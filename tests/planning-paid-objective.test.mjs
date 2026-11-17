// tests/planning-paid-objective.test.mjs
// Paid Media theo MÔ HÌNH OBJECTIVE (đợt thay thế cơ chế 7015b32).
// Mỗi dòng Paid mang field `objective`; kết quả của Objective đặt TẠI
// tầng của nó = ngân sách ÷ cost_per_result[objective] của Benchmark,
// rồi chảy XUỐNG qua tỉ lệ Benchmark (kèm uplift ở chế độ phase);
// KHÔNG suy ngược lên tầng trên; thiếu tỉ lệ thì chuỗi dừng tại đó;
// Objective chưa có đơn giá -> forecast null (đóng góp 0 chỉ số) nhưng
// ngân sách vẫn tính vào tổng. Cơ chế cũ Visits = ngân sách ×
// traffic_share ÷ cost_per_visit ĐÃ GỠ khỏi engine + benchmark.
//
// Phân bổ ngân sách (seed): GIỮ NGUYÊN tổng kênh × tháng của Master
// Forecast (Meta T1 10.920.000đ, Meta năm 546.000.000đ, TikTok năm
// 182.000.000đ); trong mỗi phase chia tổng tháng theo TỈ TRỌNG
// Objective trong phase của Lumus Draft Plan (USD, FX 26.000đ).
// Google Search B2B + LinkedIn Ads B2B seed MỚI từ Draft Plan
// (+83.200.000đ tổng "Tất cả": 1.515.500.000đ -> 1.598.700.000đ;
// tổng B2C không đổi).
//
// BẢNG DELTA Paid cũ (cơ chế traffic_share, 7015b32) -> mới (Objective),
// tính tay độc lập từ ngân sách từng Objective:
//   Meta Ads/năm:   Visits 16.380 -> 6.415,5 (Traffic 128.310.000đ/20.000đ)
//                   Signups 1.474,2 -> 1.732,185
//                   First 737,1 -> 866,0925
//                   Paid 40,5405 -> 57,7702125 (gồm Remarketing qua CAC)
//   TikTok Ads/năm: Visits 5.790,909… -> 2.523,1818… (55.510.000đ/22.000đ)
//                   Signups 521,1818… -> 524,9045…
//                   First 260,5909… -> 262,4523…
//                   Paid 14,3325 -> 14,434875
//   Ngân sách năm:  Meta 546.000.000đ / TikTok 182.000.000đ KHÔNG đổi.
// LƯU Ý chênh lệch với con số ví dụ ở điểm 5 của đặc tả (Traffic Meta
// cả năm 140.595.000đ = tổng USD Traffic của Draft Plan x 26.000):
// con số đó chỉ đúng nếu áp tỉ trọng lên TỔNG PHASE của Draft Plan,
// trong khi đặc tả đồng thời khoá (a) giữ nguyên tổng kênh × tháng
// của Master Forecast và (b) ca neo T1 theo tỉ trọng phase — tổng
// phase của Master Forecast (27,3tr / 218,4tr / 81,9tr / 218,4tr)
// khác tổng phase của Draft Plan (81,9tr / 163,8tr / 109,2tr /
// 191,1tr) nên hai cách cho tổng Traffic năm khác nhau. File này khoá
// theo (a)+(b): Traffic Meta năm = 128.310.000đ -> Visits 6.415,5.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const domainSrc = readFileSync(new URL('../js/domain.js', import.meta.url), 'utf8');
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}
const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
const sumObj = (ch, month, obj) => lumus.filter((r) => r.channel === ch && r.month === month && r.objective === obj).reduce((a, r) => a + r.budget, 0);
const sumChMonth = (ch, month) => lumus.filter((r) => r.channel === ch && r.month === month).reduce((a, r) => a + r.budget, 0);

// Tổng kênh x tháng GIỮ NGUYÊN từ seed Master Forecast (trước Objective).
const MONTH_TOTALS = {
  'Meta Ads': [10920000, 16380000, 65520000, 87360000, 65520000, 16380000, 20475000, 20475000, 24570000, 100464000, 100464000, 17472000],
  'TikTok Ads': [3640000, 5460000, 21840000, 29120000, 21840000, 5460000, 6825000, 6825000, 8190000, 33488000, 33488000, 5824000]
};
const MONTHS = Array.from({ length: 12 }, (_, i) => '2027-' + String(i + 1).padStart(2, '0'));

