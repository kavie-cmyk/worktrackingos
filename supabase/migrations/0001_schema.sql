-- ============================================================================
-- SAVA Marketing Workspace — 0001_schema.sql
-- Project Supabase RIÊNG: "sava-marketing-workspace" (chưa tạo — migration này
-- chỉ là mã nguồn, chưa áp lên bất kỳ database thật nào).
-- Múi giờ nghiệp vụ: Asia/Ho_Chi_Minh (lưu timestamptz, hiển thị ở tầng app).
-- Tuần bắt đầu thứ Hai, ngày hiển thị dd/mm/yyyy — xử lý ở tầng app.
-- TikTok: KHÔNG tự đăng — không có đường tạo publish_jobs cho TikTok
-- (xem ràng buộc ở publish_jobs + registry ở functions/_shared/providers.ts).
-- Quy ước: mọi bảng nghiệp vụ đều có workspace_id để RLS (0002) lọc theo
-- workspace một cách trực tiếp, tránh join vòng.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. WORKSPACES / USERS / MEMBERSHIPS / ROLES
-- Vai trò (role) chỉ có 4 giá trị: 'owner' | 'lead' | 'member' | 'ceo'.
-- ----------------------------------------------------------------------------

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  timezone    text not null default 'Asia/Ho_Chi_Minh',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.workspaces is 'Không gian làm việc Marketing (mặc định 1 workspace cho SAVA META).';

-- users: hồ sơ ứng dụng, id TRÙNG với auth.users.id của Supabase Auth.
create table public.users (
  id           uuid primary key,
  email        text not null unique,
  display_name text not null,
  avatar_url   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.users is 'Hồ sơ người dùng; id = auth.users.id. Quyền KHÔNG nằm ở đây — quyền nằm ở memberships.';

create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'lead', 'member', 'ceo')),
  is_active    boolean not null default true,
  invited_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

comment on table public.memberships is 'Quan hệ user ↔ workspace + vai trò. Chỉ owner được sửa (RLS 0002): member không tự cấp quyền.';

create index memberships_user_idx on public.memberships (user_id);
create index memberships_workspace_role_idx on public.memberships (workspace_id, role);

-- ----------------------------------------------------------------------------
-- 2. BU / SẢN PHẨM / BRAND PAGE (bề mặt thương hiệu theo kênh)
-- ----------------------------------------------------------------------------

create table public.bu_products (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bu_name      text not null,                       -- ví dụ: Game Studio / Publishing / AI / Metaverse
  name         text not null,                       -- sản phẩm / game / dịch vụ
  description  text,
  status       text not null default 'active' check (status in ('active', 'paused', 'archived')),
  custom_fields jsonb not null default '{}'::jsonb,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index bu_products_workspace_idx on public.bu_products (workspace_id);

create table public.brand_pages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id   uuid references public.bu_products (id) on delete set null,
  name         text not null,                       -- tên page/thương hiệu hiển thị nội bộ
  brand_voice  text,                                -- giọng thương hiệu / ghi chú định hướng
  guidelines   jsonb not null default '{}'::jsonb,  -- màu, font, điều cấm kị…
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index brand_pages_workspace_idx on public.brand_pages (workspace_id);
create index brand_pages_product_idx on public.brand_pages (product_id);

-- ----------------------------------------------------------------------------
-- 3. KÊNH / KẾT NỐI / KHẢ NĂNG KẾT NỐI
-- connection_capabilities tách riêng từng quyền: read_posts, read_analytics,
-- publish, ads_read, ads_write — có quyền đọc KHÔNG suy ra có quyền đăng/ghi.
-- Token KHÔNG lưu ở các bảng này (token ở kho bí mật của nhà cung cấp/Edge
-- Function secrets); ở đây chỉ lưu trạng thái + phạm vi đã được cấp.
-- ----------------------------------------------------------------------------

create table public.channel_accounts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  brand_page_id   uuid references public.brand_pages (id) on delete set null,
  platform        text not null check (platform in ('facebook_page', 'instagram', 'linkedin_page', 'tiktok', 'youtube')),
  external_id     text,                             -- Page ID / IG user id / URN / channel id…
  display_name    text not null,
  handle          text,                             -- @username nếu có
  profile_url     text,
  status          text not null default 'not_connected'
                    check (status in ('not_connected', 'connected', 'needs_reauth', 'disconnected', 'error')),
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);

create index channel_accounts_workspace_idx on public.channel_accounts (workspace_id);
create index channel_accounts_platform_idx on public.channel_accounts (workspace_id, platform);

create table public.connections (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts (id) on delete cascade,
  provider          text not null check (provider in ('facebook_page', 'instagram', 'linkedin_page', 'tiktok', 'youtube')),
  status            text not null default 'not_connected'
                      check (status in ('not_connected', 'pending_review', 'active', 'needs_reauth', 'revoked', 'error', 'disconnected')),
  granted_scopes    text[] not null default '{}',
  connected_by      uuid references public.users (id) on delete set null,
  connected_at      timestamptz,
  expires_at        timestamptz,
  last_error_code   text,
  last_error_message text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (channel_account_id)
);

comment on table public.connections is 'Một channel_account có tối đa 1 connection hiện hành. Chỉ owner quản lý (RLS 0002). Không lưu access token ở đây.';

create index connections_workspace_idx on public.connections (workspace_id);
create index connections_status_idx on public.connections (workspace_id, status);

create table public.connection_capabilities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  connection_id uuid not null references public.connections (id) on delete cascade,
  capability    text not null check (capability in ('read_posts', 'read_analytics', 'publish', 'ads_read', 'ads_write')),
  is_granted    boolean not null default false,
  verified_at   timestamptz,                        -- null = chưa kiểm chứng trên production
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (connection_id, capability)
);

