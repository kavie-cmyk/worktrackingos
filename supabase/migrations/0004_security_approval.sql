-- ============================================================================
-- SAVA Marketing Workspace — 0004_security_approval.sql (vòng sửa QA R1)
--   R34: khóa EXECUTE của bootstrap_owner về service_role (idempotent).
--   R33/R27: bảo vệ cột duyệt nhạy cảm của content_variants ở backend:
--     * cột current_revision_id mới + backfill từ revision mới nhất;
--     * trigger chặn authenticated/anon sửa trực tiếp approval_status,
--       approved_revision_id, publishing_status (sang scheduled/publishing/
--       published) và editorial_status (sang in_review/final) ngoài RPC;
--     * đổi current_revision_id khi đang 'approved' -> tự hạ 'pending' +
--       xóa approved_revision_id (invalidate duyệt);
--     * RPC submit_for_review / decide_approval (SECURITY DEFINER) là đường
--       DUY NHẤT đổi trạng thái duyệt; quyết định gắn đúng current revision.
--   R27: content_revisions bất biến — chặn UPDATE với mọi role trừ postgres,
--        DELETE chỉ service_role/postgres.
--   Mở rộng CHECK: approval_status + 'changes_requested'; editorial_status +
--   'in_review'; approval_steps.status + 'changes_requested'.
-- Mọi câu lệnh đều idempotent (chạy lại không lỗi).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- R34 — bootstrap_owner: chỉ service_role (và owner postgres) được EXECUTE.
-- Live đã vá tay ngày 11/11/2026 (proacl = {postgres, service_role});
-- migration này chốt lại trạng thái đó trong repo.
-- ----------------------------------------------------------------------------

revoke execute on function public.bootstrap_owner(text) from public, anon, authenticated;
grant execute on function public.bootstrap_owner(text) to service_role;

-- ----------------------------------------------------------------------------
-- Mở rộng CHECK constraints (drop + add lại để idempotent)
-- ----------------------------------------------------------------------------

alter table public.content_variants drop constraint if exists content_variants_approval_status_check;
alter table public.content_variants add constraint content_variants_approval_status_check
  check (approval_status in ('draft', 'pending', 'approved', 'rejected', 'needs_review', 'changes_requested'));

alter table public.content_variants drop constraint if exists content_variants_editorial_status_check;
alter table public.content_variants add constraint content_variants_editorial_status_check
  check (editorial_status in ('draft', 'editing', 'ready_for_review', 'in_review', 'changes_requested', 'final'));

alter table public.approval_steps drop constraint if exists approval_steps_status_check;
alter table public.approval_steps add constraint approval_steps_status_check
  check (status in ('pending', 'approved', 'rejected', 'skipped', 'cancelled', 'changes_requested'));

-- ----------------------------------------------------------------------------
-- current_revision_id: revision hiện hành của variant (nguồn sự thật cho
-- quyết định duyệt). Backfill = revision có revision_no lớn nhất.
-- ----------------------------------------------------------------------------

alter table public.content_variants
  add column if not exists current_revision_id uuid references public.content_revisions (id) on delete set null;

update public.content_variants v
   set current_revision_id = (
         select r.id from public.content_revisions r
          where r.variant_id = v.id
          order by r.revision_no desc
          limit 1
       )
 where v.current_revision_id is null
   and exists (select 1 from public.content_revisions r where r.variant_id = v.id);

create index if not exists content_variants_current_revision_idx
  on public.content_variants (current_revision_id);

comment on column public.content_variants.current_revision_id is
  'Revision hiện hành của variant. decide_approval chỉ chấp nhận revision này; store PHẢI cập nhật cột này mỗi khi tạo revision mới (đổi nó khi đang approved sẽ tự invalidate duyệt — xem trigger guard ở 0004).';

-- ----------------------------------------------------------------------------
-- Trigger bảo vệ cột nhạy cảm trên content_variants.
-- Nguyên tắc:
--   * Bỏ qua khi current_user không phải authenticated/anon (service_role của
--     worker, postgres của RPC SECURITY DEFINER / SQL admin) hoặc khi cờ
--     phiên app.via_rpc='on' (RPC tự đặt bằng set_config(..., true)).
--   * INSERT trực tiếp: không được sinh variant đã duyệt/đã lên lịch sẵn.
--   * UPDATE trực tiếp: cấm đổi approval_status / approved_revision_id;
--     cấm publishing_status -> scheduled/publishing/published; cấm
--     editorial_status -> in_review/final. Các chuyển đổi còn lại
--     (vd publishing_status -> published_external cho luồng đăng ngoài app,
--     editorial_status -> ready_for_review) vẫn đi đường thường.
--   * Nếu current_revision_id đổi trong lúc approval_status='approved'
--     (nội dung mới thay bản đã duyệt): tự hạ approval_status='pending' +
--     approved_revision_id=null TRONG CÙNG câu lệnh — quyết định duyệt cũ
--     không áp cho revision mới.
-- Tên trigger bắt đầu bằng 'content_variants_guard' để chạy TRƯỚC trigger
-- 'content_variants_invalidate_approval' của 0003 (thứ tự alphabet).
-- ----------------------------------------------------------------------------

