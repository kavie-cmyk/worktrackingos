-- ============================================================================
-- SAVA Marketing Workspace — 0010_functions_r31.sql (vòng R3.1)
--   b. budget_remaining viết lại theo JS domain (R3-06)
--   l. trigger chặn over-allocation ở backend (AC08)
--   m. trigger toàn vẹn scope chéo workspace/campaign (AC04)
--   i. RPC hẹp cho member_capacity
-- IDEMPOTENT: create or replace / drop trigger if exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- b. budget_remaining — CÔNG THỨC CHỐT R3.1 (khớp js/domain.js budgetRemaining):
--   remaining = approved_amount
--             − Σ budget_actuals.amount của dòng
--             − Σ trên commitments CÒN MỞ (planned/committed/partially_actualised)
--                 max(0, commitment.amount − paid)
--               trong đó paid = Σ budget_actuals.amount WHERE commitment_id = commitment.id
--   settled_amount KHÔNG còn được dùng (có thể stale — R2-01/R2-02).
--   Ví dụ AC12: approved=1000, commitment=1000, actual(commitment)=400
--     -> actuals=400, open=max(0,1000-400)=600, remaining=1000-400-600=0.
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
  from public.budget_actuals ba where ba.budget_line_id = p_budget_line_id;

  select coalesce(sum(greatest(bc.amount - coalesce(paid.total, 0), 0)), 0) into v_open
  from public.budget_commitments bc
  left join (
    select commitment_id, sum(amount) as total
    from public.budget_actuals
    where commitment_id is not null
    group by commitment_id
  ) paid on paid.commitment_id = bc.id
  where bc.budget_line_id = p_budget_line_id
    and bc.status in ('planned', 'committed', 'partially_actualised');

  return v_approved - v_actual - v_open;
end;
$$;
comment on function public.budget_remaining(uuid) is 'R3.1/R3-06: approved − Σactuals − Σ cam kết còn mở max(0, amount − Σactuals liên kết commitment). KHÔNG dùng settled_amount. Khớp js/domain.js budgetRemaining.';

-- ----------------------------------------------------------------------------
-- m. Toàn vẹn scope chéo — helper + triggers
-- ----------------------------------------------------------------------------
create or replace function public.assert_same_workspace(p_ws uuid, p_other_ws uuid, p_what text)
returns void language plpgsql as $$
begin
  if p_other_ws is not null and p_other_ws is distinct from p_ws then
    raise exception 'R31_SCOPE: % thuộc workspace khác (%)', p_what, p_other_ws using errcode = '23514';
  end if;
end;
$$;

-- activities: campaign (và phase) phải cùng workspace; AC04 ở tầng gốc
create or replace function public.trg_activities_scope() returns trigger language plpgsql as $$
declare v_ws uuid; v_camp uuid;
begin
  if NEW.campaign_id is not null then
    select workspace_id into v_ws from public.campaigns where id = NEW.campaign_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'campaign');
  end if;
  if NEW.phase_id is not null then
    select workspace_id, campaign_id into v_ws, v_camp from public.phases where id = NEW.phase_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'phase');
    if v_camp is not null and NEW.campaign_id is not null and v_camp is distinct from NEW.campaign_id then
      raise exception 'R31_SCOPE: phase thuộc campaign khác với activity.campaign_id' using errcode='23514';
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists activities_scope_check on public.activities;
create trigger activities_scope_check before insert or update on public.activities
  for each row execute function public.trg_activities_scope();

-- dùng chung cho budget_lines / kpis / tasks: kiểm activity/task/campaign khớp nhau
create or replace function public.trg_scoped_row_scope() returns trigger language plpgsql as $$
declare
  v_act_ws uuid; v_act_camp uuid; v_task_ws uuid; v_task_camp uuid; v_task_act uuid; v_camp_ws uuid;
  v_activity_id uuid := nullif(to_jsonb(NEW)->>'activity_id','')::uuid;
  v_task_id uuid := nullif(to_jsonb(NEW)->>'task_id','')::uuid;
