// tests/planning-b2b-bridge-deduction.test.mjs
// VIẾT LẠI 18/11/2026 (đợt 2) — CẦU NỐI THEO PHASE (Zac chốt
// 18/11/2026 23:15, thay mô hình bridge theo Channel của thay đổi B):
//   bridge(m) = phases.b2b_bridge_rate của Phase chứa tháng m
//             (phân số; null -> 0) x PaidEOM_pre(m)
//   PaidEOM_pre(m) = Paid đầu kỳ + New Paid(m) − Paid churn(m)
//   Paid EOM(m)    = PaidEOM_pre(m) − bridge(m)
// bridge do computeOperatingFinancials TỰ TÍNH ở tầng tồn từ tỉ lệ
// Phase (đọc qua inputsByMonth[m].b2b_bridge_rate / b2bBridgeRate,
// dự phòng tra input.phases) và phơi ở row.b2bBridge /
// row.bridgeConverted / row.b2bBridgeRate + totals.b2bBridge.
// forecastFunnel KHÔNG còn sinh bridge ở tầng kênh: forecast.b2bBridge
// luôn 0; forecast.b2b chỉ còn account TRỰC TIẾP qua
// cost_per_result.b2b_account (Partnership/Event) — nguồn này KHÔNG
// bị trừ khỏi Paid. Lead Gen/Demo không quy đổi ra account nữa.
// Đường dự phòng cũ (lượng b2bBridge truyền thẳng qua funnelByMonth /
// inputsByMonth / bridgeByMonth) ĐÃ GỠ: không có tỉ lệ Phase thì
// bridge = 0 bất kể các field lượng cũ mang giá trị gì.

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
const FULL_BR = { ...FULL, b2b_bridge_rate: 0.1 };

// ============================================================ forecast: tầng kênh không còn bridge
test('BRIDGE [domain] forecast: content — b2b/b2bBridge tầng kênh = 0 kể cả benchmark còn paid_to_b2b dormant; Paid giữ nguyên', () => {
  const bm = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: 0.1, direct_budget: false }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 10, budget: null }];
  const f = domain.forecastFunnel(rows, bm);
  approx(f.rows[0].forecast.paid, 1, 'Paid cohort giữ nguyên = 1');
  assert.equal(f.rows[0].forecast.b2b, 0, 'b2b tầng kênh = 0 (bridge dời lên tầng tồn theo Phase)');
  assert.equal(f.rows[0].forecast.b2bBridge, 0, 'b2bBridge tầng kênh luôn 0');
  assert.equal(f.byMonth['2027-01'].b2bBridge, 0, 'byMonth b2bBridge = 0');
  assert.equal(f.totals.b2b, 0, 'totals b2b = 0');
  assert.equal(f.totals.b2bBridge, 0, 'totals b2bBridge = 0');
  approx(f.totals.paid, 1, 'totals.paid không đổi');
});