// ---------------------------------------------------------------- catalog
test('PPO [domain]: catalog Objective chuẩn + catalog theo Channel đúng đặc tả', () => {
  assert.deepEqual(domain.PAID_OBJECTIVES.map((o) => [o.key, o.tier]), [
    ['awareness', 'views'], ['traffic', 'visits'], ['signup', 'signups'],
    ['remarketing', 'paid'], ['lead_gen', 'signups'], ['demo', 'first']
  ]);
  assert.deepEqual(domain.PAID_CHANNEL_OBJECTIVES['Meta Ads'], ['awareness', 'traffic', 'signup', 'remarketing']);
  assert.deepEqual(domain.PAID_CHANNEL_OBJECTIVES['TikTok Ads'], ['awareness', 'traffic', 'signup'], 'TikTok không có Remarketing');
  assert.deepEqual(domain.PAID_CHANNEL_OBJECTIVES['Google Search B2B'], ['traffic', 'lead_gen']);
  assert.deepEqual(domain.PAID_CHANNEL_OBJECTIVES['LinkedIn Ads B2B'], ['lead_gen', 'demo']);
  assert.equal(domain.paidObjectiveOf({ objective: 'signup' }), 'signup');
  assert.equal(domain.paidObjectiveOf({ objective: 'Lead Generation' }), 'lead_gen');
  assert.equal(domain.paidObjectiveOf({}), null);
  const metaBm = demo.benchmarks.find((b) => b.channel === 'Meta Ads');
  assert.equal(domain.costPerResultFor(metaBm, 'traffic'), 20000);
  assert.equal(domain.costPerResultFor(metaBm, 'awareness'), null, 'Awareness chưa có đơn giá');
});

// ---------------------------------------------------------------- seed phân bổ
test('PPO [seed]: ca neo Meta T1 theo Objective — Awareness 2.184.000 / Traffic 5.460.000 / Signup 3.276.000 / Remarketing 0; tổng tháng 10.920.000đ không đổi', () => {
  assert.equal(sumObj('Meta Ads', '2027-01', 'awareness'), 2184000, '20% x 10.920.000');
  assert.equal(sumObj('Meta Ads', '2027-01', 'traffic'), 5460000, '50% x 10.920.000');
  assert.equal(sumObj('Meta Ads', '2027-01', 'signup'), 3276000, '30% x 10.920.000');
  assert.equal(sumObj('Meta Ads', '2027-01', 'remarketing'), 0, 'Remarketing Phase 1 = 0 (không có dòng hoặc dòng 0)');
  assert.equal(sumChMonth('Meta Ads', '2027-01'), 10920000);
});

test('PPO [seed]: tổng kênh x tháng GIỮ NGUYÊN cho Meta/TikTok ở cả 12 tháng (cộng các Objective đúng bằng tổng tháng cũ); tổng kênh x năm không đổi', () => {
  for (const ch of Object.keys(MONTH_TOTALS)) {
    MONTHS.forEach((m, i) => {
      assert.equal(sumChMonth(ch, m), MONTH_TOTALS[ch][i], `${ch} ${m}: tổng tháng phải giữ nguyên`);
    });
    assert.equal(lumus.filter((r) => r.channel === ch).reduce((a, r) => a + r.budget, 0),
      MONTH_TOTALS[ch].reduce((a, b) => a + b, 0), ch + ': tổng năm không đổi');
  }
  // Tỉ trọng theo phase — kiểm thêm 2 tháng khác phase:
  // Meta T3 (Phase 2, Traffic 30%): 65.520.000 x 0,3 = 19.656.000.
  assert.equal(sumObj('Meta Ads', '2027-03', 'traffic'), 19656000);
  // Meta T10 (Phase 4, Signup 50%): 100.464.000 x 0,5 = 50.232.000.
  assert.equal(sumObj('Meta Ads', '2027-10', 'signup'), 50232000);
  // TikTok T1 (Phase 1): Awareness 50% / Traffic 40% / Signup 10%.
  assert.equal(sumObj('TikTok Ads', '2027-01', 'awareness'), 1820000);
  assert.equal(sumObj('TikTok Ads', '2027-01', 'traffic'), 1456000);
  assert.equal(sumObj('TikTok Ads', '2027-01', 'signup'), 364000);
});

