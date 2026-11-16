// tests/app-ui-syn-fixes.test.mjs
// ĐỢT SỬA FINDINGS QA 16/11/2026 — EXECUTOR 4 (App/UI):
//   SYN-01 summary ngân sách cho campaign có dòng scope campaign;
//   SYN-13 bucket currency chưa đặt trần -> available = null (không âm giả);
//   SYN-07 nút Từ chối không bị disable bởi các chặn của nhánh duyệt;
//   SYN-04 thông điệp BUDGET_NOT_APPROVED nói rõ tầng campaign / dòng;
//   SYN-10 làm tròn phân bổ largest-remainder 2 chữ số (parity JS);
//   SYN-11/12/29/30 CSS: a.btn, .g2-toggle, token chữ st-todo, đích chạm phụ;
//   SYN-19 hàng nhóm Gantt không còn nhãn "Chưa xếp lịch";
//   SYN-20 thứ tự hàng cây GIỮ NGUYÊN (hành vi cố ý — chỉ khóa lại);
//   SYN-21 activity mượn ngày phase đếm riêng khi chốt baseline;
//   SYN-24 chú thích mẫu số heatmap Pillar × Kênh;
//   SYN-27 thuật ngữ: Lưu post / cột Content / Trạng thái hoạt động;
//   SYN-28 khoá kéo Gantt theo quyền campaign.edit cho hàng cấu trúc;
//   SYN-15 cơ cấu Thực chi/Cam kết mở ở tầng hiển thị khớp currency.
// Tầng kiểm: [unit] trích xuất hàm thật của js/app.js chạy với stub Store +
// fixture demo / fixture tự dựng; [static] khóa cấu trúc source/CSS.

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
const M = 1000000;

// ---------- Stub dùng chung cho các helper trích từ app.js ----------
function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}
const demoState = (demo.buildDemoData ? demo.buildDemoData() : demo);
const demoData = demoState.state || demoState;
function demoDb() {
  return {
    budgetLines: demoData.budgetLines, activities: demoData.activities,
    commitments: demoData.commitments, actuals: demoData.actuals,
    budgetAllocations: demoData.budgetAllocations || [],
    campaigns: demoData.campaigns,
  };
}
const holder = { data: demoDb() };
const StoreStub = {
  list: (c) => holder.data[c] || [],
  get: (c, id) => (holder.data[c] || []).find((x) => x.id === id) || null,
};
function visibleListStub(coll) {
  return StoreStub.list(coll).filter((x) => !(x && (x.archivedAt || x.archived || String(x.status || '').toLowerCase() === 'archived')));
}

// ---------- Adapter ngân sách (summarizeCampaignBudget / summarizeActivityBudget) ----------
const adaptersSrc = section('function listSafe', 'function kpiPeriodKey');
const A = new Function('Store', 'D', 'visibleList', 'cfVal',
  adaptersSrc + '\nreturn { summarizeCampaignBudget: summarizeCampaignBudget, summarizeActivityBudget: summarizeActivityBudget, factsForActivity: factsForActivity };'
)(StoreStub, D, visibleListStub, cfValStub);

// ---------- SYN-01: summary campaign có dòng scope campaign ----------
test('SYN-01 [unit]: camp-1 (dòng scope campaign) — allocated/ceiling 130tr, actual 26tr, open 47tr, available +57tr', () => {
  holder.data = demoDb();
  const camp = demoData.campaigns.find((c) => c.id === 'camp-1');
  const rows = A.summarizeCampaignBudget(camp);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.currency, 'VND');
  assert.equal(r.ceilingConfigured, false);
  assert.equal(r.allocated, 130 * M);
  assert.equal(r.ceiling, 130 * M);
  assert.equal(r.actualTotal, 26 * M);
  assert.equal(r.openCommitments, 47 * M);
  assert.equal(r.forecastUse, 73 * M);
  assert.equal(r.available, 57 * M);
});

test('SYN-01 [unit]: 3 summary_activity của camp-1 đều bằng 0 (không lặp total campaign)', () => {
  holder.data = demoDb();
  const camp = demoData.campaigns.find((c) => c.id === 'camp-1');
  for (const actId of ['act-1', 'act-2', 'act-3']) {
    const act = demoData.activities.find((a) => a.id === actId);
    const rows = A.summarizeActivityBudget(camp, act);
    assert.equal(rows.length, 1, actId);
    assert.equal(rows[0].actualTotal, 0, actId);
    assert.equal(rows[0].openCommitments, 0, actId);
    assert.equal(rows[0].ceiling, 0, actId);
  }
});

