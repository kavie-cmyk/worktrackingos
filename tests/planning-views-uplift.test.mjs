// tests/planning-views-uplift.test.mjs
// Uplift Views riêng cho Phase (0019) — % tăng trưởng/tháng áp vào
// VIEWS MỖI BÀI của đường Content, song song với uplift tỉ lệ
// (uplift_percent_per_month). Bao phủ:
//  - Migration 0019: chỉ thêm cột views_uplift_percent_per_month
//    numeric(9,4) cho public.phases, idempotent, không xoá cột cũ.
//  - store-core: whitelist phases có cột mới; camelCase tự khớp
//    snake_case (không FIELD_ALIASES cho phases, bám cùng cách uplift
//    tỉ lệ); round-trip toDbPayload -> fromDbRow không rớt giá trị.
//  - Engine forecastFunnel: ca neo tính tay độc lập — Phase 3 tháng
//    (T3–T5), vu = 10%/tháng, benchmark output_per_unit = 4.000,
//    qty = 4/tháng: views T3 (n=0) = 16.000; T4 (n=1) = 17.600;
//    T5 (n=2) = 19.360; Paid tăng tương ứng theo views (tỉ lệ không
//    đổi). views_per_unit đặt tay (assumption) là gốc rồi mới nhân
//    (1+vu)^n. Dòng budget-driven (Meta Ads objective awareness)
//    KHÔNG đổi. vu = 0/trống/thiếu -> forecast bằng hệt bản cũ.
//  - Nhất quán 2 view: byPhase (view Theo phase) == tổng byMonth
//    (bảng KPI Theo tháng) == tổng chi tiết rows — cùng một engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const Core = require('../js/store-core.js');

