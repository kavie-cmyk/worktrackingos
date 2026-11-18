// tests/content-r2.test.mjs
// Regression tests vòng sửa QA R2 — PHẦN store.js (executor B):
//   R2-10 currency kế thừa dòng ngân sách ở _toPayload (actuals/commitments)
//   R2-14 TikTok script builder dùng chung: create chèn tiktok_scripts đủ
//         hook/scenes(hook+cta)/hashtags; update chỉ đổi hashtags cũng upsert;
//         loader gán hashtags + scenes giữ hook/cta từng cảnh
//   R2-15 _variantContentChanged đủ field nội dung; snapshot revision đóng
//         băng toàn bộ field + hash; contentRevisions thành collection
//   R2-17 _updateRemote brandAssets: patch url/fileUrl → asset_versions.external_url
//   R2-20 loader ads_insights giữ NGUYÊN mọi hàng trong state.adInsights
//   R2-30.6 loader approvals: approverId = approver_id, requestedBy = created_by;
//         _createApprovalStep ghi approver_id từ reviewer của variant
// Tầng kiểm: [store-contract] Store + fake Supabase client — KHÔNG phải live/RLS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
const Store = require('../js/store.js');

// ---------------------------------------------------------------------------
// Fake Supabase client (mẫu tests/glue-r1.test.mjs)
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

const BASE_SCENE = { shot: '1', hook: 'H1', visual: 'V1', dialogue: 'D1', onScreenText: 'T1', durationSec: 5, cta: 'C1' };
const BASE_VARIANT = {
  id: 'v1', platform: 'tiktok', caption: 'Caption gốc', mediaAssetIds: ['m1'],
  linkUrl: 'https://link.example/a', visibility: 'public',
  hook: 'Hook gốc', cta: 'CTA gốc', script: 'Kịch bản gốc', hashtags: '#a #b',
  mediaUrl: 'https://media.example/a.mp4', scriptScenes: [{ ...BASE_SCENE }],
};

// ---------------------------------------------------------------------------
// R2-10 [store-contract] — currency ép theo dòng ngân sách
// ---------------------------------------------------------------------------
test('R2-10: _toPayload actuals/commitments ép currency của dòng ngân sách khi resolve được budgetLineId', () => {
  setupDemo({ state: { budgetLines: [{ id: 'bl-1', currency: 'USD', name: 'Ads USD' }] } });
  const act = Store._toPayload('actuals', { budgetLineId: 'bl-1', amount: 100, currency: 'VND' });
  assert.equal(act.currency, 'USD', 'actual phải kế thừa currency của dòng, không giữ currency form gửi');
  const actNoCur = Store._toPayload('actuals', { budgetLineId: 'bl-1', amount: 100 });
  assert.equal(actNoCur.currency, 'USD', 'actual không gửi currency vẫn được điền từ dòng');
  const com = Store._toPayload('commitments', { budgetLineId: 'bl-1', amount: 500, currency: 'VND', title: 'Đặt cọc' });
  assert.equal(com.currency, 'USD');
  const comUnknown = Store._toPayload('commitments', { budgetLineId: 'bl-khong-co', amount: 5, currency: 'VND' });
  assert.equal(comUnknown.currency, 'VND', 'không resolve được dòng → commitment giữ currency object gửi');
  const actUnknown = Store._toPayload('actuals', { budgetLineId: 'bl-khong-co', amount: 5, currency: 'VND' });
  assert.ok(!('currency' in actUnknown), 'không resolve được dòng → actual để DB default (không gửi currency)');
});

