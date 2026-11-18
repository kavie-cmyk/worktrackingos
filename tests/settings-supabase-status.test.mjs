// tests/settings-supabase-status.test.mjs
// VÁ NHÃN TRẠNG THÁI KẾT NỐI SUPABASE — panel "Trạng thái kết nối Supabase"
// trong viewSettings (js/app.js) phải phân biệt đúng các trạng thái:
//   - (prep/remove-demo-mode) mode 'demo' ĐÃ GỠ: helper không còn nhánh
//     demo; mọi mode khác 'supabase' đều rơi về nhánh setup.
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

// ---------- 1. Mode demo ĐÃ GỠ ----------
test('SETTINGS-SUPABASE [unit]: không còn nhánh demo — mode lạ rơi về nhánh setup như cũ', () => {
  const html = supabaseConnectionHtml('demo', ME, false);
  assert.match(html, /<span class="badge warn">Chờ kết nối Supabase<\/span>/);
  assert.ok(!html.includes('Bạn đang xem dữ liệu demo'));
  assert.ok(!html.includes('Supabase đã cấu hình'));
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
  // Không còn panel "Chế độ demo" / công tắc demo trong Thiết lập.
  assert.doesNotMatch(v, /Chế độ demo|demo-on|demo-off|demo-reset/);
});

test('SETTINGS-SUPABASE [static]: helper chỉ còn 2 nhánh — supabase, còn lại là setup (không còn nhánh demo)', () => {
  assert.match(helperSrc, /if \(mode === 'supabase'\)/);
  assert.doesNotMatch(helperSrc, /mode === 'demo'/);
});

test('SETTINGS-SUPABASE [static]: setupNotice chỉ render khi setupNeeded (chỉ mode setup) và thanh trên phân biệt supabase / chờ kết nối — khóa bằng test', () => {
  // render(): setupNotice chỉ khi setupNeeded và không ở trang Thiết lập.
  assert.match(src, /else if \(Store\.setupNeeded && ROUTE\.name !== 'settings'\) \{ app\.innerHTML = setupNotice\(\); \}/);
  // store.js: setupNeeded chỉ = true ở nhánh setup; supabase = false; không còn _loadDemo.
  assert.match(storeSrc, /this\.mode = 'setup';\s*\n\s*this\.setupNeeded = true;/);
  assert.doesNotMatch(storeSrc, /_loadDemo/);
  assert.match(storeSrc, /this\.mode = 'supabase';\s*\n\s*this\.setupNeeded = false;/);
  // Thanh trên (renderNav): chỉ còn 'Dữ liệu thật' (supabase) / 'Chờ kết nối Supabase'.
  assert.match(src, /conn\.textContent = Store\.mode === 'supabase' \? 'Chế độ: Dữ liệu thật' : 'Chờ kết nối Supabase'/);
});
