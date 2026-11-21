// tests/planning-email-forecast.test.mjs
// KÊNH EMAIL trong forecast Planning (chốt của Zac 18/11/2026):
// - Views của Email = OPENS tính từ TỒN Free đầu tháng, KHÔNG theo
//   qty × views mỗi bài: opens = list_đầu_tháng × open_rate × số
//   lượt gửi (qty, unit 'sends').
// - list_đầu_tháng = opening_free (null -> 0) + tích luỹ
//   (freemium − paid) của MỌI kênh KHÁC tới hết tháng trước; bỏ qua
//   free churn (xấp xỉ đã chốt). Email không tự nuôi list của nó.
// - Chuỗi Email: opens -> clicks (visits) -> Paid; freemium = 0
//   tuyệt đối; Paid Email cộng vào byMonth.paid như New Paid thường.
// - Ngữ nghĩa cột benchmark của Email: view_to_visit = open rate
//   0,30; visit_to_freemium = click/open 0,10; freemium_to_paid =
//   click→paid 0,01 (KHÔNG thêm cột DB).
// Số học chuẩn: opening 0; T1 kênh khác tạo freemium 100, paid 0 ->
// list đầu T2 = 100; T2 gửi 2 -> opens = 100 × 0,30 × 2 = 60;
// visits = 6; paid Email T2 = 0,06.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

const BM = [
  // Kênh tạo Free: qty 1 × output 100, v2v 1, v2f 1, f2p 0
  // -> freemium 100, paid 0 trong tháng có dòng.
  { brand_id: 'b1', channel: 'KOL X', group: 'KOL', output_per_unit: 100, view_to_visit: 1, visit_to_freemium: 1, freemium_to_paid: 0, direct_budget: false },
  { brand_id: 'b1', segment: 'b2c', channel: 'Email Sends', group: 'Email', output_per_unit: null, view_to_visit: 0.30, visit_to_freemium: 0.10, freemium_to_paid: 0.01, direct_budget: false }
];
function kolRow(month) {
  return { id: 'kol-' + month, brand_id: 'b1', segment: 'b2c', month, channel: 'KOL X', group: 'KOL', qty: 1, budget: null };
}
function emailRow(month, qty = 2) {
  return { id: 'email-' + month, brand_id: 'b1', segment: 'b2c', month, channel: 'Email Sends', group: 'Email', unit: 'sends', qty, budget: null };
}
const ROWS_3M = [kolRow('2027-01'), emailRow('2027-01'), emailRow('2027-02'), emailRow('2027-03')];

test('EMAIL (a): opens tính từ tồn Free — tính tay 3 tháng (T1 list 0 -> opens 0; T2 list 100 -> opens 60, visits 6, paid 0,06; T3 list vẫn 100)', () => {
  const f = domain.forecastFunnel(ROWS_3M, BM);
  const byId = Object.fromEntries(f.rows.map((r) => [r.rowId, r.forecast]));
  // Tháng đầu: list = opening_free (không truyền -> 0) -> opens = 0 dù qty gửi = 2.
  approx(byId['email-2027-01'].emailList, 0, 'list T1');
  approx(byId['email-2027-01'].views, 0, 'opens T1 = 0');
  approx(byId['email-2027-01'].paid, 0, 'paid T1 = 0');
  // Tháng 2: list = 100 (freemium T1 của kênh khác, paid 0).
  approx(byId['email-2027-02'].emailList, 100, 'list T2 = 100');
  approx(byId['email-2027-02'].views, 60, 'opens T2 = 100 × 0,30 × 2');
  approx(byId['email-2027-02'].visits, 6, 'visits (clicks) T2 = 60 × 0,10');
  approx(byId['email-2027-02'].paid, 0.06, 'paid T2 = 6 × 0,01');
  // Tháng 3: kênh khác không tạo thêm freemium; Paid Email T2 KHÔNG
  // quay lại sửa list -> list T3 vẫn 100, opens vẫn 60.
  approx(byId['email-2027-03'].emailList, 100, 'list T3 = 100 (Paid Email không trừ list)');
  approx(byId['email-2027-03'].views, 60, 'opens T3 = 60');
});

