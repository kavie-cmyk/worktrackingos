// tests/planning-operating-financials.test.mjs
// Bảng CHỈ SỐ VẬN HÀNH & TÀI CHÍNH theo tháng (phần bổ sung — Zac
// duyệt; COGS tính theo SỐ TIỀN TRÊN MỖI USER — VNĐ/user/tháng —
// KHÔNG theo % doanh thu).
// - 5 ô nhập theo Brand x Phase đặt trong khối "Chỉ số vận hành &
//   tài chính" ở chế độ Theo phase: paid_churn_rate / free_churn_rate
//   (%/tháng, lưu dạng phân số như các tỉ lệ phase hiện có), arppu,
//   cogs_per_user, fixed_cost (VNĐ, áp mọi tháng thuộc phase).
// - opening_free / opening_paid nhập MỘT LẦN theo Brand x năm, đặt ở
//   khối Phase ĐẦU TIÊN của năm (lưu trên chính Phase đó).
// - TUYỆT ĐỐI không seed số bịa: demo để trống cả 7 field (file nguồn
//   không có churn/ARPPU/COGS) — thiếu đầu vào thì chỉ số liên quan
//   hiện "—" kèm ghi chú thiếu ô nào, không điền 0 lặng lẽ.
// - Công thức (domain.computeOperatingFinancials): Paid churn =
//   Paid EOM trước x paid_churn_rate(phase); Free churn tương tự;
//   Free EOM = EOM trước + New Free − New Paid − Free churn (kẹp ≥ 0);
//   Paid EOM = EOM trước + New Paid − Paid churn; Total users =
//   Free EOM + Paid EOM; Revenue = arppu x Paid EOM; COGS =
//   cogs_per_user x Total users; Profit (after COGS + mkt cost) =
//   Revenue − COGS − Budget; Profit (after COGS + fixed cost + mkt
//   cost) = trên − fixed_cost. Cột Tổng: flow cộng dồn, tồn lấy
//   giá trị tháng cuối, Profit cộng dồn.

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

// ---------------------------------------------------------------- domain: ca tính tay của đặc tả
test('POF [domain]: CA TÍNH TAY — opening Free 1000 / Paid 100; 1 tháng New Free 200, New Paid 10, free churn 5% -> Free churn 50, Free EOM 1140; paid churn 2% -> Paid churn 2, Paid EOM 108; Revenue = arppu x 108; COGS = cogs_per_user x 1248; 2 Profit khớp công thức', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 5000, visits: 900, signups: 300, first: 200, paid: 10 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { paid_churn_rate: 0.02, free_churn_rate: 0.05, arppu: 50000, cogs_per_user: 10000, fixed_cost: 200000 } },
    openingFree: 1000, openingPaid: 100
  });
  const r = out.months[0];
  assert.equal(r.budget, 1000000);
  assert.equal(r.reach, 5000, 'Reach = Views');
  assert.equal(r.visits, 900);
  assert.equal(r.freeUser, 300, 'Free user = Signups');
  assert.equal(r.newFree, 200, 'New Free = First Starts');
  assert.equal(r.newPaid, 10, 'New Paid = Paid');
  approx(r.freeChurn, 50, 'Free churn = 1000 x 5%');
  approx(r.freeEom, 1140, 'Free EOM = 1000 + 200 − 10 − 50');
  approx(r.paidChurn, 2, 'Paid churn = 100 x 2%');
  approx(r.paidEom, 108, 'Paid EOM = 100 + 10 − 2');
  approx(r.totalUsers, 1248, 'Total users = 1140 + 108');
  approx(r.revenue, 50000 * 108, 'Revenue = arppu x Paid EOM');
  approx(r.cogs, 10000 * 1248, 'COGS = cogs_per_user x Total users (số tiền/user, không % doanh thu)');
  approx(r.profitAfterCogsMkt, 5400000 - 12480000 - 1000000, 'Profit after COGS + mkt cost');
  approx(r.profitAfterCogsFixedMkt, 5400000 - 12480000 - 1000000 - 200000, 'Profit after COGS + fixed cost + mkt cost');
  // Cột Tổng với 1 tháng: flow = chính tháng; tồn = tháng cuối.
  assert.equal(out.totals.freeEom, 1140);
  assert.equal(out.totals.paidEom, 108);
  approx(out.totals.profitAfterCogsFixedMkt, -8280000, 'Tổng Profit cộng dồn');
  assert.deepEqual(out.missing, { opening: false, paid_churn_rate: false, free_churn_rate: false, arppu: false, cogs_per_user: false, fixed_cost: false });
});

