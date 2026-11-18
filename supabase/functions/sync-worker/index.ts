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
// Vòng R1 (R20): registry ĐÃ có OAuth authorize URL builder + callback
// contract cho cả 5 kênh (implementation_status =
// 'implemented_needs_credentials'); token exchange và lời gọi API
// publish/sync CHƯA triển khai — đó là bước tiếp theo khi có app credentials.
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

/**
 * Mức triển khai CODE của connector (R20) — tách khỏi ConnectionStatus
 * (quyền/tài khoản thật):
 *   not_implemented               — chưa có code OAuth/callback.
 *   implemented_needs_credentials — ĐÃ có authorize URL builder +
 *                                   callback contract (xem OAUTH bên dưới);
 *                                   còn thiếu app credentials + tài khoản
 *                                   thật để chạy. Token exchange và lời gọi
 *                                   API publish/sync vẫn chưa triển khai —
 *                                   publish()/sync*() vẫn ném NOT_CONNECTED.
 */
export type OAuthImplementationStatus =
  | "not_implemented"
  | "implemented_needs_credentials";

/**
 * Mức triển khai code theo TỪNG khả năng API (R2-23) — trục thứ hai, tách
 * khỏi connection_status (tài khoản thật) và implementation_status (OAuth):
 *   not_implemented               — chưa có code cho khả năng này.
 *   implemented_needs_credentials — đã có code, chờ app credentials/tài khoản.
 *   verified                      — đã chạy kiểm chứng với tài khoản thật.
 * Giá trị thật hiện tại (12/11/2026): oauth của mọi provider =
 * 'implemented_needs_credentials'; publish / syncPosts / syncMetrics / ads
 * của mọi provider = 'not_implemented' (kể cả TikTok — publish của TikTok
 * còn bị loại theo thiết kế, xem publish_support).
 */
export type ApiImplementationStatus =
  | "not_implemented"
  | "implemented_needs_credentials"
  | "verified";

/** Mức triển khai code cho từng khả năng API của một provider. */
export interface ApiImplementation {
  oauth: ApiImplementationStatus;
  publish: ApiImplementationStatus;
  syncPosts: ApiImplementationStatus;
  syncMetrics: ApiImplementationStatus;
  ads: ApiImplementationStatus;
}

/** Giá trị hiện tại dùng chung: chỉ OAuth đã có code, còn lại chưa triển khai. */
const API_IMPL_CURRENT: ApiImplementation = {
  oauth: "implemented_needs_credentials",
  publish: "not_implemented",
  syncPosts: "not_implemented",
  syncMetrics: "not_implemented",
  ads: "not_implemented",
};

/** publish qua API được hỗ trợ theo thiết kế hay bị loại có chủ đích. */
export type PublishSupport = "supported" | "not_supported_by_design";

/** Cấu hình OAuth 2.0 theo tài liệu chính thức của từng nền tảng. */
export interface OAuthConfig {
  authorize_url: string;
  token_url: string;
  scopes: string[];
  /** URL tài liệu chính thức làm nguồn cho authorize_url/scopes. */
  docs_url: string;
  /** TikTok dùng tham số client_key thay cho client_id ở authorize URL. */
  client_id_param: "client_id" | "client_key";
}

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
  /** Mức triển khai code OAuth (R20) — xem OAuthImplementationStatus. */
  implementation_status: OAuthImplementationStatus;
  /** Mức triển khai code theo từng khả năng API (R2-23) — xem ApiImplementation. */
  api_implementation: ApiImplementation;
  /** Cấu hình OAuth để buildAuthorizeUrl dùng. */
  oauth: OAuthConfig;
  /** TikTok = 'not_supported_by_design', các kênh còn lại 'supported'. */
  publish_support: PublishSupport;
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
  implementation_status: "implemented_needs_credentials",
  api_implementation: API_IMPL_CURRENT,
  publish_support: "supported",
  oauth: {
    authorize_url: "https://www.facebook.com/v21.0/dialog/oauth",
    token_url: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: [
      "pages_show_list", "pages_read_engagement", "pages_manage_posts",
      "pages_read_user_content", "instagram_basic", "instagram_content_publish",
      "instagram_manage_insights", "read_insights", "ads_read", "ads_management",
    ],
    docs_url: "https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow",
    client_id_param: "client_id",
  },
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
  implementation_status: "implemented_needs_credentials",
  api_implementation: API_IMPL_CURRENT,
  publish_support: "supported",
  oauth: {
    // Instagram API with Instagram Login (không qua Facebook Login).
    authorize_url: "https://www.instagram.com/oauth/authorize",
    token_url: "https://api.instagram.com/oauth/access_token",
    scopes: [
      "instagram_business_basic", "instagram_business_content_publish",
      "instagram_business_manage_comments", "instagram_business_manage_insights",
    ],
    docs_url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login",
    client_id_param: "client_id",
  },
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
  implementation_status: "implemented_needs_credentials",
  api_implementation: API_IMPL_CURRENT,
  publish_support: "supported",
  oauth: {
    authorize_url: "https://www.linkedin.com/oauth/v2/authorization",
    token_url: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: [
      "r_organization_social", "w_organization_social", "rw_organization_admin",
      "r_ads", "rw_ads",
    ],
    docs_url: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow",
    client_id_param: "client_id",
  },
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
  implementation_status: "implemented_needs_credentials",
  api_implementation: API_IMPL_CURRENT,
  publish_support: "supported",
  oauth: {
    authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    docs_url: "https://developers.google.com/identity/protocols/oauth2/web-server",
    client_id_param: "client_id",
  },
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
  implementation_status: "implemented_needs_credentials",
  api_implementation: API_IMPL_CURRENT,
  publish_support: "not_supported_by_design", // chỉ đọc: Login Kit + Display/Research API
  oauth: {
    authorize_url: "https://www.tiktok.com/v2/auth/authorize/",
    token_url: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.list", "video.query"],
    docs_url: "https://developers.tiktok.com/doc/login-kit-web",
    client_id_param: "client_key",
  },
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

