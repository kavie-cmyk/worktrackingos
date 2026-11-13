// tests/terminology-checklist.test.mjs
// GIAI ĐOẠN 2 — đổi thuật ngữ "kiểm tra" → "Checklist" cho tính năng
// checklist + rà soát nhất quán thuật ngữ toàn app:
// - [guard] KHÔNG còn chuỗi "Danh sách kiểm tra" / "Mục kiểm tra" /
//   "mục kiểm tra" / "danh sách kiểm tra" chỉ tính năng checklist trong
//   js/app.js (các dùng từ "kiểm tra" dạng động từ ở ngữ cảnh khác —
//   kiểm tra kết nối, kiểm tra lại — KHÔNG thuộc guard này).
// - [static] Panel chi tiết việc dùng đúng tên mới: "Checklist (x/y)",
//   "Mục checklist mới", "Chưa có mục checklist nào".
// - [static] Một khái niệm một tên: "Việc" (không còn nhãn hiển thị
//   "Công việc" cho khái niệm task ở các bề mặt chính; không còn nhãn
//   'Task'/'Content' tiếng Anh lạc lõng trong form KPI/nội dung;
//   tab drawer hoạt động là 'Tổng quan'/'Việc'; "Bài đã đăng" thống nhất
//   ở drill-down KPI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

test('TERM [guard]: không còn chuỗi tên cũ của tính năng checklist trong UI', () => {
  for (const banned of ['Danh sách kiểm tra', 'Mục kiểm tra', 'mục kiểm tra', 'danh sách kiểm tra']) {
    assert.ok(!src.includes(banned), 'còn chuỗi cũ chỉ tính năng checklist: ' + banned);
  }
});

test('TERM [static]: panel chi tiết việc dùng tên Checklist mới', () => {
  assert.match(src, /'<h3>Checklist \(' \+ panelChecklistProgress\.done/);
  assert.match(src, /Chưa có mục checklist nào\./);
  assert.match(src, /<label>Mục checklist mới<input/);
  assert.match(src, /không sửa được checklist\./);
  assert.match(src, /không thêm được mục checklist\./);
  assert.match(src, /mục checklist và quan hệ phụ thuộc đã bị khóa/);
});

test('TERM [static]: khái niệm task thống nhất tên "Việc" ở các bề mặt chính', () => {
  assert.match(src, /\['tasks', 'Việc'\], \['approvals', 'Duyệt nội dung'\]/);
  assert.match(src, /pageHead\('Việc', 'Một danh sách việc dùng chung/);
  assert.match(src, /\['tasks', 'Việc'\], \['content', 'Nội dung'\], \['kpi', 'KPI & Ngân sách'\]/);
  assert.match(src, /<strong>Việc của campaign \(' \+ ctasks\.length/);
  assert.match(src, /formShell\('task', e\.id \? 'Sửa việc' : 'Tạo việc'/);
  assert.match(src, /Việc liên quan \(tùy chọn — không bắt buộc, không phải quan hệ cha\)/);
});

test('TERM [static]: hết nhãn Task/Content tiếng Anh lạc lõng trong form + drawer hoạt động tiếng Việt', () => {
  assert.ok(!src.includes("F('taskId', 'Task'"), 'còn nhãn Task trong form KPI');
  assert.ok(!src.includes("F('taskId', 'Task liên quan'"), 'còn nhãn Task liên quan trong form nội dung');
  assert.ok(!src.includes("F('taskId', 'Task (thuộc campaign)'"), 'còn nhãn Task (thuộc campaign) trong form dòng ngân sách');
  assert.ok(!src.includes("F('contentItemId', 'Content'"), 'còn nhãn Content trong form KPI');
  assert.match(src, /\['task', 'Việc'\], \['content', 'Nội dung'\], \['pillar', 'Pillar'\], \['bu_product', 'Brand \/ Sản phẩm'\]/);
  assert.match(src, /\['overview', 'Tổng quan'\], \['tasks', 'Việc'\], \['kpi', 'KPI'\], \['budget', 'Ngân sách'\], \['docs', 'Tài liệu'\]/);
  assert.match(src, /Việc của hoạt động \(' \+ tasks\.length/);
  assert.match(src, />Tạo việc<\/button>/);
  assert.match(src, />Tạo việc sản xuất<\/button>/);
  assert.match(src, /<th>Nội dung liên quan<\/th>/);
});

test('TERM [static]: drill-down KPI thống nhất "Bài đã đăng"', () => {
  assert.match(src, /<th>Bài đã đăng<\/th><th>Nền tảng<\/th>/);
  assert.match(src, /chưa có dữ liệu bài đã đăng/);
});
