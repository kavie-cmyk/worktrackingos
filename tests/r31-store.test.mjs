// tests/r31-store.test.mjs
// CẬP NHẬT 0014 (chuỗi duyệt ngân sách): test AC10 [store] bên dưới đã sửa —
// Store._toPayload('budgetLines', …) KHÔNG còn gửi approved_amount khi
// create/update nữa (số duyệt chỉ đổi qua RPC decide_budget_proposal; guard
// DB chặn 42501 nếu gửi qua REST thường). Kỳ vọng cũ "payload giữ
// approved_amount" là semantics TRƯỚC 0014 nên phải đổi; planned_amount vẫn
// giữ nguyên. Mapping approved ↔ approved_amount ở tầng store-core
// (toDbPayload/fromDbRow) KHÔNG đổi — chỉ đường ghi của Store bị strip.
// R3.1 — hợp đồng Store/adapter: mapping + payload round-trip các field mới
// (planned độc lập, actual title/description tách, KPI scope/definition,
// metadata activity/variant/brand, idempotency AC09, capacity thật R3-09,
// scope AC04, allocations, cash, baselines). Mọi kiểm chứng ở tầng
// payload/demo-state/mock — không đụng DB live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
require('../js/domain.js'); // nạp SAVA_DOMAIN cho validateAllocations
const Store = require('../js/store.js');

const WS = 'ws-1';
const U1 = '11111111-1111-1111-1111-111111111111';
const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACT1 = 'ac111111-1111-1111-1111-111111111111';
const TASK1 = 'ta111111-1111-1111-1111-111111111111';

function resetDemo(extraState) {
  Store.mode = 'demo';
  Store.workspaceId = WS;
  Store.currentUserId = U1;
  Store._membership = null;
  Store.state = Object.assign({
    members: [{ id: U1, name: 'Owner', role: 'owner', capacityHoursPerWeek: null, daysOff: null }],
    activities: [{ id: ACT1, name: 'Ads', campaignId: CAMP_A }],
    tasks: [{ id: TASK1, title: 'Việc 1', campaignId: CAMP_A, activityId: ACT1 }],
    budgetLines: [], commitments: [], actuals: [], kpis: [], budgetAllocations: [],
    campaignBaselines: [], campaignAssets: [], brandPageVersions: [], kpiTargetVersions: [],
    cashAccounts: [], cashCategories: [], cashTransactions: [], campaigns: [{ id: CAMP_A, name: 'Camp A', status: 'active' }],
  }, extraState || {});
  Store.loadState = {};
  return Store;
}

