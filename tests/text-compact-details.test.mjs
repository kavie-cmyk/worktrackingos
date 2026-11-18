// Đợt "QA toàn bộ + tinh gọn chữ/UI" 18/11 (Giai đoạn B theo AUDIT.md):
// pattern "Chi tiết" chuẩn cho các đoạn mang định nghĩa nghiệp vụ —
// tóm tắt 1–2 dòng hiển thị mặc định, TOÀN VĂN định nghĩa gốc còn nguyên
// trong DOM qua thẻ <details> mở–đóng tại chỗ (noteDetailHtml /
// noteWithDetailHtml), không thêm data-action/handler mới.
// Các ca dưới đây khoá 3 việc: (1) helper render đúng cấu trúc details +
// summary "Chi tiết" + aria qua summary; (2) các định nghĩa cốt lõi
// (CAC từ Paid CHƯA làm tròn, CAC "Tất cả" không phải trung bình, Paid
// theo Objective không suy ngược, paid_to_b2b, chuỗi tồn A68) vẫn còn
// nguyên văn trong app.js sau khi rút; (3) 7 mục [XOÁ] của audit không
// còn xuất hiện; (4) CSS chú thích hợp nhất 1 hệ (.note/.sub max-width
// 72ch, .field-help 13px).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function extractFn(name) {
  const a = src.indexOf('function ' + name + '(');
  assert.notEqual(a, -1, 'không thấy hàm ' + name);
  const b = src.indexOf('\n  }', a);
  return src.slice(a, b + 4);
}

test('TCD [unit]: noteDetailHtml render details/summary Chi tiết + toàn văn trong DOM; noteWithDetailHtml có tóm tắt mặc định', () => {
  const factory = new Function(extractFn('noteDetailHtml') + '\n' + extractFn('noteWithDetailHtml') + '\nreturn { d: noteDetailHtml, w: noteWithDetailHtml };');
  const h = factory();
  const full = h.d('Định nghĩa đầy đủ XYZ');
  assert.match(full, /^<details class="note-details"><summary>Chi tiết<\/summary>/);
  assert.ok(full.includes('Định nghĩa đầy đủ XYZ'), 'toàn văn phải nằm trong DOM ngay cả khi details đang đóng');
  const w = h.w('Tóm tắt ngắn', 'Toàn văn dài', 'data-planning-detail-hint="1"');
  assert.match(w, /^<p class="sub note" data-planning-detail-hint="1">Tóm tắt ngắn<\/p><details/);
  assert.ok(w.includes('Toàn văn dài'));
  // Pattern không thêm handler: không data-action nào trong markup Chi tiết.
  assert.ok(!full.includes('data-action'), 'pattern Chi tiết không được thêm data-action');
  assert.ok(!w.includes('data-action='), 'pattern Chi tiết không được thêm data-action');
});

test('TCD [static]: định nghĩa cốt lõi còn nguyên văn trong Chi tiết sau khi rút hiển thị', () => {
  for (const phrase of [
    'CAC ở bảng dưới tính từ số Paid Users CHƯA làm tròn', // A65
    'KHÔNG phải trung bình các CAC tháng', // A66
    'KHÔNG suy ngược lên tầng trên', // A51 Paid Objective
    'cầu nối paid_to_b2b của Channel', // A52
    'dòng tồn (Paid EOM, Free EOM, Total users) lấy giá trị tháng cuối', // A68
    'account chuyển đổi KHÔNG bị trừ khỏi Paid EOM', // A68 B2B
    'hạn mức chỉ đổi khi đề xuất được Owner duyệt', // A21 (trong Chi tiết)
    'chỉ đổi khi Owner duyệt một đề xuất ngân sách', // A5
  ]) {
    assert.ok(src.includes(phrase), 'mất định nghĩa: ' + phrase);
  }
  // A68: phần "Thiếu đầu vào" luôn hiển thị riêng (ngoài details) — nằm ở noteTail, không nằm trong noteFull.
  const op = src.slice(src.indexOf('function planningOperatingTableHtml'), src.indexOf('// --- Audience trên dòng budget-driven'));
  assert.match(op, /var noteTail = /);
  assert.match(op, /noteDetailHtml\(noteFull\)/);
  assert.match(op, /<strong>Thiếu đầu vào:<\/strong>/);
});

test('TCD [static]: 7 mục [XOÁ] của audit không còn trong app.js', () => {
  for (const gone of [
    'Tình hình Marketing tại thời điểm hiện tại.', // A8
    'Quản lý content và duyệt content trong cùng một mục.', // A28
    'Bấm mũi tên hoặc tên Phase ở đầu mỗi khối để thu gọn / mở riêng Phase đó.', // A58
    'Một Timeline chung cho mọi campaign và task: xem theo cây campaign hoặc chỉ xem task, với một bộ lọc chung.', // A79
    'Trạng thái kết nối theo từng khả năng và thư viện Post.', // A90 phụ đề
    'Mỗi chấm kèm tên mục; rê chuột (hoặc xem dòng chữ phụ) để thấy nhãn đầy đủ của từng mức code và khả năng.', // A90 legend
    'Kết nối dữ liệu, thành viên & vai trò, BU/sản phẩm, năng lực làm việc và kết nối kênh.', // A100
  ]) {
    assert.ok(!src.includes(gone), 'mục [XOÁ] còn sót: ' + gone);
  }
  // A80: câu đếm task Timeline chỉ còn đúng 1 vị trí (chế độ cây).
  const count = (src.match(/task có đủ ngày để vẽ Timeline\./g) || []).length;
  assert.equal(count, 1, 'A80: câu đếm Timeline phải còn đúng 1 vị trí, đang có ' + count);
});

test('TCD [static]: CSS hợp nhất 1 hệ chú thích — .sub/.note 72ch, .field-help 13px, .note-details có style', () => {
  assert.match(css, /\.sub,\.note\{font-size:13px;line-height:1\.55;color:var\(--color-text-secondary,#475569\);max-width:72ch/);
  assert.match(css, /\.field-help\{font-size:var\(--t-13\);line-height:1\.55;color:var\(--color-text-secondary\)\}/);
  assert.match(css, /\.note-details>summary\{/);
  assert.ok(!css.includes('.viz-daybar-label{font-size:10px'), 'còn khai 10px bị ghi đè của .viz-daybar-label');
});
