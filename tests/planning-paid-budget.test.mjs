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
// Forecast Paid — SỬA PHẠM VI đợt Paid Objective (thay cơ chế
// traffic_share của bản cũ): mỗi dòng Paid mang field objective; kết
// quả đặt TẠI tầng của Objective = ngân sách ÷ cost_per_result của
// Benchmark rồi chảy XUỐNG qua chuỗi tỉ lệ (visit→signup 0,09 /
// signup→first 0,5 / first→paid 0,055 — 03 Inputs R59/R60). Đơn giá:
// Traffic = Cost/LPV (Meta 20.000đ / TikTok 22.000đ); Signup và
// Remarketing (CAC) SUY TỪ CHUỖI tỉ lệ file; Awareness chưa có đơn
// giá (file không có CPM/CPV) -> forecast null, ngân sách vẫn tính.
// Ca neo đầy đủ của mô hình Objective khoá ở
// tests/planning-paid-objective.test.mjs; file này giữ các ca ngân
// sách trực tiếp (i)/(ii) và neo tổng (v) đã cập nhật theo Objective.
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
  { id: 'bench-meta', brand_id: 'brand-lumus-ai', segment: 'b2c', channel: 'Meta Ads', unit_price: null, output_per_unit: null, view_to_visit: null, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, cost_per_result: { awareness: null, traffic: 20000, signup: 20000 / 0.09, remarketing: 20000 / (0.09 * 0.5 * 0.055) }, direct_budget: true },
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
test('PPB (iv) [domain]: ca số Objective — Meta Ads T1 theo từng Objective (Traffic 5.460.000đ -> Visits 273; Signup 3.276.000đ -> Freemium 14,742; tổng Paid T1 = 1,08108); cả năm Meta/TikTok theo Objective (SỬA PHẠM VI đợt Paid Objective)', () => {
  const metaJanRows = demo.plan_rows.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  assert.equal(metaJanRows.reduce((a, r) => a + r.budget, 0), 10920000, 'tổng tháng T1 không đổi');
  const f = domain.forecastFunnel(metaJanRows, demo.benchmarks);
  const byObj = Object.fromEntries(f.rows.map((r) => [r.objective, r.forecast]));
  assert.equal(byObj.awareness, null, 'Awareness chưa có đơn giá -> forecast null');
  approx(byObj.traffic.visits, 273, 'Traffic visits = 5.460.000 / 20.000');
  approx(byObj.traffic.freemium, 24.57, 'Traffic freemium = 273 x 0,09 (tầng Freemium, trước là Signups — số không đổi)');
  approx(byObj.traffic.paid, 0.675675, 'Traffic paid');
  approx(byObj.signup.freemium, 14.742, 'Signup freemium = 3.276.000 / (20.000 / 0,09) (đặt tại Freemium)');
  approx(byObj.signup.paid, 0.405405, 'Signup paid');
  approx(f.totals.views, 0, 'Views Paid = 0 (Awareness chưa có đơn giá, không suy từ tiền)');
  approx(f.totals.visits, 273, 'tổng visits T1');
  approx(f.totals.freemium, 39.312, 'tổng freemium T1');
  approx(f.totals.paid, 1.08108, 'tổng Paid Meta T1 = 0,675675 + 0,405405');
  // Cả năm theo Objective (tính tay từ ngân sách từng Objective — xem
  // bảng delta trong tests/planning-paid-objective.test.mjs).
  const metaYear = domain.forecastFunnel(demo.plan_rows.filter((r) => r.channel === 'Meta Ads'), demo.benchmarks);
  approx(metaYear.totals.visits, 6415.5, 'Meta FY visits = 128.310.000 / 20.000');
  approx(metaYear.totals.freemium, 1732.185, 'Meta FY freemium');
  approx(metaYear.totals.paid, 57.7702125, 'Meta FY paid');
  const tikYear = domain.forecastFunnel(demo.plan_rows.filter((r) => r.channel === 'TikTok Ads'), demo.benchmarks);
  approx(tikYear.totals.visits, 2523.181818181818, 'TikTok FY visits = 55.510.000 / 22.000');
  approx(tikYear.totals.freemium, 524.9045454545455, 'TikTok FY freemium');
  approx(tikYear.totals.paid, 14.434875, 'TikTok FY paid');
  // Benchmark Paid đã seed đúng đơn giá Objective; cơ chế cũ đã gỡ.
  const byChannel = Object.fromEntries(demo.benchmarks.map((b) => [b.channel, b]));
  assert.equal(byChannel['Meta Ads'].cost_per_result.traffic, 20000);
  assert.equal(byChannel['TikTok Ads'].cost_per_result.traffic, 22000);
  approx(byChannel['Meta Ads'].cost_per_result.signup, 20000 / 0.09, 'Meta cost/signup suy từ chuỗi');
  approx(byChannel['TikTok Ads'].cost_per_result.signup, 22000 / 0.09, 'TikTok cost/signup suy từ chuỗi');
  approx(byChannel['Meta Ads'].cost_per_result.remarketing, 20000 / (0.09 * 0.5 * 0.055), 'Meta CAC suy từ chuỗi');
  approx(byChannel['TikTok Ads'].cost_per_result.remarketing, 22000 / (0.09 * 0.5 * 0.055), 'TikTok CAC suy từ chuỗi');
  assert.equal(byChannel['Meta Ads'].traffic_share, undefined, 'traffic_share đã gỡ khỏi benchmark');
  assert.equal(byChannel['Meta Ads'].cost_per_visit, undefined, 'cost_per_visit đã gỡ khỏi benchmark');
  for (const ch of ['Meta Ads', 'TikTok Ads']) {
    approx(byChannel[ch].visit_to_freemium, 0.09, ch + ' v2f');
    approx(byChannel[ch].freemium_to_paid, 0.0275, ch + ' f2p (gộp 0,5 x 0,055)');
    assert.equal(byChannel[ch].view_to_visit, null, ch + ' không có view->visit (không suy ngược)');
    assert.equal(byChannel[ch].output_per_unit, null);
  }
});

