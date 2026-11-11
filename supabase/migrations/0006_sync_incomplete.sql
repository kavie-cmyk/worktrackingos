-- ============================================================================
-- SAVA Marketing Workspace — 0006_sync_incomplete.sql (vòng sửa QA R1)
-- R29: sync_runs có trạng thái 'incomplete' riêng cho lần chạy CHƯA lấy hết
-- trang (còn next cursor) — phân biệt với 'succeeded' (đã lấy hết) và
-- 'partial' (lỗi một phần metric). sync-worker ghi 'incomplete' + giữ cursor
-- để lần chạy sau resume, KHÔNG cập nhật mốc hoàn thành (last_period_end)
-- cho tới khi lấy hết. Idempotent.
-- ============================================================================

alter table public.sync_runs drop constraint if exists sync_runs_status_check;
alter table public.sync_runs add constraint sync_runs_status_check
  check (status in ('running', 'succeeded', 'partial', 'failed', 'waiting_connection', 'not_connected', 'incomplete'));
