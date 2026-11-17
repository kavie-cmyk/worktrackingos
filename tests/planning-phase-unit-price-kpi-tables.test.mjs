// tests/planning-phase-unit-price-kpi-tables.test.mjs
// Đợt: (1) Phase — nhập đầu vào dạng ĐƠN GIÁ MỖI BÀI; (2) Planning
// Theo tháng — 3 bảng KPI chi tiết theo tháng (Views / Paid Users /
// CAC) có thu gọn.
// Khóa:
//  Phần 1: ô "Đơn giá mỗi bài (VNĐ)" trong khối phase × channel cùng
//    mẫu sự kiện change + guard demo/chỉ-xem như các ô phase khác;
//    nhập giá ghi field unit_price (đặt tay) cho MỌI dòng plan có Số
//    lượng của channel thuộc các tháng trong phase (MỘT nguồn sự
//    thật, không trường giá riêng cho phase); xoá trắng bỏ đặt tay về
//    Benchmark; ca lẫn lộn (các tháng giá đặt tay khác nhau) hiển thị
//    trung thực: ô trống + ghi chú "khác nhau theo tháng", nhập giá
//    mới áp đồng nhất cả phase; validate số nguyên >= 0.
//  Phần 2: 3 bảng render từ planningKpiData — SỐ LIỆU TỪ CHÍNH engine
//    forecastFunnel (kèm ctx phase/uplift) + công thức ngân sách
//    planRowEffectiveBudget/domain.planBudget, không fork công thức.
//    Ca neo Lumus 2027 T1: KOL Nano Views = 16.000; Paid Users =
//    0,1188 (hiển thị làm tròn tối đa 4 chữ số thập phân); CAC =
//    6.000.000 ÷ 0,1188 = 50.505.050,505… -> làm tròn TỚI ĐỒNG
//    (Math.round) = 50.505.051đ. Hàng "Tất cả" T1: ngân sách
//    72.560.000đ ÷ paid 2,119635 = 34.232.309đ (làm tròn tới đồng).
//    Cột Tổng CAC = tổng ngân sách ÷ tổng paid (không phải trung
//    bình CAC tháng) — khóa bằng ca uplift phân biệt được.
//    Thu gọn: planningKpiToggleMap thuần + UI.planningKpiCollapsed
//    giữ trong phiên; mặc định cả 3 bảng MỞ.
//    Paid Media: Views "—" nhưng có mặt ở Paid Users và CAC.
//    SỬA PHẠM VI đợt Paid Objective: Paid T1 tính theo Objective —
//    Meta T1 paid = 1,08108 (Traffic 0,675675 + Signup 0,405405),
//    TikTok T1 paid = 0,20475; blended T1 paid = 2,308005 và CAC
//    blended T1 = 72.560.000 ÷ 2,308005 = 31.438.407đ (làm tròn đồng).
//    Trước đợt Objective: blended paid 2,119635 / CAC 34.232.309đ.
//    Sửa Số lượng / Đơn giá / Ngân sách Paid -> bảng cập nhật ngay
//    (render lại từ cùng state/engine, không cache).

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
const escStub = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNumStub = (n) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN');
const fmtMoneyStub = (n, c) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN') + ' ' + (c || '');

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
    const item = { id: 'plan-new-' + (rows.length + 1), ...obj };
    rows.push(item);
    state.creates.push({ coll, item });
    return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { UI: UI, phaseChannelUnitPriceInfo: phaseChannelUnitPriceInfo, planningKpiData: planningKpiData, fmtPlanningPaid: fmtPlanningPaid, fmtPlanningCac: fmtPlanningCac, planningKpiToggleMap: planningKpiToggleMap, planningKpiTablesHtml: planningKpiTablesHtml, planningPhaseBlockHtml: planningPhaseBlockHtml, savePhaseUnitPrice: savePhaseUnitPrice, savePlanningMonthQty: savePlanningMonthQty, savePlanningMonthUnitPrice: savePlanningMonthUnitPrice, savePlanningMonthPaidBudget: savePlanningMonthPaidBudget, planBudgetFor: planBudgetFor, planRowManualUnitPrice: planRowManualUnitPrice };');
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

