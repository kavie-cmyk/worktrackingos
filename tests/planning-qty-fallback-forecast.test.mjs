// tests/planning-qty-fallback-forecast.test.mjs
// Sửa tồn dư quantity/qty ở forecastFunnel (HEAD 9570f06 -> sau):
// forecastFunnel trước đây đọc số lượng THÔ bằng _planNum(r.qty) ở 3
// điểm (snapshot qty của row, cổng budget-driven _qty0, qty của đường
// content) — KHÔNG fallback qty ?? quantity ?? count như _planQty
// (helper chuẩn của domain, dùng bởi planBudget / summarize*) và
// planRowQty của app. Hệ quả: dòng plan mang số lượng ở field
// `quantity` hoặc `count` có ngân sách (planBudget đọc được) nhưng
// forecast = null. Sau sửa: cả 3 điểm đều qua _planQty — MỘT nguồn
// duy nhất, không thêm bản sao logic fallback nào khác.
//
// Bao phủ bắt buộc:
//  (1) Cùng dòng viết 3 cách (chỉ qty / chỉ quantity / chỉ count) ->
//      forecast GIỐNG HỆT nhau (Views/Paid/B2B từng tháng + totals +
//      snapshot qty của row).
//  (2) Dòng có cả qty lẫn quantity (khác giá trị) -> qty thắng, khớp
//      planBudget + planQtyOf; quantity thắng count khi thiếu qty.
//  (3) Dòng không có field số lượng nào -> forecast null như cũ.
//  (4) Differential trên fixture Lumus (mọi dòng đều qty): output của
//      forecastFunnel (+ctx và không ctx) + planBudget +
//      computeOperatingFinancials (hạ nguồn của forecast+budget)
//      khớp ĐÚNG các giá trị đã ghi lại trên code TRƯỚC sửa
//      (HEAD 9570f06; đối chiếu ngoài suite: JSON.stringify của cả 3
//      output trước/sau sửa bằng nhau từng byte — xem báo cáo đợt).
// Số neo (tính lại 18/11): 764 content; Paid cả kỳ (kèm ctx phase)
// 107,4614… (đợt SEO Articles: Paid Email tăng do Free Articles
// nuôi list); CAC "Tất cả" T1 = 21.294.587đ (giữ); tổng ngân sách
// fixture 1.238.700.000đ.
// GHI LẠI đợt Articles 21/11/2026 (CR 5% + Paid 3,5% tại kênh —
// thay đổi mô hình CÓ CHỦ ĐÍCH, không phải hồi quy của _planQty):
// Paid cả kỳ 448,5513…; CAC T1 = 6.081.190đ. Chi tiết ở ca (4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const domainSrc = readFileSync(new URL('../js/domain.js', import.meta.url), 'utf8');

function approx(actual, expected, label) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

// Benchmark content (mô hình 18/11: paid_to_b2b theo Channel đã bỏ
// nên B2B tầng kênh = 0 ở mọi cách viết số lượng — vẫn kiểm được
// tính giống hệt nhau của B2B):
// qty 4 -> views 400, visits 40, freemium 4, paid 0,4, b2b 0.
const BM = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, direct_budget: false }];

function rowsWith(field, qtyByMonth) {
  return Object.entries(qtyByMonth).map(([month, q], i) => {
    const r = { id: `r-${field}-${month}`, brand_id: 'b1', month, channel: 'KOL X', group: 'KOL', budget: null, unit_price: 1000 };
    r[field] = q;
    return r;
  });
}
const QTY_3M = { '2027-01': 4, '2027-02': 2, '2027-03': 1 };

