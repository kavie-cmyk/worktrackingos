// tests/phase-cascade.test.mjs
// CASCADE TỈ LỆ / VIEWS GIỮA CÁC PHASE (Zac chốt 18/11/2026):
// từng field phân giải theo thứ tự assumption(phase hiện tại) ->
// assumption của PHASE SỚM HƠN GẦN NHẤT cùng Brand × Channel có
// field khác null -> Benchmark. Giá trị kế thừa là giá trị GỐC
// (chưa uplift); mỗi Phase áp uplift của CHÍNH nó. Một logic chung
// _resolveFieldCascade trong domain cho effectiveRatesFor /
// effectiveViewsPerUnitFor / forecastFunnel.
//
// Ca bắt buộc:
//  A) Hình dáng Owned production: kênh KHÔNG benchmark, assumptions
//     CHỈ ở Preparation -> forecast đủ 12 tháng, số tính tay từng
//     tháng ở Phase 2 và Phase cuối.
//  B) Kênh CÓ benchmark khác assumptions: Phase sau không assumption
//     -> dùng giá trị Preparation (inherited), KHÔNG dùng benchmark.
//     Số "trước" lấy bằng engine cũ tại HEAD cd9254a qua git worktree
//     (ghi trong comment của ca B + báo cáo đợt), khớp tính tay.
//  C) Assumptions ở MỌI Phase -> forecast + planBudget trước/sau
//     BẰNG NHAU tuyệt đối (snapshot dưới đây chính là output của
//     engine cũ tại HEAD cd9254a qua git worktree, deep equal).
//  Neo fixture: 764 content; 1.238.700.000đ; CAC T1 21.294.587đ;
//     Paid phi-Email 87,9960; gồm Email 107,4614 (đợt Website
//     Articles SEO 18/11: Paid Email tăng vì Free Articles nuôi list
//     Email — Paid phi-Email và CAC T1 giữ nguyên).
//  UI: render lưới Phase không mutate dữ liệu; nhãn "Kế thừa từ
//     <tên Phase>"; lưu ở Phase sau tạo assumption riêng đúng Phase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const domainSrc = readFileSync(new URL('../js/domain.js', import.meta.url), 'utf8');

function approx(actual, expected, label) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}
function section(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ================= Ca A =================
const PHASES_A = [
  { id: 'prep', brand_id: 'b1', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0, views_uplift_percent_per_month: 0 },
  { id: 'p2', brand_id: 'b1', name: 'Phase 2', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 10, views_uplift_percent_per_month: 5 },
  { id: 'p3', brand_id: 'b1', name: 'Phase 3', start_month: '2027-06', end_month: '2027-12', uplift_percent_per_month: 0, views_uplift_percent_per_month: 0 },
];
const ASSUMP_A = [{ phase_id: 'prep', channel: 'Facebook Owned', view_to_visit: 0.01, visit_to_freemium: 0.2, freemium_to_paid: 0.25, paid_to_b2b: null, lead_to_account: null, demo_to_account: null, views_per_unit: 4000 }];
function rowsA() {
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    rows.push({ id: 'r' + m, brand_id: 'b1', channel: 'Facebook Owned', group: 'Owned', month: '2027-' + String(m).padStart(2, '0'), qty: 2, phase_id: m <= 2 ? 'prep' : (m <= 5 ? 'p2' : 'p3') });
  }
  return rows;
}

