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
