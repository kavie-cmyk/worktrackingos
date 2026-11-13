// tests/budget-approval-chain.test.mjs
// Chuỗi duyệt ngân sách (0014): ĐỀ XUẤT → Owner duyệt hạn mức/dòng →
// cam kết/khoản chi chờ duyệt → lead/owner duyệt fact theo UsageTotal.
//   - domain: factApprovalStatus/isApprovedFact, budgetUsageTotal,
//     budgetRemaining refactor, summarizeBudgetScope lọc fact chưa duyệt;
//     fixture R3.1 D.1/D.2 PHẢI giữ nguyên số khi mọi fact đã duyệt.
//   - store-core: mapping budget_proposals + cột mới + ma trận quyền
//     budget.propose / budget.decide.
//   - store: strip approved/ceiling ở payload + demo state, fact mới
//     'pending', createBudgetProposal / decideBudgetProposal /
//     decideCommitmentApproval / decidePaymentApproval (demo + remote RPC).
// Mọi kiểm chứng ở tầng domain/payload/demo-state/mock — không đụng DB live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
const domain = require('../js/domain.js');
require('../js/domain.js'); // nạp SAVA_DOMAIN cho Store._domain()
const Store = require('../js/store.js');
const demo = require('../js/demo-data.js');

const WS = 'ws-1';
const OWNER = 'u-owner';
const LEAD = 'u-lead';
const MEMBER = 'u-member';
const CEO = 'u-ceo';
const M = 1000000;

const EMPTY_COLLECTIONS = () => Object.fromEntries(Store.COLLECTIONS.map((k) => [k, []]));

function resetDemo(extraState) {
  Store.mode = 'demo';
  Store.supabaseClient = null;
  Store.workspaceId = WS;
  Store._membership = null;
  Store.currentUserId = OWNER;
  Store.state = Object.assign(EMPTY_COLLECTIONS(), {
    members: [
      { id: OWNER, name: 'Owner', role: 'owner', capacityHoursPerWeek: null, daysOff: null },
      { id: LEAD, name: 'Lead', role: 'lead', capacityHoursPerWeek: null, daysOff: null },
      { id: MEMBER, name: 'Member', role: 'member', capacityHoursPerWeek: null, daysOff: null },
      { id: CEO, name: 'CEO', role: 'ceo', capacityHoursPerWeek: null, daysOff: null },
    ],
    campaigns: [{ id: 'camp-1', name: 'Camp 1', status: 'active', budgetCeiling: null, budgetCeilingCurrency: null, approvedBy: null, approvedAt: null, approvedViaProposalId: null }],
    budgetLines: [], commitments: [], actuals: [], budgetProposals: [],
  }, extraState || {});
  Store.loadState = {};
  Store._postMappings = [];
  return Store;
}

function asUser(id) { Store.currentUserId = id; }

function approvedLine(extra) {
  return Object.assign({
    id: 'bl-1', campaignId: 'camp-1', name: 'Ads', currency: 'VND',
    planned: 120, approved: 100, approvedBy: OWNER,
    approvedAt: '2026-11-15T09:00:00Z', approvedViaProposalId: 'prop-seed',
  }, extra || {});
}

// ---------------------------------------------------------------------------
// Domain — trạng thái duyệt của fact
// ---------------------------------------------------------------------------
test('0014 [domain]: factApprovalStatus đọc camel + snake; thiếu/null → null', () => {
  assert.equal(domain.factApprovalStatus({ approvalStatus: 'pending' }), 'pending');
  assert.equal(domain.factApprovalStatus({ approval_status: 'rejected' }), 'rejected');
  assert.equal(domain.factApprovalStatus({ approvalStatus: 'APPROVED' }), 'approved');
  assert.equal(domain.factApprovalStatus({}), null);
  assert.equal(domain.factApprovalStatus({ approvalStatus: null }), null);
  assert.equal(domain.factApprovalStatus(null), null);
});

test('0014 [domain]: isApprovedFact — thiếu trạng thái coi như approved (tương thích cũ); pending/rejected → false', () => {
  assert.equal(domain.isApprovedFact({}), true);
  assert.equal(domain.isApprovedFact({ approvalStatus: null }), true);
  assert.equal(domain.isApprovedFact({ approvalStatus: 'approved' }), true);
  assert.equal(domain.isApprovedFact({ approvalStatus: 'pending' }), false);
  assert.equal(domain.isApprovedFact({ approvalStatus: 'rejected' }), false);
  assert.equal(domain.isApprovedFact({ approval_status: 'pending' }), false);
});

