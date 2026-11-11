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
// --- inlined từ _shared/providers.ts để deploy 1 file ---
// ============================================================================
// providers.ts — Registry connector mạng xã hội (dùng chung cho Edge Functions)
// SAVA Marketing Workspace — project Supabase riêng "sava-marketing-workspace".
//
// Trạng thái thật tại 11/11/2026: CHƯA provider nào có credentials / connection
// production. Mọi publish()/sync*() đều ném lỗi NOT_CONNECTED rõ ràng —
// TUYỆT ĐỐI không giả lập thành công.
//
// TikTok: theo quyết định sản phẩm, provider TikTok CHỈ có khả năng đọc
// (read_posts / read_analytics). Nó KHÔNG có method publish — sự vắng mặt này
// là cố ý ở tầng kiểu dữ liệu (TikTokProvider không kế thừa PublishCapable),
// và assertPublishable('tiktok') luôn ném lỗi.
// ============================================================================

export type PlatformId =
  | "facebook_page"
  | "instagram"
  | "linkedin_page"
  | "tiktok"
  | "youtube";

export type ConnectionStatus =
  | "not_connected" // chưa có connection / credentials
  | "pending_review" // đã nộp duyệt app ở nền tảng, chưa được production access
  | "active"; // chỉ dùng khi đã kiểm chứng thật trên production

export type CapabilityName =
  | "read_posts"
  | "read_analytics"
  | "publish"
  | "ads_read"
  | "ads_write";

/** Khả năng theo từng format nội dung. publish=false nghĩa là không đăng được format đó. */
export interface FormatCapability {
  read_posts: boolean;
  read_analytics: boolean;
  publish: boolean;
  ads_read: boolean;
  ads_write: boolean;
}

/** Snapshot nội dung ĐÃ DUYỆT bị đóng băng trong publish_jobs.snapshot. */
export interface PublishSnapshot {
  job_id: string;
  variant_id: string;
  revision_id: string;
  platform: PlatformId;
  channel_account_id: string;
  caption: string | null;
  media_asset_ids: string[];
  /** Tham chiếu file trong Storage tại thời điểm chốt duyệt: [{bucket, path}] */
  media_refs: Array<{ bucket: string; path: string }>;
  link_url: string | null;
  visibility: "public" | "unlisted" | "private";
  approval: {
    decision_id: string;
    revision_id: string;
    decided_by: string;
  };
  /** Các đích đăng của job; rỗng = 1 đích mặc định là chính channel_account. */
  destinations: Array<{ key: string; channel_account_id: string }>;
  scheduled_at: string | null;
}

export interface PublishOutcome {
  destination_key: string;
  external_post_id: string;
  external_url: string | null;
  published_at: string; // ISO 8601
}

export interface SyncedPost {
  external_post_id: string;
  external_url: string | null;
  post_type: string | null;
  caption_snapshot: string | null;
  media_snapshot: unknown[];
  published_at: string | null;
}

export interface MetricPoint {
  object_type: "external_post" | "channel_account";
  object_id: string; // external id ở nền tảng
  metric_code: string;
  value: number | null; // null = nền tảng không trả — KHÔNG ép thành 0
  period_start: string;
  period_end: string;
  period_grain: "hour" | "day" | "lifetime" | "custom";
  dimensions: Record<string, string>;
}

export interface SyncPage<T> {
  items: T[];
  next_cursor: string | null;
}

export interface SocialProvider {
  id: PlatformId;
  display_name: string;
  /** Trạng thái kiểm chứng production của connector này. */
  connection_status: ConnectionStatus;
  /** Khả năng theo format, ví dụ { post: {...}, reel: {...} }. */
  capabilities: Record<string, FormatCapability>;
  syncPosts?(args: {
    channel_account_id: string;
    cursor: string | null;
    since: string | null;
  }): Promise<SyncPage<SyncedPost>>;
  syncMetrics?(args: {
    channel_account_id: string;
    metric_codes: string[];
    cursor: string | null;
    since: string | null;
    until: string | null;
  }): Promise<SyncPage<MetricPoint>>;
}

/** Provider có khả năng đăng — TikTok KHÔNG thuộc interface này. */
export interface PublishCapableProvider extends SocialProvider {
  publish(snapshot: PublishSnapshot): Promise<PublishOutcome[]>;
}

export class ProviderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export function notConnected(providerId: PlatformId): ProviderError {
  return new ProviderError(
    "NOT_CONNECTED",
    `Kênh ${providerId} chưa kết nối: chưa có credentials/connection production đã kiểm chứng. Không đăng/đồng bộ giả.`,
  );
}

