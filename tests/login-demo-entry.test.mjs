// tests/login-demo-entry.test.mjs
// LỐI VÀO DỮ LIỆU MẪU NGAY TẠI MÀN HÌNH ĐĂNG NHẬP (17/11/2026).
// Bối cảnh: bản live chặn mọi trang sau màn hình đăng nhập khi chưa đăng
// nhập; nút "Xem dữ liệu mẫu" ở Planning/Brand chỉ tới được SAU khi đăng
// nhập. Vá:
//  - viewLogin có khối lối vào mẫu riêng (data-login-demo) với nút dùng
//    ĐÚNG action demo-on-planning đã có: Store.setDemoEnabled(true) +
//    hash #/planning + reload — không chế cơ chế demo mới;
//  - authGateView cho qua thẳng khi Store.mode === 'demo' (cờ demo bật =
//    vào app với dữ liệu mẫu, không cần phiên đăng nhập, kể cả khi
//    state.authRequired còn sót true); demo TẮT thì cổng giữ nguyên
//    tuyệt đối như trước (authRequired -> login, pendingInvite trước,
//    noMembership trước) — dữ liệu thật không đi qua đường demo vì chế
//    độ demo chỉ nạp js/demo-data.js (Store.load rẽ demo TRƯỚC supabase).
// Đường thoát khỏi demo: giữ nguyên điều khiển sẵn có ở Thiết lập —
// panel "Chế độ demo" có nút demo-off khi đang ở demo (test khóa lại).
// Tầng kiểm: [unit] chạy hàm thật viewLogin / authGateView trích từ
// source (stub pageHead / các view cổng), [static] khóa wiring handler,
// [integration] chạy Store thật với localStorage giả lập trong Node —
// không đụng DB live, không đụng Supabase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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

// ---------- [unit] viewLogin thật (stub pageHead đúng shape tối thiểu) ----------
function pageHeadStub(title, sub) {
  return '<div class="page-head"><div><h1>' + title + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div></div>';
}
const viewLogin = new Function('pageHead',
  section('function viewLogin()', 'function viewNoMembership()') + '\nreturn viewLogin;'
)(pageHeadStub);

// ---------- [unit] authGateView thật (stub Store + các view cổng) ----------
function makeGate(store) {
  return new Function('Store', 'viewInviteExpired', 'viewSetPassword', 'viewNoMembership', 'viewLogin',
    section('function authGateView()', 'function renderNav()') + '\nreturn authGateView;'
  )(store,
    () => 'INVITE_EXPIRED_VIEW',
    () => 'SET_PASSWORD_VIEW',
    () => 'NO_MEMBERSHIP_VIEW',
    () => 'LOGIN_VIEW');
}
function fakeStore(over) {
  return Object.assign({
    mode: 'supabase',
    pendingInvite: null,
    state: { authRequired: false, noMembership: false }
  }, over || {});
}

// ---------- (a) nút "Xem dữ liệu mẫu" tồn tại ở login view ----------
test('LOGIN-DEMO [unit]: viewLogin render khối lối vào mẫu riêng + nút "Xem dữ liệu mẫu" (không cần tài khoản), form đăng nhập giữ nguyên', () => {
  const html = viewLogin();
  // Form đăng nhập cũ giữ nguyên.
  assert.match(html, /<form class="inline" id="login-form">/);
  assert.match(html, /<input type="email" name="email" required autocomplete="username">/);
  assert.match(html, /<input type="password" name="password" required autocomplete="current-password">/);
  // Khối lối vào mẫu riêng, ghi rõ không cần tài khoản + là dữ liệu minh họa.
  assert.match(html, /<div class="login-demo-entry" data-login-demo="1">/);
  assert.match(html, /không cần tài khoản/);
  assert.match(html, /dữ liệu minh họa, không phải dữ liệu thật/);
  assert.match(html, /<button type="button" class="btn secondary" data-action="demo-on-planning">Xem dữ liệu mẫu<\/button>/);
});

