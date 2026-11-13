// tests/timeline-merge.test.mjs
// Đợt GỘP HAI TIMELINE LÀM MỘT (view Timeline riêng, route 'timeline'):
// - [unit] D.buildCampaignTreeTimeline: (i) cây campaign có task độc lập
//   trong nhóm cuối "Không thuộc campaign"; (ii) CẮT TỈA nhánh rỗng theo
//   lọc người/trạng thái — fixture đếm tay từng hàng; ngoại lệ campaign
//   được chọn tường minh vẫn giữ hàng campaign.
// - [unit] (iii) D.timelineStateFromTaskFilter: nút "Mở Timeline" mang
//   đúng 3 lọc campaign/người phụ trách/trạng thái của màn Task sang view
//   Timeline ở chế độ "Chỉ task" (lọc phụ không đi theo).
// - [demo] fixture demo: chế độ cây không lọc = 34 hàng / 16 task có ngày /
//   1 chưa xếp lịch / 4 edges — khớp số của Gantt tổng thể cũ cộng nhóm độc
//   lập đổi tên.
// - [static] nav/route/VIEWS có Timeline; view có 2 chế độ + 1 bộ lọc
//   chung; trang Campaigns hết khối Gantt tổng thể; chi tiết campaign và
//   dải 7 ngày ở "Task của tôi" giữ nguyên.

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

// ---------- Fixture đếm tay cho chế độ cây ----------
// Cây đầy đủ (không lọc): 2 campaign + 3 phase + 3 activity + nhóm
// "Chưa gắn" của cA + nhóm "Không thuộc campaign" + 6 task có ngày = 16 hàng.
// tA5 (thiếu hạn) và tS2 (thiếu cả hai mốc) chỉ nằm ở Chưa xếp lịch.
const DATA = {
  campaigns: [
    { id: 'cA', name: 'Campaign A', status: 'active', startDate: '2026-11-02', endDate: '2026-11-30' },
    { id: 'cB', name: 'Campaign B', status: 'planning', startDate: '2026-11-16', endDate: '2026-12-11' }
  ],
  phases: [
    { id: 'pA1', campaignId: 'cA', name: 'Phase A1', startDate: '2026-11-02', endDate: '2026-11-13' },
    { id: 'pA2', campaignId: 'cA', name: 'Phase A2', startDate: '2026-11-14', endDate: '2026-11-27' },
    { id: 'pB1', campaignId: 'cB', name: 'Phase B1', startDate: '2026-11-16', endDate: '2026-11-27' }
  ],
  activities: [
    { id: 'aA1', campaignId: 'cA', phaseId: 'pA1', name: 'Activity A1' },
    { id: 'aA2', campaignId: 'cA', phaseId: 'pA2', name: 'Activity A2' },
    { id: 'aB1', campaignId: 'cB', phaseId: 'pB1', name: 'Activity B1' }
  ],
  tasks: [
    { id: 'tA1', campaignId: 'cA', phaseId: 'pA1', activityId: 'aA1', assigneeId: 'm1', title: 'Task A1', status: 'todo', startDate: '2026-11-02', dueDate: '2026-11-04', checklist: [{ text: 'x', done: true }] },
    { id: 'tA2', campaignId: 'cA', phaseId: 'pA1', activityId: 'aA1', assigneeId: 'm2', title: 'Task A2', status: 'completed', startDate: '2026-11-05', dueDate: '2026-11-06', baselineStartDate: '2026-11-05', baselineDueDate: '2026-11-07' },
    { id: 'tA3', campaignId: 'cA', phaseId: 'pA2', activityId: 'aA2', assigneeId: 'm1', title: 'Task A3', status: 'todo', startDate: '2026-11-15', dueDate: '2026-11-18' },
    { id: 'tA4', campaignId: 'cA', assigneeId: 'm2', title: 'Task A4 chưa gắn', status: 'todo', startDate: '2026-11-05', dueDate: '2026-11-07' },
    { id: 'tA5', campaignId: 'cA', phaseId: 'pA1', activityId: 'aA1', assigneeId: 'm1', title: 'Task A5 thiếu hạn', status: 'todo', startDate: '2026-11-09', dueDate: null },
    { id: 'tB1', campaignId: 'cB', phaseId: 'pB1', activityId: 'aB1', assigneeId: 'm2', title: 'Task B1', status: 'in_progress', startDate: '2026-11-17', dueDate: '2026-11-20' },
    { id: 'tS1', campaignId: null, assigneeId: 'm1', title: 'Task độc lập 1', status: 'todo', startDate: '2026-11-18', dueDate: '2026-11-21' },
    { id: 'tS2', campaignId: null, assigneeId: 'm2', title: 'Task độc lập 2', status: 'todo', startDate: null, dueDate: null }
  ],
  dependencies: [
    { id: 'e1', predecessorId: 'tA1', successorId: 'tA2' },
    { id: 'e2', predecessorId: 'tA2', successorId: 'tA5' },
    { id: 'e3', predecessorId: 'tS1', successorId: 'tB1' }
  ],
  blockers: [{ id: 'b1', taskId: 'tA1', status: 'open' }]
};
const OPTS = { today: '2026-11-13' };
const keys = (r) => r.rows.map((x) => x.key);

