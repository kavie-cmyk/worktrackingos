-- ============================================================================
-- SAVA Marketing Workspace — 0009_schema_r31.sql (vòng R3.1)
-- Schema đi tiến, IDEMPOTENT: chạy lại không lỗi, không trùng (AC20).
-- Nguồn đặc tả: SAVA_Marketing_QA_R3_Prompt... R3-05..R3-11, C.2, C.5, C.8.
-- Đã đối chiếu schema LIVE 12/11/2026 (project nlbtjtubihxbkigdfpdg):
--   budget_lines: chưa có planned_amount/activity_id/task_id
--   budget_actuals: chưa có title/idempotency_key; ĐÃ có commitment_id
--   kpis: đã có metric_code/campaign_id/product_id; chưa có definition/
--         scope_type/activity_id/task_id/content_item_id/aggregation_mode
--   activities: chưa có owner_id/channel/deliverables
--   content_items: chưa có pillar_id/series/source_content_id
--   content_variants: chưa có owner_id/reviewer_id/production_deadline/brief
--   brand_pages: chưa có owner_id/tags
--   tasks: chưa có is_milestone
--   Chưa tồn tại: content_pillars, kpi_target_versions, kpi_contributions,
--     brand_page_versions, member_capacity, campaign_baselines,
--     campaign_assets, budget_allocations, cash_accounts/categories/transactions
-- ============================================================================

-- ----------------------------------------------------------------------------
-- f. content_pillars (tạo TRƯỚC để kpis/content_items tham chiếu được)
-- ----------------------------------------------------------------------------
create table if not exists public.content_pillars (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  bu_product_id         uuid references public.bu_products (id) on delete set null,
  name                  text not null,
  description           text,
  classification_guide  text,
  status                text not null default 'active' check (status in ('active', 'archived')),
  created_by            uuid references public.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz
);
create index if not exists content_pillars_workspace_idx on public.content_pillars (workspace_id);
create index if not exists content_pillars_product_idx on public.content_pillars (bu_product_id);
comment on table public.content_pillars is 'R3.1: trụ cột nội dung theo brand/BU/product. Không chứa lịch đăng; archive thay xóa để giữ tham chiếu cũ.';

-- ----------------------------------------------------------------------------
-- a. budget_lines: planned_amount độc lập + scope activity/task
-- ----------------------------------------------------------------------------
alter table public.budget_lines add column if not exists planned_amount numeric(18,2);
alter table public.budget_lines add column if not exists activity_id uuid;
alter table public.budget_lines add column if not exists task_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='budget_lines_planned_nonneg') then
    alter table public.budget_lines add constraint budget_lines_planned_nonneg check (planned_amount is null or planned_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='budget_lines_activity_fk') then
    alter table public.budget_lines add constraint budget_lines_activity_fk foreign key (activity_id) references public.activities (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='budget_lines_task_fk') then
    alter table public.budget_lines add constraint budget_lines_task_fk foreign key (task_id) references public.tasks (id) on delete set null;
  end if;
end $$;
create index if not exists budget_lines_activity_idx on public.budget_lines (activity_id);
create index if not exists budget_lines_task_idx on public.budget_lines (task_id);
comment on column public.budget_lines.planned_amount is 'R3-05: kế hoạch chi, ĐỘC LẬP approved_amount (hạn mức được duyệt). Không suy planned từ approved khi đọc nữa.';

-- ----------------------------------------------------------------------------
-- c. budget_actuals: title tách description + idempotency_key
-- ----------------------------------------------------------------------------
alter table public.budget_actuals add column if not exists title text;
alter table public.budget_actuals add column if not exists idempotency_key text;
comment on column public.budget_actuals.title is 'R3-07: nội dung/tên khoản chi. description giữ vai trò ghi chú/chứng từ — hai trường tách riêng, không alias đè nhau.';
comment on column public.budget_actuals.idempotency_key is 'AC09: khóa chống double-submit/retry ở backend (unique theo workspace khi not null).';
create unique index if not exists budget_actuals_idempotency_uidx
  on public.budget_actuals (workspace_id, idempotency_key) where idempotency_key is not null;

