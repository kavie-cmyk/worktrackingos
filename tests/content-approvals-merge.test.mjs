// tests/content-approvals-merge.test.mjs
// Gộp "Duyệt content" vào "Content" thành một mục duy nhất:
// - Nav: không còn mục approvals riêng, chỉ còn mục Content.
// - View Content: cụm tab chính "Danh sách" | "Duyệt content" (badge =
//   số approvals pending + needs_reapproval — đúng tập "Tất cả đang chờ"
//   của view approvals cũ; badge LUÔN hiện kể cả khi 0).
// - Route: #/approvals cũ chuyển hướng sang Content với tab Duyệt mở;
//   đích mới #/content/approvals cũng mở tab Duyệt; #/content mặc định
//   (UI mới) mở tab Danh sách và tab đã chọn được giữ qua UI state
//   (UI.contentMainTab — cùng tiền lệ UI.contentTab / UI.campaignTab).
// - Logic duyệt không đổi: viewApprovals() vẫn là renderer hàng đợi,
//   handler decide / approvals-tab / quy tắc vai trò giữ nguyên.
// Tầng kiểm: [static] đọc source js/app.js + [unit] trích xuất hai hàm
// thật (contentPendingApprovalCount/contentMainTabsHtml + parseRoute)
// và chạy với Store/window stub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ---------- Nav / route table / VIEWS ----------
test('MERGE [static]: nav không còn mục approvals riêng — nhóm Kế hoạch & content chỉ còn Content + Task ở cuối', () => {
  const nav = section('var NAV_GROUPS = [', '];');
  assert.ok(!nav.includes("'approvals'"), 'NAV_GROUPS còn route approvals');
  assert.ok(!nav.includes("['approvals', 'Duyệt content']"), 'nav còn mục Duyệt content riêng');
  assert.match(nav, /\['content', 'Content'\], \['tasks', 'Task'\]\]/);
});

test('MERGE [static]: ROUTES không còn approvals như route độc lập; VIEWS không còn ánh xạ approvals -> view riêng', () => {
  const routesLine = src.match(/var ROUTES = \[[^\]]*\];/)[0];
  assert.ok(!routesLine.includes("'approvals'"), 'ROUTES còn approvals: ' + routesLine);
  assert.ok(routesLine.includes("'content'"), 'ROUTES thiếu content');
  const views = section('var VIEWS = {', '};');
  assert.ok(!views.includes("'approvals':"), 'VIEWS còn route approvals riêng');
  assert.match(views, /'content': viewContent/);
});

// ---------- parseRoute: redirect + mặc định (unit thật) ----------
function makeParseRoute(hash, mainTab) {
  const UI = { contentTab: 'calendar', contentMainTab: mainTab || 'list', campaignTab: 'overview' };
  const ROUTES = ['overview', 'my-work', 'brand', 'campaigns', 'timeline', 'planning', 'content', 'tasks', 'team', 'kpi', 'channels', 'ads', 'reports', 'settings'];
  const replaced = [];
  const windowStub = { location: { hash }, history: { replaceState: (a, b, url) => replaced.push(url) } };
  const fnSrc = section('function parseRoute()', 'var ROUTE =');
  const parseRoute = new Function('window', 'UI', 'ROUTES', fnSrc + '\nreturn parseRoute;')(windowStub, UI, ROUTES);
  return { parseRoute, UI, replaced };
}

test('MERGE [unit]: #/approvals chuyển hướng sang content với tab Duyệt đang mở', () => {
  const { parseRoute, UI, replaced } = makeParseRoute('#/approvals', 'list');
  const r = parseRoute();
  assert.equal(r.name, 'content');
  assert.equal(r.id, null);
  assert.equal(UI.contentMainTab, 'approvals');
  // URL thật được thay bằng đích mới (replaceState, không thêm history entry).
  assert.deepEqual(replaced, ['#/content/approvals']);
});

test('MERGE [unit]: #/content/approvals (đích mới của mọi link hộp duyệt) mở tab Duyệt', () => {
  const { parseRoute, UI } = makeParseRoute('#/content/approvals', 'list');
  const r = parseRoute();
  assert.equal(r.name, 'content');
  assert.equal(r.id, null);
  assert.equal(UI.contentMainTab, 'approvals');
});

test('MERGE [unit]: #/content ở UI mới mặc định tab Danh sách; tab Duyệt đã chọn trong phiên được giữ nguyên', () => {
  const fresh = makeParseRoute('#/content', 'list');
  assert.equal(fresh.parseRoute().name, 'content');
  assert.equal(fresh.UI.contentMainTab, 'list', 'mặc định phải là Danh sách');
  // Giữ tab qua UI state (tiền lệ contentTab/campaignTab): đang ở tab
  // Duyệt trong cùng phiên thì vào lại #/content vẫn ở tab Duyệt.
  const sticky = makeParseRoute('#/content', 'approvals');
  assert.equal(sticky.parseRoute().name, 'content');
  assert.equal(sticky.UI.contentMainTab, 'approvals');
});

