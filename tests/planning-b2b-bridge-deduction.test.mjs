// tests/planning-b2b-bridge-deduction.test.mjs
// THAY ĐỔI B (Zac chốt 18/11 16:02) — ĐẢO QUY TẮC BRIDGE:
// Paid User chuyển sang B2B qua cầu nối paid_to_b2b (tỉ lệ theo
// Channel ở Benchmark, giữ nguyên) NAY BỊ TRỪ khỏi tồn Paid B2C:
//   Paid EOM_t = tồn trước + New Paid_t − Paid churn_t − bridge_t
// trong đó bridge_t là lượng cầu nối của ĐÚNG tháng đó, do MỘT nguồn
// duy nhất — forecastFunnel — tính và phơi ra ở field b2bBridge
// (row detail + byMonth + totals + byPhase). computeOperatingFinancials
// và app chỉ ĐỌC field đó, không tính lại cầu nối.
// Hai nguồn B2B còn lại KHÔNG trừ (chưa từng là Paid B2C):
//   (2) Objective Lead Gen/Demo (phần B2B qua lead/demo_to_account);
//   (3) Partnership/Event theo audience split (÷ cost per B2B account).
// Phần New Paid từ Monthly cvr (Free tồn đầu kỳ, không gắn Channel)
// không thuộc bridge — giữ nguyên như mô hình hiện tại.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const domain = require('../js/domain.js');

function approx(actual, expected, label) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}
function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

const FULL = { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 47000, cogs_per_free_user: 10000, cogs_per_paid_user: 20000, fixed_cost: 200000, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000 };

// ============================================================ forecast: phơi bridge
test('BRIDGE [domain] forecast: content — b2bBridge phơi ở row detail + byMonth + totals, bằng đúng Paid x paid_to_b2b; field b2b/paid cũ không đổi', () => {
  const bm = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: 0.1, direct_budget: false }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 10, budget: null }];
  const f = domain.forecastFunnel(rows, bm);
  approx(f.rows[0].forecast.paid, 1, 'Paid cohort giữ nguyên = 1');
  approx(f.rows[0].forecast.b2b, 0.1, 'b2b tổng giữ nguyên = 0,1');
  approx(f.rows[0].forecast.b2bBridge, 0.1, 'row detail: b2bBridge = Paid 1 x 10% (đường content toàn bộ b2b là bridge)');
  approx(f.byMonth['2027-01'].b2bBridge, 0.1, 'byMonth: b2bBridge theo tháng');
  approx(f.totals.b2bBridge, 0.1, 'totals: b2bBridge cả kỳ');
  approx(f.totals.paid, 1, 'totals.paid không đổi');
});

