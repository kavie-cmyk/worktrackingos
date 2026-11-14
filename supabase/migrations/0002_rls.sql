-- ============================================================================
-- SAVA Marketing Workspace — 0002_rls.sql
-- Bật Row Level Security cho MỌI bảng + helper functions + policies.
-- Nguyên tắc:
--   * Quyền tách nhỏ: read, edit, approve, budget_view, budget_edit, connect,
--     analytics_read, ads_read, ads_draft, ads_approve, budget_change, publish.
--   * CEO chỉ SELECT: báo cáo (report_snapshots), KPI/measurements, ngân sách
--     TỔNG HỢP (budget_lines), external_posts và insights (metric_observations,
--     ads_insights). CEO không có policy INSERT/UPDATE/DELETE ở bất kỳ bảng
--     nghiệp vụ nào và không có quyền publish / ads write.
--   * Member không tự cấp quyền: memberships chỉ owner sửa được.
--   * Chỉ owner quản memberships và connections (ghi).
--   * publish_jobs INSERT chỉ khi has_permission('publish').
--   * ads_change_requests chuyển sang 'submitted' thực chất chỉ khi có
--     ads_approve (xem policy update bên dưới).
--   * Edge Functions dùng service_role (bypass RLS) sau khi tự revalidate —
--     xem supabase/functions/publish-worker và sync-worker.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers (security definer để tránh đệ quy RLS khi đọc memberships/users)
-- ----------------------------------------------------------------------------

create or replace function public.current_app_user_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select auth.uid() $$;

comment on function public.current_app_user_id() is 'auth.uid() của phiên hiện tại.';

-- Membership (bản ghi memberships) của người dùng hiện tại.
-- Nếu user thuộc nhiều workspace, hàm không tham số trả membership sớm nhất;
-- nghiệp vụ nên dùng bản có tham số workspace khi có thể.
create or replace function public.current_member_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select m.id from public.memberships m
  where m.user_id = auth.uid() and m.is_active
  order by m.created_at asc
  limit 1
$$;

create or replace function public.current_member_id(p_workspace_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select m.id from public.memberships m
  where m.user_id = auth.uid() and m.is_active and m.workspace_id = p_workspace_id
  limit 1
$$;

-- Vai trò trong 1 workspace cụ thể; null nếu không phải thành viên active.
create or replace function public.current_role(p_workspace_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select m.role from public.memberships m
  where m.user_id = auth.uid() and m.is_active and m.workspace_id = p_workspace_id
  limit 1
$$;

-- Vai trò "cao nhất" của user trên mọi workspace (owner > lead > member > ceo
-- theo thứ tự ưu tiên liệt kê). Chỉ dùng cho hiển thị/điều hướng; phân quyền
-- nghiệp vụ dùng current_role(workspace_id) / has_permission(perm, workspace).
create or replace function public.current_role()
returns text
language sql stable security definer set search_path = public
as $$
  select m.role from public.memberships m
  where m.user_id = auth.uid() and m.is_active
  order by case m.role when 'owner' then 1 when 'lead' then 2 when 'member' then 3 when 'ceo' then 4 else 5 end
  limit 1
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.is_active and m.workspace_id = p_workspace_id
  )
$$;

create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.is_active and m.workspace_id = p_workspace_id and m.role = 'owner'
  )
$$;

-- Ma trận quyền theo vai trò (nguồn sự thật duy nhất cho has_permission).
--   owner : mọi quyền.
--   lead  : mọi quyền trừ 'connect' (kết nối kênh chỉ owner).
--   member: read, edit, analytics_read, ads_read, ads_draft.
--           KHÔNG approve / publish / budget_* / ads_approve / connect.
--   ceo   : read, budget_view, analytics_read, ads_read (chỉ-đọc, và RLS từng
--           bảng còn giới hạn thêm CEO chỉ thấy đúng các bảng được phép).
create or replace function public.role_has_permission(p_role text, p_perm text)
returns boolean
language sql immutable
as $$
  select case p_role
    when 'owner' then p_perm in ('read','edit','approve','budget_view','budget_edit','connect',
                                 'analytics_read','ads_read','ads_draft','ads_approve','budget_change','publish')
    when 'lead'  then p_perm in ('read','edit','approve','budget_view','budget_edit',
                                 'analytics_read','ads_read','ads_draft','ads_approve','budget_change','publish')
    when 'member' then p_perm in ('read','edit','analytics_read','ads_read','ads_draft')
    when 'ceo'    then p_perm in ('read','budget_view','analytics_read','ads_read')
    else false
  end
