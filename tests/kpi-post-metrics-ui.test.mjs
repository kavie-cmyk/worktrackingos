// tests/kpi-post-metrics-ui.test.mjs
// LINK KPI <-> BỘ ĐẾM BÀI ĐÃ ĐĂNG — phần UI + demo (executor B):
//   - Form KPI: select "Nguồn số liệu" (manual/post_metrics) + 2 trường phụ
//     thuộc (Chỉ số từ danh mục mã bài đăng của app + Cách gộp latest_sum /
//     period_sum); lưu MERGE vào definition.dataSource, giữ description.
//   - Hiển thị: badge "Tự động từ bài đã đăng" + dòng "từ N bài · cập nhật …"
//     từ kpi.autoActual ở renderer dùng chung (progress/mini/table/summary),
//     KPI manual không có badge; metric reach có chú thích phủ định về
//     tính không trùng (không gắn nhãn unique cho tổng reach).
//   - Drill-down: rows từ kpi.autoActual.rows, tổng bằng actual hiển thị.
//   - Form số đo của KPI auto bị disable + giải thích + chặn ở save
//     (KPI_AUTO_SOURCE); KPI manual giữ nguyên.
//   - Demo: đúng 1 KPI mẫu post_metrics (camp-1, lifetime_views latest_sum,
//     target 500, actual null) và mọi KPI demo cũ giữ nguyên actual/definition.
// Tầng kiểm: [static] đọc source js/app.js + [unit] trích xuất helper thuần
// của khối post_metrics và chạy thật với stub, theo pattern ui test cũ.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const demo = require('../js/demo-data.js');

function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}
const editorStart = src.indexOf('function editorHtml()');
const saveStart = src.indexOf('function saveEditor(');

