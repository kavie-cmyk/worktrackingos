// tests/planning-month-unit-price.test.mjs
// Planning Theo tháng — cột ĐƠN GIÁ trong BẢNG CHI TIẾT.
// VIẾT LẠI theo 2 chốt của Zac ngày 18/11:
//  (17:24) "bỏ hẳn nhập đơn giá chi tiết dòng cho mọi dòng — giá chỉ quản
//       ở phase, riêng paid media thì ko bỏ nha": bảng chi tiết KHÔNG
//       còn ô sửa Đơn giá (planning-month-unit-price +
//       savePlanningMonthUnitPrice đã gỡ hẳn); Đơn giá chỉ HIỂN THỊ
//       (giá hiệu dụng + nhãn nguồn) và chỉ đổi/xoá được qua ô "Đơn giá
//       mỗi bài" bên Theo phase (savePhaseUnitPrice). Ô Số lượng giữ
//       nguyên khả sửa; Ngân sách vẫn tự tính. Paid Media giữ nguyên ô
//       nhập Ngân sách trực tiếp theo Objective.
//  (17:28) "bỏ hẳn đi, phase nào chưa đặt giá thì để trống, mình tự đặt
//       sau" — bỏ hẳn giá Benchmark KHỎI chuỗi đơn giá: đơn giá hiệu
//       dụng CHỈ còn = unit_price trên plan_rows (giá Phase). Benchmark
//       có unit_price mà dòng chưa có giá Phase -> đơn giá trống, ngân
//       sách phần đó = 0. Nhãn nguồn "Benchmark" cho giá biến mất; chỉ
//       còn "giá Phase" / "chưa đặt giá".
// File này giữ tên cũ (đợt PMUP) nhưng nội dung khoá hành vi MỚI:
//  (static) bảng chi tiết: cột "Đơn giá (VNĐ)" là span chỉ đọc
//       data-planning-price-value + nhãn giá Phase/chưa đặt giá; KHÔNG
//       còn planning-month-unit-price / savePlanningMonthUnitPrice ở
//       bất cứ đâu; handler giá duy nhất còn lại là phase-unit-price ->
//       savePhaseUnitPrice (guard + parsePlanUnitPrice + sUpdate
//       plan_rows field unit_price); cột Ngân sách CHỈ HIỂN THỊ cho
//       dòng thường (ngoại lệ Paid Media ở file planning-paid-budget).
//  (unit) chuỗi giá: Benchmark bị phớt lờ hoàn toàn; giá Phase thắng
//       mọi thứ; Paid Ads qty null lấy budget nguồn; dòng có qty thì
//       budget lưu sẵn bị bỏ qua.
//  (a) đặt giá qua Theo phase -> ghi unit_price cho MỌI dòng Số lượng
//      của Channel trong Phase; ngân sách tháng = qty × giá mới; tổng
//      kỳ qua planBudgetFor và domain.planBudget khớp nhau.
//  (b) xoá trắng ô giá Phase -> unit_price = null cả Phase, đơn giá
//      trống, ngân sách phần đó = 0 (KHÔNG quay về Benchmark); xoá
//      trắng khi chưa có giá Phase là no-op.
//  (c) validate qua Theo phase: âm / chữ / thập phân bị chặn.
//  (d) Paid Ads (qty null): đặt giá Phase bị chặn, dữ liệu không đổi;
//      ngân sách hiển thị vẫn là ngân sách nguồn.
//  (e) ô nhiều dòng Số lượng: giá Phase ghi CÙNG unit_price cho mọi
//      dòng, ngân sách = Σ qty × giá.
//  (g) sửa Số lượng ở chi tiết: ngân sách theo qty mới × giá Phase của
//      dòng; tháng chưa đặt giá Phase thì ngân sách = 0 dù Benchmark có
//      giá; tháng qty = 0 vẫn mang giá Phase (ngân sách 0 tới khi qty > 0).
//  (h) tháng chưa có dòng plan: lưu giá Phase KHÔNG tạo dòng (chỉ áp
//      cho dòng đang có) — khác hẳn cơ chế tạo dòng của ô Số lượng.
//  (an toàn) dòng có qty thì field budget lưu sẵn (nếu có) KHÔNG được
//      dùng để tính ngân sách; dữ liệu demo hiện không có dòng nào vừa
//      có qty vừa có budget (khoá để neo không lệch âm thầm).
// Neo demo: Lumus tổng ngân sách năm = 1.238.700.000đ (gồm 811.200.000đ
// Paid Ads từ dữ liệu nguồn; 427.500.000đ nay là GIÁ PHASE trên dòng KOL
// — fixture demo đã chuyển giá từ Benchmark sang plan_rows, chốt 18/11),
// content = 764 khi chưa sửa gì.

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
    '\nreturn { planRowQty: planRowQty, planRowHasQty: planRowHasQty, planRowHasBudget: planRowHasBudget, planRowDirectBudget: planRowDirectBudget, planRowManualUnitPrice: planRowManualUnitPrice, planRowHasManualUnitPrice: planRowHasManualUnitPrice, planRowEffectiveUnitPrice: planRowEffectiveUnitPrice, planRowUnitPriceSource: planRowUnitPriceSource, planRowEffectiveBudget: planRowEffectiveBudget, planMonthRows: planMonthRows, planMonthQty: planMonthQty, planMonthBudget: planMonthBudget, planMonthHasManualUnitPrice: planMonthHasManualUnitPrice, planMonthUnitPriceInfo: planMonthUnitPriceInfo, parsePlanQty: parsePlanQty, parsePlanUnitPrice: parsePlanUnitPrice, planBudgetFor: planBudgetFor, distributeQty: distributeQty, savePlanningMonthQty: savePlanningMonthQty, savePhaseUnitPrice: savePhaseUnitPrice };');
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
// Benchmarks VẪN mang unit_price (như dữ liệu DB hiện tại) để khoá là
// giá Benchmark KHÔNG còn được đọc ở bất kỳ đường nào (chốt 18/11).
const BENCHMARKS = [
  { id: 'bench-kol-nano', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Nano', unit_price: 1500000 },
  { id: 'bench-kol-macro', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Macro', unit_price: 30000000 },
  { id: 'bench-dup', brand_id: 'brand-lumus-ai', segment: null, channel: 'Dup Channel', unit_price: 1000000 },
];
function baseRows() {
  return [
    { id: 'r-kol-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-kol-feb', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-02', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 6, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-ads-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 1000000, phase_id: 'phase-lumus-1' },
    { id: 'r-dup-1', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Dup Channel', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-dup-2', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Dup Channel', group: 'KOL', unit: 'assets', qty: 2, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-macro-jun', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-06', channel: 'KOL Macro', group: 'KOL', unit: 'assets', qty: 0, budget: null, phase_id: 'phase-lumus-2' },
  ];
}
function budgetTotalViaApp(h, rows) {
  return h.planBudgetFor(rows, BENCHMARKS).reduce((s, x) => s + x.total, 0);
}

// ---------- [static] wiring bảng chi tiết ----------
test('PMUP [static]: bảng chi tiết — cột Đơn giá CHỈ HIỂN THỊ (span giá hiệu dụng + nhãn giá Phase/chưa đặt giá), KHÔNG còn ô sửa planning-month-unit-price ở bất cứ đâu; cột Ngân sách CHỈ HIỂN THỊ cho dòng thường (ngoại lệ Paid Media ở file planning-paid-budget riêng)', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const detail = v.slice(v.indexOf('// Bảng chi tiết của dòng đang chọn'), v.indexOf('// Chart ngân sách dự kiến theo tháng'));
  assert.ok(detail.length > 0);
  assert.match(detail, /<th>Đơn giá \(VNĐ\)<\/th><th>Ngân sách \(VNĐ\)<\/th>/);
  assert.match(detail, /planMonthUnitPriceInfo\(selRows, selChannel, cellGroup, m, benchmarks\)/);
  assert.match(detail, /<span data-planning-price-value="1">/);
  assert.match(detail, /data-planning-price-phase="1">giá Phase</);
  assert.match(detail, /data-planning-price-none="1">chưa đặt giá</);
  assert.match(detail, /data-planning-detail-price-hint="1"/);
  assert.match(detail, /Đơn giá chỉ hiển thị ở bảng này — quản ở Theo phase/);
  assert.match(detail, /chưa đặt giá Phase thì đơn giá trống và ngân sách phần đó = 0/);
  // GỠ hẳn đường sửa giá tại dòng (chốt 18/11 17:24).
  assert.ok(!src.includes('planning-month-unit-price'), 'không được còn ô/handler planning-month-unit-price');
  assert.ok(!src.includes('savePlanningMonthUnitPrice'), 'không được còn hàm savePlanningMonthUnitPrice');
  assert.ok(!src.includes('data-planning-price-benchmark'), 'nhãn nguồn Benchmark cho giá đã biến mất');
  assert.ok(!src.includes('data-planning-price-manual'), 'nhãn "đặt tay" tại dòng đã thay bằng "giá Phase"');
  // Ngân sách dòng THƯỜNG: chỉ hiển thị qua span, kèm chú thích "chỉ tự
  // tính". (Paid Media là ngoại lệ nhập trực tiếp — khoá riêng ở
  // tests/planning-paid-budget.test.mjs.)
  assert.match(detail, /<span data-planning-budget-value="1">/);
  assert.match(detail, /data-planning-detail-budget-hint="1"/);
  assert.match(detail, /Ngân sách của dòng thường chỉ tự tính \(không sửa được\)/);
  assert.match(detail, /data-planning-budget-source="1">dữ liệu nguồn</);
  assert.match(detail, /data-planning-detail-budget-total="1"/);
  assert.match(detail, /detailBudgetTotal \+= budgetSum;/);
  // Paid Ads (không dòng Số lượng): ô Đơn giá là '—', không sửa được.
  assert.match(detail, /priceCell = '—';/);
  // GỠ hẳn đường sửa ngân sách trực tiếp của commit 06d8ffc.
  assert.ok(!src.includes('planning-month-budget'), 'không được còn ô/handler planning-month-budget');
  assert.ok(!src.includes('savePlanningMonthBudget'), 'không được còn hàm savePlanningMonthBudget');
  assert.ok(!src.includes('parsePlanBudget'), 'không được còn parsePlanBudget');
  assert.ok(css.includes('.planning-price-input'), 'CSS thiếu .planning-price-input (ô giá Phase vẫn dùng)');
});

test('PMUP [static]: đường sửa giá DUY NHẤT còn lại là Theo phase — handler change phase-unit-price gọi savePhaseUnitPrice(phaseId, channel, value); hàm lưu qua parsePlanUnitPrice + guard + sUpdate field unit_price (ghi và xoá = null)', () => {
  assert.match(src, /if \(ctxKind === 'phase-unit-price'\) \{ savePhaseUnitPrice\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-channel'\), t\.value\); return; \}/);
  const save = section('function savePhaseUnitPrice(phaseId, channel, raw)', '// --- Lưu ô Số lượng trong BẢNG CHI TIẾT');
  assert.match(save, /phaseSaveGuard\(\)/);
  assert.match(save, /var v = parsePlanUnitPrice\(raw\);/);
  assert.match(save, /sUpdate\('plan_rows', job\.id, \{ unit_price: job\.unit_price \}\)/);
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

// ---------- chuỗi đơn giá hiệu dụng (app + domain cùng một công thức) ----------
test('PMUP [unit]: chuỗi giá — Benchmark bị phớt lờ hoàn toàn (dòng chưa có giá Phase -> đơn giá trống, ngân sách 0 dù Benchmark có giá); giá Phase là nguồn duy nhất; Paid Ads qty null lấy budget nguồn; dòng có qty thì budget lưu sẵn bị bỏ qua', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Chưa đặt giá Phase: Benchmark 1.500.000 KHÔNG còn hiệu lực.
  assert.equal(h.planRowEffectiveUnitPrice(rows[0], BENCHMARKS), null);
  assert.equal(h.planRowUnitPriceSource(rows[0], BENCHMARKS), null);
  assert.equal(h.planRowEffectiveBudget(rows[0], BENCHMARKS), 0);
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), { value: null, source: null });
  const dNone = domain.planBudget([rows[0]], BENCHMARKS);
  assert.equal(dNone.total, 0, 'domain cũng phớt lờ giá Benchmark');
  assert.equal(dNone.rows[0].source, null);
  // Giá Phase trên dòng là nguồn giá duy nhất.
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
  const conflict = { id: 'r-conflict', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', qty: 4, budget: 999, unit_price: 1500000 };
  assert.equal(h.planRowEffectiveBudget(conflict, BENCHMARKS), 6000000);
  const db = domain.planBudget([conflict], BENCHMARKS);
  assert.equal(db.total, 6000000);
  assert.equal(db.rows[0].source, 'manual_unit_price');
  // Domain: tổng theo nguồn — mọi dòng có qty đều là giá Phase.
  rows.find((r) => r.id === 'r-kol-feb').unit_price = 1500000;
  const dAll = domain.planBudget([rows[0], rows.find((r) => r.id === 'r-kol-feb'), ads], BENCHMARKS);
  assert.equal(dAll.rows.find((r) => r.rowId === 'r-kol-jan').source, 'manual_unit_price');
  assert.equal(dAll.rows.find((r) => r.rowId === 'r-kol-feb').source, 'manual_unit_price');
  assert.equal(dAll.rows.find((r) => r.rowId === 'r-ads-jan').source, 'direct');
  assert.equal(dAll.totalManualUnitPrice, 8000000 + 9000000);
  assert.equal(dAll.totalUnitPrice, 8000000 + 9000000);
  assert.equal(dAll.totalDirect, 1000000);
  assert.equal(dAll.total, 18000000);
});

// ---------- (a) đặt giá qua Theo phase ----------
test('PMUP (a): đặt Đơn giá mỗi bài KOL Nano ở Phase 1 = 2.000.000 -> ghi unit_price cho CẢ 2 tháng của Phase, ngân sách tháng 1 = 4 × 2.000.000 = 8.000.000, tổng kỳ tăng đúng phần giá Phase mới và khớp domain', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  assert.equal(before, 1000000, 'trước khi đặt giá Phase: chỉ còn ngân sách nguồn của Paid Ads (giá Benchmark không tính)');
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '2000000');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').unit_price, 2000000);
  assert.equal(rows.find((r) => r.id === 'r-kol-feb').unit_price, 2000000);
  assert.equal(state.updates.length, 2);
  assert.ok(state.updates.every((u) => u.coll === 'plan_rows' && u.patch.unit_price === 2000000));
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 8000000);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-02', BENCHMARKS), 12000000);
  assert.equal(h.planMonthHasManualUnitPrice(rows, 'KOL Nano', 'KOL', '2027-01'), true);
  assert.equal(budgetTotalViaApp(h, rows) - before, 20000000);
  assert.equal(domain.planBudget(rows, BENCHMARKS).total, budgetTotalViaApp(h, rows), 'domain.planBudget và planBudgetFor phải khớp');
  assert.ok(state.toasts.some((m) => /Đã lưu Đơn giá mỗi bài đặt tay 2000000/.test(m)), 'phải có toast đã lưu giá Phase: ' + state.toasts.join(' | '));
});

test('PMUP (a): đặt giá Phase bằng đúng số tiền giá Benchmark cũ (1.500.000) vẫn ghi unit_price tường minh — giá đến từ dòng, không phải Benchmark', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '1500000');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').unit_price, 1500000);
  assert.equal(state.updates.length, 2);
  assert.equal(h.planRowUnitPriceSource(rows[0], BENCHMARKS), 'manual');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 6000000);
});