// ----------------------------------------------------------------------------
// OAuth — authorize URL builder + callback contract (R20)
// buildAuthorizeUrl dựng URL ủy quyền ĐÚNG domain/scope theo tài liệu chính
// thức (oauth.docs_url của từng provider). Hàm chỉ dựng URL: việc mở URL,
// nhận code ở redirect URI và đổi code lấy token (token_url) thuộc luồng
// onboarding của app khi đã có client_id/client_secret thật.
// ----------------------------------------------------------------------------

export function buildAuthorizeUrl(
  providerId: PlatformId,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const provider = getProvider(providerId);
  const cfg = provider.oauth;
  const params = new URLSearchParams();
  params.set(cfg.client_id_param, clientId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("state", state);
  // LinkedIn + Google tách scope bằng khoảng trắng; Meta/TikTok bằng dấu phẩy.
  const scopeSep = providerId === "linkedin_page" || providerId === "youtube" ? " " : ",";
  params.set("scope", cfg.scopes.join(scopeSep));
  if (providerId === "youtube") {
    params.set("access_type", "offline"); // để nhận refresh_token
    params.set("include_granted_scopes", "true");
  }
  return `${cfg.authorize_url}?${params.toString()}`;
}

export interface OAuthCallbackResult {
  provider: PlatformId;
  code: string;
  state: string | null;
  /** Endpoint đổi code -> token (bước thực thi thuộc luồng onboarding). */
  token_url: string;
}

/**
 * Callback contract: kiểm tra query của redirect URI sau khi user ủy quyền.
 * Ném ProviderError khi nền tảng trả error, thiếu code, hoặc state không
 * khớp expectedState (chống CSRF). Trả { code, token_url } khi hợp lệ —
 * KHÔNG tự đổi token ở đây (chưa có client_secret trong registry).
 */
export function parseOAuthCallback(
  providerId: PlatformId,
  params: URLSearchParams,
  expectedState?: string,
): OAuthCallbackResult {
  const provider = getProvider(providerId);
  const error = params.get("error");
  if (error) {
    throw new ProviderError(
      "OAUTH_DENIED",
      `Nền tảng ${providerId} trả lỗi ủy quyền: ${error} ${params.get("error_description") ?? ""}`.trim(),
    );
  }
  const state = params.get("state");
  if (expectedState !== undefined && state !== expectedState) {
    throw new ProviderError("OAUTH_STATE_MISMATCH", "state ở callback không khớp state đã gửi — hủy luồng ủy quyền.");
  }
  const code = params.get("code");
  if (!code) {
    throw new ProviderError("OAUTH_CODE_MISSING", `Callback của ${providerId} thiếu code.`);
  }
  return { provider: providerId, code, state, token_url: provider.oauth.token_url };
}
// --- hết phần inlined từ _shared/providers.ts ---

// Trần số trang mỗi lần chạy để không vượt timeout Edge Function. Đây KHÔNG
// phải mốc hoàn thành (R29): chạm trần mà provider còn next_cursor thì lần
// chạy là 'incomplete', cursor được lưu để lần sau resume — chỉ khi hết
// cursor mới chốt mốc hoàn thành (last_period_end).
const PAGE_LIMIT = 50;
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
): Promise<{ upserted: number; fetchedUntil: string | null; complete: boolean }> {
  const provider = getProvider(account.platform);
  if (!provider.syncPosts) {
    throw Object.assign(new Error(`Provider ${account.platform} không hỗ trợ syncPosts.`), { code: "NOT_SUPPORTED" });
  }
  const cursorState = await getCursor(supabase, account, "posts");
  let cursor = cursorState.token;
  let upserted = 0;
  let fetchedUntil: string | null = cursorState.last_period_end;
  let complete = false;

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
          source: "api",
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
    if (!cursor) {
      complete = true;
      // Lấy hết: chốt cursor=null + mốc hoàn thành mới.
      await saveCursor(supabase, account, "posts", null, fetchedUntil);
      break;
    }
    // R29: còn trang — lưu NGAY next cursor để lần chạy sau (kể cả khi lần
    // này lỗi/timeout ở trang kế tiếp) resume đúng chỗ; mốc hoàn thành
    // last_period_end GIỮ NGUYÊN, không cập nhật khi chưa lấy hết.
    await saveCursor(supabase, account, "posts", cursor, cursorState.last_period_end);
  }
  void runId;
  return { upserted, fetchedUntil, complete };
}

