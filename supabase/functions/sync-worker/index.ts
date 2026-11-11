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