test('BRIDGE [domain] forecast: budget-driven GỘP NGUỒN — b2bBridge CHỈ chứa phần cầu nối, không chứa Lead->Account / Partnership trực tiếp', () => {
  // Lead Gen both 40%: B2B trực tiếp = 40 Leads x 20% = 8; Paid phần
  // B2C = 1,65 -> bridge = 1,65 x 10% = 0,165; b2b tổng = 8,165.
  const bmLead = [{ brand_id: 'b1', channel: 'Ads B2B', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const fcL = domain.forecastFunnel([{ id: 'rl', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }], bmLead);
  approx(fcL.rows[0].forecast.b2b, 8.165, 'b2b tổng = 8 trực tiếp + 0,165 bridge');
  approx(fcL.rows[0].forecast.b2bBridge, 0.165, 'b2bBridge CHỈ = 0,165 (không gồm 8 account Lead->Account)');
  approx(fcL.byMonth['2027-01'].b2bBridge, 0.165, 'byMonth bridge tách đúng');
  // Partnership both 40%: B2B trực tiếp = 4.000.000 / 500.000 = 8;
  // Paid B2C = 120 x 2,75% = 3,3 -> bridge = 0,33; tổng = 8,33.
  const bmPE = [{ brand_id: 'b1', channel: 'Partner X', group: 'Partnership', direct_budget: true, view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, cost_per_result: { signup: 50000, b2b_account: 500000 } }];
  const fcP = domain.forecastFunnel([{ id: 'rp', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Partner X', group: 'Partnership', qty: null, budget: 10000000, audience: 'both', b2b_split_pct: 40 }], bmPE);
  approx(fcP.rows[0].forecast.b2b, 8.33, 'Partnership b2b tổng = 8 + 0,33');
  approx(fcP.rows[0].forecast.b2bBridge, 0.33, 'Partnership b2bBridge CHỈ = 0,33');
});

// ============================================================ (i) trừ bridge
test('BRIDGE [domain] (i): Paid EOM giảm đúng bridge từng tháng; Revenue/COGS Paid theo tồn đã giảm; tháng sau churn tính trên tồn đã giảm; B2B EOM tăng như trước', () => {
  // Tính tay (FULL ở trên; opening Free 1.000 / Paid 100 / B2B 50):
  // T1: Paid churn = (100+10) x 2% x 0,5 = 1,1 -> Paid EOM cũ 108,9
  //     -> MỚI 108,9 − bridge 1 = 107,9. Revenue = 47.000 x 107,9
  //     = 5.071.300 (cũ 5.118.300); cogsPaid = 20.000 x 107,9
  //     = 2.158.000 (cũ 2.178.000). B2B: churn 50 x 4% = 2,
  //     EOM = 50 + 5 − 2 = 53 (không đổi so với quy tắc cũ).
  // T2: Paid churn = (107,9 + 10) x 2% = 2,358 (tính trên tồn ĐÃ
  //     giảm; trên tồn cũ sẽ là 2,378) -> Paid EOM = 107,9 + 10
  //     − 2,358 − 1 = 114,542 (cũ 116,522). B2B EOM = 53 + 5 − 2,12
  //     = 55,88.
  const out = domain.computeOperatingFinancials({
    months: ['2027-01', '2027-02'],
    funnelByMonth: {
      '2027-01': { views: 5000, visits: 900, freemium: 210, paid: 10, b2b: 5, b2bBridge: 1 },
      '2027-02': { views: 5000, visits: 900, freemium: 210, paid: 10, b2b: 5, b2bBridge: 1 }
    },
    budgetByMonth: { '2027-01': 1000000, '2027-02': 1000000 },
    inputsByMonth: { '2027-01': FULL, '2027-02': FULL },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  const [jan, feb] = out.months;
  assert.equal(jan.b2bBridge, 1); assert.equal(jan.bridgeConverted, 1, 'bridgeConverted là alias của lượng bridge tháng đó');
  approx(jan.paidChurn, 1.1, 'T1 Paid churn tính TRƯỚC khi trừ bridge (trên tồn đầu kỳ + New Paid)');
  approx(jan.paidEom, 107.9, 'T1 Paid EOM = 108,9 (cũ) − bridge 1');
  approx(jan.revenue, 5071300, 'T1 Revenue = 47.000 x 107,9');
  approx(jan.cogsPaid, 2158000, 'T1 COGS Paid = 20.000 x 107,9');
  approx(jan.cogs, 13855500, 'T1 COGS = 11.697.500 + 2.158.000');
  approx(jan.b2bEom, 53, 'T1 B2B EOM tăng như trước (bridge vẫn cộng vào B2B)');
  approx(jan.revenueB2b, 5300000, 'T1 Revenue B2B = 100.000 x 53');
  approx(feb.paidChurn, 2.358, 'T2 Paid churn tính trên tồn đã giảm (107,9 + 10) x 2%');
  approx(feb.paidEom, 114.542, 'T2 Paid EOM = 107,9 + 10 − 2,358 − 1');
  approx(feb.revenue, 5383474, 'T2 Revenue = 47.000 x 114,542');
  approx(feb.b2bEom, 55.88, 'T2 B2B EOM = 53 + 5 − 2,12');
  approx(out.totals.b2bBridge, 2, 'Tổng bridge cả kỳ = 1 + 1 (dòng flow)');
  approx(out.totals.paidEom, 114.542, 'Tổng Paid EOM = tháng cuối đã trừ bridge');
});

test('BRIDGE [domain] (i2): đường vào dự phòng cùng cơ chế input — inputsByMonth.b2bBridge cũng được trừ; Monthly cvr KHÔNG sinh bridge', () => {
  // funnel không mang b2bBridge, inputsByMonth mang 1 -> trừ 1.
  const viaInputs = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10, b2b: 5 } },
    budgetByMonth: { '2027-01': 0 },
    inputsByMonth: { '2027-01': { ...FULL, b2bBridge: 1 } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  approx(viaInputs.months[0].paidEom, 107.9, 'inputsByMonth.b2bBridge = 1 -> Paid EOM 107,9');
  // monthly_cvr 1%: New Paid = cohort 10 + 1.000 x 1% = 20 (phần 10
  // từ cvr không gắn Channel). Bridge vẫn chỉ 1 (từ cohort funnel):
  // Paid churn = (100 + 20) x 2% x 0,5 = 1,2 -> EOM = 100+20−1,2−1.
  const withCvr = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10, b2b: 1, b2bBridge: 1 } },
    budgetByMonth: { '2027-01': 0 },
    inputsByMonth: { '2027-01': { ...FULL, monthly_cvr: 0.01 } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  assert.equal(withCvr.months[0].newPaid, 20, 'New Paid gồm cả phần cvr');
  approx(withCvr.months[0].paidEom, 117.8, 'Paid EOM chỉ trừ bridge của cohort (1), không trừ phần cvr');
});

// ============================================================ (ii) nguồn 2/3 không trừ
test('BRIDGE [domain] (ii): Lead Gen sinh B2B Account trực tiếp -> Paid EOM KHÔNG đổi (end-to-end forecast -> operating)', () => {
  const bm = [{ brand_id: 'b1', channel: 'Google-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Google-like', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }];
  const f = domain.forecastFunnel(rows, bm);
  approx(f.totals.b2b, 8, 'Lead Gen sinh 8 B2B Account');
  assert.equal(f.totals.b2bBridge, 0, 'benchmark không có paid_to_b2b -> bridge = 0');
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': f.byMonth['2027-01'] },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { ...FULL, paid_price: 50000, cogs_per_paid_user: 10000 } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  // Paid cohort 1,65; Paid churn = (100 + 1,65) x 2% x 0,5 = 1,0165
  // -> Paid EOM = 100,6335 — ĐÚNG số khi không có B2B nào.
  approx(out.months[0].paidEom, 100.6335, 'Paid EOM không bị trừ bởi 8 account Lead Gen');
  approx(out.months[0].b2bEom, 56, 'B2B EOM vẫn = 50 + 8 − 2');
  // Đối chiếu trực tiếp tại tầng operating: b2b tổng lớn nhưng
  // b2bBridge = 0 -> không trừ.
  const direct = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 5000, visits: 900, freemium: 210, paid: 10, b2b: 8, b2bBridge: 0 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': FULL },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  approx(direct.months[0].paidEom, 108.9, 'b2bBridge = 0 -> Paid EOM = baseline 108,9 dù b2b = 8');
});

// ============================================================ (iii) không B2B = baseline
test('BRIDGE [domain] (iii): fixture KHÔNG B2B — output giống hệt baseline tính tay chuẩn (số cụ thể, gồm ca paid_price 47.000)', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 5000, visits: 900, freemium: 210, paid: 10 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 47000, cogs_per_free_user: 10000, cogs_per_paid_user: 20000, fixed_cost: 200000 } },
    openingFree: 1000, openingPaid: 100
  });
  const r = out.months[0];
  assert.equal(r.b2bBridge, 0); assert.equal(r.bridgeConverted, 0);
  approx(r.paidEom, 108.9, 'baseline Paid EOM = 108,9');
  approx(r.freeEom, 1169.75, 'baseline Free EOM = 1.169,75');
  approx(r.revenue, 5118300, 'baseline Revenue = 47.000 x 108,9 = 5.118.300');
  approx(r.cogsFree, 11697500, 'baseline COGS Free');
  approx(r.cogsPaid, 2178000, 'baseline COGS Paid');
  approx(r.cogs, 13875500, 'baseline COGS');
  approx(r.profitAfterCogsMkt, -9757200, 'baseline Profit 1');
  approx(r.profitAfterCogsFixedMkt, -9957200, 'baseline Profit 2');
  assert.equal(r.b2bEom, 0); assert.equal(r.revenueB2b, 0); assert.equal(r.cogsB2b, 0);
  assert.equal(out.totals.b2bBridge, 0, 'Tổng bridge = 0 khi không B2B');
  approx(out.totals.paidEom, 108.9, 'Tổng Paid EOM baseline');
});

