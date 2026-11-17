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