// ---------- fixtures Phần 1 ----------
const PHASES1 = [
  { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
  { id: 'phase-lumus-2', brand_id: 'brand-lumus-ai', name: 'Test & Validate', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5 },
];
const BENCH1 = [
  { id: 'bench-kol-nano', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Nano', unit_price: 1500000 },
];
function baseRows1() {
  return [
    { id: 'r-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-feb', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-02', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 6, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-mar', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-03', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 7, budget: null, phase_id: 'phase-lumus-2' },
    { id: 'r-ads-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 10920000, phase_id: 'phase-lumus-1' },
  ];
}
const MONTHS_2027 = Array.from({ length: 12 }, (_, i) => '2027-' + String(i + 1).padStart(2, '0'));
function demoHarness() {
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const phases = JSON.parse(JSON.stringify(demo.phases.filter((p) => p.brand_id)));
  const benchmarks = JSON.parse(JSON.stringify(demo.benchmarks));
  const assumptions = JSON.parse(JSON.stringify(demo.phase_assumptions));
  return makeHarness(rows, phases, benchmarks, assumptions);
}
function kpiCell(html, kind, channel, month) {
  const re = new RegExp('<td data-planning-kpi-cell="' + kind + '" data-channel="' + channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" data-month="' + month + '">([^<]*)</td>');
  const m = re.exec(html);
  return m ? m[1] : null;
}
function kpiTotal(html, kind, channel) {
  const re = new RegExp('<td data-planning-kpi-total="' + kind + '" data-channel="' + channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"><strong>([^<]*)</strong></td>');
  const m = re.exec(html);
  return m ? m[1] : null;
}

// ---------- [static] Phần 1 ----------
test('PPUP-KPI [static]: khối Phase có cột Đơn giá mỗi bài + ô phase-unit-price + nhãn đặt tay tại phase/Benchmark/mixed + hint; handler change + savePhaseUnitPrice qua guard/parse/sUpdate unit_price', () => {
  const block = section('function planningPhaseBlockHtml(phase, rows, benchmarks, editable, disAttr)', '// --- Lưu các ô nhập Theo phase');
  assert.match(block, /<th>Đơn giá mỗi bài \(VNĐ\)<\/th>/);
  assert.match(block, /data-action-change="phase-unit-price" data-phase-id="' \+ esc\(phase\.id\)/);
  assert.match(block, /phaseChannelUnitPriceInfo\(chRows, benchmarks\)/);
  assert.match(block, /data-phase-price-manual="1">đặt tay tại phase</);
  assert.match(block, /data-phase-price-benchmark="1">Benchmark</);
  assert.match(block, /data-phase-price-mixed="1">khác nhau theo tháng/);
  assert.match(block, /data-planning-phase-price-hint="1"/);
  assert.match(src, /if \(ctxKind === 'phase-unit-price'\) \{ savePhaseUnitPrice\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-channel'\), t\.value\); return; \}/);
  const save = section('function savePhaseUnitPrice(phaseId, channel, raw)', '// --- Lưu ô Số lượng trong BẢNG CHI TIẾT Theo tháng');
  assert.match(save, /phaseSaveGuard\(\)/);
  assert.match(save, /var v = parsePlanUnitPrice\(raw\);/);
  assert.match(save, /sUpdate\('plan_rows', job\.id, \{ unit_price: job\.unit_price \}\)/);
  assert.match(save, /unit_price: null/);
  assert.match(save, /phaseRowsFor\(phase, filteredPlanRows\(\)\)/);
  assert.ok(css.includes('.phase-unit-price-input'), 'CSS thiếu .phase-unit-price-input');
});

// ---------- [unit] Phần 1: info ----------
test('PPUP-KPI [unit]: phaseChannelUnitPriceInfo — Benchmark / đặt tay đồng nhất / lẫn lộn / không dòng số lượng', () => {
  const rows = baseRows1();
  const { h } = makeHarness(rows, PHASES1, BENCH1);
  const chRows = rows.filter((r) => r.channel === 'KOL Nano' && r.phase_id === 'phase-lumus-1');
  assert.deepEqual(h.phaseChannelUnitPriceInfo(chRows, BENCH1), { value: 1500000, source: 'benchmark' });
  rows[0].unit_price = 2000000; rows[1].unit_price = 2000000;
  assert.deepEqual(h.phaseChannelUnitPriceInfo(chRows, BENCH1), { value: 2000000, source: 'manual' });
  rows[1].unit_price = 3000000;
  assert.deepEqual(h.phaseChannelUnitPriceInfo(chRows, BENCH1), { value: null, source: 'mixed' }, 'giá đặt tay khác nhau theo tháng -> value null + mixed');
  const paidRows = rows.filter((r) => r.channel === 'Meta Ads');
  assert.deepEqual(h.phaseChannelUnitPriceInfo(paidRows, BENCH1), { value: null, source: null }, 'Paid Media không dòng số lượng');
});

// ---------- [unit] Phần 1: lưu / xoá / lẫn lộn / validate / guard ----------
test('PPUP-KPI [unit]: ghi giá tại Phase -> unit_price cho mọi dòng số lượng trong Phase (không đụng Phase khác / Paid); ngân sách tính lại qua planBudget', () => {
  const rows = baseRows1();
  const { h, state } = makeHarness(rows, PHASES1, BENCH1);
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '2000000');
  assert.equal(rows[0].unit_price, 2000000);
  assert.equal(rows[1].unit_price, 2000000);
  assert.equal(rows[2].unit_price, undefined, 'dòng Phase 2 không được đụng');
  assert.equal(rows[3].unit_price, undefined, 'dòng Paid qty null không được đặt đơn giá');
  assert.equal(state.updates.length, 2);
  // Ngân sách 2 dòng trong Phase qua domain.planBudget: (4+6) x 2.000.000.
  assert.equal(domain.planBudget([rows[0], rows[1]], BENCH1).total, 20000000);
  assert.ok(state.toasts.some((t) => t.includes('Đơn giá mỗi bài')), 'toast phải nói rõ đã lưu đơn giá mỗi bài');
});

test('PPUP-KPI [unit]: xoá trắng ô Phase -> bỏ đặt tay cả Phase, về Benchmark', () => {
  const rows = baseRows1();
  rows[0].unit_price = 2000000; rows[1].unit_price = 2500000;
  const { h } = makeHarness(rows, PHASES1, BENCH1);
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '');
  assert.equal(rows[0].unit_price, null);
  assert.equal(rows[1].unit_price, null);
  assert.equal(domain.planBudget([rows[0], rows[1]], BENCH1).total, 15000000, '(4+6) x 1.500.000 Benchmark');
  // Xoá trắng khi đang Benchmark là no-op.
  const rows2 = baseRows1();
  const hz = makeHarness(rows2, PHASES1, BENCH1);
  hz.h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '');
  assert.equal(hz.state.updates.length, 0);
});

test('PPUP-KPI [unit]: ca lẫn lộn render trung thực (ô trống + "khác nhau theo tháng"); nhập giá mới áp đồng nhất cả Phase', () => {
  const rows = baseRows1();
  rows[0].unit_price = 2000000; rows[1].unit_price = 3000000;
  const { h } = makeHarness(rows, PHASES1, BENCH1);
  const html = h.planningPhaseBlockHtml(PHASES1[0], rows, BENCH1, true, '');
  assert.ok(html.includes('khác nhau theo tháng'), 'phải hiện ghi chú khác nhau theo tháng');
  const i = html.indexOf('data-action-change="phase-unit-price"');
  assert.notEqual(i, -1);
  const tag = html.slice(html.lastIndexOf('<input', i), html.indexOf('>', i));
  assert.ok(tag.includes('value=""'), 'ô phase khi lẫn lộn phải để trống, không bịa số đại diện: ' + tag);
  h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '2500000');
  assert.equal(rows[0].unit_price, 2500000);
  assert.equal(rows[1].unit_price, 2500000);
  const chRows = rows.filter((r) => r.channel === 'KOL Nano' && r.phase_id === 'phase-lumus-1');
  assert.deepEqual(h.phaseChannelUnitPriceInfo(chRows, BENCH1), { value: 2500000, source: 'manual' });
});

test('PPUP-KPI [unit]: validate đơn giá Phase — âm/chữ/thập phân bị chặn, dữ liệu không đổi; guard dữ liệu thật chặn lưu', () => {
  for (const bad of ['-100', 'abc', '1.5']) {
    const rows = baseRows1();
    const { h, state } = makeHarness(rows, PHASES1, BENCH1);
    h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', bad);
    assert.equal(state.updates.length, 0, 'không được lưu khi nhập ' + bad);
    assert.equal(rows[0].unit_price, undefined);
    assert.ok(state.toasts.some((t) => t.includes('số nguyên từ 0 trở lên')), 'toast lỗi validate cho ' + bad);
  }
  const rows = baseRows1();
  const hz = makeHarness(rows, PHASES1, BENCH1);
  hz.Store.mode = 'real';
  hz.h.savePhaseUnitPrice('phase-lumus-1', 'KOL Nano', '2000000');
  assert.equal(hz.state.updates.length, 0, 'chế độ dữ liệu thật không được lưu');
  assert.equal(rows[0].unit_price, undefined);
});

// ---------- [static] Phần 2 ----------
test('PPUP-KPI [static]: viewPlanning gắn 3 bảng KPI sau lưới/chi tiết, trước chart ngân sách; builder có 3 section + toggle + hàng Tất cả + ghi chú Paid/CAC; UI state + handler thu gọn', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const idxKpi = v.indexOf('planningKpiTablesHtml(rows, benchmarks, months)');
  const idxBudget = v.indexOf('// Chart ngân sách dự kiến theo tháng');
  assert.ok(idxKpi !== -1 && idxBudget !== -1 && idxKpi < idxBudget, 'bảng KPI phải nằm dưới lưới, trước chart ngân sách');
  const b = section('function planningKpiSectionHtml(key, title, note, tableHtml)', '// --- Lưu các ô nhập Theo phase');
  assert.match(b, /data-planning-kpi-section/);
  assert.match(b, /planningKpiSectionHtml\('views'/);
  assert.match(b, /planningKpiSectionHtml\('paid'/);
  assert.match(b, /planningKpiSectionHtml\('cac'/);
  assert.match(b, /không có Views/);
  assert.match(b, /data-channel="Tất cả"/);
  assert.match(b, /KHÔNG phải trung bình các CAC tháng/);
  assert.match(src, /planningKpiCollapsed: \{\}/);
  assert.match(src, /if \(action === 'planning-kpi-toggle'\) \{ UI\.planningKpiCollapsed = planningKpiToggleMap\(UI\.planningKpiCollapsed, id\); render\(\); \}/);
  assert.ok(css.includes('.planning-kpi-section'), 'CSS thiếu .planning-kpi-section');
});

// ---------- [unit] Phần 2: dữ liệu neo ----------
test('PPUP-KPI [unit]: planningKpiData ca neo Lumus — KOL Nano T1 views 16.000 / paid 0,1188 / ngân sách 6.000.000 / CAC = 6.000.000÷0,1188; blended T1 72.560.000 ÷ 2,308005 (paid theo Objective)', () => {
  const { h } = demoHarness();
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const data = h.planningKpiData(rows, demo.benchmarks, MONTHS_2027);
  const nano = data.channels.find((c) => c.channel === 'KOL Nano');
  const jan = nano.months['2027-01'];
  approx(jan.views, 16000, 'views KOL Nano T1');
  approx(jan.paid, 0.1188, 'paid KOL Nano T1');
  assert.equal(jan.budget, 6000000);
  approx(jan.cac, 6000000 / 0.1188, 'CAC KOL Nano T1 (chưa làm tròn)');
  assert.equal(h.fmtPlanningCac(jan.cac), '50.505.051 VND', 'CAC làm tròn TỚI ĐỒNG: 50.505.050,505… -> 50.505.051');
  assert.equal(h.fmtPlanningPaid(jan.paid), '0,1188');
  const bl = data.blended.months['2027-01'];
  assert.equal(bl.budget, 72560000, 'tổng ngân sách T1 mọi channel');
  approx(bl.paid, 2.308005, 'tổng paid T1 từ engine (SỬA PHẠM VI Paid Objective: KOL 1,022175 + Meta 1,08108 + TikTok 0,20475)');
  approx(bl.cac, 72560000 / 2.308005, 'CAC blended T1');
  assert.equal(h.fmtPlanningCac(bl.cac), '31.438.407 VND');
  const meta = data.channels.find((c) => c.channel === 'Meta Ads');
  assert.equal(meta.isPaidMedia, true);
  approx(meta.months['2027-01'].paid, 1.08108, 'paid Meta Ads T1 theo Objective (Traffic 0,675675 + Signup 0,405405)');
});

// ---------- [unit] Phần 2: render neo + Paid Media ----------
test('PPUP-KPI [unit]: render 3 bảng — ca neo KOL Nano T1 ở cả 3 bảng; Paid Media Views "—" nhưng có Paid Users + CAC; hàng Tất cả ở CAC', () => {
  const { h } = demoHarness();
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const html = h.planningKpiTablesHtml(rows, demo.benchmarks, MONTHS_2027);
  assert.equal(kpiCell(html, 'views', 'KOL Nano', '2027-01'), '16.000');
  assert.equal(kpiCell(html, 'paid', 'KOL Nano', '2027-01'), '0,1188');
  assert.equal(kpiCell(html, 'cac', 'KOL Nano', '2027-01'), '50.505.051 VND');
  assert.equal(kpiCell(html, 'views', 'Meta Ads', '2027-01'), '—', 'Paid Media không có Views');
  assert.equal(kpiCell(html, 'paid', 'Meta Ads', '2027-01'), '1,0811', 'Paid Media có Paid Users theo Objective (làm tròn 4 số thập phân)');
  assert.notEqual(kpiCell(html, 'cac', 'Meta Ads', '2027-01'), '—', 'Paid Media có CAC');
  assert.notEqual(kpiCell(html, 'cac', 'Meta Ads', '2027-01'), null);
  assert.equal(kpiCell(html, 'cac', 'Tất cả', '2027-01'), '31.438.407 VND', 'hàng Tất cả T1 = 72.560.000 ÷ 2,308005 (paid theo Objective) làm tròn tới đồng');
  assert.ok(html.includes('data-planning-kpi-row="cac" data-channel="Tất cả"'));
  // Channel không benchmark (Facebook Owned): forecast không tính được -> "—" ở Views/Paid, không bịa 0.
  assert.equal(kpiCell(html, 'views', 'Facebook Owned', '2027-01'), '—');
  assert.equal(kpiCell(html, 'paid', 'Facebook Owned', '2027-01'), '—');
});

// ---------- [unit] Phần 2: cột Tổng CAC không phải trung bình tháng ----------
test('PPUP-KPI [unit]: CAC cột Tổng = tổng ngân sách ÷ tổng paid, KHÁC trung bình CAC các tháng (ca uplift phân biệt được)', () => {
  const benchmarks = [{ brand_id: 'b1', channel: 'X', unit_price: 1000, output_per_unit: 1000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false }];
  const phases = [{ id: 'ph-test', brand_id: 'b1', name: 'T', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 10 }];
  const rows = [
    { id: 'r-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'X', group: 'G', qty: 1, budget: null, phase_id: 'ph-test' },
    { id: 'r-mar', brand_id: 'b1', segment: 'b2c', month: '2027-03', channel: 'X', group: 'G', qty: 10, budget: null, phase_id: 'ph-test' },
  ];
  const { h } = makeHarness(rows, phases, benchmarks, []);
  const data = h.planningKpiData(rows, benchmarks, ['2027-01', '2027-02', '2027-03']);
  const ch = data.channels[0];
  approx(ch.months['2027-01'].cac, 10000, 'CAC T1 = 1.000 ÷ 0,1');
  approx(ch.months['2027-03'].cac, 4665.07380209733, 'CAC T3 (uplift n=2)');
  approx(ch.totals.cac, 4902.859183006886, 'CAC Tổng = 11.000 ÷ (0,1 + 2,14358881)');
  const mean = (ch.months['2027-01'].cac + ch.months['2027-03'].cac) / 2;
  assert.ok(Math.abs(ch.totals.cac - mean) > 2000, 'CAC Tổng phải khác rõ trung bình CAC tháng (' + mean + ')');
});

// ---------- [unit] Phần 2: thu gọn ----------
test('PPUP-KPI [unit]: thu gọn — toggle map thuần; bảng thu gọn không render thân bảng nhưng giữ trạng thái trong phiên, mở lại hiện đủ', () => {
  const { h, UI } = demoHarness();
  assert.deepEqual(h.planningKpiToggleMap({}, 'paid'), { paid: true });
  assert.deepEqual(h.planningKpiToggleMap({ paid: true }, 'paid'), { paid: false });
  assert.deepEqual(h.planningKpiToggleMap({ paid: true }, 'cac'), { paid: true, cac: true });
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  // Mặc định: cả 3 bảng mở.
  let html = h.planningKpiTablesHtml(rows, demo.benchmarks, MONTHS_2027);
  assert.ok(html.includes('data-planning-kpi-row="paid"'), 'mặc định bảng Paid Users mở');
  assert.ok(html.includes('aria-expanded="true"'));
  // Thu gọn Paid Users qua đúng cơ chế handler dùng.
  UI.planningKpiCollapsed = h.planningKpiToggleMap(UI.planningKpiCollapsed, 'paid');
  html = h.planningKpiTablesHtml(rows, demo.benchmarks, MONTHS_2027);
  assert.ok(!html.includes('data-planning-kpi-row="paid"'), 'bảng Paid Users đã thu gọn phải ẩn thân bảng');
  assert.ok(html.includes('data-planning-kpi-section="paid"'), 'tiêu đề bảng thu gọn vẫn còn để mở lại');
  assert.ok(html.includes('data-planning-kpi-row="views"'), 'bảng Views không bị ảnh hưởng');
  // Mở lại: trạng thái vẫn trong UI của phiên -> render hiện đủ.
  UI.planningKpiCollapsed = h.planningKpiToggleMap(UI.planningKpiCollapsed, 'paid');
  html = h.planningKpiTablesHtml(rows, demo.benchmarks, MONTHS_2027);
  assert.ok(html.includes('data-planning-kpi-row="paid"'), 'mở lại phải hiện thân bảng');
});

// ---------- [static] Phần 2b: hàng Tất cả ở cả 3 bảng + ghi chú ----------
test('PPUP-KPI [static]: planningKpiTablesHtml có hàng Tất cả cho Views + Paid Users (cùng mẫu blended CAC) + ghi chú mô tả hàng Tất cả ở cả 2 bảng', () => {
  const b = section('function planningKpiTablesHtml(rows, benchmarks, months)', '// --- Bảng Chỉ số vận hành');
  assert.match(b, /data-planning-kpi-row="views" data-channel="Tất cả"/);
  assert.match(b, /data-planning-kpi-row="paid" data-channel="Tất cả"/);
  assert.match(b, /data-planning-kpi-row="cac" data-channel="Tất cả"/);
  assert.match(b, /Hàng <strong>Tất cả<\/strong>: tổng Views của mọi Channel có forecast/);
  assert.match(b, /không cộng Channel Paid Media chưa có đơn giá Awareness/);
  assert.match(b, /Cột Tổng của hàng Tất cả = tổng Views cả kỳ/);
  assert.match(b, /Hàng <strong>Tất cả<\/strong>: tổng Paid Users của mọi Channel có forecast/);
  assert.match(b, /Cột Tổng của hàng Tất cả = tổng Paid Users cả kỳ/);
});

// ---------- [unit] Phần 2b: hàng Tất cả Views / Paid Users — số neo + tổng ----------
test('PPUP-KPI [unit]: hàng Tất cả tồn tại trong cả 3 bảng; T1 Views = tổng Views content (101.000, Paid "—" không cộng), T1 Paid = tổng Paid mọi Channel có forecast (2,308); cột Tổng = tổng cả kỳ (Views 1.460.000 / Paid 95,8106); CAC không đổi', () => {
  const { h } = demoHarness();
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const data = h.planningKpiData(rows, demo.benchmarks, MONTHS_2027);
  // (b) Paid T1 ở tầng dữ liệu = tổng Paid T1 (chưa làm tròn) của mọi Channel có forecast — cùng blended đã phục vụ CAC.
  let sumPaidT1 = 0;
  data.channels.forEach((ch) => { const c = ch.months['2027-01']; if (c.hasForecast) sumPaidT1 += (c.paid || 0); });
  approx(data.blended.months['2027-01'].paid, sumPaidT1, 'blended paid T1 = tổng Paid T1 mọi Channel có forecast');
  approx(data.blended.months['2027-01'].paid, 2.308005, 'blended paid T1 neo');
  // (c) Views T1 ở tầng dữ liệu = tổng Views T1 các Channel content (Paid Media chưa có đơn giá Awareness không cộng).
  let sumViewsT1 = 0;
  data.channels.forEach((ch) => {
    const c = ch.months['2027-01'];
    if (c.hasForecast && !(ch.isPaidMedia && !ch.hasAwarenessPrice)) sumViewsT1 += (c.views || 0);
  });
  approx(data.blended.months['2027-01'].views, sumViewsT1, 'blended views T1 = tổng Views T1 các Channel có Views');
  approx(data.blended.months['2027-01'].views, 101000, 'blended views T1 neo: 16.000 (KOL Nano) + 60.000 (KOL Micro) + 25.000 (KOL Expert)');
  assert.equal(data.blended.months['2027-01'].hasViews, true);
  assert.equal(data.blended.months['2027-01'].hasForecast, true);
  // (d) Cột Tổng ở tầng dữ liệu: hai cách tính (tổng theo tháng / tổng theo Channel) cho cùng một số.
  let sumViewsByMonth = 0, sumPaidByMonth = 0;
  MONTHS_2027.forEach((m) => { sumViewsByMonth += (data.blended.months[m].views || 0); sumPaidByMonth += data.blended.months[m].paid; });
  let sumViewsByChannel = 0, sumPaidByChannel = 0;
  data.channels.forEach((ch) => {
    if (ch.totals.hasForecast && !(ch.isPaidMedia && !ch.hasAwarenessPrice)) sumViewsByChannel += (ch.totals.views || 0);
    if (ch.totals.hasForecast) sumPaidByChannel += (ch.totals.paid || 0);
  });
  approx(data.blended.totals.views, sumViewsByMonth, 'blended totals views = tổng Views theo tháng');
  approx(data.blended.totals.views, sumViewsByChannel, 'blended totals views = tổng Views theo Channel');
  approx(data.blended.totals.views, 1460000, 'blended totals views neo: 260.000 + 900.000 + 300.000');
  approx(data.blended.totals.paid, sumPaidByMonth, 'blended totals paid = tổng Paid theo tháng (cùng tổng đã phục vụ blended CAC)');
  approx(data.blended.totals.paid, sumPaidByChannel, 'blended totals paid = tổng Paid theo Channel');
  approx(data.blended.totals.paid, 95.81059904256077, 'blended totals paid neo');
  // (a) + render: hàng Tất cả tồn tại trong cả 3 bảng, ô T1 + cột Tổng đúng.
  const html = h.planningKpiTablesHtml(rows, demo.benchmarks, MONTHS_2027);
  assert.ok(html.includes('data-planning-kpi-row="views" data-channel="Tất cả"'), 'bảng Views phải có hàng Tất cả');
  assert.ok(html.includes('data-planning-kpi-row="paid" data-channel="Tất cả"'), 'bảng Paid Users phải có hàng Tất cả');
  assert.ok(html.includes('data-planning-kpi-row="cac" data-channel="Tất cả"'), 'bảng CAC phải có hàng Tất cả');
  assert.equal(kpiCell(html, 'views', 'Tất cả', '2027-01'), '101.000', 'Views Tất cả T1 = 101.000');
  assert.equal(kpiCell(html, 'paid', 'Tất cả', '2027-01'), '2,308', 'Paid Tất cả T1 = fmtPlanningPaid(2,308005)');
  assert.equal(kpiCell(html, 'paid', 'Tất cả', '2027-01'), h.fmtPlanningPaid(sumPaidT1), 'Paid Tất cả T1 render = fmtPlanningPaid(tổng Paid T1 chưa làm tròn)');
  assert.equal(kpiTotal(html, 'views', 'Tất cả'), '1.460.000', 'Views Tất cả cột Tổng = tổng Views cả kỳ');
  assert.equal(kpiTotal(html, 'paid', 'Tất cả'), '95,8106', 'Paid Tất cả cột Tổng = fmtPlanningPaid(tổng Paid cả kỳ)');
  assert.equal(kpiTotal(html, 'paid', 'Tất cả'), h.fmtPlanningPaid(data.blended.totals.paid), 'Paid Tất cả cột Tổng render từ cùng blended.totals.paid');
  // (e) CAC và mọi số cũ không đổi.
  assert.equal(kpiCell(html, 'cac', 'Tất cả', '2027-01'), '31.438.407 VND', 'CAC Tất cả T1 không đổi');
  assert.equal(kpiCell(html, 'views', 'KOL Nano', '2027-01'), '16.000');
  assert.equal(kpiCell(html, 'paid', 'KOL Nano', '2027-01'), '0,1188');
  assert.equal(kpiCell(html, 'cac', 'KOL Nano', '2027-01'), '50.505.051 VND');
  assert.equal(kpiCell(html, 'views', 'Meta Ads', '2027-01'), '—', 'Paid Media vẫn không có Views');
});

// ---------- [unit] Phần 2b: hàng Tất cả — tháng không có forecast/Views thì "—" ----------
test('PPUP-KPI [unit]: hàng Tất cả — chỉ Paid Media (không Views) thì Views Tất cả = "—" nhưng Paid Tất cả có số; không dòng nào thì cả hai = "—"', () => {
  const phases = JSON.parse(JSON.stringify(demo.phases.filter((p) => p.brand_id)));
  const benchmarks = JSON.parse(JSON.stringify(demo.benchmarks));
  const assumptions = JSON.parse(JSON.stringify(demo.phase_assumptions));
  const paidOnlyRows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai' && r.channel === 'Meta Ads')));
  const hz = makeHarness(paidOnlyRows, phases, benchmarks, assumptions);
  const htmlPaid = hz.h.planningKpiTablesHtml(paidOnlyRows, benchmarks, MONTHS_2027);
  assert.equal(kpiCell(htmlPaid, 'views', 'Tất cả', '2027-01'), '—', 'chỉ Paid Media chưa có đơn giá Awareness -> Views Tất cả phải là "—", không bịa 0');
  assert.equal(kpiTotal(htmlPaid, 'views', 'Tất cả'), '—', 'Views Tất cả cột Tổng = "—" khi không Channel nào có Views cả kỳ');
  assert.equal(kpiCell(htmlPaid, 'paid', 'Tất cả', '2027-01'), '1,0811', 'Paid Tất cả T1 = Paid của Meta Ads (1,08108 làm tròn 4 số)');
  const he = makeHarness([], phases, benchmarks, assumptions);
  const htmlEmpty = he.h.planningKpiTablesHtml([], benchmarks, ['2027-01']);
  assert.equal(kpiCell(htmlEmpty, 'views', 'Tất cả', '2027-01'), '—');
  assert.equal(kpiCell(htmlEmpty, 'paid', 'Tất cả', '2027-01'), '—');
  assert.equal(kpiTotal(htmlEmpty, 'views', 'Tất cả'), '—');
  assert.equal(kpiTotal(htmlEmpty, 'paid', 'Tất cả'), '—');
});

// ---------- [unit] Phần 2: sửa ở nơi khác -> bảng cập nhật ----------
test('PPUP-KPI [unit]: sửa Số lượng / Đơn giá (Theo tháng) và Ngân sách Paid -> 3 bảng KPI cập nhật ngay khi render lại', () => {
  const cloned = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const phases = JSON.parse(JSON.stringify(demo.phases.filter((p) => p.brand_id)));
  const benchmarks = JSON.parse(JSON.stringify(demo.benchmarks));
  const assumptions = JSON.parse(JSON.stringify(demo.phase_assumptions));
  const hz = makeHarness(cloned, phases, benchmarks, assumptions);
  let html = hz.h.planningKpiTablesHtml(cloned, benchmarks, MONTHS_2027);
  assert.equal(kpiCell(html, 'views', 'KOL Nano', '2027-01'), '16.000');
  // Sửa Số lượng T1: 4 -> 8 (gấp đôi): Views/Paid gấp đôi.
  hz.h.savePlanningMonthQty('KOL Nano', 'KOL', '2027-01', '8');
  html = hz.h.planningKpiTablesHtml(cloned, benchmarks, MONTHS_2027);
  assert.equal(kpiCell(html, 'views', 'KOL Nano', '2027-01'), '32.000');
  assert.equal(kpiCell(html, 'paid', 'KOL Nano', '2027-01'), '0,2376');
  // Sửa Đơn giá T1: 1.500.000 -> 3.000.000: ngân sách 8 x 3.000.000 = 24.000.000; CAC = 24.000.000 ÷ 0,2376.
  hz.h.savePlanningMonthUnitPrice('KOL Nano', 'KOL', '2027-01', '3000000');
  html = hz.h.planningKpiTablesHtml(cloned, benchmarks, MONTHS_2027);
  assert.equal(kpiCell(html, 'cac', 'KOL Nano', '2027-01'), '101.010.101 VND');
  // Sửa Ngân sách Paid Media T1: 10.920.000 -> 21.840.000 (gấp đôi, phân
  // bổ theo tỉ lệ các Objective): Paid Meta gấp đôi 1,08108 -> 2,16216,
  // hiển thị 4 số thập phân (SỬA PHẠM VI đợt Paid Objective).
  hz.h.savePlanningMonthPaidBudget('Meta Ads', 'Paid Media', '2027-01', '21840000');
  html = hz.h.planningKpiTablesHtml(cloned, benchmarks, MONTHS_2027);
  assert.equal(kpiCell(html, 'paid', 'Meta Ads', '2027-01'), '2,1622');
});
