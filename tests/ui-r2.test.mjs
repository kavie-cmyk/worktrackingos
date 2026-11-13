// tests/ui-r2.test.mjs
// Regression cho vòng sửa R2 — PHẦN C (UI, js/app.js).
// Tầng kiểm: [unit/static] đọc source js/app.js (IIFE trình duyệt, không DOM
// trong node --test) + [unit] kiểm fixture demo-data và hợp đồng domain mà
// UI tiêu thụ (aggregateRates byCurrency, commitmentPaidTotal...).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const demo = require('../js/demo-data.js');
const D = require('../js/domain.js');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ---------- R2-03: Gantt drag ----------
test('R2-03 [static]: pointermove cập nhật trực tiếp style.left/width của bar theo mode', () => {
  assert.match(src, /bar\.style\.left = \(ganttDrag\.origLeft \+ dx\) \+ 'px'/);
  assert.match(src, /bar\.style\.width = Math\.max\(pxPerDay, ganttDrag\.origWidth - dx\) \+ 'px'/);
  assert.match(src, /bar\.style\.width = Math\.max\(pxPerDay, ganttDrag\.origWidth \+ dx\) \+ 'px'/);
});

test('R2-03 [static]: pointerdown có setPointerCapture và có handler pointercancel khôi phục style', () => {
  assert.match(src, /bar\.setPointerCapture\(ev\.pointerId\)/);
  const cancel = section("addEventListener('pointercancel'", "addEventListener('pointerup'");
  assert.match(cancel, /drag\.bar\.style\.left = drag\.origStyleLeft/);
  assert.match(cancel, /drag\.bar\.style\.width = drag\.origStyleWidth/);
});

