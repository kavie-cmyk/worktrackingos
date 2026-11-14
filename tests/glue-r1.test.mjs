// tests/glue-r1.test.mjs
// Regression tests vòng "nối keo" R1 — tầng kiểm ghi ở từng test:
//   [unit]           hàm thuần store-core / Store._actionFor
//   [store-contract] Store + adapter giả lập (fake Supabase client / fetch) —
//                    kiểm hợp đồng của store, KHÔNG phải kiểm live/RLS thật.
// Gồm: Store.inviteMember (demo / thiếu quyền / supabase qua fetch),
// collection comments (chuẩn hoá taskId ↔ entity), assetVersions +
// listMeasurements phơi cho UI, và ads submit split (R19/QA24 phía store).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
const Store = require('../js/store.js');

// ---------------------------------------------------------------------------
// Helpers (theo mẫu tests/r1-regressions.test.mjs)
// ---------------------------------------------------------------------------
function makeFakeClient(handler) {
  const calls = [];
  function from(table) {
    const b = {
      table, op: 'select', payload: null, single: false,
      insert(p) { this.op = 'insert'; this.payload = p; return this; },
      update(p) { this.op = 'update'; this.payload = p; return this; },
      delete() { this.op = 'delete'; return this; },
      upsert(p) { this.op = 'upsert'; this.payload = p; return this; },
      select() { return this; },
      eq() { return this; }, in() { return this; }, order() { return this; },
      limit() { return this; }, range() { return this; },
      then(onF, onR) {
        const call = { table: this.table, op: this.op, payload: this.payload, single: this.single };
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

const EMPTY_COLLECTIONS = () => Object.fromEntries(Store.COLLECTIONS.map((k) => [k, []]));

function setupDemo({ role = 'lead', state = {} } = {}) {
  Store.mode = 'demo';
  Store.supabaseClient = null;
  Store._membership = null;
  Store.workspaceId = null;
  Store.state = { ...EMPTY_COLLECTIONS(), ...state };
  Store.state.members = [
    { id: 'u-owner', role: 'owner', name: 'Owner' },
    { id: 'u-lead', role: 'lead', name: 'Lead' },
    { id: 'u-member', role: 'member', name: 'Member' },
    { id: 'u-ceo', role: 'ceo', name: 'CEO' },
  ];
  Store.currentUserId = 'u-' + role;
  Store._postMappings = [];
  Store.loadState = {};
  return Store;
}

function setupRemote(handler, { role = 'lead', state = {} } = {}) {
  Store.mode = 'supabase';
  Store.workspaceId = 'ws-1';
  Store._membership = { role };
  Store.currentUserId = 'u-' + role;
  Store.state = { ...EMPTY_COLLECTIONS(), ...state };
  Store.loadState = {};
  Store._postMappings = [];
  Store.supabaseClient = makeFakeClient(handler);
  return Store;
}

// ---------------------------------------------------------------------------
// 1. inviteMember — nhánh demo + thiếu quyền + supabase (fetch Edge Function)
// ---------------------------------------------------------------------------
test('invite [store-contract/demo]: Owner ở chế độ demo → lỗi rõ "không gửi được email mời thật" (đồng bộ, không giả vờ đã mời)', () => {
  setupDemo({ role: 'owner' });
  const r = Store.inviteMember({ email: 'new@sava.example', role: 'member' });
  assert.equal(typeof r.then, 'undefined', 'nhánh demo trả kết quả đồng bộ như các action demo khác');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Chế độ demo không gửi được email mời thật');
});

test('invite [store-contract]: thiếu quyền member.manage/settings.manage bị gate trước — member demo và lead supabase đều bị chặn, fetch không được gọi', async () => {
  setupDemo({ role: 'member' });
  const rd = Store.inviteMember({ email: 'new@sava.example', role: 'member' });
  assert.equal(rd.ok, false);
  assert.match(rd.error, /member\.manage/);

  let fetchCalls = 0;
  const prevFetch = globalThis.fetch;
  const prevConfig = globalThis.SAVA_CONFIG;
  globalThis.fetch = async () => { fetchCalls += 1; return { ok: true, status: 200, json: async () => ({}) }; };
  globalThis.SAVA_CONFIG = { supabaseUrl: 'https://proj.example.co', supabaseAnonKey: 'anon-key' };
  try {
    setupRemote(() => ({ data: [], error: null }), { role: 'lead' });
    Store.supabaseClient.auth = { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) };
    const rr = await Store.inviteMember({ email: 'new@sava.example', role: 'member' });
    assert.equal(rr.ok, false);
    assert.match(rr.error, /member\.manage/);
    assert.equal(fetchCalls, 0, 'bị gate thì không được gọi Edge Function');
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.SAVA_CONFIG = prevConfig;
  }
});

test('invite [store-contract/supabase]: Owner → POST functions/v1/invite-member với Bearer access_token + apikey + body {email, role, workspace_id}; trả {ok:true, userId}', async () => {
  const prevFetch = globalThis.fetch;
  const prevConfig = globalThis.SAVA_CONFIG;
  let seen = null;
  globalThis.fetch = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ({ user_id: 'u-new', email: 'new@sava.example', role: 'member', workspace_id: 'ws-1' }) };
  };
  globalThis.SAVA_CONFIG = { supabaseUrl: 'https://proj.example.co', supabaseAnonKey: 'anon-key' };
  try {
    setupRemote(() => ({ data: [], error: null }), { role: 'owner' });
    Store.supabaseClient.auth = { getSession: async () => ({ data: { session: { access_token: 'access-tok-1' } } }) };
    const r = await Store.inviteMember({ email: 'new@sava.example', role: 'member' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.userId, 'u-new');
    assert.equal(seen.url, 'https://proj.example.co/functions/v1/invite-member');
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers.Authorization, 'Bearer access-tok-1');
    assert.equal(seen.opts.headers.apikey, 'anon-key');
    assert.deepEqual(JSON.parse(seen.opts.body), { email: 'new@sava.example', role: 'member', workspace_id: 'ws-1' });
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.SAVA_CONFIG = prevConfig;
  }
});

test('invite [store-contract/supabase]: function trả 403 {error, message} → store trả {ok:false} với message thật từ body, không nuốt lỗi', async () => {
  const prevFetch = globalThis.fetch;
  const prevConfig = globalThis.SAVA_CONFIG;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'FORBIDDEN', message: 'Chỉ Owner của workspace mới mời được thành viên.' }) });
  globalThis.SAVA_CONFIG = { supabaseUrl: 'https://proj.example.co', supabaseAnonKey: 'anon-key' };
  try {
    setupRemote(() => ({ data: [], error: null }), { role: 'owner' });
    Store.supabaseClient.auth = { getSession: async () => ({ data: { session: { access_token: 'access-tok-1' } } }) };
    const r = await Store.inviteMember({ email: 'new@sava.example', role: 'lead' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'Chỉ Owner của workspace mới mời được thành viên.');
    assert.equal(r.code, 'FORBIDDEN');
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.SAVA_CONFIG = prevConfig;
  }
});

