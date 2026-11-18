// tests/back-to-top.test.mjs
// Nút "Về đầu trang" (yêu cầu Zac 18/11/2026): nút nổi cố định góc
// dưới-phải, hiển thị ở MỌI view. Vì app là SPA nên nút sống ở khung
// app dùng chung trong index.html (NGOÀI <main id="app"> — phần render
// từng view), gắn đúng 1 lần, không bị tạo lại/trùng khi chuyển view.
// Cơ chế cuộn thật của app là WINDOW: render() khôi phục vị trí bằng
// window.scrollTo / window.scrollY và listener scroll hiện có cũng
// nghe trên window (không có container cuộn nội bộ cho nội dung
// chính) — nên ngưỡng ẩn/hiện bám window.scrollY và hành động cuộn
// dùng window.scrollTo({ top: 0, behavior: 'smooth' }).
// Góc dưới-phải đã có .toast cố định (right:18px; bottom:18px) nên
// nút đặt ở bottom:88px, phía trên vùng toast, để không chồng lấp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Khối logic thuần + hàm cập nhật nút: từ mốc PURE tới ngay trước
// listener scroll của window (điểm nối dây thật).
const pureBegin = appSrc.indexOf('// BACKTOTOP-PURE-BEGIN');
const pureEnd = appSrc.indexOf('// BACKTOTOP-PURE-END');
assert.notEqual(pureBegin, -1, 'thiếu mốc BACKTOTOP-PURE-BEGIN trong app.js');
assert.notEqual(pureEnd, -1, 'thiếu mốc BACKTOTOP-PURE-END trong app.js');
const wiringEnd = appSrc.indexOf("window.addEventListener('scroll'", pureEnd);
assert.notEqual(wiringEnd, -1, 'không thấy listener scroll của window sau khối BACKTOTOP');
const backToTopSrc = appSrc.slice(pureBegin, wiringEnd);

function makeHarness(fakeBtn, scrollY) {
  const fakeDocument = { getElementById: (id) => (id === 'back-to-top' ? fakeBtn : null) };
  const fakeWindow = { scrollY };
  const factory = new Function('document', 'window',
    backToTopSrc + '\nreturn { visible: backToTopVisible, update: updateBackToTop, THRESHOLD: BACK_TO_TOP_THRESHOLD_PX };');
  return { h: factory(fakeDocument, fakeWindow), fakeWindow };
}

// ---------- [static] đúng 1 nút trong khung app dùng chung ----------
test('BTT [static]: index.html có ĐÚNG 1 nút #back-to-top, nằm NGOÀI <main id="app"> (khung dùng chung, không render theo view), nhãn "↑ Về đầu trang", bắt đầu ẩn', () => {
  assert.equal(countOccurrences(indexHtml, 'id="back-to-top"'), 1, 'phải có đúng 1 phần tử #back-to-top trong index.html');
  assert.equal(countOccurrences(indexHtml, 'data-action="back-to-top"'), 1, 'đúng 1 nút mang data-action="back-to-top"');
  const btnIdx = indexHtml.indexOf('id="back-to-top"');
  const mainCloseIdx = indexHtml.indexOf('</main>');
  assert.notEqual(mainCloseIdx, -1);
  assert.ok(btnIdx > mainCloseIdx, 'nút phải nằm ngoài <main id="app"> để không bị render lại theo view');
  const btnTag = indexHtml.slice(indexHtml.lastIndexOf('<button', btnIdx), indexHtml.indexOf('>', btnIdx) + 1);
  assert.match(btnTag, /type="button"/);
  assert.match(btnTag, /class="btn back-to-top"/, 'giữ phong cách .btn hiện có của app + class riêng .back-to-top');
  assert.match(btnTag, /hidden/, 'mặc định ẩn (đang ở đầu trang)');
  assert.match(btnTag, /aria-label="Về đầu trang"/);
  const btnText = indexHtml.slice(indexHtml.indexOf('>', btnIdx) + 1, indexHtml.indexOf('</button>', btnIdx));
  assert.equal(btnText, '↑ Về đầu trang', 'nhãn gọn đúng yêu cầu');
  // app.js không tự tạo thêm nút ở bất kỳ view/render nào.
  assert.equal(countOccurrences(appSrc, 'id="back-to-top"'), 0, 'app.js không được sinh thêm #back-to-top trong HTML của view');
  assert.equal(countOccurrences(appSrc, "getElementById('back-to-top')"), 1, 'app.js chỉ tra cứu nút dùng chung đúng 1 chỗ (updateBackToTop)');
});