test('SYN-01 [unit]: camp-2 có summary cho CẢ 2 currency (VND 30tr + USD 1.500) và qua được bộ lọc xuất CSV', () => {
  holder.data = demoDb();
  const camp = demoData.campaigns.find((c) => c.id === 'camp-2');
  const rows = A.summarizeCampaignBudget(camp);
  assert.equal(rows.length, 2);
  const vnd = rows.find((r) => r.currency === 'VND');
  const usd = rows.find((r) => r.currency === 'USD');
  assert.deepEqual([vnd.allocated, vnd.ceiling, vnd.actualTotal, vnd.openCommitments, vnd.available], [30 * M, 30 * M, 0, 0, 30 * M]);
  assert.deepEqual([usd.allocated, usd.ceiling, usd.actualTotal, usd.openCommitments, usd.available], [1500, 1500, 0, 0, 1500]);
  // Điều kiện giữ dòng summary của exportBudgetCsv (ceiling/allocated/actual/open > 0):
  const kept = rows.filter((r) => r.ceiling > 0 || r.allocated > 0 || r.actualTotal > 0 || r.openCommitments > 0);
  assert.equal(kept.length, 2, 'cả 2 dòng summary của camp-2 phải lọt bộ lọc CSV');
});

test('SYN-01 [unit]: đối chứng camp-live GIỮ NGUYÊN tuyệt đối — ceiling 32tr / allocated 30tr / actual 20,5tr / open 7,5tr / available 4tr', () => {
  holder.data = demoDb();
  const camp = demoData.campaigns.find((c) => c.id === 'camp-live');
  const rows = A.summarizeCampaignBudget(camp);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.ceilingConfigured, true);
  assert.deepEqual([r.ceiling, r.allocated, r.actualTotal, r.openCommitments, r.forecastUse, r.available],
    [32 * M, 30 * M, 20.5 * M, 7.5 * M, 28 * M, 4 * M]);
  // Từng activity của camp-live giữ nguyên số cũ (invite 0 / ads 1tr / seeding 1tr / show 0 còn trong hạn mức).
  const expectedAvail = { 'act-live-invite': 0, 'act-live-ads': 1 * M, 'act-live-seeding': 1 * M, 'act-live-show': 0 };
  for (const [actId, avail] of Object.entries(expectedAvail)) {
    const act = demoData.activities.find((a) => a.id === actId);
    const arows = A.summarizeActivityBudget(camp, act);
    assert.equal(arows.length, 1, actId);
    assert.equal(arows[0].available, avail, actId);
  }
});

test('SYN-01 [static]: summarizeActivityBudget truyền facts đã scope (scoped.*), không truyền facts toàn campaign', () => {
  const fn = section('function summarizeActivityBudget', 'function kpiPeriodKey');
  assert.match(fn, /commitments: scoped\.commitments, actuals: scoped\.actuals/);
  assert.doesNotMatch(fn, /commitments: facts\.commitments, actuals: facts\.actuals/);
});

// ---------- SYN-13: bucket currency chưa đặt trần -> available null ----------
test('SYN-13 [unit]: campaign có actual USD nhưng KHÔNG có dòng USD và không có trần USD -> available của bucket USD = null (không phải -700)', () => {
  holder.data = {
    campaigns: [{ id: 'cx', name: 'CX' }],
    budgetLines: [{ id: 'l-vnd', campaignId: 'cx', currency: 'VND', approved: 100 }],
    commitments: [],
    actuals: [{ id: 'a-usd', campaignId: 'cx', amount: 700, currency: 'USD', approvalStatus: 'approved' }],
    activities: [], budgetAllocations: [],
  };
  const rows = A.summarizeCampaignBudget({ id: 'cx', name: 'CX' });
  const usd = rows.find((r) => r.currency === 'USD');
  assert.equal(usd.actualTotal, 700);
  assert.equal(usd.available, null, 'chưa đặt trần USD thì không được hiện available âm giả');
  const vnd = rows.find((r) => r.currency === 'VND');
  assert.equal(vnd.available, 100, 'bucket có dòng ngân sách giữ available số như cũ');
});

