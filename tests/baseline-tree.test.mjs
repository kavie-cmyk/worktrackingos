// tests/baseline-tree.test.mjs
// CHỐT BASELINE CẢ CÂY CAMPAIGN (13/11/2026): một lần bấm "Chốt baseline"
// ở chi tiết campaign chụp mốc cho campaign + phase + activity + task
// thuộc campaign; mục thiếu ngày bị bỏ qua và đếm; entry baselineVersions
// mang thống kê phạm vi thật; Member bị chặn.
// Tầng kiểm: [unit] trích helper thuần của app.js (baselineTreePlan /
// baselineVersionStatsText / canSetBaseline) chạy thật với stub +
// [integration] chạy đúng vòng ghi của handler trên Store demo
// (plan → update từng mục → update campaign kèm versions) +
// [store] payload/read của cột baseline jsonb mới cho phases/activities
// (0015) + [static] khóa cấu trúc handler và 2 chỗ hiển thị.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const core = require('../js/store-core.js');
const Store = require('../js/store.js');
const demo = require('../js/demo-data.js');

function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ---------- Trích helper của app.js (cfVal → trước NAV_GROUPS) ----------
let stubRole = 'owner';
const stubStore = { currentRole: () => stubRole, currentUserId: 'u-1' };
const stubCan = (perm) => core.canRole(stubRole, perm);
const helpersSrc = section('function cfVal', 'var NAV_GROUPS');
const H = new Function('Store', 'can',
  helpersSrc + '\nreturn { baselineVersionsOf: baselineVersionsOf, canSetBaseline: canSetBaseline, baselineTreePlan: baselineTreePlan, baselineVersionStatsText: baselineVersionStatsText };'
)(stubStore, stubCan);

// ---------- 1. baselineTreePlan: đủ ngày → patch đúng trường theo loại ----------
test('BASELINE-TREE [unit]: cả cây đủ ngày → campaignItem + items với patch đúng trường (task dùng baselineDueDate)', () => {
  const plan = H.baselineTreePlan(
    { id: 'c1', startDate: '2026-11-02', endDate: '2026-11-30' },
    [{ id: 'p1', startDate: '2026-11-02', endDate: '2026-11-13' }],
    [{ id: 'a1', startDate: '2026-11-03', endDate: '2026-11-10' }],
    [{ id: 't1', startDate: '2026-11-03', dueDate: '2026-11-05' }]
  );
  assert.deepEqual(plan.campaignItem, { type: 'campaign', coll: 'campaigns', id: 'c1', patch: { baselineStartDate: '2026-11-02', baselineEndDate: '2026-11-30' } });
  assert.equal(plan.items.length, 3);
  const byType = Object.fromEntries(plan.items.map((i) => [i.type, i]));
  assert.deepEqual(byType.phase.patch, { baselineStartDate: '2026-11-02', baselineEndDate: '2026-11-13' });
  assert.deepEqual(byType.activity.patch, { baselineStartDate: '2026-11-03', baselineEndDate: '2026-11-10' });
  assert.deepEqual(byType.task.patch, { baselineStartDate: '2026-11-03', baselineDueDate: '2026-11-05' });
  assert.ok(!('baselineEndDate' in byType.task.patch), 'task không được ghi baselineEndDate');
  assert.equal(plan.skipped, 0);
});