// ---------------------------------------------------------------------------
// Domain — budgetUsageTotal / budgetRemaining
// ---------------------------------------------------------------------------
test('0014 [domain]: budgetUsageTotal chỉ tính fact ĐÃ DUYỆT + cùng currency; cancelled/archived bị bỏ; settledAmount bị bỏ qua', () => {
  const line = { approved: 100, currency: 'VND' };
  const actuals = [
    { id: 'a1', amount: 30, currency: 'VND', commitmentId: 'c1', approvalStatus: 'approved' },
    { id: 'a2', amount: 20, currency: 'VND', approvalStatus: 'pending' },
    { id: 'a3', amount: 5, currency: 'VND', commitmentId: 'c1', approvalStatus: 'rejected' },
    { id: 'a4', amount: 7, currency: 'USD', approvalStatus: 'approved' },
  ];
  const commitments = [
    { id: 'c1', amount: 50, currency: 'VND', status: 'committed', approvalStatus: 'approved', settledAmount: 999 },
    { id: 'c2', amount: 40, currency: 'VND', status: 'committed', approvalStatus: 'pending' },
    { id: 'c3', amount: 40, currency: 'VND', status: 'cancelled', approvalStatus: 'approved' },
    { id: 'c4', amount: 40, currency: 'VND', status: 'committed', approvalStatus: 'approved', archivedAt: '2026-11-20T00:00:00Z' },
    { id: 'c5', amount: 10, currency: 'USD', status: 'committed', approvalStatus: 'approved' },
  ];
  // usage = actual đã duyệt cùng VND (30) + nghĩa vụ c1: max(0, 50 − 30) = 20 → 50.
  // a3 rejected KHÔNG giảm nghĩa vụ c1; settledAmount 999 bị bỏ qua.
  assert.equal(domain.budgetUsageTotal(line, commitments, actuals), 50);
  assert.equal(domain.budgetRemaining(line, commitments, actuals), 50);
});

test('0014 [domain]: budgetRemaining giữ nguyên kết quả cũ khi fact không mang trạng thái duyệt (fixture R2)', () => {
  const commitments = [{ id: 'C1', amount: 1000, status: 'partially_actualised', settledAmount: 0 }];
  const actuals = [{ amount: 400, commitmentId: 'C1' }];
  assert.equal(domain.commitmentPaidTotal({ id: 'C1' }, actuals), 400);
  assert.equal(domain.openCommitmentTotal(commitments, actuals), 600);
  assert.equal(domain.budgetUsageTotal({ approved: 1000 }, commitments, actuals), 1000);
  assert.equal(domain.budgetRemaining({ approved: 1000 }, commitments, actuals), 0);
});

test('0014 [domain]: commitmentPaidTotal/openCommitmentTotal lọc fact chưa duyệt', () => {
  const actuals = [
    { amount: 300, commitmentId: 'C1', approvalStatus: 'approved' },
    { amount: 200, commitmentId: 'C1', approvalStatus: 'pending' },
  ];
  assert.equal(domain.commitmentPaidTotal({ id: 'C1' }, actuals), 300, 'chỉ actual đã duyệt mới là đã trả');
  assert.equal(domain.openCommitmentTotal([{ id: 'C1', amount: 1000, status: 'committed', approvalStatus: 'approved' }], actuals), 700);
  assert.equal(domain.openCommitmentTotal([{ id: 'C1', amount: 1000, status: 'committed', approvalStatus: 'pending' }], actuals), 0);
  assert.equal(domain.openCommitmentTotal([{ id: 'C1', amount: 1000, status: 'committed', approvalStatus: 'approved', archived_at: '2026-11-20' }], actuals), 0);
});

// ---------------------------------------------------------------------------
// Domain — summarizeBudgetScope lọc theo trạng thái duyệt + D.1 giữ số
// ---------------------------------------------------------------------------
const ACTIONS = [
  { id: 'act-invite', allocated: 8, actual: 6, open: 2 },
  { id: 'act-ads', allocated: 15, actual: 10, open: 4 },
  { id: 'act-seeding', allocated: 5, actual: 3, open: 1 },
  { id: 'act-live', allocated: 2, actual: 1.5, open: 0.5 },
];
function livestreamFacts(statusFor) {
  const commitments = [];
  const actuals = [];
  for (const a of ACTIONS) {
    commitments.push({
      id: `com-${a.id}`, kind: 'commitment', amount: a.actual + a.open, status: 'committed',
      currency: 'VND', activityId: a.id, approvalStatus: statusFor ? statusFor('commitment', a.id) : 'approved',
    });
    actuals.push({
      id: `pay-${a.id}`, kind: 'actual', amount: a.actual, commitmentId: `com-${a.id}`,
      currency: 'VND', activityId: a.id, approvalStatus: statusFor ? statusFor('actual', a.id) : 'approved',
    });
  }
  return { commitments, actuals };
}
function childAllocations() {
  return ACTIONS.map((a) => ({ id: `alloc-${a.id}`, scopeId: a.id, amount: a.allocated, currency: 'VND' }));
}

test('0014 [domain]: fixture D.1 GIỮ NGUYÊN số khi mọi fact đã duyệt (30 / 20.5 / 7.5 / 28 / 2 / 4)', () => {
  const { commitments, actuals } = livestreamFacts();
  const s = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), commitments, actuals,
  });
  assert.equal(s.allocated, 30);
  assert.equal(s.actualTotal, 20.5);
  assert.equal(s.openCommitments, 7.5);
  assert.equal(s.forecastUse, 28);
  assert.equal(s.unallocated, 2);
  assert.equal(s.available, 4);
});

test('0014 [domain]: summarizeBudgetScope loại commitment pending khỏi mọi tổng (kể cả qua input.facts)', () => {
  const { commitments, actuals } = livestreamFacts((kind, id) => (kind === 'commitment' && id === 'act-seeding' ? 'pending' : 'approved'));
  const s = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), commitments, actuals,
  });
  assert.equal(s.actualTotal, 20.5, 'actual của seeding vẫn đã duyệt nên vẫn tính');
  assert.equal(s.openCommitments, 6.5, 'nghĩa vụ mở của seeding (1) bị loại vì commitment pending');
  assert.equal(s.forecastUse, 27);
  assert.equal(s.available, 5);
  // Cùng kết quả khi truyền hỗn hợp qua input.facts:
  const mixed = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), facts: [...commitments, ...actuals],
  });
  assert.equal(mixed.actualTotal, 20.5);
  assert.equal(mixed.openCommitments, 6.5);
  assert.equal(mixed.available, 5);
});