test('BRIDGE [domain] forecast: budget-driven — Lead Gen cho b2b = 0 (không quy đổi); Partnership trực tiếp nằm ở b2b, KHÔNG nằm ở b2bBridge', () => {
  const bmLead = [{ brand_id: 'b1', channel: 'Ads B2B', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const fcL = domain.forecastFunnel([{ id: 'rl', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }], bmLead);
  approx(fcL.rows[0].forecast.freemium, 60, 'Lead Gen B2C vẫn 60 Freemium');
  approx(fcL.rows[0].forecast.paid, 1.65, 'Lead Gen Paid vẫn 1,65');
  assert.equal(fcL.rows[0].forecast.b2b, 0, 'Lead Gen: accounts từ quy đổi = 0');
  assert.equal(fcL.rows[0].forecast.b2bBridge, 0, 'Lead Gen: b2bBridge = 0');
  const bmPE = [{ brand_id: 'b1', channel: 'Partner X', group: 'Partnership', direct_budget: true, view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, cost_per_result: { signup: 50000, b2b_account: 500000 } }];
  const fcP = domain.forecastFunnel([{ id: 'rp', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Partner X', group: 'Partnership', qty: null, budget: 10000000, audience: 'both', b2b_split_pct: 40 }], bmPE);
  approx(fcP.rows[0].forecast.b2b, 8, 'Partnership b2b trực tiếp = 8 (giữ nguyên)');
  assert.equal(fcP.rows[0].forecast.b2bBridge, 0, 'Partnership: b2bBridge = 0 (trực tiếp không phải bridge)');
});

// ============================================================ (i) trừ bridge theo Phase
test('BRIDGE [domain] (i): bridge = 10% x PaidEOM_pre từng tháng; Paid EOM theo tồn đã trừ, Revenue/COGS theo tồn TRƯỚC churn (mốc đầu kỳ 20/11) TRỪ/CỘNG prorate bridge α = 0,5; tháng sau churn tính trên tồn đã trừ; bridge cộng vào New B2B', () => {
  // Tính tay (FULL_BR: bridge rate 10%; opening Free 1.000 / Paid 100 / B2B 50;
  // funnel mỗi tháng: Paid 10, b2b trực tiếp 5):
  // T1: Paid churn = (100+10) x 2% x 0,5 = 1,1 -> PaidEOM_pre = 108,9
  //     -> bridge = 10,89 -> Paid EOM = 98,01. Revenue theo mốc đầu
  //     kỳ TRỪ prorate bridge: paidBase = 100 + 10 − 0,5 x 10,89 =
  //     104,555 -> Revenue = 47.000 x 104,555 = 4.914.085; cogsPaid =
  //     20.000 x 104,555 = 2.091.100; COGS = 12.100.000 (cogsFree theo
  //     freeBase 1.210) + 2.091.100 = 14.191.100. New B2B = 5 +
  //     10,89 = 15,89; B2B churn = 50 x 4% = 2 -> B2B EOM = 63,89;
  //     b2bBase = 50 + 15,89 − 0,5 x 10,89 = 60,445 -> Revenue B2B =
  //     100.000 x 60,445 = 6.044.500; COGS B2B = 30.000 x 60,445 =
  //     1.813.350.
  // T2: Paid churn = (98,01 + 10) x 2% = 2,1602 (trên tồn ĐÃ trừ
  //     bridge) -> PaidEOM_pre = 105,8498 -> bridge = 10,58498 ->
  //     Paid EOM = 95,26482. paidBase T2 = 98,01 + 10 − 0,5 x
  //     10,58498 = 102,71751 -> Revenue T2 = 47.000 x 102,71751 =
  //     4.827.722,97. B2B EOM = 63,89 + 15,58498 − 2,5556
  //     = 76,91938; b2bBase T2 = 63,89 + 15,58498 − 0,5 x 10,58498
  //     = 74,18249 -> Revenue B2B T2 = 7.418.249.
  const out = domain.computeOperatingFinancials({
    months: ['2027-01', '2027-02'],
    funnelByMonth: {
      '2027-01': { views: 5000, visits: 900, freemium: 210, paid: 10, b2b: 5 },
      '2027-02': { views: 5000, visits: 900, freemium: 210, paid: 10, b2b: 5 }
    },
    budgetByMonth: { '2027-01': 1000000, '2027-02': 1000000 },
    inputsByMonth: { '2027-01': FULL_BR, '2027-02': FULL_BR },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  const [jan, feb] = out.months;
  approx(jan.b2bBridgeRate, 0.1, 'T1 row phơi tỉ lệ Phase');
  approx(jan.b2bBridge, 10.89, 'T1 bridge = 10% x 108,9');
  assert.equal(jan.bridgeConverted, jan.b2bBridge, 'bridgeConverted là alias của bridge');
  approx(jan.paidChurn, 1.1, 'T1 Paid churn tính TRƯỚC bridge (trên tồn đầu kỳ + New Paid)');
  approx(jan.paidEom, 98.01, 'T1 Paid EOM = 108,9 − 10,89');
  approx(jan.revenue, 4914085, 'T1 Revenue = 47.000 x paidBase 104,555 (110 − 0,5 x bridge 10,89 — prorate α = 0,5)');
  approx(jan.cogsPaid, 2091100, 'T1 COGS Paid = 20.000 x paidBase 104,555');
  approx(jan.cogs, 14191100, 'T1 COGS = 12.100.000 + 2.091.100');
  approx(jan.newB2b, 15.89, 'T1 New B2B = trực tiếp 5 + bridge 10,89');
  approx(jan.b2bEom, 63.89, 'T1 B2B EOM = 50 + 15,89 − 2');
  approx(jan.revenueB2b, 6044500, 'T1 Revenue B2B = 100.000 x b2bBase 60,445 (65,89 − 0,5 x bridge 10,89)');
  approx(jan.cogsB2b, 1813350, 'T1 COGS B2B = 30.000 x b2bBase 60,445');
  approx(feb.paidChurn, 2.1602, 'T2 Paid churn tính trên tồn đã trừ bridge (98,01 + 10) x 2%');
  approx(feb.b2bBridge, 10.58498, 'T2 bridge = 10% x 105,8498');
  approx(feb.paidEom, 95.26482, 'T2 Paid EOM = 105,8498 − 10,58498');
  approx(feb.revenue, 4827722.97, 'T2 Revenue = 47.000 x paidBase 102,71751 (108,01 − 0,5 x bridge 10,58498)');
  approx(feb.revenueB2b, 7418249, 'T2 Revenue B2B = 100.000 x b2bBase 74,18249 (63,89 + 15,58498 − 0,5 x 10,58498)');
  approx(feb.b2bEom, 76.91938, 'T2 B2B EOM = 63,89 + 15,58498 − 2,5556');
  approx(out.totals.b2bBridge, 21.47498, 'Tổng bridge cả kỳ = 10,89 + 10,58498 (dòng flow)');
  approx(out.totals.paidEom, 95.26482, 'Tổng Paid EOM = tháng cuối đã trừ bridge');
});

test('BRIDGE [domain] (i2): tỉ lệ tra từ input.phases khi inputsByMonth thiếu; Monthly cvr NẰM TRONG PaidEOM_pre nên cũng chịu bridge theo Phase', () => {
  const viaPhases = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10, b2b: 5 } },
    budgetByMonth: { '2027-01': 0 },
    inputsByMonth: { '2027-01': FULL },
    phases: [{ id: 'p1', start_month: '2027-01', end_month: '2027-01', b2b_bridge_rate: 0.1 }],
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  approx(viaPhases.months[0].b2bBridge, 10.89, 'input.phases mang tỉ lệ -> bridge như đường inputsByMonth');
  approx(viaPhases.months[0].paidEom, 98.01, 'Paid EOM qua đường phases');
  // monthly_cvr 1%: New Paid = cohort 10 + 1.000 x 1% = 20; Paid
  // churn = (100 + 20) x 2% x 0,5 = 1,2 -> PaidEOM_pre = 118,8 ->
  // bridge = 10% x 118,8 = 11,88 (mô hình Phase áp trên TOÀN BỘ
  // PaidEOM_pre, khác quy tắc cũ "cvr không sinh bridge" của mô hình
  // theo Channel); Paid EOM = 106,92.
  const withCvr = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10, b2b: 1 } },
    budgetByMonth: { '2027-01': 0 },
    inputsByMonth: { '2027-01': { ...FULL_BR, monthly_cvr: 0.01 } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  assert.equal(withCvr.months[0].newPaid, 20, 'New Paid gồm cả phần cvr');
  approx(withCvr.months[0].b2bBridge, 11.88, 'bridge = 10% x PaidEOM_pre 118,8 (gồm cả phần cvr)');
  approx(withCvr.months[0].paidEom, 106.92, 'Paid EOM = 118,8 − 11,88');
});

test('BRIDGE [domain] (i3): đường dự phòng ĐÃ GỠ — funnel/inputs/bridgeByMonth mang lượng b2bBridge cũ vẫn cho bridge = 0 khi không có tỉ lệ Phase', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10, b2b: 5, b2bBridge: 5 } },
    budgetByMonth: { '2027-01': 0 },
    inputsByMonth: { '2027-01': { ...FULL, b2bBridge: 5 } },
    bridgeByMonth: { '2027-01': 5 },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  assert.equal(out.months[0].b2bBridge, 0, '3 đường lượng cũ đều mang 5 nhưng bridge vẫn 0');
  approx(out.months[0].paidEom, 108.9, 'Paid EOM = baseline 108,9');
  approx(out.months[0].newB2b, 5, 'New B2B chỉ gồm account trực tiếp 5');
  approx(out.months[0].b2bEom, 53, 'B2B EOM = 50 + 5 − 2');
});

// ============================================================ (ii) nguồn trực tiếp không trừ
test('BRIDGE [domain] (ii): Partnership/Event trực tiếp -> Paid EOM KHÔNG đổi (end-to-end forecast -> operating, không đặt tỉ lệ Phase)', () => {
  const bm = [{ brand_id: 'b1', channel: 'Partner X', group: 'Partnership', direct_budget: true, view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.0275, cost_per_result: { signup: 50000, b2b_account: 500000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Partner X', group: 'Partnership', qty: null, budget: 10000000, audience: 'both', b2b_split_pct: 40 }];
  const f = domain.forecastFunnel(rows, bm);
  approx(f.totals.b2b, 8, 'Partnership sinh 8 B2B Account trực tiếp');
  assert.equal(f.totals.b2bBridge, 0, 'trực tiếp không phải bridge');
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': f.byMonth['2027-01'] },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { ...FULL, paid_price: 50000, cogs_per_paid_user: 10000 } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  // Paid cohort 3,3; Paid churn = (100 + 3,3) x 2% x 0,5 = 1,033
  // -> Paid EOM = 102,267 — không bị trừ bởi 8 account trực tiếp.
  approx(out.months[0].paidEom, 102.267, 'Paid EOM không bị trừ bởi account trực tiếp');
  approx(out.months[0].b2bEom, 56, 'B2B EOM vẫn = 50 + 8 − 2');
  assert.equal(out.months[0].b2bBridge, 0, 'không tỉ lệ Phase -> bridge 0');
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
  assert.equal(r.b2bBridgeRate, null, 'không nguồn tỉ lệ -> b2bBridgeRate null');
  approx(r.paidEom, 108.9, 'baseline Paid EOM = 108,9');
  approx(r.freeEom, 1169.75, 'baseline Free EOM = 1.169,75');
  approx(r.revenue, 5170000, 'baseline Revenue = 47.000 x paidBase 110 = 5.170.000 (mốc trước churn 20/11)');
  approx(r.cogsFree, 12100000, 'baseline COGS Free = 10.000 x freeBase 1.210');
  approx(r.cogsPaid, 2200000, 'baseline COGS Paid = 20.000 x paidBase 110');
  approx(r.cogs, 14300000, 'baseline COGS');
  approx(r.profitAfterCogsMkt, -10130000, 'baseline Profit 1');
  approx(r.profitAfterCogsFixedMkt, -10330000, 'baseline Profit 2');
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

test('BRIDGE [app unit]: planningOperatingData map b2b_bridge_rate từ Phase vào computeOperatingFinancials — Paid EOM qua app giảm đúng bridge theo Phase', () => {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const rows = [
    { id: 'r-kol', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 1, budget: null, phase_id: 'ph-1' },
    { id: 'r-lead', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40, phase_id: 'ph-1' },
  ];
  const benchmarks = [
    { id: 'bm-kol', brand_id: 'b1', segment: null, channel: 'KOL X', group: 'KOL', unit_price: 1000000, output_per_unit: 200, view_to_visit: 1, visit_to_freemium: 1, freemium_to_paid: 0.05, direct_budget: false },
    { id: 'bm-lead', brand_id: 'b1', segment: 'b2b', channel: 'Ads B2B', group: 'Paid Media', unit_price: null, output_per_unit: null, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, cost_per_result: { lead_gen: 100000 }, direct_budget: true },
  ];
  // Phase mang b2b_bridge_rate 10%: Paid cohort = KOL 10 + Lead Gen
  // B2C 1,65 = 11,65; Paid churn = (100 + 11,65) x 2% x 0,5 = 1,1165
  // -> PaidEOM_pre = 110,5335 -> bridge = 11,05335 -> Paid EOM =
  // 99,48015. Funnel b2b trực tiếp = 0 (Lead Gen không quy đổi) nên
  // New B2B = bridge thuần 11,05335; B2B EOM = 50 + 11,05335 − 2
  // = 59,05335.
  const phases = [{ id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0, paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 50000, cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000, opening_free: 1000, opening_paid: 100, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000, opening_b2b: 50, b2b_bridge_rate: 0.1 }];
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {}, planningYear: 2027 };
  const Store = { mode: 'demo', list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? phases : coll === 'benchmarks' ? benchmarks : coll === 'phase_assumptions' ? [] : coll === 'brands' ? [] : []), get: () => null };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock + '\nreturn { planningOperatingData: planningOperatingData };');
  const h = factory(Store, domain, UI, cfValStub, () => true, () => {}, () => {}, () => ({ ok: true }), () => ({ ok: true }), () => {}, escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<table data-table-key="' + key + '">' + inner + '</table>', (m) => String(m), () => '');
  const data = h.planningOperatingData(rows, benchmarks, ['2027-01']);
  const r = data.months[0];
  approx(r.b2bBridge, 11.05335, 'bridge qua app = 10% x PaidEOM_pre 110,5335');
  approx(r.newB2b, 11.05335, 'New B2B qua app = bridge thuần (trực tiếp = 0)');
  approx(r.paidEom, 99.48015, 'Paid EOM qua app = 110,5335 − 11,05335');
  approx(data.totals.b2bBridge, 11.05335, 'Tổng bridge qua app');
  approx(r.b2bEom, 59.05335, 'B2B EOM qua app = 50 + 11,05335 − 2');
});

test('BRIDGE [static]: app.js không còn câu chữ quy tắc cũ theo Channel; câu chữ quy tắc bridge theo Phase có ở khối Phase + bảng vận hành + hint Audience', () => {
  for (const gone of ['KHÔNG bị trừ khỏi Paid EOM', 'không trừ Paid EOM', 'không bị trừ khỏi Paid', 'cầu nối paid_to_b2b']) {
    assert.ok(!src.includes(gone), 'còn sót quy tắc cũ: ' + gone);
  }
  const phrase = 'Paid User chuyển sang B2B qua cầu nối Tỉ lệ Paid → B2B của Phase bị trừ khỏi Paid EOM trong tháng chuyển đổi';
  assert.ok((src.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2, 'câu quy tắc mới phải có ở khối vận hành Phase + noteFull bảng vận hành');
  assert.ok(src.includes('data-field="b2b_bridge_rate"'), 'khối Phase phải có ô nhập b2b_bridge_rate');
  assert.ok(src.includes("b2b_bridge_rate: phaseNumField(ph, 'b2b_bridge_rate', 'b2bBridgeRate')"), 'planningOperatingData phải map b2b_bridge_rate từ Phase');
});
