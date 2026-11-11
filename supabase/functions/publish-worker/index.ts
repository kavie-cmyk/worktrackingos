// ============================================================================
// publish-worker — Edge Function thực thi publish_jobs tới hạn.
// Được bộ lập lịch (cron / pg_cron / Supabase scheduled invocation) gọi định kỳ
// bằng POST. Hàm này KHÔNG tự lập lịch.
//
// Luồng an toàn cho mỗi job:
//   1) Quá giờ (now > scheduled_at + grace) -> 'late_pending_decision',
//      KHÔNG tự đăng, chờ người quyết định.
//   2) Claim lạc quan: update ... where status='queued' — chỉ 1 worker thắng.
//   3) Revalidate: quyền người ủy quyền còn hiệu lực, connection còn active,
//      approval gắn đúng revision trong snapshot, variant còn 'approved'.
//   4) Gửi qua provider.publish(snapshot) — chỉ đăng đúng snapshot đã duyệt.
//   5) Kết quả theo TỪNG ĐÍCH: đích thành công giữ nguyên, retry sau chỉ
//      chạy đích lỗi. Timeout sau khi đã gửi -> 'needs_check', cấm retry mù.
// Provider thật chưa có credentials: registry ném NOT_CONNECTED và job được
// ghi 'failed' với mã lỗi đó — không bao giờ giả thành công.
// TikTok: DB đã chặn tạo job; worker vẫn kiểm tra lại và hủy nếu gặp.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertPublishable,
  type PublishOutcome,
  type PublishSnapshot,
} from "../_shared/providers.ts";

const GRACE_MINUTES = Number(Deno.env.get("PUBLISH_GRACE_MINUTES") ?? "30");
const SEND_TIMEOUT_MS = Number(Deno.env.get("PUBLISH_SEND_TIMEOUT_MS") ?? "25000");
const BATCH_LIMIT = 20;

// Vai trò có quyền 'publish' — khớp ma trận role_has_permission ở 0002_rls.sql.
const ROLES_CAN_PUBLISH = ["owner", "lead"];

interface PublishJobRow {
  id: string;
  workspace_id: string;
  variant_id: string;
  revision_id: string;
  channel_account_id: string;
  platform: string;
  snapshot: PublishSnapshot;
  status: string;
  scheduled_at: string | null;
  authorized_by: string | null;
}

class SendTimeoutError extends Error {
  code = "SEND_TIMEOUT";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new SendTimeoutError(`Quá ${ms}ms khi gửi tới nền tảng`)), ms)
    ),
  ]);
}