test('CASCADE A [helper]: effectiveRatesFor/effectiveViewsPerUnitFor cho Phase sau trả base Preparation với source inherited + đúng sourcePhaseId/sourcePhaseName', () => {
  const rates = domain.effectiveRatesFor(PHASES_A[1], 'Facebook Owned', [], ASSUMP_A, PHASES_A);
  for (const [f, v] of [['view_to_visit', 0.01], ['visit_to_freemium', 0.2], ['freemium_to_paid', 0.25]]) {
    assert.equal(rates[f].value, v, f + ' value');
    assert.equal(rates[f].source, 'inherited', f + ' source');
    assert.equal(rates[f].sourcePhaseId, 'prep', f + ' sourcePhaseId');
    assert.equal(rates[f].sourcePhaseName, 'Preparation', f + ' sourcePhaseName');
  }
  const views = domain.effectiveViewsPerUnitFor(PHASES_A[1], 'Facebook Owned', [], ASSUMP_A, PHASES_A);
  assert.deepEqual(views, { value: 4000, source: 'inherited', sourcePhaseId: 'prep', sourcePhaseName: 'Preparation' });
  // Phase cuối cũng kế thừa từ Preparation (Phase 2 không có assumption nào).
  const views3 = domain.effectiveViewsPerUnitFor(PHASES_A[2], 'Facebook Owned', [], ASSUMP_A, PHASES_A);
  assert.equal(views3.source, 'inherited'); assert.equal(views3.sourcePhaseId, 'prep');
  // Chính Preparation: source assumption, không phải inherited.
  const ratesPrep = domain.effectiveRatesFor(PHASES_A[0], 'Facebook Owned', [], ASSUMP_A, PHASES_A);
  assert.equal(ratesPrep.view_to_visit.source, 'assumption');
  // Tương thích ngược: KHÔNG truyền phases -> không cascade (benchmark null -> null).
  const noPhases = domain.effectiveRatesFor(PHASES_A[1], 'Facebook Owned', [], ASSUMP_A);
  assert.equal(noPhases.view_to_visit.value, null, 'thiếu phases: hành vi cũ, không cascade');
  assert.equal(domain.effectiveViewsPerUnitFor(PHASES_A[1], 'Facebook Owned', [], ASSUMP_A).value, null);
});

test('CASCADE A [forecast]: kênh không benchmark, assumptions chỉ ở Preparation -> forecast đủ 12 tháng; tháng Preparation không đổi; Phase 2 và Phase cuối đúng số tính tay (base Preparation x uplift của chính Phase đó)', () => {
  const f = domain.forecastFunnel(rowsA(), [], { phases: PHASES_A, phaseAssumptions: ASSUMP_A });
  // Đủ 12 tháng có forecast (trước cascade chỉ T1-T2: totals cũ qua
  // worktree HEAD cd9254a = views 16000 / paid 8, T3+ hasForecast=false).
  for (let m = 1; m <= 12; m++) {
    const key = '2027-' + String(m).padStart(2, '0');
    assert.equal(f.byMonth[key].hasForecast, true, key + ' phải có forecast');
  }
  // Preparation (uplift 0): qty 2 x 4000 = 8000 views; x0,01 = 80 visits;
  // x0,2 = 16 freemium; x0,25 = 4 paid — như trước cascade.
  approx(f.byMonth['2027-01'].views, 8000, 'A T1 views');
  approx(f.byMonth['2027-01'].paid, 4, 'A T1 paid');
  approx(f.byMonth['2027-02'].paid, 4, 'A T2 paid');
  // Phase 2, tháng đầu (2027-03, n=0): uplift x1 -> y hệt base.
  approx(f.byMonth['2027-03'].views, 8000, 'A T3 views (n=0)');
  approx(f.byMonth['2027-03'].paid, 4, 'A T3 paid (n=0)');
  // Phase 2, 2027-04 (n=1): views mỗi bài 4000x1,05=4200 -> views 8400;
  // v2v 0,01x1,1=0,011 -> visits 92,4; v2f 0,2x1,1=0,22 -> freemium
  // 20,328; f2p 0,25x1,1=0,275 -> paid 5,5902.
  approx(f.byMonth['2027-04'].views, 8400, 'A T4 views');
  approx(f.byMonth['2027-04'].visits, 92.4, 'A T4 visits');
  approx(f.byMonth['2027-04'].freemium, 20.328, 'A T4 freemium');
  approx(f.byMonth['2027-04'].paid, 5.5902, 'A T4 paid');
  // Phase 2, 2027-05 (n=2): views 2x4000x1,05^2=8820; paid tính tay
  // 8820 x 0,01x1,1^2 x 0,2x1,1^2 x 0,25x1,1^2 = 7,81258401.
  approx(f.byMonth['2027-05'].views, 8820, 'A T5 views');
  approx(f.byMonth['2027-05'].paid, 7.81258401, 'A T5 paid');
  // Phase cuối (uplift 0 của chính nó): mọi tháng về base Preparation
  // — uplift 10%/5% của Phase 2 KHÔNG cộng dồn sang Phase 3.
  approx(f.byMonth['2027-06'].views, 8000, 'A T6 views (Phase cuối, uplift 0)');
  approx(f.byMonth['2027-06'].paid, 4, 'A T6 paid');
  approx(f.byMonth['2027-12'].paid, 4, 'A T12 paid');
  approx(f.totals.views, 97220, 'A totals views');
  approx(f.totals.paid, 53.40278401, 'A totals paid');
});