test('0014 [domain]: allocation gắn với fact bị loại (actual pending) không tính vào scope nào', () => {
  const invoice = {
    id: 'pay-shared-pending', kind: 'actual', amount: 3, currency: 'VND', approvalStatus: 'pending',
    allocations: [{ scopeId: 'act-ads', ratio: 0.6 }, { scopeId: 'act-seeding', ratio: 0.4 }],
  };
  const { commitments, actuals } = livestreamFacts();
  const withInvoice = [...actuals, invoice];
  const campaign = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), commitments, actuals: withInvoice,
  });
  assert.equal(campaign.actualTotal, 20.5, 'hóa đơn pending không cộng vào campaign');
  const ads = domain.summarizeBudgetScope({ ceiling: 15, currency: 'VND', scopeId: 'act-ads', commitments, actuals: withInvoice });
  assert.equal(ads.actualTotal, 10, 'share 60% của fact pending không tính cho Ads');
});

// ---------------------------------------------------------------------------
// Store-core — mapping + quyền mới
// ---------------------------------------------------------------------------
test('0014 [core]: budgetProposals map đúng bảng budget_proposals + đủ cột; payload/read round-trip', () => {
  assert.equal(core.COLLECTION_TO_TABLE.budgetProposals, 'budget_proposals');
  for (const col of ['target_type', 'campaign_id', 'budget_line_id', 'proposed_amount', 'currency', 'reason', 'proposer_id', 'status', 'decided_by', 'decided_at', 'decision_note', 'revision']) {
    assert.ok(core.hasColumn('budget_proposals', col), `thiếu cột ${col}`);
  }
  const payload = core.toDbPayload('budgetProposals', {
    targetType: 'budget_line', campaignId: 'camp-1', budgetLineId: 'bl-1', proposedAmount: 120,
    currency: 'VND', reason: 'Tăng trần', proposerId: OWNER, status: 'pending', revision: 1,
  }, { workspaceId: WS });
  assert.equal(payload.target_type, 'budget_line');
  assert.equal(payload.proposed_amount, 120);
  assert.equal(payload.proposer_id, OWNER);
  const back = core.fromDbRow('budgetProposals', { id: 'p1', ...payload, decided_by: OWNER, decided_at: '2026-11-16T00:00:00Z', decision_note: 'OK' });
  assert.equal(back.targetType, 'budget_line');
  assert.equal(back.budgetLineId, 'bl-1');
  assert.equal(back.proposedAmount, 120);
  assert.equal(back.decidedBy, OWNER);
  assert.equal(back.decisionNote, 'OK');
});

test('0014 [core]: cột mới trên budget_lines/campaigns/commitments/actuals round-trip (approval + dấu duyệt)', () => {
  for (const col of ['approved_by', 'approved_at', 'approved_via_proposal_id']) {
    assert.ok(core.hasColumn('budget_lines', col), `budget_lines thiếu ${col}`);
    assert.ok(core.hasColumn('campaigns', col), `campaigns thiếu ${col}`);
  }
  for (const col of ['approval_status', 'approved_by', 'approved_at', 'approval_note']) {
    assert.ok(core.hasColumn('budget_commitments', col), `budget_commitments thiếu ${col}`);
    assert.ok(core.hasColumn('budget_actuals', col), `budget_actuals thiếu ${col}`);
  }
  const cm = core.toDbPayload('commitments', { budgetLineId: 'bl-1', amount: 5, approvalStatus: 'pending', approvedBy: LEAD, approvalNote: 'ghi chú' });
  assert.equal(cm.approval_status, 'pending');
  assert.equal(cm.approved_by, LEAD);
  assert.equal(cm.approval_note, 'ghi chú');
  const line = core.fromDbRow('budgetLines', { id: 'bl-1', approved_by: OWNER, approved_at: '2026-11-15T00:00:00Z', approved_via_proposal_id: 'p1' });
  assert.equal(line.approvedBy, OWNER);
  assert.equal(line.approvedViaProposalId, 'p1');
  const camp = core.fromDbRow('campaigns', { id: 'c1', approved_by: OWNER, approved_at: '2026-11-15T00:00:00Z', approved_via_proposal_id: 'p2' });
  assert.equal(camp.approvedBy, OWNER);
  assert.equal(camp.approvedViaProposalId, 'p2');
});

test('0014 [core]: ma trận quyền — budget.propose owner/lead/member, budget.decide CHỈ owner; approval.decide giữ nguyên lead+owner', () => {
  assert.ok(core.PERMISSION_ACTIONS.includes('budget.propose'));
  assert.ok(core.PERMISSION_ACTIONS.includes('budget.decide'));
  assert.equal(core.canRole('owner', 'budget.propose'), true);
  assert.equal(core.canRole('lead', 'budget.propose'), true);
  assert.equal(core.canRole('member', 'budget.propose'), true);
  assert.equal(core.canRole('ceo', 'budget.propose'), false);
  assert.equal(core.canRole('owner', 'budget.decide'), true);
  assert.equal(core.canRole('lead', 'budget.decide'), false);
  assert.equal(core.canRole('member', 'budget.decide'), false);
  assert.equal(core.canRole('ceo', 'budget.decide'), false);
  assert.equal(core.canRole('lead', 'approval.decide'), true);
  assert.equal(core.canRole('owner', 'approval.decide'), true);
  assert.equal(core.canRole('member', 'approval.decide'), false);
});