test('SYN-13 [unit]: activity có actual USD nhưng không có dòng USD -> available = null; có dòng thì giữ số', () => {
  holder.data = {
    campaigns: [{ id: 'cy', name: 'CY' }],
    budgetLines: [{ id: 'l1', campaignId: 'cy', activityId: 'ay2', currency: 'USD', approved: 1000 }],
    commitments: [],
    actuals: [
      { id: 'a1', campaignId: 'cy', activityId: 'ay', amount: 700, currency: 'USD', approvalStatus: 'approved' },
      { id: 'a2', campaignId: 'cy', activityId: 'ay2', amount: 700, currency: 'USD', approvalStatus: 'approved' },
    ],
    activities: [
      { id: 'ay', campaignId: 'cy', name: 'AY không dòng' },
      { id: 'ay2', campaignId: 'cy', name: 'AY2 có dòng' },
    ],
    budgetAllocations: [],
  };
  const camp = { id: 'cy', name: 'CY' };
  const r1 = A.summarizeActivityBudget(camp, { id: 'ay', campaignId: 'cy' });
  assert.equal(r1[0].actualTotal, 700);
  assert.equal(r1[0].available, null);
  const r2 = A.summarizeActivityBudget(camp, { id: 'ay2', campaignId: 'cy' });
  assert.equal(r2[0].available, 300);
  holder.data = demoDb();
});

// ---------- SYN-10: largest-remainder 2 chữ số ----------
test('SYN-10 [unit]: hóa đơn 100 chia 1/3 x3 (ratio và percent) -> tổng các share đúng 100, phần lẻ dồn cho share đầu', () => {
  const byRatio = { id: 'inv', amount: 100, allocations: [{ scopeId: 's1', ratio: 1 / 3 }, { scopeId: 's2', ratio: 1 / 3 }, { scopeId: 's3', ratio: 1 / 3 }] };
  const sharesR = ['s1', 's2', 's3'].map((s) => D.allocationShareForScope(byRatio, s));
  assert.deepEqual(sharesR, [33.34, 33.33, 33.33]);
  assert.equal(Math.round(sharesR.reduce((a, b) => a + b, 0) * 100) / 100, 100);
  const byPct = { id: 'inv2', amount: 100, allocations: [{ scopeId: 's1', percent: 33.333333 }, { scopeId: 's2', percent: 33.333333 }, { scopeId: 's3', percent: 33.333333 }] };
  const sharesP = ['s1', 's2', 's3'].map((s) => D.allocationShareForScope(byPct, s));
  assert.equal(Math.round(sharesP.reduce((a, b) => a + b, 0) * 100) / 100, 100);
});

test('SYN-10 [unit]: hóa đơn chung 3tr chia 60/40 giữ nguyên 1,8tr / 1,2tr; tổng qua summarizeBudgetScope theo scope = đúng số gốc', () => {
  const inv = { id: 'inv3', amount: 3000000, allocations: [{ scopeId: 'act-ads', ratio: 0.6 }, { scopeId: 'act-seeding', ratio: 0.4 }] };
  assert.equal(D.allocationShareForScope(inv, 'act-ads'), 1800000);
  assert.equal(D.allocationShareForScope(inv, 'act-seeding'), 1200000);
  const fact = { id: 'inv4', amount: 100, currency: 'VND', approvalStatus: 'approved', allocations: [{ scopeId: 's1', ratio: 1 / 3 }, { scopeId: 's2', ratio: 1 / 3 }, { scopeId: 's3', ratio: 1 / 3 }] };
  const total = ['s1', 's2', 's3'].reduce((sum, s) => {
    const r = D.summarizeBudgetScope({ ceiling: 100, currency: 'VND', scopeId: s, actuals: [fact] });
    return sum + r.actualTotal;
  }, 0);
  assert.equal(Math.round(total * 100) / 100, 100);
});

// ---------- SYN-04 + SYN-07 + SYN-15: helpers duyệt + currency ----------
const controlsSrc = section('function factApprovalStatusOf', 'function budgetProposalCurrentValue');
const holder2 = {
  data: {
    budgetLines: [
      { id: 'line-ok', campaignId: 'camp-ok', currency: 'VND', approved: 100, approvedBy: 'owner-1' },
      { id: 'line-chua-duyet', campaignId: 'camp-ok', currency: 'VND', approved: 100, approvedBy: null },
      { id: 'line-camp-chua-duyet', campaignId: 'camp-chua', currency: 'VND', approved: 100, approvedBy: 'owner-1' },
    ],
    campaigns: [
      { id: 'camp-ok', approvedBy: 'owner-1' },
      { id: 'camp-chua', approvedBy: null },
    ],
    commitments: [], actuals: [],
  },
};
const StoreStub2 = {
  list: (c) => holder2.data[c] || [],
  get: (c, id) => (holder2.data[c] || []).find((x) => x.id === id) || null,
};
function escStub(s) { return String(s === null || s === undefined ? '' : s); }
const C = new Function('Store', 'D', 'can', 'esc', 'vizStatusPillHtml', 'labelStatus',
  controlsSrc + '\nreturn { factApprovalControlsHtml: factApprovalControlsHtml, budgetFactBlockReason: budgetFactBlockReason, factCurrencyMatches: factCurrencyMatches };'
)(StoreStub2, D, () => true, escStub, () => '<span class="pill">pending</span>', (s) => String(s || ''));

