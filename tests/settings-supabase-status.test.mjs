// tests/settings-supabase-status.test.mjs
// VÁ NHÃN TRẠNG THÁI KẾT NỐI SUPABASE — panel "Trạng thái kết nối Supabase"
// trong viewSettings (js/app.js) phải phân biệt đúng 4 trạng thái:
//   - mode 'demo': badge "Supabase đã cấu hình" + giải thích đang xem dữ
//     liệu demo nên chưa dùng dữ liệu thật + hướng dẫn tắt demo ở panel
//     "Chế độ demo" bên dưới rồi đăng nhập; TUYỆT ĐỐI không có chuỗi
//     "Chờ kết nối Supabase" và không có 3 bước tự cài đặt.
//   - mode 'supabase' + chưa đăng nhập: giữ nguyên badge "Đã cấu hình"
//     + form đăng nhập email/mật khẩu.
//   - mode 'supabase' + đã đăng nhập: giữ nguyên badge "Đã đăng nhập"
//     + tên/email/vai trò + nút Đăng xuất.
//   - mode 'setup': giữ nguyên badge warn "Chờ kết nối Supabase"
//     + hướng dẫn 3 bước.
// Tầng kiểm: [unit] trích xuất helper thuần supabaseConnectionHtml và chạy
// thật với stub esc/labelStatus + [static] đọc source js/app.js / js/store.js
// theo đúng pattern các test UI hiện có trong repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const storeSrc = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');

function section(startMarker, endMarker, source) {
  const s = source || src;
  const a = s.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = s.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return s.slice(a, b);
}

