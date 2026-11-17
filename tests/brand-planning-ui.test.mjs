// tests/brand-planning-ui.test.mjs
// Brand + Planning (bản bấm thử 17/11/2026) — Executor B (giao diện).
// Bao phủ: bộ lọc Brand/Segment toàn cục (state + selector + handler),
// view Planning (lưới Channel × tháng, chi tiết channel, chart Budget/Forecast),
// trang Brand (danh sách, thẻ Identity, form tạo Brand demo) và việc nối
// các hàm domain của Executor A (planBudget / forecastFunnel) qua lớp
// chuẩn hoá phòng thủ normalize*.
// Tầng kiểm: [static] khóa cấu trúc source; [unit] trích xuất khối helper
// thật của js/app.js chạy với stub Store/D/UI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ---------- [static] điều hướng + route + view ----------
test('BP-UI [static]: nav có Planning trong nhóm Kế hoạch & content; ROUTES + VIEWS có planning', () => {
  assert.match(src, /\['timeline', 'Timeline'\], \['planning', 'Planning'\]/);
  assert.match(src, /var ROUTES = \[[^\]]*'planning'[^\]]*\];/);
  assert.match(src, /'planning': viewPlanning/);
});

test('BP-UI [static]: state lọc toàn cục duy nhất brandFilter/segmentFilter + selector ở sidebar', () => {
  assert.match(src, /brandFilter: 'all',\s*\n\s*segmentFilter: 'all',/);
  assert.match(src, /id="context-brand-select" data-action-change="context-brand"/);
  assert.match(src, /id="context-segment-select" data-action-change="context-segment"/);
  assert.match(src, /contextSelectorHtml\(\)/);
  // Handler change cập nhật đúng state rồi render lại.
  assert.match(src, /ctxKind === 'context-brand'\) \{ UI\.brandFilter = t\.value \|\| 'all'; render\(\); return; \}/);
  assert.match(src, /ctxKind === 'context-segment'\) \{ UI\.segmentFilter = t\.value \|\| 'all'; render\(\); return; \}/);
  // Selector lấy brand ĐỘNG từ collection brands, không hardcode tên brand.
  assert.match(src, /function contextSelectorHtml\(\) \{[\s\S]*?brandsList\(\)/);
});

test('BP-UI [static]: Overview / Campaigns / KPI & Ngân sách áp bộ lọc Brand/Segment', () => {
  const ov = section('function viewOverview()', '// ---------- Việc của tôi ----------');
  assert.match(ov, /filteredCampaigns\(\)/);
  assert.match(ov, /matchesBrandSegment\(t, campaignContextFallback\(t\.campaignId\)\)/);
  const camps = section('function viewCampaigns()', '// ---------- R3.1-VIZ: lớp trình bày');
  assert.match(camps, /filteredCampaigns\(\)/);
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /Store\.list\('kpis'\)\.filter\(function \(k\) \{ return matchesBrandSegment\(k, campaignContextFallback\(k\.campaignId\)\); \}\)/);
  assert.match(kpi, /visibleList\('budgetLines'\)\.filter\(function \(b\) \{ return matchesBrandSegment\(b, campaignContextFallback\(b\.campaignId\)\); \}\)/);
});

test('BP-UI [static]: view Planning — lưới theo group, tổng hàng/cột/kỳ, chi tiết channel, 2 chart', () => {
  const v = section('function viewPlanning()', '// ---------- Brand Hub ----------');
  assert.match(v, /data-planning-grand="1"/);
  assert.match(v, /'planning-grid'/);
  assert.match(v, /Tổng theo tháng/);
  assert.match(v, /data-action="planning-channel"/);
  assert.match(v, /data-planning-detail="1"/);
  assert.match(v, /planBudgetFor\(rows, benchmarks\)/);
  assert.match(v, /forecastFunnelFor\(rows, benchmarks\)/);
  assert.match(v, /data-viz="planning-budget-chart"/);
  assert.match(v, /data-viz="planning-forecast-chart"/);
  assert.match(v, /id="planning-year-form"/);
  assert.match(v, /filteredPlanRows\(\)/);
});

