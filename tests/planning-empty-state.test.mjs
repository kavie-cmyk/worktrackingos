// tests/planning-empty-state.test.mjs
// Vá trải nghiệm "Planning trống" (17/11/2026) — Executor B.
// Bối cảnh: Owner ở chế độ dữ liệu THẬT (chưa có dữ liệu brand/plan) bấm
// Planning thấy trống trơn không lời giải thích. Vá:
//  - viewPlanning phân biệt 3 trường hợp rỗng: toàn tập trống (no-data),
//    rỗng do bộ lọc Brand/Segment (filtered), rỗng do năm (year);
//  - (prep/remove-demo-mode) KHÔNG còn nút "Xem dữ liệu mẫu" / chế độ
//    demo: khối rỗng chỉ giải thích + hướng dẫn nới lọc / tạo dữ liệu;
//  - cùng mẫu cho trạng thái rỗng toàn tập của mục Brand (#/brand);
//  - brandFilter KHÔNG bị persist vào localStorage/prefs (mặc định 'all').
// Tầng kiểm: [static] khóa cấu trúc source + [unit] render helper thật
// (planningEmptyStateHtml / brandEmptyStateHtml) bằng stub esc tối thiểu,
// đúng mẫu test render/string hiện có của repo.

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

function escStub(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function loadEmptyHelpers() {
  const block = section('// ---------- Planning / Brand: trạng thái rỗng có lời ----------', '// ---------- Planning (Brand + Planning, bản bấm thử) ----------');
  const factory = new Function('esc', block + '\nreturn { planningEmptyStateHtml: planningEmptyStateHtml, brandEmptyStateHtml: brandEmptyStateHtml };');
  return factory(escStub);
}

// ---------- [static] wiring trong viewPlanning / view Brand / handler ----------
test('EMPTY [static]: viewPlanning rẽ 3 trường hợp rỗng qua planningEmptyStateHtml (no-data / filtered / year)', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  assert.match(v, /var allPlanRows = planRowsList\(\);/);
  assert.match(v, /if \(!allPlanRows\.length\) \{\s*\n\s*html \+= planningEmptyStateHtml\('no-data'/);
  // Rỗng-do-lọc chỉ khi tập ĐÃ lọc Brand/Segment (allRows) trống hẳn;
  // còn dòng đã lọc mà rỗng theo năm là nhánh 'year' riêng.
  assert.match(v, /if \(!allRows\.length\) \{\s*\n\s*html \+= planningEmptyStateHtml\('filtered'/);
  assert.match(v, /html \+= planningEmptyStateHtml\('year'/);
  // Câu chữ cũ gộp chung nguyên nhân (năm + bộ lọc trong một câu) đã bị gỡ.
  assert.doesNotMatch(v, /khớp bộ lọc hiện tại \('/);
});

test('EMPTY [static]: KHÔNG còn nút/demo mode trong trạng thái rỗng (đã gỡ demo)', () => {
  const helpers = section('// ---------- Planning / Brand: trạng thái rỗng có lời ----------', '// ---------- Planning (Brand + Planning, bản bấm thử) ----------');
  assert.doesNotMatch(helpers, /demo-on-planning|demo-on-brand|Xem dữ liệu mẫu|isDemo/);
  assert.doesNotMatch(src, /demo-on-planning|demo-on-brand|setDemoEnabled/);
});

test('EMPTY [static]: mục Brand áp cùng mẫu trạng thái rỗng (brandEmptyStateHtml) khi collection brands trống toàn tập', () => {
  const sec = section('function brandSectionHtml(ed)', 'function brandDetailHtml(b)');
  assert.match(sec, /html \+= brandEmptyStateHtml\(\{ canEditBrand: ed \}\);/);
});

test('EMPTY [static]: Planning vẫn hiện nhãn ngữ cảnh lọc như các view khác (contextBanner + contextLabel)', () => {
  const v = section('function viewPlanning()', '// ---------- Planning Theo phase');
  assert.match(v, /contextBannerHtml\(\)/);
  assert.match(v, /Ngữ cảnh: ' \+ esc\(contextLabel\(\)\)/);
});

// ---------- [static] brandFilter không bị persist ----------
test('EMPTY [static]: brandFilter/segmentFilter KHÔNG lưu localStorage hay prefs — mặc định luôn all khi tải lại trang', () => {
  assert.match(src, /brandFilter: 'all',\s*\n\s*segmentFilter: 'all',/);
  assert.doesNotMatch(src, /localStorage[^;\n]*brandFilter/);
  assert.doesNotMatch(src, /localStorage[^;\n]*segmentFilter/);
  assert.doesNotMatch(src, /setPref\('(brandFilter|segmentFilter)'/);
  assert.doesNotMatch(src, /getPrefs\(\)[^;]*brandFilter/);
  // Chỉ có 2 điểm ghi state: handler đổi select ở sidebar.
  assert.match(src, /ctxKind === 'context-brand'\) \{ UI\.brandFilter = t\.value \|\| 'all'; render\(\); return; \}/);
});

// ---------- [unit] render helper: Planning ----------
test('EMPTY [unit]: plan rỗng toàn tập -> giải thích + hướng dẫn tạo dữ liệu, không nút mẫu', () => {
  const h = loadEmptyHelpers();
  const html = h.planningEmptyStateHtml('no-data', { year: 2027, contextLabel: 'Tất cả Brand · Tất cả Segment' });
  assert.match(html, /data-planning-empty="1"/);
  assert.match(html, /data-planning-empty-kind="no-data"/);
  assert.match(html, /Chưa có dòng Planning nào/);
  assert.match(html, /hãy tạo Brand rồi thêm dòng Planning đầu tiên/);
  assert.doesNotMatch(html, /demo|Xem dữ liệu mẫu/);
});

test('EMPTY [unit]: rỗng do lọc -> nói rõ đang lọc theo Brand/Segment nào + gợi ý nới lọc', () => {
  const h = loadEmptyHelpers();
  const html = h.planningEmptyStateHtml('filtered', { year: 2027, contextLabel: 'Brand: Lumus AI · Segment: B2C', total: 776 });
  assert.match(html, /data-planning-empty-kind="filtered"/);
  assert.match(html, /Đang lọc theo <strong>Brand: Lumus AI · Segment: B2C<\/strong>/);
  assert.match(html, /776 dòng ngoài ngữ cảnh đang chọn/);
  assert.match(html, /sang "Tất cả" ở thanh bên để nới lọc/);
  assert.doesNotMatch(html, /demo|Xem dữ liệu mẫu/);
});

test('EMPTY [unit]: rỗng do năm -> nói rõ thuộc năm khác, không đổ cho bộ lọc', () => {
  const h = loadEmptyHelpers();
  const html = h.planningEmptyStateHtml('year', { year: 2026, contextLabel: 'Tất cả Brand · Tất cả Segment', total: 776 });
  assert.match(html, /data-planning-empty-kind="year"/);
  assert.match(html, /Không có dòng Planning nào cho năm 2026/);
  assert.match(html, /thuộc năm khác/);
  assert.doesNotMatch(html, /demo/);
});

// ---------- [unit] render helper: Brand ----------
test('EMPTY [unit]: Brand rỗng toàn tập -> hướng dẫn tạo Brand đầu tiên khi có quyền sửa', () => {
  const h = loadEmptyHelpers();
  const html = h.brandEmptyStateHtml({ canEditBrand: true });
  assert.match(html, /data-brand-empty="1"/);
  assert.match(html, /data-brand-empty-kind="no-data"/);
  assert.match(html, /Chưa có Brand nào trong collection brands/);
  assert.match(html, /tạo Brand đầu tiên\./);
  assert.doesNotMatch(html, /demo|Xem dữ liệu mẫu/);
});

test('EMPTY [unit]: Brand rỗng + vai chỉ xem -> không hiện hướng dẫn tạo', () => {
  const h = loadEmptyHelpers();
  const html = h.brandEmptyStateHtml({ canEditBrand: false });
  assert.match(html, /Chưa có Brand nào trong collection brands/);
  assert.doesNotMatch(html, /Tạo Brand/);
});
