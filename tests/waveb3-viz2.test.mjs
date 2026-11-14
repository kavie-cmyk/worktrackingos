// tests/waveb3-viz2.test.mjs
// WAVE-B3-VIZ2 — Content Plan + KPI & Ngân sách + Thu–Chi:
// [static] lịch Content không tràn (grid minmax(0,1fr)), chip lịch có viền
// tông + chấm ngày; các tab content có stacked/share/heatmap/queue cards/
// timeline/thư viện số liệu/manage cell bar; trang KPI dùng vizKpiCardHtml +
// stacked dòng tiền + cell bar dòng ngân sách; Thu–Chi có đường số dư lũy kế.
// [unit] vizCashCumulativePoints cộng dồn ĐÚNG net của vizCashMonthly trên
// fixture demo cash mới; vizTimelineHtml chia tỉ lệ thời gian thật;
// fixture cash demo tự khớp khi cộng tay (bảng đối chiếu ở demo-data.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const demo = require('../js/demo-data.js');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy: ' + endMarker);
  return src.slice(a, b);
}

const pureBegin = src.indexOf('// R3.1-VIZ-PURE-BEGIN');
const pureEnd = src.indexOf('// R3.1-VIZ-PURE-END');
assert.notEqual(pureBegin, -1); assert.notEqual(pureEnd, -1);
const pureSrc = src.slice(pureBegin, pureEnd);
function escStub(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtNumStub(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
function fmtMoneyStub(n, cur) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN') + ' ' + (cur || ''); }
function labelStatusStub(s) { if (s === null || s === undefined || s === '') return '—'; return String(s); }
const V = new Function('esc', 'fmtMoney', 'fmtNum', 'labelStatus',
  pureSrc + '\nreturn { vizCashMonthly: vizCashMonthly, vizCashCumulativePoints: vizCashCumulativePoints, vizTimelineHtml: vizTimelineHtml, vizMonthLabel: vizMonthLabel };'
)(escStub, fmtMoneyStub, fmtNumStub, labelStatusStub);

const M = 1000000;

// ---------- [static] lịch + content ----------
test('WAVE-B3 [static]: CSS lịch dùng minmax(0,1fr) + ô/chip bị chặn bề ngang (hết tràn 1811px)', () => {
  assert.match(css, /\.cal\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(css, /\.cal-cell\{[^}]*min-width:0;overflow:hidden/);
  assert.match(css, /\.chip\{[^}]*max-width:100%/);
  assert.match(css, /\.tab\{[^}]*flex:0 0 auto/);
  assert.match(css, /td\.heat-4\{/);
  assert.match(css, /\.viz-timeline\{/);
  assert.match(css, /\.metric-chip\{/);
});

test('WAVE-B3 [static]: viewContent có chip st-edge + cal dots, backlog stacked, pillar share, mix heat/stacked, queue cards+tuổi chờ, production timeline, library số liệu, manage cell bar', () => {
  const c = section('function viewContent()', '// ---------- Công việc ----------');
  assert.match(c, /chip st-edge-' \+ vizStatusTone\(p\.status\)/);
  assert.match(c, /vizCalDotsHtml\(dayItems\)/);
  assert.match(c, /data-viz="content-backlog-pipeline"/);
  assert.match(c, /vizStackedBarHtml\(\{ segments: blSegs, total: backlog\.length/);
  assert.match(c, /data-viz="content-pillar-share"/);
  assert.match(c, /contentMixRows\(items, pubs, 'content'\)/);
  assert.match(c, /data-viz="content-mix-heat"/);
  assert.match(c, /heatCls/);
  assert.match(c, /data-viz="content-mix-stacked"/);
  assert.match(c, /data-viz="content-queue-cards"/);
  assert.match(c, /data-viz="content-queue-age"/);
  assert.match(c, /vizTimelineHtml\(tlPts\)/);
  assert.match(c, /data-viz="tiktok-metrics"/);
  assert.match(c, /libLatestMetric\(p\.refId, \['views', 'lifetime_views'\]\)/);
  assert.match(c, /vizCellBarHtml\(\{ value: cnt, max: pillarMaxCnt/);
});

test('WAVE-B3 [static]: viewKpi dùng vizKpiCardHtml x6 + stacked dòng tiền + cell bar dòng ngân sách; cash có đường lũy kế', () => {
  const k = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(k, /data-viz="kpi-money-cards"/);
  assert.match(k, /vizKpiCardHtml\(\{ label: 'Kế hoạch'/);
  assert.match(k, /vizKpiCardHtml\(\{ label: 'Dự kiến sử dụng'/);
  assert.match(k, /data-viz="kpi-budget-stacked"/);
  assert.match(k, /vizCellBarHtml\(\{ value: lineUsed, max: Number\(b\.approved\)/);
  const cash = section('function cashChartHtml()', 'function workspaceChartsHtml()');
  assert.match(cash, /data-viz="cash-balance-line"/);
  assert.match(cash, /vizCashCumulativePoints\(monthly, cur\)/);
  assert.match(cash, /vizLineAreaSvgHtml/);
  // Vùng PURE vẫn thuần sau khi thêm helper B3.
  assert.doesNotMatch(pureSrc, /Store\.|SAVA_DOMAIN|budgetLines|commitments/);
  assert.doesNotMatch(pureSrc, /summarizeBudgetScope|rollupKpi/);
});

// ---------- [unit] helper thuần B3 ----------
test('WAVE-B3 [unit]: vizCashCumulativePoints cộng dồn net đúng trên fixture demo cash (16tr -> 37,5tr -> 60tr)', () => {
  const accCur = (id) => (demo.cashAccounts.find((a) => a.id === id) || {}).currency || 'VND';
  const monthly = V.vizCashMonthly(demo.cashTransactions, accCur);
  assert.deepEqual(monthly.map((m) => [m.month, m.inTotal, m.outTotal, m.net]), [
    ['2026-09', 20 * M, 4 * M, 16 * M],
    ['2026-10', 30 * M, 8.5 * M, 21.5 * M],
    ['2026-11', 37 * M, 14.5 * M, 22.5 * M],
  ]);
  const pts = V.vizCashCumulativePoints(monthly, 'VND');
  assert.deepEqual(pts.map((p) => p.y), [16 * M, 37.5 * M, 60 * M]);
  assert.deepEqual(pts.map((p) => p.x), ['Tháng 9/2026', 'Tháng 10/2026', 'Tháng 11/2026']);
  // Tiền tệ khác -> không có điểm; tháng unknown bị loại khỏi đường lũy kế.
  assert.deepEqual(V.vizCashCumulativePoints(monthly, 'USD'), []);
  const withUnknown = monthly.concat([{ month: 'unknown', currency: 'VND', inTotal: 5, outTotal: 0, net: 5, count: 1 }]);
  assert.equal(V.vizCashCumulativePoints(withUnknown, 'VND').length, 3);
});

test('WAVE-B3 [unit]: số dư tài khoản fixture demo khớp cộng tay (108,5tr và 11,5tr)', () => {
  for (const acc of demo.cashAccounts) {
    let bal = Number(acc.openingBalance) || 0;
    demo.cashTransactions.filter((t) => t.accountId === acc.id).forEach((t) => { bal += t.direction === 'in' ? t.amount : -t.amount; });
    assert.equal(bal, acc.id === 'cash-acc-1' ? 108.5 * M : 11.5 * M, 'số dư ' + acc.id);
  }
  // Vài giao dịch gắn camp-live như task yêu cầu.
  assert.ok(demo.cashTransactions.filter((t) => t.campaignId === 'camp-live').length >= 3);
});

test('WAVE-B3 [unit]: vizTimelineHtml — mốc giữa nằm đúng tỉ lệ thời gian khi ngày tăng dần đều', () => {
  const html = V.vizTimelineHtml([
    { label: 'Hạn sản xuất', date: '2026-11-01', dateText: '01/11/2026', tone: 'running' },
    { label: 'Hạn duyệt', date: '2026-11-11', dateText: '11/11/2026', tone: 'pending' },
    { label: 'Ngày đăng', date: '2026-11-21', dateText: '21/11/2026', tone: 'done' },
  ]);
  assert.match(html, /data-viz="timeline"/);
  assert.match(html, /left:50%/);
  assert.match(html, /Hạn duyệt/);
  // Thiếu ngày -> vẫn vẽ theo thứ tự, không bịa tỉ lệ (mốc giữa vẫn 50% do chia đều 3 mốc).
  const sparse = V.vizTimelineHtml([{ label: 'A', date: '', dateText: '—' }, { label: 'B', date: '2026-11-21', dateText: '21/11/2026' }]);
  assert.match(sparse, /data-viz="timeline"/);
  assert.equal(V.vizTimelineHtml([]), '<span class="sub">—</span>');
});