// ---------- (b) xoá trắng ô giá Phase ----------
test('PMUP (b): xoá trắng ô Đơn giá mỗi bài -> unit_price = null cả Phase, đơn giá TRỐNG và ngân sách = 0 (KHÔNG quay về Benchmark), tổng kỳ về đúng ban đầu; xoá trắng khi chưa có giá Phase là no-op', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  const before = budgetTotalViaApp(h, rows);
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '2000000');
  assert.equal(budgetTotalViaApp(h, rows), before + 20000000);
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').unit_price, null);
  assert.equal(rows.find((r) => r.id === 'r-kol-feb').unit_price, null);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 0);
  assert.equal(h.planMonthHasManualUnitPrice(rows, 'KOL Nano', 'KOL', '2027-01'), false);
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), { value: null, source: null });
  assert.equal(budgetTotalViaApp(h, rows), before);
  assert.ok(state.toasts.some((m) => /Đã bỏ giá Phase của KOL Nano/.test(m) && /Đơn giá để trống/.test(m)));
  const updatesBefore = state.updates.length;
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '');
  assert.equal(state.updates.length, updatesBefore, 'xoá trắng lần nữa là no-op');
});

// ---------- (c) validate ----------
test('PMUP (c): nhập Đơn giá mỗi bài sai (âm / chữ / thập phân) bị chặn — không update/create, dữ liệu không đổi, có toast lỗi', () => {
  for (const raw of ['-1000', 'abc', '1.5', '1000.5']) {
    const rows = baseRows();
    const snapshot = rows.map((r) => ({ ...r }));
    const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
    h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', raw);
    assert.deepEqual(rows, snapshot, 'raw=' + JSON.stringify(raw) + ' không được đổi dữ liệu');
    assert.equal(state.updates.length, 0);
    assert.equal(state.creates.length, 0);
    assert.ok(state.toasts.some((m) => /Đơn giá mỗi bài phải là số nguyên từ 0 trở lên/.test(m)), 'raw=' + JSON.stringify(raw) + ' phải báo lỗi rõ');
  }
});

