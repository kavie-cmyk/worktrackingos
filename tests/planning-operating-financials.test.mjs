// tests/planning-operating-financials.test.mjs
// Bảng CHỈ SỐ VẬN HÀNH & TÀI CHÍNH theo tháng — ĐÃ CĂN CHỈNH theo
// sheet Lumilink1 (phễu Freemium/Paid):
// - funnelByMonth[m] = { views, visits, freemium, paid, b2b }.
//   Free user (dòng vào) = Freemium; New Paid = Paid (cohort từ
//   engine) + Free EOM đầu kỳ x monthly_cvr; New Free = Free user −
//   New Paid. monthly_cvr null -> phần chuyển đổi đóng góp 0 (quyết
//   định đã chốt, KHÔNG null-hoá New Paid).
// - Churn tính trên (tồn đầu kỳ + dòng vào trong tháng); RIÊNG tháng
//   đầu tiên của mảng months cả hai churn x 0,5:
//   Free churn = (Free EOM trước + Free user) x free_churn_rate;
//   Paid churn = (Paid EOM trước + New Paid) x paid_churn_rate.
//   Free EOM = EOM trước + Free user − New Paid − Free churn (kẹp ≥ 0);
//   Paid EOM = EOM trước + New Paid − Paid churn.
// - Giá Paid 3 mức: paid_price_tiers [{ price, pct }] (pct = số phần
//   trăm 0–100, tổng pct ≤ 100); ARPPU hiệu dụng = Σ price x pct/100;
//   Revenue = ARPPU hiệu dụng x Paid EOM. Vi phạm validate -> coi như
//   thiếu (missing.paid_price_tiers), Revenue/Profit null.
// - COGS TÁCH: cogsFree = cogs_per_free_user x Free EOM; cogsPaid =
//   cogs_per_paid_user x Paid EOM; COGS = cogsFree + cogsPaid. Thiếu
//   một đơn giá -> phần tương ứng + tổng + Profit null.
// - TUYỆT ĐỐI không seed số bịa: demo để trống các field tài chính.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}
function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// Bộ đầu vào đầy đủ dùng chung: giá Paid 3 mức 25.000x50% + 49.000x30%
// + 99.000x20% -> ARPPU hiệu dụng = 12.500 + 14.700 + 19.800 = 47.000đ.
const TIERS_47K = [{ price: 25000, pct: 50 }, { price: 49000, pct: 30 }, { price: 99000, pct: 20 }];
const FULL = { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price_tiers: TIERS_47K, cogs_per_free_user: 10000, cogs_per_paid_user: 20000, fixed_cost: 200000 };
const MISSING_OK = { opening: false, paid_churn_rate: false, free_churn_rate: false, paid_price_tiers: false, cogs_per_free_user: false, cogs_per_paid_user: false, fixed_cost: false };

