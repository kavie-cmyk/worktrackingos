// tests/planning-month-budget.test.mjs
// Planning Theo tháng — ô NGÂN SÁCH trong BẢNG CHI TIẾT (bổ sung):
// mỗi tháng thêm ô Ngân sách sửa được cạnh ô Số lượng, cùng mẫu tương
// tác (sửa tại ô, lưu khi rời ô/Enter qua sự kiện change).
// Yêu cầu khóa:
//  (static) bảng chi tiết có cột + ô Ngân sách (planning-month-budget),
//       nhãn phân biệt "đặt tay" / "tự tính", chú thích xoá trắng ->
//       bỏ đặt tay, tổng ngân sách của dòng; handler change gọi
//       savePlanningMonthBudget; hàm lưu qua parsePlanBudget + guard
//       demo + distributeQty + sUpdate/sCreate plan_rows field budget.
//  (a) đặt tay: nhập số -> ghi field budget, planMonthBudget và mọi
//      nơi đọc qua planBudgetFor khớp số mới ngay;
//  (b) xoá trắng -> budget = null, quay về tự tính qty × đơn giá;
//      xoá trắng ở tháng đang tự tính là no-op;
//  (c) validate: âm / chữ / thập phân bị chặn, dữ liệu không đổi;
//  (d) Paid Ads (qty null, budget sẵn có): sửa được ngân sách; xoá
//      trắng Paid Ads -> tự tính = 0 (không có đơn giá Benchmark);
//  (e) nhiều dòng / ô: phân bổ bằng distributeQty theo tỉ lệ ngân
//      sách hiệu dụng hiện tại, tổng sau lưu khớp đúng số nhập;
//  (f) nhất quán tổng: đặt tay 1 tháng tăng +X -> tổng kỳ (planBudgetFor)
//      tăng đúng +X; xoá đặt tay -> về đúng giá trị tự tính ban đầu;
//  (g) tương tác với Số lượng: tháng TỰ TÍNH sửa qty -> ngân sách đổi
//      theo qty; tháng ĐẶT TAY sửa qty -> ngân sách giữ nguyên đặt tay;
//  (h) ô tháng chưa có dòng plan: nhập > 0 tạo dòng mới mang budget,
//      nhập 0 không tạo.
// Neo demo: Lumus tổng ngân sách năm = 1.515.500.000đ, content = 776
// khi chưa sửa gì (qua domain.planBudget lẫn planBudgetFor của app).

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

function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}

function makeHarness(rows, phases, benchmarks) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const saves = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all' };
  const state = { toasts: [], updates: [], creates: [], renders: 0 };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : []),
    get: () => null,
  };
  const sUpdate = (coll, id, patch) => {
    const item = rows.find((r) => r.id === id);
    if (!item) return { ok: false, error: 'Không tìm thấy dòng plan.' };
    Object.assign(item, patch);
    state.updates.push({ coll, id, patch });
    return { ok: true, item };
  };
  const sCreate = (coll, obj) => {
    const item = { id: 'plan-new-' + (rows.length + 1), ...obj };
    rows.push(item);
    state.creates.push({ coll, item });
    return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'tbl', 'vizFunnelHtml',
    helpers + '\n' + saves +
    '\nreturn { planRowQty: planRowQty, planRowHasQty: planRowHasQty, planRowHasBudget: planRowHasBudget, planRowDirectBudget: planRowDirectBudget, planRowEffectiveBudget: planRowEffectiveBudget, planMonthRows: planMonthRows, planMonthQty: planMonthQty, planMonthBudget: planMonthBudget, planMonthHasManualBudget: planMonthHasManualBudget, parsePlanQty: parsePlanQty, parsePlanBudget: parsePlanBudget, planBudgetFor: planBudgetFor, distributeQty: distributeQty, savePlanningMonthQty: savePlanningMonthQty, savePlanningMonthBudget: savePlanningMonthBudget };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true,
    (m) => state.toasts.push(m),
    () => { state.renders++; },
    sUpdate, sCreate, saveResult,
    (s) => String(s === null || s === undefined ? '' : s),
    (n) => String(n),
    () => '', () => '');
  return { h, state };
}

