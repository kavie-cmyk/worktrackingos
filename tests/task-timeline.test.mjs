// tests/task-timeline.test.mjs
// Builder Timeline "Chỉ task" (trước là tab Timeline của màn Task, nay là
// chế độ 'tasks' của view Timeline hợp nhất — xem timeline-merge.test.mjs):
// - [unit] D.buildTaskTimeline là hàm THUẦN dựng hàng/lọc/nhóm: tập hàng
//   đúng theo dữ kiện, 3 chế độ nhóm (campaign / người phụ trách / không
//   nhóm), lọc co hàng + edges phụ thuộc, đếm "Chưa xếp lịch".
// - [demo] fixture demo: mọi task có đủ ngày đều có hàng, đúng 1 task
//   chưa xếp lịch (task-f thiếu cả hai mốc).
// - [static] chế độ Chỉ task của view Timeline gọi ganttHtml với hàng/edges
//   của builder + bộ lọc chung UI.timelineFilter, mục Chưa xếp lịch (N) bấm
//   mở được chi tiết; màn Task không còn tab — có nút "Mở Timeline".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ---------- Fixture thuần ----------
const CAMPAIGNS = [{ id: 'c1', name: 'Campaign Một' }, { id: 'c2', name: 'Campaign Hai' }];
const MEMBERS = [{ id: 'm1', name: 'An' }, { id: 'm2', name: 'Bình' }];
const TASKS = [
  { id: 't1', campaignId: 'c1', assigneeId: 'm1', title: 'Việc 1', status: 'completed', startDate: '2026-11-02', dueDate: '2026-11-04', baselineStartDate: '2026-11-01', baselineDueDate: '2026-11-03', checklist: [{ text: 'a', done: true }, { text: 'b', done: false }] },
  { id: 't2', campaignId: 'c1', assigneeId: 'm2', title: 'Việc 2', status: 'in_progress', startDate: '2026-11-05', dueDate: '2026-11-20' },
  { id: 't2a', campaignId: 'c1', assigneeId: 'm2', parentId: 't2', title: 'Việc 2 con', status: 'todo', startDate: '2026-11-06', dueDate: '2026-11-08' },
  { id: 't3', campaignId: 'c2', assigneeId: 'm1', title: 'Việc 3 mốc', status: 'todo', startDate: '2026-11-10', dueDate: '2026-11-10', isMilestone: true },
  { id: 't4', campaignId: null, assigneeId: null, title: 'Việc độc lập chưa gán', status: 'todo', startDate: '2026-11-01', dueDate: '2026-11-03' },
  { id: 't5', campaignId: 'c2', assigneeId: 'm2', title: 'Việc thiếu hạn', status: 'todo', startDate: '2026-11-09', dueDate: null },
  { id: 't6', campaignId: 'c1', assigneeId: 'm1', title: 'Việc chưa có ngày', status: 'todo', startDate: null, dueDate: null },
  { id: 't7', campaignId: 'c1', assigneeId: 'm1', title: 'Việc đã lưu trữ', status: 'archived', startDate: '2026-11-02', dueDate: '2026-11-03' }
];
const EDGES = [
  { id: 'e1', predecessorId: 't1', successorId: 't2' },
  { id: 'e2', predecessorId: 't2', successorId: 't5' },
  { id: 'e3', predecessorId: 't3', successorId: 't4' }
];
const BLOCKERS = [{ id: 'b1', taskId: 't2', status: 'open' }, { id: 'b2', taskId: 't1', status: 'resolved' }];
const OPTS = { campaigns: CAMPAIGNS, members: MEMBERS, blockers: BLOCKERS, dependencies: EDGES, today: '2026-11-13' };

function taskRows(r) { return r.rows.filter((x) => x.kind === 'task'); }
function groupRows(r) { return r.rows.filter((x) => x.kind === 'group'); }

