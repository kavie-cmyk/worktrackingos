// tests/planning-month-qty.test.mjs
// Planning Theo tháng (thiết kế chốt lại 17/11): lưới CHỈ HIỂN THỊ; bấm
// vào một dòng Channel mở BẢNG CHI TIẾT ngay bên dưới lưới cho đúng dòng
// đó — trong chi tiết mới sửa Số lượng theo từng tháng; tổng = tổng các tháng.
// Yêu cầu khóa:
//  (mở) bấm dòng mở đúng bảng chi tiết của dòng đó; chỉ mở MỘT dòng;
//       bấm dòng khác chuyển chi tiết; bấm lại dòng đang mở / nút đóng
//       thì đóng (planningDetailToggle thuần + wiring handler);
//  (a) sửa ô tháng trong bảng chi tiết cập nhật Store (plan_rows) đúng
//      dòng/tháng đó;
//  (b) Tổng hàng = tổng các ô tháng — sửa 1 ô thì tổng tăng đúng chênh lệch;
//  (c) nhập sai (âm / chữ / thập phân / trống) bị chặn, dữ liệu không đổi;
//  (d) nhất quán 2 chế độ: sửa Theo tháng -> Theo phase thấy số mới và
//      ngược lại (cùng nguồn plan_rows, không bản sao);
//  (e) ô tháng chưa có dòng plan: nhập > 0 tạo dòng mới đúng ngữ cảnh,
//      nhập 0 thì không tạo; ô chỉ có dòng Ngân sách không sửa Số lượng.
// Neo demo: Lumus AI tổng Content FY2027 = 764 khi chưa sửa gì, và mọi
// đường tổng (domain summarize + helper ô tháng) đều cộng từ các tháng.
// Tầng kiểm: [static] khóa wiring/render trong js/app.js + CSS;
// [unit] trích xuất helper + hàm lưu THẬT của js/app.js chạy với stub
// Store/sUpdate/sCreate/saveResult/toast/render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}

// Nạp helper (khối Brand/Planning) + khối lưu Theo phase/Theo tháng THẬT.
function makeHarness(rows, phases) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const saves = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all' };
  const state = { toasts: [], updates: [], creates: [], renders: 0 };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : []),
    get: () => null,
  };
  const sUpdate = (coll, id, patch) => {
    const item = rows.find((r) => r.id === id);
    if (!item) return { ok: false, error: 'Không tìm thấy dòng plan.' };
    Object.assign(item, patch);
    state.updates.push({ coll, id, patch });
    return { ok: true, item };
  };
  const sCreate = (coll, obj) => {
    const item = { id: 'plan-new-' + (rows.length + 1), ...obj };
    rows.push(item);
    state.creates.push({ coll, item });
    return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'tbl', 'vizFunnelHtml',
    helpers + '\n' + saves +
    '\nreturn { planRowQty: planRowQty, planRowGroup: planRowGroup, planRowHasQty: planRowHasQty, planMonthRows: planMonthRows, planMonthQty: planMonthQty, parsePlanQty: parsePlanQty, planningDetailToggle: planningDetailToggle, filteredPlanRows: filteredPlanRows, phaseRowsFor: phaseRowsFor, savePhaseQty: savePhaseQty, savePlanningMonthQty: savePlanningMonthQty, planningMonthSaveGuard: planningMonthSaveGuard };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true,
    (m) => state.toasts.push(m),
    () => { state.renders++; },
    sUpdate, sCreate, saveResult,
    (s) => String(s === null || s === undefined ? '' : s),
    (n) => String(n),
    () => '', () => '');
  return { h, state };
}