test('PPO [seed]: Google Search B2B + LinkedIn Ads B2B — ngân sách phase chia đều theo tháng (Phase 3: 4.160.000đ/tháng, Phase 4: 8.320.000đ/tháng), đúng Objective + segment B2B; tổng "Tất cả" 1.598.700.000đ, B2C không đổi', () => {
  for (const [ch, obj] of [['Google Search B2B', 'lead_gen'], ['LinkedIn Ads B2B', 'demo']]) {
    const rows = lumus.filter((r) => r.channel === ch);
    assert.ok(rows.length > 0, ch + ' phải có dòng seed');
    assert.ok(rows.every((r) => r.objective === obj && r.segment === 'b2b' && r.group === 'Paid Media'), ch + ': mọi dòng đúng objective/segment/nhóm');
    assert.equal(rows.reduce((a, r) => a + r.budget, 0), 41600000, ch + ': $1.600 x 26.000');
    for (const m of ['2027-06', '2027-07', '2027-08', '2027-09']) assert.equal(sumChMonth(ch, m), 4160000, ch + ' ' + m + ' Phase 3 chia đều');
    for (const m of ['2027-10', '2027-11', '2027-12']) assert.equal(sumChMonth(ch, m), 8320000, ch + ' ' + m + ' Phase 4 chia đều');
    for (const m of ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05']) assert.equal(sumChMonth(ch, m), 0, ch + ' ' + m + ' Phase 1-2 ngân sách 0');
  }
  assert.equal(domain.planBudget(lumus, demo.benchmarks).total, 1598700000);
  assert.equal(domain.planBudget(lumus.filter((r) => r.segment !== 'b2b'), demo.benchmarks).total, 1515500000, 'tổng B2C không đổi');
});

// ---------------------------------------------------------------- forecast ca neo
test('PPO [domain]: ca neo tính tay Meta T1 — Traffic: Visits 273 -> Signups 24,57 -> First 12,285 -> Paid 0,675675; Signup: Signups 14,742 -> First 7,371 -> Paid 0,405405; tổng Paid T1 = 1,08108', () => {
  const rows = lumus.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  const f = domain.forecastFunnel(rows, demo.benchmarks);
  const byObj = Object.fromEntries(f.rows.map((r) => [r.objective, r.forecast]));
  approx(byObj.traffic.visits, 273, 'Traffic visits = 5.460.000 / 20.000');
  approx(byObj.traffic.signups, 24.57, 'Traffic signups');
  approx(byObj.traffic.first, 12.285, 'Traffic first');
  approx(byObj.traffic.paid, 0.675675, 'Traffic paid');
  approx(byObj.signup.signups, 14.742, 'Signup signups = 3.276.000 / (20.000 / 0,09)');
  approx(byObj.signup.first, 7.371, 'Signup first');
  approx(byObj.signup.paid, 0.405405, 'Signup paid');
  approx(f.totals.paid, 1.08108, 'Tổng Paid Meta T1 (Remarketing T1 = 0đ, Awareness chưa có đơn giá)');
  // KHÔNG suy ngược: dòng Signup không tạo Visits/Views; dòng Traffic không tạo Views.
  assert.equal(byObj.signup.visits, 0);
  assert.equal(byObj.signup.views, 0);
  assert.equal(byObj.traffic.views, 0);
});

test('PPO [domain]: Remarketing đặt kết quả TẠI tầng Paid (Meta T10: 20.092.800đ / CAC suy từ chuỗi = Paid 2,486484; mọi tầng trên = 0)', () => {
  const rows = lumus.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-10' && r.objective === 'remarketing');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].budget, 20092800, 'Phase 4 Remarketing 20% x 100.464.000');
  const fc = domain.forecastFunnel(rows, demo.benchmarks).rows[0].forecast;
  approx(fc.paid, 20092800 / (20000 / (0.09 * 0.5 * 0.055)), 'Paid = ngân sách / CAC suy từ chuỗi');
  approx(fc.paid, 2.486484, 'Paid Remarketing T10');
  assert.equal(fc.views + fc.visits + fc.signups + fc.first, 0, 'không suy ngược lên tầng trên');
});

test('PPO [domain]: bảng delta năm cũ -> mới (Meta + TikTok: Visits/Signups/First/Paid) khoá bằng engine', () => {
  const meta = domain.forecastFunnel(lumus.filter((r) => r.channel === 'Meta Ads'), demo.benchmarks).totals;
  // Cũ (traffic_share): visits 16.380 / signups 1.474,2 / first 737,1 / paid 40,5405.
  approx(meta.visits, 6415.5, 'Meta visits mới = 128.310.000 / 20.000');
  approx(meta.signups, 1732.185, 'Meta signups mới');
  approx(meta.first, 866.0925, 'Meta first mới');
  approx(meta.paid, 57.7702125, 'Meta paid mới');
  const tik = domain.forecastFunnel(lumus.filter((r) => r.channel === 'TikTok Ads'), demo.benchmarks).totals;
  // Cũ: visits 5.790,909… / signups 521,1818… / first 260,5909… / paid 14,3325.
  approx(tik.visits, 55510000 / 22000, 'TikTok visits mới');
  approx(tik.signups, 524.9045454545455, 'TikTok signups mới');
  approx(tik.first, 262.4522727272727, 'TikTok first mới');
  approx(tik.paid, 14.434875, 'TikTok paid mới');
});

test('PPO [domain]: Objective thiếu đơn giá — đóng góp 0 chỉ số, ngân sách vẫn đủ vào tổng (Awareness Meta + Lead Gen Google + Demo LinkedIn)', () => {
  const metaYear = lumus.filter((r) => r.channel === 'Meta Ads');
  const awarenessBudget = metaYear.filter((r) => r.objective === 'awareness').reduce((a, r) => a + r.budget, 0);
  assert.equal(awarenessBudget, 79170000, 'ngân sách Awareness cả năm vẫn nằm trong tổng kênh');
  const fAw = domain.forecastFunnel(metaYear.filter((r) => r.objective === 'awareness'), demo.benchmarks);
  assert.ok(fAw.rows.every((r) => r.forecast === null), 'Awareness: mọi dòng forecast null');
  assert.equal(fAw.totals.views + fAw.totals.paid, 0, 'Awareness đóng góp 0 chỉ số');
  assert.equal(domain.planBudget(metaYear, demo.benchmarks).total, 546000000, 'tổng ngân sách Meta vẫn đủ cả Awareness');
  for (const ch of ['Google Search B2B', 'LinkedIn Ads B2B']) {
    const rows = lumus.filter((r) => r.channel === ch);
    const f = domain.forecastFunnel(rows, demo.benchmarks);
    assert.ok(f.rows.every((r) => r.forecast === null), ch + ': chưa có đơn giá -> forecast null');
    assert.equal(domain.planBudget(rows, demo.benchmarks).total, 41600000, ch + ': ngân sách vẫn tính đủ');
  }
});

test('PPO [domain]: thiếu tỉ lệ hạ nguồn thì chuỗi DỪNG tại đó, không bịa số (Traffic có đơn giá nhưng visit_to_signup = null -> chỉ Visits, Signups/First/Paid = 0)', () => {
  const bm = [{ brand_id: 'b1', channel: 'Ads X', direct_budget: true, view_to_visit: null, visit_to_signup: null, signup_to_first: 0.5, first_to_paid: 0.055, cost_per_result: { traffic: 10000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Ads X', group: 'Paid Media', qty: null, budget: 100000, objective: 'traffic' }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  assert.ok(fc, 'có đơn giá ở tầng của Objective thì forecast tồn tại');
  approx(fc.visits, 10, 'Visits = 100.000 / 10.000');
  assert.equal(fc.signups, 0, 'thiếu visit_to_signup -> chuỗi dừng, Signups = 0');
  assert.equal(fc.first, 0);
  assert.equal(fc.paid, 0);
  // Dòng Paid KHÔNG có objective -> forecast null (không tự gán Objective).
  const noObj = domain.forecastFunnel([{ ...rows[0], id: 'r2', objective: undefined }], [{ ...bm[0], cost_per_result: { traffic: 10000 } }]);
  assert.equal(noObj.rows[0].forecast, null);
});

test('PPO [domain]: uplift phase áp vào tỉ lệ hạ nguồn của Objective như kênh thường (Meta Traffic T4 — Phase 2 uplift 5%/tháng, n=1)', () => {
  const rows = lumus.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-04' && r.objective === 'traffic');
  const ctx = { phases: demo.phases.filter((p) => p.brand_id && p.start_month), phaseAssumptions: demo.phase_assumptions };
  const noCtx = domain.forecastFunnel(rows, demo.benchmarks).rows[0].forecast;
  approx(noCtx.visits, 1310.4, 'visits không đổi bởi uplift');
  approx(noCtx.signups, 117.936, 'signups không uplift = visits x 0,09');
  const withCtx = domain.forecastFunnel(rows, demo.benchmarks, ctx).rows[0].forecast;
  approx(withCtx.visits, 1310.4, 'visits vẫn không đổi');
  approx(withCtx.signups, 1310.4 * 0.09 * 1.05, 'signups uplift n=1');
  approx(withCtx.first, 1310.4 * 0.09 * 1.05 * 0.5 * 1.05, 'first uplift luỹ kế theo tháng');
});

test('PPO [gỡ cơ chế cũ]: engine + app không còn dùng traffic_share/cost_per_visit trong tính toán; benchmark demo không còn 2 field đó', () => {
  assert.ok(!domainSrc.includes("_benchField(b, 'traffic_share'"), 'engine không được đọc traffic_share');
  assert.ok(!domainSrc.includes("_benchField(b, 'cost_per_visit'"), 'engine không được đọc cost_per_visit');
  assert.ok(!src.includes('traffic share ÷'), 'app không còn công thức Visits theo traffic share');
  for (const b of demo.benchmarks) {
    assert.equal(b.traffic_share, undefined, 'benchmark ' + b.channel + ' còn traffic_share');
    assert.equal(b.cost_per_visit, undefined, 'benchmark ' + b.channel + ' còn cost_per_visit');
  }
  // Benchmark CHỈ có traffic_share/cost_per_visit (kiểu cũ) + dòng có
  // objective -> forecast null (cơ chế cũ không được hồi sinh ngầm).
  const oldBm = [{ brand_id: 'b1', channel: 'Ads X', direct_budget: true, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, traffic_share: 0.6, cost_per_visit: 20000 }];
  const rows = [{ id: 'r1', brand_id: 'b1', month: '2027-01', channel: 'Ads X', qty: null, budget: 1000000, objective: 'traffic' }];
  assert.equal(domain.forecastFunnel(rows, oldBm).rows[0].forecast, null);
});

// ---------------------------------------------------------------- app: helpers + lưu theo Objective
function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}
function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}
function makeHarness(rows, phases, benchmarks, assumptions) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const saves = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all' };
  const state = { toasts: [], updates: [], creates: [], renders: 0 };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : coll === 'phase_assumptions' ? (assumptions || []) : []),
    get: () => null,
  };
  const sUpdate = (coll, id, patch) => {
    const pool = coll === 'plan_rows' ? rows : [];
    const item = pool.find((r) => r.id === id);
    if (!item) return { ok: false, error: 'Không tìm thấy dòng plan.' };
    Object.assign(item, patch);
    state.updates.push({ coll, id, patch });
    return { ok: true, item };
  };
  const sCreate = (coll, obj) => {
    const item = { id: 'plan-new-' + (rows.length + 1), ...obj };
    if (coll === 'plan_rows') rows.push(item);
    state.creates.push({ coll, item });
    return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'tbl', 'vizFunnelHtml', 'fmtMoney',
    helpers + '\n' + saves +
    '\nreturn { planRowObjective: planRowObjective, paidObjectivesForChannel: paidObjectivesForChannel, planBenchmarkCostPerResult: planBenchmarkCostPerResult, phasePaidObjectiveBudgets: phasePaidObjectiveBudgets, funnelTotalsFor: funnelTotalsFor, savePlanningMonthPaidObjectiveBudget: savePlanningMonthPaidObjectiveBudget };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true,
    (m) => state.toasts.push(m),
    () => { state.renders++; },
    sUpdate, sCreate, saveResult,
    (s) => String(s === null || s === undefined ? '' : s),
    (n) => String(n),
    () => '', () => '', (n) => String(n));
  return { h, state };
}
function demoMetaRows() {
  return JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
}
const DEMO_PHASES = () => JSON.parse(JSON.stringify(demo.phases.filter((p) => p.brand_id)));
const DEMO_BENCH = () => JSON.parse(JSON.stringify(demo.benchmarks));
const DEMO_ASSUMP = () => JSON.parse(JSON.stringify(demo.phase_assumptions));