comment on table public.connection_capabilities is 'Quyền theo từng khả năng, tách riêng: read_posts/read_analytics/publish/ads_read/ads_write. TikTok không bao giờ có dòng publish được cấp theo quyết định sản phẩm (vẫn tạo bản ghi is_granted=false + note nếu cần minh bạch).';

create index connection_capabilities_conn_idx on public.connection_capabilities (connection_id);

-- ----------------------------------------------------------------------------
-- 4. ASSETS / ASSET VERSIONS (thư viện tư liệu — file thật ở Supabase Storage)
-- ----------------------------------------------------------------------------

create table public.assets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  asset_type    text not null check (asset_type in ('image', 'video', 'audio', 'document', 'design', 'other')),
  storage_bucket text,
  storage_path   text,                              -- đường dẫn trong Storage, null nếu chỉ là link ngoài
  external_url   text,
  mime_type      text,
  size_bytes     bigint,
  width          integer,
  height         integer,
  duration_sec   numeric,
  tags           text[] not null default '{}',
  rights_note    text,                              -- bản quyền / giấy phép sử dụng
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index assets_workspace_idx on public.assets (workspace_id);
create index assets_type_idx on public.assets (workspace_id, asset_type);

create table public.asset_versions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  asset_id       uuid not null references public.assets (id) on delete cascade,
  version_no     integer not null check (version_no >= 1),
  storage_bucket text,
  storage_path   text,
  external_url   text,
  change_note    text,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (asset_id, version_no)
);

create index asset_versions_asset_idx on public.asset_versions (asset_id);

-- ----------------------------------------------------------------------------
-- 5. PLANS / CAMPAIGNS (IMC) / PHASES / ACTIVITIES
-- ----------------------------------------------------------------------------

