// tests/p2-commitment-idempotency.test.mjs
// Vá P2 — budget_commitments có idempotency_key như budget_actuals /
// cash_transactions (migration 0009 → 0013): cột + UNIQUE partial index
// (workspace_id, idempotency_key) WHERE NOT NULL ở DB; store sinh key ổn
// định cho 1 ý định tạo, retry cùng ý định dùng lại cùng key, server trả
// 409/23505 thì đọc lại bản ghi theo key và coi là đã tạo (deduped).
// Tầng kiểm: payload/demo-state/mock remote — không đụng DB live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
require('../js/domain.js');
const Store = require('../js/store.js');

const WS = 'ws-1';
const U1 = '11111111-1111-1111-1111-111111111111';

const EMPTY_COLLECTIONS = () => Object.fromEntries(Store.COLLECTIONS.map((k) => [k, []]));

function resetDemo(extraState) {
  Store.mode = 'demo';
  Store.supabaseClient = null;
  Store.workspaceId = WS;
  Store.currentUserId = U1;
  Store._membership = null;
  Store.state = Object.assign(EMPTY_COLLECTIONS(), {
    members: [{ id: U1, name: 'Owner', role: 'owner', capacityHoursPerWeek: null, daysOff: null }],
    budgetLines: [{ id: 'bl1', name: 'Ads', currency: 'VND' }],
  }, extraState || {});
  Store.loadState = {};
  Store._postMappings = [];
  return Store;
}

// Fake Supabase client (mẫu tests/content-r2.test.mjs)
function makeFakeClient(handler) {
  const calls = [];
  function from(table) {
    const b = {
      table, op: 'select', payload: null, single: false, filters: {},
      insert(p) { this.op = 'insert'; this.payload = p; return this; },
      update(p) { this.op = 'update'; this.payload = p; return this; },
      delete() { this.op = 'delete'; return this; },
      upsert(p) { this.op = 'upsert'; this.payload = p; return this; },
      select() { return this; },
      eq(col, val) { this.filters[col] = val; return this; },
      in() { return this; }, order() { return this; },
      limit() { return this; }, range() { return this; },
      then(onF, onR) {
        const call = { table: this.table, op: this.op, payload: this.payload, single: this.single, filters: { ...this.filters } };
        calls.push(call);
        return Promise.resolve().then(() => handler(call)).then(onF, onR);
      },
    };
    b.single = function () { this.single = true; return this; };
    return b;
  }
  return {
    calls,
    from,
    rpc(name, args) {
      const call = { rpc: name, args };
      calls.push(call);
      return Promise.resolve().then(() => handler(call));
    },
  };
}

function setupRemote(handler, extraState) {
  Store.mode = 'supabase';
  Store.workspaceId = WS;
  Store._membership = { role: 'lead' };
  Store.currentUserId = U1;
  Store.state = Object.assign(EMPTY_COLLECTIONS(), {
    members: [{ id: U1, name: 'Lead', role: 'lead' }],
    budgetLines: [{ id: 'bl1', name: 'Ads', currency: 'VND' }],
  }, extraState || {});
  Store.loadState = {};
  Store._postMappings = [];
  Store.supabaseClient = makeFakeClient(handler);
  return Store;
}