$$;

-- has_permission(perm): đúng nếu BẤT KỲ membership active nào của user có quyền.
create or replace function public.has_permission(p_perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.is_active
      and public.role_has_permission(m.role, p_perm)
  )
$$;

-- has_permission(perm, workspace_id): bản theo workspace — dùng trong policies.
create or replace function public.has_permission(p_perm text, p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.is_active and m.workspace_id = p_workspace_id
      and public.role_has_permission(m.role, p_perm)
  )
$$;

-- Thành viên active và KHÔNG phải CEO (dùng cho các bảng nghiệp vụ vận hành).
create or replace function public.is_operational_member(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_workspace_member(p_workspace_id)
     and coalesce(public.current_role(p_workspace_id), '') <> 'ceo'
$$;

-- ----------------------------------------------------------------------------
-- Bật RLS cho toàn bộ bảng
-- ----------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.bu_products enable row level security;
alter table public.brand_pages enable row level security;
alter table public.channel_accounts enable row level security;
alter table public.connections enable row level security;
alter table public.connection_capabilities enable row level security;
alter table public.assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.plans enable row level security;
alter table public.campaigns enable row level security;
alter table public.phases enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.blockers enable row level security;
alter table public.content_items enable row level security;
alter table public.content_variants enable row level security;
alter table public.content_revisions enable row level security;
alter table public.tiktok_scripts enable row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.external_posts enable row level security;
alter table public.post_content_mappings enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.metric_observations enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.ad_accounts enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_groups enable row level security;
alter table public.ads enable row level security;
alter table public.ads_insights enable row level security;
alter table public.ads_change_requests enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.publish_attempts enable row level security;
alter table public.publish_results enable row level security;
alter table public.kpis enable row level security;
alter table public.measurements enable row level security;
alter table public.budget_lines enable row level security;
alter table public.budget_commitments enable row level security;
alter table public.budget_actuals enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.marketing_requests enable row level security;
alter table public.report_snapshots enable row level security;
alter table public.audit_log enable row level security;

-- ----------------------------------------------------------------------------
-- workspaces / users / memberships
-- ----------------------------------------------------------------------------

create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_insert_authenticated on public.workspaces
  for insert to authenticated
  with check (auth.uid() is not null);

create policy workspaces_update_owner on public.workspaces
  for update to authenticated
  using (public.is_workspace_owner(id))
  with check (public.is_workspace_owner(id));

create policy workspaces_delete_owner on public.workspaces
  for delete to authenticated
  using (public.is_workspace_owner(id));

-- users: thấy mình + người cùng workspace; chỉ sửa hồ sơ của chính mình.
create policy users_select_self_or_workspace on public.users
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships me
      join public.memberships other on other.workspace_id = me.workspace_id
      where me.user_id = auth.uid() and me.is_active and other.user_id = users.id and other.is_active
    )
  );

create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = auth.uid());

create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- Không có policy DELETE cho users: vô hiệu hoá bằng is_active thay vì xoá.

-- memberships: CHỈ owner quản lý. Member không tự cấp quyền / không sửa của ai.
create policy memberships_select_workspace_member on public.memberships
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy memberships_insert_owner on public.memberships
  for insert to authenticated
  with check (public.is_workspace_owner(workspace_id));

create policy memberships_update_owner on public.memberships
  for update to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create policy memberships_delete_owner on public.memberships
  for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

-- ----------------------------------------------------------------------------
-- Nhóm nghiệp vụ vận hành (CEO không đọc/ghi): bu_products, brand_pages,
-- assets, asset_versions, plans, campaigns, phases, activities, tasks,
-- task_dependencies, blockers, content_items, tiktok_scripts,
-- post_content_mappings, marketing_requests
-- Mẫu: SELECT = operational member; ghi = has_permission('edit').
-- ----------------------------------------------------------------------------

