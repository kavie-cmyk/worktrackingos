// tests/r1-regressions.test.mjs
// Regression tests vòng sửa QA R1 — tầng kiểm ghi ở từng test:
//   [unit]          hàm thuần domain/store-core
//   [store-contract] Store + adapter giả lập (fake Supabase client) — kiểm
//                    hợp đồng gọi REST/RPC của store, KHÔNG phải kiểm UI
//                    và KHÔNG phải kiểm RLS thật trên server (xem báo cáo).
// QA10 ở đây là tầng store: adapter giả trả resolved {error} thì store
// phải trả ok:false — khác với QA10 tầng UI (thao tác thật trên app).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
const domain = require('../js/domain.js');
const Store = require('../js/store.js');

// ---------------------------------------------------------------------------
// Fake Supabase client: builder thenable ghi lại (table, op, payload).
// handler(call) -> { data, error } (resolved, giống supabase-js).
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
      singleFn() { return this; },
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
// QA13-demo [store-contract] — CEO demo KHÔNG sửa được task (R32)
// ---------------------------------------------------------------------------
test('QA13-demo [store-contract]: CEO demo đổi status task bị chặn ở tầng lệnh, dữ liệu không đổi', () => {
  setupDemo({ role: 'ceo', state: { tasks: [{ id: 'task-c', title: 'KV', status: 'in_progress' }] } });
  const r = Store.update('tasks', 'task-c', { status: 'completed' });
  assert.equal(r.ok, false);
  assert.match(r.error, /task\.updateStatus/);
  assert.equal(Store.get('tasks', 'task-c').status, 'in_progress');
  const c = Store.create('tasks', { title: 'Việc mới' });
  assert.equal(c.ok, false, 'CEO demo tạo task cũng bị chặn');
});

test('R32 [unit]: PERMISSIONS matrix dùng chung — member không approval.decide/budget.edit, ceo chỉ đọc', () => {
  assert.equal(core.canRole('ceo', 'task.updateStatus'), false);
  assert.equal(core.canRole('ceo', 'data.read'), true);
  assert.equal(core.canRole('ceo', 'approval.decide'), false);
  assert.equal(core.canRole('member', 'approval.decide'), false);
  assert.equal(core.canRole('member', 'budget.edit'), false);
  assert.equal(core.canRole('member', 'task.updateStatus'), true);
  assert.equal(core.canRole('lead', 'approval.decide'), true);
  assert.equal(core.canRole('owner', 'settings.manage'), true);
  assert.equal(core.canRole('lead', 'settings.manage'), false);
  // legacy names resolve cùng matrix
  assert.equal(core.canRole('ceo', 'edit'), false);
  assert.equal(core.canRole('member', 'approve'), false);
});

// ---------------------------------------------------------------------------
// QA06 [unit + store-contract] — date range / parent cycle / dependency cycle
// ---------------------------------------------------------------------------
test('QA06 [unit]: validateDateRange + todayISO theo Asia/Ho_Chi_Minh (không UTC)', () => {
  assert.equal(core.validateDateRange('2026-11-10', '2026-11-01').ok, false);
  assert.equal(core.validateDateRange('2026-11-01', '2026-11-10').ok, true);
  assert.equal(core.validateDateRange('2026-11-10', '2026-11-10').ok, true);
  // 17:30 UTC = 00:30 hôm sau ở ICT
  assert.equal(core.todayISO('Asia/Ho_Chi_Minh', new Date('2026-11-11T17:30:00Z')), '2026-11-12');
  const m = core.currentMonthRange('Asia/Ho_Chi_Minh', new Date('2026-11-11T17:30:00Z'));
  assert.deepEqual([m.year, m.month, m.start, m.end], [2026, 11, '2026-11-01', '2026-11-30']);
});

test('QA06 [store-contract]: demo — tạo campaign start>end bị từ chối; gán parent tạo vòng bị từ chối', () => {
  setupDemo({ state: { tasks: [
    { id: 'A', title: 'A', parentId: 'B', status: 'todo' },
    { id: 'B', title: 'B', parentId: null, status: 'todo' },
  ] } });
  const bad = Store.create('campaigns', { name: 'X', startDate: '2026-11-20', endDate: '2026-11-01' });
  assert.equal(bad.ok, false);
  assert.equal(Store.list('campaigns').length, 0);
  const cyc = Store.update('tasks', 'B', { parentId: 'A' }); // B là parent của A → vòng
  assert.equal(cyc.ok, false);
  assert.equal(Store.get('tasks', 'B').parentId, null);
  assert.equal(core.wouldCreateParentCycle([{ id: 'A', parentId: 'B' }, { id: 'B', parentId: null }], 'B', 'A'), true);
  assert.equal(core.wouldCreateParentCycle([{ id: 'A', parentId: null }], 'A', 'B'), false);
});