test('CASCADE A2 [per-field]: kế thừa TỪNG field độc lập — field có ở Phase gần hơn thắng field đó, field null ở Phase gần vẫn lấy từ Phase xa hơn / benchmark', () => {
  const phases = [
    { id: 'prep', brand_id: 'b1', name: 'Preparation', start_month: '2027-01', end_month: '2027-02' },
    { id: 'p2', brand_id: 'b1', name: 'Phase 2', start_month: '2027-03', end_month: '2027-05' },
    { id: 'p3', brand_id: 'b1', name: 'Phase 3', start_month: '2027-06', end_month: '2027-12' },
  ];
  const assumptions = [
    { phase_id: 'prep', channel: 'Ch X', view_to_visit: 0.01, visit_to_freemium: 0.2, freemium_to_paid: null, views_per_unit: 4000 },
    { phase_id: 'p2', channel: 'Ch X', view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.5, views_per_unit: null },
  ];
  const bm = [{ brand_id: 'b1', channel: 'Ch X', output_per_unit: 9999, view_to_visit: 0.003, visit_to_freemium: 0.09, freemium_to_paid: 0.0275 }];
  const rates = domain.effectiveRatesFor(phases[2], 'Ch X', bm, assumptions, phases);
  assert.equal(rates.view_to_visit.value, 0.01, 'v2v: p2 null -> lấy prep (không rơi benchmark)');
  assert.equal(rates.view_to_visit.sourcePhaseId, 'prep');
  assert.equal(rates.visit_to_freemium.value, 0.2, 'v2f từ prep');
  assert.equal(rates.freemium_to_paid.value, 0.5, 'f2p: Phase GẦN NHẤT (p2) thắng');
  assert.equal(rates.freemium_to_paid.sourcePhaseId, 'p2');
  const views = domain.effectiveViewsPerUnitFor(phases[2], 'Ch X', bm, assumptions, phases);
  assert.equal(views.value, 4000, 'views: p2 null -> prep 4000, không phải benchmark 9999');
  assert.equal(views.source, 'inherited');
  // Khác Brand không kế thừa: phase brand khác dù sớm hơn cũng bị bỏ.
  const phasesOtherBrand = phases.concat([{ id: 'px', brand_id: 'b2', name: 'Other', start_month: '2026-01', end_month: '2026-12' }]);
  const assumpOther = assumptions.concat([{ phase_id: 'px', channel: 'Ch X', view_to_visit: 0.99, visit_to_freemium: 0.99, freemium_to_paid: 0.99, views_per_unit: 1 }]);
  const rates2 = domain.effectiveRatesFor(phases[0], 'Ch X', bm, assumpOther, phasesOtherBrand);
  assert.equal(rates2.view_to_visit.value, 0.01, 'prep là phase sớm nhất của b1: không kế thừa từ brand khác / phase sau');
  assert.equal(rates2.view_to_visit.source, 'assumption');
});

