-- ============================================================================
-- SAVA Marketing Workspace — 0012_kpi_ratio.sql (vòng R3.1 bổ sung nhỏ)
-- Persist THẬT 2 field của KPI ratio trước đây bị rơi ở chế độ Supabase:
--   kpis.numerator   — tử số của KPI ratio (vd tổng chi phí cho CPL)
--   kpis.denominator — mẫu số của KPI ratio (vd số đăng ký hợp lệ cho CPL)
-- Form KPI (js/app.js) đã lưu numerator/denominator vào model KPI và
-- domain.rollupKpi đọc hai field này để tính ratio/CPL, nhưng bảng kpis
-- chưa có cột thật và kpis KHÔNG có custom_fields nên store-core loại
-- cả hai khỏi payload khi ghi Supabase (đặc tả C.8: mọi field cho nhập
-- phải được lưu thật).
-- Schema đi tiến, IDEMPOTENT: chạy lại không lỗi, không trùng.
-- Đã đối chiếu schema LIVE 12/11/2026 (project nlbtjtubihxbkigdfpdg,
-- information_schema): kpis có 26 cột, ĐÃ có direction (0011) nhưng
-- CHƯA có numerator / denominator và KHÔNG có custom_fields.
-- RLS: cột mới trên bảng cũ nên policy sẵn có ở 0002/0009 bao phủ, không
-- cần policy mới.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- kpis: numerator / denominator — numeric(18,4) nullable.
-- Nullable: KPI không phải ratio (hoặc ratio chưa khai tử/mẫu) thì để
-- null; rollupKpi tự trả insufficient_data khi thiếu một trong hai
-- hoặc mẫu số bằng 0, không cần CHECK chặn ở DB. Độ chính xác 4 chữ số
-- thập phân đủ cho cả tử số tiền lớn và mẫu số/tỉ lệ có phần lẻ.
-- ----------------------------------------------------------------------------
alter table public.kpis add column if not exists numerator numeric(18,4);
alter table public.kpis add column if not exists denominator numeric(18,4);
comment on column public.kpis.numerator is 'R3.1/C.8: tử số của KPI aggregation_mode=ratio (vd tổng chi phí của đúng scope đã khai). Model field ở frontend: numerator. Trước đây bị store-core loại khỏi payload vì chưa có cột thật và kpis không có custom_fields.';
comment on column public.kpis.denominator is 'R3.1/C.8: mẫu số của KPI aggregation_mode=ratio (vd số kết quả hợp lệ của cùng scope). Model field ở frontend: denominator. rollupKpi tính ratio = numerator / denominator, không lấy trung bình các tỷ lệ con.';