// ---------------------------------------------------------------------------
// 2. comments — mapping 2 chiều + chuẩn hoá taskId ↔ entity task
// ---------------------------------------------------------------------------
test('comments [unit]: core mapping comments ↔ bảng comments; payload không rò task_id/created_by', () => {
  assert.equal(core.COLLECTION_TO_TABLE.comments, 'comments');
  for (const col of ['entity_type', 'entity_id', 'parent_id', 'body', 'mentions', 'author_id', 'workspace_id']) {
    assert.ok(core.hasColumn('comments', col), `comments thiếu cột ${col}`);
  }
  const payload = core.toDbPayload('comments', {
    entityType: 'task', entityId: 't-1', parentId: null, body: 'Xin chào', mentions: [], authorId: 'u-1', taskId: 't-1', createdBy: 'u-1',
  }, { workspaceId: 'ws-1' });
  assert.equal(payload.entity_type, 'task');
  assert.equal(payload.entity_id, 't-1');
  assert.equal(payload.author_id, 'u-1');
  assert.equal(payload.body, 'Xin chào');
  assert.equal(payload.workspace_id, 'ws-1');
  assert.ok(!('task_id' in payload) && !('created_by' in payload), 'trường UI không phải cột thật không được gửi lên');
  const item = core.fromDbRow('comments', { id: 'c1', entity_type: 'task', entity_id: 't-1', body: 'A', author_id: 'u-1', mentions: [] });
  assert.equal(item.entityType, 'task');
  assert.equal(item.entityId, 't-1');
  assert.equal(item.authorId, 'u-1');
});

