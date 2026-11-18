-- ============================================================================
-- SAVA Marketing Workspace — 0016_budget_approval_money_fixes.sql
-- Vá các finding QA vòng 16/11/2026 (SYNTHESIS.md + money/REPORT.md):
--   SYN-02 (Money F-01): budget_remaining lệch JS — thiếu lọc currency +
--     archived_at. Nay: chỉ tính fact CÙNG currency với dòng ngân sách
--     (currency của dòng lấy từ budget_lines.currency, so bằng '=' nên fact
--     thiếu currency KHÔNG được tính — xem thêm SYN-09 ở dưới), và loại
--     cam kết có archived_at not null khỏi phần cam kết còn mở. Các ngữ
--     nghĩa 0014 còn lại giữ nguyên: chỉ fact approval_status='approved'
--     mới tính; cam kết còn mở = status planned/committed/
--     partially_actualised (đúng tập JS OPEN_COMMITMENT_STATUSES sau khi
--     bỏ 2 alias 'open'/'partial' mà CHECK của DB không cho lưu); "đã trả"
--     chỉ từ actual ĐÃ DUYỆT liên kết, cùng currency với dòng (khớp JS:
--     budgetUsageTotal lọc acts theo sameCurrency trước khi
--     commitmentPaidTotal cộng).
--   SYN-03 (Money F-02): UsageTotal trong decide_commitment_approval /
--     decide_payment_approval KHÔNG còn gồm cam kết settled/released —
--     tập status chuyển từ "status <> 'cancelled'" sang đúng tập còn mở
--     của JS (planned/committed/partially_actualised). Mirror JS
--     budgetUsageTotal/domain.openCommitmentTotal: settled 50 đã trả 10
--     -> usage 10 (chỉ phần actual đã duyệt tính); released 50 -> usage 0.
--     Hệ quả: khoản trong trần theo UI không còn bị RPC chặn oan
--     BUDGET_LIMIT_EXCEEDED.
--   SYN-04 (Money F-03, Zac chốt 16/11 gồm cả hạn mức campaign): cả 2 RPC
--     decide_* thêm kiểm dấu duyệt TẦNG CAMPAIGN — nếu dòng ngân sách
--     thuộc một campaign (budget_lines.campaign_id not null) thì yêu cầu
--     campaigns.approved_by NOT NULL, thiếu -> BUDGET_NOT_APPROVED với
--     message ghi rõ level=campaign (JS mirror đọc trường missingStamp;
--     phía SQL ghi level vào message text). Dòng không thuộc campaign ->
--     chỉ cần dấu duyệt của dòng như 0014. Message thiếu dấu của dòng
--     cũng ghi thêm level=budget_line cho đối xứng.
--   SYN-08 (Money F-05, phần chặn trả vượt): decide_payment_approval chặn
--     khi tổng payment ĐÃ DUYỆT gắn cam kết + payment đang xét vượt quá
--     amount gốc của cam kết -> PAYMENT_EXCEEDS_COMMITMENT (42501).
--   SYN-09 (Money F-06): fact thiếu currency (null) xử lý như lệch
--     currency — KHÔNG tự coi là cùng currency: (a) check của fact đang
--     xét giữ nguyên 'currency is distinct from line.currency' của 0014
--     (null distinct -> CURRENCY_MISMATCH); (b) mọi tổng usage/remaining
--     lọc bằng 'currency = line.currency' ('=' với null cho kết quả null
--     nên fact thiếu currency bị loại khỏi tổng, không cộng như JS cũ).
--   SYN-22 (Permissions F5-01): revoke EXECUTE trên budget_remaining,
--     upsert_member_capacity, get_member_capacity khỏi public + anon
--     đích danh; grant execute cho authenticated, service_role.
--   SYN-23 (Permissions F5-02): policy insert budget_proposals loại vai
--     CEO (giữ nguyên các vai còn lại như 0014: mọi thành viên workspace
--     khác tạo được đề xuất cho chính mình).
--   SYN-14 (Money F-09): trigger trg_budget_allocations_cap tính cả
--     allocation khai share_percent — effective amount của allocation
--     phần trăm = round(amount gốc x share_percent/100, 2); tổng
--     effective của mọi allocation của cùng một nguồn <= amount gốc.
-- IDEMPOTENT: create or replace / drop policy if exists / drop trigger
-- if exists; chạy lại không lỗi, không đổi kết quả. KHÔNG sửa migration
-- cũ; file này CHƯA áp lên production khi tạo (áp qua quy trình riêng).
-- Mã lỗi ỔN ĐỊNH giữ nguyên tiền tố của 0014 + mã mới:
--   PAYMENT_EXCEEDS_COMMITMENT (42501).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) budget_remaining — bản 0014 + lọc currency + loại cam kết archived
--    (SYN-02). Giữ nguyên signature, kiểu trả và các lọc approval của 0014.
-- ----------------------------------------------------------------------------
create or replace function public.budget_remaining(p_budget_line_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_approved numeric;
  v_currency text;
  v_actual   numeric;
  v_open     numeric;
begin
  select bl.approved_amount, bl.currency into v_approved, v_currency
  from public.budget_lines bl where bl.id = p_budget_line_id;
  if v_approved is null then return null; end if;

  -- Chỉ actual ĐÃ DUYỆT và CÙNG currency với dòng (fact thiếu currency:
  -- currency = v_currency cho null -> bị loại, đúng SYN-09).
  select coalesce(sum(ba.amount), 0) into v_actual
  from public.budget_actuals ba
  where ba.budget_line_id = p_budget_line_id
    and ba.approval_status = 'approved'
    and ba.currency = v_currency;

  -- Cam kết còn mở ĐÃ DUYỆT, cùng currency, CHƯA archive; "đã trả" chỉ từ
  -- actual ĐÃ DUYỆT liên kết cùng currency với dòng.
  select coalesce(sum(greatest(bc.amount - coalesce(paid.total, 0), 0)), 0) into v_open
  from public.budget_commitments bc
  left join (
    select commitment_id, sum(amount) as total
    from public.budget_actuals
    where commitment_id is not null
      and approval_status = 'approved'
      and currency = v_currency
    group by commitment_id
  ) paid on paid.commitment_id = bc.id
  where bc.budget_line_id = p_budget_line_id
    and bc.approval_status = 'approved'
    and bc.currency = v_currency
    and bc.archived_at is null
    and bc.status in ('planned', 'committed', 'partially_actualised');

  return v_approved - v_actual - v_open;
end;
$$;
comment on function public.budget_remaining(uuid) is '0016 (gốc 0010/R3-06, duyệt 0014): approved − Σactuals ĐÃ DUYỆT cùng currency − Σ cam kết ĐÃ DUYỆT còn mở (planned/committed/partially_actualised), cùng currency, archived_at is null, của max(0, amount − Σactuals ĐÃ DUYỆT liên kết cùng currency). KHÔNG dùng settled_amount. Khớp js/domain.js budgetRemaining/budgetUsageTotal + lọc currency/archived (SYN-02).';

-- ----------------------------------------------------------------------------
-- 2) RPC decide_commitment_approval — bản 0014 + 3 thay đổi:
--    a. UsageTotal chỉ gồm cam kết CÒN MỞ (loại settled/released — SYN-03);
--    b. thêm kiểm dấu duyệt tầng campaign khi dòng thuộc campaign (SYN-04);
--    c. fact thiếu currency -> CURRENCY_MISMATCH (giữ 'is distinct from',
--       ghi rõ ở comment — SYN-09).
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
  v_commitment         public.budget_commitments%rowtype;
  v_line               public.budget_lines%rowtype;
  v_role               text;
  v_usage_after        numeric;
  v_campaign_found     boolean;
  v_campaign_approved_by uuid;
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
      raise exception 'BUDGET_NOT_APPROVED: dòng ngân sách chưa có dấu duyệt (approved_by null) — cần đề xuất được Owner duyệt trước; level=budget_line'
        using errcode = '42501';
    end if;
    -- SYN-04: dòng thuộc campaign -> hạn mức campaign cũng phải có dấu
    -- duyệt của Owner (campaigns.approved_by). Campaign không tồn tại
    -- (không đọc được dấu) cũng coi như thiếu dấu ở tầng campaign.
    if v_line.campaign_id is not null then
      select c.approved_by into v_campaign_approved_by
      from public.campaigns c where c.id = v_line.campaign_id;
      v_campaign_found := found;
      if not v_campaign_found or v_campaign_approved_by is null then
        raise exception 'BUDGET_NOT_APPROVED: thiếu dấu duyệt ở tầng campaign (campaigns.approved_by null, campaign_id %) — hạn mức campaign chưa được Owner duyệt; level=campaign', v_line.campaign_id
          using errcode = '42501';
      end if;
    end if;
    -- SYN-09: 'is distinct from' — currency null của fact cũng lệch.
    if v_commitment.currency is distinct from v_line.currency then
      raise exception 'CURRENCY_MISMATCH: currency cam kết (%) khác currency của dòng (%)', v_commitment.currency, v_line.currency
        using errcode = '22023';
    end if;

    -- UsageAfter (SYN-03): cam kết này tính như đã duyệt NHƯNG vẫn phải
    -- qua đúng tập status còn mở của JS — cam kết settled/released (kể cả
    -- chính cam kết đang xét) đóng góp 0 vào phần nghĩa vụ mở; phần actual
    -- ĐÃ DUYỆT liên kết vẫn tính ở tổng actuals như JS budgetUsageTotal.
    -- Mọi tổng lọc 'currency = currency của dòng' nên fact thiếu currency
    -- bị loại (SYN-09).
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
                    and bc.status in ('planned', 'committed', 'partially_actualised')
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