// ---------------------------------------------------------------------------
// Store — payload strip + fact mới pending + read normalize
// ---------------------------------------------------------------------------
test('0014 [store]: _toPayload budgetLines strip approved_* (create + update), giữ planned', () => {
  resetDemo();
  const ins = Store._toPayload('budgetLines', {
    name: 'Ads', planned: 1200, approved: 1000, approvedBy: OWNER, approvedAt: '2026-11-15T00:00:00Z', approvedViaProposalId: 'p1', currency: 'VND',
  }, { workspaceId: WS, forInsert: true });
  assert.equal(ins.planned_amount, 1200);
  assert.ok(!('approved_amount' in ins), 'create không gửi approved_amount — số duyệt chỉ qua đề xuất');
  assert.ok(!('approved_by' in ins) && !('approved_at' in ins) && !('approved_via_proposal_id' in ins));
  const upd = Store._toPayload('budgetLines', { name: 'Ads 2', approved: 2000 }, { workspaceId: WS });
  assert.equal(upd.name, 'Ads 2');
  assert.ok(!('approved_amount' in upd), 'update cũng không gửi approved_amount');
});

test('0014 [store]: _toPayload campaigns strip ceiling + dấu duyệt (create + update)', () => {
  resetDemo();
  const ins = Store._toPayload('campaigns', {
    name: 'C', budgetCeiling: 32000000, budgetCeilingCurrency: 'VND', approvedBy: OWNER,
  }, { workspaceId: WS, forInsert: true });
  assert.ok(!('budget_ceiling_amount' in ins), 'create không gửi budget_ceiling_amount');
  assert.ok(!('budget_ceiling_currency' in ins));
  assert.ok(!('approved_by' in ins));
  const upd = Store._toPayload('campaigns', { name: 'C2', budgetCeiling: 40000000 }, { workspaceId: WS });
  assert.equal(upd.name, 'C2');
  assert.ok(!('budget_ceiling_amount' in upd), 'update không gửi ceiling — giữ nguyên giá trị DB');
});

test('0014 [store]: _toPayload commitments/actuals — insert ép approval pending; update strip 4 cột approval_*', () => {
  resetDemo({ budgetLines: [approvedLine()] });
  const ins = Store._toPayload('commitments', {
    budgetLineId: 'bl-1', title: 'Đặt cọc', amount: 10, approvalStatus: 'approved', approvedBy: LEAD,
  }, { workspaceId: WS, forInsert: true });
  assert.equal(ins.approval_status, 'pending', 'fact mới luôn chờ duyệt kể cả khi caller gửi approved');
  assert.equal(ins.approved_by, null);
  const insA = Store._toPayload('actuals', { budgetLineId: 'bl-1', title: 'Chi', amount: 10 }, { workspaceId: WS, forInsert: true });
  assert.equal(insA.approval_status, 'pending');
  const upd = Store._toPayload('commitments', { amount: 20, approvalStatus: 'approved', approvedBy: LEAD, approvedAt: '2026-11-16T00:00:00Z', approvalNote: 'x' }, { workspaceId: WS });
  assert.equal(upd.amount, 20);
  assert.ok(!('approval_status' in upd) && !('approved_by' in upd) && !('approved_at' in upd) && !('approval_note' in upd),
    'update thường không đổi được cột duyệt');
});

test('0014 [store]: _rowToItem — fact thiếu approvalStatus normalize thành approved; dòng/campaign đủ 3 cột dấu duyệt', () => {
  resetDemo();
  const old = Store._rowToItem('commitments', { id: 'cm-old', budget_line_id: 'bl-1', amount: 5 });
  assert.equal(old.approvalStatus, 'approved');
  const pend = Store._rowToItem('actuals', { id: 'a-p', budget_line_id: 'bl-1', amount: 5, approval_status: 'pending', approved_by: null });
  assert.equal(pend.approvalStatus, 'pending');
  const line = Store._rowToItem('budgetLines', { id: 'bl-1', planned_amount: 10, approved_amount: 8, approved_by: OWNER, approved_at: '2026-11-15T00:00:00Z', approved_via_proposal_id: 'p1' });
  assert.equal(line.approvedBy, OWNER);
  assert.equal(line.approvedAt, '2026-11-15T00:00:00Z');
  assert.equal(line.approvedViaProposalId, 'p1');
  const camp = Store._rowToItem('campaigns', { id: 'camp-1', budget_ceiling_amount: 32, approved_by: OWNER, approved_at: '2026-11-15T00:00:00Z', approved_via_proposal_id: null });
  assert.equal(camp.approvedBy, OWNER);
  assert.equal(camp.approvedViaProposalId, null);
});

test('0014 [store/demo]: tạo commitment/actual → approvalStatus pending; sửa fact không đổi được cột duyệt qua update thường', () => {
  resetDemo({ budgetLines: [approvedLine()] });
  asUser(LEAD); // lead có quyền budget.edit để tạo fact (member không có)
  const c = Store.create('commitments', { budgetLineId: 'bl-1', title: 'Đặt cọc', amount: 10, status: 'committed', approvalStatus: 'approved' });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.item.approvalStatus, 'pending', 'tạo mới luôn pending kể cả khi caller gửi approved');
  const a = Store.create('actuals', { budgetLineId: 'bl-1', title: 'Ghi thanh toán', amount: 5 });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.item.approvalStatus, 'pending');
  asUser(LEAD);
  const u = Store.update('commitments', c.item.id, { amount: 12, approvalStatus: 'approved', approvedBy: LEAD });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.item.amount, 12);
  assert.equal(u.item.approvalStatus, 'pending', 'update thường bị strip cột duyệt');
  assert.equal(u.item.approvedBy, null);
});