// ---------- [unit] tập hàng đúng theo dữ kiện ----------
test('TL [unit]: tập hàng — chỉ task đủ 2 mốc thành hàng task, mang đủ thuộc tính engine cần', () => {
  const r = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'campaign' });
  assert.equal(r.totalCount, 7, 'task đã lưu trữ bị loại khỏi tổng');
  assert.equal(r.datedCount, 5);
  assert.deepEqual(taskRows(r).map((x) => x.id).sort(), ['t1', 't2', 't2a', 't3', 't4']);
  const t1 = r.rows.find((x) => x.id === 't1');
  assert.equal(t1.key, 'task:t1');
  assert.equal(t1.coll, 'tasks');
  assert.equal(t1.ganttId, 't1');
  assert.equal(t1.kind, 'task');
  assert.equal(t1.start, '2026-11-02');
  assert.equal(t1.end, '2026-11-04');
  assert.equal(t1.bStart, '2026-11-01', 'baseline start phải đi theo hàng');
  assert.equal(t1.bEnd, '2026-11-03', 'baseline due phải đi theo hàng');
  assert.equal(t1.completed, true);
  assert.deepEqual(t1.checklist, TASKS[0].checklist, 'checklist phải đi theo hàng để engine vẽ badge ☑');
  const t3 = r.rows.find((x) => x.id === 't3');
  assert.equal(t3.milestone, true);
  const t2 = r.rows.find((x) => x.id === 't2');
  assert.equal(t2.blocked, true, 'blocker đang mở → hàng bị chặn');
  assert.equal(t1.blocked, false, 'blocker đã gỡ → không bị chặn');
  assert.equal(t2.overdue, false);
  const t4 = r.rows.find((x) => x.id === 't4');
  assert.equal(t4.overdue, true, 'quá hạn 2026-11-03 so với today 2026-11-13 và chưa xong → overdue');
  assert.equal(t1.overdue, false, 'đã hoàn thành thì không tính quá hạn');
});

test('TL [unit]: task con lồng dưới cha trong cùng nhóm (parentKey/depth/hasChildren), cha ở nhóm khác thì làm gốc nhóm mình', () => {
  const r = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'campaign' });
  const t2 = r.rows.find((x) => x.id === 't2');
  const t2a = r.rows.find((x) => x.id === 't2a');
  assert.equal(t2.hasChildren, true);
  assert.equal(t2.parentKey, 'tgrp:camp:c1');
  assert.equal(t2.depth, 1);
  assert.equal(t2a.parentKey, 'task:t2');
  assert.equal(t2a.depth, 2);
  // Nhóm theo người phụ trách: t2a cùng người với t2 nên vẫn lồng; đổi
  // người của t2a sang m1 → t2a thành gốc của nhóm m1, không biến mất.
  const tasks2 = TASKS.map((t) => (t.id === 't2a' ? { ...t, assigneeId: 'm1' } : t));
  const r2 = domain.buildTaskTimeline(tasks2, { ...OPTS, groupBy: 'assignee' });
  const t2a2 = r2.rows.find((x) => x.id === 't2a');
  assert.equal(t2a2.parentKey, 'tgrp:assignee:m1');
  assert.equal(t2a2.depth, 1);
  assert.equal(r2.rows.find((x) => x.id === 't2').hasChildren, false);
});

// ---------- [unit] 3 chế độ nhóm ----------
test('TL [unit]: nhóm theo campaign (mặc định) — hàng nhóm là campaign, độc lập vào "Không thuộc campaign", nhóm cuối', () => {
  const r = domain.buildTaskTimeline(TASKS, { ...OPTS });
  assert.equal(r.groupBy, 'campaign');
  assert.deepEqual(groupRows(r).map((x) => x.title), ['Campaign Một', 'Campaign Hai', 'Không thuộc campaign']);
  assert.deepEqual(groupRows(r).map((x) => x.key), ['tgrp:camp:c1', 'tgrp:camp:c2', 'tgrp:camp:none']);
  for (const g of groupRows(r)) {
    assert.equal(g.coll, '');
    assert.equal(g.ganttId, '');
    assert.equal(g.depth, 0);
    assert.equal(g.hasChildren, true);
  }
  // Thứ tự hàng: mọi task của nhóm đứng sau hàng nhóm của mình.
  const idx = Object.fromEntries(r.rows.map((x, i) => [x.key, i]));
  assert.ok(idx['tgrp:camp:c1'] < idx['task:t1'] && idx['task:t1'] < idx['tgrp:camp:c2']);
  assert.ok(idx['tgrp:camp:none'] < idx['task:t4']);
});