create policy bu_products_select on public.bu_products for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy bu_products_insert on public.bu_products for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy bu_products_update on public.bu_products for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy bu_products_delete on public.bu_products for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy brand_pages_select on public.brand_pages for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy brand_pages_insert on public.brand_pages for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy brand_pages_update on public.brand_pages for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy brand_pages_delete on public.brand_pages for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy assets_select on public.assets for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy assets_insert on public.assets for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy assets_update on public.assets for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy assets_delete on public.assets for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy asset_versions_select on public.asset_versions for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy asset_versions_insert on public.asset_versions for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
-- asset_versions không UPDATE/DELETE qua app: version là bất biến, sai thì tạo version mới.

create policy plans_select on public.plans for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy plans_insert on public.plans for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy plans_update on public.plans for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy plans_delete on public.plans for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy campaigns_select on public.campaigns for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy campaigns_update on public.campaigns for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy phases_select on public.phases for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy phases_insert on public.phases for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy phases_update on public.phases for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy phases_delete on public.phases for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy activities_select on public.activities for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy activities_insert on public.activities for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy activities_update on public.activities for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy activities_delete on public.activities for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy tasks_select on public.tasks for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy tasks_update on public.tasks for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy task_dependencies_insert on public.task_dependencies for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy task_dependencies_update on public.task_dependencies for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy task_dependencies_delete on public.task_dependencies for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy blockers_select on public.blockers for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy blockers_insert on public.blockers for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy blockers_update on public.blockers for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy blockers_delete on public.blockers for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy content_items_select on public.content_items for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy content_items_insert on public.content_items for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy content_items_update on public.content_items for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy content_items_delete on public.content_items for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy tiktok_scripts_select on public.tiktok_scripts for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy tiktok_scripts_insert on public.tiktok_scripts for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy tiktok_scripts_update on public.tiktok_scripts for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy tiktok_scripts_delete on public.tiktok_scripts for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy post_content_mappings_select on public.post_content_mappings for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy post_content_mappings_insert on public.post_content_mappings for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy post_content_mappings_update on public.post_content_mappings for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy post_content_mappings_delete on public.post_content_mappings for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy marketing_requests_select on public.marketing_requests for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy marketing_requests_insert on public.marketing_requests for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy marketing_requests_update on public.marketing_requests for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy marketing_requests_delete on public.marketing_requests for delete to authenticated
  using (public.has_permission('approve', workspace_id));

-- ----------------------------------------------------------------------------
-- Kênh / kết nối: đọc cho thành viên vận hành; GHI connections chỉ owner
-- (quyền 'connect' — trong ma trận chỉ owner mới có).
-- ----------------------------------------------------------------------------

create policy channel_accounts_select on public.channel_accounts for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy channel_accounts_insert on public.channel_accounts for insert to authenticated
  with check (public.has_permission('connect', workspace_id));
create policy channel_accounts_update on public.channel_accounts for update to authenticated
  using (public.has_permission('connect', workspace_id)) with check (public.has_permission('connect', workspace_id));
create policy channel_accounts_delete on public.channel_accounts for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

-- connections: SELECT cho owner/lead (lead cần biết trạng thái để vận hành);
-- token không lưu ở bảng này nên SELECT không lộ bí mật. Ghi: chỉ owner.
create policy connections_select on public.connections for select to authenticated
  using (public.current_role(workspace_id) in ('owner', 'lead'));
create policy connections_insert on public.connections for insert to authenticated
  with check (public.has_permission('connect', workspace_id));
create policy connections_update on public.connections for update to authenticated
  using (public.has_permission('connect', workspace_id)) with check (public.has_permission('connect', workspace_id));
create policy connections_delete on public.connections for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

create policy connection_capabilities_select on public.connection_capabilities for select to authenticated
  using (public.current_role(workspace_id) in ('owner', 'lead'));
create policy connection_capabilities_insert on public.connection_capabilities for insert to authenticated
  with check (public.has_permission('connect', workspace_id));
