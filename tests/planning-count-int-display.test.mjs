// tests/planning-count-int-display.test.mjs
// Đợt "Hiển thị số nguyên cho chỉ số đếm" (yêu cầu Zac 18/11/2026):
// mọi chỉ số ĐẾM NGƯỜI/LƯỢT trong Planning HIỂN THỊ số nguyên
// (Math.round, phân tách nghìn vi-VN) thay vì thập phân:
//   Paid 2,308005 -> "2"; Paid 0,1188 -> "0"; Visits 2.206,75 ->
//   "2.207"; Views 101.000 -> "101.000"; B2B Accounts 0,0119 -> "0".
// CHỈ đổi lớp hiển thị (fmtPlanningCount + vizFunnelHtml countInt):
// engine/domain và giá trị nội bộ giữ nguyên thập phân đầy đủ, CAC
// vẫn tính từ Paid CHƯA làm tròn, tiền/tỉ lệ/qty hiển thị như cũ.
// Số neo engine phải giữ nguyên: Paid cả kỳ fixture 92,1879…;
// CAC "Tất cả" T1 = 31.438.407đ; Views "Tất cả" T1 = 101.000;
// 776 content Lumus; tổng ngân sách Lumus 1.598.700.000đ.

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
const fmtMoneyStub = (n, c) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('vi-VN') + ' ' + (c || '');

// Harness app.js theo đúng mẫu các test Planning hiện có: helpers
// (Brand + Planning) + khối Theo phase (chứa planningKpiTablesHtml /
// planningOperatingTableHtml / planningPhaseBlockHtml).
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
  const sUpdate = () => ({ ok: true });
  const sCreate = () => ({ ok: true });
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { UI: UI, fmtPlanningCount: fmtPlanningCount, fmtPlanningPaid: fmtPlanningPaid, fmtPlanningCac: fmtPlanningCac, planningKpiData: planningKpiData, planningKpiTablesHtml: planningKpiTablesHtml, planningOperatingTableHtml: planningOperatingTableHtml, planningPhaseBlockHtml: planningPhaseBlockHtml, funnelTotalsFor: funnelTotalsFor };');
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
function demoHarness() {
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const phases = JSON.parse(JSON.stringify(demo.phases.filter((p) => p.brand_id)));
  const benchmarks = JSON.parse(JSON.stringify(demo.benchmarks));
  const assumptions = JSON.parse(JSON.stringify(demo.phase_assumptions));
  return { ...makeHarness(rows, phases, benchmarks, assumptions), rows, phases, benchmarks, assumptions };
}
const MONTHS_2027 = Array.from({ length: 12 }, (_, i) => '2027-' + String(i + 1).padStart(2, '0'));
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

// vizFunnelHtml THẬT từ vùng PURE (mẫu waveb4-viz2): chỉ truyền
// esc/fmtMoney/fmtNum/labelStatus như harness gốc.
const pureSrc = src.slice(src.indexOf('// R3.1-VIZ-PURE-BEGIN'), src.indexOf('// R3.1-VIZ-PURE-END'));
const V = new Function('esc', 'fmtMoney', 'fmtNum', 'labelStatus',
  pureSrc + '\nreturn { vizFunnelHtml: vizFunnelHtml };'
)(escStub, fmtMoneyStub, fmtNumStub, () => '—');

