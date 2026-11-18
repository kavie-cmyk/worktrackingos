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
// Số neo giữ nguyên: 776 content; Paid cả kỳ (kèm ctx phase)
// 92,1879…; CAC "Tất cả" T1 = 31.438.407đ; tổng ngân sách fixture
// 1.598.700.000đ.

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

// Benchmark content có paid_to_b2b để B2B khác 0 (kiểm được cả B2B):
// qty 4 -> views 400, visits 40, freemium 4, paid 0,4, b2b 0,04.
const BM = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: 0.1, direct_budget: false }];

function rowsWith(field, qtyByMonth) {
  return Object.entries(qtyByMonth).map(([month, q], i) => {
    const r = { id: `r-${field}-${month}`, brand_id: 'b1', month, channel: 'KOL X', group: 'KOL', budget: null };
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
  approx(fQty.byMonth['2027-01'].b2b, 0.04, 'T1 b2b');
  approx(fQty.totals.views, 700, 'tổng views 3 tháng');
  approx(fQty.totals.paid, 0.7, 'tổng paid 3 tháng');
  approx(fQty.totals.b2b, 0.07, 'tổng b2b 3 tháng');
  // Ngân sách (planBudget) của 3 cách viết vốn đã giống nhau từ trước;
  // nay forecast khớp cùng một nguồn số lượng với ngân sách.
  for (const rows of [rowsWith('qty', QTY_3M), rowsWith('quantity', QTY_3M), rowsWith('count', QTY_3M)]) {
    assert.equal(domain.planBudget(rows, BM).total, 7000, 'planBudget = (4+2+1) x 1.000');
  }
});

test('PQF (2): có cả qty lẫn quantity -> qty thắng (khớp planQtyOf + planBudget); thiếu qty -> quantity thắng count', () => {
  const both = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 4, quantity: 99, count: 77, budget: null }];
  assert.equal(domain.planQtyOf(both[0]), 4, 'planQtyOf: qty thắng');
  assert.equal(domain.planBudget(both, BM).total, 4000, 'planBudget: qty thắng (4 x 1.000)');
  const f = domain.forecastFunnel(both, BM);
  assert.equal(f.rows[0].qty, 4, 'snapshot qty: qty thắng');
  approx(f.rows[0].forecast.views, 400, 'forecast theo qty = 4 (không phải 99/77)');
  approx(f.rows[0].forecast.paid, 0.4, 'paid theo qty');
  const noQty = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'KOL', quantity: 5, count: 99, budget: null }];
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
  const rows = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'KOL X', group: 'Paid Media', quantity: 4, budget: 999999 }];
  const f = domain.forecastFunnel(rows, bmContent);
  assert.ok(f.rows[0].forecast, 'dòng có quantity phải forecast theo content');
  approx(f.rows[0].forecast.views, 400, 'views = quantity x output');
  assert.equal(domain.planBudget(rows, bmContent).total, 4000, 'planBudget khớp: quantity x đơn giá, bỏ qua field budget');
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
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776, 'neo: 776 content');
  const ctx = { phases: demo.phases.filter((p) => p.brand_id), phaseAssumptions: demo.phase_assumptions };
  const forecast = domain.forecastFunnel(lumus, demo.benchmarks, ctx);
  const forecastNoCtx = domain.forecastFunnel(lumus, demo.benchmarks);
  const budget = domain.planBudget(lumus, demo.benchmarks);
  // Snapshot TRƯỚC sửa (HEAD 9570f06):
  approx(forecast.totals.views, 1460000, 'diff forecast views');
  approx(forecast.totals.visits, 15044.82404318182, 'diff forecast visits');
  approx(forecast.totals.freemium, 2862.9112790681543, 'diff forecast freemium');
  approx(forecast.totals.paid, 92.18790756785299, 'neo: Paid cả kỳ fixture = 92,1879…');
  assert.equal(forecast.totals.b2b, 0, 'diff forecast b2b');
  approx(forecastNoCtx.totals.paid, 86.75808750000002, 'diff forecast (không ctx) paid');
  approx(forecast.byMonth['2027-01'].views, 101000, 'diff T1 views');
  approx(forecast.byMonth['2027-01'].paid, 2.308005, 'diff T1 paid');
  assert.equal(budget.total, 1598700000, 'neo: tổng ngân sách fixture = 1.598.700.000đ');
  assert.equal(budget.totalDirect, 811200000, 'diff budget direct');
  assert.equal(budget.totalUnitPrice, 787500000, 'diff budget unit-price');
  assert.equal(budget.byMonth['2027-01'].amount, 72560000, 'diff budget T1');
  assert.equal(Math.round(budget.byMonth['2027-01'].amount / forecastNoCtx.byMonth['2027-01'].paid), 31438407, 'neo: CAC Tất cả T1 = 31.438.407đ');
  // Hạ nguồn tài chính: cùng đầu vào FULL cố định như bản ghi trước sửa.
  const FULL = { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: 0.01, paid_price: 47000, cogs_per_free_user: 10000, cogs_per_paid_user: 20000, fixed_cost: 200000, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000 };
  const funnelByMonth = {}; const budgetByMonth = {}; const inputsByMonth = {};
  for (const m of forecast.months) {
    funnelByMonth[m] = forecast.byMonth[m];
    budgetByMonth[m] = budget.byMonth[m] ? budget.byMonth[m].amount : 0;
    inputsByMonth[m] = FULL;
  }
  const fin = domain.computeOperatingFinancials({ months: forecast.months, funnelByMonth, budgetByMonth, inputsByMonth, openingFree: 1000, openingPaid: 100, openingB2b: 50 });
  assert.equal(fin.totals.budget, 1598700000, 'diff fin budget');
  approx(fin.totals.reach, 1460000, 'diff fin reach');
  approx(fin.totals.newPaid, 294.7762466522813, 'diff fin newPaid');
  approx(fin.totals.revenue, 123044889.6254129, 'diff fin revenue');
  approx(fin.totals.paidEom, 342.4941574174081, 'diff fin paidEom');
  approx(fin.totals.freeEom, 2439.1459594039598, 'diff fin freeEom');
  approx(fin.months[0].paidEom, 111.18492495, 'diff fin T1 paidEom');
  approx(fin.months[0].revenueB2b, 4800000, 'diff fin T1 revenueB2b');
});