const PHASES = [
  { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
  { id: 'phase-lumus-2', brand_id: 'brand-lumus-ai', name: 'Test & Validate', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5 },
];
function baseRows() {
  return [
    { id: 'r-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Facebook Owned', group: 'Owned Social', unit: 'posts', qty: 21, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-feb', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-02', channel: 'Facebook Owned', group: 'Owned Social', unit: 'posts', qty: 20, budget: null, phase_id: 'phase-lumus-1' },
    { id: 'r-mar', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-03', channel: 'Facebook Owned', group: 'Owned Social', unit: 'posts', qty: 20, budget: null, phase_id: 'phase-lumus-2' },
    { id: 'r-ads-jan', brand_id: 'brand-lumus-ai', segment: 'b2c', month: '2027-01', channel: 'Meta Ads', group: 'Paid Media', unit: null, qty: null, budget: 1000000, phase_id: 'phase-lumus-1' },
  ];
}
const MONTHS_3 = ['2027-01', '2027-02', '2027-03'];
function rowTotalOf(h, rows) {
  return MONTHS_3.reduce((s, m) => s + h.planMonthQty(rows, 'Facebook Owned', 'Owned Social', m), 0);
}

// ---------- [static] wiring lưới + bảng chi tiết Theo tháng ----------
test('PMQ [static]: lưới Theo tháng CHỈ HIỂN THỊ số lượng (không input trong lưới); bấm tên Channel mở chi tiết', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const grid = v.slice(0, v.indexOf('// Bảng chi tiết của dòng đang chọn'));
  assert.ok(grid.length > 0);
  // Ô lưới là text hiển thị như cũ, KHÔNG còn ô sửa trực tiếp trong lưới.
  assert.match(grid, /return '<td>' \+ \(sum \? fmtNum\(sum\) : '—'\) \+ '<\/td>';/);
  assert.doesNotMatch(grid, /planning-month-qty/);
  assert.doesNotMatch(grid, /<input/);
  // Dòng vẫn bấm được qua tên Channel (kèm group) + trạng thái đang mở.
  assert.match(grid, /data-action="planning-channel" data-channel="' \+ esc\(ch\) \+ '" data-group="' \+ esc\(gName\) \+ '"/);
  assert.match(grid, /aria-expanded="' \+ \(isOpen \? 'true' : 'false'\) \+ '"/);
  assert.match(grid, /data-planning-row-open="1"/);
  assert.match(grid, /data-planning-grid-hint="1"/);
});

test('PMQ [static]: bảng chi tiết ngay dưới lưới — đúng dòng Channel × Group, 12 ô tháng sửa được, tổng dòng tự cộng, Forecast của dòng, nút đóng + khóa khi không demo/chỉ xem', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  const detail = v.slice(v.indexOf('// Bảng chi tiết của dòng đang chọn'), v.indexOf('// Chart ngân sách dự kiến theo tháng'));
  assert.ok(detail.length > 0);
  // Đúng dòng đã bấm: lọc theo channel VÀ group của dòng đó.
  assert.match(detail, /data-planning-detail="1" data-planning-detail-channel=/);
  assert.match(detail, /data-planning-detail-group=/);
  assert.match(detail, /String\(r\.channel \|\| '—'\) === selChannel && \(selGroup === null \|\| selGroup === undefined \|\| planRowGroup\(r\) === String\(selGroup\)\)/);
  // 12 ô tháng: lặp đủ months (12) và mỗi ô là input planning-month-qty.
  assert.match(detail, /var detailMonthRows = months\.map\(function \(m\) \{/);
  assert.match(detail, /data-action-change="planning-month-qty" data-channel="' \+ esc\(selChannel\)/);
  assert.match(detail, /data-month="' \+ esc\(m\) \+ '"/);
  assert.match(detail, /class="phase-input planning-month-input" type="number" step="1" min="0"/);
  // Tháng chỉ có dòng Ngân sách (qty trống) không render input.
  assert.match(detail, /var cellHasQty = cellRows\.some\(planRowHasQty\);/);
  assert.match(detail, /if \(cellHasQty \|\| \(!cellRows\.length && selHasQty\)\)/);
  // Tổng dòng tự cộng từ các ô tháng + hàng tổng riêng.
  assert.match(detail, /detailTotal \+= sum;/);
  assert.match(detail, /data-planning-detail-total="1"/);
  // Forecast của dòng qua cơ chế sẵn có funnelTotalsFor + viz funnel.
  assert.match(detail, /var detailTotals = funnelTotalsFor\(selRows, benchmarks\);/);
  assert.match(detail, /data-viz="planning-detail-forecast"/);
  // Khóa/hint + cách đóng.
  assert.match(detail, /var detailEditable = planningInputsEditable\(\);/);
  assert.match(detail, /data-planning-detail-locked="1"/);
  assert.match(detail, /data-planning-detail-hint="1"/);
  assert.match(detail, /data-action="planning-channel-close">Đóng chi tiết</);
});

test('PMQ [static]: handler bấm dòng dùng planningDetailToggle (mở đúng dòng / chuyển dòng / bấm lại đóng); nút đóng xoá cả channel + group; state có planningChannelGroup', () => {
  assert.match(src, /planningChannel: null,\s*\n\s*planningChannelGroup: null,/);
  assert.match(src, /if \(action === 'planning-channel'\) \{ var detailSel = planningDetailToggle\(UI\.planningChannel, UI\.planningChannelGroup, t\.getAttribute\('data-channel'\), t\.getAttribute\('data-group'\)\); UI\.planningChannel = detailSel\.channel; UI\.planningChannelGroup = detailSel\.group; render\(\); \}/);
  assert.match(src, /if \(action === 'planning-channel-close'\) \{ UI\.planningChannel = null; UI\.planningChannelGroup = null; render\(\); \}/);
});

test('PMQ [unit]: planningDetailToggle — mở đúng dòng, bấm dòng khác chuyển (chỉ 1 dòng mở), bấm lại dòng đang mở thì đóng', () => {
  const { h } = makeHarness(baseRows(), PHASES);
  // Chưa mở -> bấm KOL/Facebook mở đúng dòng đó.
  let sel = h.planningDetailToggle(null, null, 'Facebook Owned', 'Owned Social');
  assert.deepEqual(sel, { channel: 'Facebook Owned', group: 'Owned Social' });
  // Đang mở dòng A -> bấm dòng B thì chi tiết chuyển sang B (A tự đóng).
  sel = h.planningDetailToggle(sel.channel, sel.group, 'KOL Nano', 'KOL');
  assert.deepEqual(sel, { channel: 'KOL Nano', group: 'KOL' });
  // Bấm lại đúng dòng đang mở -> đóng.
  sel = h.planningDetailToggle(sel.channel, sel.group, 'KOL Nano', 'KOL');
  assert.deepEqual(sel, { channel: null, group: null });
  // Cùng channel nhưng khác group là dòng khác -> chuyển, không đóng.
  sel = h.planningDetailToggle('Meta Ads', 'Paid Media', 'Meta Ads', 'Campaign Budget');
  assert.deepEqual(sel, { channel: 'Meta Ads', group: 'Campaign Budget' });
});

test('PMQ [static]: tổng lưới Theo tháng cộng TỪ CÁC Ô THÁNG (cột += ô, hàng += ô, kỳ += hàng) — không còn reduce riêng qua chRows', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  assert.match(v, /var sum = planMonthQty\(chRows, ch, gName, m\);/);
  assert.match(v, /colTotals\[idx\] \+= sum; rowTotal \+= sum;/);
  assert.match(v, /grand \+= rowTotal;/);
  assert.doesNotMatch(v, /var rowTotal = chRows\.reduce/);
  assert.match(v, /data-planning-grand="1"/);
});

test('PMQ [static]: handler change planning-month-qty gọi savePlanningMonthQty(channel, group, month, value); hàm lưu qua parsePlanQty + guard demo + sUpdate/sCreate plan_rows', () => {
  assert.match(src, /if \(ctxKind === 'planning-month-qty'\) \{ savePlanningMonthQty\(t\.getAttribute\('data-channel'\), t\.getAttribute\('data-group'\), t\.getAttribute\('data-month'\), t\.value\); return; \}/);
  const save = section('function savePlanningMonthQty(channel, group, month, raw)', '// ---------- Brand Hub ----------');
  assert.match(save, /planningMonthSaveGuard\(\)/);
  assert.match(save, /var v = parsePlanQty\(raw\);/);
  assert.match(save, /sUpdate\('plan_rows', job\.id, \{ qty: job\.qty \}\)/);
  assert.match(save, /sCreate\('plan_rows', obj\)/);
  assert.match(src, /function planningMonthSaveGuard\(\) \{\s*\n\s*if \(!canEdit\(\)\)/);
  assert.ok(css.includes('.planning-month-input'), 'CSS thiếu .planning-month-input');
});

test('PMQ [unit]: parsePlanQty — chỉ số nguyên >= 0; âm/chữ/thập phân/trống -> null', () => {
  const { h } = makeHarness(baseRows(), PHASES);
  assert.equal(h.parsePlanQty('0'), 0);
  assert.equal(h.parsePlanQty('25'), 25);
  assert.equal(h.parsePlanQty(7), 7);
  assert.equal(h.parsePlanQty('-3'), null);
  assert.equal(h.parsePlanQty('abc'), null);
  assert.equal(h.parsePlanQty('1.5'), null);
  assert.equal(h.parsePlanQty(''), null);
  assert.equal(h.parsePlanQty(null), null);
});

// ---------- (a) sửa ô tháng trong bảng chi tiết cập nhật Store đúng ----------
test('PMQ (a): sửa ô tháng 2027-01 trong bảng chi tiết của Facebook Owned 21 -> 25 cập nhật đúng dòng plan_rows đó', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES);
  h.savePlanningMonthQty('Facebook Owned', 'Owned Social', '2027-01', '25');
  assert.equal(rows.find((r) => r.id === 'r-jan').qty, 25);
  assert.deepEqual(state.updates, [{ coll: 'plan_rows', id: 'r-jan', patch: { qty: 25 } }]);
  assert.equal(state.creates.length, 0);
  assert.equal(h.planMonthQty(rows, 'Facebook Owned', 'Owned Social', '2027-01'), 25);
  assert.ok(state.toasts.some((m) => /Đã lưu Số lượng 25/.test(m)), 'phải có toast đã lưu: ' + state.toasts.join(' | '));
});

// ---------- (b) tổng hàng = tổng các tháng, tăng đúng chênh lệch ----------
test('PMQ (b): Tổng hàng = tổng các ô tháng; sửa 1 ô (+4) thì Tổng hàng và tổng kỳ (domain) cùng tăng đúng +4', () => {
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES);
  const beforeRow = rowTotalOf(h, rows);
  const beforeAll = domain.summarizePlanByMonth(rows).totalQty;
  assert.equal(beforeRow, 61);
  h.savePlanningMonthQty('Facebook Owned', 'Owned Social', '2027-02', '24');
  const afterRow = rowTotalOf(h, rows);
  const afterAll = domain.summarizePlanByMonth(rows).totalQty;
  assert.equal(afterRow - beforeRow, 4, 'Tổng hàng phải tăng đúng chênh lệch của ô vừa sửa');
  assert.equal(afterRow, 65);
  assert.equal(afterAll - beforeAll, 4, 'tổng kỳ qua summarizePlanByMonth phải tăng đúng +4');
  // Tổng theo tháng của domain khớp từng ô tháng của helper lưới.
  const byMonth = domain.summarizePlanByMonth(rows).byMonth;
  for (const m of MONTHS_3) assert.equal(byMonth[m].qty, h.planMonthQty(rows, 'Facebook Owned', 'Owned Social', m));
  // Tổng theo Channel của domain = tổng các tháng của channel đó.
  const byChannel = domain.summarizePlanByChannel(rows).byChannel['Facebook Owned'];
  assert.equal(byChannel.qty, afterRow);
});