test('BP-UI [static]: trang Brand — danh sách, thẻ Identity (palette swatch/voice/key messages/funnel), form tạo Brand', () => {
  const v = section('function viewBrand()', '// ---------- IMC & Campaigns ----------');
  assert.match(v, /brandSectionHtml\(ed\)/);
  assert.match(v, /data-kind="brandNew"/);
  const sec = section('function brandSectionHtml(ed)', 'function brandDetailHtml(b)');
  assert.match(sec, /data-brand-card=/);
  assert.match(sec, /data-action="brand-detail"/);
  const det = section('function brandDetailHtml(b)', 'function viewBrand()');
  assert.match(det, /data-brand-detail=/);
  assert.match(det, /brand-swatch/);
  assert.match(det, /Key messages:/);
  assert.match(det, /Các bước Funnel:/);
  assert.match(det, /Ngân sách dự kiến \(Planning\)/);
  // Form tạo Brand ở editor + lưu qua sCreate('brands').
  assert.match(src, /case 'brandNew': \{[\s\S]*?formShell\('brandNew', 'Tạo Brand mới \(demo\)'/);
  assert.match(src, /case 'brandNew': \{[\s\S]*?sCreate\('brands', newBrand\)/);
});

test('BP-UI [static]: CSS có lớp cho bộ lọc ngữ cảnh + swatch Brand', () => {
  assert.ok(css.includes('.context-filter'), 'CSS thiếu .context-filter');
  assert.ok(css.includes('.brand-swatch'), 'CSS thiếu .brand-swatch');
});

// ---------- [unit] helper thật với stub ----------
function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}
function loadHelpers({ storeList, domain }) {
  const block = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const UI = { brandFilter: 'all', segmentFilter: 'all' };
  const Store = {
    list: storeList || (() => []),
    get: () => null,
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal',
    block + '\nreturn { UI: UI, brandsList: brandsList, matchesBrandSegment: matchesBrandSegment, planBudgetFor: planBudgetFor, forecastFunnelFor: forecastFunnelFor, filteredPlanRows: filteredPlanRows };');
  return factory(Store, domain || {}, UI, cfValStub);
}

test('BP-UI [unit]: matchesBrandSegment — bản ghi không brand/segment chỉ hiện khi chọn Tất cả', () => {
  const h = loadHelpers({});
  const bare = { id: 'x' };
  const tagged = { id: 'y', brand_id: 'brand-lumus-ai', segment: 'b2c' };
  assert.equal(h.matchesBrandSegment(bare), true);
  h.UI.brandFilter = 'brand-lumus-ai';
  assert.equal(h.matchesBrandSegment(bare), false, 'không brand_id phải ẩn khi đã chọn brand');
  assert.equal(h.matchesBrandSegment(tagged), true);
  assert.equal(h.matchesBrandSegment({ brand_id: 'brand-sava-meta' }), false);
  h.UI.brandFilter = 'all'; h.UI.segmentFilter = 'b2b';
  assert.equal(h.matchesBrandSegment(tagged), false, 'segment b2c phải ẩn khi lọc b2b');
  assert.equal(h.matchesBrandSegment({ segment: 'b2b' }), true);
  assert.equal(h.matchesBrandSegment(bare), false, 'không segment phải ẩn khi đã chọn segment');
});

test('BP-UI [unit]: brandsList phòng thủ khi Store.list ném lỗi (collection chưa có)', () => {
  const h = loadHelpers({ storeList: () => { throw new Error('no collection'); } });
  assert.deepEqual(h.brandsList(), []);
  assert.deepEqual(h.filteredPlanRows(), []);
});

test('BP-UI [unit]: planBudgetFor nối đúng shape thật của domain A ({byMonth:{m:{amount}}})', () => {
  const domain = { planBudget: () => ({ months: ['2027-01'], byMonth: { '2027-01': { month: '2027-01', amount: 123456, directBudget: 0, unitPriceBudget: 123456 } }, total: 123456 }) };
  const h = loadHelpers({ domain });
  assert.deepEqual(h.planBudgetFor([{ month: '2027-01', channel: 'X', qty: 1 }], []), [{ month: '2027-01', total: 123456 }]);
});

test('BP-UI [unit]: planBudgetFor dự phòng qty × unit_price khi domain chưa có hàm', () => {
  const h = loadHelpers({ domain: {} });
  const rows = [{ month: '2027-02', channel: 'KOL Nano', qty: 2, brand_id: 'brand-lumus-ai' }];
  const benchmarks = [{ brand_id: 'brand-lumus-ai', channel: 'KOL Nano', unit_price: 1500000 }];
  assert.deepEqual(h.planBudgetFor(rows, benchmarks), [{ month: '2027-02', total: 3000000 }]);
});

test('BP-UI [unit]: forecastFunnelFor nối đúng shape thật của domain A ({steps:[tên], totals:{...}})', () => {
  const domain = { forecastFunnel: () => ({ steps: ['views', 'visits', 'signups', 'first', 'paid'], totals: { views: 16000, visits: 48, signups: 4.32, first: 2.16, paid: 0.1188 }, byMonth: {}, rows: [] }) };
  const h = loadHelpers({ domain });
  const steps = h.forecastFunnelFor([{ month: '2027-01', channel: 'KOL Nano', qty: 4 }], []);
  assert.deepEqual(steps.map((s) => s.label), ['Views', 'Visits', 'Signups', 'First starts', 'Paid']);
  assert.deepEqual(steps.map((s) => s.value), [16000, 48, 4.32, 2.16, 0.1188]);
});

test('BP-UI [unit]: forecastFunnelFor dự phòng từ benchmark khi domain chưa có hàm; không benchmark thì rỗng, không crash', () => {
  const h = loadHelpers({ domain: {} });
  const rows = [{ month: '2027-01', channel: 'KOL Nano', qty: 4, brand_id: 'brand-lumus-ai' }];
  const benchmarks = [{ brand_id: 'brand-lumus-ai', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 }];
  const steps = h.forecastFunnelFor(rows, benchmarks);
  assert.equal(steps[0].value, 16000);
  assert.equal(steps[1].value, 48);
  assert.deepEqual(h.forecastFunnelFor(rows, []), []);
});
