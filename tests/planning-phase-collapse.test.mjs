// tests/planning-phase-collapse.test.mjs
// Đợt "Thu gọn khối Phase trong Planning" (yêu cầu Zac 18/11/2026):
// mỗi khối Phase ở Planning Theo phase có thanh header MỎNG luôn
// hiển thị (chevron ▸/▾ + tên Phase + khoảng tháng + tóm tắt
// Forecast Paid / Ngân sách lấy từ ĐÚNG các tổng engine
// funnelTotalsFor / planBudgetFor mà thân khối đang dùng), thân
// khối (Uplift / Uplift Views / tài chính / lưới Channel / funnel)
// ẩn khi thu gọn. Bấm chevron hoặc tên Phase để thu/mở; ô nhập nằm
// NGOÀI nút thu/mở (data-action-change riêng) nên bấm vào ô nhập
// không đổi trạng thái. Trạng thái NHỚ BỀN qua localStorage (khoá
// sava-mkt-planning-phase-collapsed-v1, chỉ lưu phase đang thu
// gọn; mặc định MỞ) + 2 nút "Thu gọn tất cả" / "Mở tất cả" ở đầu
// view Theo phase áp cho mọi Phase đang hiển thị.
// Mẫu thu gọn bám 3 bảng KPI chi tiết theo tháng sẵn có
// (planningKpiSectionHtml / planningKpiToggleMap: linklike + ▸/▾ +
// map {key: true}); khác ở chỗ trạng thái Phase lưu bền như mẫu
// kéo rộng cột (js/col-resize.js) thay vì chỉ trong phiên.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const domain = require('../js/domain.js');

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
const escStub = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNumStub = (n) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN');
const fmtMoneyStub = (n, c) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('vi-VN') + ' ' + (c || '');

// localStorage giả lập (Map) — gắn vào global window/localStorage
// trong lúc harness chạy, đúng đường planningPhaseStorageGet/Set
// đang đọc (window.localStorage trước, localStorage sau).
function makeFakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}
function withStorage(storage, fn) {
  const prevWindow = globalThis.window;
  const prevLs = globalThis.localStorage;
  globalThis.window = { localStorage: storage };
  globalThis.localStorage = storage;
  try { return fn(); } finally {
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
    if (prevLs === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLs;
  }
}

const BENCH = [{ id: 'bench-kol', brand_id: 'b1', channel: 'KOL Nano', unit_price: 1500000, output_per_unit: 4000, view_to_visit: 0.003, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, direct_budget: false }];
const PHASES = [
  { id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0 },
  { id: 'ph-2', brand_id: 'b1', name: 'Phase 2', start_month: '2027-02', end_month: '2027-02', uplift_percent_per_month: 0 },
];
function baseRows() {
  return [
    { id: 'r-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', qty: 4, budget: null, phase_id: 'ph-1' },
    { id: 'r-feb', brand_id: 'b1', segment: 'b2c', month: '2027-02', channel: 'KOL Nano', group: 'KOL', qty: 6, budget: null, phase_id: 'ph-2' },
  ];
}
// Số engine của fixture: Phase 1 Paid = 4 x 4000 x 0,003 x 0,09 x
// 0,0275 = 0,1188 -> hiển thị số nguyên "0"; ngân sách Phase 1 =
// 4 x 1.500.000 = 6.000.000đ; Phase 2 ngân sách = 9.000.000đ.

function makeHarness(rows, phases, benchmarks, assumptions) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {}, planningPhaseCollapsed: {}, planningPhaseCollapsedLoaded: false };
  const state = { toasts: [], updates: [], renders: 0 };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : coll === 'phase_assumptions' ? (assumptions || []) : []),
    get: () => null,
  };
  const sUpdate = () => ({ ok: true });
  const sCreate = () => ({ ok: true });
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { UI: UI, planningPhaseBlockHtml: planningPhaseBlockHtml, planningPhaseModeHtml: planningPhaseModeHtml, planningPhaseToggleMap: planningPhaseToggleMap, planningPhaseSetAllMap: planningPhaseSetAllMap, planningPhaseParseCollapsed: planningPhaseParseCollapsed, planningPhaseSerializeCollapsed: planningPhaseSerializeCollapsed, planningPhaseIsCollapsed: planningPhaseIsCollapsed, planningPhaseEnsureLoaded: planningPhaseEnsureLoaded, planningPhaseSaveCollapsed: planningPhaseSaveCollapsed, funnelTotalsFor: funnelTotalsFor, planBudgetFor: planBudgetFor, STORAGE_KEY: PLANNING_PHASE_COLLAPSED_STORAGE_KEY };');
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
// Mô phỏng đúng việc handler click làm khi bấm nút thu/mở 1 Phase:
// ensureLoaded -> toggle map -> save bền -> (render lại ở test).
function clickToggle(hz, phaseId) {
  hz.h.planningPhaseEnsureLoaded();
  hz.h.planningPhaseSaveCollapsed(hz.h.planningPhaseToggleMap(hz.UI.planningPhaseCollapsed, phaseId));
}
// Tách HTML của 1 khối Phase trong output của planningPhaseModeHtml.
function phaseSegment(modeHtml, phaseId, nextPhaseId) {
  const start = modeHtml.indexOf('data-planning-phase="' + phaseId + '"');
  assert.notEqual(start, -1, 'không thấy khối Phase ' + phaseId);
  if (!nextPhaseId) return modeHtml.slice(start);
  const end = modeHtml.indexOf('data-planning-phase="' + nextPhaseId + '"', start);
  assert.notEqual(end, -1, 'không thấy khối Phase kế ' + nextPhaseId);
  return modeHtml.slice(start, end);
}