// ---------- (i) cây có task độc lập trong nhóm cuối ----------
test('TM [unit] (i): không lọc — cây đủ 16 hàng đếm tay, task độc lập ở nhóm cuối "Không thuộc campaign"', () => {
  const r = domain.buildCampaignTreeTimeline(DATA, OPTS);
  assert.equal(r.mode, 'tree');
  assert.equal(r.totalCount, 8);
  assert.equal(r.datedCount, 6);
  assert.equal(r.rows.length, 16, '2 campaign + 3 phase + 3 activity + 2 nhóm + 6 task');
  assert.deepEqual(keys(r), [
    'camp:cA', 'phase:pA1', 'act:aA1', 'phase:pA2', 'act:aA2', 'grp:cA',
    'task:tA1', 'task:tA2', 'task:tA3', 'task:tA4',
    'camp:cB', 'phase:pB1', 'act:aB1', 'task:tB1',
    'grp:no-campaign', 'task:tS1'
  ]);
  const grp = r.rows[r.rows.length - 2];
  assert.equal(grp.title, 'Không thuộc campaign');
  assert.equal(grp.kind, 'group');
  assert.equal(grp.depth, 0);
  const solo = r.rows.find((x) => x.id === 'tS1');
  assert.equal(solo.parentKey, 'grp:no-campaign');
  assert.equal(solo.depth, 1);
  // Thuộc tính engine cần trên hàng task: baseline + checklist + blocked.
  const tA2 = r.rows.find((x) => x.id === 'tA2');
  assert.equal(tA2.bStart, '2026-11-05');
  assert.equal(tA2.bEnd, '2026-11-07');
  assert.equal(tA2.completed, true);
  assert.deepEqual(r.rows.find((x) => x.id === 'tA1').checklist, DATA.tasks[0].checklist);
  assert.equal(r.rows.find((x) => x.id === 'tA1').blocked, true, 'blocker đang mở → bị chặn');
  // Chưa xếp lịch: đúng định nghĩa phẳng — thiếu một trong hai mốc, qua lọc.
  assert.deepEqual(r.unscheduled.map((t) => t.id), ['tA5', 'tS2']);
  // edges: e2 chạm task chưa xếp lịch nên bị loại.
  assert.deepEqual(r.edges.map((e) => e.id), ['e1', 'e3']);
});

// ---------- (ii) cắt tỉa theo lọc ----------
test('TM [unit] (ii): lọc người phụ trách m1 — cắt tỉa nhánh rỗng, đếm tay 9 hàng còn lại', () => {
  const r = domain.buildCampaignTreeTimeline(DATA, { ...OPTS, filter: { campaignId: 'all', ownerId: 'm1', status: 'all' } });
  // Task hiển thị: tA1 (aA1/pA1/cA), tA3 (aA2/pA2/cA), tS1 (nhóm độc lập).
  // cB mất hết (tB1 của m2) → cả campaign bị tỉa; grp:cA mất (tA4 của m2).
  // Thứ tự hàng như builder cây cũ: hàng cấu trúc của campaign trước,
  // hàng task sau (parentKey trỏ về đúng tổ tiên).
  assert.deepEqual(keys(r), [
    'camp:cA', 'phase:pA1', 'act:aA1', 'phase:pA2', 'act:aA2',
    'task:tA1', 'task:tA3',
    'grp:no-campaign', 'task:tS1'
  ]);
  assert.equal(r.datedCount, 3);
  assert.deepEqual(r.unscheduled.map((t) => t.id), ['tA5'], 'tA5 của m1, thiếu hạn → chưa xếp lịch');
  assert.deepEqual(r.edges.map((e) => e.id), [], 'không cạnh nào còn đủ hai đầu hiển thị');
});