function escStub(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function labelStatusStub(s) { if (s === null || s === undefined || s === '') return '—'; return ({ owner: 'Owner', lead: 'Lead', member: 'Member', ceo: 'CEO (chỉ xem)' })[String(s).toLowerCase()] || String(s); }

const helperSrc = section('function supabaseConnectionHtml', 'function viewSettings()');
const supabaseConnectionHtml = new Function('esc', 'labelStatus',
  helperSrc + '\nreturn supabaseConnectionHtml;'
)(escStub, labelStatusStub);

const ME = { name: 'Zac Owner', email: 'owner@example.com', role: 'owner', roleLabel: 'Owner' };

// ---------- 1. Mode demo ----------
test('SETTINGS-SUPABASE [unit]: mode demo — badge "Supabase đã cấu hình", giải thích dữ liệu demo + hướng dẫn tắt demo rồi đăng nhập, KHÔNG "Chờ kết nối" / KHÔNG 3 bước', () => {
  const html = supabaseConnectionHtml('demo', ME, false);
  assert.match(html, /<span class="badge ok">Supabase đã cấu hình<\/span>/);
  // Câu giải thích rõ: đang xem dữ liệu demo nên app chưa dùng dữ liệu thật.
  assert.match(html, /Bạn đang xem dữ liệu demo nên app chưa dùng dữ liệu thật/);
  assert.match(html, /Supabase đã được cấu hình sẵn/);
  // Hướng dẫn: tắt chế độ demo ở panel "Chế độ demo" bên dưới rồi đăng nhập để vào workspace thật.
  assert.match(html, /tắt chế độ demo ở panel "Chế độ demo" bên dưới rồi đăng nhập/);
  assert.match(html, /vào workspace thật/);
  // Tuyệt đối không đánh đồng demo với chưa cấu hình.
  assert.ok(!html.includes('Chờ kết nối Supabase'), 'mode demo vẫn còn chuỗi "Chờ kết nối Supabase"');
  assert.ok(!html.includes('Hướng dẫn 3 bước'), 'mode demo vẫn còn hướng dẫn 3 bước');
  assert.ok(!html.includes('Tạo một Supabase project'), 'mode demo vẫn còn bước tự tạo project');
  assert.ok(!html.includes('config.js'), 'mode demo vẫn còn bước tự điền config.js');
  assert.ok(!html.includes('badge warn'), 'mode demo không được dùng badge warn của trạng thái setup');
  assert.ok(!html.includes('id="signin-form"'), 'mode demo không hiện form đăng nhập (phải tắt demo trước)');
});

// ---------- 2. Mode supabase, chưa đăng nhập ----------
test('SETTINGS-SUPABASE [unit]: mode supabase + chưa đăng nhập — giữ nguyên badge "Đã cấu hình" + form đăng nhập email/mật khẩu', () => {
  for (const html of [supabaseConnectionHtml('supabase', null, false), supabaseConnectionHtml('supabase', ME, false)]) {
    assert.match(html, /<span class="badge ok">Đã cấu hình<\/span>/);
    assert.match(html, /App đã có thông tin kết nối\. Đăng nhập bằng email\/mật khẩu để vào workspace\./);
    assert.match(html, /<form class="inline" id="signin-form">/);
    assert.match(html, /<input type="email" name="email" required>/);
    assert.match(html, /<input type="password" name="password" required>/);
    assert.match(html, /<button class="btn" type="submit">Đăng nhập<\/button>/);
    assert.ok(!html.includes('Chờ kết nối Supabase'));
    assert.ok(!html.includes('Hướng dẫn 3 bước'));
  }
});

// ---------- 3. Mode supabase, đã đăng nhập ----------
test('SETTINGS-SUPABASE [unit]: mode supabase + đã đăng nhập — giữ nguyên badge "Đã đăng nhập" + tên/email/vai trò + nút Đăng xuất', () => {
  const html = supabaseConnectionHtml('supabase', ME, true);
  assert.match(html, /<span class="badge ok">Đã đăng nhập<\/span>/);
  assert.match(html, /Zac Owner/);
  assert.match(html, /owner@example\.com/);
  assert.match(html, /vai trò: Owner\./);
  assert.match(html, /data-action="sign-out">Đăng xuất<\/button>/);
  assert.ok(!html.includes('id="signin-form"'), 'đã đăng nhập thì không hiện lại form đăng nhập');
  assert.ok(!html.includes('Chờ kết nối Supabase'));
  assert.ok(!html.includes('Hướng dẫn 3 bước'));
});

// ---------- 4. Mode setup ----------
test('SETTINGS-SUPABASE [unit]: mode setup — giữ nguyên badge warn "Chờ kết nối Supabase" + đủ 3 bước hướng dẫn', () => {
  const html = supabaseConnectionHtml('setup', null, false);
  assert.match(html, /<span class="badge warn">Chờ kết nối Supabase<\/span>/);
  assert.match(html, /Hướng dẫn 3 bước:/);
  assert.match(html, /<li>Tạo một Supabase project riêng cho Marketing Workspace\.<\/li>/);
  assert.match(html, /Chạy các migration trong thư mục <code>supabase\/<\/code>/);
  assert.match(html, /Điền thông tin kết nối công khai vào file <code>config\.js<\/code>/);
  assert.match(html, /config\.example\.js/);
  assert.ok(!html.includes('Supabase đã cấu hình'));
  assert.ok(!html.includes('id="signin-form"'));
});

// ---------- 5. Nối vào viewSettings + các điểm rà soát liên quan ----------
test('SETTINGS-SUPABASE [static]: viewSettings render panel qua helper với đúng mode / người dùng / phiên Supabase hiện tại', () => {
  const v = section('function viewSettings()', '// ---------- Đăng nhập');
  assert.match(v, /<h2>Trạng thái kết nối Supabase<\/h2><div class="panel">/);
  assert.match(v, /supabaseConnectionHtml\(Store\.mode, Store\.currentUser\(\), !!Store\.supabaseUser\)/);
  // Panel "Chế độ demo" vẫn nằm ngay bên dưới để câu hướng dẫn ở trạng thái demo trỏ đúng chỗ.
  assert.match(v, /<h2>Chế độ demo<\/h2>/);
  assert.ok(v.indexOf('Trạng thái kết nối Supabase') < v.indexOf('Chế độ demo'), 'panel Chế độ demo phải nằm sau panel trạng thái kết nối');
});

test('SETTINGS-SUPABASE [static]: helper rẽ nhánh theo mode — supabase trước, demo riêng, còn lại mới là setup', () => {
  assert.match(helperSrc, /if \(mode === 'supabase'\)/);
  assert.match(helperSrc, /if \(mode === 'demo'\)/);
  assert.ok(helperSrc.indexOf("mode === 'supabase'") < helperSrc.indexOf("mode === 'demo'"));
  // Nhánh demo nằm trọn trước return của nhánh setup: trong đoạn demo không có chuỗi chờ kết nối.
  const demoBranch = section("if (mode === 'demo')", 'return \'<p><span class="badge warn">', helperSrc);
  assert.ok(!demoBranch.includes('Chờ kết nối Supabase'));
  assert.match(demoBranch, /Supabase đã cấu hình/);
});

test('SETTINGS-SUPABASE [static]: setupNotice chỉ render khi setupNeeded (chỉ mode setup) và thanh trên vẫn phân biệt đúng 3 mode — giữ nguyên, khóa bằng test', () => {
  // render(): setupNotice chỉ khi setupNeeded và không ở trang Thiết lập.
  assert.match(src, /else if \(Store\.setupNeeded && ROUTE\.name !== 'settings'\) \{ app\.innerHTML = setupNotice\(\); \}/);
  // store.js: setupNeeded chỉ = true ở nhánh setup; demo và supabase đều = false.
  assert.match(storeSrc, /this\.mode = 'setup';\s*\n\s*this\.setupNeeded = true;/);
  assert.match(storeSrc, /_loadDemo: function \(\) \{\s*\n\s*this\.mode = 'demo';\s*\n\s*this\.setupNeeded = false;/);
  assert.match(storeSrc, /this\.mode = 'supabase';\s*\n\s*this\.setupNeeded = false;/);
  // Thanh trên (renderNav): đã phân biệt đúng demo / supabase / setup từ trước.
  assert.match(src, /conn\.textContent = Store\.mode === 'demo' \? 'Chế độ: Dữ liệu minh họa \(demo\)' : \(Store\.mode === 'supabase' \? 'Chế độ: Dữ liệu thật' : 'Chờ kết nối Supabase'\)/);
});
