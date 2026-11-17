// tests/planning-month-unit-price.test.mjs
// Planning Theo tháng — cột ĐƠN GIÁ sửa được + NGÂN SÁCH CHỈ TỰ TÍNH
// trong BẢNG CHI TIẾT (đợt thay thế ô sửa Ngân sách của commit 06d8ffc).
// Chốt của Zac: "cột ngân sách dự kiến chỉ tự tính thôi, không sửa được —
// chỉ sửa đơn giá thôi." File này THAY tests/planning-month-budget.test.mjs
// (đã gỡ): các test PMB neo vào hành vi sửa ngân sách trực tiếp (đặt tay
// ngân sách qua field budget, phân bổ ngân sách, xoá trắng ngân sách...)
// bị gỡ vì hành vi đó không còn tồn tại; phần còn đúng (validate, tương
// tác Số lượng, neo demo) được viết lại theo cơ chế Đơn giá đặt tay.
// Yêu cầu khóa:
//  (static) bảng chi tiết có cột "Đơn giá (VNĐ)" với ô sửa
//       planning-month-unit-price + nhãn nguồn "đặt tay"/"Benchmark" +
//       chú thích xoá trắng ô Đơn giá; cột Ngân sách CHỈ HIỂN THỊ (span,
//       không còn input planning-month-budget / savePlanningMonthBudget
//       ở bất cứ đâu); handler change gọi savePlanningMonthUnitPrice;
//       hàm lưu qua parsePlanUnitPrice + guard demo + sUpdate/sCreate
//       plan_rows field unit_price.
//  (a) đặt đơn giá -> ghi field unit_price, ngân sách tháng = qty × giá
//      mới; tổng kỳ qua planBudgetFor và domain.planBudget khớp nhau.
//  (b) xoá trắng ô Đơn giá -> unit_price = null, về đơn giá Benchmark;
//      xoá trắng ở tháng đang Benchmark là no-op.
//  (c) validate: âm / chữ / thập phân bị chặn, dữ liệu không đổi.
//  (d) Paid Ads (qty null): cột Đơn giá hiện '—' không sửa được — gọi
//      lưu bị chặn, dữ liệu không đổi; ngân sách hiển thị vẫn là ngân
//      sách nguồn đã lưu (field budget), không có đường sửa.
//  (e) ô nhiều dòng Số lượng: đặt đơn giá ghi CÙNG unit_price cho mọi
//      dòng, ngân sách = Σ qty × giá mới.
//  (g) sửa Số lượng: tháng có đơn giá đặt tay -> ngân sách theo qty mới
//      × giá đặt tay; tháng Benchmark -> ngân sách theo qty mới × giá
//      Benchmark. Tháng qty = 0 vẫn đặt được đơn giá (ngân sách 0 cho
//      tới khi qty > 0).
//  (h) ô tháng chưa có dòng plan: nhập đơn giá tạo dòng mới qty = 0
//      mang unit_price.
//  (an toàn) dòng có qty thì field budget lưu sẵn (nếu có) KHÔNG được
//      dùng để tính ngân sách — ngân sách luôn = qty × đơn giá hiệu
//      dụng; dữ liệu demo hiện không có dòng nào vừa có qty vừa có
//      budget (khoá để neo không lệch âm thầm).
// Neo demo: Lumus tổng ngân sách năm = 1.515.500.000đ (gồm 728.000.000đ
// Paid Ads từ dữ liệu nguồn), content = 776 khi chưa sửa gì.

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
    '\nreturn { planRowQty: planRowQty, planRowHasQty: planRowHasQty, planRowHasBudget: planRowHasBudget, planRowDirectBudget: planRowDirectBudget, planRowManualUnitPrice: planRowManualUnitPrice, planRowHasManualUnitPrice: planRowHasManualUnitPrice, planRowBenchmarkUnitPrice: planRowBenchmarkUnitPrice, planRowEffectiveUnitPrice: planRowEffectiveUnitPrice, planRowUnitPriceSource: planRowUnitPriceSource, planRowEffectiveBudget: planRowEffectiveBudget, planMonthRows: planMonthRows, planMonthQty: planMonthQty, planMonthBudget: planMonthBudget, planMonthHasManualUnitPrice: planMonthHasManualUnitPrice, planMonthUnitPriceInfo: planMonthUnitPriceInfo, parsePlanQty: parsePlanQty, parsePlanUnitPrice: parsePlanUnitPrice, planBudgetFor: planBudgetFor, distributeQty: distributeQty, savePlanningMonthQty: savePlanningMonthQty, savePlanningMonthUnitPrice: savePlanningMonthUnitPrice };');
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
  { id: 'bench-kol-expert', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Expert', unit_price: 30000000 },
  { id: 'bench-dup', brand_id: 'brand-lumus-ai', segment: null, channel: 'Dup Channel', unit_price: 1000000 },
];
function baseRows() {
  return [
    { id: 'r-kol-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-kol-feb', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-02', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 6, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-ads-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 1000000, phase_id: 'phase-lumus-1' },
    { id: 'r-dup-1', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Dup Channel', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-dup-2', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Dup Channel', group: 'KOL', unit: 'assets', qty: 2, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-expert-jun', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-06', channel: 'KOL Expert', group: 'KOL', unit: 'assets', qty: 0, budget: null, phase_id: 'phase-lumus-2' },
  ];
}
function budgetTotalViaApp(h, rows) {
  return h.planBudgetFor(rows, BENCHMARKS).reduce((s, x) => s + x.total, 0);
}

// ---------- [static] wiring bảng chi tiết ----------
test('PMUP [static]: bảng chi tiết có cột Đơn giá + ô sửa planning-month-unit-price, nhãn đặt tay/Benchmark, chú thích xoá trắng; cột Ngân sách CHỈ HIỂN THỊ, không còn ô sửa ngân sách', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const detail = v.slice(v.indexOf('// Bảng chi tiết của dòng đang chọn'), v.indexOf('// Chart ngân sách dự kiến theo tháng'));
  assert.ok(detail.length > 0);
  assert.match(detail, /<th>Đơn giá \(VNĐ\)<\/th><th>Ngân sách \(VNĐ\)<\/th>/);
  assert.match(detail, /data-action-change="planning-month-unit-price" data-channel="' \+ esc\(selChannel\)/);
  assert.match(detail, /class="phase-input planning-month-input planning-price-input" type="number" step="1" min="0"/);
  assert.match(detail, /planMonthUnitPriceInfo\(selRows, selChannel, cellGroup, m, benchmarks\)/);
  assert.match(detail, /data-planning-price-manual="1">đặt tay</);
  assert.match(detail, /data-planning-price-benchmark="1">Benchmark</);
  assert.match(detail, /data-planning-detail-price-hint="1"/);
  assert.match(detail, /Xoá trắng ô Đơn giá/);
  assert.match(detail, /quay về đơn giá Benchmark/);
  // Ngân sách: chỉ hiển thị qua span, kèm chú thích "chỉ tự tính".
  assert.match(detail, /<span data-planning-budget-value="1">/);
  assert.match(detail, /data-planning-detail-budget-hint="1"/);
  assert.match(detail, /Ngân sách chỉ tự tính \(không sửa được\)/);
  assert.match(detail, /data-planning-budget-source="1">dữ liệu nguồn</);
  assert.match(detail, /data-planning-detail-budget-total="1"/);
  assert.match(detail, /detailBudgetTotal \+= budgetSum;/);
  // Paid Ads (không dòng Số lượng): ô Đơn giá là '—', không sửa được.
  assert.match(detail, /priceCell = '—';/);
  // GỠ hẳn đường sửa ngân sách trực tiếp của commit 06d8ffc.
  assert.ok(!src.includes('planning-month-budget'), 'không được còn ô/handler planning-month-budget');
  assert.ok(!src.includes('savePlanningMonthBudget'), 'không được còn hàm savePlanningMonthBudget');
  assert.ok(!src.includes('parsePlanBudget'), 'không được còn parsePlanBudget');
  assert.ok(css.includes('.planning-price-input'), 'CSS thiếu .planning-price-input');
});

test('PMUP [static]: handler change planning-month-unit-price gọi savePlanningMonthUnitPrice(channel, group, month, value); hàm lưu qua parsePlanUnitPrice + guard + sUpdate/sCreate field unit_price', () => {
  assert.match(src, /if \(ctxKind === 'planning-month-unit-price'\) \{ savePlanningMonthUnitPrice\(t\.getAttribute\('data-channel'\), t\.getAttribute\('data-group'\), t\.getAttribute\('data-month'\), t\.value\); return; \}/);
  const save = section('function savePlanningMonthUnitPrice(channel, group, month, raw)', '// ---------- Brand Hub ----------');
  assert.match(save, /planningMonthSaveGuard\(\)/);
  assert.match(save, /var v = parsePlanUnitPrice\(raw\);/);
  assert.match(save, /sUpdate\('plan_rows', job\.id, \{ unit_price: job\.unit_price \}\)/);
  assert.match(save, /sCreate\('plan_rows', objP\)/);
  assert.match(save, /unit_price: null/);
});

test('PMUP [unit]: parsePlanUnitPrice — chỉ số nguyên >= 0; âm/chữ/thập phân/trống -> null', () => {
  const { h } = makeHarness(baseRows(), PHASES, BENCHMARKS);
  assert.equal(h.parsePlanUnitPrice('0'), 0);
  assert.equal(h.parsePlanUnitPrice('1500000'), 1500000);
  assert.equal(h.parsePlanUnitPrice('-1000'), null);
  assert.equal(h.parsePlanUnitPrice('abc'), null);
  assert.equal(h.parsePlanUnitPrice('1.5'), null);
  assert.equal(h.parsePlanUnitPrice(''), null);
  assert.equal(h.parsePlanUnitPrice(null), null);
});

// ---------- thứ tự ưu tiên ngân sách (app + domain cùng một công thức) ----------
test('PMUP [unit]: ưu tiên ngân sách — đơn giá đặt tay > Benchmark; Paid Ads qty null lấy budget nguồn; dòng có qty thì budget lưu sẵn bị bỏ qua', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Benchmark: KOL Jan qty 4 × 1.500.000.
  assert.equal(h.planRowEffectiveUnitPrice(rows[0], BENCHMARKS), 1500000);
  assert.equal(h.planRowUnitPriceSource(rows[0], BENCHMARKS), 'benchmark');
  assert.equal(h.planRowEffectiveBudget(rows[0], BENCHMARKS), 6000000);
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), { value: 1500000, source: 'benchmark' });
  // Đặt tay thắng Benchmark.
  rows[0].unit_price = 2000000;
  assert.equal(h.planRowEffectiveUnitPrice(rows[0], BENCHMARKS), 2000000);
  assert.equal(h.planRowUnitPriceSource(rows[0], BENCHMARKS), 'manual');
  assert.equal(h.planRowEffectiveBudget(rows[0], BENCHMARKS), 8000000);
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), { value: 2000000, source: 'manual' });
  // Paid Ads: không đơn giá, ngân sách = budget nguồn.
  const ads = rows.find((r) => r.id === 'r-ads-jan');
  assert.equal(h.planRowEffectiveUnitPrice(ads, BENCHMARKS), null);
  assert.equal(h.planRowEffectiveBudget(ads, BENCHMARKS), 1000000);
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'Meta Ads', 'Paid Media', '2027-01', BENCHMARKS), { value: null, source: null });
  // An toàn neo: dòng CÓ qty mà có budget lưu sẵn lệch công thức -> budget
  // bị bỏ qua ở CẢ app lẫn domain (không tự ý cộng budget vào tổng).
  const conflict = { id: 'r-conflict', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', qty: 4, budget: 999 };
  assert.equal(h.planRowEffectiveBudget(conflict, BENCHMARKS), 6000000);
  const db = domain.planBudget([conflict], BENCHMARKS);
  assert.equal(db.total, 6000000);
  assert.equal(db.rows[0].source, 'unit_price');
  // Domain: nguồn của từng tầng.
  const nanoManual = { ...rows[0] };
  const dAll = domain.planBudget([nanoManual, rows.find((r) => r.id === 'r-kol-feb'), ads], BENCHMARKS);
  assert.equal(dAll.rows.find((r) => r.rowId === 'r-kol-jan').source, 'manual_unit_price');
  assert.equal(dAll.rows.find((r) => r.rowId === 'r-kol-feb').source, 'unit_price');
  assert.equal(dAll.rows.find((r) => r.rowId === 'r-ads-jan').source, 'direct');
  assert.equal(dAll.totalManualUnitPrice, 8000000);
  assert.equal(dAll.totalUnitPrice, 8000000 + 9000000);
  assert.equal(dAll.totalDirect, 1000000);
  assert.equal(dAll.total, 18000000);
});