test('POF [domain]: chuỗi nhiều tháng — tồn tháng sau ăn tồn tháng trước; cột Tổng flow cộng dồn, tồn lấy tháng cuối', () => {
  const inputs = { paid_churn_rate: 0.02, free_churn_rate: 0.05, arppu: 50000, cogs_per_user: 10000, fixed_cost: 200000 };
  const out = domain.computeOperatingFinancials({
    months: ['2027-01', '2027-02'],
    funnelByMonth: {
      '2027-01': { views: 0, visits: 0, signups: 0, first: 200, paid: 10 },
      '2027-02': { views: 0, visits: 0, signups: 0, first: 100, paid: 20 }
    },
    budgetByMonth: { '2027-01': 1000000, '2027-02': 500000 },
    inputsByMonth: { '2027-01': inputs, '2027-02': inputs },
    openingFree: 1000, openingPaid: 100
  });
  const feb = out.months[1];
  approx(feb.freeChurn, 1140 * 0.05, 'Free churn T2 = Free EOM T1 x 5%');
  approx(feb.freeEom, 1140 + 100 - 20 - 57, 'Free EOM T2 = 1163');
  approx(feb.paidChurn, 108 * 0.02, 'Paid churn T2');
  approx(feb.paidEom, 108 + 20 - 2.16, 'Paid EOM T2 = 125,84');
  assert.equal(out.totals.budget, 1500000, 'Tổng Budget cộng dồn');
  approx(out.totals.newPaid, 30, 'Tổng New Paid cộng dồn');
  approx(out.totals.freeEom, 1163, 'Tổng Free EOM = giá trị tháng cuối, không cộng dồn');
  approx(out.totals.paidEom, 125.84, 'Tổng Paid EOM = tháng cuối');
});

