-- ============================================================================
-- SAVA Marketing Workspace — 0014_budget_approval_chain.sql
-- Chuỗi duyệt ngân sách: ĐỀ XUẤT (budget_proposals) -> duyệt hạn mức/dòng
-- (chỉ Owner, RPC decide_budget_proposal) -> CAM KẾT chờ duyệt -> CHI chờ
-- duyệt (lead/owner, RPC decide_commitment_approval /
-- decide_payment_approval, chặn vượt số đã duyệt theo UsageTotal).
-- Schema đi tiến, IDEMPOTENT: chạy lại không lỗi, không trùng.
-- Mẫu áp dụng:
--   * Guard trigger dùng cờ phiên current_setting('app.via_rpc') = 'on',
--     RPC SECURITY DEFINER + set_config('app.via_rpc','on',true) ngay đầu,
--     revoke/grant ở cuối mỗi hàm — đúng mẫu 0004.
--   * budget_remaining viết lại từ bản 0010, CHỈ thêm lọc approval_status.
-- Mã lỗi ỔN ĐỊNH (message bắt đầu bằng tiền tố, store/UI map theo tiền tố):
--   FORBIDDEN_ROLE (42501) · ALREADY_DECIDED (P0001) · SELF_APPROVAL (42501)
--   BUDGET_NOT_APPROVED (42501) · BUDGET_LIMIT_EXCEEDED (42501)
--   STALE_REVISION (42501) · CURRENCY_MISMATCH (22023)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) budget_proposals — đề xuất duyệt hạn mức campaign / số duyệt của dòng.
--    campaign_id LUÔN bắt buộc (kể cả khi target là budget_line: dòng thuộc
--    campaign đó); budget_line_id bắt buộc đúng khi target_type='budget_line'
--    (CHECK hai chiều ở dưới).
--    RLS: thành viên workspace được SELECT; INSERT chỉ cho chính mình
--    (proposer_id = auth.uid()); KHÔNG có policy UPDATE/DELETE cho
--    authenticated — trạng thái đề xuất chỉ đổi qua RPC decide_budget_proposal
--    (SECURITY DEFINER).
-- ----------------------------------------------------------------------------

create table if not exists public.budget_proposals (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id),
  target_type    text not null check (target_type in ('campaign_ceiling', 'budget_line')),
  campaign_id    uuid not null references public.campaigns (id),
  budget_line_id uuid references public.budget_lines (id),
  proposed_amount numeric(18, 2) not null,
  currency       text not null,
  reason         text,
  proposer_id    uuid not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  revision       integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint budget_proposals_target_check
    check ((target_type = 'budget_line') = (budget_line_id is not null))
);

create index if not exists budget_proposals_workspace_status_idx
  on public.budget_proposals (workspace_id, status);
create index if not exists budget_proposals_campaign_idx
  on public.budget_proposals (campaign_id);
create index if not exists budget_proposals_line_idx
  on public.budget_proposals (budget_line_id);

comment on table public.budget_proposals is '0014: đề xuất duyệt ngân sách — target campaign_ceiling (trần campaign) hoặc budget_line (approved_amount của dòng). Chỉ Owner quyết định qua RPC decide_budget_proposal; revision dùng chống quyết định trên bản đề xuất đã bị sửa (STALE_REVISION).';
comment on column public.budget_proposals.revision is 'Phiên bản lạc quan (optimistic lock): người duyệt phải gửi đúng revision đang xem; lệch -> STALE_REVISION.';

alter table public.budget_proposals enable row level security;

grant select, insert on public.budget_proposals to authenticated;
grant all on public.budget_proposals to service_role;

drop policy if exists budget_proposals_select on public.budget_proposals;
create policy budget_proposals_select on public.budget_proposals
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists budget_proposals_insert on public.budget_proposals;
create policy budget_proposals_insert on public.budget_proposals
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and proposer_id = auth.uid());
-- Cố ý KHÔNG tạo policy UPDATE/DELETE cho authenticated: chỉ RPC
-- decide_budget_proposal (SECURITY DEFINER) mới đổi được trạng thái đề xuất.

-- ----------------------------------------------------------------------------
-- 2) Cột mới
-- ----------------------------------------------------------------------------