// ---------- (d) Paid Ads ----------
test('PMUP (d): Paid Ads (qty null) — đặt giá Phase bị chặn, dữ liệu không đổi; ngân sách hiển thị vẫn là ngân sách nguồn 1.000.000', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  h.savePhaseUnitPrice('phase-lumus-1', 'Meta Ads', '2000000');
  const ads = rows.find((r) => r.id === 'r-ads-jan');
  assert.equal(ads.unit_price, undefined);
  assert.equal(ads.budget, 1000000, 'ngân sách nguồn của Paid Ads không đổi');
  assert.equal(ads.qty, null);
  assert.equal(state.updates.length, 0);
  assert.equal(state.creates.length, 0);
  assert.ok(state.toasts.some((m) => /chỉ có dòng ngân sách nguồn/.test(m) && /không đặt Đơn giá mỗi bài/.test(m)));
  assert.equal(h.planMonthBudget(rows, 'Meta Ads', 'Paid Media', '2027-01', BENCHMARKS), 1000000);
});

// ---------- (e) nhiều dòng / ô ----------
test('PMUP (e): ô nhiều dòng Số lượng — giá Phase ghi cùng unit_price cho mọi dòng, ngân sách = Σ qty × giá; xoá trắng -> cả hai dòng mất giá, ngân sách = 0', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Dup Channel: qty 4 + 2 trong Phase 1 -> đặt 1.500.000.
  h.savePhaseUnitPrice('phase-lumus-1', 'Dup Channel', '1500000');
  assert.equal(rows.find((r) => r.id === 'r-dup-1').unit_price, 1500000);
  assert.equal(rows.find((r) => r.id === 'r-dup-2').unit_price, 1500000);
  assert.equal(h.planMonthBudget(rows, 'Dup Channel', 'KOL', '2027-01', BENCHMARKS), 9000000);
  assert.deepEqual(h.planMonthUnitPriceInfo(rows, 'Dup Channel', 'KOL', '2027-01', BENCHMARKS), { value: 1500000, source: 'manual' });
  // Xoá trắng: cả hai dòng về trống -> ngân sách 0 (Benchmark 1.000.000 bị phớt lờ).
  h.savePhaseUnitPrice('phase-lumus-1', 'Dup Channel', '');
  assert.equal(rows.find((r) => r.id === 'r-dup-1').unit_price, null);
  assert.equal(rows.find((r) => r.id === 'r-dup-2').unit_price, null);
  assert.equal(h.planMonthBudget(rows, 'Dup Channel', 'KOL', '2027-01', BENCHMARKS), 0);
});

