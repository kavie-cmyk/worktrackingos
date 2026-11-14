-- ============================================================================
-- SAVA Marketing Workspace — 0005_data_contracts.sql (vòng sửa QA R1)
--   R14: đường nhập tay hẹp cho external_posts / metric_observations.
--   R17: assets.approval_status tách khỏi status sử dụng.
--   R18: trigger merge custom_fields (kèm explicit unset "__UNSET__").
--   R26: budget_commitments.settled_amount + budget_remaining theo semantic
--        đã chốt (xem comment tại hàm).
--   R28: publish_jobs.decision_id.
--   R31: archived_at cho các bảng entity chính (archive thay hard-delete).
-- Mọi câu lệnh đều idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- R14 — external_posts.source: 'api' (sync qua connector) / 'manual' (nhập
-- tay trong app) / 'import' (nạp file). Dữ liệu sync cũ mặc định 'api'.
-- ----------------------------------------------------------------------------

alter table public.external_posts
  add column if not exists source text not null default 'api';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'external_posts_source_check') then
    alter table public.external_posts
      add constraint external_posts_source_check check (source in ('api', 'manual', 'import'));
  end if;
end $$;

comment on column public.external_posts.source is 'Nguồn bản ghi: api = sync-worker/connector, manual = nhập tay trong app, import = nạp file. Policy ghi của authenticated CHỈ áp cho manual.';

-- INSERT/UPDATE tay: chỉ member+ (quyền 'edit': owner/lead/member — CEO bị
-- loại bởi ma trận quyền) của ĐÚNG workspace, và CHỈ với source='manual'.
-- Dữ liệu source='api'/'import' vẫn chỉ service_role (sync-worker) ghi.
drop policy if exists external_posts_insert_manual on public.external_posts;
create policy external_posts_insert_manual on public.external_posts for insert to authenticated
  with check (source = 'manual' and public.has_permission('edit', workspace_id));

drop policy if exists external_posts_update_manual on public.external_posts;
create policy external_posts_update_manual on public.external_posts for update to authenticated
  using (source = 'manual' and public.has_permission('edit', workspace_id))
  with check (source = 'manual' and public.has_permission('edit', workspace_id));

-- metric_observations: cột source đã có (giá trị sync = tên nền tảng).
-- Nhập tay/import chỉ khi source in ('manual','import') + quyền 'edit' của
-- workspace. UPDATE policy đi kèm để upsert (on conflict) của PostgREST
-- hoạt động cho đúng các dòng manual/import đó.
drop policy if exists metric_observations_insert_manual on public.metric_observations;
create policy metric_observations_insert_manual on public.metric_observations for insert to authenticated
  with check (source in ('manual', 'import') and public.has_permission('edit', workspace_id));

drop policy if exists metric_observations_update_manual on public.metric_observations;
create policy metric_observations_update_manual on public.metric_observations for update to authenticated
  using (source in ('manual', 'import') and public.has_permission('edit', workspace_id))
  with check (source in ('manual', 'import') and public.has_permission('edit', workspace_id));

-- R15 (đối chiếu): post_content_mappings ĐÃ có policy INSERT/UPDATE/DELETE
-- cho authenticated với has_permission('edit', workspace_id) từ 0002_rls.sql
-- (đã đọc lại live 11/11/2026) — gắn/đổi/bỏ gắn campaign đi qua bảng nối này,
-- KHÔNG cần sửa external_posts. Không thay đổi gì ở migration này.

-- ----------------------------------------------------------------------------
-- R17 — assets.approval_status: vòng duyệt của tư liệu, TÁCH khỏi status sử
-- dụng ('active'/'archived'). Giá trị: draft / in_review / approved /
-- archived. Backfill: mọi asset hiện có = 'draft' (KHÔNG tự coi active là
-- đã duyệt).
-- ----------------------------------------------------------------------------

alter table public.assets
  add column if not exists approval_status text not null default 'draft';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_approval_status_check') then
    alter table public.assets
      add constraint assets_approval_status_check
      check (approval_status in ('draft', 'in_review', 'approved', 'archived'));
  end if;
end $$;

comment on column public.assets.approval_status is 'Trạng thái duyệt tư liệu (draft/in_review/approved/archived), tách khỏi status sử dụng (active/archived). Mặc định draft — active KHÔNG đồng nghĩa đã duyệt.';

-- ----------------------------------------------------------------------------
-- R18 — merge custom_fields khi UPDATE: giá trị mới được TRỘN lên giá trị cũ
-- (old || new) nên patch 1 khóa không xóa các khóa khác. Muốn XÓA 1 khóa,
-- gửi khóa đó với giá trị chuỗi đặc biệt "__UNSET__" (explicit unset) —
-- trigger sẽ loại khóa đó khỏi kết quả. Áp cho mọi bảng có custom_fields:
-- bu_products, campaigns, content_items, marketing_requests, tasks.
-- ----------------------------------------------------------------------------