function notConnectedImpl(providerId: PlatformId) {
  return {
    publish: (_snapshot: PublishSnapshot): Promise<PublishOutcome[]> =>
      Promise.reject(notConnected(providerId)),
    syncPosts: (): Promise<SyncPage<SyncedPost>> =>
      Promise.reject(notConnected(providerId)),
    syncMetrics: (): Promise<SyncPage<MetricPoint>> =>
      Promise.reject(notConnected(providerId)),
  };
}

const NO_CAPS: FormatCapability = {
  read_posts: false,
  read_analytics: false,
  publish: false,
  ads_read: false,
  ads_write: false,
};

// ----------------------------------------------------------------------------
// Registry — capabilities phản ánh khả năng KỸ THUẬT theo tài liệu chính thức
// (xem docs/CAPABILITY_MATRIX.md), KHÔNG phản ánh quyền đã được cấp thật:
// connection_status mới là nguồn sự thật về việc đã dùng được hay chưa, và
// mọi mục hiện đều 'not_connected'.
// ----------------------------------------------------------------------------

export const facebookPageProvider: PublishCapableProvider = {
  id: "facebook_page",
  display_name: "Facebook Page",
  connection_status: "not_connected",
  capabilities: {
    post: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    photo: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    video: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    reel: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    story: { ...NO_CAPS, read_posts: true, publish: false },
  },
  ...notConnectedImpl("facebook_page"),
};

export const instagramProvider: PublishCapableProvider = {
  id: "instagram",
  display_name: "Instagram Professional",
  connection_status: "not_connected",
  capabilities: {
    post: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    reel: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    story: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true },
    carousel: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
  },
  ...notConnectedImpl("instagram"),
};

export const linkedinPageProvider: PublishCapableProvider = {
  id: "linkedin_page",
  display_name: "LinkedIn Page",
  connection_status: "pending_review", // chờ quyền Community Management / Marketing Developer Platform
  capabilities: {
    post: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    article: { ...NO_CAPS, read_posts: true, publish: true },
    video: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
  },
  ...notConnectedImpl("linkedin_page"),
};

export const youtubeProvider: PublishCapableProvider = {
  id: "youtube",
  display_name: "YouTube",
  connection_status: "not_connected",
  capabilities: {
    video: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    short: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: true, ads_read: true, ads_write: true },
    live: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: false },
  },
  ...notConnectedImpl("youtube"),
};

/**
 * Provider TikTok — CHỈ ĐỌC. Interface này cố ý không có publish và đối tượng
 * dưới đây cũng không khai báo publish. Mọi đường đăng TikTok phải đi qua
 * publish_mode='external' (đăng ngoài app, lưu external_url) ở tầng nghiệp vụ.
 */
export interface ReadOnlyProvider extends SocialProvider {
  publish?: undefined;
}

export const tiktokProvider: ReadOnlyProvider = {
  id: "tiktok",
  display_name: "TikTok",
  connection_status: "not_connected",
  capabilities: {
    video: { ...NO_CAPS, read_posts: true, read_analytics: true, publish: false },
  },
  syncPosts: () => Promise.reject(notConnected("tiktok")),
  syncMetrics: () => Promise.reject(notConnected("tiktok")),
  // Không có publish — cố ý.
};

export const providerRegistry: Record<PlatformId, SocialProvider> = {
  facebook_page: facebookPageProvider,
  instagram: instagramProvider,
  linkedin_page: linkedinPageProvider,
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
};

export function getProvider(platform: PlatformId): SocialProvider {
  const provider = providerRegistry[platform];
  if (!provider) {
    throw new ProviderError("UNKNOWN_PLATFORM", `Không có provider cho nền tảng: ${platform}`);
  }
  return provider;
}

/**
 * Chốt chặn đăng bài: ném lỗi rõ ràng với TikTok và với mọi provider chưa
 * ở trạng thái 'active' hoặc thiếu method publish.
 */
export function assertPublishable(platform: PlatformId): PublishCapableProvider {
  if (platform === "tiktok") {
    throw new ProviderError(
      "PUBLISH_NOT_SUPPORTED",
      "TikTok không đăng qua app theo quyết định sản phẩm: hãy soạn script, đăng ngoài app, rồi lưu link vào variant (publish_mode='external'). Không tạo PublishJob cho TikTok.",
    );
  }
  const provider = getProvider(platform);
  if (!("publish" in provider) || typeof (provider as PublishCapableProvider).publish !== "function") {
    throw new ProviderError(
      "PUBLISH_NOT_SUPPORTED",
      `Provider ${platform} không có khả năng publish.`,
    );
  }
  if (provider.connection_status !== "active") {
    throw notConnected(platform);
  }
  return provider as PublishCapableProvider;
}

// --- hết phần inlined từ _shared/providers.ts ---

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
