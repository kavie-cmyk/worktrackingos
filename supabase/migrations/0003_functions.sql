-- ============================================================================
-- SAVA Marketing Workspace — 0003_functions.sql
-- Hàm/trigger nghiệp vụ:
--   1) check_dependency_cycle() — chống vòng tròn trong task_dependencies.
--   2) task_is_ready(task_id)   — successor chỉ sẵn sàng khi MỌI predecessor
--      đã 'completed'.
--   3) invalidate_approval_on_content_change() — sửa nội dung đã duyệt thì
--      approval_status -> 'needs_review' + hủy publish_jobs đang 'queued'.
--   4) budget_remaining(budget_line_id) — approved − actual − cam kết còn mở,
--      không trừ trùng phần cam kết đã chuyển thành actual.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Chống vòng tròn dependency
-- Đồ thị: cạnh predecessor -> successor (finish_to_start). Thêm/sửa cạnh
-- P -> S tạo vòng khi S đã tới được P qua các cạnh hiện có. Duyệt đệ quy
-- từ S; gặp lại P thì raise exception (errcode 23514 = check_violation).
-- ----------------------------------------------------------------------------

create or replace function public.check_dependency_cycle()
returns trigger
language plpgsql
as $$
declare
  v_hit uuid;
begin
  if NEW.predecessor_id = NEW.successor_id then
    raise exception 'task_dependencies: predecessor_id và successor_id không được trùng nhau (task %)', NEW.predecessor_id
      using errcode = '23514';
  end if;

  with recursive reachable (node_id) as (
    select td.successor_id
    from public.task_dependencies td
    where td.predecessor_id = NEW.successor_id
      and td.id is distinct from NEW.id
    union
    select td.successor_id
    from public.task_dependencies td
    join reachable r on td.predecessor_id = r.node_id
    where td.id is distinct from NEW.id
  )
  select node_id into v_hit
  from reachable
  where node_id = NEW.predecessor_id
  limit 1;

  if v_hit is not null then
    raise exception 'task_dependencies: cạnh % -> % sẽ tạo vòng tròn phụ thuộc', NEW.predecessor_id, NEW.successor_id
      using errcode = '23514';
  end if;

  return NEW;
end;
$$;

comment on function public.check_dependency_cycle() is 'Trigger function: duyệt đồ thị phụ thuộc đệ quy, chặn mọi cạnh tạo vòng (kể cả vòng dài qua nhiều task).';

drop trigger if exists task_dependencies_no_cycle on public.task_dependencies;
create trigger task_dependencies_no_cycle
  before insert or update of predecessor_id, successor_id on public.task_dependencies
  for each row execute function public.check_dependency_cycle();

-- ----------------------------------------------------------------------------
-- 2. task_is_ready(task_id)
-- Trả true khi task tồn tại và MỌI predecessor (theo task_dependencies,
-- type finish_to_start) đều có status = 'completed'.
--   * Không có predecessor nào -> true.
--   * Còn 1 predecessor chưa 'completed' (todo/in_progress/review) -> false.
--   * Predecessor bị 'cancelled' KHÔNG được tính là xong -> false. Lý do:
--     việc tiền lệ sẽ không bao giờ hoàn thành; người quản lý phải chủ động
--     gỡ dependency đó hoặc mở lại task tiền lệ, thay vì hệ thống tự cho qua.
--   * Task không tồn tại -> false.
-- ----------------------------------------------------------------------------

create or replace function public.task_is_ready(p_task_id uuid)
returns boolean
language sql
stable
as $$
  select
    exists (select 1 from public.tasks t where t.id = p_task_id)
    and not exists (
      select 1
      from public.task_dependencies td
      join public.tasks pred on pred.id = td.predecessor_id
      where td.successor_id = p_task_id
        and td.type = 'finish_to_start'
        and pred.status <> 'completed'
    )
$$;

comment on function public.task_is_ready(uuid) is 'true khi mọi predecessor finish_to_start đều completed. Cancelled không tính là xong (xem đầu mục 2 trong 0003_functions.sql).';

-- ----------------------------------------------------------------------------
-- 3. Sửa nội dung sau khi duyệt -> mất hiệu lực duyệt
-- Kích hoạt khi variant đang 'approved' mà caption / media (media_asset_ids)
-- / tài khoản kênh (channel_account_id) / visibility thay đổi:
--   * approval_status := 'needs_review', approved_revision_id := null
--     (lịch sử duyệt cũ vẫn còn nguyên trong approval_decisions).
--   * publishing_status 'scheduled' -> 'not_scheduled'.
--   * publish_jobs của variant đang 'queued' -> 'cancelled' kèm lý do.
--     (Job 'unscheduled' giữ nguyên trạng thái nhưng snapshot của nó không
--     còn khớp revision được duyệt; publish-worker revalidate sẽ chặn khi
--     job được xếp lịch. Job đang 'processing' trở đi không bị trigger này
--     đụng vào — worker tự xử lý theo kết quả gửi thực tế.)
--   * Ghi audit_log.
-- ----------------------------------------------------------------------------

create or replace function public.invalidate_approval_on_content_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

comment on function public.invalidate_approval_on_content_change() is 'Trigger function trên content_variants: sửa caption/media/account/visibility sau khi approved thì hạ về needs_review và hủy publish_jobs queued.';

drop trigger if exists content_variants_invalidate_approval on public.content_variants;
create trigger content_variants_invalidate_approval
  before update of caption, media_asset_ids, channel_account_id, visibility on public.content_variants
  for each row execute function public.invalidate_approval_on_content_change();

-- ----------------------------------------------------------------------------
-- 4. budget_remaining(budget_line_id)
--   còn lại = approved_amount
--             − tổng budget_actuals của dòng
--             − tổng cam kết CÒN MỞ, trong đó mỗi cam kết chỉ tính phần
--               CHƯA chuyển thành actual:
--               max(commitment.amount − sum(actuals có commitment_id = nó), 0)
-- Nhờ trừ theo commitment_id, một khoản chi đã ghi actual từ cam kết không
-- bị trừ hai lần (một lần ở actual, một lần ở cam kết).
-- Cam kết còn mở = status in ('planned','committed','partially_actualised').
-- Cam kết 'settled' đã xong (phần chênh lệch nếu có coi như đã giải phóng),
-- 'released'/'cancelled' không còn giữ ngân sách.
-- Trả NULL nếu budget_line không tồn tại. Kết quả có thể âm (vượt ngân sách)
-- — giữ nguyên số âm để cảnh báo, không ép về 0.
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
  from public.budget_lines bl
  where bl.id = p_budget_line_id;

  if v_approved is null then
    return null;
  end if;

  select coalesce(sum(ba.amount), 0) into v_actual
  from public.budget_actuals ba
  where ba.budget_line_id = p_budget_line_id;

  select coalesce(sum(greatest(bc.amount - coalesce(act.actualised, 0), 0)), 0) into v_open
  from public.budget_commitments bc
  left join (
    select ba.commitment_id, sum(ba.amount) as actualised
    from public.budget_actuals ba
    where ba.commitment_id is not null
    group by ba.commitment_id
  ) act on act.commitment_id = bc.id
  where bc.budget_line_id = p_budget_line_id
    and bc.status in ('planned', 'committed', 'partially_actualised');

  return v_approved - v_actual - v_open;
end;
$$;

comment on function public.budget_remaining(uuid) is 'Ngân sách còn lại = approved − actual − cam kết còn mở (đã trừ phần cam kết chuyển thành actual qua budget_actuals.commitment_id, không trừ trùng).';
