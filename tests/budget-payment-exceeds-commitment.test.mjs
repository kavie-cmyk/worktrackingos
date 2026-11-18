// tests/budget-payment-exceeds-commitment.test.mjs
// SYN-08 (phần chặn trả vượt cam kết ở tầng Store/UI) — vá finding QA 16/11:
// migration 0016 đã có clause PAYMENT_EXCEEDS_COMMITMENT trong RPC
// decide_payment_approval, nhưng Store demo + tiền kiểm UI chưa mirror:
// ca đo thật — payment 120 trên cam kết 80, trần dòng 500 → trước vá
// Store.decidePaymentApproval (demo) trả ok=true và nút Duyệt không bị khóa.
// Nay khóa cả 3 tầng theo đúng thứ tự RPC 0016:
//   … → CURRENCY_MISMATCH → PAYMENT_EXCEEDS_COMMITMENT → BUDGET_LIMIT_EXCEEDED
// "Đã duyệt" tính bằng Domain.commitmentPaidTotal (chỉ actual ĐÃ DUYỆT
// liên kết với cam kết) — khớp ngữ nghĩa RPC:
//   Σ payment đã duyệt của cam kết + payment đang xét > amount gốc cam kết.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
require('../js/domain.js'); // nạp SAVA_DOMAIN cho Store._domain()
const Store = require('../js/store.js');

const WS = 'ws-1';
const OWNER = 'u-owner';
const LEAD = 'u-lead';
const MEMBER = 'u-member';

const EMPTY_COLLECTIONS = () => Object.fromEntries(Store.COLLECTIONS.map((k) => [k, []]));

function resetDemo(extraState) {
  Store.mode = 'demo';
  Store.supabaseClient = null;
  Store.workspaceId = WS;
  Store._membership = null;
  Store.currentUserId = LEAD;
  Store.state = Object.assign(EMPTY_COLLECTIONS(), {
    members: [
      { id: OWNER, name: 'Owner', role: 'owner', capacityHoursPerWeek: null, daysOff: null },
      { id: LEAD, name: 'Lead', role: 'lead', capacityHoursPerWeek: null, daysOff: null },
      { id: MEMBER, name: 'Member', role: 'member', capacityHoursPerWeek: null, daysOff: null },
    ],
    campaigns: [{ id: 'camp-1', name: 'Camp 1', status: 'active', budgetCeiling: null, budgetCeilingCurrency: null, approvedBy: OWNER, approvedAt: '2026-11-15T09:00:00Z', approvedViaProposalId: 'prop-camp-seed' }],
    budgetLines: [], commitments: [], actuals: [], budgetProposals: [],
  }, extraState || {});
  Store.loadState = {};
  Store._postMappings = [];
  return Store;
}

// Trần dòng 500 (đủ lớn để ca 120 KHÔNG chạm BUDGET_LIMIT_EXCEEDED —
// tách bạch lỗi vượt cam kết khỏi lỗi vượt trần dòng).
function line500(extra) {
  return Object.assign({
    id: 'bl-1', campaignId: 'camp-1', name: 'Ads', currency: 'VND',
    planned: 600, approved: 500, approvedBy: OWNER,
    approvedAt: '2026-11-15T09:00:00Z', approvedViaProposalId: 'prop-seed',
  }, extra || {});
}
function commitment80(extra) {
  return Object.assign({
    id: 'cm-1', budgetLineId: 'bl-1', title: 'Cam kết', amount: 80, currency: 'VND',
    status: 'committed', approvalStatus: 'approved', createdBy: MEMBER,
  }, extra || {});
}
function pendingPayment(extra) {
  return Object.assign({
    id: 'pay-1', budgetLineId: 'bl-1', title: 'Chi', amount: 120, currency: 'VND',
    commitmentId: 'cm-1', approvalStatus: 'pending', createdBy: MEMBER,
  }, extra || {});
}

// ---------------------------------------------------------------------------
// Store demo — ca đo QA + các biên
// ---------------------------------------------------------------------------
test('SYN-08 [store/demo]: ca đo QA — payment 120 trên cam kết 80, trần dòng 500 → PAYMENT_EXCEEDS_COMMITMENT (trước vá trả ok=true)', () => {
  resetDemo({
    budgetLines: [line500()],
    commitments: [commitment80()],
    actuals: [pendingPayment({ amount: 120 })],
  });
  const r = Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.code, 'PAYMENT_EXCEEDS_COMMITMENT');
  assert.ok(r.error.startsWith('PAYMENT_EXCEEDS_COMMITMENT'), r.error);
  assert.equal(Store.get('actuals', 'pay-1').approvalStatus, 'pending', 'payment bị chặn phải còn pending');
});

test('SYN-08 [store/demo]: payment 80 đúng bằng cam kết 80 → duyệt được (không chặn nhầm ở biên bằng)', () => {
  resetDemo({
    budgetLines: [line500()],
    commitments: [commitment80()],
    actuals: [pendingPayment({ amount: 80 })],
  });
  const r = Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(Store.get('actuals', 'pay-1').approvalStatus, 'approved');
});

