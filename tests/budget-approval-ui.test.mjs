// tests/budget-approval-ui.test.mjs
// 0014 UI — Chuỗi duyệt ngân sách ở lớp giao diện (js/app.js):
//   - Form dòng ngân sách: bỏ ô nhập trực tiếp approved, thay bằng khối dấu
//     duyệt chỉ-đọc + nút "Đề xuất duyệt" (chỉ khi can('budget.propose')).
//   - Form Đề xuất ngân sách (modal budgetProposal) + 3 điểm mở form.
//   - Hàng đợi "Ngân sách" ở màn Duyệt/Requests: Hiện tại → Đề xuất + thanh
//     chênh lệch + % thay đổi, pill trạng thái đúng hệ màu, Owner quyết tại chỗ.
//   - Cam kết / khoản chi: pill trạng thái duyệt + nút quyết khi pending và
//     can('approval.decide'), disable kèm lý do tại chỗ cho 2 tiền kiểm UI.
//   - Hàm map lỗi dùng chung budgetApprovalErrorMessage đủ 7 tiền tố RPC.
// Tầng kiểm: [static] đọc source js/app.js + [unit] trích xuất hai hàm thuần
// (map lỗi + tính chênh lệch đề xuất) và chạy thật, theo pattern ui test cũ.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}
const editorStart = src.indexOf('function editorHtml()');
const saveStart = src.indexOf('function saveEditor(');

// Trích xuất hai hàm thuần để chạy unit thật.
const mapFn = new Function(section('function budgetApprovalErrorMessage', 'function budgetProposalChange') + '\nreturn budgetApprovalErrorMessage;')();
const changeFn = new Function(section('function budgetProposalChange', 'function budgetLineApprovedAmount') + '\nreturn budgetProposalChange;')();

