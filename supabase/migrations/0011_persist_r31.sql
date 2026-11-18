-- ============================================================================
-- SAVA Marketing Workspace — 0011_persist_r31.sql (vòng R3.1 bổ sung)
-- Persist THẬT 2 field trước đây chỉ lưu tạm qua custom_fields / bị rơi:
--   kpis.direction                    — chiều tốt lên của KPI (UI Action Plan)
--   campaigns.budget_ceiling_amount   — hạn mức ngân sách campaign (C.2)
--   campaigns.budget_ceiling_currency — tiền tệ của hạn mức
-- Schema đi tiến, IDEMPOTENT: chạy lại không lỗi, không trùng (AC20).
-- Đã đối chiếu schema LIVE 12/11/2026 (project nlbtjtubihxbkigdfpdg,
-- information_schema): kpis CHƯA có direction; campaigns CHƯA có
-- budget_ceiling_amount / budget_ceiling_currency — cả 3 đều cần thêm.
-- RLS: cột mới trên bảng cũ nên policy sẵn có ở 0002/0009 bao phủ, không
-- cần policy mới.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- a. kpis: direction — 'increase' (càng cao càng tốt) / 'decrease' (càng
--    thấp càng tốt). Nullable: KPI cũ chưa khai chiều thì để null, UI tự
--    mặc định 'increase' khi hiển thị (js/app.js form KPI).
-- ----------------------------------------------------------------------------
alter table public.kpis add column if not exists direction text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='kpis_direction_check') then
    alter table public.kpis add constraint kpis_direction_check
      check (direction is null or direction in ('increase','decrease'));
  end if;
end $$;
comment on column public.kpis.direction is 'R3.1: chiều tốt lên của KPI — increase = càng cao càng tốt, decrease = càng thấp càng tốt. Trước đây UI lưu tạm/bị rơi vì chưa có cột thật.';

-- ----------------------------------------------------------------------------
-- b. campaigns: hạn mức ngân sách ở cấp campaign (C.2) — dữ liệu thật,
--    KHÔNG để mãi trong custom_fields. amount numeric(18,2) như các cột
--    tiền khác (budget_lines.planned_amount…); currency text nullable
--    như ads_change_requests/metric_observations (UI dùng VND/USD).
-- ----------------------------------------------------------------------------
alter table public.campaigns add column if not exists budget_ceiling_amount numeric(18,2);
alter table public.campaigns add column if not exists budget_ceiling_currency text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='campaigns_budget_ceiling_nonneg') then
    alter table public.campaigns add constraint campaigns_budget_ceiling_nonneg
      check (budget_ceiling_amount is null or budget_ceiling_amount >= 0);
  end if;
end $$;
comment on column public.campaigns.budget_ceiling_amount is 'R3.1/C.2: hạn mức ngân sách được duyệt ở cấp campaign — khác tổng phân bổ xuống hoạt động. Model field ở frontend: budgetCeiling.';
comment on column public.campaigns.budget_ceiling_currency is 'R3.1/C.2: tiền tệ của hạn mức campaign (VND/USD). Model field ở frontend: budgetCeilingCurrency.';