-- ----------------------------------------------------------------------------
-- d. kpis: definition / scope / aggregation / versioning / contributions
--    definition chọn JSONB: {how, source, formula?, dedup_key?, note?}
-- ----------------------------------------------------------------------------
alter table public.kpis add column if not exists definition jsonb not null default '{}'::jsonb;
alter table public.kpis add column if not exists scope_type text not null default 'campaign';
alter table public.kpis add column if not exists activity_id uuid;
alter table public.kpis add column if not exists task_id uuid;
alter table public.kpis add column if not exists content_item_id uuid;
alter table public.kpis add column if not exists bu_product_id uuid;
alter table public.kpis add column if not exists pillar_id uuid;
alter table public.kpis add column if not exists aggregation_mode text not null default 'direct';
alter table public.kpis add column if not exists target_version integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='kpis_activity_fk') then
    alter table public.kpis add constraint kpis_activity_fk foreign key (activity_id) references public.activities (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='kpis_task_fk') then
    alter table public.kpis add constraint kpis_task_fk foreign key (task_id) references public.tasks (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='kpis_content_item_fk') then
    alter table public.kpis add constraint kpis_content_item_fk foreign key (content_item_id) references public.content_items (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='kpis_bu_product_fk') then
    alter table public.kpis add constraint kpis_bu_product_fk foreign key (bu_product_id) references public.bu_products (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='kpis_pillar_fk') then
    alter table public.kpis add constraint kpis_pillar_fk foreign key (pillar_id) references public.content_pillars (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='kpis_scope_type_check') then
    alter table public.kpis add constraint kpis_scope_type_check
      check (scope_type in ('campaign','activity','task','content','bu_product','pillar','channel','workspace'));
  end if;
  if not exists (select 1 from pg_constraint where conname='kpis_aggregation_mode_check') then
    alter table public.kpis add constraint kpis_aggregation_mode_check
      check (aggregation_mode in ('direct','sum','unique','ratio','snapshot','manual'));
  end if;
  -- CHECK bộ cột theo scope_type (quan hệ chéo campaign/workspace do trigger ở 0010 kiểm tra)
  if not exists (select 1 from pg_constraint where conname='kpis_scope_columns_check') then
    alter table public.kpis add constraint kpis_scope_columns_check check (
      case scope_type
        when 'campaign'   then campaign_id is not null and activity_id is null and task_id is null and content_item_id is null
        when 'activity'   then activity_id is not null and task_id is null and content_item_id is null
        when 'task'       then task_id is not null and content_item_id is null
        when 'content'    then content_item_id is not null
        when 'bu_product' then (bu_product_id is not null or product_id is not null)
        when 'pillar'     then pillar_id is not null
        else true  -- channel / workspace: không bắt FK nghiệp vụ
      end
    );
  end if;
end $$;
create index if not exists kpis_activity_idx on public.kpis (activity_id);
create index if not exists kpis_task_idx on public.kpis (task_id);
create index if not exists kpis_content_item_idx on public.kpis (content_item_id);
create index if not exists kpis_pillar_idx on public.kpis (pillar_id);
comment on column public.kpis.definition is 'R3-08/C.4: định nghĩa cách đo dạng jsonb {how, source, formula, dedup_key, note}. Tách khỏi name/target.';
comment on column public.kpis.aggregation_mode is 'direct|sum|unique|ratio|snapshot|manual — cách tổng hợp lên scope cha (xem kpi_contributions).';

-- Target versioning: bảng lịch sử (mỗi lần đổi target/mapping ghi 1 version mới)
create table if not exists public.kpi_target_versions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  kpi_id         uuid not null references public.kpis (id) on delete cascade,
  version        integer not null check (version >= 1),
  target_value   numeric,
  unit           text,
  definition     jsonb not null default '{}'::jsonb,
  aggregation_mode text,
  note           text,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (kpi_id, version)
);
create index if not exists kpi_target_versions_kpi_idx on public.kpi_target_versions (kpi_id, version desc);

-- KPI contributions: mapping nguồn cho roll-up, tham chiếu — không copy actual
create table if not exists public.kpi_contributions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  kpi_id          uuid not null references public.kpis (id) on delete cascade,
  source_kpi_id   uuid references public.kpis (id) on delete set null,
  source_fact_type text check (source_fact_type in ('measurement','metric_observation','external_fact','manual')),
  source_fact_id  text,
  rule            text not null check (rule in ('sum','unique_dedup','ratio_num','ratio_den','snapshot_latest')),
  dedup_key_field text,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (source_kpi_id is not null or source_fact_id is not null)
);
create index if not exists kpi_contributions_kpi_idx on public.kpi_contributions (kpi_id);
create index if not exists kpi_contributions_source_idx on public.kpi_contributions (source_kpi_id);

