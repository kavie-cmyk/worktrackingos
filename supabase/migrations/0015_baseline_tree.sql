-- 0015 — Baseline cho phase/activity (chốt baseline CẢ CÂY campaign).
--
-- TRẠNG THÁI: ĐÃ ÁP LÊN DB LIVE 13/11/2026 (coordinator áp qua Management
-- API sau khi QA độc lập rà soát kết luận an toàn; áp 2 lần đều HTTP 201 —
-- idempotent; smoke test ghi/đọc baseline trên phases + activities đạt,
-- dữ kiện thử đã dọn, production sạch).
--
-- LÝ DO BẮT BUỘC CÓ MIGRATION NÀY: bảng phases/activities hiện KHÔNG có
-- cột baseline và KHÔNG có custom_fields (xem 0001_schema.sql), nên
-- baseline của phase/activity không có chỗ lưu ở remote — store-core
-- loại trường lạ khỏi payload, ghi qua REST sẽ lặng lẽ mất baseline.
-- Campaigns đã có sẵn cột baseline jsonb (0001) và tasks có custom_fields
-- nên hai loại đó chốt được ngay không cần migration này.
--
-- Nội dung: thêm cột baseline jsonb {start_date, end_date} cho phases và
-- activities — đúng khuôn campaigns.baseline. Không bảng mới, không RPC,
-- không đổi RLS (policy theo bảng đã phủ cột mới). An toàn chạy lại
-- (if not exists), không đụng dữ liệu hiện có; rollback = drop column.

alter table public.phases
  add column if not exists baseline jsonb not null default '{}'::jsonb;

alter table public.activities
  add column if not exists baseline jsonb not null default '{}'::jsonb;

comment on column public.phases.baseline is
  '0015: mốc lịch đã chốt của phase {start_date, end_date} — ghi qua hành động Chốt baseline cả cây ở campaign.';
comment on column public.activities.baseline is
  '0015: mốc lịch đã chốt của activity {start_date, end_date} — ghi qua hành động Chốt baseline cả cây ở campaign.';