test('PPO [app static]: chi tiết Theo tháng có dòng Objective (ô nhập riêng + nhãn chưa có đơn giá + tổng tháng chỉ đọc), handler + hàm lưu theo Objective; Theo phase hiện ngân sách Objective chỉ đọc kèm ghi chú sửa ở Theo tháng', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const detail = v.slice(v.indexOf('// Bảng chi tiết của dòng đang chọn'), v.indexOf('// Chart ngân sách dự kiến theo tháng'));
  assert.match(detail, /data-planning-paid-objective-row="1"/);
  assert.match(detail, /data-action-change="planning-month-paid-objective-budget"/);
  assert.match(detail, /data-planning-paid-no-price="1"/);
  assert.match(detail, /chưa có đơn giá/);
  assert.match(detail, /data-planning-paid-month-total="1"/);
  assert.match(detail, /Tổng tháng \(chỉ đọc — cộng các Objective\)/);
  assert.match(src, /if \(ctxKind === 'planning-month-paid-objective-budget'\) \{ savePlanningMonthPaidObjectiveBudget\(t\.getAttribute\('data-channel'\), t\.getAttribute\('data-group'\), t\.getAttribute\('data-month'\), t\.getAttribute\('data-objective'\), t\.value\); return; \}/);
  const save = section('function savePlanningMonthPaidObjectiveBudget(channel, group, month, objective, raw)', '// ---------- Brand Hub ----------');
  assert.match(save, /planningMonthSaveGuard\(\)/);
  assert.match(save, /var v = parsePlanPaidBudget\(raw\);/);
  assert.match(save, /planRowObjective\(r\) === objKey/);
  assert.match(save, /sCreate\('plan_rows', objO\)/);
  assert.match(save, /objective: objKey/);
  const phaseBlock = section('function planningPhaseBlockHtml(phase, rows, benchmarks, editable, disAttr)', '// --- Lưu các ô nhập Theo phase');
  assert.match(phaseBlock, /data-planning-phase-paid-objectives="1"/);
  assert.match(phaseBlock, /phasePaidObjectiveBudgets\(chRows\)/);
  assert.match(phaseBlock, /data-planning-phase-paid-note="1"/);
  assert.match(phaseBlock, /sửa ở bảng chi tiết Theo tháng/);
});

