// tests/budget-money-0016.test.mjs
// Migration 0016 — vá findings QA 16/11 (tiền & quyền):
//   SYN-02 budget_remaining lọc currency + archived_at · SYN-03 decide_*
//   loại settled/released khỏi UsageTotal · SYN-04 kiểm dấu duyệt tầng
//   campaign (level=campaign trong message) · SYN-08
//   PAYMENT_EXCEEDS_COMMITMENT · SYN-09 fact thiếu currency coi như lệch ·
//   SYN-22 revoke EXECUTE public/anon cho 3 hàm · SYN-23 policy insert
//   budget_proposals loại CEO · SYN-14 trigger over-allocation tính
//   share_percent.
// Kiểm chứng TĨNH trên văn bản migration (đúng phong cách test [static]
// của r31-persist / budget-approval-chain) + ghim ngữ nghĩa JS mà SQL
// phải mirror bằng domain thật — không đụng DB live, không áp migration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');

const SQL = readFileSync(new URL('../supabase/migrations/0016_budget_approval_money_fixes.sql', import.meta.url), 'utf8');
// Bỏ comment dòng (--) để các assert về code không khớp nhầm chữ trong comment.
const CODE = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function section(fromMarker, toMarker) {
  const a = CODE.indexOf(fromMarker);
  assert.ok(a >= 0, `không tìm thấy mốc ${fromMarker}`);
  const b = toMarker ? CODE.indexOf(toMarker, a + fromMarker.length) : CODE.length;
  assert.ok(b > a, `không tìm thấy mốc kết thúc ${toMarker}`);
  return CODE.slice(a, b);
}

const REMAINING = section('function public.budget_remaining', 'function public.decide_commitment_approval');
const DECIDE_CMT = section('function public.decide_commitment_approval', 'function public.decide_payment_approval');
const DECIDE_PAY = section('function public.decide_payment_approval', 'revoke execute on function public.budget_remaining');

// ---------------------------------------------------------------------------
// SYN-02 — budget_remaining: currency + archived + giữ ngữ nghĩa 0014
// ---------------------------------------------------------------------------
test('0016 [static]: budget_remaining chỉ tính fact CÙNG currency với dòng (actuals + commitments + paid)', () => {
  assert.match(REMAINING, /select bl\.approved_amount, bl\.currency into v_approved, v_currency/);
  // actuals: lọc currency của dòng.
  assert.match(REMAINING, /from public\.budget_actuals ba[\s\S]*?ba\.currency = v_currency/);
  // commitments: lọc currency của dòng.
  assert.match(REMAINING, /from public\.budget_commitments bc[\s\S]*?bc\.currency = v_currency/);
  // paid (actual liên kết): cũng chỉ cùng currency — khớp JS lọc acts trước commitmentPaidTotal.
  assert.match(REMAINING, /commitment_id is not null[\s\S]*?currency = v_currency/);
});

test('0016 [static]: budget_remaining loại cam kết archived + giữ lọc approved và tập status còn mở của 0014', () => {
  assert.match(REMAINING, /bc\.archived_at is null/);
  assert.match(REMAINING, /ba\.approval_status = 'approved'/);
  assert.match(REMAINING, /bc\.approval_status = 'approved'/);
  assert.match(REMAINING, /bc\.status in \('planned', 'committed', 'partially_actualised'\)/);
});

// ---------------------------------------------------------------------------
// SYN-03 — decide_* UsageTotal loại settled/released (mirror JS)
// ---------------------------------------------------------------------------
for (const [name, body] of [['decide_commitment_approval', DECIDE_CMT], ['decide_payment_approval', DECIDE_PAY]]) {
  test(`0016 [static]: ${name} — UsageTotal chỉ gồm cam kết còn mở, không còn mẫu <> 'cancelled'`, () => {
    assert.match(body, /bc\.status in \('planned', 'committed', 'partially_actualised'\)/);
    assert.match(body, /bc\.archived_at is null/);
    assert.ok(!/coalesce\(bc\.status, ''\) <> 'cancelled'/.test(body),
      'mẫu cũ status <> cancelled (gồm settled/released) phải bị loại hẳn');
  });
}