test('CASCADE A3 [fallback key cũ]: v2f/f2p fallback vẫn áp ở tầng hiệu dụng, nguồn từng key cũ qua cascade; nguồn f2p dạng tích theo quy tắc assumption > inherited (phase nguồn của yếu tố inherited đầu tiên) > benchmark', () => {
  const phases = [
    { id: 'prep', brand_id: 'b1', name: 'Preparation', start_month: '2027-01', end_month: '2027-02' },
    { id: 'p2', brand_id: 'b1', name: 'Phase 2', start_month: '2027-03', end_month: '2027-05' },
  ];
  // Chỉ key cũ ở Preparation: signup_to_first 0,5 + first_to_paid 0,1.
  const assumptions = [{ phase_id: 'prep', channel: 'Ch Old', view_to_visit: 0.01, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.1, views_per_unit: 1000 }];
  const rates = domain.effectiveRatesFor(phases[1], 'Ch Old', [], assumptions, phases);
  assert.equal(rates.visit_to_freemium.value, 0.09, 'v2f fallback = visit_to_signup kế thừa');
  assert.equal(rates.visit_to_freemium.source, 'inherited');
  approx(rates.freemium_to_paid.value, 0.05, 'f2p fallback = 0,5 x 0,1 kế thừa');
  assert.equal(rates.freemium_to_paid.source, 'inherited', 'f2p tích: không yếu tố assumption, có inherited -> inherited');
  assert.equal(rates.freemium_to_paid.sourcePhaseId, 'prep', 'phase nguồn của yếu tố inherited đầu tiên (signup_to_first)');
  // Forecast qua key cũ kế thừa cũng chạy đủ chuỗi.
  const rows = [{ id: 'r1', brand_id: 'b1', channel: 'Ch Old', group: 'KOL', month: '2027-03', qty: 2, phase_id: 'p2' }];
  const f = domain.forecastFunnel(rows, [], { phases, phaseAssumptions: assumptions });
  approx(f.rows[0].forecast.views, 2000, 'views qua views_per_unit kế thừa');
  approx(f.rows[0].forecast.paid, 2000 * 0.01 * 0.09 * 0.05, 'paid qua chuỗi key cũ kế thừa');
});