// ---------- 1. Form dòng ngân sách ----------
test('0014-UI [static]: form dòng ngân sách KHÔNG còn input approved + có khối dấu duyệt và nút Đề xuất duyệt theo quyền budget.propose', () => {
  const form = section("case 'budgetLine': {", "case 'budgetProposal': {", editorStart);
  assert.ok(!form.includes("F('approved'"), 'vẫn còn ô nhập approved trực tiếp');
  assert.match(form, /F\('planned', 'Kế hoạch \(planned\)', 'number'/);
  assert.match(form, /budgetLineApprovalBlockHtml\(b\)/);
  assert.match(form, /can\('budget\.propose'\)/);
  assert.match(form, /data-kind="budgetProposal"[^>]*>Đề xuất duyệt</);
  // Helper dấu duyệt: đủ hai nhánh đã duyệt (số · người · ngày dd/mm/yyyy qua formatDateVN) / chưa duyệt.
  const stamp = section('function budgetLineApprovalBlockHtml', 'function budgetLineApprovedCellHtml');
  assert.match(stamp, /Đã duyệt ' \+ fmtMoney\(amt, cur\) \+ ' · ' \+ esc\(memberName\(/);
  assert.match(stamp, /D\.formatDateVN\(line\.approvedAt/);
  assert.match(stamp, /Chưa được duyệt/);
});

test('0014-UI [static]: lưu dòng ngân sách không gửi approved (số duyệt chỉ qua đề xuất)', () => {
  const save = section("case 'budgetLine': {", "case 'budgetProposal': {", saveStart);
  assert.doesNotMatch(save, /approved\s*:/);
  assert.match(save, /planned:/);
});

// ---------- 2. Form đề xuất ngân sách + 3 điểm mở ----------
test('0014-UI [static]: modal Đề xuất ngân sách — ngữ cảnh Hiện tại → Đề xuất, tiền tệ điền sẵn theo đối tượng, lý do, gửi qua Store.createBudgetProposal', () => {
  const form = section("case 'budgetProposal': {", "case 'allocation': {", editorStart);
  assert.match(form, /Ngữ cảnh đối tượng/);
  assert.match(form, /Hiện tại:/);
  assert.match(form, /F\('proposedAmount', 'Số đề xuất \*', 'number'/);
  assert.match(form, /F\('currency', 'Tiền tệ', 'select', ev\('currency', bpCurrency\)/);
  assert.match(form, /F\('reason', 'Lý do', 'textarea'/);
  assert.match(form, /F\('targetType', 'Đối tượng đề xuất', 'select'/);
  const save = section("case 'budgetProposal': {", "case 'allocation': {", saveStart);
  assert.match(save, /Store\.createBudgetProposal\(\{/);
  assert.match(save, /targetType: data\.targetType === 'budget_line' \? 'budget_line' : 'campaign_ceiling'/);
  assert.match(save, /amount: Number\(data\.proposedAmount\)/);
});

test('0014-UI [static]: 3 điểm mở form đề xuất — (a) form dòng ngân sách, (b) màn KPI & Ngân sách, (c) khối hạn mức Tổng quan campaign kèm dấu duyệt hạn mức', () => {
  // (b) viewKpi có nút "Đề xuất ngân sách" mở kind budgetProposal, gated budget.propose.
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /can\('budget\.propose'\) \? ' <button type="button" class="btn secondary" data-action="editor-open" data-kind="budgetProposal">Đề xuất ngân sách<\/button>/);
  // (c) khối hạn mức ở tổng quan campaign: dấu duyệt hạn mức + nút đề xuất cho ceiling của campaign đó.
  const detail = section('function campaignDetailHtml(id)', '// ---------- Nội dung (Content) ----------');
  assert.match(detail, /data-budget-ceiling-block="1"/);
  assert.match(detail, /campaignCeilingApprovalHtml\(c\)/);
  assert.match(detail, /data-target-type="campaign_ceiling">Đề xuất ngân sách</);
  const ceil = section('function campaignCeilingApprovalHtml', 'function factApprovalStatusOf');
  assert.match(ceil, /Đã duyệt bởi/);
  assert.match(ceil, /Hạn mức chưa được duyệt/);
});

// ---------- 3. Hàng đợi Ngân sách (Requests / màn Duyệt) ----------
test('0014-UI [static]: hàng đợi Ngân sách liệt kê Store.budgetProposals với Hiện tại → Đề xuất + thanh chênh lệch + %, người đề xuất, lý do, pill đúng tông, Owner mới thấy nút quyết + ô ghi chú', () => {
  const q = section('function budgetProposalsQueueHtml()', '// R2-30.6');
  assert.match(q, /Store\.list\('budgetProposals'\)/);
  assert.match(q, /Hàng đợi ngân sách/);
  assert.match(q, /budgetProposalTargetLabel\(p\)/);
  assert.match(q, /budgetProposalDeltaHtml\(p\)/);
  assert.match(q, /Người đề xuất: ' \+ esc\(memberName\(p\.proposerId/);
  assert.match(q, /p\.reason/);
  assert.match(q, /vizStatusPillHtml\(st, \{ label: labelStatus\(st\) \}\)/);
  assert.match(q, /can\('budget\.decide'\)/);
  assert.match(q, /id="budget-proposal-note-' \+ esc\(p\.id\)/);
  assert.match(q, /data-action="budget-proposal-decide" data-decision="approved"/);
  assert.match(q, /data-action="budget-proposal-decide" data-decision="rejected"/);
  assert.match(q, /Chỉ Owner được duyệt ngân sách/);
  // Thanh chênh lệch dùng helper viz sẵn có + % thay đổi từ budgetProposalChange.
  const delta = section('function budgetProposalDeltaHtml', 'function budgetProposalsQueueHtml');
  assert.match(delta, /Hiện tại: <strong>/);
  assert.match(delta, /→ Đề xuất: <strong>/);
  assert.match(delta, /vizHBarHtml\(/);
  assert.match(delta, /budgetProposalChange\(cur, prop\)/);
  // Màn Duyệt (Requests) thật sự gắn hàng đợi này vào view.
  const approvals = section('function viewApprovals()', '// ---------- Team & Workload ----------');
  assert.match(approvals, /budgetProposalsQueueHtml\(\)/);
  // Handler quyết đề xuất: gọi store với revision đang xem + map lỗi theo context proposal.
  assert.match(src, /Store\.decideBudgetProposal\(id, bpDecision, bpNote, bp\.revision/);
  assert.match(src, /budgetApprovalErrorMessage\(msg, 'proposal'\)/);
});

test('0014-UI [unit]: budgetProposalChange — chênh lệch + % thay đổi, hiện tại trống/0 thì pct = null', () => {
  assert.deepEqual(changeFn(100, 130), { current: 100, proposed: 130, diff: 30, pct: 30 });
  assert.deepEqual(changeFn(200, 150), { current: 200, proposed: 150, diff: -50, pct: -25 });
  assert.equal(changeFn(null, 50).pct, null);
  assert.equal(changeFn(0, 50).pct, null);
  assert.equal(changeFn(100, null).proposed, null);
});

// ---------- 4. Pill + nút quyết cho fact, disable 2 lý do ----------
test('0014-UI [static]: factApprovalControlsHtml — pill theo Domain.factApprovalStatus (thiếu = approved), nút chỉ khi pending + approval.decide, disable kèm 2 lý do tại chỗ', () => {
  const helpers = section('function factApprovalStatusOf', 'function budgetProposalCurrentValue');
  assert.match(helpers, /D\.factApprovalStatus\(fact\)/);
  assert.match(helpers, /return 'approved';/);
  assert.match(helpers, /function factApprovalPillHtml\(fact\)/);
  assert.match(helpers, /vizStatusPillHtml\(st, \{ label: labelStatus\(st\) \}\)/);
  const controls = section('function factApprovalControlsHtml', 'function budgetProposalCurrentValue');
  assert.match(controls, /st !== 'pending'/);
  assert.match(controls, /can\('approval\.decide'\)/);
  assert.match(controls, /budgetFactBlockReason\(fact, kind\)/);
  assert.match(controls, /data-action="budget-fact-decide" data-kind="' \+ esc\(kind\) \+ '" data-decision="approved"/);
  assert.match(controls, /data-decision="rejected"/);
  assert.match(controls, /budget-approval-block-reason/);
  // Tiền kiểm: dòng chưa approvedBy → lý do 1; vượt trần qua Domain.budgetUsageTotal (fact tính như đã duyệt) → lý do 2.
  const reason = section('function budgetFactBlockReason', 'function factApprovalControlsHtml');
  assert.match(reason, /line\.approvedBy/);
  assert.match(reason, /return 'Khoản ngân sách chưa được duyệt';/);
  assert.match(reason, /D\.budgetUsageTotal\(line, commitments, actuals\)/);
  assert.match(reason, /approvalStatus: 'approved'/);
  assert.match(reason, /return 'Vượt số đã duyệt';/);
  // Handler quyết fact: đúng 2 method store + map lỗi dùng chung.
  assert.match(src, /Store\.decideCommitmentApproval\(id, bfDecision, bfNote\)/);
  assert.match(src, /Store\.decidePaymentApproval\(id, bfDecision, bfNote\)/);
  assert.match(src, /budgetApprovalErrorMessage\(msg, 'fact'\)/);
});

test('0014-UI [static]: pill + nút decide xuất hiện ở KPI & Ngân sách (cam kết + khoản chi), tab ngân sách campaign và drawer Action Plan', () => {
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /<th>Duyệt<\/th>/);
  assert.match(kpi, /factApprovalControlsHtml\(cm, 'commitment'\)/);
  assert.match(kpi, /factApprovalControlsHtml\(a, 'actual'\)/);
  const drawer = section('function activityDrawerHtml()', 'function campaignDetailHtml(id)');
  assert.match(drawer, /factApprovalControlsHtml\(cm, 'commitment'\)/);
  assert.match(drawer, /factApprovalControlsHtml\(a, 'actual'\)/);
});

// ---------- 5. Dấu duyệt ở bảng ngân sách ----------
test('0014-UI [static]: cột Đã duyệt ở viewKpi + drawer kèm dòng phụ người duyệt + ngày hoặc nhãn Chưa được duyệt', () => {
  const cell = section('function budgetLineApprovedCellHtml', 'function approvalStampLineHtml');
  assert.match(cell, /memberName\(line\.approvedBy/);
  assert.match(cell, /D\.formatDateVN\(line\.approvedAt/);
  assert.match(cell, /Chưa được duyệt/);
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /budgetLineApprovedCellHtml\(b\)/);
  const drawer = section('function activityDrawerHtml()', 'function campaignDetailHtml(id)');
  assert.match(drawer, /budgetLineApprovedCellHtml\(l\)/);
});

// ---------- 6. Map lỗi đủ 7 tiền tố ----------
test('0014-UI [unit]: budgetApprovalErrorMessage map đủ 7 tiền tố sang tiếng Việt (FORBIDDEN_ROLE tách proposal/fact)', () => {
  assert.equal(mapFn('BUDGET_NOT_APPROVED: dòng chưa duyệt', 'fact'), 'Khoản ngân sách chưa được duyệt');
  assert.equal(mapFn('BUDGET_LIMIT_EXCEEDED: vượt', 'fact'), 'Vượt số đã duyệt');
  assert.equal(mapFn('SELF_APPROVAL: tự duyệt', 'fact'), 'Không được tự duyệt khoản do mình tạo');
  assert.equal(mapFn('ALREADY_DECIDED: đã quyết', 'fact'), 'Khoản này đã được quyết định trước đó');
  assert.equal(mapFn('FORBIDDEN_ROLE: member', 'fact'), 'Bạn không có quyền duyệt mục này');
  assert.equal(mapFn('FORBIDDEN_ROLE: lead', 'proposal'), 'Chỉ Owner được duyệt ngân sách');
  assert.equal(mapFn('STALE_REVISION: lệch revision', 'proposal'), 'Đề xuất đã thay đổi, hãy tải lại');
  assert.equal(mapFn('CURRENCY_MISMATCH: lệch tiền tệ', 'fact'), 'Khác tiền tệ với khoản ngân sách');
  assert.equal(mapFn('Lỗi lạ khác', 'fact'), 'Lỗi lạ khác');
  assert.equal(mapFn({ error: 'BUDGET_LIMIT_EXCEEDED: x' }, 'fact'), 'Vượt số đã duyệt');
});

// ---------- CSS: lớp mới dùng biến hệ màu, không hex cứng ----------
test('0014-UI [static]: CSS lớp duyệt ngân sách dùng biến trạng thái sẵn có, không thêm hex cứng', () => {
  assert.match(css, /\.budget-approval-block-reason\{color:var\(--st-overdue\)/);
  assert.match(css, /\.budget-proposal-delta\{/);
});