test('PPB (iv): sửa ngân sách Paid qua hàm lưu THẬT -> Forecast (funnelTotalsFor) thay đổi đúng tỉ lệ; steps phễu Paid bắt đầu ở Visits (không có bước Views)', () => {
  // Dùng đúng dữ liệu demo Lumus cho Meta Ads T1 (clone để không đụng
  // demo gốc) — SỬA PHẠM VI đợt Paid Objective: T1 nay gồm các dòng
  // Objective (Awareness/Traffic/Signup); hàm lưu tổng tháng phân bổ
  // theo tỉ lệ hiện tại nên mọi Objective cùng gấp đôi, forecast gấp đôi.
  const rows = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai' && r.channel === 'Meta Ads' && r.month === '2027-01')
    .map((r) => ({ ...r }));
  const phases = demo.phases.filter((p) => p.brand_id && p.start_month);
  const { h } = makeHarness(rows, phases, demo.benchmarks, demo.phase_assumptions);
  const before = h.funnelTotalsFor(rows, demo.benchmarks);
  approx(before.views, 0, 'trước: views Paid = 0');
  approx(before.visits, 273, 'trước: visits (chỉ Objective Traffic)');
  approx(before.paid, 1.08108, 'trước: paid T1 theo Objective');
  // Tăng ngân sách T1 gấp đôi: 10.920.000 -> 21.840.000 (+10.920.000).
  h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2027-01', '21840000');
  assert.equal(rows.reduce((a, r) => a + r.budget, 0), 21840000, 'tổng các dòng Objective sau lưu đúng bằng số nhập');
  const after = h.funnelTotalsFor(rows, demo.benchmarks);
  approx(after.visits, 546, 'sau: visits gấp đôi đúng tỉ lệ ngân sách');
  approx(after.freemium, 78.624, 'sau: freemium gấp đôi');
  approx(after.paid, 2.16216, 'sau: paid gấp đôi');
  approx(after.views, 0, 'sau: views vẫn 0 — không bịa Views từ tiền');
  // Steps vẽ phễu cho Paid-only: bắt đầu ở Visits, KHÔNG có bước Views.
  const steps = h.planningFunnelSteps(after);
  assert.deepEqual(steps.map((s) => s.label), ['Visits', 'Freemium', 'Paid']);
  approx(steps[0].value, 546, 'bước đầu phễu Paid là Visits');
  // Totals có Views (KOL) thì steps giữ nguyên bắt đầu ở Views như cũ.
  const kolSteps = h.planningFunnelSteps({ views: 16000, visits: 48, freemium: 4.32, paid: 0.1188 });
  assert.deepEqual(kolSteps.map((s) => s.label), ['Views', 'Visits', 'Freemium', 'Paid']);
});