test('TM [unit] (ii): lọc trạng thái completed — chỉ còn chuỗi tổ tiên của tA2 (4 hàng)', () => {
  const r = domain.buildCampaignTreeTimeline(DATA, { ...OPTS, filter: { campaignId: 'all', ownerId: 'all', status: 'completed' } });
  assert.deepEqual(keys(r), ['camp:cA', 'phase:pA1', 'act:aA1', 'task:tA2']);
  assert.equal(r.datedCount, 1);
  assert.equal(r.unscheduled.length, 0);
});

test('TM [unit] (ii): campaign được chọn tường minh thì giữ hàng campaign dù nhánh rỗng hết', () => {
  // Lọc campaign cB + người m1: không task nào của cB khớp m1.
  const r = domain.buildCampaignTreeTimeline(DATA, { ...OPTS, filter: { campaignId: 'cB', ownerId: 'm1', status: 'all' } });
  assert.deepEqual(keys(r), ['camp:cB'], 'phase/activity rỗng bị tỉa, campaign được chọn tường minh được giữ');
  assert.equal(r.rows[0].hasChildren, false);
  assert.equal(r.datedCount, 0);
  // Chỉ lọc campaign (không lọc task) → KHÔNG cắt tỉa: cây cB đủ 4 hàng.
  const r2 = domain.buildCampaignTreeTimeline(DATA, { ...OPTS, filter: { campaignId: 'cB', ownerId: 'all', status: 'all' } });
  assert.deepEqual(keys(r2), ['camp:cB', 'phase:pB1', 'act:aB1', 'task:tB1']);
});

test('TM [unit] (ii): lọc campaign "" — chỉ nhóm độc lập, đếm tay 2 hàng + 1 chưa xếp lịch', () => {
  const r = domain.buildCampaignTreeTimeline(DATA, { ...OPTS, filter: { campaignId: '', ownerId: 'all', status: 'all' } });
  assert.deepEqual(keys(r), ['grp:no-campaign', 'task:tS1']);
  assert.deepEqual(r.unscheduled.map((t) => t.id), ['tS2']);
  assert.equal(r.totalCount, 2);
});

// ---------- (iii) mang lọc từ màn Task ----------
test('TM [unit] (iii): timelineStateFromTaskFilter — chế độ Chỉ task + đúng 3 lọc, lọc phụ không đi theo', () => {
  const st = domain.timelineStateFromTaskFilter({ campaignId: 'cA', ownerId: 'm1', status: 'todo', priority: 'Cao', due: 'week', blocked: 'blocked', unassigned: true });
  assert.deepEqual(st, { mode: 'tasks', filter: { campaignId: 'cA', ownerId: 'm1', status: 'todo' } });
  assert.deepEqual(domain.timelineStateFromTaskFilter({}), { mode: 'tasks', filter: { campaignId: 'all', ownerId: 'all', status: 'all' } });
  assert.deepEqual(domain.timelineStateFromTaskFilter(null), { mode: 'tasks', filter: { campaignId: 'all', ownerId: 'all', status: 'all' } });
  // campaignId '' (task độc lập) là giá trị có nghĩa — phải giữ nguyên.
  assert.equal(domain.timelineStateFromTaskFilter({ campaignId: '', ownerId: 'all', status: 'all' }).filter.campaignId, '');
});

// ---------- [demo] ----------
test('TM [demo]: dữ liệu demo chế độ cây — 34 hàng / 16 task có ngày / 1 chưa xếp lịch / 4 edges', () => {
  const r = domain.buildCampaignTreeTimeline(
    { campaigns: demo.campaigns, phases: demo.phases, activities: demo.activities, tasks: demo.tasks, dependencies: demo.dependencies, blockers: demo.blockers },
    { today: '2026-11-13' }
  );
  assert.equal(r.rows.length, 34, '3 campaign + 5 phase + 8 activity + 1 nhóm chưa gắn + 16 task + 1 nhóm độc lập');
  assert.equal(r.datedCount, 16);
  assert.equal(r.totalCount, 17);
  assert.deepEqual(r.unscheduled.map((t) => t.id), ['task-f']);
  assert.equal(r.edges.length, 4);
  const grp = r.rows.find((x) => x.key === 'grp:no-campaign');
  assert.equal(grp.title, 'Không thuộc campaign');
  assert.equal(r.rows.find((x) => x.id === 'task-solo-1').parentKey, 'grp:no-campaign');
  // Nhóm độc lập đứng cuối cây.
  assert.equal(r.rows[r.rows.length - 2].key, 'grp:no-campaign');
  assert.equal(r.rows[r.rows.length - 1].key, 'task:task-solo-1');
});