// ================= Ca B =================
test('CASCADE B: kênh CÓ benchmark khác assumptions — Phase sau không assumption dùng giá trị Preparation (inherited), KHÔNG dùng benchmark; số tháng Phase sau TRƯỚC/SAU liệt kê rõ', () => {
  // Số TRƯỚC (engine cũ tại HEAD cd9254a, chạy qua git worktree —
  // cách lấy ghi ở báo cáo đợt; khớp tính tay từ benchmark):
  //   views = 2 x 4000 = 8000; visits = 8000 x 0,003 = 24;
  //   freemium = 24 x 0,09 = 2,16; paid = 2,16 x 0,0275 = 0,0594.
  // Số SAU (cascade từ Preparation):
  //   views = 2 x 5000 = 10000; visits = 10000 x 0,01 = 100;
  //   freemium = 100 x 0,2 = 20; paid = 20 x 0,25 = 5.
  const bm = [{ brand_id: 'b1', channel: 'KOL Test', output_per_unit: 4000, view_to_visit: 0.003, visit_to_freemium: 0.09, freemium_to_paid: 0.0275 }];
  const phases = [
    { id: 'prep', brand_id: 'b1', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
    { id: 'p2', brand_id: 'b1', name: 'Phase 2', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 0 },
  ];
  const assumptions = [{ phase_id: 'prep', channel: 'KOL Test', view_to_visit: 0.01, visit_to_freemium: 0.2, freemium_to_paid: 0.25, views_per_unit: 5000 }];
  const rates = domain.effectiveRatesFor(phases[1], 'KOL Test', bm, assumptions, phases);
  assert.equal(rates.view_to_visit.source, 'inherited', 'Phase sau phải inherited, không phải benchmark');
  assert.equal(rates.view_to_visit.value, 0.01);
  const rows = [{ id: 'rb', brand_id: 'b1', channel: 'KOL Test', group: 'KOL', month: '2027-03', qty: 2, phase_id: 'p2' }];
  const fc = domain.forecastFunnel(rows, bm, { phases, phaseAssumptions: assumptions }).rows[0].forecast;
  approx(fc.views, 10000, 'B SAU views (trước: 8000 benchmark)');
  approx(fc.visits, 100, 'B SAU visits (trước: 24)');
  approx(fc.freemium, 20, 'B SAU freemium (trước: 2,16)');
  approx(fc.paid, 5, 'B SAU paid (trước: 0,0594)');
  assert.notEqual(fc.paid, 0.0594, 'paid sau cascade khác hẳn số benchmark cũ');
});

// ================= Ca C =================
test('CASCADE C: assumptions ở MỌI Phase — forecast + planBudget trước/sau BẰNG NHAU tuyệt đối (deep equal với snapshot engine cũ HEAD cd9254a)', () => {
  const phases = [
    { id: 'prep', brand_id: 'b1', name: 'Preparation', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 },
    { id: 'p2', brand_id: 'b1', name: 'Phase 2', start_month: '2027-03', end_month: '2027-05', uplift_percent_per_month: 5, views_uplift_percent_per_month: 2 },
  ];
  const bm = [{ brand_id: 'b1', channel: 'KOL Test', output_per_unit: 4000, view_to_visit: 0.003, visit_to_freemium: 0.09, freemium_to_paid: 0.0275 }];
  const assumptions = [
    { phase_id: 'prep', channel: 'KOL Test', view_to_visit: 0.01, visit_to_freemium: 0.2, freemium_to_paid: 0.25, views_per_unit: 5000 },
    { phase_id: 'p2', channel: 'KOL Test', view_to_visit: 0.02, visit_to_freemium: 0.3, freemium_to_paid: 0.1, views_per_unit: 6000 },
  ];
  const rows = [
    { id: 'r1', brand_id: 'b1', channel: 'KOL Test', group: 'KOL', month: '2027-01', qty: 2, phase_id: 'prep', unit_price: 1000 },
    { id: 'r2', brand_id: 'b1', channel: 'KOL Test', group: 'KOL', month: '2027-04', qty: 3, phase_id: 'p2', unit_price: 1000 },
  ];
  const f = domain.forecastFunnel(rows, bm, { phases, phaseAssumptions: assumptions });
  // Snapshot engine CŨ (git worktree HEAD cd9254a — output JSON khớp
  // từng byte với engine mới trên fixture này, đã đối chiếu ngoài suite):
  assert.deepEqual(f.totals, { views: 28360, visits: 485.56, freemium: 141.4514, paid: 17.752397000000002, b2b: 0, b2bBridge: 0 });
  assert.deepEqual(f.rows.map((r) => r.forecast), [
    { views: 10000, visits: 100, freemium: 20, paid: 5, b2b: 0, b2bBridge: 0 },
    { views: 18360, visits: 385.56, freemium: 121.4514, paid: 12.752397000000002, b2b: 0, b2bBridge: 0 },
  ]);
  assert.deepEqual(f.byPhase, {
    prep: { phase_id: 'prep', views: 10000, visits: 100, freemium: 20, paid: 5, b2b: 0, b2bBridge: 0, rowCount: 1 },
    p2: { phase_id: 'p2', views: 18360, visits: 385.56, freemium: 121.4514, paid: 12.752397000000002, b2b: 0, b2bBridge: 0, rowCount: 1 },
  });
  assert.equal(domain.planBudget(rows, bm).total, 5000, 'planBudget không đổi: (2+3) x 1.000 giá Phase trên dòng');
  // Helper có/không truyền phases cho cùng kết quả khi mọi Phase đều có assumption riêng.
  assert.deepEqual(domain.effectiveRatesFor(phases[1], 'KOL Test', bm, assumptions, phases), domain.effectiveRatesFor(phases[1], 'KOL Test', bm, assumptions));
  assert.deepEqual(domain.effectiveViewsPerUnitFor(phases[1], 'KOL Test', bm, assumptions, phases), domain.effectiveViewsPerUnitFor(phases[1], 'KOL Test', bm, assumptions));
});

// ================= Neo fixture =================
test('CASCADE [neo]: fixture Lumus — 764 content; ngân sách 1.238.700.000đ; CAC Tất cả T1 21.294.587đ; Paid phi-Email 87,9960 (giữ); gồm Email 107,4614 (đợt SEO Articles 18/11)', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 764, 'content = 764');
  const ctx = { phases: demo.phases.filter((p) => p.brand_id && p.start_month), phaseAssumptions: demo.phase_assumptions };
  const budget = domain.planBudget(lumus, demo.benchmarks);
  assert.equal(budget.total, 1238700000, 'tổng ngân sách = 1.238.700.000đ');
  const f = domain.forecastFunnel(lumus, demo.benchmarks, ctx);
  approx(f.totals.paid, 107.46143872807268, 'Paid gồm Email = 107,4614 (Paid Email tăng do Free Articles nuôi list)');
  const nonEmail = lumus.filter((r) => !(r.channel === 'Email Sends' || r.channel === 'Email CRM' || r.channel === 'Email' || r.group === 'Email'));
  approx(domain.forecastFunnel(nonEmail, demo.benchmarks, ctx).totals.paid, 87.99595277784127, 'Paid phi-Email = 87,9960');
  assert.equal(Math.round(budget.byMonth['2027-01'].amount / f.byMonth['2027-01'].paid), 21294587, 'CAC Tất cả T1 = 21.294.587đ');
});