-- 2a. budget_commitments / budget_actuals: bộ cột duyệt.
-- Default 'approved' để DỮ LIỆU CŨ giữ nguyên kết quả tính toán
-- (budget_remaining trước 0014 không lọc approval); dòng MỚI do client tạo
-- bị guard trigger (mục 3) ép về 'pending'.
alter table public.budget_commitments add column if not exists approval_status text not null default 'approved';
alter table public.budget_commitments add column if not exists approved_by uuid;
alter table public.budget_commitments add column if not exists approved_at timestamptz;
alter table public.budget_commitments add column if not exists approval_note text;
-- archived_at chưa có trên live (0005 mới thêm cho các entity chính);
-- công thức UsageTotal của chuỗi duyệt cần cột này (bỏ qua cam kết đã archive).
alter table public.budget_commitments add column if not exists archived_at timestamptz;

alter table public.budget_actuals add column if not exists approval_status text not null default 'approved';
alter table public.budget_actuals add column if not exists approved_by uuid;
alter table public.budget_actuals add column if not exists approved_at timestamptz;
alter table public.budget_actuals add column if not exists approval_note text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'budget_commitments_approval_status_check') then
    alter table public.budget_commitments add constraint budget_commitments_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_actuals_approval_status_check') then
    alter table public.budget_actuals add constraint budget_actuals_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

comment on column public.budget_commitments.approval_status is '0014: pending/approved/rejected — chỉ đổi qua RPC decide_commitment_approval. Dòng cũ default approved; dòng mới qua client bị guard ép pending.';
comment on column public.budget_actuals.approval_status is '0014: pending/approved/rejected — chỉ đổi qua RPC decide_payment_approval. Dòng cũ default approved; dòng mới qua client bị guard ép pending.';
comment on column public.budget_commitments.archived_at is '0014: mốc archive (mẫu R31 ở 0005); UsageTotal bỏ qua cam kết đã archive.';

-- 2b. Dấu duyệt trên budget_lines / campaigns (ghi bởi decide_budget_proposal).
-- Với campaigns, 3 cột này là dấu duyệt của HẠN MỨC (budget_ceiling_amount /
-- budget_ceiling_currency) ở cấp campaign — không phải duyệt campaign nói chung.
alter table public.budget_lines add column if not exists approved_by uuid;
alter table public.budget_lines add column if not exists approved_at timestamptz;
alter table public.budget_lines add column if not exists approved_via_proposal_id uuid;

alter table public.campaigns add column if not exists approved_by uuid;
alter table public.campaigns add column if not exists approved_at timestamptz;
alter table public.campaigns add column if not exists approved_via_proposal_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_approved_via_proposal_fk') then
    alter table public.budget_lines add constraint budget_lines_approved_via_proposal_fk
      foreign key (approved_via_proposal_id) references public.budget_proposals (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaigns_approved_via_proposal_fk') then
    alter table public.campaigns add constraint campaigns_approved_via_proposal_fk
      foreign key (approved_via_proposal_id) references public.budget_proposals (id);
  end if;
end $$;

comment on column public.budget_lines.approved_by is '0014: người duyệt số approved_amount hiện hành — chỉ ghi qua RPC decide_budget_proposal. NULL = dòng chưa từng được duyệt (RPC duyệt cam kết/chi sẽ chặn BUDGET_NOT_APPROVED).';
comment on column public.campaigns.approved_by is '0014: người duyệt HẠN MỨC campaign (budget_ceiling_amount) hiện hành — chỉ ghi qua RPC decide_budget_proposal.';
comment on column public.campaigns.approved_at is '0014: thời điểm duyệt HẠN MỨC campaign hiện hành.';
comment on column public.campaigns.approved_via_proposal_id is '0014: đề xuất (budget_proposals) đã sinh ra HẠN MỨC campaign hiện hành.';

-- ----------------------------------------------------------------------------
-- 3) Guard triggers (BEFORE INSERT OR UPDATE).
-- Bỏ qua khi current_user không phải authenticated/anon (service_role của
-- worker, postgres của SQL admin) hoặc khi cờ phiên app.via_rpc='on'
-- (RPC SECURITY DEFINER tự đặt) — đúng mẫu guard ở 0004.
-- ----------------------------------------------------------------------------