create or replace function public.guard_content_variant_sensitive()
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
    if NEW.approval_status is distinct from 'draft'
       or NEW.approved_revision_id is not null
       or NEW.publishing_status is distinct from 'not_scheduled' then
      raise exception 'content_variants: không được tạo variant ở trạng thái đã duyệt/đã lên lịch — hãy tạo ở draft rồi dùng RPC submit_for_review'
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  -- UPDATE: người dùng tự ghi các cột nhạy cảm -> chặn trước mọi xử lý khác.
  if NEW.approval_status is distinct from OLD.approval_status then
    raise exception 'content_variants: approval_status chỉ đổi qua RPC decide_approval'
      using errcode = '42501';
  end if;
  if NEW.approved_revision_id is distinct from OLD.approved_revision_id then
    raise exception 'content_variants: approved_revision_id chỉ đổi qua RPC decide_approval'
      using errcode = '42501';
  end if;
  if NEW.publishing_status is distinct from OLD.publishing_status
     and NEW.publishing_status in ('scheduled', 'publishing', 'published') then
    raise exception 'content_variants: publishing_status sang % chỉ qua luồng publish (publish_jobs/worker)', NEW.publishing_status
      using errcode = '42501';
  end if;
  if NEW.editorial_status is distinct from OLD.editorial_status
     and NEW.editorial_status in ('in_review', 'final') then
    raise exception 'content_variants: editorial_status sang % chỉ qua RPC submit_for_review/decide_approval', NEW.editorial_status
      using errcode = '42501';
  end if;

  -- Revision hiện hành đổi khi đang approved -> duyệt cũ mất hiệu lực.
  if NEW.current_revision_id is distinct from OLD.current_revision_id
     and OLD.approval_status = 'approved' then
    NEW.approval_status := 'pending';
    NEW.approved_revision_id := null;
    if NEW.publishing_status = 'scheduled' then
      NEW.publishing_status := 'not_scheduled';
    end if;
  end if;

  return NEW;
end;
$$;

comment on function public.guard_content_variant_sensitive() is 'R33: chặn authenticated/anon đổi trực tiếp cột duyệt/đăng của content_variants ngoài RPC; đổi current_revision_id khi approved thì tự invalidate về pending.';

drop trigger if exists content_variants_guard_sensitive_columns on public.content_variants;
create trigger content_variants_guard_sensitive_columns
  before insert or update on public.content_variants
  for each row execute function public.guard_content_variant_sensitive();

-- ----------------------------------------------------------------------------
-- R27 — content_revisions bất biến:
--   UPDATE: cấm với mọi role trừ postgres (kể cả service_role).
--   DELETE: chỉ service_role / postgres (dọn dẹp có kiểm soát); authenticated
--           và anon bị chặn (RLS vốn đã không cấp DELETE, đây là chốt tầng 2).
-- ----------------------------------------------------------------------------

create or replace function public.guard_content_revision_immutable()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if current_user <> 'postgres' then
      raise exception 'content_revisions: revision bất biến — không được sửa nội dung đã chốt, hãy tạo revision mới'
        using errcode = '42501';
    end if;
    return NEW;
  end if;
  -- DELETE
  if current_user not in ('service_role', 'postgres') then
    raise exception 'content_revisions: chỉ service_role được xóa revision (dọn dẹp có kiểm soát)'
      using errcode = '42501';
  end if;
  return OLD;
end;
$$;

comment on function public.guard_content_revision_immutable() is 'R27: content_revisions bất biến — UPDATE chỉ postgres, DELETE chỉ service_role/postgres.';

drop trigger if exists content_revisions_immutable on public.content_revisions;
create trigger content_revisions_immutable
  before update or delete on public.content_revisions
  for each row execute function public.guard_content_revision_immutable();