test('PPO [app unit]: helpers Objective — planRowObjective / catalog / đơn giá kết quả / ngân sách Objective theo phase (chỉ đọc)', () => {
  const rows = demoMetaRows();
  const { h } = makeHarness(rows, DEMO_PHASES(), DEMO_BENCH(), DEMO_ASSUMP());
  assert.equal(h.planRowObjective({ objective: 'traffic' }), 'traffic');
  assert.equal(h.planRowObjective({}), null);
  assert.deepEqual(h.paidObjectivesForChannel('Meta Ads'), ['awareness', 'traffic', 'signup', 'remarketing']);
  assert.deepEqual(h.paidObjectivesForChannel('TikTok Ads'), ['awareness', 'traffic', 'signup']);
  const metaBm = DEMO_BENCH().find((b) => b.channel === 'Meta Ads');
  assert.equal(h.planBenchmarkCostPerResult(metaBm, 'traffic'), 20000);
  assert.equal(h.planBenchmarkCostPerResult(metaBm, 'awareness'), null);
  approx(h.planBenchmarkCostPerResult(metaBm, 'signup'), 20000 / 0.09, 'cost signup');
  // Ngân sách Objective của Meta trong Phase 1 (T1–T2): Traffic =
  // 5.460.000 (T1) + 8.190.000 (T2, 50% x 16.380.000) = 13.650.000.
  const p1 = rows.filter((r) => r.channel === 'Meta Ads' && (r.month === '2027-01' || r.month === '2027-02'));
  const budgets = Object.fromEntries(h.phasePaidObjectiveBudgets(p1).map((o) => [o.objective, o.budget]));
  assert.equal(budgets.traffic, 13650000);
  assert.equal(budgets.awareness, 2184000 + 3276000);
  assert.equal(budgets.signup, 3276000 + 4914000);
  assert.equal(budgets.remarketing, 0, 'Phase 1 Remarketing = 0');
});