function commitmentRowFromPayload(payload, id) {
  return {
    id, workspace_id: WS, budget_line_id: payload.budget_line_id,
    description: payload.description, amount: payload.amount, currency: payload.currency || 'VND',
    vendor: payload.vendor || null, status: payload.status || 'committed',
    settled_amount: payload.settled_amount != null ? payload.settled_amount : 0,
    committed_at: '2026-11-13T00:00:00Z', expected_at: null,
    idempotency_key: payload.idempotency_key || null,
    created_by: U1, created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// store-core mapping hai chiều
// ---------------------------------------------------------------------------
test('P2 [store-core]: budget_commitments có cột idempotency_key; payload + read round-trip giữ key', () => {
  assert.ok(core.TABLE_COLUMNS.budget_commitments.includes('idempotency_key'));
  const payload = core.toDbPayload('commitments', { budgetLineId: 'bl1', title: 'Đặt cọc', amount: 500, idempotencyKey: 'cmt-key-1' });
  assert.equal(payload.idempotency_key, 'cmt-key-1');
  const back = core.fromDbRow('commitments', { id: 'cm1', budget_line_id: 'bl1', description: 'Đặt cọc', amount: 500, idempotency_key: 'cmt-key-1' });
  assert.equal(back.idempotencyKey, 'cmt-key-1');
  assert.equal(back.title, 'Đặt cọc');
});

test('P2 [store]: _toPayload commitments — insert sinh key/giữ key caller; update không sinh key, không gửi key', () => {
  resetDemo();
  const kept = Store._toPayload('commitments', { budgetLineId: 'bl1', title: 'Đặt cọc', amount: 500, idempotencyKey: 'cmt-key-9' }, { workspaceId: WS, forInsert: true });
  assert.equal(kept.idempotency_key, 'cmt-key-9', 'key caller cấp phải được giữ nguyên');
  const auto = Store._toPayload('commitments', { budgetLineId: 'bl1', title: 'Đặt cọc', amount: 500 }, { workspaceId: WS, forInsert: true });
  assert.ok(auto.idempotency_key, 'tạo cam kết không truyền key → _toPayload sinh key');
  assert.match(auto.idempotency_key, /^cmt-/);
  const upd = Store._toPayload('commitments', { amount: 600, idempotencyKey: 'cmt-key-khac' }, { workspaceId: WS });
  assert.ok(!('idempotency_key' in upd), 'update không được gửi/đổi idempotency_key');
});

// ---------------------------------------------------------------------------
// Demo — dedup theo key
// ---------------------------------------------------------------------------
test('P2 [demo]: tạo + retry cùng ý định (cùng key) → đúng 1 commitment, retry deduped', () => {
  resetDemo();
  const first = Store.create('commitments', { budgetLineId: 'bl1', title: 'Đặt cọc agency', amount: 1000, status: 'committed' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.ok(first.item.idempotencyKey, 'tạo cam kết không truyền key → store sinh key và giữ trên item');
  const retry = Store.create('commitments', { budgetLineId: 'bl1', title: 'Đặt cọc agency', amount: 1000, status: 'committed', idempotencyKey: first.item.idempotencyKey });
  assert.equal(retry.ok, true);
  assert.equal(retry.deduped, true);
  assert.equal(retry.item.id, first.item.id);
  assert.equal(Store.state.commitments.length, 1, 'retry cùng key không được tạo bản ghi thứ hai');
  // Key do caller cấp tường minh cũng được giữ + dedup:
  const explicit = Store.create('commitments', { budgetLineId: 'bl1', title: 'Thuê KOL', amount: 200, idempotencyKey: 'cmt-explicit-1' });
  assert.equal(explicit.item.idempotencyKey, 'cmt-explicit-1');
  const explicitRetry = Store.create('commitments', { budgetLineId: 'bl1', title: 'Thuê KOL', amount: 200, idempotencyKey: 'cmt-explicit-1' });
  assert.equal(explicitRetry.deduped, true);
  assert.equal(Store.state.commitments.length, 2);
});

test('P2 [demo]: 2 ý định khác nhau → 2 commitment (key khác nhau, kể cả khi không truyền key)', () => {
  resetDemo();
  const a = Store.create('commitments', { budgetLineId: 'bl1', title: 'Cam kết A', amount: 100 });
  const b = Store.create('commitments', { budgetLineId: 'bl1', title: 'Cam kết B', amount: 200 });
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.notEqual(a.item.idempotencyKey, b.item.idempotencyKey);
  assert.equal(Store.state.commitments.length, 2);
});

test('P2 [demo]: sửa cam kết không sinh actual, không đổi idempotency_key', () => {
  resetDemo();
  const c = Store.create('commitments', { budgetLineId: 'bl1', title: 'Đặt cọc', amount: 1000, status: 'committed' });
  assert.equal(c.ok, true);
  const keyBefore = c.item.idempotencyKey;
  const u = Store.update('commitments', c.item.id, { title: 'Đặt cọc (sửa)', amount: 1200, idempotencyKey: 'cmt-key-bi-ghi-de' });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.item.idempotencyKey, keyBefore, 'update không được đổi key của bản ghi đã có');
  assert.equal(Store.state.commitments.length, 1);
  assert.equal(Store.state.actuals.length, 0, 'sửa cam kết không được tự sinh payment/actual');
});

// ---------------------------------------------------------------------------
// Remote-contract mock — insert thành công gửi key; 409/23505 → dedup
// ---------------------------------------------------------------------------
test('P2 [remote]: insert commitments gửi idempotency_key xuống backend; 2 ý định khác nhau → 2 commitment', async () => {
  let seq = 0;
  const handler = (call) => {
    if (call.table === 'budget_commitments' && call.op === 'insert') {
      seq += 1;
      return { data: commitmentRowFromPayload(call.payload, 'cm-remote-' + seq), error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler);
  const a = await Store.create('commitments', { budgetLineId: 'bl1', title: 'Cam kết A', amount: 100, status: 'committed' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.ok(a.item.idempotencyKey, 'item đọc về phải mang idempotencyKey');
  const b = await Store.create('commitments', { budgetLineId: 'bl1', title: 'Cam kết B', amount: 200, status: 'committed' });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(Store.state.commitments.length, 2);
  const inserts = Store.supabaseClient.calls.filter((c) => c.table === 'budget_commitments' && c.op === 'insert');
  assert.equal(inserts.length, 2);
  assert.ok(inserts[0].payload.idempotency_key, 'payload insert phải có idempotency_key');
  assert.equal(inserts[0].payload.idempotency_key, a.item.idempotencyKey, 'key trên payload khớp key item giữ');
  assert.notEqual(inserts[0].payload.idempotency_key, inserts[1].payload.idempotency_key);
});

test('P2 [remote]: retry cùng ý định — backend 409/23505 → đọc lại theo key, state đúng 1 commitment, không lỗi giả', async () => {
  let existing = null;
  const handler = (call) => {
    if (call.table === 'budget_commitments' && call.op === 'insert') {
      if (!existing) {
        existing = commitmentRowFromPayload(call.payload, 'cm-remote-1');
        return { data: existing, error: null };
      }
      return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "budget_commitments_idempotency_uidx"' } };
    }
    if (call.table === 'budget_commitments' && call.op === 'select') {
      return { data: existing ? [existing] : [], error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler);
  const intent = { budgetLineId: 'bl1', title: 'Đặt cọc agency', amount: 1000, status: 'committed', idempotencyKey: 'cmt-retry-1' };
  const first = await Store.create('commitments', { ...intent });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(Store.state.commitments.length, 1);
  const retry = await Store.create('commitments', { ...intent });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.deduped, true, 'trùng key ở backend phải được coi là đã tạo thành công (deduped)');
  assert.equal(retry.item.id, first.item.id);
  assert.equal(Store.state.commitments.length, 1, 'retry không được nhân đôi commitment trong state');
  const sel = Store.supabaseClient.calls.find((c) => c.table === 'budget_commitments' && c.op === 'select');
  assert.ok(sel, 'sau 409/23505 phải truy lại bản ghi theo idempotency_key');
  assert.equal(sel.filters.idempotency_key, 'cmt-retry-1');
});

test('P2 [remote]: backend trả 409 (không phải 23505) cho commitments cũng dedup theo key', async () => {
  const existing = commitmentRowFromPayload(
    { budget_line_id: 'bl1', description: 'Đặt cọc', amount: 300, currency: 'VND', status: 'committed', idempotency_key: 'cmt-409-1' },
    'cm-409-1',
  );
  const handler = (call) => {
    if (call.table === 'budget_commitments' && call.op === 'insert') {
      return { data: null, error: { code: '409', message: 'duplicate key value violates unique constraint' } };
    }
    if (call.table === 'budget_commitments' && call.op === 'select') return { data: [existing], error: null };
    return { data: [], error: null };
  };
  setupRemote(handler);
  const r = await Store.create('commitments', { budgetLineId: 'bl1', title: 'Đặt cọc', amount: 300, status: 'committed', idempotencyKey: 'cmt-409-1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.deduped, true);
  assert.equal(r.item.id, 'cm-409-1');
  assert.equal(r.item.idempotencyKey, 'cmt-409-1');
  assert.equal(Store.state.commitments.length, 1);
});
