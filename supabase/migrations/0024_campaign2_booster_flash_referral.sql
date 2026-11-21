-- 0024 — Lumus 2027: thêm dòng ngân sách chương trình "Campaign 2 Booster —
-- Flash Referral" (Zac chốt 21/11/2026).
--
-- Cách ghi Zac chốt: ngân sách CHƯƠNG TRÌNH 100.000.000đ thuộc Campaign 2,
-- T10/2027 = 50.000.000đ và T11/2027 = 50.000.000đ; KHÔNG gắn vào đơn giá
-- kênh Referral (đơn giá Referral giữ nguyên 52.000đ/lượt) và không sinh
-- phễu (hiệu quả đã nằm trong sản lượng Referral T10/T11). Khi thực chi:
-- tách tiền mặt CPA KOL và COGS tháng tặng người dùng.
--
-- Cách làm: clone benchmark của kênh Referral (cùng workspace/brand/group)
-- với mọi tỉ lệ + cost_per_result để trống -> forecast = 0 ở mọi tầng;
-- clone dòng plan của Referral ở 2027-10 và 2027-11, đổi thành ngân sách
-- trực tiếp 50.000.000đ/tháng. Chạy lại an toàn (có guard NOT EXISTS).
--
-- Cách chạy: dán toàn bộ file vào Supabase Dashboard > SQL Editor > Run
-- (project sava-marketing-workspace).

-- ===== KIỂM TRA TRƯỚC: kênh mới chưa tồn tại =====
select 'benchmark' as loai, channel from public.benchmarks
where channel = 'Campaign 2 Booster — Flash Referral' and archived_at is null
union all
select 'plan_row', channel || ' ' || month from public.plan_rows
where channel = 'Campaign 2 Booster — Flash Referral' and archived_at is null;

-- ===== 1. BENCHMARK (clone từ Referral, xoá mọi tỉ lệ/đơn giá) =====
insert into public.benchmarks (
  workspace_id, brand_id, segment, channel, channel_group, unit_price,
  currency, output_per_unit, view_to_visit, visit_to_signup, signup_to_first,
  first_to_paid, paid_to_b2b, lead_to_account, demo_to_account,
  visit_to_freemium, freemium_to_paid, cost_per_result, direct_budget,
  confidence, source
)
select
  b.workspace_id, b.brand_id, 'b2c', 'Campaign 2 Booster — Flash Referral',
  b.channel_group, null, 'VND', null, null, null, null, null, null, null,
  null, null, null, '{}'::jsonb, true, 'B — theo draft',
  'Ngân sách chương trình Campaign 2 (draft Lumus, Zac chốt 21/11/2026): Flash Referral 50trđ/tháng ở T10+T11/2027; không gắn đơn giá kênh Referral; không sinh phễu. Thực chi tách: tiền mặt CPA KOL và COGS tháng tặng người dùng.'
from public.benchmarks b
where b.channel = 'Referral'
  and b.brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
  and b.archived_at is null
  and not exists (
    select 1 from public.benchmarks x
    where x.channel = 'Campaign 2 Booster — Flash Referral'
      and x.brand_id = b.brand_id and x.archived_at is null
  )
limit 1;

-- ===== 2. PLAN ROWS T10 + T11 (clone từ Referral cùng tháng) =====
insert into public.plan_rows (
  workspace_id, brand_id, segment, month, channel, channel_group, unit,
  qty, audience, b2b_split_pct, unit_price, budget, objective, phase_id,
  campaign_id, activity_id
)
select
  r.workspace_id, r.brand_id, r.segment, r.month,
  'Campaign 2 Booster — Flash Referral', r.channel_group, 'Gói', 1,
  r.audience, null, null, 50000000, null, r.phase_id, null, null
from (
  select distinct on (month) *
  from public.plan_rows
  where channel = 'Referral'
    and month in ('2027-10', '2027-11')
    and brand_id = (select id from public.brands where name ilike '%Lumus%' order by created_at limit 1)
    and archived_at is null
  order by month, created_at
) r
where not exists (
  select 1 from public.plan_rows x
  where x.channel = 'Campaign 2 Booster — Flash Referral'
    and x.month = r.month and x.brand_id = r.brand_id
    and x.archived_at is null
);

-- ===== KIỂM TRA SAU: benchmark 1 dòng + 2 plan rows 50.000.000 =====
select channel, segment, channel_group, direct_budget, cost_per_result
from public.benchmarks
where channel = 'Campaign 2 Booster — Flash Referral' and archived_at is null;

select month, channel, qty, unit_price, budget
from public.plan_rows
where channel = 'Campaign 2 Booster — Flash Referral' and archived_at is null
order by month;