// ================= Static: một logic chung =================
test('CASCADE [static]: domain có MỘT hàm phân giải chung _resolveFieldCascade; effectiveRatesFor/effectiveViewsPerUnitFor/forecastFunnel đều gọi nó; app wrapper truyền brandPhasesList()', () => {
  assert.match(domainSrc, /function _resolveFieldCascade\(/);
  const effRates = section(domainSrc, 'function effectiveRatesFor(', 'function effectiveViewsPerUnitFor(');
  assert.match(effRates, /_resolveFieldCascade\(/);
  const effViews = section(domainSrc, 'function effectiveViewsPerUnitFor(', 'function planMonthsForYear(');
  assert.match(effViews, /_resolveFieldCascade\(/);
  const funnel = section(domainSrc, 'function forecastFunnel(', 'function planBudget(');
  assert.ok((funnel.match(/_resolveFieldCascade\(/g) || []).length >= 2, 'forecastFunnel: baseRate + views mỗi bài đều qua hàm chung');
  assert.match(appSrc, /D\.effectiveRatesFor\(phR, channel, benchmarks \|\| benchmarksList\(\), phaseAssumptionsList\(\), brandPhasesList\(\)\)/);
  assert.match(appSrc, /D\.effectiveViewsPerUnitFor\(phV, channel, benchmarks \|\| benchmarksList\(\), phaseAssumptionsList\(\), brandPhasesList\(\)\)/);
  // Toast/hint xoá trắng nói đúng cascade (không còn khẳng định tuyệt đối về Benchmark ở savePhaseRate).
  assert.match(appSrc, /quay về kế thừa Phase trước\/Benchmark theo cascade/);
});

// ================= UI: render không mutate + nhãn kế thừa + lưu Phase sau =================
function cfValStub(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
  if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
  return undefined;
}
const escStub = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtNumStub = (n) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN');
const fmtMoneyStub = (n, c) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('vi-VN') + ' ' + (c || '');

function makeUiHarness(rows, phases, benchmarks, assumptions) {
  const helpers = section(appSrc, '// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section(appSrc, '// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {}, planningOpeningPhaseIds: {} };
  const state = { toasts: [], updates: [], creates: [] };
  const Store = {
    mode: 'supabase',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? phases : coll === 'benchmarks' ? benchmarks : coll === 'phase_assumptions' ? assumptions : []),
    get: () => null,
  };
  const poolOf = (coll) => coll === 'plan_rows' ? rows : coll === 'phases' ? phases : coll === 'phase_assumptions' ? assumptions : benchmarks;
  const sUpdate = (coll, id, patch) => {
    const item = poolOf(coll).find((r) => String(r.id) === String(id));
    if (!item) return { ok: false, error: 'Không tìm thấy dòng.' };
    Object.assign(item, patch); state.updates.push({ coll, id, patch }); return { ok: true, item };
  };
  const sCreate = (coll, obj) => {
    const arr = poolOf(coll);
    const item = { id: coll + '-new-' + (arr.length + 1), ...obj };
    arr.push(item); state.creates.push({ coll, item }); return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => { if (result && result.ok) { if (onOk) onOk(result); } else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.'); };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { UI: UI, planningPhaseBlockHtml: planningPhaseBlockHtml, savePhaseRate: savePhaseRate, savePhaseViews: savePhaseViews, effectivePhaseRates: effectivePhaseRates, effectivePhaseViewsPerUnit: effectivePhaseViewsPerUnit, phaseAssumptionFor: phaseAssumptionFor, brandPhasesList: brandPhasesList };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true, (m) => state.toasts.push(m), () => {},
    sUpdate, sCreate, saveResult,
    escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<table data-table-key="' + key + '">' + inner + '</table>',
    (m) => 'Tháng ' + Number(String(m).slice(5, 7)) + '/' + String(m).slice(0, 4),
    () => '<div data-viz-stub="funnel"></div>');
  return { h, state, UI };
}

test('CASCADE [UI]: render lưới Phase của Phase sau (trống assumption) KHÔNG mutate dữ liệu, hiện nhãn "Kế thừa từ Preparation" + giá trị hiệu dụng cạnh ô; lưu tỉ lệ ở Phase sau tạo đúng assumption của Phase đó', () => {
  const phases = JSON.parse(JSON.stringify(PHASES_A));
  const rows = rowsA();
  const assumptions = JSON.parse(JSON.stringify(ASSUMP_A));
  const { h, state } = makeUiHarness(rows, phases, [], assumptions);
  const snapshotBefore = JSON.stringify({ phases, rows, assumptions });
  const block = h.planningPhaseBlockHtml(phases[1], rows, [], true, '');
  // Render không ghi dữ liệu: không assumption mới, không update/create nào.
  assert.equal(JSON.stringify({ phases, rows, assumptions }), snapshotBefore, 'render không mutate store/dữ liệu');
  assert.equal(assumptions.length, 1, 'chỉ xem Phase sau trống không tự sinh assumption');
  assert.equal(state.creates.length + state.updates.length, 0, 'render không gọi ghi');
  // Nhãn nguồn kế thừa + phase nguồn, cho cả tỉ lệ và views.
  assert.ok(block.includes('Kế thừa từ Preparation'), 'ô tỉ lệ/views phải hiện "Kế thừa từ Preparation", block: ' + block.slice(0, 400));
  assert.ok(block.includes('data-rate-source="inherited"'), 'td tỉ lệ mang data-rate-source=inherited');
  assert.ok(block.includes('data-views-source="inherited"'), 'ô views mang data-views-source=inherited');
  assert.ok(block.includes('data-source-phase-id="prep"'), 'nhãn kế thừa kèm sourcePhaseId=prep');
  // Ô input của Phase sau: giá trị RIÊNG (data-own-value) trống — assumption
  // của chính Phase đó chưa có; giá trị hiệu dụng hiện cạnh ô qua nhãn/Hiệu dụng.
  assert.ok(block.includes('data-own-value=""'), 'assumption riêng của Phase 2 trống (data-own-value="")');
  assert.ok(block.includes('Hiệu dụng:'), 'cạnh ô có giá trị hiệu dụng');
  // App wrapper (qua domain + phases) cho cùng kết quả inherited như domain thuần.
  const appRates = h.effectivePhaseRates(phases[1], 'Facebook Owned', []);
  assert.equal(appRates.view_to_visit.source, 'inherited');
  assert.equal(appRates.view_to_visit.sourcePhaseId, 'prep');
  // Lưu tỉ lệ ở Phase sau -> tạo assumption ĐÚNG (phase đó, channel đó), ghi đè kế thừa.
  h.savePhaseRate('p2', 'Facebook Owned', 'view_to_visit', '2');
  const own = assumptions.find((a) => a.phase_id === 'p2' && a.channel === 'Facebook Owned');
  assert.ok(own, 'savePhaseRate ở Phase sau phải tạo assumption cho p2');
  assert.equal(own.view_to_visit, 0.02, 'nhập 2% lưu 0,02');
  const after = h.effectivePhaseRates(phases[1], 'Facebook Owned', []);
  assert.equal(after.view_to_visit.source, 'assumption', 'sau khi lưu, field đó là assumption của chính Phase (ghi đè kế thừa)');
  assert.equal(after.visit_to_freemium.source, 'inherited', 'field chưa lưu vẫn kế thừa');
  // Lưu views ở Phase sau cũng tạo/ghi đúng assumption đó.
  h.savePhaseViews('p2', 'Facebook Owned', '6000');
  assert.equal(own.views_per_unit, 6000);
});