test('LOGIN-DEMO [static]: viewLogin là view mà cổng trả về khi authRequired (nút mẫu nằm đúng màn hình đăng nhập, không phải view khác)', () => {
  assert.match(src, /if \(Store\.state\.authRequired\) return viewLogin\(\);/);
  const loginBlock = section('function viewLogin()', 'function viewNoMembership()');
  assert.match(loginBlock, /data-action="demo-on-planning">Xem dữ liệu mẫu</);
  // Nút ở login KHÔNG dùng action demo-on (hạ cánh Overview) — phải hạ cánh Planning.
  assert.doesNotMatch(loginBlock, /data-action="demo-on"/);
});

// ---------- (b) handler bật demo đúng cơ chế hiện có ----------
test('LOGIN-DEMO [static]: handler của nút ở login là demo-on-planning sẵn có — setDemoEnabled(true) + hash #/planning + reload, không cơ chế mới', () => {
  assert.match(src, /if \(action === 'demo-on-planning'\) \{ Store\.setDemoEnabled\(true\); window\.location\.hash = '#\/planning'; window\.location\.reload\(\); \}/);
  // setDemoEnabled của Store ghi ĐÚNG cờ demo hiện hữu sava_demo_enabled.
  assert.match(storeSrc, /var DEMO_FLAG_KEY = 'sava_demo_enabled';/);
  assert.match(storeSrc, /setDemoEnabled: function \(enabled\) \{\s*\n\s*try \{ global\.localStorage\.setItem\(DEMO_FLAG_KEY, enabled \? '1' : '0'\); \} catch \(e\) \{\}/);
  // Store.load rẽ demo TRƯỚC nhánh supabase: cờ bật là vào thẳng dữ liệu mẫu.
  const loadBlock = section('load: function () {', '_initSupabase: function ()', storeSrc);
  assert.ok(loadBlock.indexOf('demoRequested()') < loadBlock.indexOf('configIsValid()'),
    'Store.load phải kiểm tra cờ demo trước khi vào nhánh supabase');
  assert.match(loadBlock, /if \(demoRequested\(\)\) \{\s*\n\s*this\._loadDemo\(\);/);
});

// ---------- (c) gate: demo bật -> qua; demo tắt -> chặn như cũ ----------
test('LOGIN-DEMO [unit]: gate — demo bật (mode demo) thì cho qua thẳng dù authRequired/noMembership còn sót, render được view thật', () => {
  const gate = makeGate(fakeStore({
    mode: 'demo',
    pendingInvite: null,
    state: { authRequired: true, noMembership: true }
  }));
  assert.equal(gate(), null, 'demo bật: cổng phải trả null để render() hiển thị view đích (#/planning)');
});

test('LOGIN-DEMO [unit]: gate — demo tắt giữ nguyên tuyệt đối: chưa đăng nhập -> login; có phiên hợp lệ -> qua; invite/noMembership giữ thứ tự cũ', () => {
  // Chưa đăng nhập ở chế độ dữ liệu thật -> màn hình đăng nhập như cũ.
  assert.equal(makeGate(fakeStore({ mode: 'supabase', state: { authRequired: true, noMembership: false } }))(), 'LOGIN_VIEW');
  assert.equal(makeGate(fakeStore({ mode: 'setup', state: { authRequired: true, noMembership: false } }))(), 'LOGIN_VIEW');
  // Đã đăng nhập, không vướng điều kiện nào -> qua cổng.
  assert.equal(makeGate(fakeStore({ mode: 'supabase', state: { authRequired: false, noMembership: false } }))(), null);
  // Thứ tự ưu tiên cũ khi demo tắt: invite hết hạn -> invite; invite -> đặt mật khẩu; noMembership -> noMembership.
  assert.equal(makeGate(fakeStore({ mode: 'supabase', pendingInvite: { expired: true }, state: { authRequired: true, noMembership: true } }))(), 'INVITE_EXPIRED_VIEW');
  assert.equal(makeGate(fakeStore({ mode: 'supabase', pendingInvite: { type: 'invite' }, state: { authRequired: false, noMembership: false } }))(), 'SET_PASSWORD_VIEW');
  assert.equal(makeGate(fakeStore({ mode: 'supabase', state: { authRequired: false, noMembership: true } }))(), 'NO_MEMBERSHIP_VIEW');
});

// ---------- Đường thoát khỏi demo (dùng lại điều khiển sẵn có) ----------
test('LOGIN-DEMO [static]: đường thoát demo sẵn có ở Thiết lập giữ nguyên — panel "Chế độ demo" hiện nút Tắt khi đang demo, handler demo-off tắt cờ + reload', () => {
  const settings = section('function viewSettings()', '// ---------- Đăng nhập');
  assert.match(settings, /<h2>Chế độ demo<\/h2>/);
  assert.match(settings, /data-action="demo-off">Tắt chế độ demo<\/button>/);
  assert.match(src, /if \(action === 'demo-off'\) \{ Store\.setDemoEnabled\(false\); window\.location\.hash = '#\/settings'; window\.location\.reload\(\); \}/);
  // Lời dẫn ở login trỏ đúng tới đường thoát này.
  assert.match(section('function viewLogin()', 'function viewNoMembership()'), /Thoát chế độ mẫu bất cứ lúc nào ở mục Thiết lập bằng nút "Tắt chế độ demo"/);
});

// ---------- [integration] Store thật: bật cờ -> load vào demo; tắt cờ -> không vào demo ----------
const storageData = new Map();
globalThis.localStorage = {
  getItem: (k) => (storageData.has(k) ? storageData.get(k) : null),
  setItem: (k, v) => { storageData.set(k, String(v)); },
  removeItem: (k) => { storageData.delete(k); }
};
const require = createRequire(import.meta.url);
require('../js/domain.js');
require('../js/demo-data.js'); // nạp SAVA_DEMO_DATA cho Store._loadDemo
const Store = require('../js/store.js');

test('LOGIN-DEMO [integration/store]: đúng luồng nút login — setDemoEnabled(true) ghi cờ sava_demo_enabled=1, Store.load() vào mode demo, authRequired=false, có dữ liệu mẫu Planning; gate (Store thật) cho qua', async () => {
  Store.setDemoEnabled(true);
  assert.equal(storageData.get('sava_demo_enabled'), '1');
  await Store.load();
  assert.equal(Store.mode, 'demo');
  assert.equal(Store.setupNeeded, false);
  assert.equal(Store.state.authRequired, false);
  assert.ok((Store.state.plan_rows || []).length > 0, 'demo phải có plan_rows mẫu để hạ cánh #/planning có dữ liệu');
  assert.ok((Store.state.brands || []).length > 0, 'demo phải có brands mẫu');
  assert.equal(makeGate(Store)(), null);
  // Kể cả khi cờ authRequired bị đặt sót true (trạng thái phiên trước), demo vẫn qua cổng.
  Store.state.authRequired = true;
  assert.equal(makeGate(Store)(), null);
  Store.state.authRequired = false;
});

test('LOGIN-DEMO [integration/store]: tắt demo (setDemoEnabled(false)) -> Store.load() KHÔNG vào demo nữa; gate với authRequired=true quay lại chặn ở login như cũ', async () => {
  Store.setDemoEnabled(false);
  assert.equal(storageData.get('sava_demo_enabled'), '0');
  await Store.load();
  assert.notEqual(Store.mode, 'demo', 'demo tắt: load không được vào chế độ demo');
  // Ở trình duyệt thật (có config) nhánh này là supabase + authRequired=true
  // khi chưa đăng nhập; ở Node không có config nên là setup — cả hai đều
  // không phải demo, và gate phải chặn như cũ khi authRequired=true.
  Store.pendingInvite = null;
  Store.state.noMembership = false;
  Store.state.authRequired = true;
  assert.equal(makeGate(Store)(), 'LOGIN_VIEW');
  Store.state.authRequired = false;
});
