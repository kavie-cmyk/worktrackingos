-- ============================================================================
-- SAVA Marketing Workspace — 0017_brand_planning.sql
-- Brand + Planning lên dữ liệu thật (mô hình: MO-HINH-BRAND-PLANNING.md).
-- CHỈ là mã nguồn trong repo — CHƯA áp lên production khi file này được commit.
-- Cách áp + kiểm chứng + quay lui: docs/MIGRATION-0017-RUNBOOK.md.
-- Idempotent theo mẫu 0009/0014: create table if not exists, add column if not
-- exists, drop policy if exists trước khi tạo lại.
--
-- QUYẾT ĐỊNH ÁNH XẠ CHÍNH (chi tiết ở runbook mục "Quyết định ánh xạ"):
--  1. ID: các bảng mới dùng uuid như mọi bảng cũ. Dữ liệu demo dùng id text
--     (vd 'brand-lumus-ai') — seed (supabase/seed/from-demo-data.sql) ánh xạ
--     deterministic: uuid = md5('sava-seed-v1:' || <demo id>) định dạng uuid
--     v4-like. App KHÔNG giữ id text: bản ghi tạo mới qua app được DB cấp uuid
--     như mọi collection cũ (store-core bỏ id không phải uuid khi insert).
--  2. phases DÙNG CHUNG một bảng: phase campaign cũ (campaign_id/plan_id +
--     start_date/end_date) và phase Brand+Planning (brand_id + start_month/
--     end_month) cùng nằm ở public.phases — KHÔNG tạo bảng phases mới, chỉ
--     ALTER thêm cột. Lý do: collection 'phases' của app đã trỏ bảng này;
--     activities/tasks/kpis tham chiếu phases(id) — tách bảng sẽ vỡ FK và
--     phải fork collection. Ràng buộc cũ "plan_id hoặc campaign_id not null"
--     được nới thành "plan_id hoặc campaign_id hoặc brand_id not null".
--  3. Cột `group` của demo (plan_rows/benchmarks) → channel_group ("group" là
--     từ khóa của PostgreSQL, không dùng làm tên cột trần). store-core có
--     FIELD_ALIASES group → channel_group nên app vẫn đọc/ghi field `group`.
--  4. brand_id/segment: CHỈ thêm vào campaigns, kpis, budget_lines (dữ liệu
--     demo của 3 collection này đã có sẵn brand_id/segment) + các bảng mới.
--     Không thêm vào tasks/activities/content (demo không có; app suy qua
--     campaign cha — giữ nguyên cơ chế cũ).
--  5. Mọi field dạng object/array của demo → jsonb (cost_per_result,
--     palette, key_messages, funnel_steps). Field của demo không có cột tương
--     ứng ở các bảng CŨ (vd campaigns.why/businessGoal) tiếp tục đi qua
--     custom_fields như cơ chế hiện hành — không đổi ở migration này.
--
-- FIELD B2B CHÍNH THỨC (Zac duyệt mô hình v2, 17/11/2026 22:00): cầu nối
-- Paid User → B2B Account, ngân sách Partnership/Event chia B2C/B2B,
-- churn/COGS/ARPU riêng cho B2B. Danh sách field đã CHỐT và nằm ngay trong
-- từng bảng bên dưới: plan_rows (audience, b2b_split_pct), benchmarks
-- (paid_to_b2b, lead_to_account, demo_to_account + key signup/b2b_account
-- trong cost_per_result), phases (b2b_churn_rate, arppu_b2b,
-- cogs_per_b2b_account, opening_b2b).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. brands
-- ----------------------------------------------------------------------------
create table if not exists public.brands (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  code          text,
  name          text not null,
  tagline       text,
  description   text,
  market        text,
  primary_color text,
  color         text,
  palette       jsonb not null default '[]'::jsonb,
  voice         text,
  key_messages  jsonb not null default '[]'::jsonb,
  funnel_steps  jsonb not null default '[]'::jsonb,
  status        text not null default 'active' check (status in ('active', 'archived')),
  archived_at   timestamptz,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists brands_workspace_idx on public.brands (workspace_id);
create index if not exists brands_workspace_status_idx on public.brands (workspace_id, status);
comment on table public.brands is '0017: Brand (lớp trên cùng của mô hình Brand+Planning). Brand Identity nằm ngay trên dòng brand: palette/key_messages/funnel_steps dạng jsonb mảng.';

-- ----------------------------------------------------------------------------
-- 2. phases — ALTER bảng cũ cho phase Brand+Planning (quyết định 2 ở trên)
-- ----------------------------------------------------------------------------
alter table public.phases add column if not exists brand_id uuid references public.brands (id) on delete set null;
alter table public.phases add column if not exists segment text;
alter table public.phases add column if not exists start_month text;
alter table public.phases add column if not exists end_month text;
alter table public.phases add column if not exists objective text;
alter table public.phases add column if not exists uplift_percent_per_month numeric(9,4);
alter table public.phases add column if not exists note text;
-- Chỉ số vận hành & tài chính theo Phase (bảng Planning "Chỉ số vận hành"):
alter table public.phases add column if not exists paid_churn_rate numeric(9,6);
alter table public.phases add column if not exists free_churn_rate numeric(9,6);
alter table public.phases add column if not exists arppu numeric(18,2);
alter table public.phases add column if not exists cogs_per_user numeric(18,2);
alter table public.phases add column if not exists fixed_cost numeric(18,2);
alter table public.phases add column if not exists opening_free numeric(18,2);
alter table public.phases add column if not exists opening_paid numeric(18,2);
-- Field B2B chính thức theo Phase (Zac duyệt 17/11/2026): churn/ARPPU/COGS
-- riêng cho B2B Account + số dư B2B đầu kỳ (cùng quy ước kiểu với các cột
-- tài chính B2C ở trên: rate dạng phân số numeric(9,6), tiền numeric(18,2)).
alter table public.phases add column if not exists b2b_churn_rate numeric(9,6);
alter table public.phases add column if not exists arppu_b2b numeric(18,2);
alter table public.phases add column if not exists cogs_per_b2b_account numeric(18,2);
alter table public.phases add column if not exists opening_b2b numeric(18,2);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'phases_segment_check') then
    alter table public.phases add constraint phases_segment_check
      check (segment is null or segment in ('b2c', 'b2b'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phases_month_format_check') then
    alter table public.phases add constraint phases_month_format_check
      check ((start_month is null or start_month ~ '^\d{4}-\d{2}$')
         and (end_month is null or end_month ~ '^\d{4}-\d{2}$'));
  end if;
end $$;

-- Nới ràng buộc scope cũ của 0001 (plan_id/campaign_id not null) để phase
-- Brand (chỉ có brand_id) hợp lệ. Tìm constraint theo định nghĩa, không đoán tên.
do $$
declare v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.phases'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%plan_id IS NOT NULL OR campaign_id IS NOT NULL%'
    and pg_get_constraintdef(oid) not like '%brand_id%';
  if v_name is not null then
    execute format('alter table public.phases drop constraint %I', v_name);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phases_scope_check') then
    alter table public.phases add constraint phases_scope_check
      check (plan_id is not null or campaign_id is not null or brand_id is not null);
  end if;
end $$;

create index if not exists phases_brand_idx on public.phases (brand_id);
create index if not exists phases_workspace_brand_idx on public.phases (workspace_id, brand_id);
comment on column public.phases.brand_id is '0017: phase thuộc Brand (Planning theo Phase). Phase campaign cũ để null.';
comment on column public.phases.start_month is '0017: tháng đầu phase Brand dạng yyyy-mm. Phase campaign cũ dùng start_date/end_date.';
comment on column public.phases.uplift_percent_per_month is '0017: uplift %/tháng áp vào tỉ lệ chuyển đổi theo (1+u)^n từ tháng đầu phase.';

-- ----------------------------------------------------------------------------
-- 3. benchmarks — thư viện đầu vào dự báo (sheet "03 Inputs")
-- ----------------------------------------------------------------------------
create table if not exists public.benchmarks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  brand_id        uuid references public.brands (id) on delete cascade,
  segment         text check (segment is null or segment in ('b2c', 'b2b')),
  channel         text not null,
  channel_group   text,
  unit_price      numeric(18,2),
  currency        text not null default 'VND',
  output_per_unit numeric(18,4),
  view_to_visit   numeric(12,8),
  visit_to_signup numeric(12,8),
  signup_to_first numeric(12,8),
  first_to_paid   numeric(12,8),
  paid_to_b2b     numeric(12,8),
  lead_to_account numeric(12,8),
  demo_to_account numeric(12,8),
  cost_per_result jsonb not null default '{}'::jsonb,
  direct_budget   boolean not null default false,
  confidence      text,
  source          text,
  archived_at     timestamptz,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Field B2B chính thức (Zac duyệt 17/11/2026): 3 tỉ lệ funnel B2B (cùng
-- quy ước numeric(12,8) như các tỉ lệ funnel ở trên). Cost per B2B account
-- KHÔNG thêm cột: nằm trong map cost_per_result jsonb với key 'b2b_account'
-- (cùng key 'signup' cho objective Signup) — map này không có constraint
-- khóa nên không cần thay schema khi thêm key.
create index if not exists benchmarks_workspace_idx on public.benchmarks (workspace_id);
create index if not exists benchmarks_brand_channel_idx on public.benchmarks (workspace_id, brand_id, channel);
comment on table public.benchmarks is '0017: benchmark theo Brand × Channel (segment null = dùng chung). cost_per_result là map jsonb {objective: chi phí/kết quả} cho Paid Media — key chính thức gồm signup và b2b_account (cost per B2B account, kênh Partnership/Event).';
comment on column public.benchmarks.channel_group is 'Nhóm kênh (field `group` ở app/demo) — đổi tên vì GROUP là từ khóa PostgreSQL.';

-- ----------------------------------------------------------------------------
-- 4. plan_rows — một dòng kế hoạch = Brand × Segment × Tháng × Channel
-- ----------------------------------------------------------------------------
create table if not exists public.plan_rows (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id     uuid not null references public.brands (id) on delete cascade,
  segment      text check (segment is null or segment in ('b2c', 'b2b')),
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  channel      text not null,
  channel_group text,
  unit         text,
  qty          numeric(18,4),
  audience     text check (audience is null or audience in ('b2c', 'b2b', 'both')),
  b2b_split_pct numeric(9,4) check (b2b_split_pct is null or (b2b_split_pct >= 0 and b2b_split_pct <= 100)),
  unit_price   numeric(18,2),
  budget       numeric(18,2),
  objective    text,
  phase_id     uuid references public.phases (id) on delete set null,
  campaign_id  uuid references public.campaigns (id) on delete set null,
  activity_id  uuid references public.activities (id) on delete set null,
  archived_at  timestamptz,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Field B2B chính thức (Zac duyệt 17/11/2026) nằm ngay trong create table
-- plan_rows bên dưới: audience (check 3 giá trị b2c/b2b/both) +
-- b2b_split_pct (tỉ lệ % chia ngân sách sang B2B, cùng quy ước kiểu với
-- uplift_percent_per_month của phases: numeric(9,4), lưu dạng % 0–100).
create index if not exists plan_rows_workspace_idx on public.plan_rows (workspace_id);
create index if not exists plan_rows_brand_month_idx on public.plan_rows (workspace_id, brand_id, month);
create index if not exists plan_rows_phase_idx on public.plan_rows (phase_id);
create index if not exists plan_rows_campaign_idx on public.plan_rows (campaign_id);
comment on table public.plan_rows is '0017: dòng Planning. Ngân sách tự tính = qty × đơn giá hiệu dụng (unit_price đặt tay > benchmark) trừ Paid Media: budget nhập thẳng theo tháng × objective.';
comment on column public.plan_rows.channel_group is 'Nhóm kênh (field `group` ở app/demo) — đổi tên vì GROUP là từ khóa PostgreSQL.';

-- ----------------------------------------------------------------------------
-- 5. phase_assumptions — tỉ lệ chuyển đổi ghi đè theo Phase × Channel
-- ----------------------------------------------------------------------------
create table if not exists public.phase_assumptions (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  phase_id            uuid not null references public.phases (id) on delete cascade,
  channel             text not null,
  view_to_visit       numeric(12,8),
  visit_to_signup     numeric(12,8),
  signup_to_first     numeric(12,8),
  first_to_paid       numeric(12,8),
  top_funnel_override numeric(18,4),
  created_by          uuid references public.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (phase_id, channel)
);
create index if not exists phase_assumptions_workspace_idx on public.phase_assumptions (workspace_id);
create index if not exists phase_assumptions_phase_idx on public.phase_assumptions (phase_id);
comment on table public.phase_assumptions is '0017: tỉ lệ null = kế thừa benchmark của Brand × Channel (không phải 0).';

-- ----------------------------------------------------------------------------
-- 6. brand_id/segment cho campaigns / kpis / budget_lines (demo đã có sẵn)
--    + phase_id/period_key/source cho kpis (demo kpis đã có phase_id,
--    periodKey, source; actual KHÔNG thêm cột — actual suy từ measurements
--    như cơ chế hiện hành, giá trị demo của actual đều null).
-- ----------------------------------------------------------------------------
alter table public.campaigns add column if not exists brand_id uuid references public.brands (id) on delete set null;
alter table public.campaigns add column if not exists segment text;
alter table public.kpis add column if not exists brand_id uuid references public.brands (id) on delete set null;
alter table public.kpis add column if not exists segment text;
alter table public.kpis add column if not exists phase_id uuid references public.phases (id) on delete set null;
alter table public.kpis add column if not exists period_key text;
alter table public.kpis add column if not exists source text;
alter table public.budget_lines add column if not exists brand_id uuid references public.brands (id) on delete set null;
alter table public.budget_lines add column if not exists segment text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_segment_check') then
    alter table public.campaigns add constraint campaigns_segment_check check (segment is null or segment in ('b2c', 'b2b'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpis_segment_check') then
    alter table public.kpis add constraint kpis_segment_check check (segment is null or segment in ('b2c', 'b2b'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_segment_check') then
    alter table public.budget_lines add constraint budget_lines_segment_check check (segment is null or segment in ('b2c', 'b2b'));
  end if;
end $$;

create index if not exists campaigns_brand_idx on public.campaigns (brand_id);
create index if not exists campaigns_workspace_brand_idx on public.campaigns (workspace_id, brand_id);
create index if not exists kpis_brand_idx on public.kpis (brand_id);
create index if not exists kpis_phase_idx on public.kpis (phase_id);
create index if not exists budget_lines_brand_idx on public.budget_lines (brand_id);

-- ----------------------------------------------------------------------------
-- 7. RLS + grants + policies cho 4 bảng mới — mẫu 0002/0009 (operational
--    member đọc, has_permission('edit') ghi). brands cũng theo mẫu này
--    (KHÔNG theo mẫu kpis "mọi member kể cả CEO" — Brand là dữ liệu vận hành).
--    Tổng policy mới: 4 bảng × 4 = 16 policy.
-- ----------------------------------------------------------------------------
do $$ declare v_table text; begin
  foreach v_table in array array['brands','benchmarks','plan_rows','phase_assumptions'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
  end loop;
end $$;

do $$ declare v_table text; begin
  foreach v_table in array array['brands','benchmarks','plan_rows','phase_assumptions'] loop
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
