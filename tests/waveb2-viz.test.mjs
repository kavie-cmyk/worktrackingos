// tests/waveb2-viz.test.mjs
// WAVE-B2-VIZ — Campaigns + chi tiết campaign: [static] các view campaign dùng
// đúng helper Wave A tại đúng vị trí; [unit] adapter B2 (phân bổ trạng thái
// việc loại trừ nhau, thanh ngân sách 3 lớp, timeline, chip kênh, lịch mini)
// chạy trên fixture D.1 — số phải khớp domain, không công thức mới ở view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'thiếu: ' + startMarker);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.notEqual(b, -1, 'thiếu cuối: ' + endMarker);
  return src.slice(a, b);
}

// ---------- [static] điểm gọi theo từng hạng mục ----------
test('WAVE-B2 [static] #1: thẻ campaign có donut từ campaignProgress + pill sức khỏe số', () => {
  const v = section('function viewCampaigns()', '// ---------- R3.1-VIZ:');
  assert.match(v, /data-viz="campaign-card-donut"/);
  assert.match(v, /vizDonutSvgHtml\(\{ segments: \[\{ label: 'Đã xong', value: p\.completed/);
  assert.match(v, /value: p\.total - p\.completed/);
  assert.match(v, /data-viz="campaign-health"/);
  assert.match(v, /vizStatusPillHtml\('overdue', \{ label: seg3\.overdue \+ ' việc trễ', derived: true \}\)/);
  assert.match(v, /vizStatusPillHtml\('blocked', \{ label: seg3\.blocked \+ ' việc bị chặn', derived: true \}\)/);
  // Giữ progress bar Wave A (test wavea khóa chữ ký này).
  assert.match(v, /vizProgressBarHtml\(\{ value: p\.completed, max: p\.total, pct: p\.percentage/);
});

test('WAVE-B2 [static] #2: Tổng quan campaign — KPI card sức khỏe + stacked trạng thái việc + stacked ngân sách', () => {
  const d = section('function campaignDetailHtml(id)', '// ---------- R3.1: Content Plan');
  assert.match(d, /vizBudgetStackedHtml\(ovBudget\)/);
  assert.match(d, /vizKpiCardHtml\(\{ label: 'Hoạt động đúng hạn'/);
  assert.match(d, /vizKpiCardHtml\(\{ label: 'Hoạt động có việc trễ'/);
  assert.match(d, /vizKpiCardHtml\(\{ label: 'Hoạt động bị chặn'/);
  assert.match(d, /data-viz="campaign-overview-task-stacked"/);
  assert.match(d, /vizTaskStatusSegments\(ctasks\)/);
  assert.match(d, /Hoạt động đúng hạn/); // nhãn cũ giữ nguyên (r31-ui-action khóa)
});

test('WAVE-B2 [static] #3: Action Plan — KPI mini bar + ngân sách stacked; drawer có stacked task + bar theo dòng', () => {
  const plan = section('function actionPlanHtml(c)', 'function activityDrawerHtml()');
  assert.match(plan, /vizKpiMiniHtml\(k\)/);
  assert.match(plan, /vizBudgetStackedHtml\(budgetRows\)/);
  const drawer = section('function activityDrawerHtml()', 'function campaignDetailHtml(id)');
  assert.match(drawer, /data-viz="activity-task-stacked"/);
  assert.match(drawer, /data-viz="activity-budget-line-bar"/);
  assert.match(drawer, /D\.budgetRemaining\(l, lineCommits, lineActuals\)/);
  const helpers = section('// ---------- WAVE-B2:', 'function vizKpiRowFor(k)');
  assert.match(helpers, /function vizKpiMiniHtml\(k\)/);
  assert.match(helpers, /vizCellBarHtml\(\{ value: row\.state\.value, max: Number\(k\.target\)/);
  // KPI tỉ lệ giữ dạng chữ, không ép thang tiến độ.
  assert.match(helpers, /mode === 'ratio'\) return/);
});

test('WAVE-B2 [static] #4–#7: tasks timeline, content lịch mini + chip kênh, summary donut, plan pill + chấm owner', () => {
  const d = section('function campaignDetailHtml(id)', '// ---------- R3.1: Content Plan');
  assert.match(d, /<th>Timeline tương đối<\/th>/);
  assert.match(d, /vizTaskTimelineHtml\(t\)/);
  assert.match(d, /vizCampaignCalStripHtml\(pubsForCamp\)/);
  assert.match(d, /<th>Số phiên bản kênh<\/th>/);
  assert.match(d, /vizChannelChipsHtml\(vs\)/);
  assert.match(d, /data-viz="campaign-summary-donut"/);
  assert.match(d, /vizDonutSvgHtml\(\{ segments: \[\{ label: 'Đã xong', value: prog\.completed/);
  assert.ok((d.match(/vizOwnerDotHtml\(/g) || []).length >= 2, 'plan phải có chấm owner ở cả 2 bảng');
  assert.match(d, /data-viz="campaign-summary-task-stacked"/);
  const helpers = section('// ---------- WAVE-B2:', 'function vizKpiRowFor(k)');
  assert.match(helpers, /function vizTaskTimelineHtml\(t\)/);
  assert.match(helpers, /vizTaskDerivedTone\(t\)/);
  assert.match(helpers, /function vizCampaignCalStripHtml\(pubs\)/);
  assert.match(helpers, /vizCalDotsHtml\(items\)/);
  // B2 không thêm hex cứng mới trong CSS (chỉ biến --st-*/--cat-*/--line/--panel).
  const b2css = css.slice(css.indexOf('WAVE-B2'));
  assert.doesNotMatch(b2css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(src + css, /chart\.js|\becharts\b|\bhighcharts\b|cdn\.jsdelivr|unpkg\.com/i);
});

// ---------- [unit] adapter B2 với stub Store/domain ----------
const pureBegin = src.indexOf('// R3.1-VIZ-PURE-BEGIN');
const pureEnd = src.indexOf('// R3.1-VIZ-PURE-END');
const pureSrc = src.slice(pureBegin, pureEnd);
const b2Src = section('// ---------- WAVE-B2:', 'function vizKpiRowFor(k)');
function escStub(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtNumStub(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
function fmtMoneyStub(n, cur) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN') + ' ' + (cur || ''); }
const LABELS = { facebook: 'Facebook', tiktok: 'TikTok', published: 'Đã đăng', scheduled: 'Đã lên lịch' };
function labelStatusStub(s) { if (s === null || s === undefined || s === '') return '—'; return LABELS[String(s).toLowerCase()] || String(s); }
const TODAY = '2026-11-07';
const blockersFixture = [{ id: 'b1', taskId: 't-blocked', status: 'open' }, { id: 'b2', taskId: 't-done', status: 'open' }];
const StoreStub = { list: (coll) => (coll === 'blockers' ? blockersFixture : []) };
const DStub = { formatDateVN: (d) => String(d || '—') };
function isCompletedStub(t) { const s = String((t && t.status) || '').toLowerCase(); return s === 'completed' || s === 'done'; }
function isOverdueStub(t) { if (!t.dueDate) return false; const s = String(t.status || '').toLowerCase(); return String(t.dueDate).slice(0, 10) < TODAY && s !== 'completed' && s !== 'done' && s !== 'cancelled'; }
const V = new Function('esc', 'fmtMoney', 'fmtNum', 'labelStatus', 'Store', 'D', 'isCompletedTask', 'isOverdue', 'todayISO', 'memberName', 'vizTaskDerivedTone', 'vizKpiRowFor', 'kpiSummaryHtml',
  pureSrc + '\n' + b2Src + '\nreturn { vizTaskStatusSegments: vizTaskStatusSegments, vizBudgetStackedHtml: vizBudgetStackedHtml, vizTaskTimelineHtml: vizTaskTimelineHtml, vizChannelChipsHtml: vizChannelChipsHtml, vizCampaignCalStripHtml: vizCampaignCalStripHtml, vizOwnerDotHtml: vizOwnerDotHtml };'
)(escStub, fmtMoneyStub, fmtNumStub, labelStatusStub, StoreStub, DStub, isCompletedStub, isOverdueStub, () => TODAY, (id) => 'Người ' + id, () => null, () => null, () => '');

test('WAVE-B2 [unit]: vizTaskStatusSegments loại trừ nhau, cộng đúng tổng (xong thắng bị chặn)', () => {
  const tasks = [
    { id: 't-done', status: 'completed', dueDate: '2026-11-01' },
    { id: 't-blocked', status: 'in_progress', dueDate: '2026-11-20' },
    { id: 't-over', status: 'in_progress', dueDate: '2026-11-05' },
    { id: 't-rest', status: 'todo', dueDate: '2026-11-20' },
  ];
  const r = V.vizTaskStatusSegments(tasks);
  assert.equal(r.total, 4); assert.equal(r.done, 1); assert.equal(r.blocked, 1); assert.equal(r.overdue, 1); assert.equal(r.rest, 1);
  assert.equal(r.segments.reduce((a, x) => a + x.value, 0), 4);
});

test('WAVE-B2 [unit]: vizBudgetStackedHtml trên fixture D.1 (32tr) — 3 đoạn khớp tỉ lệ domain', () => {
  const M = 1000000;
  const html = V.vizBudgetStackedHtml([{ currency: 'VND', ceiling: 32 * M, actualTotal: 20.5 * M, openCommitments: 7.5 * M, available: 4 * M }]);
  assert.match(html, /data-viz="budget-stacked"/);
  assert.match(html, /width:64\.06%/); // thực chi
  assert.match(html, /width:23\.44%/); // cam kết
  assert.match(html, /width:12\.5%/); // còn dùng được
  assert.equal(V.vizBudgetStackedHtml([{ currency: 'VND', ceiling: 0, actualTotal: 0, openCommitments: 0, available: 0 }]), '');
});

test('WAVE-B2 [unit]: vizTaskTimelineHtml — hôm nay ở giữa khoảng việc = 50%, tông theo trạng thái', () => {
  const html = V.vizTaskTimelineHtml({ id: 'x', status: 'in_progress', startDate: '2026-11-02', dueDate: '2026-11-12' });
  assert.match(html, /data-viz="task-timeline"/);
  assert.match(html, /width:50%/);
  assert.match(html, /st-fill-running/);
  assert.match(V.vizTaskTimelineHtml({ id: 'y', status: 'todo' }), /Chưa đủ ngày/);
});

test('WAVE-B2 [unit]: chip kênh đếm đúng + màu cat theo thứ tự kênh đã sắp; lịch mini gom theo ngày', () => {
  const chips = V.vizChannelChipsHtml([{ platform: 'tiktok' }, { platform: 'facebook' }, { platform: 'facebook' }]);
  assert.match(chips, /data-viz="channel-chips"/);
  assert.match(chips, /cat-1"><\/span>Facebook ×2/);
  assert.match(chips, /cat-2"><\/span>TikTok ×1/);
  const strip = V.vizCampaignCalStripHtml([
    { at: '2026-11-10T09:00:00+07:00', status: 'published' },
    { at: '2026-11-10T20:00:00+07:00', status: 'scheduled' },
    { at: '2026-11-11T09:00:00+07:00', status: 'published' },
  ]);
  assert.match(strip, /data-viz="campaign-cal-strip"/);
  assert.match(strip, /data-viz="cal-dots"/);
  assert.match(strip, /2026-11-10 · 2 lần/);
  assert.match(V.vizCampaignCalStripHtml([]), /data-viz="empty-chart"/);
});
