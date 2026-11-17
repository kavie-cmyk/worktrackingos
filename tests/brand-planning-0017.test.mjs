// 0017 — Brand + Planning lên dữ liệu thật:
//  - store-core có ánh xạ bảng + cột cho brands/benchmarks/plan_rows/
//    phase_assumptions và các cột 0017 trên phases/campaigns/kpis/budget_lines.
//  - Ánh xạ hai chiều (toDbPayload → fromDbRow) không rớt field của demo
//    cho các collection mới + field Brand/Phase trên collection cũ.
//  - File migration 0017 + seed sinh tự động tồn tại và khớp số dòng demo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../js/store-core.js');
const demo = require('../js/demo-data.js');

const mig = readFileSync(new URL('../supabase/migrations/0017_brand_planning.sql', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../supabase/seed/from-demo-data.sql', import.meta.url), 'utf8');

test('0017 [store-core]: COLLECTION_TO_TABLE có đủ 4 collection Brand+Planning', () => {
  assert.equal(Core.COLLECTION_TO_TABLE.brands, 'brands');
  assert.equal(Core.COLLECTION_TO_TABLE.benchmarks, 'benchmarks');
  assert.equal(Core.COLLECTION_TO_TABLE.plan_rows, 'plan_rows');
  assert.equal(Core.COLLECTION_TO_TABLE.phase_assumptions, 'phase_assumptions');
  assert.equal(Core.COLLECTION_TO_TABLE.phases, 'phases');
});

test('0017 [store-core]: TABLE_COLUMNS có đủ field bắt buộc của từng bảng mới', () => {
  const need = {
    brands: ['code', 'name', 'tagline', 'description', 'market', 'primary_color', 'color', 'palette', 'voice', 'key_messages', 'funnel_steps', 'status', 'workspace_id', 'created_at', 'updated_at'],
    benchmarks: ['brand_id', 'segment', 'channel', 'channel_group', 'unit_price', 'currency', 'output_per_unit', 'view_to_visit', 'visit_to_signup', 'signup_to_first', 'first_to_paid', 'paid_to_b2b', 'lead_to_account', 'demo_to_account', 'cost_per_result', 'direct_budget', 'confidence', 'source'],
    plan_rows: ['brand_id', 'segment', 'month', 'channel', 'channel_group', 'unit', 'qty', 'audience', 'b2b_split_pct', 'unit_price', 'budget', 'objective', 'phase_id'],
    phase_assumptions: ['phase_id', 'channel', 'view_to_visit', 'visit_to_signup', 'signup_to_first', 'first_to_paid', 'top_funnel_override'],
    phases: ['brand_id', 'segment', 'start_month', 'end_month', 'objective', 'uplift_percent_per_month', 'note', 'paid_churn_rate', 'free_churn_rate', 'arppu', 'cogs_per_user', 'fixed_cost', 'opening_free', 'opening_paid', 'b2b_churn_rate', 'arppu_b2b', 'cogs_per_b2b_account', 'opening_b2b'],
    campaigns: ['brand_id', 'segment'],
    kpis: ['brand_id', 'segment', 'phase_id', 'period_key', 'source'],
    budget_lines: ['brand_id', 'segment']
  };
  for (const [table, cols] of Object.entries(need)) {
    for (const c of cols) assert.ok(Core.hasColumn(table, c), table + ' thiếu cột ' + c);
  }
});

test('0017 [migration]: file 0017 tạo 4 bảng mới + ALTER phases/campaigns/kpis/budget_lines + RLS/policy', () => {
  for (const t of ['brands', 'benchmarks', 'plan_rows', 'phase_assumptions']) {
    assert.match(mig, new RegExp('create table if not exists public\\.' + t + ' '), 'thiếu create table ' + t);
    assert.match(mig, new RegExp("'" + t + "'"), 'thiếu RLS/policy cho ' + t);
  }
  assert.match(mig, /alter table public\.phases add column if not exists brand_id/);
  assert.match(mig, /alter table public\.phases add column if not exists paid_churn_rate/);
  assert.match(mig, /alter table public\.phases add column if not exists opening_paid/);
  assert.match(mig, /phases_scope_check/);
  assert.match(mig, /alter table public\.campaigns add column if not exists brand_id/);
  assert.match(mig, /alter table public\.kpis add column if not exists phase_id/);
  assert.match(mig, /alter table public\.budget_lines add column if not exists brand_id/);
  // Field B2B CHÍNH THỨC (Zac duyệt 17/11/2026) phải có ngay trong migration.
  assert.match(mig, /audience\s+text check \(audience is null or audience in \('b2c', 'b2b', 'both'\)\)/);
  assert.match(mig, /b2b_split_pct numeric\(9,4\)/);
  assert.match(mig, /paid_to_b2b\s+numeric\(12,8\)/);
  assert.match(mig, /lead_to_account numeric\(12,8\)/);
  assert.match(mig, /demo_to_account numeric\(12,8\)/);
  assert.match(mig, /b2b_churn_rate numeric\(9,6\)/);
  assert.match(mig, /arppu_b2b numeric\(18,2\)/);
  assert.match(mig, /cogs_per_b2b_account numeric\(18,2\)/);
  assert.match(mig, /opening_b2b numeric\(18,2\)/);
  assert.match(mig, /b2b_account/);
});

function roundTrip(collection, item) {
  const payload = Core.toDbPayload(collection, item, { forInsert: true, workspaceId: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6' });
  const back = Core.fromDbRow(collection, payload);
  return { payload, back };
}

test('0017 [round-trip]: brands — mọi field demo sống sót qua ánh xạ hai chiều', () => {
  for (const b of demo.brands) {
    const { payload, back } = roundTrip('brands', b);
    assert.equal(payload.name, b.name);
    assert.deepEqual(payload.palette, b.palette);
    assert.deepEqual(payload.key_messages, b.key_messages);
    assert.deepEqual(payload.funnel_steps, b.funnel_steps);
    assert.equal(back.primaryColor, b.primary_color);
    assert.equal(back.color, b.color);
    assert.deepEqual(back.keyMessages, b.key_messages);
    assert.deepEqual(back.funnelSteps, b.funnel_steps);
  }
});

test('0017 [round-trip]: benchmarks — tỉ lệ funnel + cost_per_result jsonb + group→channel_group', () => {
  for (const b of demo.benchmarks) {
    const { payload, back } = roundTrip('benchmarks', b);
    assert.equal(payload.brand_id, b.brand_id);
    assert.equal(payload.channel_group, b.group);
    assert.equal(payload.unit_price, b.unit_price);
    assert.equal(payload.view_to_visit, b.view_to_visit);
    assert.equal(payload.first_to_paid, b.first_to_paid);
    assert.deepEqual(payload.cost_per_result || {}, b.cost_per_result || {});
    assert.equal(back.group, b.group, 'fromDbRow phải khôi phục field group từ channel_group');
    assert.equal(back.brandId, b.brand_id);
    assert.deepEqual(back.costPerResult || {}, b.cost_per_result || {});
  }
});

test('0017 [round-trip]: plan_rows — qty/unit_price/budget/objective/phase_id/group', () => {
  const sample = demo.plan_rows.filter((r) => r.budget != null).slice(0, 5)
    .concat(demo.plan_rows.filter((r) => r.qty != null).slice(0, 5));
  for (const r of sample) {
    const { payload, back } = roundTrip('plan_rows', r);
    assert.equal(payload.brand_id, r.brand_id);
    assert.equal(payload.month, r.month);
    assert.equal(payload.channel_group, r.group);
    assert.equal(payload.qty, r.qty);
    assert.equal(payload.budget, r.budget);
    assert.equal(payload.objective ?? null, r.objective ?? null);
    assert.equal(payload.phase_id, r.phase_id);
    assert.equal(back.group, r.group);
    assert.equal(back.phaseId, r.phase_id);
  }
  // Field B2B chính thức (demo chưa có dữ liệu — ánh xạ phải sẵn sàng):
  const b2bRow = Object.assign({}, demo.plan_rows.find((r) => r.budget != null), { audience: 'both', b2b_split_pct: 30 });
  const b2bPayload = roundTrip('plan_rows', b2bRow).payload;
  assert.equal(b2bPayload.audience, 'both');
  assert.equal(b2bPayload.b2b_split_pct, 30);
  const b2bBench = Object.assign({}, demo.benchmarks[0], { paid_to_b2b: 0.01, lead_to_account: 0.2, demo_to_account: 0.5, cost_per_result: { signup: 1000, b2b_account: 5000000 } });
  const bbPayload = roundTrip('benchmarks', b2bBench).payload;
  assert.equal(bbPayload.paid_to_b2b, 0.01);
  assert.equal(bbPayload.lead_to_account, 0.2);
  assert.equal(bbPayload.demo_to_account, 0.5);
  assert.equal(bbPayload.cost_per_result.b2b_account, 5000000);
  // Dòng có unit_price đặt tay (app ghi khi sửa Đơn giá) cũng phải qua được.
  const manual = Object.assign({}, demo.plan_rows[0], { unit_price: 123456 });
  assert.equal(roundTrip('plan_rows', manual).payload.unit_price, 123456);
});

test('0017 [round-trip]: phase_assumptions + phases Brand (kèm field tài chính app ghi)', () => {
  for (const p of demo.phase_assumptions) {
    const { payload } = roundTrip('phase_assumptions', p);
    assert.equal(payload.phase_id, p.phase_id);
    assert.equal(payload.channel, p.channel);
    assert.equal(payload.top_funnel_override, p.top_funnel_override);
  }
  for (const ph of demo.phases) {
    const { payload, back } = roundTrip('phases', ph);
    assert.equal(payload.brand_id, ph.brand_id);
    assert.equal(payload.start_month, ph.start_month);
    assert.equal(payload.end_month, ph.end_month);
    assert.equal(payload.uplift_percent_per_month, ph.uplift_percent_per_month);
    assert.equal(back.brandId, ph.brand_id);
  }
  // Field tài chính theo Phase do app ghi (planning operating inputs):
  const fin = Object.assign({}, demo.phases[0], {
    paid_churn_rate: 0.05, free_churn_rate: 0.1, arppu: 99000,
    cogs_per_user: 12000, fixed_cost: 3000000, opening_free: 100, opening_paid: 7
  });
  const finB2b = Object.assign({}, fin, { b2b_churn_rate: 0.03, arppu_b2b: 500000, cogs_per_b2b_account: 120000, opening_b2b: 4 });
  const b2bPhasePayload = roundTrip('phases', finB2b).payload;
  assert.equal(b2bPhasePayload.b2b_churn_rate, 0.03);
  assert.equal(b2bPhasePayload.arppu_b2b, 500000);
  assert.equal(b2bPhasePayload.cogs_per_b2b_account, 120000);
  assert.equal(b2bPhasePayload.opening_b2b, 4);
  const { payload } = roundTrip('phases', fin);
  assert.equal(payload.paid_churn_rate, 0.05);
  assert.equal(payload.arppu, 99000);
  assert.equal(payload.opening_paid, 7);
  // Phase campaign cũ (camelCase) vẫn ánh xạ như trước:
  const camp = { name: 'Giai đoạn 1', campaignId: 'x', startDate: '2026-10-01', endDate: '2026-10-31', status: 'todo' };
  const cp = Core.toDbPayload('phases', camp, {});
  assert.equal(cp.campaign_id, 'x');
  assert.equal(cp.start_date, '2026-10-01');
});

test('0017 [round-trip]: campaigns/kpis/budget_lines giữ brand_id + segment (+ phase_id/period_key/source của kpis)', () => {
  for (const c of demo.campaigns) {
    const { payload } = roundTrip('campaigns', c);
    assert.equal(payload.brand_id, c.brand_id);
    assert.equal(payload.segment, c.segment);
  }
  for (const k of demo.kpis) {
    const { payload } = roundTrip('kpis', k);
    assert.equal(payload.brand_id, k.brand_id);
    assert.equal(payload.segment, k.segment);
    assert.equal(payload.phase_id, k.phase_id);
    assert.equal(payload.period_key, k.periodKey);
    assert.equal(payload.source, k.source);
  }
  for (const b of demo.budgetLines) {
    const { payload } = roundTrip('budgetLines', b);
    assert.equal(payload.brand_id, b.brand_id);
    assert.equal(payload.segment, b.segment);
  }
});

test('0017 [seed]: số INSERT trong seed khớp số dòng demo từng bảng + có 4 truy vấn số neo', () => {
  const count = (t) => (seed.match(new RegExp('^insert into public\\.' + t + ' ', 'gm')) || []).length;
  const expect = {
    brands: demo.brands.length, campaigns: demo.campaigns.length, phases: demo.phases.length,
    activities: demo.activities.length, content_pillars: demo.contentPillars.length,
    brand_pages: demo.brandPages.length, assets: demo.brandAssets.length, asset_versions: demo.brandAssets.length,
    channel_accounts: demo.channelAccounts.length, content_items: demo.contentItems.length,
    content_variants: demo.variants.length, external_posts: demo.externalPosts.length,
    metric_observations: demo.metricObservations.length, budget_lines: demo.budgetLines.length,
    kpis: demo.kpis.length, tasks: demo.tasks.length, ad_accounts: demo.adAccounts.length,
    ads_change_requests: demo.adChangeRequests.length, marketing_requests: demo.marketingRequests.length,
    cash_accounts: demo.cashAccounts.length, cash_transactions: demo.cashTransactions.length,
    report_snapshots: demo.reportSnapshots.length, benchmarks: demo.benchmarks.length,
    plan_rows: demo.plan_rows.length, phase_assumptions: demo.phase_assumptions.length,
    bu_products: demo.businessUnits.reduce((s, u) => s + u.products.length, 0)
  };
  for (const [t, n] of Object.entries(expect)) assert.equal(count(t), n, 'seed lệch số dòng bảng ' + t);
  // Workspace đích ở mọi INSERT:
  assert.ok(!/^insert into public\.\w+ \([^)]*\) values \((?!.*a0870eed-cbdc-4fde-a3da-0b09d83d83b6)/m.test(seed.replace(/^insert into public\.asset_versions .*$/gm, '')), 'có INSERT thiếu workspace đích (trừ asset_versions)');
  // 4 số neo ở phần kiểm chứng cuối file:
  assert.match(seed, /776 as ky_vong/);
  assert.match(seed, /1598700000 as ky_vong/);
  assert.match(seed, /51539000 as ky_vong/);
  assert.match(seed, /115 as ky_vong/);
  // Tiền điều kiện đầu file:
  assert.match(seed, /TIỀN ĐIỀU KIỆN/);
  assert.match(seed, /SINH TỰ ĐỘNG, KHÔNG SỬA TAY/);
});