create policy connection_capabilities_update on public.connection_capabilities for update to authenticated
  using (public.has_permission('connect', workspace_id)) with check (public.has_permission('connect', workspace_id));
create policy connection_capabilities_delete on public.connection_capabilities for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

-- ----------------------------------------------------------------------------
-- Nội dung & duyệt: variants sửa bằng 'edit' (trigger 0003 tự hạ trạng thái
-- duyệt nếu sửa sau khi approved); revisions BẤT BIẾN (chỉ insert);
-- decisions chỉ người có 'approve' mới tạo, và quyết định là bất biến.
-- ----------------------------------------------------------------------------

create policy content_variants_select on public.content_variants for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy content_variants_insert on public.content_variants for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy content_variants_update on public.content_variants for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy content_variants_delete on public.content_variants for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy content_revisions_select on public.content_revisions for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy content_revisions_insert on public.content_revisions for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
-- Không UPDATE/DELETE policy cho content_revisions: revision đã chốt là bất biến.

create policy approval_steps_select on public.approval_steps for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy approval_steps_insert on public.approval_steps for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy approval_steps_update on public.approval_steps for update to authenticated
  using (public.has_permission('approve', workspace_id)) with check (public.has_permission('approve', workspace_id));
create policy approval_steps_delete on public.approval_steps for delete to authenticated
  using (public.has_permission('approve', workspace_id));

create policy approval_decisions_select on public.approval_decisions for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy approval_decisions_insert on public.approval_decisions for insert to authenticated
  with check (public.has_permission('approve', workspace_id) and decided_by = auth.uid());
-- Không UPDATE/DELETE policy cho approval_decisions: quyết định duyệt là bất biến.

-- ----------------------------------------------------------------------------
-- Dữ liệu đồng bộ từ nền tảng: external_posts / metric_observations /
-- ads_insights đọc theo quyền tương ứng (CEO được đọc — đây là lớp "insights"
-- CEO được phép xem); GHI chỉ qua service_role (sync-worker), không cấp
-- policy ghi cho authenticated.
-- ----------------------------------------------------------------------------

create policy external_posts_select on public.external_posts for select to authenticated
  using (public.has_permission('analytics_read', workspace_id));

create policy metric_definitions_select on public.metric_definitions for select to authenticated
  using (workspace_id is null or public.is_workspace_member(workspace_id));
create policy metric_definitions_insert on public.metric_definitions for insert to authenticated
  with check (workspace_id is not null and public.has_permission('edit', workspace_id));
create policy metric_definitions_update on public.metric_definitions for update to authenticated
  using (workspace_id is not null and public.has_permission('edit', workspace_id))
  with check (workspace_id is not null and public.has_permission('edit', workspace_id));

create policy metric_observations_select on public.metric_observations for select to authenticated
  using (public.has_permission('analytics_read', workspace_id));

create policy ads_insights_select on public.ads_insights for select to authenticated
  using (public.has_permission('ads_read', workspace_id));

-- sync_*: xem cho owner/lead; cấu hình job cho owner/lead có 'edit';
-- runs/cursors ghi bởi service_role (sync-worker).
create policy sync_jobs_select on public.sync_jobs for select to authenticated
  using (public.current_role(workspace_id) in ('owner', 'lead'));
create policy sync_jobs_insert on public.sync_jobs for insert to authenticated
  with check (public.has_permission('edit', workspace_id) and public.current_role(workspace_id) in ('owner', 'lead'));
create policy sync_jobs_update on public.sync_jobs for update to authenticated
  using (public.has_permission('edit', workspace_id) and public.current_role(workspace_id) in ('owner', 'lead'))
  with check (public.has_permission('edit', workspace_id) and public.current_role(workspace_id) in ('owner', 'lead'));
create policy sync_jobs_delete on public.sync_jobs for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

create policy sync_runs_select on public.sync_runs for select to authenticated
  using (public.current_role(workspace_id) in ('owner', 'lead'));

create policy sync_cursors_select on public.sync_cursors for select to authenticated
  using (public.current_role(workspace_id) in ('owner', 'lead'));