// ---------- [static] handler click + nối dây cuộn ----------
test('BTT [static]: handler click của data-action="back-to-top" gọi window.scrollTo({top:0, behavior:"smooth"}); listener scroll của window + render() đều gọi updateBackToTop', () => {
  assert.match(appSrc, /if \(action === 'back-to-top'\) \{ window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\); \}/,
    'click phải cuộn mượt về đầu bằng scroller thật (window)');
  // Listener scroll hiện có của app (nơi lưu scrollMem theo window.scrollY) phải cập nhật nút.
  const listenerStart = appSrc.indexOf("window.addEventListener('scroll'");
  const listener = appSrc.slice(listenerStart, appSrc.indexOf('});', listenerStart));
  assert.match(listener, /UI\.scrollMem\[routeKey\(ROUTE\)\] = window\.scrollY;/, 'listener gốc vẫn lưu vị trí cuộn theo window.scrollY');
  assert.match(listener, /updateBackToTop\(\);/, 'listener scroll phải cập nhật ẩn/hiện nút');
  // render() cũng đồng bộ lại trạng thái nút sau khi khôi phục vị trí cuộn.
  const renderStart = appSrc.indexOf('function render() {');
  const renderEnd = appSrc.indexOf("window.addEventListener('scroll'", renderStart);
  assert.match(appSrc.slice(renderStart, renderEnd), /window\.scrollTo\(0, UI\.scrollMem\[routeKey\(ROUTE\)\]\);[\s\S]*updateBackToTop\(\);/,
    'render() khôi phục cuộn bằng window rồi gọi updateBackToTop()');
});

// ---------- [unit] logic ẩn/hiện theo ngưỡng ----------
test('BTT [unit]: backToTopVisible — ngưỡng 400px: <= 400 ẩn, > 400 hiện, giá trị rác ẩn', () => {
  const { h } = makeHarness({ hidden: true }, 0);
  assert.equal(h.THRESHOLD, 400);
  assert.equal(h.visible(0), false);
  assert.equal(h.visible(399), false);
  assert.equal(h.visible(400), false, 'đúng ngưỡng vẫn ẩn (chỉ hiện khi ĐÃ qua ngưỡng)');
  assert.equal(h.visible(401), true);
  assert.equal(h.visible(5000), true);
  assert.equal(h.visible('401'), true, 'chuỗi số vẫn hiểu được qua Number()');
  assert.equal(h.visible('abc'), false);
  assert.equal(h.visible(undefined), false);
  assert.equal(h.visible(null), false);
  assert.equal(h.visible(-50), false);
});

// ---------- [unit] updateBackToTop bám window.scrollY thật ----------
test('BTT [unit]: updateBackToTop — dưới ngưỡng thì hidden=true, qua ngưỡng hidden=false, quay lại đầu trang thì ẩn lại; thiếu nút không vỡ', () => {
  const btn = { hidden: true };
  const { h, fakeWindow } = makeHarness(btn, 0);
  h.update();
  assert.equal(btn.hidden, true, 'ở đầu trang (scrollY=0) nút ẩn');
  fakeWindow.scrollY = 400;
  h.update();
  assert.equal(btn.hidden, true, 'scrollY=400 (chưa qua ngưỡng) nút vẫn ẩn');
  fakeWindow.scrollY = 401;
  h.update();
  assert.equal(btn.hidden, false, 'scrollY=401 nút hiện');
  fakeWindow.scrollY = 1200;
  h.update();
  assert.equal(btn.hidden, false, 'cuộn sâu nút vẫn hiện');
  fakeWindow.scrollY = 0;
  h.update();
  assert.equal(btn.hidden, true, 'về đầu trang nút ẩn lại');
  // Không có nút trong DOM (phòng thủ) -> không ném lỗi.
  const noBtn = makeHarness(null, 999);
  assert.doesNotThrow(() => noBtn.h.update());
});

// ---------- [static] CSS: cố định góc dưới-phải, tránh toast ----------
test('BTT [static]: CSS .back-to-top cố định góc dưới-phải (fixed, right:18px) và bottom CAO HƠN .toast để không đè phần tử nổi sẵn có; [hidden] ẩn hẳn', () => {
  const rule = /\.back-to-top\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'thiếu rule .back-to-top trong styles.css');
  assert.match(rule[1], /position:fixed/);
  assert.match(rule[1], /right:18px/);
  const btnBottom = Number(/bottom:(\d+)px/.exec(rule[1])[1]);
  const toastRule = /\.toast\{([^}]*)\}/.exec(css);
  assert.ok(toastRule, 'không thấy rule .toast để đối chiếu vị trí');
  assert.match(toastRule[1], /position:fixed/);
  const toastBottom = Number(/bottom:(\d+)px/.exec(toastRule[1])[1]);
  assert.ok(btnBottom > toastBottom + 40,
    'nút phải nằm trên vùng toast một khoảng rõ (bottom nút ' + btnBottom + 'px > bottom toast ' + toastBottom + 'px + 40px)');
  assert.match(css, /\.back-to-top\[hidden\]\{display:none\}/, 'trạng thái hidden phải ẩn hẳn khỏi màn hình');
});
