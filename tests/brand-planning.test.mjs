// tests/brand-planning.test.mjs
// Brand + Planning (bản bấm thử 17/11/2026) — Executor A (dữ liệu + domain).
// Bao phủ: demo-data (brands/benchmarks/plan_rows), 4 hàm thuần domain
// (summarizePlanByMonth / summarizePlanByChannel / forecastFunnel /
// planBudget) và hợp đồng store cho 3 collection mới.
// Số neo bắt buộc: forecast KOL Nano 2027-01 (qty 4) và planBudget T1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const core = require('../js/store-core.js');
const Store = require('../js/store.js');

const EPS = 1e-9;
function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

const nanoJan = demo.plan_rows.find((r) => r.channel === 'KOL Nano' && r.month === '2027-01');
// Seed SAVA CAMP 01 (17/11): plan_rows nay gồm cả 21 dòng SAVA META 2026-10/11 —
// các neo FY2027 dưới đây lọc đúng brand-lumus-ai (144 dòng) thay vì toàn bộ plan_rows.
const lumusRows = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');

// ---------------------------------------------------------------- demo-data
test('BP [demo]: 2 brands với identity + funnel steps đúng mô hình', () => {
  assert.equal(demo.brands.length, 2);
  const sava = demo.brands.find((b) => b.name === 'SAVA META');
  const lumus = demo.brands.find((b) => b.name === 'Lumus AI');
  assert.ok(sava && lumus);
  for (const b of demo.brands) {
    assert.ok(b.primary_color && Array.isArray(b.palette) && b.palette.length >= 2);
    assert.ok(b.tagline && b.description && b.market && b.voice);
    assert.ok(Array.isArray(b.key_messages) && b.key_messages.length >= 1);
    assert.ok(Array.isArray(b.funnel_steps) && b.funnel_steps.length >= 4);
  }
  assert.deepEqual(lumus.funnel_steps, ['Reach', 'Visit', 'Signup', 'First', 'Paid']);
  assert.deepEqual(sava.funnel_steps, ['Reach', 'Follow', 'Participation', 'Lead', 'Application']);
});

test('BP [demo]: benchmarks KOL đúng số 03 Inputs; Paid Ads là direct budget', () => {
  const byChannel = Object.fromEntries(demo.benchmarks.map((b) => [b.channel, b]));
  assert.equal(byChannel['KOL Nano'].unit_price, 1500000);
  assert.equal(byChannel['KOL Nano'].output_per_unit, 4000);
  approx(byChannel['KOL Nano'].view_to_visit, 0.003, 'nano v2v');
  assert.equal(byChannel['KOL Micro'].unit_price, 5500000);
  assert.equal(byChannel['KOL Micro'].output_per_unit, 15000);
  approx(byChannel['KOL Micro'].view_to_visit, 0.004, 'micro v2v');
  assert.equal(byChannel['KOL Expert'].unit_price, 30000000);
  assert.equal(byChannel['KOL Expert'].output_per_unit, 25000);
  approx(byChannel['KOL Expert'].view_to_visit, 0.005, 'expert v2v');
  // Chuỗi hạ nguồn dùng chung trong file nguồn cho cả 3 KOL.
  for (const ch of ['KOL Nano', 'KOL Micro', 'KOL Expert']) {
    approx(byChannel[ch].visit_to_signup, 0.09, `${ch} v2s`);
    approx(byChannel[ch].signup_to_first, 0.5, `${ch} s2f`);
    approx(byChannel[ch].first_to_paid, 0.055, `${ch} f2p`);
    assert.equal(byChannel[ch].brand_id, 'brand-lumus-ai');
  }
  for (const ch of ['Meta Ads', 'TikTok Ads']) {
    assert.equal(byChannel[ch].unit_price, null);
    assert.equal(byChannel[ch].direct_budget, true);
  }
});