-- ----------------------------------------------------------------------------
-- e. activities: owner / channel / deliverables (đều thiếu trên live)
-- ----------------------------------------------------------------------------
alter table public.activities add column if not exists owner_id uuid;
alter table public.activities add column if not exists channel text;
alter table public.activities add column if not exists deliverables jsonb not null default '[]'::jsonb;
alter table public.activities add column if not exists objective text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='activities_owner_fk') then
    alter table public.activities add constraint activities_owner_fk foreign key (owner_id) references public.users (id) on delete set null;
  end if;
end $$;
create index if not exists activities_owner_idx on public.activities (owner_id);
comment on column public.activities.deliverables is 'R3-08: đầu ra kỳ vọng của hoạt động (jsonb mảng).';

-- ----------------------------------------------------------------------------
-- f. content_items: pillar / series / nguồn dùng lại / snapshot lúc đăng
-- ----------------------------------------------------------------------------
alter table public.content_items add column if not exists pillar_id uuid;
alter table public.content_items add column if not exists bu_product_id uuid;
alter table public.content_items add column if not exists activity_id uuid;
alter table public.content_items add column if not exists series text;
alter table public.content_items add column if not exists source_content_id uuid;
alter table public.content_items add column if not exists pillar_id_at_publish uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='content_items_pillar_fk') then
    alter table public.content_items add constraint content_items_pillar_fk foreign key (pillar_id) references public.content_pillars (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='content_items_bu_product_fk') then
    alter table public.content_items add constraint content_items_bu_product_fk foreign key (bu_product_id) references public.bu_products (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='content_items_activity_fk') then
    alter table public.content_items add constraint content_items_activity_fk foreign key (activity_id) references public.activities (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='content_items_source_fk') then
    alter table public.content_items add constraint content_items_source_fk foreign key (source_content_id) references public.content_items (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='content_items_pillar_publish_fk') then
    alter table public.content_items add constraint content_items_pillar_publish_fk foreign key (pillar_id_at_publish) references public.content_pillars (id) on delete set null;
  end if;
end $$;
create index if not exists content_items_pillar_idx on public.content_items (pillar_id);
create index if not exists content_items_activity_idx on public.content_items (activity_id);
comment on column public.content_items.pillar_id_at_publish is 'Snapshot phân loại tại thời điểm đăng: đổi pillar hiện tại không làm đổi báo cáo đã chốt theo phân loại lúc đăng.';

-- ----------------------------------------------------------------------------
-- g. content_variants: metadata sản xuất còn thiếu
-- ----------------------------------------------------------------------------
alter table public.content_variants add column if not exists owner_id uuid;
alter table public.content_variants add column if not exists reviewer_id uuid;
alter table public.content_variants add column if not exists production_deadline timestamptz;
alter table public.content_variants add column if not exists brief text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='content_variants_owner_fk') then
    alter table public.content_variants add constraint content_variants_owner_fk foreign key (owner_id) references public.users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='content_variants_reviewer_fk') then
    alter table public.content_variants add constraint content_variants_reviewer_fk foreign key (reviewer_id) references public.users (id) on delete set null;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- h. brand_pages: owner / tags + brand_page_versions
-- ----------------------------------------------------------------------------
alter table public.brand_pages add column if not exists owner_id uuid;
alter table public.brand_pages add column if not exists tags text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='brand_pages_owner_fk') then
    alter table public.brand_pages add constraint brand_pages_owner_fk foreign key (owner_id) references public.users (id) on delete set null;
  end if;
end $$;
create table if not exists public.brand_page_versions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  brand_page_id  uuid not null references public.brand_pages (id) on delete cascade,
  version        integer not null check (version >= 1),
  snapshot       jsonb not null default '{}'::jsonb,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (brand_page_id, version)
);
create index if not exists brand_page_versions_page_idx on public.brand_page_versions (brand_page_id, version desc);