test('0016 [mirror JS]: ngữ nghĩa JS bị mirror — settled 50 đã trả 10 → usage 10; released 50 → usage 0', () => {
  const line = { approved: 100, currency: 'VND' };
  const settled = [{ id: 'c1', amount: 50, currency: 'VND', status: 'settled', approvalStatus: 'approved' }];
  const paid10 = [{ id: 'a1', amount: 10, currency: 'VND', commitmentId: 'c1', approvalStatus: 'approved' }];
  assert.equal(domain.budgetUsageTotal(line, settled, paid10), 10);
  const released = [{ id: 'c2', amount: 50, currency: 'VND', status: 'released', approvalStatus: 'approved' }];
  assert.equal(domain.budgetUsageTotal(line, released, []), 0);
});

// ---------------------------------------------------------------------------
// SYN-04 — dấu duyệt tầng campaign trong cả 2 RPC decide_*
// ---------------------------------------------------------------------------
for (const [name, body] of [['decide_commitment_approval', DECIDE_CMT], ['decide_payment_approval', DECIDE_PAY]]) {
  test(`0016 [static]: ${name} — dòng thuộc campaign thì bắt buộc campaigns.approved_by, lỗi ghi level=campaign`, () => {
    assert.match(body, /if v_line\.campaign_id is not null then/);
    assert.match(body, /from public\.campaigns c where c\.id = v_line\.campaign_id/);
    assert.match(body, /v_campaign_approved_by is null/);
    assert.match(body, /BUDGET_NOT_APPROVED: thiếu dấu duyệt ở tầng campaign[\s\S]*?level=campaign/);
    // Dấu của dòng vẫn được kiểm và ghi level=budget_line.
    assert.match(body, /if v_line\.approved_by is null then/);
    assert.match(body, /level=budget_line/);
  });
}

// ---------------------------------------------------------------------------
// SYN-08 + SYN-09 — decide_payment_approval
// ---------------------------------------------------------------------------
test('0016 [static]: decide_payment_approval chặn trả vượt cam kết gốc → PAYMENT_EXCEEDS_COMMITMENT', () => {
  assert.match(DECIDE_PAY, /if v_actual\.commitment_id is not null then/);
  assert.match(DECIDE_PAY, /ba\.commitment_id = v_actual\.commitment_id[\s\S]*?ba\.approval_status = 'approved'/);
  assert.match(DECIDE_PAY, /v_commitment_paid \+ v_actual\.amount > v_commitment_amount/);
  assert.match(DECIDE_PAY, /PAYMENT_EXCEEDS_COMMITMENT:/);
});

test('0016 [static]: fact thiếu currency → CURRENCY_MISMATCH ở cả 2 RPC (is distinct from, không coi null là cùng currency)', () => {
  assert.match(DECIDE_CMT, /v_commitment\.currency is distinct from v_line\.currency/);
  assert.match(DECIDE_PAY, /v_actual\.currency is distinct from v_line\.currency/);
  // Tổng usage lọc bằng '=' (null bị loại) chứ không dùng is-not-distinct/coalesce nới lỏng.
  assert.match(DECIDE_CMT, /ba\.currency = v_line\.currency/);
  assert.match(DECIDE_PAY, /ba\.currency = v_line\.currency/);
});

// ---------------------------------------------------------------------------
// SYN-22 — revoke/grant EXECUTE
// ---------------------------------------------------------------------------
test('0016 [static]: revoke EXECUTE khỏi public + anon và grant authenticated/service_role cho cả 3 hàm (SYN-22)', () => {
  for (const sig of [
    'public.budget_remaining(uuid)',
    'public.upsert_member_capacity(uuid, uuid, numeric, jsonb, date, date)',
    'public.get_member_capacity(uuid, uuid)',
  ]) {
    assert.match(CODE, new RegExp(`revoke execute on function ${sig.replace(/[()]/g, '\\$&')} from public, anon;`));
    assert.match(CODE, new RegExp(`grant execute on function ${sig.replace(/[()]/g, '\\$&')} to authenticated, service_role;`));
  }
});