-- 3a. budget_lines: approved_amount + 3 cột dấu duyệt CHỈ đổi qua RPC.
-- LƯU Ý live: approved_amount là NOT NULL DEFAULT 0 (0001) nên "chưa duyệt"
-- ở INSERT nghĩa là approved_amount = 0 và 3 cột dấu duyệt đều NULL; INSERT
-- mang số duyệt <> 0 hoặc bất kỳ dấu duyệt nào đều bị chặn.
create or replace function public.guard_budget_line_approval_chain()
returns trigger
language plpgsql
as $$
declare
  v_via_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
begin
  if current_user not in ('authenticated', 'anon') or v_via_rpc then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if coalesce(NEW.approved_amount, 0) <> 0
       or NEW.approved_by is not null
       or NEW.approved_at is not null
       or NEW.approved_via_proposal_id is not null then
      raise exception 'budget_lines: approved_amount chỉ đổi qua RPC decide_budget_proposal'
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  if NEW.approved_amount is distinct from OLD.approved_amount
     or NEW.approved_by is distinct from OLD.approved_by
     or NEW.approved_at is distinct from OLD.approved_at
     or NEW.approved_via_proposal_id is distinct from OLD.approved_via_proposal_id then
    raise exception 'budget_lines: approved_amount chỉ đổi qua RPC decide_budget_proposal'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

comment on function public.guard_budget_line_approval_chain() is '0014: chặn authenticated/anon đặt/đổi approved_amount + dấu duyệt của budget_lines ngoài RPC decide_budget_proposal.';

drop trigger if exists budget_lines_guard_approval_chain on public.budget_lines;
create trigger budget_lines_guard_approval_chain
  before insert or update on public.budget_lines
  for each row execute function public.guard_budget_line_approval_chain();

-- 3b. campaigns: budget_ceiling_amount + 3 cột dấu duyệt của HẠN MỨC chỉ qua RPC.
create or replace function public.guard_campaign_ceiling_approval()
returns trigger
language plpgsql
as $$
declare
  v_via_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
begin
  if current_user not in ('authenticated', 'anon') or v_via_rpc then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.budget_ceiling_amount is not null
       or NEW.approved_by is not null
       or NEW.approved_at is not null
       or NEW.approved_via_proposal_id is not null then
      raise exception 'campaigns: budget_ceiling_amount chỉ đổi qua RPC decide_budget_proposal'
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  if NEW.budget_ceiling_amount is distinct from OLD.budget_ceiling_amount
     or NEW.approved_by is distinct from OLD.approved_by
     or NEW.approved_at is distinct from OLD.approved_at
     or NEW.approved_via_proposal_id is distinct from OLD.approved_via_proposal_id then
    raise exception 'campaigns: budget_ceiling_amount chỉ đổi qua RPC decide_budget_proposal'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

comment on function public.guard_campaign_ceiling_approval() is '0014: chặn authenticated/anon đặt/đổi budget_ceiling_amount + dấu duyệt hạn mức của campaigns ngoài RPC decide_budget_proposal.';

drop trigger if exists campaigns_guard_ceiling_approval on public.campaigns;
create trigger campaigns_guard_ceiling_approval
  before insert or update on public.campaigns
  for each row execute function public.guard_campaign_ceiling_approval();

-- 3c+3d. budget_commitments / budget_actuals (dùng chung 1 hàm guard):
--   INSERT -> ÉP approval_status='pending' + xóa 3 cột quyết định (không
--   raise: mọi đường insert của client đều ra trạng thái chờ duyệt, kể cả
--   khi client cố gửi sẵn 'approved').
--   UPDATE đổi bất kỳ cột nào trong 4 cột approval_* -> chặn 42501.
-- Khi bị từ chối, approved_by/approved_at mang nghĩa NGƯỜI/THỜI ĐIỂM QUYẾT
-- ĐỊNH (cả duyệt lẫn từ chối đều ghi vào đây, kèm approval_note).
create or replace function public.guard_budget_fact_approval()
returns trigger
language plpgsql
as $$
declare
  v_via_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