// ---------- (g) tương tác Số lượng <-> giá Phase/Ngân sách ----------
test('PMUP (g): sửa Số lượng ở chi tiết — ngân sách theo qty mới × giá Phase của dòng; tháng chưa đặt giá Phase thì ngân sách = 0 dù Benchmark có giá; tháng qty = 0 vẫn mang giá Phase', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS);
  // Chưa đặt giá Phase: sửa qty Feb 6 -> 5, ngân sách vẫn 0 (Benchmark
  // 1.500.000 không còn được đọc).
  h.savePlanningMonthQty('KOL Nano', 'KOL', '2027-02', '5');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-02', BENCHMARKS), 0);
  // Đặt giá Phase 2.000.000 (áp cả Jan + Feb): Jan qty 4 -> 8.000.000,
  // Feb qty 5 -> 10.000.000; sửa qty Jan 4 -> 5 thì ngân sách chạy theo
  // giá Phase -> 10.000.000.
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '2000000');
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 8000000);
  h.savePlanningMonthQty('KOL Nano', 'KOL', '2027-01', '5');
  assert.equal(rows.find((r) => r.id === 'r-kol-jan').qty, 5);
  assert.equal(h.planMonthBudget(rows, 'KOL Nano', 'KOL', '2027-01', BENCHMARKS), 10000000);
  // Tháng qty = 0 (KOL Macro 2027-06, Phase 2): đặt giá Phase
  // 10.000.000 được, ngân sách vẫn 0; tăng qty lên 2 -> 20.000.000.
  h.savePhaseUnitPrice('phase-lumus-2', 'KOL Macro', '10000000');
  assert.equal(rows.find((r) => r.id === 'r-macro-jun').unit_price, 10000000);
  assert.equal(h.planMonthBudget(rows, 'KOL Macro', 'KOL', '2027-06', BENCHMARKS), 0);
  h.savePlanningMonthQty('KOL Macro', 'KOL', '2027-06', '2');
  assert.equal(h.planMonthBudget(rows, 'KOL Macro', 'KOL', '2027-06', BENCHMARKS), 20000000);
});