test('R2-03 [static]: ganttHtml vẽ thanh preview (is-preview, nhãn "Chưa lưu") cạnh thanh gốc mờ khi preview khớp row', () => {
  assert.match(src, /function ganttIsPreviewRow\(r\)/);
  assert.match(src, /is-preview/);
  assert.match(src, /g2-preview-label">Chưa lưu</);
  assert.match(src, /is-original/);
  // Đường phụ thuộc dùng ngày hiệu lực (preview-aware).
  assert.match(src, /var aS = ganttEffStart\(a\), aE = ganttEffEnd\(a\), bS = ganttEffStart\(b\)/);
});

// ---------- R2-28a: gantt-apply giữ preview khi lỗi ----------
test('R2-28a [static]: gantt-apply KHÔNG null UI.ganttPreview trước request — chỉ xóa trong callback thành công', () => {
  const block = section("action === 'gantt-apply'", "action === 'gantt-cancel'");
  assert.doesNotMatch(block, /var pv = UI\.ganttPreview; UI\.ganttPreview = null;/);
  const idxUpdate = block.indexOf('sUpdate(pv.coll, pv.id, patch)');
  const idxNull = block.indexOf('UI.ganttPreview = null');
  assert.ok(idxUpdate !== -1 && idxNull !== -1 && idxNull > idxUpdate, 'preview chỉ được xóa sau khi đã gọi update (trong callback)');
  assert.match(block, /UI\.ganttError = msg/);
  assert.match(block, /if \(UI\.ganttSaving\) return;/);
});

// ---------- R2-05: task panel draft ----------
test('R2-05 [static]: taskPanelHtml đọc UI.taskDraft và ưu tiên draft khi cùng taskId', () => {
  assert.match(src, /UI\.taskDraft && UI\.taskDraft\.taskId === t\.id/);
  assert.match(src, /function captureTaskDraft\(\)/);
  assert.match(src, /function taskDraftIsDirty\(\)/);
  assert.match(src, /UI\.taskDraftConflict/);
});

// ---------- R2-06/20/21: báo cáo từ adInsights theo byCurrency ----------
test('R2-06 [static]: reportDataset aggregate ads TỪ adInsights (không từ cây lifetime)', () => {
  const ds = section('function reportDataset()', 'function groupInsights');
  assert.match(ds, /Store\.list\('adInsights'\)/);
  assert.match(ds, /insightLevel\(ins\) === f\.level/);
  assert.match(ds, /chain\.imcCampaignId !== f\.campaignId/);
});

test('R2-20/21 [static]: viewReports render theo bucket byCurrency của aggregateRates mới', () => {
  assert.match(src, /var buckets = agg\.byCurrency \|\| \{\}/);
  assert.match(src, /bucketCurs\.forEach\(function \(cur\)/);
  assert.match(src, /Không đủ dữ liệu trong kỳ đã chọn/);
  const csv = section('function exportCsv()', 'function runGlobalSearch');
  assert.match(csv, /currency,spend/);
});

test('R2-20 [unit]: D.aggregateRates trả byCurrency tách tiền tệ (hợp đồng UI tiêu thụ)', () => {
  const agg = D.aggregateRates([
    { currency: 'VND', spend: 1000, impressions: 100, clicks: 10, results: 2, conversionValue: 3000 },
    { currency: 'USD', spend: 50, impressions: 200, clicks: 20, results: 4, conversionValue: 150 }
  ]);
  assert.ok(agg.byCurrency.VND && agg.byCurrency.USD);
  assert.equal(agg.mixed, true);
  assert.equal(agg.byCurrency.VND.totals.spend, 1000);
  assert.equal(agg.byCurrency.USD.totals.spend, 50);
  assert.equal(agg.byCurrency.VND.ctr, 0.1);
});

// ---------- R2-13: variant linkUrl/mediaUrl tách riêng ----------
test('R2-13 [static]: saveEditor variant không còn linkUrl: data.mediaUrl; form có field Link đích riêng', () => {
  assert.ok(!src.includes('linkUrl: data.mediaUrl'), 'vẫn còn gán linkUrl từ mediaUrl');
  assert.match(src, /linkUrl: data\.linkUrl \|\| ''/);
  assert.match(src, /F\('linkUrl', 'Link đích bài viết'/);
  assert.ok(!src.includes("ev('mediaUrl', vv.mediaUrl || vv.linkUrl)"), 'editor variant vẫn suy mediaUrl từ linkUrl');
});

// ---------- R2-15: snapshot duyệt không fallback variant hiện tại ----------
test('R2-15 [static]: approvalSnapshotHtml không fallback sang variant hiện tại cho hook/caption/...', () => {
  const snap = section('function approvalSnapshotHtml(a)', 'function viewApprovals()');
  assert.doesNotMatch(snap, /\(snap && snap\.hook\) \|\| v\.hook/);
  assert.doesNotMatch(snap, /snap \? \(snap\.caption/);
  assert.doesNotMatch(snap, /\|\| v\.scriptScenes/);
  assert.doesNotMatch(snap, /\|\| v\.mediaUrl/);
  assert.match(snap, /không có trong bản đóng băng/);
  assert.match(snap, /snapField\('caption'\)/);
  assert.match(snap, /snapField\('hook'\)/);
});

// ---------- R2-01: cam kết không tự tạo actual; có editor Ghi thanh toán ----------
test('R2-01 [static]: saveEditor commitment chỉ ghi commitments; form bỏ ô settledAmount; có kind commitmentPayment tạo actuals source manual', () => {
  assert.ok(!src.includes("F('settledAmount'"), 'form cam kết vẫn còn ô nhập số đã thanh toán');
  assert.ok(!src.includes('commitDone'), 'vẫn còn khối tự tạo actual kèm cam kết');
  const pay = section('// R2-01: ghi một khoản thanh toán', "case 'actual': {");
  assert.match(pay, /sCreate\('actuals'/);
  assert.match(pay, /source: 'manual'/);
  assert.match(pay, /commitmentId:/);
  // Form hiển thị "Đã thanh toán" read-only qua D.commitmentPaidTotal.
  assert.match(src, /Đã thanh toán \(từ các khoản thanh toán\)/);
  assert.match(src, /D\.commitmentPaidTotal/);
  // viewKpi có nút Ghi thanh toán cạnh Sửa cam kết.
  assert.match(src, /data-kind="commitmentPayment"/);
  assert.match(src, /Ghi thanh toán/);
});

test('R2-01 [unit]: D.commitmentPaidTotal chỉ tính Σ actuals liên kết', () => {
  const paid = D.commitmentPaidTotal({ id: 'c1', settledAmount: 999 }, [
    { commitmentId: 'c1', amount: 100 }, { commitmentId: 'c1', amount: 50 }, { commitmentId: 'c2', amount: 70 }
  ]);
  assert.equal(paid, 150);
});

// ---------- R2-02: viewKpi dùng openCommitmentTotal ----------
test('R2-02 [static]: viewKpi dùng D.openCommitmentTotal và D.budgetRemaining — không còn phép tính openCommit riêng', () => {
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /D\.openCommitmentTotal\(commits, acts\)/);
  assert.match(kpi, /D\.budgetRemaining\(b, commits, acts\)/);
  assert.doesNotMatch(kpi, /var paidByCommit = \{\}/);
});

// ---------- R2-09/10: actual form ----------
test('R2-09/10 [static]: form actual — source là select enum, ghi chú vào description, currency kế thừa dòng', () => {
  const form = section("case 'actual': {", "case 'post': {");
  assert.match(form, /F\('source', 'Nguồn chi', 'select'/);
  assert.match(form, /\['manual', 'Nhập tay'\], \['invoice', 'Hóa đơn'\], \['import', 'Nhập từ file'\]/);
  assert.match(form, /F\('description', 'Số chứng từ \/ ghi chú'/);
  assert.match(src, /currency: acLine2\.currency \|\| 'VND'/);
});

// ---------- R2-04: datetime helpers ----------
test('R2-04 [static]: không còn String(x).slice(0,16) cho datetime-local; save dùng fromDatetimeLocalValue', () => {
  assert.doesNotMatch(src, /scheduledAt \? String\(vv\.scheduledAt\)\.slice\(0, 16\)/);
  assert.match(src, /toDatetimeLocalValue\(vv\.scheduledAt\)/);
  assert.match(src, /scheduledAt: data\.scheduledAt \? fromDatetimeLocalValue\(data\.scheduledAt\) : null/);
  assert.match(src, /dateInTz\(v2\.scheduledAt\) >= weekStart/);
  assert.match(src, /dateInTz\(v\.scheduledAt\) === iso/);
});

// ---------- R2-07: pageHead campaign ----------
test('R2-07 [static]: campaignDetailHtml — subtitle pageHead là text thuần, badge ở block riêng', () => {
  const detail = section('function campaignDetailHtml(id)', '// ---------- Nội dung (Content) ----------');
  assert.doesNotMatch(detail, /pageHead\(c\.name, statusBadge/);
  assert.match(detail, /campaign-status-block">/);
});

// ---------- R2-17/18/23/25/26/27/28b/29/30 ----------
test('R2-17 [static]: hai chỗ đọc link asset dùng externalUrl trước url/fileUrl', () => {
  const hits = src.match(/a\.externalUrl \|\| a\.url \|\| a\.fileUrl/g) || [];
  assert.ok(hits.length >= 2, 'chỉ thấy ' + hits.length + ' chỗ');
});

test('R2-18 [static]: form KPI dùng periodStart/periodEnd dạng date và gửi khi lưu', () => {
  assert.match(src, /F\('periodStart', 'Kỳ đo — từ ngày', 'date'/);
  assert.match(src, /F\('periodEnd', 'Kỳ đo — đến ngày', 'date'/);
  assert.match(src, /periodStart: data\.periodStart \|\| null, periodEnd: data\.periodEnd \|\| null/);
});

test('R2-23 [static]: viewChannels hiển thị 2 trục — apiImplementation + trạng thái tài khoản', () => {
  assert.match(src, /a\.apiImplementation \|\| a\.api_implementation/);
  assert.match(src, /implemented_needs_credentials/);
});

test('R2-25 [static]: viewKpi có summary cards theo currency và bảng con cam kết/thực chi', () => {
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /Cam kết chưa trả/);
  assert.match(kpi, /Còn phân bổ/);
  assert.match(kpi, /Dự kiến sử dụng/);
  assert.match(kpi, /<th>Cam kết<\/th><th>Số tiền<\/th><th>Đã thanh toán<\/th>/);
});

test('R2-26 [static]: Gantt zoom thật — pxPerDay theo scale, track width = totalDays × pxPerDay, có nút Hôm nay + range UI.ganttRange', () => {
  assert.match(src, /function ganttPxPerDay\(\) \{ return UI\.ganttScale === 'month' \? 4 : 14; \}/);
  assert.match(src, /var trackW = totalDays \* pxPerDay;/);
  assert.match(src, /data-action="gantt-today">Hôm nay</);
  assert.match(src, /UI\.ganttRange\.from/);
});

test('R2-27 [static]: builder Gantt đệ quy dùng chung + nhóm Chưa gắn phase/activity + Việc độc lập', () => {
  assert.match(src, /function appendTaskTree\(rows, tasks, rootParentKeyOf, rootDepthOf\)/);
  assert.match(src, /\(byParent\[t\.id\] \|\| \[\]\)\.forEach/);
  assert.match(src, /Chưa gắn phase\/activity/);
  assert.match(src, /grp:independent/);
  assert.match(src, /Việc độc lập/);
  // Editor task có select phaseId/activityId + validate.
  assert.match(src, /F\('phaseId', 'Giai đoạn \(theo campaign\)', 'select'/);
  assert.match(src, /F\('activityId', 'Hoạt động', 'select'/);
  assert.match(src, /errors\.activityId = 'Hoạt động đã chọn không thuộc giai đoạn đã chọn\.'/);
});

test('R2-28b [static]: milestone từ isMilestone (không còn startDate===dueDate), mile có data-gantt-drag khóa resize', () => {
  assert.doesNotMatch(src, /milestone: !!\(t\.startDate && t\.startDate === t\.dueDate\)/);
  assert.match(src, /milestone: isMilestoneTask\(t\)/);
  assert.match(src, /class="g2-mile" data-mile="1"/);
  assert.match(src, /name="isMilestone"/);
});

test('R2-28c [static]: campaign có hành động Chốt baseline qua baselineVersions; form bỏ 2 ô baseline', () => {
  assert.match(src, /data-action="campaign-baseline"/);
  assert.match(src, /baselineVersionsOf\(bc\)/);
  assert.ok(!src.includes("F('baselineStartDate'"), 'form campaign vẫn còn ô nhập baseline');
});

test('R2-29 [static]: filter bar viewTasks + viewContent + brand (29.5/29.6/29.2)', () => {
  assert.match(src, /id="task-filter-form"/);
  assert.match(src, /id="content-filter-form"/);
  assert.match(src, /id="brand-filter-form"/);
  assert.match(src, /asset-thumb/);
});

test('R2-30 [static]: dirty confirm 3 lựa chọn, submitting không finally đồng bộ, focus trap, waiting-for-me', () => {
  assert.match(src, /data-action="confirm-save">Lưu</);
  assert.match(src, /data-action="confirm-discard">Bỏ thay đổi</);
  assert.match(src, /data-action="confirm-continue">Tiếp tục sửa</);
  const submit = section("f.getAttribute('data-editor-form')", "f.id === 'gantt-range-form'");
  assert.doesNotMatch(submit, /\}\s*finally\s*\{/);
  assert.match(src, /function trapTab\(ev\)/);
  assert.match(src, /function isWaitingForMe\(a, me\)/);
  assert.match(src, /data-action="approvals-tab"|approvalsTab/);
  // Marketing Requests: thao tác nhận xử lý / từ chối có lý do / chuyển thành việc chống trùng.
  assert.match(src, /data-action="request-accept"/);
  assert.match(src, /rejectionReason:/);
  assert.match(src, /marketingRequestId: id/);
});

// ---------- Fixture demo-data (R2-27/R2-06) ----------
test('R2-27 [unit]: demo-data có task gắn phase/activity, cây 4 cấp và 1 task độc lập', () => {
  const tasks = demo.tasks;
  assert.ok(tasks.some((t) => t.phaseId && t.activityId), 'chưa task nào gắn phase+activity');
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  // Đếm độ sâu cây từ task-tree-3 lên gốc.
  let depth = 1; let cur = byId['task-tree-3'];
  assert.ok(cur, 'thiếu fixture task-tree-3');
  while (cur.parentId) { cur = byId[cur.parentId]; depth++; }
  assert.ok(depth >= 3, 'cây fixture chưa đủ sâu (task→sub→sub-sub): depth=' + depth);
  assert.ok(tasks.some((t) => !t.campaignId), 'chưa có task độc lập');
  assert.ok(tasks.some((t) => t.isMilestone === true), 'chưa có task milestone mẫu');
});

test('R2-06 [unit]: demo-data có adInsights đúng grain (objectType/period/currency/metrics)', () => {
  assert.ok(Array.isArray(demo.adInsights) && demo.adInsights.length >= 3);
  for (const ins of demo.adInsights) {
    assert.ok(ins.objectType && ins.objectId && ins.periodStart && ins.periodEnd && ins.currency);
    assert.equal(typeof ins.spend, 'number');
  }
});

// ---------- PHẦN E (QA độc lập): groupInsights currency + reportDataset dateInTz ----------
test('QA-E [static]: groupInsights không gán mặc định VND cho dòng thiếu currency — giữ null, key bucket __unknown, viewReports hiện "Chưa rõ tiền tệ"', () => {
  const grp = section('function groupInsights', 'function viewReports');
  assert.doesNotMatch(grp, /currency:\s*r\.currency \|\| 'VND'/);
  assert.doesNotMatch(grp, /\|\| 'VND'/);
  assert.match(grp, /curNorm \|\| '__unknown'/);
  assert.match(grp, /currency: curNorm/);
  assert.match(src, /function currencyLabel\(cur\)/);
  assert.match(src, /Chưa rõ tiền tệ/);
  const vr = section('function viewReports()', '// ---------- Thiết lập ----------');
  assert.match(vr, /currencyLabel\(cur\)/);
  assert.match(vr, /currencyLabel\(r\.currency\)/);
});

test('QA-E [static]: reportDataset lọc metricObservations bằng dateInTz (ngày ICT), không còn slice ngày UTC', () => {
  const ds = section('function reportDataset()', 'function groupInsights');
  const obsPart = ds.slice(ds.indexOf("Store.list('metricObservations')"));
  assert.match(obsPart, /dateInTz\(o\.observedAt\)/);
  assert.doesNotMatch(obsPart, /String\(o\.observedAt/);
  assert.doesNotMatch(obsPart, /\.slice\(0, 10\)/);
});

// ---------- providers.ts / CAPABILITY_MATRIX (R2-23) ----------
test('R2-23 [static]: providers.ts có trục api_implementation với giá trị thật hiện tại', () => {
  const ts = readFileSync(new URL('../supabase/functions/_shared/providers.ts', import.meta.url), 'utf8');
  assert.match(ts, /export type ApiImplementationStatus/);
  assert.match(ts, /api_implementation: ApiImplementation/);
  assert.match(ts, /oauth: "implemented_needs_credentials"/);
  assert.match(ts, /publish: "not_implemented"/);
  assert.match(ts, /syncPosts: "not_implemented"/);
  assert.match(ts, /ads: "not_implemented"/);
  const count = (ts.match(/api_implementation: API_IMPL_CURRENT/g) || []).length;
  assert.equal(count, 5, 'phải gán cho đủ 5 provider');
  const doc = readFileSync(new URL('../docs/CAPABILITY_MATRIX.md', import.meta.url), 'utf8');
  assert.match(doc, /api_implementation/);
});