begin
  if current_user not in ('authenticated', 'anon') or v_via_rpc then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    NEW.approval_status := 'pending';
    NEW.approved_by := null;
    NEW.approved_at := null;
    NEW.approval_note := null;
    return NEW;
  end if;

  if NEW.approval_status is distinct from OLD.approval_status
     or NEW.approved_by is distinct from OLD.approved_by
     or NEW.approved_at is distinct from OLD.approved_at
     or NEW.approval_note is distinct from OLD.approval_note then
    raise exception '%: approval_status chỉ đổi qua RPC duyệt', TG_TABLE_NAME
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

comment on function public.guard_budget_fact_approval() is '0014: dùng chung cho budget_commitments/budget_actuals — INSERT ép pending, UPDATE cấm đổi 4 cột approval_* ngoài RPC duyệt.';

drop trigger if exists budget_commitments_guard_approval on public.budget_commitments;
create trigger budget_commitments_guard_approval
  before insert or update on public.budget_commitments
  for each row execute function public.guard_budget_fact_approval();

drop trigger if exists budget_actuals_guard_approval on public.budget_actuals;
create trigger budget_actuals_guard_approval
  before insert or update on public.budget_actuals
  for each row execute function public.guard_budget_fact_approval();

-- ----------------------------------------------------------------------------
-- 5) budget_remaining (bản 0010) + lọc approval_status='approved'.
-- Giữ nguyên signature, kiểu trả và mọi logic còn lại của 0010; chỉ thêm:
--   * actuals: chỉ actual ĐÃ DUYỆT mới trừ;
--   * commitments: chỉ commitment ĐÃ DUYỆT mới giữ ngân sách, và "paid" của
--     nó chỉ tính từ actual ĐÃ DUYỆT liên kết.
-- Cột mới default 'approved' nên dữ liệu cũ cho kết quả như trước.
-- ----------------------------------------------------------------------------
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
  from public.budget_lines bl where bl.id = p_budget_line_id;
  if v_approved is null then return null; end if;

  select coalesce(sum(ba.amount), 0) into v_actual
  from public.budget_actuals ba
  where ba.budget_line_id = p_budget_line_id
    and ba.approval_status = 'approved';

  select coalesce(sum(greatest(bc.amount - coalesce(paid.total, 0), 0)), 0) into v_open
  from public.budget_commitments bc
  left join (
    select commitment_id, sum(amount) as total
    from public.budget_actuals
    where commitment_id is not null
      and approval_status = 'approved'
    group by commitment_id
  ) paid on paid.commitment_id = bc.id
  where bc.budget_line_id = p_budget_line_id
    and bc.approval_status = 'approved'
    and bc.status in ('planned', 'committed', 'partially_actualised');

  return v_approved - v_actual - v_open;
end;
$$;
comment on function public.budget_remaining(uuid) is '0014 (gốc 0010/R3-06): approved − Σactuals ĐÃ DUYỆT − Σ cam kết ĐÃ DUYỆT còn mở max(0, amount − Σactuals ĐÃ DUYỆT liên kết commitment). KHÔNG dùng settled_amount. Khớp js/domain.js budgetRemaining + lọc approval_status.';