test('POF [domain]: thiếu đầu vào -> null ("—") đúng dòng — thiếu opening đứt chuỗi tồn; thiếu arppu chỉ mất Revenue/Profit; thiếu fixed_cost chỉ mất Profit cuối; thiếu churn tháng đầu đứt chuỗi cả các tháng sau', () => {
  const full = { paid_churn_rate: 0.02, free_churn_rate: 0.05, arppu: 50000, cogs_per_user: 10000, fixed_cost: 200000 };
  const funnel = { '2027-01': { views: 1, visits: 1, signups: 1, first: 200, paid: 10 }, '2027-02': { views: 1, visits: 1, signups: 1, first: 100, paid: 20 } };
  // Thiếu opening: flow vẫn có, churn/EOM/Revenue/COGS/Profit null.
  let out = domain.computeOperatingFinancials({ months: ['2027-01'], funnelByMonth: funnel, budgetByMonth: { '2027-01': 100 }, inputsByMonth: { '2027-01': full }, openingFree: null, openingPaid: null });
  assert.equal(out.missing.opening, true);
  assert.equal(out.months[0].newPaid, 10, 'flow vẫn hiện khi thiếu opening');
  for (const k of ['paidChurn', 'freeChurn', 'paidEom', 'freeEom', 'totalUsers', 'revenue', 'cogs', 'profitAfterCogsMkt', 'profitAfterCogsFixedMkt']) {
    assert.equal(out.months[0][k], null, 'thiếu opening -> ' + k + ' null');
  }
  // Thiếu arppu: EOM/COGS tính được, Revenue + 2 Profit null.
  out = domain.computeOperatingFinancials({ months: ['2027-01'], funnelByMonth: funnel, budgetByMonth: { '2027-01': 100 }, inputsByMonth: { '2027-01': { ...full, arppu: null } }, openingFree: 1000, openingPaid: 100 });
  assert.equal(out.missing.arppu, true);
  approx(out.months[0].paidEom, 108, 'thiếu arppu vẫn có EOM');
  approx(out.months[0].cogs, 12480000, 'thiếu arppu vẫn có COGS');
  assert.equal(out.months[0].revenue, null);
  assert.equal(out.months[0].profitAfterCogsMkt, null);
  assert.equal(out.months[0].profitAfterCogsFixedMkt, null);
  // Thiếu fixed_cost: chỉ Profit cuối null.
  out = domain.computeOperatingFinancials({ months: ['2027-01'], funnelByMonth: funnel, budgetByMonth: { '2027-01': 100 }, inputsByMonth: { '2027-01': { ...full, fixed_cost: null } }, openingFree: 1000, openingPaid: 100 });
  assert.ok(out.months[0].profitAfterCogsMkt !== null, 'thiếu fixed_cost vẫn có Profit (after COGS + mkt)');
  assert.equal(out.months[0].profitAfterCogsFixedMkt, null);
  // Thiếu free_churn_rate ở tháng 1: chuỗi đứt — tháng 2 đủ input vẫn null.
  out = domain.computeOperatingFinancials({ months: ['2027-01', '2027-02'], funnelByMonth: funnel, budgetByMonth: {}, inputsByMonth: { '2027-01': { ...full, free_churn_rate: null }, '2027-02': full }, openingFree: 1000, openingPaid: 100 });
  assert.equal(out.missing.free_churn_rate, true);
  assert.equal(out.months[0].freeEom, null);
  assert.equal(out.months[1].freeEom, null, 'chuỗi đã đứt thì tháng sau không tự hồi (không điền 0 lặng lẽ)');
  assert.equal(out.totals.freeEom, null);
});

test('POF [domain]: Free EOM âm -> kẹp về 0 và đánh dấu freeClamped', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, signups: 0, first: 0, paid: 50 } },
    budgetByMonth: {},
    inputsByMonth: { '2027-01': { paid_churn_rate: 0, free_churn_rate: 0, arppu: 1000, cogs_per_user: 100, fixed_cost: 0 } },
    openingFree: 10, openingPaid: 100
  });
  assert.equal(out.months[0].freeClamped, true, '10 + 0 − 50 − 0 < 0 phải kẹp');
  assert.equal(out.months[0].freeEom, 0);
  approx(out.months[0].paidEom, 150, 'Paid EOM không bị kẹp bởi Free');
});

