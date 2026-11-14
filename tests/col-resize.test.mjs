// tests/col-resize.test.mjs
// Kéo rộng cột kiểu Excel (js/col-resize.js):
// [unit] logic THUẦN lưu/áp độ rộng + auto-fit (vùng COLRESIZE-PURE);
// [static] điểm chạm tối thiểu: tbl() gắn data-table-key theo key tuỳ
// chọn, index.html nạp col-resize.js sau app.js, khối CSS cô lập, và
// các bảng bị loại trừ (scene-table, drawer) KHÔNG có key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const crSrc = readFileSync(new URL('../js/col-resize.js', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const pureBegin = crSrc.indexOf('// COLRESIZE-PURE-BEGIN');
const pureEnd = crSrc.indexOf('// COLRESIZE-PURE-END');
assert.notEqual(pureBegin, -1, 'thiếu mốc COLRESIZE-PURE-BEGIN');
assert.notEqual(pureEnd, -1, 'thiếu mốc COLRESIZE-PURE-END');
const pureSrc = crSrc.slice(pureBegin, pureEnd);
const P = new Function(pureSrc + '\nreturn { clamp: colResizeClampWidth, autoFit: colResizeAutoFitWidth, storageKey: colResizeStorageKey, normalize: colResizeNormalizeSaved, parse: colResizeParseStored, serialize: colResizeSerializeSaved, hasManual: colResizeHasManual, display: colResizeDisplayWidths, isAction: colResizeIsActionLabel, MIN: COL_RESIZE_MIN_WIDTH, AUTO_MAX: COL_RESIZE_AUTO_MAX, PREFIX: COL_RESIZE_STORAGE_PREFIX };')();

// ---------- [unit] kẹp độ rộng + auto-fit ----------
test('COLRESIZE [unit]: clamp — sàn 60px, trần kéo tay 2000px, rác -> null', () => {
  assert.equal(P.MIN, 60);
  assert.equal(P.clamp(30), 60);
  assert.equal(P.clamp(100.4), 100);
  assert.equal(P.clamp(5000), 2000);
  assert.equal(P.clamp('abc'), null);
  assert.equal(P.clamp(''), null);
  assert.equal(P.clamp(null), null);
  assert.equal(P.clamp(900, P.AUTO_MAX), 520);
});

test('COLRESIZE [unit]: autoFit — ô rộng nhất, trần 520px, sàn 60px, rỗng -> null', () => {
  assert.equal(P.AUTO_MAX, 520);
  assert.equal(P.autoFit([120, 300, 80]), 300);
  assert.equal(P.autoFit([900]), 520);
  assert.equal(P.autoFit([10]), 60);
  assert.equal(P.autoFit([]), null);
  assert.equal(P.autoFit([null, 'x', 0]), null);
});

// ---------- [unit] lưu / áp độ rộng ----------
test('COLRESIZE [unit]: storageKey — tiền tố riêng, key lạ -> null', () => {
  assert.equal(P.PREFIX, 'sava-mkt-colwidths-v1:');
  assert.equal(P.storageKey('budget-lines'), 'sava-mkt-colwidths-v1:budget-lines');
  assert.equal(P.storageKey('Bad Key'), null);
  assert.equal(P.storageKey(''), null);
  assert.equal(P.storageKey(null), null);
});

test('COLRESIZE [unit]: normalize — bỏ cột vượt số cột hiện tại, kẹp độ rộng, không vỡ khi rác', () => {
  assert.deepEqual(P.normalize({ v: 1, cols: { 0: 200, 1: 30, 5: 300 } }, 3), { 0: 200, 1: 60 });
  assert.deepEqual(P.normalize({ 0: 150 }, 2), { 0: 150 });
  assert.deepEqual(P.normalize({ cols: { 0: 'x', 1: 120 } }, 2), { 1: 120 });
  assert.deepEqual(P.normalize(null, 3), {});
  assert.deepEqual(P.normalize({ cols: { 0: 200 } }, 0), {});
});

test('COLRESIZE [unit]: parse/serialize — vòng tròn giữ nguyên, JSON hỏng -> {}', () => {
  const text = P.serialize({ 0: 200, 2: 340 });
  assert.deepEqual(P.parse(text, 3), { 0: 200, 2: 340 });
  assert.deepEqual(P.parse(text, 2), { 0: 200 });
  assert.deepEqual(P.parse('{hỏng', 3), {});
  assert.deepEqual(P.parse('', 3), {});
  assert.deepEqual(P.parse(null, 3), {});
});

test('COLRESIZE [unit]: displayWidths — ưu tiên chỉnh tay, rồi tự nhiên, rồi dự phòng 160', () => {
  assert.deepEqual(P.display(3, [100, 0, null], { 1: 250 }), [100, 250, 160]);
  assert.deepEqual(P.display(2, [100, 200], {}), [100, 200]);
  assert.deepEqual(P.display(0, [], {}), []);
  assert.equal(P.hasManual({ 0: 100 }), true);
  assert.equal(P.hasManual({}), false);
  assert.equal(P.hasManual(null), false);
});