// ------------------------------------------------- domain: ca tính tay MỚI
// Tháng đầu: opening Free 1.000 / Paid 100; Free user vào 210, cohort
// Paid 10, monthly_cvr null; free churn 5%, paid churn 2%.
//   New Paid  = 10 + 1.000 x 0 (cvr null -> +0)          = 10
//   New Free  = 210 − 10                                  = 200
//   Free churn = (1.000 + 210) x 5% x 0,5 (tháng đầu)     = 30,25
//   Paid churn = (100 + 10) x 2% x 0,5 (tháng đầu)        = 1,1
//   Free EOM  = 1.000 + 210 − 10 − 30,25                  = 1.169,75
//   Paid EOM  = 100 + 10 − 1,1                            = 108,9
//   Total users = 1.169,75 + 108,9                        = 1.278,65
//   ARPPU hiệu dụng = 47.000 -> Revenue = 47.000 x 108,9  = 5.118.300
//   cogsFree = 10.000 x 1.169,75 = 11.697.500
//   cogsPaid = 20.000 x 108,9    = 2.178.000
//   COGS     = 13.875.500
//   Profit1  = 5.118.300 − 13.875.500 − 1.000.000         = −9.757.200
//   Profit2  = Profit1 − 200.000                          = −9.957.200
test('POF [domain]: CA TÍNH TAY MỚI — tháng đầu churn x0,5 trên (đầu kỳ + dòng vào); COGS tách Free/Paid; ARPPU từ 3 mức giá = 47.000', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 5000, visits: 900, freemium: 210, paid: 10 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': FULL },
    openingFree: 1000, openingPaid: 100
  });
  const r = out.months[0];
  assert.equal(r.budget, 1000000);
  assert.equal(r.reach, 5000, 'Reach = Views');
  assert.equal(r.visits, 900);
  assert.equal(r.freeUser, 210, 'Free user (dòng vào) = Freemium');
  assert.equal(r.newPaid, 10, 'New Paid = cohort 10 + cvr null -> +0');
  assert.equal(r.newFree, 200, 'New Free = Free user − New Paid = 210 − 10');
  approx(r.freeChurn, 30.25, 'Free churn = (1000 + 210) x 5% x 0,5 (tháng đầu)');
  approx(r.freeEom, 1169.75, 'Free EOM = 1000 + 210 − 10 − 30,25');
  approx(r.paidChurn, 1.1, 'Paid churn = (100 + 10) x 2% x 0,5 (tháng đầu)');
  approx(r.paidEom, 108.9, 'Paid EOM = 100 + 10 − 1,1');
  approx(r.totalUsers, 1278.65, 'Total users = Free EOM + Paid EOM');
  approx(r.arppuEffective, 47000, 'ARPPU hiệu dụng = 25.000x50% + 49.000x30% + 99.000x20%');
  approx(r.revenue, 47000 * 108.9, 'Revenue = ARPPU hiệu dụng x Paid EOM = 5.118.300');
  approx(r.cogsFree, 10000 * 1169.75, 'cogsFree = cogs_per_free_user x Free EOM');
  approx(r.cogsPaid, 20000 * 108.9, 'cogsPaid = cogs_per_paid_user x Paid EOM');
  approx(r.cogs, 11697500 + 2178000, 'COGS tổng = cogsFree + cogsPaid = 13.875.500');
  approx(r.profitAfterCogsMkt, 5118300 - 13875500 - 1000000, 'Profit after COGS + mkt cost');
  approx(r.profitAfterCogsFixedMkt, 5118300 - 13875500 - 1000000 - 200000, 'Profit after COGS + fixed cost + mkt cost');
  assert.equal(out.totals.freeEom, 1169.75);
  assert.equal(out.totals.paidEom, 108.9);
  approx(out.totals.cogsFree, 11697500, 'Tổng cogsFree cộng dồn (flow)');
  approx(out.totals.cogsPaid, 2178000, 'Tổng cogsPaid cộng dồn (flow)');
  approx(out.totals.profitAfterCogsFixedMkt, -9957200, 'Tổng Profit cộng dồn');
  assert.deepEqual(out.missing, MISSING_OK);
});

test('POF [domain]: (b) New Paid HAI NGUỒN — monthly_cvr 1% trên tồn Free đầu kỳ 1.000 -> +10 chuyển đổi cộng vào cohort', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 100, paid: 5 } },
    budgetByMonth: { '2027-01': 0 },
    inputsByMonth: { '2027-01': { ...FULL, monthly_cvr: 0.01, paid_churn_rate: 0, free_churn_rate: 0 } },
    openingFree: 1000, openingPaid: 100
  });
  const r = out.months[0];
  assert.equal(r.newPaid, 15, 'New Paid = cohort 5 + 1.000 x 1% = 15');
  assert.equal(r.newFree, 85, 'New Free = 100 − 15');
  approx(r.freeEom, 1085, 'Free EOM = 1.000 + 100 − 15 − 0');
  approx(r.paidEom, 115, 'Paid EOM = 100 + 15 − 0');
  // monthly_cvr đọc cả key camelCase monthlyCvr.
  const out2 = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 100, paid: 5 } },
    budgetByMonth: {},
    inputsByMonth: { '2027-01': { paidChurnRate: 0, freeChurnRate: 0, monthlyCvr: 0.01, paidPriceTiers: TIERS_47K, cogsPerFreeUser: 10000, cogsPerPaidUser: 20000, fixedCost: 0 } },
    openingFree: 1000, openingPaid: 100
  });
  assert.equal(out2.months[0].newPaid, 15, 'key camelCase monthlyCvr/paidPriceTiers/cogsPer* cũng đọc được');
});

test('POF [domain]: (c) tháng 2 churn KHÔNG còn x0,5 — chuỗi 2 tháng tính tay', () => {
  // Tháng 1 = ca tính tay ở trên: Free EOM 1.169,75; Paid EOM 108,9.
  // Tháng 2 (Free user 210, cohort 10, cvr null):
  //   Free churn = (1.169,75 + 210) x 5%        = 68,9875 (KHÔNG x0,5)
  //   Paid churn = (108,9 + 10) x 2%            = 2,378
  //   Free EOM   = 1.169,75 + 210 − 10 − 68,9875 = 1.300,7625
  //   Paid EOM   = 108,9 + 10 − 2,378            = 116,522
  const out = domain.computeOperatingFinancials({
    months: ['2027-01', '2027-02'],
    funnelByMonth: {
      '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10 },
      '2027-02': { views: 0, visits: 0, freemium: 210, paid: 10 }
    },
    budgetByMonth: { '2027-01': 1000000, '2027-02': 500000 },
    inputsByMonth: { '2027-01': FULL, '2027-02': FULL },
    openingFree: 1000, openingPaid: 100
  });
  const feb = out.months[1];
  approx(feb.freeChurn, 68.9875, 'Free churn T2 = (1169,75 + 210) x 5% — không x0,5 nữa (x0,5 sẽ là 34,49375)');
  approx(feb.paidChurn, 2.378, 'Paid churn T2 = (108,9 + 10) x 2%');
  approx(feb.freeEom, 1300.7625, 'Free EOM T2');
  approx(feb.paidEom, 116.522, 'Paid EOM T2');
  assert.equal(out.totals.budget, 1500000, 'Tổng Budget cộng dồn');
  approx(out.totals.newPaid, 20, 'Tổng New Paid cộng dồn');
  approx(out.totals.freeEom, 1300.7625, 'Tổng Free EOM = giá trị tháng cuối, không cộng dồn');
  approx(out.totals.paidEom, 116.522, 'Tổng Paid EOM = tháng cuối');
});

