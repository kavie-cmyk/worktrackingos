-- ============================================================================
-- SAVA Marketing Workspace — 0020_paid_price.sql
-- THAY ĐỔI A (Zac chốt 18/11/2026): BỎ 3 mức giá Paid, CHỈ CÒN 1 giá Paid
-- duy nhất theo Phase.
-- CHỈ là mã nguồn trong repo — CHƯA áp lên production khi file này được
-- commit. Migration này CHỈ thêm cột vào bảng cũ public.phases + quy đổi
-- dữ liệu, KHÔNG tạo bảng mới, KHÔNG đổi RLS/policy (cột mới nằm trên bảng
-- đã có RLS) và KHÔNG xoá cột cũ paid_price_tiers (giữ lịch sử).
-- Idempotent theo mẫu 0017/0018/0019: add column if not exists; bước quy
-- đổi chỉ ghi vào phase còn paid_price IS NULL nên chạy lại không ghi đè
-- giá đã nhập tay sau này.
--
-- CỘT MỚI TRÊN public.phases:
--  paid_price numeric(18,2) — giá Paid duy nhất của Phase
--  (VNĐ/user/tháng). Kiểu numeric(18,2) khớp các cột tiền khác của phases
--  ở 0017 (arppu, cogs_per_user, fixed_cost, opening_free/opening_paid,
--  arppu_b2b, cogs_per_b2b_account đều là numeric(18,2)).
--  ARPPU hiệu dụng của Phase = paid_price trực tiếp;
--  Revenue = paid_price x Paid EOM. null = chưa nhập giá (Revenue/Profit
--  hiện "—" như hành vi thiếu mức giá trước đây).
--
-- QUY ĐỔI DỮ LIỆU TỪ paid_price_tiers (0018):
--  Shape jsonb đã đọc từ code domain (js/domain.js
--  computeOperatingFinancials trước thay đổi A) + migration 0018:
--  paid_price_tiers là MẢNG các object [{"price":25000,"pct":50},
--  {"price":49000,"pct":30},{"price":99000,"pct":20}], trong đó `pct`
--  là SỐ PHẦN TRĂM 0–100 (KHÔNG phải phân số). ARPPU trọng số cũ =
--  Σ price x pct / 100 (vd bộ trên: 25.000x50% + 49.000x30% +
--  99.000x20% = 47.000). Phase nào đang có paid_price_tiers (mảng
--  không rỗng) thì paid_price = ARPPU trọng số đó; phase không có
--  tiers giữ paid_price = null.
-- ============================================================================

alter table public.phases add column if not exists paid_price numeric(18,2);

comment on column public.phases.paid_price is '0020: giá Paid duy nhất theo Phase (VNĐ/user/tháng); ARPPU hiệu dụng = paid_price trực tiếp, Revenue = paid_price x Paid EOM. Thay cho 3 mức giá paid_price_tiers của 0018 (cột cũ giữ nguyên để tra lịch sử, app không còn đọc/ghi).';

-- ----------------------------------------------------------------------------
-- Quy đổi: paid_price = Σ (price x pct / 100) trên từng phần tử của mảng
-- paid_price_tiers. Chỉ cập nhật phase có tiers không rỗng và chưa có
-- paid_price (idempotent). Phần tử thiếu price/pct bị bỏ qua ở phép cộng
-- (dữ liệu do app ghi luôn có đủ cả hai; validate cũ của domain chặn
-- pct ngoài 0–100 / tổng pct > 100 ở đường vận hành, migration chỉ quy
-- đổi số học đúng công thức trọng số).
-- ----------------------------------------------------------------------------
update public.phases p
set paid_price = conv.arppu_weighted
from (
  select ph.id,
         sum(((elem ->> 'price')::numeric) * ((elem ->> 'pct')::numeric) / 100) as arppu_weighted
  from public.phases ph
  cross join lateral jsonb_array_elements(ph.paid_price_tiers) as elem
  where ph.paid_price_tiers is not null
    and jsonb_typeof(ph.paid_price_tiers) = 'array'
    and jsonb_array_length(ph.paid_price_tiers) > 0
    and (elem ->> 'price') is not null
    and (elem ->> 'pct') is not null
  group by ph.id
) as conv
where p.id = conv.id
  and p.paid_price is null;

-- ============================================================================
-- KIỂM CHỨNG SAU KHI ÁP (chạy tay, không nằm trong luồng áp migration):
--
-- 1) Đếm phase đã có giá Paid đơn:
--    select count(*) as phases_with_paid_price
--    from public.phases where paid_price is not null;
--
-- 2) Đối chiếu paid_price với ARPPU tính lại từ tiers cho các phase
--    còn tiers — mọi dòng phải có diff = 0 (hoặc ~0 do làm tròn
--    numeric(18,2)):
--    select p.id, p.name, p.paid_price,
--           sum(((elem ->> 'price')::numeric) * ((elem ->> 'pct')::numeric) / 100) as arppu_from_tiers,
--           p.paid_price - sum(((elem ->> 'price')::numeric) * ((elem ->> 'pct')::numeric) / 100) as diff
--    from public.phases p
--    cross join lateral jsonb_array_elements(p.paid_price_tiers) as elem
--    where p.paid_price_tiers is not null
--      and jsonb_typeof(p.paid_price_tiers) = 'array'
--      and jsonb_array_length(p.paid_price_tiers) > 0
--    group by p.id, p.name, p.paid_price
--    order by p.name;
-- ============================================================================