// ---------- Trích xuất helper post_metrics để chạy unit thật ----------
function escStub(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtNumStub(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
function labelStatusStub(s) { if (s === null || s === undefined || s === '') return '—'; return ({ facebook: 'Facebook', tiktok: 'TikTok', instagram: 'Instagram' })[String(s).toLowerCase()] || String(s); }
function tblStub(inner) { return '<div class="table-wrap"><table>' + inner + '</table></div>'; }
const DStub = { formatDateTimeVN: (s) => 'DT(' + s + ')' };
const helpersSrc = section('var POST_METRIC_OPTIONS', 'function vizKpiMiniHtml');
const H = new Function('esc', 'fmtNum', 'labelStatus', 'tbl', 'D',
  helpersSrc + '\nreturn { POST_METRIC_OPTIONS: POST_METRIC_OPTIONS, postMetricLabel: postMetricLabel, kpiDefinitionObject: kpiDefinitionObject, kpiDataSource: kpiDataSource, isKpiAuto: isKpiAuto, kpiAutoMetric: kpiAutoMetric, kpiAutoInfoHtml: kpiAutoInfoHtml, kpiAutoDrillHtml: kpiAutoDrillHtml };'
)(escStub, fmtNumStub, labelStatusStub, tblStub, DStub);

const AUTO_KPI = {
  id: 'kpi-x', name: 'KPI auto mẫu', unit: 'lượt xem', actual: 200,
  definition: { description: 'mô tả gốc', dataSource: { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum' } },
  autoActual: { postCount: 1, latestObservedAt: '2026-11-09T10:00:00+07:00', rows: [{ postId: 'post-1', title: 'Bài giới thiệu sự kiện', platform: 'facebook', value: 200, observedAt: '2026-11-09T10:00:00+07:00' }] },
};
const MANUAL_KPI = { id: 'kpi-m', name: 'KPI tay', definition: { description: 'chỉ mô tả' } };

// ---------- 1. Form KPI: nguồn + 2 trường phụ thuộc ----------
test('KPI-POST-UI [static]: form KPI có select Nguồn số liệu (Tự nhập mặc định / Tự động từ bài đã đăng) làm mới form khi đổi', () => {
  const form = section("case 'kpi': {", "case 'measurement': {", editorStart);
  assert.match(form, /F\('dataSourceType', 'Nguồn số liệu', 'select', kSourceType/);
  assert.match(form, /\['manual', 'Tự nhập'\]/);
  assert.match(form, /\['post_metrics', 'Tự động từ bài đã đăng'\]/);
  assert.match(form, /data-refresh-editor="1"/);
  // KPI manual cũ (không dataSource) phải mở lên ở 'Tự nhập'.
  assert.match(form, /ev\('dataSourceType', \(kDs0 && kDs0\.type === 'post_metrics'\) \? 'post_metrics' : 'manual'\)/);
});

test('KPI-POST-UI [static+unit]: khi chọn post_metrics hiện Chỉ số (đúng danh mục mã bài đăng của app) + Cách gộp latest_sum/period_sum', () => {
  const form = section("case 'kpi': {", "case 'measurement': {", editorStart);
  assert.match(form, /kIsAutoForm/);
  assert.match(form, /F\('dataSourceMetric', 'Chỉ số', 'select', kDsMetric, \{ options: kMetricOpts/);
  assert.match(form, /F\('dataSourceMode', 'Cách gộp', 'select', kDsMode/);
  assert.match(form, /\['latest_sum', 'Cộng số mới nhất của từng bài'\]/);
  assert.match(form, /\['period_sum', 'Cộng theo kỳ'\]/);
  // Danh mục mã: nguyên các mã app đang dùng cho số liệu bài đăng.
  const codes = H.POST_METRIC_OPTIONS.map((p) => p[0]);
  for (const code of ['lifetime_views', 'views', 'reach', 'impressions', 'likes', 'comments', 'shares']) {
    assert.ok(codes.includes(code), 'thiếu mã chỉ số bài đăng: ' + code);
  }
  assert.equal(H.postMetricLabel('lifetime_views'), 'Lượt xem lũy kế');
  assert.equal(H.postMetricLabel('views'), 'Lượt xem');
  assert.equal(H.postMetricLabel('reach'), 'Tiếp cận');
  assert.equal(H.postMetricLabel('impressions'), 'Hiển thị');
});

test('KPI-POST-UI [static]: lưu KPI MERGE definition cũ (giữ field khác + description) và đặt/gỡ definition.dataSource theo nguồn đã chọn', () => {
  const save = section("case 'kpi': {", "case 'measurement': {", saveStart);
  assert.match(save, /Object\.assign\(\{\}, kpiDefinitionObject\(existingKpiForDef\)\)/);
  assert.match(save, /if \(data\.definition\) koDefinition\.description = data\.definition;/);
  assert.match(save, /data\.dataSourceType === 'post_metrics'/);
  assert.match(save, /koDefinition\.dataSource = \{ type: 'post_metrics', metric: data\.dataSourceMetric \|\| 'lifetime_views', mode: data\.dataSourceMode \|\| 'latest_sum' \};/);
  assert.match(save, /delete koDefinition\.dataSource;/);
  assert.match(save, /definition: koDefinition,/);
  assert.doesNotMatch(save, /definition: data\.definition \? \{ description: data\.definition \} : \{\}/, 'vẫn ghi đè definition kiểu cũ, mất field khác');
});

// ---------- 2. Nhận diện + hiển thị KPI auto ----------
test('KPI-POST-UI [unit]: isKpiAuto chỉ đúng với definition.dataSource.type = post_metrics', () => {
  assert.equal(H.isKpiAuto(AUTO_KPI), true);
  assert.equal(H.kpiAutoMetric(AUTO_KPI), 'lifetime_views');
  assert.deepEqual(H.kpiDataSource(AUTO_KPI), { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum' });
  assert.equal(H.isKpiAuto(MANUAL_KPI), false);
  assert.equal(H.isKpiAuto({ id: 'k2', definition: 'chuỗi mô tả cũ' }), false);
  assert.equal(H.isKpiAuto({ id: 'k3' }), false);
  assert.equal(H.isKpiAuto({ id: 'k4', definition: { dataSource: { type: 'manual' } } }), false);
});

test('KPI-POST-UI [unit]: kpiAutoInfoHtml — badge + dòng "từ N bài · cập nhật …" từ autoActual; chưa có autoActual thì ghi chưa có dữ liệu; manual thì rỗng', () => {
  const html = H.kpiAutoInfoHtml(AUTO_KPI);
  assert.match(html, /data-kpi-auto-badge="1">Tự động từ bài đã đăng</);
  assert.match(html, /từ 1 bài · cập nhật DT\(2026-11-09T10:00:00\+07:00\)/);
  const noData = H.kpiAutoInfoHtml({ id: 'k9', definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'period_sum' } } });
  assert.match(noData, /Tự động từ bài đã đăng/);
  assert.match(noData, /chưa có dữ liệu bài đăng/);
  assert.equal(H.kpiAutoInfoHtml(MANUAL_KPI), '', 'KPI manual không được có badge/dòng auto');
});

test('KPI-POST-UI [unit]: metric reach có chú thích phủ định đúng nguyên văn và không gắn nhãn unique cho tổng reach ở nơi nào khác', () => {
  const reachKpi = { id: 'kr', unit: 'người', definition: { dataSource: { type: 'post_metrics', metric: 'reach', mode: 'latest_sum' } }, autoActual: { postCount: 3, latestObservedAt: '2026-11-09T09:00:00+07:00', rows: [] } };
  const html = H.kpiAutoInfoHtml(reachKpi);
  assert.ok(html.includes('Tổng lượt tiếp cận theo bài — không phải số người dùng không trùng.'));
  // Ngoài câu phủ định đó, helper hiển thị auto không dùng "không trùng"/"unique" như nhãn.
  const stripped = html.replace('Tổng lượt tiếp cận theo bài — không phải số người dùng không trùng.', '');
  assert.doesNotMatch(stripped, /không trùng|unique/i);
  // KPI auto không phải reach thì không có chú thích reach.
  assert.doesNotMatch(H.kpiAutoInfoHtml(AUTO_KPI), /Tổng lượt tiếp cận theo bài/);
});

test('KPI-POST-UI [static]: badge/dòng auto có mặt ở renderer dùng chung — progress chart, bảng KPI, mini Action Plan, summary và bảng KPI chính', () => {
  const progress = section('function vizKpiProgressHtml', 'function vizKpiTableHtml');
  assert.match(progress, /isKpiAuto\(k\)/);
  assert.match(progress, /kpiAutoInfoHtml\(k\)/);
  assert.match(progress, /data-action="kpi-drill"/);
  const table = section('function vizKpiTableHtml', 'function vizBudgetUsedBarHtml');
  assert.match(table, /kpiAutoInfoHtml\(k\)/);
  const mini = section('function vizKpiMiniHtml', 'function vizTaskTimelineHtml');
  assert.match(mini, /kpiAutoInfoHtml\(k\)/);
  const summary = section('function kpiSummaryHtml', 'function activityTasks');
  assert.match(summary, /kpiAutoInfoHtml\(k\)/);
  const view = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(view, /kpiAutoInfoHtml\(k\)/);
  assert.match(view, /'Tự động từ bài đã đăng'/);
});

// ---------- 3. Drill-down ----------
test('KPI-POST-UI [unit]: drill-down render đủ rows từ autoActual (tiêu đề/nền tảng/giá trị/thời điểm) và tổng bằng actual hiển thị', () => {
  const html = H.kpiAutoDrillHtml(AUTO_KPI);
  assert.match(html, /data-kpi-auto-drill="1"/);
  assert.match(html, /Bài giới thiệu sự kiện/);
  assert.match(html, /Facebook/);
  assert.match(html, /200/);
  assert.match(html, /DT\(2026-11-09T10:00:00\+07:00\)/);
  const sum = AUTO_KPI.autoActual.rows.reduce((s, r) => s + r.value, 0);
  assert.equal(sum, AUTO_KPI.actual, 'tổng rows phải bằng actual đang hiển thị');
  assert.match(html, new RegExp('Tổng các bài: <strong>' + sum + '</strong>'));
  // Nhiều bài: tổng cộng đúng từng dòng.
  const two = { id: 'k2b', unit: 'lượt xem', actual: 200, definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'latest_sum' } }, autoActual: { postCount: 2, latestObservedAt: '2026-11-09T10:00:00+07:00', rows: [
    { postId: 'p1', title: 'Bài một', platform: 'facebook', value: 120, observedAt: '2026-11-09T10:00:00+07:00' },
    { postId: 'p2', title: 'Bài hai', platform: 'tiktok', value: 80, observedAt: '2026-11-08T10:00:00+07:00' },
  ] } };
  const html2 = H.kpiAutoDrillHtml(two);
  assert.match(html2, /Bài một/); assert.match(html2, /Bài hai/);
  assert.match(html2, /Tổng các bài: <strong>200<\/strong>/);
  // Chưa có rows -> ghi rõ chưa có dữ liệu bài đăng; KPI manual -> rỗng.
  assert.match(H.kpiAutoDrillHtml({ id: 'k9', definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'latest_sum' } } }), /chưa có dữ liệu bài đăng/);
  assert.equal(H.kpiAutoDrillHtml(MANUAL_KPI), '');
});

test('KPI-POST-UI [static]: drill-down nối theo pattern toggle sẵn có (UI.kpiOpenId + data-action kpi-drill) ở progress chart và bảng KPI chính', () => {
  assert.match(src, /kpiOpenId: null,/);
  assert.match(src, /if \(action === 'kpi-drill'\) \{ UI\.kpiOpenId = UI\.kpiOpenId === id \? null : id; render\(\); \}/);
  const view = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(view, /data-action="kpi-drill" data-id="' \+ esc\(k\.id\)/);
  assert.match(view, /UI\.kpiOpenId === k\.id/);
  assert.match(view, /kpiAutoDrillHtml\(k\)/);
});

// ---------- 4. Form số đo cho KPI auto ----------
test('KPI-POST-UI [static]: form số đo của KPI auto disable các ô + hiện giải thích; save bị chặn với KPI_AUTO_SOURCE; nút thêm số đo ở bảng bị disable cho KPI auto', () => {
  const form = section("case 'measurement': {", "case 'budgetLine': {", editorStart);
  assert.match(form, /isKpiAuto\(kk\)/);
  assert.match(form, /data-kpi-auto-measurement="1">KPI này lấy số tự động từ bài đã đăng — số sẽ cập nhật khi bộ đếm của bài thay đổi\./);
  assert.match(form, /disabled: true/);
  const save = section("case 'measurement': {", "case 'budgetLine': {", saveStart);
  assert.match(save, /isKpiAuto\(measureKpi\)/);
  assert.match(save, /KPI_AUTO_SOURCE/);
  // Phòng thủ: guard nằm TRƯỚC req('value'...) để KPI auto không lưu được bằng đường nào.
  assert.ok(save.indexOf('isKpiAuto(measureKpi)') < save.indexOf("req('value'"), 'guard KPI auto phải đứng trước validate/lưu số đo');
  const view = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(view, /dis\(!ed \|\| kAuto\)/);
});

// ---------- 5. Demo ----------
test('KPI-POST-UI [unit]: demo có ĐÚNG 1 KPI auto mẫu — camp-1, lifetime_views latest_sum, target 500, actual null (store tự tính = 200 từ post-1)', () => {
  const autos = demo.kpis.filter((k) => k.definition && k.definition.dataSource && k.definition.dataSource.type === 'post_metrics');
  assert.equal(autos.length, 1, 'phải có đúng 1 KPI mẫu post_metrics');
  const k = autos[0];
  assert.equal(k.campaignId, 'camp-1');
  assert.equal(k.scopeType, 'campaign');
  assert.equal(k.metricCode, 'lifetime_views');
  assert.equal(k.name, 'Lượt xem lũy kế từ bài đã đăng — Campaign mẫu 1');
  assert.equal(k.target, 500);
  assert.ok(k.actual === null || k.actual === undefined, 'không đặt actual cứng cho KPI auto mẫu');
  assert.deepEqual(k.definition.dataSource, { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum' });
  // Đối chiếu dữ kiện demo sẵn có: post-1 (camp-1) lifetime_views mới nhất = 200.
  const post1 = demo.externalPosts.find((p) => p.id === 'post-1');
  assert.equal(post1.campaignId, 'camp-1');
  const lv = demo.metricObservations.filter((o) => o.externalPostId === 'post-1' && o.metric === 'lifetime_views')
    .slice().sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
  assert.deepEqual(lv.map((o) => o.value), [100, 150, 200]);
  assert.equal(lv[lv.length - 1].value, 200, 'actual đúng của KPI mẫu phải là 200 (latest)');
  assert.equal(demo.metricObservations.length, 6, 'không thêm/sửa observation demo nào khác');
});

test('KPI-POST-UI [unit]: các KPI demo khác giữ nguyên id/actual/definition ngoài ý muốn (đối chiếu từng id)', () => {
  const expected = {
    'kpi-1': { actual: 6200, dataSource: undefined },
    'kpi-2': { actual: null, dataSource: undefined },
    'kpi-3': { actual: 0, dataSource: undefined },
    'kpi-live-ads-reg': { actual: 100, dataSource: undefined },
    'kpi-live-seeding-reg': { actual: 60, dataSource: undefined },
    'kpi-live-campaign-reg': { actual: null, dataSource: undefined },
    'kpi-live-guests': { actual: 2, dataSource: undefined },
    'kpi-live-ads-cpl': { actual: null, dataSource: undefined },
    'kpi-live-campaign-cpl': { actual: null, dataSource: undefined },
  };
  const ids = demo.kpis.map((k) => k.id).sort();
  assert.deepEqual(ids, Object.keys(expected).concat(['kpi-auto-post-views']).sort(), 'tập id KPI demo chỉ thêm đúng KPI mẫu mới');
  for (const [id, exp] of Object.entries(expected)) {
    const k = demo.kpis.find((x) => x.id === id);
    assert.equal(k.actual, exp.actual, id + ': actual bị đổi ngoài ý muốn');
    assert.equal(k.definition && k.definition.dataSource, exp.dataSource, id + ': definition.dataSource bị đổi ngoài ý muốn');
  }
  // Fixture R3.1 D.2 giữ nguyên: unique 140/150 qua contributions không bị đụng.
  const camp = demo.kpis.find((k) => k.id === 'kpi-live-campaign-reg');
  assert.equal(camp.target, 150);
  assert.equal(camp.aggregationMode, 'unique');
  assert.equal(demo.kpiContributions.filter((c) => c.kpiId === camp.id).length, 2);
});