const PHASES = [
  { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
  { id: 'phase-lumus-2', brand_id: 'brand-lumus-ai', name: 'Test & Validate', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5 },
];
const BENCHMARKS = [
  { id: 'bench-kol-nano', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Nano', unit_price: 1500000 },
  { id: 'bench-dup', brand_id: 'brand-lumus-ai', segment: null, channel: 'Dup Channel', unit_price: 1000000 },
];
function baseRows() {
  return [
    { id: 'r-kol-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-kol-feb', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-02', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 6, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-ads-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 1000000, phase_id: 'phase-lumus-1' },
    { id: 'r-multi-1', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Multi Channel', group: 'Paid Media', unit: null, qty: null, budget: 3000000, phase_id: 'phase-lumus-1' },
    { id: 'r-multi-2', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Multi Channel', group: 'Paid Media', unit: null, qty: null, budget: 1000000, phase_id: 'phase-lumus-1' },
    { id: 'r-dup-1', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Dup Channel', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-dup-2', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Dup Channel', group: 'KOL', unit: 'assets', qty: 2, budget: null, phase_id: 'phase-lumus-1' },
  ];
}
function budgetTotalViaApp(h, rows) {
  return h.planBudgetFor(rows, BENCHMARKS).reduce((s, x) => s + x.total, 0);
}

// ---------- [static] wiring bảng chi tiết ----------
test('PMB [static]: bảng chi tiết có cột Ngân sách + ô sửa planning-month-budget cạnh ô Số lượng, nhãn đặt tay/tự tính, chú thích xoá trắng, tổng ngân sách dòng', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const detail = v.slice(v.indexOf('// Bảng chi tiết của dòng đang chọn'), v.indexOf('// Chart ngân sách dự kiến theo tháng'));
  assert.ok(detail.length > 0);
  assert.match(detail, /<th>Ngân sách \(VNĐ\)<\/th>/);
  assert.match(detail, /data-action-change="planning-month-budget" data-channel="' \+ esc\(selChannel\)/);
  assert.match(detail, /class="phase-input planning-month-input planning-budget-input" type="number" step="1" min="0"/);
  assert.match(detail, /value="' \+ esc\(String\(budgetSum\)\) \+ '"/);
  assert.match(detail, /var budgetSum = cellRows\.reduce\(function \(s, r\) \{ return s \+ planRowEffectiveBudget\(r, benchmarks\); \}, 0\);/);
  assert.match(detail, /data-planning-budget-manual="1">đặt tay</);
  assert.match(detail, /data-planning-budget-auto="1">tự tính</);
  assert.match(detail, /data-planning-detail-budget-hint="1"/);
  assert.match(detail, /Xoá trắng ô Ngân sách/);
  assert.match(detail, /quay về tự tính/);
  assert.match(detail, /tháng đặt tay/);
  assert.match(detail, /data-planning-detail-budget-total="1"/);
  assert.match(detail, /detailBudgetTotal \+= budgetSum;/);
  assert.ok(css.includes('.planning-budget-input'), 'CSS thiếu .planning-budget-input');
});

test('PMB [static]: handler change planning-month-budget gọi savePlanningMonthBudget(channel, group, month, value); hàm lưu qua parsePlanBudget + guard + distributeQty + sUpdate/sCreate field budget', () => {
  assert.match(src, /if \(ctxKind === 'planning-month-budget'\) \{ savePlanningMonthBudget\(t\.getAttribute\('data-channel'\), t\.getAttribute\('data-group'\), t\.getAttribute\('data-month'\), t\.value\); return; \}/);
  const save = section('function savePlanningMonthBudget(channel, group, month, raw)', '// ---------- Brand Hub ----------');
  assert.match(save, /planningMonthSaveGuard\(\)/);
  assert.match(save, /var v = parsePlanBudget\(raw\);/);
  assert.match(save, /distributeQty\(v, currents\)/);
  assert.match(save, /sUpdate\('plan_rows', job\.id, \{ budget: job\.budget \}\)/);
  assert.match(save, /sCreate\('plan_rows', objB\)/);
  assert.match(save, /budget: null/);
});

test('PMB [unit]: parsePlanBudget — chỉ số nguyên >= 0; âm/chữ/thập phân/trống -> null', () => {
  const { h } = makeHarness(baseRows(), PHASES, BENCHMARKS);
  assert.equal(h.parsePlanBudget('0'), 0);
  assert.equal(h.parsePlanBudget('1500000'), 1500000);
  assert.equal(h.parsePlanBudget('-1000'), null);
  assert.equal(h.parsePlanBudget('abc'), null);
  assert.equal(h.parsePlanBudget('1.5'), null);
  assert.equal(h.parsePlanBudget(''), null);
  assert.equal(h.parsePlanBudget(null), null);
});

test('PMB [unit]: planMonthBudget / planMonthHasManualBudget — tự tính = qty × đơn giá, đặt tay lấy field budget', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 6000000);
  assert.equal(h.planMonthHasManualBudget(rows, 'KOL Nano', 'KOL', '2027-01'), false);
  assert.equal(h.planMonthBudget(rows, 'Meta Ads', 'Paid Media', '2027-01', BENCHMARKS), 1000000);
  assert.equal(h.planMonthHasManualBudget(rows, 'Meta Ads', 'Paid Media', '2027-01'), true);
  assert.equal(h.planRowEffectiveBudget(rows[0], BENCHMARKS), 6000000);
  assert.equal(h.planRowEffectiveBudget(rows[2], BENCHMARKS), 1000000);
});

// ---------- (a) + (f) đặt tay và nhất quán tổng ----------
test('PMB (a)(f): đặt tay KOL Nano 2027-01 từ tự tính 6.000.000 -> 9.000.000: ghi field budget, tổng kỳ qua planBudgetFor tăng đúng +3.000.000', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-01', '9000000');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').budget, 9000000);
  assert.deepEqual(state.updates, [{ coll: 'plan_rows', id: 'r-kol-jan', patch: { budget: 9000000 } }]);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 9000000);
  assert.equal(h.planMonthHasManualBudget(rows, 'KOL Nano', 'KOL', '2027-01'), true);
  assert.equal(budgetTotalViaApp(h, rows) - before, 3000000, 'tổng kỳ phải tăng đúng chênh lệch đặt tay');
  assert.equal(domain.planBudget(rows, BENCHMARKS).total, budgetTotalViaApp(h, rows), 'domain.planBudget và planBudgetFor phải khớp');
  assert.ok(state.toasts.some((m) => /Đã lưu Ngân sách đặt tay 9000000/.test(m)), 'phải có toast đã lưu đặt tay: ' + state.toasts.join(' | '));
});