test('SYN-07 [unit]: fact pending ở dòng chưa duyệt — nút Duyệt disabled kèm lý do, nút Từ chối KHÔNG disabled', () => {
  const html = C.factApprovalControlsHtml({ id: 'f1', budgetLineId: 'line-chua-duyet', approvalStatus: 'pending' }, 'commitment');
  const tags = [...html.matchAll(/<button[^>]*data-decision="(approved|rejected)"[^>]*>/g)];
  assert.equal(tags.length, 2);
  const approve = tags.find((t) => t[1] === 'approved')[0];
  const reject = tags.find((t) => t[1] === 'rejected')[0];
  assert.match(approve, /disabled/);
  assert.doesNotMatch(reject, /disabled/);
  assert.match(html, /budget-approval-block-reason/);
});

test('SYN-04 [unit]: budgetFactBlockReason phân tầng — dòng chưa duyệt vs hạn mức campaign chưa duyệt', () => {
  assert.equal(C.budgetFactBlockReason({ id: 'f1', budgetLineId: 'line-chua-duyet' }, 'commitment'), 'Dòng ngân sách chưa được duyệt');
  assert.equal(C.budgetFactBlockReason({ id: 'f2', budgetLineId: 'line-camp-chua-duyet' }, 'commitment'), 'Hạn mức campaign chưa được duyệt');
  assert.equal(C.budgetFactBlockReason({ id: 'f3', budgetLineId: 'line-ok' }, 'commitment'), '');
});

const mapFn = new Function(section('function budgetApprovalErrorMessage', 'function budgetProposalChange') + '\nreturn budgetApprovalErrorMessage;')();
test('SYN-04 [unit]: budgetApprovalErrorMessage nói rõ tầng thiếu dấu (missingStamp / level= / câu chữ store), fallback chung giữ nguyên', () => {
  assert.match(mapFn({ error: 'BUDGET_NOT_APPROVED: x', missingStamp: 'campaign' }, 'fact'), /Hạn mức campaign chưa được duyệt/);
  assert.match(mapFn({ error: 'BUDGET_NOT_APPROVED: x', missingStamp: 'line' }, 'fact'), /Dòng ngân sách chưa được duyệt/);
  assert.match(mapFn('BUDGET_NOT_APPROVED: thiếu dấu duyệt ở tầng campaign (campaigns.approved_by null); level=campaign', 'fact'), /Hạn mức campaign chưa được duyệt/);
  assert.match(mapFn('BUDGET_NOT_APPROVED: dòng ngân sách chưa có dấu duyệt (approved_by null); level=budget_line', 'fact'), /Dòng ngân sách chưa được duyệt/);
  assert.match(mapFn('BUDGET_NOT_APPROVED: campaign chưa có dấu duyệt hạn mức (approved_by null)', 'fact'), /Hạn mức campaign chưa được duyệt/);
  assert.equal(mapFn('BUDGET_NOT_APPROVED: dòng chưa duyệt', 'fact'), 'Khoản ngân sách chưa được duyệt');
});

test('SYN-15 [unit]: ca actual USD 30 gắn cam kết VND 50 — cơ cấu hiển thị khớp domain/SQL: Thực chi 0 / Cam kết mở 50 (không còn 30/20)', () => {
  const line = { id: 'l', approved: 100, currency: 'VND' };
  const commits = [{ id: 'c1', budgetLineId: 'l', amount: 50, currency: 'VND', status: 'committed', approvalStatus: 'approved' }];
  const acts = [{ id: 'a1', budgetLineId: 'l', commitmentId: 'c1', amount: 30, currency: 'USD', approvalStatus: 'approved' }];
  // Domain (nguồn sự thật sau đợt 1): usage 50.
  assert.equal(D.budgetUsageTotal(line, commits, acts), 50);
  // Cơ cấu ở tầng hiển thị app (lọc factCurrencyMatches như viewKpi/CSV):
  const commitsCur = commits.filter((x) => C.factCurrencyMatches(x, line.currency));
  const actsCur = acts.filter((x) => C.factCurrencyMatches(x, line.currency));
  const spent = actsCur.reduce((s, a) => s + a.amount, 0);
  const open = D.openCommitmentTotal(commitsCur, actsCur);
  assert.deepEqual([spent, open], [0, 50]);
  // factCurrencyMatches: thiếu currency = lệch khi phía chuẩn có currency.
  assert.equal(C.factCurrencyMatches({ currency: 'USD' }, 'VND'), false);
  assert.equal(C.factCurrencyMatches({}, 'VND'), false);
  assert.equal(C.factCurrencyMatches({ currency: 'USD' }, ''), true);
});