-- Không policy ghi cho sync_runs / sync_cursors / external_posts /
-- metric_observations / ads_insights đối với authenticated: sync-worker dùng
-- service_role và tự kiểm tra connection trước khi ghi.

-- ----------------------------------------------------------------------------
-- Ads: cấu trúc tài khoản đọc bằng ads_read (trừ CEO — CEO chỉ xem insights);
-- ad_accounts ghi bởi owner (connect); cây campaigns/groups/ads chủ yếu do
-- sync ghi (service_role), app chỉ đọc.
-- ads_change_requests: tạo nháp bằng ads_draft; sửa nháp của chính mình khi
-- còn 'draft' và chỉ được đẩy tới 'pending_approval'; MỌI chuyển trạng thái
-- khác (approved/submitted/confirmed…) phải qua policy ads_approve.
-- ----------------------------------------------------------------------------

create policy ad_accounts_select on public.ad_accounts for select to authenticated
  using (public.is_operational_member(workspace_id) and public.has_permission('ads_read', workspace_id));
create policy ad_accounts_insert on public.ad_accounts for insert to authenticated
  with check (public.has_permission('connect', workspace_id));
create policy ad_accounts_update on public.ad_accounts for update to authenticated
  using (public.has_permission('connect', workspace_id)) with check (public.has_permission('connect', workspace_id));
create policy ad_accounts_delete on public.ad_accounts for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

create policy ad_campaigns_select on public.ad_campaigns for select to authenticated
  using (public.is_operational_member(workspace_id) and public.has_permission('ads_read', workspace_id));

create policy ad_groups_select on public.ad_groups for select to authenticated
  using (public.is_operational_member(workspace_id) and public.has_permission('ads_read', workspace_id));

create policy ads_select on public.ads for select to authenticated
  using (public.is_operational_member(workspace_id) and public.has_permission('ads_read', workspace_id));

create policy ads_change_requests_select on public.ads_change_requests for select to authenticated
  using (public.is_operational_member(workspace_id) and public.has_permission('ads_read', workspace_id));

create policy ads_change_requests_insert on public.ads_change_requests for insert to authenticated
  with check (
    public.has_permission('ads_draft', workspace_id)
    and status = 'draft'
    and requested_by = auth.uid()
  );

-- Người tạo nháp: sửa khi còn draft, đích đến chỉ draft/pending_approval.
create policy ads_change_requests_update_drafter on public.ads_change_requests for update to authenticated
  using (
    public.has_permission('ads_draft', workspace_id)
    and requested_by = auth.uid()
    and status = 'draft'
  )
  with check (status in ('draft', 'pending_approval'));

-- Người có ads_approve: duyệt / submit / xác nhận / báo lỗi.
create policy ads_change_requests_update_approver on public.ads_change_requests for update to authenticated
  using (public.has_permission('ads_approve', workspace_id))
  with check (public.has_permission('ads_approve', workspace_id));

create policy ads_change_requests_delete on public.ads_change_requests for delete to authenticated
  using (public.is_workspace_owner(workspace_id) and status = 'draft');

-- ----------------------------------------------------------------------------
-- Publish: INSERT chỉ khi has_permission('publish'). TikTok đã bị chặn ở
-- tầng schema (publish_jobs_no_tiktok + publish_mode của variant).
-- attempts/results do publish-worker (service_role) ghi; app chỉ đọc.
-- ----------------------------------------------------------------------------

create policy publish_jobs_select on public.publish_jobs for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy publish_jobs_insert on public.publish_jobs for insert to authenticated
  with check (public.has_permission('publish', workspace_id));
create policy publish_jobs_update on public.publish_jobs for update to authenticated
  using (public.has_permission('publish', workspace_id)) with check (public.has_permission('publish', workspace_id));
create policy publish_jobs_delete on public.publish_jobs for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

create policy publish_attempts_select on public.publish_attempts for select to authenticated
  using (public.is_operational_member(workspace_id));

create policy publish_results_select on public.publish_results for select to authenticated
  using (public.is_operational_member(workspace_id));

