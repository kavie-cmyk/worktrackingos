// tests/data-link-unification-stepb.test.mjs
// BƯỚC B — ĐỒNG NHẤT LIÊN KẾT DỮ LIỆU về một nguồn (theo AUDIT Bước A).
// Khóa cho từng phát hiện (i)/(ii) đã xử lý: mỗi đại lượng chỉ còn MỘT
// hàm nguồn (domain là nguồn cho benchmark/objective/tỉ lệ/resolve
// phase/thứ tự channel/tiền đã duyệt/còn mở/số dư), mọi nơi hiển thị
// gọi nguồn đó — kiểm bằng ca chứng minh của audit + differential
// (cùng fixture, các nơi hiển thị phải cho cùng kết quả).
// Số neo: 764 content; tổng ngân sách fixture
// 1.238.700.000đ (khóa ở đây qua planBudget + summarizePlanByMonth).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const storeSrc = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const StoreModule = require('../js/store.js');

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

// ---------- Harness app: helpers Brand+Planning + khối Phase ----------
function makeAppHarness(rows, phases, benchmarks, assumptions, domainOverride) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {} };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : coll === 'phase_assumptions' ? (assumptions || []) : []),
    get: () => null,
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { planChannelOrder: planChannelOrder, planChannelOrderByGroup: planChannelOrderByGroup, planRowGroup: planRowGroup, planRowObjective: planRowObjective, planBenchmarkCostPerResult: planBenchmarkCostPerResult, benchmarkForRow: benchmarkForRow, planRowB2bShare: planRowB2bShare, planRowEffectiveAudience: planRowEffectiveAudience, phaseRowsFor: phaseRowsFor, phaseForPlanRow: phaseForPlanRow, effectivePhaseRates: effectivePhaseRates, effectivePhaseViewsPerUnit: effectivePhaseViewsPerUnit, planRowEffectiveBudget: planRowEffectiveBudget, planningOperatingData: planningOperatingData, cacFor: cacFor, forecastFunnelFor: forecastFunnelFor };');
  return factory(Store, domainOverride || domain, UI, cfValStub,
    () => true, () => {}, () => {},
    () => ({ ok: false }), () => ({ ok: false }), () => {},
    escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<table data-table-key="' + key + '">' + inner + '</table>',
    (m) => 'Tháng ' + Number(String(m).slice(5, 7)) + '/' + String(m).slice(0, 4),
    () => '<div data-viz-stub="funnel"></div>');
}

// ---------- Harness adapter ngân sách (summarize* + budgetActualTotalFor) ----------
const adapterHolder = { data: { campaigns: [], budgetLines: [], commitments: [], actuals: [], activities: [], budgetAllocations: [] } };
function makeAdapters() {
  const adaptersSrc = section('function listSafe', 'function kpiPeriodKey');
  const StoreStub = {
    list: (c) => adapterHolder.data[c] || [],
    get: (c, id) => (adapterHolder.data[c] || []).find((x) => x.id === id) || null,
  };
  const visibleListStub = (coll) => StoreStub.list(coll).filter((x) => !(x && (x.archivedAt || x.archived || String(x.status || '').toLowerCase() === 'archived')));
  const factory = new Function('Store', 'D', 'visibleList', 'cfVal',
    adaptersSrc + '\nreturn { summarizeCampaignBudget: summarizeCampaignBudget, summarizeActivityBudget: summarizeActivityBudget, budgetActualTotalFor: budgetActualTotalFor };');
  return factory(StoreStub, domain, visibleListStub, cfValStub);
}