-- ----------------------------------------------------------------------------
-- Chốt đường ghi quyết định duyệt: bỏ policy INSERT trực tiếp vào
-- approval_decisions và UPDATE/DELETE trực tiếp approval_steps cho
-- authenticated. Từ nay quyết định + trạng thái bước CHỈ qua 2 RPC dưới đây
-- (SECURITY DEFINER, bypass RLS sau khi tự kiểm quyền trong thân hàm).
-- Policy INSERT/SELECT của approval_steps giữ nguyên.
-- ----------------------------------------------------------------------------

drop policy if exists approval_decisions_insert on public.approval_decisions;
drop policy if exists approval_steps_update on public.approval_steps;
drop policy if exists approval_steps_delete on public.approval_steps;

-- ----------------------------------------------------------------------------
-- RPC submit_for_review(p_variant_id)
-- Người gọi: thành viên vận hành (owner/lead/member) của workspace chứa
-- variant. Đặt editorial_status='in_review', approval_status='pending' và
-- đảm bảo có 1 approval_step đang pending cho variant:
--   * đã có step pending -> dùng lại (idempotent);
--   * step pending đó có approver_id cụ thể -> giữ nguyên người duyệt;
--   * chưa có -> tạo step mới, approver_role='lead' (cấu hình mặc định 1 bước).
-- Trả jsonb của step.
-- ----------------------------------------------------------------------------

