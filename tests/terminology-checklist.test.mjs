// THUẬT NGỮ — vòng đổi thuật ngữ Marketing sang tiếng Anh (Zac chốt
// 13/11/2026): "Thuật ngữ MKT để tiếng Anh, câu chữ còn lại tiếng Việt."
// - Task/Content/Overview/Post/Publication/Activity là tên hiển thị của các
//   thực thể task/content/overview/post/publication/activity ở MỌI bề mặt
//   chính (nav, tiêu đề màn, tab, form, nút, toast, văn xuôi giữa câu viết
//   thường: task/content/activity/publication/post).
// - [guard] KHÔNG còn chuỗi "Danh sách kiểm tra" / "Mục kiểm tra" chỉ tính
//   năng checklist (vòng Checklist trước giữ nguyên).
// - [guard] KHÔNG còn "Còn có thể dùng" (thống nhất "Còn dùng được") và
//   không còn "Phiên bản nội dung" (thống nhất "Phiên bản content").
// - Giữ nguyên tiếng Anh sẵn có: Checklist, Campaign, KPI, Gantt,
//   Action Plan, Content Plan, Content mix, Pillar, Brand Hub, milestone.
// - Giữ nguyên TIẾNG VIỆT có chủ đích: Duyệt, Ngân sách, Cam kết, Phân bổ,
//   "Còn dùng được", Thu–Chi, "Người phụ trách", "Kênh" (chưa có chỉ đạo
//   đổi Channel), "Phiên bản theo kênh".
// Lưu ý phạm vi guard: chỉ khóa các mẫu NHÃN hiển thị cụ thể — comment mã
// nguồn (vd tiêu đề section "// ---------- Kênh & Bài đã đăng ----------"
// mà các test khác dùng làm mốc cắt section) không phải chuỗi hiển thị.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('TERM [guard]: không còn chuỗi tên cũ của tính năng checklist trong UI', () => {
  for (const banned of ['Danh sách kiểm tra', 'Mục kiểm tra', 'mục kiểm tra', 'danh sách kiểm tra']) {
    assert.ok(!src.includes(banned), 'còn chuỗi cũ chỉ tính năng checklist: ' + banned);
  }
});

test('TERM [static]: panel chi tiết task dùng tên Checklist', () => {
  assert.match(src, /'<h3>Checklist \(' \+ panelChecklistProgress\.done/);
  assert.match(src, /Chưa có mục checklist nào\./);
  assert.match(src, /<label>Mục checklist mới<input/);
  assert.match(src, /không sửa được checklist\./);
  assert.match(src, /không thêm được mục checklist\./);
  assert.match(src, /mục checklist và quan hệ phụ thuộc đã bị khóa/);
});