create table public.plans (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  period_type  text not null default 'quarter' check (period_type in ('month', 'quarter', 'year', 'custom')),
  start_date   date,
  end_date     date,
  objectives   text,
  status       text not null default 'draft' check (status in ('draft', 'active', 'paused', 'done', 'archived')),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index plans_workspace_idx on public.plans (workspace_id);

create table public.campaigns (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  plan_id         uuid references public.plans (id) on delete set null,
  product_id      uuid references public.bu_products (id) on delete set null,
  name            text not null,
  -- Khung IMC:
  objectives      text,                                -- mục tiêu truyền thông/kinh doanh
  audiences       jsonb not null default '[]'::jsonb,  -- [{segment, description, channels[]}]
  insights        text,                                -- insight khách hàng/người chơi
  big_idea        text,
  key_message     text,
  cta             text,                                -- lời kêu gọi hành động chính
  offer           text,                                -- ưu đãi/cơ chế (nếu có)
  kv_direction    text,                                -- định hướng key visual
  custom_fields   jsonb not null default '{}'::jsonb,
  -- Baseline: số liệu gốc để so sánh hiệu quả + mốc thời gian của baseline.
  baseline           jsonb not null default '{}'::jsonb,  -- {metric_code: value, ...}
  baseline_timeline  jsonb not null default '[]'::jsonb,  -- [{at, note, metrics{}}]
  status          text not null default 'draft'
                    check (status in ('draft', 'planning', 'active', 'paused', 'done', 'cancelled', 'archived')),
  risk_note       text,                                -- rủi ro / điều cần lưu ý
  owner_id        uuid references public.users (id) on delete set null,
  start_date      date,
  end_date        date,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index campaigns_workspace_idx on public.campaigns (workspace_id);
create index campaigns_plan_idx on public.campaigns (plan_id);
create index campaigns_status_idx on public.campaigns (workspace_id, status);

create table public.phases (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plan_id      uuid references public.plans (id) on delete cascade,
  campaign_id  uuid references public.campaigns (id) on delete cascade,
  name         text not null,
  sort_order   integer not null default 0,
  start_date   date,
  end_date     date,
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (plan_id is not null or campaign_id is not null),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index phases_campaign_idx on public.phases (campaign_id);
create index phases_plan_idx on public.phases (plan_id);

create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plan_id      uuid references public.plans (id) on delete cascade,
  campaign_id  uuid references public.campaigns (id) on delete cascade,
  phase_id     uuid references public.phases (id) on delete set null,
  name         text not null,
  description  text,
  sort_order   integer not null default 0,
  start_date   date,
  end_date     date,
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (plan_id is not null or campaign_id is not null),
  check (end_date is null or start_date is null or end_date >= start_date)
);

comment on table public.activities is 'Hạng mục hoạt động trong plan/campaign (cấp cha của tasks qua tasks.activity_id). Khác audit/hoạt động hệ thống.';

create index activities_campaign_idx on public.activities (campaign_id);
create index activities_plan_idx on public.activities (plan_id);

-- ----------------------------------------------------------------------------
-- 6. TASKS / DEPENDENCIES / BLOCKERS
-- Trạng thái xong duy nhất là 'completed'. 'blocked' KHÔNG phải status của
-- task: tắc nghẽn là cờ is_blocked + bản ghi blockers riêng.
-- ----------------------------------------------------------------------------

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  campaign_id   uuid references public.campaigns (id) on delete set null,
  phase_id      uuid references public.phases (id) on delete set null,
  activity_id   uuid references public.activities (id) on delete set null,
  content_item_id uuid,  -- FK thêm ở mục 7 (sau khi content_items tồn tại) — xem alter table bên dưới
  parent_id     uuid references public.tasks (id) on delete cascade,
  title         text not null,
  description   text,
  owner_id      uuid references public.users (id) on delete set null,
  collaborators uuid[] not null default '{}',          -- user_id các cộng tác viên
  approver_id   uuid references public.users (id) on delete set null,
  start_date    date,
  due_date      date,
  completed_at  timestamptz,
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  effort_hours  numeric(10, 2),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  status        text not null default 'todo'
                  check (status in ('todo', 'in_progress', 'review', 'completed', 'cancelled')),
  is_blocked    boolean not null default false,        -- cờ tắc nghẽn RIÊNG, không thay status
  sort_order    integer not null default 0,
  custom_fields jsonb not null default '{}'::jsonb,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (parent_id is null or parent_id <> id),
  check (due_date is null or start_date is null or due_date >= start_date),
  check (status <> 'completed' or completed_at is not null)
);

comment on table public.tasks is 'completed_at chỉ có nghĩa khi status=completed; app phải set/clear cùng lúc với status. is_blocked là cờ riêng kèm blockers.';

create index tasks_workspace_idx on public.tasks (workspace_id);
create index tasks_owner_due_idx on public.tasks (owner_id, due_date);
create index tasks_workspace_due_idx on public.tasks (workspace_id, due_date);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_campaign_idx on public.tasks (campaign_id);
create index tasks_status_idx on public.tasks (workspace_id, status);

create table public.task_dependencies (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  predecessor_id uuid not null references public.tasks (id) on delete cascade,
  successor_id   uuid not null references public.tasks (id) on delete cascade,
  type           text not null default 'finish_to_start' check (type = 'finish_to_start'),
  lag_days       integer not null default 0,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint task_dependencies_no_self check (predecessor_id <> successor_id),
  unique (predecessor_id, successor_id, type)
);

comment on table public.task_dependencies is 'finish_to_start: successor chỉ sẵn sàng khi predecessor completed. Chống vòng tròn bằng trigger ở 0003 (check_dependency_cycle).';

create index task_dependencies_pred_idx on public.task_dependencies (predecessor_id);
create index task_dependencies_succ_idx on public.task_dependencies (successor_id);

create table public.blockers (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  task_id        uuid not null references public.tasks (id) on delete cascade,
  description    text not null,
  reported_by    uuid references public.users (id) on delete set null,
  reported_at    timestamptz not null default now(),
  handler_id     uuid references public.users (id) on delete set null,  -- người xử lý
  resolve_by     timestamptz,                                           -- hạn xử lý
  status         text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  external_party text,                                                  -- bên ngoài liên quan (đối tác, nền tảng…) nếu có
  resolution_note text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index blockers_task_idx on public.blockers (task_id);
create index blockers_open_idx on public.blockers (workspace_id, status, resolve_by);

-- ----------------------------------------------------------------------------
-- 7. CONTENT: ITEMS / VARIANTS / REVISIONS / TIKTOK SCRIPTS / APPROVALS
-- Ba trục trạng thái của variant tách riêng, không gộp:
--   editorial_status  — soạn thảo nội bộ
--   approval_status   — duyệt (gắn với revision cụ thể ở approval_decisions)
--   publishing_status — tình trạng đăng
-- ----------------------------------------------------------------------------

create table public.content_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  campaign_id   uuid references public.campaigns (id) on delete set null,
  task_id       uuid references public.tasks (id) on delete set null,
  title         text not null,
  content_type  text not null default 'post'
                  check (content_type in ('post', 'video', 'reel', 'short', 'story', 'article', 'live', 'ad_creative', 'other')),
  brief         text,
  owner_id      uuid references public.users (id) on delete set null,
  status        text not null default 'draft'
                  check (status in ('draft', 'in_production', 'in_review', 'approved', 'scheduled', 'published', 'archived', 'cancelled')),
  planned_at    timestamptz,                       -- mốc dự kiến trên Content Calendar
  custom_fields jsonb not null default '{}'::jsonb,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index content_items_workspace_idx on public.content_items (workspace_id);
create index content_items_campaign_idx on public.content_items (campaign_id);
create index content_items_planned_idx on public.content_items (workspace_id, planned_at);

-- Bổ sung FK tasks.content_item_id (khai báo cột ở mục 6 để giữ thứ tự tạo bảng).
alter table public.tasks
  add constraint tasks_content_item_fk
  foreign key (content_item_id) references public.content_items (id) on delete set null;

create index tasks_content_item_idx on public.tasks (content_item_id);

create table public.content_variants (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  content_item_id   uuid not null references public.content_items (id) on delete cascade,
  channel_account_id uuid references public.channel_accounts (id) on delete set null,
  platform          text check (platform in ('facebook_page', 'instagram', 'linkedin_page', 'tiktok', 'youtube')),
  format            text,                          -- post / reel / short / story / video…
  caption           text,                          -- caption RIÊNG của variant này
  media_asset_ids   uuid[] not null default '{}',  -- thứ tự phần tử = thứ tự media khi đăng
  link_url          text,
  visibility        text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  first_comment     text,
  editorial_status  text not null default 'draft'
                      check (editorial_status in ('draft', 'editing', 'ready_for_review', 'changes_requested', 'final')),
  approval_status   text not null default 'draft'
                      check (approval_status in ('draft', 'pending', 'approved', 'rejected', 'needs_review')),
  approved_revision_id uuid,  -- FK tới content_revisions, thêm sau khi bảng revisions tồn tại
  publishing_status text not null default 'not_scheduled'
                      check (publishing_status in ('not_scheduled', 'scheduled', 'publishing', 'published', 'published_external', 'failed', 'cancelled')),
  publish_mode      text not null default 'app' check (publish_mode in ('app', 'external')),
  scheduled_at      timestamptz,
  published_at      timestamptz,
  external_url      text,                          -- link bài đã đăng (bắt buộc về nghiệp vụ khi publish_mode='external')
  created_by        uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- TikTok chỉ đăng ngoài app: variant TikTok không được để publish_mode='app'.
  constraint content_variants_tiktok_external_only
    check (platform is distinct from 'tiktok' or publish_mode = 'external')
);

comment on table public.content_variants is 'Variant = bản nội dung cho 1 kênh/format cụ thể. Sửa caption/media/account/visibility sau khi approved sẽ bị trigger ở 0003 hạ approval_status về needs_review và hủy publish_jobs queued.';

create index content_variants_item_idx on public.content_variants (content_item_id);
create index content_variants_account_idx on public.content_variants (channel_account_id);
create index content_variants_schedule_idx on public.content_variants (workspace_id, scheduled_at);
create index content_variants_approval_idx on public.content_variants (workspace_id, approval_status);

create table public.content_revisions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  variant_id      uuid not null references public.content_variants (id) on delete cascade,
  revision_no     integer not null check (revision_no >= 1),
  caption         text,
  media_asset_ids uuid[] not null default '{}',
  link_url        text,
  visibility      text,
  snapshot        jsonb not null default '{}'::jsonb,  -- toàn bộ nội dung tại thời điểm chốt revision
  change_note     text,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (variant_id, revision_no)
);

comment on table public.content_revisions is 'Phiên bản nội dung bất biến sau khi tạo. Quyết định duyệt (approval_decisions) LUÔN gắn vào 1 revision cụ thể, không gắn vào variant nói chung.';

create index content_revisions_variant_idx on public.content_revisions (variant_id);

alter table public.content_variants
  add constraint content_variants_approved_revision_fk
  foreign key (approved_revision_id) references public.content_revisions (id) on delete set null;

create table public.tiktok_scripts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  variant_id    uuid not null references public.content_variants (id) on delete cascade,
  hook          text,                                -- câu hook mở đầu
  scenes        jsonb not null default '[]'::jsonb,  -- [{shot, visual, dialogue, on_screen_text, duration_sec}]
  cta           text,
  caption       text,
  hashtags      text[] not null default '{}',
  external_url  text,                                -- link TikTok sau khi đăng NGOÀI app
  posted_at     timestamptz,                         -- thời điểm đăng ngoài app (ghi tay)
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (variant_id)
);