test('SYN-08 [store/demo]: cộng dồn payment ĐÃ DUYỆT trước — đã duyệt 50, thêm 40 trên cam kết 80 → chặn; thêm 30 → qua', () => {
  const approved50 = { id: 'pay-old', budgetLineId: 'bl-1', title: 'Chi cũ', amount: 50, currency: 'VND', commitmentId: 'cm-1', approvalStatus: 'approved', createdBy: MEMBER };
  // Đối chiếu nguồn sự thật JS mà check dùng:
  assert.equal(domain.commitmentPaidTotal(commitment80(), [approved50]), 50);
  resetDemo({
    budgetLines: [line500()],
    commitments: [commitment80()],
    actuals: [approved50, pendingPayment({ id: 'pay-40', amount: 40 })],
  });
  const over = Store.decidePaymentApproval('pay-40', 'approved');
  assert.equal(over.ok, false, '50 đã duyệt + 40 = 90 > 80 phải chặn');
  assert.equal(over.code, 'PAYMENT_EXCEEDS_COMMITMENT');
  resetDemo({
    budgetLines: [line500()],
    commitments: [commitment80()],
    actuals: [approved50, pendingPayment({ id: 'pay-30', amount: 30 })],
  });
  const ok = Store.decidePaymentApproval('pay-30', 'approved');
  assert.equal(ok.ok, true, JSON.stringify(ok), '50 đã duyệt + 30 = 80 đúng bằng cam kết thì qua');
});

test('SYN-08 [store/demo]: payment KHÔNG gắn cam kết giữ hành vi cũ — 120/trần 500 duyệt được; 600/trần 500 vẫn BUDGET_LIMIT_EXCEEDED', () => {
  const noCommitment = pendingPayment({ amount: 120 });
  delete noCommitment.commitmentId;
  resetDemo({
    budgetLines: [line500()],
    commitments: [commitment80()],
    actuals: [noCommitment],
  });
  const r = Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(r.ok, true, JSON.stringify(r), 'không gắn cam kết thì không áp PAYMENT_EXCEEDS_COMMITMENT');
  const big = pendingPayment({ id: 'pay-big', amount: 600 });
  delete big.commitmentId;
  resetDemo({
    budgetLines: [line500()],
    commitments: [commitment80()],
    actuals: [big],
  });
  const over = Store.decidePaymentApproval('pay-big', 'approved');
  assert.equal(over.ok, false);
  assert.ok(over.error.startsWith('BUDGET_LIMIT_EXCEEDED'), over.error, 'chặn trần dòng cũ giữ nguyên cho payment không gắn cam kết');
});

test('SYN-08 [store/demo]: thứ tự khớp RPC 0016 — vượt CẢ cam kết lẫn trần dòng thì lỗi là PAYMENT_EXCEEDS_COMMITMENT (kiểm trước BUDGET_LIMIT_EXCEEDED)', () => {
  resetDemo({
    budgetLines: [line500({ approved: 100 })],
    commitments: [commitment80()],
    actuals: [pendingPayment({ amount: 120 })],
  });
  const r = Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PAYMENT_EXCEEDS_COMMITMENT', 'RPC kiểm PAYMENT_EXCEEDS_COMMITMENT trước BUDGET_LIMIT_EXCEEDED');
  assert.ok(r.error.startsWith('PAYMENT_EXCEEDS_COMMITMENT'), r.error);
});

// ---------------------------------------------------------------------------
// Remote — tiền kiểm local + map nguyên code lỗi RPC
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

test('SYN-08 [store/remote]: tiền kiểm local — payment 120/cam kết 80 → PAYMENT_EXCEEDS_COMMITMENT, KHÔNG gọi RPC', async () => {
  let rpcCalled = false;
  setupRemote((call) => {
    if (call.rpc) { rpcCalled = true; return { data: null, error: null }; }
    return { data: [], error: null };
  }, {
    budgetLines: [line500()],
    commitments: [commitment80()],
    actuals: [pendingPayment({ amount: 120 })],
  });
  const r = await Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PAYMENT_EXCEEDS_COMMITMENT');
  assert.ok(r.error.startsWith('PAYMENT_EXCEEDS_COMMITMENT'), r.error);
  assert.equal(rpcCalled, false, 'đã chặn ở tiền kiểm local thì không gọi RPC');
  Store.mode = 'demo'; Store.supabaseClient = null;
});

