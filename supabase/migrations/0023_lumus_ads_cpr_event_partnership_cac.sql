-- 0023 — Lumus 2027: cost_per_result cho Paid Ads + CAC b2b_account cho
-- Event/Partnership theo bản draft team gửi (Zac duyệt 21/11/2026).
--
-- Vì sao cần migration: field cost_per_result nằm trên benchmark cấp kênh,
-- giao diện app CHƯA có chỗ nhập/sửa field này (số hiện tại do seed nạp:
-- Meta traffic 20.000 / signup 222.222, TikTok traffic 22.000 /
-- signup 244.444, Awareness + Google + LinkedIn chưa có). Tỉ lệ phễu Ads
-- (view_to_visit / visit_to_freemium / freemium_to_paid) ĐÃ đặt qua
-- phase_assumptions trong app nên migration này KHÔNG đụng vào tỉ lệ.
--
-- Giá trị mới (VNĐ/kết quả), suy từ phễu Paid_Ads_Input của draft
-- (CPM/CTR/CVR theo nền tảng, quy đổi 26.000đ/$) và ĐÃ chia cho hệ số
-- bứt phá bình quân gia quyền theo ngân sách của từng nền tảng
-- (Meta ÷1,4836; TikTok ÷1,5227; Google ÷1,4157; LinkedIn ÷1,2651)
-- theo yêu cầu của Zac "áp cả hệ số bứt phá":
--   Meta Ads:    awareness 202 (=299/1,4836), traffic 6.298
--                (=9.343,75/1,4836), signup 24.223 (=35.937,5/1,4836).
--                remarketing GIỮ NGUYÊN 8.080.808 (draft không có).
--   TikTok Ads:  awareness 184, traffic 5.269, signup 21.075.
--   Google Search B2B: lead_gen 40.447 (=57.261,9/1,4157).
--   LinkedIn Ads B2B:  demo 73.621 (=93.134,87/1,2651).
--   Event (5 kênh):      b2b_account 178.617 (= ngân sách draft
--                        109.348.200đ / 612,2 accounts).
--   Partnership (10 kênh): b2b_account 368.580 (= 177.840.000đ /
--                        482,5 accounts).
-- Ngân sách Event/Partnership và đơn giá Paid PR sửa trực tiếp trong app,
-- không nằm trong migration này.
--
-- Cách chạy: dán toàn bộ file vào Supabase Dashboard > SQL Editor > Run.
-- Chạy lại an toàn (merge key vào jsonb, ghi cùng giá trị).

-- ===== KIỂM TRA TRƯỚC: giá trị hiện tại của 19 kênh =====
select channel, cost_per_result
from public.benchmarks
where brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null
  and channel in (
    'Meta Ads', 'TikTok Ads', 'Google Search B2B', 'LinkedIn Ads B2B',
    'Biztech (VINASA)', 'ICTComm', 'InnoEx', 'Tech4Life', 'VIIE',
    'NachoNacho + DealMirror', 'Secret (JoinSecret)', 'Builtfirst',
    'Dealify + Coworking VN #1', 'FounderPass', 'Aspire', 'Volopay',
    'Coworking Space VN #2', 'Coworking Space VN #3', 'Coworking Space VN #4'
  )
order by channel;

-- ===== PAID ADS =====
update public.benchmarks
set cost_per_result = cost_per_result || '{"awareness": 202, "traffic": 6298, "signup": 24223}'::jsonb,
    updated_at = now()
where channel = 'Meta Ads'
  and brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null;

update public.benchmarks
set cost_per_result = cost_per_result || '{"awareness": 184, "traffic": 5269, "signup": 21075}'::jsonb,
    updated_at = now()
where channel = 'TikTok Ads'
  and brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null;

update public.benchmarks
set cost_per_result = cost_per_result || '{"lead_gen": 40447}'::jsonb,
    updated_at = now()
where channel = 'Google Search B2B'
  and brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null;

update public.benchmarks
set cost_per_result = cost_per_result || '{"demo": 73621}'::jsonb,
    updated_at = now()
where channel = 'LinkedIn Ads B2B'
  and brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null;

-- ===== EVENT: CAC b2b_account = 178.617 =====
update public.benchmarks
set cost_per_result = cost_per_result || '{"b2b_account": 178617}'::jsonb,
    updated_at = now()
where channel in ('Biztech (VINASA)', 'ICTComm', 'InnoEx', 'Tech4Life', 'VIIE')
  and brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null;

-- ===== PARTNERSHIP: CAC b2b_account = 368.580 =====
update public.benchmarks
set cost_per_result = cost_per_result || '{"b2b_account": 368580}'::jsonb,
    updated_at = now()
where channel in (
    'NachoNacho + DealMirror', 'Secret (JoinSecret)', 'Builtfirst',
    'Dealify + Coworking VN #1', 'FounderPass', 'Aspire', 'Volopay',
    'Coworking Space VN #2', 'Coworking Space VN #3', 'Coworking Space VN #4'
  )
  and brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null;

-- ===== KIỂM TRA SAU: phải thấy đủ 19 kênh với giá trị mới =====
-- Meta Ads: awareness 202 / traffic 6298 / signup 24223 / remarketing 8080808 (giữ nguyên)
-- TikTok Ads: awareness 184 / traffic 5269 / signup 21075
-- Google Search B2B: lead_gen 40447 | LinkedIn Ads B2B: demo 73621
-- 5 kênh Event: b2b_account 178617 | 10 kênh Partnership: b2b_account 368580
select channel, cost_per_result
from public.benchmarks
where brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and archived_at is null
  and channel in (
    'Meta Ads', 'TikTok Ads', 'Google Search B2B', 'LinkedIn Ads B2B',
    'Biztech (VINASA)', 'ICTComm', 'InnoEx', 'Tech4Life', 'VIIE',
    'NachoNacho + DealMirror', 'Secret (JoinSecret)', 'Builtfirst',
    'Dealify + Coworking VN #1', 'FounderPass', 'Aspire', 'Volopay',
    'Coworking Space VN #2', 'Coworking Space VN #3', 'Coworking Space VN #4'
  )
order by channel;
