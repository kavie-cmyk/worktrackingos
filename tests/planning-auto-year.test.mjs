// tests/planning-auto-year.test.mjs
// Tự chuyển năm Planning theo bộ lọc Brand/Segment.
// Bối cảnh: dữ liệu demo SAVA META ở 2026, Lumus AI ở 2027; view Planning
// mặc định năm 2027 nên chọn Brand SAVA META thì trang rỗng. Vá:
// pickPlanningYear(rows, currentYear) thuần — chỉ phụ thuộc planRowMonth —
// giữ nguyên năm đang chọn khi năm đó có dòng (không giành quyền người
// dùng), ngược lại chọn năm nhiều dòng nhất / gần nhất / lớn hơn khi hòa;
// viewPlanning nối helper trước khi lọc theo năm + trước mọi empty-state
// và hiện ghi chú data-planning-auto-year khi đã tự chuyển.
// Tầng kiểm: [unit] helper thật trích xuất từ js/app.js + [static] khóa
// wiring/render marker trong viewPlanning (trích xuất viewPlanning nguyên
// khối quá nặng vì phụ thuộc Store/UI/esc và nhiều helper render khác,
// nên render được khóa ở tầng source như các test static hiện có).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

function loadPick() {
  const block = section('  function planRowMonth', '  function planRowQty');
  const factory = new Function(block + '\nreturn { planRowMonth: planRowMonth, pickPlanningYear: pickPlanningYear };');
  return factory();
}

function rowsOf(year, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ month: year + '-' + String((i % 12) + 1).padStart(2, '0') });
  return out;
}

// ---------- [unit] pickPlanningYear ----------
test('AUTO-YEAR [unit]: rows chỉ 2026, current 2027 -> chọn 2026, changed=true, from=2027', () => {
  const h = loadPick();
  const r = h.pickPlanningYear(rowsOf('2026', 3), 2027);
  assert.deepEqual(r, { year: 2026, changed: true, from: 2027 });
});

test('AUTO-YEAR [unit]: rows chỉ 2027, current 2027 -> giữ 2027, changed=false', () => {
  const h = loadPick();
  const r = h.pickPlanningYear(rowsOf('2027', 2), 2027);
  assert.deepEqual(r, { year: 2027, changed: false, from: 2027 });
});

test('AUTO-YEAR [unit]: rows cả 2026+2027, current có dòng -> giữ current', () => {
  const h = loadPick();
  const rows = rowsOf('2026', 5).concat(rowsOf('2027', 1));
  assert.deepEqual(h.pickPlanningYear(rows, 2027), { year: 2027, changed: false, from: 2027 });
  assert.deepEqual(h.pickPlanningYear(rows, 2026), { year: 2026, changed: false, from: 2026 });
});

test('AUTO-YEAR [unit]: current cố ý = 2026 (ít dòng hơn 2027) -> KHÔNG đổi', () => {
  const h = loadPick();
  const rows = rowsOf('2026', 1).concat(rowsOf('2027', 10));
  const r = h.pickPlanningYear(rows, 2026);
  assert.equal(r.year, 2026);
  assert.equal(r.changed, false);
});

test('AUTO-YEAR [unit]: rows rỗng -> null', () => {
  const h = loadPick();
  assert.equal(h.pickPlanningYear([], 2027), null);
  assert.equal(h.pickPlanningYear(null, 2027), null);
  assert.equal(h.pickPlanningYear(undefined, 2027), null);
});

test('AUTO-YEAR [unit]: rows không có năm hợp lệ 4 chữ số -> null', () => {
  const h = loadPick();
  assert.equal(h.pickPlanningYear([{ month: '' }, {}, { month: 'abcd-01' }, { monthKey: '20-01' }], 2027), null);
});

test('AUTO-YEAR [unit]: hòa số dòng + hòa khoảng cách -> năm lớn hơn (2026 vs 2028, current 2027 -> 2028)', () => {
  const h = loadPick();
  const rows = rowsOf('2026', 2).concat(rowsOf('2028', 2));
  const r = h.pickPlanningYear(rows, 2027);
  assert.deepEqual(r, { year: 2028, changed: true, from: 2027 });
});

