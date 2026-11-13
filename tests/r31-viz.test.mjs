// tests/r31-viz.test.mjs
// R3.1-VIZ — EXECUTOR VISUALIZE: chart-first CHỈ ở lớp trình bày.
// [static] chart có mặt ở đúng view, đọc số qua summarizeBudgetScope /
// rollupKpi (thông qua adapter summarizeCampaignBudget /
// summarizeActivityBudget / kpiRollupFor); [unit] trích xuất vùng helper
// thuần R3.1-VIZ-PURE trong js/app.js và chạy với fixture D.1/D.2 thật
// (domain + demo-data) để chứng minh số trên chart KHÔNG đổi:
// 30/20.5/7.5/28, chưa phân bổ 2, còn dùng được 4, unique 140 = 93,33%,
// CPL 100.000 vs ≈146.429, KPI thiếu khóa → "Chưa đủ dữ liệu" (không số bịa).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const demo = require('../js/demo-data.js');
const D = require('../js/domain.js');

function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// Trích xuất vùng helper thuần của lớp viz để chạy unit thật trên code app.
const pureBegin = src.indexOf('// R3.1-VIZ-PURE-BEGIN');
const pureEnd = src.indexOf('// R3.1-VIZ-PURE-END');
assert.notEqual(pureBegin, -1); assert.notEqual(pureEnd, -1);
const pureSrc = src.slice(pureBegin, pureEnd);
function escStub(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtNumStub(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
function fmtMoneyStub(n, cur) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN') + ' ' + (cur || ''); }
const V = new Function('esc', 'fmtMoney', 'fmtNum',
  pureSrc + '\nreturn { vizPct: vizPct, vizBarWidth: vizBarWidth, vizBudgetRowState: vizBudgetRowState, vizKpiState: vizKpiState, vizCashMonthly: vizCashMonthly, vizMonthLabel: vizMonthLabel, fmtPct: fmtPct, vizBudgetBars: vizBudgetBars, vizBudgetGroupsChartHtml: vizBudgetGroupsChartHtml, vizKpiRowsHtml: vizKpiRowsHtml, vizShareRowsHtml: vizShareRowsHtml, vizCashColumnsHtml: vizCashColumnsHtml };'
)(escStub, fmtMoneyStub, fmtNumStub);

const M = 1000000;
function liveFacts() {
  const lines = demo.budgetLines.filter((b) => b.campaignId === 'camp-live');
  const lineIds = new Set(lines.map((l) => l.id));
  return {
    lines,
    commitments: demo.commitments.filter((x) => lineIds.has(x.budgetLineId)),
    actuals: demo.actuals.filter((x) => lineIds.has(x.budgetLineId)),
  };
}
function campaignSummary() {
  const { lines, commitments, actuals } = liveFacts();
  const camp = demo.campaigns.find((c) => c.id === 'camp-live');
  const child = demo.activities.filter((a) => a.campaignId === 'camp-live').map((a) => ({
    activityId: a.id, scopeId: a.id, currency: 'VND',
    amount: lines.filter((l) => l.activityId === a.id).reduce((s, l) => s + l.approved, 0),
  }));
  return D.summarizeBudgetScope({ ceiling: camp.budgetCeiling, currency: 'VND', childAllocations: child, commitments, actuals });
}

// ---------- [static] 1. Tổng quan campaign: chart trước, bảng dưới ----------
test('R3.1-VIZ [static]: tổng quan campaign — chart phân bổ theo action TRƯỚC bảng chi tiết C.7, hai số Chưa phân bổ / Còn dùng được tách biệt', () => {
  const detail = section('function campaignDetailHtml(id)', '// ---------- R3.1: Content Plan');
  assert.match(detail, /summarizeCampaignBudget\(c\)/);
  assert.match(detail, /vizBudgetActionChartHtml\(c\)/);
  assert.ok(detail.indexOf('vizBudgetActionChartHtml(c)') < detail.indexOf('Bảng số chi tiết ngân sách'), 'chart phải nằm trên bảng số chi tiết');
  assert.match(detail, /data-viz="campaign-budget-note"/);
  assert.match(detail, /Chưa phân bổ: <strong>/);
  assert.match(detail, /Còn dùng được: <strong>/);
  assert.match(detail, /là hai số tách biệt, không gộp/);
  for (const label of ['Hạn mức', 'Đã phân bổ', 'Chưa phân bổ', 'Thực chi', 'Cam kết chưa trả', 'Dự kiến sử dụng', 'Còn dùng được']) {
    assert.ok(detail.includes('<th>' + label + '</th>'), 'bảng chi tiết thiếu cột: ' + label);
  }
  assert.match(detail, /Hai số này khác nhau và không cộng lẫn nhau/);
});

test('R3.1-VIZ [static]: tổng quan campaign — thanh tiến độ KPI qua rollupKpi + bảng KPI ngay dưới chart', () => {
  const detail = section('function campaignDetailHtml(id)', '// ---------- R3.1: Content Plan');
  assert.match(detail, /data-viz="campaign-kpi-chart"/);
  assert.match(detail, /vizKpiProgressHtml\(ovKpis\)/);
  assert.match(detail, /vizKpiTableHtml\(ovKpis\)/);
  assert.ok(detail.indexOf('vizKpiProgressHtml(ovKpis)') < detail.indexOf('vizKpiTableHtml(ovKpis)'), 'chart KPI phải nằm trên bảng KPI');
  const viz = section('// ---------- R3.1-VIZ:', 'function campaignDetailHtml(id)');
  assert.match(viz, /kpiRollupFor\(k\)/);
  assert.match(viz, /D\.kpiDisplay\(k\)/);
});

test('R3.1-VIZ [static]: chart ngân sách theo action đọc số qua summarizeActivityBudget → summarizeBudgetScope (không cộng tiền ở lớp viz)', () => {
  const viz = section('// ---------- R3.1-VIZ:', 'function campaignDetailHtml(id)');
  assert.match(viz, /function vizBudgetActionChartHtml\(c\)/);
  assert.match(viz, /summarizeActivityBudget\(c, a\)/);
  assert.match(viz, /vizBudgetBars\(r\.ceiling, r\.actualTotal, r\.openCommitments\)/);
  // Vùng helper thuần không chạm Store/domain/fact gốc — chỉ nhận số đã chốt.
  assert.doesNotMatch(pureSrc, /Store\.|SAVA_DOMAIN|budgetLines|commitments/);
  assert.doesNotMatch(pureSrc, /summarizeBudgetScope|rollupKpi/);
});

// ---------- [static] 2. Tổng quan workspace ----------
test('R3.1-VIZ [static]: viewOverview gắn khối chart workspace (ngân sách theo campaign, KPI nổi bật, content mix, Thu–Chi) + trạng thái trống rõ ràng', () => {
  const ov = section('function viewOverview()', '// ---------- Việc của tôi ----------');
  assert.match(ov, /workspaceChartsHtml\(\)/);
  const ws = section('function workspaceChartsHtml()', '// ---------- R3.1: Action Plan');
  assert.match(ws, /summarizeCampaignBudget\(c\)/);
  assert.match(ws, /data-viz="workspace-budget-chart"/);
  assert.match(ws, /data-viz="workspace-budget-empty"/);
  assert.match(ws, /vizKpiProgressHtml\(featured\)/);
  assert.match(ws, /contentMixRows\(mixItems, mixPubs, mixUnit\)/);
  assert.match(ws, /UI\.contentMixUnit/);
  assert.match(ws, /data-viz="workspace-content-mix"/);
  assert.match(ws, /cashChartHtml\(\)/);
  const cash = section('function cashChartHtml()', 'function workspaceChartsHtml()');
  assert.match(cash, /data-viz="cash-empty"/);
  assert.match(cash, /không vẽ số 0 giả làm dữ liệu/);
  assert.match(cash, /vizCashMonthly\(txns, accCur\)/);
  assert.match(cash, /vizCashBalancesSync\(\)/);
});

// ---------- [static] 3. Action Plan + drawer ----------
test('R3.1-VIZ [static]: Action Plan thêm thanh % task ở cột Đầu ra + thanh ngân sách đã dùng/phân bổ ở cột Ngân sách (kèm cảnh báo vượt)', () => {
  const plan = section('function actionPlanHtml(c)', 'function activityDrawerHtml()');
  assert.match(plan, /data-viz="action-task-progress"/);
  assert.match(plan, /vizPct\(info\.done, info\.total\)/);
  assert.match(plan, /budgetRows\.map\(function \(r\) \{ return vizBudgetUsedBarHtml\(r\); \}\)/);
  assert.match(plan, /budgetSummaryText\(budgetRows\)/); // số text cũ giữ nguyên cạnh chart
  const viz = section('// ---------- R3.1-VIZ:', 'function campaignDetailHtml(id)');
  assert.match(viz, /data-viz="budget-used-bar"/);
  assert.match(viz, /Đã dùng \(thực chi \+ cam kết\)/);
  assert.match(viz, /Vượt phân bổ/);
  assert.match(viz, /vizBudgetRowState\(r\)/);
});

test('R3.1-VIZ [static]: drawer hoạt động tab Overview có mini-chart ngân sách action + tiến độ KPI action', () => {
  const drawer = section('function activityDrawerHtml()', 'function campaignDetailHtml(id)');
  assert.match(drawer, /data-viz="activity-mini-charts"/);
  assert.match(drawer, /data-viz="activity-mini-budget"/);
  assert.match(drawer, /data-viz="activity-mini-kpi"/);
  assert.match(drawer, /vizKpiProgressHtml\(kpis\)/);
  assert.match(drawer, /vizBudgetGroupsChartHtml\(budgetRows\.map/);
});

// ---------- [static] 4. Content mix ----------
test('R3.1-VIZ [static]: content mix có chart pillar + kênh dùng đúng đơn vị đếm đang chọn, in mẫu số tại chart, bảng giữ dưới chart', () => {
  const view = section('function viewContent()', '// ---------- Công việc ----------');
  const mixAt = view.indexOf("UI.contentTab === 'mix'");
  assert.notEqual(mixAt, -1);
  const mixSec = view.slice(mixAt);
  assert.match(mixSec, /vizMixChartHtml\(mix, unit\)/);
  assert.ok(mixSec.indexOf('vizMixChartHtml(mix, unit)') < mixSec.indexOf('Tỷ trọng'), 'chart mix phải nằm trên bảng số');
  const viz = section('// ---------- R3.1-VIZ:', 'function campaignDetailHtml(id)');
  assert.match(viz, /content-mix-pillar-chart/);
  assert.match(viz, /content-mix-channel-chart/);
  assert.match(viz, /Mẫu số:/);
  // Tags phụ vẫn không cộng tổng (ghi chú cũ giữ nguyên ở view).
  assert.match(mixSec, /tỷ trọng theo tags KHÔNG cộng ra tổng/);
});

// ---------- [static] 5. KPI & Ngân sách / Thu–Chi ----------
test('R3.1-VIZ [static]: viewKpi — chart so sánh KPI (thanh tỉ lệ) + chart ngân sách theo campaign/hoạt động + khối Thu–Chi có chart cột theo tháng', () => {
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /data-viz="kpi-page-chart"/);
  assert.match(kpi, /vizKpiProgressHtml\(kpis\)/);
  assert.ok(kpi.indexOf('vizKpiProgressHtml(kpis)') < kpi.indexOf('<th>Định nghĩa / kỳ</th>'), 'chart KPI nằm trên bảng chi tiết');
  assert.match(kpi, /data-viz="kpi-page-budget-chart"/);
  assert.match(kpi, /summarizeCampaignBudget\(c2\)/);
  assert.match(kpi, /summarizeActivityBudget\(c2, a\)/);
  assert.match(kpi, /Thu–Chi &amp; Ngân sách \(sổ quỹ\)/);
  assert.match(kpi, /cashChartHtml\(\)/);
  const cash = section('function cashChartHtml()', 'function workspaceChartsHtml()');
  assert.match(cash, /Biểu đồ cột Thu \/ Chi theo tháng/);
  assert.match(cash, /Số dư theo tài khoản/);
  assert.match(cash, /Giao dịch Thu–Chi/);
});

// ---------- [static] 6. Hồi quy trình bày + responsive + không lib ngoài ----------
test('R3.1-VIZ [static]: không dùng thư viện chart ngoài/CDN; CSS chart có cuộn ngang trong khối + breakpoint 480px; Gantt giữ nguyên builder/ID', () => {
  assert.doesNotMatch(src + css, /chart\.js|\becharts\b|\bhighcharts\b|cdn\.jsdelivr|unpkg\.com/i);
  assert.match(css, /\.viz-chart\{[^}]*overflow-x:auto/);
  assert.match(css, /\.viz-scroll-inner\{min-width:540px\}/);
  assert.match(css, /@media\(max-width:480px\)\{[^}]*\.viz-row/);
  assert.match(src, /function ganttHtml\(/);
  assert.match(src, /ganttRowsCampaign\(c\)/);
  assert.match(src, /ganttRowsPortfolio\(\)/);
  assert.match(src, /data-gantt-drag/);
});

// ---------- [unit] helper thuần ----------
test('R3.1-VIZ [unit]: vizPct / vizBarWidth — 140/150 = 93,33; chặn bề rộng thanh 0–100; mẫu số 0 → null (không bịa %)', () => {
  assert.equal(V.vizPct(140, 150), 93.33);
  assert.equal(V.vizPct(20.5, 30), 68.33);
  assert.equal(V.vizPct(1, 0), null);
  assert.equal(V.vizPct(null, 10), null);
  assert.equal(V.vizBarWidth(120), 100);
  assert.equal(V.vizBarWidth(-5), 0);
  assert.equal(V.vizBarWidth(null), 0);
  assert.equal(V.fmtPct(93.33), '93,33%');
});

test('R3.1-VIZ [unit]: chart ngân sách từ fixture D.1 qua domain cho đúng 30/20.5/7.5 và đã dùng 28 (87,5% của hạn mức 32)', () => {
  const s = campaignSummary();
  assert.equal(s.allocated, 30 * M);
  assert.equal(s.actualTotal, 20.5 * M);
  assert.equal(s.openCommitments, 7.5 * M);
  assert.equal(s.forecastUse, 28 * M);
  assert.equal(s.unallocated, 2 * M);
  assert.equal(s.available, 4 * M);
  const html = V.vizBudgetGroupsChartHtml([{ title: 'Livestream (VND)', currency: 'VND', bars: V.vizBudgetBars(s.allocated, s.actualTotal, s.openCommitments) }]);
  assert.match(html, /data-viz="budget-groups-chart"/);
  assert.match(html, /30\.000\.000/);
  assert.match(html, /20\.500\.000/);
  assert.match(html, /7\.500\.000/);
  for (const label of ['Phân bổ', 'Thực chi', 'Cam kết chưa trả']) assert.ok(html.includes(label), 'thiếu thanh: ' + label);
  const st = V.vizBudgetRowState(s);
  assert.equal(st.used, 28 * M);
  assert.equal(st.usedPct, 87.5);
  assert.equal(st.over, false);
  assert.equal(st.warn, false, 'còn dùng được 4tr > 0 thì không cảnh báo');
});

test('R3.1-VIZ [unit]: trạng thái ngân sách từng action (D.1) — action hết hạn mức (còn 0) thì warn, Ads còn 1tr thì không warn và % đã dùng 93,33', () => {
  const { commitments, actuals } = liveFacts();
  const ceilings = { 'act-live-invite': 8, 'act-live-ads': 15, 'act-live-seeding': 5, 'act-live-show': 2 };
  const expectedAvail = { 'act-live-invite': 0, 'act-live-ads': 1, 'act-live-seeding': 1, 'act-live-show': 0 };
  for (const [aid, avail] of Object.entries(expectedAvail)) {
    const s = D.summarizeBudgetScope({ ceiling: ceilings[aid] * M, currency: 'VND', scopeId: aid, commitments, actuals });
    assert.equal(s.available, avail * M, aid);
    const st = V.vizBudgetRowState(s);
    assert.equal(st.warn, avail <= 0, aid + ': còn ≤ 0 phải cảnh báo, còn > 0 thì không');
    assert.equal(st.over, false, aid);
  }
  const ads = D.summarizeBudgetScope({ ceiling: 15 * M, currency: 'VND', scopeId: 'act-live-ads', commitments, actuals });
  assert.equal(V.vizBudgetRowState(ads).usedPct, 93.33);
  const over = V.vizBudgetRowState({ ceiling: 10 * M, actualTotal: 9 * M, openCommitments: 3 * M, forecastUse: 12 * M, available: -2 * M });
  assert.equal(over.over, true);
  assert.equal(over.warn, true);
});

test('R3.1-VIZ [unit]: KPI unique D.2 qua rollupKpi → thanh tiến độ hiện 140/150 và 93,33%', () => {
  const byId = Object.fromEntries(demo.kpis.map((k) => [k.id, k]));
  const camp = byId['kpi-live-campaign-reg'];
  const facts = demo.kpiContributions.filter((c) => c.kpiId === camp.id).map((c) => {
    const sk = byId[c.sourceKpiId];
    return { id: 'fact-' + sk.id, metricCode: sk.metricCode, unit: sk.unit, period: sk.periodKey, value: sk.actual, identities: sk.identityKeys };
  });
  const r = D.rollupKpi(facts, { mode: 'unique', metricCode: 'valid_registrations', unit: 'người', period: '2026-11', target: 150 });
  assert.equal(r.value, 140);
  assert.equal(r.achievementPercent, 93.33);
  const st = V.vizKpiState(r);
  assert.equal(st.kind, 'ok');
  assert.equal(st.pct, 93.33);
  const html = V.vizKpiRowsHtml([{ name: camp.name, scopeLabel: 'Campaign: Livestream', state: st, actualText: '140 người', targetText: '150 người' }]);
  assert.match(html, /data-viz-kpi-state="ok"/);
  assert.match(html, /140 người \/ 150 người \(93,33%\)/);
  assert.match(html, /width:93\.33%/);
});

test('R3.1-VIZ [unit]: KPI unique THIẾU khóa định danh → rollup insufficient_data → chart hiện thanh rỗng "Chưa đủ dữ liệu", không vẽ số bịa', () => {
  const r = D.rollupKpi(
    [{ id: 'f-no-key', metricCode: 'valid_registrations', unit: 'người', period: '2026-11', value: 50 }],
    { mode: 'unique', metricCode: 'valid_registrations', unit: 'người', period: '2026-11', target: 150 });
  assert.equal(r.status, 'insufficient_data');
  assert.equal(r.value, null);
  const st = V.vizKpiState(r);
  assert.equal(st.kind, 'insufficient_data');
  assert.equal(st.label, 'Chưa đủ dữ liệu');
  const html = V.vizKpiRowsHtml([{ name: 'KPI thiếu khóa', scopeLabel: 'Campaign: X', state: st, actualText: '', targetText: '150 người' }]);
  assert.match(html, /data-viz-kpi-state="insufficient_data"/);
  assert.match(html, /viz-track-empty/);
  assert.match(html, /Chưa đủ dữ liệu/);
  assert.doesNotMatch(html, /50 người/);
  assert.doesNotMatch(html, /\(33,33%\)/);
});

test('R3.1-VIZ [unit]: CPL hai scope qua rollupKpi ratio — Ads 100.000 vs campaign ≈146.429 (chart dùng đúng số domain)', () => {
  const byId = Object.fromEntries(demo.kpis.map((k) => [k.id, k]));
  const ads = D.rollupKpi([], { mode: 'ratio', numerator: byId['kpi-live-ads-cpl'].numerator, denominator: byId['kpi-live-ads-cpl'].denominator });
  const camp = D.rollupKpi([], { mode: 'ratio', numerator: byId['kpi-live-campaign-cpl'].numerator, denominator: byId['kpi-live-campaign-cpl'].denominator });
  assert.equal(V.vizKpiState(ads).value, 100000);
  assert.equal(Math.round(V.vizKpiState(camp).value), 146429);
});

test('R3.1-VIZ [unit]: vizShareRowsHtml in rõ mẫu số + tỷ trọng đúng (3/4 = 75%, 1/4 = 25%)', () => {
  const html = V.vizShareRowsHtml([{ label: 'Pillar A', total: 3 }, { label: 'Pillar B', total: 1 }], 4, 'nội dung gốc', 'content-mix-pillar-chart');
  assert.match(html, /data-viz="content-mix-pillar-chart"/);
  assert.match(html, /Mẫu số: <strong>4<\/strong> nội dung gốc/);
  assert.match(html, /3 \(75%\)/);
  assert.match(html, /1 \(25%\)/);
});

test('R3.1-VIZ [unit]: vizCashMonthly gom Thu/Chi theo tháng đúng + chart cột có nhãn tháng dd/mm dạng Tháng m/yyyy và số tiền', () => {
  const txns = [
    { accountId: 'acc-1', direction: 'in', amount: 500000, occurredOn: '2026-11-05' },
    { accountId: 'acc-1', direction: 'out', amount: 200000, occurredOn: '2026-11-12' },
    { accountId: 'acc-1', direction: 'in', amount: 300000, occurredOn: '2026-10-01' },
  ];
  const monthly = V.vizCashMonthly(txns, () => 'VND');
  assert.equal(monthly.length, 2);
  const nov = monthly.find((m) => m.month === '2026-11');
  assert.equal(nov.inTotal, 500000);
  assert.equal(nov.outTotal, 200000);
  assert.equal(nov.net, 300000);
  assert.equal(V.vizMonthLabel('2026-11'), 'Tháng 11/2026');
  const html = V.vizCashColumnsHtml(monthly, 'VND');
  assert.match(html, /data-viz="cash-columns"/);
  assert.match(html, /Tháng 11\/2026/);
  assert.match(html, /Thu 500\.000/);
  assert.match(html, /Chi 200\.000/);
});