// ---------- (c) nhập sai bị chặn ----------
test('PMQ (c): nhập sai (âm / chữ / thập phân / trống) bị chặn — không update/create, dữ liệu không đổi, có toast lỗi', () => {
  for (const raw of ['-3', 'abc', '1.5', '']) {
    const rows = baseRows();
    const snapshot = rows.map((r) => ({ ...r }));
    const { h, state } = makeHarness(rows, PHASES);
    h.savePlanningMonthQty('Facebook Owned', 'Owned Social', '2027-01', raw);
    assert.deepEqual(rows, snapshot, 'raw=' + JSON.stringify(raw) + ' không được đổi dữ liệu');
    assert.equal(state.updates.length, 0);
    assert.equal(state.creates.length, 0);
    assert.ok(state.toasts.some((m) => /Số lượng phải là số nguyên từ 0 trở lên/.test(m)), 'raw=' + JSON.stringify(raw) + ' phải báo lỗi rõ');
  }
});

// ---------- (d) nhất quán 2 chế độ ----------
test('PMQ (d): sửa Theo tháng -> Theo phase thấy số mới; sửa Theo phase -> Theo tháng thấy số mới (cùng plan_rows)', () => {
  // Tháng -> Phase: Jan 21 -> 31 (+10); Phase 1 (Jan+Feb) phải thấy 31+20=51.
  const rows = baseRows();
  const { h } = makeHarness(rows, PHASES);
  h.savePlanningMonthQty('Facebook Owned', 'Owned Social', '2027-01', '31');
  const phase1 = PHASES[0];
  const phaseRows = h.phaseRowsFor(phase1, h.filteredPlanRows()).filter((r) => r.channel === 'Facebook Owned');
  assert.equal(phaseRows.reduce((s, r) => s + h.planRowQty(r), 0), 51, 'Theo phase phải thấy tổng mới sau khi sửa Theo tháng');

  // Phase -> Tháng: đặt tổng Phase 1 = 61 (từ 41) qua savePhaseQty thật;
  // phân bổ largest-remainder theo tỉ lệ 21:20 -> Jan 31, Feb 30.
  const rows2 = baseRows();
  const { h: h2 } = makeHarness(rows2, PHASES);
  h2.savePhaseQty('phase-lumus-1', 'Facebook Owned', '61');
  assert.equal(h2.planMonthQty(rows2, 'Facebook Owned', 'Owned Social', '2027-01'), 31);
  assert.equal(h2.planMonthQty(rows2, 'Facebook Owned', 'Owned Social', '2027-02'), 30);
  assert.equal(
    h2.planMonthQty(rows2, 'Facebook Owned', 'Owned Social', '2027-01') + h2.planMonthQty(rows2, 'Facebook Owned', 'Owned Social', '2027-02'),
    61, 'tổng các ô tháng phải bằng đúng tổng Phase vừa lưu');
});

