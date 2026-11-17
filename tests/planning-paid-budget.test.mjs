// tests/planning-paid-budget.test.mjs
// Planning Theo tháng — NGOẠI LỆ Paid Media: nhập ngân sách trực tiếp
// theo tháng trong BẢNG CHI TIẾT + chỉ số Paid suy ra từ ngân sách.
// Chốt của Zac (đợt này): CHỈ dòng thuộc nhóm "Paid Media" (qty null,
// ngân sách ở field budget) mới được nhập ngân sách trực tiếp theo
// tháng, vì chỉ số Paid Media suy ra từ ngân sách. Mọi dòng không-paid
// giữ nguyên hành vi của commit ec2ab1b: ngân sách chỉ tự tính
// (qty × đơn giá hiệu dụng), không có ô nhập ngân sách.
// Tên hàm/handler dùng riêng "paid" (planning-month-paid-budget /
// savePlanningMonthPaidBudget / parsePlanPaidBudget) để KHÔNG hồi sinh
// cơ chế sửa ngân sách tổng quát đã gỡ ở 06d8ffc -> ec2ab1b.
//
// Forecast Paid — căn cứ file nguồn (TUYỆT ĐỐI không bịa số):
// Lumus 2027 Master Forecast (.xlsm), sheet 03 Inputs R59/R60:
//   Meta Ads:   traffic share (cột M) 0,6; COST/LP VISIT (cột N) 20.000đ;
//               visit→signup 0,09 / signup→first 0,5 / first→paid 0,055.
//   TikTok Ads: traffic share 0,7; cost/LP visit 22.000đ; hạ nguồn như trên.
// Công thức sheet 04 Monthly (cột H VISITS):
//   Visits = Ngân sách VNĐ × traffic_share ÷ cost_per_visit
//   (file tính bằng USD × FX 26.000 — tương đương vì ngân sách plan đã
//   là VNĐ). Kiểm chứng khớp sheet 02 KPI Budget: Meta cả năm
//   546.000.000 × 0,6 ÷ 20.000 = 16.380 Visits / 1.474,2 Signups /
//   737,1 First; TikTok 182.000.000 × 0,7 ÷ 22.000 = 5.790,909… Visits.
// Views của Paid: file nguồn ĐỂ TRỐNG cột REACH/VIEWS cho Paid ->
// forecast Paid bắt đầu ở Visits, Views đóng góp 0, KHÔNG suy Views.
// Paid (bước cuối) theo chuỗi thống nhất của app như KOL: First ×
// first_to_paid (file nguồn tính New Paid theo cohort lag riêng — app
// không dùng cơ chế lag đó cho bất kỳ channel nào, giữ nhất quán app).
//
// Cách xử lý tháng NHIỀU dòng Paid khi lưu (ghi rõ theo yêu cầu):
// phân bổ TỔNG ngân sách mới về các dòng theo tỉ lệ ngân sách hiện tại
// bằng distributeQty — cùng cơ chế ô Số lượng (dòng 0 giữ 0; mọi dòng
// đều 0 thì chia đều; tổng sau lưu đúng bằng số đã nhập).
//
// Neo trước khi sửa (phải giữ nguyên): Meta Ads năm 546.000.000đ;
// TikTok Ads 182.000.000đ; tổng Paid Ads 728.000.000đ; tổng ngân sách
// năm Lumus 1.515.500.000đ; tổng content 776.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}
function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
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
    '\nreturn { planRowIsPaidMedia: planRowIsPaidMedia, planMonthIsPaidMedia: planMonthIsPaidMedia, parsePlanPaidBudget: parsePlanPaidBudget, planRowEffectiveBudget: planRowEffectiveBudget, planMonthBudget: planMonthBudget, planBudgetFor: planBudgetFor, funnelTotalsFor: funnelTotalsFor, planningFunnelSteps: planningFunnelSteps, savePlanningMonthPaidBudget: savePlanningMonthPaidBudget };');
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