// ---------------------------------------------------------------- demo không seed số bịa
test('POF [demo]: TUYỆT ĐỐI không seed số bịa — mọi Phase demo đều trống paid_churn_rate / free_churn_rate / arppu / cogs_per_user / fixed_cost / opening_free / opening_paid', () => {
  for (const p of demo.phases) {
    for (const f of ['paid_churn_rate', 'free_churn_rate', 'arppu', 'cogs_per_user', 'fixed_cost', 'opening_free', 'opening_paid']) {
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

// Fixture app: 1 channel X, qty 1 x output 200, mọi tỉ lệ = 1 trừ
// first_to_paid 0,05 -> funnel tháng: views/visits/signups/first = 200,
// paid = 10; ngân sách = 1 x 1.000.000 = 1.000.000đ (đúng ca tính tay:
// New Free 200, New Paid 10, Budget 1.000.000).
const OP_BENCH = [{ id: 'bench-x', brand_id: 'b1', channel: 'X', unit_price: 1000000, output_per_unit: 200, view_to_visit: 1, visit_to_signup: 1, signup_to_first: 1, first_to_paid: 0.05, direct_budget: false }];
function opPhases(withInputs = true) {
  const base = { id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0 };
  if (!withInputs) return [base];
  return [{ ...base, paid_churn_rate: 0.02, free_churn_rate: 0.05, arppu: 50000, cogs_per_user: 10000, fixed_cost: 200000, opening_free: 1000, opening_paid: 100 }];
}
function opRows() {
  return [{ id: 'r-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'X', group: 'G', qty: 1, budget: null, phase_id: 'ph-1' }];
}

test('POF [static]: khối Phase có 5 ô nhập operating + 2 ô opening (chỉ Phase đầu tiên qua UI.planningOpeningPhaseIds); handler + hàm lưu qua guard; bảng operating là section thứ 4 cạnh 3 bảng KPI, hàng đúng thứ tự bản gốc', () => {
  const opHtml = section('function planningPhaseOperatingHtml(phase, disAttr, showOpening)', 'function planningPhaseModeHtml');
  assert.match(opHtml, /data-planning-phase-operating="1"/);
  assert.match(opHtml, /data-action-change="phase-operating-rate" data-field="paid_churn_rate"/);
  assert.match(opHtml, /data-action-change="phase-operating-rate" data-field="free_churn_rate"/);
  assert.match(opHtml, /data-action-change="phase-operating-money" data-field="arppu"/);
  assert.match(opHtml, /data-action-change="phase-operating-money" data-field="cogs_per_user"/);
  assert.match(opHtml, /data-action-change="phase-operating-money" data-field="fixed_cost"/);
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
  // Thứ tự hàng của bảng đúng bản gốc của Zac.
  const rowsDef = section('var OPERATING_ROWS = [', 'var OPERATING_MISSING_LABELS');
  const labels = [...rowsDef.matchAll(/'([a-zA-Z]+)', '([^']+)'/g)].map((m) => m[2]);
  assert.deepEqual(labels, ['Budget', 'Reach', 'Visits', 'Free user', 'New Paid', 'New Free', 'Paid churn', 'Free churn', 'Paid EOM', 'Free EOM', 'Total users', 'Revenue', 'Profit (after COGS + mkt cost)', 'Profit (after COGS + fixed cost + mkt cost)']);
  const kpi = section('function planningKpiTablesHtml(rows, benchmarks, months)', '// --- Bảng Chỉ số vận hành');
  assert.match(kpi, /planningOperatingTableHtml\(rows, benchmarks, months\)/);
  const tblFn = section('function planningOperatingTableHtml(rows, benchmarks, months)', '// --- Lưu các ô nhập Theo phase');
  assert.match(tblFn, /planningKpiSectionHtml\('operating', 'Chỉ số vận hành & tài chính theo tháng'/);
  assert.match(tblFn, /dòng tồn \(Paid EOM, Free EOM, Total users\) lấy giá trị tháng cuối/);
  assert.match(tblFn, /Thiếu đầu vào:/);
});

test('POF [app unit]: planningOperatingData + bảng — ca tính tay qua đúng đường app (funnel + ngân sách + Phase inputs + opening)', () => {
  const rows = opRows();
  const phases = opPhases(true);
  const { h, UI } = makeHarness(rows, phases, OP_BENCH, []);
  UI.planningOpeningPhaseIds = { 'ph-1': true };
  const data = h.planningOperatingData(rows, OP_BENCH, ['2027-01']);
  const r = data.months[0];
  assert.equal(r.budget, 1000000);
  assert.equal(r.reach, 200); assert.equal(r.newFree, 200); assert.equal(r.newPaid, 10);
  approx(r.freeChurn, 50, 'Free churn qua app');
  approx(r.freeEom, 1140, 'Free EOM qua app');
  approx(r.paidChurn, 2, 'Paid churn qua app');
  approx(r.paidEom, 108, 'Paid EOM qua app');
  approx(r.totalUsers, 1248, 'Total users qua app');
  approx(r.revenue, 5400000, 'Revenue qua app');
  approx(r.cogs, 12480000, 'COGS qua app');
  approx(r.profitAfterCogsMkt, -8080000, 'Profit 1 qua app');
  approx(r.profitAfterCogsFixedMkt, -8280000, 'Profit 2 qua app');
  const html = h.planningOperatingTableHtml(rows, OP_BENCH, ['2027-01']);
  const cell = (key) => {
    const m = new RegExp('<td data-planning-operating-cell="' + key + '" data-month="2027-01">([^<]*)</td>').exec(html);
    return m ? m[1] : null;
  };
  assert.equal(cell('budget'), '1.000.000 VND');
  assert.equal(cell('freeEom'), '1.140');
  assert.equal(cell('paidEom'), '108');
  assert.equal(cell('totalUsers'), '1.248');
  assert.equal(cell('revenue'), '5.400.000 VND');
  assert.equal(cell('profitAfterCogsFixedMkt'), '-8.280.000 VND');
  // Bảng operating nằm trong planningKpiTablesHtml như section thứ 4.
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

test('POF [app unit]: lưu ô Phase — tỉ lệ nhập % lưu dạng phân số và hiển thị lại đúng %; tiền >= 0; xoá trắng về null (thiếu); validate chặn 101% / âm', () => {
  const rows = opRows();
  const phases = opPhases(false);
  const { h, state } = makeHarness(rows, phases, OP_BENCH, []);
  h.savePhaseOperatingRate('ph-1', 'free_churn_rate', '5');
  assert.equal(phases[0].free_churn_rate, 0.05, 'nhập 5% lưu 0,05 như cơ chế tỉ lệ phase hiện có');
  assert.equal(h.ratePctText(phases[0].free_churn_rate), '5', 'hiển thị lại đúng 5%');
  h.savePhaseOperatingRate('ph-1', 'paid_churn_rate', '2');
  assert.equal(phases[0].paid_churn_rate, 0.02);
  h.savePhaseOperatingMoney('ph-1', 'arppu', '50000');
  assert.equal(phases[0].arppu, 50000);
  h.savePhaseOperatingMoney('ph-1', 'cogs_per_user', '10000');
  assert.equal(phases[0].cogs_per_user, 10000);
  h.savePhaseOpening('ph-1', 'opening_free', '1000');
  assert.equal(phases[0].opening_free, 1000, 'opening lưu trên chính Phase đầu tiên');
  h.savePhaseOpening('ph-1', 'opening_paid', '100');
  assert.equal(phases[0].opening_paid, 100);
  // Sau khi nhập đủ qua đúng hàm lưu, bảng tính được ngay (không cache).
  const data = h.planningOperatingData(rows, OP_BENCH, ['2027-01']);
  approx(data.months[0].freeEom, 1140, 'Free EOM tính được sau khi nhập churn + opening qua hàm lưu (thiếu fixed_cost không chặn EOM)');
  approx(data.months[0].revenue, 5400000, 'Revenue tính được sau khi nhập arppu');
  assert.equal(data.months[0].profitAfterCogsFixedMkt, null, 'thiếu fixed_cost -> chỉ Profit cuối là —');
  h.savePhaseOperatingMoney('ph-1', 'fixed_cost', '200000');
  approx(h.planningOperatingData(rows, OP_BENCH, ['2027-01']).months[0].profitAfterCogsFixedMkt, -8280000, 'nhập fixed_cost xong Profit cuối hiện ngay');
  // Xoá trắng -> null (thiếu), không phải 0.
  h.savePhaseOperatingRate('ph-1', 'free_churn_rate', '');
  assert.equal(phases[0].free_churn_rate, null);
  // Validate: 101% và số âm bị chặn, dữ liệu không đổi.
  const updatesBefore = state.updates.length;
  h.savePhaseOperatingRate('ph-1', 'paid_churn_rate', '101');
  h.savePhaseOperatingMoney('ph-1', 'arppu', '-5');
  h.savePhaseOpening('ph-1', 'opening_free', '-1');
  assert.equal(state.updates.length, updatesBefore, 'nhập sai không được ghi');
  assert.equal(phases[0].paid_churn_rate, 0.02);
  assert.equal(phases[0].arppu, 50000);
  // Field lạ bị chặn ở whitelist.
  h.savePhaseOperatingRate('ph-1', 'view_to_visit', '5');
  assert.equal(phases[0].view_to_visit, undefined);
});

test('POF [app unit]: khối Phase render — 5 ô operating ở mọi Phase; 2 ô opening CHỈ ở Phase đầu tiên của Brand trong năm', () => {
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