// ---------- Cụm tab chính trong view Content ----------
test('MERGE [static]: viewContent có nhánh tab Duyệt render nguyên viewApprovals() + cụm tab ở cả hai nhánh', () => {
  const view = section('function viewContent()', '// ---------- Timeline hợp nhất');
  assert.match(view, /if \(UI\.contentMainTab === 'approvals'\)/);
  assert.match(view, /contentMainTabsHtml\(\) \+ viewApprovals\(\)/);
  // Nhánh Danh sách: cụm tab chính chèn ngay sau pageHead Content Plan.
  assert.match(view, /html \+= contentMainTabsHtml\(\);/);
  assert.match(src, /data-content-main-tabs="1"/);
  assert.match(src, /data-action="content-main-tab" data-id="list"/);
  assert.match(src, /data-action="content-main-tab" data-id="approvals"/);
  // Handler chuyển tab chính.
  assert.match(src, /if \(action === 'content-main-tab'\) \{ UI\.contentMainTab = id === 'approvals' \? 'approvals' : 'list'; render\(\); \}/);
  // UI state mặc định Danh sách.
  assert.match(src, /contentMainTab: 'list'/);
});

// ---------- Badge: đếm khớp hàng đợi + luôn hiện khi 0 (unit thật) ----------
function makeTabsHtml(approvals, mainTab) {
  const Store = { list: (coll) => (coll === 'approvals' ? approvals : []) };
  const UI = { contentMainTab: mainTab || 'list' };
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fnSrc = section('function contentPendingApprovalCount()', 'function variantCardActions');
  const api = new Function('Store', 'UI', 'esc', fnSrc + '\nreturn { count: contentPendingApprovalCount, tabs: contentMainTabsHtml };')(Store, UI, esc);
  return api;
}

test('MERGE [unit]: badge đếm đúng pending + needs_reapproval (cùng tập "Tất cả đang chờ" của view approvals cũ), bỏ qua đã quyết', () => {
  const data = [
    { id: 'a1', status: 'pending' },
    { id: 'a2', status: 'needs_reapproval' },
    { id: 'a3', status: 'pending' },
    { id: 'a4', status: 'approved' },
    { id: 'a5', status: 'rejected' },
    { id: 'a6', status: 'changes_requested' },
  ];
  const api = makeTabsHtml(data, 'list');
  assert.equal(api.count(), 3);
  const html = api.tabs();
  assert.match(html, /data-content-approvals-badge="1">3<\/span>/);
  assert.match(html, />Danh sách<\/button>/);
  assert.match(html, />Duyệt content <span/);
});

test('MERGE [unit]: badge vẫn hiện số 0 khi không có gì chờ duyệt (lựa chọn đã ghi ở bàn giao)', () => {
  const api = makeTabsHtml([{ id: 'a1', status: 'approved' }], 'approvals');
  assert.equal(api.count(), 0);
  const html = api.tabs();
  assert.match(html, /data-content-approvals-badge="1">0<\/span>/);
  // Đang ở tab Duyệt thì nút Duyệt mang class active + aria-selected=true.
  assert.match(html, /data-id="approvals" role="tab" aria-selected="true"/);
});

// ---------- Hàng đợi duyệt giữ nguyên chức năng ----------
test('MERGE [static]: tab Duyệt giữ nguyên hàng đợi cũ — lọc mine/all, nút Duyệt/Yêu cầu sửa/Từ chối, cổng vai trò canApprove, hàng đợi ngân sách', () => {
  const v = section('function viewApprovals()', '// ---------- Team & Workload ----------');
  assert.match(v, /UI\.approvalsTab === 'mine' \? minePending : allPending/);
  assert.match(v, /data-action="decide" data-decision="approved"/);
  assert.match(v, /data-action="decide" data-decision="changes_requested"/);
  assert.match(v, /data-action="decide" data-decision="rejected"/);
  assert.match(v, /var ok = canApprove\(\);/);
  assert.match(v, /tabsHtml\(\[\['mine', 'Chờ mình duyệt \(' \+ minePending\.length \+ '\)'\], \['all', 'Tất cả đang chờ \(' \+ allPending\.length \+ '\)'\]\], UI\.approvalsTab, 'approvals-tab'\)/);
  assert.match(v, /budgetProposalsQueueHtml\(\)/);
  assert.match(v, /data-viz="approval-queue-strip"/);
});

// ---------- Mọi link tới hộp duyệt trỏ đích mới ----------
test('MERGE [static]: không còn link href="#/approvals" nào; mọi điểm vào hộp duyệt dùng #/content/approvals', () => {
  assert.ok(!src.includes('href="#/approvals"'), 'còn link href="#/approvals"');
  assert.ok(!src.includes("href: '#/approvals'"), "còn href: '#/approvals'");
  const hits = src.match(/#\/content\/approvals/g) || [];
  // Overview (KPI card + danh sách chờ duyệt), Task của tôi, Báo cáo (KPI card)
  // + parseRoute đích mới trong comment/handler = ít nhất 4 link thật.
  const linkHits = src.match(/href[:=] ?["']#\/content\/approvals/g) || [];
  assert.ok(linkHits.length >= 4, 'chỉ thấy ' + linkHits.length + ' link tới #/content/approvals');
  assert.ok(hits.length >= linkHits.length);
  // Toast gửi duyệt trỏ đúng tab mới.
  assert.match(src, /ở tab Duyệt content trong mục Content/);
});