-- ----------------------------------------------------------------------------
-- i. member_capacity (R3-09: thay hardcode 40h/daysOff=[])
-- ----------------------------------------------------------------------------
create table if not exists public.member_capacity (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  hours_per_week numeric(6,2) not null check (hours_per_week >= 0),
  days_off       jsonb not null default '[]'::jsonb,
  effective_from date,
  effective_to   date,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index if not exists member_capacity_ws_user_idx on public.member_capacity (workspace_id, user_id);

-- ----------------------------------------------------------------------------
-- j. tasks.is_milestone + campaign_baselines
-- ----------------------------------------------------------------------------
alter table public.tasks add column if not exists is_milestone boolean not null default false;
create table if not exists public.campaign_baselines (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  version      integer not null check (version >= 1),
  snapshot     jsonb not null default '{}'::jsonb,
  approved_by  uuid references public.users (id) on delete set null,
  approved_at  timestamptz,
  note         text,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (campaign_id, version)
);
create index if not exists campaign_baselines_campaign_idx on public.campaign_baselines (campaign_id, version desc);

-- ----------------------------------------------------------------------------
-- k. campaign_assets (bảng nối campaign <-> asset)
-- ----------------------------------------------------------------------------
create table if not exists public.campaign_assets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  asset_id     uuid not null references public.assets (id) on delete cascade,
  role         text,
  note         text,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (campaign_id, asset_id)
);
create index if not exists campaign_assets_campaign_idx on public.campaign_assets (campaign_id);
create index if not exists campaign_assets_asset_idx on public.campaign_assets (asset_id);

-- ----------------------------------------------------------------------------
-- l. budget_allocations: chia 1 khoản gốc (actual/commitment) cho activity
-- ----------------------------------------------------------------------------
create table if not exists public.budget_allocations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  source_kind    text not null check (source_kind in ('actual','commitment')),
  actual_id      uuid references public.budget_actuals (id) on delete cascade,
  commitment_id  uuid references public.budget_commitments (id) on delete cascade,
  campaign_id    uuid not null references public.campaigns (id) on delete cascade,
  activity_id    uuid references public.activities (id) on delete set null,
  amount         numeric(18,2) not null check (amount > 0),
  share_percent  numeric(7,4),
  effective_date date,
  currency       text not null default 'VND',
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((source_kind = 'actual' and actual_id is not null and commitment_id is null)
      or (source_kind = 'commitment' and commitment_id is not null and actual_id is null))
);
create index if not exists budget_allocations_actual_idx on public.budget_allocations (actual_id);
create index if not exists budget_allocations_commitment_idx on public.budget_allocations (commitment_id);
create index if not exists budget_allocations_campaign_idx on public.budget_allocations (campaign_id);
create index if not exists budget_allocations_activity_idx on public.budget_allocations (activity_id);
comment on table public.budget_allocations is 'AC08: phân bổ share của ĐÚNG 1 khoản gốc; trigger ở 0010 chặn tổng allocation vượt amount của nguồn. activity_id null = chi trực tiếp campaign.';

-- ----------------------------------------------------------------------------
-- n. Sổ Thu–Chi (R2-24 / R3-10): cash_accounts / categories / transactions
-- ----------------------------------------------------------------------------
create table if not exists public.cash_accounts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  name            text not null,
  currency        text not null default 'VND',
  opening_balance numeric(18,2) not null default 0,
  status          text not null default 'active' check (status in ('active','archived')),
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists cash_accounts_workspace_idx on public.cash_accounts (workspace_id);

create table if not exists public.cash_categories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  kind         text not null check (kind in ('in','out')),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists cash_categories_workspace_idx on public.cash_categories (workspace_id);

create table if not exists public.cash_transactions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  account_id      uuid not null references public.cash_accounts (id) on delete cascade,
  category_id     uuid references public.cash_categories (id) on delete set null,
  direction       text not null check (direction in ('in','out')),
  amount          numeric(18,2) not null check (amount > 0),
  occurred_on     date not null default current_date,
  campaign_id     uuid references public.campaigns (id) on delete set null,
  activity_id     uuid references public.activities (id) on delete set null,
  note            text,
  evidence_ref    text,
  idempotency_key text,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists cash_transactions_account_idx on public.cash_transactions (account_id, occurred_on);
create index if not exists cash_transactions_campaign_idx on public.cash_transactions (campaign_id);
create unique index if not exists cash_transactions_idempotency_uidx
  on public.cash_transactions (workspace_id, idempotency_key) where idempotency_key is not null;

-- Số dư = opening + sum(in) - sum(out); security_invoker để tôn trọng RLS người gọi
create or replace view public.cash_account_balances with (security_invoker = true) as
  select a.id as account_id, a.workspace_id, a.currency,
         a.opening_balance
           + coalesce(sum(case when t.direction='in' then t.amount else 0 end),0)
           - coalesce(sum(case when t.direction='out' then t.amount else 0 end),0) as balance
  from public.cash_accounts a
  left join public.cash_transactions t on t.account_id = a.id
  group by a.id, a.workspace_id, a.currency, a.opening_balance;