// ---------- (h) tháng chưa có dòng ----------
test('PMUP (h): Phase chưa có dòng nào của Channel — lưu giá Phase KHÔNG tạo dòng, không update, có toast nói rõ (giá chỉ áp cho dòng đang có; tạo dòng là việc của ô Số lượng / Thêm dòng)', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES, BENCHMARKS);
  // Phase 2 (2027-03..05) không có dòng KOL Nano nào trong fixture.
  h.savePhaseUnitPrice('phase-lumus-2', 'KOL Nano', '2500000');
  assert.equal(state.creates.length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(rows.length, 6);
  assert.ok(state.toasts.some((m) => /Không có dòng plan nào của Channel KOL Nano trong Phase/.test(m)), 'phải có toast nói rõ: ' + state.toasts.join(' | '));
});

// ---------- an toàn + neo demo ----------
test('PMUP [an toàn]: dữ liệu demo KHÔNG có dòng nào vừa có qty vừa có budget lưu sẵn (0 dòng lệch công thức) — neo không bị đe doạ', () => {
  const both = demo.plan_rows.filter((r) => r.qty !== null && r.qty !== undefined && r.budget !== null && r.budget !== undefined);
  assert.equal(both.length, 0, 'nếu sau này dữ liệu nguồn thêm dòng qty+budget lệch công thức thì phải dừng và báo delta, không tự ý đổi neo');
});