// ---------- (a) đặt đơn giá ----------
test('PMUP (a): đặt Đơn giá KOL Nano 2027-01 = 2.000.000 -> ghi unit_price, ngân sách tháng = 4 × 2.000.000 = 8.000.000, tổng kỳ tăng đúng +2.000.000 và khớp domain', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-01', '2000000');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').unit_price, 2000000);
  assert.deepEqual(state.updates, [{ coll: 'plan_rows', id: 'r-kol-jan', patch: { unit_price: 2000000 } }]);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 8000000);
  assert.equal(h.planMonthHasManualUnitPrice(rows, 'KOL Nano', 'KOL', '2027-01'), true);
  assert.equal(budgetTotalViaApp(h, rows) - before, 2000000);
  assert.equal(domain.planBudget(rows, BENCHMARKS).total, budgetTotalViaApp(h, rows), 'domain.planBudget và planBudgetFor phải khớp');
  assert.ok(state.toasts.some((m) => /Đã lưu Đơn giá đặt tay 2000000/.test(m)), 'phải có toast đã lưu đơn giá đặt tay: ' + state.toasts.join(' | '));
});

test('PMUP (a): đặt Đơn giá bằng đúng giá Benchmark (1.500.000) vẫn ghi unit_price tường minh để tháng thành đặt tay thật', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-01', '1500000');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').unit_price, 1500000);
  assert.equal(state.updates.length, 1);
  assert.equal(h.planRowUnitPriceSource(rows[0], BENCHMARKS), 'manual');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 6000000);
});