comment on table public.tiktok_scripts is 'Script TikTok: chỉ sản xuất + đăng ngoài app + lưu link. Không có publish job cho TikTok.';

create table public.approval_steps (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  content_item_id uuid references public.content_items (id) on delete cascade,
  variant_id    uuid references public.content_variants (id) on delete cascade,
  campaign_id   uuid references public.campaigns (id) on delete cascade,
  step_order    integer not null default 1,
  name          text not null,
  approver_id   uuid references public.users (id) on delete set null,
  approver_role text check (approver_role in ('owner', 'lead', 'member', 'ceo')),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'skipped', 'cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (content_item_id is not null or variant_id is not null or campaign_id is not null)
);

create index approval_steps_variant_idx on public.approval_steps (variant_id);
create index approval_steps_item_idx on public.approval_steps (content_item_id);

create table public.approval_decisions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  step_id       uuid references public.approval_steps (id) on delete set null,
  variant_id    uuid not null references public.content_variants (id) on delete cascade,
  revision_id   uuid not null references public.content_revisions (id) on delete cascade,
  decision      text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  decided_by    uuid not null references public.users (id) on delete restrict,
  comment       text,
  decided_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.approval_decisions is 'Quyết định duyệt gắn revision_id cụ thể: duyệt revision N không có nghĩa duyệt revision N+1.';

create index approval_decisions_variant_idx on public.approval_decisions (variant_id, decided_at desc);
create index approval_decisions_revision_idx on public.approval_decisions (revision_id);

-- ----------------------------------------------------------------------------
-- 8. EXTERNAL POSTS / MAPPINGS (bài đã đăng trên nền tảng, đồng bộ về)
-- ----------------------------------------------------------------------------

create table public.external_posts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts (id) on delete cascade,
  platform          text not null check (platform in ('facebook_page', 'instagram', 'linkedin_page', 'tiktok', 'youtube')),
  external_post_id  text not null,                    -- id bài trên nền tảng
  external_url      text,
  post_type         text,                             -- post / reel / video / short / story…
  caption_snapshot  text,
  media_snapshot    jsonb not null default '[]'::jsonb,
  published_at      timestamptz,                      -- thời điểm đăng TRÊN NỀN TẢNG
  author_external_id text,
  raw               jsonb not null default '{}'::jsonb,  -- payload gốc rút gọn để đối chiếu
  first_synced_at   timestamptz not null default now(),
  last_synced_at    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint external_posts_platform_account_external_unique
    unique (platform, channel_account_id, external_post_id)
);

create index external_posts_account_idx on public.external_posts (channel_account_id);
create index external_posts_published_idx on public.external_posts (workspace_id, published_at desc);

create table public.post_content_mappings (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  external_post_id uuid not null references public.external_posts (id) on delete cascade,
  variant_id       uuid references public.content_variants (id) on delete set null,
  content_item_id  uuid references public.content_items (id) on delete set null,
  campaign_id      uuid references public.campaigns (id) on delete set null,
  mapping_source   text not null default 'manual' check (mapping_source in ('publish_job', 'manual', 'auto_match')),
  confidence       numeric(5, 2),                    -- chỉ có nghĩa khi auto_match
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (variant_id is not null or content_item_id is not null or campaign_id is not null)
);

comment on table public.post_content_mappings is 'Nối bài đã đăng ngoài nền tảng với nội dung/campaign nội bộ để quy hiệu quả về đúng campaign.';