test('PQF (1): chỉ qty / chỉ quantity / chỉ count -> forecast giống hệt nhau từng tháng (Views/Paid/B2B)', () => {
  const fQty = domain.forecastFunnel(rowsWith('qty', QTY_3M), BM);
  const fQuantity = domain.forecastFunnel(rowsWith('quantity', QTY_3M), BM);
  const fCount = domain.forecastFunnel(rowsWith('count', QTY_3M), BM);
  // Snapshot qty của row detail cũng phải qua cùng quy tắc fallback.
  for (const f of [fQty, fQuantity, fCount]) {
    assert.deepEqual(f.rows.map((r) => r.qty), [4, 2, 1], 'snapshot qty của row');
    assert.ok(f.rows.every((r) => r.forecast !== null), 'mọi dòng đều có forecast');
  }
  assert.deepEqual(fQuantity.byMonth, fQty.byMonth, 'byMonth quantity == qty');
  assert.deepEqual(fCount.byMonth, fQty.byMonth, 'byMonth count == qty');
  assert.deepEqual(fQuantity.totals, fQty.totals, 'totals quantity == qty');
  assert.deepEqual(fCount.totals, fQty.totals, 'totals count == qty');
  assert.deepEqual(
    fQuantity.rows.map((r) => r.forecast), fQty.rows.map((r) => r.forecast), 'forecast từng row quantity == qty');
  assert.deepEqual(
    fCount.rows.map((r) => r.forecast), fQty.rows.map((r) => r.forecast), 'forecast từng row count == qty');
  // Số neo tính tay của chính fixture này (qty T1 = 4):
  approx(fQty.byMonth['2027-01'].views, 400, 'T1 views');
  approx(fQty.byMonth['2027-01'].paid, 0.4, 'T1 paid');
  assert.equal(fQty.byMonth['2027-01'].b2b, 0, 'T1 b2b = 0 (không còn tỉ lệ theo Channel)');
  approx(fQty.totals.views, 700, 'tổng views 3 tháng');
  approx(fQty.totals.paid, 0.7, 'tổng paid 3 tháng');
  assert.equal(fQty.totals.b2b, 0, 'tổng b2b 3 tháng = 0');
  // Ngân sách (planBudget) của 3 cách viết vốn đã giống nhau từ trước;
  // nay forecast khớp cùng một nguồn số lượng với ngân sách.
  for (const rows of [rowsWith('qty', QTY_3M), rowsWith('quantity', QTY_3M), rowsWith('count', QTY_3M)]) {
    assert.equal(domain.planBudget(rows, BM).total, 7000, 'planBudget = (4+2+1) x 1.000');
  }
});

test('PQF (2): có cả qty lẫn quantity -> qty thắng (khớp planQtyOf + planBudget); thiếu qty -> quantity thắng count', () => {
  const both = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 4, quantity: 99, count: 77, budget: null, unit_price: 1000 }];
  assert.equal(domain.planQtyOf(both[0]), 4, 'planQtyOf: qty thắng');
  assert.equal(domain.planBudget(both, BM).total, 4000, 'planBudget: qty thắng (4 x 1.000)');
  const f = domain.forecastFunnel(both, BM);
  assert.equal(f.rows[0].qty, 4, 'snapshot qty: qty thắng');
  approx(f.rows[0].forecast.views, 400, 'forecast theo qty = 4 (không phải 99/77)');
  approx(f.rows[0].forecast.paid, 0.4, 'paid theo qty');
  const noQty = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'KOL', quantity: 5, count: 99, budget: null, unit_price: 1000 }];
  assert.equal(domain.planQtyOf(noQty[0]), 5, 'planQtyOf: quantity thắng count');
  assert.equal(domain.planBudget(noQty, BM).total, 5000, 'planBudget: quantity thắng count');
  approx(domain.forecastFunnel(noQty, BM).rows[0].forecast.views, 500, 'forecast: quantity thắng count');
});

test('PQF (3): dòng không có field số lượng nào -> forecast null như cũ, không bịa số', () => {
  const rows = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'KOL', budget: null }];
  const f = domain.forecastFunnel(rows, BM);
  assert.equal(f.rows[0].qty, null, 'snapshot qty = null');
  assert.equal(f.rows[0].forecast, null, 'forecast = null');
  assert.equal(f.byMonth['2027-01'].hasForecast, false, 'tháng không có forecast');
  assert.deepEqual(f.totals, { views: 0, visits: 0, freemium: 0, paid: 0, b2b: 0, b2bBridge: 0 }, 'totals toàn 0 (b2bBridge = field cộng thêm của thay đổi B 18/11, 0 khi không có forecast)');
  // qty = '' / không phải số cũng là không có số lượng (cùng _planQty).
  for (const bad of ['', 'abc']) {
    const fb = domain.forecastFunnel([{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'KOL', quantity: bad, budget: null }], BM);
    assert.equal(fb.rows[0].forecast, null, `quantity=${JSON.stringify(bad)} -> forecast null`);
  }
});