begin
  if NEW.campaign_id is not null then
    select workspace_id into v_camp_ws from public.campaigns where id = NEW.campaign_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_camp_ws, 'campaign');
  end if;
  if v_activity_id is not null then
    select workspace_id, campaign_id into v_act_ws, v_act_camp from public.activities where id = v_activity_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_act_ws, 'activity');
    if NEW.campaign_id is not null and v_act_camp is not null and NEW.campaign_id is distinct from v_act_camp then
      raise exception 'R31_SCOPE: campaign_id % không khớp campaign của activity % (%)', NEW.campaign_id, v_activity_id, v_act_camp using errcode='23514';
    end if;
  end if;
  if v_task_id is not null then
    select workspace_id, campaign_id, activity_id into v_task_ws, v_task_camp, v_task_act
    from public.tasks where id = v_task_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_task_ws, 'task');
    if NEW.campaign_id is not null and v_task_camp is not null and NEW.campaign_id is distinct from v_task_camp then
      raise exception 'R31_SCOPE: campaign_id không khớp campaign của task' using errcode='23514';
    end if;
    if v_activity_id is not null and v_task_act is not null and v_activity_id is distinct from v_task_act then
      raise exception 'R31_SCOPE: activity_id không khớp activity của task' using errcode='23514';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists budget_lines_scope_check on public.budget_lines;
create trigger budget_lines_scope_check before insert or update on public.budget_lines
  for each row execute function public.trg_scoped_row_scope();
drop trigger if exists kpis_scope_check on public.kpis;
create trigger kpis_scope_check before insert or update on public.kpis
  for each row execute function public.trg_scoped_row_scope();
drop trigger if exists tasks_scope_check on public.tasks;
create trigger tasks_scope_check before insert or update on public.tasks
  for each row execute function public.trg_scoped_row_scope();

-- content_items: pillar/campaign/source phải cùng workspace (campaign/activity tùy chọn — R3.1)
create or replace function public.trg_content_items_scope() returns trigger language plpgsql as $$
declare v_ws uuid; v_camp uuid;
begin
  if NEW.pillar_id is not null then
    select workspace_id into v_ws from public.content_pillars where id = NEW.pillar_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'pillar');
  end if;
  if NEW.campaign_id is not null then
    select workspace_id into v_ws from public.campaigns where id = NEW.campaign_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'campaign');
  end if;
  if NEW.activity_id is not null then
    select workspace_id, campaign_id into v_ws, v_camp from public.activities where id = NEW.activity_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'activity');
    if NEW.campaign_id is not null and v_camp is not null and NEW.campaign_id is distinct from v_camp then
      raise exception 'R31_SCOPE: campaign của content không khớp campaign của activity liên kết' using errcode='23514';
    end if;
  end if;
  if NEW.source_content_id is not null then
    select workspace_id into v_ws from public.content_items where id = NEW.source_content_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'source_content');
  end if;
  return NEW;
end;
$$;
drop trigger if exists content_items_scope_check on public.content_items;
create trigger content_items_scope_check before insert or update on public.content_items
  for each row execute function public.trg_content_items_scope();

-- ----------------------------------------------------------------------------
-- l. budget_allocations: tổng allocation của 1 nguồn KHÔNG vượt amount nguồn
-- ----------------------------------------------------------------------------
create or replace function public.trg_budget_allocations_cap() returns trigger language plpgsql as $$
declare v_source_amount numeric; v_allocated numeric; v_ws uuid; v_camp uuid;
begin
  -- scope: campaign/activity cùng workspace
  select workspace_id into v_ws from public.campaigns where id = NEW.campaign_id;
  perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'campaign');
  if NEW.activity_id is not null then
    select workspace_id, campaign_id into v_ws, v_camp from public.activities where id = NEW.activity_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'activity');
    if v_camp is not null and NEW.campaign_id is distinct from v_camp then
      raise exception 'R31_SCOPE: allocation campaign không khớp campaign của activity' using errcode='23514';
    end if;
  end if;

  if NEW.source_kind = 'actual' then
    select amount into v_source_amount from public.budget_actuals where id = NEW.actual_id for update;
  else
    select amount into v_source_amount from public.budget_commitments where id = NEW.commitment_id for update;
  end if;
  if v_source_amount is null then
    raise exception 'R31_ALLOC: không tìm thấy nguồn phân bổ' using errcode='23503';
  end if;
  select coalesce(sum(amount), 0) into v_allocated
  from public.budget_allocations
  where (NEW.source_kind = 'actual' and actual_id = NEW.actual_id)
     or (NEW.source_kind = 'commitment' and commitment_id = NEW.commitment_id);
  -- khi UPDATE, v_allocated đã gồm bản ghi cũ của chính dòng này
  if TG_OP = 'UPDATE' then v_allocated := v_allocated - OLD.amount; end if;
  if v_allocated + NEW.amount > v_source_amount then
    raise exception 'R31_ALLOC: tổng phân bổ (%) vượt amount của nguồn (%)', v_allocated + NEW.amount, v_source_amount using errcode='23514';
  end if;
  return NEW;