create index post_content_mappings_post_idx on public.post_content_mappings (external_post_id);
create index post_content_mappings_variant_idx on public.post_content_mappings (variant_id);

-- ----------------------------------------------------------------------------
-- 9. METRICS: DEFINITIONS / OBSERVATIONS / SYNC
-- metric_observations là "sổ quan trắc": mỗi dòng = 1 giá trị của 1 metric,
-- cho 1 đối tượng, trong 1 kỳ, theo 1 phiên bản định nghĩa. Unique key đầy đủ
-- để upsert không nhân đôi khi sync lại.
-- ----------------------------------------------------------------------------

create table public.metric_definitions (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid references public.workspaces (id) on delete cascade,  -- null = định nghĩa dùng chung
  code               text not null,                    -- impressions / reach / clicks / spend / followers…
  name_vi            text not null,
  unit               text not null default 'count' check (unit in ('count', 'currency', 'percent', 'ratio', 'seconds', 'score')),
  definition_version integer not null default 1,
  formula            text,                             -- công thức người-đọc-được, xem docs/METRICS.md
  source_platform    text,                             -- nền tảng nguồn (nếu riêng theo nền tảng)
  note               text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, code, definition_version)
);

create table public.metric_observations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  source             text not null,                    -- facebook_page / instagram / tiktok / youtube / meta_ads / manual…
  object_type        text not null check (object_type in ('external_post', 'channel_account', 'campaign', 'ad_account', 'ad_campaign', 'ad_group', 'ad')),
  object_id          text not null,                    -- id đối tượng ở nguồn (external id) hoặc uuid nội bộ dạng text — giữ text để thống nhất
  metric_code        text not null,
  value              numeric,                          -- null = nền tảng không trả giá trị (KHÁC 0)
  period_start       timestamptz not null,
  period_end         timestamptz not null,
  period_grain       text not null default 'day' check (period_grain in ('hour', 'day', 'lifetime', 'custom')),
  scope              text not null default 'organic' check (scope in ('organic', 'paid', 'total', 'account')),
  dimensions         jsonb not null default '{}'::jsonb,  -- breakdown: {age, gender, placement…}
  definition_version integer not null default 1,
  currency           text,
  observed_at        timestamptz not null default now(),  -- thời điểm sync lấy được
  sync_run_id        uuid,  -- FK thêm sau khi sync_runs tồn tại
  created_at         timestamptz not null default now(),
  constraint metric_observations_unique_key
    unique (source, object_type, object_id, metric_code, period_start, period_end, scope, dimensions, definition_version),
  check (period_end >= period_start)
);

comment on table public.metric_observations is 'value NULL nghĩa là không có dữ liệu — tầng hiển thị phải ghi "Không tính được", không được ép thành 0 (xem docs/METRICS.md). Lifetime snapshot: lấy observed_at mới nhất, không cộng dồn.';

create index metric_observations_object_idx
  on public.metric_observations (object_type, object_id, metric_code, period_start, period_end);
create index metric_observations_metric_period_idx
  on public.metric_observations (metric_code, period_start, period_end);
create index metric_observations_workspace_idx on public.metric_observations (workspace_id);

create table public.sync_jobs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  channel_account_id uuid references public.channel_accounts (id) on delete cascade,
  connection_id      uuid references public.connections (id) on delete set null,
  job_type           text not null check (job_type in ('sync_posts', 'sync_metrics', 'sync_ads', 'sync_all')),
  schedule_cron      text,                             -- lịch gợi ý cho bộ lập lịch bên ngoài (Edge Function được cron gọi)
  is_enabled         boolean not null default true,
  config             jsonb not null default '{}'::jsonb,
  created_by         uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index sync_jobs_workspace_idx on public.sync_jobs (workspace_id);

create table public.sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  sync_job_id        uuid references public.sync_jobs (id) on delete set null,
  channel_account_id uuid references public.channel_accounts (id) on delete set null,
  run_type           text not null check (run_type in ('sync_posts', 'sync_metrics', 'sync_ads', 'sync_all')),
  status             text not null default 'running'
                       check (status in ('running', 'succeeded', 'partial', 'failed', 'waiting_connection', 'not_connected')),
  requested_range    tstzrange,                        -- khoảng THỜI GIAN dữ liệu yêu cầu lấy
  fetched_range      tstzrange,                        -- khoảng thực tế lấy được
  missing_ranges     jsonb not null default '[]'::jsonb,  -- [{start, end, reason}] khoảng còn thiếu
  metrics_succeeded  text[] not null default '{}',
  metrics_failed     jsonb not null default '[]'::jsonb,  -- [{metric_code, error_code, message}] — lỗi 1 metric không chặn metric khác
  posts_upserted     integer not null default 0,
  observations_upserted integer not null default 0,
  error_code         text,
  error_message      text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index sync_runs_job_idx on public.sync_runs (sync_job_id, started_at desc);
create index sync_runs_account_idx on public.sync_runs (channel_account_id, started_at desc);

alter table public.metric_observations
  add constraint metric_observations_sync_run_fk
  foreign key (sync_run_id) references public.sync_runs (id) on delete set null;

create table public.sync_cursors (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts (id) on delete cascade,
  cursor_key         text not null,                    -- ví dụ 'posts' / 'metrics:impressions'
  cursor_token       text,                             -- token phân trang của nền tảng (opaque)
  last_synced_at     timestamptz,
  last_period_end    timestamptz,                      -- đã lấy dữ liệu tới mốc này
  state              jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (channel_account_id, cursor_key)
);

create index sync_cursors_account_idx on public.sync_cursors (channel_account_id);