// ---------- (b) xoá trắng quay về Benchmark ----------
test('PMUP (b): xoá trắng ô Đơn giá đang đặt tay -> unit_price = null, ngân sách về đúng Benchmark và tổng kỳ về đúng ban đầu; xoá trắng ô đang Benchmark là no-op', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-01', '2000000');
  assert.equal(budgetTotalViaApp(h, rows), before + 2000000);
  h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-01', '');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').unit_price, null);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 6000000);
  assert.equal(h.planMonthHasManualUnitPrice(rows, 'KOL Nano', 'KOL', '2027-01'), false);
  assert.equal(budgetTotalViaApp(h, rows), before);
  assert.ok(state.toasts.some((m) => /Đã bỏ Đơn giá đặt tay/.test(m) && /Benchmark/.test(m)));
  const updatesBefore = state.updates.length;
  h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-02', '');
  assert.equal(state.updates.length, updatesBefore);
  assert.equal(rows.find((r) => r.id === 'r-kol-feb').unit_price, undefined);
});

// ---------- (c) validate ----------
test('PMUP (c): nhập Đơn giá sai (âm / chữ / thập phân) bị chặn — không update/create, dữ liệu không đổi, có toast lỗi', () => {
  for (const raw of ['-1000', 'abc', '1.5', '1000.5']) {
    const rows = baseRows();
    const snapshot = rows.map((r) => ({ ...r }));
    const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
    h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-01', raw);
    assert.deepEqual(rows, snapshot, 'raw=' + JSON.stringify(raw) + ' không được đổi dữ liệu');
    assert.equal(state.updates.length, 0);
    assert.equal(state.creates.length, 0);
    assert.ok(state.toasts.some((m) => /Đơn giá phải là số nguyên từ 0 trở lên/.test(m)), 'raw=' + JSON.stringify(raw) + ' phải báo lỗi rõ');
  }
});

