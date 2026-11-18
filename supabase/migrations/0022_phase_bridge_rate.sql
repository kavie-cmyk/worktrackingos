-- SAVA Marketing Workspace — 0022_phase_bridge_rate.sql
-- Zac chốt 18/11/2026 23:15–23:17: BỎ cơ chế cầu nối Paid -> B2B theo
-- từng Channel (paid_to_b2b ở benchmarks + phase_assumptions) và bỏ quy
-- đổi lead_to_account / demo_to_account. Cầu nối tính CHUNG theo Phase:
--   B2B Account từ bridge của tháng = b2b_bridge_rate (Phase chứa tháng)
--     x Paid EOM của tháng (sau churn, trước khi trừ bridge),
--   lượng bridge vẫn BỊ TRỪ khỏi Paid EOM như quy tắc 18/11.
-- Cột tỉ lệ dạng phân số numeric(9,6) như paid_churn_rate/free_churn_rate.
-- NULL = chưa đặt -> bridge = 0. Các cột paid_to_b2b / lead_to_account /
-- demo_to_account ở benchmarks + phase_assumptions GIỮ NGUYÊN trong DB
-- (dormant, engine không đọc nữa) để không mất dữ liệu lịch sử.
alter table public.phases
  add column if not exists b2b_bridge_rate numeric(9,6);

comment on column public.phases.b2b_bridge_rate is
  'Ti le Paid B2C -> B2B Account tinh tren Paid EOM moi thang (phan so, vd 0.01 = 1%). Zac chot 18/11/2026.';