// ---------- (e) ô trống / ô ngân sách ----------
test('PMQ (e): ô tháng chưa có dòng plan — nhập > 0 tạo dòng mới đúng Brand/Segment/Phase; nhập 0 không tạo; ô chỉ có Ngân sách không lưu Số lượng', () => {
  const rows = baseRows();
  const { h, state } = makeHarness(rows, PHASES);
  h.savePlanningMonthQty('Facebook Owned', 'Owned Social', '2027-04', '9');
  assert.equal(state.creates.length, 1);
  const created = state.creates[0].item;
  assert.equal(created.month, '2027-04');
  assert.equal(created.qty, 9);
  assert.equal(created.channel, 'Facebook Owned');
  assert.equal(created.brand_id, 'brand-lumus-ai');
  assert.equal(created.segment, 'b2c');
  assert.equal(created.phase_id, 'phase-lumus-2', 'tháng 2027-04 thuộc Phase 2 của Lumus');
  assert.equal(h.planMonthQty(rows, 'Facebook Owned', 'Owned Social', '2027-04'), 9);

  const rows0 = baseRows();
  const { h: h0, state: s0 } = makeHarness(rows0, PHASES);
  h0.savePlanningMonthQty('Facebook Owned', 'Owned Social', '2027-04', '0');
  assert.equal(s0.creates.length, 0, 'nhập 0 vào ô trống không tạo dòng');
  assert.equal(rows0.length, 4);

  const rowsB = baseRows();
  const { h: hB, state: sB } = makeHarness(rowsB, PHASES);
  hB.savePlanningMonthQty('Meta Ads', 'Paid Media', '2027-01', '5');
  assert.equal(sB.updates.length, 0);
  assert.equal(sB.creates.length, 0);
  assert.equal(rowsB.find((r) => r.id === 'r-ads-jan').qty, null, 'dòng Ngân sách giữ qty trống');
  assert.equal(rowsB.find((r) => r.id === 'r-ads-jan').budget, 1000000, 'ngân sách của dòng không đổi');
  assert.ok(sB.toasts.some((m) => /chỉ có dòng Ngân sách/.test(m)));
});

