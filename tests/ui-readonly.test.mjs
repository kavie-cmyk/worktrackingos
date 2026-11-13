// tests/ui-readonly.test.mjs
// Regression cho lỗi P2 vòng sửa R1 (QA độc lập): panel chi tiết công việc ở
// vai chỉ-xem vẫn cho chọn/sửa ô nhập, chỉ chặn lúc bấm Lưu.
// Tầng kiểm: [unit/static] — đọc source js/app.js và khẳng định hợp đồng
// render (app.js là IIFE trình duyệt, không có DOM trong node --test nên
// không render thật ở đây; kiểm render thật thuộc QA trình duyệt) KÈM
// [unit] kiểm matrix quyền thật ở store-core: CEO thiếu cả task.edit lẫn
// task.updateStatus (điều kiện kích hoạt chế độ chỉ-đọc của panel), còn
// owner/lead/member có đủ cả hai (hành vi không đổi với vai có quyền).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

test('P2 [unit]: matrix quyền — CEO không có task.edit/task.updateStatus, vai có quyền thì có đủ', () => {
  assert.equal(core.canRole('ceo', 'task.edit'), false);
  assert.equal(core.canRole('ceo', 'task.updateStatus'), false);
  assert.equal(core.canRole('ceo', 'campaign.edit'), false);
  for (const role of ['owner', 'lead', 'member']) {
    assert.equal(core.canRole(role, 'task.edit'), true, role);
    assert.equal(core.canRole(role, 'task.updateStatus'), true, role);
  }
  // campaign.edit tách riêng: owner/lead có, member KHÔNG (khớp
  // Store._actionFor campaigns → 'campaign.edit') — nên formShell khóa
  // form campaign với member là đúng hợp đồng, không phải hồi quy.
  assert.equal(core.canRole('owner', 'campaign.edit'), true);
  assert.equal(core.canRole('lead', 'campaign.edit'), true);
  assert.equal(core.canRole('member', 'campaign.edit'), false);
});

test('P2 [unit/static]: panel dùng đúng action task.edit/task.updateStatus qua Store.can và có ghi chú chỉ đọc', () => {
  assert.match(src, /function canEditTask\(\) \{ return can\('task\.edit'\); \}/);
  assert.match(src, /function canUpdateTaskStatus\(\) \{ return can\('task\.updateStatus'\); \}/);
  assert.match(src, /function taskPanelReadonly\(\) \{ return !canEditTask\(\) && !canUpdateTaskStatus\(\); \}/);
  assert.match(src, /Bạn đang xem ở chế độ chỉ đọc/);
  assert.match(src, /html \+= taskReadonlyNote\(\);/);
});

test('P2 [unit/static]: mọi ô nhập của form panel được truyền disabled theo quyền (F2/F2sel hỗ trợ disabled)', () => {
  // Field builder phải thực sự in thuộc tính disabled.
  assert.match(src, /function F2\(name, label, type, value, opts\)/);
  assert.match(src, /function F2sel\(name, label, value, pairs, emptyLabel, opts\)/);
  // Form panel: trường thường khóa theo !ed, riêng trạng thái khóa theo !statusEd.
  assert.match(src, /F2\('title'[^;]*disabled: !ed/);
  assert.match(src, /F2sel\('status'[^;]*disabled: !statusEd/);
  assert.match(src, /<textarea name="description" rows="3"' \+ dis\(!ed\)/);
  // Nút Lưu của panel chỉ disabled khi chỉ-đọc hoàn toàn (status-only vẫn lưu được trạng thái).
  assert.match(src, /id="task-panel-form"[\s\S]*?dis\(ro\)/);
});

test('P2 [unit/static]: form thêm checklist / thêm phụ thuộc / bình luận trong panel đều khóa cả ô nhập lẫn nút khi không có quyền', () => {
  assert.match(src, /id="checklist-add-form"[\s\S]*?name="text" required' \+ dis\(!ed\)/);
  assert.match(src, /id="dep-add-panel-form"[\s\S]*?<select name="predecessorId"' \+ dis\(!ed\)/);
  assert.match(src, /id="comment-add-form"[\s\S]*?dis\(!commentEd\)/);
});

test('P2 [unit/static]: handler submit/change có phòng thủ cùng cơ chế quyền (không chỉ dựa vào disabled)', () => {
  assert.match(src, /if \(taskPanelReadonly\(\)\) \{ toast\('Bạn đang xem ở chế độ chỉ đọc, không lưu được thay đổi\.'\); return; \}/);
  assert.match(src, /if \(!canEditTask\(\)\) \{ toast\('Bạn đang xem ở chế độ chỉ đọc, không thêm được mục checklist\.'\); return; \}/);
  assert.match(src, /if \(!canEditTask\(\)\) \{ toast\('Bạn đang xem ở chế độ chỉ đọc, không thêm được phụ thuộc\.'\); return; \}/);
  assert.match(src, /kind === 'checklist-toggle'[\s\S]*?if \(!canEditTask\(\)\)/);
});

test('P2 [unit/static]: formShell (điểm vào chung) áp chỉ-đọc cho campaign/task editor — khóa field + nút Lưu + ghi chú', () => {
  assert.match(src, /function editorReadonly\(kind\)/);
  assert.match(src, /if \(kind === 'campaign'\) return !can\('campaign\.edit'\);/);
  assert.match(src, /body\.replace\(\/<\(input\|select\|textarea\)/);
  assert.match(src, /ro \? readonlyFormNote\(kind\) : ''/);
});