// ---------- (d) Paid Ads ----------
test('PMUP (d): Paid Ads (qty null) — đặt Đơn giá bị chặn, dữ liệu không đổi; ngân sách hiển thị vẫn là ngân sách nguồn 1.000.000', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePlanningMonthUnitPrice('Meta Ads', 'Paid Media', '2027-01', '2000000');
  const ads = rows.find((r) => r.id === 'r-ads-jan');
  assert.equal(ads.unit_price, undefined);
  assert.equal(ads.budget, 1000000, 'ngân sách nguồn của Paid Ads không có đường sửa');
  assert.equal(ads.qty, null);
  assert.equal(state.updates.length, 0);
  assert.equal(state.creates.length, 0);
  assert.ok(state.toasts.some((m) => /chỉ có dòng ngân sách nguồn/.test(m) && /không đặt Đơn giá/.test(m)));
  assert.equal(h.planMonthBudget(rows, 'Meta Ads', 'Paid Media', '2027-01', BENCHMARKS), 1000000);
});

// ---------- (e) nhiều dòng / ô ----------
test('PMUP (e): ô nhiều dòng Số lượng — đặt Đơn giá ghi cùng unit_price cho mọi dòng, ngân sách = Σ qty × giá mới', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Dup Channel: qty 4 + 2, Benchmark 1.000.000 -> đặt 1.500.000.
  h.savePlanningMonthUnitPrice('Dup Channel', 'KOL', '2027-01', '1500000');
  assert.equal(rows.find((r) => r.id === 'r-dup-1').unit_price, 1500000);
  assert.equal(rows.find((r) => r.id === 'r-dup-2').unit_price, 1500000);
  assert.equal(h.planMonthBudget(rows, 'Dup Channel', 'KOL', '2027-01', BENCHMARKS), 9000000);
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'Dup Channel', 'KOL', '2027-01', BENCHMARKS), { value: 1500000, source: 'manual' });
  // Xoá trắng: cả hai dòng về Benchmark 1.000.000 -> ngân sách 6.000.000.
  h.savePlanningMonthUnitPrice('Dup Channel', 'KOL', '2027-01', '');
  assert.equal(rows.find((r) => r.id === 'r-dup-1').unit_price, null);
  assert.equal(rows.find((r) => r.id === 'r-dup-2').unit_price, null);
  assert.equal(h.planMonthBudget(rows, 'Dup Channel', 'KOL', '2027-01', BENCHMARKS), 6000000);
});