// ---------- [unit] helper hiển thị số nguyên ----------
test('PCID [unit]: fmtPlanningCount — ca neo của Zac: Paid 2,308005 -> "2", Paid 0,1188 -> "0", Visits 2.206,75 -> "2.207", Views 101000 -> "101.000", B2B 0,0119 -> "0", 2,5 -> "3"', () => {
  const { h } = demoHarness();
  assert.equal(h.fmtPlanningCount(2.308005), '2');
  assert.equal(h.fmtPlanningCount(0.1188), '0');
  assert.equal(h.fmtPlanningCount(2206.75), '2.207');
  assert.equal(h.fmtPlanningCount(101000), '101.000');
  assert.equal(h.fmtPlanningCount(0.0119), '0');
  assert.equal(h.fmtPlanningCount(2.5), '3', 'làm tròn chuẩn Math.round: 2,5 -> 3');
  assert.equal(h.fmtPlanningCount(92.18790756785299), '92');
  assert.equal(h.fmtPlanningCount(1460000), '1.460.000');
  assert.equal(h.fmtPlanningCount(null), '—');
  assert.equal(h.fmtPlanningCount(undefined), '—');
  assert.equal(h.fmtPlanningCount(''), '—');
  // Alias cũ fmtPlanningPaid cho cùng kết quả số nguyên.
  assert.equal(h.fmtPlanningPaid(2.308005), '2');
  assert.equal(h.fmtPlanningPaid(0.1188), '0');
});

test('PCID [unit]: CAC hiển thị KHÔNG đổi — vẫn làm tròn tới đồng từ Paid CHƯA làm tròn', () => {
  const { h } = demoHarness();
  assert.equal(h.fmtPlanningCac(72560000 / 2.308005), '31.438.407 VND', 'CAC Tất cả T1 giữ nguyên 31.438.407đ');
  assert.equal(h.fmtPlanningCac(6000000 / 0.1188), '50.505.051 VND', 'CAC KOL Nano T1 giữ nguyên');
  assert.equal(h.fmtPlanningCac(null), '—');
});

// ---------- [unit] render KPI Theo tháng + số neo engine ----------
test('PCID [unit]: bảng KPI Theo tháng hiển thị số nguyên ở mọi ô Paid/Views/B2B (kể cả hàng Tất cả + cột Tổng); số neo engine không đổi', () => {
  const { h, rows, benchmarks } = demoHarness();
  const data = h.planningKpiData(rows, benchmarks, MONTHS_2027);
  // Neo ENGINE (giá trị nội bộ, chưa làm tròn) giữ nguyên hệt trước đợt.
  approx(data.blended.totals.paid, 92.18790756785299, 'Paid cả kỳ fixture (engine) = 92,1879…');
  approx(data.blended.months['2027-01'].paid, 2.308005, 'Paid Tất cả T1 (engine) = 2,308005');
  approx(data.blended.months['2027-01'].views, 101000, 'Views Tất cả T1 (engine) = 101.000');
  const html = h.planningKpiTablesHtml(rows, benchmarks, MONTHS_2027);
  // Hiển thị: số nguyên ở đúng các ô đã neo.
  assert.equal(kpiCell(html, 'paid', 'Tất cả', '2027-01'), '2', 'Paid Tất cả T1 hiển thị "2"');
  assert.equal(kpiTotal(html, 'paid', 'Tất cả'), '92', 'Paid Tất cả cột Tổng hiển thị "92"');
  assert.equal(kpiCell(html, 'paid', 'KOL Nano', '2027-01'), '0', 'Paid KOL Nano T1 (engine 0,1188) hiển thị "0"');
  assert.equal(kpiCell(html, 'views', 'Tất cả', '2027-01'), '101.000', 'Views Tất cả T1 hiển thị "101.000"');
  assert.equal(kpiTotal(html, 'views', 'Tất cả'), '1.460.000', 'Views Tất cả cột Tổng hiển thị "1.460.000"');
  assert.equal(kpiCell(html, 'cac', 'Tất cả', '2027-01'), '31.438.407 VND', 'CAC Tất cả T1 không đổi');
  // Không ô đếm nào của 3 bảng Paid/Views/B2B còn dấu thập phân kiểu "x,yyyy".
  for (const kind of ['paid', 'views', 'b2b']) {
    const cells = [...html.matchAll(new RegExp('data-planning-kpi-(?:cell|total)="' + kind + '"[^>]*>(?:<strong>)?([^<]*)(?:</strong>)?</td>', 'g'))].map((m) => m[1]);
    assert.ok(cells.length > 0, 'phải có ô ' + kind + ' để kiểm');
    for (const c of cells) {
      assert.ok(c === '—' || /^-?\d{1,3}(\.\d{3})*$/.test(c), 'ô ' + kind + ' phải là số nguyên phân tách nghìn, got: ' + c);
    }
  }
});

