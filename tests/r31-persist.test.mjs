// tests/r31-persist.test.mjs
// CẬP NHẬT 0014 (chuỗi duyệt ngân sách): 2 test [store] về campaign ceiling
// bên dưới đã sửa — Store KHÔNG còn gửi budget_ceiling_amount/currency khi
// create/update campaign (hạn mức chỉ đổi qua RPC decide_budget_proposal;
// guard DB chặn nếu gửi qua REST thường) và demo create/update cũng không
// tự đặt/đổi hạn mức. Kỳ vọng cũ "Store gửi/giữ ceiling khi tạo+sửa" là
// semantics TRƯỚC 0014. Phần store-core (cột thật, custom_fields, chiều
// ĐỌC) giữ nguyên toàn bộ.
// R3.1 bổ sung — persist THẬT 2 field trước đây lưu tạm qua custom_fields
// hoặc bị rơi vì chưa có cột (migration 0011_persist_r31.sql):
//   kpis.direction                  ↔ cột kpis.direction (increase/decrease)
//   campaigns.budgetCeiling         ↔ cột campaigns.budget_ceiling_amount
//   campaigns.budgetCeilingCurrency ↔ cột campaigns.budget_ceiling_currency
// Kiểm chứng ở tầng mapping (store-core) + adapter (store _toPayload/
// _rowToItem, gồm bộ lọc cột cuối) + demo round-trip — không đụng DB live
// (schema live đã kiểm riêng bằng SQL khi áp 0011).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
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
// Migration 0011 — tĩnh: đủ 3 cột, idempotent, có CHECK như phong cách 0009
// ---------------------------------------------------------------------------
test('0011 [static]: thêm đúng 3 cột còn thiếu, idempotent + constraint có guard', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0011_persist_r31.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.kpis add column if not exists direction text/);
  assert.match(sql, /alter table public\.campaigns add column if not exists budget_ceiling_amount numeric\(18,2\)/);
  assert.match(sql, /alter table public\.campaigns add column if not exists budget_ceiling_currency text/);
  assert.match(sql, /kpis_direction_check[\s\S]*direction in \('increase','decrease'\)/);
  assert.match(sql, /campaigns_budget_ceiling_nonneg[\s\S]*budget_ceiling_amount >= 0/);
  // Mọi constraint đều nằm trong guard if not exists (chạy lại lần 2 không lỗi).
  assert.equal((sql.match(/if not exists \(select 1 from pg_constraint/g) || []).length, 2);
});

// ---------------------------------------------------------------------------
// kpis.direction — payload ghi cột thật, không rơi, không gói custom_fields
// ---------------------------------------------------------------------------
test('R3.1-persist [core]: KPI direction vào payload cột direction (increase + decrease)', () => {
  for (const dir of ['increase', 'decrease']) {
    const payload = core.toDbPayload('kpis', { name: 'KPI', campaignId: CAMP_A, direction: dir, target: 10 });
    assert.equal(payload.direction, dir);
    assert.ok(!('custom_fields' in payload), 'kpis không có custom_fields — direction không được gói tạm');
  }
  assert.equal(core.hasColumn('kpis', 'direction'), true);
});

test('R3.1-persist [core]: KPI direction đọc về nguyên vẹn qua fromDbRow', () => {
  const back = core.fromDbRow('kpis', { id: 'k1', direction: 'decrease', target_value: 10 });
  assert.equal(back.direction, 'decrease');
  const unset = core.fromDbRow('kpis', { id: 'k2', direction: null });
  assert.equal(unset.direction, null, 'KPI cũ chưa khai chiều → null, không bịa mặc định ở tầng mapping');
});

test('R3.1-persist [store]: KPI direction round-trip qua _toPayload/_rowToItem (kèm bộ lọc cột của store)', () => {
  resetDemo();
  const payload = Store._toPayload('kpis', {
    name: 'Chi phí / lead', campaignId: CAMP_A, direction: 'decrease', target: 50000, metricCode: 'cpl',
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.direction, 'decrease', 'bộ lọc cột cuối của store không được xoá direction');
  const back = Store._rowToItem('kpis', { id: 'k1', ...payload });
  assert.equal(back.direction, 'decrease');
});

test('R3.1-persist [store/demo]: tạo + sửa KPI giữ direction trong state', () => {
  resetDemo();
  const c = Store.create('kpis', { id: 'kpi-dir', name: 'CPL', campaignId: CAMP_A, target: 100, direction: 'decrease' });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.item.direction, 'decrease');
  const u = Store.update('kpis', 'kpi-dir', { direction: 'increase' });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(Store.get('kpis', 'kpi-dir').direction, 'increase');
});

// ---------------------------------------------------------------------------
// campaigns.budgetCeiling* — alias sang cột thật, KHÔNG còn vào custom_fields
// ---------------------------------------------------------------------------
test('R3.1-persist [core]: campaign budgetCeiling/Currency vào cột budget_ceiling_amount/currency', () => {
  const payload = core.toDbPayload('campaigns', { name: 'C', budgetCeiling: 32000000, budgetCeilingCurrency: 'USD' });
  assert.equal(payload.budget_ceiling_amount, 32000000);
  assert.equal(payload.budget_ceiling_currency, 'USD');
  assert.ok(!('budget_ceiling' in payload), 'không tồn tại cột budget_ceiling — hạn mức phải đi budget_ceiling_amount');
  assert.equal(core.hasColumn('campaigns', 'budget_ceiling_amount'), true);
  assert.equal(core.hasColumn('campaigns', 'budget_ceiling_currency'), true);
  const cf = payload.custom_fields || {};
  assert.ok(!('budget_ceiling' in cf) && !('budget_ceiling_currency' in cf) && !('budgetCeiling' in cf),
    'hạn mức là dữ liệu thật (C.2) — không gói vào custom_fields nữa');
});