-- ----------------------------------------------------------------------------
-- 10. ADS: ACCOUNTS / CAMPAIGNS / GROUPS (AD SETS) / ADS / INSIGHTS / CHANGES
-- Cây quảng cáo 4 cấp — khi tổng hợp TUYỆT ĐỐI không cộng chồng các cấp
-- (xem docs/METRICS.md). ads_change_requests là đường ghi duy nhất có kiểm
-- soát: nháp → chờ duyệt → đã duyệt → đã submit → xác nhận/lỗi.
-- ----------------------------------------------------------------------------

create table public.ad_accounts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  platform       text not null check (platform in ('meta_ads', 'google_ads', 'tiktok_ads', 'linkedin_ads')),
  external_id    text not null,
  name           text not null,
  currency       text not null default 'VND',
  timezone       text not null default 'Asia/Ho_Chi_Minh',
  status         text not null default 'not_connected'
                   check (status in ('not_connected', 'active', 'needs_reauth', 'disabled', 'error')),
  connection_id  uuid references public.connections (id) on delete set null,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);

create index ad_accounts_workspace_idx on public.ad_accounts (workspace_id);

create table public.ad_campaigns (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  campaign_id    uuid references public.campaigns (id) on delete set null,  -- campaign IMC nội bộ (nếu gắn)
  external_id    text not null,
  name           text not null,
  objective      text,
  status         text,                                  -- trạng thái ở nền tảng ads (ACTIVE/PAUSED…)
  external_created_at timestamptz,
  last_synced_at timestamptz,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ad_account_id, external_id)
);

create index ad_campaigns_account_idx on public.ad_campaigns (ad_account_id);
create index ad_campaigns_internal_idx on public.ad_campaigns (campaign_id);

create table public.ad_groups (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  ad_campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  external_id    text not null,
  name           text not null,
  status         text,
  targeting      jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ad_campaign_id, external_id)
);

comment on table public.ad_groups is 'Nhóm quảng cáo (ad set trong Meta Ads).';

create index ad_groups_campaign_idx on public.ad_groups (ad_campaign_id);

create table public.ads (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  ad_group_id    uuid not null references public.ad_groups (id) on delete cascade,
  external_id    text not null,
  name           text not null,
  status         text,
  creative       jsonb not null default '{}'::jsonb,   -- {asset_id, headline, body, cta, link_url…}
  external_post_id uuid references public.external_posts (id) on delete set null,
  last_synced_at timestamptz,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ad_group_id, external_id)
);

create index ads_group_idx on public.ads (ad_group_id);

create table public.ads_insights (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  object_type    text not null check (object_type in ('ad_account', 'ad_campaign', 'ad_group', 'ad')),
  object_id      text not null,                        -- external id của cấp tương ứng
  period_start   date not null,
  period_end     date not null,
  impressions    bigint,
  clicks         bigint,
  spend          numeric(18, 2),
  currency       text,
  reach          bigint,
  results        numeric(18, 2),
  result_type    text,
  conversion_value numeric(18, 2),
  dimensions     jsonb not null default '{}'::jsonb,
  sync_run_id    uuid references public.sync_runs (id) on delete set null,
  observed_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (object_type, object_id, period_start, period_end, dimensions),
  check (period_end >= period_start)
);

comment on table public.ads_insights is 'Số liệu ads theo TỪNG cấp riêng. Tổng hợp phải chọn đúng 1 cấp, không cộng account+campaign+adset+ad (docs/METRICS.md). Chỉ số dẫn xuất (CTR/CPC/CPM/ROAS) tính khi hiển thị, không lưu.';

create index ads_insights_object_idx on public.ads_insights (object_type, object_id, period_start, period_end);

create table public.ads_change_requests (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  ad_account_id  uuid references public.ad_accounts (id) on delete set null,
  target_type    text not null check (target_type in ('ad_account', 'ad_campaign', 'ad_group', 'ad', 'budget')),
  target_external_id text not null,
  change_type    text not null check (change_type in ('budget', 'status', 'schedule', 'targeting', 'bid', 'creative', 'other')),
  before_state   jsonb,                                  -- trạng thái TRƯỚC (đọc từ nền tảng/bản sync gần nhất)
  after_state    jsonb not null,                         -- trạng thái SAU đề xuất
  amount         numeric(18, 2),                         -- số tiền liên quan (ngân sách mới/mức thay đổi) nếu có
  currency       text,
  reason         text,
  status         text not null default 'draft'
                   check (status in ('draft', 'pending_approval', 'approved', 'submitted', 'confirmed', 'failed', 'rejected', 'cancelled')),
  -- Mặc định an toàn: mọi thay đổi được submit ở trạng thái PAUSED, chỉ bật
  -- chạy khi có quyết định riêng ghi rõ.
  submit_as_paused boolean not null default true,
  requested_by   uuid references public.users (id) on delete set null,
  approved_by    uuid references public.users (id) on delete set null,
  approved_at    timestamptz,
  submitted_at   timestamptz,
  confirmed_at   timestamptz,
  external_reference text,                               -- id tham chiếu phía nền tảng sau khi submit
  error_code     text,
  error_message  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.ads_change_requests is 'Luồng: draft → pending_approval → approved → submitted → confirmed/failed. Submit chỉ khi người submit có quyền ads_approve (RLS 0002). Mặc định submit_as_paused=true.';

create index ads_change_requests_workspace_idx on public.ads_change_requests (workspace_id, status);
create index ads_change_requests_account_idx on public.ads_change_requests (ad_account_id);

-- ----------------------------------------------------------------------------
-- 11. PUBLISH JOBS / ATTEMPTS / RESULTS
-- publish_jobs chỉ dành cho kênh đăng qua app (publish_mode='app'). TikTok
-- bị chặn ở 2 lớp: content_variants_tiktok_external_only + CHECK dưới đây.
-- snapshot là bản nội dung ĐÃ DUYỆT bị đóng băng tại lúc tạo job: worker chỉ
-- được đăng đúng snapshot này (caption/asset/account/approval ref).
-- ----------------------------------------------------------------------------

create table public.publish_jobs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  variant_id        uuid not null references public.content_variants (id) on delete cascade,
  revision_id       uuid not null references public.content_revisions (id) on delete restrict,
  channel_account_id uuid not null references public.channel_accounts (id) on delete restrict,
  platform          text not null check (platform in ('facebook_page', 'instagram', 'linkedin_page', 'youtube')),
  idempotency_key   text not null,
  snapshot          jsonb not null,
  -- snapshot bắt buộc có đủ các khóa tối thiểu (kiểm tra sâu ở publish-worker):
  -- {caption, media_asset_ids, storage refs, channel_account_id, platform,
  --  approval: {decision_id, revision_id}, destinations: [...]}
  status            text not null default 'unscheduled'
                      check (status in ('unscheduled', 'queued', 'processing', 'submitted', 'published',
                                        'failed', 'needs_reauth', 'cancelled', 'needs_check', 'late_pending_decision')),
  scheduled_at      timestamptz,                       -- UTC; hiển thị Asia/Ho_Chi_Minh ở app
  is_late           boolean not null default false,    -- quá cửa sổ cho phép (grace) khi worker nhặt job
  cancel_reason     text,
  authorized_by     uuid references public.users (id) on delete set null,  -- người ủy quyền đăng (revalidate lúc chạy)
  last_error_code   text,
  last_error_message text,
  created_by        uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint publish_jobs_idempotency_key_unique unique (idempotency_key),
  constraint publish_jobs_no_tiktok check (platform <> 'tiktok')
);

