// ============================================================================
// sync-worker — Edge Function đồng bộ bài đã đăng + chỉ số từ các nền tảng.
// Được cron gọi (POST, có thể kèm { channel_account_id } để sync 1 kênh).
//
// Nguyên tắc:
//   * Chưa có connection active -> ghi sync_runs status 'waiting_connection'
//     ("Chờ kết nối"), KHÔNG bịa dữ liệu, KHÔNG coi là lỗi hệ thống.
//   * Phân trang theo cursor của nền tảng; cursor lưu ở sync_cursors để lần
//     chạy sau đi tiếp, không lấy lại từ đầu.
//   * Upsert: external_posts theo (platform, channel_account_id,
//     external_post_id); metric_observations theo unique key đầy đủ của bảng.
//   * Lỗi của 1 metric KHÔNG chặn các metric khác: mỗi metric chạy trong
//     try/catch riêng, kết quả ghi vào sync_runs.metrics_succeeded /
//     metrics_failed; run kết thúc 'partial' nếu có phần lỗi.
//   * sync_runs luôn ghi requested_range / fetched_range / missing_ranges để
//     biết khoảng dữ liệu còn thiếu mà bù sau.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getProvider,
  type MetricPoint,
  type PlatformId,
  type SyncedPost,
} from "../_shared/providers.ts";

const PAGE_LIMIT = 50; // trần số trang mỗi lần chạy để không vượt timeout Edge Function
const METRIC_CODES_BY_PLATFORM: Record<string, string[]> = {
  facebook_page: ["impressions", "reach", "engaged_users", "reactions", "comments", "shares", "video_views", "followers"],
  instagram: ["impressions", "reach", "likes", "comments", "shares", "saves", "video_views", "followers"],
  linkedin_page: ["impressions", "clicks", "reactions", "comments", "shares", "followers"],
  tiktok: ["video_views", "likes", "comments", "shares", "followers"],
  youtube: ["views", "likes", "comments", "subscribers", "watch_time_minutes"],
};

interface ChannelAccountRow {
  id: string;
  workspace_id: string;
  platform: PlatformId;
  external_id: string | null;
}

async function getCursor(
  supabase: SupabaseClient,
  account: ChannelAccountRow,
  key: string,
): Promise<{ token: string | null; last_period_end: string | null }> {
  const { data } = await supabase
    .from("sync_cursors")
    .select("cursor_token, last_period_end")
    .eq("channel_account_id", account.id)
    .eq("cursor_key", key)
    .maybeSingle();
  return { token: data?.cursor_token ?? null, last_period_end: data?.last_period_end ?? null };
}