test('POF [domain]: (e) validate paid_price_tiers — tổng pct > 100 hoặc 1 pct > 100 -> Revenue/Profit null + missing.paid_price_tiers; tổng pct < 100 vẫn hợp lệ', () => {
  const base = {
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10 } },
    budgetByMonth: { '2027-01': 100 },
    openingFree: 1000, openingPaid: 100
  };
  let out = domain.computeOperatingFinancials({ ...base, inputsByMonth: { '2027-01': { ...FULL, paid_price_tiers: [{ price: 25000, pct: 60 }, { price: 49000, pct: 50 }] } } });
  assert.equal(out.missing.paid_price_tiers, true, 'tổng pct 110 > 100 -> coi như thiếu');
  approx(out.months[0].paidEom, 108.9, 'EOM vẫn tính được');
  assert.equal(out.months[0].arppuEffective, null);
  assert.equal(out.months[0].revenue, null);
  assert.equal(out.months[0].profitAfterCogsMkt, null);
  assert.equal(out.months[0].profitAfterCogsFixedMkt, null);
  out = domain.computeOperatingFinancials({ ...base, inputsByMonth: { '2027-01': { ...FULL, paid_price_tiers: [{ price: 25000, pct: 101 }] } } });
  assert.equal(out.months[0].revenue, null, 'pct từng mức 101 > 100 -> không hợp lệ');
  assert.equal(out.missing.paid_price_tiers, true);
  out = domain.computeOperatingFinancials({ ...base, inputsByMonth: { '2027-01': { ...FULL, paid_price_tiers: [{ price: 50000, pct: 50 }] } } });
  assert.equal(out.missing.paid_price_tiers, false, 'tổng pct 50 ≤ 100 là hợp lệ');
  approx(out.months[0].arppuEffective, 25000, 'ARPPU hiệu dụng = 50.000 x 50%');
  approx(out.months[0].revenue, 25000 * 108.9, 'Revenue theo ARPPU hiệu dụng');
  out = domain.computeOperatingFinancials({ ...base, inputsByMonth: { '2027-01': { ...FULL, paid_price_tiers: [] } } });
  assert.equal(out.months[0].revenue, null, 'chưa nhập mức nào (mảng rỗng) -> thiếu như null');
  assert.equal(out.missing.paid_price_tiers, true);
});

