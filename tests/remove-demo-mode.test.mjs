// ============================================================================
// REMOVE-DEMO (branch prep/remove-demo-mode) — App KHÔNG còn chế độ demo:
// khởi động thẳng vào Supabase/dữ liệu thật; không còn nút "Xem dữ liệu
// mẫu", không công tắc demo ở Thiết lập, không đường nạp js/demo-data.js
// vào app. js/demo-data.js vẫn ở trong repo CHỈ làm fixture cho test +
// nguồn sinh seed (scripts/generate-seed-from-demo.mjs).
// Adapter trong bộ nhớ của Store (mode='demo' nội bộ) chỉ còn phục vụ các
// test dùng dữ liệu test độc lập tự dựng state — app không bao giờ vào
// được mode đó nữa vì Store.load() không còn nhánh demo.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const appSrc = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const storeSrc = fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
const indexSrc = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('REMOVE-DEMO [static]: index.html không nạp demo-data, không banner demo, không bộ đổi người dùng demo', () => {
  assert.doesNotMatch(indexSrc, /demo-data\.js/);
  assert.doesNotMatch(indexSrc, /demo-banner/);
  assert.doesNotMatch(indexSrc, /demo-user-picker/);
  assert.doesNotMatch(indexSrc, /current-user-select/);
});

test('REMOVE-DEMO [static]: app.js không còn lối vào demo nào', () => {
  assert.doesNotMatch(appSrc, /demo-on|demo-off|demo-reset/);
  assert.doesNotMatch(appSrc, /Xem dữ liệu mẫu/);
  assert.doesNotMatch(appSrc, /login-demo-entry|data-login-demo/);
  assert.doesNotMatch(appSrc, /<h2>Chế độ demo<\/h2>/);
  assert.doesNotMatch(appSrc, /setDemoEnabled|resetDemo/);
  assert.doesNotMatch(appSrc, /Store\.mode === 'demo'/);
});

test('REMOVE-DEMO [static]: store.js không còn cơ chế nạp demo', () => {
  assert.doesNotMatch(storeSrc, /_loadDemo|setDemoEnabled|demoRequested|SAVA_DEMO_DATA|sava_demo_enabled|demo_sava_workspace/);
  // load() chỉ còn 2 nhánh: supabase (config hợp lệ) hoặc setup.
  const loadBlock = storeSrc.slice(storeSrc.indexOf('load: function ()'), storeSrc.indexOf('_initSupabase: function'));
  assert.match(loadBlock, /configIsValid\(\)/);
  assert.match(loadBlock, /this\.mode = 'setup'/);
});

test('REMOVE-DEMO [unit]: Store.load() bỏ qua mọi cờ demo cũ trong localStorage — không cấu hình thì vào setup', async () => {
  const hadStorage = 'localStorage' in globalThis;
  const prev = globalThis.localStorage;
  const mem = new Map([['sava_demo_enabled', '1'], ['demo_sava_workspace_v1', '{"campaigns":[{}]}']]);
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  globalThis.location = { search: '?demo=1', hash: '' };
  try {
    delete require.cache[require.resolve('../js/store.js')];
    const Store = require('../js/store.js');
    await Store.load();
    assert.notEqual(Store.mode, 'demo');
    assert.equal(Store.mode, 'setup'); // không có SAVA_CONFIG hợp lệ trong môi trường test
    assert.equal(Store.setupNeeded, true);
  } finally {
    if (hadStorage) globalThis.localStorage = prev; else delete globalThis.localStorage;
    delete globalThis.location;
    delete require.cache[require.resolve('../js/store.js')];
    require('../js/store.js');
  }
});