comment on function public.decide_commitment_approval(uuid, text, text) is '0016 (gốc 0014): lead/owner duyệt/từ chối cam kết chờ duyệt; chặn tự duyệt (trừ owner), dòng chưa duyệt (level=budget_line), hạn mức campaign chưa duyệt khi dòng thuộc campaign (level=campaign, SYN-04), lệch/thiếu currency (SYN-09) và vượt approved_amount theo UsageTotal chỉ tính cam kết còn mở — loại settled/released (SYN-03). Trả jsonb commitment. approved_by/at = người/thời điểm quyết định kể cả khi rejected.';

revoke all on function public.decide_commitment_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_commitment_approval(uuid, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) RPC decide_payment_approval — bản 0014 + 4 thay đổi:
--    a. UsageTotal chỉ gồm cam kết CÒN MỞ (loại settled/released — SYN-03);
--    b. thêm kiểm dấu duyệt tầng campaign khi dòng thuộc campaign (SYN-04);
--    c. chặn trả vượt cam kết gốc -> PAYMENT_EXCEEDS_COMMITMENT (SYN-08);
--    d. fact thiếu currency -> CURRENCY_MISMATCH (SYN-09, như mục 2).
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
  v_actual               public.budget_actuals%rowtype;
  v_line                 public.budget_lines%rowtype;
  v_role                 text;
  v_usage_after          numeric;
  v_campaign_found       boolean;
  v_campaign_approved_by uuid;
  v_commitment_amount    numeric;
  v_commitment_paid      numeric;
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
      raise exception 'BUDGET_NOT_APPROVED: dòng ngân sách chưa có dấu duyệt (approved_by null) — cần đề xuất được Owner duyệt trước; level=budget_line'
        using errcode = '42501';
    end if;
    -- SYN-04: như decide_commitment_approval — dòng thuộc campaign thì
    -- hạn mức campaign phải có dấu duyệt của Owner.
    if v_line.campaign_id is not null then
      select c.approved_by into v_campaign_approved_by
      from public.campaigns c where c.id = v_line.campaign_id;
      v_campaign_found := found;
      if not v_campaign_found or v_campaign_approved_by is null then
        raise exception 'BUDGET_NOT_APPROVED: thiếu dấu duyệt ở tầng campaign (campaigns.approved_by null, campaign_id %) — hạn mức campaign chưa được Owner duyệt; level=campaign', v_line.campaign_id
          using errcode = '42501';
      end if;
    end if;
    -- SYN-09: 'is distinct from' — currency null của fact cũng lệch.
    if v_actual.currency is distinct from v_line.currency then
      raise exception 'CURRENCY_MISMATCH: currency khoản chi (%) khác currency của dòng (%)', v_actual.currency, v_line.currency
        using errcode = '22023';
    end if;

    -- SYN-08: payment gắn cam kết — tổng payment ĐÃ DUYỆT của cam kết đó
    -- (đúng tập "đã trả" của JS commitmentPaidTotal: actual đã duyệt liên
    -- kết) + payment đang xét không được vượt amount gốc của cam kết.
    if v_actual.commitment_id is not null then
      select bc.amount into v_commitment_amount
      from public.budget_commitments bc where bc.id = v_actual.commitment_id;
      if v_commitment_amount is not null then
        select coalesce(sum(ba.amount), 0) into v_commitment_paid
        from public.budget_actuals ba
        where ba.commitment_id = v_actual.commitment_id
          and ba.approval_status = 'approved';
        if v_commitment_paid + v_actual.amount > v_commitment_amount then
          raise exception 'PAYMENT_EXCEEDS_COMMITMENT: tổng payment đã duyệt (%) + payment này (%) vượt số tiền cam kết gốc (%)', v_commitment_paid, v_actual.amount, v_commitment_amount
            using errcode = '42501';
        end if;
      end if;
    end if;

    -- UsageAfter (SYN-03): actual này tính như đã duyệt (id = p_actual_id
    -- trong cả tổng actuals lẫn phần "paid" trừ vào nghĩa vụ của
    -- commitment liên kết); tập commitments chỉ còn mở như JS.
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
                    and bc.status in ('planned', 'committed', 'partially_actualised')
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

