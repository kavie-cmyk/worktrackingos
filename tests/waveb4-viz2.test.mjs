// tests/waveb4-viz2.test.mjs
// WAVE-B4-VIZ2 — Công việc/Requests + Duyệt + Brand Hub + Kênh + Quảng cáo +
// Team + Settings (INVENTORY #25/#26/#27/#30/#31/#34/#35):
// [unit] helper THUẦN mới (vizDayDiff, vizTaskBarHtml, vizDepBadgesHtml,
// vizCompactNum, vizFunnelHtml, vizMiniDayBarsHtml, vizAssetCatIndex,
// vizBrandThumbHtml) chỉ làm toán trình bày trên số/ngày đã có;
// [static] từng view dùng đúng helper/dải trực quan đã giao, không hex cứng mới,
// vùng PURE vẫn thuần.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

const pureBegin = src.indexOf('// R3.1-VIZ-PURE-BEGIN');
const pureEnd = src.indexOf('// R3.1-VIZ-PURE-END');
const pureSrc = src.slice(pureBegin, pureEnd);
function escStub(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtNumStub(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
function fmtMoneyStub(n, cur) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN') + ' ' + (cur || ''); }
const LABELS = { in_progress: 'Đang làm', pending: 'Chờ duyệt', completed: 'Hoàn thành', draft: 'Nháp', blocked: 'Bị chặn', rejected: 'Đã từ chối', open: 'Đang mở', resolved: 'Đã gỡ', new: 'Mới ghi nhận' };
function labelStatusStub(s) { if (s === null || s === undefined || s === '') return '—'; return LABELS[String(s).toLowerCase()] || String(s); }
const V = new Function('esc', 'fmtMoney', 'fmtNum', 'labelStatus',
  pureSrc + '\nreturn { vizDayDiff: vizDayDiff, vizTaskBarHtml: vizTaskBarHtml, vizDepBadgesHtml: vizDepBadgesHtml, vizCompactNum: vizCompactNum, vizFunnelHtml: vizFunnelHtml, vizMiniDayBarsHtml: vizMiniDayBarsHtml, vizCatDotHtml: vizCatDotHtml, vizAssetCatIndex: vizAssetCatIndex, vizBrandThumbHtml: vizBrandThumbHtml };'
)(escStub, fmtMoneyStub, fmtNumStub, labelStatusStub);

// ---------- [unit] helper thuần ----------
test('WAVE-B4 [unit]: vizDayDiff — chênh ngày thuần, thiếu mốc -> null', () => {
  assert.equal(V.vizDayDiff('2026-11-01', '2026-11-11'), 10);
  assert.equal(V.vizDayDiff('2026-11-11', '2026-11-01'), -10);
  assert.equal(V.vizDayDiff('2026-11-10T15:00:00+07:00', '2026-11-12'), 2);
  assert.equal(V.vizDayDiff('', '2026-11-12'), null);
  assert.equal(V.vizDayDiff('2026-11-12', null), null);
});

test('WAVE-B4 [unit]: vizTaskBarHtml — đoạn start→due + vạch hôm nay ở đúng vị trí tương đối', () => {
  const html = V.vizTaskBarHtml({ start: '2026-11-01', due: '2026-11-11', today: '2026-11-06', tone: 'running', startLabel: '01/11/2026', dueLabel: '11/11/2026' });
  assert.match(html, /data-viz="task-timeline"/);
  assert.match(html, /viz-timeline-bar st-fill-running" style="left:0%;width:100%"/);
  assert.match(html, /viz-timeline-elapsed st-fill-running" style="left:0%;width:50%"/);
  assert.match(html, /viz-timeline-today" style="left:50%"/);
  assert.match(html, /01\/11\/2026 → 11\/11\/2026/);
  assert.equal(V.vizTaskBarHtml({ start: null, due: null, today: '2026-11-06' }), '');
  const od = V.vizTaskBarHtml({ start: '2026-11-01', due: '2026-11-03', today: '2026-11-06', tone: 'overdue' });
  assert.match(od, /data-viz-tone="overdue"/);
});

test('WAVE-B4 [unit]: vizDepBadgesHtml — badge đếm đúng tông, chi tiết ở title', () => {
  const html = V.vizDepBadgesHtml({ waitingCount: 2, blockingCount: 1, waitingTitles: ['Việc A', 'Việc B'], blockingTitles: ['Việc C'] });
  assert.match(html, /st-blocked[^"]*" data-viz="dep-badge" data-viz-tone="blocked" title="Đang chờ: Việc A, Việc B">Đang chờ: 2</);
  assert.match(html, /st-pending[^"]*" data-viz="dep-badge" data-viz-tone="pending" title="Việc đang chờ mình: Việc C">Chờ mình: 1</);
  assert.match(V.vizDepBadgesHtml({ waitingCount: 0, blockingCount: 0 }), /Không phụ thuộc/);
});

test('WAVE-B4 [unit]: vizCompactNum — gọn kiểu Việt, số nhỏ giữ nguyên, thiếu -> —', () => {
  assert.equal(V.vizCompactNum(3500), '3.500');
  assert.equal(V.vizCompactNum(12500), '12,5 nghìn');
  assert.equal(V.vizCompactNum(240000), '240 nghìn');
  assert.equal(V.vizCompactNum(1500000), '1,5 triệu');
  assert.equal(V.vizCompactNum(null), '—');
});

test('WAVE-B4 [unit]: vizFunnelHtml — % theo bước đầu từ tổng aggregate (240.000 -> 7.200 -> 950)', () => {
  const html = V.vizFunnelHtml({ steps: [{ label: 'Hiển thị', value: 240000 }, { label: 'Nhấp', value: 7200 }, { label: 'Kết quả', value: 950 }] });
  assert.match(html, /data-viz="ads-funnel"/);
  assert.match(html, /240\.000 \(100%\)/);
  assert.match(html, /7\.200 \(3%\)/);
  assert.match(html, /950 \(0,4%\)/);
  assert.match(V.vizFunnelHtml({ steps: [{ label: 'Hiển thị', value: 0 }] }), /data-viz="empty-chart"/);
});

test('WAVE-B4 [unit]: vizMiniDayBarsHtml — cột theo giờ, >8h tông overdue; rỗng -> chuỗi rỗng', () => {
  const html = V.vizMiniDayBarsHtml({ days: [{ label: '10/11', hours: 4, title: '10/11/2026: 4 giờ' }, { label: '11/11', hours: 9, title: '11/11/2026: 9 giờ' }] });
  assert.match(html, /data-viz="day-bars"/);
  assert.match(html, /viz-daybar-fill st-fill-running" style="height:44\.44%"/);
  assert.match(html, /viz-daybar-fill st-fill-overdue" style="height:100%"/);
  assert.equal(V.vizMiniDayBarsHtml({ days: [] }), '');
});

test('WAVE-B4 [unit]: vizAssetCatIndex + vizBrandThumbHtml — ảnh dùng thumb, loại khác ô giữ chỗ + chấm cat', () => {
  assert.equal(V.vizAssetCatIndex('Logo'), 1);
  assert.equal(V.vizAssetCatIndex('Hình ảnh'), 2);
  assert.equal(V.vizAssetCatIndex('Hướng dẫn'), 3);
  const img = V.vizBrandThumbHtml({ name: 'KV lễ', type: 'Hình ảnh', url: 'https://example.com/kv.png', isImg: true });
  assert.match(img, /data-viz="brand-thumb"/);
  assert.match(img, /asset-thumb-lg" src="https:\/\/example\.com\/kv\.png"/);
  assert.match(img, /viz-dot cat-2/);
  const ph = V.vizBrandThumbHtml({ name: 'Bảng màu và font chữ', type: 'Hướng dẫn', url: '', isImg: false });
  assert.match(ph, /asset-thumb-ph cat-edge-3/);
  assert.match(ph, />B</);
  assert.match(ph, /viz-dot cat-3/);
});

// ---------- [static] điểm dùng ở từng view ----------
test('WAVE-B4 [static]: #/tasks — timeline ở cột Thời gian, badge phụ thuộc, pill Trở ngại, dải KPI Requests', () => {
  const v = section('function viewTasks()', '// ---------- Duyệt nội dung ----------');
  assert.match(v, /vizTaskBarHtml\(\{ start: t\.startDate, due: t\.dueDate, today: todayISO\(\)/);
  assert.match(v, /vizDepBadgesHtml\(\{ waitingCount: waitingFor\.length, blockingCount: blockingOthers\.length/);
  assert.match(v, /vizStatusPillHtml\(b\.status, \{ context: 'blocker'/);
  assert.match(v, /data-viz="requests-kpi-strip"/);
  assert.match(v, /data-viz="requests-status-chart"/);
  assert.match(v, /data-viz="requests-priority-chart"/);
  assert.match(v, /vizStackedBarHtml\(\{ segments: reqStatusSegs, total: reqs\.length/);
  assert.doesNotMatch(v, /Đang chờ: ' \+ \(waitingFor/);
});

test('WAVE-B4 [static]: #/approvals — dải hàng đợi + tuổi chờ từ requestedAt, pill quyết định + cột thời gian chờ', () => {
  const v = section('function viewApprovals()', '// ---------- Team & Workload ----------');
  assert.match(v, /data-viz="approval-queue-strip"/);
  assert.match(v, /data-viz="approval-queue-chart"/);
  assert.match(v, /a\.requestedAt \|\| a\.createdAt \|\| a\.created_at/);
  assert.match(v, /Đã chờ ' \+ waitDays \+ ' ngày/);
  assert.match(v, /vizStatusPillHtml\(a\.status, \{ label: a\.statusLabel \}\)/);
  assert.match(v, /<th>Thời gian chờ<\/th>/);
});

test('WAVE-B4 [static]: #/brand — cột Xem trước + badge phiên bản, pill Đã lưu trữ tông cancelled', () => {
  const v = section('function viewBrand()', '// ---------- IMC & Campaigns ----------');
  assert.match(v, /vizBrandThumbHtml\(\{ name: a\.name, type: a\.type, url: url, isImg: isImg \}\)/);
  assert.match(v, /<th>Xem trước<\/th>/);
  assert.match(v, /vizStatusPillHtml\('', \{ tone: 'neutral', label: 'v' \+ \(p\.version \|\| 1\) \}\)/);
  assert.match(v, /vizStatusPillHtml\('cancelled', \{ label: 'Đã lưu trữ' \}\)/);
  assert.match(v, /colspan="8"/);
});

test('WAVE-B4 [static]: #/channels — bảng kết nối gộp chấm + legend, cột Lượt xem/Tiếp cận từ observations', () => {
  const v = section('function viewChannels()', '// ---------- Quảng cáo ----------');
  assert.match(v, /data-viz="channel-legend"/);
  assert.match(v, /viz-dot-group/);
  assert.match(v, /<th>Mức code \(OAuth · Đăng bài · Đồng bộ · Quảng cáo\)<\/th>/);
  assert.doesNotMatch(v, /<th>Mức code: OAuth<\/th>/);
  assert.match(v, /<th>Lượt xem<\/th><th>Tiếp cận<\/th>/);
  assert.match(v, /D\.latestLifetimeSnapshot/);
  assert.match(v, /vizCompactNum\(views\)/);
  assert.match(v, /colspan="10"/);
});

test('WAVE-B4 [static]: #/ads — phễu từ D.aggregateRates cấp chiến dịch + thanh chi tiêu theo maxSpend', () => {
  const v = section('function viewAds()', '// ---------- Báo cáo ----------');
  assert.match(v, /D\.aggregateRates\(allAdCampaigns\)/);
  assert.match(v, /vizFunnelHtml\(\{ steps: \[/);
  assert.match(v, /label: 'Hiển thị'/);
  assert.match(v, /label: 'Kết quả'/);
  const rc = section('function ratesCells(r, maxSpend)', 'function viewAds()');
  assert.match(rc, /vizCellBarHtml\(\{ value: Number\(r\.spend\), max: Number\(maxSpend\)/);
  assert.match(v, /ratesCells\(ac, maxSpend\)/);
});

test('WAVE-B4 [static]: #/team — cột theo ngày có day-bars, chữ chi tiết giữ ở dòng phụ', () => {
  const v = section('function viewTeam()', '// ---------- KPI & Ngân sách ----------');
  assert.match(v, /vizMiniDayBarsHtml\(\{ days: Object\.keys\(perDay\)\.sort\(\)/);
  assert.match(v, /data-viz="day-bars"|vizMiniDayBarsHtml/);
  assert.match(v, /vizWorkloadBarHtml/);
});

test('WAVE-B4 [static]: #/settings — ma trận quyền tô màu perm-yes/perm-no, giữ nguyên cấu trúc bảng', () => {
  const v = section('function viewSettings()', '// ---------- Đăng nhập');
  assert.match(v, /class="perm-yes" title="Có quyền">✓/);
  assert.match(v, /class="perm-no" title="Không có quyền">—/);
  assert.match(v, /<th>Quyền<\/th><th>Owner<\/th><th>Lead<\/th><th>Member<\/th><th>CEO<\/th>/);
});

test('WAVE-B4 [static]: không hex cứng mới ở khối B4; vùng PURE vẫn thuần; CSS có class B4 dùng biến', () => {
  const b4 = section('// ---------- WAVE-B4-VIZ2: helper thuần bổ sung', '// R3.1-VIZ-PURE-END');
  assert.doesNotMatch(b4, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(pureSrc, /Store\.|SAVA_DOMAIN|budgetLines|commitments/);
  assert.doesNotMatch(pureSrc, /summarizeBudgetScope|rollupKpi/);
  for (const cls of ['.viz-timeline', '.viz-daybars', '.asset-thumb-lg', '.asset-thumb-ph', '.viz-dot-group', '.perm-yes', '.perm-no', '.viz-fill.cat-1']) {
    assert.ok(css.includes(cls), 'CSS thiếu class B4: ' + cls);
  }
  assert.match(css, /\.perm-yes\{color:var\(--st-done\)/);
  assert.match(css, /\.viz-timeline-today\{[^}]*background:var\(--st-overdue\)/);
});