test('PMB (a): đặt tay bằng đúng số tự tính (6.000.000) vẫn ghi budget tường minh để tháng thành đặt tay thật', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-01', '6000000');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').budget, 6000000);
  assert.equal(state.updates.length, 1);
  assert.equal(h.planMonthHasManualBudget(rows, 'KOL Nano', 'KOL', '2027-01'), true);
});

// ---------- (b) xoá trắng quay về tự tính ----------
test('PMB (b)(f): xoá trắng ô đang đặt tay -> budget = null, ngân sách về đúng tự tính ban đầu và tổng kỳ về đúng ban đầu; xoá trắng ô đang tự tính là no-op', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-01', '9000000');
  assert.equal(budgetTotalViaApp(h, rows), before + 3000000);
  h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-01', '');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').budget, null);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 6000000);
  assert.equal(h.planMonthHasManualBudget(rows, 'KOL Nano', 'KOL', '2027-01'), false);
  assert.equal(budgetTotalViaApp(h, rows), before, 'xoá đặt tay phải đưa tổng kỳ về đúng giá trị ban đầu');
  assert.ok(state.toasts.some((m) => /Đã bỏ Ngân sách đặt tay/.test(m) && /tự tính/.test(m)));
  // No-op: xoá trắng tháng đang tự tính (Feb) không update gì thêm.
  const updatesBefore = state.updates.length;
  h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-02', '');
  assert.equal(state.updates.length, updatesBefore);
  assert.equal(rows.find((r) => r.id === 'r-kol-feb').budget, null);
});

// ---------- (c) validate ----------
test('PMB (c): nhập sai (âm / chữ / thập phân) bị chặn — không update/create, dữ liệu không đổi, có toast lỗi', () => {
  for (const raw of ['-1000', 'abc', '1.5', '1000.5']) {
    const rows = baseRows();
    const snapshot = rows.map((r) => ({ ...r }));
    const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
    h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-01', raw);
    assert.deepEqual(rows, snapshot, 'raw=' + JSON.stringify(raw) + ' không được đổi dữ liệu');
    assert.equal(state.updates.length, 0);
    assert.equal(state.creates.length, 0);
    assert.ok(state.toasts.some((m) => /Ngân sách phải là số nguyên từ 0 trở lên/.test(m)), 'raw=' + JSON.stringify(raw) + ' phải báo lỗi rõ');
  }
});

// ---------- (d) Paid Ads ----------
test('PMB (d): Paid Ads (qty null, budget sẵn có) sửa được ngân sách; qty vẫn null; xoá trắng -> tự tính = 0', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  h.savePlanningMonthBudget('Meta Ads', 'Paid Media', '2027-01', '2500000');
  const ads = rows.find((r) => r.id === 'r-ads-jan');
  assert.equal(ads.budget, 2500000);
  assert.equal(ads.qty, null, 'sửa ngân sách không được đụng qty của dòng Paid Ads');
  assert.equal(budgetTotalViaApp(h, rows) - before, 1500000);
  assert.ok(state.toasts.some((m) => /Ngân sách đặt tay/.test(m)));
  h.savePlanningMonthBudget('Meta Ads', 'Paid Media', '2027-01', '');
  assert.equal(ads.budget, null);
  assert.equal(h.planMonthBudget(rows, 'Meta Ads', 'Paid Media', '2027-01', BENCHMARKS), 0, 'Paid Ads không có đơn giá nên tự tính = 0');
  assert.equal(h.planMonthHasManualBudget(rows, 'Meta Ads', 'Paid Media', '2027-01'), false);
});

