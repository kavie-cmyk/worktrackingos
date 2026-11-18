// tests/planning-kpi-channel-order.test.mjs
// Thứ tự Channel trong planningKpiData (nguồn của 3 bảng "KPI chi
// tiết theo tháng" Views / Paid Users / CAC + bảng B2B Accounts qua
// planningKpiTablesHtml) phải KHỚP thứ tự bảng lưới Planning:
// lưới duyệt GROUP theo thứ tự xuất hiện đầu tiên của planRowGroup
// trong rows, trong mỗi group duyệt Channel theo thứ tự xuất hiện
// đầu tiên trong group đó.
// Lỗi cũ: channelOrder lấy theo thứ tự xuất hiện đầu tiên trong
// rows THÔ — khi dòng Paid Media chen trước dòng Content, KOL Nano
// (dòng Content xuất hiện muộn trong rows thô) bị đẩy xuống cuối
// bảng KPI, lệch khỏi lưới.
// Khóa ở đây:
//  - Fixture rows cố tình xáo trộn thứ tự thô: group Content mở đầu
//    (Website Articles), Paid Media chen giữa, KOL Nano đứng CUỐI
//    mảng thô -> thứ tự mới phải đưa KOL Nano về vị trí nhóm
//    Content (thứ 2), KHÔNG ở cuối.
//  - byChannel vẫn gộp theo tên Channel (KOL Nano có 2 dòng ở 2
//    tháng khác nhau -> 1 entry duy nhất, đủ 2 dòng, ngân sách từng
//    tháng không đổi).
//  - Channel xuất hiện ở 2 group: khử trùng theo lần xuất hiện đầu
//    tiên khi phẳng hoá group->channel (1 entry duy nhất).
//  - Thứ tự RENDER của cả 3 bảng (views/paid/cac) + bảng b2b trong
//    planningKpiTablesHtml khớp cùng thứ tự; hàng "Tất cả" vẫn ở
//    cuối mỗi bảng.
//  - Số neo fixture Lumus không đổi khi chạy qua planningKpiData:
//    Paid cả kỳ 92,1879; CAC "Tất cả" T1 = 31.438.407đ.

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
  const sUpdate = () => ({ ok: false, error: 'không dùng trong test này' });
  const sCreate = () => ({ ok: false, error: 'không dùng trong test này' });
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { UI: UI, planningKpiData: planningKpiData, planningKpiTablesHtml: planningKpiTablesHtml, fmtPlanningCac: fmtPlanningCac };');
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