test('comments [store-contract/demo]: tạo bằng {taskId} (dạng UI) và bằng {entityType, entityId} đều chuẩn hoá về entity task + giữ taskId để panel lọc được', () => {
  setupDemo({ role: 'member' });
  const a = Store.create('comments', { taskId: 'task-a', body: 'Bình luận 1', authorId: 'u-member', createdBy: 'u-member', createdAt: '2026-11-11T10:00:00Z' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.item.entityType, 'task');
  assert.equal(a.item.entityId, 'task-a');
  assert.equal(a.item.taskId, 'task-a');
  const b = Store.create('comments', { entityType: 'task', entityId: 'task-b', body: 'Bình luận 2', mentions: [] });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.item.taskId, 'task-b', 'dạng entity phải suy ra taskId cho UI');
  assert.deepEqual(Store.list('comments').filter((c) => c.taskId === 'task-a').map((c) => c.body), ['Bình luận 1']);
  const noEntity = Store.create('comments', { body: 'Không gắn đối tượng' });
  assert.equal(noEntity.ok, false, 'bình luận không gắn đối tượng phải bị từ chối rõ');
  setupDemo({ role: 'ceo', state: { comments: Store.state.comments } });
  const ceo = Store.create('comments', { taskId: 'task-a', body: 'CEO không được bình luận kiểu ghi' });
  assert.equal(ceo.ok, false, 'CEO (chỉ đọc) tạo bình luận bị chặn ở tầng guard data.edit');
});