end;
$$;
drop trigger if exists budget_allocations_cap_check on public.budget_allocations;
create trigger budget_allocations_cap_check before insert or update on public.budget_allocations
  for each row execute function public.trg_budget_allocations_cap();

-- cash_transactions: account/category/campaign/activity cùng workspace
create or replace function public.trg_cash_tx_scope() returns trigger language plpgsql as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.cash_accounts where id = NEW.account_id;
  perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'cash_account');
  if NEW.category_id is not null then
    select workspace_id into v_ws from public.cash_categories where id = NEW.category_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'cash_category');
  end if;
  if NEW.campaign_id is not null then
    select workspace_id into v_ws from public.campaigns where id = NEW.campaign_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'campaign');
  end if;
  if NEW.activity_id is not null then
    select workspace_id into v_ws from public.activities where id = NEW.activity_id;
    perform public.assert_same_workspace(NEW.workspace_id, v_ws, 'activity');
  end if;
  return NEW;
end;
$$;
drop trigger if exists cash_transactions_scope_check on public.cash_transactions;
create trigger cash_transactions_scope_check before insert or update on public.cash_transactions
  for each row execute function public.trg_cash_tx_scope();

-- ----------------------------------------------------------------------------
-- i. RPC hẹp member_capacity (SECURITY DEFINER + kiểm membership/role)
-- ----------------------------------------------------------------------------
create or replace function public.upsert_member_capacity(
  p_workspace_id uuid, p_user_id uuid, p_hours_per_week numeric,
  p_days_off jsonb default '[]'::jsonb, p_effective_from date default null, p_effective_to date default null
) returns public.member_capacity
language plpgsql security definer set search_path = public
as $$
declare v_role text; v_row public.member_capacity;
begin
  select role into v_role from public.memberships
  where user_id = auth.uid() and workspace_id = p_workspace_id and is_active;
  if v_role is null then raise exception 'R31_PERM: không phải thành viên workspace' using errcode='42501'; end if;
  if p_user_id is distinct from auth.uid() and v_role not in ('owner','lead') then
    raise exception 'R31_PERM: chỉ owner/lead được đặt capacity cho người khác' using errcode='42501';
  end if;
  if not exists (select 1 from public.memberships where user_id = p_user_id and workspace_id = p_workspace_id and is_active) then
    raise exception 'R31_PERM: user đích không phải thành viên active của workspace' using errcode='23503';
  end if;
  insert into public.member_capacity (workspace_id, user_id, hours_per_week, days_off, effective_from, effective_to, created_by)
  values (p_workspace_id, p_user_id, p_hours_per_week, coalesce(p_days_off,'[]'::jsonb), p_effective_from, p_effective_to, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.get_member_capacity(p_workspace_id uuid, p_user_id uuid default null)
returns setof public.member_capacity
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'R31_PERM: không phải thành viên workspace' using errcode='42501';
  end if;
  return query select * from public.member_capacity mc
  where mc.workspace_id = p_workspace_id and (p_user_id is null or mc.user_id = p_user_id)
  order by mc.effective_from desc nulls last, mc.created_at desc;
end;
$$;

revoke all on function public.upsert_member_capacity(uuid, uuid, numeric, jsonb, date, date) from public;
revoke all on function public.get_member_capacity(uuid, uuid) from public;
grant execute on function public.upsert_member_capacity(uuid, uuid, numeric, jsonb, date, date) to authenticated, service_role;
grant execute on function public.get_member_capacity(uuid, uuid) to authenticated, service_role;