// ---------- (g) tương tác Số lượng <-> Đơn giá/Ngân sách ----------
test('PMUP (g): sửa Số lượng — tháng ĐẶT TAY đơn giá thì ngân sách theo qty mới × giá đặt tay; tháng Benchmark thì theo qty mới × giá Benchmark; tháng qty = 0 vẫn đặt được đơn giá', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Benchmark: KOL Feb qty 6 -> 5 thì ngân sách 9.000.000 -> 7.500.000.
  h.savePlanningMonthQty('KOL Nano', 'KOL', '2027-02', '5');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-02', BENCHMARKS), 7500000);
  // Đặt tay 2.000.000 cho Jan (qty 4 -> ngân sách 8.000.000) rồi sửa qty 4 -> 5:
  // ngân sách chạy theo đơn giá đặt tay -> 10.000.000 (KHÁC ngân sách đặt tay cũ).
  h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-01', '2000000');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 8000000);
  h.savePlanningMonthQty('KOL Nano', 'KOL', '2027-01', '5');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').qty, 5);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 10000000);
  // Tháng qty = 0 (KOL Expert 2027-06): đặt đơn giá 10.000.000 được, ngân
  // sách vẫn 0; tăng qty lên 2 -> ngân sách 20.000.000.
  h.savePlanningMonthUnitPrice('KOL Expert', 'KOL', '2027-06', '10000000');
  assert.equal(rows.find((r) => r.id === 'r-expert-jun').unit_price, 10000000);
  assert.equal(h.planMonthBudget(rows, 'KOL Expert', 'KOL', '2027-06', BENCHMARKS), 0);
  h.savePlanningMonthQty('KOL Expert', 'KOL', '2027-06', '2');
  assert.equal(h.planMonthBudget(rows, 'KOL Expert', 'KOL', '2027-06', BENCHMARKS), 20000000);
});