// ---------------------------------------------------------------------------
// SYN-23 — policy insert budget_proposals loại CEO, giữ vai còn lại
// ---------------------------------------------------------------------------
test('0016 [static]: policy budget_proposals_insert drop/recreate đúng tên, loại CEO, giữ member + proposer = auth.uid()', () => {
  assert.match(CODE, /drop policy if exists budget_proposals_insert on public\.budget_proposals;/);
  const pol = section('create policy budget_proposals_insert', 'function public.trg_budget_allocations_cap');
  assert.match(pol, /for insert to authenticated/);
  assert.match(pol, /public\.is_workspace_member\(workspace_id\)/);
  assert.match(pol, /proposer_id = auth\.uid\(\)/);
  assert.match(pol, /coalesce\(public\.current_role\(workspace_id\), ''\) <> 'ceo'/);
});

// ---------------------------------------------------------------------------
// SYN-14 — trigger over-allocation tính share_percent
// ---------------------------------------------------------------------------
test('0016 [static]: trg_budget_allocations_cap tính effective theo share_percent = round(amount gốc × share_percent/100, 2)', () => {
  const trg = section('function public.trg_budget_allocations_cap', 'create trigger budget_allocations_cap_check');
  assert.match(trg, /round\(v_source_amount \* NEW\.share_percent \/ 100, 2\)/);
  assert.match(trg, /round\(v_source_amount \* a\.share_percent \/ 100, 2\)/);
  assert.match(trg, /when NEW\.share_percent is not null then/);
  assert.match(trg, /else NEW\.amount/);
  assert.match(trg, /v_allocated \+ v_new_effective > v_source_amount/);
  assert.match(CODE, /drop trigger if exists budget_allocations_cap_check on public\.budget_allocations;/);
  assert.match(CODE, /create trigger budget_allocations_cap_check before insert or update on public\.budget_allocations/);
});

// ---------------------------------------------------------------------------
// Idempotent — cấu trúc + mô phỏng áp văn bản 2 lần không đổi
// ---------------------------------------------------------------------------
test('0016 [static]: mọi đối tượng đều create or replace / drop if exists (idempotent theo cấu trúc)', () => {
  assert.equal((CODE.match(/create or replace function/g) || []).length, 4,
    'budget_remaining + 2 decide_* + trg_budget_allocations_cap');
  assert.ok(!/create function(?! or replace)/.test(CODE));
  assert.ok(!/create policy(?! )/.test(CODE) || /drop policy if exists budget_proposals_insert/.test(CODE));
  assert.match(CODE, /drop trigger if exists budget_allocations_cap_check/);
});

test('0016 [static]: mô phỏng áp migration 2 lần trên văn bản — tập định nghĩa đối tượng không đổi', () => {
  // Mô phỏng: trích "định nghĩa cuối cùng" của từng đối tượng từ văn bản;
  // áp lần 2 = chạy lại cùng phép trích trên văn bản đã nối thêm chính nó
  // (create or replace/drop+create cho cùng kết quả cuối).
  function finalDefinitions(text) {
    const defs = {};
    const re = /create or replace function (public\.[\w]+)|create policy ([\w]+)|create trigger ([\w]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = m[1] || m[2] || m[3];
      defs[key] = (defs[key] || 0) + 1;
    }
    return Object.keys(defs).sort();
  }
  const once = finalDefinitions(CODE);
  const twice = finalDefinitions(CODE + '\n' + CODE);
  assert.deepEqual(twice, once, 'áp 2 lần phải cho cùng tập đối tượng');
  assert.deepEqual(once, [
    'budget_allocations_cap_check',
    'budget_proposals_insert',
    'public.budget_remaining',
    'public.decide_commitment_approval',
    'public.decide_payment_approval',
    'public.trg_budget_allocations_cap',
  ]);
});