test('TM [demo]: dữ liệu demo lọc theo người phụ trách — edges chỉ còn giữa các hàng đang hiển thị', () => {
  const r = domain.buildCampaignTreeTimeline(
    { campaigns: demo.campaigns, phases: demo.phases, activities: demo.activities, tasks: demo.tasks, dependencies: demo.dependencies, blockers: demo.blockers },
    { today: '2026-11-13', filter: { campaignId: 'all', ownerId: 'member-content', status: 'all' } }
  );
  const visibleTaskIds = new Set(r.rows.filter((x) => x.kind === 'task').map((x) => x.id));
  for (const e of r.edges) {
    assert.ok(visibleTaskIds.has(e.predecessorId) && visibleTaskIds.has(e.successorId), 'edge ' + e.id + ' phải nối hai hàng đang hiển thị');
  }
  assert.deepEqual(r.edges.map((e) => e.id), ['dep-4']);
});

// ---------- [static] bề mặt view Timeline ----------
test('TM [static]: nav + route + VIEWS có mục Timeline riêng trong nhóm Kế hoạch & content', () => {
  assert.match(src, /\['Kế hoạch & content', \[\['campaigns', 'IMC & Campaigns'\], \['timeline', 'Timeline'\]/);
  assert.match(src, /var ROUTES = \[[^\]]*'timeline'[^\]]*\];/);
  assert.match(src, /'timeline': viewTimeline,/);
  assert.match(src, /timelineMode: 'tree'/);
  assert.match(src, /timelineFilter: \{ campaignId: 'all', ownerId: 'all', status: 'all' \}/);
});

test('TM [static]: view Timeline có 2 chế độ + MỘT bộ lọc chung (form timeline-filter-form) cho cả hai', () => {
  const v = section('function viewTimeline()', '// ---------- Công việc ----------');
  assert.match(v, /data-action="timeline-mode" data-id="' \+ id/);
  assert.match(v, /modeBtn\('tree', 'Cây campaign'\)/);
  assert.match(v, /modeBtn\('tasks', 'Chỉ task'\)/);
  assert.match(v, /id="timeline-filter-form"/);
  // Chế độ cây: builder thuần + engine dùng chung + mục Chưa xếp lịch.
  assert.match(v, /D\.buildCampaignTreeTimeline\(/);
  assert.match(v, /ganttHtml\(tree\.rows, tree\.edges\)/);
  assert.match(v, /unscheduledHtml\(tree\.unscheduled\)/);
  // Chế độ Chỉ task: dùng lại taskTimelineHtml với ĐÚNG bộ lọc chung.
  assert.match(v, /taskTimelineHtml\(visibleList\('tasks'\), edges, blockers, tf\)/);
  assert.match(src, /if \(f\.id === 'timeline-filter-form'\) \{/);
  assert.match(src, /if \(action === 'timeline-mode'\) \{ UI\.timelineMode = \(id === 'tasks' \? 'tasks' : 'tree'\); render\(\); \}/);
});

test('TM [static]: nút Mở Timeline ở màn Task mang lọc qua handler dùng hàm thuần timelineStateFromTaskFilter', () => {
  assert.match(src, /if \(action === 'open-timeline'\) \{/);
  assert.match(src, /var tlState = D\.timelineStateFromTaskFilter\(UI\.taskFilter\);/);
  assert.match(src, /UI\.timelineMode = tlState\.mode;/);
  assert.match(src, /UI\.timelineFilter = tlState\.filter;/);
  assert.match(src, /window\.location\.hash = '#\/timeline'/);
});

test('TM [static]: bề mặt giữ nguyên — Timeline trong chi tiết campaign + dải 7 ngày ở Task của tôi', () => {
  assert.match(src, /<h3>Timeline của campaign<\/h3>' \+ ganttHtml\(ganttRowsCampaign\(c\), Store\.list\('dependencies'\)\)/);
  const mw = section('function viewMyWork()', '// ---------- Brand Hub ----------');
  assert.match(mw, /Timeline 7 ngày/);
  // Kéo–thả + baseline + badge checklist vẫn qua engine ganttHtml dùng chung.
  const g = section('function ganttHtml(rowsAll, edges)', '// R2-27: builder cây đệ quy');
  assert.match(g, /data-gantt-drag="1"/);
  assert.match(g, /g2-bar baseline/);
  assert.match(g, /g2-cl-badge/);
});