// ---------- 2. baselineTreePlan: thiếu ngày → bỏ qua + đếm đúng theo loại ----------
test('BASELINE-TREE [unit]: mục thiếu start hoặc end/due bị bỏ qua, không có patch rỗng, đếm đúng theo loại', () => {
  const plan = H.baselineTreePlan(
    { id: 'c1', startDate: '2026-11-02', endDate: '2026-11-30' },
    [
      { id: 'p1', startDate: '2026-11-02', endDate: '2026-11-13' },
      { id: 'p2', startDate: '2026-11-14', endDate: null },
    ],
    [
      { id: 'a1', startDate: null, endDate: null },
      { id: 'a2', startDate: '2026-11-03', endDate: '2026-11-10' },
    ],
    [
      { id: 't1', startDate: '2026-11-03', dueDate: '2026-11-05' },
      { id: 't2', startDate: '2026-11-03', dueDate: null },
      { id: 't3', startDate: null, dueDate: '2026-11-05' },
    ]
  );
  assert.deepEqual(plan.items.map((i) => i.id), ['p1', 'a2', 't1']);
  assert.equal(plan.skipped, 4);
  assert.deepEqual(plan.skippedByType, { campaign: 0, phase: 1, activity: 1, task: 2 });
  for (const it of plan.items) {
    assert.ok(it.patch.baselineStartDate, 'patch không được rỗng mốc bắt đầu');
    assert.ok(it.patch.baselineEndDate || it.patch.baselineDueDate, 'patch không được rỗng mốc kết thúc');
  }
});

// ---------- 3. Fixture demo camp-1: số thật của cây demo ----------
test('BASELINE-TREE [unit]: fixture demo camp-1 → 2 phase + 12 task được chốt, 3 activity chưa có lịch bị bỏ qua; task-b ghi đè baseline cũ bằng lịch hiện tại', () => {
  const d = demo.buildDemoData ? demo.buildDemoData() : demo;
  const state = d.state || d;
  const camp = state.campaigns.find((c) => c.id === 'camp-1');
  const phases = state.phases.filter((x) => x.campaignId === 'camp-1');
  const acts = state.activities.filter((x) => x.campaignId === 'camp-1');
  const tasks = state.tasks.filter((x) => x.campaignId === 'camp-1');
  const plan = H.baselineTreePlan(camp, phases, acts, tasks);
  assert.equal(plan.items.filter((i) => i.type === 'phase').length, 2);
  assert.equal(plan.items.filter((i) => i.type === 'activity').length, 0);
  assert.equal(plan.items.filter((i) => i.type === 'task').length, 12);
  assert.equal(plan.skipped, 3);
  assert.equal(plan.skippedByType.activity, 3);
  const tb = plan.items.find((i) => i.id === 'task-b');
  assert.deepEqual(tb.patch, { baselineStartDate: '2026-11-11', baselineDueDate: '2026-11-16' },
    'baseline mới = lịch HIỆN TẠI của task (11→16/11), không phải baseline cũ (10→14/11)');
});

// ---------- 4. Thống kê trong entry version + tương thích entry cũ ----------
test('BASELINE-TREE [unit]: baselineVersionStatsText có counts → câu tóm tắt; entry cũ không counts → rỗng', () => {
  assert.equal(
    H.baselineVersionStatsText({ version: 2, counts: { campaign: 1, phase: 3, activity: 8, task: 12 }, skipped: 3, failed: 0 }),
    'đã chốt 24 mục · bỏ qua 3 mục chưa có lịch'
  );
  assert.equal(
    H.baselineVersionStatsText({ version: 3, counts: { campaign: 1, phase: 0, activity: 0, task: 0 }, skipped: 0, failed: 2 }),
    'đã chốt 1 mục · lỗi 2 mục'
  );
  assert.equal(H.baselineVersionStatsText({ version: 1, startDate: '2026-11-02', endDate: '2026-11-27' }), '');
  assert.equal(H.baselineVersionStatsText(null), '');
});

// ---------- 5. Quyền: Member bị chặn ở helper của app ----------
test('BASELINE-TREE [unit]: canSetBaseline — owner/lead được, member bị chặn', () => {
  stubRole = 'owner'; assert.equal(H.canSetBaseline(), true);
  stubRole = 'lead'; assert.equal(H.canSetBaseline(), true);
  stubRole = 'member'; assert.equal(H.canSetBaseline(), false);
  stubRole = 'owner';
});