// ---------- (h) ô trống ----------
test('PMUP (h): ô tháng chưa có dòng plan — nhập Đơn giá tạo dòng mới qty = 0 mang unit_price đúng ngữ cảnh', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-04', '2500000');
  assert.equal(state.creates.length, 1);
  const created = state.creates[0].item;
  assert.equal(created.month, '2027-04');
  assert.equal(created.unit_price, 2500000);
  assert.equal(created.qty, 0);
  assert.equal(created.budget, null);
  assert.equal(created.channel, 'KOL Nano');
  assert.equal(created.brand_id, 'brand-lumus-ai');
  assert.equal(created.phase_id, 'phase-lumus-2', 'tháng 2027-04 thuộc Phase 2');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-04', BENCHMARKS), 0, 'qty 0 nên ngân sách vẫn 0 dù đã có đơn giá đặt tay');
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'KOL Nano', 'KOL', '2027-04', BENCHMARKS), { value: 2500000, source: 'manual' });
});

// ---------- an toàn + neo demo ----------
test('PMUP [an toàn]: dữ liệu demo KHÔNG có dòng nào vừa có qty vừa có budget lưu sẵn (0 dòng lệch công thức) — neo không bị đe doạ', () => {
  const both = demo.plan_rows.filter((r) => r.qty !== null && r.qty !== undefined && r.budget !== null && r.budget !== undefined);
  assert.equal(both.length, 0, 'nếu sau này dữ liệu nguồn thêm dòng qty+budget lệch công thức thì phải dừng và báo delta, không tự ý đổi neo');
});

test('PMUP [neo]: demo Lumus tổng ngân sách năm = 1.515.500.000đ (gồm Paid Ads direct 728.000.000đ từ dữ liệu nguồn) và tổng content = 776 khi chưa sửa gì (domain + planBudgetFor đều khớp)', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776);
  const d = domain.planBudget(lumus, demo.benchmarks);
  assert.equal(d.total, 1515500000);
  assert.equal(d.totalDirect, 728000000);
  assert.equal(d.totalUnitPrice, 787500000);
  assert.equal(d.totalManualUnitPrice, 0, 'chưa sửa gì thì không có đơn giá đặt tay nào');
  assert.ok(lumus.every((r) => r.unit_price === undefined || r.unit_price === null), 'dữ liệu nguồn không mang sẵn đơn giá đặt tay trên dòng');
  const { h } = makeHarness([], [], demo.benchmarks);
  const viaApp = h.planBudgetFor(lumus, demo.benchmarks).reduce((s, x) => s + x.total, 0);
  assert.equal(viaApp, 1515500000);
});
