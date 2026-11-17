-- ============================================================================
-- SAVA Marketing Workspace — 0018_funnel_freemium.sql
-- Căn chỉnh phễu freemium: bổ sung field tài chính/chuyển đổi mới cho
-- public.phases phục vụ mô hình phễu Visit → Freemium → Paid.
-- CHỈ là mã nguồn trong repo — CHƯA áp lên production khi file này được
-- commit. Migration này CHỈ thêm cột vào bảng cũ public.phases, KHÔNG tạo
-- bảng mới và KHÔNG đổi RLS/policy (cột mới nằm trên bảng đã có RLS).
-- Idempotent theo mẫu 0017: add column if not exists.
--
-- CÁC CỘT MỚI TRÊN public.phases:
--  1. monthly_cvr numeric — tỉ lệ chuyển đổi hằng tháng của Phase, lưu dạng
--     PHÂN SỐ (0–1) như các churn rate hiện có (paid_churn_rate,
--     free_churn_rate, b2b_churn_rate ở 0017), KHÔNG lưu dạng %.
--  2. cogs_per_free_user numeric — COGS trên mỗi Free User.
--  3. cogs_per_paid_user numeric — COGS trên mỗi Paid User.
--     (Tách COGS theo Free/Paid thay cho cogs_per_user gộp trước đây.)
--  4. paid_price_tiers jsonb — các bậc giá Paid dạng mảng object, vd
--     [{"price":25000,"pct":50},{"price":49000,"pct":30},
--      {"price":99000,"pct":20}]. LƯU Ý: `pct` trong paid_price_tiers là
--     SỐ PHẦN TRĂM 0–100 (khác quy ước phân số của monthly_cvr/churn rate).
--
-- GIỮ NGUYÊN cột cũ: arppu và cogs_per_user của 0017 KHÔNG bị xoá ở
-- migration này (dữ liệu/app cũ vẫn có thể đang đọc) — việc dọn cột cũ,
-- nếu có, là quyết định riêng sau này.
-- ============================================================================

alter table public.phases add column if not exists monthly_cvr numeric;
alter table public.phases add column if not exists cogs_per_free_user numeric;
alter table public.phases add column if not exists cogs_per_paid_user numeric;
alter table public.phases add column if not exists paid_price_tiers jsonb;

comment on column public.phases.monthly_cvr is '0018: tỉ lệ chuyển đổi hằng tháng của Phase, lưu dạng phân số (0–1) như các churn rate.';
comment on column public.phases.cogs_per_free_user is '0018: COGS trên mỗi Free User (tách từ cogs_per_user gộp của 0017; cột cũ giữ nguyên).';
comment on column public.phases.cogs_per_paid_user is '0018: COGS trên mỗi Paid User (tách từ cogs_per_user gộp của 0017; cột cũ giữ nguyên).';
comment on column public.phases.paid_price_tiers is '0018: bậc giá Paid dạng jsonb mảng object [{price, pct}]; pct là số phần trăm 0–100.';

-- ============================================================================
-- BỔ SUNG 0018 (persistence phễu freemium): tỉ lệ phễu MỚI cho
-- public.benchmarks và public.phase_assumptions.
-- Hai bảng này ở 0017 khai tỉ lệ phễu là CỘT PHẲNG (view_to_visit,
-- visit_to_signup, signup_to_first, first_to_paid — numeric(12,8)).
-- Key MỚI visit_to_freemium / freemium_to_paid chưa có cột thì store-core
-- (whitelist TABLE_COLUMNS) sẽ làm rơi tỉ lệ mới khi ghi/đọc DB và seed
-- sinh từ demo-data sẽ mất tỉ lệ phễu của benchmarks.
-- Cột cũ GIỮ NGUYÊN (engine có fallback đọc key cũ); chỉ THÊM cột mới
-- theo đúng kiểu numeric(12,8) của nhóm tỉ lệ hiện có, idempotent như
-- phần phases ở trên. KHÔNG tạo bảng mới, KHÔNG đổi RLS/policy.
-- ============================================================================

alter table public.benchmarks add column if not exists visit_to_freemium numeric(12,8);
alter table public.benchmarks add column if not exists freemium_to_paid numeric(12,8);
alter table public.phase_assumptions add column if not exists visit_to_freemium numeric(12,8);
alter table public.phase_assumptions add column if not exists freemium_to_paid numeric(12,8);

comment on column public.benchmarks.visit_to_freemium is '0018: tỉ lệ Visit → Freemium, lưu dạng phân số (0–1); cột cũ visit_to_signup/signup_to_first/first_to_paid giữ nguyên cho fallback.';
comment on column public.benchmarks.freemium_to_paid is '0018: tỉ lệ Freemium → Paid, lưu dạng phân số (0–1); cột cũ visit_to_signup/signup_to_first/first_to_paid giữ nguyên cho fallback.';
comment on column public.phase_assumptions.visit_to_freemium is '0018: tỉ lệ Visit → Freemium ghi đè theo Phase × Channel, lưu dạng phân số (0–1); null = kế thừa benchmark; cột cũ giữ nguyên cho fallback.';
comment on column public.phase_assumptions.freemium_to_paid is '0018: tỉ lệ Freemium → Paid ghi đè theo Phase × Channel, lưu dạng phân số (0–1); null = kế thừa benchmark; cột cũ giữ nguyên cho fallback.';