test('SYN-15 [static]: viewKpi + export lineStats lọc fact theo currency của dòng trước khi tính Thực chi/Cam kết mở', () => {
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /D\.openCommitmentTotal\(commitsCur, actsCur\)/);
  assert.match(kpi, /factCurrencyMatches\(x, cm\.currency \|\| cur\)/);
  const exp = section('function exportBudgetCsv', 'function exportCashCsv');
  assert.match(exp, /D\.openCommitmentTotal\(csCur, asCur\)/);
});

// ---------- SYN-19 / SYN-20 / SYN-28: Gantt ----------
test('SYN-19 [static]: ganttHtml không in nhãn "Chưa xếp lịch" cho hàng nhóm (kind=group), hàng khác giữ nguyên', () => {
  const g = section('function ganttHtml', 'function ganttTaskRow');
  assert.match(g, /else if \(r\.kind !== 'group'\) \{\s*\/\/ SYN-19/);
  assert.match(g, /g2-unsched">Chưa xếp lịch<\/span>/);
});

test('SYN-28 [static]: ganttHtml khoá kéo hàng campaign/phase/activity theo campaign.edit, hàng task giữ gate canEdit', () => {
  const g = section('function ganttHtml', 'function ganttTaskRow');
  assert.match(g, /var locked = r\.completed \|\| !canEdit\(\);/);
  assert.match(g, /r\.kind === 'campaign' \|\| r\.kind === 'phase' \|\| r\.kind === 'activity'\) locked = r\.completed \|\| !can\('campaign\.edit'\)/);
});

test('SYN-20 [static]: thứ tự hàng cây GIỮ NGUYÊN hành vi cố ý — hàng cấu trúc (phase/activity) trước, task nối sau qua appendTaskTree', () => {
  const builder = section('function appendPhaseActivityRows', 'function ganttRowsCampaign');
  const phaseAt = builder.indexOf("rows.push({ key: pkey");
  const taskTreeAt = builder.indexOf('appendTaskTree(rows, tasks');
  assert.ok(phaseAt !== -1 && taskTreeAt !== -1 && phaseAt < taskTreeAt, 'hàng cấu trúc vẫn đứng trước hàng task như đặc tả hiện tại');
});

// ---------- SYN-21: baseline — borrowed tách khỏi skipped + stats text ----------
const baselineHelpers = new Function('Store', 'can',
  section('function cfVal', 'var NAV_GROUPS') + '\nreturn { baselineTreePlan: baselineTreePlan, baselineVersionStatsText: baselineVersionStatsText };'
)({ currentRole: () => 'owner', currentUserId: 'u-1' }, () => false);

test('SYN-21 [unit]: activity không ngày riêng + phase có đủ ngày -> borrowed (không skipped, không có item ghi); phase cũng thiếu ngày -> skipped', () => {
  const plan = baselineHelpers.baselineTreePlan(
    { id: 'c1', startDate: '2026-11-02', endDate: '2026-11-30' },
    [{ id: 'p1', startDate: '2026-11-02', endDate: '2026-11-13' }, { id: 'p2', startDate: null, endDate: null }],
    [
      { id: 'a-borrow', phaseId: 'p1', startDate: null, endDate: null },
      { id: 'a-skip', phaseId: 'p2', startDate: null, endDate: null },
      { id: 'a-own', phaseId: 'p1', startDate: '2026-11-03', endDate: '2026-11-10' },
    ],
    []
  );
  assert.equal(plan.borrowed, 1);
  assert.deepEqual(plan.borrowedIds, ['a-borrow']);
  assert.equal(plan.skippedByType.activity, 1, 'chỉ a-skip vào skipped');
  assert.equal(plan.skippedByType.phase, 1, 'p2 thiếu ngày vẫn skipped như cũ');
  assert.deepEqual(plan.items.filter((i) => i.type === 'activity').map((i) => i.id), ['a-own'], 'activity mượn ngày KHÔNG được ghi baseline');
  assert.match(baselineHelpers.baselineVersionStatsText({ counts: { campaign: 1, phase: 1, activity: 1, task: 0 }, skipped: 2, borrowed: 1, failed: 0 }), /1 activity mượn ngày phase/);
});

// ---------- SYN-24: chú thích heatmap ----------
test('SYN-24 [static]: ma trận Pillar × Kênh có chú thích 3 mẫu số (toàn kỳ / per-pillar / heatMax) + ghi chú khi tỷ trọng kênh < 100%', () => {
  const mix = section("if (UI.contentTab === 'mix')", "if (UI.contentTab === 'queue')");
  assert.match(mix, /Thang tô màu tính theo ô đậm nhất \(heatMax = '/);
  assert.match(mix, /Mẫu số của từng Pillar/);
  assert.match(mix, /Tổng tỷ trọng theo kênh nhỏ hơn 100%/);
  assert.match(mix, /kênh ĐẦU TIÊN của nó/);
  assert.match(mix, /channelTotal < mix\.denominator/);
});

// ---------- SYN-27: thuật ngữ ----------
test('SYN-27 [static]: Lưu post (không còn Lưu bài), cột Content ở Tiến độ sản xuất, header Trạng thái hoạt động ở bảng thành viên', () => {
  assert.ok(src.includes("'Lưu post'"));
  assert.ok(!src.includes("'Lưu bài'"), 'còn sót nút Lưu bài');
  const prod = section('Tiến độ sản xuất theo lịch đăng', "if (UI.contentTab === 'queue')");
  assert.match(prod, /<th>Content<\/th>/);
  const settings = section('Thành viên & vai trò', 'Ma trận quyền (4 vai)');
  assert.match(settings, /<th>Trạng thái hoạt động<\/th>/);
  assert.doesNotMatch(settings, /<th>Activity<\/th>/);
});

// ---------- CSS: SYN-11 / SYN-12 / SYN-29 / SYN-30 ----------
function luminance(hex) {
  const h = hex.replace('#', '');
  const f = (v) => { const c = parseInt(v, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(h.slice(0, 2)) + 0.7152 * f(h.slice(2, 4)) + 0.0722 * f(h.slice(4, 6));
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('SYN-11 [css]: a.btn hiển thị như nút thường (inline-flex) — min-height áp được, a.btn.small sàn 36px desktop / 38px mobile', () => {
  assert.match(css, /a\.btn\{display:inline-flex;align-items:center;justify-content:center/);
  assert.match(css, /a\.btn\.small\{min-height:36px\}/);
  const mediaAt = css.indexOf('@media(max-width:820px)');
  assert.ok(mediaAt !== -1 && css.indexOf('a.btn.small{min-height:38px}', mediaAt) !== -1, 'trong media mobile a.btn.small sàn 38px');
});

test('SYN-12 [css]: .g2-toggle có vùng bấm tối thiểu 28x28px', () => {
  assert.match(css, /\.g2-toggle\{[^}]*min-width:28px[^}]*min-height:28px/);
});

test('SYN-29 [css]: token chữ st-todo đạt AA >= 4.5:1 trên nền pill, nền hệ trạng thái giữ nguyên; st-pending không bị đẩy xuống dưới AA', () => {
  assert.match(css, /--st-todo-text:#626b77/);
  assert.match(css, /\.badge\.st-todo\{color:var\(--st-todo-text\)\}/);
  assert.ok(contrast('#626b77', '#eef0f3') >= 4.5, 'contrast st-todo-text = ' + contrast('#626b77', '#eef0f3').toFixed(2));
  assert.match(css, /--st-todo-bg:#eef0f3/, 'màu nền pill todo giữ nguyên');
  assert.match(css, /--st-pending:#b45309/, 'token st-pending giữ nguyên');
  assert.ok(contrast('#b45309', '#fef3c7') >= 4.5, 'st-pending vẫn đạt AA');
});

test('SYN-30 [css]: .inpage-nav a đạt sàn 40px; button.linklike trong agenda Content mobile đạt 36px', () => {
  assert.match(css, /\.inpage-nav a\{[^}]*min-height:40px/);
  assert.match(css, /\.cal-agenda button\.linklike\{min-height:36px/);
});
