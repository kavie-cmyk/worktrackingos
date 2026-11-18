-- ============================================================================
-- SAVA Marketing Workspace — 0019_views_uplift.sql
-- Uplift Views riêng cho Phase: bổ sung cột views_uplift_percent_per_month
-- cho public.phases — % tăng trưởng/tháng áp vào VIEWS MỖI BÀI của các
-- dòng Content trong forecast Planning, chạy song song với
-- uplift_percent_per_month (áp vào tỉ lệ chuyển đổi) của 0017.
-- CHỈ là mã nguồn trong repo — CHƯA áp lên production khi file này được
-- commit. Migration này CHỈ thêm cột vào bảng cũ public.phases, KHÔNG tạo
-- bảng mới và KHÔNG đổi RLS/policy (cột mới nằm trên bảng đã có RLS).
-- Idempotent theo mẫu 0017/0018: add column if not exists.
--
-- CỘT MỚI TRÊN public.phases:
--  views_uplift_percent_per_month numeric(9,4) — cùng kiểu với
--  uplift_percent_per_month của 0017; lưu dạng SỐ PHẦN TRĂM 0–100
--  (vd 10 = +10%/tháng) như uplift_percent_per_month, KHÔNG lưu dạng
--  phân số. null = không tăng trưởng (hệ số 1). Engine chỉ áp cho
--  đường Content (dòng có qty): views mỗi bài hiệu dụng = views mỗi
--  bài gốc x (1 + vu/100)^n với n = số tháng từ tháng đầu Phase tới
--  tháng của dòng (cùng n với uplift tỉ lệ). KHÔNG áp cho dòng
--  budget-driven (Paid Media theo Objective / Partnership / Event —
--  views suy từ ngân sách), KHÔNG áp vào qty và KHÔNG áp vào tỉ lệ
--  chuyển đổi (uplift tỉ lệ giữ nguyên hành vi).
-- ============================================================================

alter table public.phases add column if not exists views_uplift_percent_per_month numeric(9,4);

comment on column public.phases.views_uplift_percent_per_month is '0019: uplift Views %/tháng áp vào Views mỗi bài (đường Content) theo (1+vu)^n từ tháng đầu phase; lưu dạng % 0–100 như uplift_percent_per_month; null = không tăng trưởng.';