test('POF [domain]: thiếu đầu vào -> null ("—") đúng dòng — thiếu opening đứt chuỗi tồn; thiếu tiers chỉ mất Revenue/Profit; thiếu 1 đơn giá COGS chỉ mất phần đó + tổng + Profit; thiếu fixed_cost chỉ mất Profit cuối; thiếu churn tháng đầu đứt chuỗi cả các tháng sau', () => {
  const funnel = { '2027-01': { views: 1, visits: 1, freemium: 210, paid: 10 }, '2027-02': { views: 1, visits: 1, freemium: 210, paid: 10 } };
  // Thiếu opening: flow vẫn có, churn/EOM/Revenue/COGS/Profit null.
  let out = domain.computeOperatingFinancials({ months: ['2027-01'], funnelByMonth: funnel, budgetByMonth: { '2027-01': 100 }, inputsByMonth: { '2027-01': FULL }, openingFree: null, openingPaid: null });
  assert.equal(out.missing.opening, true);
  assert.equal(out.months[0].newPaid, 10, 'flow vẫn hiện khi thiếu opening (cohort; cvr null)');
  assert.equal(out.months[0].newFree, 200, 'New Free = Free user − New Paid vẫn hiện');
  for (const k of ['paidChurn', 'freeChurn', 'paidEom', 'freeEom', 'totalUsers', 'revenue', 'cogs', 'cogsFree', 'cogsPaid', 'profitAfterCogsMkt', 'profitAfterCogsFixedMkt']) {
    assert.equal(out.months[0][k], null, 'thiếu opening -> ' + k + ' null');
  }
  // Thiếu tiers: EOM/COGS tính được, Revenue + 2 Profit null.
  out = domain.computeOperatingFinancials({ months: ['2027-01'], funnelByMonth: funnel, budgetByMonth: { '2027-01': 100 }, inputsByMonth: { '2027-01': { ...FULL, paid_price_tiers: null } }, openingFree: 1000, openingPaid: 100 });
  assert.equal(out.missing.paid_price_tiers, true);
  approx(out.months[0].paidEom, 108.9, 'thiếu tiers vẫn có EOM');
  approx(out.months[0].cogs, 13875500, 'thiếu tiers vẫn có COGS');
  assert.equal(out.months[0].revenue, null);
  assert.equal(out.months[0].profitAfterCogsMkt, null);
  assert.equal(out.months[0].profitAfterCogsFixedMkt, null);
  // Thiếu cogs_per_paid_user: cogsFree còn, cogsPaid + tổng + Profit null.
  out = domain.computeOperatingFinancials({ months: ['2027-01'], funnelByMonth: funnel, budgetByMonth: { '2027-01': 100 }, inputsByMonth: { '2027-01': { ...FULL, cogs_per_paid_user: null } }, openingFree: 1000, openingPaid: 100 });
  assert.equal(out.missing.cogs_per_paid_user, true);
  assert.equal(out.missing.cogs_per_free_user, false);
  approx(out.months[0].cogsFree, 11697500, 'cogsFree vẫn tính được');
  assert.equal(out.months[0].cogsPaid, null);
  assert.equal(out.months[0].cogs, null, 'thiếu 1 đơn giá -> COGS tổng null');
  assert.equal(out.months[0].profitAfterCogsMkt, null);
  approx(out.months[0].revenue, 5118300, 'Revenue không bị ảnh hưởng bởi thiếu COGS');
  // Thiếu fixed_cost: chỉ Profit cuối null.
  out = domain.computeOperatingFinancials({ months: ['2027-01'], funnelByMonth: funnel, budgetByMonth: { '2027-01': 100 }, inputsByMonth: { '2027-01': { ...FULL, fixed_cost: null } }, openingFree: 1000, openingPaid: 100 });
  assert.ok(out.months[0].profitAfterCogsMkt !== null, 'thiếu fixed_cost vẫn có Profit (after COGS + mkt)');
  assert.equal(out.months[0].profitAfterCogsFixedMkt, null);
  // Thiếu free_churn_rate ở tháng 1: chuỗi đứt — tháng 2 đủ input vẫn null.
  out = domain.computeOperatingFinancials({ months: ['2027-01', '2027-02'], funnelByMonth: funnel, budgetByMonth: {}, inputsByMonth: { '2027-01': { ...FULL, free_churn_rate: null }, '2027-02': FULL }, openingFree: 1000, openingPaid: 100 });
  assert.equal(out.missing.free_churn_rate, true);
  assert.equal(out.months[0].freeEom, null);
  assert.equal(out.months[1].freeEom, null, 'chuỗi đã đứt thì tháng sau không tự hồi (không điền 0 lặng lẽ)');
  assert.equal(out.totals.freeEom, null);
});

test('POF [domain]: Free EOM âm -> kẹp về 0 và đánh dấu freeClamped', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 0, paid: 50 } },
    budgetByMonth: {},
    inputsByMonth: { '2027-01': { paid_churn_rate: 0, free_churn_rate: 0, monthly_cvr: null, paid_price_tiers: [{ price: 1000, pct: 100 }], cogs_per_free_user: 100, cogs_per_paid_user: 100, fixed_cost: 0 } },
    openingFree: 10, openingPaid: 100
  });
  assert.equal(out.months[0].freeClamped, true, '10 + 0 − 50 − 0 < 0 phải kẹp');
  assert.equal(out.months[0].freeEom, 0);
  approx(out.months[0].paidEom, 150, 'Paid EOM không bị kẹp bởi Free');
});

// ---------------------------------------------------------------- demo không seed số bịa
test('POF [demo]: TUYỆT ĐỐI không seed số bịa — mọi Phase demo đều trống các field tài chính MỚI (churn / monthly_cvr / paid_price_tiers / cogs tách / fixed_cost / opening)', () => {
  for (const p of demo.phases) {
    for (const f of ['paid_churn_rate', 'free_churn_rate', 'monthly_cvr', 'paid_price_tiers', 'cogs_per_free_user', 'cogs_per_paid_user', 'fixed_cost', 'opening_free', 'opening_paid']) {
      assert.ok(p[f] === undefined || p[f] === null, `phase ${p.id} không được seed sẵn ${f}`);
    }
  }
});

// ---------------------------------------------------------------- app harness
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