async function syncMetrics(
  supabase: SupabaseClient,
  account: ChannelAccountRow,
  runId: string,
  range: { since: string; until: string },
): Promise<{ upserted: number; succeeded: string[]; failed: Array<{ metric_code: string; error_code: string; message: string }>; incomplete: string[] }> {
  const provider = getProvider(account.platform);
  const succeeded: string[] = [];
  const failed: Array<{ metric_code: string; error_code: string; message: string }> = [];
  const incomplete: string[] = [];
  let upserted = 0;

  if (!provider.syncMetrics) {
    return {
      upserted: 0,
      succeeded,
      incomplete,
      failed: [{ metric_code: "*", error_code: "NOT_SUPPORTED", message: `Provider ${account.platform} không hỗ trợ syncMetrics.` }],
    };
  }

  // Mỗi metric 1 vòng riêng: lỗi metric này không chặn metric khác.
  for (const metricCode of METRIC_CODES_BY_PLATFORM[account.platform] ?? []) {
    try {
      const cursorState = await getCursor(supabase, account, `metrics:${metricCode}`);
      let cursor = cursorState.token;
      let metricComplete = false;
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
        if (!cursor) {
          metricComplete = true;
          break;
        }
        // R29: còn trang — lưu cursor resume ngay, KHÔNG chốt mốc kỳ.
        await saveCursor(supabase, account, `metrics:${metricCode}`, cursor, cursorState.last_period_end);
      }
      if (metricComplete) {
        await saveCursor(supabase, account, `metrics:${metricCode}`, null, range.until);
        succeeded.push(metricCode);
      } else {
        incomplete.push(metricCode);
      }
    } catch (e) {
      const err = e as { code?: string; message: string };
      failed.push({ metric_code: metricCode, error_code: err.code ?? "SYNC_ERROR", message: err.message });
    }
  }
  return { upserted, succeeded, failed, incomplete };
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
    // R29: còn trang (posts hoặc metric nào đó) -> 'incomplete', không báo đủ.
    const incompleteReasons: Array<{ start: string; end: string; reason: string }> = [];
    if (!posts.complete) {
      incompleteReasons.push({ start: range.since, end: range.until, reason: "posts: còn trang chưa lấy — cursor đã lưu, lần chạy sau resume" });
    }
    for (const code of metrics.incomplete) {
      incompleteReasons.push({ start: range.since, end: range.until, reason: `metric ${code}: còn trang chưa lấy — cursor đã lưu, lần chạy sau resume` });
    }
    const isIncomplete = incompleteReasons.length > 0;
    return finish({
      status: hasFailure ? "partial" : isIncomplete ? "incomplete" : "succeeded",
      fetched_range: posts.complete ? `[${range.since},${posts.fetchedUntil ?? range.until}]` : null,
      missing_ranges: [
        ...metrics.failed.map((f) => ({ start: range.since, end: range.until, reason: `metric ${f.metric_code}: ${f.error_code}` })),
        ...incompleteReasons,
      ],
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

// ----------------------------------------------------------------------------
// R35 — Gate fail-closed: worker dùng service_role nên CHỈ chấp nhận người
// gọi server/cron đã xác thực, kiểm tra TRƯỚC khi tạo service client:
//   (a) header x-cron-secret khớp env SYNC_CRON_SECRET, hoặc
//   (b) Authorization: Bearer == SUPABASE_SERVICE_ROLE_KEY (đường pg_cron
//       đang dùng — key lấy từ Vault, xem docs/WORKERS.md).
// Thiếu cả hai / không khớp -> 401. TUYỆT ĐỐI không dùng mẫu fail-open
// `if (cronSecret && ...)` (env trống là lọt qua).
// ----------------------------------------------------------------------------
function isAuthorizedCaller(req: Request, cronSecretEnvName: string): boolean {
  const cronSecret = Deno.env.get(cronSecretEnvName);
  const provided = req.headers.get("x-cron-secret");
  if (cronSecret && provided && provided === cronSecret) return true;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (serviceKey && auth === `Bearer ${serviceKey}`) return true;
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!isAuthorizedCaller(req, "SYNC_CRON_SECRET")) {
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
