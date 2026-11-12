// tests/waveb1-viz2.test.mjs
// WAVE-B1-VIZ2 — Việc của tôi + Báo cáo (perf/ops) + rà Tổng quan:
// [static] các view dùng đúng helper Wave A, số lấy từ hàm domain/đếm
// hiện có (aggregateRates theo kỳ, campaignProgress), CSS mới chỉ dùng
// biến màu --st-*/--track (không hex cứng mới).

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

test('WAVE-B1 [static]: Việc của tôi — dải KPI từ chính số đếm nhóm + stacked bar + timeline 7 ngày + dải lịch CalDots', () => {
  const mw = section('function viewMyWork()', '// ---------- Brand Hub ----------');
  assert.match(mw, /data-viz="my-work-summary"/);
  assert.match(mw, /vizKpiCardHtml\(\{/);
  // KPI đếm lấy từ groups/myApprovals đã lọc ở view, không đếm lại công thức mới.
  assert.match(mw, /count: g\[1\]\.length/);
  assert.match(mw, /count: myApprovals\.length/);
  assert.match(mw, /vizStackedBarHtml\(\{\s*segments: kpiDefs\.map/);
  // Timeline 7 ngày chỉ dùng startDate/dueDate đã có, kẹp trong tuần.
  assert.match(mw, /data-viz="my-work-week-timeline"/);
  assert.match(mw, /function weekTimelineHtml\(list\)/);
  assert.match(mw, /t\.startDate \|\| t\.dueDate/);
  assert.match(mw, /vizTaskDerivedTone\(t\) \|\| vizStatusTone\(t\.status\)/);
  // Dải lịch nội dung theo ngày có chấm trạng thái.
  assert.match(mw, /data-viz="my-work-cal-strip"/);
  assert.match(mw, /vizCalDotsHtml\(Object\.keys\(byTone\)/);
  assert.match(mw, /dateInTz\(v2\.scheduledAt\) === d/);
  // Bảng nhóm giữ nguyên, trạng thái qua statusBadge (alias pill chuẩn).
  assert.match(mw, /statusBadge\(t\.status\)/);
});

test('WAVE-B1 [static]: Báo cáo ops — 4 thẻ vizKpiCardHtml + tiến độ vizCellBarHtml từ campaignProgress + pill quá hạn khi >0', () => {
  const rp = section('function viewReports()', '// ---------- Thiết lập ----------');
  assert.match(rp, /data-viz="reports-ops-cards"/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'Campaign đang chạy', valueText: String\(runningCampaigns\.length\)/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'Việc quá hạn', valueText: String\(overdue\.length\)/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'Nội dung chờ duyệt', valueText: String\(pendingApprovals\.length\)/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'Việc đã hoàn thành'/);
  assert.match(rp, /data-viz="reports-ops-progress"/);
  assert.match(rp, /vizCellBarHtml\(\{ value: p\.completed, max: p\.total, tone: pTone/);
  assert.match(rp, /odCount > 0 \? vizStatusPillHtml\('overdue', \{ label: odCount \+ ' quá hạn', derived: true \}\) : '0'/);
});

test('WAVE-B1 [static]: Báo cáo perf — 5 thẻ vizKpiCardHtml giữ số aggregateRates + chart theo kỳ gọi lại aggregateRates từng kỳ + lifetime có thanh tỉ trọng', () => {
  const rp = section('function viewReports()', '// ---------- Thiết lập ----------');
  assert.match(rp, /data-viz="reports-perf-cards"/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'CTR \(' \+ curLabel \+ '\)', valueText: \(b\.ctr === null/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'CPC \(' \+ curLabel \+ '\/nhấp\)'/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'CPM \(' \+ curLabel \+ '\/1\.000 hiển thị\)'/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'ROAS \(' \+ curLabel \+ '\)'/);
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'Tổng chi tiêu \(' \+ curLabel \+ '\)', valueText: fmtMoney\(t\.spend, curMoney\)/);
  // Theo kỳ: gom theo periodStart/periodEnd và gọi LẠI D.aggregateRates cho từng kỳ.
  assert.match(rp, /data-viz="reports-perf-period"/);
  assert.match(rp, /var rowsInPeriod = levelInsights\.filter/);
  assert.match(rp, /D\.aggregateRates\(rowsInPeriod\)/);
  assert.match(rp, /vizLineAreaSvgHtml\(\{ points: perPeriod\.map/);
  assert.match(rp, /vizHBarHtml\(\{ label: 'Nhấp — '/);
  assert.match(rp, /vizHBarHtml\(\{ label: 'Kết quả — '/);
  // Lifetime: thẻ qua vizKpiCardHtml + cột tỉ trọng vizCellBarHtml trên lifetimeTotal của view.
  assert.match(rp, /vizKpiCardHtml\(\{ label: 'Lượt xem trọn đời — tổng của bản mới nhất từng bài'/);
  assert.match(rp, /data-viz="reports-lifetime-bars"/);
  assert.match(rp, /vizCellBarHtml\(\{ value: r\.value, max: lifetimeTotal, tone: 'running'/);
});

test('WAVE-B1 [static]: Tổng quan — list Chờ duyệt & Quá hạn ở cuối trang có pill chuẩn (không làm lại KPI/risk của Wave A)', () => {
  const ov = section('function viewOverview()', '// ---------- Việc của tôi ----------');
  const tail = ov.slice(ov.indexOf('<h2>Chờ duyệt & quá hạn</h2>'));
  assert.match(tail, /vizStatusPillHtml\(a\.status\)/);
  assert.match(tail, /vizStatusPillHtml\('overdue', \{ label: 'Quá hạn', derived: true \}\)/);
  assert.match(tail, /statusBadge\(t\.status\)/);
});

test('WAVE-B1 [static]: CSS mới (timeline/dải lịch) chỉ dùng biến màu, không hex cứng mới', () => {
  const block = css.slice(css.indexOf('/* WAVE-B1-VIZ2'));
  assert.ok(block.length > 100, 'thiếu khối CSS WAVE-B1-VIZ2');
  const end = block.indexOf('@media(max-width:480px)', 10);
  const rules = block.slice(0, end === -1 ? undefined : end);
  assert.match(rules, /\.viz-week-bar\.st-fill-overdue\{background:var\(--st-overdue\)\}/);
  assert.match(rules, /\.viz-cal-day\.is-today\{border-color:var\(--st-running\)\}/);
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/, 'CSS WAVE-B1 không được có hex cứng');
});
