// tests/store-domain-syn-fixes.test.mjs
// Đợt sửa findings QA 16/11 — phần Store/Domain/KPI (executor 2):
//   - SYN-05 (domain): rollupKpi ratio khử trùng numeratorFacts/
//     denominatorFacts theo fact ID.
//   - SYN-06 (store, demo + remote): khóa measurement KPI auto kiểm theo
//     KPI HIỆN TẠI và KPI đích khi patch gán lại kpiId.
//   - SYN-16 (domain): postMetricActual period_sum khử trùng observation id.
//   - SYN-17 (domain): rollupKpi snapshot thiếu objectId → insufficient_data.
//   - SYN-18 (store, demo + remote): update('kpis') đổi nguồn auto→manual
//     kèm actual → strip actual khỏi patch.
//   - SYN-26 (store demo): createPublishJob TikTok trả thông điệp riêng,
//     không bị lỗi demo chung che mất.
//   - SYN-04 (store remote): decide fact qua RPC vẫn mang missingStamp.
// Mọi kiểm chứng ở tầng domain/demo-state/mock client — không đụng DB live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
require('../js/domain.js'); // nạp SAVA_DOMAIN cho Store._domain()
const Store = require('../js/store.js');

const WS = 'ws-1';
const OWNER = 'u-owner';
const LEAD = 'u-lead';

const EMPTY_COLLECTIONS = () => Object.fromEntries(Store.COLLECTIONS.map((k) => [k, []]));