async function saveCursor(
  supabase: SupabaseClient,
  account: ChannelAccountRow,
  key: string,
  token: string | null,
  lastPeriodEnd: string | null,
): Promise<void> {
  await supabase
    .from("sync_cursors")
    .upsert(
      {
        workspace_id: account.workspace_id,
        channel_account_id: account.id,
        cursor_key: key,
        cursor_token: token,
        last_synced_at: new Date().toISOString(),
        last_period_end: lastPeriodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_account_id,cursor_key" },
    );
}

async function syncPosts(
  supabase: SupabaseClient,
  account: ChannelAccountRow,
  runId: string,
): Promise<{ upserted: number; fetchedUntil: string | null }> {
  const provider = getProvider(account.platform);
  if (!provider.syncPosts) {
    throw Object.assign(new Error(`Provider ${account.platform} không hỗ trợ syncPosts.`), { code: "NOT_SUPPORTED" });
  }
  const cursorState = await getCursor(supabase, account, "posts");
  let cursor = cursorState.token;
  let upserted = 0;
  let fetchedUntil: string | null = cursorState.last_period_end;

  for (let page = 0; page < PAGE_LIMIT; page++) {
    const result = await provider.syncPosts({
      channel_account_id: account.id,
      cursor,
      since: cursorState.last_period_end,
    });
    for (const post of result.items as SyncedPost[]) {
      const { error } = await supabase.from("external_posts").upsert(
        {
          workspace_id: account.workspace_id,
          channel_account_id: account.id,
          platform: account.platform,
          external_post_id: post.external_post_id,
          external_url: post.external_url,
          post_type: post.post_type,
          caption_snapshot: post.caption_snapshot,
          media_snapshot: post.media_snapshot,
          published_at: post.published_at,
          raw: post as unknown as Record<string, unknown>,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "platform,channel_account_id,external_post_id" },
      );
      if (error) throw error;
      upserted++;
      if (post.published_at && (!fetchedUntil || post.published_at > fetchedUntil)) {
        fetchedUntil = post.published_at;
      }
    }
    cursor = result.next_cursor;
    if (!cursor) break;
  }
  await saveCursor(supabase, account, "posts", cursor, fetchedUntil);
  void runId;
  return { upserted, fetchedUntil };
}

async function syncMetrics(
  supabase: SupabaseClient,
  account: ChannelAccountRow,
  runId: string,
  range: { since: string; until: string },
): Promise<{ upserted: number; succeeded: string[]; failed: Array<{ metric_code: string; error_code: string; message: string }> }> {
  const provider = getProvider(account.platform);
  const succeeded: string[] = [];
  const failed: Array<{ metric_code: string; error_code: string; message: string }> = [];
  let upserted = 0;

  if (!provider.syncMetrics) {
    return {
      upserted: 0,
      succeeded,
      failed: [{ metric_code: "*", error_code: "NOT_SUPPORTED", message: `Provider ${account.platform} không hỗ trợ syncMetrics.` }],
    };
  }

  // Mỗi metric 1 vòng riêng: lỗi metric này không chặn metric khác.
  for (const metricCode of METRIC_CODES_BY_PLATFORM[account.platform] ?? []) {
    try {
      const cursorState = await getCursor(supabase, account, `metrics:${metricCode}`);
      let cursor = cursorState.token;
      for (let page = 0; page < PAGE_LIMIT; page++) {
        const result = await provider.syncMetrics({
          channel_account_id: account.id,
          metric_codes: [metricCode],
          cursor,
          since: range.since,
          until: range.until,
        });
        for (const point of result.items as MetricPoint[]) {
          const { error } = await supabase.from("metric_observations").upsert(
            {
              workspace_id: account.workspace_id,
              source: account.platform,
              object_type: point.object_type,
              object_id: point.object_id,
              metric_code: point.metric_code,
              value: point.value,
              period_start: point.period_start,
              period_end: point.period_end,
              period_grain: point.period_grain,
              scope: point.object_type === "channel_account" ? "account" : "organic",
              dimensions: point.dimensions,
              definition_version: 1,
              sync_run_id: runId,
            },
            {
              onConflict:
                "source,object_type,object_id,metric_code,period_start,period_end,scope,dimensions,definition_version",
            },
          );
          if (error) throw error;
          upserted++;
        }
        cursor = result.next_cursor;
        if (!cursor) break;
      }
      await saveCursor(supabase, account, `metrics:${metricCode}`, cursor, range.until);
      succeeded.push(metricCode);
    } catch (e) {
      const err = e as { code?: string; message: string };
      failed.push({ metric_code: metricCode, error_code: err.code ?? "SYNC_ERROR", message: err.message });
    }
  }
  return { upserted, succeeded, failed };
}

async function syncAccount(
  supabase: SupabaseClient,
  account: ChannelAccountRow,
  range: { since: string; until: string },
): Promise<string> {
  // Kiểm tra connection trước: chưa kết nối -> run 'waiting_connection'.
  const { data: connection } = await supabase
    .from("connections")
    .select("id, status")
    .eq("channel_account_id", account.id)
    .maybeSingle();

  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({
      workspace_id: account.workspace_id,
      channel_account_id: account.id,
      run_type: "sync_all",
      status: "running",
      requested_range: `[${range.since},${range.until}]`,
    })
    .select("id")
    .single();
  if (runError || !run) return "run_create_failed";
  const runId = run.id as string;

  const finish = async (patch: Record<string, unknown>): Promise<string> => {
    await supabase
      .from("sync_runs")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", runId);
    return patch.status as string;
  };

  if (!connection || connection.status !== "active") {
    return finish({
      status: "waiting_connection",
      error_code: "NOT_CONNECTED",
      error_message: "Chờ kết nối: kênh chưa có connection active nên chưa đồng bộ được.",
    });
  }

  try {
    const posts = await syncPosts(supabase, account, runId);
    const metrics = await syncMetrics(supabase, account, runId, range);
    const hasFailure = metrics.failed.length > 0;
    return finish({
      status: hasFailure ? "partial" : "succeeded",
      fetched_range: `[${range.since},${posts.fetchedUntil ?? range.until}]`,
      missing_ranges: hasFailure
        ? metrics.failed.map((f) => ({ start: range.since, end: range.until, reason: `metric ${f.metric_code}: ${f.error_code}` }))
        : [],
      metrics_succeeded: metrics.succeeded,
      metrics_failed: metrics.failed,
      posts_upserted: posts.upserted,
      observations_upserted: metrics.upserted,
    });
  } catch (e) {
    const err = e as { code?: string; message: string };
    return finish({
      status: err.code === "NOT_CONNECTED" ? "not_connected" : "failed",
      error_code: err.code ?? "SYNC_ERROR",
      error_message: err.message,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const cronSecret = Deno.env.get("SYNC_CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: { channel_account_id?: string; since?: string; until?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const until = body.until ?? new Date().toISOString();
  const since = body.since ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  let query = supabase.from("channel_accounts").select("id, workspace_id, platform, external_id");
  if (body.channel_account_id) query = query.eq("id", body.channel_account_id);
  const { data: accounts, error } = await query;
  if (error) {
    return Response.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 });
  }

  const summary: Record<string, number> = {};
  for (const account of (accounts ?? []) as ChannelAccountRow[]) {
    const result = await syncAccount(supabase, account, { since, until });
    summary[result] = (summary[result] ?? 0) + 1;
  }
  return Response.json({ accounts: accounts?.length ?? 0, summary });
});
