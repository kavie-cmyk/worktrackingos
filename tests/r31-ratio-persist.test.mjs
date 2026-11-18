// tests/r31-ratio-persist.test.mjs
// R3.1 bổ sung nhỏ — persist THẬT tử số / mẫu số của KPI ratio
// (migration 0012_kpi_ratio.sql):
//   kpis.numerator   ↔ cột kpis.numerator   numeric(18,4) nullable
//   kpis.denominator ↔ cột kpis.denominator numeric(18,4) nullable
// Trước 0012: form KPI (js/app.js) đã lưu numerator/denominator vào model
// và domain.rollupKpi đọc hai field này, nhưng bảng kpis chưa có cột thật
// và kpis KHÔNG có custom_fields nên store-core loại cả hai khỏi payload
// ở chế độ Supabase (đặc tả C.8).
// Kiểm chứng ở tầng mapping (store-core) + adapter (store _toPayload/
// _rowToItem, gồm bộ lọc cột cuối + đường update lạc quan) + demo
// round-trip + rollupKpi trên object đọc lại — không đụng DB live
// (schema live đã kiểm riêng bằng SQL khi áp 0012).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
const domain = require('../js/domain.js');
require('../js/domain.js');
const Store = require('../js/store.js');

const WS = 'ws-1';
const U1 = '11111111-1111-1111-1111-111111111111';
const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function resetDemo(extraState) {
  Store.mode = 'demo';
  Store.workspaceId = WS;
  Store.currentUserId = U1;
  Store._membership = null;
  Store.state = Object.assign({
    members: [{ id: U1, name: 'Owner', role: 'owner', capacityHoursPerWeek: null, daysOff: null }],
    campaigns: [{ id: CAMP_A, name: 'Camp A', status: 'active' }],
    kpis: [], kpiTargetVersions: [],
  }, extraState || {});
  Store.loadState = {};
  return Store;
}

// ---------------------------------------------------------------------------
// Migration 0012 — tĩnh: đủ 2 cột, đúng kiểu, idempotent
// ---------------------------------------------------------------------------
test('0012 [static]: thêm numerator + denominator numeric(18,4), idempotent', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0012_kpi_ratio.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.kpis add column if not exists numerator numeric\(18,4\)/);
  assert.match(sql, /alter table public\.kpis add column if not exists denominator numeric\(18,4\)/);
  // Idempotent: cả 2 lệnh đều dùng add column if not exists (chạy lại không lỗi).
  assert.equal((sql.match(/add column if not exists/g) || []).length, 2);
});

// ---------------------------------------------------------------------------
// Payload ghi: 2 cột thật có đúng giá trị, không rơi, không gói custom_fields
// ---------------------------------------------------------------------------
test('R3.1-ratio [core]: KPI numerator/denominator vào payload cột thật đúng giá trị', () => {
  const payload = core.toDbPayload('kpis', {
    name: 'CPL', campaignId: CAMP_A, aggregationMode: 'ratio', numerator: 10000000, denominator: 100,
  });
  assert.equal(payload.numerator, 10000000);
  assert.equal(payload.denominator, 100);
  assert.ok(!('custom_fields' in payload), 'kpis không có custom_fields — numerator/denominator không được gói tạm');
  assert.equal(core.hasColumn('kpis', 'numerator'), true);
  assert.equal(core.hasColumn('kpis', 'denominator'), true);
});

test('R3.1-ratio [core]: xoá tử/mẫu tường minh (null) vẫn vào payload — không bị nuốt', () => {
  const payload = core.toDbPayload('kpis', { name: 'CPL', numerator: null, denominator: null });
  assert.ok('numerator' in payload && payload.numerator === null);
  assert.ok('denominator' in payload && payload.denominator === null);
});