// ============================================================ app: bridge chảy qua planningOperatingData
function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}
const escStub = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNumStub = (n) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN');
const fmtMoneyStub = (n, c) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('vi-VN') + ' ' + (c || '');

test('BRIDGE [app unit]: planningOperatingData truyền b2bBridge từ forecast (byMonth) vào computeOperatingFinancials — Paid EOM qua app giảm đúng bridge', () => {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const rows = [
    { id: 'r-kol', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 1, budget: null, phase_id: 'ph-1' },
    { id: 'r-lead', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40, phase_id: 'ph-1' },
  ];
  const benchmarks = [
    { id: 'bm-kol', brand_id: 'b1', segment: null, channel: 'KOL X', group: 'KOL', unit_price: 1000000, output_per_unit: 200, view_to_visit: 1, visit_to_freemium: 1, freemium_to_paid: 0.05, paid_to_b2b: 0.1, direct_budget: false },
    { id: 'bm-lead', brand_id: 'b1', segment: 'b2b', channel: 'Ads B2B', group: 'Paid Media', unit_price: null, output_per_unit: null, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.2, paid_to_b2b: null, cost_per_result: { lead_gen: 100000 }, direct_budget: true },
  ];
  const phases = [{ id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0, paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 50000, cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000, opening_free: 1000, opening_paid: 100, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000, opening_b2b: 50 }];
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {}, planningYear: 2027 };
  const Store = { mode: 'demo', list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? phases : coll === 'benchmarks' ? benchmarks : coll === 'phase_assumptions' ? [] : coll === 'brands' ? [] : []), get: () => null };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock + '\nreturn { planningOperatingData: planningOperatingData };');
  const h = factory(Store, domain, UI, cfValStub, () => true, () => {}, () => {}, () => ({ ok: true }), () => ({ ok: true }), () => {}, escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<table data-table-key="' + key + '">' + inner + '</table>', (m) => String(m), () => '');
  const data = h.planningOperatingData(rows, benchmarks, ['2027-01']);
  const r = data.months[0];
  approx(r.newB2b, 9, 'New B2B = bridge 1 + Lead->Account 8');
  approx(r.b2bBridge, 1, 'app truyền đúng bridge = 1 (chỉ cầu nối KOL)');
  approx(r.paidEom, 109.5335, 'Paid EOM qua app = 110,5335 (cũ) − bridge 1');
  approx(data.totals.b2bBridge, 1, 'Tổng bridge qua app = 1');
  approx(r.b2bEom, 57, 'B2B EOM qua app = 57 như trước');
});

test('BRIDGE [static]: app.js không còn câu chữ quy tắc cũ; câu chữ quy tắc mới có ở cả khối Phase, bảng vận hành và hint Audience', () => {
  for (const gone of ['KHÔNG bị trừ khỏi Paid EOM', 'không trừ Paid EOM', 'không bị trừ khỏi Paid']) {
    assert.ok(!src.includes(gone), 'còn sót quy tắc cũ: ' + gone);
  }
  const phrase = 'Paid User chuyển sang B2B qua cầu nối paid_to_b2b bị trừ khỏi Paid EOM trong tháng chuyển đổi; B2B Account từ Lead Gen/Demo/Partnership/Event không trừ (chưa từng là Paid B2C)';
  assert.ok((src.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 3, 'câu quy tắc mới phải xuất hiện ở ít nhất 3 vị trí (Phase + noteFull + Audience)');
  assert.ok(src.includes('b2bBridge: bm.b2bBridge || 0'), 'planningOperatingData phải truyền b2bBridge từ byMonth của forecast');
});