function autoKpi(extra) {
  return Object.assign({
    id: 'kpi-auto', scopeType: 'campaign', campaignId: 'camp-1', name: 'Views tự động',
    metricCode: 'lifetime_views', target: 500, actual: 42, unit: 'lượt xem', periodKey: '2026-11',
    targetVersion: 1,
    definition: { description: 'Tự tính', dataSource: { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum' } },
  }, extra || {});
}
function manualKpi(extra) {
  return Object.assign({
    id: 'kpi-manual', scopeType: 'campaign', campaignId: 'camp-1', name: 'KPI tay',
    metricCode: 'leads', target: 100, actual: 10, unit: 'lead', targetVersion: 1,
    definition: { description: 'Nhập tay' },
  }, extra || {});
}

function resetDemo(extraState) {
  Store.mode = 'demo';
  Store.supabaseClient = null;
  Store.workspaceId = WS;
  Store._membership = null;
  Store.currentUserId = OWNER;
  Store.state = Object.assign(EMPTY_COLLECTIONS(), {
    members: [
      { id: OWNER, name: 'Owner', role: 'owner' },
      { id: LEAD, name: 'Lead', role: 'lead' },
    ],
    campaigns: [{ id: 'camp-1', name: 'Camp 1', status: 'active', approvedBy: OWNER, approvedAt: '2026-11-15T09:00:00Z' }],
    kpis: [autoKpi(), manualKpi(), manualKpi({ id: 'kpi-manual-2', name: 'KPI tay 2' })],
    measurements: [
      { id: 'meas-auto-old', kpiId: 'kpi-auto', value: 1, source: 'manual', measuredAt: '2026-11-01T00:00:00Z' },
      { id: 'meas-manual', kpiId: 'kpi-manual', value: 5, source: 'manual', measuredAt: '2026-11-01T00:00:00Z' },
    ],
    variants: [
      { id: 'v-tiktok', platform: 'tiktok', approvalStatus: 'approved', caption: 'TT' },
      { id: 'v-fb', platform: 'facebook', approvalStatus: 'approved', caption: 'FB' },
    ],
    kpiTargetVersions: [],
  }, extraState || {});
  Store.loadState = {};
  Store._postMappings = [];
  return Store;
}

// ---------------------------------------------------------------------------
// SYN-05 — ratio khử trùng fact ID ở tử và mẫu
// ---------------------------------------------------------------------------
test('SYN-05 [domain]: ratio — tử số trùng fact ID chỉ tính 1 lần (ratio 100, không phải 200)', () => {
  const r = domain.rollupKpi([], {
    mode: 'ratio',
    numeratorFacts: [{ id: 'same', value: 1000 }, { id: 'same', value: 1000 }],
    denominatorFacts: [{ id: 'd', value: 10 }],
  });
  assert.equal(r.numeratorTotal, 1000);
  assert.equal(r.denominatorTotal, 10);
  assert.equal(r.value, 100);
  assert.ok(r.duplicateFactIds.includes('same'));
  assert.deepEqual(r.includedFactIds.sort(), ['d', 'same']);
});

test('SYN-05 [domain]: ratio — mẫu số trùng fact ID chỉ tính 1 lần (ratio 30, không phải 15)', () => {
  const r = domain.rollupKpi([], {
    mode: 'ratio',
    numeratorFacts: [{ id: 'n', value: 900 }],
    denominatorFacts: [{ id: 'same-den', value: 30 }, { id: 'same-den', value: 30 }],
  });
  assert.equal(r.numeratorTotal, 900);
  assert.equal(r.denominatorTotal, 30);
  assert.equal(r.value, 30);
  assert.ok(r.duplicateFactIds.includes('same-den'));
});

test('SYN-05 [domain]: ratio CPL chuẩn giữ nguyên (Ads 100000, campaign ≈146429)', () => {
  const ads = domain.rollupKpi([], {
    mode: 'ratio', scopeLabel: 'Ads',
    numeratorFacts: [{ id: 'spend-ads', value: 10000000 }],
    denominatorFacts: [{ id: 'reg-ads', value: 100 }],
  });
  assert.equal(ads.value, 100000);
  const camp = domain.rollupKpi([], {
    mode: 'ratio', scopeLabel: 'Toàn campaign',
    numeratorFacts: [{ id: 'spend-camp', value: 20500000 }],
    denominatorFacts: [{ id: 'reg-unique', value: 140 }],
  });
  assert.equal(Math.round(camp.value), 146429);
});

// ---------------------------------------------------------------------------
// SYN-16 — period_sum khử trùng observation theo id
// ---------------------------------------------------------------------------
test('SYN-16 [domain]: period_sum — observation trùng id chỉ cộng 1 lần (30, không phải 40)', () => {
  const kpi = {
    id: 'kpi-period', periodStart: '2026-11-01', periodEnd: '2026-11-30',
    definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'period_sum' } },
  };
  const posts = [{ id: 'p1', title: 'Bài 1', platform: 'facebook' }];
  const obs = [
    { id: 'dup-1', externalPostId: 'p1', metric: 'views', value: 10, observedAt: '2026-11-05T00:00:00Z' },
    { id: 'dup-1', externalPostId: 'p1', metric: 'views', value: 10, observedAt: '2026-11-05T00:00:00Z' },
    { id: 'obs-2', externalPostId: 'p1', metric: 'views', value: 20, observedAt: '2026-11-06T00:00:00Z' },
  ];
  const r = domain.postMetricActual(kpi, posts, obs);
  assert.equal(r.value, 30);
  assert.equal(r.postCount, 1);
});