test('PQF (3b): cổng budget-driven dùng cùng _planQty — dòng nhóm Paid Media có quantity + budget KHÔNG bị kéo sang đường ngân sách', () => {
  // Benchmark KHÔNG direct_budget: trước sửa, _qty0 đọc r.qty thô =
  // null nên dòng bị phân loại budget-driven (forecast null vì không
  // objective/đơn giá); planBudget lại coi đây là dòng có số lượng.
  // Sau sửa hai đường thống nhất: dòng đi đường content.
  const bmContent = [{ brand_id: 'b1', channel: 'KOL X', group: 'Paid Media', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: null, direct_budget: false }];
  const rows = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'Paid Media', quantity: 4, budget: 999999, unit_price: 1000 }];
  const f = domain.forecastFunnel(rows, bmContent);
  assert.ok(f.rows[0].forecast, 'dòng có quantity phải forecast theo content');
  approx(f.rows[0].forecast.views, 400, 'views = quantity x output');
  assert.equal(domain.planBudget(rows, bmContent).total, 4000, 'planBudget khớp: quantity x giá Phase trên dòng, bỏ qua field budget');
});

test('PQF [static]: domain chỉ còn MỘT nơi chứa chuỗi fallback qty/quantity/count — chính _planQty; forecastFunnel không đọc r.qty thô', () => {
  const fallbackSites = domainSrc.match(/\.qty !== undefined \? [A-Za-z_$][\w$]*\.qty : \(/g) || [];
  assert.equal(fallbackSites.length, 1, 'đúng 1 định nghĩa fallback trong domain (trong _planQty)');
  assert.ok(!/_planNum\(\s*r\s*&&\s*r\.qty\s*\)/.test(domainSrc), 'không còn _planNum(r && r.qty)');
  assert.ok(!/_planNum\(\s*r\.qty\s*\)/.test(domainSrc), 'không còn _planNum(r.qty)');
  const funnelSrc = domainSrc.slice(domainSrc.indexOf('function forecastFunnel('), domainSrc.indexOf('function planBudget('));
  assert.ok((funnelSrc.match(/_planQty\(r\)/g) || []).length >= 3, 'forecastFunnel đọc số lượng qua _planQty ở cả 3 điểm');
});

test('PQF (4) [differential]: fixture Lumus (mọi dòng đều qty) — forecastFunnel + planBudget + computeOperatingFinancials khớp snapshot ghi TRƯỚC sửa', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 764, 'neo: 764 content');
  const ctx = { phases: demo.phases.filter((p) => p.brand_id), phaseAssumptions: demo.phase_assumptions };
  const forecast = domain.forecastFunnel(lumus, demo.benchmarks, ctx);
  const forecastNoCtx = domain.forecastFunnel(lumus, demo.benchmarks);
  const budget = domain.planBudget(lumus, demo.benchmarks);
  // Snapshot TRƯỚC sửa (HEAD 9570f06), GHI LẠI sau đợt Email 18/11
  // và sau đợt xoá kênh KOL thứ ba 18/11: kênh Email có benchmark
  // nên forecast gồm opens/clicks/Paid Email (freemium KHÔNG đổi
  // vì Email freemium = 0).
  // GHI LẠI đợt Website Articles SEO 18/11: Articles có forecast
  // theo Mô hình SEO B (views 189.749, freemium 4.744, visits =
  // views, paid 0); Free Articles nuôi list Email nên Paid Email
  // tăng 9,6875 -> 19,4655 và Paid tổng 97,6835 -> 107,4614.
  // GHI LẠI đợt Articles 21/11 (Zac chốt: CR 2,5% -> 5% + Paid =
  // 3,5% × Free TẠI KÊNH): views Articles giữ 189.749; freemium
  // Articles 4.744 -> 9.487; Paid Articles tại kênh = 332 (T1 = 5);
  // list Email theo tồn (Free − Paid) -> Paid Email 19,4655 ->
  // 28,5554, opens Email (ctx) 17.296,9117 -> 25.392,6695. Paid
  // tổng = 448,5513; Paid không ctx = 438,8769; Paid T1 = 6,99863.
  // (Series Articles + chuỗi list Email đã kiểm chứng độc lập
  // ngoài engine ở tests/planning-seo-articles.test.mjs.)
  approx(forecast.totals.views, 1375141.6695244024, 'diff forecast views');
  approx(forecast.totals.visits, 205924.9593923939, 'diff forecast visits');
  approx(forecast.totals.freemium, 12203.831132798625, 'diff forecast freemium');
  approx(forecast.totals.paid, 448.5513053315356, 'neo: Paid cả kỳ fixture = 448,5513… (gồm Paid Email + Paid Articles tại kênh)');
  assert.equal(forecast.totals.b2b, 0, 'diff forecast b2b');
  approx(forecastNoCtx.totals.paid, 438.8769071731386, 'diff forecast (không ctx) paid');
  approx(forecast.byMonth['2027-01'].views, 78808, 'diff T1 views');
  approx(forecast.byMonth['2027-01'].paid, 6.99863, 'diff T1 paid');
  assert.equal(budget.total, 1238700000, 'neo: tổng ngân sách fixture = 1.238.700.000đ');
  assert.equal(budget.totalDirect, 811200000, 'diff budget direct');
  assert.equal(budget.totalUnitPrice, 427500000, 'diff budget unit-price');
  assert.equal(budget.byMonth['2027-01'].amount, 42560000, 'diff budget T1');
  assert.equal(Math.round(budget.byMonth['2027-01'].amount / forecastNoCtx.byMonth['2027-01'].paid), 6081190, 'neo: CAC Tất cả T1 = 6.081.190đ');
  // Hạ nguồn tài chính: cùng đầu vào FULL cố định như bản ghi trước sửa.
  const FULL = { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: 0.01, paid_price: 47000, cogs_per_free_user: 10000, cogs_per_paid_user: 20000, fixed_cost: 200000, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000 };
  const funnelByMonth = {}; const budgetByMonth = {}; const inputsByMonth = {};
  for (const m of forecast.months) {
    funnelByMonth[m] = forecast.byMonth[m];
    budgetByMonth[m] = budget.byMonth[m] ? budget.byMonth[m].amount : 0;
    inputsByMonth[m] = FULL;
  }
  const fin = domain.computeOperatingFinancials({ months: forecast.months, funnelByMonth, budgetByMonth, inputsByMonth, openingFree: 1000, openingPaid: 100, openingB2b: 50 });
  assert.equal(fin.totals.budget, 1238700000, 'diff fin budget');
  // Số tài chính GHI LẠI sau đợt Email 18/11: reach/newPaid/revenue/
  // paidEom tăng đúng lượng Paid Email chảy vào New Paid; freeEom
  // giảm tương ứng (New Paid trừ khỏi Free EOM). T1 không đổi vì
  // Email T1 = 0 (list đầu kỳ của fixture này do openingFree quyết).
  // GHI LẠI đợt SEO Articles 18/11: Free Articles vào Free user của
  // bảng vận hành -> New Paid qua Monthly cvr (1%) tăng theo tồn
  // Free, reach/visits tăng theo views/visits Articles; T1 paidEom
  // vẫn giữ nguyên (New Paid T1 = funnel Paid T1 + 1% × openingFree
  // 1.000, cả hai thành phần đều không đổi ở T1).
  // GHI LẠI đợt Articles 21/11 (CR 5% + Paid tại kênh): đầu vào
  // funnel byMonth đổi (Free 12.203,8311; Paid 448,5513 — series
  // đã kiểm chứng độc lập) -> New Paid = Paid funnel 448,5513 +
  // CVR conversions 417,3619 (tăng từ 311,0046 vì tồn Free lớn
  // hơn) = 865,9133. LẦN NÀY T1 paidEom ĐỔI vì funnel Paid T1
  // +5: New Paid T1 = 6,99863 + 1% × 1.000 = 16,99863; Paid churn
  // T1 = (100 + 16,99863) × 2% × 0,5 = 1,1699863; paidEom T1 =
  // 100 + 16,99863 − 1,1699863 = 115,8286 (cũ 110,8786; +4,95 =
  // 5 × 0,99 — khớp công thức đóng). Revenue T1 = 47.000 ×
  // (100 + 16,99863) = 5.498.935,61.
  approx(fin.totals.reach, 1375141.6695244024, 'diff fin reach');
  approx(fin.totals.newPaid, 865.9132543358772, 'diff fin newPaid');
  // GHI LẠI đợt đổi mốc thu phí đầu kỳ 20/11/2026: Revenue/COGS
  // tính trên tồn TRƯỚC churn -> totals.revenue tăng từ
  // 140.451.139,90 lên 143.263.776,07 (= Σ 47.000 x paidBase; đã
  // kiểm chứng độc lập revenue = 47.000 x (Paid EOM + Paid churn +
  // bridge) từng tháng) và revenueB2b T1 = 100.000 x b2bBase
  // (50 + 0) = 5.000.000 thay cho x B2B EOM 48. Mọi dòng tồn
  // (paidEom/freeEom) KHÔNG đổi.
  approx(fin.totals.revenue, 218221216.2292106, 'diff fin revenue');
  approx(fin.totals.paidEom, 874.2231486234473, 'diff fin paidEom');
  approx(fin.totals.freeEom, 9671.233513164745, 'diff fin freeEom');
  approx(fin.months[0].paidEom, 115.8286437, 'diff fin T1 paidEom');
  approx(fin.months[0].revenueB2b, 5000000, 'diff fin T1 revenueB2b');
});