// ---------- 6. Store: cột baseline của phases/activities (0015) ----------
test('BASELINE-TREE [store]: TABLE_COLUMNS phases/activities có cột baseline; _toPayload/_rowToItem round-trip như campaigns', () => {
  assert.ok(core.TABLE_COLUMNS.phases.includes('baseline'));
  assert.ok(core.TABLE_COLUMNS.activities.includes('baseline'));
  for (const coll of ['phases', 'activities']) {
    const payload = Store._toPayload(coll, { name: 'X', baselineStartDate: '2026-11-02', baselineEndDate: '2026-11-13' }, {});
    assert.deepEqual(payload.baseline, { start_date: '2026-11-02', end_date: '2026-11-13' }, coll);
    const noBase = Store._toPayload(coll, { name: 'X' }, {});
    assert.ok(!('baseline' in noBase), coll + ': patch không đụng baseline thì không gửi baseline');
    const item = Store._rowToItem(coll, { id: 'x1', name: 'X', baseline: { start_date: '2026-11-02', end_date: '2026-11-13' } });
    assert.equal(item.baselineStartDate, '2026-11-02', coll);
    assert.equal(item.baselineEndDate, '2026-11-13', coll);
    const legacy = Store._rowToItem(coll, { id: 'x2', name: 'Y' });
    assert.equal(legacy.baselineStartDate, null, coll + ': hàng chưa có baseline → null, không bịa');
  }
  // Task: baseline đi qua custom_fields như cũ (không cần cột mới).
  const tp = core.toDbPayload('tasks', { title: 'T', baselineStartDate: '2026-11-03', baselineDueDate: '2026-11-05' });
  assert.equal(tp.custom_fields.baseline_start_date, '2026-11-03');
  assert.equal(tp.custom_fields.baseline_due_date, '2026-11-05');
});

// ---------- 7. Integration trên Store demo: chạy đúng vòng ghi của handler ----------
function resetBaselineDemo(role) {
  Store.mode = 'demo';
  Store.workspaceId = 'ws-1';
  const uid = role === 'member' ? 'u-member' : 'u-owner';
  Store.currentUserId = uid;
  Store._membership = null;
  Store.state = {
    members: [{ id: uid, name: role === 'member' ? 'Member' : 'Owner', role }],
    campaigns: [{ id: 'c1', name: 'Camp', status: 'active', startDate: '2026-11-02', endDate: '2026-11-30', baselineStartDate: '2026-11-01', baselineEndDate: '2026-11-29', customFields: { baselineVersions: [{ version: 1, startDate: '2026-11-01', endDate: '2026-11-29', setBy: uid, setAt: '2026-11-01T00:00:00.000Z' }] } }],
    phases: [
      { id: 'p1', campaignId: 'c1', name: 'P1', startDate: '2026-11-02', endDate: '2026-11-13' },
      { id: 'p2', campaignId: 'c1', name: 'P2', startDate: '2026-11-14', endDate: null },
    ],
    activities: [
      { id: 'a1', campaignId: 'c1', phaseId: 'p1', name: 'A1', startDate: '2026-11-03', endDate: '2026-11-10' },
      { id: 'a2', campaignId: 'c1', phaseId: 'p1', name: 'A2' },
    ],
    tasks: [
      { id: 't1', campaignId: 'c1', activityId: 'a1', title: 'T1', status: 'todo', startDate: '2026-11-03', dueDate: '2026-11-05', baselineStartDate: '2026-11-01', baselineDueDate: '2026-11-02' },
      { id: 't2', campaignId: 'c1', title: 'T2', status: 'todo', startDate: '2026-11-06', dueDate: null },
      { id: 't3', campaignId: 'other', title: 'T3 ngoài cây', status: 'todo', startDate: '2026-11-06', dueDate: '2026-11-07' },
    ],
  };
  Store.loadState = {};
  return Store;
}