// =====================================================================
// I-0 SYN-13: điều kiện chưa đặt trần nằm ở domain
// =====================================================================
test('B-I0 [domain]: summarizeBudgetScope — ceiling 0 + actual approved 700 USD, ceilingConfigured:false -> available null (không còn -700); configured:true -> -700; không truyền cờ -> giữ hành vi cũ -700', () => {
  const actuals = [{ id: 'a1', amount: 700, currency: 'USD', approvalStatus: 'approved' }];
  const off = domain.summarizeBudgetScope({ ceiling: 0, currency: 'USD', ceilingConfigured: false, actuals });
  assert.equal(off.available, null);
  assert.equal(off.byCurrency.USD.available, null);
  assert.equal(off.ceilingConfigured, false);
  const on = domain.summarizeBudgetScope({ ceiling: 0, currency: 'USD', ceilingConfigured: true, actuals });
  assert.equal(on.available, -700);
  const legacy = domain.summarizeBudgetScope({ ceiling: 0, currency: 'USD', actuals });
  assert.equal(legacy.available, -700, 'caller cũ không truyền cờ giữ nguyên số cũ');
  const byMap = domain.summarizeBudgetScope({ ceiling: 0, currency: 'USD', ceilingConfiguredByCurrency: { USD: false }, actuals });
  assert.equal(byMap.available, null);
});

test('B-I0 [differential + static]: adapter campaign cho cùng kết quả null như domain; adapter không còn ghi đè available', () => {
  adapterHolder.data = {
    campaigns: [{ id: 'cx', name: 'CX' }],
    budgetLines: [{ id: 'l-vnd', campaignId: 'cx', currency: 'VND', approved: 100 }],
    commitments: [],
    actuals: [{ id: 'a-usd', campaignId: 'cx', amount: 700, currency: 'USD', approvalStatus: 'approved' }],
    activities: [], budgetAllocations: [],
  };
  const A = makeAdapters();
  const rows = A.summarizeCampaignBudget({ id: 'cx', name: 'CX' });
  assert.equal(rows.find((r) => r.currency === 'USD').available, null);
  assert.equal(rows.find((r) => r.currency === 'VND').available, 100);
  const adaptersSrc = section('function listSafe', 'function kpiPeriodKey');
  assert.match(adaptersSrc, /ceilingConfiguredByCurrency/);
  assert.doesNotMatch(adaptersSrc, /var available = /);
});

// =====================================================================
// I-1 benchmark + II-2 group + I-3 objective + II-6 costPerResult
// =====================================================================
const BENCH_SEG = [
  { brand_id: 'b1', channel: 'X', segment: 'b2b', unit_price: 200 },
  { brand_id: 'b1', channel: 'X', segment: 'b2c', unit_price: 100 },
];
test('B-I1 [domain + differential app]: khớp benchmark theo segment — dòng b2b lấy 200 (bản cũ domain lấy 100 do ghi đè key); app benchmarkForRow cho cùng kết quả; planBudget KHÔNG còn đọc giá Benchmark (chốt 18/11)', () => {
  const row = { brand_id: 'b1', channel: 'X', segment: 'b2b' };
  assert.equal(domain.benchmarkForRow(row, BENCH_SEG).unit_price, 200);
  // Chốt 18/11 — bỏ giá Benchmark: dòng không có giá Phase thì ngân sách
  // = 0 dù Benchmark có unit_price 200; giá chỉ còn từ unit_price trên dòng.
  assert.equal(domain.planBudget([{ brand_id: 'b1', channel: 'X', segment: 'b2b', month: '2027-01', qty: 1 }], BENCH_SEG).total, 0);
  assert.equal(domain.planBudget([{ brand_id: 'b1', channel: 'X', segment: 'b2b', month: '2027-01', qty: 1, unit_price: 200 }], BENCH_SEG).total, 200);
  const h = makeAppHarness([], [], BENCH_SEG, []);
  assert.equal(h.benchmarkForRow(row, BENCH_SEG).unit_price, 200, 'app phải khớp domain');
  // Bản trùng key cùng segment: bản ĐẦU thắng (không ghi đè theo thứ tự key).
  const dup = [
    { brand_id: 'b1', channel: 'X', segment: 'b2b', unit_price: 111 },
    { brand_id: 'b1', channel: 'X', segment: 'b2b', unit_price: 222 },
  ];
  assert.equal(domain.benchmarkForRow(row, dup).unit_price, 111);
});

test('B-II2 [domain + app]: tên nhóm một quy tắc — dòng không group -> "Chưa nhóm" ở cả domain rowGroupOf và app planRowGroup', () => {
  assert.equal(domain.rowGroupOf({}), 'Chưa nhóm');
  assert.equal(domain.rowGroupOf({ groupName: 'G' }), 'G');
  const h = makeAppHarness([], [], [], []);
  assert.equal(h.planRowGroup({}), 'Chưa nhóm');
  assert.equal(h.planRowGroup({ group: 'Paid Media' }), 'Paid Media');
});