function makeHarness(rows, phases, benchmarks, assumptions) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {} };
  const state = { toasts: [], updates: [], creates: [], renders: 0 };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : coll === 'phase_assumptions' ? (assumptions || []) : []),
    get: () => null,
  };
  const sUpdate = (coll, id, patch) => {
    const pool = coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : [];
    const item = pool.find((r) => r.id === id);
    if (!item) return { ok: false, error: 'Không tìm thấy dòng.' };
    Object.assign(item, patch);
    state.updates.push({ coll, id, patch });
    return { ok: true, item };
  };
  const sCreate = (coll, obj) => {
    const item = { id: 'new-' + (rows.length + 1), ...obj };
    if (coll === 'plan_rows') rows.push(item);
    state.creates.push({ coll, item });
    return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { UI: UI, planningPhaseModeHtml: planningPhaseModeHtml, planningPhaseBlockHtml: planningPhaseBlockHtml, planningOperatingData: planningOperatingData, planningOperatingTableHtml: planningOperatingTableHtml, planningKpiTablesHtml: planningKpiTablesHtml, savePhaseOperatingRate: savePhaseOperatingRate, savePhaseOperatingMoney: savePhaseOperatingMoney, savePhaseOpening: savePhaseOpening, ratePctText: ratePctText };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true,
    (m) => state.toasts.push(m),
    () => { state.renders++; },
    sUpdate, sCreate, saveResult,
    escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<div class="table-wrap"><table data-table-key="' + key + '">' + inner + '</table></div>',
    (m) => 'Tháng ' + Number(String(m).slice(5, 7)) + '/' + String(m).slice(0, 4),
    () => '<div data-viz-stub="funnel"></div>');
  return { h, state, Store, UI };
}