comment on table public.publish_jobs is 'Trạng thái theo §10.3 + late_pending_decision (quá grace, chờ người quyết định — worker KHÔNG tự đăng). needs_check = đã gửi nhưng không chắc kết quả (timeout sau khi gửi): cấm retry mù.';

create index publish_jobs_due_idx on public.publish_jobs (status, scheduled_at);
create index publish_jobs_variant_idx on public.publish_jobs (variant_id);
create index publish_jobs_workspace_idx on public.publish_jobs (workspace_id);

create table public.publish_attempts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  publish_job_id uuid not null references public.publish_jobs (id) on delete cascade,
  attempt_no    integer not null check (attempt_no >= 1),
  destination_key text,                                -- đích cụ thể trong snapshot.destinations (null = toàn job)
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  outcome       text check (outcome in ('succeeded', 'failed', 'timeout_after_send', 'skipped')),
  request_ref   text,
  error_code    text,
  error_message text,
  created_at    timestamptz not null default now()
);

create index publish_attempts_job_idx on public.publish_attempts (publish_job_id, attempt_no);

create table public.publish_results (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  publish_job_id   uuid not null references public.publish_jobs (id) on delete cascade,
  destination_key  text not null,                      -- 1 dòng / 1 đích: partial success giữ kết quả từng đích
  channel_account_id uuid references public.channel_accounts (id) on delete set null,
  status           text not null check (status in ('succeeded', 'failed', 'needs_check')),
  external_post_id text,                               -- id bài trên nền tảng (external id dạng text)
  external_url     text,
  error_code       text,
  error_message    text,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (publish_job_id, destination_key)
);

comment on table public.publish_results is 'Kết quả THEO TỪNG ĐÍCH: đích thành công giữ nguyên khi retry, retry chỉ chạy đích failed/needs_check đã được kiểm tra.';

create index publish_results_job_idx on public.publish_results (publish_job_id);

-- ----------------------------------------------------------------------------
-- 12. KPI / MEASUREMENTS / NGÂN SÁCH
-- budget_actuals.commitment_id: chi thực tế phát sinh từ 1 cam kết thì gắn
-- vào cam kết đó — hàm budget_remaining (0003) dùng liên kết này để không
-- trừ trùng cam kết + thực tế.
-- ----------------------------------------------------------------------------