test('0014 [store/demo]: tạo dòng/campaign qua store không mang số duyệt/hạn mức; sửa dòng/campaign giữ nguyên số đã duyệt', () => {
  resetDemo({ budgetLines: [approvedLine()] });
  asUser(OWNER);
  const line = Store.create('budgetLines', { id: 'bl-new', name: 'Mới', campaignId: 'camp-1', planned: 50, approved: 999, currency: 'VND' });
  assert.equal(line.ok, true, JSON.stringify(line));
  assert.equal(line.item.approved, 0, 'dòng mới chưa duyệt: approved = 0 như default DB');
  assert.equal(line.item.approvedBy, null);
  assert.equal(line.item.planned, 50);
  const upd = Store.update('budgetLines', 'bl-1', { name: 'Ads v2', approved: 1 });
  assert.equal(upd.ok, true, JSON.stringify(upd));
  assert.equal(upd.item.name, 'Ads v2');
  assert.equal(upd.item.approved, 100, 'update không đổi được số duyệt của dòng');
  const camp = Store.create('campaigns', { id: 'camp-new', name: 'Camp mới', budgetCeiling: 32000000, budgetCeilingCurrency: 'VND' });
  assert.equal(camp.ok, true, JSON.stringify(camp));
  assert.equal(camp.item.budgetCeiling, null, 'campaign mới chưa có hạn mức được duyệt');
  const campUpd = Store.update('campaigns', 'camp-1', { name: 'Camp 1 v2' });
  assert.equal(campUpd.ok, true, JSON.stringify(campUpd));
});

// ---------------------------------------------------------------------------
// Store — đề xuất + quyết định của Owner
// ---------------------------------------------------------------------------
test('0014 [store/demo]: createBudgetProposal — member tạo được (pending, revision 1, suy campaign từ dòng); CEO bị chặn quyền propose', () => {
  resetDemo({ budgetLines: [approvedLine()] });
  asUser(MEMBER);
  const r = Store.createBudgetProposal({ targetType: 'budget_line', budgetLineId: 'bl-1', amount: 130, reason: 'Tăng giá thầu' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.item.status, 'pending');
  assert.equal(r.item.revision, 1);
  assert.equal(r.item.proposerId, MEMBER);
  assert.equal(r.item.campaignId, 'camp-1', 'campaignId suy từ dòng ngân sách');
  assert.equal(r.item.proposedAmount, 130);
  assert.equal(r.item.currency, 'VND', 'currency suy từ dòng');
  asUser(CEO);
  const denied = Store.createBudgetProposal({ targetType: 'campaign_ceiling', campaignId: 'camp-1', amount: 10 });
  assert.equal(denied.ok, false);
  assert.equal(denied.action, 'budget.propose');
});

test('0014 [store/demo]: decideBudgetProposal — lead quyết → FORBIDDEN_ROLE; owner duyệt dòng → áp số + dấu; quyết lần 2 → ALREADY_DECIDED; revision lạ → STALE_REVISION', () => {
  resetDemo({ budgetLines: [approvedLine()] });
  asUser(MEMBER);
  const p = Store.createBudgetProposal({ targetType: 'budget_line', budgetLineId: 'bl-1', amount: 130 }).item;
  asUser(LEAD);
  const byLead = Store.decideBudgetProposal(p.id, 'approved');
  assert.equal(byLead.ok, false);
  assert.ok(byLead.error.startsWith('FORBIDDEN_ROLE'), byLead.error);
  assert.equal(Store.get('budgetLines', 'bl-1').approved, 100, 'lead quyết thất bại không đổi số duyệt');
  asUser(OWNER);
  const stale = Store.decideBudgetProposal(p.id, 'approved', '', 99);
  assert.equal(stale.ok, false);
  assert.ok(stale.error.startsWith('STALE_REVISION'), stale.error);
  const ok = Store.decideBudgetProposal(p.id, 'approved', 'Đồng ý');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.item.status, 'approved');
  assert.equal(ok.item.decidedBy, OWNER);
  assert.equal(ok.item.decisionNote, 'Đồng ý');
  const line = Store.get('budgetLines', 'bl-1');
  assert.equal(line.approved, 130);
  assert.equal(line.approvedAmount, 130);
  assert.equal(line.approvedBy, OWNER);
  assert.ok(line.approvedAt);
  assert.equal(line.approvedViaProposalId, p.id);
  const again = Store.decideBudgetProposal(p.id, 'rejected');
  assert.equal(again.ok, false);
  assert.ok(again.error.startsWith('ALREADY_DECIDED'), again.error);
});