test('PMUP [neo]: demo Lumus tổng ngân sách năm = 1.238.700.000đ (Paid Ads direct 811.200.000đ + giá Phase KOL 427.500.000đ trên dòng — fixture đã chuyển giá từ Benchmark sang plan_rows, chốt 18/11) và tổng content = 764 khi chưa sửa gì (domain + planBudgetFor đều khớp)', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 764);
  const d = domain.planBudget(lumus, demo.benchmarks);
  assert.equal(d.total, 1238700000);
  assert.equal(d.totalDirect, 811200000);
  assert.equal(d.totalUnitPrice, 427500000);
  assert.equal(d.totalManualUnitPrice, 427500000, 'toàn bộ phần qty × đơn giá nay là giá Phase trên dòng');
  const priced = lumus.filter((r) => r.unit_price !== undefined && r.unit_price !== null);
  assert.equal(priced.length, 24, '24 dòng KOL (2 kênh × 12 tháng) mang giá Phase trong fixture');
  assert.ok(priced.every((r) => ['KOL Nano', 'KOL Micro'].includes(r.channel)));
  const { h } = makeHarness([], [], demo.benchmarks);
  const viaApp = h.planBudgetFor(lumus, demo.benchmarks).reduce((s, x) => s + x.total, 0);
  assert.equal(viaApp, 1238700000);
});