test('B-I3 [app + domain]: planRowObjective dùng bảng alias của domain — "Lead Generation" -> lead_gen, "Video Views" -> awareness (bản exact-key cũ trả null)', () => {
  const h = makeAppHarness([], [], [], []);
  assert.equal(h.planRowObjective({ objective: 'Lead Generation' }), 'lead_gen');
  assert.equal(h.planRowObjective({ objective: 'Video Views' }), 'awareness');
  assert.equal(h.planRowObjective({ objective: 'Lead Generation' }), domain.paidObjectiveOf({ objective: 'Lead Generation' }));
  assert.equal(h.planRowObjective({ objective: 'traffic' }), 'traffic');
  assert.equal(h.planRowObjective({}), null);
});

test('B-II6 [app + domain]: planBenchmarkCostPerResult = D.costPerResultFor trên cùng benchmark (gồm alias objective)', () => {
  const h = makeAppHarness([], [], [], []);
  const bm = { brand_id: 'b1', channel: 'Meta Ads', cost_per_result: { traffic: 20000, lead_gen: 500000, awareness: null } };
  assert.equal(h.planBenchmarkCostPerResult(bm, 'traffic'), domain.costPerResultFor(bm, 'traffic'));
  assert.equal(h.planBenchmarkCostPerResult(bm, 'traffic'), 20000);
  assert.equal(h.planBenchmarkCostPerResult(bm, 'awareness'), null);
  assert.equal(h.planBenchmarkCostPerResult(bm, 'lead_gen'), 500000);
});

// =====================================================================
// I-2 summarizePlanByMonth/ByChannel ủy quyền công thức hiệu dụng
// =====================================================================
test('B-I2 [domain]: summarizePlanByMonth — qty fallback quantity (5, không còn 0); dòng qty+budget dùng qty x giá Phase trên dòng (200, không cộng budget 999)', () => {
  const s1 = domain.summarizePlanByMonth([{ quantity: 5, budget: 999, month: '2027-01', channel: 'X' }]);
  assert.equal(s1.totalQty, 5);
  assert.equal(s1.byMonth['2027-01'].qty, 5);
  // Giá Phase trên dòng (chốt 18/11); Benchmark kèm theo có giá khác
  // (999) để khoá là giá Benchmark KHÔNG được đọc.
  const s2 = domain.summarizePlanByMonth([{ qty: 2, budget: 999, month: '2027-01', channel: 'X', unit_price: 100 }], [{ channel: 'X', unit_price: 999 }]);
  assert.equal(s2.totalBudget, 200);
  assert.equal(s2.byMonth['2027-01'].budget, 200);
});

test('B-I2 [domain]: summarizePlanByChannel — thứ tự group->channel (không còn ABC) + ngân sách hiệu dụng theo channel', () => {
  const rows = [
    { channel: 'Zeta', group: 'G1', month: '2027-01', qty: 1, unit_price: 10 },
    { channel: 'Alpha', group: 'G2', month: '2027-01', qty: 2, unit_price: 100 },
  ];
  // Giá Phase trên dòng (chốt 18/11); bench giữ nguyên để chứng minh
  // summarize không đọc giá Benchmark nữa.
  const bench = [{ channel: 'Zeta', unit_price: 10 }, { channel: 'Alpha', unit_price: 100 }];
  const s = domain.summarizePlanByChannel(rows, bench);
  assert.deepEqual(s.channels.map((c) => c.channel), ['Zeta', 'Alpha'], 'thứ tự theo group xuất hiện đầu tiên, không phải ABC');
  assert.equal(s.byChannel.Zeta.budget, 10);
  assert.equal(s.byChannel.Alpha.budget, 200);
  assert.equal(s.totalBudget, 210);
});