// ---------- fixture xáo trộn ----------
// Thứ tự THÔ (cố tình): Content mở đầu bằng Website Articles, rồi
// Paid Media chen vào (Meta Ads, TikTok Ads), Owned Social, và
// KOL Nano — vẫn thuộc group Content — đứng cuối mảng.
const PHASES = [
  { id: 'ph-ord', brand_id: 'b1', name: 'P1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0 },
];
function bench(channel, unitPrice) {
  return { brand_id: 'b1', channel, unit_price: unitPrice, output_per_unit: 1000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false };
}
const BENCH = [bench('Website Articles', 100000), bench('KOL Nano', 1500000)];
const MONTHS = ['2027-01', '2027-02'];
function shuffledRows() {
  return [
    { id: 'r-web-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Website Articles', group: 'Content', qty: 2, budget: null, phase_id: 'ph-ord', unit_price: 100000 },
    { id: 'r-meta-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', qty: null, budget: 10920000, phase_id: 'ph-ord' },
    { id: 'r-tikads-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'TikTok Ads', group: 'Paid Media', qty: null, budget: 5000000, phase_id: 'ph-ord' },
    { id: 'r-fb-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Facebook Owned', group: 'Owned Social', qty: 3, budget: null, phase_id: 'ph-ord' },
    { id: 'r-nano-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'Content', qty: 4, budget: null, phase_id: 'ph-ord', unit_price: 1500000 },
    { id: 'r-nano-feb', brand_id: 'b1', segment: 'b2c', month: '2027-02', channel: 'KOL Nano', group: 'Content', qty: 6, budget: null, phase_id: 'ph-ord', unit_price: 1500000 },
  ];
}
// Thứ tự lưới (group -> channel): group Content xuất hiện đầu tiên
// (Website Articles, KOL Nano), rồi Paid Media (Meta Ads, TikTok
// Ads), rồi Owned Social (Facebook Owned).
const GRID_ORDER = ['Website Articles', 'KOL Nano', 'Meta Ads', 'TikTok Ads', 'Facebook Owned'];
// Thứ tự THÔ cũ (để đối chứng test thật sự phân biệt được 2 cách):
const RAW_ORDER = ['Website Articles', 'Meta Ads', 'TikTok Ads', 'Facebook Owned', 'KOL Nano'];

function gridOrderOf(rows) {
  // Đúng phép duyệt của lưới trong viewPlanning: group theo thứ tự
  // xuất hiện đầu tiên, channel trong group theo thứ tự xuất hiện
  // đầu tiên trong group, phẳng hoá + khử trùng lần đầu.
  const groupOrder = [], groupMap = {};
  rows.forEach((r) => {
    const g = String((r && (r.group || r.groupName)) || 'Chưa nhóm');
    if (!groupMap[g]) { groupMap[g] = { channelOrder: [] }; groupOrder.push(g); }
    const ch = String(r.channel || '—');
    if (!groupMap[g].channelOrder.includes(ch)) groupMap[g].channelOrder.push(ch);
  });
  const out = [];
  groupOrder.forEach((g) => groupMap[g].channelOrder.forEach((ch) => { if (!out.includes(ch)) out.push(ch); }));
  return out;
}
function renderedChannelOrder(html, kind) {
  const re = new RegExp('data-planning-kpi-row="' + kind + '" data-channel="([^"]+)"', 'g');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

test('PKCO [unit]: planningKpiData — rows thô xáo trộn (Paid Media chen trước, KOL Nano cuối mảng) -> thứ tự Channel khớp phép duyệt group->channel của lưới, KOL Nano về vị trí nhóm Content', () => {
  const rows = shuffledRows();
  assert.deepEqual(gridOrderOf(rows), GRID_ORDER, 'fixture: phép duyệt lưới cho thứ tự kỳ vọng');
  assert.notDeepEqual(GRID_ORDER, RAW_ORDER, 'fixture phải phân biệt được thứ tự lưới với thứ tự thô cũ');
  const { h } = makeHarness(rows, PHASES, BENCH, []);
  const data = h.planningKpiData(rows, BENCH, MONTHS);
  assert.deepEqual(data.channels.map((c) => c.channel), GRID_ORDER,
    'thứ tự Channel phải theo group->channel như lưới; thứ tự thô cũ sẽ là: ' + RAW_ORDER.join(', '));
  assert.equal(data.channels[1].channel, 'KOL Nano', 'KOL Nano ở vị trí nhóm Content (thứ 2), không bị đẩy xuống cuối');
});

test('PKCO [unit]: byChannel vẫn gộp theo tên Channel — KOL Nano 2 dòng/2 tháng gộp 1 entry, ngân sách từng tháng và forecast không đổi', () => {
  const rows = shuffledRows();
  const { h } = makeHarness(rows, PHASES, BENCH, []);
  const data = h.planningKpiData(rows, BENCH, MONTHS);
  const nanoEntries = data.channels.filter((c) => c.channel === 'KOL Nano');
  assert.equal(nanoEntries.length, 1, 'KOL Nano chỉ có 1 entry dù có 2 dòng');
  const nano = nanoEntries[0];
  assert.equal(nano.rows.length, 2, 'entry gộp đủ 2 dòng');
  assert.equal(nano.months['2027-01'].budget, 6000000, 'ngân sách T1 = 4 x 1.500.000 (giá Phase trên dòng — chốt 18/11)');
  assert.equal(nano.months['2027-02'].budget, 9000000, 'ngân sách T2 = 6 x 1.500.000 (giá Phase trên dòng — chốt 18/11)');
  approx(nano.months['2027-01'].views, 4000, 'views T1 = 4 x output_per_unit 1000');
  assert.equal(nano.totals.budget, 15000000, 'tổng ngân sách KOL Nano cả kỳ không đổi');
  // Tổng blended = tổng ngân sách mọi dòng: 200.000 + 10.920.000 +
  // 5.000.000 + 0 (Facebook Owned không benchmark -> 0) + 15.000.000.
  assert.equal(data.blended.totals.budget, 31120000, 'tổng ngân sách blended không đổi theo thứ tự');
});

test('PKCO [unit]: Channel xuất hiện ở 2 group — phẳng hoá khử trùng theo lần xuất hiện đầu tiên (1 entry, vị trí theo group xuất hiện trước)', () => {
  const rows = [
    { id: 'x1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Shared Ch', group: 'Group B', qty: 1, budget: null, phase_id: 'ph-ord' },
    { id: 'x2', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Alpha', group: 'Group A', qty: 1, budget: null, phase_id: 'ph-ord' },
    { id: 'x3', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Beta', group: 'Group B', qty: 1, budget: null, phase_id: 'ph-ord' },
    { id: 'x4', brand_id: 'b1', segment: 'b2c', month: '2027-02', channel: 'Shared Ch', group: 'Group A', qty: 2, budget: null, phase_id: 'ph-ord' },
  ];
  assert.deepEqual(gridOrderOf(rows), ['Shared Ch', 'Beta', 'Alpha'], 'fixture: duyệt lưới cho [Shared Ch, Beta, Alpha]');
  const { h } = makeHarness(rows, PHASES, [], []);
  const data = h.planningKpiData(rows, [], MONTHS);
  assert.deepEqual(data.channels.map((c) => c.channel), ['Shared Ch', 'Beta', 'Alpha']);
  const shared = data.channels.filter((c) => c.channel === 'Shared Ch');
  assert.equal(shared.length, 1, 'Shared Ch xuất hiện ở 2 group vẫn chỉ 1 entry');
  assert.equal(shared[0].rows.length, 2, 'entry gộp cả 2 dòng của 2 group');
});

test('PKCO [unit]: render — thứ tự hàng của cả 4 bảng KPI (views/paid/cac/b2b) trong planningKpiTablesHtml khớp thứ tự lưới; hàng "Tất cả" vẫn cuối mỗi bảng', () => {
  const rows = shuffledRows();
  const { h } = makeHarness(rows, PHASES, BENCH, []);
  const html = h.planningKpiTablesHtml(rows, BENCH, MONTHS);
  for (const kind of ['views', 'paid', 'cac', 'b2b']) {
    assert.deepEqual(renderedChannelOrder(html, kind), [...GRID_ORDER, 'Tất cả'],
      'bảng ' + kind + ' phải render Channel theo thứ tự lưới, hàng Tất cả cuối bảng');
  }
});

test('PKCO [neo]: fixture Lumus qua planningKpiData — thứ tự Channel khớp duyệt lưới của chính fixture; số neo giữ nguyên (Paid cả kỳ 102,4347 gồm Paid Email — đợt Email 18/11; CAC Tất cả T1 = 31.438.407đ)', () => {
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const phases = JSON.parse(JSON.stringify(demo.phases.filter((p) => p.brand_id)));
  const benchmarks = JSON.parse(JSON.stringify(demo.benchmarks));
  const assumptions = JSON.parse(JSON.stringify(demo.phase_assumptions));
  const { h } = makeHarness(rows, phases, benchmarks, assumptions);
  const MONTHS_2027 = Array.from({ length: 12 }, (_, i) => '2027-' + String(i + 1).padStart(2, '0'));
  const data = h.planningKpiData(rows, benchmarks, MONTHS_2027);
  assert.deepEqual(data.channels.map((c) => c.channel), gridOrderOf(rows), 'thứ tự Channel Lumus khớp phép duyệt lưới');
  approx(data.blended.totals.paid, 102.43472979521258, 'Paid cả kỳ fixture (phễu Freemium + Paid Email đợt 18/11)');
  assert.equal(data.blended.months['2027-01'].budget, 72560000, 'ngân sách T1 fixture');
  assert.equal(h.fmtPlanningCac(data.blended.months['2027-01'].cac), '31.438.407 VND', 'CAC Tất cả T1');
  assert.equal(domain.planBudget(rows, benchmarks).total, 1598700000, 'tổng ngân sách fixture = 1.598.700.000đ');
  assert.equal(rows.reduce((s, r) => s + (r.qty || 0), 0), 776, 'content Lumus = 776');
});
