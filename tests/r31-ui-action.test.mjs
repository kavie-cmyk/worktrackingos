// tests/r31-ui-action.test.mjs
// R3.1 — PHẦN UI ACTION PLAN (js/app.js + js/demo-data.js).
// Tầng kiểm: [static] đọc source js/app.js (IIFE trình duyệt, không DOM
// trong node --test) + [unit] kiểm fixture demo livestream bằng đúng engine
// domain mà UI tiêu thụ (summarizeBudgetScope / rollupKpi), theo D.1/D.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const demo = require('../js/demo-data.js');
const D = require('../js/domain.js');

function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}
const saveStart = src.indexOf('function saveEditor(');

// ---------- 1. Tab Action Plan + nhóm + số qua domain ----------
test('R3.1-UI [static]: campaign detail có tab Action Plan và route sub "action" hợp lệ', () => {
  assert.match(src, /\['action', 'Action Plan'\]/);
  assert.match(src, /\['overview', 'action', 'plan', 'tasks', 'content', 'kpi', 'docs', 'summary'\]/);
  assert.match(src, /function actionPlanHtml\(c\)/);
  assert.match(src, /data-action="action-group"/);
  assert.match(src, /Nhóm theo:/);
});

test('R3.1-UI [static]: số tiền/KPI của Action Plan đi qua domain (summarizeBudgetScope/rollupKpi), không tự cộng ở view', () => {
  const helpers = section('// ---------- R3.1: Action Plan', 'function campaignDetailHtml(id)');
  assert.match(helpers, /D\.summarizeBudgetScope\(/);
  assert.match(helpers, /D\.rollupKpi\(/);
  assert.match(helpers, /function summarizeCampaignBudget\(c\)/);
  assert.match(helpers, /function summarizeActivityBudget\(c, act\)/);
  assert.match(helpers, /function kpiRollupFor\(k\)/);
  // Trạng thái thiếu dữ liệu của rollup phải hiện "Chưa đủ dữ liệu", không bịa số.
  assert.match(helpers, /insufficient_data/);
  assert.match(helpers, /Chưa đủ dữ liệu/);
});

// ---------- 2. Drawer hoạt động ----------
test('R3.1-UI [static]: drawer hoạt động có 5 tab + section Nội dung liên quan + nút theo context đã điền sẵn campaign/activity', () => {
  assert.match(src, /function activityDrawerHtml\(\)/);
  assert.match(src, /root\.innerHTML = editorHtml\(\) \+ taskPanelHtml\(\) \+ activityDrawerHtml\(\) \+ confirmCloseHtml\(\)/);
  const drawer = section('function activityDrawerHtml()', 'function campaignDetailHtml(id)');
  assert.match(drawer, /\['overview', 'Tổng quan'\], \['tasks', 'Việc'\], \['kpi', 'KPI'\], \['budget', 'Ngân sách'\], \['docs', 'Tài liệu'\]/);
  assert.match(drawer, /Nội dung liên quan/);
  assert.match(drawer, /Không có nội dung liên quan/);
  for (const label of ['Tạo việc', 'Thêm KPI', 'Thêm dòng ngân sách', 'Ghi cam kết', 'Ghi thanh toán']) {
    assert.ok(drawer.includes(label), 'drawer thiếu nút: ' + label);
  }
  assert.match(drawer, /data-kind="task" data-campaign=/);
  assert.match(drawer, /data-activity="' \+ esc\(act\.id\)/);
});

// ---------- 3. Tổng quan campaign (C.7) ----------
test('R3.1-UI [static]: tổng quan campaign tách "Chưa phân bổ" ≠ "Còn có thể dùng" + cảnh báo KPI + đếm action', () => {
  const detail = section('function campaignDetailHtml(id)', '// ---------- Nội dung (Content) ----------');
  assert.match(detail, /summarizeCampaignBudget\(c\)/);
  for (const label of ['Hạn mức', 'Đã phân bổ', 'Chưa phân bổ', 'Thực chi', 'Cam kết chưa trả', 'Dự kiến sử dụng', 'Còn có thể dùng']) {
    assert.ok(detail.includes(label), 'tổng quan thiếu chỉ tiêu: ' + label);
  }
  assert.match(detail, /Hai số này khác nhau và không cộng lẫn nhau/);
  assert.match(detail, /chưa có nguồn\/cách tổng hợp hợp lệ/);
  assert.match(detail, /Hoạt động đúng hạn/);
  assert.match(detail, /Hoạt động bị chặn/);
});

// ---------- 4. Form KPI: scope selector + definition + aggregation + contributions ----------
test('R3.1-UI [static]: form KPI có scope selector đủ 6 scope, definition, metric_code, aggregation_mode, direction, owner', () => {
  const form = section("case 'kpi': {", "case 'measurement': {");
  assert.match(form, /F\('scopeType', 'Phạm vi \(scope\)', 'select'/);
  for (const s of ["['campaign', 'Campaign']", "['activity', 'Hoạt động']", "['task', 'Việc']", "['content', 'Nội dung']", "['pillar', 'Pillar']", "['bu_product', 'Brand / Sản phẩm']"]) {
    assert.ok(form.includes(s), 'thiếu scope: ' + s);
  }
  assert.match(form, /F\('metricCode', 'Mã chỉ số \(metric_code\)'/);
  assert.match(form, /F\('definition', 'Định nghĩa \/ cách đo \(definition\)'/);
  assert.match(form, /F\('aggregationMode', 'Cách tổng hợp \(aggregation_mode\)', 'select'/);
  for (const m of ['direct', 'sum', 'unique', 'ratio', 'snapshot', 'manual']) {
    assert.ok(form.includes("'" + m + "'"), 'thiếu aggregation mode: ' + m);
  }
  assert.match(form, /F\('direction', 'Chiều tốt lên', 'select'/);
  assert.match(form, /name="sourceKpiIds" multiple/);
  assert.match(form, /Kết quả roll-up hiện tại/);
});

test('R3.1-UI [static]: lưu KPI gửi scope/FK/aggregation qua store và đồng bộ contributions', () => {
  const save = section("case 'kpi': {", "case 'measurement': {", saveStart);
  assert.match(save, /scopeType: scopeType/);
  assert.match(save, /activityId: koActivity, taskId: koTask/);
  assert.match(save, /contentItemId: scopeType === 'content'/);
  assert.match(save, /pillarId: scopeType === 'pillar'/);
  assert.match(save, /aggregationMode: data\.aggregationMode/);
  assert.match(save, /metricCode: data\.metricCode/);
  assert.match(save, /syncKpiContributions\(kid, srcIds, ko\.aggregationMode/);
  // Chọn activity thì campaign tự điền từ activity.
  assert.match(save, /if \(kAct && kAct\.campaignId\) koCampaign = kAct\.campaignId/);
});

// ---------- 5. Form ngân sách: planned riêng + dấu duyệt chỉ-đọc + activity/task ----------
// SỬA THEO QUY TẮC MỚI CỦA ZAC (chuỗi duyệt 0014, 13/11/2026): form dòng ngân
// sách KHÔNG còn ô nhập trực tiếp "Được duyệt" (approved) — số duyệt chỉ đổi
// qua đề xuất ngân sách được Owner duyệt (RPC decide_budget_proposal, store
// strip approved_* khỏi payload thường). Hai test dưới đây trước đây khẳng
// định còn ô approved + payload approved; đã viết lại theo quy tắc mới.
test('R3.1-UI [static]: form dòng ngân sách có ô Kế hoạch (planned) + khối dấu duyệt chỉ-đọc và nút Đề xuất duyệt (KHÔNG còn ô nhập approved)', () => {
  const form = section("case 'budgetLine': {", "case 'budgetProposal': {");
  assert.match(form, /F\('planned', 'Kế hoạch \(planned\)', 'number'/);
  assert.ok(!form.includes("F('approved', 'Được duyệt (approved)', 'number'"), 'form vẫn còn ô nhập trực tiếp approved — trái quy tắc mới của Zac');
  assert.match(form, /budgetLineApprovalBlockHtml\(b\)/);
  assert.match(form, /data-kind="budgetProposal"/);
  assert.match(form, />Đề xuất duyệt</);
  assert.match(form, /F\('activityId', 'Hoạt động \(thuộc campaign\)', 'select'/);
  assert.match(form, /F\('taskId', 'Việc \(thuộc campaign\)', 'select'/);
  assert.match(form, /F\('currency', 'Tiền tệ', 'select'/);
});

test('R3.1-UI [static]: lưu dòng ngân sách chỉ gửi planned (trống = null) — KHÔNG gửi approved nữa (quy tắc mới của Zac)', () => {
  const save = section("case 'budgetLine': {", "case 'budgetProposal': {", saveStart);
  assert.match(save, /planned: \(data\.planned === '' \|\| data\.planned === null \|\| data\.planned === undefined\) \? null : Number\(data\.planned\)/);
  assert.doesNotMatch(save, /approved\s*:/);
  assert.doesNotMatch(save, /planned:\s*[^,]*approved/);
  assert.match(save, /activityId: data\.activityId \|\| null, taskId: data\.taskId \|\| null/);
});

// ---------- 6. Form khoản chi/thanh toán: title tách note (AC11 ở UI) ----------
test('R3.1-UI [static]: form khoản chi + ghi thanh toán tách ô "Nội dung khoản chi" (title) khỏi "Ghi chú / Chứng từ" (description)', () => {
  const actual = section("case 'actual': {", "case 'post': {");
  assert.match(actual, /F\('title', 'Nội dung khoản chi \*', 'text'/);
  assert.match(actual, /F\('description', 'Số chứng từ \/ ghi chú', 'text'/);
  assert.match(actual, /Ghi chú \/ Chứng từ — tách riêng khỏi ô Nội dung khoản chi/);
  const pay = section("case 'commitmentPayment': {", "case 'actual': {");
  assert.match(pay, /F\('title', 'Nội dung khoản chi', 'text'/);
  assert.match(pay, /F\('description', 'Ghi chú \/ Chứng từ', 'text'/);
  const paySave = section('// R2-01: ghi một khoản thanh toán', "case 'actual': {", saveStart);
  assert.match(paySave, /title: data\.title \|\|/);
});

// ---------- 7. Editor phân bổ chi chung ----------
test('R3.1-UI [static]: editor phân bổ validate bằng D.validateAllocations trước khi lưu; có nút mở từ view KPI', () => {
  const form = section("case 'allocation': {", "case 'commitment': {");
  assert.match(form, /Phân bổ chi chung/);
  assert.match(form, /F\('sharePercent', 'Tỷ lệ phân bổ \(%\)', 'number'/);
  const save = section("case 'allocation': {", "case 'commitment': {", saveStart);
  assert.match(save, /D\.validateAllocations\(alSrc,/);
  assert.match(save, /Phân bổ không hợp lệ: tổng phân bổ/);
  assert.match(save, /sCreate\('budgetAllocations', alo\)/);
  assert.match(src, /data-kind="allocation" data-source-kind="actual"/);
  assert.match(src, /data-kind="allocation" data-source-kind="commitment"/);
});

// ---------- 8. Template Livestream ----------
test('R3.1-UI [static]: template Livestream có 4 hoạt động + phân bổ 8/15/5/2tr sửa được, chỉ tạo dự thảo (không khoản chi/thanh toán, không approved)', () => {
  const tpl = section('var LIVESTREAM_TEMPLATE = [', 'function createLivestreamChildren');
  for (const n of ['Mời khách mời', 'Chạy ads', 'Seeding', 'Tổ chức livestream']) assert.ok(tpl.includes("name: '" + n + "'"), 'thiếu hoạt động mẫu: ' + n);
  for (const a of ['alloc: 8000000', 'alloc: 15000000', 'alloc: 5000000', 'alloc: 2000000']) assert.ok(tpl.includes(a), 'thiếu phân bổ mẫu: ' + a);
  const campForm = section("case 'campaign': {", "case 'phase': {");
  assert.match(campForm, /F\('template', 'Mẫu campaign', 'select'/);
  assert.match(campForm, /F\('tplAlloc0', 'Mời khách mời — phân bổ dự thảo', 'number', ev\('tplAlloc0', 8000000\)/);
  assert.match(campForm, /F\('tplAlloc3', 'Tổ chức livestream — phân bổ dự thảo', 'number', ev\('tplAlloc3', 2000000\)/);
  const create = section('function createLivestreamChildren', '// Đồng bộ kpiContributions');
  assert.match(create, /sCreate\('budgetLines', \{ name: 'Phân bổ dự thảo — ' \+ tpl\.name, campaignId: campaignId, activityId: actId, planned: alloc, approved: null, currency: 'VND' \}\)/);
  assert.match(create, /sCreate\('tasks',/);
  assert.match(create, /sCreate\('kpis',/);
  assert.doesNotMatch(create, /sCreate\('actuals'/);
  assert.doesNotMatch(create, /sCreate\('commitments'/);
});

// ---------- 9. Workload: capacity thật ----------
test('R3.1-UI [static]: workload dùng Store.capacityByMember(); chưa cấu hình hiện "Chưa cấu hình", không còn mặc định bịa', () => {
  const team = section('function viewTeam()', '// ---------- KPI & Ngân sách ----------');
  assert.match(team, /Store\.capacityByMember\(\)/);
  assert.match(team, /Chưa cấu hình/);
  assert.doesNotMatch(src, /m\.capacityHoursPerWeek \|\| 0/);
  const save = section("case 'memberCap': {", "case 'invite': {", saveStart);
  assert.match(save, /Store\.saveMemberCapacity\(e\.context\.memberId/);
});

// ---------- 10. Fixture demo livestream (unit, qua domain như UI) ----------
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

test('R3.1-FIX [unit]: fixture ngân sách livestream khớp D.1 — 30/20.5/7.5/28, chưa phân bổ 2, còn dùng được 4', () => {
  const { lines, commitments, actuals } = liveFacts();
  const camp = demo.campaigns.find((c) => c.id === 'camp-live');
  assert.equal(camp.budgetCeiling, 32 * M);
  const child = demo.activities.filter((a) => a.campaignId === 'camp-live').map((a) => ({
    activityId: a.id, scopeId: a.id, currency: 'VND',
    amount: lines.filter((l) => l.activityId === a.id).reduce((s, l) => s + l.approved, 0),
  }));
  const s = D.summarizeBudgetScope({ ceiling: camp.budgetCeiling, currency: 'VND', childAllocations: child, commitments, actuals });
  assert.equal(s.allocated, 30 * M);
  assert.equal(s.actualTotal, 20.5 * M);
  assert.equal(s.openCommitments, 7.5 * M);
  assert.equal(s.forecastUse, 28 * M);
  assert.equal(s.unallocated, 2 * M);
  assert.equal(s.available, 4 * M);
  assert.notEqual(s.available, 6 * M);
});

test('R3.1-FIX [unit]: còn trong hạn mức từng action = 0/1/1/0tr; task quay video + 2 content gắn Ads không đổi tổng tiền', () => {
  const { commitments, actuals } = liveFacts();
  const expected = { 'act-live-invite': 0, 'act-live-ads': 1, 'act-live-seeding': 1, 'act-live-show': 0 };
  const ceilings = { 'act-live-invite': 8, 'act-live-ads': 15, 'act-live-seeding': 5, 'act-live-show': 2 };
  for (const [aid, avail] of Object.entries(expected)) {
    const s = D.summarizeBudgetScope({ ceiling: ceilings[aid] * M, currency: 'VND', scopeId: aid, commitments, actuals });
    assert.equal(s.available, avail * M, aid);
  }
  assert.ok(demo.tasks.some((t) => t.id === 'task-live-video' && t.activityId === 'act-live-ads'));
  assert.equal(demo.contentItems.filter((x) => x.activityId === 'act-live-ads').length, 2);
  const s2 = D.summarizeBudgetScope({ ceiling: 32 * M, currency: 'VND', commitments, actuals });
  assert.equal(s2.actualTotal, 20.5 * M, 'thêm task/content liên kết không được làm tăng thực chi');
});

test('R3.1-FIX [unit]: KPI unique 100 + 60 − trùng 20 = 140/150 = 93,33%; CPL hai scope 100.000 vs ≈146.429', () => {
  const byId = Object.fromEntries(demo.kpis.map((k) => [k.id, k]));
  const camp = byId['kpi-live-campaign-reg'];
  assert.equal(camp.aggregationMode, 'unique');
  assert.equal(camp.target, 150);
  const facts = demo.kpiContributions.filter((c) => c.kpiId === camp.id).map((c) => {
    const sk = byId[c.sourceKpiId];
    return { id: 'fact-' + sk.id, metricCode: sk.metricCode, unit: sk.unit, period: sk.periodKey, value: sk.actual, identities: sk.identityKeys };
  });
  assert.equal(facts.length, 2);
  const r = D.rollupKpi(facts, { mode: 'unique', metricCode: 'valid_registrations', unit: 'người', period: '2026-11', target: 150 });
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 140);
  assert.equal(r.achievementPercent, 93.33);
  // KPI khách mời (metric khác) không lọt vào tổng đăng ký.
  assert.equal(byId['kpi-live-guests'].metricCode, 'confirmed_guests');
  const adsCpl = D.rollupKpi([], { mode: 'ratio', numerator: byId['kpi-live-ads-cpl'].numerator, denominator: byId['kpi-live-ads-cpl'].denominator });
  assert.equal(adsCpl.value, 100000);
  const campCpl = D.rollupKpi([], { mode: 'ratio', numerator: byId['kpi-live-campaign-cpl'].numerator, denominator: byId['kpi-live-campaign-cpl'].denominator });
  assert.equal(Math.round(campCpl.value), 146429);
  assert.match(byId['kpi-live-campaign-cpl'].name, /toàn campaign/);
});

test('R3.1-FIX [unit]: fixture giữ planned ≠ approved ở ít nhất 1 dòng (hai số độc lập) và không có hóa đơn chung trong campaign này', () => {
  const line = demo.budgetLines.find((l) => l.id === 'bl-live-ads');
  assert.equal(line.planned, 16 * M);
  assert.equal(line.approved, 15 * M);
  // Không khoản nào trong campaign này có allocations (hóa đơn chung 60/40
  // thuộc ca test domain/store riêng) — tổng thực chi giữ đúng 20,5tr.
  const { actuals } = liveFacts();
  assert.ok(actuals.every((a) => !a.allocations || !a.allocations.length));
  assert.deepEqual(demo.budgetAllocations, []);
});