test('EMAIL (b): freemium của Email = 0 tuyệt đối mọi tháng; tổng freemium chỉ từ kênh khác', () => {
  const f = domain.forecastFunnel(ROWS_3M, BM);
  for (const r of f.rows) {
    if (r.channel === 'Email Sends') assert.equal(r.forecast.freemium, 0, 'freemium Email phải = 0 ở ' + r.month);
  }
  approx(f.totals.freemium, 100, 'tổng freemium = 100 (chỉ KOL X)');
  for (const m of ['2027-02', '2027-03']) approx(f.byMonth[m].freemium, 0, 'freemium byMonth ' + m);
});

test('EMAIL (c): Paid Email cộng vào byMonth.paid + totals.paid; computeOperatingFinancials đếm như New Paid', () => {
  const f = domain.forecastFunnel(ROWS_3M, BM);
  approx(f.byMonth['2027-02'].paid, 0.06, 'byMonth.paid T2 gồm Paid Email');
  approx(f.totals.paid, 0.12, 'totals.paid = 0,06 × 2 tháng');
  const op = domain.computeOperatingFinancials({
    months: ['2027-01', '2027-02'],
    funnelByMonth: f.byMonth,
    budgetByMonth: { '2027-01': 0, '2027-02': 0 },
    inputsByMonth: {
      '2027-01': { paid_churn_rate: 0, free_churn_rate: 0, monthly_cvr: null, paid_price: 1000, cogs_per_free_user: 0, cogs_per_paid_user: 0, fixed_cost: 0 },
      '2027-02': { paid_churn_rate: 0, free_churn_rate: 0, monthly_cvr: null, paid_price: 1000, cogs_per_free_user: 0, cogs_per_paid_user: 0, fixed_cost: 0 }
    },
    openingFree: 0, openingPaid: 0
  });
  approx(op.months[1].newPaid, 0.06, 'New Paid T2 ở bảng vận hành = Paid Email 0,06');
});

test('EMAIL (d): opening_free qua Phase sớm nhất — tháng 1 list = opening (sản phẩm đã có tệp Free)', () => {
  const phases = [{ id: 'ph-1', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0, opening_free: 50 }];
  const rows = ROWS_3M.map((r) => Object.assign({}, r, { phase_id: 'ph-1' }));
  const f = domain.forecastFunnel(rows, BM, { phases });
  const byId = Object.fromEntries(f.rows.map((r) => [r.rowId, r.forecast]));
  approx(byId['email-2027-01'].emailList, 50, 'list T1 = opening_free 50');
  approx(byId['email-2027-01'].views, 30, 'opens T1 = 50 × 0,30 × 2');
  approx(byId['email-2027-02'].emailList, 150, 'list T2 = 50 + 100');
});

test('EMAIL (e): kênh khác KHÔNG đổi số khi có/không có Email (đối chiếu KOL X từng dòng + tổng non-Email)', () => {
  const withEmail = domain.forecastFunnel(ROWS_3M, BM);
  const without = domain.forecastFunnel([kolRow('2027-01')], BM);
  const kolWith = withEmail.rows.find((r) => r.rowId === 'kol-2027-01').forecast;
  const kolWithout = without.rows[0].forecast;
  assert.deepEqual(kolWith, kolWithout, 'forecast của KOL X phải giống hệt khi thêm Email');
  approx(without.totals.views, 100, 'views non-Email');
  approx(withEmail.totals.views - 120, without.totals.views, 'views tổng − opens Email (60×2) = views non-Email');
});