create or replace function public.submit_for_review(p_variant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_variant  public.content_variants%rowtype;
  v_role     text;
  v_step     public.approval_steps%rowtype;
begin
  if auth.uid() is null then
    raise exception 'submit_for_review: cần đăng nhập' using errcode = '42501';
  end if;

  select * into v_variant from public.content_variants where id = p_variant_id;
  if not found then
    raise exception 'submit_for_review: không tìm thấy variant %', p_variant_id using errcode = 'P0002';
  end if;

  v_role := public.current_role(v_variant.workspace_id);
  if v_role is null or v_role = 'ceo' then
    raise exception 'submit_for_review: người gọi không phải thành viên vận hành của workspace' using errcode = '42501';
  end if;

  if v_variant.current_revision_id is null then
    raise exception 'submit_for_review: variant chưa có revision hiện hành (current_revision_id) — hãy chốt nội dung thành revision trước khi gửi duyệt'
      using errcode = '23514';
  end if;

  perform set_config('app.via_rpc', 'on', true);

  update public.content_variants
     set editorial_status = 'in_review',
         approval_status  = 'pending',
         updated_at       = now()
   where id = p_variant_id;

  select * into v_step
    from public.approval_steps
   where variant_id = p_variant_id and status = 'pending'
   order by step_order asc, created_at asc
   limit 1;

  if not found then
    insert into public.approval_steps
      (workspace_id, content_item_id, variant_id, step_order, name, approver_role, status)
    values
      (v_variant.workspace_id, v_variant.content_item_id, p_variant_id, 1, 'Duyệt nội dung', 'lead', 'pending')
    returning * into v_step;
  end if;

  insert into public.audit_log (workspace_id, actor_id, actor_role, entity_type, entity_id, action, detail)
  values (v_variant.workspace_id, auth.uid(), v_role, 'content_variant', p_variant_id, 'status_change',
          jsonb_build_object('reason', 'submit_for_review', 'step_id', v_step.id,
                             'revision_id', v_variant.current_revision_id));

  return to_jsonb(v_step);
end;
$$;

comment on function public.submit_for_review(uuid) is 'Gửi variant đi duyệt: editorial_status=in_review, approval_status=pending, đảm bảo approval_step pending (mặc định 1 bước, approver_role=lead). Trả jsonb của step.';

revoke all on function public.submit_for_review(uuid) from public, anon;
grant execute on function public.submit_for_review(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC decide_approval(p_step_id, p_revision_id, p_decision, p_comment)
-- Người gọi phải là approver được giao: approver_id = auth.uid(), hoặc
-- (step chưa gán người cụ thể) approver_role khớp vai của người gọi trong
-- workspace VÀ vai đó thuộc (owner, lead).
-- p_revision_id BẮT BUỘC = current_revision_id của variant — quyết định cho
-- revision cũ / nội dung đã đổi bị từ chối với errcode 23514
-- (REVISION_MISMATCH) để UI báo "nội dung đã thay đổi, cần duyệt lại".
-- Toàn bộ: ghi approval_decisions + cập nhật step + cập nhật variant trong
-- CÙNG 1 transaction (hàm plpgsql chạy trong transaction của câu gọi).
--   approved          -> variant.approval_status='approved',
--                        approved_revision_id=p_revision_id, editorial='final'
--   changes_requested -> approval_status='changes_requested',
--                        editorial='changes_requested', KHÔNG set
--                        approved_revision_id
--   rejected          -> approval_status='rejected'
-- Trả jsonb của approval_decisions (gồm id — publish_jobs.decision_id trỏ
-- vào id này).
-- ----------------------------------------------------------------------------

create or replace function public.decide_approval(
  p_step_id uuid,
  p_revision_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step     public.approval_steps%rowtype;
  v_variant  public.content_variants%rowtype;
  v_role     text;
  v_decision public.approval_decisions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'decide_approval: cần đăng nhập' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'decide_approval: decision không hợp lệ: %', p_decision using errcode = '22023';
  end if;

  select * into v_step from public.approval_steps where id = p_step_id;
  if not found then
    raise exception 'decide_approval: không tìm thấy approval_step %', p_step_id using errcode = 'P0002';
  end if;
  if v_step.variant_id is null then
    raise exception 'decide_approval: step này không gắn variant — chưa hỗ trợ' using errcode = '0A000';
  end if;
  if v_step.status <> 'pending' then
    raise exception 'decide_approval: step đã ở trạng thái %, không quyết định lại được', v_step.status
      using errcode = '23514';
  end if;

  select * into v_variant from public.content_variants where id = v_step.variant_id;
  if not found then
    raise exception 'decide_approval: variant của step không còn tồn tại' using errcode = 'P0002';
  end if;

  v_role := public.current_role(v_variant.workspace_id);

  -- Kiểm approver được giao.
  if v_step.approver_id is not null then
    if v_step.approver_id <> auth.uid() then
      raise exception 'decide_approval: bước này được giao cho người duyệt khác' using errcode = '42501';
    end if;
  else
    if v_step.approver_role is null
       or v_role is distinct from v_step.approver_role
       or v_role not in ('owner', 'lead') then
      raise exception 'decide_approval: người gọi không phải approver theo vai được giao (%)', coalesce(v_step.approver_role, '—')
        using errcode = '42501';
    end if;
  end if;

  -- Quyết định phải gắn ĐÚNG revision hiện hành mà người duyệt đang xem.
  if p_revision_id is null or p_revision_id is distinct from v_variant.current_revision_id then
    raise exception 'REVISION_MISMATCH: revision % không phải revision hiện hành của variant (nội dung có thể đã thay đổi sau khi gửi duyệt)', p_revision_id
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.content_revisions r
                  where r.id = p_revision_id and r.variant_id = v_variant.id) then
    raise exception 'REVISION_MISMATCH: revision % không thuộc variant này', p_revision_id
      using errcode = '23514';
  end if;

  perform set_config('app.via_rpc', 'on', true);

  insert into public.approval_decisions
    (workspace_id, step_id, variant_id, revision_id, decision, decided_by, comment)
  values
    (v_variant.workspace_id, p_step_id, v_variant.id, p_revision_id, p_decision, auth.uid(), p_comment)
  returning * into v_decision;

  update public.approval_steps
     set status = p_decision, updated_at = now()
   where id = p_step_id;

  if p_decision = 'approved' then
    update public.content_variants
       set approval_status = 'approved',
           approved_revision_id = p_revision_id,
           editorial_status = 'final',
           updated_at = now()
     where id = v_variant.id;
  elsif p_decision = 'changes_requested' then
    update public.content_variants
       set approval_status = 'changes_requested',
           editorial_status = 'changes_requested',
           updated_at = now()
     where id = v_variant.id;
  else -- rejected
    update public.content_variants
       set approval_status = 'rejected',
           updated_at = now()
     where id = v_variant.id;
  end if;

  insert into public.audit_log (workspace_id, actor_id, actor_role, entity_type, entity_id, action, detail)
  values (v_variant.workspace_id, auth.uid(), v_role, 'content_variant', v_variant.id,
          case when p_decision = 'approved' then 'approve' when p_decision = 'rejected' then 'reject' else 'status_change' end,
          jsonb_build_object('step_id', p_step_id, 'decision_id', v_decision.id,
                             'revision_id', p_revision_id, 'decision', p_decision));

  return to_jsonb(v_decision);
end;
$$;

comment on function public.decide_approval(uuid, uuid, text, text) is 'Quyết định duyệt gắn đúng current_revision_id của variant; ghi decision + step + variant trong 1 transaction. Trả jsonb approval_decisions (id dùng cho publish_jobs.decision_id).';

revoke all on function public.decide_approval(uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, uuid, text, text) to authenticated, service_role;