// Mô phỏng trung thực vòng ghi của handler campaign-baseline: plan →
// update từng mục con (đếm ok/fail) → update campaign kèm entry version.
function runBaselineFlow() {
  const bc = Store.get('campaigns', 'c1');
  const phases = Store.list('phases').filter((x) => x.campaignId === 'c1');
  const phaseIds = {}; phases.forEach((p) => { phaseIds[p.id] = true; });
  const acts = Store.list('activities').filter((x) => x.campaignId === 'c1' || (!x.campaignId && x.phaseId && phaseIds[x.phaseId]));
  const actIds = {}; acts.forEach((a) => { actIds[a.id] = true; });
  const tasks = Store.list('tasks').filter((t) => {
    if (t.campaignId === 'c1') return true;
    if (t.campaignId) return false;
    return !!((t.activityId && actIds[t.activityId]) || (t.phaseId && phaseIds[t.phaseId]));
  });
  const plan = H.baselineTreePlan(bc, phases, acts, tasks);
  const done = { phase: 0, activity: 0, task: 0 };
  let failed = 0;
  for (const it of plan.items) {
    const r = Store.update(it.coll, it.id, it.patch);
    if (r && r.ok) done[it.type] += 1; else failed += 1;
  }
  const versions = H.baselineVersionsOf(bc).slice();
  const nv = {
    version: versions.length + 1, startDate: bc.startDate, endDate: bc.endDate,
    setBy: Store.currentUserId, setAt: new Date().toISOString(),
    counts: { campaign: 1, phase: done.phase, activity: done.activity, task: done.task },
    skipped: plan.skipped, skippedByType: plan.skippedByType, failed,
  };
  versions.push(nv);
  const rc = Store.update('campaigns', 'c1', { baselineStartDate: nv.startDate, baselineEndDate: nv.endDate, baselineVersions: versions });
  return { plan, done, failed, nv, rc };
}

test('BASELINE-TREE [integration/demo]: chốt cả cây ghi baseline đúng từng mục, bỏ qua mục thiếu ngày, version tăng + entry có thống kê', () => {
  resetBaselineDemo('owner');
  const { nv, rc } = runBaselineFlow();
  assert.equal(rc.ok, true);
  assert.equal(Store.get('phases', 'p1').baselineStartDate, '2026-11-02');
  assert.equal(Store.get('phases', 'p1').baselineEndDate, '2026-11-13');
  assert.equal(Store.get('phases', 'p2').baselineStartDate, undefined, 'phase thiếu endDate không được ghi baseline');
  assert.equal(Store.get('activities', 'a1').baselineEndDate, '2026-11-10');
  assert.equal(Store.get('activities', 'a2').baselineStartDate, undefined, 'activity chưa có lịch không được ghi baseline');
  assert.equal(Store.get('tasks', 't1').baselineStartDate, '2026-11-03', 'task ghi đè baseline cũ bằng lịch hiện tại');
  assert.equal(Store.get('tasks', 't1').baselineDueDate, '2026-11-05');
  assert.equal(Store.get('tasks', 't2').baselineStartDate, undefined, 'task thiếu dueDate bị bỏ qua');
  assert.equal(Store.get('tasks', 't3').baselineStartDate, undefined, 'task ngoài cây không bị đụng');
  const camp = Store.get('campaigns', 'c1');
  assert.equal(camp.baselineStartDate, '2026-11-02');
  assert.equal(camp.baselineEndDate, '2026-11-30');
  const versions = H.baselineVersionsOf(camp);
  assert.equal(versions.length, 2, 'version tăng 1 → 2, giữ entry cũ');
  assert.equal(versions[0].counts, undefined, 'entry v1 cũ giữ nguyên, không bịa thống kê');
  assert.equal(nv.version, 2);
  assert.deepEqual(nv.counts, { campaign: 1, phase: 1, activity: 1, task: 1 });
  assert.equal(nv.skipped, 3);
  assert.deepEqual(nv.skippedByType, { campaign: 0, phase: 1, activity: 1, task: 1 });
  assert.equal(nv.failed, 0);
  // Chốt lại lần nữa → v3, số vẫn đúng (idempotent theo lịch hiện tại).
  const again = runBaselineFlow();
  assert.equal(again.nv.version, 3);
  assert.equal(H.baselineVersionsOf(Store.get('campaigns', 'c1')).length, 3);
});

