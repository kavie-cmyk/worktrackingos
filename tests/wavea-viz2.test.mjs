// tests/wavea-viz2.test.mjs
// WAVE-A-VIZ2 — hệ trực quan thống nhất (DESIGN_SYSTEM_SPEC §2/§3):
// [static] biến màu duy nhất trong styles.css, statusBadge là alias của
// vizStatusPillHtml, Gantt có legend + chấm trạng thái + viền trễ/chặn,
// Tổng quan dùng vizKpiCardHtml + bảng risk + vizProgressBarHtml;
// [unit] helper THUẦN mới chạy trên fixture D.1/D.2 thật (domain +
// demo-data): số trên helper mới phải khớp số domain đã chốt ở R3.1.

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

const pureBegin = src.indexOf('// R3.1-VIZ-PURE-BEGIN');
const pureEnd = src.indexOf('// R3.1-VIZ-PURE-END');
assert.notEqual(pureBegin, -1); assert.notEqual(pureEnd, -1);
const pureSrc = src.slice(pureBegin, pureEnd);
function escStub(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtNumStub(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
function fmtMoneyStub(n, cur) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN') + ' ' + (cur || ''); }
const LABELS = { in_progress: 'Đang làm', active: 'Đang chạy', cancelled: 'Đã hủy', pending: 'Chờ duyệt', completed: 'Hoàn thành', draft: 'Nháp', blocked: 'Bị chặn', rejected: 'Đã từ chối', todo: 'Chưa bắt đầu' };
function labelStatusStub(s) { if (s === null || s === undefined || s === '') return '—'; return LABELS[String(s).toLowerCase()] || String(s); }
const V = new Function('esc', 'fmtMoney', 'fmtNum', 'labelStatus',
  pureSrc + '\nreturn { STATUS_TONE: STATUS_TONE, vizStatusTone: vizStatusTone, vizStatusPillHtml: vizStatusPillHtml, vizStatusDotHtml: vizStatusDotHtml, vizLegendHtml: vizLegendHtml, vizEmptyChartHtml: vizEmptyChartHtml, vizProgressBarHtml: vizProgressBarHtml, vizHBarHtml: vizHBarHtml, vizCellBarHtml: vizCellBarHtml, vizStackedBarHtml: vizStackedBarHtml, vizDonutSvgHtml: vizDonutSvgHtml, vizLineAreaSvgHtml: vizLineAreaSvgHtml, vizDeltaHtml: vizDeltaHtml, vizKpiCardHtml: vizKpiCardHtml, vizCalDotsHtml: vizCalDotsHtml, vizWorkloadBarHtml: vizWorkloadBarHtml, vizPct: vizPct, vizKpiState: vizKpiState };'
)(escStub, fmtMoneyStub, fmtNumStub, labelStatusStub);

const M = 1000000;
function campaignSummary() {
  const lines = demo.budgetLines.filter((b) => b.campaignId === 'camp-live');
  const lineIds = new Set(lines.map((l) => l.id));
  const camp = demo.campaigns.find((c) => c.id === 'camp-live');
  const child = demo.activities.filter((a) => a.campaignId === 'camp-live').map((a) => ({
    activityId: a.id, scopeId: a.id, currency: 'VND',
    amount: lines.filter((l) => l.activityId === a.id).reduce((s, l) => s + l.approved, 0),
  }));
  return D.summarizeBudgetScope({
    ceiling: camp.budgetCeiling, currency: 'VND', childAllocations: child,
    commitments: demo.commitments.filter((x) => lineIds.has(x.budgetLineId)),
    actuals: demo.actuals.filter((x) => lineIds.has(x.budgetLineId)),
  });
}

// ---------- [static] màu + điểm dùng chung ----------
test('WAVE-A [static]: styles.css có đủ biến --st-*/--series-*/--cat-* đúng hex đặc tả, biến cũ giữ nguyên', () => {
  const expected = {
    '--st-running:#2456a6': 1, '--st-running-bg:#e8eefb': 1, '--st-done:#067647': 1, '--st-done-bg:#ecfdf3': 1,
    '--st-overdue:#b42318': 1, '--st-overdue-bg:#fef2f2': 1, '--st-blocked:#7c5cd6': 1, '--st-blocked-bg:#f0ebfd': 1,
    '--st-pending:#b45309': 1, '--st-pending-bg:#fef3c7': 1, '--st-pending-fill:#f79009': 1,
    '--st-todo:#66707e': 1, '--st-cancelled:#98a2b3': 1, '--st-neutral:#66707e': 1,
    '--series-alloc:#2456a6': 1, '--series-actual:#0e9384': 1, '--series-commit:#f79009': 1, '--series-in:#067647': 1, '--series-out:#b54708': 1,
    '--cat-1:#2456a6': 1, '--cat-2:#0e9384': 1, '--cat-3:#7c5cd6': 1, '--cat-4:#b54708': 1, '--cat-5:#b45309': 1, '--cat-6:#067647': 1, '--cat-7:#98a2b3': 1, '--cat-8:#66707e': 1,
    '--track:#eaedf1': 1, '--accent:#2456a6': 1, '--ok:#067647': 1, '--warn:#b45309': 1, '--bad:#b42318': 1,
  };
  for (const kv of Object.keys(expected)) assert.ok(css.includes(kv), 'CSS thiếu biến: ' + kv);
  for (const cls of ['.badge.st-running', '.badge.st-done', '.badge.st-overdue', '.badge.st-blocked', '.badge.st-pending', '.badge.st-cancelled', '.viz-kpi-card', '.viz-stacked', '.viz-donut-wrap', '.viz-cal-dots', '.badge.pill-series-in', '.badge.pill-series-out']) {
    assert.ok(css.includes(cls), 'CSS thiếu class: ' + cls);
  }
  // Gantt: done giữ màu loại (override theo kind), trễ/chặn qua viền.
  assert.match(css, /\.g2-bar\.kind-task\.is-done\{background-color:var\(--cat-1\)\}/);
  assert.match(css, /\.g2-bar\.is-overdue\{outline:2px solid var\(--st-overdue\)/);
  assert.match(css, /\.g2-bar\.is-blocked\{outline:2px solid var\(--st-blocked\)/);
});

test('WAVE-A [static]: statusBadge là alias vizStatusPillHtml; Gantt có legend + chấm + viền; Tổng quan dùng KPI card + bảng risk + progress mới', () => {
  assert.match(src, /function statusBadge\(status, label\) \{\s*return vizStatusPillHtml\(status, \{ label: label \}\);/);
  assert.match(src, /chartId: 'gantt-legend'/);
  assert.match(src, /vizStatusDotHtml\(rowTone/);
  assert.match(src, /' is-overdue'/);
  assert.match(src, /' is-blocked'/);
  assert.match(src, /function vizTaskDerivedTone\(t\)/);
  assert.match(src, /D\.assessTaskRisk\(t,/);
  const ov = section('function viewOverview()', '// ---------- Việc của tôi ----------');
  assert.match(ov, /vizKpiCardHtml\(\{ label: 'Campaign đang chạy'/);
  assert.match(ov, /vizKpiCardHtml\(\{ label: 'Việc quá hạn'/);
  assert.match(ov, /vizKpiCardHtml\(\{ label: 'Campaign nguy cơ trễ'/);
  assert.match(ov, /data-viz="overview-risk-table"/);
  assert.match(ov, /vizCellBarHtml\(\{ value: r\.affectedCount, max: r\.totalCount, tone: 'overdue'/);
  assert.doesNotMatch(ov, /class="progress"/);
  const camps = section('function viewCampaigns()', '// ---------- R3.1-VIZ:');
  assert.doesNotMatch(camps, /class="progress"/);
  assert.match(camps, /vizProgressBarHtml\(\{ value: p\.completed, max: p\.total, pct: p\.percentage/);
  // Vùng PURE vẫn thuần: không chạm Store/domain/công thức nghiệp vụ.
  assert.doesNotMatch(pureSrc, /Store\.|SAVA_DOMAIN|budgetLines|commitments/);
  assert.doesNotMatch(pureSrc, /summarizeBudgetScope|rollupKpi/);
  assert.doesNotMatch(src + css, /chart\.js|\becharts\b|\bhighcharts\b|cdn\.jsdelivr|unpkg\.com/i);
});

// ---------- [unit] trạng thái ----------
test('WAVE-A [unit]: vizStatusTone — ánh xạ §2.3 (đang chạy ≠ chờ duyệt; blocked tím riêng; open của blocker = blocked)', () => {
  assert.equal(V.vizStatusTone('in_progress'), 'running');
  assert.equal(V.vizStatusTone('active'), 'running');
  assert.equal(V.vizStatusTone('scheduled'), 'running');
  assert.equal(V.vizStatusTone('completed'), 'done');
  assert.equal(V.vizStatusTone('approved'), 'done');
  assert.equal(V.vizStatusTone('pending'), 'pending');
  assert.equal(V.vizStatusTone('in_review'), 'pending');
  assert.equal(V.vizStatusTone('changes_requested'), 'pending');
  assert.equal(V.vizStatusTone('blocked'), 'blocked');
  assert.equal(V.vizStatusTone('open', 'blocker'), 'blocked');
  assert.equal(V.vizStatusTone('open'), 'running');
  assert.equal(V.vizStatusTone('rejected'), 'overdue');
  assert.equal(V.vizStatusTone('overdue'), 'overdue');
  assert.equal(V.vizStatusTone('todo'), 'todo');
  assert.equal(V.vizStatusTone('cancelled'), 'cancelled');
  assert.equal(V.vizStatusTone('draft'), 'neutral');
  assert.equal(V.vizStatusTone('paused'), 'neutral');
  assert.equal(V.vizStatusTone('ma-la'), 'neutral');
  assert.equal(V.vizStatusTone(''), 'neutral');
});

test('WAVE-A [unit]: vizStatusPillHtml — nhãn giữ nguyên từ labelStatus, class theo tông; cancelled có gạch ngang', () => {
  const run = V.vizStatusPillHtml('in_progress');
  assert.match(run, /class="badge st-running"/);
  assert.match(run, />Đang làm</);
  assert.match(run, /data-viz-tone="running"/);
  const can = V.vizStatusPillHtml('cancelled');
  assert.match(can, /st-cancelled viz-cancelled/);
  assert.match(can, />Đã hủy</);
  const blocked = V.vizStatusPillHtml('blocked', { label: 'Bị chặn: Việc A', derived: true });
  assert.match(blocked, /st-blocked/);
  assert.match(blocked, /data-viz-derived="1"/);
  const dot = V.vizStatusDotHtml('overdue', 'Trễ');
  assert.match(dot, /viz-dot st-bg-overdue/);
});

test('WAVE-A [unit]: vizLegendHtml dùng class tông/series (không chép hex), vizEmptyChartHtml có data-viz', () => {
  const html = V.vizLegendHtml([{ label: 'Thực chi', series: 'actual' }, { label: 'Trễ', tone: 'overdue' }, { label: 'Ghi chú', noDot: true }]);
  assert.match(html, /data-viz="legend"/);
  assert.match(html, /viz-dot series-actual/);
  assert.match(html, /viz-dot st-bg-overdue/);
  assert.doesNotMatch(html, /#0e9384|#f79009|#b42318|style="background/);
  assert.equal((html.match(/viz-dot/g) || []).length, 2, 'mục noDot không có chấm');
  assert.match(V.vizEmptyChartHtml('Chưa có số liệu'), /data-viz="empty-chart"/);
  assert.match(V.vizEmptyChartHtml('Chưa có số liệu'), /Chưa có số liệu/);
});

// ---------- [unit] thanh & thẻ ----------
test('WAVE-A [unit]: vizProgressBarHtml — 140/150 = 93,33% đúng fixture KPI D.2; 100% -> done; thiếu % -> track sọc', () => {
  const byId = Object.fromEntries(demo.kpis.map((k) => [k.id, k]));
  const camp = byId['kpi-live-campaign-reg'];
  const facts = demo.kpiContributions.filter((c) => c.kpiId === camp.id).map((c) => {
    const sk = byId[c.sourceKpiId];
    return { id: 'fact-' + sk.id, metricCode: sk.metricCode, unit: sk.unit, period: sk.periodKey, value: sk.actual, identities: sk.identityKeys };
  });
  const r = D.rollupKpi(facts, { mode: 'unique', metricCode: 'valid_registrations', unit: 'người', period: '2026-11', target: 150 });
  assert.equal(r.achievementPercent, 93.33);
  const html = V.vizProgressBarHtml({ value: r.value, max: 150, pct: r.achievementPercent, tone: 'running' });
  assert.match(html, /data-viz="progress-bar"/);
  assert.match(html, /width:93\.33%/);
  assert.match(html, /140 \/ 150 \(93,33%\)/);
  assert.match(V.vizProgressBarHtml({ value: 10, max: 10, pct: 100 }), /data-viz-tone="done"/);
  assert.match(V.vizProgressBarHtml({ value: null, max: null }), /viz-track-empty/);
});

test('WAVE-A [unit]: vizCellBarHtml + vizHBarHtml — bề rộng kẹp 0–100, text giữ nguyên số đã chốt', () => {
  const cell = V.vizCellBarHtml({ value: 3, max: 4, tone: 'overdue', text: '3/4 việc bị ảnh hưởng (75%)' });
  assert.match(cell, /data-viz="cell-bar"/);
  assert.match(cell, /width:75%/);
  assert.match(cell, /3\/4 việc bị ảnh hưởng \(75%\)/);
  const bar = V.vizHBarHtml({ label: 'Ads', value: 14, max: 15, series: 'actual', valueText: '14/15 (93,33%)' });
  assert.match(bar, /data-viz="hbar"/);
  assert.match(bar, /viz-fill series-actual/);
  assert.match(bar, /width:93\.33%/);
});

test('WAVE-A [unit]: vizStackedBarHtml trên fixture ngân sách D.1 — đoạn 20,5/7,5/4 trên mẫu số 32tr khớp tỉ lệ domain', () => {
  const s = campaignSummary();
  assert.equal(s.actualTotal, 20.5 * M); assert.equal(s.openCommitments, 7.5 * M); assert.equal(s.available, 4 * M);
  const html = V.vizStackedBarHtml({
    segments: [
      { label: 'Thực chi', value: s.actualTotal, series: 'actual' },
      { label: 'Cam kết chưa trả', value: s.openCommitments, series: 'commit' },
      { label: 'Còn có thể dùng', value: s.available, tone: 'done' },
    ],
    total: 32 * M, unitLabel: 'VND (hạn mức campaign)',
  });
  assert.match(html, /data-viz="stacked-bar"/);
  assert.match(html, /Mẫu số: <strong>32\.000\.000<\/strong>/);
  assert.match(html, /width:64\.06%/);
  assert.match(html, /width:23\.44%/);
  assert.match(html, /width:12\.5%/);
  assert.match(V.vizStackedBarHtml({ segments: [], total: 0 }), /data-viz="empty-chart"/);
});

test('WAVE-A [unit]: vizDonutSvgHtml — 3/4 = 75%, 1/4 = 25% trong title + legend; rỗng -> empty', () => {
  const html = V.vizDonutSvgHtml({ segments: [{ label: 'Pillar A', value: 3 }, { label: 'Pillar B', value: 1 }], total: 4, centerLabel: 'Nội dung', unitLabel: 'nội dung gốc' });
  assert.match(html, /data-viz="donut"/);
  assert.match(html, /<svg class="viz-donut-svg"/);
  assert.match(html, /Pillar A 3 \(75%\)/);
  assert.match(html, /Pillar B 1 \(25%\)/);
  assert.match(html, /Mẫu số: <strong>4<\/strong> nội dung gốc/);
  assert.match(V.vizDonutSvgHtml({ segments: [], total: 0 }), /data-viz="empty-chart"/);
});

test('WAVE-A [unit]: vizLineAreaSvgHtml — điểm y=null làm đứt đường (2 đoạn), không NaN; toàn null -> empty', () => {
  const html = V.vizLineAreaSvgHtml({ points: [{ x: 'T9', y: 100 }, { x: 'T10', y: 150 }, { x: 'T11', y: null }, { x: 'T12', y: 120 }], yLabel: 'Ròng' });
  assert.match(html, /data-viz="line-area"/);
  assert.doesNotMatch(html, /NaN/);
  const linePaths = (html.match(/fill="none" stroke="var\(--st-running\)"/g) || []).length;
  assert.equal(linePaths, 1, 'chỉ 1 đoạn liên tục có >=2 điểm mới vẽ line; đoạn 1 điểm chỉ có chấm');
  assert.match(html, /Điểm đầu: T9 = 100/);
  assert.match(html, /điểm cuối: T12 = 120/);
  const two = V.vizLineAreaSvgHtml({ points: [{ x: 'A', y: 1 }, { x: 'B', y: 2 }, { x: 'C', y: null }, { x: 'D', y: 3 }, { x: 'E', y: 4 }] });
  assert.equal((two.match(/fill="none" stroke="var\(--st-running\)"/g) || []).length, 2, 'hai đoạn liên tục -> hai đường');
  assert.match(V.vizLineAreaSvgHtml({ points: [{ x: 'A', y: null }] }), /data-viz="empty-chart"/);
});

test('WAVE-A [unit]: vizKpiCardHtml + vizDeltaHtml — thẻ có số/pill/progress/link; delta thiếu kỳ trước -> rỗng (không bịa)', () => {
  const card = V.vizKpiCardHtml({ label: 'Việc quá hạn', valueText: '7', tone: 'overdue', toneLabel: 'Quá hạn', href: '#/tasks', hrefLabel: 'Xem công việc', progress: { value: 7, max: 20, pct: 35, tone: 'overdue' } });
  assert.match(card, /data-viz="kpi-card"/);
  assert.match(card, /<div class="big">7<\/div>/);
  assert.match(card, /badge st-overdue/);
  assert.match(card, /width:35%/);
  assert.match(card, /href="#\/tasks"/);
  assert.match(V.vizDeltaHtml({ current: 120, previous: 100 }), /viz-delta-done/);
  assert.match(V.vizDeltaHtml({ current: 120, previous: 100 }), /▲ 20/);
  assert.match(V.vizDeltaHtml({ current: 120, previous: 100, invert: true }), /viz-delta-overdue/);
  assert.equal(V.vizDeltaHtml({ current: 120, previous: null }), '');
  assert.equal(V.vizDeltaHtml({ current: 120, previous: 0 }), '');
});

test('WAVE-A [unit]: vizCalDotsHtml — tối đa 3 chấm + +N; vizWorkloadBarHtml — vượt năng lực đỏ, chưa cấu hình sọc (không bịa 40h)', () => {
  const dots = V.vizCalDotsHtml([{ tone: 'done', count: 2 }, { tone: 'overdue', count: 3 }]);
  assert.match(dots, /data-viz="cal-dots"/);
  assert.equal((dots.match(/viz-dot st-bg-/g) || []).length, 3);
  assert.match(dots, /\+2/);
  assert.equal(V.vizCalDotsHtml([{ tone: 'done', count: 0 }]), '');
  const over = V.vizWorkloadBarHtml({ hours: 50, capacityHours: 40, overCapacity: true });
  assert.match(over, /data-viz="workload-bar"/);
  assert.match(over, /data-viz-tone="overdue"/);
  assert.match(over, /Vượt năng lực/);
  assert.match(over, /width:100%/);
  const ok = V.vizWorkloadBarHtml({ hours: 20, capacityHours: 40, overCapacity: false });
  assert.match(ok, /data-viz-tone="done"/);
  assert.match(ok, /20 \/ 40 giờ \(50%\)/);
  const unconf = V.vizWorkloadBarHtml({ hours: 12, capacityHours: null });
  assert.match(unconf, /data-viz-state="unconfigured"/);
  assert.match(unconf, /viz-track-empty/);
  assert.match(unconf, /Chưa cấu hình/);
  assert.doesNotMatch(unconf, /40/);
});