-- ----------------------------------------------------------------------------
-- o. RLS + grants cho MỌI bảng mới (mẫu 0002: operational/edit, kpis, budget)
-- ----------------------------------------------------------------------------
do $$ declare v_table text; begin
  foreach v_table in array array['content_pillars','kpi_target_versions','kpi_contributions','brand_page_versions','member_capacity','campaign_baselines','campaign_assets','budget_allocations','cash_accounts','cash_categories','cash_transactions'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
  end loop;
end $$;
grant select on public.cash_account_balances to authenticated, service_role;

-- content_pillars / brand_page_versions / campaign_assets: operational + edit
do $$ declare v_table text; begin
  foreach v_table in array array['content_pillars','brand_page_versions','campaign_assets'] loop
    execute format('drop policy if exists %I on public.%I', v_table||'_select', v_table);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_operational_member(workspace_id))', v_table||'_select', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_insert', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(''edit'', workspace_id))', v_table||'_insert', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_update', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(''edit'', workspace_id)) with check (public.has_permission(''edit'', workspace_id))', v_table||'_update', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_delete', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(''edit'', workspace_id))', v_table||'_delete', v_table);
  end loop;
end $$;

-- kpi_target_versions / kpi_contributions: mẫu kpis (member đọc, edit ghi)
do $$ declare v_table text; begin
  foreach v_table in array array['kpi_target_versions','kpi_contributions'] loop
    execute format('drop policy if exists %I on public.%I', v_table||'_select', v_table);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', v_table||'_select', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_insert', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(''edit'', workspace_id))', v_table||'_insert', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_update', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(''edit'', workspace_id)) with check (public.has_permission(''edit'', workspace_id))', v_table||'_update', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_delete', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(''edit'', workspace_id))', v_table||'_delete', v_table);
  end loop;
end $$;

-- campaign_baselines: operational đọc, approve mới ghi (bản duyệt)
drop policy if exists campaign_baselines_select on public.campaign_baselines;
create policy campaign_baselines_select on public.campaign_baselines for select to authenticated using (public.is_operational_member(workspace_id));
drop policy if exists campaign_baselines_insert on public.campaign_baselines;
create policy campaign_baselines_insert on public.campaign_baselines for insert to authenticated with check (public.has_permission('approve', workspace_id));
drop policy if exists campaign_baselines_update on public.campaign_baselines;
create policy campaign_baselines_update on public.campaign_baselines for update to authenticated using (public.has_permission('approve', workspace_id)) with check (public.has_permission('approve', workspace_id));
drop policy if exists campaign_baselines_delete on public.campaign_baselines;
create policy campaign_baselines_delete on public.campaign_baselines for delete to authenticated using (public.has_permission('approve', workspace_id));

-- budget_allocations / cash_*: mẫu ngân sách (budget_view đọc, budget_edit ghi)
do $$ declare v_table text; begin
  foreach v_table in array array['budget_allocations','cash_accounts','cash_categories','cash_transactions'] loop
    execute format('drop policy if exists %I on public.%I', v_table||'_select', v_table);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_operational_member(workspace_id) and public.has_permission(''budget_view'', workspace_id))', v_table||'_select', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_insert', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(''budget_edit'', workspace_id))', v_table||'_insert', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_update', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(''budget_edit'', workspace_id)) with check (public.has_permission(''budget_edit'', workspace_id))', v_table||'_update', v_table);
    execute format('drop policy if exists %I on public.%I', v_table||'_delete', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(''budget_edit'', workspace_id))', v_table||'_delete', v_table);
  end loop;
end $$;

-- member_capacity: thành viên cùng workspace đọc; ghi = chính mình hoặc owner/lead
drop policy if exists member_capacity_select on public.member_capacity;
create policy member_capacity_select on public.member_capacity for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists member_capacity_insert on public.member_capacity;
create policy member_capacity_insert on public.member_capacity for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and (user_id = auth.uid() or public.current_role(workspace_id) in ('owner','lead')));
drop policy if exists member_capacity_update on public.member_capacity;
create policy member_capacity_update on public.member_capacity for update to authenticated
  using (public.is_workspace_member(workspace_id) and (user_id = auth.uid() or public.current_role(workspace_id) in ('owner','lead')))
  with check (public.is_workspace_member(workspace_id) and (user_id = auth.uid() or public.current_role(workspace_id) in ('owner','lead')));
drop policy if exists member_capacity_delete on public.member_capacity;
create policy member_capacity_delete on public.member_capacity for delete to authenticated
  using (public.current_role(workspace_id) in ('owner','lead'));
