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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
  assert.match(src, /case 'brandNew': \{[\s\S]*?formShell\('brandNew', 'Tạo Brand mới'/);
  assert.match(src, /case 'brandNew': \{[\s\S]*?sCreate\('brands', newBrand\)/);
});

test('BP-UI [static]: trang Brand áp bộ lọc Brand toàn cục cho danh sách thẻ; số liệu thẻ/chi tiết qua tập đã lọc Segment', () => {
  const sec = section('function brandSectionHtml(ed)', 'function brandDetailHtml(b)');
  // Danh sách thẻ KHÔNG còn lấy brandsList() thô chưa lọc.
  assert.match(sec, /var brands = filteredBrandsList\(\)/);
  assert.doesNotMatch(sec, /var brands = brandsList\(\)/);
  // Số liệu trên thẻ (campaign / dòng plan) lấy từ tập đã áp matchesBrandSegment.
  assert.match(sec, /filteredPlanRows\(\)\.filter/);
  assert.match(sec, /filteredCampaigns\(\)\.filter/);
  // Chi tiết deep-link vẫn tra trên toàn bộ danh sách Brand (brandById), không bị bộ lọc chặn.
  assert.match(sec, /brandById\(detailId\)/);
  const det = section('function brandDetailHtml(b)', 'function viewBrand()');
  assert.match(det, /filteredPlanRows\(\)\.filter/);
  assert.match(det, /filteredCampaigns\(\)\.filter/);
});

test('BP-UI [static]: Overview — approvals chờ duyệt áp matchesBrandSegment kèm fallback campaign qua content', () => {
  const ov = section('function viewOverview()', '// ---------- Việc của tôi ----------');
  assert.match(ov, /matchesBrandSegment\(a, approvalContextFallback\(a\)\)/);
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
function loadHelpers({ storeList, storeGet, domain }) {
  const block = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all' };
  const Store = {
    list: storeList || (() => []),
    get: storeGet || (() => null),
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal',
    block + '\nreturn { UI: UI, brandsList: brandsList, filteredBrandsList: filteredBrandsList, approvalContextFallback: approvalContextFallback, matchesBrandSegment: matchesBrandSegment, planBudgetFor: planBudgetFor, forecastFunnelFor: forecastFunnelFor, filteredPlanRows: filteredPlanRows, brandPhasesList: brandPhasesList, filteredBrandPhases: filteredBrandPhases, phaseAssumptionsList: phaseAssumptionsList, phaseCtx: phaseCtx, forecastRawFor: forecastRawFor, phaseMonths: phaseMonths, phaseRowsFor: phaseRowsFor, phaseAssumptionFor: phaseAssumptionFor, effectivePhaseRates: effectivePhaseRates, phaseViewsPerUnitOverride: phaseViewsPerUnitOverride, effectivePhaseViewsPerUnit: effectivePhaseViewsPerUnit, funnelTotalsFor: funnelTotalsFor, distributeQty: distributeQty, kpiMatchesPhase: kpiMatchesPhase, matchesPhaseFilter: matchesPhaseFilter, recordPhaseId: recordPhaseId };');
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
  const domain = { forecastFunnel: () => ({ steps: ['views', 'visits', 'freemium', 'paid'], totals: { views: 16000, visits: 48, freemium: 4.32, paid: 0.1188 }, byMonth: {}, rows: [] }) };
  const h = loadHelpers({ domain });
  const steps = h.forecastFunnelFor([{ month: '2027-01', channel: 'KOL Nano', qty: 4 }], []);
  assert.deepEqual(steps.map((s) => s.label), ['Views', 'Visits', 'Freemium', 'Paid']);
  assert.deepEqual(steps.map((s) => s.value), [16000, 48, 4.32, 0.1188]);
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

test('BP-UI [unit]: filteredBrandsList — thẻ Brand chỉ lọc theo brandFilter (id của Brand); segmentFilter KHÔNG lọc thẻ', () => {
  const brands = [{ id: 'brand-sava-meta', name: 'SAVA META' }, { id: 'brand-lumus-ai', name: 'Lumus AI' }];
  const h = loadHelpers({ storeList: (coll) => (coll === 'brands' ? brands : []) });
  assert.deepEqual(h.filteredBrandsList().map((b) => b.id), ['brand-sava-meta', 'brand-lumus-ai']);
  h.UI.brandFilter = 'brand-lumus-ai';
  assert.deepEqual(h.filteredBrandsList().map((b) => b.id), ['brand-lumus-ai'], 'đặt lọc Lumus AI thì trang Brand chỉ còn thẻ Lumus AI');
  h.UI.brandFilter = 'all'; h.UI.segmentFilter = 'b2b';
  assert.deepEqual(h.filteredBrandsList().map((b) => b.id), ['brand-sava-meta', 'brand-lumus-ai'], 'Brand không mang segment — segmentFilter không được ẩn thẻ Brand');
});

test('BP-UI [unit]: approvalContextFallback — suy campaign qua contentItem/variant; không liên kết thì matchesBrandSegment chỉ cho hiện khi lọc Tất cả', () => {
  const camps = { 'camp-1': { id: 'camp-1', brand_id: 'brand-lumus-ai', segment: 'b2c' } };
  const items = { 'ci-1': { id: 'ci-1', campaignId: 'camp-1' } };
  const variants = { 'v-1': { id: 'v-1', contentItemId: 'ci-1' } };
  const h = loadHelpers({
    storeList: () => [],
    storeGet: (coll, id) => (coll === 'campaigns' ? camps[id] : coll === 'contentItems' ? items[id] : coll === 'variants' ? variants[id] : null) || null,
  });
  const viaContent = { id: 'a1', contentItemId: 'ci-1', status: 'pending' };
  const viaVariant = { id: 'a2', variantId: 'v-1', status: 'pending' };
  const orphan = { id: 'a3', status: 'pending' };
  assert.equal(h.approvalContextFallback(viaContent).id, 'camp-1');
  assert.equal(h.approvalContextFallback(viaVariant).id, 'camp-1');
  assert.equal(h.approvalContextFallback(orphan), null);
  h.UI.brandFilter = 'brand-lumus-ai';
  assert.equal(h.matchesBrandSegment(viaContent, h.approvalContextFallback(viaContent)), true);
  assert.equal(h.matchesBrandSegment(viaVariant, h.approvalContextFallback(viaVariant)), true);
  assert.equal(h.matchesBrandSegment(orphan, h.approvalContextFallback(orphan)), false, 'approval không suy được ngữ cảnh phải ẩn khi đã chọn Brand');
  h.UI.brandFilter = 'brand-sava-meta';
  assert.equal(h.matchesBrandSegment(viaContent, h.approvalContextFallback(viaContent)), false);
  h.UI.brandFilter = 'all'; h.UI.segmentFilter = 'b2b';
  assert.equal(h.matchesBrandSegment(viaContent, h.approvalContextFallback(viaContent)), false, 'campaign b2c phải ẩn khi lọc segment b2b');
  h.UI.segmentFilter = 'b2c';
  assert.equal(h.matchesBrandSegment(viaContent, h.approvalContextFallback(viaContent)), true);
});

// =====================================================================
// Phase + Uplift (bổ sung) — Executor B2: Planning Theo phase + lọc KPI
// theo Phase. Hợp đồng A2 (4a5cf63): brand phase lọc CỨNG brand_id +
// start_month trong collection phases dùng chung với campaign phase.
// =====================================================================

// ---------- [static] Planning Theo phase ----------
test('BP-UI [static]: state planningMode/kpiPhaseFilter + toggle [Theo tháng | Theo phase] + handler planning-mode', () => {
  assert.match(src, /planningMode: 'month',\s*\n\s*kpiPhaseFilter: 'all',/);
  const v = section('function viewPlanning()', '// ---------- Brand Hub ----------');
  assert.match(v, /data-planning-mode-toggle="1"/);
  assert.match(v, /data-action="planning-mode" data-id="month">Theo tháng</);
  assert.match(v, /data-action="planning-mode" data-id="phase">Theo phase</);
  assert.match(v, /var mode = UI\.planningMode === 'phase' \? 'phase' : 'month';/);
  assert.match(v, /if \(mode === 'phase'\) \{ html \+= planningPhaseModeHtml\(year, rows, benchmarks\); return html; \}/);
  assert.match(src, /if \(action === 'planning-mode'\) \{ UI\.planningMode = id === 'phase' \? 'phase' : 'month'; render\(\); \}/);
});

test('BP-UI [static]: brandPhasesList lọc CỨNG brand_id && start_month (không lọt campaign phase)', () => {
  assert.match(src, /return !!p && !!recordBrandId\(p\) && !!phaseField\(p, 'start_month', 'startMonth'\);/);
  // phaseCtx chỉ gồm brand phase + phase_assumptions, đúng hợp đồng engine.
  assert.match(src, /return \{ phases: brandPhasesList\(\), phaseAssumptions: phaseAssumptionsList\(\) \};/);
  // forecastRawFor truyền ctx vào forecastFunnel (chế độ Theo tháng cũng qua wrapper này).
  assert.match(src, /return fn\(rows, benchmarks, phaseCtx\(\)\);/);
});

test('BP-UI [static]: khối Phase — uplift/qty/views/4 tỉ lệ là ô nhập change-lưu-ngay; funnel theo phase; khóa ở dữ liệu thật', () => {
  const blk = section('function planningPhaseModeHtml(year, rows, benchmarks)', '// --- Lưu các ô nhập Theo phase');
  assert.match(blk, /data-planning-phase="/);
  assert.match(blk, /planningPhaseBlockHtml\(p, rows, benchmarks, editable, disAttr\)/);
  const block = section('function planningPhaseBlockHtml(phase, rows, benchmarks, editable, disAttr)', '// --- Lưu các ô nhập Theo phase');
  assert.match(block, /data-action-change="phase-uplift" data-phase-id=/);
  assert.match(block, /data-action-change="phase-qty" data-phase-id=/);
  assert.match(block, /data-action-change="phase-views" data-phase-id=/);
  assert.match(block, /data-action-change="phase-rate" data-field=/);
  assert.match(block, /data-viz="planning-phase-funnel" data-phase-id=/);
  assert.match(block, /funnelTotalsFor\(chRows, benchmarks\)/);
  assert.match(block, /funnelTotalsFor\(pRows, benchmarks\)/);
  assert.match(block, /effectivePhaseRates\(phase, ch, benchmarks\)/);
  // Views mỗi bài (đổi ngữ nghĩa 17/11/2026): cột + aria-label theo nhãn
  // mới, ô hiện giá trị HIỆU DỤNG mỗi bài qua effectivePhaseViewsPerUnit,
  // KHÔNG còn hiển thị tổng views cả phase hay nhãn "Đang đặt thẳng".
  assert.match(block, /<th>Views mỗi bài \(đầu phễu\)<\/th>/);
  assert.match(block, /aria-label="Views mỗi bài \(đầu phễu\) của /);
  assert.match(block, /effectivePhaseViewsPerUnit\(phase, ch, benchmarks\)/);
  const phaseBlockOnly = section('function planningPhaseBlockHtml(phase, rows, benchmarks, editable, disAttr)', '// --- 3 bảng KPI chi tiết theo tháng (chế độ Theo tháng) ---');
  assert.doesNotMatch(phaseBlockOnly, /Đang đặt thẳng/);
  assert.doesNotMatch(phaseBlockOnly, /totals\.views/);
  assert.match(block, /data-planning-phase-views-hint="1"/);
  // Toast lưu/xoá của savePhaseViews theo ngữ nghĩa mỗi bài.
  assert.match(src, /Forecast tháng = Số lượng × Views mỗi bài/);
  assert.match(src, /quay về Views mỗi bài của Benchmark/);
  // Editable khi supabase + canEdit (0017: Planning có bảng thật; demo đã gỡ); vai chỉ xem có banner khóa.
  assert.match(src, /function planningInputsEditable\(\) \{ return Store\.mode === 'supabase' && canEdit\(\); \}/);
  assert.match(blk, /data-planning-phase-locked="1"/);
  assert.match(blk, /data-planning-phase-empty="1"/);
});

test('BP-UI [static]: handler lưu Phase — uplift vào phases, tỉ lệ/Views mỗi bài vào phase_assumptions, số lượng phân bổ về plan_rows', () => {
  assert.match(src, /if \(ctxKind === 'phase-uplift'\) \{ savePhaseUplift\(t\.getAttribute\('data-phase-id'\), t\.value\); return; \}/);
  assert.match(src, /if \(ctxKind === 'phase-qty'\) \{ savePhaseQty\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-channel'\), t\.value\); return; \}/);
  assert.match(src, /if \(ctxKind === 'phase-views'\) \{ savePhaseViews\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-channel'\), t\.value\); return; \}/);
  assert.match(src, /if \(ctxKind === 'phase-rate'\) \{ savePhaseRate\(t\.getAttribute\('data-phase-id'\), t\.getAttribute\('data-channel'\), t\.getAttribute\('data-field'\), t\.value\); return; \}/);
  assert.match(src, /sUpdate\('phases', phaseId, \{ uplift_percent_per_month: v \}\)/);
  assert.match(src, /sUpdate\('phase_assumptions', existing\.id, patch\)/);
  assert.match(src, /sCreate\('phase_assumptions', obj\)/);
  assert.match(src, /patch\.views_per_unit = v;/);
  assert.match(src, /patch\.views_per_unit = null;/);
  assert.match(src, /var news = distributeQty\(v, rows\.map\(planRowQty\)\);/);
  assert.match(src, /sUpdate\('plan_rows', job\.id, \{ qty: job\.qty \}\)/);
  // Guard chặn lưu khi vai chỉ xem, trước mọi đường ghi.
  assert.match(src, /function phaseSaveGuard\(\) \{\s*\n\s*if \(!canEdit\(\)\)/);
});

test('BP-UI [static]: KPI — bộ lọc Phase chỉ khi chọn đúng 1 Brand, lọc bằng kpiMatchesPhase trên phase_id', () => {
  const kpi = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpi, /data-kpi-phase-filter="1"/);
  assert.match(kpi, /id="kpi-phase-select" data-action-change="kpi-phase"/);
  assert.match(kpi, /var kpiPhases = \(UI\.brandFilter && UI\.brandFilter !== 'all'\) \? filteredBrandPhases\(\) : \[\];/);
  assert.match(kpi, /if \(kpiPhaseSel !== 'all'\) kpis = kpis\.filter\(function \(k\) \{ return kpiMatchesPhase\(k, kpiPhaseSel\); \}\);/);
  assert.match(src, /if \(ctxKind === 'kpi-phase'\) \{ UI\.kpiPhaseFilter = t\.value \|\| 'all'; render\(\); return; \}/);
});

test('BP-UI [static]: CSS cho toggle Planning + ô nhập Phase', () => {
  assert.ok(css.includes('.planning-mode-toggle'), 'CSS thiếu .planning-mode-toggle');
  assert.ok(css.includes('.phase-input'), 'CSS thiếu .phase-input');
  assert.ok(css.includes('.planning-phase'), 'CSS thiếu .planning-phase');
});

// ---------- [unit] lọc brand phase theo shape A2 thật ----------
const A2_PHASES_MIXED = [
  { id: 'phase-1', campaignId: 'camp-1', name: 'Giai đoạn 1 — Khởi động', startDate: '2026-11-02', endDate: '2026-11-13' },
  { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', objective: 'Chuẩn bị', uplift_percent_per_month: 0 },
  { id: 'phase-lumus-2', brand_id: 'brand-lumus-ai', name: 'Test & Validate', start_month: '2027-03', end_month: '2027-05', objective: 'Kiểm chứng', uplift_percent_per_month: 5 },
  { id: 'phase-sava-play', brand_id: 'brand-sava-meta', segment: 'b2c', campaign_id: 'camp-play-unknown', name: 'PLAY THE UNKNOWN', start_month: '2026-10', end_month: '2026-11', objective: 'Mở phễu', uplift_percent_per_month: 1 },
  { id: 'phase-thieu-start', brand_id: 'brand-lumus-ai', name: 'Thiếu start_month' },
  { id: 'phase-thieu-brand', start_month: '2027-01', end_month: '2027-02', name: 'Thiếu brand_id' }
];

test('BP-UI [unit]: brandPhasesList — chỉ brand phase (brand_id + start_month); campaign phase/thiếu field bị loại', () => {
  const h = loadHelpers({ storeList: (coll) => (coll === 'phases' ? A2_PHASES_MIXED : []) });
  assert.deepEqual(h.brandPhasesList().map((p) => p.id), ['phase-lumus-1', 'phase-lumus-2', 'phase-sava-play']);
  assert.deepEqual(h.filteredBrandPhases().map((p) => p.id), ['phase-lumus-1', 'phase-lumus-2', 'phase-sava-play']);
  h.UI.brandFilter = 'brand-lumus-ai';
  assert.deepEqual(h.filteredBrandPhases().map((p) => p.id), ['phase-lumus-1', 'phase-lumus-2'], 'đang chọn Lumus thì chỉ phase Lumus');
  h.UI.brandFilter = 'brand-sava-meta';
  assert.deepEqual(h.filteredBrandPhases().map((p) => p.id), ['phase-sava-play']);
});

test('BP-UI [unit]: phaseCtx chỉ chứa brand phase + phase_assumptions; forecastFunnelFor truyền ctx cho engine', () => {
  let seenCtx = null;
  const assumptions = [{ id: 'passump-lumus-1-kol-nano', phase_id: 'phase-lumus-1', channel: 'KOL Nano', view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: null }];
  const domain = { forecastFunnel: (rows, benchmarks, ctx) => { seenCtx = ctx; return { steps: ['views'], totals: { views: 10 }, byMonth: {}, rows: [] }; } };
  const h = loadHelpers({
    storeList: (coll) => (coll === 'phases' ? A2_PHASES_MIXED : coll === 'phase_assumptions' ? assumptions : []),
    domain
  });
  h.forecastFunnelFor([{ month: '2027-01', channel: 'KOL Nano', qty: 1 }], []);
  assert.ok(seenCtx, 'engine phải nhận ctx');
  assert.deepEqual(seenCtx.phases.map((p) => p.id), ['phase-lumus-1', 'phase-lumus-2', 'phase-sava-play'], 'ctx.phases không được chứa campaign phase');
  assert.deepEqual(seenCtx.phaseAssumptions, assumptions);
});

test('BP-UI [unit]: phaseMonths + phaseRowsFor — ưu tiên phase_id, dự phòng khoảng tháng khi dòng chưa gắn', () => {
  const h = loadHelpers({ storeList: (coll) => (coll === 'phases' ? A2_PHASES_MIXED : []) });
  const p2 = A2_PHASES_MIXED[2];
  assert.deepEqual(h.phaseMonths(p2), ['2027-03', '2027-04', '2027-05']);
  assert.deepEqual(h.phaseMonths(A2_PHASES_MIXED[0]), [], 'campaign phase không có start_month -> không tháng nào');
  const rows = [
    { id: 'r1', brand_id: 'brand-lumus-ai', month: '2027-04', channel: 'KOL Nano', qty: 7, phase_id: 'phase-lumus-2' },
    { id: 'r2', brand_id: 'brand-lumus-ai', month: '2027-01', channel: 'KOL Nano', qty: 4, phase_id: 'phase-lumus-1' },
    { id: 'r3', brand_id: 'brand-lumus-ai', month: '2027-05', channel: 'KOL Micro', qty: 6 },
    { id: 'r4', brand_id: 'brand-sava-meta', month: '2027-04', channel: 'X', qty: 1 }
  ];
  assert.deepEqual(h.phaseRowsFor(p2, rows).map((r) => r.id), ['r1', 'r3'], 'r1 theo phase_id; r3 suy theo tháng+brand; r4 khác brand bị loại dù cùng tháng');
});

test('BP-UI [unit]: effectivePhaseRates — assumption null kế thừa Benchmark; assumption có số thắng; không cả hai -> null', () => {
  const benchmarks = [{ brand_id: 'brand-lumus-ai', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 }];
  const seedNull = [{ id: 'a1', phase_id: 'phase-lumus-1', channel: 'KOL Nano', view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: null }];
  const h = loadHelpers({ storeList: (coll) => (coll === 'phase_assumptions' ? seedNull : []) });
  const phase = { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai' };
  let rates = h.effectivePhaseRates(phase, 'KOL Nano', benchmarks);
  assert.equal(rates.view_to_visit.value, 0.003); assert.equal(rates.view_to_visit.source, 'benchmark');
  // Phễu Freemium: visit_to_freemium fallback key cũ visit_to_signup;
  // freemium_to_paid fallback GỘP signup_to_first x first_to_paid.
  assert.equal(rates.visit_to_freemium.value, 0.09); assert.equal(rates.visit_to_freemium.source, 'benchmark');
  assert.ok(Math.abs(rates.freemium_to_paid.value - 0.0275) < 1e-9, 'freemium_to_paid fallback gộp = 0,5 x 0,055 = 0,0275, got ' + rates.freemium_to_paid.value);
  assert.equal(rates.freemium_to_paid.source, 'benchmark');
  const h2 = loadHelpers({ storeList: (coll) => (coll === 'phase_assumptions' ? [{ id: 'a2', phase_id: 'phase-lumus-1', channel: 'KOL Nano', view_to_visit: 0.01, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: null }] : []) });
  rates = h2.effectivePhaseRates(phase, 'KOL Nano', benchmarks);
  assert.equal(rates.view_to_visit.value, 0.01); assert.equal(rates.view_to_visit.source, 'assumption');
  assert.equal(rates.visit_to_freemium.source, 'benchmark', 'field assumption null vẫn kế thừa benchmark (qua fallback key cũ visit_to_signup)');
  assert.equal(rates.visit_to_freemium.value, 0.09);
  rates = h.effectivePhaseRates(phase, 'Facebook Owned', benchmarks);
  assert.equal(rates.view_to_visit.value, null); assert.equal(rates.view_to_visit.source, null);
  // phaseAssumptionFor tìm đúng dòng seed theo phase_id + channel (lưu tỉ lệ update đúng dòng, không tạo trùng).
  assert.equal(h.phaseAssumptionFor('phase-lumus-1', 'KOL Nano').id, 'a1');
  assert.equal(h.phaseAssumptionFor('phase-lumus-2', 'KOL Nano'), null);
});

test('BP-UI [unit]: effectivePhaseViewsPerUnit — views_per_unit null kế thừa output_per_unit Benchmark; có số thắng; không cả hai -> null', () => {
  const benchmarks = [{ brand_id: 'brand-lumus-ai', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.003, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055 }];
  const phase = { id: 'phase-lumus-1', brand_id: 'brand-lumus-ai' };
  const hNull = loadHelpers({ storeList: (coll) => (coll === 'phase_assumptions' ? [{ id: 'a1', phase_id: 'phase-lumus-1', channel: 'KOL Nano', view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: null }] : []) });
  assert.equal(hNull.phaseViewsPerUnitOverride(phase, 'KOL Nano'), null);
  let info = hNull.effectivePhaseViewsPerUnit(phase, 'KOL Nano', benchmarks);
  assert.equal(info.value, 4000); assert.equal(info.source, 'benchmark');
  const hSet = loadHelpers({ storeList: (coll) => (coll === 'phase_assumptions' ? [{ id: 'a2', phase_id: 'phase-lumus-1', channel: 'KOL Nano', view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: 5000 }] : []) });
  assert.equal(hSet.phaseViewsPerUnitOverride(phase, 'KOL Nano'), 5000);
  info = hSet.effectivePhaseViewsPerUnit(phase, 'KOL Nano', benchmarks);
  assert.equal(info.value, 5000); assert.equal(info.source, 'assumption');
  info = hNull.effectivePhaseViewsPerUnit(phase, 'Facebook Owned', benchmarks);
  assert.equal(info.value, null); assert.equal(info.source, null);
});

test('BP-UI [unit]: distributeQty — largest remainder deterministic; tháng 0 giữ 0; tất cả 0 thì chia đều', () => {
  const h = loadHelpers({});
  assert.deepEqual(h.distributeQty(20, [4, 6]), [8, 12]);
  assert.deepEqual(h.distributeQty(10, [0, 5]), [0, 10], 'tháng đang 0 giữ 0');
  assert.deepEqual(h.distributeQty(7, [0, 0, 0]), [3, 2, 2], 'mọi tháng 0 -> chia đều, dư cho tháng sớm hơn');
  assert.deepEqual(h.distributeQty(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(h.distributeQty(0, [4, 6]), [0, 0]);
  assert.deepEqual(h.distributeQty(5, []), []);
  const out = h.distributeQty(100, [4, 6, 7, 7, 7]);
  assert.equal(out.reduce((s, v) => s + v, 0), 100, 'tổng luôn đúng bằng total');
});

test('BP-UI [unit]: kpiMatchesPhase — Tất cả hiện cả KPI không phase_id; chọn 1 phase chỉ hiện KPI của phase đó', () => {
  const h = loadHelpers({});
  const k1 = { id: 'kpi-live-ads-reg', phase_id: 'phase-lumus-1' };
  const k2 = { id: 'kpi-live-seeding-reg', phase_id: 'phase-lumus-2' };
  const bare = { id: 'kpi-cu' };
  assert.equal(h.kpiMatchesPhase(bare, 'all'), true);
  assert.equal(h.kpiMatchesPhase(k1, 'phase-lumus-1'), true);
  assert.equal(h.kpiMatchesPhase(k2, 'phase-lumus-1'), false);
  assert.equal(h.kpiMatchesPhase(bare, 'phase-lumus-1'), false, 'KPI không phase_id ẩn khi đã chọn 1 phase');
  h.UI.kpiPhaseFilter = 'phase-lumus-2';
  assert.equal(h.matchesPhaseFilter(k2), true);
  assert.equal(h.matchesPhaseFilter(k1), false);
});

// ---------- [unit] đối chiếu engine + demo THẬT của A2 ----------
test('BP-UI [unit]: funnelTotalsFor khớp engine A2 thật — phase totals = byPhase; toàn kỳ = totals; uplift áp đúng', () => {
  const domain = require('../js/domain.js');
  const demo = require('../js/demo-data.js');
  const h = loadHelpers({
    storeList: (coll) => demo[coll] || [],
    domain
  });
  const lumusRows = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  // Toàn kỳ: funnelTotalsFor qua wrapper (có ctx) == totals của engine.
  const ctx = { phases: demo.phases.filter((p) => p.brand_id && p.start_month), phaseAssumptions: demo.phase_assumptions };
  const eng = domain.forecastFunnel(lumusRows, demo.benchmarks, ctx);
  const mine = h.funnelTotalsFor(lumusRows, demo.benchmarks);
  for (const k of ['views', 'visits', 'freemium', 'paid']) {
    assert.ok(Math.abs(mine[k] - eng.totals[k]) < 1e-6, 'toàn kỳ lệch ở ' + k + ': ' + mine[k] + ' vs ' + eng.totals[k]);
  }
  // Theo phase: funnelTotalsFor(rows của phase) == byPhase của engine.
  for (const pid of ['phase-lumus-1', 'phase-lumus-2', 'phase-lumus-3', 'phase-lumus-4']) {
    const rowsP = lumusRows.filter((r) => r.phase_id === pid);
    const t = h.funnelTotalsFor(rowsP, demo.benchmarks);
    const bp = eng.byPhase[pid];
    assert.ok(bp, 'engine thiếu byPhase ' + pid);
    for (const k of ['views', 'visits', 'freemium', 'paid']) {
      assert.ok(Math.abs(t[k] - bp[k]) < 1e-6, pid + ' lệch ở ' + k + ': ' + t[k] + ' vs ' + bp[k]);
    }
  }
  // Uplift: KOL Nano 2027-04 thuộc phase-lumus-2 (uplift 5%, tháng thứ 2 -> n=1):
  // visits = 7 x 4000 x (0.003 x 1.05) x (0.09 x 1.05) ... visits chỉ qua 1 bước uplift.
  const apr = lumusRows.filter((r) => r.phase_id === 'phase-lumus-2' && r.channel === 'KOL Nano' && r.month === '2027-04');
  const tApr = h.funnelTotalsFor(apr, demo.benchmarks);
  assert.ok(Math.abs(tApr.views - 28000) < 1e-6, 'views không uplift: ' + tApr.views);
  assert.ok(Math.abs(tApr.visits - 28000 * 0.003 * 1.05) < 1e-6, 'visits phải có uplift 5%: ' + tApr.visits);
  // Channel không benchmark/assumption (Facebook Owned) -> null, không bịa số.
  const fb = lumusRows.filter((r) => r.channel === 'Facebook Owned');
  assert.equal(h.funnelTotalsFor(fb, demo.benchmarks), null);
});