// ---------- neo demo 764 + mọi đường tổng cộng từ các tháng ----------
test('PMQ [neo]: demo Lumus tổng Content FY2027 = 764 khi chưa sửa; summarize ByMonth/ByChannel và helper ô tháng đều cộng từ các tháng ra đúng 764', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 764);
  const byMonth = domain.summarizePlanByMonth(lumus);
  assert.equal(byMonth.totalQty, 764);
  assert.equal(Object.values(byMonth.byMonth).reduce((s, x) => s + x.qty, 0), 764);
  const byChannel = domain.summarizePlanByChannel(lumus);
  assert.equal(byChannel.totalQty, 764);
  for (const ch of byChannel.channels) {
    const monthSum = Object.values(ch.months).reduce((s, v) => s + v, 0);
    assert.equal(ch.qty, monthSum, 'tổng channel ' + ch.channel + ' phải bằng tổng các tháng của channel');
  }
  // Helper ô tháng của lưới: cộng mọi ô (channel × group × tháng) = 764.
  const { h } = makeHarness([], []);
  const keys = new Map();
  for (const r of lumus) keys.set(r.channel + '|' + r.group, { channel: r.channel, group: r.group });
  let gridGrand = 0;
  for (const { channel, group } of keys.values()) {
    for (let i = 1; i <= 12; i++) {
      gridGrand += h.planMonthQty(lumus, channel, group, '2027-' + String(i).padStart(2, '0'));
    }
  }
  assert.equal(gridGrand, 764);
  // plan_rows không mang trường tổng lưu sẵn nào.
  assert.ok(lumus.every((r) => r.totalQty === undefined && r.total_qty === undefined && r.total === undefined));
});