test('PPO [app unit]: sửa ngân sách 1 Objective CHỈ đổi Objective đó + tổng liên quan, Objective khác giữ nguyên (ca neo: Traffic Meta T1 gấp đôi)', () => {
  const rows = demoMetaRows();
  const { h, state } = makeHarness(rows, DEMO_PHASES(), DEMO_BENCH(), DEMO_ASSUMP());
  const t1 = () => rows.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  const before = Object.fromEntries(t1().map((r) => [r.objective, r.budget]));
  const beforeTotals = h.funnelTotalsFor(t1(), DEMO_BENCH());
  h.savePlanningMonthPaidObjectiveBudget('Meta Ads', 'Paid Media', '2027-01', 'traffic', '10920000');
  const after = Object.fromEntries(t1().map((r) => [r.objective, r.budget]));
  assert.equal(after.traffic, 10920000, 'Traffic gấp đôi');
  assert.equal(after.awareness, before.awareness, 'Awareness không đổi');
  assert.equal(after.signup, before.signup, 'Signup không đổi');
  assert.equal(state.updates.length, 1, 'chỉ 1 dòng được ghi');
  assert.equal(t1().reduce((a, r) => a + r.budget, 0), 16380000, 'tổng tháng tăng đúng +5.460.000');
  const afterTotals = h.funnelTotalsFor(t1(), DEMO_BENCH());
  approx(afterTotals.visits, 546, 'visits Traffic gấp đôi');
  approx(afterTotals.paid - beforeTotals.paid, 0.675675, 'paid tăng đúng phần Traffic gấp đôi; phần Signup giữ nguyên');
});

