/*
 * js/store-core.js — Logic thuần của lớp Store (SAVA Marketing Workspace).
 * Không chạm DOM, không gọi mạng: chuyển đổi camelCase ↔ snake_case, mapping
 * collection (frontend) ↔ bảng (Supabase, 0001_schema.sql), lọc trường không
 * phải cột thật, đóng gói trường giao diện vào custom_fields (với bảng có cột
 * đó), dựng payload + điều kiện khóa lạc quan (optimistic lock theo updated_at),
 * và phân tích hash của link mời / khôi phục mật khẩu của Supabase Auth.
 * Dùng được ở trình duyệt (window.SAVA_STORE_CORE) và trong Node (module.exports).
 */
(function (global) {
  'use strict';

  // ---------- Đổi tên trường ----------
  function camelToSnake(name) {
    return String(name || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
  }
  function snakeToCamel(name) {
    return String(name || '').replace(/_([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
  }

  // ---------- Mapping collection → bảng ----------
  // approvals → approval_steps (yêu cầu duyệt đang chờ) + approval_decisions
  // (quyết định bất biến) — xem ghi chú trong js/store.js.
  // manualMetricEntries → metric_observations (số liệu nhập tay là 1 dạng
  // observation có source='manual' — cùng bảng với metricObservations).
  var COLLECTION_TO_TABLE = {
    members: 'memberships', // đặc biệt: memberships JOIN users (xử lý riêng ở store.js)
    businessUnits: 'bu_products',
    campaigns: 'campaigns',
    phases: 'phases',
    activities: 'activities',
    tasks: 'tasks',
    dependencies: 'task_dependencies',
    blockers: 'blockers',
    contentItems: 'content_items',
    variants: 'content_variants',
    publishJobs: 'publish_jobs',
    brandPages: 'brand_pages',
    brandAssets: 'assets',
    approvals: 'approval_steps',
    channelAccounts: 'channel_accounts',
    externalPosts: 'external_posts',
    metricObservations: 'metric_observations',
    budgetLines: 'budget_lines',
    commitments: 'budget_commitments',
    actuals: 'budget_actuals',
    kpis: 'kpis',
    adAccounts: 'ad_accounts',
    adCampaigns: 'ad_campaigns',
    adSets: 'ad_groups',
    ads: 'ads',
    adChangeRequests: 'ads_change_requests',
    marketingRequests: 'marketing_requests',
    reportSnapshots: 'report_snapshots',
    manualMetricEntries: 'metric_observations',
    comments: 'comments',
    assetVersions: 'asset_versions',
    measurements: 'measurements'
  };

  // ---------- Cột thật của từng bảng (trích từ 0001_schema.sql) ----------
  var TABLE_COLUMNS = {
    workspaces: ['id', 'name', 'slug', 'timezone', 'settings', 'created_at', 'updated_at', 'archived_at'],
    users: ['id', 'email', 'display_name', 'avatar_url', 'is_active', 'created_at', 'updated_at'],
    memberships: ['id', 'workspace_id', 'user_id', 'role', 'is_active', 'invited_by', 'created_at', 'updated_at'],
    bu_products: ['id', 'workspace_id', 'bu_name', 'name', 'description', 'status', 'custom_fields', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    brand_pages: ['id', 'workspace_id', 'product_id', 'name', 'brand_voice', 'guidelines', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    channel_accounts: ['id', 'workspace_id', 'brand_page_id', 'platform', 'external_id', 'display_name', 'handle', 'profile_url', 'status', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    assets: ['id', 'workspace_id', 'name', 'asset_type', 'storage_bucket', 'storage_path', 'external_url', 'mime_type', 'size_bytes', 'width', 'height', 'duration_sec', 'tags', 'rights_note', 'status', 'approval_status', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    asset_versions: ['id', 'workspace_id', 'asset_id', 'version_no', 'storage_bucket', 'storage_path', 'external_url', 'change_note', 'created_by', 'created_at'],
    campaigns: ['id', 'workspace_id', 'plan_id', 'product_id', 'name', 'objectives', 'audiences', 'insights', 'big_idea', 'key_message', 'cta', 'offer', 'kv_direction', 'custom_fields', 'baseline', 'baseline_timeline', 'status', 'risk_note', 'owner_id', 'start_date', 'end_date', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    phases: ['id', 'workspace_id', 'plan_id', 'campaign_id', 'name', 'sort_order', 'start_date', 'end_date', 'status', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    activities: ['id', 'workspace_id', 'plan_id', 'campaign_id', 'phase_id', 'name', 'description', 'sort_order', 'start_date', 'end_date', 'status', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    tasks: ['id', 'workspace_id', 'campaign_id', 'phase_id', 'activity_id', 'content_item_id', 'parent_id', 'title', 'description', 'owner_id', 'collaborators', 'approver_id', 'start_date', 'due_date', 'completed_at', 'priority', 'effort_hours', 'progress_percent', 'status', 'is_blocked', 'sort_order', 'custom_fields', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    task_dependencies: ['id', 'workspace_id', 'predecessor_id', 'successor_id', 'type', 'lag_days', 'created_by', 'created_at'],
    blockers: ['id', 'workspace_id', 'task_id', 'description', 'reported_by', 'reported_at', 'handler_id', 'resolve_by', 'status', 'external_party', 'resolution_note', 'resolved_at', 'created_at', 'updated_at'],
    content_items: ['id', 'workspace_id', 'campaign_id', 'task_id', 'title', 'content_type', 'brief', 'owner_id', 'status', 'planned_at', 'custom_fields', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    content_variants: ['id', 'workspace_id', 'content_item_id', 'channel_account_id', 'platform', 'format', 'caption', 'media_asset_ids', 'link_url', 'visibility', 'first_comment', 'editorial_status', 'approval_status', 'approved_revision_id', 'current_revision_id', 'publishing_status', 'publish_mode', 'scheduled_at', 'published_at', 'external_url', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    content_revisions: ['id', 'workspace_id', 'variant_id', 'revision_no', 'caption', 'media_asset_ids', 'link_url', 'visibility', 'snapshot', 'change_note', 'created_by', 'created_at'],
    tiktok_scripts: ['id', 'workspace_id', 'variant_id', 'hook', 'scenes', 'cta', 'caption', 'hashtags', 'external_url', 'posted_at', 'created_by', 'created_at', 'updated_at'],
    approval_steps: ['id', 'workspace_id', 'content_item_id', 'variant_id', 'campaign_id', 'step_order', 'name', 'approver_id', 'approver_role', 'status', 'created_at', 'updated_at'],
    approval_decisions: ['id', 'workspace_id', 'step_id', 'variant_id', 'revision_id', 'decision', 'decided_by', 'comment', 'decided_at', 'created_at'],
    external_posts: ['id', 'workspace_id', 'channel_account_id', 'platform', 'external_post_id', 'external_url', 'post_type', 'caption_snapshot', 'media_snapshot', 'published_at', 'author_external_id', 'raw', 'source', 'archived_at', 'first_synced_at', 'last_synced_at', 'created_at', 'updated_at'],
    post_content_mappings: ['id', 'workspace_id', 'external_post_id', 'variant_id', 'content_item_id', 'campaign_id', 'mapping_source', 'confidence', 'created_by', 'created_at'],
    metric_observations: ['id', 'workspace_id', 'source', 'object_type', 'object_id', 'metric_code', 'value', 'period_start', 'period_end', 'period_grain', 'scope', 'dimensions', 'definition_version', 'currency', 'observed_at', 'sync_run_id', 'created_at'],
    kpis: ['id', 'workspace_id', 'campaign_id', 'plan_id', 'product_id', 'metric_code', 'name', 'target_value', 'unit', 'period_start', 'period_end', 'owner_id', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    measurements: ['id', 'workspace_id', 'kpi_id', 'measured_at', 'period_start', 'period_end', 'value', 'source', 'note', 'created_by', 'created_at'],
    budget_lines: ['id', 'workspace_id', 'plan_id', 'campaign_id', 'name', 'category', 'approved_amount', 'currency', 'period_start', 'period_end', 'owner_id', 'note', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    budget_commitments: ['id', 'workspace_id', 'budget_line_id', 'description', 'amount', 'currency', 'vendor', 'status', 'settled_amount', 'committed_at', 'expected_at', 'created_by', 'created_at', 'updated_at', 'archived_at'],
    budget_actuals: ['id', 'workspace_id', 'budget_line_id', 'commitment_id', 'ad_spend_source_id', 'description', 'amount', 'currency', 'spent_at', 'source', 'created_by', 'created_at', 'updated_at'],
    ad_accounts: ['id', 'workspace_id', 'platform', 'external_id', 'name', 'currency', 'timezone', 'status', 'connection_id', 'created_by', 'created_at', 'updated_at'],
    ad_campaigns: ['id', 'workspace_id', 'ad_account_id', 'campaign_id', 'external_id', 'name', 'objective', 'status', 'external_created_at', 'last_synced_at', 'raw', 'created_at', 'updated_at'],
    ad_groups: ['id', 'workspace_id', 'ad_campaign_id', 'external_id', 'name', 'status', 'targeting', 'last_synced_at', 'raw', 'created_at', 'updated_at'],
    ads: ['id', 'workspace_id', 'ad_group_id', 'external_id', 'name', 'status', 'creative', 'external_post_id', 'last_synced_at', 'raw', 'created_at', 'updated_at'],
    ads_insights: ['id', 'workspace_id', 'object_type', 'object_id', 'period_start', 'period_end', 'impressions', 'clicks', 'spend', 'currency', 'reach', 'results', 'result_type', 'conversion_value', 'dimensions', 'sync_run_id', 'observed_at', 'created_at'],
    ads_change_requests: ['id', 'workspace_id', 'ad_account_id', 'target_type', 'target_external_id', 'change_type', 'before_state', 'after_state', 'amount', 'currency', 'reason', 'status', 'submit_as_paused', 'requested_by', 'approved_by', 'approved_at', 'submitted_at', 'confirmed_at', 'external_reference', 'error_code', 'error_message', 'archived_at', 'created_at', 'updated_at'],
    publish_jobs: ['id', 'workspace_id', 'variant_id', 'revision_id', 'decision_id', 'channel_account_id', 'platform', 'idempotency_key', 'snapshot', 'status', 'scheduled_at', 'is_late', 'cancel_reason', 'authorized_by', 'last_error_code', 'last_error_message', 'created_by', 'created_at', 'updated_at'],
    marketing_requests: ['id', 'workspace_id', 'requester_id', 'requester_unit', 'title', 'description', 'request_type', 'product_id', 'campaign_id', 'priority', 'desired_due_date', 'status', 'assignee_id', 'rejection_reason', 'custom_fields', 'archived_at', 'created_by', 'created_at', 'updated_at'],
    report_snapshots: ['id', 'workspace_id', 'name', 'report_type', 'scope', 'period_start', 'period_end', 'data', 'definition_versions', 'generated_by', 'generated_at', 'created_at'],
    comments: ['id', 'workspace_id', 'entity_type', 'entity_id', 'parent_id', 'body', 'mentions', 'author_id', 'created_at', 'updated_at']
  };

  // Bảng có cột custom_fields → trường giao diện chưa có cột thật được gói vào đây.
  var CUSTOM_FIELDS_TABLES = { bu_products: true, campaigns: true, tasks: true, content_items: true, marketing_requests: true };
  // Bảng có archived_at (xoá mềm); các bảng mapped còn lại không có nên xoá thật.
  var SOFT_DELETE_COLUMNS = { workspaces: 'archived_at' };
  // R31: entity chính có archived_at — remove = archive (không hard-delete).
  var ARCHIVABLE_TABLES = { bu_products: true, brand_pages: true, assets: true, campaigns: true, phases: true, activities: true, tasks: true, content_items: true, content_variants: true, channel_accounts: true, kpis: true, budget_lines: true, external_posts: true, ads_change_requests: true, marketing_requests: true };

  // ---------- Alias trường: tên ở frontend (camel) → cột thật (snake) ----------
  // Chỉ khai báo khi tên tự động camel→snake KHÔNG ra đúng cột, hoặc ngữ nghĩa khác.
  var FIELD_ALIASES = {
    tasks: { assigneeId: 'owner_id' },
    campaigns: { audienceInsights: 'insights', creativeDirection: 'kv_direction', risks: 'risk_note' },
    brandPages: { title: 'name', summary: 'brand_voice' },
    brandAssets: { type: 'asset_type' },
    channelAccounts: { name: 'display_name' },
    externalPosts: { title: 'caption_snapshot', url: 'external_url' },
    metricObservations: { metric: 'metric_code' },
    manualMetricEntries: { metric: 'metric_code' },
    budgetLines: { approved: 'approved_amount' },
    commitments: { title: 'description' },
    actuals: { title: 'description', date: 'spent_at' },
    kpis: { target: 'target_value' },
    adSets: { adCampaignId: 'ad_campaign_id' },
    ads: { adSetId: 'ad_group_id' },
    adChangeRequests: { requestedBy: 'requested_by' },
    marketingRequests: { requester: 'requester_unit', dueDate: 'desired_due_date', note: 'description' },
    reportSnapshots: { title: 'name' },
    assetVersions: { version: 'version_no' },
    contentItems: { type: 'content_type' },
    variants: {},
    approvals: { requestedAt: 'created_at' }
  };
  // Trường chỉ để hiển thị ở frontend, không bao giờ gửi lên server.
  function isLabelField(camelKey) { return /Label$/.test(camelKey); }

  // ---------- Platform: giá trị frontend ↔ enum ở DB ----------
  var PLATFORM_TO_DB = { facebook: 'facebook_page', facebook_page: 'facebook_page', instagram: 'instagram', linkedin: 'linkedin_page', linkedin_page: 'linkedin_page', tiktok: 'tiktok', youtube: 'youtube' };
  var PLATFORM_FROM_DB = { facebook_page: 'facebook', instagram: 'instagram', linkedin_page: 'linkedin', tiktok: 'tiktok', youtube: 'youtube' };
  var PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn' };
  // Nền tảng ads: frontend dùng nhãn hiển thị ('Meta Ads'…), DB dùng enum.
  var AD_PLATFORM_TO_DB = { 'Meta Ads': 'meta_ads', meta_ads: 'meta_ads', 'Google Ads': 'google_ads', google_ads: 'google_ads', 'TikTok Ads': 'tiktok_ads', tiktok_ads: 'tiktok_ads', 'LinkedIn Ads': 'linkedin_ads', linkedin_ads: 'linkedin_ads' };

  function columnsOf(table) { return TABLE_COLUMNS[table] || []; }
  function hasColumn(table, snake) { return columnsOf(table).indexOf(snake) !== -1; }

  function aliasFor(collection, camelKey) {
    var map = FIELD_ALIASES[collection] || {};
    return map[camelKey] || null;
  }
  function reverseAliasFor(collection, snakeKey) {
    var map = FIELD_ALIASES[collection] || {};
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) if (map[keys[i]] === snakeKey) return keys[i];
    return null;
  }

  var UNSET = '__UNSET__';
  var VALID_ASSET_TYPES = ['image', 'video', 'audio', 'document', 'design', 'other'];
  var VALID_VARIANT_PLATFORMS = ['facebook_page', 'instagram', 'linkedin_page', 'tiktok', 'youtube'];

  /**
   * Chuẩn hoá giá trị đặc thù trước khi ghi (enum ở DB chặt hơn nhãn frontend).
   * Trả { value, stash } — stash là giá trị gốc cần giữ lại trong custom_fields
   * (nếu bảng có) để đọc về không mất thông tin hiển thị.
   */
  function normalizeWriteValue(collection, snakeKey, value) {
    if (collection === 'variants' && snakeKey === 'platform' && value != null) {
      var p = PLATFORM_TO_DB[String(value).toLowerCase()] || String(value);
      return { value: VALID_VARIANT_PLATFORMS.indexOf(p) !== -1 ? p : null };
    }
    if (collection === 'externalPosts' && snakeKey === 'platform' && value != null) {
      var ep = PLATFORM_TO_DB[String(value).toLowerCase()] || String(value);
      return { value: ep };
    }
    if (collection === 'channelAccounts' && snakeKey === 'platform' && value != null) {
      var cp = PLATFORM_TO_DB[String(value).toLowerCase()] || String(value);
      return { value: cp };
    }
    if (collection === 'channelAccounts' && snakeKey === 'status' && value != null) {
      var cs = { 'Chờ kết nối': 'not_connected', 'Đã kết nối': 'connected', 'Cần đăng nhập lại': 'needs_reauth', 'Đã ngắt kết nối': 'disconnected', 'Lỗi': 'error' }[value];
      return { value: cs || (['not_connected', 'connected', 'needs_reauth', 'disconnected', 'error'].indexOf(value) !== -1 ? value : 'not_connected'), stash: cs ? undefined : value };
    }
    if (collection === 'brandAssets' && snakeKey === 'asset_type' && value != null) {
      var at = String(value).toLowerCase();
      return VALID_ASSET_TYPES.indexOf(at) !== -1 ? { value: at } : { value: 'other', stash: value };
    }
    if (collection === 'brandAssets' && snakeKey === 'status' && value != null) {
      var bs = { Approved: 'active', Draft: 'active', 'In review': 'active', Archived: 'archived' }[value];
      return { value: bs || (value === 'active' || value === 'archived' ? value : 'active') };
    }
    if (collection === 'brandPages' && snakeKey === 'name') return { value: value };
    if (collection === 'contentItems' && snakeKey === 'status' && value != null) {
      var st = { draft: 'draft', in_review: 'in_review', approved: 'approved', scheduled: 'scheduled' }[value];
      return { value: st || value, stash: st ? undefined : value };
    }
    if (collection === 'commitments' && snakeKey === 'status' && value != null) {
      var cm = { open: 'committed', resolved: 'settled', closed: 'settled' }[value];
      return { value: cm || value };
    }
    if (collection === 'marketingRequests' && snakeKey === 'priority' && value != null) {
      var pr = { 'Thấp': 'low', 'Trung bình': 'medium', 'Cao': 'high', 'Khẩn cấp': 'urgent', low: 'low', medium: 'medium', high: 'high', urgent: 'urgent' }[value];
      return { value: pr || 'medium' };
    }
    if (collection === 'adAccounts' && snakeKey === 'platform' && value != null) {
      return { value: AD_PLATFORM_TO_DB[value] || 'meta_ads', stash: value };
    }
    if (collection === 'adAccounts' && snakeKey === 'status' && value != null) {
      var as = ['not_connected', 'active', 'needs_reauth', 'disabled', 'error'].indexOf(value) !== -1 ? value : 'not_connected';
      return { value: as, stash: as === value ? undefined : value };
    }
    return { value: value };
  }

  /**
   * camel object (frontend) → payload snake_case để ghi Supabase.
   * - Bỏ qua trường nhãn (*Label) và trường không phải cột thật.
   * - Trường chưa có cột thật: nếu bảng có custom_fields thì gói vào đó,
   *   ngược lại bỏ qua (không gửi rác lên REST — PostgREST sẽ báo lỗi cột lạ).
   * - Bỏ qua id rỗng / undefined; giữ null (xoá giá trị) khi người dùng chủ ý.
   */
  function toDbPayload(collection, obj, options) {
    options = options || {};
    var table = COLLECTION_TO_TABLE[collection];
    if (!table || !obj) return {};
    var payload = {};
    var stash = {}; // gói vào custom_fields
    var existingCustom = (obj.customFields && typeof obj.customFields === 'object') ? obj.customFields : (obj.custom_fields || {});
    Object.keys(obj).forEach(function (key) {
      if (key === 'customFields' || key === 'custom_fields') return;
      if (isLabelField(key)) return;
      var value = obj[key];
      if (value === undefined) return;
      var snake = aliasFor(collection, key) || camelToSnake(key);
      if (hasColumn(table, snake)) {
        var norm = normalizeWriteValue(collection, snake, value);
        if (norm.stash !== undefined) stash[key] = norm.stash;
        if (snake === 'id' && (norm.value === null || norm.value === '' || (options.forInsert && !/^[0-9a-f-]{36}$/i.test(String(norm.value))))) return;
        payload[snake] = norm.value;
      } else if (CUSTOM_FIELDS_TABLES[table]) {
        stash[key] = value;
      }
      // Không có cột và không có custom_fields → bỏ qua có chủ ý.
    });
    if (CUSTOM_FIELDS_TABLES[table] && (Object.keys(stash).length || Object.keys(existingCustom).length)) {
      var merged = {};
      Object.keys(existingCustom).forEach(function (k) { merged[camelToSnake(k)] = existingCustom[k]; });
      Object.keys(stash).forEach(function (k) {
        if (stash[k] === UNSET) delete merged[camelToSnake(k)]; else merged[camelToSnake(k)] = stash[k];
      });
      payload.custom_fields = merged;
    }
    if (options.workspaceId && hasColumn(table, 'workspace_id')) payload.workspace_id = options.workspaceId;
    if (options.forInsert && hasColumn(table, 'created_by') && options.userId && payload.created_by === undefined) {
      payload.created_by = options.userId;
    }
    return payload;
  }

  /**
   * Dòng snake_case từ Supabase → object camelCase cho frontend.
   * custom_fields được bung ngược lên top-level (không ghi đè cột thật).
   */
  function fromDbRow(collection, row) {
    var table = COLLECTION_TO_TABLE[collection];
    if (!row) return null;
    var out = {};
    Object.keys(row).forEach(function (snake) {
      if (snake === 'custom_fields') return;
      // Giữ cả tên camel tự nhiên lẫn tên alias của frontend (vd owner_id →
      // ownerId VÀ assigneeId) để mọi view đều đọc được.
      var natural = snakeToCamel(snake);
      out[natural] = row[snake];
      var alias = reverseAliasFor(collection, snake);
      if (alias && alias !== natural) out[alias] = row[snake];
    });
    var cf = row.custom_fields;
    if (cf && typeof cf === 'object') {
      out.customFields = cf;
      Object.keys(cf).forEach(function (k) {
        var camel = snakeToCamel(k);
        if (out[camel] === undefined) out[camel] = cf[k];
      });
    }
    // Chuẩn hoá ngược các enum đặc thù về giá trị frontend vẫn đang dùng.
    if ((collection === 'variants' || collection === 'externalPosts' || collection === 'channelAccounts') && out.platform) {
      out.platform = PLATFORM_FROM_DB[out.platform] || out.platform;
    }
    if (collection === 'variants' && out.platform) out.channelLabel = PLATFORM_LABELS[out.platform] || out.platform;
    if (collection === 'tasks' && out.ownerId && out.assigneeId === undefined) out.assigneeId = out.ownerId;
    if (collection === 'brandAssets') {
      if (out.customFields && out.customFields.type) out.type = out.customFields.type;
      if (out.status === 'active' && !(out.customFields && out.customFields.status)) out.statusLabel = undefined;
    }
    return out;
  }

  /**
   * Dựng payload + điều kiện cho UPDATE có khóa lạc quan (AC09):
   * chỉ ghi khi updated_at ở server vẫn bằng updated_at bản đang giữ;
   * payload tự mang updated_at mới (DB không có trigger updated_at chung).
   * Trả null nếu bản ghi không có updated_at (bảng không hỗ trợ khóa lạc quan).
   */
  function buildOptimisticUpdate(collection, patch, currentItem, nowIso) {
    var table = COLLECTION_TO_TABLE[collection];
    if (!table || !currentItem || !currentItem.id) return null;
    if (!hasColumn(table, 'updated_at') || !currentItem.updatedAt) return null;
    var payload = toDbPayload(collection, patch || {});
    delete payload.id;
    delete payload.created_at;
    delete payload.workspace_id;
    payload.updated_at = nowIso || new Date().toISOString();
    return {
      table: table,
      payload: payload,
      match: { id: currentItem.id, updated_at: currentItem.updatedAt }
    };
  }

  // ---------- Hash của Supabase Auth (mời / khôi phục mật khẩu) ----------
  /**
   * Phân tích location.hash. Supabase redirect về dạng:
   *   #access_token=…&refresh_token=…&type=invite|recovery|signup…
   *   #error=access_denied&error_code=otp_expired&error_description=…
   * Hash route của app luôn bắt đầu bằng '#/' nên không xung đột.
   */
  function parseAuthHash(hash) {
    var raw = String(hash || '');
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    if (!raw || raw.charAt(0) === '/') return { isAuthCallback: false, expired: false };
    var params = {};
    try {
      new URLSearchParams(raw).forEach(function (v, k) { params[k] = v; });
    } catch (e) { return { isAuthCallback: false, expired: false }; }
    var errorCode = params.error_code || '';
    var error = params.error || '';
    if (error || errorCode) {
      return {
        isAuthCallback: true, hasError: true, expired: errorCode === 'otp_expired' || /expired/i.test(error),
        error: error, errorCode: errorCode,
        errorDescription: params.error_description ? decodeURIComponent(params.error_description.replace(/\+/g, ' ')) : '',
        type: params.type || null, accessToken: params.access_token || null, refreshToken: params.refresh_token || null
      };
    }
    var type = params.type || null;
    if (params.access_token && (type === 'invite' || type === 'recovery')) {
      return { isAuthCallback: true, hasError: false, expired: false, type: type, accessToken: params.access_token, refreshToken: params.refresh_token || null };
    }
    if (params.access_token) {
      return { isAuthCallback: true, hasError: false, expired: false, type: type, accessToken: params.access_token, refreshToken: params.refresh_token || null };
    }
    return { isAuthCallback: false, expired: false };
  }

  /** Kiểm tra mật khẩu đặt mới: tối thiểu 8 ký tự + hai lần nhập khớp nhau. */
  function validateNewPassword(pw1, pw2) {
    if (!pw1 || pw1.length < 8) return { ok: false, error: 'Mật khẩu phải có tối thiểu 8 ký tự.' };
    if (pw1 !== pw2) return { ok: false, error: 'Hai lần nhập mật khẩu chưa khớp nhau.' };
    return { ok: true };
  }


  // ======================================================================
  // R32/R30 — PERMISSIONS matrix + validation DÙNG CHUNG demo & real.
  // Đây là nguồn sự thật phía client: demo adapter và Supabase adapter đều
  // phải kiểm cùng matrix này (backend/RLS vẫn là lớp cuối). CEO = chỉ đọc.
  // ======================================================================
  var PERMISSION_ACTIONS = [
    'data.read', 'data.edit', 'task.updateStatus', 'task.edit', 'campaign.edit',
    'content.edit', 'asset.edit', 'kpi.edit', 'budget.edit', 'approval.decide',
    'publish.create', 'settings.manage', 'member.manage', 'channel.connect',
    'analytics.view', 'ads.read', 'ads.draft', 'ads.approve'
  ];
  function _perm(over) { var m = {}; PERMISSION_ACTIONS.forEach(function (a) { m[a] = false; }); Object.keys(over || {}).forEach(function (k) { m[k] = !!over[k]; }); return m; }
  var PERMISSIONS = {
    owner: _perm({ 'data.read': true, 'data.edit': true, 'task.updateStatus': true, 'task.edit': true, 'campaign.edit': true, 'content.edit': true, 'asset.edit': true, 'kpi.edit': true, 'budget.edit': true, 'approval.decide': true, 'publish.create': true, 'settings.manage': true, 'member.manage': true, 'channel.connect': true, 'analytics.view': true, 'ads.read': true, 'ads.draft': true, 'ads.approve': true }),
    lead: _perm({ 'data.read': true, 'data.edit': true, 'task.updateStatus': true, 'task.edit': true, 'campaign.edit': true, 'content.edit': true, 'asset.edit': true, 'kpi.edit': true, 'budget.edit': true, 'approval.decide': true, 'publish.create': true, 'analytics.view': true, 'ads.read': true, 'ads.draft': true, 'ads.approve': true }),
    member: _perm({ 'data.read': true, 'data.edit': true, 'task.updateStatus': true, 'task.edit': true, 'content.edit': true, 'asset.edit': true, 'kpi.edit': true, 'analytics.view': true, 'ads.read': true, 'ads.draft': true }),
    ceo: _perm({ 'data.read': true, 'analytics.view': true, 'ads.read': true })
  };
  // Tên quyền cũ (app.js đang dùng) → action mới. can()/canRole() nhận cả hai.
  var LEGACY_PERMISSION_MAP = {
    read: 'data.read', edit: 'data.edit', approve: 'approval.decide',
    budget: 'budget.edit', budgetChange: 'budget.edit', publish: 'publish.create',
    connect: 'channel.connect', analytics: 'analytics.view',
    adsRead: 'ads.read', adsDraft: 'ads.draft', adsApprove: 'ads.approve'
  };
  function resolvePermission(perm) { return LEGACY_PERMISSION_MAP[perm] || perm; }
  function canRole(role, perm) {
    var m = PERMISSIONS[String(role || '').toLowerCase()];
    if (!m) return false;
    return !!m[resolvePermission(perm)];
  }

  // ---------- Ngày theo timezone workspace (R30) ----------
  var DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
  /** todayISO theo timezone (KHÔNG dùng UTC): 'yyyy-mm-dd' của "hôm nay" tại tz. */
  function todayISO(timezone, now) {
    var tz = timezone || DEFAULT_TIMEZONE;
    var d = now ? new Date(now) : new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      var o = {}; parts.forEach(function (x) { o[x.type] = x.value; });
      if (o.year && o.month && o.day) return o.year + '-' + o.month + '-' + o.day;
    } catch (e) { /* Intl không có tz: rơi xuống giờ máy */ }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** Tháng hiện tại theo timezone workspace — calendar mặc định dùng khoảng này. */
  function currentMonthRange(timezone, now) {
    var today = todayISO(timezone, now);
    var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var mm = String(m).padStart(2, '0');
    return { year: y, month: m, start: y + '-' + mm + '-01', end: y + '-' + mm + '-' + String(last).padStart(2, '0'), today: today };
  }
  function _dateOnly(v) {
    if (v == null || v === '') return null;
    var str = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
  }
  /** validateDateRange: start<=end theo ngày (yyyy-mm-dd). Trả {ok, error?}. */
  function validateDateRange(start, end, labels) {
    var s = _dateOnly(start), e = _dateOnly(end);
    if (start != null && start !== '' && !s) return { ok: false, error: 'Ngày bắt đầu không hợp lệ.' };
    if (end != null && end !== '' && !e) return { ok: false, error: 'Ngày kết thúc không hợp lệ.' };
    if (s && e && s > e) return { ok: false, error: ((labels && labels.start) || 'Ngày bắt đầu') + ' phải nhỏ hơn hoặc bằng ' + ((labels && labels.end) || 'ngày kết thúc') + '.' };
    return { ok: true };
  }
  function validateNumber(value, opts) {
    opts = opts || {};
    if (value == null || value === '') return { ok: true };
    var n = Number(value);
    if (!isFinite(n)) return { ok: false, error: 'Giá trị phải là số hợp lệ.' };
    if (opts.min != null && n < opts.min) return { ok: false, error: 'Giá trị không được nhỏ hơn ' + opts.min + '.' };
    return { ok: true, value: n };
  }
  var DATE_PAIRS = [['startDate', 'endDate'], ['startDate', 'dueDate'], ['periodStart', 'periodEnd'], ['start', 'end']];
  var NON_NEGATIVE_FIELDS = ['effortHours', 'amount', 'approved', 'approvedAmount', 'target', 'targetValue', 'value', 'settledAmount'];
  /** Validation dùng chung cho create/update (demo & real cùng gọi). */
  function validateEntity(collection, obj, existing) {
    var merged = Object.assign({}, existing || {}, obj || {});
    var errors = [];
    DATE_PAIRS.forEach(function (pair) {
      if (merged[pair[0]] != null || merged[pair[1]] != null) {
        var r = validateDateRange(merged[pair[0]], merged[pair[1]]);
        if (!r.ok) errors.push(r.error);
      }
    });
    NON_NEGATIVE_FIELDS.forEach(function (f) {
      // 'target'/'targetValue' chỉ là SỐ ở kpis (mục tiêu). Ở adChangeRequests
      // 'target' là NHÃN đối tượng quảng cáo (chuỗi) — kiểm số ở đó làm submit
      // draft→pending_approval (patch kèm target nhãn như app.js gửi) fail oan.
      if ((f === 'target' || f === 'targetValue') && collection !== 'kpis') return;
      if (merged[f] !== undefined) { var r = validateNumber(merged[f], { min: 0 }); if (!r.ok) errors.push(f + ': ' + r.error); }
    });
    return { ok: errors.length === 0, errors: errors, error: errors[0] || null };
  }
  /** Parent cycle: gán parentId cho taskId có tạo vòng cha-con không (đi ngược chuỗi parent). */
  function wouldCreateParentCycle(items, taskId, parentId) {
    if (!parentId) return false;
    if (taskId && String(parentId) === String(taskId)) return true;
    var byId = {}; (items || []).forEach(function (t) { byId[t.id] = t; });
    var cur = parentId, seen = {};
    while (cur) {
      if (taskId && String(cur) === String(taskId)) return true;
      if (seen[cur]) return true; // vòng có sẵn trong dữ liệu
      seen[cur] = true;
      var node = byId[cur];
      cur = node ? (node.parentId || node.parent_id || null) : null;
    }
    return false;
  }
  /** Merge custom_fields: patch '__UNSET__' = xoá field đó; field khác giữ nguyên (R18/QA05). */
  function mergeCustomFields(oldFields, patchFields) {
    var out = {};
    Object.keys(oldFields || {}).forEach(function (k) { out[k] = oldFields[k]; });
    Object.keys(patchFields || {}).forEach(function (k) {
      if (patchFields[k] === UNSET) delete out[k]; else out[k] = patchFields[k];
    });
    return out;
  }
  // ---------- Hash ổn định + idempotency (R28) ----------
  function stableStringify(x) {
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + stableStringify(x[k]); }).join(',') + '}';
  }
  function stableHash(x) {
    var str = typeof x === 'string' ? x : stableStringify(x);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }
  /** Slot lịch khớp tới phút: cùng intent trong cùng phút → cùng slot. */
  function scheduleSlot(iso) {
    if (!iso) return 'now';
    var d = new Date(iso); if (isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toISOString().slice(0, 16); // yyyy-mm-ddThh:mm
  }
  function publishIdempotencyKey(variantId, revisionId, accountId, scheduledAt) {
    var slot = scheduleSlot(scheduledAt);
    return 'job-' + stableHash([variantId, revisionId, accountId, slot].join('|')) + '-' + slot.replace(/[^0-9]/g, '').slice(0, 12);
  }
  /**
   * R19/QA24 — payload partial cho ads_change_requests.
   * Chỉ field có trong patch mới được gửi; after_state CHỈ khi explicitProposal
   * (người dùng sửa proposal thật) hoặc khi insert (DB bắt buộc after_state).
   */
  function adChangePayload(patch, currentItem, options) {
    options = options || {};
    patch = patch || {};
    var payload = {};
    var passthrough = ['status', 'amount', 'currency', 'reason', 'changeType', 'change_type', 'targetType', 'target_type', 'adAccountId', 'ad_account_id', 'submitAsPaused', 'submit_as_paused'];
    passthrough.forEach(function (k) { if (patch[k] !== undefined) payload[k] = patch[k]; });
    if (patch.target !== undefined && options.explicitProposal) payload.target_external_id = patch.target;
    if (patch.targetExternalId !== undefined) payload.target_external_id = patch.targetExternalId;
    var existingAfter = (currentItem && (currentItem.afterState || currentItem.after_state)) || {};
    if (patch.afterState !== undefined || patch.after_state !== undefined) {
      payload.after_state = Object.assign({}, existingAfter, patch.afterState || patch.after_state || {});
    } else if (options.explicitProposal && (patch.title !== undefined || patch.target !== undefined)) {
      payload.after_state = Object.assign({}, existingAfter);
      if (patch.title !== undefined) payload.after_state.title = patch.title;
      if (patch.target !== undefined) payload.after_state.target = patch.target;
    } else if (options.forInsert) {
      payload.after_state = Object.assign({}, existingAfter, { title: patch.title || '', target: patch.target || '' });
      if (!payload.target_external_id) payload.target_external_id = patch.target || patch.title || '';
    }
    // status-only patch: tuyệt đối không đụng before_state/after_state.
    return payload;
  }

  var api = {
    camelToSnake: camelToSnake,
    snakeToCamel: snakeToCamel,
    COLLECTION_TO_TABLE: COLLECTION_TO_TABLE,
    TABLE_COLUMNS: TABLE_COLUMNS,
    CUSTOM_FIELDS_TABLES: CUSTOM_FIELDS_TABLES,
    SOFT_DELETE_COLUMNS: SOFT_DELETE_COLUMNS,
    FIELD_ALIASES: FIELD_ALIASES,
    PLATFORM_TO_DB: PLATFORM_TO_DB,
    PLATFORM_FROM_DB: PLATFORM_FROM_DB,
    PLATFORM_LABELS: PLATFORM_LABELS,
    isLabelField: isLabelField,
    hasColumn: hasColumn,
    toDbPayload: toDbPayload,
    fromDbRow: fromDbRow,
    buildOptimisticUpdate: buildOptimisticUpdate,
    parseAuthHash: parseAuthHash,
    validateNewPassword: validateNewPassword,
    UNSET: UNSET,
    ARCHIVABLE_TABLES: ARCHIVABLE_TABLES,
    PERMISSIONS: PERMISSIONS,
    PERMISSION_ACTIONS: PERMISSION_ACTIONS,
    LEGACY_PERMISSION_MAP: LEGACY_PERMISSION_MAP,
    resolvePermission: resolvePermission,
    canRole: canRole,
    DEFAULT_TIMEZONE: DEFAULT_TIMEZONE,
    todayISO: todayISO,
    currentMonthRange: currentMonthRange,
    validateDateRange: validateDateRange,
    validateNumber: validateNumber,
    validateEntity: validateEntity,
    wouldCreateParentCycle: wouldCreateParentCycle,
    mergeCustomFields: mergeCustomFields,
    stableStringify: stableStringify,
    stableHash: stableHash,
    scheduleSlot: scheduleSlot,
    publishIdempotencyKey: publishIdempotencyKey,
    adChangePayload: adChangePayload
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SAVA_STORE_CORE = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