test('comments [store-contract/remote]: insert lên bảng comments với entity_type=task/entity_id/author_id; dòng trả về map ngược có taskId', async () => {
  const handler = (call) => {
    if (call.table === 'comments' && call.op === 'insert') {
      return { data: { id: 'cmt-1', workspace_id: 'ws-1', ...call.payload, created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z' }, error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler, { role: 'lead' });
  const r = await Store.create('comments', { taskId: '11111111-1111-1111-1111-111111111111', body: 'Đã rõ', authorId: 'u-lead' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ins = Store.supabaseClient.calls.find((c) => c.table === 'comments' && c.op === 'insert');
  assert.equal(ins.payload.entity_type, 'task');
  assert.equal(ins.payload.entity_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(ins.payload.author_id, 'u-lead');
  assert.equal(ins.payload.body, 'Đã rõ');
  assert.ok(!('task_id' in ins.payload));
  assert.equal(r.item.taskId, '11111111-1111-1111-1111-111111111111');
  assert.equal(Store.list('comments').length, 1);
});

// ---------------------------------------------------------------------------
// 3. assetVersions + listMeasurements phơi cho UI
// ---------------------------------------------------------------------------
test('assetVersions/measurements [unit+store-contract]: COLLECTIONS + mapping có mặt; _rowToItem cho version (Brand Hub) và value số (KPI)', () => {
  for (const coll of ['comments', 'assetVersions', 'measurements']) {
    assert.ok(Store.COLLECTIONS.includes(coll), `Store.COLLECTIONS thiếu ${coll}`);
  }
  assert.equal(core.COLLECTION_TO_TABLE.assetVersions, 'asset_versions');
  assert.equal(core.COLLECTION_TO_TABLE.measurements, 'measurements');
  setupDemo({});
  const v = Store._rowToItem('assetVersions', { id: 'av1', asset_id: 'a1', version_no: 3, external_url: 'https://x/y.png', change_note: 'Bản 3', created_by: 'u-lead', created_at: '2026-11-01T00:00:00Z' });
  assert.equal(v.assetId, 'a1');
  assert.equal(v.version, 3, 'UI Brand Hub đọc h.version');
  assert.equal(v.versionNo, 3);
  assert.equal(v.createdBy, 'u-lead');
  const back = core.toDbPayload('assetVersions', { assetId: 'a1', version: 4 });
  assert.equal(back.version_no, 4, 'version ở frontend phải ghi xuống version_no');
  const m = Store._rowToItem('measurements', { id: 'm1', kpi_id: 'k1', value: '42', measured_at: '2026-11-02T00:00:00Z', source: 'manual' });
  assert.equal(m.kpiId, 'k1');
  assert.equal(m.value, 42);
});

test('listMeasurements [store-contract/demo]: trả số đo của đúng KPI, measured_at giảm dần; KPI khác không lẫn', () => {
  setupDemo({ state: { measurements: [
    { id: 'm1', kpiId: 'kpi-1', value: 10, measuredAt: '2026-11-01T09:00:00Z', source: 'manual' },
    { id: 'm2', kpiId: 'kpi-1', value: 30, measuredAt: '2026-11-03T09:00:00Z', source: 'manual' },
    { id: 'm3', kpiId: 'kpi-1', value: 20, measuredAt: '2026-11-02T09:00:00Z', source: 'manual' },
    { id: 'm4', kpiId: 'kpi-2', value: 99, measuredAt: '2026-11-04T09:00:00Z', source: 'manual' },
  ] } });
  const rows = Store.listMeasurements('kpi-1');
  assert.ok(Array.isArray(rows), 'demo / đã có dữ liệu trong state → trả mảng đồng bộ');
  assert.deepEqual(rows.map((x) => x.id), ['m2', 'm3', 'm1']);
  assert.deepEqual(Store.listMeasurements('kpi-khong-co'), []);
});

test('listMeasurements [store-contract/remote]: chưa có trong state → truy vấn bổ sung bảng measurements, gộp vào state, trả giảm dần', async () => {
  const handler = (call) => {
    if (call.table === 'measurements' && call.op === 'select') {
      return { data: [
        { id: 'm1', workspace_id: 'ws-1', kpi_id: 'kpi-1', value: 5, measured_at: '2026-11-01T09:00:00Z', source: 'manual', created_at: '2026-11-01T09:00:00Z' },
        { id: 'm2', workspace_id: 'ws-1', kpi_id: 'kpi-1', value: 7, measured_at: '2026-11-05T09:00:00Z', source: 'manual', created_at: '2026-11-05T09:00:00Z' },
      ], error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler);
  const rows = await Store.listMeasurements('kpi-1');
  assert.deepEqual(rows.map((x) => x.id), ['m2', 'm1']);
  assert.equal(Store.state.measurements.length, 2, 'kết quả truy vấn bổ sung phải gộp vào state');
  const again = Store.listMeasurements('kpi-1');
  assert.ok(Array.isArray(again), 'đã có trong state thì trả mảng đồng bộ, không truy vấn lại');
});

// ---------------------------------------------------------------------------
// 4. Ads submit split (R19/QA24 phía store)
// ---------------------------------------------------------------------------
test('ads-split [unit]: _actionFor — draft→pending_approval = ads.draft; chuyển status khác = ads.approve; không có status giữ ads.draft', () => {
  assert.equal(Store._actionFor('adChangeRequests', { status: 'pending_approval' }, 'update', { status: 'draft' }), 'ads.draft');
  assert.equal(Store._actionFor('adChangeRequests', { status: 'pending_approval', statusLabel: 'Chờ duyệt', title: 'X', target: 'T' }, 'update', { status: 'draft' }), 'ads.draft', 'patch submit của app kèm field sao y bản hiện tại vẫn là submit');
  assert.equal(Store._actionFor('adChangeRequests', { status: 'approved' }, 'update', { status: 'pending_approval' }), 'ads.approve');
  assert.equal(Store._actionFor('adChangeRequests', { status: 'rejected' }, 'update', { status: 'pending_approval' }), 'ads.approve');
  assert.equal(Store._actionFor('adChangeRequests', { status: 'pending_approval' }, 'update', { status: 'rejected' }), 'ads.approve', 'gửi lại từ trạng thái khác draft không phải submit chuẩn');
  assert.equal(Store._actionFor('adChangeRequests', { title: 'Sửa nháp' }, 'update', { status: 'draft' }), 'ads.draft', 'patch không có status giữ hành vi cũ');
  assert.equal(Store._actionFor('adChangeRequests', { status: 'draft' }, 'create', null), 'ads.draft');
});

test('ads-split [store-contract/demo]: member (chỉ ads.draft) submit draft→pending_approval được ở tầng guard; approve bị chặn, trạng thái không đổi', () => {
  setupDemo({ role: 'member', state: { adChangeRequests: [{ id: 'adcr-1', title: 'Tăng ngân sách', target: 'Nhóm A', status: 'draft', statusLabel: 'Nháp' }] } });
  assert.equal(Store.can('ads.draft'), true);
  assert.equal(Store.can('ads.approve'), false);
  // Patch đúng như app.js adcr-submit: status + statusLabel + title/target sao y.
  const submit = Store.update('adChangeRequests', 'adcr-1', { status: 'pending_approval', statusLabel: 'Chờ duyệt', title: 'Tăng ngân sách', target: 'Nhóm A' });
  assert.equal(submit.ok, true, JSON.stringify(submit));
  assert.equal(Store.get('adChangeRequests', 'adcr-1').status, 'pending_approval');
  // Quay về draft rồi thử approve như member → bị chặn ở guard.
  Store.state.adChangeRequests[0].status = 'draft';
  const approve = Store.update('adChangeRequests', 'adcr-1', { status: 'approved', statusLabel: 'Đã duyệt' });
  assert.equal(approve.ok, false);
  assert.match(approve.error, /ads\.approve/);
  assert.equal(Store.get('adChangeRequests', 'adcr-1').status, 'draft', 'approve bị chặn thì trạng thái không được đổi');
  // Sửa nháp không đổi status: member vẫn làm được (hành vi cũ giữ nguyên).
  const edit = Store.update('adChangeRequests', 'adcr-1', { title: 'Tăng ngân sách (bản sửa)' });
  assert.equal(edit.ok, true, JSON.stringify(edit));
});
