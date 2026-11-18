// tests/planning-add-row.test.mjs
// Planning Theo tháng — THÊM DÒNG (kênh mới) vào lưới:
//  (static) nút "+ Thêm dòng" + form planning-add-row-form (Brand /
//       Channel có sẵn hoặc mới / Nhóm có sẵn hoặc mới / Segment —
//       KHÔNG còn ô "Đơn giá ban đầu": ô đó tạo Benchmark kèm giá, giá
//       Benchmark đã bỏ hẳn nên gỡ luôn theo chốt 18/11 17:28); đổi
//       Brand trong form render lại để nạp Channel/Nhóm theo Brand;
//       submit -> savePlanningAddRow; hàm lưu qua guard + sCreate
//       plan_rows, KHÔNG tạo Benchmark, KHÔNG ghi giá lên dòng.
//  (a) thêm kênh mới hoàn toàn (Google Ads): tạo 1 dòng plan qty = 0 ở
//      tháng 1 năm đang xem, gắn phase theo Brand + tháng như các đường
//      tạo dòng hiện tại; dòng hiện trong lưới (helper gom lưới), bảng
//      chi tiết mở sẵn và sửa được ngay Số lượng ở tháng chưa có dòng
//      plan (cơ chế tạo dòng khi sửa áp cho kênh mới); giá đặt sau qua
//      ô Đơn giá mỗi bài ở Theo phase (áp cho mọi dòng của Phase).
//  (b) thêm dòng KHÔNG tạo Benchmark và dòng KHÔNG mang giá: ngân sách
//      = 0 cho tới khi đặt giá Phase; Forecast của kênh mới = null
//      (chưa có Benchmark tỉ lệ) như kênh thiếu Benchmark khác, không lỗi.
//  (c) Channel đã có Benchmark (KOL Micro) -> vẫn chỉ tạo dòng plan,
//      Benchmark không bị đụng (và giá Benchmark 5.500.000 của nó cũng
//      KHÔNG áp cho dòng mới — giá chỉ từ Phase).
//  (d) trùng dòng (Brand × Channel × Nhóm đã có trong lưới năm đang
//      xem) -> chặn, không tạo, mở sẵn chi tiết dòng đang có.
//  (e) validate: thiếu Brand / thiếu Channel / thiếu Nhóm -> chặn,
//      không tạo gì, có toast lỗi.
//  (f) bộ lọc toàn cục: thêm dòng cho Brand/Segment khác bộ lọc hiện
//      tại -> bộ lọc chuyển theo để dòng mới hiện ngay; dòng mới tuân
//      thủ matchesBrandSegment như mọi dòng khác.
// Neo demo TRƯỚC khi thêm không đổi: Lumus 776 content / tổng ngân sách
// năm 1.598.700.000đ (sau đợt Paid Objective; trước đợt đó là 1.515.500.000đ).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
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

function makeHarness(rows, phases, benchmarks, brands, uiOverrides) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const saves = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningYear: 2027, planningChannel: null, planningChannelGroup: null, planningAddOpen: true, planningAddBrand: null, ...(uiOverrides || {}) };
  const state = { toasts: [], updates: [], creates: [], renders: 0 };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : coll === 'brands' ? (brands || []) : []),
    get: (coll, id) => (coll === 'brands' ? (brands || []).find((b) => String(b.id) === String(id)) || null : null),
  };
  const findIn = (coll, id) => (coll === 'plan_rows' ? rows : coll === 'benchmarks' ? benchmarks : []).find((r) => r.id === id);
  const sUpdate = (coll, id, patch) => {
    const item = findIn(coll, id);
    if (!item) return { ok: false, error: 'Không tìm thấy bản ghi.' };
    Object.assign(item, patch);
    state.updates.push({ coll, id, patch });
    return { ok: true, item };
  };
  const sCreate = (coll, obj) => {
    const arr = coll === 'plan_rows' ? rows : coll === 'benchmarks' ? benchmarks : null;
    if (!arr) return { ok: false, error: 'Collection lạ: ' + coll };
    const item = { id: coll + '-new-' + (arr.length + 1), ...obj };
    arr.push(item);
    state.creates.push({ coll, item });
    return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'tbl', 'vizFunnelHtml',
    helpers + '\n' + saves +
    '\nreturn { UI: UI, filteredPlanRows: filteredPlanRows, matchesBrandSegment: matchesBrandSegment, planMonthRows: planMonthRows, planMonthQty: planMonthQty, planMonthBudget: planMonthBudget, planRowEffectiveBudget: planRowEffectiveBudget, planningExistingChannels: planningExistingChannels, planningBrandGridChannels: planningBrandGridChannels, planningBrandGroups: planningBrandGroups, planningPhaseIdForNewRow: planningPhaseIdForNewRow, savePlanningMonthQty: savePlanningMonthQty, savePhaseUnitPrice: savePhaseUnitPrice, savePlanningAddRow: savePlanningAddRow };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true,
    (m) => state.toasts.push(m),
    () => { state.renders++; },
    sUpdate, sCreate, saveResult,
    (s) => String(s === null || s === undefined ? '' : s),
    (n) => String(n),
    () => '', () => '');
  return { h, state, UI };
}