// ---------- [unit] bảng vận hành: hàng đếm số nguyên, tiền giữ nguyên ----------
test('PCID [unit]: bảng Chỉ số vận hành — hàng đếm (Paid EOM 108,9 -> "109", Total users 1.268,9 -> "1.269", Paid churn 1,1 -> "1") hiển thị số nguyên; hàng tiền giữ fmtMoney', () => {
  const bench = [{ id: 'bench-x', brand_id: 'b1', channel: 'X', unit_price: 1000000, output_per_unit: 200, view_to_visit: 1, visit_to_signup: 1, signup_to_first: 1, first_to_paid: 0.05, direct_budget: false }];
  const phases = [{ id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0, paid_churn_rate: 0.02, free_churn_rate: 0.05, paid_price_tiers: [{ price: 50000, pct: 100 }], cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000, opening_free: 1000, opening_paid: 100 }];
  const rows = [{ id: 'r-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'X', group: 'G', qty: 1, budget: null, phase_id: 'ph-1' }];
  const { h, UI } = makeHarness(rows, phases, bench, []);
  UI.planningOpeningPhaseIds = { 'ph-1': true };
  const html = h.planningOperatingTableHtml(rows, bench, ['2027-01']);
  const cell = (key) => {
    const m = new RegExp('<td data-planning-operating-cell="' + key + '" data-month="2027-01">([^<]*)</td>').exec(html);
    return m ? m[1] : null;
  };
  assert.equal(cell('reach'), '200');
  assert.equal(cell('paidChurn'), '1', 'Paid churn engine 1,1 -> hiển thị "1"');
  assert.equal(cell('paidEom'), '109', 'Paid EOM engine 108,9 -> hiển thị "109"');
  assert.equal(cell('freeEom'), '1.160');
  assert.equal(cell('totalUsers'), '1.269', 'Total users engine 1.268,9 -> hiển thị "1.269"');
  assert.equal(cell('budget'), '1.000.000 VND', 'hàng tiền giữ nguyên formatter tiền');
  assert.equal(cell('revenue'), '5.445.000 VND', 'Revenue giữ nguyên (tính từ Paid EOM chưa làm tròn 108,9)');
});

// ---------- [unit] Theo phase: cột Forecast của dòng channel ----------
test('PCID [unit]: Theo phase — cột Forecast Visits/Freemium/Paid/B2B của dòng channel hiển thị số nguyên (Freemium 4,32 -> "4", Paid 0,1188 -> "0")', () => {
  const bench = [{ id: 'bench-kol', brand_id: 'b1', channel: 'KOL Nano', unit_price: 1500000, output_per_unit: 4000, view_to_visit: 0.003, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, direct_budget: false }];
  const phases = [{ id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0 }];
  const rows = [{ id: 'r-jan', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', qty: 4, budget: null, phase_id: 'ph-1' }];
  const { h } = makeHarness(rows, phases, bench, []);
  const totals = h.funnelTotalsFor(rows, bench);
  approx(totals.freemium, 4.32, 'engine: Freemium = 4,32 (không đổi)');
  approx(totals.paid, 0.1188, 'engine: Paid = 0,1188 (không đổi)');
  const html = h.planningPhaseBlockHtml(phases[0], rows, bench, true, '');
  assert.ok(html.includes('<td>48</td>'), 'Forecast Visits = 48');
  assert.ok(html.includes('<td>4</td>'), 'Forecast Freemium 4,32 -> hiển thị "4"');
  assert.ok(!html.includes('4,32'), 'không còn thập phân 4,32 ở khối Phase');
  assert.ok(!html.includes('0,1188'), 'không còn thập phân 0,1188 ở khối Phase');
});

// ---------- [unit] funnel: countInt chỉ ở Planning ----------
test('PCID [unit]: vizFunnelHtml countInt — phễu Planning hiển thị số nguyên (Views 101.000 / Visits 2.207 / Paid 2), % vẫn tính từ số chưa làm tròn; không bật countInt thì giữ fmtNum cũ (phễu ngoài Planning không đổi)', () => {
  const steps = [
    { label: 'Views', value: 101000 },
    { label: 'Visits', value: 2206.75 },
    { label: 'Paid', value: 2.308005 },
  ];
  const html = V.vizFunnelHtml({ steps, countInt: true });
  assert.ok(html.includes('101.000 (100%)'), 'Views hiển thị 101.000, got: ' + html);
  assert.ok(html.includes('2.207 ('), 'Visits 2.206,75 -> hiển thị 2.207, got: ' + html);
  assert.ok(!html.includes('2.206,75') && !html.includes('2,308'), 'phễu Planning không còn thập phân');
  const plain = V.vizFunnelHtml({ steps });
  assert.ok(plain.includes('2,308'), 'không countInt -> giữ hiển thị cũ của fmtNum (2,308)');
  const b2b = V.vizFunnelHtml({ steps: [{ label: 'Paid', value: 0.1188 }, { label: 'B2B Accounts', value: 0.0119 }], countInt: true });
  assert.ok(!b2b.includes('0,1188') && !b2b.includes('0,0119'), 'Paid 0,1188 và B2B 0,0119 đều hiển thị "0"');
});

// ---------- [static] các điểm render đã nối fmtPlanningCount ----------
test('PCID [static]: mọi bề mặt đếm của Planning nối fmtPlanningCount / countInt; CAC + tiền + tỉ lệ không bị đổi formatter', () => {
  const kpi = section('function planningKpiTablesHtml(rows, benchmarks, months)', '// --- Bảng Chỉ số vận hành');
  assert.match(kpi, /fmtPlanningCount\(cell\.paid\)/);
  assert.match(kpi, /fmtPlanningCount\(cell\.b2b\)/);
  assert.match(kpi, /fmtPlanningCount\(cell\.views\)/);
  assert.match(kpi, /fmtPlanningCac\(cell\.cac\)/, 'CAC giữ fmtPlanningCac');
  assert.doesNotMatch(kpi, /fmtPlanningPaid\(/, 'bảng KPI không còn gọi formatter thập phân cũ');
  const op = section('function planningOperatingTableHtml(rows, benchmarks, months)', '// --- Audience trên dòng budget-driven');
  assert.match(op, /kind === 'money' \? fmtMoney\(v, 'VND'\) : fmtPlanningCount\(v\)/, 'bảng vận hành: tiền giữ fmtMoney, đếm dùng fmtPlanningCount');
  assert.match(src, /esc\(meta\.metric\) \+ ': ' \+ fmtPlanningCount\(primary\)/, 'kết quả Objective trong bảng chi tiết dòng dùng fmtPlanningCount');
  assert.doesNotMatch(src, /Math\.round\(primary \* 10000\)/, 'không còn làm tròn 4 số thập phân cho kết quả Objective');
  assert.match(src, /vizFunnelHtml\(\{ steps: detailSteps, countInt: true/);
  assert.match(src, /vizFunnelHtml\(\{ steps: funnelSteps, countInt: true/);
  assert.match(src, /vizFunnelHtml\(\{ steps: pSteps, countInt: true/);
  const ads = section('function viewAds()', '// ---------- Báo cáo ----------');
  assert.doesNotMatch(ads, /countInt/, 'phễu Quảng cáo (ngoài Planning) không bật countInt');
});

// ---------- [domain] số neo fixture không đổi ----------
test('PCID [domain]: số neo fixture giữ nguyên — 776 content Lumus; tổng ngân sách Lumus 1.598.700.000đ', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776, 'content Lumus FY2027 = 776');
  assert.equal(domain.planBudget(lumus, demo.benchmarks).total, 1598700000, 'tổng ngân sách Lumus = 1.598.700.000đ');
});