comment on function public.decide_payment_approval(uuid, text, text) is '0016 (gốc 0014): lead/owner duyệt/từ chối khoản chi chờ duyệt; chặn tự duyệt (trừ owner), dòng chưa duyệt (level=budget_line), hạn mức campaign chưa duyệt khi dòng thuộc campaign (level=campaign, SYN-04), lệch/thiếu currency (SYN-09), trả vượt cam kết gốc (PAYMENT_EXCEEDS_COMMITMENT, SYN-08) và vượt approved_amount theo UsageTotal chỉ tính cam kết còn mở — loại settled/released (SYN-03). Trả jsonb actual. approved_by/at = người/thời điểm quyết định kể cả khi rejected.';

revoke all on function public.decide_payment_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_payment_approval(uuid, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) SYN-22 — siết EXECUTE của budget_remaining + 2 RPC capacity:
--    revoke khỏi public VÀ anon đích danh (0010 mới revoke public cho 2
--    RPC capacity; budget_remaining chưa từng bị revoke), grant lại cho
--    authenticated, service_role.
-- ----------------------------------------------------------------------------
revoke execute on function public.budget_remaining(uuid) from public, anon;
grant execute on function public.budget_remaining(uuid) to authenticated, service_role;

revoke execute on function public.upsert_member_capacity(uuid, uuid, numeric, jsonb, date, date) from public, anon;
grant execute on function public.upsert_member_capacity(uuid, uuid, numeric, jsonb, date, date) to authenticated, service_role;