-- ----------------------------------------------------------------------------
-- KPI / measurements: mọi thành viên (kể cả CEO) đọc; ghi bằng 'edit'.
-- Ngân sách: đọc chi tiết bằng budget_view nhưng CEO chỉ đọc budget_lines
-- (tổng hợp) + report_snapshots; commitments/actuals (chi tiết) trừ CEO.
-- Tạo/sửa dòng ngân sách (approved_amount) cần 'budget_change';
-- cam kết & chi thực tế cần 'budget_edit'.
-- ----------------------------------------------------------------------------

create policy kpis_select on public.kpis for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy kpis_insert on public.kpis for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy kpis_update on public.kpis for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy kpis_delete on public.kpis for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy measurements_select on public.measurements for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy measurements_insert on public.measurements for insert to authenticated
  with check (public.has_permission('edit', workspace_id));
create policy measurements_update on public.measurements for update to authenticated
  using (public.has_permission('edit', workspace_id)) with check (public.has_permission('edit', workspace_id));
create policy measurements_delete on public.measurements for delete to authenticated
  using (public.has_permission('edit', workspace_id));

create policy budget_lines_select on public.budget_lines for select to authenticated
  using (public.has_permission('budget_view', workspace_id));
create policy budget_lines_insert on public.budget_lines for insert to authenticated
  with check (public.has_permission('budget_change', workspace_id));
create policy budget_lines_update on public.budget_lines for update to authenticated
  using (public.has_permission('budget_change', workspace_id)) with check (public.has_permission('budget_change', workspace_id));
create policy budget_lines_delete on public.budget_lines for delete to authenticated
  using (public.has_permission('budget_change', workspace_id));

create policy budget_commitments_select on public.budget_commitments for select to authenticated
  using (public.is_operational_member(workspace_id) and public.has_permission('budget_view', workspace_id));
create policy budget_commitments_insert on public.budget_commitments for insert to authenticated
  with check (public.has_permission('budget_edit', workspace_id));
create policy budget_commitments_update on public.budget_commitments for update to authenticated
  using (public.has_permission('budget_edit', workspace_id)) with check (public.has_permission('budget_edit', workspace_id));
create policy budget_commitments_delete on public.budget_commitments for delete to authenticated
  using (public.has_permission('budget_edit', workspace_id));

create policy budget_actuals_select on public.budget_actuals for select to authenticated
  using (public.is_operational_member(workspace_id) and public.has_permission('budget_view', workspace_id));
create policy budget_actuals_insert on public.budget_actuals for insert to authenticated
  with check (public.has_permission('budget_edit', workspace_id));
create policy budget_actuals_update on public.budget_actuals for update to authenticated
  using (public.has_permission('edit', workspace_id) and public.has_permission('budget_edit', workspace_id))
  with check (public.has_permission('budget_edit', workspace_id));
create policy budget_actuals_delete on public.budget_actuals for delete to authenticated
  using (public.has_permission('budget_edit', workspace_id));

-- ----------------------------------------------------------------------------
-- Comments / notifications / report_snapshots / audit_log
-- ----------------------------------------------------------------------------

create policy comments_select on public.comments for select to authenticated
  using (public.is_operational_member(workspace_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (public.has_permission('edit', workspace_id) and author_id = auth.uid());
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.current_role(workspace_id) in ('owner', 'lead'));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.is_workspace_member(workspace_id));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- report_snapshots: mọi thành viên đọc (kể cả CEO); tạo bằng 'edit';
-- KHÔNG có policy UPDATE/DELETE — snapshot đóng băng, không sửa hồi tố.
create policy report_snapshots_select on public.report_snapshots for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy report_snapshots_insert on public.report_snapshots for insert to authenticated
  with check (public.has_permission('edit', workspace_id));

-- audit_log: chỉ owner/lead đọc; mọi thành viên ghi với actor là chính mình;
-- KHÔNG UPDATE/DELETE (append-only).
create policy audit_log_select on public.audit_log for select to authenticated
  using (workspace_id is not null and public.current_role(workspace_id) in ('owner', 'lead'));
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (actor_id = auth.uid());
