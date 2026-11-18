// tests/planning-detail-price-readonly.test.mjs
// Render THẬT bảng chi tiết dòng (viewPlanning, chế độ Theo tháng) —
// khoá 2 chốt của Zac ngày 18/11:
//  (17:24) Bỏ nhập Đơn giá ở bảng chi tiết dòng: cột Đơn giá là HIỂN
//       THỊ CHỈ ĐỌC (span data-planning-price-value + nhãn nguồn),
//       KHÔNG còn input planning-month-unit-price nào trong HTML;
//       ô Số lượng vẫn sửa được; Paid Media GIỮ NGUYÊN ô nhập Ngân
//       sách trực tiếp theo Objective.
//  (17:28) Bỏ hẳn giá Benchmark: dòng có giá Phase -> hiện đúng giá
//       Phase + nhãn "giá Phase"; dòng CHƯA có giá Phase -> hiện "—"
//       + nhãn "chưa đặt giá" DÙ Benchmark của Channel có unit_price.
//  Differential: render không mutate dòng plan; tổng ngân sách fixture
//  demo (đã chuyển giá sang giá Phase trên dòng) = 1.238.700.000đ.

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
const escStub = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNumStub = (n) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN');
const fmtMoneyStub = (n, c) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN') + ' ' + (c || '');

function makeHarness(rows, phases, benchmarks, brands, uiOverrides) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const planning = section('// ---------- Planning (Brand + Planning, bản bấm thử) ----------', '// ---------- Brand Hub ----------');
  const UI = {
    brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all',
    planningYear: 2027, planningMode: 'month', planningChannel: null, planningChannelGroup: null,
    planningAddOpen: false, planningAddBrand: null, planningKpiCollapsed: {},
    ...(uiOverrides || {}),
  };
  const state = { toasts: [], updates: [], creates: [], renders: 0 };
  const Store = {
    mode: 'supabase',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : coll === 'brands' ? (brands || []) : coll === 'phase_assumptions' ? [] : []),
    get: (coll, id) => (coll === 'brands' ? (brands || []).find((b) => String(b.id) === String(id)) || null : null),
  };
  const sUpdate = () => ({ ok: true });
  const sCreate = () => ({ ok: true });
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'can', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'pageHead', 'vizBarRowHtml', 'vizFunnelHtml', 'vizMonthLabel', 'noteDetailHtml', 'noteWithDetailHtml', 'readonlyNote', 'contextBannerHtml',
    helpers + '\n' + planning +
    '\nreturn { UI: UI, viewPlanning: viewPlanning };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true, () => true,
    (m) => state.toasts.push(m),
    () => { state.renders++; },
    sUpdate, sCreate, saveResult,
    escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<div class="table-wrap"><table data-table-key="' + key + '">' + inner + '</table></div>',
    (title, sub) => '<h1>' + escStub(title) + '</h1><p class="sub">' + escStub(sub || '') + '</p>',
    () => '',
    () => '<div data-viz-stub="funnel"></div>',
    (m) => 'Tháng ' + Number(String(m).slice(5, 7)) + '/' + String(m).slice(0, 4),
    (text) => '<div class="note">' + escStub(text) + '</div>',
    (text) => '<div class="note">' + escStub(text) + '</div>',
    () => '',
    () => '');
  return { h, state, UI };
}