const mig = readFileSync(new URL('../supabase/migrations/0019_views_uplift.sql', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function appSection(startMarker, endMarker) {
  const a = appSrc.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = appSrc.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return appSrc.slice(a, b);
}
function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}
// Trích xuất khối helper Brand + Planning THẬT của app.js (cùng khuôn
// loadHelpers của brand-planning-ui.test.mjs) chạy với stub Store/D/UI.
function loadAppHelpers({ storeList, domain }) {
  const block = appSection('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all' };
  const Store = { list: storeList || (() => []), get: () => null };
  const factory = new Function('Store', 'D', 'UI', 'cfVal',
    block + '\nreturn { UI: UI, phaseViewsUplift: phaseViewsUplift, phaseForPlanRow: phaseForPlanRow, phaseCtx: phaseCtx, forecastRawFor: forecastRawFor, forecastFunnelFor: forecastFunnelFor, funnelTotalsFor: funnelTotalsFor, brandPhasesList: brandPhasesList };');
  return factory(Store, domain || {}, UI, cfValStub);
}

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

// ---------------------------------------------------------------- migration
test('VU [migration]: 0019 chỉ thêm cột views_uplift_percent_per_month numeric(9,4) cho phases, không xoá cột', () => {
  assert.match(mig, /alter table public\.phases add column if not exists views_uplift_percent_per_month numeric\(9,4\)/);
  assert.ok(!/drop column/i.test(mig), 'migration 0019 không được chứa drop column');
  assert.ok(!/create table/i.test(mig), 'migration 0019 không tạo bảng mới');
  // Cột cũ của uplift tỉ lệ vẫn còn nguyên trong whitelist/DB.
  assert.ok(Core.hasColumn('phases', 'uplift_percent_per_month'));
  // Comment ghi quy ước lưu dạng % như uplift_percent_per_month.
  assert.match(mig, /comment on column public\.phases\.views_uplift_percent_per_month is '0019:[^']*%[^']*'/);
});

// ---------------------------------------------------------------- store-core
test('VU [store-core]: TABLE_COLUMNS.phases chứa views_uplift_percent_per_month; camel tự khớp snake, không alias', () => {
  assert.ok(Core.hasColumn('phases', 'views_uplift_percent_per_month'));
  assert.ok(Core.TABLE_COLUMNS.phases.includes('views_uplift_percent_per_month'));
  assert.equal(Core.camelToSnake('viewsUpliftPercentPerMonth'), 'views_uplift_percent_per_month');
  assert.equal(Core.snakeToCamel('views_uplift_percent_per_month'), 'viewsUpliftPercentPerMonth');
  const aliases = Core.FIELD_ALIASES.phases || {};
  assert.ok(!('viewsUpliftPercentPerMonth' in aliases), 'không cần alias cho viewsUpliftPercentPerMonth');
  assert.ok(!('views_uplift_percent_per_month' in aliases), 'không cần alias cho views_uplift_percent_per_month');
});

test('VU [store-core]: round-trip phase có views uplift qua toDbPayload -> fromDbRow không rớt; null giữ nguyên', () => {
  const payload = Core.toDbPayload('phases', { name: 'Phase VU', viewsUpliftPercentPerMonth: 10 }, { forInsert: true, workspaceId: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6' });
  assert.equal(payload.views_uplift_percent_per_month, 10);
  assert.equal(Core.fromDbRow('phases', payload).viewsUpliftPercentPerMonth, 10);
  // Dạng snake_case (như demo-data / dữ liệu đọc thẳng) cũng qua được:
  const payload2 = Core.toDbPayload('phases', { views_uplift_percent_per_month: 7.5 }, { forInsert: true });
  assert.equal(payload2.views_uplift_percent_per_month, 7.5);
  // null (chưa nhập = không tăng trưởng) giữ nguyên null cả hai chiều:
  const payload3 = Core.toDbPayload('phases', { viewsUpliftPercentPerMonth: null }, {});
  assert.equal(payload3.views_uplift_percent_per_month, null);
  assert.equal(Core.fromDbRow('phases', payload3).viewsUpliftPercentPerMonth, null);
});

// ---------------------------------------------------------------- engine: ca neo
const BM = [{ brand_id: 'b1', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.01, visit_to_freemium: 0.1, freemium_to_paid: 0.1, direct_budget: false }];
const PHASE_VU = [{ id: 'ph-vu', brand_id: 'b1', name: 'VU', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 0, views_uplift_percent_per_month: 10 }];
const ROWS_VU = ['2027-03', '2027-04', '2027-05'].map((m, i) => ({ id: 'r' + i, brand_id: 'b1', month: m, channel: 'KOL Nano', qty: 4, phase_id: 'ph-vu' }));

test('VU [domain]: CA NEO — vu 10%/tháng, output 4.000, qty 4: views T3=16.000 (n=0), T4=17.600 (n=1), T5=19.360 (n=2); Paid tăng tương ứng', () => {
  const f = domain.forecastFunnel(ROWS_VU, BM, { phases: PHASE_VU });
  // Tính tay độc lập: views = 4 x 4.000 x 1,1^n; chuỗi tỉ lệ giữ
  // nguyên (uplift tỉ lệ = 0): visits = views x 0,01; freemium =
  // visits x 0,1; paid = freemium x 0,1.
  const expectViews = [16000, 17600, 19360];
  f.rows.forEach((r, i) => {
    assert.ok(r.forecast, 'row ' + r.month + ' phải có forecast');
    approx(r.forecast.views, expectViews[i], 'views ' + r.month);
    approx(r.forecast.visits, expectViews[i] * 0.01, 'visits ' + r.month);
    approx(r.forecast.freemium, expectViews[i] * 0.001, 'freemium ' + r.month);
    approx(r.forecast.paid, expectViews[i] * 0.0001, 'paid ' + r.month);
  });
  approx(f.totals.views, 16000 + 17600 + 19360, 'tổng views');
  approx(f.byMonth['2027-03'].views, 16000, 'byMonth T3');
  approx(f.byMonth['2027-04'].views, 17600, 'byMonth T4');
  approx(f.byMonth['2027-05'].views, 19360, 'byMonth T5');
  // Paid tăng ĐÚNG theo views so với bản không vu (tỉ lệ không đổi):
  const base = domain.forecastFunnel(ROWS_VU, BM, { phases: [{ ...PHASE_VU[0], views_uplift_percent_per_month: null }] });
  f.rows.forEach((r, i) => {
    const ratio = Math.pow(1.1, i);
    approx(r.forecast.paid, base.rows[i].forecast.paid * ratio, 'paid tỉ lệ theo views tháng ' + r.month);
    approx(base.rows[i].forecast.views, 16000, 'bản không vu views phẳng 16.000');
  });
});

test('VU [domain]: key camel viewsUpliftPercentPerMonth cho cùng kết quả như snake', () => {
  const camel = [{ id: 'ph-vu', brand_id: 'b1', startMonth: '2027-03', endMonth: '2027-05', viewsUpliftPercentPerMonth: 10 }];
  const f = domain.forecastFunnel(ROWS_VU, BM, { phases: camel });
  approx(f.rows[1].forecast.views, 17600, 'camel T4');
  approx(f.rows[2].forecast.views, 19360, 'camel T5');
});

test('VU [domain]: views_per_unit đặt tay (assumption) là GỐC rồi mới nhân (1+vu)^n', () => {
  const assumptions = [{ phase_id: 'ph-vu', channel: 'KOL Nano', view_to_visit: null, visit_to_freemium: null, freemium_to_paid: null, views_per_unit: 5000 }];
  const f = domain.forecastFunnel(ROWS_VU, BM, { phases: PHASE_VU, phaseAssumptions: assumptions });
  // Gốc 5.000 (thắng benchmark 4.000): T3 = 4 x 5.000 = 20.000;
  // T4 = 4 x 5.000 x 1,1 = 22.000; T5 = 4 x 5.000 x 1,21 = 24.200.
  assert.deepEqual(f.rows.map((r) => Math.round(r.forecast.views * 1e6) / 1e6), [20000, 22000, 24200]);
});

test('VU [domain]: dòng budget-driven (Meta Ads objective awareness) trong phase có vu — forecast KHÔNG đổi', () => {
  const bmPaid = [{ brand_id: 'b1', channel: 'Meta Ads', group: 'Paid Media', direct_budget: true, view_to_visit: 0.01, visit_to_freemium: 0.1, freemium_to_paid: 0.1, cost_per_result: { awareness: 100 } }];
  const rowsPaid = [{ id: 'p1', brand_id: 'b1', month: '2027-04', channel: 'Meta Ads', group: 'Paid Media', budget: 1000000, objective: 'awareness', phase_id: 'ph-vu' }];
  const withVu = domain.forecastFunnel(rowsPaid, bmPaid, { phases: PHASE_VU });
  const noVu = domain.forecastFunnel(rowsPaid, bmPaid, { phases: [{ ...PHASE_VU[0], views_uplift_percent_per_month: null }] });
  assert.ok(withVu.rows[0].forecast, 'awareness có đơn giá trong fixture -> có forecast');
  // Views suy từ ngân sách: 1.000.000 / 100 = 10.000 — vu không chạm.
  approx(withVu.rows[0].forecast.views, 10000, 'views awareness từ ngân sách');
  assert.deepEqual(withVu.rows[0].forecast, noVu.rows[0].forecast, 'budget-driven phải bằng hệt khi không vu');
  assert.deepEqual(withVu.totals, noVu.totals);
});

test('VU [domain]: vu = 0 / null / thiếu field -> forecast bằng hệt nhau và bằng bản trước 0019', () => {
  const mk = (patch) => [{ id: 'ph-vu', brand_id: 'b1', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5, ...patch }];
  const fZero = domain.forecastFunnel(ROWS_VU, BM, { phases: mk({ views_uplift_percent_per_month: 0 }) });
  const fNull = domain.forecastFunnel(ROWS_VU, BM, { phases: mk({ views_uplift_percent_per_month: null }) });
  const fAbsent = domain.forecastFunnel(ROWS_VU, BM, { phases: mk({}) });
  assert.deepEqual(fZero.rows, fAbsent.rows);
  assert.deepEqual(fNull.rows, fAbsent.rows);
  assert.deepEqual(fZero.totals, fAbsent.totals);
  assert.deepEqual(fZero.byMonth, fAbsent.byMonth);
  // Uplift TỈ LỆ (5%) vẫn áp vào tỉ lệ như cũ, views giữ phẳng 16.000:
  approx(fAbsent.rows[2].forecast.views, 16000, 'views không đổi khi chỉ có uplift tỉ lệ');
  assert.ok(fAbsent.rows[2].forecast.visits > 160, 'visits T5 phải lớn hơn 160 nhờ uplift tỉ lệ 5% x n=2');
});

test('VU [domain]: uplift tỉ lệ và Uplift Views chạy song song, không nhân chéo sai — ca tính tay kết hợp', () => {
  // Phase: uplift tỉ lệ 10% + vu 10%; row n=1 (2027-04), qty 4.
  // views = 4 x 4.000 x 1,1 = 17.600 (chỉ vu áp vào views mỗi bài)
  // visits = 17.600 x (0,01 x 1,1) = 193,6 (uplift tỉ lệ áp 1 lần)
  // freemium = 193,6 x (0,1 x 1,1) = 21,296; paid = 21,296 x (0,1 x 1,1) = 2,34256.
  const phases = [{ id: 'ph-vu', brand_id: 'b1', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 10, views_uplift_percent_per_month: 10 }];
  const f = domain.forecastFunnel([ROWS_VU[1]], BM, { phases });
  const fc = f.rows[0].forecast;
  approx(fc.views, 17600, 'views');
  approx(fc.visits, 193.6, 'visits');
  approx(fc.freemium, 21.296, 'freemium');
  approx(fc.paid, 2.34256, 'paid');
});

// ---------------------------------------------------------------- nhất quán 2 view (engine)
test('VU [domain]: nhất quán — byPhase (Theo phase) == tổng byMonth (Theo tháng) == tổng chi tiết rows khi có vu', () => {
  const f = domain.forecastFunnel(ROWS_VU, BM, { phases: PHASE_VU });
  const sumRows = f.rows.reduce((s, r) => s + r.forecast.views, 0);
  const sumMonths = Object.values(f.byMonth).reduce((s, m) => s + m.views, 0);
  approx(f.byPhase['ph-vu'].views, sumRows, 'byPhase vs rows');
  approx(f.byPhase['ph-vu'].views, sumMonths, 'byPhase vs byMonth');
  approx(f.totals.views, sumRows, 'totals vs rows');
  approx(f.byPhase['ph-vu'].paid, f.rows.reduce((s, r) => s + r.forecast.paid, 0), 'byPhase paid vs rows');
});

// ---------------------------------------------------------------- demo-data neo
test('VU [demo]: demo-data KHÔNG đặt views uplift mặc định -> mọi số neo giữ nguyên', () => {
  assert.ok(demo.phases.every((p) => p.views_uplift_percent_per_month === undefined && p.viewsUpliftPercentPerMonth === undefined),
    'mọi phase demo phải trống views uplift');
  const ctx = { phases: demo.phases.filter((p) => p.brand_id), phaseAssumptions: demo.phase_assumptions };
  const f = domain.forecastFunnel(demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai'), demo.benchmarks, ctx);
  approx(f.totals.views, 1460000, 'tổng views Lumus giữ neo');
  // Views T1/2027 toàn Lumus (mọi channel có forecast) giữ nguyên mức
  // engine của bản trước 0019: cộng tay từ rows T1.
  const jan = domain.forecastFunnel(demo.plan_rows.filter((r) => r.month === '2027-01'), demo.benchmarks, ctx);
  assert.equal(jan.byMonth['2027-01'].views, f.byMonth['2027-01'].views);
});

// ---------------------------------------------------------------- UI (static)
test('VU [UI static]: khối Phase có ô nhập Uplift Views cạnh ô Uplift tỉ lệ + handler lưu riêng', () => {
  assert.match(appSrc, /data-action-change="phase-views-uplift" data-phase-id=/);
  assert.match(appSrc, /Uplift Views \(%\/tháng\)/);
  assert.match(appSrc, /function phaseViewsUplift\(p\)/);
  assert.match(appSrc, /function savePhaseViewsUplift\(phaseId, raw\)/);
  assert.match(appSrc, /if \(ctxKind === 'phase-views-uplift'\) \{ savePhaseViewsUplift\(t\.getAttribute\('data-phase-id'\), t\.value\); return; \}/);
  assert.match(appSrc, /sUpdate\('phases', phaseId, \{ views_uplift_percent_per_month: v \}\)/);
  assert.match(appSrc, /sUpdate\('phases', phaseId, \{ views_uplift_percent_per_month: null \}\)/);
  // Validate: số âm -> chặn + toast như ô Uplift tỉ lệ; lưu xong render lại.
  const saveBlock = appSection('function savePhaseViewsUplift(phaseId, raw)', '// --- Lưu các ô Chỉ số vận hành');
  assert.match(saveBlock, /if \(isNaN\(v\) \|\| v < 0\) \{ toast\('Uplift Views phải là số %\/tháng từ 0 trở lên\.'\); render\(\); return; \}/);
  assert.match(saveBlock, /phaseSaveGuard\(\)/);
});

// ---------------------------------------------------------------- UI (unit): hai view khớp nhau qua lớp app
test('VU [UI unit]: phaseViewsUplift đọc snake/camel; trống -> null', () => {
  const h = loadAppHelpers({});
  assert.equal(h.phaseViewsUplift({ views_uplift_percent_per_month: 10 }), 10);
  assert.equal(h.phaseViewsUplift({ viewsUpliftPercentPerMonth: 7.5 }), 7.5);
  assert.equal(h.phaseViewsUplift({ views_uplift_percent_per_month: null }), null);
  assert.equal(h.phaseViewsUplift({}), null);
  assert.equal(h.phaseViewsUplift({ views_uplift_percent_per_month: 0 }), 0);
});

test('VU [UI unit]: view Theo phase (funnelTotalsFor) == view Theo tháng (forecastRawFor byMonth) khi phase có vu', () => {
  const phases = [{ id: 'ph-vu', brand_id: 'b1', name: 'VU', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 0, views_uplift_percent_per_month: 10 }];
  const h = loadAppHelpers({
    storeList: (coll) => (coll === 'phases' ? phases : coll === 'phase_assumptions' ? [] : []),
    domain
  });
  // Đường Theo phase: funnelTotalsFor trên rows của phase.
  const tPhase = h.funnelTotalsFor(ROWS_VU, BM);
  // Đường Theo tháng: forecastRawFor -> byMonth (nguồn của bảng KPI
  // Theo tháng Views/Paid Users/CAC/B2B Accounts).
  const raw = h.forecastRawFor(ROWS_VU, BM);
  const sumByMonth = Object.values(raw.byMonth).reduce((s, m) => s + m.views, 0);
  approx(tPhase.views, 16000 + 17600 + 19360, 'Theo phase tổng views có vu');
  approx(tPhase.views, sumByMonth, 'Theo phase == Theo tháng (views)');
  approx(tPhase.views, raw.byPhase['ph-vu'].views, 'Theo phase == byPhase engine');
  approx(tPhase.paid, Object.values(raw.byMonth).reduce((s, m) => s + m.paid, 0), 'Theo phase == Theo tháng (paid)');
});

test('VU [UI unit]: đường dự phòng normalizeFunnelSteps (engine không trả kết quả) cũng áp Uplift Views cùng cơ chế', () => {
  const phases = [{ id: 'ph-vu', brand_id: 'b1', name: 'VU', start_month: '2027-03', end_month: '2027-05', views_uplift_percent_per_month: 10 }];
  // domain rỗng -> forecastRawFor null -> forecastFunnelFor rơi vào
  // dự phòng tự tính reach = qty x output_per_unit trong app.js.
  const h = loadAppHelpers({
    storeList: (coll) => (coll === 'phases' ? phases : []),
    domain: {}
  });
  const steps = h.forecastFunnelFor([ROWS_VU[0], ROWS_VU[1]], BM);
  const reach = steps.find((s) => s.label === 'Reach / Views');
  assert.ok(reach, 'dự phòng phải có bước Reach / Views');
  // T3 (n=0): 4 x 4.000 = 16.000; T4 (n=1): 4 x 4.000 x 1,1 = 17.600.
  assert.equal(reach.value, 16000 + 17600, 'reach dự phòng phải gồm vu: ' + JSON.stringify(steps));
  // Không vu -> reach phẳng 32.000.
  const h2 = loadAppHelpers({
    storeList: (coll) => (coll === 'phases' ? [{ ...phases[0], views_uplift_percent_per_month: null }] : []),
    domain: {}
  });
  const reach2 = h2.forecastFunnelFor([ROWS_VU[0], ROWS_VU[1]], BM).find((s) => s.label === 'Reach / Views');
  assert.equal(reach2.value, 32000);
});