test('TL [unit]: nhóm theo người phụ trách — theo assignee, chưa gán vào "Chưa phân công" ở cuối', () => {
  const r = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'assignee' });
  assert.deepEqual(groupRows(r).map((x) => x.title), ['An', 'Bình', 'Chưa phân công']);
  assert.deepEqual(groupRows(r).map((x) => x.key), ['tgrp:assignee:m1', 'tgrp:assignee:m2', 'tgrp:assignee:none']);
  assert.equal(r.rows.find((x) => x.id === 't4').parentKey, 'tgrp:assignee:none');
  assert.equal(r.rows.find((x) => x.id === 't1').parentKey, 'tgrp:assignee:m1');
});

test('TL [unit]: không nhóm — phẳng, không hàng nhóm, sắp theo ngày bắt đầu tăng dần', () => {
  const r = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'none' });
  assert.equal(groupRows(r).length, 0);
  assert.deepEqual(taskRows(r).map((x) => x.id), ['t4', 't1', 't2', 't2a', 't3']);
  for (const row of taskRows(r)) {
    assert.equal(row.depth, 0);
    assert.equal(row.parentKey, undefined);
    assert.equal(row.hasChildren, false);
  }
  // groupBy lạ → rơi về mặc định campaign.
  assert.equal(domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'lạ' }).groupBy, 'campaign');
});

// ---------- [unit] lọc co hàng + edges, đếm chưa xếp lịch ----------
test('TL [unit]: lọc campaign/người phụ trách/trạng thái co cả hàng lẫn edges phụ thuộc', () => {
  const byCamp = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'none', filter: { campaignId: 'c1', ownerId: 'all', status: 'all' } });
  assert.deepEqual(taskRows(byCamp).map((x) => x.id).sort(), ['t1', 't2', 't2a']);
  assert.deepEqual(byCamp.edges.map((e) => e.id), ['e1'], 'edges chỉ còn cạnh giữa các task đang hiển thị');
  const byOwner = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'none', filter: { campaignId: 'all', ownerId: 'm1', status: 'all' } });
  assert.deepEqual(taskRows(byOwner).map((x) => x.id).sort(), ['t1', 't3']);
  assert.equal(byOwner.edges.length, 0, 'không cạnh nào còn đủ hai đầu hiển thị');
  const byStatus = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'none', filter: { campaignId: 'all', ownerId: 'all', status: 'completed' } });
  assert.deepEqual(taskRows(byStatus).map((x) => x.id), ['t1']);
  const independent = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'none', filter: { campaignId: '', ownerId: 'all', status: 'all' } });
  assert.deepEqual(taskRows(independent).map((x) => x.id), ['t4'], "campaignId '' = chỉ task độc lập (khớp UI.taskFilter)");
  // Không truyền filter → edges vẫn loại cạnh chạm task chưa xếp lịch.
  const all = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'none' });
  assert.deepEqual(all.edges.map((e) => e.id), ['e1', 'e3'], 'e2 chạm t5 chưa xếp lịch nên bị loại');
});

test('TL [unit]: đếm Chưa xếp lịch — task thiếu một trong hai mốc, đã qua lọc', () => {
  const r = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'campaign' });
  assert.equal(r.unscheduled.length, 2);
  assert.deepEqual(r.unscheduled.map((t) => t.id).sort(), ['t5', 't6']);
  const filtered = domain.buildTaskTimeline(TASKS, { ...OPTS, groupBy: 'campaign', filter: { campaignId: 'c2', ownerId: 'all', status: 'all' } });
  assert.deepEqual(filtered.unscheduled.map((t) => t.id), ['t5'], 'lọc campaign c2 → chỉ còn t5 chưa xếp lịch');
  assert.equal(filtered.datedCount, 1);
});

// ---------- [demo] fixture thật của repo ----------
test('TL [demo]: dữ liệu demo — 16/17 task có hàng Timeline, đúng 1 chưa xếp lịch, 4 edges vẽ được', () => {
  const r = domain.buildTaskTimeline(demo.tasks, {
    campaigns: demo.campaigns, members: demo.members, blockers: demo.blockers,
    dependencies: demo.dependencies, groupBy: 'campaign', today: '2026-11-13'
  });
  assert.equal(r.totalCount, demo.tasks.length);
  assert.equal(r.datedCount, 16);
  assert.equal(taskRows(r).length, 16);
  assert.deepEqual(r.unscheduled.map((t) => t.id), ['task-f']);
  assert.equal(r.edges.length, demo.dependencies.length);
  assert.ok(groupRows(r).some((g) => g.title === 'Không thuộc campaign'), 'task độc lập phải có nhóm riêng');
  const byAssignee = domain.buildTaskTimeline(demo.tasks, {
    campaigns: demo.campaigns, members: demo.members, blockers: demo.blockers,
    dependencies: demo.dependencies, groupBy: 'assignee', today: '2026-11-13'
  });
  assert.equal(taskRows(byAssignee).length, 16, 'đổi chế độ nhóm không được làm mất/thừa task nào');
});