test('COLRESIZE [unit]: isActionLabel — cột hành động theo nhãn', () => {
  assert.equal(P.isAction('Thao tác'), true);
  assert.equal(P.isAction(''), true);
  assert.equal(P.isAction('Hành động'), true);
  assert.equal(P.isAction('Task'), false);
  assert.equal(P.isAction('Trạng thái'), false);
});

// ---------- [static] điểm chạm + phạm vi ----------
const TABLE_KEYS = ['overview-risk', 'my-work-tasks', 'brand-pages', 'brand-assets', 'brand-archived', 'campaigns-archived', 'kpi-summary', 'cash-balances', 'cash-transactions', 'budget-by-campaign', 'campaign-action-plan', 'campaign-budget-detail', 'campaign-phases', 'campaign-activities', 'campaign-tasks', 'campaign-content', 'campaign-publications', 'campaign-assets', 'content-backlog', 'content-grouped', 'content-month-publications', 'content-items', 'content-variants', 'content-production', 'content-library', 'content-mix-matrix', 'content-queue', 'content-orphan-posts', 'content-pillars', 'tasks-main', 'tasks-blockers', 'tasks-requests', 'approvals-decisions', 'team-workload', 'kpi-main', 'budget-lines', 'budget-commitments', 'budget-actuals', 'channels-accounts', 'channels-posts', 'ads-main', 'ads-change-requests', 'reports-campaign-progress', 'reports-detail', 'reports-lifetime', 'settings-members', 'settings-permissions', 'settings-bu'];

test('COLRESIZE [static]: tbl() gắn data-table-key theo key tuỳ chọn; đủ 48 bảng chính có key, mỗi key đúng 1 chỗ', () => {
  assert.match(appSrc, /function tbl\(inner, key\)/);
  assert.match(appSrc, /data-table-key="' \+ esc\(key\) \+ '"/);
  for (const k of TABLE_KEYS) {
    const needle = ", '" + k + "'";
    assert.equal(appSrc.split(needle).length - 1, 1, 'key phải xuất hiện đúng 1 lần: ' + k);
  }
});

test('COLRESIZE [static]: bảng loại trừ không có key — scene-table viết tay + drawer hoạt động + bảng key-value Mục tiêu', () => {
  for (const line of appSrc.split('\n')) {
    if (line.includes('scene-table')) assert.ok(!line.includes('data-table-key'), 'scene-table không được resize');
  }
  const drawerStart = appSrc.indexOf('function activityDrawerHtml()');
  const drawerEnd = appSrc.indexOf('function campaignDetailHtml(', drawerStart);
  assert.notEqual(drawerStart, -1); assert.notEqual(drawerEnd, -1);
  const drawer = appSrc.slice(drawerStart, drawerEnd);
  for (const k of TABLE_KEYS) assert.ok(!drawer.includes(", '" + k + "'"), 'drawer không được gắn key: ' + k);
  assert.match(appSrc, /<th>Vì sao chạy campaign này\?<\/th>/);
});

test('COLRESIZE [static]: index.html nạp col-resize.js SAU app.js', () => {
  const a = indexHtml.indexOf('js/app.js');
  const b = indexHtml.indexOf('js/col-resize.js');
  assert.notEqual(a, -1); assert.notEqual(b, -1);
  assert.ok(b > a, 'col-resize.js phải nạp sau app.js');
});

test('COLRESIZE [static]: cơ chế kéo — Pointer Events + capture, bấm đúp auto-fit, Shift+bấm đúp reset, tooltip tiếng Việt', () => {
  assert.match(crSrc, /addEventListener\('pointerdown'/);
  assert.match(crSrc, /setPointerCapture/);
  assert.match(crSrc, /addEventListener\('pointermove'/);
  assert.match(crSrc, /addEventListener\('dblclick'/);
  assert.match(crSrc, /ev\.shiftKey/);
  assert.match(crSrc, /Kéo để đổi độ rộng cột · bấm đúp: tự vừa nội dung/);
  assert.match(crSrc, /MutationObserver/);
  assert.match(crSrc, /localStorage/);
  assert.match(crSrc, /scene-table/);
});

test('COLRESIZE [static]: CSS cô lập — handle col-resize + touch-action chỉ trên tay nắm + fixed khi đã chỉnh', () => {
  assert.match(css, /table\.col-resized\{table-layout:fixed\}/);
  assert.match(css, /\.col-resize-handle\{[^}]*cursor:col-resize[^}]*touch-action:none/);
  assert.match(css, /table\.col-resize-measuring th,table\.col-resize-measuring td\{white-space:nowrap!important\}/);
  assert.match(css, /th\.col-resize-th\{position:relative\}/);
});