// ---------- (e) nhiều dòng / ô ----------
test('PMB (e): ô nhiều dòng đặt tay — phân bổ theo tỉ lệ hiệu dụng hiện tại bằng distributeQty, tổng khớp đúng số nhập; ô nhiều dòng tự tính cũng vậy', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Multi Channel: 2 dòng budget 3.000.000 + 1.000.000 (tỉ lệ 3:1) -> đặt 5.000.000.
  h.savePlanningMonthBudget('Multi Channel', 'Paid Media', '2027-01', '5000000');
  assert.equal(rows.find((r) => r.id === 'r-multi-1').budget, 3750000);
  assert.equal(rows.find((r) => r.id === 'r-multi-2').budget, 1250000);
  assert.equal(h.planMonthBudget(rows, 'Multi Channel', 'Paid Media', '2027-01', BENCHMARKS), 5000000);
  // Xoá trắng ô nhiều dòng: cả hai dòng về null.
  h.savePlanningMonthBudget('Multi Channel', 'Paid Media', '2027-01', '');
  assert.equal(rows.find((r) => r.id === 'r-multi-1').budget, null);
  assert.equal(rows.find((r) => r.id === 'r-multi-2').budget, null);
  // Dup Channel: 2 dòng tự tính 4.000.000 + 2.000.000 (qty 4/2 × 1.000.000) -> đặt 9.000.000 theo tỉ lệ 2:1.
  h.savePlanningMonthBudget('Dup Channel', 'KOL', '2027-01', '9000000');
  assert.equal(rows.find((r) => r.id === 'r-dup-1').budget, 6000000);
  assert.equal(rows.find((r) => r.id === 'r-dup-2').budget, 3000000);
  assert.equal(h.planMonthBudget(rows, 'Dup Channel', 'KOL', '2027-01', BENCHMARKS), 9000000);
});

// ---------- (g) tương tác Số lượng <-> Ngân sách ----------
test('PMB (g): tháng TỰ TÍNH sửa Số lượng -> ngân sách đổi theo qty; tháng ĐẶT TAY sửa Số lượng -> ngân sách giữ nguyên đặt tay', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Tự tính: KOL Jan qty 4 -> 5 thì ngân sách 6.000.000 -> 7.500.000.
  h.savePlanningMonthQty('KOL Nano', 'KOL', '2027-01', '5');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 7500000);
  // Đặt tay 9.000.000 rồi sửa qty 5 -> 10: ngân sách vẫn 9.000.000.
  h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-01', '9000000');
  h.savePlanningMonthQty('KOL Nano', 'KOL', '2027-01', '10');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').qty, 10);
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').budget, 9000000);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 9000000, 'qty không được ghi đè ngân sách đặt tay');
});

// ---------- (h) ô trống ----------
test('PMB (h): ô tháng chưa có dòng plan — nhập ngân sách > 0 tạo dòng mới mang budget đúng ngữ cảnh; nhập 0 không tạo', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-04', '2000000');
  assert.equal(state.creates.length, 1);
  const created = state.creates[0].item;
  assert.equal(created.month, '2027-04');
  assert.equal(created.budget, 2000000);
  assert.equal(created.qty, 0, 'Channel có Số lượng thì dòng mới tạo mang qty 0 và budget đặt tay');
  assert.equal(created.channel, 'KOL Nano');
  assert.equal(created.brand_id, 'brand-lumus-ai');
  assert.equal(created.phase_id, 'phase-lumus-2', 'tháng 2027-04 thuộc Phase 2');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-04', BENCHMARKS), 2000000);

  const rows0 = baseRows();
  const { h: h0, state: s0 } = makeHarness(rows0, PHASES, BENCHMARKS);
  h0.savePlanningMonthBudget('KOL Nano', 'KOL', '2027-04', '0');
  assert.equal(s0.creates.length, 0, 'nhập 0 vào ô trống không tạo dòng');
});

// ---------- neo demo ----------
test('PMB [neo]: demo Lumus tổng ngân sách năm = 1.515.500.000đ và tổng content = 776 khi chưa sửa gì (domain + planBudgetFor đều khớp)', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776);
  assert.equal(domain.planBudget(lumus, demo.benchmarks).total, 1515500000);
  const { h } = makeHarness([], [], demo.benchmarks);
  const viaApp = h.planBudgetFor(lumus, demo.benchmarks).reduce((s, x) => s + x.total, 0);
  assert.equal(viaApp, 1515500000);
});