const BRANDS = [
  { id: 'brand-lumus-ai', name: 'Lumus AI' },
  { id: 'brand-sava-meta', name: 'SAVA META' },
];
const PHASES = [
  { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
  { id: 'phase-lumus-2', brand_id: 'brand-lumus-ai', name: 'Test & Validate', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5 },
  { id: 'phase-sava-play', brand_id: 'brand-sava-meta', name: 'PLAY THE UNKNOWN', start_month: '2026-10', end_month: '2026-11', uplift_percent_per_month: 1 },
];
const BENCHMARKS = () => ([
  { id: 'bench-kol-nano', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Nano', unit_price: 1500000, output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 },
  { id: 'bench-kol-micro', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Micro', unit_price: 5500000, output_per_unit: 15000, view_to_visit: 0.004, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 },
  { id: 'bench-search-ads', brand_id: 'brand-lumus-ai', segment: null, channel: 'Search Ads', unit_price: 4000000, output_per_unit: null, view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null },
]);
function baseRows() {
  return [
    { id: 'r-kol-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-kol-feb', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-02', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 6, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-ads-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 1000000, phase_id: 'phase-lumus-1' },
  ];
}

// ---------- [static] ----------
test('PAR [static]: view Theo tháng có nút Thêm dòng + form đủ field; đổi Brand trong form nạp lại Channel/Nhóm; submit/toggle/change nối đúng handler', () => {
  const v = section('function planningAddRowHtml(year)', 'function viewPlanning()');
  assert.match(v, /data-action="planning-add-row-toggle"/);
  assert.match(v, />\+ Thêm dòng</);
  assert.match(v, /id="planning-add-row-form" data-year="' \+ esc\(year\) \+ '"/);
  for (const name of ['brandId', 'channelExisting', 'channelNew', 'groupExisting', 'groupNew', 'segment']) {
    assert.ok(v.includes('name="' + name + '"'), 'form thiếu field name=' + name);
  }
  assert.ok(!v.includes('name="unitPrice"'), 'ô Đơn giá ban đầu đã gỡ (chốt 18/11 — giá Benchmark bỏ hẳn, ô này nhập vào không còn tác dụng)');
  assert.ok(!src.includes('unitPriceRaw'), 'submit handler không còn truyền unitPriceRaw');
  assert.match(v, /data-action-change="planning-add-brand"/);
  assert.match(v, /planningBrandGridChannels\(selBrand, year\)/);
  assert.match(v, /planningBrandGroups\(selBrand\)/);
  const view = section('function viewPlanning()', '// ---------- Planning Theo phase');
  assert.match(view, /if \(mode === 'month'\) html \+= planningAddRowHtml\(year\);/);
  assert.match(src, /if \(action === 'planning-add-row-toggle'\) \{ UI\.planningAddOpen = !UI\.planningAddOpen; render\(\); \}/);
  assert.match(src, /if \(ctxKind === 'planning-add-brand'\) \{ UI\.planningAddBrand = t\.value \|\| null; render\(\); return; \}/);
  assert.match(src, /if \(f\.id === 'planning-add-row-form'\) \{\s+savePlanningAddRow\(\{/);
  const save = section('function savePlanningAddRow(input)', '// ---------- Brand Hub ----------');
  assert.match(save, /planningMonthSaveGuard\(\)/);
  assert.match(save, /sCreate\('plan_rows', obj\)/);
  assert.match(save, /planningPhaseIdForNewRow\(brandId, month\)/);
  assert.ok(!save.includes("sCreate('benchmarks'"), 'thêm dòng KHÔNG còn tạo Benchmark (chốt 18/11)');
  assert.ok(!save.includes('unit_price'), 'thêm dòng KHÔNG ghi giá lên dòng plan — giá đặt sau ở Theo phase');
});

// ---------- [unit] helper ----------
test('PAR [unit]: helper danh sách — Channel hiện có (gồm kênh chỉ có Benchmark), Channel đã có trong lưới theo Brand/năm, Nhóm theo Brand, gắn phase theo Brand + tháng', () => {
  const rows = baseRows();
  const benchmarks = BENCHMARKS();
  const { h } = makeHarness(rows, PHASES, benchmarks, BRANDS);
  assert.deepEqual(h.planningExistingChannels(), ['KOL Nano', 'Meta Ads', 'KOL Micro', 'Search Ads']);
  assert.deepEqual(h.planningBrandGridChannels('brand-lumus-ai', 2027), ['KOL Nano', 'Meta Ads']);
  assert.deepEqual(h.planningBrandGridChannels('brand-sava-meta', 2027), []);
  assert.deepEqual(h.planningBrandGroups('brand-lumus-ai'), ['KOL', 'Paid Media']);
  assert.equal(h.planningPhaseIdForNewRow('brand-lumus-ai', '2027-01'), 'phase-lumus-1');
  assert.equal(h.planningPhaseIdForNewRow('brand-lumus-ai', '2027-04'), 'phase-lumus-2');
  assert.equal(h.planningPhaseIdForNewRow('brand-lumus-ai', '2027-09'), null, 'tháng không thuộc phase nào của Brand -> null, không bịa');
  assert.equal(h.planningPhaseIdForNewRow('brand-sava-meta', '2027-01'), null);
});

// ---------- (a) thêm kênh mới ----------
test('PAR (a): thêm kênh mới hoàn toàn "Google Ads" — tạo dòng qty = 0 tháng 1/2027 gắn phase, hiện trong lưới, chi tiết mở sẵn, sửa được Số lượng ở tháng chưa có dòng và đặt được giá Phase cho kênh mới', () => {
  const rows = baseRows();
  const benchmarks = BENCHMARKS();
  const { h, state, UI } = makeHarness(rows, PHASES, benchmarks, BRANDS);
  h.savePlanningAddRow({ brandId: 'brand-lumus-ai', channelExisting: '', channelNew: 'Google Ads', groupExisting: '', groupNew: 'Paid Media', segment: 'b2c', year: 2027 });
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].coll, 'plan_rows');
  const created = state.creates[0].item;
  assert.equal(created.channel, 'Google Ads');
  assert.equal(created.group, 'Paid Media');
  assert.equal(created.month, '2027-01');
  assert.equal(created.qty, 0);
  assert.equal(created.budget, null);
  assert.equal(created.brand_id, 'brand-lumus-ai');
  assert.equal(created.segment, 'b2c');
  assert.equal(created.phase_id, 'phase-lumus-1', 'tháng 1/2027 thuộc phase Preparation của Lumus');
  // Hiện trong lưới: helper gom lưới + tập đã lọc đều thấy kênh mới.
  assert.ok(h.planningBrandGridChannels('brand-lumus-ai', 2027).includes('Google Ads'));
  assert.ok(h.filteredPlanRows().some((r) => r.channel === 'Google Ads'));
  assert.equal(h.planMonthQty(rows, 'Google Ads', 'Paid Media', '2027-01'), 0);
  // Form đóng, bảng chi tiết của dòng mới mở sẵn.
  assert.equal(UI.planningAddOpen, false);
  assert.equal(UI.planningChannel, 'Google Ads');
  assert.equal(UI.planningChannelGroup, 'Paid Media');
  // Sửa ngay ở tháng CHƯA có dòng plan (2027-03): cơ chế tạo dòng khi sửa áp được.
  h.savePlanningMonthQty('Google Ads', 'Paid Media', '2027-03', '7');
  const mar = rows.find((r) => r.channel === 'Google Ads' && r.month === '2027-03');
  assert.ok(mar, 'phải tạo được dòng tháng 3 cho kênh mới');
  assert.equal(mar.qty, 7);
  assert.equal(mar.phase_id, 'phase-lumus-2', 'tháng 3/2027 thuộc phase Test & Validate');
  // Đặt giá cho kênh mới qua Theo phase (đường quản giá DUY NHẤT):
  // giá áp cho mọi dòng Số lượng của kênh trong Phase 1 (tháng 1 + 2).
  h.savePlanningMonthQty('Google Ads', 'Paid Media', '2027-02', '3');
  h.savePhaseUnitPrice('phase-lumus-1', 'Google Ads', '1200000');
  const jan = rows.find((r) => r.channel === 'Google Ads' && r.month === '2027-01');
  const feb = rows.find((r) => r.channel === 'Google Ads' && r.month === '2027-02');
  assert.equal(jan.unit_price, 1200000);
  assert.equal(feb.unit_price, 1200000);
  assert.equal(h.planMonthBudget(rows, 'Google Ads', 'Paid Media', '2027-02', benchmarks), 3600000);
});

// ---------- (b) thêm dòng không kèm giá / không tạo Benchmark ----------
test('PAR (b): thêm dòng KHÔNG tạo Benchmark, dòng KHÔNG mang giá — ngân sách = 0 cho tới khi đặt giá Phase; Forecast = null không lỗi', () => {
  const rows = baseRows();
  const benchmarks = BENCHMARKS();
  const { h, state } = makeHarness(rows, PHASES, benchmarks, BRANDS);
  h.savePlanningAddRow({ brandId: 'brand-lumus-ai', channelExisting: '', channelNew: 'Google Ads', groupExisting: 'Paid Media', groupNew: '', segment: '', year: 2027 });
  assert.equal(state.creates.length, 1, 'chỉ tạo đúng 1 dòng plan_rows');
  assert.equal(state.creates[0].coll, 'plan_rows');
  assert.equal(benchmarks.length, 3, 'Benchmark không đổi — không tạo mới');
  const row = rows.find((r) => r.channel === 'Google Ads');
  assert.ok(row.unit_price === undefined || row.unit_price === null, 'dòng mới không mang giá');
  // Chưa đặt giá Phase: đặt Số lượng tháng 1 = 2 -> ngân sách vẫn 0.
  h.savePlanningMonthQty('Google Ads', 'Paid Media', '2027-01', '2');
  assert.equal(h.planMonthBudget(rows, 'Google Ads', 'Paid Media', '2027-01', benchmarks), 0);
  assert.equal(domain.planBudget([row], benchmarks).total, 0);
  // Đặt giá Phase 3.000.000 -> ngân sách chạy theo giá Phase: 2 x 3.000.000.
  h.savePhaseUnitPrice('phase-lumus-1', 'Google Ads', '3000000');
  assert.equal(h.planMonthBudget(rows, 'Google Ads', 'Paid Media', '2027-01', benchmarks), 6000000);
  assert.equal(domain.planBudget([row], benchmarks).total, 6000000);
  // Forecast chưa tính được (không Benchmark tỉ lệ/output) -> null, không throw.
  const f = domain.forecastFunnel([row], benchmarks);
  assert.equal(f.rows[0].forecast, null);
  assert.ok(state.toasts.some((m) => /Đã thêm dòng Google Ads/.test(m) && /quản ở Theo phase/.test(m)), 'toast phải hướng dẫn đặt giá ở Theo phase: ' + state.toasts.join(' | '));
});

// ---------- (c) Channel đã có Benchmark: Benchmark không bị đụng, giá của nó không áp ----------
test('PAR (c): Channel đã có Benchmark (KOL Micro, unit_price 5.500.000) -> thêm dòng chỉ tạo plan_rows, Benchmark nguyên vẹn và giá Benchmark KHÔNG áp cho dòng mới', () => {
  const rows = baseRows();
  const benchmarks = BENCHMARKS();
  const { h, state } = makeHarness(rows, PHASES, benchmarks, BRANDS);
  h.savePlanningAddRow({ brandId: 'brand-lumus-ai', channelExisting: 'KOL Micro', channelNew: '', groupExisting: 'KOL', groupNew: '', segment: 'b2c', year: 2027 });
  const created = rows.find((r) => r.channel === 'KOL Micro');
  assert.ok(created, 'dòng plan vẫn được tạo');
  assert.equal(state.creates.filter((c) => c.coll === 'benchmarks').length, 0, 'không tạo/ghi Benchmark nào');
  assert.equal(benchmarks.find((b) => b.channel === 'KOL Micro').unit_price, 5500000, 'Benchmark giữ nguyên như dữ liệu cũ');
  assert.ok(created.unit_price === undefined || created.unit_price === null, 'dòng mới không mang giá');
  h.savePlanningMonthQty('KOL Micro', 'KOL', '2027-01', '2');
  assert.equal(h.planMonthBudget(rows, 'KOL Micro', 'KOL', '2027-01', benchmarks), 0, 'giá Benchmark 5.500.000 KHÔNG áp — chưa đặt giá Phase thì ngân sách = 0 (chốt 18/11)');
});

// ---------- (d) trùng dòng ----------
test('PAR (d): thêm trùng Brand × Channel × Nhóm đã có trong lưới -> chặn, không tạo dòng/Benchmark, mở sẵn chi tiết dòng đang có', () => {
  const rows = baseRows();
  const benchmarks = BENCHMARKS();
  const { h, state, UI } = makeHarness(rows, PHASES, benchmarks, BRANDS);
  h.savePlanningAddRow({ brandId: 'brand-lumus-ai', channelExisting: 'KOL Nano', channelNew: '', groupExisting: 'KOL', groupNew: '', segment: 'b2c', year: 2027 });
  assert.equal(state.creates.length, 0);
  assert.equal(rows.length, 3);
  assert.equal(UI.planningChannel, 'KOL Nano');
  assert.ok(state.toasts.some((m) => /đã có trong lưới/.test(m)));
});

// ---------- (e) validate ----------
test('PAR (e): validate — thiếu Brand / thiếu Channel / thiếu Nhóm -> chặn hết, không tạo gì, có toast lỗi', () => {
  const cases = [
    [{ brandId: '', channelNew: 'Google Ads', groupNew: 'Paid Media', segment: 'b2c', year: 2027 }, /Hãy chọn Brand/],
    [{ brandId: 'brand-khong-co', channelNew: 'Google Ads', groupNew: 'Paid Media', segment: 'b2c', year: 2027 }, /Hãy chọn Brand/],
    [{ brandId: 'brand-lumus-ai', channelExisting: '', channelNew: '  ', groupNew: 'Paid Media', segment: 'b2c', year: 2027 }, /Hãy chọn Channel/],
    [{ brandId: 'brand-lumus-ai', channelNew: 'Google Ads', groupExisting: '', groupNew: '', segment: 'b2c', year: 2027 }, /Hãy chọn Nhóm/],
  ];
  for (const [input, re] of cases) {
    const rows = baseRows();
    const benchmarks = BENCHMARKS();
    const { h, state } = makeHarness(rows, PHASES, benchmarks, BRANDS);
    h.savePlanningAddRow(input);
    assert.equal(state.creates.length, 0, 'input ' + JSON.stringify(input) + ' không được tạo gì');
    assert.equal(rows.length, 3);
    assert.equal(benchmarks.length, 3);
    assert.ok(state.toasts.some((m) => re.test(m)), 'input ' + JSON.stringify(input) + ' phải báo lỗi ' + re + ' — nhận: ' + state.toasts.join(' | '));
  }
});

// ---------- (f) bộ lọc toàn cục ----------
test('PAR (f): thêm dòng cho Brand/Segment khác bộ lọc hiện tại -> bộ lọc chuyển theo để dòng hiện ngay; kênh chỉ có Benchmark (Search Ads) chọn từ danh sách có sẵn được', () => {
  const rows = baseRows();
  const benchmarks = BENCHMARKS();
  const { h, UI } = makeHarness(rows, PHASES, benchmarks, BRANDS, { brandFilter: 'brand-lumus-ai', segmentFilter: 'b2c' });
  h.savePlanningAddRow({ brandId: 'brand-sava-meta', channelExisting: 'Search Ads', channelNew: '', groupExisting: '', groupNew: 'Paid Media', segment: 'b2b', year: 2027 });
  const created = rows.find((r) => r.channel === 'Search Ads');
  assert.ok(created);
  assert.equal(created.brand_id, 'brand-sava-meta');
  assert.equal(created.segment, 'b2b');
  assert.equal(created.phase_id, undefined, 'SAVA không có phase nào phủ tháng 1/2027 -> không gắn phase, không bịa (phaseRowsFor cũng không suy được)');
  assert.equal(UI.brandFilter, 'brand-sava-meta', 'bộ lọc Brand chuyển theo Brand vừa thêm');
  assert.equal(UI.segmentFilter, 'b2b', 'bộ lọc Segment chuyển theo Segment vừa thêm');
  assert.ok(h.filteredPlanRows().some((r) => r.channel === 'Search Ads'), 'dòng mới phải qua được bộ lọc sau khi chuyển');
  assert.ok(h.matchesBrandSegment(created));
});

// ---------- neo ----------
test('PAR [neo]: số neo demo TRƯỚC khi thêm dòng — Lumus 776 content / tổng ngân sách năm 1.598.700.000đ (SỬA PHẠM VI đợt Paid Objective: +83.200.000đ từ 2 kênh Paid B2B mới trong Draft Plan mà seed cũ bỏ sót; tổng B2C vẫn 1.515.500.000đ)', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776);
  assert.equal(domain.planBudget(lumus, demo.benchmarks).total, 1598700000);
  assert.ok(!demo.plan_rows.some((r) => r.channel === 'Google Ads'), 'dữ liệu nguồn chưa có kênh Google Ads — tính năng thêm dòng là thao tác người dùng, không sửa dữ liệu nguồn');
});