test('PPB (iv): kênh KHÔNG có căn cứ vẫn "chưa tính được" — funnelTotalsFor = null, planningFunnelSteps = [], không crash (Facebook Owned + direct budget thiếu cost)', () => {
  const fb = demo.plan_rows.filter((r) => r.channel === 'Facebook Owned' && r.brand_id === 'brand-lumus-ai').map((r) => ({ ...r }));
  const phases = demo.phases.filter((p) => p.brand_id && p.start_month);
  const { h } = makeHarness(fb, phases, demo.benchmarks, demo.phase_assumptions);
  assert.equal(h.funnelTotalsFor(fb, demo.benchmarks), null);
  assert.deepEqual(h.planningFunnelSteps(null), []);
  assert.deepEqual(h.planningFunnelSteps({ views: 0, visits: 0, freemium: 0, paid: 0 }), []);
  // Direct budget nhưng benchmark thiếu cost_per_result -> null.
  const meta = demo.plan_rows.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-01');
  const f = domain.forecastFunnel(meta, [{ brand_id: 'brand-lumus-ai', channel: 'Meta Ads', direct_budget: true, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 }]);
  assert.ok(f.rows.every((r) => r.forecast === null), 'thiếu cost_per_result thì không bịa forecast Paid');
});

// ---------- (v) neo trước khi sửa ----------
test('PPB (v) [neo]: chưa sửa gì — Meta Ads 546.000.000đ / TikTok Ads 182.000.000đ / 2 kênh B2B mới 83.200.000đ / tổng năm Lumus 1.598.700.000đ (SỬA PHẠM VI đợt Paid Objective; tổng B2C vẫn 1.515.500.000đ) / content 776; forecast toàn Lumus views = 1.460.000 KOL + 8.363,33 opens Email (đợt Email 18/11; Paid vẫn không cộng Views)', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776);
  const sumCh = (ch) => lumus.filter((r) => r.channel === ch).reduce((s, r) => s + r.budget, 0);
  assert.equal(sumCh('Meta Ads'), 546000000);
  assert.equal(sumCh('TikTok Ads'), 182000000);
  assert.equal(sumCh('Meta Ads') + sumCh('TikTok Ads'), 728000000);
  assert.equal(sumCh('Google Search B2B') + sumCh('LinkedIn Ads B2B'), 83200000);
  const d = domain.planBudget(lumus, demo.benchmarks);
  assert.equal(d.total, 1598700000);
  assert.equal(d.totalDirect, 811200000);
  assert.equal(domain.planBudget(lumus.filter((r) => r.segment !== 'b2b'), demo.benchmarks).total, 1515500000, 'tổng B2C không đổi');
  const f = domain.forecastFunnel(lumus, demo.benchmarks);
  approx(f.totals.views, 1468363.3327981387, 'views toàn kỳ = KOL 1.460.000 + opens Email 8.363,3328 (không ctx)');
  approx(f.totals.visits, 5880 + 6415.5 + 2523.181818181818 + 836.3332798138637, 'visits toàn kỳ = KOL + Paid theo Objective Traffic + clicks Email 836,3333');
});