// ---------------------------------------------------------------------------
// R2-14a [store-contract/remote] — create variant TikTok chèn tiktok_scripts
// ---------------------------------------------------------------------------
test('R2-14a: _createRemote variants (tiktok) insert tiktok_scripts đủ hook/cta/caption/hashtags mảng/scenes đủ hook+cta/external_url', async () => {
  const handler = (call) => {
    if (call.table === 'content_variants' && call.op === 'insert') {
      return { data: { id: 'var-new', workspace_id: 'ws-1', platform: 'tiktok', caption: 'Cap 1', editorial_status: 'draft', approval_status: 'draft' }, error: null };
    }
    if (call.table === 'tiktok_scripts' && call.op === 'insert') return { data: [{ id: 'ts-1' }], error: null };
    return { data: [], error: null };
  };
  setupRemote(handler);
  const r = await Store.create('variants', {
    contentItemId: 'ci-1', platform: 'tiktok', caption: 'Cap 1',
    hook: 'Hook chính', cta: 'Mua ngay', hashtags: '#sava #vr',
    scriptScenes: [{ ...BASE_SCENE }], externalUrl: 'https://www.tiktok.com/@sava/video/1',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ins = Store.supabaseClient.calls.find((c) => c.table === 'tiktok_scripts' && c.op === 'insert');
  assert.ok(ins, 'phải có insert vào tiktok_scripts sau insert bảng chính');
  assert.equal(ins.payload.variant_id, 'var-new');
  assert.equal(ins.payload.hook, 'Hook chính');
  assert.equal(ins.payload.cta, 'Mua ngay');
  assert.equal(ins.payload.caption, 'Cap 1');
  assert.deepEqual(ins.payload.hashtags, ['sava', 'vr'], "chuỗi '#sava #vr' → mảng ['sava','vr']");
  assert.deepEqual(ins.payload.scenes, [{
    shot: '1', hook: 'H1', visual: 'V1', dialogue: 'D1', on_screen_text: 'T1', duration_sec: 5, cta: 'C1',
  }], 'scenes phải map ĐỦ field gồm hook/cta từng cảnh');
  assert.equal(ins.payload.external_url, 'https://www.tiktok.com/@sava/video/1');
});

test('R2-14a: lỗi insert tiktok_scripts → {ok:false, partial:true, failedStep:tiktok_scripts.insert, item} (không ok giả)', async () => {
  const handler = (call) => {
    if (call.table === 'content_variants' && call.op === 'insert') {
      return { data: { id: 'var-new', workspace_id: 'ws-1', platform: 'tiktok', caption: 'Cap', editorial_status: 'draft', approval_status: 'draft' }, error: null };
    }
    if (call.table === 'tiktok_scripts') return { data: null, error: { code: '42501', message: 'permission denied' } };
    return { data: [], error: null };
  };
  setupRemote(handler);
  const r = await Store.create('variants', { contentItemId: 'ci-1', platform: 'tiktok', caption: 'Cap', hook: 'H', hashtags: '#a' });
  assert.equal(r.ok, false);
  assert.equal(r.partial, true);
  assert.equal(r.failedStep, 'tiktok_scripts.insert');
  assert.ok(r.item && r.item.id === 'var-new', 'partial vẫn trả item của bước chính để đối soát');
});

// ---------------------------------------------------------------------------
// R2-14b [store-contract/remote] — update chỉ đổi hashtags cũng upsert script
// ---------------------------------------------------------------------------
test('R2-14b: _updateVariantRemote patch chỉ đổi hashtags → vẫn upsert tiktok_scripts bằng builder (hashtags mảng, scenes giữ hook/cta cũ)', async () => {
  const handler = (call) => {
    if (call.table === 'content_revisions' && call.op === 'insert') {
      return { data: { id: 'rev-2', revision_no: 2, variant_id: 'v1', snapshot: call.payload.snapshot }, error: null };
    }
    if (call.table === 'content_variants' && call.op === 'update') {
      return { data: [{ id: 'v1', platform: 'tiktok', caption: 'Caption gốc', current_revision_id: 'rev-2', editorial_status: 'draft', approval_status: 'draft', updated_at: '2026-11-12T00:00:00Z' }], error: null };
    }
    if (call.table === 'tiktok_scripts' && call.op === 'upsert') return { data: [{ id: 'ts-1' }], error: null };
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { variants: [{ ...BASE_VARIANT, approvalStatus: 'draft', revision: 1, currentRevisionId: 'rev-1', updatedAt: '2026-11-01T00:00:00Z' }] } });
  const r = await Store.updateVariant('v1', { hashtags: '#moi #tag' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const up = Store.supabaseClient.calls.find((c) => c.table === 'tiktok_scripts' && c.op === 'upsert');
  assert.ok(up, 'patch chỉ đổi hashtags vẫn phải upsert script');
  assert.deepEqual(up.payload.hashtags, ['moi', 'tag']);
  assert.equal(up.payload.hook, 'Hook gốc', 'field không sửa lấy từ variant hiện tại');
  assert.equal(up.payload.scenes[0].hook, 'H1');
  assert.equal(up.payload.scenes[0].cta, 'C1');
});

// ---------------------------------------------------------------------------
// R2-15a [unit] — _variantContentChanged: từng field nội dung → true
// ---------------------------------------------------------------------------
test('R2-15a: _variantContentChanged — đổi từng field nội dung (caption/media/link/visibility/hook/cta/script/hashtags/mediaUrl/scriptScenes) đều true; gửi kèm không đổi → false', () => {
  setupDemo({});
  const v = { ...BASE_VARIANT };
  const cases = {
    caption: 'Caption mới',
    mediaAssetIds: ['m2'],
    linkUrl: 'https://link.example/b',
    visibility: 'private',
    hook: 'Hook mới',
    cta: 'CTA mới',
    script: 'Kịch bản mới',
    hashtags: '#a #c',
    mediaUrl: 'https://media.example/b.mp4',
    scriptScenes: [{ ...BASE_SCENE, hook: 'Hook cảnh mới' }],
  };
  for (const [field, value] of Object.entries(cases)) {
    assert.equal(Store._variantContentChanged(v, { [field]: value }), true, `đổi ${field} phải được coi là đổi nội dung`);
  }
  assert.equal(Store._variantContentChanged(v, { scriptScenes: [{ ...BASE_SCENE, cta: 'CTA cảnh mới' }] }), true, 'đổi cta trong cảnh cũng là đổi nội dung');
  // Gửi kèm giá trị KHÔNG đổi (kể cả khác dạng biểu diễn) → false:
  assert.equal(Store._variantContentChanged(v, { caption: v.caption, hook: v.hook }), false);
  assert.equal(Store._variantContentChanged(v, { hashtags: ['a', 'b'] }), false, "hashtags mảng ['a','b'] tương đương chuỗi '#a #b' sau chuẩn hoá");
  assert.equal(Store._variantContentChanged(v, {
    scriptScenes: [{ shot: '1', hook: 'H1', visual: 'V1', dialogue: 'D1', on_screen_text: 'T1', duration_sec: 5, cta: 'C1' }],
  }), false, 'scenes dạng snake tương đương dạng camel sau chuẩn hoá theo builder');
  assert.equal(Store._variantContentChanged(v, { approvalStatus: 'approved' }), false, 'field không thuộc nội dung không tạo revision');
});

// ---------------------------------------------------------------------------
// R2-15b [store-contract] — snapshot revision đóng băng đủ field + hash
// ---------------------------------------------------------------------------
test('R2-15b: _createRevisionForVariant — snapshot chứa đủ caption/media_asset_ids/link_url/visibility/hook/cta/script/hashtags/script_scenes/media_url + hash trên toàn bộ snapshot', async () => {
  const handler = (call) => {
    if (call.table === 'content_revisions' && call.op === 'insert') {
      return { data: { id: 'rev-9', revision_no: 3, variant_id: 'v1', snapshot: call.payload.snapshot }, error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler);
  const v = { ...BASE_VARIANT, revision: 2, currentRevisionId: 'rev-2' };
  const r = await Store._createRevisionForVariant(v, { hook: 'Hook mới', scriptScenes: [{ ...BASE_SCENE, cta: 'CTA cảnh mới' }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ins = Store.supabaseClient.calls.find((c) => c.table === 'content_revisions' && c.op === 'insert');
  const snap = ins.payload.snapshot;
  assert.equal(snap.caption, 'Caption gốc');
  assert.deepEqual(snap.media_asset_ids, ['m1']);
  assert.equal(snap.link_url, 'https://link.example/a');
  assert.equal(snap.visibility, 'public');
  assert.equal(snap.hook, 'Hook mới', 'snapshot lấy hook SAU sửa');
  assert.equal(snap.cta, 'CTA gốc');
  assert.equal(snap.script, 'Kịch bản gốc');
  assert.equal(snap.hashtags, '#a #b');
  assert.equal(snap.media_url, 'https://media.example/a.mp4');
  assert.ok(Array.isArray(snap.script_scenes) && snap.script_scenes.length === 1);
  assert.equal(snap.script_scenes[0].cta, 'CTA cảnh mới');
  assert.equal(snap.script_scenes[0].hook, 'H1');
  const { hash, ...rest } = snap;
  assert.ok(hash, 'snapshot phải có hash');
  assert.equal(hash, core.stableHash(rest), 'hash tính trên toàn bộ snapshot (không gồm chính field hash)');
});

test('R2-15b/c [store-contract/demo]: updateVariant demo — revision mới vào state.contentRevisions với snapshot đủ field; COLLECTIONS có contentRevisions + adInsights', () => {
  assert.ok(Store.COLLECTIONS.includes('contentRevisions'));
  assert.ok(Store.COLLECTIONS.includes('adInsights'));
  setupDemo({ state: { variants: [{ ...BASE_VARIANT, approvalStatus: 'approved', revision: 1 }] } });
  const r = Store.updateVariant('v1', { hook: 'Hook mới demo' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const revs = Store.list('contentRevisions').filter((x) => x.variantId === 'v1');
  assert.equal(revs.length, 1, 'đổi hook phải tạo revision mới ở demo');
  const snap = revs[0].snapshot;
  assert.equal(snap.hook, 'Hook mới demo');
  assert.equal(snap.caption, 'Caption gốc');
  assert.deepEqual(snap.media_asset_ids, ['m1']);
  assert.equal(snap.link_url, 'https://link.example/a');
  assert.equal(snap.visibility, 'public');
  assert.equal(snap.cta, 'CTA gốc');
  assert.equal(snap.script, 'Kịch bản gốc');
  assert.equal(snap.hashtags, '#a #b');
  assert.equal(snap.media_url, 'https://media.example/a.mp4');
  assert.equal(snap.script_scenes[0].hook, 'H1');
  assert.ok(snap.hash);
});

// ---------------------------------------------------------------------------
// R2-20 + R2-14c [store-contract/remote] — loader: adInsights giữ mọi kỳ;
// tiktok_scripts merge hashtags/scenes; content_revisions → collection
// ---------------------------------------------------------------------------
test('R2-20: loader ads_insights giữ NGUYÊN 2 kỳ của cùng object trong adInsights (đủ grain), merge cây ads chỉ là phụ', async () => {
  const insightRows = [
    { id: 'ins-1', workspace_id: 'ws-1', object_type: 'ad_campaign', object_id: 'ext-c1', period_start: '2027-01-01', period_end: '2027-01-31', observed_at: '2027-02-01T00:00:00Z', currency: 'VND', dimensions: { source: 'meta' }, spend: 100, impressions: 1000, clicks: 10, reach: 800, results: 5, result_type: 'leads', conversion_value: 300 },
    { id: 'ins-2', workspace_id: 'ws-1', object_type: 'ad_campaign', object_id: 'ext-c1', period_start: '2027-02-01', period_end: '2027-02-28', observed_at: '2027-03-01T00:00:00Z', currency: 'VND', dimensions: { source: 'meta' }, spend: 200, impressions: 2000, clicks: 20, reach: 1500, results: 9, result_type: 'leads', conversion_value: 700 },
  ];
  const handler = (call) => {
    if (call.table === 'ads_insights' && call.op === 'select') return { data: insightRows, error: null };
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { adCampaigns: [{ id: 'ac-db-1', externalId: 'ext-c1', name: 'Camp 1' }] } });
  await Store._loadDerivedMerges();
  assert.equal(Store.state.adInsights.length, 2, 'cả 2 kỳ của cùng object phải được giữ — không gộp còn 1 hàng mới nhất');
  const jan = Store.state.adInsights.find((x) => x.id === 'ins-1');
  assert.equal(jan.objectType, 'ad_campaign');
  assert.equal(jan.objectId, 'ext-c1');
  assert.equal(jan.periodStart, '2027-01-01');
  assert.equal(jan.periodEnd, '2027-01-31');
  assert.equal(jan.observedAt, '2027-02-01T00:00:00Z');
  assert.equal(jan.currency, 'VND');
  assert.deepEqual(jan.dimensions, { source: 'meta' });
  assert.equal(jan.spend, 100);
  assert.equal(jan.impressions, 1000);
  assert.equal(jan.clicks, 10);
  assert.equal(jan.reach, 800);
  assert.equal(jan.results, 5);
  assert.equal(jan.resultType, 'leads');
  assert.equal(jan.conversionValue, 300);
  // Merge vào cây ads (hiển thị) vẫn chạy và lấy hàng mới nhất của đúng object.
  assert.equal(Store.state.adCampaigns[0].spend, 200);
});

test('R2-14c/R2-15c: loader gán hashtags (mảng → chuỗi) + scenes giữ hook/cta vào variant; content_revisions map thành contentRevisions', async () => {
  const handler = (call) => {
    if (call.table === 'tiktok_scripts' && call.op === 'select') {
      return { data: [{ id: 'ts-1', workspace_id: 'ws-1', variant_id: 'v1', hook: 'H', cta: 'C', caption: 'Cap', hashtags: ['sava', 'vr'], scenes: [{ shot: '1', hook: 'SH', visual: 'V', dialogue: 'D', on_screen_text: 'T', duration_sec: 3, cta: 'SC' }], external_url: 'https://www.tiktok.com/x' }], error: null };
    }
    if (call.table === 'content_revisions' && call.op === 'select') {
      return { data: [{ id: 'rev-1', workspace_id: 'ws-1', variant_id: 'v1', revision_no: 2, caption: 'Cap', media_asset_ids: ['m1'], link_url: null, visibility: 'public', snapshot: { caption: 'Cap', hook: 'H' }, created_by: 'u-lead', created_at: '2026-11-10T00:00:00Z' }], error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { variants: [{ id: 'v1', platform: 'tiktok', publishingStatus: 'draft' }] } });
  await Store._loadDerivedMerges();
  const v = Store.get('variants', 'v1');
  assert.equal(v.hashtags, '#sava #vr');
  assert.equal(v.scriptScenes[0].hook, 'SH', 'hook từng cảnh không được rơi khi load');
  assert.equal(v.scriptScenes[0].cta, 'SC', 'cta từng cảnh không được rơi khi load');
  assert.equal(v.scriptScenes[0].onScreenText, 'T');
  assert.equal(v.scriptScenes[0].durationSec, 3);
  const revs = Store.list('contentRevisions');
  assert.equal(revs.length, 1);
  assert.equal(revs[0].variantId, 'v1');
  assert.equal(revs[0].revisionNo, 2);
  assert.deepEqual(revs[0].snapshot, { caption: 'Cap', hook: 'H' });
  assert.equal(revs[0].createdAt, '2026-11-10T00:00:00Z');
});

// ---------------------------------------------------------------------------
// R2-17 [store-contract/remote] — brandAssets: patch url/fileUrl → version mới đúng external_url
// ---------------------------------------------------------------------------
test('R2-17: _updateRemote brandAssets với patch {url} tạo asset_versions với external_url lấy từ _toPayload của patch', async () => {
  const handler = (call) => {
    if (call.table === 'assets' && call.op === 'update') {
      return { data: [{ id: 'a9', asset_type: 'image', status: 'active', approval_status: 'draft', name: 'KV', external_url: 'https://example.com/a.png', updated_at: '2026-11-12T00:00:00Z' }], error: null };
    }
    if (call.table === 'asset_versions' && call.op === 'insert') return { data: [{ id: 'av2' }], error: null };
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { brandAssets: [{ id: 'a9', name: 'KV', version: 1, externalUrl: 'https://old.example/x.png', updatedAt: '2026-11-01T00:00:00Z' }] } });
  const r = await Store.update('brandAssets', 'a9', { url: 'https://example.com/a.png' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const vIns = Store.supabaseClient.calls.filter((c) => c.table === 'asset_versions' && c.op === 'insert').pop();
  assert.ok(vIns, "patch chỉ có 'url' cũng phải được coi là sửa nội dung → tạo version mới");
  assert.equal(vIns.payload.external_url, 'https://example.com/a.png');
  assert.equal(vIns.payload.version_no, 2);
});

// ---------------------------------------------------------------------------
// R2-30.6 [store-contract/remote] — approvals: approverId/requestedBy + create step
// ---------------------------------------------------------------------------
test('R2-30.6: loader approvals — approverId = step.approver_id, requestedBy = step.created_by (không gán ngược)', async () => {
  const handler = (call) => {
    if (call.table === 'approval_steps' && call.op === 'select') {
      return { data: [{ id: 'st-1', workspace_id: 'ws-1', variant_id: 'v1', content_item_id: 'ci-1', campaign_id: null, name: 'Duyệt nội dung', approver_id: 'user-reviewer', approver_role: 'lead', status: 'pending', created_by: 'user-requester', created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z' }], error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler);
  await Store._loadApprovals();
  const item = Store.get('approvals', 'st-1');
  assert.equal(item.approverId, 'user-reviewer');
  assert.equal(item.requestedBy, 'user-requester', 'requestedBy không được là approver_id như trước');
});

test('R2-30.6: _createApprovalStep ghi approver_id từ reviewerId của variant khi có (thay vì luôn null)', async () => {
  const handler = (call) => {
    if (call.table === 'approval_steps' && call.op === 'insert') {
      return { data: { id: 'st-2', ...call.payload }, error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler, { state: { variants: [{ id: 'v1', reviewerId: 'user-reviewer' }] } });
  const r = await Store._createApprovalStep({ variantId: 'v1', contentItemId: 'ci-1', note: 'Duyệt giúp' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ins = Store.supabaseClient.calls.find((c) => c.table === 'approval_steps' && c.op === 'insert');
  assert.equal(ins.payload.approver_id, 'user-reviewer');
});