async function setJobStatus(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("publish_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function recordAttempt(
  supabase: SupabaseClient,
  job: PublishJobRow,
  destinationKey: string,
  outcome: string,
  error?: { code: string; message: string },
): Promise<void> {
  const { count } = await supabase
    .from("publish_attempts")
    .select("id", { count: "exact", head: true })
    .eq("publish_job_id", job.id);
  await supabase.from("publish_attempts").insert({
    workspace_id: job.workspace_id,
    publish_job_id: job.id,
    attempt_no: (count ?? 0) + 1,
    destination_key: destinationKey,
    finished_at: new Date().toISOString(),
    outcome,
    error_code: error?.code ?? null,
    error_message: error?.message ?? null,
  });
}

async function upsertResult(
  supabase: SupabaseClient,
  job: PublishJobRow,
  row: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("publish_results")
    .upsert(
      { workspace_id: job.workspace_id, publish_job_id: job.id, ...row, updated_at: new Date().toISOString() },
      { onConflict: "publish_job_id,destination_key" },
    );
}

/** Revalidate sau khi claim. Trả { ok: true } hoặc trạng thái đích + lỗi. */
async function revalidate(
  supabase: SupabaseClient,
  job: PublishJobRow,
): Promise<{ ok: true } | { ok: false; status: string; code: string; message: string }> {
  // a) Người ủy quyền còn là thành viên active và còn quyền publish.
  if (!job.authorized_by) {
    return { ok: false, status: "failed", code: "NO_AUTHORIZER", message: "Job không có người ủy quyền đăng." };
  }
  const { data: membership } = await supabase
    .from("memberships")
    .select("role, is_active")
    .eq("workspace_id", job.workspace_id)
    .eq("user_id", job.authorized_by)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership || !ROLES_CAN_PUBLISH.includes(membership.role as string)) {
    return {
      ok: false, status: "failed", code: "AUTHORIZATION_INVALID",
      message: "Người ủy quyền không còn quyền publish trong workspace.",
    };
  }

  // b) Connection của kênh còn active.
  const { data: connection } = await supabase
    .from("connections")
    .select("status")
    .eq("channel_account_id", job.channel_account_id)
    .maybeSingle();
  if (!connection || connection.status !== "active") {
    return {
      ok: false, status: "needs_reauth", code: "CONNECTION_NOT_ACTIVE",
      message: `Connection chưa active (hiện tại: ${connection?.status ?? "không có"}). Cần kết nối/ủy quyền lại.`,
    };
  }

  // c) Approval còn gắn đúng revision trong snapshot và variant còn approved.
  const snapshot = job.snapshot;
  if (!snapshot?.approval || snapshot.approval.revision_id !== job.revision_id) {
    return {
      ok: false, status: "cancelled", code: "APPROVAL_REVISION_MISMATCH",
      message: "Snapshot không gắn approval của đúng revision của job. Hủy để duyệt lại.",
    };
  }
  const { data: variant } = await supabase
    .from("content_variants")
    .select("approval_status, approved_revision_id, publish_mode")
    .eq("id", job.variant_id)
    .maybeSingle();
  if (!variant || variant.approval_status !== "approved" || variant.approved_revision_id !== job.revision_id) {
    return {
      ok: false, status: "cancelled", code: "APPROVAL_INVALIDATED",
      message: "Variant không còn ở trạng thái approved cho revision này (có thể đã sửa nội dung sau duyệt).",
    };
  }
  if (variant.publish_mode !== "app") {
    return {
      ok: false, status: "cancelled", code: "PUBLISH_MODE_EXTERNAL",
      message: "Variant ở chế độ đăng ngoài app (external) — không thực thi qua worker.",
    };
  }
  const { data: decision } = await supabase
    .from("approval_decisions")
    .select("id")
    .eq("id", snapshot.approval.decision_id)
    .eq("revision_id", job.revision_id)
    .eq("decision", "approved")
    .maybeSingle();
  if (!decision) {
    return {
      ok: false, status: "cancelled", code: "APPROVAL_DECISION_NOT_FOUND",
      message: "Không tìm thấy quyết định approved cho revision trong snapshot.",
    };
  }
  return { ok: true };
}