// ---------------------------------------------------------------------------
// R3-05 / AC10 — planned 1200 ≠ approved 1000, round-trip hai chiều
// ---------------------------------------------------------------------------
test('AC10 [store]: budgetLines payload giữ planned_amount riêng + activity/task; approved_amount bị strip (0014)', () => {
  resetDemo();
  const payload = Store._toPayload('budgetLines', {
    name: 'Ads', planned: 1200, approved: 1000, campaignId: CAMP_A, activityId: ACT1, taskId: TASK1, currency: 'VND',
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.planned_amount, 1200);
  // 0014: số duyệt KHÔNG gửi qua create/update thường nữa — chỉ đổi khi
  // Owner duyệt đề xuất qua RPC decide_budget_proposal.
  assert.ok(!('approved_amount' in payload), 'create budget line không được gửi approved_amount (0014)');
  assert.equal(payload.activity_id, ACT1, 'R3-02: payload phải có activity_id');
  assert.equal(payload.task_id, TASK1, 'R3-02: payload phải có task_id');
  // Tầng store-core vẫn map approved ↔ approved_amount hai chiều (đọc +
  // RPC trả về vẫn cần) — chỉ Store strip khi ghi:
  assert.equal(core.toDbPayload('budgetLines', { name: 'Ads', approved: 1000 }).approved_amount, 1000);
});

test('AC10 [store]: read budgetLines — planned từ planned_amount, KHÔNG fallback approved; chưa có planned → null', () => {
  resetDemo();
  const item = Store._rowToItem('budgetLines', { id: 'bl1', planned_amount: 1200, approved_amount: 1000, activity_id: ACT1, task_id: TASK1 });
  assert.equal(item.planned, 1200);
  assert.equal(item.plannedAmount, 1200);
  assert.equal(item.approved, 1000);
  assert.equal(item.activityId, ACT1);
  assert.equal(item.taskId, TASK1);
  const noPlan = Store._rowToItem('budgetLines', { id: 'bl2', planned_amount: null, approved_amount: 1000 });
  assert.equal(noPlan.planned, null, 'planned_amount null thì planned phải null — không được gán bằng approved');
});

// ---------------------------------------------------------------------------
// R3-07 / AC11 — actual title vs description tách hẳn
// ---------------------------------------------------------------------------
test('AC11 [store]: actual payload có title VÀ description riêng; read round-trip không đè nhau', () => {
  resetDemo();
  const payload = Store._toPayload('actuals', {
    budgetLineId: 'bl1', title: 'Chi ads', description: 'Hóa đơn HD01', amount: 400, commitmentId: 'cm1',
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.title, 'Chi ads');
  assert.equal(payload.description, 'Hóa đơn HD01');
  assert.equal(payload.commitment_id, 'cm1');
  assert.ok(payload.idempotency_key, 'payment create phải gửi idempotency_key xuống backend');
  const back = Store._rowToItem('actuals', { id: 'a1', ...payload });
  assert.equal(back.title, 'Chi ads');
  assert.equal(back.description, 'Hóa đơn HD01');
});

test('AC11 [store]: ghi chú rỗng không xoá title của actual', () => {
  resetDemo();
  const payload = Store._toPayload('actuals', { budgetLineId: 'bl1', title: 'Chi ads', description: '', amount: 10 }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.title, 'Chi ads');
  assert.equal(payload.description, '');
  const back = Store._rowToItem('actuals', { id: 'a2', ...payload });
  assert.equal(back.title, 'Chi ads', 'note rỗng không được làm mất tên khoản chi');
});

// ---------------------------------------------------------------------------
// AC09 — idempotency ở tầng store (demo/mock adapter)
// ---------------------------------------------------------------------------
test('AC09 [store]: retry payment cùng idempotency_key không tạo bản ghi thứ hai', () => {
  resetDemo();
  const first = Store.create('actuals', { budgetLineId: 'bl1', title: 'Chi ads', amount: 400, idempotencyKey: 'pay-key-1' });
  assert.equal(first.ok, true);
  assert.equal(first.item.idempotencyKey, 'pay-key-1', 'key caller cấp phải được giữ nguyên');
  const retry = Store.create('actuals', { budgetLineId: 'bl1', title: 'Chi ads', amount: 400, idempotencyKey: 'pay-key-1' });
  assert.equal(retry.ok, true);
  assert.equal(retry.deduped, true);
  assert.equal(Store.state.actuals.length, 1, 'retry cùng key không được tạo bản ghi thứ hai');
  const auto = Store.create('actuals', { budgetLineId: 'bl1', title: 'Chi khác', amount: 50 });
  assert.equal(auto.ok, true);
  assert.ok(auto.item.idempotencyKey, 'tạo payment không truyền key → store sinh key và giữ trên item');
  assert.equal(Store.state.actuals.length, 2);
});

// ---------------------------------------------------------------------------
// R3-01 — KPI payload đủ scope/definition
// ---------------------------------------------------------------------------
test('R3-01 [store]: KPI payload có activityId/taskId/definition/scope_type/metric_code/aggregation/target_version', () => {
  resetDemo();
  const payload = Store._toPayload('kpis', {
    name: 'Leads từ ads', campaignId: CAMP_A, activityId: ACT1, taskId: TASK1,
    definition: { how: 'Đếm lead hợp lệ', source: 'CRM' }, metricCode: 'leads',
    aggregationMode: 'sum', target: 500, unit: 'lead',
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.activity_id, ACT1);
  assert.equal(payload.task_id, TASK1);
  assert.equal(payload.campaign_id, CAMP_A);
  assert.equal(payload.metric_code, 'leads');
  assert.deepEqual(payload.definition, { how: 'Đếm lead hợp lệ', source: 'CRM' });
  assert.equal(payload.aggregation_mode, 'sum');
  const back = Store._rowToItem('kpis', { id: 'k1', ...payload, target_value: 500, scope_type: 'activity', target_version: 1 });
  assert.equal(back.activityId, ACT1);
  assert.equal(back.taskId, TASK1);
  assert.deepEqual(back.definition, { how: 'Đếm lead hợp lệ', source: 'CRM' });
  assert.equal(back.scopeType, 'activity');
});

test('R3-01 [store]: đổi target KPI → target_version tăng + ghi kpi_target_versions (demo)', () => {
  resetDemo();
  const c = Store.create('kpis', { id: 'kpi-1', name: 'Leads', target: 100, campaignId: CAMP_A });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(Store.state.kpiTargetVersions.filter((v) => v.kpiId === 'kpi-1').length, 1);
  const u = Store.update('kpis', 'kpi-1', { target: 250 });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.item.targetVersion, 2);
  const vers = Store.state.kpiTargetVersions.filter((v) => v.kpiId === 'kpi-1');
  assert.equal(vers.length, 2);
  assert.equal(vers[1].version, 2);
  assert.equal(vers[1].targetValue, 250);
  const payload = Store._toPayload('kpis', { target: 300 }, { currentItem: Store.get('kpis', 'kpi-1') });
  assert.equal(payload.target_version, 3, 'payload update đổi target phải mang target_version mới');
});

// ---------------------------------------------------------------------------
// R3-03 — content: pillar/series/source, campaign nullable
// ---------------------------------------------------------------------------
test('R3-03 [store]: content payload có pillarId/series/sourceContentId; campaign null vẫn hợp lệ', () => {
  resetDemo();
  const payload = Store._toPayload('contentItems', {
    title: 'Bài A', pillarId: 'pil-1', series: 'Series 1', sourceContentId: 'ci-0', campaignId: null,
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.pillar_id, 'pil-1');
  assert.equal(payload.series, 'Series 1');
  assert.equal(payload.source_content_id, 'ci-0');
  assert.equal(payload.campaign_id, null, 'campaign là tùy chọn — null phải được giữ, không ép');
  assert.ok(!('activity_id' in payload) || payload.activity_id == null, 'không ép activity_id cho content');
  const back = Store._rowToItem('contentItems', { id: 'ci1', ...payload, status: 'draft' });
  assert.equal(back.pillarId, 'pil-1');
  assert.equal(back.series, 'Series 1');
  assert.equal(back.sourceContentId, 'ci-0');
});

// ---------------------------------------------------------------------------
// AC18 tầng store — metadata activity / variant / brand round-trip
// ---------------------------------------------------------------------------
test('AC18 [store]: activity owner/channel/deliverables/objective round-trip', () => {
  resetDemo();
  const payload = Store._toPayload('activities', {
    name: 'Chạy ads', campaignId: CAMP_A, ownerId: U1, channel: 'facebook', deliverables: ['Báo cáo tuần'], objective: 'Lead',
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.owner_id, U1);
  assert.equal(payload.channel, 'facebook');
  assert.deepEqual(payload.deliverables, ['Báo cáo tuần']);
  const back = Store._rowToItem('activities', { id: ACT1, ...payload });
  assert.equal(back.ownerId, U1);
  assert.equal(back.channel, 'facebook');
  assert.deepEqual(back.deliverables, ['Báo cáo tuần']);
  assert.equal(back.objective, 'Lead');
});

test('AC18 [store]: variant owner/reviewer/production_deadline/brief round-trip', () => {
  resetDemo();
  const payload = Store._toPayload('variants', {
    contentItemId: 'ci1', platform: 'facebook', ownerId: U1, reviewerId: U1,
    productionDeadline: '2026-11-20T10:00:00.000Z', brief: 'Brief ngắn',
  }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.owner_id, U1);
  assert.equal(payload.reviewer_id, U1);
  assert.equal(payload.production_deadline, '2026-11-20T10:00:00.000Z');
  assert.equal(payload.brief, 'Brief ngắn');
  const back = Store._rowToItem('variants', { id: 'v1', ...payload });
  assert.equal(back.ownerId, U1);
  assert.equal(back.reviewerId, U1);
  assert.equal(back.brief, 'Brief ngắn');
});

test('AC18 [store]: brand page owner/tags round-trip + sửa nội dung ghi brand_page_versions (demo)', () => {
  resetDemo({ brandPages: [{ id: 'bp1', name: 'Page A', version: 1 }] });
  const payload = Store._toPayload('brandPages', { name: 'Page A', ownerId: U1, tags: ['hero', '2026'] }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.owner_id, U1);
  assert.deepEqual(payload.tags, ['hero', '2026']);
  const back = Store._rowToItem('brandPages', { id: 'bp1', ...payload, guidelines: {} });
  assert.equal(back.ownerId, U1);
  assert.deepEqual(back.tags, ['hero', '2026']);
  const u = Store.update('brandPages', 'bp1', { name: 'Page A2' });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.item.version, 2);
  const vers = Store.listBrandPageVersions('bp1');
  assert.equal(vers.length, 1);
  assert.equal(vers[0].version, 2);
  assert.equal(vers[0].snapshot.name, 'Page A2');
});

test('R3 [store]: tasks.is_milestone có trong payload + read', () => {
  const payload = core.toDbPayload('tasks', { title: 'Mốc', isMilestone: true });
  assert.equal(payload.is_milestone, true);
  const back = core.fromDbRow('tasks', { id: 't1', is_milestone: true });
  assert.equal(back.isMilestone, true);
});

// ---------------------------------------------------------------------------
// AC04 tầng store — suy campaign từ activity + chặn mâu thuẫn
// ---------------------------------------------------------------------------
test('AC04 [store]: tạo budget line chỉ với activityId → campaignId suy ra từ activity', () => {
  resetDemo();
  const r = Store.create('budgetLines', { id: 'bl-scope', name: 'Ads', activityId: ACT1, approved: 100 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.item.campaignId, CAMP_A);
});

test('AC04 [store]: campaignId mâu thuẫn activity → lỗi R31_SCOPE rõ trước khi gửi', () => {
  resetDemo();
  const r = Store.create('budgetLines', { id: 'bl-bad', name: 'Ads', activityId: ACT1, campaignId: CAMP_B, approved: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /R31_SCOPE/);
  const k = Store.create('kpis', { id: 'kpi-bad', name: 'X', activityId: ACT1, campaignId: CAMP_B, target: 1 });
  assert.equal(k.ok, false);
  assert.match(k.error, /R31_SCOPE/);
});

// ---------------------------------------------------------------------------
// Allocations — pre-validate domain + đúng 1 nguồn
// ---------------------------------------------------------------------------
test('R3 [store]: allocation hợp lệ qua domain.validateAllocations; vượt trần nguồn → lỗi R31_ALLOC sớm', () => {
  resetDemo({ actuals: [{ id: 'act-1', budgetLineId: 'bl1', amount: 300, title: 'Chi ads' }] });
  const okR = Store.create('budgetAllocations', { id: 'al1', sourceKind: 'actual', actualId: 'act-1', campaignId: CAMP_A, activityId: ACT1, amount: 180 });
  assert.equal(okR.ok, true, JSON.stringify(okR));
  const over = Store.create('budgetAllocations', { id: 'al2', sourceKind: 'actual', actualId: 'act-1', campaignId: CAMP_A, amount: 200 });
  assert.equal(over.ok, false, 'tổng 180+200 > 300 phải bị chặn');
  assert.match(over.error, /R31_ALLOC/);
  const both = Store.create('budgetAllocations', { id: 'al3', sourceKind: 'actual', actualId: 'act-1', commitmentId: 'cm1', campaignId: CAMP_A, amount: 10 });
  assert.equal(both.ok, false, 'allocation phải có đúng 1 nguồn');
  assert.equal(Store.listAllocationsForSource('actual', 'act-1').length, 1);
});

// ---------------------------------------------------------------------------
// Cash (Thu–Chi) — tách hẳn budget, số dư từ transactions
// ---------------------------------------------------------------------------
test('R3-10 [store]: cash CRUD + số dư opening + in − out; transaction giữ campaign/activity nullable + idempotency', () => {
  resetDemo();
  const acc = Store.create('cashAccounts', { id: 'cash-1', name: 'Quỹ tiền mặt', currency: 'VND', openingBalance: 1000 });
  assert.equal(acc.ok, true, JSON.stringify(acc));
  const t1 = Store.create('cashTransactions', { id: 'ct1', accountId: 'cash-1', direction: 'in', amount: 500, occurredOn: '2026-11-12', campaignId: CAMP_A, activityId: null });
  assert.equal(t1.ok, true, JSON.stringify(t1));
  assert.ok(t1.item.idempotencyKey, 'cash transaction phải có idempotency_key');
  const t2 = Store.create('cashTransactions', { id: 'ct2', accountId: 'cash-1', direction: 'out', amount: 200, occurredOn: '2026-11-12' });
  assert.equal(t2.ok, true);
  assert.equal(t2.item.campaignId, undefined, 'không truyền campaign thì để trống (nullable), không bịa');
  const bal = Store.cashBalance('cash-1');
  assert.equal(bal.balance, 1300);
  assert.equal(Store.state.budgetLines.length, 0, 'cash không được map nhầm thành budget lines');
  const payload = Store._toPayload('cashTransactions', { accountId: 'cash-1', direction: 'out', amount: 5, campaignId: null, activityId: ACT1 }, { workspaceId: WS, forInsert: true });
  assert.equal(payload.campaign_id, null);
  assert.equal(payload.activity_id, ACT1);
  assert.ok(payload.idempotency_key);
});

// ---------------------------------------------------------------------------
// Campaign baselines — version mới không ghi đè version cũ
// ---------------------------------------------------------------------------
test('R3 [store]: createCampaignBaseline tạo version+1 snapshot mới, version cũ nguyên vẹn', () => {
  resetDemo();
  const b1 = Store.createCampaignBaseline(CAMP_A, { note: 'Chốt lần 1' });
  assert.equal(b1.ok, true);
  assert.equal(b1.item.version, 1);
  const snap1 = JSON.stringify(b1.item.snapshot);
  const b2 = Store.createCampaignBaseline(CAMP_A, { snapshot: { name: 'Camp A v2' }, note: 'Chốt lần 2' });
  assert.equal(b2.item.version, 2);
  const list = Store.listCampaignBaselines(CAMP_A);
  assert.equal(list.length, 2);
  assert.equal(list[0].version, 2);
  assert.equal(JSON.stringify(list.find((b) => b.version === 1).snapshot), snap1, 'baseline cũ không bị ghi đè');
});

// ---------------------------------------------------------------------------
// Campaign assets — link/unlink/list
// ---------------------------------------------------------------------------
test('R3 [store]: linkCampaignAsset/unlinkCampaignAsset/listCampaignAssets theo campaign', () => {
  resetDemo();
  const r = Store.linkCampaignAsset(CAMP_A, 'asset-1', { role: 'KV' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(Store.listCampaignAssets(CAMP_A).length, 1);
  const u = Store.unlinkCampaignAsset(CAMP_A, 'asset-1');
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(Store.listCampaignAssets(CAMP_A).length, 0);
});

// ---------------------------------------------------------------------------
// R3-09 — capacity: không còn 40 mặc định (mock Supabase client + RPC)
// ---------------------------------------------------------------------------
function mockClient({ memberships, users, capacityRows }) {
  function builder(table, rows) {
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, order() { return b; },
      range() { return Promise.resolve({ data: rows, error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
    };
    return b;
  }
  return {
    calls: [],
    from(table) {
      if (table === 'memberships') return builder(table, memberships);
      if (table === 'users') return builder(table, users);
      if (table === 'member_capacity') return builder(table, capacityRows);
      return builder(table, []);
    },
    rpc(name, args) {
      this.calls.push({ name, args });
      if (name === 'get_member_capacity') return Promise.resolve({ data: capacityRows, error: null });
      return Promise.resolve({ data: null, error: { message: 'rpc lạ' } });
    },
  };
}

test('R3-09 [store]: _loadMembers nạp capacity thật 32h qua RPC; member chưa cấu hình → null, KHÔNG phải 40', async () => {
  const U2 = '22222222-2222-2222-2222-222222222222';
  Store.mode = 'supabase';
  Store.workspaceId = WS;
  Store.supabaseClient = mockClient({
    memberships: [
      { id: 'm1', user_id: U1, workspace_id: WS, role: 'lead', is_active: true, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
      { id: 'm2', user_id: U2, workspace_id: WS, role: 'member', is_active: true, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
    ],
    users: [
      { id: U1, display_name: 'Lead A', email: 'a@x.vn' },
      { id: U2, display_name: 'Member B', email: 'b@x.vn' },
    ],
    capacityRows: [
      { id: 'cap1', workspace_id: WS, user_id: U1, hours_per_week: 32, days_off: ['2026-11-15'], created_at: '2026-11-10T00:00:00Z' },
    ],
  });
  Store.state = { members: [] };
  await Store._loadMembers();
  const lead = Store.get('members', U1);
  assert.equal(lead.capacityHoursPerWeek, 32, 'capacity phải lấy từ member_capacity, không hardcode');
  assert.deepEqual(lead.daysOff, ['2026-11-15']);
  const member = Store.get('members', U2);
  assert.equal(member.capacityHoursPerWeek, null, 'chưa cấu hình capacity → null (chưa đủ dữ liệu), KHÔNG tự gán 40');
  assert.equal(Store.getMemberCapacity(U2), null);
  assert.deepEqual(Store.capacityByMember()[U1], { hoursPerWeek: 32, daysOff: ['2026-11-15'] });
  assert.ok(Store.supabaseClient.calls.some((c) => c.name === 'get_member_capacity'), 'phải gọi RPC get_member_capacity');
  Store.mode = 'demo';
  Store.supabaseClient = null;
});

test('R3-09 [store]: saveMemberCapacity (demo) ghi capacity thật lên member', () => {
  resetDemo();
  const r = Store.saveMemberCapacity(U1, { hoursPerWeek: 24, daysOff: ['2026-11-20'] });
  assert.equal(r.ok, true);
  assert.equal(Store.get('members', U1).capacityHoursPerWeek, 24);
  assert.deepEqual(Store.getMemberCapacity(U1), { hoursPerWeek: 24, daysOff: ['2026-11-20'], effectiveFrom: null, effectiveTo: null });
});

// ---------------------------------------------------------------------------
// Mapping bảng mới trong store-core
// ---------------------------------------------------------------------------
test('R3 [store-core]: collection mới map đúng bảng + có danh sách cột', () => {
  const expected = {
    contentPillars: 'content_pillars', kpiTargetVersions: 'kpi_target_versions',
    kpiContributions: 'kpi_contributions', brandPageVersions: 'brand_page_versions',
    campaignBaselines: 'campaign_baselines', campaignAssets: 'campaign_assets',
    budgetAllocations: 'budget_allocations', cashAccounts: 'cash_accounts',
    cashCategories: 'cash_categories', cashTransactions: 'cash_transactions',
  };
  for (const [col, table] of Object.entries(expected)) {
    assert.equal(core.COLLECTION_TO_TABLE[col], table, `${col} → ${table}`);
    assert.ok(core.TABLE_COLUMNS[table]?.length, `thiếu cột cho ${table}`);
  }
  const contrib = core.toDbPayload('kpiContributions', { kpiId: 'k1', sourceKpiId: 'k0', rule: 'sum', dedupKeyField: 'lead_id' });
  assert.equal(contrib.source_kpi_id, 'k0');
  assert.equal(contrib.rule, 'sum');
  assert.equal(contrib.dedup_key_field, 'lead_id');
});
