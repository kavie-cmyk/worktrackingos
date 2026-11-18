-- ============================================================================
-- SAVA Marketing Workspace — 0021_phase_assumptions_b2b_rates.sql
-- Bổ sung 3 tỉ lệ B2B còn thiếu cho public.phase_assumptions:
-- paid_to_b2b, lead_to_account, demo_to_account.
-- CHỈ là mã nguồn trong repo — CHƯA áp lên production khi file này được
-- commit. Migration này CHỈ thêm cột vào bảng cũ public.phase_assumptions,
-- KHÔNG tạo bảng mới và KHÔNG đổi RLS/policy (cột mới nằm trên bảng đã có
-- RLS). Idempotent theo mẫu 0017/0018/0020: add column if not exists.
--
-- VÌ SAO: lưới tỉ lệ của Phase (Planning → Theo phase) render đủ 6 tỉ lệ
-- và savePhaseRate/savePhaseAssumption (js/app.js) đã tạo patch đúng cả
-- 3 field B2B, nhưng:
--  - 0017 tạo public.phase_assumptions KHÔNG có 3 cột B2B này (chỉ
--    public.benchmarks mới có, cùng 0017), và 0018 chỉ bổ sung
--    visit_to_freemium/freemium_to_paid cho phase_assumptions;
--  - whitelist TABLE_COLUMNS.phase_assumptions ở js/store-core.js cũng
--    thiếu 3 field này nên tầng store lược bỏ chúng khỏi payload ghi.
-- Hệ quả: nhập số vào ô Paid→B2B / Lead→Account / Demo→Account trong
-- lưới Phase thì số không lưu, giao diện trả về "—". Migration này vá
-- lớp DB; lớp store được vá cùng đợt trong js/store-core.js (thêm đúng
-- 3 field vào whitelist phase_assumptions).
--
-- CÁC CỘT MỚI TRÊN public.phase_assumptions (kiểu numeric(12,8) — khớp
-- 3 cột B2B tương ứng của public.benchmarks ở 0017 và các cột tỉ lệ
-- khác của chính phase_assumptions ở 0017/0018):
--  1. paid_to_b2b     — tỉ lệ Paid User (luồng B2C) → B2B Account.
--  2. lead_to_account — tỉ lệ Lead (phần B2B của Objective Lead
--     Generation) → B2B Account.
--  3. demo_to_account — tỉ lệ Demo (phần B2B của Objective Demo /
--     Contact) → B2B Account.
-- Cả 3 lưu dạng PHÂN SỐ (0–1) như mọi tỉ lệ phễu của bảng; null = kế
-- thừa Benchmark của Brand × Channel (không phải 0), đúng quy ước của
-- bảng từ 0017.
-- ============================================================================

alter table public.phase_assumptions add column if not exists paid_to_b2b numeric(12,8);
alter table public.phase_assumptions add column if not exists lead_to_account numeric(12,8);
alter table public.phase_assumptions add column if not exists demo_to_account numeric(12,8);

comment on column public.phase_assumptions.paid_to_b2b is '0021: tỉ lệ Paid→B2B ghi đè theo Phase × Channel (cầu nối Paid User luồng B2C → B2B Account), lưu dạng phân số (0–1); null = kế thừa Benchmark.';
comment on column public.phase_assumptions.lead_to_account is '0021: tỉ lệ Lead→Account ghi đè theo Phase × Channel (phần B2B của Objective Lead Generation → B2B Account), lưu dạng phân số (0–1); null = kế thừa Benchmark.';
comment on column public.phase_assumptions.demo_to_account is '0021: tỉ lệ Demo→Account ghi đè theo Phase × Channel (phần B2B của Objective Demo/Contact → B2B Account), lưu dạng phân số (0–1); null = kế thừa Benchmark.';

-- ============================================================================
-- KIỂM CHỨNG SAU KHI ÁP (chạy tay, không nằm trong luồng áp migration):
--
-- Cả 3 cột B2B phải xuất hiện với data_type = numeric, độ chính xác 12
-- và scale 8 (numeric(12,8)):
--    select column_name, data_type, numeric_precision, numeric_scale
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'phase_assumptions'
--      and column_name in ('paid_to_b2b', 'lead_to_account', 'demo_to_account')
--    order by column_name;
-- ============================================================================