// ---------- [static] wiring ----------
test('PPC [static]: header thu gọn bám mẫu KPI (linklike + chevron ▸/▾ + aria-expanded) + handler 3 action + khoá localStorage + toolbar 2 nút + CSS', () => {
  const block = section('function planningPhaseBlockHtml(phase, rows, benchmarks, editable, disAttr)', '// --- 3 bảng KPI chi tiết theo tháng (chế độ Theo tháng) ---');
  assert.match(block, /data-planning-phase-header="1"/);
  assert.match(block, /class="linklike planning-phase-toggle" data-action="planning-phase-toggle" data-id="' \+ esc\(phase\.id\)/);
  assert.match(block, /data-planning-phase-chevron="1">' \+ \(collapsed \? '▸' : '▾'\)/);
  assert.match(block, /aria-expanded="' \+ \(collapsed \? 'false' : 'true'\)/);
  assert.match(block, /data-planning-phase-summary="1"/);
  assert.match(block, /data-planning-phase-body="1"/);
  assert.match(block, /if \(collapsed\) \{ html \+= '<\/div>'; return html; \}/, 'thu gọn thì không render thân khối (như planningKpiSectionHtml)');
  // Tóm tắt header lấy từ đúng tổng engine của thân khối.
  assert.match(block, /var pTotals = funnelTotalsFor\(pRows, benchmarks\);/);
  assert.match(block, /planBudgetFor\(pRows, benchmarks\)/);
  assert.match(block, /Forecast Paid: ' \+ esc\(summaryPaid\)/);
  assert.match(block, /Ngân sách: ' \+ esc\(summaryBudget\)/);
  // Lưu bền: khoá riêng + helper parse/serialize/save + ensureLoaded.
  assert.match(src, /var PLANNING_PHASE_COLLAPSED_STORAGE_KEY = 'sava-mkt-planning-phase-collapsed-v1';/);
  assert.match(src, /planningPhaseCollapsed: \{\},\s*\n\s*planningPhaseCollapsedLoaded: false,/);
  // Handler click: toggle 1 Phase / thu gọn tất cả / mở tất cả — đều lưu bền rồi render.
  assert.match(src, /if \(action === 'planning-phase-toggle'\) \{ planningPhaseEnsureLoaded\(\); planningPhaseSaveCollapsed\(planningPhaseToggleMap\(UI\.planningPhaseCollapsed, id\)\); render\(\); \}/);
  assert.match(src, /action === 'planning-phase-collapse-all' \|\| action === 'planning-phase-expand-all'/);
  assert.match(src, /planningPhaseSetAllMap\(UI\.planningPhaseCollapsed, phaseIdsAll, action === 'planning-phase-collapse-all'\)/);
  // Toolbar ở view Theo phase mang danh sách phase id đang hiển thị.
  const mode = section('function planningPhaseModeHtml(year, rows, benchmarks)', 'function planningPhaseBlockHtml');
  assert.match(mode, /data-planning-phase-toolbar="1"/);
  assert.match(mode, /data-action="planning-phase-collapse-all" data-phase-ids="' \+ esc\(visiblePhaseIds\) \+ '">Thu gọn tất cả</);
  assert.match(mode, /data-action="planning-phase-expand-all" data-phase-ids="' \+ esc\(visiblePhaseIds\) \+ '">Mở tất cả</);
  assert.match(mode, /planningPhaseEnsureLoaded\(\);/);
  assert.ok(css.includes('.planning-phase-header'), 'CSS thiếu .planning-phase-header');
  assert.ok(css.includes('.planning-phase-toolbar'), 'CSS thiếu .planning-phase-toolbar');
});

// ---------- [unit] helper thuần ----------
test('PPC [unit]: helper thuần — parse/serialize chỉ giữ phase thu gọn; toggle lật 1 phase không đột biến map gốc; setAll chỉ đụng phase trong danh sách', () => {
  const storage = makeFakeStorage();
  withStorage(storage, () => {
    const { h } = makeHarness(baseRows(), PHASES, BENCH, []);
    assert.equal(h.STORAGE_KEY, 'sava-mkt-planning-phase-collapsed-v1');
    assert.deepEqual(h.planningPhaseParseCollapsed(null), {});
    assert.deepEqual(h.planningPhaseParseCollapsed(''), {});
    assert.deepEqual(h.planningPhaseParseCollapsed('{hỏng'), {}, 'JSON hỏng -> map rỗng, không crash');
    assert.deepEqual(h.planningPhaseParseCollapsed('{"ph-1":true,"ph-2":false,"ph-3":1}'), { 'ph-1': true }, 'chỉ giữ giá trị true đúng nghĩa');
    assert.deepEqual(h.planningPhaseParseCollapsed('[1,2]'), {}, 'mảng không phải map');
    assert.equal(h.planningPhaseSerializeCollapsed({ 'ph-1': true, 'ph-2': false }), '{"ph-1":true}');
    assert.equal(h.planningPhaseSerializeCollapsed({}), '{}');
    const orig = {};
    const t1 = h.planningPhaseToggleMap(orig, 'ph-1');
    assert.deepEqual(t1, { 'ph-1': true });
    assert.deepEqual(orig, {}, 'toggle không đột biến map gốc');
    assert.deepEqual(h.planningPhaseToggleMap(t1, 'ph-1'), {}, 'toggle lần 2 mở lại (bỏ key)');
    assert.deepEqual(h.planningPhaseToggleMap(t1, 'ph-2'), { 'ph-1': true, 'ph-2': true }, 'toggle phase khác giữ nguyên phase đang thu gọn');
    assert.equal(h.planningPhaseIsCollapsed(t1, 'ph-1'), true);
    assert.equal(h.planningPhaseIsCollapsed(t1, 'ph-2'), false);
    assert.deepEqual(h.planningPhaseSetAllMap({}, ['ph-1', 'ph-2'], true), { 'ph-1': true, 'ph-2': true });
    assert.deepEqual(h.planningPhaseSetAllMap({ 'ph-1': true, 'ph-2': true, 'ph-khac': true }, ['ph-1', 'ph-2'], false), { 'ph-khac': true }, 'mở tất cả chỉ mở các phase trong danh sách, phase ngoài phạm vi giữ nguyên');
  });
});

// ---------- [unit] render mặc định mở ----------
test('PPC [unit]: render mặc định MỞ — có chevron ▾ + aria-expanded=true + thân khối đủ ô nhập + header tóm tắt đúng số engine (Forecast Paid / Ngân sách / khoảng tháng)', () => {
  const storage = makeFakeStorage();
  withStorage(storage, () => {
    const rows = baseRows();
    const { h } = makeHarness(rows, PHASES, BENCH, []);
    const html = h.planningPhaseBlockHtml(PHASES[0], rows, BENCH, true, '');
    assert.ok(html.includes('data-planning-phase="ph-1"'), 'khối Phase có data-planning-phase');
    assert.ok(html.includes('data-planning-phase-collapsed="false"'), 'mặc định không thu gọn');
    assert.ok(html.includes('data-planning-phase-header="1"'), 'có thanh header');
    assert.ok(html.includes('<span data-planning-phase-chevron="1">▾</span> Phase: Phase 1'), 'chevron mở là ▾ kèm tên Phase trong nút thu/mở');
    assert.ok(html.includes('aria-expanded="true"'));
    assert.ok(html.includes('data-planning-phase-body="1"'), 'đang mở thì có thân khối');
    assert.ok(html.includes('data-action-change="phase-uplift"'), 'thân khối còn ô Uplift');
    assert.ok(html.includes('data-action-change="phase-views-uplift"'), 'thân khối còn ô Uplift Views');
    assert.ok(html.includes('data-planning-phase-operating="1"'), 'thân khối còn khối tài chính theo Phase');
    assert.ok(html.includes('data-viz="planning-phase-funnel"'), 'thân khối còn funnel của Phase');
    // Tóm tắt header: khoảng tháng + Forecast Paid + Ngân sách từ engine.
    const sumStart = html.indexOf('data-planning-phase-summary="1"');
    const summary = html.slice(sumStart, html.indexOf('</p>', sumStart));
    assert.ok(summary.includes('Tháng 1/2027'), 'tóm tắt có khoảng tháng của Phase: ' + summary);
    assert.ok(summary.includes('Forecast Paid: 0'), 'Forecast Paid = fmtPlanningCount(0,1188) = "0": ' + summary);
    assert.ok(summary.includes('Ngân sách: 6.000.000 VND'), 'Ngân sách = planBudgetFor(pRows) = 6.000.000đ: ' + summary);
    // View Theo phase: toolbar 2 nút + cả 2 khối đều mở.
    const mode = h.planningPhaseModeHtml(2027, rows, BENCH);
    assert.ok(mode.includes('data-planning-phase-toolbar="1"'), 'view Theo phase có toolbar');
    assert.ok(mode.includes('>Thu gọn tất cả</button>'), 'có nút Thu gọn tất cả');
    assert.ok(mode.includes('>Mở tất cả</button>'), 'có nút Mở tất cả');
    assert.ok(mode.includes('data-phase-ids="ph-1,ph-2"'), 'toolbar mang đúng danh sách phase đang hiển thị');
    assert.equal(mode.split('data-planning-phase-body="1"').length - 1, 2, 'mặc định cả 2 Phase đều mở (2 thân khối)');
  });
});

// ---------- [unit] thu gọn 1 phase ----------
test('PPC [unit]: thu gọn 1 Phase -> thân của Phase đó ẩn hẳn (header + tóm tắt vẫn còn), Phase khác vẫn mở; bấm lại thì mở ra đủ ô nhập như cũ', () => {
  const storage = makeFakeStorage();
  withStorage(storage, () => {
    const rows = baseRows();
    const hz = makeHarness(rows, PHASES, BENCH, []);
    clickToggle(hz, 'ph-1');
    assert.deepEqual(hz.UI.planningPhaseCollapsed, { 'ph-1': true });
    const mode = hz.h.planningPhaseModeHtml(2027, rows, BENCH);
    const seg1 = phaseSegment(mode, 'ph-1', 'ph-2');
    assert.ok(seg1.includes('data-planning-phase-collapsed="true"'), 'Phase 1 đánh dấu đã thu gọn');
    assert.ok(seg1.includes('<span data-planning-phase-chevron="1">▸</span>'), 'chevron thu gọn là ▸');
    assert.ok(seg1.includes('aria-expanded="false"'));
    assert.ok(seg1.includes('data-planning-phase-summary="1"'), 'header tóm tắt vẫn hiển thị khi thu gọn');
    assert.ok(seg1.includes('Ngân sách: 6.000.000 VND'), 'tóm tắt vẫn đúng số khi thu gọn');
    assert.ok(!seg1.includes('data-planning-phase-body="1"'), 'thân Phase 1 không render khi thu gọn');
    assert.ok(!seg1.includes('data-action-change="phase-uplift"'), 'ô nhập của Phase 1 không còn trong DOM khi thu gọn');
    const seg2 = phaseSegment(mode, 'ph-2', null);
    assert.ok(seg2.includes('data-planning-phase-collapsed="false"'), 'Phase 2 không bị ảnh hưởng');
    assert.ok(seg2.includes('data-planning-phase-body="1"'), 'Phase 2 vẫn mở');
    assert.ok(seg2.includes('data-action-change="phase-uplift"'), 'ô nhập Phase 2 vẫn còn');
    // Bấm lại nút của Phase 1 -> mở ra, ô nhập trở lại nguyên vẹn.
    clickToggle(hz, 'ph-1');
    const reopened = hz.h.planningPhaseBlockHtml(PHASES[0], rows, BENCH, true, '');
    assert.ok(reopened.includes('data-planning-phase-body="1"'));
    assert.ok(reopened.includes('data-action-change="phase-uplift"'));
    assert.ok(reopened.includes('data-action-change="phase-qty"'), 'lưới Channel + ô Số lượng trở lại như cũ');
  });
});

// ---------- [unit] nhớ bền qua localStorage ----------
test('PPC [unit]: trạng thái thu gọn được LƯU vào localStorage theo phase id và render lại ở phiên mới (UI mới tinh) vẫn thu gọn; mở lại thì bản lưu cũng mở', () => {
  const storage = makeFakeStorage();
  withStorage(storage, () => {
    const rows = baseRows();
    const hz1 = makeHarness(rows, PHASES, BENCH, []);
    clickToggle(hz1, 'ph-2');
    assert.equal(storage.getItem('sava-mkt-planning-phase-collapsed-v1'), '{"ph-2":true}', 'bản lưu chỉ gồm phase đang thu gọn, khoá theo phase id');
    // Phiên mới: harness mới với UI mới tinh (chưa có trạng thái nào).
    const hz2 = makeHarness(rows, PHASES, BENCH, []);
    assert.deepEqual(hz2.UI.planningPhaseCollapsed, {}, 'UI mới chưa mang trạng thái trong phiên');
    const html = hz2.h.planningPhaseBlockHtml(PHASES[1], rows, BENCH, true, '');
    assert.ok(html.includes('data-planning-phase-collapsed="true"'), 'render ở phiên mới đọc localStorage -> vẫn thu gọn');
    assert.ok(!html.includes('data-planning-phase-body="1"'), 'thân vẫn ẩn ở phiên mới');
    const htmlOther = hz2.h.planningPhaseBlockHtml(PHASES[0], rows, BENCH, true, '');
    assert.ok(htmlOther.includes('data-planning-phase-collapsed="false"'), 'Phase không có trong bản lưu vẫn mở ở phiên mới');
    // Mở lại ở phiên mới -> bản lưu cập nhật (không còn ph-2).
    clickToggle(hz2, 'ph-2');
    assert.equal(storage.getItem('sava-mkt-planning-phase-collapsed-v1'), '{}');
    const hz3 = makeHarness(rows, PHASES, BENCH, []);
    assert.ok(hz3.h.planningPhaseBlockHtml(PHASES[1], rows, BENCH, true, '').includes('data-planning-phase-collapsed="false"'), 'phiên sau nữa thấy Phase đã mở');
  });
});

// ---------- [unit] thu gọn / mở tất cả ----------
test('PPC [unit]: Thu gọn tất cả / Mở tất cả (đúng đường handler dùng: setAllMap trên data-phase-ids của toolbar + save bền) đổi trạng thái MỌI Phase đang hiển thị và được nhớ bền', () => {
  const storage = makeFakeStorage();
  withStorage(storage, () => {
    const rows = baseRows();
    const hz = makeHarness(rows, PHASES, BENCH, []);
    const mode0 = hz.h.planningPhaseModeHtml(2027, rows, BENCH);
    const idsAttr = /data-action="planning-phase-collapse-all" data-phase-ids="([^"]*)"/.exec(mode0);
    assert.ok(idsAttr, 'nút Thu gọn tất cả phải mang data-phase-ids');
    const ids = idsAttr[1].split(',').filter(Boolean);
    assert.deepEqual(ids, ['ph-1', 'ph-2']);
    // Thu gọn tất cả.
    hz.h.planningPhaseEnsureLoaded();
    hz.h.planningPhaseSaveCollapsed(hz.h.planningPhaseSetAllMap(hz.UI.planningPhaseCollapsed, ids, true));
    let mode = hz.h.planningPhaseModeHtml(2027, rows, BENCH);
    assert.equal(mode.split('data-planning-phase-body="1"').length - 1, 0, 'thu gọn tất cả -> không Phase nào còn thân');
    assert.equal(mode.split('data-planning-phase-collapsed="true"').length - 1, 2, 'cả 2 Phase đều thu gọn');
    assert.equal(storage.getItem('sava-mkt-planning-phase-collapsed-v1'), '{"ph-1":true,"ph-2":true}', 'trạng thái sau Thu gọn tất cả được lưu bền');
    // Mở tất cả.
    hz.h.planningPhaseSaveCollapsed(hz.h.planningPhaseSetAllMap(hz.UI.planningPhaseCollapsed, ids, false));
    mode = hz.h.planningPhaseModeHtml(2027, rows, BENCH);
    assert.equal(mode.split('data-planning-phase-body="1"').length - 1, 2, 'mở tất cả -> cả 2 Phase đều mở lại');
    assert.equal(storage.getItem('sava-mkt-planning-phase-collapsed-v1'), '{}', 'trạng thái sau Mở tất cả được lưu bền');
  });
});

// ---------- [unit] bấm ô nhập không thu/mở ----------
test('PPC [unit]: cấu trúc chống bấm nhầm — nút thu/mở là phần tử data-action DUY NHẤT của khối và KHÔNG chứa ô nhập nào; mọi ô nhập nằm trong thân khối, dùng data-action-change (không khớp bộ uỷ quyền click [data-action])', () => {
  const storage = makeFakeStorage();
  withStorage(storage, () => {
    const rows = baseRows();
    const { h } = makeHarness(rows, PHASES, BENCH, []);
    const html = h.planningPhaseBlockHtml(PHASES[0], rows, BENCH, true, '');
    // Đúng 1 phần tử data-action="planning-phase-toggle" trong khối.
    assert.equal(html.split('data-action="planning-phase-toggle"').length - 1, 1, 'chỉ nút ở header mang action thu/mở');
    // Nội dung của nút thu/mở: chỉ chevron + tên Phase, không input/button con.
    const btnStart = html.lastIndexOf('<button', html.indexOf('data-action="planning-phase-toggle"'));
    const btnEnd = html.indexOf('</button>', btnStart);
    const btnHtml = html.slice(btnStart, btnEnd);
    assert.ok(!btnHtml.includes('<input'), 'nút thu/mở không được bao trùm ô nhập: ' + btnHtml);
    assert.ok(!btnHtml.includes('data-action-change'), 'nút thu/mở không chứa handler change của ô nhập');
    // Mọi ô nhập đều nằm SAU thẻ mở của thân khối (ngoài header/nút).
    const bodyStart = html.indexOf('data-planning-phase-body="1"');
    assert.ok(bodyStart > btnEnd, 'thân khối nằm ngoài và sau nút thu/mở');
    const firstInput = html.indexOf('<input');
    assert.ok(firstInput > bodyStart, 'ô nhập đầu tiên nằm trong thân khối, không nằm trong header');
    for (const m of html.matchAll(/<input[^>]*>/g)) {
      assert.ok(!m[0].includes('data-action="'), 'ô nhập không mang data-action (click vào ô không khớp uỷ quyền thu/mở): ' + m[0]);
      assert.ok(m[0].includes('data-action-change="phase-'), 'ô nhập giữ nguyên handler change-lưu-số như cũ: ' + m[0]);
    }
    // Handler click thật trong source: nhánh thu/mở chỉ chạy cho
    // đúng 3 action của cơ chế này, không dính tới change của ô nhập.
    assert.match(src, /if \(action === 'planning-phase-toggle'\)/);
    assert.doesNotMatch(section('function planningPhaseBlockHtml(phase, rows, benchmarks, editable, disAttr)', '// --- 3 bảng KPI chi tiết theo tháng (chế độ Theo tháng) ---'), /data-action="(?!planning-phase-toggle)/, 'trong khối Phase không có data-action nào khác ngoài nút thu/mở');
  });
});