// Fixture app: 1 channel X, qty 1 x output 200, benchmark KEY CŨ (đi
// qua fallback của engine): v2v 1, v2s 1 -> freemium 200; f2p gộp
// 1 x 0,05 -> paid 10; ngân sách = 1 x 1.000.000 = 1.000.000đ.
// Qua công thức MỚI với opening Free 1.000 / Paid 100, churn Free 5% /
// Paid 2%, cvr trống, giá Paid 1 mức 50.000đ x 100% (ARPPU 50.000),
// COGS Free = COGS Paid = 10.000đ/user:
//   Free churn = (1.000 + 200) x 5% x 0,5 = 30; Free EOM = 1.160
//   Paid churn = (100 + 10) x 2% x 0,5 = 1,1;  Paid EOM = 108,9
//   Revenue = 50.000 x 108,9 = 5.445.000
//   cogsFree = 10.000 x 1.160 = 11.600.000; cogsPaid = 10.000 x 108,9
//     = 1.089.000; COGS = 12.689.000
//   Profit1 = −8.244.000; Profit2 = −8.444.000
const OP_BENCH = [{ id: 'bench-x', brand_id: 'b1', channel: 'X', unit_price: 1000000, output_per_unit: 200, view_to_visit: 1, visit_to_signup: 1, signup_to_first: 1, first_to_paid: 0.05, direct_budget: false }];
function opPhases(withInputs = true) {
  const base = { id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0 };
  if (!withInputs) return [base];
  return [{ ...base, paid_churn_rate: 0.02, free_churn_rate: 0.05, paid_price_tiers: [{ price: 50000, pct: 100 }], cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000, opening_free: 1000, opening_paid: 100 }];
}
function opRows() {
  return [{ id: 'r-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'X', group: 'G', qty: 1, budget: null, phase_id: 'ph-1' }];
}

test('POF [static]: khối Phase có các ô nhập operating MỚI (churn + monthly_cvr dạng %, COGS tách Free/Paid + fixed_cost dạng tiền, paid_price_tiers) + 2 ô opening (chỉ Phase đầu tiên qua UI.planningOpeningPhaseIds); bảng operating là section thứ 4 cạnh 3 bảng KPI', () => {
  const opHtml = section('function planningPhaseOperatingHtml(phase, disAttr, showOpening)', 'function planningPhaseModeHtml');
  assert.match(opHtml, /data-planning-phase-operating="1"/);
  assert.match(opHtml, /data-action-change="phase-operating-rate" data-field="paid_churn_rate"/);
  assert.match(opHtml, /data-action-change="phase-operating-rate" data-field="free_churn_rate"/);
  assert.match(opHtml, /data-action-change="phase-operating-rate" data-field="monthly_cvr"/);
  assert.match(opHtml, /data-action-change="phase-operating-money" data-field="cogs_per_free_user"/);
  assert.match(opHtml, /data-action-change="phase-operating-money" data-field="cogs_per_paid_user"/);
  assert.match(opHtml, /data-action-change="phase-operating-money" data-field="fixed_cost"/);
  assert.match(opHtml, /paid_price_tiers/);
  assert.match(opHtml, /data-action-change="phase-opening" data-field="opening_free"/);
  assert.match(opHtml, /data-action-change="phase-opening" data-field="opening_paid"/);
  assert.match(opHtml, /số tiền trên mỗi user/);
  const mode = section('function planningPhaseModeHtml(year, rows, benchmarks)', 'function planningPhaseBlockHtml');
  assert.match(mode, /UI\.planningOpeningPhaseIds\[String\(g\.phases\[0\]\.id\)\] = true/);
  assert.match(src, /if \(ctxKind === 'phase-operating-rate'\) \{ savePhaseOperatingRate\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-field'\), t\.value\); return; \}/);
  assert.match(src, /if \(ctxKind === 'phase-operating-money'\) \{ savePhaseOperatingMoney\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-field'\), t\.value\); return; \}/);
  assert.match(src, /if \(ctxKind === 'phase-opening'\) \{ savePhaseOpening\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-field'\), t\.value\); return; \}/);
  const save = section('function savePhaseOperatingField(phaseId, field, raw, isRate)', '// --- Lưu ô Số lượng trong BẢNG CHI TIẾT Theo tháng');
  assert.match(save, /phaseSaveGuard\(\)/);
  assert.match(save, /ratePatch\[field\] = n \/ 100/);
  // Hàng cốt lõi của bảng operating theo thứ tự: Budget đầu, 2 Profit
  // cuối; có Free user / New Paid / New Free / các dòng tồn / Revenue
  // và các hàng COGS tách (nhãn chi tiết COGS Free/Paid do phía app
  // chốt — ở đây chỉ khóa có ít nhất 2 hàng nhãn chứa 'COGS' ngoài
  // 'COGS B2B': hàng COGS Free + COGS Paid hoặc COGS tổng).
  const rowsDef = section('var OPERATING_ROWS = [', 'var OPERATING_MISSING_LABELS');
  const labels = [...rowsDef.matchAll(/'([a-zA-Z0-9]+)', '([^']+)'/g)].map((m) => m[2]);
  assert.equal(labels[0], 'Budget');
  assert.deepEqual(labels.slice(-2), ['Profit (after COGS + mkt cost)', 'Profit (after COGS + fixed cost + mkt cost)']);
  for (const l of ['Reach', 'Visits', 'Free user', 'New Paid', 'New Free', 'New B2B Accounts', 'Paid churn', 'Free churn', 'Paid EOM', 'Free EOM', 'Total users', 'Revenue']) {
    assert.ok(labels.includes(l), 'bảng operating thiếu hàng ' + l + ' — got: ' + labels.join(' | '));
  }
  assert.ok(labels.filter((l) => l.includes('COGS') && l !== 'COGS B2B').length >= 2, 'phải có các hàng COGS tách (Free/Paid hoặc Free/Paid/Tổng) — got: ' + labels.join(' | '));
  const kpi = section('function planningKpiTablesHtml(rows, benchmarks, months)', '// --- Bảng Chỉ số vận hành');
  assert.match(kpi, /planningOperatingTableHtml\(rows, benchmarks, months\)/);
  const tblFn = section('function planningOperatingTableHtml(rows, benchmarks, months)', '// --- Lưu các ô nhập Theo phase');
  assert.match(tblFn, /planningKpiSectionHtml\('operating', 'Chỉ số vận hành & tài chính theo tháng'/);
  assert.match(tblFn, /dòng tồn \(Paid EOM, Free EOM, Total users\) lấy giá trị tháng cuối/);
  assert.match(tblFn, /Thiếu đầu vào:/);
});

test('POF [app unit]: planningOperatingData + bảng — ca tính tay MỚI qua đúng đường app (funnel fallback key cũ + ngân sách + Phase inputs + opening)', () => {
  const rows = opRows();
  const phases = opPhases(true);
  const { h, UI } = makeHarness(rows, phases, OP_BENCH, []);
  UI.planningOpeningPhaseIds = { 'ph-1': true };
  const data = h.planningOperatingData(rows, OP_BENCH, ['2027-01']);
  const r = data.months[0];
  assert.equal(r.budget, 1000000);
  assert.equal(r.reach, 200); assert.equal(r.freeUser, 200); assert.equal(r.newPaid, 10); assert.equal(r.newFree, 190);
  approx(r.freeChurn, 30, 'Free churn qua app = (1000 + 200) x 5% x 0,5');
  approx(r.freeEom, 1160, 'Free EOM qua app');
  approx(r.paidChurn, 1.1, 'Paid churn qua app = (100 + 10) x 2% x 0,5');
  approx(r.paidEom, 108.9, 'Paid EOM qua app');
  approx(r.totalUsers, 1268.9, 'Total users qua app');
  approx(r.revenue, 5445000, 'Revenue qua app = 50.000 x 108,9');
  approx(r.cogsFree, 11600000, 'cogsFree qua app');
  approx(r.cogsPaid, 1089000, 'cogsPaid qua app');
  approx(r.cogs, 12689000, 'COGS qua app');
  approx(r.profitAfterCogsMkt, -8244000, 'Profit 1 qua app');
  approx(r.profitAfterCogsFixedMkt, -8444000, 'Profit 2 qua app');
  const html = h.planningOperatingTableHtml(rows, OP_BENCH, ['2027-01']);
  const cell = (key) => {
    const m = new RegExp('<td data-planning-operating-cell="' + key + '" data-month="2027-01">([^<]*)</td>').exec(html);
    return m ? m[1] : null;
  };
  assert.equal(cell('budget'), '1.000.000 VND');
  assert.equal(cell('freeEom'), '1.160');
  assert.equal(cell('revenue'), '5.445.000 VND');
  assert.equal(cell('profitAfterCogsFixedMkt'), '-8.444.000 VND');
  const all = h.planningKpiTablesHtml(rows, OP_BENCH, ['2027-01']);
  assert.ok(all.includes('data-planning-kpi-section="operating"'), 'section operating phải nằm cạnh 3 bảng KPI');
  assert.ok(all.includes('data-planning-operating-row="freeEom"'));
});

test('POF [app unit]: thiếu đầu vào ở app — Phase chưa nhập gì (như demo) thì churn/EOM/Revenue/Profit hiện "—" kèm ghi chú thiếu, flow vẫn hiện', () => {
  const rows = opRows();
  const phases = opPhases(false);
  const { h } = makeHarness(rows, phases, OP_BENCH, []);
  const data = h.planningOperatingData(rows, OP_BENCH, ['2027-01']);
  assert.equal(data.missing.opening, true);
  assert.equal(data.missing.paid_churn_rate, true);
  assert.equal(data.missing.paid_price_tiers, true);
  assert.equal(data.months[0].freeEom, null);
  assert.equal(data.months[0].budget, 1000000, 'Budget vẫn hiện');
  const html = h.planningOperatingTableHtml(rows, OP_BENCH, ['2027-01']);
  const cell = (key) => {
    const m = new RegExp('<td data-planning-operating-cell="' + key + '" data-month="2027-01">([^<]*)</td>').exec(html);
    return m ? m[1] : null;
  };
  assert.equal(cell('freeEom'), '—');
  assert.equal(cell('revenue'), '—');
  assert.equal(cell('profitAfterCogsFixedMkt'), '—');
  assert.equal(cell('budget'), '1.000.000 VND');
  assert.ok(html.includes('Thiếu đầu vào:'), 'phải ghi chú thiếu đầu vào nào');
  assert.ok(html.includes('Paid churn rate'), 'ghi chú phải nêu tên ô thiếu');
});

test('POF [app unit]: lưu ô Phase — tỉ lệ nhập % lưu dạng phân số (gồm monthly_cvr) và hiển thị lại đúng %; tiền >= 0; xoá trắng về null (thiếu); validate chặn 101% / âm', () => {
  const rows = opRows();
  const phases = opPhases(false);
  // Mức giá Paid lưu dạng mảng trên Phase (editor mức giá của app ghi
  // thẳng field này) — đặt sẵn để bảng tính được khi đủ các ô còn lại.
  phases[0].paid_price_tiers = [{ price: 50000, pct: 100 }];
  const { h, state } = makeHarness(rows, phases, OP_BENCH, []);
  h.savePhaseOperatingRate('ph-1', 'free_churn_rate', '5');
  assert.equal(phases[0].free_churn_rate, 0.05, 'nhập 5% lưu 0,05 như cơ chế tỉ lệ phase hiện có');
  assert.equal(h.ratePctText(phases[0].free_churn_rate), '5', 'hiển thị lại đúng 5%');
  h.savePhaseOperatingRate('ph-1', 'paid_churn_rate', '2');
  assert.equal(phases[0].paid_churn_rate, 0.02);
  h.savePhaseOperatingMoney('ph-1', 'cogs_per_free_user', '10000');
  assert.equal(phases[0].cogs_per_free_user, 10000);
  h.savePhaseOperatingMoney('ph-1', 'cogs_per_paid_user', '10000');
  assert.equal(phases[0].cogs_per_paid_user, 10000);
  h.savePhaseOpening('ph-1', 'opening_free', '1000');
  assert.equal(phases[0].opening_free, 1000, 'opening lưu trên chính Phase đầu tiên');
  h.savePhaseOpening('ph-1', 'opening_paid', '100');
  assert.equal(phases[0].opening_paid, 100);
  // Sau khi nhập đủ qua đúng hàm lưu, bảng tính được ngay (không cache).
  const data = h.planningOperatingData(rows, OP_BENCH, ['2027-01']);
  approx(data.months[0].freeEom, 1160, 'Free EOM tính được sau khi nhập churn + opening qua hàm lưu (thiếu fixed_cost không chặn EOM)');
  approx(data.months[0].revenue, 5445000, 'Revenue tính được sau khi có paid_price_tiers');
  assert.equal(data.months[0].profitAfterCogsFixedMkt, null, 'thiếu fixed_cost -> chỉ Profit cuối là —');
  h.savePhaseOperatingMoney('ph-1', 'fixed_cost', '200000');
  approx(h.planningOperatingData(rows, OP_BENCH, ['2027-01']).months[0].profitAfterCogsFixedMkt, -8444000, 'nhập fixed_cost xong Profit cuối hiện ngay');
  // monthly_cvr nhập % lưu phân số; New Paid thêm nguồn chuyển đổi:
  // 10 + 1.000 x 1% = 20 -> Free EOM = 1.000 + 200 − 20 − 30 = 1.150;
  // Paid churn = (100 + 20) x 2% x 0,5 = 1,2 -> Paid EOM = 118,8.
  h.savePhaseOperatingRate('ph-1', 'monthly_cvr', '1');
  assert.equal(phases[0].monthly_cvr, 0.01, 'monthly_cvr nhập 1% lưu 0,01');
  const data2 = h.planningOperatingData(rows, OP_BENCH, ['2027-01']);
  assert.equal(data2.months[0].newPaid, 20, 'New Paid = cohort 10 + tồn Free 1.000 x cvr 1%');
  approx(data2.months[0].freeEom, 1150, 'Free EOM sau khi có monthly_cvr');
  approx(data2.months[0].paidEom, 118.8, 'Paid EOM sau khi có monthly_cvr');
  // Xoá trắng -> null (thiếu), không phải 0.
  h.savePhaseOperatingRate('ph-1', 'free_churn_rate', '');
  assert.equal(phases[0].free_churn_rate, null);
  // Validate: 101% và số âm bị chặn, dữ liệu không đổi.
  const updatesBefore = state.updates.length;
  h.savePhaseOperatingRate('ph-1', 'paid_churn_rate', '101');
  h.savePhaseOperatingMoney('ph-1', 'cogs_per_free_user', '-5');
  h.savePhaseOpening('ph-1', 'opening_free', '-1');
  assert.equal(state.updates.length, updatesBefore, 'nhập sai không được ghi');
  assert.equal(phases[0].paid_churn_rate, 0.02);
  assert.equal(phases[0].cogs_per_free_user, 10000);
  // Field lạ bị chặn ở whitelist.
  h.savePhaseOperatingRate('ph-1', 'view_to_visit', '5');
  assert.equal(phases[0].view_to_visit, undefined);
});

test('POF [app unit]: khối Phase render — các ô operating ở mọi Phase; 2 ô opening CHỈ ở Phase đầu tiên của Brand trong năm', () => {
  const rows = [];
  const phases = [
    { id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
    { id: 'ph-2', brand_id: 'b1', name: 'Phase 2', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5 },
  ];
  const { h } = makeHarness(rows, phases, OP_BENCH, []);
  const html = h.planningPhaseModeHtml(2027, rows, OP_BENCH);
  assert.equal(html.split('data-planning-phase-operating="1"').length - 1, 2, 'mỗi Phase 1 khối operating');
  assert.equal(html.split('data-planning-phase-opening="1"').length - 1, 1, 'opening chỉ xuất hiện 1 lần cho cả năm/Brand');
  const openIdx = html.indexOf('data-planning-phase-opening="1"');
  const ph2Idx = html.indexOf('data-planning-phase="ph-2"');
  assert.ok(openIdx !== -1 && (ph2Idx === -1 || openIdx < ph2Idx), 'khối opening nằm trong Phase đầu tiên (ph-1)');
  assert.ok(html.includes('data-action-change="phase-opening" data-field="opening_free" data-phase-id="ph-1"'));
  // Sau khi lưu tỉ lệ qua hàm lưu, render lại hiện đúng % đã nhập.
  h.savePhaseOperatingRate('ph-1', 'free_churn_rate', '5');
  const html2 = h.planningPhaseModeHtml(2027, rows, OP_BENCH);
  const m = /data-field="free_churn_rate" data-phase-id="ph-1"[^>]*value="([^"]*)"/.exec(html2) || /value="([^"]*)"[^>]*data-field="free_churn_rate" data-phase-id="ph-1"/.exec(html2);
  assert.ok(m && m[1] === '5', 'ô Free churn rate phải hiện lại 5 sau khi lưu, got: ' + (m && m[1]));
});
