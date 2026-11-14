-- ============================================================================
-- SAVA Marketing Workspace — 0007_metric_observations_content_variant.sql
-- (vòng sửa QA R1, bổ sung theo gap R16 do nhóm Store xác minh)
--
-- Vấn đề: CHECK metric_observations_object_type_check ở 0001 chỉ cho
-- object_type in ('external_post','channel_account','campaign','ad_account',
-- 'ad_campaign','ad_group','ad') — CHƯA có 'content_variant'. Nhánh R16
-- "video TikTok chưa có bài đăng ngoài nền tảng -> lưu metric dạng
-- observation nội bộ gắn vào content_variant" (store: saveTiktokMetrics
-- dùng object_type='content_variant', object_id = variant UUID, source
-- 'manual') bị DB từ chối với lỗi 23514 (check_violation).
--
-- Sửa: nới CHECK thêm 'content_variant'. object_id khi object_type =
-- 'content_variant' là UUID của content_variants (dạng text, khớp quy ước
-- cột object_id hiện hữu). Đây là observation NỘI BỘ, không giả danh
-- channel_account/external_post — khi video có external_post thật, metric
-- đi theo object_type='external_post' như bình thường.
-- Idempotent (drop if exists + add).
-- ============================================================================

alter table public.metric_observations
  drop constraint if exists metric_observations_object_type_check;

alter table public.metric_observations
  add constraint metric_observations_object_type_check
  check (object_type in (
    'external_post', 'channel_account', 'campaign', 'ad_account',
    'ad_campaign', 'ad_group', 'ad', 'content_variant'
  ));

comment on constraint metric_observations_object_type_check on public.metric_observations is
  'object_type hợp lệ; content_variant (R16, thêm ở 0007) = observation nội bộ gắn variant khi chưa có external_post — object_id là UUID của content_variants.';