create table public.kpis (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  campaign_id   uuid references public.campaigns (id) on delete cascade,
  plan_id       uuid references public.plans (id) on delete set null,
  product_id    uuid references public.bu_products (id) on delete set null,
  metric_code   text not null,
  name          text not null,
  target_value  numeric,
  unit          text,
  period_start  date,
  period_end    date,
  owner_id      uuid references public.users (id) on delete set null,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create index kpis_workspace_idx on public.kpis (workspace_id);
create index kpis_campaign_idx on public.kpis (campaign_id);

create table public.measurements (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  kpi_id        uuid not null references public.kpis (id) on delete cascade,
  measured_at   timestamptz not null default now(),
  period_start  date,
  period_end    date,
  value         numeric,                               -- null = không đo được trong kỳ (không phải 0)
  source        text not null default 'manual' check (source in ('manual', 'sync', 'ads_sync', 'import')),
  note          text,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index measurements_kpi_idx on public.measurements (kpi_id, measured_at desc);

create table public.budget_lines (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  plan_id         uuid references public.plans (id) on delete set null,
  campaign_id     uuid references public.campaigns (id) on delete set null,
  name            text not null,
  category        text,                                -- media / production / KOL / tools…
  approved_amount numeric(18, 2) not null default 0 check (approved_amount >= 0),
  currency        text not null default 'VND',
  period_start    date,
  period_end      date,
  owner_id        uuid references public.users (id) on delete set null,
  note            text,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index budget_lines_workspace_idx on public.budget_lines (workspace_id);
create index budget_lines_campaign_idx on public.budget_lines (campaign_id);

create table public.budget_commitments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  budget_line_id uuid not null references public.budget_lines (id) on delete cascade,
  description   text not null,
  amount        numeric(18, 2) not null check (amount >= 0),
  currency      text not null default 'VND',
  vendor        text,
  status        text not null default 'committed'
                  check (status in ('planned', 'committed', 'partially_actualised', 'settled', 'released', 'cancelled')),
  committed_at  timestamptz not null default now(),
  expected_at   date,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.budget_commitments is 'Cam kết chi còn MỞ = status planned/committed/partially_actualised. Phần đã thành actual được xác định qua budget_actuals.commitment_id.';

create index budget_commitments_line_idx on public.budget_commitments (budget_line_id, status);

create table public.budget_actuals (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  budget_line_id   uuid not null references public.budget_lines (id) on delete cascade,
  commitment_id    uuid references public.budget_commitments (id) on delete set null,
  ad_spend_source_id text,                             -- mapping tới nguồn chi ads (ads_insights/sync id) khi actual này là chi quảng cáo đồng bộ về
  description      text,
  amount           numeric(18, 2) not null check (amount >= 0),
  currency         text not null default 'VND',
  spent_at         date not null default current_date,
  source           text not null default 'manual' check (source in ('manual', 'ads_sync', 'import', 'invoice')),
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.budget_actuals is 'Chi thực tế. Nếu phát sinh từ cam kết thì PHẢI gắn commitment_id; ad_spend_source_id dùng để đối chiếu chi ads, tránh cộng trùng với ads_insights.';

create index budget_actuals_line_idx on public.budget_actuals (budget_line_id, spent_at);
create index budget_actuals_commitment_idx on public.budget_actuals (commitment_id);

-- ----------------------------------------------------------------------------
-- 13. COMMENTS / NOTIFICATIONS / MARKETING REQUESTS / REPORT SNAPSHOTS / AUDIT
-- ----------------------------------------------------------------------------

create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type  text not null check (entity_type in ('task', 'content_item', 'content_variant', 'campaign', 'plan', 'marketing_request', 'ads_change_request', 'budget_line', 'kpi')),
  entity_id    uuid not null,
  parent_id    uuid references public.comments (id) on delete cascade,
  body         text not null,
  mentions     uuid[] not null default '{}',
  author_id    uuid not null references public.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index comments_entity_idx on public.comments (entity_type, entity_id, created_at);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,  -- người nhận
  type         text not null,                          -- task_assigned / approval_requested / publish_failed / blocker_opened…
  title        text not null,
  body         text,
  entity_type  text,
  entity_id    uuid,
  is_read      boolean not null default false,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, is_read, created_at desc);

create table public.marketing_requests (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  requester_id    uuid references public.users (id) on delete set null,   -- người/đơn vị yêu cầu (nội bộ)
  requester_unit  text,                                                  -- phòng ban/BU yêu cầu dạng text nếu không có tài khoản
  title           text not null,
  description     text,
  request_type    text not null default 'other'
                    check (request_type in ('campaign', 'content', 'design', 'video', 'ads', 'event_support', 'other')),
  product_id      uuid references public.bu_products (id) on delete set null,
  campaign_id     uuid references public.campaigns (id) on delete set null,  -- campaign sinh ra từ request (nếu được chấp nhận)
  priority        text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  desired_due_date date,
  status          text not null default 'new'
                    check (status in ('new', 'triaging', 'accepted', 'in_progress', 'done', 'rejected', 'cancelled')),
  assignee_id     uuid references public.users (id) on delete set null,
  rejection_reason text,
  custom_fields   jsonb not null default '{}'::jsonb,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.marketing_requests is 'Yêu cầu marketing từ các đơn vị khác (§13): tiếp nhận → phân loại → chấp nhận (có thể sinh campaign/task) hoặc từ chối có lý do.';

create index marketing_requests_workspace_idx on public.marketing_requests (workspace_id, status);

create table public.report_snapshots (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  report_type   text not null check (report_type in ('campaign', 'channel', 'ads', 'kpi_budget', 'executive', 'custom')),
  scope         jsonb not null default '{}'::jsonb,     -- {campaign_id, channel_account_ids[], period…}
  period_start  date,
  period_end    date,
  data          jsonb not null,                          -- DỮ LIỆU ĐÃ ĐÓNG BĂNG tại thời điểm tạo báo cáo
  definition_versions jsonb not null default '{}'::jsonb,  -- {metric_code: version} đã dùng
  generated_by  uuid references public.users (id) on delete set null,
  generated_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
  -- KHÔNG có updated_at: snapshot không sửa hồi tố (RLS 0002 cũng không cấp UPDATE).
);

comment on table public.report_snapshots is 'Báo cáo đóng băng: số liệu trong data không thay đổi theo dữ liệu nguồn về sau. Muốn số mới thì tạo snapshot mới.';

create index report_snapshots_workspace_idx on public.report_snapshots (workspace_id, generated_at desc);

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  actor_id     uuid references public.users (id) on delete set null,
  actor_role   text,
  entity_type  text not null,
  entity_id    uuid,
  action       text not null check (action in ('create', 'update', 'delete', 'approve', 'reject', 'publish', 'submit_ads_change', 'connect', 'disconnect', 'status_change', 'other')),
  before_state jsonb,
  after_state  jsonb,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.audit_log is 'Nhật ký kiểm toán append-only: RLS không cấp UPDATE/DELETE cho bất kỳ vai trò nào.';

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_workspace_idx on public.audit_log (workspace_id, created_at desc);