test('PPO [app unit]: Objective chưa có dòng ở tháng đó — nhập > 0 tạo dòng mang objective (Remarketing Meta T1), nhập 0 không tạo; nhập sai bị chặn', () => {
  const rows = demoMetaRows();
  const { h, state } = makeHarness(rows, DEMO_PHASES(), DEMO_BENCH(), DEMO_ASSUMP());
  h.savePlanningMonthPaidObjectiveBudget('Meta Ads', 'Paid Media', '2027-01', 'remarketing', '8080808');
  assert.equal(state.creates.length, 1);
  const created = state.creates[0].item;
  assert.equal(created.objective, 'remarketing');
  assert.equal(created.budget, 8080808);
  assert.equal(created.qty, null);
  assert.equal(created.month, '2027-01');
  assert.equal(created.phase_id, 'phase-lumus-1');
  // Forecast của dòng vừa tạo: Paid = 8.080.808 / CAC ≈ 1.
  const fc = domain.forecastFunnel([created], DEMO_BENCH()).rows[0].forecast;
  approx(fc.paid, 8080808 / (20000 / (0.09 * 0.5 * 0.055)), 'Paid của Remarketing vừa tạo');
  // Nhập 0 cho Objective chưa có dòng (TikTok remarketing không thuộc
  // catalog nhưng hàm lưu tổng quát): không tạo dòng.
  const rows2 = demoMetaRows();
  const h2 = makeHarness(rows2, DEMO_PHASES(), DEMO_BENCH(), DEMO_ASSUMP());
  h2.h.savePlanningMonthPaidObjectiveBudget('Meta Ads', 'Paid Media', '2027-02', 'remarketing', '0');
  assert.equal(h2.state.creates.length, 0);
  // Nhập sai bị chặn, dữ liệu không đổi.
  const rows3 = demoMetaRows();
  const snapshot = JSON.stringify(rows3);
  const h3 = makeHarness(rows3, DEMO_PHASES(), DEMO_BENCH(), DEMO_ASSUMP());
  h3.h.savePlanningMonthPaidObjectiveBudget('Meta Ads', 'Paid Media', '2027-01', 'traffic', '-5');
  h3.h.savePlanningMonthPaidObjectiveBudget('Meta Ads', 'Paid Media', '2027-01', 'traffic', 'abc');
  assert.equal(JSON.stringify(rows3), snapshot);
  assert.equal(h3.state.updates.length + h3.state.creates.length, 0);
});