test('R3.1-persist [core]: đọc campaign — model field budgetCeiling/Currency từ cột thật', () => {
  const back = core.fromDbRow('campaigns', { id: 'c1', budget_ceiling_amount: 32000000, budget_ceiling_currency: 'VND', custom_fields: {} });
  assert.equal(back.budgetCeiling, 32000000, 'UI (app.js) đọc c.budgetCeiling — read phải trả đúng tên model này');
  assert.equal(back.budgetCeilingAmount, 32000000);
  assert.equal(back.budgetCeilingCurrency, 'VND');
});

test('R3.1-persist [core]: cột thật ƯU TIÊN bản sao custom_fields cũ; cột null thì rơi về bản sao cũ', () => {
  const both = core.fromDbRow('campaigns', {
    id: 'c1', budget_ceiling_amount: 32000000, budget_ceiling_currency: 'USD',
    custom_fields: { budget_ceiling: 111, budget_ceiling_currency: 'VND' },
  });
  assert.equal(both.budgetCeiling, 32000000, 'cột thật thắng bản sao stale trong custom_fields');
  assert.equal(both.budgetCeilingCurrency, 'USD');
  const legacyOnly = core.fromDbRow('campaigns', {
    id: 'c2', budget_ceiling_amount: null, budget_ceiling_currency: null,
    custom_fields: { budget_ceiling: 999000, budget_ceiling_currency: 'VND' },
  });
  assert.equal(legacyOnly.budgetCeiling, 999000, 'dòng viết trước 0011 (chỉ có custom_fields) không mất hạn mức khi đọc');
  assert.equal(legacyOnly.budgetCeilingCurrency, 'VND');
});

test('R3.1-persist [core]: ghi kèm field thật thì xoá bản sao stale; patch không đụng field thì giữ nguyên bản sao', () => {
  const written = core.toDbPayload('campaigns', {
    name: 'C', budgetCeiling: 500, budgetCeilingCurrency: 'VND',
    customFields: { budget_ceiling: 111, budget_ceiling_currency: 'USD', other_note: 'giữ' },
  });
  assert.equal(written.budget_ceiling_amount, 500);
  assert.deepEqual(written.custom_fields, { other_note: 'giữ' }, 'bản sao stale bị xoá, field custom khác giữ nguyên');
  const untouched = core.toDbPayload('campaigns', {
    name: 'C2', customFields: { budget_ceiling: 555, budget_ceiling_currency: 'VND' },
  });
  assert.deepEqual(untouched.custom_fields, { budget_ceiling: 555, budget_ceiling_currency: 'VND' },
    'patch không mang hạn mức thì không được xoá dữ liệu cũ');
  const cleared = core.toDbPayload('campaigns', {
    name: 'C3', budgetCeiling: null, customFields: { budget_ceiling: 555 },
  });
  assert.equal(cleared.budget_ceiling_amount, null, 'xoá hạn mức tường minh → cột thật null');
  assert.ok(!('budget_ceiling' in (cleared.custom_fields || {})), 'đã xoá tường minh thì bản sao cũ không được hồi sinh khi đọc');
});

test('R3.1-persist [store]: campaign ceiling — _toPayload strip ceiling khi ghi (0014); _rowToItem vẫn đọc cột thật', () => {
  resetDemo();
  const payload = Store._toPayload('campaigns', {
    name: 'Camp mới', budgetCeiling: 32000000, budgetCeilingCurrency: 'VND',
  }, { workspaceId: WS, forInsert: true });
  // 0014: hạn mức chỉ đổi qua RPC decide_budget_proposal — payload ghi
  // thường KHÔNG mang budget_ceiling_amount/currency (cả create lẫn update).
  assert.ok(!('budget_ceiling_amount' in payload), 'create campaign không gửi budget_ceiling_amount (0014)');
  assert.ok(!('budget_ceiling_currency' in payload), 'create campaign không gửi budget_ceiling_currency (0014)');
  // Chiều ĐỌC không đổi: dòng DB có cột thật vẫn map về budgetCeiling/Currency.
  const back = Store._rowToItem('campaigns', { id: CAMP_A, budget_ceiling_amount: 32000000, budget_ceiling_currency: 'VND' });
  assert.equal(back.budgetCeiling, 32000000);
  assert.equal(back.budgetCeilingCurrency, 'VND');
});

test('R3.1-persist [store/demo]: tạo campaign không tự đặt hạn mức; sửa campaign giữ nguyên hạn mức đã có (0014)', () => {
  resetDemo({
    campaigns: [{ id: CAMP_A, name: 'Camp A', status: 'active', budgetCeiling: 32000000, budgetCeilingCurrency: 'VND' }],
  });
  const c = Store.create('campaigns', { id: 'camp-ceil', name: 'Camp hạn mức', budgetCeiling: 32000000, budgetCeilingCurrency: 'VND' });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.item.budgetCeiling, null, 'campaign mới tạo chưa có hạn mức — hạn mức chỉ đến từ đề xuất được Owner duyệt (0014)');
  const u = Store.update('campaigns', CAMP_A, { budgetCeiling: 40000000 });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(Store.get('campaigns', CAMP_A).budgetCeiling, 32000000, 'update thường không đổi được hạn mức — giữ nguyên giá trị hiện có');
  assert.equal(Store.get('campaigns', CAMP_A).budgetCeilingCurrency, 'VND');
});