create or replace function public.merge_custom_fields()
returns trigger
language plpgsql
as $$
declare
  v_key    text;
  v_merged jsonb;
begin
  if NEW.custom_fields is null then
    NEW.custom_fields := coalesce(OLD.custom_fields, '{}'::jsonb);
    return NEW;
  end if;
  v_merged := coalesce(OLD.custom_fields, '{}'::jsonb) || NEW.custom_fields;
  for v_key in select jsonb_object_keys(NEW.custom_fields) loop
    if NEW.custom_fields -> v_key = '"__UNSET__"'::jsonb then
      v_merged := v_merged - v_key;
    end if;
  end loop;
  NEW.custom_fields := v_merged;
  return NEW;
end;
$$;

comment on function public.merge_custom_fields() is 'R18: BEFORE UPDATE — new.custom_fields được merge lên old (old || new); khóa có giá trị "__UNSET__" bị xóa khỏi kết quả (explicit unset).';

do $$
declare v_table text;
begin
  foreach v_table in array array['bu_products', 'campaigns', 'content_items', 'marketing_requests', 'tasks'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_merge_custom_fields', v_table);
    execute format('create trigger %I before update on public.%I for each row execute function public.merge_custom_fields()',
                   v_table || '_merge_custom_fields', v_table);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- R26 — SEMANTIC NGÂN SÁCH ĐÃ CHỐT (áp đồng nhất SQL/JS/export):
--   settled_amount = phần cam kết ĐÃ thanh toán/đối soát xong (nguồn sự
--   thật, ghi trực tiếp trên commitment — không suy từ actuals nữa).
--   remaining = approved_amount
--             − sum(budget_actuals.amount)                       [mọi actual]
--             − sum(commitment.amount − commitment.settled_amount)
--               với commitment ở trạng thái CÒN MỞ:
--               'planned' / 'committed' / 'partially_actualised'.
--   Commitment 'settled' / 'released' / 'cancelled' KHÔNG trừ phần chưa
--   settle (coi như đã giải phóng ngân sách).
-- ----------------------------------------------------------------------------

alter table public.budget_commitments
  add column if not exists settled_amount numeric(18, 2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budget_commitments_settled_nonneg') then
    alter table public.budget_commitments
      add constraint budget_commitments_settled_nonneg check (settled_amount >= 0);
  end if;
end $$;

comment on column public.budget_commitments.settled_amount is 'Phần cam kết đã thanh toán/đối soát. budget_remaining trừ (amount − settled_amount) cho cam kết còn mở — semantic chốt ở 0005 (R26).';

create or replace function public.budget_remaining(p_budget_line_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_approved numeric;
  v_actual   numeric;
  v_open     numeric;
begin
  select bl.approved_amount into v_approved
  from public.budget_lines bl
  where bl.id = p_budget_line_id;

  if v_approved is null then
    return null;
  end if;

  select coalesce(sum(ba.amount), 0) into v_actual
  from public.budget_actuals ba
  where ba.budget_line_id = p_budget_line_id;

  select coalesce(sum(bc.amount - bc.settled_amount), 0) into v_open
  from public.budget_commitments bc
  where bc.budget_line_id = p_budget_line_id
    and bc.status in ('planned', 'committed', 'partially_actualised');

  return v_approved - v_actual - v_open;
end;
$$;

comment on function public.budget_remaining(uuid) is 'R26 semantic chốt: approved − sum(actuals) − sum(cam kết còn mở: amount − settled_amount). Settled/cancelled/released không trừ phần chưa settle.';

-- ----------------------------------------------------------------------------
-- R28 — publish_jobs.decision_id: job PHẢI trỏ tới quyết định duyệt cụ thể
-- đã duyệt đúng revision của job. publish-worker kiểm tra cột này khi chạy:
-- thiếu decision_id hoặc revision không khớp approved_revision_id của
-- variant -> job chuyển 'needs_check', không gửi.
-- ----------------------------------------------------------------------------

alter table public.publish_jobs
  add column if not exists decision_id uuid references public.approval_decisions (id) on delete set null;

comment on column public.publish_jobs.decision_id is 'Quyết định duyệt (approval_decisions.id) làm căn cứ đăng. Bắt buộc về contract: worker từ chối gửi (needs_check) khi thiếu hoặc không khớp revision đã duyệt.';

-- ----------------------------------------------------------------------------
-- R31 — archived_at cho các bảng entity chính chưa có: archive là UPDATE
-- thường (đặt archived_at = now(), khôi phục = null) theo policy sẵn có,
-- thay cho hard-delete qua _removeRemote.
-- ----------------------------------------------------------------------------

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'campaigns', 'tasks', 'content_items', 'content_variants', 'assets',
    'brand_pages', 'kpis', 'budget_lines', 'external_posts',
    'ads_change_requests', 'plans', 'bu_products', 'marketing_requests',
    'channel_accounts', 'phases', 'activities'
  ] loop
    execute format('alter table public.%I add column if not exists archived_at timestamptz', v_table);
  end loop;
end $$;
