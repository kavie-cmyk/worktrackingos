-- ============================================================================
-- SAVA Marketing Workspace — 0013_commitments_idempotency.sql (vá P2)
-- Schema đi tiến, IDEMPOTENT: chạy lại không lỗi, không trùng.
-- Lỗi vá: budget_commitments chưa có idempotency_key/unique — double-click
-- hoặc client retry khi tạo cam kết sinh 2 dòng trùng, làm số cam kết mở
-- nhân đôi ở cả JS lẫn SQL.
-- Mẫu áp dụng ĐÚNG như budget_actuals và cash_transactions ở 0009:
--   cột text nullable + UNIQUE partial index trên (workspace_id,
--   idempotency_key) WHERE idempotency_key IS NOT NULL.
-- Không đổi dữ liệu/số liệu domain nào khác.
-- ============================================================================

alter table public.budget_commitments add column if not exists idempotency_key text;
comment on column public.budget_commitments.idempotency_key is 'P2/AC09: khóa chống double-submit/retry ở backend (unique theo workspace khi not null).';
create unique index if not exists budget_commitments_idempotency_uidx
  on public.budget_commitments (workspace_id, idempotency_key) where idempotency_key is not null;