test('0014 [store/demo]: owner duyệt đề xuất hạn mức campaign → campaign mang ceiling + currency + dấu duyệt; rejected không áp số', () => {
  resetDemo();
  asUser(LEAD);
  const p = Store.createBudgetProposal({ targetType: 'campaign_ceiling', campaignId: 'camp-1', amount: 32 * M, currency: 'VND' }).item;
  asUser(OWNER);
  const ok = Store.decideBudgetProposal(p.id, 'approved');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const camp = Store.get('campaigns', 'camp-1');
  assert.equal(camp.budgetCeiling, 32 * M);
  assert.equal(camp.budgetCeilingAmount, 32 * M);
  assert.equal(camp.budgetCeilingCurrency, 'VND');
  assert.equal(camp.approvedBy, OWNER);
  assert.equal(camp.approvedViaProposalId, p.id);
  const p2 = Store.createBudgetProposal({ targetType: 'campaign_ceiling', campaignId: 'camp-1', amount: 99 * M, currency: 'VND' }).item;
  const rej = Store.decideBudgetProposal(p2.id, 'rejected', 'Quá cao');
  assert.equal(rej.ok, true);
  assert.equal(Store.get('campaigns', 'camp-1').budgetCeiling, 32 * M, 'rejected không đổi hạn mức');
});

// ---------------------------------------------------------------------------
// Store — duyệt cam kết / khoản chi (demo, đúng quy tắc RPC)
// ---------------------------------------------------------------------------
function pendingCommitment(extra) {
  return Object.assign({
    id: 'cm-1', budgetLineId: 'bl-1', title: 'Cam kết', amount: 40, currency: 'VND',
    status: 'committed', approvalStatus: 'pending', createdBy: MEMBER,
  }, extra || {});
}
function pendingActual(extra) {
  return Object.assign({
    id: 'pay-1', budgetLineId: 'bl-1', title: 'Chi', amount: 10, currency: 'VND',
    approvalStatus: 'pending', createdBy: MEMBER,
  }, extra || {});
}

test('0014 [store/demo]: duyệt cam kết ở dòng CHƯA có dấu duyệt → BUDGET_NOT_APPROVED', () => {
  const unapproved = approvedLine({ approvedBy: null, approvedAt: null, approvedViaProposalId: null });
  resetDemo({ budgetLines: [unapproved], commitments: [pendingCommitment()] });
  asUser(LEAD);
  const r = Store.decideCommitmentApproval('cm-1', 'approved');
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith('BUDGET_NOT_APPROVED'), r.error);
  assert.equal(Store.get('commitments', 'cm-1').approvalStatus, 'pending');
});

test('0014 [store/demo]: duyệt cam kết vượt số đã duyệt → BUDGET_LIMIT_EXCEEDED (UsageAfter tính cả actual đã duyệt)', () => {
  resetDemo({
    budgetLines: [approvedLine()],
    commitments: [pendingCommitment({ amount: 50 })],
    actuals: [{ id: 'a-old', budgetLineId: 'bl-1', amount: 60, currency: 'VND', approvalStatus: 'approved', createdBy: MEMBER }],
  });
  asUser(LEAD);
  const r = Store.decideCommitmentApproval('cm-1', 'approved');
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith('BUDGET_LIMIT_EXCEEDED'), r.error, 'UsageAfter = 60 actual + 50 cam kết = 110 > 100');
  // Trong trần thì duyệt được và ghi đủ dấu quyết định:
  Store.state.commitments = [pendingCommitment({ id: 'cm-2', amount: 30 })];
  const ok = Store.decideCommitmentApproval('cm-2', 'approved', 'OK');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.item.approvalStatus, 'approved');
  assert.equal(ok.item.approvedBy, LEAD);
  assert.ok(ok.item.approvedAt);
  assert.equal(ok.item.approvalNote, 'OK');
  const again = Store.decideCommitmentApproval('cm-2', 'approved');
  assert.equal(again.ok, false);
  assert.ok(again.error.startsWith('ALREADY_DECIDED'), again.error);
});

test('0014 [store/demo]: lead tự duyệt cam kết của mình → SELF_APPROVAL; owner tự duyệt → được; member duyệt → FORBIDDEN_ROLE; lệch currency → CURRENCY_MISMATCH', () => {
  resetDemo({
    budgetLines: [approvedLine()],
    commitments: [
      pendingCommitment({ id: 'cm-self', createdBy: LEAD }),
      pendingCommitment({ id: 'cm-usd', currency: 'USD' }),
    ],
  });
  asUser(LEAD);
  const self = Store.decideCommitmentApproval('cm-self', 'approved');
  assert.equal(self.ok, false);
  assert.ok(self.error.startsWith('SELF_APPROVAL'), self.error);
  const mismatch = Store.decideCommitmentApproval('cm-usd', 'approved');
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.error.startsWith('CURRENCY_MISMATCH'), mismatch.error);
  asUser(MEMBER);
  const forbidden = Store.decideCommitmentApproval('cm-self', 'approved');
  assert.equal(forbidden.ok, false);
  assert.ok(forbidden.error.startsWith('FORBIDDEN_ROLE'), forbidden.error);
  asUser(OWNER);
  const byOwner = Store.decideCommitmentApproval('cm-self', 'approved');
  assert.equal(byOwner.ok, true, JSON.stringify(byOwner), 'owner được duyệt cam kết do chính mình tạo');
});