test('SYN-08 [store/remote]: lỗi PAYMENT_EXCEEDS_COMMITMENT từ RPC được map NGUYÊN code (state local không có cam kết → RPC là nguồn sự thật)', async () => {
  setupRemote((call) => {
    if (call.rpc === 'decide_payment_approval') {
      return { data: null, error: { code: '42501', message: 'PAYMENT_EXCEEDS_COMMITMENT: tổng payment đã duyệt (50) + payment này (40) vượt số tiền cam kết gốc (80)' } };
    }
    return { data: [], error: null };
  }, {
    budgetLines: [], commitments: [],
    actuals: [pendingPayment({ amount: 40 })],
  });
  const r = await Store.decidePaymentApproval('pay-1', 'approved');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PAYMENT_EXCEEDS_COMMITMENT', 'code từ RPC không bị nuốt thành lỗi chung / mã SQL');
  assert.ok(r.error.startsWith('PAYMENT_EXCEEDS_COMMITMENT'), r.error);
  Store.mode = 'demo'; Store.supabaseClient = null;
});

// ---------------------------------------------------------------------------
// UI (js/app.js) — budgetFactBlockReason khóa nút Duyệt + map lỗi
// ---------------------------------------------------------------------------
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}
const mapFn = new Function(section('function budgetApprovalErrorMessage', 'function budgetProposalChange') + '\nreturn budgetApprovalErrorMessage;')();

test('SYN-08 [ui/unit]: budgetApprovalErrorMessage map PAYMENT_EXCEEDS_COMMITMENT sang thông điệp tiếng Việt dễ hiểu', () => {
  assert.equal(mapFn('PAYMENT_EXCEEDS_COMMITMENT: tổng payment đã duyệt (0) + payment này (120) vượt số tiền cam kết gốc (80)', 'fact'), 'Tổng payment vượt số tiền cam kết gốc');
  assert.equal(mapFn({ error: 'PAYMENT_EXCEEDS_COMMITMENT: x' }, 'fact'), 'Tổng payment vượt số tiền cam kết gốc');
});

const holder = {
  data: {
    budgetLines: [{ id: 'bl-1', campaignId: 'camp-1', currency: 'VND', approved: 500, approvedBy: OWNER }],
    campaigns: [{ id: 'camp-1', approvedBy: OWNER }],
    commitments: [commitment80()],
    actuals: [],
  },
};
const StoreStub = {
  list: (c) => holder.data[c] || [],
  get: (c, id) => (holder.data[c] || []).find((x) => x.id === id) || null,
};
function escStub(s) { return String(s === null || s === undefined ? '' : s); }
const controlsSrc = section('function factApprovalStatusOf', 'function budgetProposalCurrentValue');
const C = new Function('Store', 'D', 'can', 'esc', 'vizStatusPillHtml', 'labelStatus',
  controlsSrc + '\nreturn { budgetFactBlockReason: budgetFactBlockReason, factApprovalControlsHtml: factApprovalControlsHtml };'
)(StoreStub, domain, () => true, escStub, () => '<span class="pill">pending</span>', (s) => String(s || ''));

test('SYN-08 [ui/unit]: budgetFactBlockReason — payment 120/cam kết 80/trần 500 → lý do vượt cam kết + nút Duyệt disabled, Từ chối vẫn bấm được', () => {
  holder.data.actuals = [pendingPayment({ amount: 120 })];
  const fact = holder.data.actuals[0];
  assert.equal(C.budgetFactBlockReason(fact, 'actual'), 'Payment vượt số tiền cam kết gốc');
  const html = C.factApprovalControlsHtml(fact, 'actual');
  const tags = [...html.matchAll(/<button[^>]*data-decision="(approved|rejected)"[^>]*>/g)];
  assert.equal(tags.length, 2);
  assert.match(tags.find((t) => t[1] === 'approved')[0], /disabled/);
  assert.doesNotMatch(tags.find((t) => t[1] === 'rejected')[0], /disabled/);
});

test('SYN-08 [ui/unit]: budgetFactBlockReason — payment 80 bằng cam kết → không chặn; đã duyệt 50 + thêm 40 → chặn, thêm 30 → không chặn; không gắn cam kết → không chặn vì lý do này', () => {
  holder.data.actuals = [pendingPayment({ amount: 80 })];
  assert.equal(C.budgetFactBlockReason(holder.data.actuals[0], 'actual'), '');
  const approved50 = { id: 'pay-old', budgetLineId: 'bl-1', amount: 50, currency: 'VND', commitmentId: 'cm-1', approvalStatus: 'approved', createdBy: MEMBER };
  holder.data.actuals = [approved50, pendingPayment({ id: 'pay-40', amount: 40 })];
  assert.equal(C.budgetFactBlockReason(holder.data.actuals[1], 'actual'), 'Payment vượt số tiền cam kết gốc', '50 + 40 > 80');
  holder.data.actuals = [approved50, pendingPayment({ id: 'pay-30', amount: 30 })];
  assert.equal(C.budgetFactBlockReason(holder.data.actuals[1], 'actual'), '', '50 + 30 = 80 thì qua');
  const noCommitment = pendingPayment({ id: 'pay-free', amount: 120 });
  delete noCommitment.commitmentId;
  holder.data.actuals = [noCommitment];
  assert.equal(C.budgetFactBlockReason(noCommitment, 'actual'), '', 'không gắn cam kết giữ hành vi cũ');
});
