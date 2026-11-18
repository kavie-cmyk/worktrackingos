-- ============================================================================
-- SAVA Marketing Workspace — 0008_invalidation_order_fix.sql (đổi số từ 0007 ngày 11/11/2026 để nhường số 0007 cho migration metric_observations — file này CHƯA áp live) (vòng sửa QA R1)
-- QA live 11/11/2026 phát hiện: khi 1 câu UPDATE đổi ĐỒNG THỜI
-- current_revision_id và caption/media, trigger của 0003
-- (invalidate_approval_on_content_change) chạy SAU trigger guard của 0004
-- và ghi đè approval_status thành 'needs_review', trong khi semantic đã
-- chốt cho đường đổi revision là hạ về 'pending' (xem 0004).
-- Sửa dứt điểm:
--   1) invalidate_approval_on_content_change (CREATE OR REPLACE): BỎ QUA
--      khi current_revision_id cũng đổi trong cùng câu lệnh — trường hợp đó
--      thuộc guard của 0004.
--   2) guard_content_variant_sensitive (CREATE OR REPLACE): khi invalidate
--      theo đường đổi revision, đồng thời hủy publish_jobs đang 'queued'
--      của variant (giống hệ quả của trigger 0003) + ghi audit_log.
-- Idempotent.
-- ============================================================================

create or replace function public.invalidate_approval_on_content_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0007: đổi current_revision_id trong cùng câu lệnh -> guard của 0004 xử
  -- (hạ 'pending'); trigger này chỉ xử thay đổi nội dung thuần túy.
  if NEW.current_revision_id is distinct from OLD.current_revision_id then
    return NEW;
  end if;

  if OLD.approval_status = 'approved'
     and (
       NEW.caption is distinct from OLD.caption
       or NEW.media_asset_ids is distinct from OLD.media_asset_ids
       or NEW.channel_account_id is distinct from OLD.channel_account_id
       or NEW.visibility is distinct from OLD.visibility
     ) then

    NEW.approval_status := 'needs_review';
    NEW.approved_revision_id := null;

    if NEW.publishing_status = 'scheduled' then
      NEW.publishing_status := 'not_scheduled';
    end if;

    update public.publish_jobs
    set status = 'cancelled',
        cancel_reason = 'Nội dung đã sửa sau khi duyệt — phải duyệt lại trước khi đăng',
        updated_at = now()
    where variant_id = OLD.id
      and status = 'queued';

    insert into public.audit_log (workspace_id, actor_id, entity_type, entity_id, action, detail)
    values (
      OLD.workspace_id,
      auth.uid(),
      'content_variant',
      OLD.id,
      'status_change',
      jsonb_build_object(
        'reason', 'content_changed_after_approval',
        'approval_status_before', OLD.approval_status,
        'approval_status_after', 'needs_review'
      )
    );
  end if;

  return NEW;
end;
$$;

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

  -- Revision hiện hành đổi khi đang approved -> duyệt cũ mất hiệu lực:
  -- hạ 'pending', xóa approved_revision_id, hủy publish_jobs queued.
  if NEW.current_revision_id is distinct from OLD.current_revision_id
     and OLD.approval_status = 'approved' then
    NEW.approval_status := 'pending';
    NEW.approved_revision_id := null;
    if NEW.publishing_status = 'scheduled' then
      NEW.publishing_status := 'not_scheduled';
    end if;

    update public.publish_jobs
    set status = 'cancelled',
        cancel_reason = 'Revision hiện hành đã đổi sau khi duyệt — phải duyệt lại trước khi đăng',
        updated_at = now()
    where variant_id = OLD.id
      and status = 'queued';

    insert into public.audit_log (workspace_id, actor_id, entity_type, entity_id, action, detail)
    values (
      OLD.workspace_id,
      auth.uid(),
      'content_variant',
      OLD.id,
      'status_change',
      jsonb_build_object(
        'reason', 'current_revision_changed_after_approval',
        'approval_status_before', OLD.approval_status,
        'approval_status_after', 'pending'
      )
    );
  end if;

  return NEW;
end;
$$;