test('BASELINE-TREE [integration/demo]: Member bị chặn ghi campaign/phase/activity ở tầng Store (campaign.edit); cổng chặn chốt-baseline cho Member là canSetBaseline ở handler (test 5)', () => {
  resetBaselineDemo('member');
  for (const [coll, id] of [['phases', 'p1'], ['activities', 'a1'], ['campaigns', 'c1']]) {
    const r = Store.update(coll, id, { baselineStartDate: '2026-11-02' });
    assert.equal(r.ok, false, coll + ': member phải bị chặn');
  }
  assert.equal(Store.get('phases', 'p1').baselineStartDate, undefined);
  // Lưu ý đúng kiến trúc hiện có: Store cho member sửa task nói chung
  // (task.edit) — member không chốt được baseline vì handler campaign-
  // baseline dừng ngay ở canSetBaseline() trước mọi lệnh ghi.
  resetBaselineDemo('owner');
});

// ---------- 8. Static: handler + 2 chỗ hiển thị ----------
test('BASELINE-TREE [static]: handler chốt cả cây — thu thập theo quan hệ store, ghi qua sUpdate từng mục, campaign ghi cuối kèm counts/skipped/failed, toast đủ số thật', () => {
  const handler = section("if (action === 'campaign-baseline')", "if (action === 'request-accept')");
  assert.match(handler, /canSetBaseline\(\)/);
  assert.match(handler, /Store\.list\('phases'\)\.filter\(function \(x\) \{ return x\.campaignId === id; \}\)/);
  assert.match(handler, /Store\.list\('activities'\)/);
  assert.match(handler, /Store\.list\('tasks'\)/);
  assert.match(handler, /baselineTreePlan\(bc, bPhases, bActs, bTasks\)/);
  assert.match(handler, /sUpdate\(bit\.coll, bit\.id, bit\.patch\)/);
  assert.match(handler, /counts: \{ campaign: 1, phase: bDone\.phase, activity: bDone\.activity, task: bDone\.task \}/);
  assert.match(handler, /skipped: bPlan\.skipped, skippedByType: bPlan\.skippedByType, failed: bFailed/);
  assert.match(handler, /'Đã chốt baseline v' \+ nv\.version \+ ': 1 campaign, ' \+ bDone\.phase \+ ' phase, ' \+ bDone\.activity \+ ' activity, ' \+ bDone\.task \+ ' task'/);
  assert.match(handler, /bỏ qua ' \+ bPlan\.skipped \+ ' mục chưa có lịch/);
  // Kiểm chứng sau ghi (chống thành công giả khi tầng dữ liệu bỏ trường).
  assert.match(handler, /Store\.get\(bit\.coll, bit\.id\)/);
  assert.match(handler, /cfVal\(cur, k\)/);
});

test('BASELINE-TREE [static]: hiển thị — đầu chi tiết campaign có tóm tắt lần chốt gần nhất; form sửa liệt kê thống kê từng version; Gantt phase/activity mang bStart/bEnd', () => {
  const detail = section('function campaignDetailHtml(id)', "if (tab === 'overview')");
  assert.match(detail, /baselineVersionStatsText\(campVersions\[campVersions\.length - 1\]\)/);
  assert.match(detail, /data-action="campaign-baseline"/);
  const form = section('Kế hoạch đã duyệt (baseline) — chỉ xem', "F('why',");
  assert.match(form, /baselineVersionStatsText\(bv\)/);
  const ganttRows = section('function appendPhaseActivityRows', 'function ganttRowsCampaign');
  assert.match(ganttRows, /bStart: p\.baselineStartDate, bEnd: p\.baselineEndDate/);
  assert.match(ganttRows, /bStart: a\.baselineStartDate, bEnd: a\.baselineEndDate/);
});