// ---------------------------------------------------------------------------
// SYN-17 — snapshot thiếu objectId → insufficient_data
// ---------------------------------------------------------------------------
test('SYN-17 [domain]: snapshot — fact thiếu objectId → insufficient_data, KHÔNG cộng dồn 250', () => {
  const facts = [
    { id: 'obs-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 100, observedAt: '2026-11-10T10:00:00.000Z' },
    { id: 'obs-2', metricCode: 'views', unit: 'view', period: '2026-11', value: 150, observedAt: '2026-11-11T10:00:00.000Z' },
  ];
  const r = domain.rollupKpi(facts, { mode: 'snapshot', metricCode: 'views', unit: 'view', period: '2026-11' });
  assert.equal(r.value, null);
  assert.notEqual(r.value, 250);
  assert.equal(r.status, 'insufficient_data');
  assert.deepEqual(r.missingObjectFactIds, ['obs-1', 'obs-2']);
});

test('SYN-17 [domain]: snapshot — có objectId đúng vẫn lấy latest 150; nhiều object cộng latest từng object (230)', () => {
  const one = domain.rollupKpi([
    { id: 'o1', objectId: 'post-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 100, observedAt: '2026-11-10T10:00:00.000Z' },
    { id: 'o2', objectId: 'post-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 150, observedAt: '2026-11-11T10:00:00.000Z' },
  ], { mode: 'snapshot', metricCode: 'views', unit: 'view', period: '2026-11' });
  assert.equal(one.status, 'ok');
  assert.equal(one.value, 150);
  assert.deepEqual(one.missingObjectFactIds, []);
  const two = domain.rollupKpi([
    { id: 'o1', objectId: 'post-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 150, observedAt: '2026-11-11T10:00:00.000Z' },
    { id: 'o3', externalPostId: 'post-2', metricCode: 'views', unit: 'view', period: '2026-11', value: 80, observedAt: '2026-11-09T10:00:00.000Z' },
  ], { mode: 'snapshot', metricCode: 'views', unit: 'view', period: '2026-11' });
  assert.equal(two.value, 230);
});

// ---------------------------------------------------------------------------
// SYN-06 — gán lại kpiId của measurement không vòng qua được khóa KPI auto
// ---------------------------------------------------------------------------
test('SYN-06 [store/demo]: gán measurement của KPI auto sang KPI manual kèm value → KPI_AUTO_SOURCE, bản ghi nguyên vẹn', () => {
  resetDemo();
  const r = Store.update('measurements', 'meas-auto-old', { kpiId: 'kpi-manual', value: 777 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'KPI_AUTO_SOURCE');
  const m = Store.get('measurements', 'meas-auto-old');
  assert.equal(m.kpiId, 'kpi-auto', 'measurement vẫn thuộc KPI auto');
  assert.equal(m.value, 1, 'value không bị ghi thành 777');
});

test('SYN-06 [store/demo]: gán measurement của KPI manual sang KPI auto → KPI_AUTO_SOURCE; manual→manual vẫn được', () => {
  resetDemo();
  const r = Store.update('measurements', 'meas-manual', { kpiId: 'kpi-auto', value: 777 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'KPI_AUTO_SOURCE');
  assert.equal(Store.get('measurements', 'meas-manual').kpiId, 'kpi-manual');
  const ok = Store.update('measurements', 'meas-manual', { kpiId: 'kpi-manual-2', value: 66 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(Store.get('measurements', 'meas-manual').kpiId, 'kpi-manual-2');
  assert.equal(Store.get('measurements', 'meas-manual').value, 66);
});

test('SYN-06 [store/remote]: gán lại kpiId qua đường remote cũng bị chặn KPI_AUTO_SOURCE trước khi chạm client', async () => {
  resetDemo();
  Store.mode = 'supabase';
  Store.supabaseClient = null; // chặn phải xảy ra TRƯỚC mọi lần chạm client
  const r1 = await Store.update('measurements', 'meas-auto-old', { kpiId: 'kpi-manual', value: 777 });
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'KPI_AUTO_SOURCE');
  const r2 = await Store.update('measurements', 'meas-manual', { kpiId: 'kpi-auto', value: 777 });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'KPI_AUTO_SOURCE');
  Store.mode = 'demo';
});

// ---------------------------------------------------------------------------
// SYN-18 — đổi nguồn auto→manual kèm actual: strip actual, thao tác vẫn chạy
// ---------------------------------------------------------------------------
test('SYN-18 [store/demo]: update kpis đổi nguồn auto→manual kèm actual → ok, nguồn đổi, actual KHÔNG bị ghi trong cùng thao tác', () => {
  resetDemo();
  const r = Store.update('kpis', 'kpi-auto', {
    definition: { description: 'now manual' },
    actual: 999,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const k = Store.get('kpis', 'kpi-auto');
  assert.equal(Store._kpiDataSource(k), null, 'KPI đã thành manual sau update');
  assert.equal(k.actual, 42, 'actual giữ giá trị cũ — 999 bị strip khỏi patch, không ghi');
  // Thao tác RIÊNG sau đó (KPI đã manual) mới ghi được actual — đúng ngữ nghĩa 2 bước.
  const r2 = Store.update('kpis', 'kpi-auto', { actual: 555 });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(Store.get('kpis', 'kpi-auto').actual, 555);
});

test('SYN-18 [store/demo]: giữ nguyên các đường chặn — auto→auto kèm actual vẫn KPI_AUTO_SOURCE; manual→auto kèm actual vẫn bị chặn', () => {
  resetDemo();
  const still = Store.update('kpis', 'kpi-auto', {
    definition: { description: 'vẫn auto', dataSource: { type: 'post_metrics', metric: 'views', mode: 'latest_sum' } },
    actual: 999,
  });
  assert.equal(still.ok, false);
  assert.equal(still.code, 'KPI_AUTO_SOURCE');
  const toAuto = Store.update('kpis', 'kpi-manual', {
    definition: { description: 'thành auto', dataSource: { type: 'post_metrics', metric: 'views', mode: 'latest_sum' } },
    actual: 999,
  });
  assert.equal(toAuto.ok, false);
  assert.equal(toAuto.code, 'KPI_AUTO_SOURCE');
});

// ---------------------------------------------------------------------------
// SYN-26 — TikTok ở demo: thông điệp riêng không bị lỗi demo chung che mất
// ---------------------------------------------------------------------------
test('SYN-26 [store/demo]: createPublishJob cho variant TikTok ở demo → thông điệp riêng của TikTok; Facebook vẫn lỗi demo chung', () => {
  resetDemo();
  const tt = Store.createPublishJob('v-tiktok', { accountId: 'acc-1', decisionId: 'dec-1' });
  assert.equal(tt.ok, false);
  assert.equal(tt.error, 'TikTok đăng ngoài app: app không tạo PublishJob cho TikTok.');
  const fb = Store.createPublishJob('v-fb', { accountId: 'acc-1', decisionId: 'dec-1' });
  assert.equal(fb.ok, false);
  assert.match(fb.error, /chế độ demo/, 'variant không phải TikTok vẫn nhận thông điệp demo chung như cũ');
});

// ---------------------------------------------------------------------------
// SYN-04 — đường remote: missingStamp có mặt ở mọi kết quả lỗi BUDGET_NOT_APPROVED
// ---------------------------------------------------------------------------
function makeFakeClient(handler) {
  const calls = [];
  function from(table) {
    const b = {
      table, op: 'select', payload: null, filters: {},
      insert(p) { this.op = 'insert'; this.payload = p; return this; },
      update(p) { this.op = 'update'; this.payload = p; return this; },
      delete() { this.op = 'delete'; return this; },
      select() { return this; },
      eq(col, val) { this.filters[col] = val; return this; },
      in() { return this; }, order() { return this; }, limit() { return this; }, range() { return this; },
      single() { this.single = true; return this; },
      then(onF, onR) {
        const call = { table: this.table, op: this.op, payload: this.payload, filters: { ...this.filters } };
        calls.push(call);
        return Promise.resolve().then(() => handler(call)).then(onF, onR);
      },
    };
    return b;
  }
  return {
    calls, from,
    rpc(name, args) {
      const call = { rpc: name, args };
      calls.push(call);
      return Promise.resolve().then(() => handler(call));
    },
  };
}

function setupRemote(handler, extraState) {
  resetDemo(extraState);
  Store.mode = 'supabase';
  Store._membership = { role: 'lead' };
  Store.currentUserId = LEAD;
  Store.supabaseClient = makeFakeClient(handler);
  return Store;
}

test('SYN-04 [store/remote]: tiền kiểm local — campaign chưa dấu duyệt → BUDGET_NOT_APPROVED + missingStamp campaign, KHÔNG gọi RPC', async () => {
  let rpcCalled = false;
  setupRemote((call) => {
    if (call.rpc) { rpcCalled = true; return { data: null, error: null }; }
    return { data: [], error: null };
  }, {
    campaigns: [{ id: 'camp-1', name: 'Camp 1', status: 'active', approvedBy: null, approvedAt: null }],
    budgetLines: [{ id: 'bl-1', campaignId: 'camp-1', name: 'Ads', currency: 'VND', approved: 100, approvedBy: OWNER, approvedAt: '2026-11-15T09:00:00Z' }],
    commitments: [{ id: 'cm-1', budgetLineId: 'bl-1', amount: 40, currency: 'VND', status: 'committed', approvalStatus: 'pending', createdBy: OWNER }],
  });
  const r = await Store.decideCommitmentApproval('cm-1', 'approved');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BUDGET_NOT_APPROVED');
  assert.equal(r.missingStamp, 'campaign');
  assert.equal(rpcCalled, false, 'đã chặn ở tiền kiểm local thì không gọi RPC');
  Store.mode = 'demo'; Store.supabaseClient = null;
});

test('SYN-04 [store/remote]: lỗi BUDGET_NOT_APPROVED từ RPC được gắn missingStamp (suy từ thông điệp RPC / mặc định line)', async () => {
  setupRemote((call) => {
    if (call.rpc === 'decide_payment_approval') {
      return { data: null, error: { code: 'P0001', message: 'BUDGET_NOT_APPROVED: campaign chưa có dấu duyệt hạn mức' } };
    }
    if (call.rpc === 'decide_commitment_approval') {
      return { data: null, error: { code: 'P0001', message: 'BUDGET_NOT_APPROVED' } };
    }
    return { data: [], error: null };
  }, {
    // State local KHÔNG có dòng/campaign → tiền kiểm không kết luận được, RPC quyết.
    budgetLines: [], campaigns: [],
    commitments: [{ id: 'cm-1', budgetLineId: 'bl-x', amount: 40, currency: 'VND', status: 'committed', approvalStatus: 'pending', createdBy: OWNER }],
    actuals: [{ id: 'pay-1', budgetLineId: 'bl-x', amount: 10, currency: 'VND', approvalStatus: 'pending', createdBy: OWNER }],
  });
  const rp = await Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(rp.ok, false);
  assert.equal(rp.code, 'BUDGET_NOT_APPROVED');
  assert.equal(rp.missingStamp, 'campaign', 'thông điệp RPC nhắc campaign → missingStamp campaign');
  const rc = await Store.decideCommitmentApproval('cm-1', 'approved');
  assert.equal(rc.ok, false);
  assert.equal(rc.code, 'BUDGET_NOT_APPROVED');
  assert.equal(rc.missingStamp, 'line', 'không suy ra được tầng campaign → mặc định line, trường vẫn có mặt');
  Store.mode = 'demo'; Store.supabaseClient = null;
});

// ---------------------------------------------------------------------------
// SYN-18 — đường remote: strip actual khi đổi nguồn (không insert measurement)
// ---------------------------------------------------------------------------
test('SYN-18 [store/remote]: update kpis auto→manual kèm actual → update chạy, KHÔNG insert measurement cho actual bị strip', async () => {
  const kpiRow = {
    id: 'kpi-auto', workspace_id: WS, name: 'Views tự động', metric_code: 'lifetime_views',
    target_value: 500, unit: 'lượt xem', period_key: '2026-11', target_version: 2,
    definition: { description: 'now manual' },
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-16T00:00:00Z',
  };
  setupRemote((call) => {
    if (call.table === 'kpis' && call.op === 'update') return { data: [kpiRow], error: null };
    if (call.table === 'kpi_target_versions' && call.op === 'insert') return { data: { id: 'ver-2' }, error: null };
    if (call.table === 'measurements' && call.op === 'insert') return { data: [{ id: 'meas-x' }], error: null };
    return { data: [], error: null };
  }, {});
  const r = await Store.update('kpis', 'kpi-auto', {
    definition: { description: 'now manual' },
    actual: 999,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const measIns = Store.supabaseClient.calls.find((c) => c.table === 'measurements' && c.op === 'insert');
  assert.equal(measIns, undefined, 'actual 999 bị strip → không được insert measurement trong cùng thao tác đổi nguồn');
  Store.mode = 'demo'; Store.supabaseClient = null;
});