test('BP [demo]: plan_rows Lumus đủ ma trận 12 tháng x 12 channel = 144 dòng, tổng FY khớp file nguồn', () => {
  assert.equal(lumusRows.length, 144);
  const months = [...new Set(lumusRows.map((r) => r.month))].sort();
  assert.deepEqual(months, Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`));
  const total = (ch) => lumusRows.filter((r) => r.channel === ch).reduce((a, r) => a + (r.qty || 0), 0);
  assert.equal(total('KOL Nano'), 65);
  assert.equal(total('KOL Micro'), 60);
  assert.equal(total('KOL Expert'), 12);
  assert.equal(total('Facebook Owned'), 244);
  assert.equal(total('TikTok Owned'), 104);
  assert.equal(total('LinkedIn Owned'), 104);
  assert.equal(total('Website Articles'), 130);
  assert.equal(total('Email Sends'), 24);
  assert.equal(total('B2B Event'), 6);
  assert.equal(total('Paid Community'), 27);
  // Tháng qty = 0 vẫn có row (KOL Expert T6) để lưới đủ 12 cột.
  assert.equal(demo.plan_rows.find((r) => r.channel === 'KOL Expert' && r.month === '2027-06').qty, 0);
  // Segment: LinkedIn Owned + B2B Event là b2b, còn lại mặc định b2c.
  assert.ok(demo.plan_rows.filter((r) => r.channel === 'LinkedIn Owned').every((r) => r.segment === 'b2b'));
  assert.ok(demo.plan_rows.filter((r) => r.channel === 'B2B Event').every((r) => r.segment === 'b2b'));
  // Paid Ads: budget thẳng, tổng năm = pool USD x FX 26.000.
  const budgetTotal = (ch) => lumusRows.filter((r) => r.channel === ch).reduce((a, r) => a + r.budget, 0);
  assert.equal(budgetTotal('Meta Ads'), 21000 * 26000);
  assert.equal(budgetTotal('TikTok Ads'), 7000 * 26000);
});

test('BP [demo]: campaigns/kpis/budgetLines hiện có gắn brand_id + segment; có PLAY/BUILD THE UNKNOWN', () => {
  const play = demo.campaigns.find((c) => c.id === 'camp-play-unknown');
  const build = demo.campaigns.find((c) => c.id === 'camp-build-unknown');
  assert.ok(play && build);
  assert.equal(play.brand_id, 'brand-sava-meta'); assert.equal(play.segment, 'b2c');
  assert.equal(build.brand_id, 'brand-sava-meta'); assert.equal(build.segment, 'b2b');
  assert.ok(demo.campaigns.every((c) => c.brand_id && c.segment));
  assert.ok(demo.kpis.every((k) => k.brand_id && k.segment));
  assert.ok(demo.budgetLines.every((b) => b.brand_id && b.segment));
  assert.ok(demo.kpis.some((k) => k.brand_id === 'brand-lumus-ai'));
  assert.ok(demo.budgetLines.some((b) => b.brand_id === 'brand-lumus-ai'));
});

// ---------------------------------------------------------------- summarize
test('BP [domain]: summarizePlanByMonth đủ 12 tháng + tổng khớp cộng tay', () => {
  const s = domain.summarizePlanByMonth(lumusRows);
  assert.equal(s.months.length, 12);
  assert.equal(s.byMonth['2027-01'].qty, 4 + 4 + 1 + 21 + 9 + 9 + 11 + 2 + 0 + 2); // 63
  assert.equal(s.byMonth['2027-01'].budget, 10920000 + 3640000);
  assert.equal(s.totalQty, 65 + 60 + 12 + 244 + 104 + 104 + 130 + 24 + 6 + 27);
  assert.equal(s.totalBudget, 546000000 + 182000000);
});

test('BP [domain]: summarizePlanByChannel kèm group + tổng theo channel', () => {
  const s = domain.summarizePlanByChannel(lumusRows);
  const nano = s.byChannel['KOL Nano'];
  assert.equal(nano.qty, 65);
  assert.equal(nano.group, 'KOL');
  assert.equal(s.byChannel['Meta Ads'].group, 'Paid Media');
  assert.equal(s.byChannel['Meta Ads'].budget, 546000000);
  assert.equal(s.channels.length, 12);
});

// ---------------------------------------------------------------- forecast
test('BP [domain]: forecastFunnel CA SỐ NEO — KOL Nano 2027-01', () => {
  const f = domain.forecastFunnel([nanoJan], demo.benchmarks);
  const row = f.rows[0];
  assert.ok(row.forecast, 'phải có forecast');
  approx(row.forecast.views, 16000, 'views');       // 4 x 4000
  approx(row.forecast.visits, 48, 'visits');        // x 0,003
  approx(row.forecast.signups, 4.32, 'signups');    // x 0,09
  approx(row.forecast.first, 2.16, 'first');        // x 0,5
  approx(row.forecast.paid, 0.1188, 'paid');        // x 0,055
  approx(f.byMonth['2027-01'].views, 16000, 'byMonth views');
  approx(f.totals.paid, 0.1188, 'totals paid');
  assert.deepEqual(f.steps, ['views', 'visits', 'signups', 'first', 'paid']);
});

test('BP [domain]: forecastFunnel toàn năm — tổng views KOL khớp cộng tay; byMonth đủ 12', () => {
  const f = domain.forecastFunnel(lumusRows, demo.benchmarks);
  assert.equal(f.months.length, 12);
  // 65x4000 + 60x15000 + 12x25000 = 260.000 + 900.000 + 300.000
  approx(f.totals.views, 1460000, 'total views');
  approx(f.totals.visits, 780 + 3600 + 1500, 'total visits');
});

test('BP [domain]: forecastFunnel — channel không benchmark / Paid Ads -> forecast null, không bịa số', () => {
  const fb = demo.plan_rows.filter((r) => r.channel === 'Facebook Owned' && r.month === '2027-01');
  const f1 = domain.forecastFunnel(fb, demo.benchmarks);
  assert.equal(f1.rows[0].forecast, null);
  assert.equal(f1.totals.views, 0);
  const meta = demo.plan_rows.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  const f2 = domain.forecastFunnel(meta, demo.benchmarks);
  assert.equal(f2.rows[0].forecast, null);
  // Benchmark lạ không khớp brand -> null.
  const f3 = domain.forecastFunnel([nanoJan], [{ brand_id: 'brand-khac', channel: 'KOL Nano', unit_price: 1, output_per_unit: 1, view_to_visit: 1, visit_to_signup: 1, signup_to_first: 1, first_to_paid: 1 }]);
  assert.equal(f3.rows[0].forecast, null);
});

// ---------------------------------------------------------------- planBudget
test('BP [domain]: planBudget CA SỐ NEO — KOL Nano T1 = 4 x 1.500.000 = 6.000.000đ', () => {
  const b = domain.planBudget([nanoJan], demo.benchmarks);
  assert.equal(b.total, 6000000);
  assert.equal(b.byMonth['2027-01'].amount, 6000000);
  assert.equal(b.rows[0].source, 'unit_price');
});

test('BP [domain]: planBudget — Paid Ads lấy field budget trực tiếp; tổng kỳ khớp', () => {
  const b = domain.planBudget(lumusRows, demo.benchmarks);
  const kolTotal = 65 * 1500000 + 60 * 5500000 + 12 * 30000000;
  assert.equal(b.totalUnitPrice, kolTotal);
  assert.equal(b.totalDirect, 546000000 + 182000000);
  assert.equal(b.total, kolTotal + 546000000 + 182000000);
  const metaJan = b.rows.find((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  assert.equal(metaJan.amount, 10920000);
  assert.equal(metaJan.source, 'direct');
  // Channel không đơn giá và không budget -> amount 0, source null.
  const fbJan = b.rows.find((r) => r.channel === 'Facebook Owned' && r.month === '2027-01');
  assert.equal(fbJan.amount, 0);
  assert.equal(fbJan.source, null);
});

// ---------------------------------------------------------------- an toàn rỗng
test('BP [domain]: an toàn với rows rỗng / thiếu benchmark — không throw', () => {
  assert.deepEqual(domain.summarizePlanByMonth([]), { months: [], byMonth: {}, totalQty: 0, totalBudget: 0 });
  assert.deepEqual(domain.summarizePlanByMonth(null).totalQty, 0);
  assert.equal(domain.summarizePlanByChannel(undefined).channels.length, 0);
  const f = domain.forecastFunnel([], []);
  assert.equal(f.totals.views, 0);
  assert.equal(domain.forecastFunnel(null, null).rows.length, 0);
  const b = domain.planBudget([], null);
  assert.equal(b.total, 0);
  assert.equal(domain.planBudget([nanoJan], []).total, 0);
});

// ---------------------------------------------------------------- SAVA seed (17/11, file Action Plan CAMP 01 + IMC Game Chapter)
test('BP [demo]: SAVA CAMP 01 seed từ file — 115 task / 24 content / 9 dòng ngân sách = 51.539.000đ', () => {
  const tasks = demo.tasks.filter((t) => t.campaignId === 'camp-play-unknown');
  assert.equal(tasks.length, 115, '66 dòng tab LP + Job Fair + 49 dòng tab HNĐT');
  assert.ok(tasks.every((t) => t.assigneeId && t.startDate && t.dueDate && t.sourceRef));
  assert.equal(demo.contentItems.filter((c) => c.campaignId === 'camp-play-unknown').length, 24);
  const lines = demo.budgetLines.filter((b) => b.campaignId === 'camp-play-unknown');
  assert.equal(lines.length, 9);
  assert.equal(lines.reduce((a, b) => a + b.approved, 0), 51539000);
  const savaPlan = demo.plan_rows.filter((r) => r.brand_id === 'brand-sava-meta');
  assert.equal(savaPlan.reduce((a, r) => a + (r.budget || 0), 0), 51539000);
  assert.equal(savaPlan.filter((r) => r.month === '2026-10' || r.month === '2026-11').length, savaPlan.length);
  // CAMP 02/03 mức tổng theo file IMC.
  assert.equal(demo.budgetLines.find((b) => b.id === 'budget-build-unknown').approved, 154200000);
  assert.equal(demo.budgetLines.find((b) => b.id === 'budget-create-unknown').approved, 49349500);
  assert.ok(demo.kpis.filter((k) => k.brand_id === 'brand-sava-meta').length >= 12);
});

// ---------------------------------------------------------------- store
test('BP [store]: COLLECTIONS có brands/benchmarks/plan_rows; chế độ thật an toàn (không ánh xạ bảng)', () => {
  for (const c of ['brands', 'benchmarks', 'plan_rows']) {
    assert.ok(Store.COLLECTIONS.includes(c), `COLLECTIONS thiếu ${c}`);
    // Không có bảng Supabase tương ứng: _loadCollection trả [] ngay,
    // không gọi Supabase -> chế độ thật không crash khi thiếu dữ liệu.
    assert.equal(core.COLLECTION_TO_TABLE[c], undefined, `${c} chưa được có bảng ở bản bấm thử`);
  }
  return Store._loadCollection('brands').then(() => {
    assert.deepEqual(Store.state.brands, []);
    return Store._loadCollection('plan_rows');
  }).then(() => {
    assert.deepEqual(Store.state.plan_rows, []);
  });
});