const PHASES = [
  { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
  { id: 'phase-lumus-2', brand_id: 'brand-lumus-ai', name: 'Test & Validate', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5 },
];
const BENCHMARKS = [
  { id: 'bench-kol-nano', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Nano', unit_price: 1500000, output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 },
  { id: 'bench-meta', brand_id: 'brand-lumus-ai', segment: 'b2c', channel: 'Meta Ads', unit_price: null, output_per_unit: null, view_to_visit: null, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, traffic_share: 0.6, cost_per_visit: 20000, direct_budget: true },
];
function baseRows() {
  return [
    { id: 'r-kol-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-ads-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 1000000, phase_id: 'phase-lumus-1' },
    { id: 'r-ads-feb', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-02', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 2000000, phase_id: 'phase-lumus-1' },
    { id: 'r-camp-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'PR GameK', group: 'Campaign Budget', unit: null, qty: null, budget: 6600000, phase_id: 'phase-lumus-1' },
    // Ô nhiều dòng Paid kiểu SAVA Meta Ads 2026-11 (3 dòng / tháng).
    { id: 'r-multi-1', brand_id: 'brand-sava-meta', segment: 'b2c', month: '2026-11', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 4396000, phase_id: 'phase-sava-play' },
    { id: 'r-multi-2', brand_id: 'brand-sava-meta', segment: 'b2c', month: '2026-11', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 2000000, phase_id: 'phase-sava-play' },
    { id: 'r-multi-3', brand_id: 'brand-sava-meta', segment: 'b2c', month: '2026-11', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 9438000, phase_id: 'phase-sava-play' },
  ];
}
function budgetTotalViaApp(h, rows, benchmarks) {
  return h.planBudgetFor(rows, benchmarks || BENCHMARKS).reduce((s, x) => s + x.total, 0);
}

// ---------- [static] wiring hai chiều: CÓ ở Paid, KHÔNG ở dòng thường ----------
test('PPB [static]: bảng chi tiết — ô nhập ngân sách CHỈ ở nhánh Paid Media (planning-month-paid-budget + nhãn + chú thích); dòng thường vẫn span chỉ hiển thị; handler + hàm lưu + CSS đủ', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const detail = v.slice(v.indexOf('// Bảng chi tiết của dòng đang chọn'), v.indexOf('// Chart ngân sách dự kiến theo tháng'));
  assert.ok(detail.length > 0);
  // Nhánh Paid: đúng MỘT ô nhập ngân sách trong bảng chi tiết, gated bởi Paid.
  assert.equal(detail.split('data-action-change="planning-month-paid-budget"').length - 1, 1, 'chỉ được có đúng 1 mẫu ô nhập ngân sách (ở nhánh Paid)');
  assert.match(detail, /var cellIsPaid = cellRows\.some\(planRowIsPaidMedia\);/);
  assert.match(detail, /if \(cellIsPaid \|\| \(!cellRows\.length && selHasPaid\)\) \{/);
  assert.match(detail, /class="phase-input planning-month-input planning-paid-budget-input" type="number" step="1" min="0"/);
  assert.match(detail, /data-planning-paid-budget-label="1">Paid Media — nhập ngân sách trực tiếp</);
  assert.match(detail, /data-planning-paid-budget-hint="1"/);
  assert.match(detail, /Dòng Paid Media: nhập ngân sách trực tiếp theo tháng/);
  // Nhánh thường vẫn tồn tại NGUYÊN: span chỉ hiển thị + nhãn dữ liệu nguồn.
  assert.match(detail, /budgetCell = '<span data-planning-budget-value="1">'/);
  assert.match(detail, /data-planning-budget-source="1">dữ liệu nguồn</);
  // Cột Đơn giá / Số lượng của dòng Paid giữ nguyên trạng '—'.
  assert.match(detail, /priceCell = '—';/);
  // Helper nhận diện Paid: đúng nhóm "Paid Media" + không có Số lượng.
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  assert.match(helpers, /function planRowIsPaidMedia\(r\) \{\s*\n\s*return !!r && planRowGroup\(r\) === 'Paid Media' && !planRowHasQty\(r\);/);
  assert.match(helpers, /function parsePlanPaidBudget\(raw\)/);
  // Handler change + hàm lưu qua guard/parse/distributeQty, ghi field budget.
  assert.match(src, /if \(ctxKind === 'planning-month-paid-budget'\) \{ savePlanningMonthPaidBudget\(t\.getAttribute\('data-channel'\), t\.getAttribute\('data-group'\), t\.getAttribute\('data-month'\), t\.value\); return; \}/);
  const save = section('function savePlanningMonthPaidBudget(channel, group, month, raw)', '// ---------- Brand Hub ----------');
  assert.match(save, /planningMonthSaveGuard\(\)/);
  assert.match(save, /var v = parsePlanPaidBudget\(raw\);/);
  assert.match(save, /distributeQty\(v, paidRows\.map/);
  assert.match(save, /sUpdate\('plan_rows', job\.id, \{ budget: job\.budget \}\)/);
  assert.match(save, /sCreate\('plan_rows', objB\)/);
  assert.ok(css.includes('.planning-paid-budget-input'), 'CSS thiếu .planning-paid-budget-input');
  // Cơ chế tổng quát đã gỡ KHÔNG hồi sinh (tên cũ vẫn vắng mặt).
  assert.ok(!src.includes('planning-month-budget'), 'không được hồi sinh ô planning-month-budget tổng quát');
  assert.ok(!src.includes('savePlanningMonthBudget'), 'không được hồi sinh savePlanningMonthBudget tổng quát');
  assert.ok(!src.includes('parsePlanBudget'), 'không được hồi sinh parsePlanBudget tổng quát');
});

test('PPB [unit]: planRowIsPaidMedia / parsePlanPaidBudget — nhận diện đúng Paid, loại mọi dòng khác; parse chỉ số nguyên >= 0', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  assert.equal(h.planRowIsPaidMedia(rows.find((r) => r.id === 'r-ads-jan')), true);
  assert.equal(h.planRowIsPaidMedia(rows.find((r) => r.id === 'r-camp-jan')), false, 'Campaign Budget (qty null, có budget) KHÔNG phải Paid Media');
  assert.equal(h.planRowIsPaidMedia(rows.find((r) => r.id === 'r-kol-jan')), false, 'dòng có Số lượng không phải Paid');
  assert.equal(h.planRowIsPaidMedia({ channel: 'X', group: 'Paid Media', qty: 2, budget: 5 }), false, 'nhóm Paid Media nhưng CÓ qty thì ngân sách vẫn tự tính');
  assert.equal(h.planMonthIsPaidMedia(rows, 'Meta Ads', 'Paid Media', '2027-01'), true);
  assert.equal(h.planMonthIsPaidMedia(rows, 'PR GameK', 'Campaign Budget', '2027-01'), false);
  assert.equal(h.parsePlanPaidBudget('0'), 0);
  assert.equal(h.parsePlanPaidBudget('1500000'), 1500000);
  assert.equal(h.parsePlanPaidBudget('-1'), null);
  assert.equal(h.parsePlanPaidBudget('abc'), null);
  assert.equal(h.parsePlanPaidBudget('1.5'), null);
  assert.equal(h.parsePlanPaidBudget(''), null);
  assert.equal(h.parsePlanPaidBudget(null), null);
});

// ---------- (i) sửa ngân sách Paid: lưu đúng field, tổng nhảy đúng +X ----------
test('PPB (i): sửa ngân sách Meta Ads 2027-01 từ 1.000.000 lên 1.500.000 (+500.000) — ghi đúng field budget của dòng đó, qty/đơn giá không đổi, tổng kỳ tăng đúng +500.000 và khớp domain.planBudget', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2027-01', '1500000');
  const ads = rows.find((r) => r.id === 'r-ads-jan');
  assert.equal(ads.budget, 1500000);
  assert.equal(ads.qty, null, 'Số lượng giữ nguyên trạng');
  assert.equal(ads.unit_price, undefined, 'không được sinh đơn giá đặt tay');
  assert.deepEqual(state.updates, [{ coll: 'plan_rows', id: 'r-ads-jan', patch: { budget: 1500000 } }]);
  assert.equal(state.creates.length, 0);
  assert.equal(h.planMonthBudget(rows, 'Meta Ads', 'Paid Media', '2027-01', BENCHMARKS), 1500000);
  assert.equal(budgetTotalViaApp(h, rows) - before, 500000, 'tổng kỳ phải tăng đúng +X');
  assert.equal(domain.planBudget(rows, BENCHMARKS).total, budgetTotalViaApp(h, rows), 'domain.planBudget và planBudgetFor phải khớp (không fork công thức)');
  assert.equal(domain.planBudget(rows, BENCHMARKS).rows.find((r) => r.rowId === 'r-ads-jan').source, 'direct');
  assert.ok(state.toasts.some((m) => /Đã lưu Ngân sách Paid Media 1500000/.test(m)), 'phải có toast đã lưu: ' + state.toasts.join(' | '));
});

test('PPB (i): ô NHIỀU dòng Paid — phân bổ tổng mới theo tỉ lệ hiện tại bằng distributeQty (tổng sau lưu đúng bằng số nhập; gấp đôi thì từng dòng gấp đôi)', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Tổng hiện tại 4.396.000 + 2.000.000 + 9.438.000 = 15.834.000 -> gấp đôi.
  h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2026-11', '31668000');
  assert.equal(rows.find((r) => r.id === 'r-multi-1').budget, 8792000);
  assert.equal(rows.find((r) => r.id === 'r-multi-2').budget, 4000000);
  assert.equal(rows.find((r) => r.id === 'r-multi-3').budget, 18876000);
  assert.equal(h.planMonthBudget(rows, 'Meta Ads', 'Paid Media', '2026-11', BENCHMARKS), 31668000);
  // Số lẻ không chia hết: tổng sau lưu vẫn ĐÚNG bằng số nhập (largest remainder).
  h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2026-11', '10000000');
  const sum = ['r-multi-1', 'r-multi-2', 'r-multi-3'].reduce((s, id) => s + rows.find((r) => r.id === id).budget, 0);
  assert.equal(sum, 10000000);
});

test('PPB (i): ô tháng chưa có dòng Paid — nhập > 0 tạo dòng Paid mới (qty null, budget = số nhập, đúng Brand/Segment/Phase); nhập 0 không tạo', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2027-03', '5000000');
  assert.equal(state.creates.length, 1);
  const created = state.creates[0].item;
  assert.equal(created.month, '2027-03');
  assert.equal(created.qty, null);
  assert.equal(created.budget, 5000000);
  assert.equal(created.channel, 'Meta Ads');
  assert.equal(created.group, 'Paid Media');
  assert.equal(created.brand_id, 'brand-lumus-ai');
  assert.equal(created.segment, 'b2c');
  assert.equal(created.phase_id, 'phase-lumus-2', 'tháng 2027-03 thuộc Phase 2');
  const rows0 = baseRows();
  const { h: h0, state: s0 } = makeHarness(rows0, PHASES, BENCHMARKS);
  h0.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2027-03', '0');
  assert.equal(s0.creates.length, 0, 'nhập 0 vào ô trống không tạo dòng');
});

// ---------- (ii) validate + chặn dòng không-paid ----------
test('PPB (ii): nhập sai (âm / chữ / thập phân / trống) bị chặn — không update/create, dữ liệu không đổi, có toast lỗi', () => {
  for (const raw of ['-1000', 'abc', '1.5', '1000.5', '']) {
    const rows = baseRows();
    const snapshot = rows.map((r) => ({ ...r }));
    const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
    h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2027-01', raw);
    assert.deepEqual(rows, snapshot, 'raw=' + JSON.stringify(raw) + ' không được đổi dữ liệu');
    assert.equal(state.updates.length, 0);
    assert.equal(state.creates.length, 0);
    assert.ok(state.toasts.some((m) => /Ngân sách Paid Media phải là số nguyên từ 0 trở lên/.test(m)), 'raw=' + JSON.stringify(raw) + ' phải báo lỗi rõ');
  }
});

test('PPB (ii): dòng KHÔNG-paid gọi lưu ngân sách trực tiếp đều bị chặn — dòng có Số lượng (tự tính) và dòng ngân sách nguồn nhóm Campaign Budget', () => {
  const rows = baseRows();
  const snapshot = rows.map((r) => ({ ...r }));
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePlanningMonthPaidBudget('KOL Nano', 'KOL', '2027-01', '9999999');
  h.savePlanningMonthPaidBudget('PR GameK', 'Campaign Budget', '2027-01', '9999999');
  assert.deepEqual(rows, snapshot, 'dòng không-paid không được đổi ngân sách qua đường Paid');
  assert.equal(state.updates.length, 0);
  assert.equal(state.creates.length, 0);
  assert.equal(state.toasts.filter((m) => /không thuộc nhóm Paid Media nên ngân sách chỉ tự tính/.test(m)).length, 2);
  // Ngân sách dòng thường vẫn = qty x đơn giá hiệu dụng như cũ.
  assert.equal(h.planRowEffectiveBudget(rows.find((r) => r.id === 'r-kol-jan'), BENCHMARKS), 6000000);
  assert.equal(h.planMonthBudget(rows, 'PR GameK', 'Campaign Budget', '2027-01', BENCHMARKS), 6600000);
});

// ---------- (iv) forecast Paid suy từ ngân sách ----------
test('PPB (iv) [domain]: ca số file nguồn — Meta Ads T1 ngân sách 10.920.000đ -> Visits 327,6 / Signups 29,484 / First 14,742 (khớp 04 Monthly + 02 KPI Budget); cả năm Meta/TikTok khớp sheet 02', () => {
  const metaJan = demo.plan_rows.find((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  assert.equal(metaJan.budget, 10920000);
  const f = domain.forecastFunnel([metaJan], demo.benchmarks);
  const fc = f.rows[0].forecast;
  assert.ok(fc, 'Paid có căn cứ file nguồn thì forecast phải tính được');
  approx(fc.views, 0, 'Views Paid = 0 (file nguồn để trống, không suy từ tiền)');
  approx(fc.visits, 327.6, 'visits = 10.920.000 x 0,6 / 20.000');
  approx(fc.signups, 29.484, 'signups = visits x 0,09');
  approx(fc.first, 14.742, 'first = signups x 0,5');
  approx(fc.paid, 14.742 * 0.055, 'paid = first x 0,055 (chuỗi app thống nhất)');
  // Cả năm theo channel — khớp sheet 02 KPI Budget R23/R24 ở Visits/Signups/First.
  const metaYear = domain.forecastFunnel(demo.plan_rows.filter((r) => r.channel === 'Meta Ads'), demo.benchmarks);
  approx(metaYear.totals.visits, 16380, 'Meta FY visits');
  approx(metaYear.totals.signups, 1474.2, 'Meta FY signups');
  approx(metaYear.totals.first, 737.1, 'Meta FY first');
  const tikYear = domain.forecastFunnel(demo.plan_rows.filter((r) => r.channel === 'TikTok Ads'), demo.benchmarks);
  approx(tikYear.totals.visits, 5790.909090909091, 'TikTok FY visits = 182.000.000 x 0,7 / 22.000');
  approx(tikYear.totals.signups, 521.1818181818182, 'TikTok FY signups');
  approx(tikYear.totals.first, 260.5909090909091, 'TikTok FY first');
  // Benchmark Paid đã seed đúng số file nguồn.
  const byChannel = Object.fromEntries(demo.benchmarks.map((b) => [b.channel, b]));
  assert.equal(byChannel['Meta Ads'].traffic_share, 0.6);
  assert.equal(byChannel['Meta Ads'].cost_per_visit, 20000);
  assert.equal(byChannel['TikTok Ads'].traffic_share, 0.7);
  assert.equal(byChannel['TikTok Ads'].cost_per_visit, 22000);
  for (const ch of ['Meta Ads', 'TikTok Ads']) {
    approx(byChannel[ch].visit_to_signup, 0.09, ch + ' v2s');
    approx(byChannel[ch].signup_to_first, 0.5, ch + ' s2f');
    approx(byChannel[ch].first_to_paid, 0.055, ch + ' f2p');
    assert.equal(byChannel[ch].view_to_visit, null, ch + ' không có view->visit (không suy Views)');
    assert.equal(byChannel[ch].output_per_unit, null);
  }
});

test('PPB (iv): sửa ngân sách Paid qua hàm lưu THẬT -> Forecast (funnelTotalsFor) thay đổi đúng tỉ lệ; steps phễu Paid bắt đầu ở Visits (không có bước Views)', () => {
  // Dùng đúng dữ liệu demo Lumus cho Meta Ads T1 (clone để không đụng demo gốc).
  const rows = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai' && r.channel === 'Meta Ads' && r.month === '2027-01')
    .map((r) => ({ ...r }));
  const phases = demo.phases.filter((p) => p.brand_id && p.start_month);
  const { h } = makeHarness(rows, phases, demo.benchmarks, demo.phase_assumptions);
  const before = h.funnelTotalsFor(rows, demo.benchmarks);
  approx(before.views, 0, 'trước: views Paid = 0');
  approx(before.visits, 327.6, 'trước: visits');
  // Tăng ngân sách T1 gấp đôi: 10.920.000 -> 21.840.000 (+10.920.000).
  h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2027-01', '21840000');
  assert.equal(rows[0].budget, 21840000);
  const after = h.funnelTotalsFor(rows, demo.benchmarks);
  approx(after.visits, 655.2, 'sau: visits gấp đôi đúng tỉ lệ ngân sách');
  approx(after.signups, 58.968, 'sau: signups gấp đôi');
  approx(after.first, 29.484, 'sau: first gấp đôi');
  approx(after.paid, 29.484 * 0.055, 'sau: paid gấp đôi');
  approx(after.views, 0, 'sau: views vẫn 0 — không bịa Views từ tiền');
  // Steps vẽ phễu cho Paid-only: bắt đầu ở Visits, KHÔNG có bước Views.
  const steps = h.planningFunnelSteps(after);
  assert.deepEqual(steps.map((s) => s.label), ['Visits', 'Signups', 'First starts', 'Paid']);
  approx(steps[0].value, 655.2, 'bước đầu phễu Paid là Visits');
  // Totals có Views (KOL) thì steps giữ nguyên bắt đầu ở Views như cũ.
  const kolSteps = h.planningFunnelSteps({ views: 16000, visits: 48, signups: 4.32, first: 2.16, paid: 0.1188 });
  assert.deepEqual(kolSteps.map((s) => s.label), ['Views', 'Visits', 'Signups', 'First starts', 'Paid']);
});

test('PPB (iv): kênh KHÔNG có căn cứ vẫn "chưa tính được" — funnelTotalsFor = null, planningFunnelSteps = [], không crash (Facebook Owned + direct budget thiếu cost)', () => {
  const fb = demo.plan_rows.filter((r) => r.channel === 'Facebook Owned' && r.brand_id === 'brand-lumus-ai').map((r) => ({ ...r }));
  const phases = demo.phases.filter((p) => p.brand_id && p.start_month);
  const { h } = makeHarness(fb, phases, demo.benchmarks, demo.phase_assumptions);
  assert.equal(h.funnelTotalsFor(fb, demo.benchmarks), null);
  assert.deepEqual(h.planningFunnelSteps(null), []);
  assert.deepEqual(h.planningFunnelSteps({ views: 0, visits: 0, signups: 0, first: 0, paid: 0 }), []);
  // Direct budget nhưng benchmark thiếu traffic_share/cost_per_visit -> null.
  const meta = demo.plan_rows.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  const f = domain.forecastFunnel(meta, [{ brand_id: 'brand-lumus-ai', channel: 'Meta Ads', direct_budget: true, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 }]);
  assert.equal(f.rows[0].forecast, null, 'thiếu cost/traffic share thì không bịa forecast Paid');
});

// ---------- (v) neo trước khi sửa ----------
test('PPB (v) [neo]: chưa sửa gì — Meta Ads 546.000.000đ / TikTok Ads 182.000.000đ / Paid 728.000.000đ / tổng năm Lumus 1.515.500.000đ / content 776; forecast toàn Lumus views vẫn 1.460.000 (Paid không cộng Views)', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776);
  const sumCh = (ch) => lumus.filter((r) => r.channel === ch).reduce((s, r) => s + r.budget, 0);
  assert.equal(sumCh('Meta Ads'), 546000000);
  assert.equal(sumCh('TikTok Ads'), 182000000);
  assert.equal(sumCh('Meta Ads') + sumCh('TikTok Ads'), 728000000);
  const d = domain.planBudget(lumus, demo.benchmarks);
  assert.equal(d.total, 1515500000);
  assert.equal(d.totalDirect, 728000000);
  const f = domain.forecastFunnel(lumus, demo.benchmarks);
  approx(f.totals.views, 1460000, 'views toàn kỳ chỉ từ KOL');
  approx(f.totals.visits, 5880 + 16380 + 5790.909090909091, 'visits toàn kỳ = KOL + Paid');
});