revoke execute on function public.get_member_capacity(uuid, uuid) from public, anon;
grant execute on function public.get_member_capacity(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) SYN-23 — policy insert budget_proposals: loại vai CEO.
--    Giữ nguyên phần còn lại của policy 0014 (thành viên workspace +
--    proposer_id = auth.uid()); chỉ thêm điều kiện vai <> 'ceo' — CEO là
--    vai chỉ xem, không tạo được đề xuất kể cả qua API trực tiếp.
-- ----------------------------------------------------------------------------
drop policy if exists budget_proposals_insert on public.budget_proposals;
create policy budget_proposals_insert on public.budget_proposals
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id)
    and proposer_id = auth.uid()
    and coalesce(public.current_role(workspace_id), '') <> 'ceo');

-- ----------------------------------------------------------------------------
-- 6) SYN-14 — trigger chặn over-allocation tính cả share_percent.
--    Viết lại trg_budget_allocations_cap của 0010 (giữ nguyên kiểm scope
--    chéo workspace/campaign/activity và lỗi R31_SCOPE/R31_ALLOC cũ):
--      effective(allocation) = khi khai share_percent:
--                                round(amount gốc x share_percent/100, 2)
--                              ngược lại: amount tường minh như 0010.
--    Tổng effective của MỌI allocation cùng nguồn (khi UPDATE trừ phần
--    effective cũ của chính dòng đang sửa) + effective của dòng mới
--    không vượt amount gốc. Khớp hướng JS validateAllocations (chặn cả
--    đường tiền lẫn đường tỷ lệ).
-- ----------------------------------------------------------------------------
create or replace function public.trg_budget_allocations_cap() returns trigger language plpgsql as $$
declare
  v_source_amount numeric;
  v_allocated     numeric;
  v_old_effective numeric;
  v_new_effective numeric;
  v_ws uuid;
  v_camp uuid;
begin
  -- scope: campaign/activity cùng workspace (giữ nguyên 0010)
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

  -- Effective của dòng đang ghi + của dòng cũ (khi UPDATE).
  v_new_effective := case
    when NEW.share_percent is not null then round(v_source_amount * NEW.share_percent / 100, 2)
    else NEW.amount
  end;
  v_old_effective := 0;
  if TG_OP = 'UPDATE' then
    v_old_effective := case
      when OLD.share_percent is not null then round(v_source_amount * OLD.share_percent / 100, 2)
      else OLD.amount
    end;
  end if;

  -- Tổng effective của mọi allocation cùng nguồn (đã gồm dòng cũ khi UPDATE).
  select coalesce(sum(case
           when a.share_percent is not null then round(v_source_amount * a.share_percent / 100, 2)
           else a.amount
         end), 0) into v_allocated
  from public.budget_allocations a
  where (NEW.source_kind = 'actual' and a.actual_id = NEW.actual_id)
     or (NEW.source_kind = 'commitment' and a.commitment_id = NEW.commitment_id);
  if TG_OP = 'UPDATE' then v_allocated := v_allocated - v_old_effective; end if;
  if v_allocated + v_new_effective > v_source_amount then
    raise exception 'R31_ALLOC: tổng phân bổ (%) vượt amount của nguồn (%)', v_allocated + v_new_effective, v_source_amount using errcode='23514';
  end if;
  return NEW;
end;
$$;
drop trigger if exists budget_allocations_cap_check on public.budget_allocations;
create trigger budget_allocations_cap_check before insert or update on public.budget_allocations
  for each row execute function public.trg_budget_allocations_cap();