test('0014 [store/demo]: payment gắn cam kết làm GIẢM nghĩa vụ mở đúng công thức (duyệt 80 trên cam kết 80, dòng duyệt 100)', () => {
  resetDemo({
    budgetLines: [approvedLine()],
    commitments: [{
      id: 'cm-1', budgetLineId: 'bl-1', title: 'Cam kết', amount: 80, currency: 'VND',
      status: 'committed', approvalStatus: 'approved', createdBy: MEMBER,
    }],
    actuals: [pendingActual({ id: 'pay-1', amount: 80, commitmentId: 'cm-1' })],
  });
  // Trước duyệt: usage = 0 actual + max(0, 80 − 0) = 80.
  assert.equal(domain.budgetUsageTotal(Store.get('budgetLines', 'bl-1'), Store.state.commitments, Store.state.actuals), 80);
  asUser(LEAD);
  const r = Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(r.ok, true, JSON.stringify(r),
    'UsageAfter = 80 actual + max(0, 80 − 80) = 80 ≤ 100 — nếu không giảm nghĩa vụ sẽ ra 160 và bị chặn oan');
  // Sau duyệt: usage vẫn 80 (actual thay nghĩa vụ), remaining = 20.
  const line = Store.get('budgetLines', 'bl-1');
  assert.equal(domain.budgetUsageTotal(line, Store.state.commitments, Store.state.actuals), 80);
  assert.equal(domain.budgetRemaining(line, Store.state.commitments, Store.state.actuals), 20);
  const again = Store.decidePaymentApproval('pay-1', 'rejected');
  assert.equal(again.ok, false);
  assert.ok(again.error.startsWith('ALREADY_DECIDED'), again.error);
});

test('0014 [store/demo]: duyệt payment vượt trần → BUDGET_LIMIT_EXCEEDED; rejected không cần qua các chặn approved', () => {
  const unapproved = approvedLine({ id: 'bl-2', approvedBy: null, approvedAt: null, approvedViaProposalId: null });
  resetDemo({
    budgetLines: [approvedLine(), unapproved],
    actuals: [
      pendingActual({ id: 'pay-big', amount: 150 }),
      pendingActual({ id: 'pay-rej', amount: 10, budgetLineId: 'bl-2' }),
    ],
  });
  asUser(LEAD);
  const over = Store.decidePaymentApproval('pay-big', 'approved');
  assert.equal(over.ok, false);
  assert.ok(over.error.startsWith('BUDGET_LIMIT_EXCEEDED'), over.error);
  const rej = Store.decidePaymentApproval('pay-rej', 'rejected', 'Thiếu chứng từ');
  assert.equal(rej.ok, true, JSON.stringify(rej), 'rejected không áp các chặn của nhánh approved (kể cả dòng chưa duyệt)');
  assert.equal(rej.item.approvalStatus, 'rejected');
  assert.equal(rej.item.approvedBy, LEAD, 'approvedBy ở đây = người quyết định kể cả khi rejected');
});

// ---------------------------------------------------------------------------
// Demo-data — fixture livestream có dấu duyệt + D.1 giữ số qua domain
// ---------------------------------------------------------------------------
test('0014 [demo-data]: camp-live + các dòng ngân sách có dấu duyệt của Owner demo; commitments/actuals đều approved tường minh', () => {
  const camp = demo.campaigns.find((c) => c.id === 'camp-live');
  assert.equal(camp.approvedBy, 'member-owner');
  assert.ok(camp.approvedAt);
  assert.equal(camp.approvedViaProposalId, null);
  for (const line of demo.budgetLines) {
    assert.equal(line.approvedBy, 'member-owner', `dòng ${line.id} thiếu dấu duyệt`);
    assert.ok(line.approvedAt, `dòng ${line.id} thiếu approvedAt`);
    assert.equal(line.approvedViaProposalId, null);
  }
  for (const f of [...demo.commitments, ...demo.actuals]) {
    assert.equal(f.approvalStatus, 'approved', `fact ${f.id} phải mang approvalStatus approved tường minh`);
  }
});

test('0014 [demo-data]: tổng ngân sách livestream qua domain GIỮ NGUYÊN D.1 (phân bổ 30tr, thực chi 20.5tr, cam kết mở 7.5tr, dự kiến 28tr, chưa phân bổ 2tr, còn dùng được 4tr)', () => {
  const camp = demo.campaigns.find((c) => c.id === 'camp-live');
  const lines = demo.budgetLines.filter((l) => l.campaignId === 'camp-live');
  const commitments = demo.commitments.filter((c) => c.campaignId === 'camp-live');
  const actuals = demo.actuals.filter((a) => a.campaignId === 'camp-live');
  const child = demo.activities.filter((a) => a.campaignId === 'camp-live').map((a) => ({
    scopeId: a.id, currency: 'VND',
    amount: lines.filter((l) => l.activityId === a.id).reduce((s, l) => s + l.approved, 0),
  }));
  const s = domain.summarizeBudgetScope({ ceiling: camp.budgetCeiling, currency: 'VND', childAllocations: child, commitments, actuals });
  assert.equal(s.allocated, 30 * M);
  assert.equal(s.actualTotal, 20.5 * M);
  assert.equal(s.openCommitments, 7.5 * M);
  assert.equal(s.forecastUse, 28 * M);
  assert.equal(s.unallocated, 2 * M);
  assert.equal(s.available, 4 * M);
  for (const line of lines) {
    const cs = commitments.filter((c) => c.budgetLineId === line.id);
    const as = actuals.filter((a) => a.budgetLineId === line.id);
    assert.equal(domain.budgetRemaining(line, cs, as), line.approved - domain.budgetUsageTotal(line, cs, as));
  }
});