-- ----------------------------------------------------------------------------
-- 4a) RPC decide_budget_proposal — CHỈ Owner (Zac) quyết định đề xuất.
-- Owner ĐƯỢC duyệt đề xuất của chính mình (không áp SELF_APPROVAL ở đây).
-- ----------------------------------------------------------------------------
create or replace function public.decide_budget_proposal(
  p_proposal_id uuid,
  p_revision integer,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.budget_proposals%rowtype;
  v_role     text;
begin
  perform set_config('app.via_rpc', 'on', true);

  if auth.uid() is null then
    raise exception 'decide_budget_proposal: cần đăng nhập' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decide_budget_proposal: decision không hợp lệ: %', p_decision using errcode = '22023';
  end if;

  select * into v_proposal from public.budget_proposals
   where id = p_proposal_id for update;
  if not found then
    raise exception 'decide_budget_proposal: không tìm thấy proposal %', p_proposal_id using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'ALREADY_DECIDED: proposal đã ở trạng thái %', v_proposal.status using errcode = 'P0001';
  end if;
  if v_proposal.revision is distinct from p_revision then
    raise exception 'STALE_REVISION: revision đề xuất hiện tại là %, người duyệt đang xem %', v_proposal.revision, p_revision
      using errcode = '42501';
  end if;

  v_role := public.current_role(v_proposal.workspace_id);
  if v_role is distinct from 'owner' then
    raise exception 'FORBIDDEN_ROLE: chỉ owner mới được quyết định đề xuất ngân sách (vai hiện tại: %)', coalesce(v_role, 'không phải thành viên')
      using errcode = '42501';
  end if;

  if p_decision = 'approved' then
    if v_proposal.target_type = 'budget_line' then
      update public.budget_lines
         set approved_amount = v_proposal.proposed_amount,
             approved_by = auth.uid(),
             approved_at = now(),
             approved_via_proposal_id = v_proposal.id,
             updated_at = now()
       where id = v_proposal.budget_line_id;
      if not found then
        raise exception 'decide_budget_proposal: không tìm thấy budget_line %', v_proposal.budget_line_id using errcode = 'P0002';
      end if;
    else -- campaign_ceiling: ghi HẠN MỨC + currency + dấu duyệt hạn mức
      update public.campaigns
         set budget_ceiling_amount = v_proposal.proposed_amount,
             budget_ceiling_currency = v_proposal.currency,
             approved_by = auth.uid(),
             approved_at = now(),
             approved_via_proposal_id = v_proposal.id,
             updated_at = now()
       where id = v_proposal.campaign_id;
      if not found then
        raise exception 'decide_budget_proposal: không tìm thấy campaign %', v_proposal.campaign_id using errcode = 'P0002';
      end if;
    end if;
  end if;

  update public.budget_proposals
     set status = p_decision,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = p_note,
         updated_at = now()
   where id = v_proposal.id
  returning * into v_proposal;

  return to_jsonb(v_proposal);
end;
$$;

comment on function public.decide_budget_proposal(uuid, integer, text, text) is '0014: Owner quyết định budget_proposals (approved -> ghi approved_amount của dòng / budget_ceiling của campaign + dấu duyệt; rejected -> chỉ chốt proposal). Khóa revision chống STALE_REVISION. Trả jsonb proposal.';

revoke all on function public.decide_budget_proposal(uuid, integer, text, text) from public, anon;
grant execute on function public.decide_budget_proposal(uuid, integer, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4b) RPC decide_commitment_approval — lead/owner duyệt cam kết.
-- Công thức UsageTotal (dùng chung với 4c, theo domain budgetRemaining,
-- chỉ tính fact có currency = currency của dòng L):
--   Σ amount actuals ĐÃ DUYỆT thuộc L
--   + Σ trên commitments c thuộc L (approval_status='approved',
--       archived_at is null, coalesce(status,'') <> 'cancelled')
--       max(0, c.amount − Σ amount actuals ĐÃ DUYỆT có commitment_id = c.id)
-- UsageAfter = UsageTotal với CHÍNH cam kết này được tính như đã duyệt.
-- ----------------------------------------------------------------------------
create or replace function public.decide_commitment_approval(
  p_commitment_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commitment public.budget_commitments%rowtype;
  v_line       public.budget_lines%rowtype;
  v_role       text;
  v_usage_after numeric;
begin
  perform set_config('app.via_rpc', 'on', true);

  if auth.uid() is null then
    raise exception 'decide_commitment_approval: cần đăng nhập' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decide_commitment_approval: decision không hợp lệ: %', p_decision using errcode = '22023';
  end if;

  select * into v_commitment from public.budget_commitments
   where id = p_commitment_id for update;
  if not found then
    raise exception 'decide_commitment_approval: không tìm thấy commitment %', p_commitment_id using errcode = 'P0002';
  end if;

  select * into v_line from public.budget_lines
   where id = v_commitment.budget_line_id for update;
  if not found then
    raise exception 'decide_commitment_approval: không tìm thấy budget_line %', v_commitment.budget_line_id using errcode = 'P0002';
  end if;

  v_role := public.current_role(v_commitment.workspace_id);
  if v_role is null or v_role not in ('lead', 'owner') then
    raise exception 'FORBIDDEN_ROLE: chỉ lead/owner mới được duyệt cam kết (vai hiện tại: %)', coalesce(v_role, 'không phải thành viên')
      using errcode = '42501';
  end if;
  if v_commitment.approval_status <> 'pending' then
    raise exception 'ALREADY_DECIDED: commitment đã ở trạng thái duyệt %', v_commitment.approval_status using errcode = 'P0001';
  end if;
  if v_commitment.created_by is not null and v_commitment.created_by = auth.uid() and v_role <> 'owner' then
    raise exception 'SELF_APPROVAL: người tạo cam kết không được tự quyết định (trừ owner)' using errcode = '42501';
  end if;

  if p_decision = 'approved' then
    if v_line.approved_by is null then
      raise exception 'BUDGET_NOT_APPROVED: dòng ngân sách chưa có dấu duyệt (approved_by null) — cần đề xuất được Owner duyệt trước'
        using errcode = '42501';
    end if;
    if v_commitment.currency is distinct from v_line.currency then
      raise exception 'CURRENCY_MISMATCH: currency cam kết (%) khác currency của dòng (%)', v_commitment.currency, v_line.currency
        using errcode = '22023';
    end if;

    -- UsageAfter: cam kết này tính như đã duyệt (id = p_commitment_id trong
    -- tập commitments; tập actuals giữ nguyên ĐÃ DUYỆT).
    select
      coalesce((select sum(ba.amount) from public.budget_actuals ba
                 where ba.budget_line_id = v_line.id
                   and ba.currency = v_line.currency
                   and ba.approval_status = 'approved'), 0)
      + coalesce((select sum(greatest(bc.amount - coalesce(
                    (select sum(ba2.amount) from public.budget_actuals ba2
                      where ba2.commitment_id = bc.id
                        and ba2.currency = v_line.currency
                        and ba2.approval_status = 'approved'), 0), 0))
                  from public.budget_commitments bc
                  where bc.budget_line_id = v_line.id
                    and bc.currency = v_line.currency
                    and bc.archived_at is null
                    and coalesce(bc.status, '') <> 'cancelled'
                    and (bc.approval_status = 'approved' or bc.id = p_commitment_id)), 0)
      into v_usage_after;

    if v_usage_after > v_line.approved_amount then
      raise exception 'BUDGET_LIMIT_EXCEEDED: tổng sử dụng sau duyệt (%) vượt số đã duyệt của dòng (%)', v_usage_after, v_line.approved_amount
        using errcode = '42501';
    end if;
  end if;

  -- approved_by/approved_at ở đây = NGƯỜI/THỜI ĐIỂM QUYẾT ĐỊNH (dùng cho cả
  -- quyết định 'rejected', kèm approval_note).
  update public.budget_commitments
     set approval_status = p_decision,
         approved_by = auth.uid(),
         approved_at = now(),
         approval_note = p_note,
         updated_at = now()
   where id = p_commitment_id
  returning * into v_commitment;

  return to_jsonb(v_commitment);
end;
$$;

comment on function public.decide_commitment_approval(uuid, text, text) is '0014: lead/owner duyệt/từ chối cam kết chờ duyệt; chặn tự duyệt (trừ owner), dòng chưa duyệt, lệch currency và vượt approved_amount theo UsageTotal. Trả jsonb commitment. approved_by/at = người/thời điểm quyết định kể cả khi rejected.';

revoke all on function public.decide_commitment_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_commitment_approval(uuid, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4c) RPC decide_payment_approval — lead/owner duyệt khoản chi (actual).
-- Y hệt 4b với actual: UsageAfter = UsageTotal với actual này tính như đã
-- duyệt — actual liên kết commitment đồng thời làm GIẢM nghĩa vụ mở của
-- commitment đó trong công thức (paid tăng -> max(0, amount − paid) giảm).
-- ----------------------------------------------------------------------------
create or replace function public.decide_payment_approval(
  p_actual_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual      public.budget_actuals%rowtype;
  v_line        public.budget_lines%rowtype;
  v_role        text;
  v_usage_after numeric;
begin
  perform set_config('app.via_rpc', 'on', true);

  if auth.uid() is null then
    raise exception 'decide_payment_approval: cần đăng nhập' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decide_payment_approval: decision không hợp lệ: %', p_decision using errcode = '22023';
  end if;

  select * into v_actual from public.budget_actuals
   where id = p_actual_id for update;
  if not found then
    raise exception 'decide_payment_approval: không tìm thấy actual %', p_actual_id using errcode = 'P0002';
  end if;

  select * into v_line from public.budget_lines
   where id = v_actual.budget_line_id for update;
  if not found then
    raise exception 'decide_payment_approval: không tìm thấy budget_line %', v_actual.budget_line_id using errcode = 'P0002';
  end if;

  v_role := public.current_role(v_actual.workspace_id);
  if v_role is null or v_role not in ('lead', 'owner') then
    raise exception 'FORBIDDEN_ROLE: chỉ lead/owner mới được duyệt khoản chi (vai hiện tại: %)', coalesce(v_role, 'không phải thành viên')
      using errcode = '42501';
  end if;
  if v_actual.approval_status <> 'pending' then
    raise exception 'ALREADY_DECIDED: actual đã ở trạng thái duyệt %', v_actual.approval_status using errcode = 'P0001';
  end if;
  if v_actual.created_by is not null and v_actual.created_by = auth.uid() and v_role <> 'owner' then
    raise exception 'SELF_APPROVAL: người tạo khoản chi không được tự quyết định (trừ owner)' using errcode = '42501';
  end if;

  if p_decision = 'approved' then
    if v_line.approved_by is null then
      raise exception 'BUDGET_NOT_APPROVED: dòng ngân sách chưa có dấu duyệt (approved_by null) — cần đề xuất được Owner duyệt trước'
        using errcode = '42501';
    end if;
    if v_actual.currency is distinct from v_line.currency then
      raise exception 'CURRENCY_MISMATCH: currency khoản chi (%) khác currency của dòng (%)', v_actual.currency, v_line.currency
        using errcode = '22023';
    end if;

    -- UsageAfter: actual này tính như đã duyệt (id = p_actual_id trong cả
    -- tổng actuals lẫn phần "paid" trừ vào nghĩa vụ của commitment liên kết).
    select
      coalesce((select sum(ba.amount) from public.budget_actuals ba
                 where ba.budget_line_id = v_line.id
                   and ba.currency = v_line.currency
                   and (ba.approval_status = 'approved' or ba.id = p_actual_id)), 0)
      + coalesce((select sum(greatest(bc.amount - coalesce(
                    (select sum(ba2.amount) from public.budget_actuals ba2
                      where ba2.commitment_id = bc.id
                        and ba2.currency = v_line.currency
                        and (ba2.approval_status = 'approved' or ba2.id = p_actual_id)), 0), 0))
                  from public.budget_commitments bc
                  where bc.budget_line_id = v_line.id
                    and bc.currency = v_line.currency
                    and bc.archived_at is null
                    and coalesce(bc.status, '') <> 'cancelled'
                    and bc.approval_status = 'approved'), 0)
      into v_usage_after;

    if v_usage_after > v_line.approved_amount then
      raise exception 'BUDGET_LIMIT_EXCEEDED: tổng sử dụng sau duyệt (%) vượt số đã duyệt của dòng (%)', v_usage_after, v_line.approved_amount
        using errcode = '42501';
    end if;
  end if;

  -- approved_by/approved_at ở đây = NGƯỜI/THỜI ĐIỂM QUYẾT ĐỊNH (dùng cho cả
  -- quyết định 'rejected', kèm approval_note).
  update public.budget_actuals
     set approval_status = p_decision,
         approved_by = auth.uid(),
         approved_at = now(),
         approval_note = p_note,
         updated_at = now()
   where id = p_actual_id
  returning * into v_actual;

  return to_jsonb(v_actual);
end;
$$;

comment on function public.decide_payment_approval(uuid, text, text) is '0014: lead/owner duyệt/từ chối khoản chi chờ duyệt; chặn tự duyệt (trừ owner), dòng chưa duyệt, lệch currency và vượt approved_amount theo UsageTotal (actual liên kết commitment làm giảm nghĩa vụ mở của commitment). Trả jsonb actual. approved_by/at = người/thời điểm quyết định kể cả khi rejected.';

revoke all on function public.decide_payment_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_payment_approval(uuid, text, text) to authenticated, service_role;