test('AUTO-YEAR [unit]: số dòng thắng khoảng cách (current 2027 rỗng, 2026 có 5, 2028 có 3 -> 2026)', () => {
  const h = loadPick();
  const rows = rowsOf('2026', 5).concat(rowsOf('2028', 3));
  const r = h.pickPlanningYear(rows, 2027);
  assert.equal(r.year, 2026);
  assert.equal(r.changed, true);
  assert.equal(r.from, 2027);
});

test('AUTO-YEAR [unit]: hòa số dòng -> năm gần current nhất thắng trước khi xét năm lớn hơn', () => {
  const h = loadPick();
  // 2025 và 2026 cùng 2 dòng, current 2027: khoảng cách 2 vs 1 -> 2026.
  const rows = rowsOf('2025', 2).concat(rowsOf('2026', 2));
  assert.equal(h.pickPlanningYear(rows, 2027).year, 2026);
  // monthKey / periodKey cũng được tính qua planRowMonth.
  const rows2 = [{ monthKey: '2026-03' }, { periodKey: '2026-04' }];
  assert.equal(h.pickPlanningYear(rows2, 2027).year, 2026);
});

// ---------- [static] wiring trong viewPlanning ----------
test('AUTO-YEAR [static]: viewPlanning gọi helper với (allRows, year) TRƯỚC khi lọc rows theo năm và trước empty-state / rẽ mode', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  assert.match(v, /var autoYear = pickPlanningYear\(allRows, year\);/);
  assert.match(v, /UI\.planningYear = year;/);
  const idxPick = v.indexOf('pickPlanningYear(allRows, year)');
  const idxFilter = v.indexOf('var rows = allRows.filter');
  const idxEmpty = v.indexOf('planningEmptyStateHtml');
  const idxMode = v.indexOf("planningPhaseModeHtml(year, rows, benchmarks)");
  assert.ok(idxPick !== -1 && idxFilter !== -1 && idxPick < idxFilter, 'helper phải chạy trước khi lọc rows theo năm');
  assert.ok(idxPick < idxEmpty, 'helper phải chạy trước mọi nhánh empty-state');
  assert.ok(idxPick < idxMode, 'helper phải chạy trước điểm rẽ mode phase');
});

test('AUTO-YEAR [static]: ghi chú tự chuyển — class sub + data-planning-auto-year, đủ năm mới + contextLabel() + năm cũ, đặt ngay dưới form chọn năm (trước rẽ mode)', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  assert.match(v, /data-planning-auto-year="1"/);
  assert.match(v, /class="sub" data-planning-auto-year="1"/);
  // Nội dung ghi chú gồm cả năm mới (autoYearNote.to), ngữ cảnh lọc
  // (contextLabel()) và năm cũ (autoYearNote.from).
  assert.match(v, /Đã tự chuyển sang năm ' \+ esc\(autoYearNote\.to\)/);
  assert.match(v, /esc\(contextLabel\(\)\)/);
  assert.match(v, /chưa có dòng plan trong năm ' \+ esc\(autoYearNote\.from\)/);
  // Đặt ngay dưới form chọn năm và trước điểm rẽ mode -> hiện ở cả
  // Theo tháng lẫn Theo phase.
  const idxForm = v.indexOf('id="planning-year-form"');
  const idxNote = v.indexOf('data-planning-auto-year="1"');
  const idxModeBranch = v.indexOf("if (mode === 'phase')");
  assert.ok(idxForm !== -1 && idxNote > idxForm, 'ghi chú phải nằm dưới form chọn năm');
  assert.ok(idxNote < idxModeBranch, 'ghi chú phải nằm trước điểm rẽ mode');
  // Chỉ hiện khi có autoYearNote (đã changed) — bọc trong if (autoYearNote).
  assert.match(v, /if \(autoYearNote\) \{[\s\S]*?data-planning-auto-year="1"/);
});

test('AUTO-YEAR [static]: helper thuần chỉ phụ thuộc planRowMonth (không đọc UI/Store)', () => {
  const block = section('  function pickPlanningYear', '  function planRowQty');
  assert.match(block, /planRowMonth\(r\)\.slice\(0, 4\)/);
  assert.doesNotMatch(block, /\bUI\./);
  assert.doesNotMatch(block, /\bStore\./);
});