async function processJob(supabase: SupabaseClient, job: PublishJobRow): Promise<string> {
  const now = Date.now();

  // 1) Quá giờ: đánh dấu chờ quyết định, tuyệt đối không tự đăng.
  if (job.scheduled_at) {
    const lateAfter = new Date(job.scheduled_at).getTime() + GRACE_MINUTES * 60_000;
    if (now > lateAfter) {
      const { data: updated } = await supabase
        .from("publish_jobs")
        .update({ status: "late_pending_decision", is_late: true, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id");
      return updated?.length ? "late_pending_decision" : "skipped_not_queued";
    }
  }

  // 2) Claim lạc quan: chỉ worker update được từ 'queued' mới sở hữu job.
  const { data: claimed } = await supabase
    .from("publish_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return "skipped_claim_lost";

  // TikTok không bao giờ được đăng qua worker (DB đã chặn; đây là chốt phụ).
  if (job.platform === "tiktok") {
    await setJobStatus(supabase, job.id, {
      status: "cancelled",
      cancel_reason: "TikTok không đăng qua app — đăng ngoài app và lưu link vào variant.",
      last_error_code: "PUBLISH_NOT_SUPPORTED",
      last_error_message: "PublishJob cho TikTok bị hủy bởi worker.",
    });
    return "cancelled_tiktok";
  }

  // 3) Revalidate quyền / connection / approval.
  const check = await revalidate(supabase, job);
  if (!check.ok) {
    await setJobStatus(supabase, job.id, {
      status: check.status,
      cancel_reason: check.status === "cancelled" ? check.message : null,
      last_error_code: check.code,
      last_error_message: check.message,
    });
    return check.status;
  }

  // 4) Gửi theo từng đích; đích đã succeeded (retry) thì bỏ qua.
  const snapshot = job.snapshot;
  const destinations = snapshot.destinations?.length
    ? snapshot.destinations
    : [{ key: "primary", channel_account_id: job.channel_account_id }];

  const { data: priorResults } = await supabase
    .from("publish_results")
    .select("destination_key, status")
    .eq("publish_job_id", job.id);
  const alreadySucceeded = new Set(
    (priorResults ?? []).filter((r) => r.status === "succeeded").map((r) => r.destination_key as string),
  );

  let succeeded = alreadySucceeded.size;
  let failed = 0;
  let needsCheck = 0;
  let lastError: { code: string; message: string } | null = null;

  for (const dest of destinations) {
    if (alreadySucceeded.has(dest.key)) continue;

    let provider;
    try {
      provider = assertPublishable(job.platform as PublishSnapshot["platform"]);
    } catch (e) {
      // Chưa kết nối / không hỗ trợ: lỗi TRƯỚC khi gửi — an toàn để thử lại sau.
      const err = e as { code?: string; message: string };
      failed++;
      lastError = { code: err.code ?? "PROVIDER_ERROR", message: err.message };
      await recordAttempt(supabase, job, dest.key, "failed", lastError);
      await upsertResult(supabase, job, {
        destination_key: dest.key,
        channel_account_id: dest.channel_account_id,
        status: "failed",
        error_code: lastError.code,
        error_message: lastError.message,
      });
      continue;
    }

    // Từ đây request được coi là ĐÃ GỬI đi: nếu timeout thì kết quả không
    // chắc chắn -> needs_check, không retry mù (tránh đăng trùng).
    try {
      const outcomes: PublishOutcome[] = await withTimeout(provider.publish(snapshot), SEND_TIMEOUT_MS);
      const outcome = outcomes.find((o) => o.destination_key === dest.key) ?? outcomes[0];
      if (!outcome) throw new Error("Provider không trả kết quả cho đích này.");
      succeeded++;
      await recordAttempt(supabase, job, dest.key, "succeeded");
      await upsertResult(supabase, job, {
        destination_key: dest.key,
        channel_account_id: dest.channel_account_id,
        status: "succeeded",
        external_post_id: outcome.external_post_id,
        external_url: outcome.external_url,
        published_at: outcome.published_at,
        error_code: null,
        error_message: null,
      });
    } catch (e) {
      if (e instanceof SendTimeoutError) {
        needsCheck++;
        lastError = { code: e.code, message: e.message };
        await recordAttempt(supabase, job, dest.key, "timeout_after_send", lastError);
        await upsertResult(supabase, job, {
          destination_key: dest.key,
          channel_account_id: dest.channel_account_id,
          status: "needs_check",
          error_code: lastError.code,
          error_message: "Đã gửi nhưng không nhận được xác nhận — cần kiểm tra trên nền tảng trước khi thử lại.",
        });
      } else {
        const err = e as { code?: string; message: string };
        failed++;
        lastError = { code: err.code ?? "PROVIDER_ERROR", message: err.message };
        await recordAttempt(supabase, job, dest.key, "failed", lastError);
        await upsertResult(supabase, job, {
          destination_key: dest.key,
          channel_account_id: dest.channel_account_id,
          status: "failed",
          error_code: lastError.code,
          error_message: lastError.message,
        });
      }
    }
  }

  // 5) Chốt trạng thái job theo kết quả từng đích (partial success được giữ).
  if (needsCheck > 0) {
    await setJobStatus(supabase, job.id, {
      status: "needs_check",
      last_error_code: lastError?.code ?? "SEND_TIMEOUT",
      last_error_message: lastError?.message ?? null,
    });
    return "needs_check";
  }
  if (succeeded === destinations.length) {
    await setJobStatus(supabase, job.id, { status: "published", last_error_code: null, last_error_message: null });
    await supabase
      .from("content_variants")
      .update({ publishing_status: "published", published_at: new Date().toISOString() })
      .eq("id", job.variant_id);
    return "published";
  }
  await setJobStatus(supabase, job.id, {
    status: "failed",
    last_error_code: lastError?.code ?? "PARTIAL_FAILURE",
    last_error_message: succeeded > 0
      ? `Thành công ${succeeded}/${destinations.length} đích; retry chỉ chạy các đích còn lỗi. ${lastError?.message ?? ""}`
      : (lastError?.message ?? "Đăng thất bại."),
  });
  return succeeded > 0 ? "failed_partial" : "failed";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const cronSecret = Deno.env.get("PUBLISH_CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const nowIso = new Date().toISOString();
  const { data: jobs, error } = await supabase
    .from("publish_jobs")
    .select("id, workspace_id, variant_id, revision_id, channel_account_id, platform, snapshot, status, scheduled_at, authorized_by")
    .eq("status", "queued")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return Response.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 });
  }

  const summary: Record<string, number> = {};
  for (const job of (jobs ?? []) as PublishJobRow[]) {
    const result = await processJob(supabase, job);
    summary[result] = (summary[result] ?? 0) + 1;
  }
  return Response.json({ processed: jobs?.length ?? 0, summary });
});