test('B-I2 [neo]: fixture Lumus — summarizePlanByMonth(rows, benchmarks) cho totalQty 764 và totalBudget = planBudget = 1.238.700.000đ', () => {
  const rows = JSON.parse(JSON.stringify(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai')));
  const benchmarks = JSON.parse(JSON.stringify(demo.benchmarks));
  const s = domain.summarizePlanByMonth(rows, benchmarks);
  assert.equal(s.totalQty, 764);
  assert.equal(s.totalBudget, 1238700000);
  assert.equal(s.totalBudget, domain.planBudget(rows, benchmarks).total);
});

// =====================================================================
// II-1 planChannelOrder một nguồn (domain + app + lưới/kpi/phase)
// =====================================================================
test('B-II1 [domain + app]: planChannelOrder khớp phép duyệt lưới group->channel trên rows xáo trộn; bản ByGroup giữ channel ở cả 2 group cho lưới', () => {
  const rows = [
    { channel: 'Website Articles', group: 'Content', month: '2027-01', qty: 1 },
    { channel: 'Meta Ads', group: 'Paid Media', month: '2027-01', qty: null, budget: 5 },
    { channel: 'KOL Nano', group: 'Content', month: '2027-01', qty: 1 },
  ];
  const expected = [
    { group: 'Content', channel: 'Website Articles' },
    { group: 'Content', channel: 'KOL Nano' },
    { group: 'Paid Media', channel: 'Meta Ads' },
  ];
  assert.deepEqual(domain.planChannelOrder(rows), expected);
  const h = makeAppHarness(rows, [], [], []);
  assert.deepEqual(h.planChannelOrder(rows), expected, 'app phải dùng cùng helper domain');
  const byGroup = h.planChannelOrderByGroup([
    { channel: 'Shared', group: 'B', month: '2027-01', qty: 1 },
    { channel: 'Shared', group: 'A', month: '2027-01', qty: 1 },
  ]);
  assert.deepEqual(byGroup.map((g) => [g.group, g.channels]), [['B', ['Shared']], ['A', ['Shared']]], 'lưới giữ channel ở từng group');
  // Khối Phase + lưới dùng helper: kiểm tĩnh đường gọi.
  assert.match(section('function planningPhaseBlockHtml', '// --- 3 bảng KPI chi tiết theo tháng'), /planChannelOrder\(pRows\)/);
  assert.match(section('function viewPlanning()', '// ---------- Planning Theo phase'), /planChannelOrderByGroup\(rows\)/);
});

// =====================================================================
// II-3 tỉ lệ hiệu dụng + II-5 đơn giá đặt tay customFields + II-7 audience
// =====================================================================
test('B-II3 [differential]: effectivePhaseRates/effectivePhaseViewsPerUnit của app bằng hệt domain effectiveRatesFor/effectiveViewsPerUnitFor', () => {
  const benchmarks = [{ brand_id: 'b1', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 }];
  const assumptions = [{ id: 'a1', phase_id: 'ph-1', channel: 'KOL Nano', view_to_visit: 0.01, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: null }];
  const phase = { id: 'ph-1', brand_id: 'b1' };
  const h = makeAppHarness([], [], benchmarks, assumptions);
  assert.deepEqual(h.effectivePhaseRates(phase, 'KOL Nano', benchmarks), domain.effectiveRatesFor(phase, 'KOL Nano', benchmarks, assumptions));
  assert.deepEqual(h.effectivePhaseViewsPerUnit(phase, 'KOL Nano', benchmarks), domain.effectiveViewsPerUnitFor(phase, 'KOL Nano', benchmarks, assumptions));
  assert.equal(h.effectivePhaseRates(phase, 'KOL Nano', benchmarks).view_to_visit.value, 0.01, 'assumption thắng');
  approx(h.effectivePhaseRates(phase, 'KOL Nano', benchmarks).freemium_to_paid.value, 0.0275, 'f2p fallback gộp');
});

test('B-II5 [differential]: đơn giá đặt tay trong customFields — domain planBudget và app planRowEffectiveBudget cho cùng 300', () => {
  const row = { qty: 2, month: '2027-01', channel: 'X', customFields: { unit_price: 150 } };
  assert.equal(domain.planBudget([row], []).total, 300);
  assert.equal(domain.planBudget([row], []).rows[0].source, 'manual_unit_price');
  const h = makeAppHarness([], [], [], []);
  assert.equal(h.planRowEffectiveBudget(row, []), 300);
});

test('B-II7 [differential]: planRowB2bShare = audienceShareFor của domain — cả field trực tiếp lẫn customFields', () => {
  const h = makeAppHarness([], [], [], []);
  const r1 = { objective: 'lead_gen', audience: 'both', b2b_split_pct: 30, segment: 'b2c' };
  assert.equal(h.planRowB2bShare(r1), domain.audienceShareFor(r1).b2b);
  assert.equal(h.planRowB2bShare(r1), 0.3);
  const r2 = { objective: 'lead_gen', customFields: { audience: 'b2b' } };
  assert.equal(h.planRowB2bShare(r2), 1);
  assert.equal(h.planRowEffectiveAudience(r2), 'b2b');
  const r3 = { objective: 'awareness', audience: 'b2b' };
  assert.equal(h.planRowB2bShare(r3), 0, 'objective thuần B2C khóa B2B ở cả hai đường');
});

// =====================================================================
// I-7 resolve phase một nguồn
// =====================================================================
test('B-I7 [differential]: dòng phase_id "ma" — phaseRowsFor (app) và engine forecastFunnel (domain) cùng gom vào Phase theo Brand + khoảng tháng', () => {
  const P1 = { id: 'ph-1', brand_id: 'b1', name: 'P1', start_month: '2027-01', end_month: '2027-03' };
  const ghost = { id: 'g1', brand_id: 'b1', month: '2027-02', channel: 'KOL Nano', qty: 2, phase_id: 'ghost-phase' };
  const benchmarks = [{ brand_id: 'b1', channel: 'KOL Nano', output_per_unit: 1000, view_to_visit: 0.01, visit_to_freemium: 0.1, freemium_to_paid: 0.1 }];
  const h = makeAppHarness([ghost], [P1], benchmarks, []);
  assert.deepEqual(h.phaseRowsFor(P1, [ghost]).map((r) => r.id), ['g1'], 'phaseRowsFor không còn loại dòng phase_id hỏng');
  assert.equal(h.phaseForPlanRow(ghost).id, 'ph-1');
  const f = domain.forecastFunnel([ghost], benchmarks, { phases: [P1], phaseAssumptions: [] });
  assert.ok(f.byPhase['ph-1'], 'engine gom dòng vào byPhase của P1');
  assert.equal(f.byPhase['ph-1'].rowCount, 1);
});

// =====================================================================
// I-4 Đã chi đã duyệt + I-5 Còn mở từng cam kết
// =====================================================================
test('B-I4 [domain + app helper]: budgetActualTotal chỉ tính actual ĐÃ DUYỆT cùng currency — approved 1.000 + pending 300 -> 1.000 ở cả domain và budgetActualTotalFor', () => {
  const line = { id: 'l1', currency: 'VND', approved: 2000 };
  const acts = [
    { id: 'a1', amount: 1000, currency: 'VND', approvalStatus: 'approved' },
    { id: 'a2', amount: 300, currency: 'VND', approvalStatus: 'pending' },
    { id: 'a3', amount: 200, currency: 'USD', approvalStatus: 'approved' },
  ];
  assert.equal(domain.budgetActualTotal(line, acts), 1000);
  const A = makeAdapters();
  assert.equal(A.budgetActualTotalFor(line, acts), 1000);
  // Nhất quán với budgetRemaining: remaining = 2.000 - 1.000 = 1.000;
  // "Dự kiến sử dụng" = approved - remaining = 1.000 = Đã chi + Cam kết mở (0).
  assert.equal(domain.budgetRemaining(line, [], acts), 1000);
  assert.equal(2000 - domain.budgetRemaining(line, [], acts), domain.budgetActualTotal(line, acts) + domain.openCommitmentTotal([], acts));
  // Đường hiển thị dùng helper: kiểm tĩnh viewKpi + export.
  assert.match(section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------'), /budgetActualTotalFor\(b, actsCur\)/);
  assert.match(section('function exportBudgetCsv', 'function exportCashCsv'), /budgetActualTotalFor\(l, asCur\)/);
});

test('B-I5 [domain]: openCommitmentAmount — settled -> 0 (bản viết tay cũ cho 100); tổng openCommitmentTotal bằng tổng từng cam kết', () => {
  const commits = [
    { id: 'c1', status: 'settled', amount: 100 },
    { id: 'c2', status: 'committed', amount: 50 },
    { id: 'c3', status: 'committed', amount: 70, approvalStatus: 'pending' },
    { id: 'c4', status: 'released', amount: 30 },
  ];
  assert.equal(domain.openCommitmentAmount(commits[0], []), 0);
  assert.equal(domain.openCommitmentAmount(commits[1], []), 50);
  assert.equal(domain.openCommitmentAmount(commits[2], []), 0, 'chưa duyệt -> 0');
  const sumSingles = commits.reduce((s, c) => s + domain.openCommitmentAmount(c, []), 0);
  assert.equal(domain.openCommitmentTotal(commits, []), sumSingles);
  assert.equal(domain.openCommitmentTotal(commits, []), 50);
  assert.match(section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------'), /D\.openCommitmentAmount\(cm, cmActs\)/);
});

// =====================================================================
// I-6 lũy kế cash gồm opening + II-12 số dư một công thức
// =====================================================================
test('B-I6 [unit]: vizCashCumulativePoints khởi tạo từ opening — fixture demo: điểm cuối = opening 60tr + net 60tr = 120tr (trước đây 60tr)', () => {
  const pureBegin = src.indexOf('// R3.1-VIZ-PURE-BEGIN');
  const pureEnd = src.indexOf('// R3.1-VIZ-PURE-END');
  const pureSrc = src.slice(pureBegin, pureEnd);
  const V = new Function('esc', 'fmtMoney', 'fmtNum', 'labelStatus',
    pureSrc + '\nreturn { vizCashMonthly: vizCashMonthly, vizCashCumulativePoints: vizCashCumulativePoints };'
  )(escStub, fmtMoneyStub, fmtNumStub, (s) => String(s || ''));
  const monthly = [
    { month: '2026-09', currency: 'VND', inTotal: 20000000, outTotal: 4000000, net: 16000000, count: 2 },
    { month: '2026-10', currency: 'VND', inTotal: 30000000, outTotal: 8500000, net: 21500000, count: 2 },
    { month: '2026-11', currency: 'VND', inTotal: 37000000, outTotal: 14500000, net: 22500000, count: 2 },
  ];
  const opening = 50000000 + 10000000; // cash-acc-1 + cash-acc-2 (demo-data)
  const pts = V.vizCashCumulativePoints(monthly, 'VND', opening);
  assert.deepEqual(pts.map((p) => p.y), [76000000, 97500000, 120000000]);
  // Tổng số dư bảng (opening + net cả kỳ) của 2 tài khoản demo:
  // 108,5tr + 11,5tr = 120tr — đường lũy kế nay khớp bảng số dư.
  assert.equal(pts[pts.length - 1].y, 108500000 + 11500000);
  // Caller cũ không truyền opening -> hành vi cũ (bắt đầu từ 0).
  assert.deepEqual(V.vizCashCumulativePoints(monthly, 'VND').map((p) => p.y), [16000000, 37500000, 60000000]);
});

test('B-II12 [differential]: số dư cash — domain cashBalanceFor = Store.listCashBalances (demo) = công thức SQL view; direction lạ bị bỏ qua ở cả hai', () => {
  const acc = { id: 'a1', currency: 'VND', openingBalance: 50 };
  const txns = [
    { id: 't1', accountId: 'a1', direction: 'in', amount: 10 },
    { id: 't2', accountId: 'a1', direction: 'weird', amount: 5 },
    { id: 't3', accountId: 'a1', direction: 'out', amount: 3 },
  ];
  assert.equal(domain.cashBalanceFor(acc, txns), 57);
  StoreModule.state.cashAccounts = [acc];
  StoreModule.state.cashTransactions = txns;
  const res = StoreModule.listCashBalances();
  assert.equal(res.balances[0].balance, 57, 'store cho cùng số với domain');
  assert.match(src, /D\.cashBalanceFor\(acc, txns\)/);
  assert.match(storeSrc, /Domain\.cashBalanceFor/);
});

// =====================================================================
// I-8 ARPPU đa Brand + II-10 phân loại cột Tổng từ domain
// =====================================================================
test('B-I8 [app unit]: planningOperatingData gộp 2 Brand — ARPPU tháng = ΣRevenue ÷ ΣPaid EOM = 40.000 (không còn cộng 30.000 + 50.000 = 80.000)', () => {
  const KEYS = ['budget', 'reach', 'visits', 'freeUser', 'newPaid', 'newFree', 'paidChurn', 'freeChurn', 'paidEom', 'freeEom', 'totalUsers', 'arppuEffective', 'revenue', 'cogs', 'cogsFree', 'cogsPaid', 'profitAfterCogsMkt', 'profitAfterCogsFixedMkt', 'newB2b', 'b2bChurn', 'b2bEom', 'revenueB2b', 'cogsB2b'];
  function fakeRow(arppu, revenue, paidEom) {
    const r = { month: '2027-01', freeClamped: false };
    KEYS.forEach((k) => { r[k] = 0; });
    r.arppuEffective = arppu; r.revenue = revenue; r.paidEom = paidEom;
    return r;
  }
  let call = 0;
  const stubD = {
    forecastFunnel: () => ({ byMonth: { '2027-01': { views: 0, visits: 0, freemium: 0, paid: 1, b2b: 0 } }, rows: [], totals: {} }),
    planBudget: () => ({ byMonth: { '2027-01': { amount: 0 } }, total: 0 }),
    computeOperatingFinancials: () => {
      call++;
      const row = call === 1 ? fakeRow(30000, 30000, 1) : fakeRow(50000, 50000, 1);
      return { months: [row], totals: {}, missing: {}, missingB2b: {} };
    },
    OPERATING_FLOW_KEYS: domain.OPERATING_FLOW_KEYS,
    OPERATING_STOCK_KEYS: domain.OPERATING_STOCK_KEYS,
  };
  const rows = [
    { id: 'r1', brand_id: 'b1', channel: 'X', month: '2027-01', qty: 1 },
    { id: 'r2', brand_id: 'b2', channel: 'X', month: '2027-01', qty: 1 },
  ];
  const h = makeAppHarness(rows, [], [], [], stubD);
  const data = h.planningOperatingData(rows, [], ['2027-01']);
  assert.equal(data.months[0].revenue, 80000);
  assert.equal(data.months[0].paidEom, 2);
  assert.equal(data.months[0].arppuEffective, 40000, 'ARPPU gộp = 80.000 / 2');
  assert.equal(data.totals.arppuEffective, 40000, 'cột Tổng lấy ARPPU tháng cuối đã tính lại');
});

test('B-II10 [domain + static]: OPERATING_FLOW_KEYS/STOCK_KEYS ở domain, rời nhau, không chứa arppuEffective; app suy OPERATING_KEYS từ đó', () => {
  assert.ok(Array.isArray(domain.OPERATING_FLOW_KEYS) && Array.isArray(domain.OPERATING_STOCK_KEYS));
  assert.deepEqual(domain.OPERATING_FLOW_KEYS.filter((k) => domain.OPERATING_STOCK_KEYS.includes(k)), []);
  assert.ok(!domain.OPERATING_FLOW_KEYS.includes('arppuEffective') && !domain.OPERATING_STOCK_KEYS.includes('arppuEffective'));
  assert.match(src, /D\.OPERATING_FLOW_KEYS\.concat\(D\.OPERATING_STOCK_KEYS\)/);
  assert.match(src, /OPERATING_STOCK_SET\[k\]/);
});

// =====================================================================
// II-8 CAC một phép chia + II-9 tháng kỳ + II-11 kpiActualDisplay + II-4
// =====================================================================
test('B-II8 [static + unit]: planningKpiData dùng cacFor ở cả 4 chỗ (ô, tổng channel, blended tháng, blended kỳ); cacFor đúng điều kiện null', () => {
  const kpiFn = section('function planningKpiData', '// Chỉ số ĐẾM của Planning');
  assert.equal((kpiFn.match(/cacFor\(/g) || []).length, 4);
  const h = makeAppHarness([], [], [], []);
  assert.equal(h.cacFor(1000, 4), 250);
  assert.equal(h.cacFor(1000, 0), null);
  assert.equal(h.cacFor(1000, null), null);
});

test('B-II9 [domain + static]: danh sách tháng kỳ năm từ D.planMonthsForYear; viewPlanning gọi nguồn đó', () => {
  assert.equal(domain.planMonthsForYear(2027).length, 12);
  assert.equal(domain.planMonthsForYear(2027)[0], '2027-01');
  assert.equal(domain.planMonthsForYear(2027)[11], '2027-12');
  assert.deepEqual(domain.planMonthsOf([{ month: '2027-03' }]), domain.planMonthsForYear(2027));
  assert.match(section('function viewPlanning()', '// ---------- Planning Theo phase'), /D\.planMonthsForYear\(year\)/);
});

test('B-II11 [unit]: kpiActualDisplay — rollup thắng; unique insufficient không rơi xuống actual tay; không rollup thì kpiDisplay; thiếu -> missing', () => {
  const pureSrc = src.slice(src.indexOf('// R3.1-VIZ-PURE-BEGIN'), src.indexOf('// R3.1-VIZ-PURE-END'));
  const adaptersSrc = section('function listSafe', 'function kpiSummaryHtml');
  const StoreStub = {
    list: (c) => [],
    get: () => null,
  };
  const visibleListStub = (coll) => StoreStub.list(coll);
  const factory = new Function('Store', 'D', 'visibleList', 'cfVal', 'esc', 'fmtNum', 'labelStatus', 'campaignName',
    pureSrc + '\n' + adaptersSrc + '\nreturn { kpiActualDisplay: kpiActualDisplay };');
  const H = factory(StoreStub, domain, visibleListStub, cfValStub, escStub, fmtNumStub, (s) => String(s || ''), () => 'Camp');
  const direct = H.kpiActualDisplay({ id: 'k1', name: 'K1', actual: 50, target: 100, aggregationMode: 'direct', campaignId: 'c1' });
  assert.equal(direct.kind, 'ok'); assert.equal(direct.source, 'rollup'); assert.equal(direct.value, 50);
  const unique = H.kpiActualDisplay({ id: 'k3', name: 'K3', actual: 999, target: 100, aggregationMode: 'unique', campaignId: 'c1' });
  assert.equal(unique.kind, 'insufficient', 'rollup insufficient thắng actual tay 999');
  const missing = H.kpiActualDisplay({ id: 'k2', name: 'K2', target: 100, aggregationMode: 'direct', campaignId: 'c1' });
  assert.equal(missing.kind, 'missing'); assert.equal(missing.label, 'Chưa cập nhật');
  const ratio = H.kpiActualDisplay({ id: 'k4', name: 'K4', aggregationMode: 'ratio', numerator: 30, denominator: 60, target: 1, campaignId: 'c1' });
  assert.equal(ratio.kind, 'ok'); assert.equal(ratio.mode, 'ratio'); approx(ratio.value, 0.5, 'ratio value');
  // Ba nơi hiển thị cùng gọi nguồn này.
  assert.match(section('function vizKpiRowFor', 'function vizKpiProgressHtml'), /kpiActualDisplay\(k\)/);
  assert.match(section('function kpiSummaryHtml', 'function activityTasks'), /kpiActualDisplay\(k\)/);
  assert.match(section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------'), /kpiActualDisplay\(k\)/);
});

test('B-II4 [unit]: đường dự phòng normalizeFunnelSteps CHỈ chạy khi engine không trả totals — engine có hàm thì số qua engine; engine vắng thì dự phòng cho cùng số neo KOL Nano', () => {
  const rows = [{ month: '2027-01', channel: 'KOL Nano', qty: 4, brand_id: 'brand-lumus-ai' }];
  const benchmarks = [{ brand_id: 'brand-lumus-ai', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 }];
  const hNoEngine = makeAppHarness(rows, [], benchmarks, [], {});
  const steps = hNoEngine.forecastFunnelFor(rows, benchmarks);
  assert.equal(steps[0].value, 16000, 'dự phòng (không engine) vẫn cho views neo');
  const hEngine = makeAppHarness(rows, [], benchmarks, []);
  const steps2 = hEngine.forecastFunnelFor(rows, benchmarks);
  assert.equal(steps2[0].value, 16000, 'có engine: cùng số qua engine');
});