// ---------------------------------------------------------------------------
// QA05 [store-contract] — custom_fields merge, patch 1 field không mất field khác
// ---------------------------------------------------------------------------
test('QA05 [store-contract/demo]: patch deliverable không làm mất custom field khác; __UNSET__ xoá đúng field', () => {
  setupDemo({ state: { tasks: [{ id: 't1', title: 'A', customFields: { deliverable: 'bản cũ', other: 'giữ nguyên' }, deliverable: 'bản cũ', other: 'giữ nguyên' }] } });
  const r = Store.update('tasks', 't1', { deliverable: 'bản mới' });
  assert.equal(r.ok, true);
  assert.equal(r.item.customFields.deliverable, 'bản mới');
  assert.equal(r.item.customFields.other, 'giữ nguyên', 'field custom khác không được mất');
  const u = Store.update('tasks', 't1', { customFields: { other: '__UNSET__' } });
  assert.equal(u.ok, true);
  assert.ok(!('other' in u.item.customFields), '__UNSET__ phải xoá field khỏi custom_fields');
  assert.equal(u.item.customFields.deliverable, 'bản mới');
});

test('QA05 [store-contract/remote]: update đọc-trước-ghi custom_fields từ server rồi merge', async () => {
  const handler = (call) => {
    if (call.table === 'tasks' && call.op === 'select') {
      return { data: [{ custom_fields: { deliverable: 'bản cũ', keep: 'yes', server_only: 's1' } }], error: null };
    }
    if (call.table === 'tasks' && call.op === 'update') {
      return { data: [{ id: 't1', title: 'A', custom_fields: call.payload.custom_fields, updated_at: '2026-11-03T00:00:00Z' }], error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { tasks: [{ id: 't1', title: 'A', customFields: { deliverable: 'bản cũ' }, updatedAt: '2026-11-01T00:00:00Z' }] } });
  const r = await Store.update('tasks', 't1', { deliverable: 'bản mới' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const upd = Store.supabaseClient.calls.find((c) => c.table === 'tasks' && c.op === 'update');
  assert.deepEqual(upd.payload.custom_fields, { deliverable: 'bản mới', keep: 'yes', server_only: 's1' });
});

// ---------------------------------------------------------------------------
// QA10 [store-contract] — failure injection: {error} resolved → ok:false
// ---------------------------------------------------------------------------
test('QA10 [store-contract]: insert measurement/KPI trả {error:42501} → store trả ok:false, state không có dữ liệu giả', async () => {
  const handler = () => ({ data: null, error: { code: '42501', message: 'permission denied for table kpis (row-level security)' } });
  setupRemote(handler);
  const r = await Store._createRemote('kpis', { name: 'Leads', target: 100, actual: 5 });
  assert.equal(r.ok, false);
  assert.ok(r.failedStep, 'phải có failedStep');
  assert.equal(Store.list('kpis').length, 0, 'state không được chứa KPI chưa lưu được');
});

test('QA10 [store-contract]: bước chính xong nhưng bước phụ (measurements) lỗi → partial:true + failedStep, không ok giả', async () => {
  const handler = (call) => {
    if (call.table === 'kpis' && call.op === 'insert') {
      return { data: { id: '11111111-1111-1111-1111-111111111111', workspace_id: 'ws-1', name: 'Leads', target_value: 100 }, error: null };
    }
    if (call.table === 'measurements') return { data: null, error: { code: '42501', message: 'permission denied' } };
    return { data: [], error: null };
  };
  setupRemote(handler);
  const r = await Store._createRemote('kpis', { name: 'Leads', target: 100, actual: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.partial, true);
  assert.equal(r.failedStep, 'measurements.insert');
  assert.ok(r.item, 'partial outcome vẫn trả item của bước chính để UI đối soát');
});

test('QA11 [store-contract]: load 403 → loadState denied; refresh lỗi khi có dữ liệu cũ → stale + giữ dữ liệu', async () => {
  const handler = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
  setupRemote(handler);
  await Store._loadCollection('tasks');
  assert.equal(Store.getLoadState('tasks').status, 'denied');
  Store.state.tasks = [{ id: 'old-1', title: 'Dữ liệu cũ' }];
  await Store._loadCollection('tasks');
  assert.equal(Store.getLoadState('tasks').status, 'stale');
  assert.equal(Store.list('tasks').length, 1, 'dữ liệu cũ phải được giữ, không biến thành list trống');
  assert.ok(Store.getLoadState('tasks').error);
});

test('R15 [store-contract]: gắn campaign cho post CHỈ qua post_content_mappings — không update external_posts', async () => {
  const handler = (call) => {
    if (call.table === 'post_content_mappings' && call.op === 'delete') return { data: [], error: null };
    if (call.table === 'post_content_mappings' && call.op === 'insert') return { data: { id: 'm1', external_post_id: 'p1', campaign_id: 'c9' }, error: null };
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { externalPosts: [{ id: 'p1', platform: 'facebook', title: 'Bài' }] } });
  const r = await Store.update('externalPosts', 'p1', { campaignId: 'c9' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(Store.get('externalPosts', 'p1').campaignId, 'c9');
  const postWrites = Store.supabaseClient.calls.filter((c) => c.table === 'external_posts' && (c.op === 'update' || c.op === 'insert'));
  assert.equal(postWrites.length, 0, 'không được ghi lên external_posts khi chỉ gắn campaign');
  // Bỏ gắn: campaignId=null → xoá mapping, không insert
  Store.supabaseClient.calls.length = 0;
  const r2 = await Store.update('externalPosts', 'p1', { campaignId: null });
  assert.equal(r2.ok, true);
  assert.equal(Store.get('externalPosts', 'p1').campaignId, null);
  assert.ok(Store.supabaseClient.calls.some((c) => c.table === 'post_content_mappings' && c.op === 'delete'));
  assert.ok(!Store.supabaseClient.calls.some((c) => c.table === 'post_content_mappings' && c.op === 'insert'));
});

// ---------------------------------------------------------------------------
// QA09 [store-contract/demo] — TikTok: metric đúng video (R16)
// ---------------------------------------------------------------------------
test('QA09 [store-contract]: saveTiktokMetrics của video B gắn post B (không rơi vào A); chưa có post → content_variant', () => {
  setupDemo({ state: {
    contentItems: [{ id: 'ci-A', title: 'A' }, { id: 'ci-B', title: 'B' }, { id: 'ci-C', title: 'C' }],
    variants: [
      { id: 'var-A', contentItemId: 'ci-A', platform: 'tiktok' },
      { id: 'var-B', contentItemId: 'ci-B', platform: 'tiktok' },
      { id: 'var-C', contentItemId: 'ci-C', platform: 'tiktok' },
    ],
    externalPosts: [
      { id: 'post-A', platform: 'tiktok', variantId: 'var-A', contentItemId: 'ci-A' },
      { id: 'post-B', platform: 'tiktok', variantId: 'var-B', contentItemId: 'ci-B' },
    ],
    metricObservations: [],
  } });
  Store._postMappings = [
    { external_post_id: 'post-A', variant_id: 'var-A', content_item_id: 'ci-A' },
    { external_post_id: 'post-B', variant_id: 'var-B', content_item_id: 'ci-B' },
  ];
  const r = Store.saveTiktokMetrics('var-B', { views: 999 });
  assert.equal(r.ok, true);
  assert.equal(r.target.objectType, 'external_post');
  assert.equal(r.target.objectId, 'post-B');
  assert.ok(r.items.every((i) => i.objectId === 'post-B' && i.objectType === 'external_post'));
  assert.ok(!Store.state.metricObservations.some((o) => o.objectId === 'post-A'), 'metric của B không được rơi vào A');
  const r2 = Store.saveTiktokMetrics('var-C', { views: 12 });
  assert.equal(r2.target.objectType, 'content_variant', 'chưa có post → observation nội bộ theo variant');
  assert.equal(r2.target.objectId, 'var-C');
  assert.ok(r2.items.every((i) => i.objectType !== 'channel_account'), 'không dùng channel_account + variant id nữa');
});

// ---------------------------------------------------------------------------
// R17 [store-contract] — assets: approval_status tách status, version thật
// ---------------------------------------------------------------------------
test('R17 [store-contract]: _rowToItem assets — active không còn thành Approved, approval_status đọc riêng, version không hardcode 1', () => {
  setupDemo({});
  const item = Store._rowToItem('brandAssets', { id: 'a1', asset_type: 'image', status: 'active', approval_status: 'in_review' });
  assert.equal(item.status, 'active');
  assert.equal(item.approvalStatus, 'in_review');
  assert.equal(item.version, null, 'chưa merge asset_versions thì version = null, không bịa 1');
  Store._assetVersionById = { a1: 4 };
  const item2 = Store._rowToItem('brandAssets', { id: 'a1', asset_type: 'image', status: 'archived', approval_status: 'approved' });
  assert.equal(item2.version, 4, 'version = max(asset_versions.version_no)');
  assert.equal(item2.status, 'archived');
  Store._assetVersionById = null;
});

test('R17 [store-contract/remote]: tạo asset → insert asset_versions v1; sửa nội dung → version mới', async () => {
  const handler = (call) => {
    if (call.table === 'assets' && call.op === 'insert') return { data: { id: 'a9', asset_type: 'image', status: 'active', approval_status: 'draft', name: 'KV' }, error: null };
    if (call.table === 'asset_versions' && call.op === 'insert') return { data: [{ id: 'av1' }], error: null };
    if (call.table === 'assets' && call.op === 'update') return { data: [{ id: 'a9', asset_type: 'image', status: 'active', approval_status: 'draft', name: 'KV', external_url: 'https://x/y.png', updated_at: '2026-11-03T00:00:00Z' }], error: null };
    return { data: [], error: null };
  };
  setupRemote(handler);
  const c = await Store._createRemote('brandAssets', { name: 'KV', type: 'image' });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.item.version, 1);
  const vIns = Store.supabaseClient.calls.find((x) => x.table === 'asset_versions' && x.op === 'insert');
  assert.equal(vIns.payload.version_no, 1);
  Store.state.brandAssets = [{ id: 'a9', name: 'KV', version: 1, updatedAt: '2026-11-01T00:00:00Z' }];
  const u = await Store.update('brandAssets', 'a9', { externalUrl: 'https://x/y.png' });
  assert.equal(u.ok, true, JSON.stringify(u));
  const vIns2 = Store.supabaseClient.calls.filter((x) => x.table === 'asset_versions' && x.op === 'insert').pop();
  assert.equal(vIns2.payload.version_no, 2, 'sửa nội dung phải thêm version 2, không ghi đè');
});

// ---------------------------------------------------------------------------
// QA24 [store-contract] — ad change request partial update (R19)
// ---------------------------------------------------------------------------
test('QA24 [store-contract]: status-only patch không đụng after_state/before_state; sửa proposal phải explicit', () => {
  const current = { afterState: { title: 'Đề xuất cũ', target: 'T1', budget: 5 }, beforeState: { budget: 3 } };
  const statusOnly = Store._toPayload('adChangeRequests', { status: 'approved' }, { currentItem: current });
  assert.deepEqual(statusOnly, { status: 'approved' });
  const explicit = Store._toPayload('adChangeRequests', { _explicitProposal: true, title: 'Đề xuất mới' }, { currentItem: current });
  assert.deepEqual(explicit.after_state, { title: 'Đề xuất mới', target: 'T1', budget: 5 }, 'explicit sửa proposal: field không sửa giữ nguyên từ after_state cũ');
  const ins = Store._toPayload('adChangeRequests', { status: 'draft', title: 'X', target: 'T2' }, { forInsert: true });
  assert.deepEqual(ins.after_state, { title: 'X', target: 'T2' }, 'insert mới được dựng after_state (DB bắt buộc)');
});

// ---------------------------------------------------------------------------
// QA12/R27 [store-contract] — revision mới + RPC decide_approval/submit_for_review
// ---------------------------------------------------------------------------
test('QA12 [store-contract/remote]: sửa caption → insert content_revisions MỚI rồi update current_revision_id; không update revision cũ', async () => {
  const handler = (call) => {
    if (call.table === 'content_revisions' && call.op === 'insert') return { data: { id: 'rev-2', revision_no: 2, variant_id: 'v1' }, error: null };
    if (call.table === 'content_variants' && call.op === 'update') return { data: [{ id: 'v1', platform: 'facebook_page', caption: 'Caption mới', current_revision_id: 'rev-2', approval_status: 'needs_review', editorial_status: 'ready_for_review', updated_at: '2026-11-03T00:00:00Z' }], error: null };
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { variants: [{ id: 'v1', platform: 'facebook', caption: 'Caption cũ', approvalStatus: 'approved', revision: 1, currentRevisionId: 'rev-1', updatedAt: '2026-11-01T00:00:00Z' }] } });
  const r = await Store.updateVariant('v1', { caption: 'Caption mới' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const calls = Store.supabaseClient.calls;
  const revInsertIdx = calls.findIndex((c) => c.table === 'content_revisions' && c.op === 'insert');
  const varUpdateIdx = calls.findIndex((c) => c.table === 'content_variants' && c.op === 'update');
  assert.ok(revInsertIdx !== -1 && varUpdateIdx !== -1 && revInsertIdx < varUpdateIdx, 'revision mới phải tạo TRƯỚC khi update variant');
  assert.equal(calls[varUpdateIdx].payload.current_revision_id, 'rev-2');
  assert.equal(calls[varUpdateIdx].payload.caption, 'Caption mới');
  assert.ok(!calls.some((c) => c.table === 'content_revisions' && c.op === 'update'), 'revision cũ là bất biến — không update đè');
});

test('QA12 [store-contract/remote]: decide gọi RPC decide_approval với revisionId TỪ STATE; mismatch → lỗi "nội dung đã thay đổi, cần tải lại"', async () => {
  let rpcBehavior = { data: { id: 'dec-1', decision: 'approved' }, error: null };
  const handler = (call) => {
    if (call.rpc) return rpcBehavior;
    return { data: [], error: null };
  };
  setupRemote(handler, { state: {
    approvals: [{ id: 'step-1', _kind: 'step', variantId: 'v1', revisionId: 'rev-2', status: 'pending' }],
    variants: [{ id: 'v1', currentRevisionId: 'rev-2', approvalStatus: 'pending' }],
  } });
  const ok = await Store.decideApproval('step-1', 'approved', 'Đẹp'); // wrapper: revisionId lấy từ state đang hiển thị
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const rpcCall = Store.supabaseClient.calls.find((c) => c.rpc === 'decide_approval');
  assert.deepEqual(rpcCall.args, { p_step_id: 'step-1', p_revision_id: 'rev-2', p_decision: 'approved', p_comment: 'Đẹp' });
  rpcBehavior = { data: null, error: { code: '23514', message: 'REVISION_MISMATCH: revision không phải revision hiện hành' } };
  const bad = await Store.decide('step-1', 'rev-2', 'approved', '');
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'revision_mismatch');
  assert.match(bad.error, /nội dung đã thay đổi, cần tải lại/i);
  const missing = await Store.decide('step-1', null, 'approved', '');
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'revision_required', 'decide thiếu revisionId bị từ chối — không tự lấy latest');
});

test('R27 [store-contract/remote]: submitReview gọi RPC submit_for_review(p_variant_id)', async () => {
  const handler = (call) => {
    if (call.rpc === 'submit_for_review') return { data: { id: 'step-9', status: 'pending' }, error: null };
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { variants: [{ id: 'v1', currentRevisionId: 'rev-1', approvalStatus: 'draft' }] } });
  const r = await Store.submitReview('v1');
  assert.equal(r.ok, true, JSON.stringify(r));
  const rpcCall = Store.supabaseClient.calls.find((c) => c.rpc === 'submit_for_review');
  assert.deepEqual(rpcCall.args, { p_variant_id: 'v1' });
});

// ---------------------------------------------------------------------------
// QA15/R28 [store-contract] — publish job contract
// ---------------------------------------------------------------------------
test('QA15 [store-contract/remote]: job có decision_id + revision + hash; đăng ngay set scheduled_at=now; double-click cùng key', async () => {
  const handler = (call) => {
    if (call.table === 'publish_jobs' && call.op === 'insert') {
      return { data: { id: 'job-1', variant_id: 'v1', revision_id: call.payload.revision_id, decision_id: call.payload.decision_id, idempotency_key: call.payload.idempotency_key, scheduled_at: call.payload.scheduled_at, status: 'queued' }, error: null };
    }
    return { data: [], error: null };
  };
  const variant = { id: 'v1', platform: 'facebook', approvalStatus: 'approved', publishMode: 'app', channelAccountId: 'acc-1', approvedRevisionId: 'rev-2', currentRevisionId: 'rev-2', caption: 'Xin chào', mediaAssetIds: [] };
  setupRemote(handler, { state: { variants: [variant] } });
  const noDecision = await Store.createPublishJob('v1', { accountId: 'acc-1', scheduledAt: '2026-11-12T09:00:00Z' });
  assert.equal(noDecision.ok, false);
  assert.equal(noDecision.code, 'decision_required');
  assert.ok(!Store.supabaseClient.calls.some((c) => c.table === 'publish_jobs'), 'thiếu decisionId thì không được insert job');
  const a = await Store.createPublishJob('v1', { accountId: 'acc-1', scheduledAt: '2026-11-12T09:00:30Z', decisionId: 'dec-1' });
  const b = await Store.createPublishJob('v1', { accountId: 'acc-1', scheduledAt: '2026-11-12T09:00:45Z', decisionId: 'dec-1' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, true);
  const inserts = Store.supabaseClient.calls.filter((c) => c.table === 'publish_jobs' && c.op === 'insert');
  assert.equal(inserts[0].payload.idempotency_key, inserts[1].payload.idempotency_key, 'cùng intent trong cùng phút → cùng idempotency_key');
  assert.equal(inserts[0].payload.decision_id, 'dec-1');
  assert.equal(inserts[0].payload.snapshot.approval.decision_id, 'dec-1');
  assert.equal(inserts[0].payload.snapshot.approval.revision_id, 'rev-2');
  assert.ok(inserts[0].payload.snapshot.approval.approved_hash, 'snapshot phải có approved hash');
  const immediate = Store.buildPublishJobPayload(variant, { accountId: 'acc-1', decisionId: 'dec-1', revisionId: 'rev-2', scheduledAt: null });
  assert.ok(immediate.scheduled_at && !isNaN(Date.parse(immediate.scheduled_at)), 'đăng ngay → scheduled_at = now, không null');
});

// ---------------------------------------------------------------------------
// QA19 [unit] — lifetime theo object (R23)
// ---------------------------------------------------------------------------
test('QA19 [unit]: lifetimeLatestByObject — A:100→150, B:200→250; tổng latest = 400, không cộng snapshot', () => {
  const obs = [
    { objectType: 'external_post', objectId: 'A', metric: 'lifetime_views', scope: 'lifetime', value: 100, observedAt: '2026-11-01T00:00:00Z' },
    { objectType: 'external_post', objectId: 'B', metric: 'lifetime_views', scope: 'lifetime', value: 200, observedAt: '2026-11-01T00:00:00Z' },
    { objectType: 'external_post', objectId: 'A', metric: 'lifetime_views', scope: 'lifetime', value: 150, observedAt: '2026-11-03T00:00:00Z' },
    { objectType: 'external_post', objectId: 'B', metric: 'lifetime_views', scope: 'lifetime', value: 250, observedAt: '2026-11-02T00:00:00Z' },
  ];
  const latest = domain.lifetimeLatestByObject(obs);
  assert.equal(latest.length, 2, 'mỗi object chỉ còn 1 bản latest');
  const byId = Object.fromEntries(latest.map((e) => [e.objectId, e.value]));
  assert.deepEqual(byId, { A: 150, B: 250 });
  assert.equal(domain.sumLifetimeLatest(obs, { metric: 'lifetime_views' }), 400);
  assert.notEqual(domain.sumLifetimeLatest(obs, { metric: 'lifetime_views' }), 700, 'không cộng mọi snapshot');
});

// ---------------------------------------------------------------------------
// QA20 [unit] — thiếu dữ liệu → null; CSV giữ ô trống + cột trạng thái thiếu (R22)
// ---------------------------------------------------------------------------
test('QA20 [unit]: aggregateRates với conversionValue=null → ROAS null (không 0); spend/impressions thiếu → null', () => {
  const r = domain.aggregateRates([{ spend: 100, impressions: 1000, clicks: 50, results: 10, conversionValue: null }]);
  assert.equal(r.roas, null);
  assert.equal(r.totals.conversionValue, null);
  assert.equal(r.ctr, 50 / 1000, 'tỷ lệ khác vẫn tính được từ tổng tử/mẫu');
  const empty = domain.aggregateRates([]);
  assert.equal(empty.roas, null);
  assert.equal(empty.ctr, null);
});

test('QA20 [unit]: buildCsv — null thành ô trống (không ||0) và có cột missing_status', () => {
  const csv = domain.buildCsv(
    [{ name: 'A', spend: 100, conversionValue: null }, { name: 'B', spend: 0, conversionValue: 50 }],
    [{ key: 'name', label: 'Tên' }, { key: 'spend', label: 'Chi tiêu' }, { key: 'conversionValue', label: 'Giá trị chuyển đổi' }],
  );
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Tên,Chi tiêu,Giá trị chuyển đổi,missing_status');
  assert.equal(lines[1], 'A,100,,Thiếu: Giá trị chuyển đổi');
  assert.equal(lines[2], 'B,0,50,đầy đủ', '0 thật vẫn là 0, không bị coi là thiếu');
});

// ---------------------------------------------------------------------------
// QA22 [unit] — workload theo tuần, chỉ leaf, capacity/nghỉ từ tham số (R25)
// ---------------------------------------------------------------------------
test('QA22 [unit]: task 3 tuần chia đều từng tuần; parent bị loại; capacity + ngày nghỉ lấy từ cấu hình', () => {
  const tasks = [
    { id: 'P', title: 'Cha', assigneeId: 'm1', effortHours: 999, startDate: '2026-11-02', dueDate: '2026-11-20', status: 'in_progress' },
    { id: 'L1', title: 'Lá 3 tuần', parentId: 'P', assigneeId: 'm1', effortHours: 30, startDate: '2026-11-02', dueDate: '2026-11-20', status: 'in_progress' },
    { id: 'L2', title: 'Lá 1 tuần có ngày nghỉ riêng', assigneeId: 'm2', effortHours: 8, startDate: '2026-11-02', dueDate: '2026-11-06', status: 'todo' },
  ];
  const cfg = { capacityByMember: { m1: { hoursPerWeek: 40, daysOff: [] }, m2: { hoursPerWeek: 32, daysOff: ['2026-11-04'] } } };
  for (const weekStart of ['2026-11-02', '2026-11-09', '2026-11-16']) {
    const w = domain.weeklyWorkload(tasks, { weekStart, ...cfg });
    const m1 = w.find((x) => x.memberId === 'm1');
    assert.equal(m1.hours, 10, `tuần ${weekStart}: L1 30h/15 ngày làm việc = 2h/ngày × 5 = 10h (không dồn 30h, không tính cha 999h)`);
    assert.equal(m1.capacityHours, 40);
    assert.ok(!m1.taskIds.includes('P'));
  }
  const w1 = domain.weeklyWorkload(tasks, { weekStart: '2026-11-02', ...cfg });
  const m2 = w1.find((x) => x.memberId === 'm2');
  assert.equal(m2.hours, 8, 'L2: 8h chia cho 4 ngày làm việc còn lại (trừ ngày nghỉ riêng 04/11) — vẫn đủ 8h trong tuần');
  assert.equal(m2.capacityHours, 32, 'capacity lấy từ cấu hình thành viên, không hardcode 40');
  const noCfg = domain.weeklyWorkload(tasks, { weekStart: '2026-11-02' });
  assert.equal(noCfg.find((x) => x.memberId === 'm1').capacityHours, null, 'không có cấu hình → capacity null, không bịa 40h');
});

// ---------------------------------------------------------------------------
// QA23 [unit] — budget semantic chốt, fixture DÙNG CHUNG với docs/METRICS.md
// ---------------------------------------------------------------------------
test('QA23 [unit]: budgetRemaining — fixture chung METRICS.md: approved 1.000.000 → remaining 200.000', () => {
  const line = { approved: 1000000 };
  const commitments = [
    { id: 'C-open', amount: 250000, status: 'committed', settledAmount: 0 },
    { id: 'C-partial', amount: 300000, status: 'partially_actualised', settledAmount: 200000 },
    { id: 'C-settled', amount: 150000, status: 'settled', settledAmount: 150000 },
    { id: 'C-cancelled', amount: 80000, status: 'cancelled', settledAmount: 0 },
  ];
  const actuals = [
    { amount: 200000, commitmentId: 'C-partial' },
    { amount: 150000, commitmentId: 'C-settled' },
    { amount: 100000, commitmentId: null },
  ];
  // remaining = 1.000.000 − Σactuals 450.000 − [(250.000−0) + (300.000−200.000)] = 200.000
  assert.equal(domain.budgetRemaining(line, commitments, actuals), 200000);
  // settled không có actual đi kèm cũng không bị trừ phần chưa settle (khớp SQL 0005)
  assert.equal(domain.budgetRemaining({ approved: 100 }, [{ id: 'X', amount: 60, status: 'settled', settledAmount: 60 }], []), 100);
});

// ---------------------------------------------------------------------------
// R24 [unit] — ads insights theo đúng cấp + tài khoản
// ---------------------------------------------------------------------------
test('R24 [unit]: filterInsightsByLevelAndAccount chỉ lấy đúng level và đúng account', () => {
  const rows = [
    { objectType: 'ad_campaign', objectId: 'ac1', adAccountId: 'acc-1', spend: 10 },
    { objectType: 'ad_campaign', objectId: 'ac2', adAccountId: 'acc-2', spend: 20 },
    { objectType: 'ad_group', objectId: 'ag1', adAccountId: 'acc-1', spend: 30 },
    { objectType: 'ad_account', objectId: 'acc-1', spend: 40 },
  ];
  assert.deepEqual(domain.filterInsightsByLevelAndAccount(rows, { level: 'campaign', accountId: 'acc-1' }).map((r) => r.objectId), ['ac1']);
  assert.deepEqual(domain.filterInsightsByLevelAndAccount(rows, { level: 'account' }).map((r) => r.objectId), ['acc-1']);
  assert.equal(domain.filterInsightsByLevelAndAccount(rows, { level: 'ad', accountId: 'acc-1' }).length, 0);
});

// ---------------------------------------------------------------------------
// R30 [unit] — risk: pending dependency bình thường KHÔNG phải rủi ro
// ---------------------------------------------------------------------------
test('R30 [unit]: assessTaskRisk — chờ tiền nhiệm còn slack = không rủi ro; quá hạn / blocker / slack âm mới cảnh báo', () => {
  const tasks = [
    { id: 'A', status: 'in_progress', startDate: '2026-11-02', dueDate: '2026-11-06' },
    { id: 'B', status: 'todo', startDate: '2026-11-09', dueDate: '2026-11-13' },
    { id: 'C', status: 'todo', startDate: '2026-11-05', dueDate: '2026-11-06' },
  ];
  const deps = [
    { predecessorId: 'A', successorId: 'B' }, // A chưa xong nhưng due 06/11 <= start B 09/11 → bình thường
    { predecessorId: 'A', successorId: 'C' }, // A due 06/11 > start C 05/11 → slack âm
  ];
  const ctx = { today: '2026-11-04', tasks, dependencies: deps, blockers: [] };
  assert.equal(domain.assessTaskRisk(tasks[1], ctx).atRisk, false, 'pending dependency bình thường không phải rủi ro');
  const c = domain.assessTaskRisk(tasks[2], ctx);
  assert.equal(c.atRisk, true);
  assert.ok(c.reasons.includes('negative_slack'));
  const overdue = domain.assessTaskRisk({ id: 'X', status: 'todo', dueDate: '2026-11-01' }, ctx);
  assert.ok(overdue.reasons.includes('overdue'));
  const blocked = domain.assessTaskRisk(tasks[1], { ...ctx, blockers: [{ taskId: 'B', status: 'open' }] });
  assert.ok(blocked.reasons.includes('blocker'));
});

// ---------------------------------------------------------------------------
// R31 [store-contract/demo] — archive/restore thay hard-delete
// ---------------------------------------------------------------------------
test('R31 [store-contract]: remove = archive (list mặc định ẩn, includeArchived thấy), restore khôi phục; archive variant huỷ job chờ', () => {
  setupDemo({ state: {
    tasks: [{ id: 't1', title: 'A', status: 'todo' }],
    variants: [{ id: 'v1', platform: 'facebook', approvalStatus: 'approved' }],
    publishJobs: [{ id: 'j1', variantId: 'v1', status: 'queued' }, { id: 'j2', variantId: 'v1', status: 'published' }],
  } });
  const r = Store.remove('tasks', 't1');
  assert.equal(r.ok, true);
  assert.equal(r.archived, true);
  assert.equal(Store.list('tasks').length, 0, 'list mặc định lọc archived');
  assert.equal(Store.list('tasks', { includeArchived: true }).length, 1, 'bản ghi vẫn còn để khôi phục');
  const back = Store.restore('tasks', 't1');
  assert.equal(back.ok, true);
  assert.equal(Store.list('tasks').length, 1);
  Store.remove('variants', 'v1');
  assert.equal(Store.get('publishJobs', 'j1').status, 'cancelled', 'job đang chờ của variant bị huỷ khi archive');
  assert.equal(Store.get('publishJobs', 'j2').status, 'published', 'job đã đăng không bị đụng');
});

// ---------------------------------------------------------------------------
// R29 [store-contract] — sync status incomplete giữ nguyên
// ---------------------------------------------------------------------------
test('R29 [store-contract]: recordSyncStatus giữ nguyên incomplete từ server, không tự đánh dấu complete', () => {
  setupDemo({});
  const e = Store.recordSyncStatus({ id: 'run-1', status: 'incomplete', fetchedUntil: '2026-11-01' });
  assert.equal(e.status, 'incomplete');
  assert.equal(e.complete, false);
  const e2 = Store.recordSyncStatus({ id: 'run-2', status: 'complete' });
  assert.equal(e2.complete, true);
});