// ---------------------------------------------------------------------------
// Đọc về: fromDbRow trả lại đúng + rollupKpi trên object đọc lại = 100000
// ---------------------------------------------------------------------------
test('R3.1-ratio [core]: đọc về nguyên vẹn qua fromDbRow và rollupKpi cho 100000', () => {
  const back = core.fromDbRow('kpis', { id: 'k1', numerator: 10000000, denominator: 100, aggregation_mode: 'ratio' });
  assert.equal(back.numerator, 10000000);
  assert.equal(back.denominator, 100);
  const r = domain.rollupKpi([], { mode: 'ratio', numerator: back.numerator, denominator: back.denominator });
  assert.equal(r.status, 'ok');
  assert.equal(r.numeratorTotal, 10000000);
  assert.equal(r.denominatorTotal, 100);
  assert.equal(r.value, 100000);
});

test('R3.1-ratio [core]: KPI cũ chưa khai tử/mẫu → null khi đọc, rollup insufficient_data', () => {
  const back = core.fromDbRow('kpis', { id: 'k2', numerator: null, denominator: null });
  assert.equal(back.numerator, null);
  assert.equal(back.denominator, null);
  const r = domain.rollupKpi([], { mode: 'ratio', numerator: back.numerator, denominator: back.denominator });
  assert.equal(r.value, null);
  assert.equal(r.status, 'insufficient_data');
});

// ---------------------------------------------------------------------------
// Adapter store: _toPayload/_rowToItem (bộ lọc cột cuối không xoá 2 cột)
// + đường update lạc quan qua buildOptimisticUpdate
// ---------------------------------------------------------------------------
test('R3.1-ratio [store]: round-trip qua _toPayload/_rowToItem giữ đúng 10000000/100', () => {
  resetDemo();
  const payload = Store._toPayload('kpis', {
    name: 'Chi phí / đăng ký', campaignId: CAMP_A, metricCode: 'cpl',
    aggregationMode: 'ratio', numerator: 10000000, denominator: 100,
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.numerator, 10000000, 'bộ lọc cột cuối của store không được xoá numerator');
  assert.equal(payload.denominator, 100, 'bộ lọc cột cuối của store không được xoá denominator');
  const back = Store._rowToItem('kpis', { id: 'k1', ...payload });
  assert.equal(back.numerator, 10000000);
  assert.equal(back.denominator, 100);
  const r = domain.rollupKpi([], { mode: 'ratio', numerator: back.numerator, denominator: back.denominator });
  assert.equal(r.value, 100000);
});

test('R3.1-ratio [core]: update lạc quan (buildOptimisticUpdate) mang cả numerator/denominator', () => {
  const upd = core.buildOptimisticUpdate(
    'kpis',
    { numerator: 20000000, denominator: 200 },
    { id: 'k1', updatedAt: '2026-11-12T00:00:00.000Z' },
    '2026-11-12T01:00:00.000Z',
  );
  assert.ok(upd, 'kpis có updated_at nên đường lạc quan phải dựng được');
  assert.equal(upd.table, 'kpis');
  assert.equal(upd.payload.numerator, 20000000);
  assert.equal(upd.payload.denominator, 200);
  assert.deepEqual(upd.match, { id: 'k1', updated_at: '2026-11-12T00:00:00.000Z' });
});

// ---------------------------------------------------------------------------
// Demo round-trip: tạo + sửa KPI ratio giữ numerator/denominator trong state
// ---------------------------------------------------------------------------
test('R3.1-ratio [store/demo]: tạo + sửa KPI ratio giữ tử số/mẫu số trong state', () => {
  resetDemo();
  const c = Store.create('kpis', {
    id: 'kpi-cpl', name: 'CPL', campaignId: CAMP_A, metricCode: 'cpl',
    aggregationMode: 'ratio', numerator: 10000000, denominator: 100,
  });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.item.numerator, 10000000);
  assert.equal(c.item.denominator, 100);
  const u = Store.update('kpis', 'kpi-cpl', { numerator: 20500000, denominator: 140 });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(Store.get('kpis', 'kpi-cpl').numerator, 20500000);
  assert.equal(Store.get('kpis', 'kpi-cpl').denominator, 140);
});