test('EMAIL (f): phase_assumptions ghi đè tỉ lệ Email như kênh khác (open rate riêng theo Phase)', () => {
  const phases = [{ id: 'ph-1', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0, opening_free: 100 }];
  const assumptions = [{ phase_id: 'ph-1', channel: 'Email Sends', view_to_visit: 0.5, visit_to_freemium: null, freemium_to_paid: null, views_per_unit: null }];
  const rows = [emailRow('2027-01')].map((r) => Object.assign({}, r, { phase_id: 'ph-1' }));
  const f = domain.forecastFunnel(rows, BM, { phases, phaseAssumptions: assumptions });
  // open rate hiệu dụng = 0,5 (assumption thắng benchmark 0,30):
  // opens = 100 × 0,5 × 2 = 100; visits = 10; paid = 0,1.
  approx(f.rows[0].forecast.views, 100, 'opens với open rate assumption 0,5');
  approx(f.rows[0].forecast.paid, 0.1, 'paid với assumption');
});

test('EMAIL (g): dữ liệu Lumus thật — neo tính lại 18/11 (764 content, ngân sách 1.238.700.000đ), Email đóng góp opens/paid > 0 từ T2, KOL Nano không đổi', () => {
  const rows = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(rows.reduce((s, r) => s + (r.qty || 0), 0), 764, 'tổng content Lumus = 764');
  assert.equal(domain.planBudget(rows, demo.benchmarks).total, 1238700000, 'tổng ngân sách = 1.238.700.000đ');
  const ctx = { phases: demo.phases, phaseAssumptions: demo.phase_assumptions };
  const f = domain.forecastFunnel(rows, demo.benchmarks, ctx);
  const emails = f.rows.filter((r) => r.channel === 'Email Sends');
  assert.equal(emails.length, 12, '12 dòng Email Sends');
  assert.ok(emails.every((r) => r.forecast && r.forecast.freemium === 0), 'freemium Email = 0 cả 12 tháng');
  approx(emails[0].forecast.views, 0, 'opens T1 = 0 (opening_free null -> list 0)');
  assert.ok(emails[1].forecast.views > 0, 'opens T2 > 0 khi list đã có Free từ T1');
  const emailPaid = emails.reduce((s, r) => s + r.forecast.paid, 0);
  assert.ok(emailPaid > 0, 'Paid Email cả năm > 0');
  // Đợt Website Articles SEO 18/11: freemium cộng thêm 4.744 Free
  // của Articles (Mô hình SEO B) -> 2.716,8311 + 4.744 = 7.460,8311.
  // Đợt Articles 21/11 (CR 2,5% -> 5%): Free Articles = 9.487
  // -> 2.716,8311 + 9.487 = 12.203,8311.
  approx(f.totals.freemium, 12203.831132798625, 'tổng freemium (Email freemium = 0; gồm 9.487 Free Articles)');
  const kolNano = f.rows.filter((r) => r.channel === 'KOL Nano').reduce((s, r) => s + (r.forecast ? r.forecast.views : 0), 0);
  approx(kolNano, 260000, 'views KOL Nano không đổi = 260.000');
});

test('EMAIL (h): benchmark Email trong demo-data mang đúng 3 tỉ lệ + seed SQL có INSERT khớp', async () => {
  const bm = demo.benchmarks.find((b) => b.channel === 'Email Sends' && b.brand_id === 'brand-lumus-ai');
  assert.ok(bm, 'phải có benchmark Email Sends cho Lumus');
  assert.equal(bm.view_to_visit, 0.30, 'open rate ở view_to_visit');
  assert.equal(bm.visit_to_freemium, 0.10, 'click/open ở visit_to_freemium');
  assert.equal(bm.freemium_to_paid, 0.01, 'click→paid ở freemium_to_paid');
  assert.equal(bm.output_per_unit, null, 'output_per_unit null — opens không theo views mỗi bài');
  const { readFileSync } = await import('node:fs');
  const seed = readFileSync(new URL('../supabase/seed/from-demo-data.sql', import.meta.url), 'utf8');
  assert.match(seed, /'Email Sends', 'Email', null, 'VND', null, 0\.3, 0\.1, 0\.01/, 'seed SQL phải có INSERT benchmark Email khớp demo-data');
});