test('TERM [static]: khái niệm task thống nhất tên "Task" ở các bề mặt chính', () => {
  assert.match(src, /\['tasks', 'Task'\], \['approvals', 'Duyệt content'\]/);
  assert.match(src, /pageHead\('Task', 'Một danh sách task dùng chung/);
  assert.match(src, /\['tasks', 'Task'\], \['content', 'Content'\], \['kpi', 'KPI & Ngân sách'\]/);
  assert.match(src, /<strong>Task của campaign \(' \+ ctasks\.length/);
  assert.match(src, /formShell\('task', e\.id \? 'Sửa task' : 'Tạo task'/);
  assert.match(src, /e\.id \? 'Lưu task' : 'Tạo task'/);
  assert.match(src, /Task liên quan \(tùy chọn — không bắt buộc, không phải quan hệ cha\)/);
  assert.match(src, /pageHead\('Task của tôi', 'Task của '/);
  assert.ok(!src.includes("['tasks', 'Việc']"), 'nav còn nhãn Việc cho task');
  assert.ok(!src.includes("pageHead('Việc'"), 'còn tiêu đề màn Việc');
  assert.ok(!src.includes('Công việc chung'), 'nhóm nav còn tên cũ Công việc chung');
});

test('TERM [static]: nav dùng Overview / Content / Post + nhóm "Chung"; màn Overview + tab Overview', () => {
  assert.match(src, /\['Chung', \[\['overview', 'Overview'\], \['my-work', 'Task của tôi'\]\]\]/);
  assert.match(src, /\['content', 'Content'\]/);
  assert.match(src, /\['channels', 'Kênh & Post'\]/);
  assert.match(src, /pageHead\('Overview',/);
  // Tab trong drawer activity + tab campaign đều là Overview / Task.
  assert.match(src, /\['overview', 'Overview'\], \['tasks', 'Task'\], \['kpi', 'KPI'\], \['budget', 'Ngân sách'\], \['docs', 'Tài liệu'\]/);
  assert.ok(!src.includes("['overview', 'Tổng quan']"), 'còn tab Tổng quan');
  assert.ok(!src.includes("pageHead('Tổng quan'"), 'còn tiêu đề màn Tổng quan');
  assert.ok(!src.includes("['channels', 'Kênh & Bài đã đăng']"), 'nav còn nhãn Bài đã đăng');
});

test('TERM [static]: form dùng Task/Content/Activity theo bảng thuật ngữ (scope + liên quan)', () => {
  assert.match(src, /\['task', 'Task'\], \['content', 'Content'\], \['pillar', 'Pillar'\], \['bu_product', 'Brand \/ Sản phẩm'\]/);
  assert.match(src, /\['activity', 'Activity'\]/);
  assert.match(src, /Task của activity \(' \+ tasks\.length/);
  assert.match(src, />Tạo task<\/button>/);
  assert.match(src, />Tạo task sản xuất<\/button>/);
  assert.match(src, /<th>Content liên quan<\/th>/);
  assert.match(src, /F\('taskId', 'Task liên quan', 'select'/);
  assert.match(src, /F\('activityId', 'Activity liên quan \(Action Plan\)', 'select'/);
  assert.match(src, /— Không gắn task —/);
  assert.match(src, /— Không gắn content —/);
  assert.ok(!src.includes("F('taskId', 'Việc'"), 'form còn nhãn Việc cho task');
  assert.ok(!src.includes("F('contentItemId', 'Nội dung'"), 'form còn nhãn Nội dung cho content');
});

test('TERM [static]: Post + Publication là hai khái niệm riêng, thống nhất ở thư viện + KPI tự động + content mix', () => {
  assert.match(src, /<th>Post<\/th><th>Nền tảng<\/th>/);
  assert.match(src, /chưa có dữ liệu post/);
  assert.match(src, /Tự động từ post/);
  assert.match(src, /<h2>Thư viện Post \(' \+ filtered\.length/);
  assert.match(src, /<h2>Thư viện Post \(' \+ posted\.length \+ ' publication\)<\/h2>/);
  assert.match(src, /data-id="publication">Publication<\/button>/);
  assert.match(src, /<h3>Publication thuộc campaign \(' \+ pubsForCamp\.length/);
  assert.ok(!src.includes("pageHead('Kênh & Bài đã đăng'"), 'tiêu đề màn Kênh còn Bài đã đăng');
});

test('TERM [guard]: "Còn dùng được" thống nhất — không còn "Còn có thể dùng"; "Phiên bản content" — không còn "Phiên bản nội dung"', () => {
  assert.ok(src.includes('Còn dùng được'), 'thiếu nhãn Còn dùng được');
  assert.ok(!src.includes('Còn có thể dùng'), 'còn nhãn cũ Còn có thể dùng');
  assert.match(src, /Còn dùng được: <strong>/);
  assert.ok(src.includes('Phiên bản content'), 'thiếu nhãn Phiên bản content');
  assert.ok(!src.includes('Phiên bản nội dung'), 'còn nhãn cũ Phiên bản nội dung');
});

test('TERM [static]: thuật ngữ giữ tiếng Việt có chủ đích vẫn còn nguyên (Duyệt / Ngân sách / Người phụ trách / Kênh)', () => {
  assert.match(src, /\['approvals', 'Duyệt content'\]/);
  assert.match(src, /'KPI & Ngân sách'/);
  assert.match(src, /F\('ownerId', 'Người phụ trách', 'select'/);
  assert.match(src, /F\('platform', 'Kênh', 'select'/);
  assert.match(src, /Sửa phiên bản theo kênh/);
  assert.match(src, /Giao dịch Thu–Chi/);
});

test('TERM [static]: ô tìm kiếm toàn cục ở index.html dùng task/content', () => {
  assert.ok(indexHtml.includes('Tìm campaign, task, content, tài nguyên'), 'placeholder tìm kiếm chưa đổi thuật ngữ');
  assert.ok(!indexHtml.includes('Tìm campaign, việc, nội dung'), 'placeholder tìm kiếm còn thuật ngữ cũ');
});