const BRANDS = [{ id: 'brand-lumus-ai', name: 'Lumus AI' }];
const PHASES = [
  { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
];
// Benchmark CỐ TÌNH mang unit_price cho cả 2 kênh — sau chốt 18/11 giá
// này không được đọc: KOL Nano có giá Phase trên dòng thì hiện giá
// Phase; KOL Micro không có giá Phase thì hiện "chưa đặt giá".
const BENCHMARKS = [
  { id: 'bench-nano', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Nano', unit_price: 1500000, output_per_unit: 4000, view_to_visit: 0.003, visit_to_freemium: 0.09, freemium_to_paid: 0.0275 },
  { id: 'bench-micro', brand_id: 'brand-lumus-ai', segment: null, channel: 'KOL Micro', unit_price: 5500000, output_per_unit: 15000, view_to_visit: 0.004, visit_to_freemium: 0.09, freemium_to_paid: 0.0275 },
  { id: 'bench-meta', brand_id: 'brand-lumus-ai', segment: 'b2c', channel: 'Meta Ads', unit_price: null, direct_budget: true, cost_per_result: { awareness: null, traffic: 20000, signup: 20000 / 0.09, remarketing: null } },
];
function baseRows() {
  return [
    { id: 'r-nano-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1', unit_price: 400000 },
    { id: 'r-micro-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'KOL Micro', group: 'KOL', unit: 'assets', qty: 4, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-meta-traffic', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 5460000, phase_id: 'phase-lumus-1', objective: 'traffic' },
    { id: 'r-meta-signup', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 3276000, phase_id: 'phase-lumus-1', objective: 'signup' },
  ];
}
function detailOf(html) {
  const a = html.indexOf('data-planning-detail');
  assert.notEqual(a, -1, 'phải render được bảng chi tiết');
  return html.slice(Math.max(0, a - 2000));
}

test('PDPR [render]: chi tiết KOL Nano (có giá Phase 400.000) — Đơn giá CHỈ ĐỌC hiện đúng giá Phase + nhãn "giá Phase", KHÔNG còn input planning-month-unit-price; ô Số lượng vẫn sửa được', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS, BRANDS, { planningChannel: 'KOL Nano', planningChannelGroup: 'KOL' });
  const html = h.viewPlanning();
  assert.ok(!html.includes('planning-month-unit-price'), 'toàn trang không còn ô sửa Đơn giá tại dòng');
  const detail = detailOf(html);
  assert.ok(detail.includes('<span data-planning-price-value="1">400.000 VND</span>'), 'ô giá hiện đúng giá Phase 400.000đ: ' + detail.slice(0, 400));
  assert.ok(detail.includes('data-planning-price-phase="1">giá Phase'), 'nhãn nguồn phải là "giá Phase"');
  assert.ok(!detail.includes('data-planning-price-benchmark'), 'không còn nhãn Benchmark');
  assert.ok(detail.includes('data-action-change="planning-month-qty"'), 'ô Số lượng vẫn là input sửa được');
  assert.ok(detail.includes('<span data-planning-budget-value="1">1.600.000 VND</span>'), 'Ngân sách tháng = 4 × 400.000 tự tính, chỉ hiển thị');
});

test('PDPR [render]: chi tiết KOL Micro (Benchmark có giá 5.500.000 nhưng CHƯA đặt giá Phase) — Đơn giá hiện "—" + nhãn "chưa đặt giá", Ngân sách = 0', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS, BRANDS, { planningChannel: 'KOL Micro', planningChannelGroup: 'KOL' });
  const html = h.viewPlanning();
  const detail = detailOf(html);
  assert.ok(detail.includes('<span data-planning-price-value="1">—</span>'), 'chưa đặt giá Phase thì đơn giá trống');
  assert.ok(detail.includes('data-planning-price-none="1">chưa đặt giá'), 'nhãn "chưa đặt giá"');
  assert.ok(!detail.includes('5.500.000'), 'giá Benchmark 5.500.000 KHÔNG được hiện ở đâu trong chi tiết');
  assert.ok(detail.includes('<span data-planning-budget-value="1">0 VND</span>'), 'ngân sách phần chưa đặt giá = 0');
});

test('PDPR [render]: chi tiết Meta Ads (Paid Media) — ô nhập Ngân sách trực tiếp theo Objective còn nguyên vẹn', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES, BENCHMARKS, BRANDS, { planningChannel: 'Meta Ads', planningChannelGroup: 'Paid Media' });
  const html = h.viewPlanning();
  assert.ok(html.includes('data-action-change="planning-month-paid-objective-budget"'), 'ô nhập Ngân sách theo Objective của Paid Media phải còn nguyên (chốt 18/11: paid media không bỏ)');
  assert.ok(!html.includes('planning-month-unit-price'), 'Paid Media cũng không có ô Đơn giá tại dòng');
});

test('PDPR [differential]: render KHÔNG mutate dòng plan; tổng ngân sách fixture demo (giá đã chuyển sang giá Phase trên dòng) = baseline 1.238.700.000đ', () => {
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const phases = JSON.parse(JSON.stringify(demo.phases.filter((p) => p.brand_id)));
  const benchmarks = JSON.parse(JSON.stringify(demo.benchmarks));
  const snapshot = JSON.stringify(rows);
  const { h } = makeHarness(rows, phases, benchmarks, BRANDS, { planningChannel: 'KOL Nano', planningChannelGroup: 'KOL' });
  const html = h.viewPlanning();
  assert.ok(html.includes('data-planning-price-value="1">1.500.000 VND'), 'KOL Nano demo hiện giá Phase 1.500.000đ từ dòng');
  assert.equal(JSON.stringify(rows), snapshot, 'render không được sửa dữ liệu dòng');
  const total = domain.planBudget(rows, benchmarks);
  assert.equal(total.total, 1238700000, 'tổng ngân sách fixture = baseline tính lại 18/11');
  assert.equal(total.totalDirect, 811200000);
  assert.equal(total.totalUnitPrice, 427500000);
  assert.equal(total.totalManualUnitPrice, 427500000, 'phần qty × đơn giá nay toàn bộ là giá Phase');
});