// ---------------------------------------------------------------------------
// Remote (mock) — decide qua RPC, hợp nhất row trả về, giữ tiền tố lỗi
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
  Store.mode = 'supabase';
  Store.workspaceId = WS;
  Store._membership = { role: 'owner' };
  Store.currentUserId = OWNER;
  Store.state = Object.assign(EMPTY_COLLECTIONS(), {
    members: [{ id: OWNER, name: 'Owner', role: 'owner' }],
    campaigns: [], budgetLines: [], commitments: [], actuals: [], budgetProposals: [],
  }, extraState || {});
  Store.loadState = {};
  Store._postMappings = [];
  Store.supabaseClient = makeFakeClient(handler);
  return Store;
}

test('0014 [remote]: decideBudgetProposal gọi RPC decide_budget_proposal với revision trong state + hợp nhất proposal và dòng đích đọc lại', async () => {
  const proposalRow = {
    id: 'prop-1', workspace_id: WS, target_type: 'budget_line', campaign_id: 'camp-1', budget_line_id: 'bl-1',
    proposed_amount: 130, currency: 'VND', reason: null, proposer_id: MEMBER, status: 'approved',
    decided_by: OWNER, decided_at: '2026-11-16T00:00:00Z', decision_note: 'OK', revision: 1,
    created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-16T00:00:00Z',
  };
  const lineRow = {
    id: 'bl-1', workspace_id: WS, campaign_id: 'camp-1', name: 'Ads', planned_amount: 120, approved_amount: 130,
    currency: 'VND', approved_by: OWNER, approved_at: '2026-11-16T00:00:00Z', approved_via_proposal_id: 'prop-1',
    created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-16T00:00:00Z',
  };
  const handler = (call) => {
    if (call.rpc === 'decide_budget_proposal') return { data: proposalRow, error: null };
    if (call.table === 'budget_lines' && call.op === 'select') return { data: [lineRow], error: null };
    return { data: [], error: null };
  };
  setupRemote(handler, {
    budgetProposals: [{ id: 'prop-1', targetType: 'budget_line', campaignId: 'camp-1', budgetLineId: 'bl-1', proposedAmount: 130, currency: 'VND', status: 'pending', revision: 1, proposerId: MEMBER }],
    budgetLines: [{ id: 'bl-1', campaignId: 'camp-1', name: 'Ads', currency: 'VND', planned: 120, approved: 100, approvedBy: null, updatedAt: '2026-11-15T00:00:00Z' }],
  });
  const r = await Store.decideBudgetProposal('prop-1', 'approved', 'OK');
  assert.equal(r.ok, true, JSON.stringify(r));
  const rpc = Store.supabaseClient.calls.find((c) => c.rpc === 'decide_budget_proposal');
  assert.deepEqual(rpc.args, { p_proposal_id: 'prop-1', p_revision: 1, p_decision: 'approved', p_note: 'OK' });
  assert.equal(Store.get('budgetProposals', 'prop-1').status, 'approved');
  assert.equal(Store.get('budgetProposals', 'prop-1').decidedBy, OWNER);
  assert.equal(r.target.approved, 130, 'dòng đích được đọc lại từ DB sau RPC');
  assert.equal(r.target.approvedViaProposalId, 'prop-1');
  Store.mode = 'demo'; Store.supabaseClient = null;
});

test('0014 [remote]: decideCommitmentApproval gọi RPC + hợp nhất row; lỗi RPC giữ NGUYÊN tiền tố FORBIDDEN_ROLE', async () => {
  const row = {
    id: 'cm-1', workspace_id: WS, budget_line_id: 'bl-1', description: 'Cam kết', amount: 40, currency: 'VND',
    status: 'committed', settled_amount: 0, approval_status: 'approved', approved_by: LEAD,
    approved_at: '2026-11-16T00:00:00Z', approval_note: null, created_by: MEMBER,
    created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-16T00:00:00Z',
  };
  let failRpc = false;
  const handler = (call) => {
    if (call.rpc === 'decide_commitment_approval') {
      if (failRpc) return { data: null, error: { code: '42501', message: 'FORBIDDEN_ROLE: chỉ lead/owner mới được duyệt cam kết (vai hiện tại: member)' } };
      return { data: row, error: null };
    }
    return { data: [], error: null };
  };
  setupRemote(handler, {
    commitments: [{ id: 'cm-1', budgetLineId: 'bl-1', amount: 40, currency: 'VND', status: 'committed', approvalStatus: 'pending', createdBy: MEMBER }],
  });
  const r = await Store.decideCommitmentApproval('cm-1', 'approved', null);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rpc = Store.supabaseClient.calls.find((c) => c.rpc === 'decide_commitment_approval');
  assert.deepEqual(rpc.args, { p_commitment_id: 'cm-1', p_decision: 'approved', p_note: null });
  assert.equal(Store.get('commitments', 'cm-1').approvalStatus, 'approved');
  assert.equal(Store.get('commitments', 'cm-1').approvedBy, LEAD);
  failRpc = true;
  Store.state.commitments = [{ id: 'cm-2', budgetLineId: 'bl-1', amount: 5, currency: 'VND', status: 'committed', approvalStatus: 'pending', createdBy: MEMBER }];
  const bad = await Store.decideCommitmentApproval('cm-2', 'approved');
  assert.equal(bad.ok, false);
  assert.ok(bad.error.startsWith('FORBIDDEN_ROLE'), bad.error, 'tiền tố lỗi RPC phải giữ nguyên qua friendlyError/_attempt');
  Store.mode = 'demo'; Store.supabaseClient = null;
});
