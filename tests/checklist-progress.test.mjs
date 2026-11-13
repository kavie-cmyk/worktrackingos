// tests/checklist-progress.test.mjs
// Tiến độ checklist trên thẻ/hàng việc + Gantt:
// - [unit] Domain.checklistProgress là nguồn đếm duy nhất (done/total/%),
//   khớp cách panel chi tiết đếm (mục done truthy).
// - [static] Mọi bề mặt liếc nhanh (Việc của tôi / màn Việc / Công việc của
//   campaign / Tasks trong drawer hoạt động / Gantt) gọi đúng helper UI
//   checklistBadgeHtml — helper này gọi Domain.checklistProgress và trả ''
//   khi total = 0. Gantt: badge cột tên + lớp g2-cl-fill + tooltip.
// - [demo] fixture checklist mẫu cho 2 việc campaign Livestream (3/5, 0/4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ---------- [unit] Domain.checklistProgress ----------

test('CL [unit]: checklistProgress — việc không có checklist → total 0', () => {
  assert.deepEqual(domain.checklistProgress(null), { done: 0, total: 0, progress: 0, percentage: 0 });
  assert.deepEqual(domain.checklistProgress({}), { done: 0, total: 0, progress: 0, percentage: 0 });
  assert.deepEqual(domain.checklistProgress({ checklist: [] }), { done: 0, total: 0, progress: 0, percentage: 0 });
  assert.deepEqual(domain.checklistProgress({ checklist: 'không-phải-mảng' }), { done: 0, total: 0, progress: 0, percentage: 0 });
});

test('CL [unit]: checklistProgress — đếm done/total/% khớp panel chi tiết', () => {
  const t = { checklist: [{ text: 'a', done: true }, { text: 'b', done: true }, { text: 'c', done: true }, { text: 'd', done: false }, { text: 'e', done: false }] };
  assert.deepEqual(domain.checklistProgress(t), { done: 3, total: 5, progress: 0.6, percentage: 60 });
  assert.deepEqual(domain.checklistProgress({ checklist: [{ done: true }, { done: true }] }), { done: 2, total: 2, progress: 1, percentage: 100 });
  assert.deepEqual(domain.checklistProgress({ checklist: [{ done: false }, { done: false }, { done: false }, { done: false }] }), { done: 0, total: 4, progress: 0, percentage: 0 });
  // Làm tròn % như campaignProgress (Math.round): 1/3 → 33.
  assert.equal(domain.checklistProgress({ checklist: [{ done: true }, { done: false }, { done: false }] }).percentage, 33);
  // Mục lỗi (null) không tính là done nhưng vẫn tính vào total — khớp filter của panel.
  assert.deepEqual(domain.checklistProgress({ checklist: [null, { done: true }] }), { done: 1, total: 2, progress: 0.5, percentage: 50 });
});

// ---------- [static] helper UI + các bề mặt ----------

test('CL [static]: checklistBadgeHtml gọi Domain.checklistProgress, total = 0 → rỗng, có badge + thanh mini', () => {
  const h = section('function checklistBadgeHtml(task)', 'function vizStackedBarHtml(opts)');
  assert.match(h, /D\.checklistProgress\(task\)/);
  assert.match(h, /if \(!cp\.total\) return '';/);
  assert.match(h, /data-viz="task-checklist"/);
  assert.match(h, /☑ ' \+ cp\.done \+ '\/' \+ cp\.total/);
  assert.match(h, /viz-fill st-fill-' \+ tone/);
  assert.match(h, /cp\.percentage >= 100 \? 'done' : 'running'/);
});

test('CL [static]: panel chi tiết việc đếm bằng Domain.checklistProgress (cùng nguồn với thẻ việc)', () => {
  assert.match(src, /var panelChecklistProgress = D\.checklistProgress\(t\);/);
  assert.match(src, /panelChecklistProgress\.done \+ '\/' \+ panelChecklistProgress\.total/);
});

test('CL [static]: Việc của tôi + màn Việc + Công việc của campaign + Tasks drawer hoạt động đều gắn checklistBadgeHtml', () => {
  const mw = section('function viewMyWork()', '// ---------- Brand Hub ----------');
  assert.match(mw, /checklistBadgeHtml\(t\)/);
  const vt = section('function viewTasks()', '// ---------- Duyệt nội dung ----------');
  assert.match(vt, /checklistBadgeHtml\(t\)/);
  const cd = section('function campaignDetailHtml(id)', 'function viewContent()');
  assert.match(cd, /checklistBadgeHtml\(t\)/);
  const ad = section('function activityDrawerHtml()', 'function campaignDetailHtml(id)');
  assert.match(ad, /checklistBadgeHtml\(t\)/);
});

test('CL [static]: Gantt — hàng việc mang checklist, badge cột tên, lớp nền trong thanh, tooltip Checklist', () => {
  assert.match(src, /checklist: t\.checklist/);
  const g = section('function ganttHtml(rowsAll, edges)', '// R2-27: builder cây đệ quy');
  assert.match(g, /var clp = D\.checklistProgress\(r\);/);
  assert.match(g, /class="g2-cl-badge"/);
  assert.match(g, /class="g2-cl-fill" style="width:' \+ clp\.percentage \+ '%"/);
  assert.match(g, /'Checklist: ' \+ clp\.done \+ '\/' \+ clp\.total \+ ' \(' \+ clp\.percentage \+ '%\)'/);
  // Màu trạng thái của thanh KHÔNG bị helper checklist đụng tới.
  assert.match(g, /g2-bar kind-' \+ esc\(r\.kind\)/);
});

test('CL [static]: CSS chỉ dấu dùng biến màu trạng thái hiện hành, lớp nền Gantt là trắng bán trong suốt', () => {
  assert.match(css, /\.task-checklist\{/);
  assert.match(css, /\.task-checklist-track\{/);
  assert.match(css, /\.g2-cl-badge\{[^}]*var\(--st-neutral\)/);
  assert.match(css, /\.g2-cl-fill\{[^}]*rgba\(255,255,255,\.55\)/);
});

// ---------- [demo] fixture ----------

test('CL [demo]: 2 việc Livestream có checklist mẫu 3/5 và 0/4, đếm qua domain khớp', () => {
  const video = demo.tasks.find((t) => t.id === 'task-live-video');
  const seeding = demo.tasks.find((t) => t.id === 'task-live-seeding');
  assert.ok(video && Array.isArray(video.checklist), 'task-live-video phải có checklist');
  assert.ok(seeding && Array.isArray(seeding.checklist), 'task-live-seeding phải có checklist');
  assert.deepEqual(domain.checklistProgress(video), { done: 3, total: 5, progress: 0.6, percentage: 60 });
  assert.deepEqual(domain.checklistProgress(seeding), { done: 0, total: 4, progress: 0, percentage: 0 });
});