// ---------- [static] bề mặt màn Task ----------
test('TL [static]: màn Task không còn thanh tab — một danh sách duy nhất + nút Mở Timeline ở đầu màn', () => {
  assert.doesNotMatch(src, /taskTab: 'list'/);
  assert.doesNotMatch(src, /data-action="task-tab"|action === 'task-tab'/);
  assert.match(src, /taskTimelineGroupBy: 'campaign'/);
  const vt = section('function viewTasks()', '// ---------- Duyệt nội dung ----------');
  assert.doesNotMatch(vt, /tabsHtml\(\[\['list', 'Danh sách Task'\], \['timeline', 'Timeline'\]\]/);
  assert.match(vt, /data-action="open-timeline">Mở Timeline<\/button>/);
  // Nội dung danh sách cũ còn nguyên: bảng task + trở ngại + yêu cầu.
  assert.match(vt, /'tasks-main'/);
  assert.match(vt, /'tasks-blockers'/);
  assert.match(vt, /'tasks-requests'/);
});

test('TL [static]: chế độ Chỉ task dùng lại ganttHtml + builder thuần + bộ lọc chung UI.timelineFilter, không engine mới', () => {
  const tl = section('function taskTimelineHtml(tasks, edges, blockers, filter)', 'function viewTimeline()');
  assert.match(tl, /var tf = filter \|\| UI\.timelineFilter;/);
  assert.match(tl, /D\.buildTaskTimeline\(tasks, \{/);
  assert.match(tl, /filter: \{ campaignId: tf\.campaignId, ownerId: tf\.ownerId, status: tf\.status \}/);
  assert.match(tl, /ganttHtml\(tl\.rows, tl\.edges\)/);
  assert.match(tl, /data-action="task-timeline-group" data-id="' \+ id/);
  assert.match(src, /if \(action === 'task-timeline-group'\) \{ UI\.taskTimelineGroupBy = id; render\(\); \}/);
  // 3 nhãn chế độ nhóm.
  assert.match(tl, /'Theo campaign'/);
  assert.match(tl, /'Theo người phụ trách'/);
  assert.match(tl, /'Không nhóm'/);
});

test('TL [static]: mục Chưa xếp lịch (N) ở cuối Timeline, bấm vào mở chi tiết task', () => {
  const tl = section('function taskTimelineHtml(tasks, edges, blockers, filter)', 'function viewTimeline()');
  assert.ok(tl.indexOf('ganttHtml(tl.rows, tl.edges)') < tl.indexOf('unscheduledHtml(tl.unscheduled)'), 'mục chưa xếp lịch phải nằm sau biểu đồ');
  const un = section('function unscheduledHtml(list)', 'function taskTimelineHtml(');
  assert.match(un, /'<h3>Chưa xếp lịch \(' \+ list\.length \+ '\)<\/h3>'/);
  assert.match(un, /data-action="open-task" data-id="' \+ esc\(t\.id\)/);
});

test('TL [static]: Gantt chi tiết campaign giữ nguyên lời gọi; trang Campaigns không còn Gantt tổng thể', () => {
  assert.match(src, /ganttHtml\(ganttRowsCampaign\(c\), Store\.list\('dependencies'\)\)/);
  const vc = section('function viewCampaigns()', '// ---------- R3.1-VIZ:');
  assert.doesNotMatch(vc, /Biểu đồ kế hoạch tổng thể/);
  assert.doesNotMatch(vc, /ganttRowsPortfolio\(\)/);
  // Builder cây cũ vẫn còn trong app cho Gantt chi tiết/đối chiếu; view
  // Timeline chế độ cây dùng builder thuần mới D.buildCampaignTreeTimeline.
  assert.match(src, /function ganttRowsPortfolio\(\)/);
});
