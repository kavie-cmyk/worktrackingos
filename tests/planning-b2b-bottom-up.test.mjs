// tests/planning-b2b-bottom-up.test.mjs
// MÔ HÌNH B2B BOTTOM-UP — CẬP NHẬT 18/11/2026 (đợt 2): cầu nối
// Paid -> B2B theo Channel (paid_to_b2b) ĐÃ BỎ. Cầu nối nay tính
// theo Phase ở tầng tồn (phases.b2b_bridge_rate x PaidEOM_pre, trừ
// khỏi Paid EOM) — khóa ở planning-b2b-bridge-deduction.test.mjs và
// phase-bridge-rate-0022.test.mjs. Ở tầng kênh, B2B Account chỉ còn
// nguồn TRỰC TIẾP qua cost_per_result.b2b_account (Partnership /
// Event). Lead Gen/Demo: phần B2B chỉ đếm Lead/Demo, accounts từ
// quy đổi (lead_to_account / demo_to_account) = 0.
// 2) Audience trên dòng budget-driven (Paid Media theo Objective;
//    Partnership; Event): audience 'b2c'|'b2b'|'both' + b2b_split_pct.
//    Objective thuần B2C (Awareness/Traffic/Signup/Remarketing) bị
//    khóa lựa chọn B2B ở UI + engine ép phần B2B = 0.
// 3) Cách tính: Lead Gen B2C -> Freemium tại tầng Freemium chảy xuống;
//    Lead Gen/Demo B2B -> 0 account (không quy đổi nữa);
//    Partnership/Event B2C -> Freemium = tiền /
//    cost_per_result.signup, B2B -> Accounts = tiền /
//    cost_per_result.b2b_account. CHỈ áp dòng budget-driven (qty
//    null) thuộc 3 nhóm — không phân loại lại dòng content có qty.
// 4) Seed: file nguồn không có số cho các đầu vào B2B mới -> để null;
//    đầu vào B2B trống thì MỌI số hiện tại giữ nguyên tuyệt đối.
// 5) KPI: bảng thứ 5 "B2B Accounts" + tầng B2B Accounts ở phễu tổng.
// 6) Tài chính B2B: opening_b2b (Phase đầu năm), b2b_churn_rate,
//    arppu_b2b, cogs_per_b2b_account theo Phase; chuỗi tồn B2B riêng;
//    Profit tính trên TỔNG B2C + B2B; ngoại lệ tồn 0 + không account
//    mới -> Revenue B2B / COGS B2B = 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}
function section(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ============================================================ (a) cầu nối
test('PB2B [domain] (a): kênh content KHÔNG còn cầu nối theo Channel — benchmark còn paid_to_b2b dormant 10% vẫn cho b2b tầng kênh = 0, Paid giữ nguyên (bridge tính theo Phase ở tầng tồn)', () => {
  const bm = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: 0.1, direct_budget: false }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 10, budget: null }];
  const f = domain.forecastFunnel(rows, bm);
  const P = f.rows[0].forecast.paid;
  approx(P, 1, 'Paid = 10 x 100 x 0,1 x 0,1 x 0,1 (freemium_to_paid 0,1 = 0,5 x 0,2 gộp)');
  assert.equal(f.rows[0].forecast.b2b, 0, 'b2b tầng kênh = 0 dù paid_to_b2b = 10% (mô hình cũ đã bỏ)');
  assert.equal(f.byMonth['2027-01'].b2b, 0, 'byMonth b2b = 0');
  assert.equal(f.totals.b2b, 0, 'totals b2b = 0');
  const bmNoRate = [{ ...bm[0], paid_to_b2b: null }];
  const f2 = domain.forecastFunnel(rows, bmNoRate);
  approx(f2.rows[0].forecast.paid, P, 'Paid không đổi khi bỏ field dormant');
  assert.equal(f2.rows[0].forecast.b2b, 0, 'b2b vẫn 0');
});

test('PB2B [domain] (a2): Paid Objective thuần B2C và phần B2C của Lead Gen đều KHÔNG sinh B2B ở tầng kênh nữa (bridge chỉ ở tầng tồn theo Phase)', () => {
  const bmTraffic = [{ brand_id: 'b1', channel: 'Meta-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, cost_per_result: { traffic: 20000 } }];
  const rowTraffic = [{ id: 'rt', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Meta-like', group: 'Paid Media', qty: null, budget: 5460000, objective: 'traffic', audience: 'b2c' }];
  const fcT = domain.forecastFunnel(rowTraffic, bmTraffic).rows[0].forecast;
  approx(fcT.paid, 0.675675, 'Traffic Paid như ca neo Meta T1');
  assert.equal(fcT.b2b, 0, 'Traffic: b2b tầng kênh = 0');
  const bmLead = [{ brand_id: 'b1', channel: 'Ads B2B', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const rowLead = [{ id: 'rl', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }];
  const fcL = domain.forecastFunnel(rowLead, bmLead).rows[0].forecast;
  approx(fcL.paid, 1.65, 'Lead Gen Paid phần B2C giữ nguyên 1,65');
  assert.equal(fcL.b2b, 0, 'Lead Gen: b2b tầng kênh = 0 (không Lead->Account, không cầu nối Channel)');
});

test('PB2B [domain] (a3): phase_assumptions còn mang paid_to_b2b dormant + uplift — engine vẫn bỏ qua; EFFECTIVE_RATE_FIELDS không chứa field B2B cũ', () => {
  const phases = [{ id: 'ph-1', brand_id: 'b1', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 10 }];
  const assumptions = [{ phase_id: 'ph-1', channel: 'KOL X', view_to_visit: null, visit_to_freemium: null, freemium_to_paid: null, paid_to_b2b: 0.2, lead_to_account: null, demo_to_account: null, views_per_unit: null }];
  const bm = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: null, direct_budget: false }];
  const mk = (month) => [{ id: 'r-' + month, brand_id: 'b1', segment: 'b2c', month, channel: 'KOL X', group: 'KOL', qty: 10, budget: null, phase_id: 'ph-1' }];
  const ctx = { phases, phaseAssumptions: assumptions };
  const jan = domain.forecastFunnel(mk('2027-01'), bm, ctx).rows[0].forecast;
  approx(jan.paid, 1, 'Paid tháng đầu = 1 (10 x 100 x 0,1 x 0,1 x 0,1)');
  assert.equal(jan.b2b, 0, 'assumption paid_to_b2b 20% bị bỏ qua: b2b = 0');
  const feb = domain.forecastFunnel(mk('2027-02'), bm, ctx).rows[0].forecast;
  assert.equal(feb.b2b, 0, 'tháng 2 (có uplift) b2b vẫn 0');
  const rates = domain.effectiveRatesFor(phases[0], 'KOL X', bm, assumptions, phases);
  assert.ok(!('paid_to_b2b' in rates) && !('lead_to_account' in rates) && !('demo_to_account' in rates), 'effectiveRatesFor không còn phơi 3 field B2B cũ');
});

// ============================================================ (b) split
test('PB2B [domain] (b): CA NEO SPLIT Lead Gen — 10.000.000đ, both, B2B 40%, CPL 100.000, freemium_to_paid 2,75% (= 50% x 5,5% gộp): B2C 60 Freemium -> 1,65 Paid; B2B 40 Leads -> 0 Accounts (bỏ quy đổi lead_to_account)', () => {
  const bm = [{ brand_id: 'b1', channel: 'Google-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Google-like', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.freemium, 60, 'phần B2C 6.000.000 / 100.000 = 60 Freemium (đặt tại tầng Freemium, KHÔNG áp visit_to_freemium ngược)');
  assert.equal(fc.visits, 0, 'không suy ngược lên Visits');
  assert.equal(fc.views, 0, 'không suy ngược lên Views');
  approx(fc.paid, 1.65, 'Paid = 60 x 2,75%');
  assert.equal(fc.b2b, 0, 'phần B2B: 40 Leads vẫn được đếm ở tầng Lead nhưng accounts từ quy đổi lead_to_account = 0 (mô hình mới)');
});

test('PB2B [domain] (b2): Demo split — phần B2C đặt tại Freemium rồi chảy xuống; phần B2B chỉ đếm Demo, 0 Account', () => {
  const bm = [{ brand_id: 'b1', channel: 'LinkedIn-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, demo_to_account: 0.25, cost_per_result: { demo: 200000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'LinkedIn-like', group: 'Paid Media', qty: null, budget: 10000000, objective: 'demo', audience: 'both', b2b_split_pct: 40 }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.freemium, 30, 'B2C 6.000.000 / 200.000 = 30 Freemium');
  approx(fc.paid, 0.825, 'Paid = 30 x 2,75%');
  assert.equal(fc.b2b, 0, 'B2B: 20 Demos được đếm ở tầng Demo nhưng accounts từ quy đổi demo_to_account = 0 (mô hình mới)');
  // Audience b2b thuần (như seed LinkedIn): toàn bộ ngân sách vào chân B2B.
  const fcB = domain.forecastFunnel([{ ...rows[0], id: 'r2', audience: 'b2b', b2b_split_pct: null }], bm).rows[0].forecast;
  approx(fcB.freemium, 0, 'audience b2b: phần B2C = 0');
  assert.equal(fcB.b2b, 0, 'audience b2b: 50 Demos -> 0 Accounts (không quy đổi)');
});

test('PB2B [domain] (b3): Partnership/Event budget-driven — B2C = tiền / cost signup chảy xuống; B2B = tiền / cost per B2B account', () => {
  const bm = [{ brand_id: 'b1', channel: 'Partner X', group: 'Partnership', direct_budget: true, view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.0275, cost_per_result: { signup: 50000, b2b_account: 500000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Partner X', group: 'Partnership', qty: null, budget: 10000000, audience: 'both', b2b_split_pct: 40 }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.freemium, 120, 'B2C 6.000.000 / 50.000 = 120 Freemium');
  approx(fc.paid, 3.3, 'Paid = 120 x 2,75%');
  approx(fc.b2b, 8, 'B2B 4.000.000 / 500.000 = 8 Accounts');
  // Event thuần B2B: chỉ ra Account, phễu B2C = 0.
  const bmEv = [{ ...bm[0], channel: 'Event X', group: 'Event', cost_per_result: { signup: 50000, b2b_account: 250000 } }];
  const fcEv = domain.forecastFunnel([{ id: 'r2', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Event X', group: 'Event', qty: null, budget: 5000000, audience: 'b2b' }], bmEv).rows[0].forecast;
  approx(fcEv.b2b, 20, 'Event B2B: 5.000.000 / 250.000 = 20 Accounts');
  approx(fcEv.freemium, 0, 'Event thuần B2B: Freemium = 0');
  // Thiếu cả 2 đơn giá -> forecast null như cơ chế "chưa có đơn giá".
  const bmNone = [{ ...bm[0], cost_per_result: {} }];
  assert.equal(domain.forecastFunnel(rows, bmNone).rows[0].forecast, null, 'Partnership chưa có đơn giá nào -> forecast null');
  // Dòng CONTENT có qty thuộc nhóm Event KHÔNG bị phân loại lại:
  // vẫn tính theo qty x output như content thường (khóa phạm vi).
  const bmContent = [{ brand_id: 'b1', channel: 'B2B Event', group: 'Event', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, direct_budget: false, cost_per_result: { signup: 1, b2b_account: 1 } }];
  const fcContent = domain.forecastFunnel([{ id: 'r3', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'B2B Event', group: 'Event', qty: 2, budget: null }], bmContent).rows[0].forecast;
  approx(fcContent.views, 200, 'dòng Event có qty vẫn là content: Views = qty x output');
  approx(fcContent.b2b, 0, 'dòng content không sinh B2B kiểu budget-driven (và benchmark này không có paid_to_b2b)');
});

test('PB2B [domain] (b4): Objective thuần B2C bị khóa B2B ở engine — audience b2b/both trên Traffic vẫn chạy 100% B2C', () => {
  const bm = [{ brand_id: 'b1', channel: 'Meta-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.9, cost_per_result: { traffic: 20000, lead_gen: 1 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Meta-like', group: 'Paid Media', qty: null, budget: 2000000, objective: 'traffic', audience: 'both', b2b_split_pct: 90 }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.visits, 100, 'Traffic bị khóa B2C: Visits = toàn bộ 2.000.000 / 20.000, không chia B2B');
  assert.deepEqual(domain.audienceShareFor(rows[0], 'traffic'), { b2c: 1, b2b: 0 }, 'audienceShareFor ép B2C cho Objective thuần B2C');
});

// ============================================================ (c) tài chính B2B
test('PB2B [domain] (c): CA NEO TÀI CHÍNH B2B — opening_b2b 50, New 8, b2b churn 4% -> churn 2, EOM 56, Revenue B2B = arppu_b2b x b2bBase 58 (mốc trước churn 20/11); Profit gồm cả B2B; Paid EOM giữ nguyên vì fixture chỉ truyền tổng b2b (không truyền b2bBridge — tổng B2B không tự suy thành bridge, thay đổi B 18/11)', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 5000, visits: 900, freemium: 300, paid: 10, b2b: 8 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 50000, cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000 } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  const r = out.months[0];
  assert.equal(r.newB2b, 8, 'New B2B Accounts từ funnel');
  approx(r.b2bChurn, 2, 'B2B churn = 50 x 4%');
  approx(r.b2bEom, 56, 'B2B EOM = 50 + 8 - 2');
  approx(r.revenueB2b, 100000 * 58, 'Revenue B2B = arppu_b2b x b2bBase (50 + 8) — mốc trước churn 20/11');
  approx(r.cogsB2b, 30000 * 58, 'COGS B2B = cogs_per_b2b_account x b2bBase 58');
  // LOẠI 3 — tính lại theo công thức tài chính MỚI (tháng đầu, churn x0,5 trên đầu kỳ + dòng vào):
  //   Free churn = (1.000 + 300) x 5% x 0,5 = 32,5; Free EOM = 1.000 + 300 - 10 - 32,5 = 1.257,5
  //   Paid churn = (100 + 10) x 2% x 0,5 = 1,1; Paid EOM = 100 + 10 - 1,1 = 108,9
  //   Mốc thu phí đầu kỳ 20/11: Revenue B2C = 50.000 x paidBase 110 = 5.500.000;
  //   COGS B2C = 10.000 x freeBase 1.300 + 10.000 x paidBase 110 = 14.100.000
  approx(r.paidEom, 108.9, 'Paid EOM = 100 + 10 - 1,1 = 108,9 — fixture không đặt b2b_bridge_rate nên bridge = 0, không trừ (tổng b2b trực tiếp không tự thành bridge)');
  assert.equal(r.b2bBridge, 0, 'không có tỉ lệ Phase -> bridge = 0');
  approx(r.profitAfterCogsMkt, (5500000 + 5800000) - (14100000 + 1740000) - 1000000, 'Profit 1 = (Revenue + Revenue B2B) - (COGS + COGS B2B) - Budget');
  approx(r.profitAfterCogsFixedMkt, (5500000 + 5800000) - (14100000 + 1740000) - 1000000 - 200000, 'Profit 2 trừ thêm fixed cost');
  assert.equal(out.totals.b2bEom, 56, 'Tổng B2B EOM = giá trị tháng cuối (dòng tồn)');
  approx(out.totals.newB2b, 8, 'Tổng New B2B Accounts cộng dồn (dòng flow)');
  assert.deepEqual(out.missingB2b, { opening_b2b: false, b2b_churn_rate: false, arppu_b2b: false, cogs_per_b2b_account: false });
});

test('PB2B [domain] (c2): ngoại lệ tồn B2B = 0 — chưa nhập bất kỳ đầu vào B2B nào thì Revenue B2B / COGS B2B = 0 và Profit KHÔNG hiện "—" oan; thiếu arppu_b2b KHI CÓ account thì Revenue B2B vẫn null nhưng Profit vẫn là số (Revenue B2B tạm tính 0)', () => {
  const base = {
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 0, paid: 10, b2b: 0 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 50000, cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000 } },
    openingFree: 1000, openingPaid: 100
  };
  const out = domain.computeOperatingFinancials(base);
  const r = out.months[0];
  assert.equal(r.b2bEom, 0); assert.equal(r.revenueB2b, 0); assert.equal(r.cogsB2b, 0);
  // LOẠI 3 — tính lại theo công thức MỚI + mốc thu phí đầu kỳ 20/11: Free churn = (1.000 + 0) x 5% x 0,5 = 25 -> Free EOM 965;
  // Paid churn = (100 + 10) x 2% x 0,5 = 1,1 -> Paid EOM 108,9; Revenue = 50.000 x paidBase 110 = 5.500.000;
  // COGS = 10.000 x freeBase 1.000 + 10.000 x paidBase 110 = 11.100.000; Profit 2 = 5.500.000 - 11.100.000 - 1.000.000 - 200.000.
  approx(r.profitAfterCogsFixedMkt, -6800000, 'Profit bằng đúng ca B2C thuần (công thức MỚI, mốc trước churn) khi không có B2B');
  assert.deepEqual(out.missingB2b, { opening_b2b: false, b2b_churn_rate: false, arppu_b2b: false, cogs_per_b2b_account: false }, 'không hoạt động B2B thì không báo thiếu đầu vào B2B');
  // Có account mới + opening_b2b nhưng thiếu arppu_b2b -> Revenue B2B null, missingB2b.arppu_b2b = true; Profit vẫn là số (Revenue B2B tạm tính 0, Zac chốt 18/11).
  const out2 = domain.computeOperatingFinancials({
    ...base,
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 0, paid: 10, b2b: 8 } },
    inputsByMonth: { '2027-01': { ...base.inputsByMonth['2027-01'], b2b_churn_rate: 0.04, cogs_per_b2b_account: 30000 } },
    openingB2b: 50
  });
  assert.equal(out2.months[0].revenueB2b, null, 'có tồn B2B mà thiếu arppu_b2b -> Revenue B2B null');
  // Revenue B2C 5.500.000 − COGS B2C 11.100.000 − COGS B2B 1.740.000 (30.000 x b2bBase 58) − Budget 1.000.000 (Revenue B2B tính 0)
  approx(out2.months[0].profitAfterCogsMkt, 5500000 - 11100000 - 1740000 - 1000000, 'Profit vẫn là số khi Revenue B2B null (tạm tính 0) = −8.340.000');
  approx(out2.months[0].profitAfterCogsFixedMkt, -8340000 - 200000, 'Profit2 = Profit1 − fixed_cost');
  assert.equal(out2.missingB2b.arppu_b2b, true);
  approx(out2.months[0].cogsB2b, 30000 * 58, 'COGS B2B vẫn tính được (theo b2bBase)');
  // Có account mới nhưng thiếu opening_b2b -> chuỗi B2B đứt (null), missingB2b.opening_b2b = true.
  const out3 = domain.computeOperatingFinancials({
    ...base,
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 0, paid: 10, b2b: 8 } },
    inputsByMonth: { '2027-01': { ...base.inputsByMonth['2027-01'], b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000 } }
  });
  assert.equal(out3.months[0].b2bEom, null);
  assert.equal(out3.missingB2b.opening_b2b, true);
});

// ============================================================ (d) hồi quy + seed
test('PB2B [domain+demo] (d): HỒI QUY — đầu vào B2B trống thì mọi số neo giữ nguyên tuyệt đối', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  // 764 content Lumus (tổng qty các dòng có số lượng).
  assert.equal(lumus.filter((r) => r.qty !== null && r.qty !== undefined).reduce((s, r) => s + r.qty, 0), 764, 'tổng content Lumus = 764');
  // Tổng ngân sách năm khi lọc Tất cả.
  assert.equal(domain.planBudget(lumus, demo.benchmarks).total, 1238700000, 'tổng ngân sách năm = 1.238.700.000đ');
  // Meta T1 Paid + Paid Tất cả T1 + CAC Tất cả T1.
  const metaT1 = domain.forecastFunnel(lumus.filter((r) => r.channel === 'Meta Ads' && r.month === '2027-01'), demo.benchmarks);
  approx(metaT1.totals.paid, 1.08108, 'Meta T1 Paid = 1,08108');
  const allT1 = domain.forecastFunnel(lumus.filter((r) => r.month === '2027-01'), demo.benchmarks);
  approx(allT1.totals.paid, 1.99863, 'Paid Tất cả T1 = 1,99863');
  const budgetT1 = domain.planBudget(lumus, demo.benchmarks).byMonth['2027-01'].amount;
  assert.equal(Math.round(budgetT1 / allT1.totals.paid), 21294587, 'CAC Tất cả T1 = 21.294.587đ');
  // B2B toàn năm = 0 (mọi đầu vào B2B đều trống) và Google/LinkedIn vẫn forecast null.
  const year = domain.forecastFunnel(lumus, demo.benchmarks);
  assert.equal(year.totals.b2b, 0, 'chưa có tỉ lệ/đơn giá B2B -> 0 B2B Account toàn năm');
  for (const ch of ['Google Search B2B', 'LinkedIn Ads B2B']) {
    assert.ok(domain.forecastFunnel(lumus.filter((r) => r.channel === ch), demo.benchmarks).rows.every((r) => r.forecast === null), ch + ': chưa có CPL/tỉ lệ -> forecast null như hiện tại');
  }
  // Ca tài chính: opening Free 1000 / Paid 100, Free user (Freemium) 300, New Paid 10, free churn 5%, paid churn 2% (số EOM tính lại theo công thức MỚI — xem comment LOẠI 3 dưới).
  const fin = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 5000, visits: 900, freemium: 300, paid: 10 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 50000, cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000 } },
    openingFree: 1000, openingPaid: 100
  });
  // LOẠI 3 — tính lại theo công thức MỚI: Free churn = (1.000 + 300) x 5% x 0,5 = 32,5 ->
  // Free EOM = 1.000 + 300 - 10 - 32,5 = 1.257,5; Paid churn = (100 + 10) x 2% x 0,5 = 1,1 -> Paid EOM = 108,9.
  approx(fin.months[0].freeEom, 1257.5, 'Free EOM công thức MỚI = 1257,5');
  approx(fin.months[0].paidEom, 108.9, 'Paid EOM công thức MỚI = 108,9');
  assert.deepEqual(fin.missing, { opening: false, paid_churn_rate: false, free_churn_rate: false, paid_price: false, cogs_per_free_user: false, cogs_per_paid_user: false, fixed_cost: false }, 'hợp đồng missing B2C theo key MỚI (paid_price + cogs tách Free/Paid)');
});

test('PB2B [demo] seed: audience đúng đặc tả + đầu vào B2B mới để trống (null) — KHÔNG bịa số', () => {
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  for (const r of lumus.filter((x) => x.channel === 'Meta Ads' || x.channel === 'TikTok Ads')) {
    assert.equal(r.audience, 'b2c', r.id + ': dòng Objective Meta/TikTok = b2c');
  }
  for (const r of lumus.filter((x) => x.channel === 'Google Search B2B')) assert.equal(r.audience, 'b2b', r.id + ': Google lead_gen = b2b');
  for (const r of lumus.filter((x) => x.channel === 'LinkedIn Ads B2B')) assert.equal(r.audience, 'b2b', r.id + ': LinkedIn demo = b2b');
  for (const b of demo.benchmarks) {
    assert.ok(b.paid_to_b2b === null || b.paid_to_b2b === undefined, 'benchmark ' + b.channel + ': paid_to_b2b phải trống');
  }
  for (const b of demo.benchmarks.filter((x) => x.group === 'Paid Media')) {
    assert.ok(b.lead_to_account === null || b.lead_to_account === undefined, 'benchmark ' + b.channel + ': lead_to_account phải trống');
    assert.ok(b.demo_to_account === null || b.demo_to_account === undefined, 'benchmark ' + b.channel + ': demo_to_account phải trống');
    const cpr = b.cost_per_result || {};
    assert.ok(cpr.b2b_account === null || cpr.b2b_account === undefined, 'benchmark ' + b.channel + ': cost per B2B account phải trống');
  }
  for (const a of demo.phase_assumptions) {
    assert.ok(a.paid_to_b2b === null || a.paid_to_b2b === undefined, 'phase_assumptions: paid_to_b2b trống');
    assert.ok(a.lead_to_account === null || a.lead_to_account === undefined, 'phase_assumptions: lead_to_account trống');
    assert.ok(a.demo_to_account === null || a.demo_to_account === undefined, 'phase_assumptions: demo_to_account trống');
  }
  for (const p of demo.phases) {
    for (const f of ['b2b_churn_rate', 'arppu_b2b', 'cogs_per_b2b_account', 'opening_b2b']) {
      assert.ok(p[f] === undefined || p[f] === null, `phase ${p.id} không được seed sẵn ${f}`);
    }
  }
  // Dòng content có qty (kể cả B2B Event) KHÔNG mang audience — không phân loại lại.
  for (const r of demo.plan_rows.filter((x) => x.qty !== null && x.qty !== undefined)) {
    assert.ok(r.audience === undefined || r.audience === null, 'dòng content ' + r.id + ' không được gắn audience');
  }
});

// ============================================================ app harness
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

function makeHarness(rows, phases, benchmarks, assumptions, brands) {
  const helpers = section('// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section('// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {}, planningYear: 2027, planningChannel: null, planningChannelGroup: null, planningAddOpen: true, planningAddBrand: null };
  const state = { toasts: [], updates: [], creates: [], renders: 0 };
  const Store = {
    mode: 'demo',
    list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'benchmarks' ? (benchmarks || []) : coll === 'phase_assumptions' ? (assumptions || []) : coll === 'brands' ? (brands || []) : []),
    get: (coll, id) => (coll === 'brands' ? (brands || []).find((b) => String(b.id) === String(id)) || null : null),
  };
  const poolOf = (coll) => coll === 'plan_rows' ? rows : coll === 'phases' ? (phases || []) : coll === 'phase_assumptions' ? (assumptions || []) : coll === 'benchmarks' ? (benchmarks || []) : [];
  const sUpdate = (coll, id, patch) => {
    const item = poolOf(coll).find((r) => r.id === id);
    if (!item) return { ok: false, error: 'Không tìm thấy dòng.' };
    Object.assign(item, patch);
    state.updates.push({ coll, id, patch });
    return { ok: true, item };
  };
  const sCreate = (coll, obj) => {
    const arr = poolOf(coll);
    const item = { id: coll + '-new-' + (arr.length + 1), ...obj };
    arr.push(item);
    state.creates.push({ coll, item });
    return { ok: true, item };
  };
  const saveResult = (result, onOk, onErr) => {
    if (result && result.ok) { if (onOk) onOk(result); }
    else if (onErr) onErr((result && result.error) || 'Thao tác thất bại.');
  };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock +
    '\nreturn { UI: UI, planningKpiData: planningKpiData, planningKpiTablesHtml: planningKpiTablesHtml, planningOperatingData: planningOperatingData, planningOperatingTableHtml: planningOperatingTableHtml, planningAudienceControlsHtml: planningAudienceControlsHtml, savePlanningRowAudience: savePlanningRowAudience, savePlanningRowB2bSplit: savePlanningRowB2bSplit, savePlanningDrivenBudget: savePlanningDrivenBudget, savePhaseOperatingRate: savePhaseOperatingRate, savePhaseOperatingMoney: savePhaseOperatingMoney, savePhaseOpening: savePhaseOpening, savePhaseRate: savePhaseRate, savePhaseViews: savePhaseViews, planningPhaseBlockHtml: planningPhaseBlockHtml, phasePaidObjectiveBudgets: phasePaidObjectiveBudgets, phaseBudgetDrivenBreakdowns: phaseBudgetDrivenBreakdowns, savePlanningAddRow: savePlanningAddRow, planRowIsBudgetDriven: planRowIsBudgetDriven, planRowEffectiveAudience: planRowEffectiveAudience };');
  const h = factory(Store, domain, UI, cfValStub,
    () => true,
    (m) => state.toasts.push(m),
    () => { state.renders++; },
    sUpdate, sCreate, saveResult,
    escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<div class="table-wrap"><table data-table-key="' + key + '">' + inner + '</table></div>',
    (m) => 'Tháng ' + Number(String(m).slice(5, 7)) + '/' + String(m).slice(0, 4),
    () => '<div data-viz-stub="funnel"></div>');
  return { h, state, Store, UI };
}

const B2B_BENCH = [
  { id: 'bm-kol', brand_id: 'b1', segment: null, channel: 'KOL X', group: 'KOL', unit_price: 1000000, output_per_unit: 200, view_to_visit: 1, visit_to_freemium: 1, freemium_to_paid: 0.05, paid_to_b2b: 0.1, direct_budget: false },
  { id: 'bm-lead', brand_id: 'b1', segment: 'b2b', channel: 'Ads B2B', group: 'Paid Media', unit_price: null, output_per_unit: null, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.2, paid_to_b2b: null, cost_per_result: { lead_gen: 100000 }, direct_budget: true },
];
const B2B_PHASES = [{ id: 'ph-1', brand_id: 'b1', name: 'Phase 1', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0 }];
function b2bRows() {
  return [
    { id: 'r-kol', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 1, budget: null, phase_id: 'ph-1' },
    { id: 'r-lead', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40, phase_id: 'ph-1' },
  ];
}

test('PB2B [app unit]: planningKpiData + bảng KPI thứ 5 "B2B Accounts" — tầng kênh CHỈ còn account trực tiếp (Partnership/Event); KOL + Lead Gen = 0 theo mô hình mới, có hàng Tất cả, thu gọn như các bảng kia', () => {
  const rows = b2bRows();
  const { h } = makeHarness(rows, B2B_PHASES, B2B_BENCH, []);
  const data = h.planningKpiData(rows, B2B_BENCH, ['2027-01']);
  const kol = data.channels.find((c) => c.channel === 'KOL X');
  const lead = data.channels.find((c) => c.channel === 'Ads B2B');
  assert.equal(kol.months['2027-01'].b2b, 0, 'KOL X: không còn cầu nối theo Channel — b2b tầng kênh = 0 (bridge theo Phase nằm ở bảng vận hành)');
  assert.equal(lead.months['2027-01'].b2b, 0, 'Ads B2B: Lead Gen không quy đổi ra account — b2b tầng kênh = 0');
  assert.equal(data.blended.months['2027-01'].b2b, 0, 'Tất cả tháng = 0');
  assert.equal(data.blended.totals.b2b, 0, 'Tất cả cả kỳ = 0');
  const html = h.planningKpiTablesHtml(rows, B2B_BENCH, ['2027-01']);
  assert.ok(html.includes('data-planning-kpi-section="b2b"'), 'phải có section KPI b2b');
  assert.ok(html.includes('KPI chi tiết theo tháng — B2B Accounts (Forecast)'), 'tiêu đề bảng thứ 5');
  assert.ok(html.includes('data-planning-kpi-row="b2b" data-channel="Tất cả"'), 'bảng B2B Accounts phải có hàng Tất cả');
  const cell = /<td data-planning-kpi-cell="b2b" data-channel="Ads B2B" data-month="2027-01">([^<]*)<\/td>/.exec(html);
  assert.ok(cell && cell[1] === '0', 'ô B2B của Ads B2B tháng 1 = 0, got: ' + (cell && cell[1]));
});

test('PB2B [app unit]: lưu Audience + % B2B — ghi đúng field lên plan_rows; Objective thuần B2C bị chặn ở handler; % ngoài 0-100 bị chặn', () => {
  const rows = b2bRows().concat([
    { id: 'r-traffic', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 2000000, objective: 'traffic', audience: 'b2c', phase_id: 'ph-1' },
  ]);
  const { h, state } = makeHarness(rows, B2B_PHASES, B2B_BENCH, []);
  h.savePlanningRowAudience('Ads B2B', 'Paid Media', '2027-01', 'lead_gen', 'b2b');
  assert.equal(rows[1].audience, 'b2b', 'audience lead_gen được ghi lên dòng');
  h.savePlanningRowAudience('Ads B2B', 'Paid Media', '2027-01', 'lead_gen', 'both');
  assert.equal(rows[1].audience, 'both');
  h.savePlanningRowB2bSplit('Ads B2B', 'Paid Media', '2027-01', 'lead_gen', '40');
  assert.equal(rows[1].b2b_split_pct, 40, '% B2B được ghi dạng %');
  const before = state.updates.length;
  h.savePlanningRowB2bSplit('Ads B2B', 'Paid Media', '2027-01', 'lead_gen', '101');
  assert.equal(state.updates.length, before, '% B2B = 101 bị chặn, không ghi');
  assert.equal(rows[1].b2b_split_pct, 40);
  // Objective thuần B2C (traffic): chọn B2B bị chặn ở handler, dữ liệu không đổi.
  h.savePlanningRowAudience('Ads B2B', 'Paid Media', '2027-01', 'traffic', 'b2b');
  assert.equal(rows[2].audience, 'b2c', 'traffic là Objective thuần B2C — không đổi được sang B2B');
  assert.ok(state.toasts.some((t) => t.includes('thuần B2C')), 'phải có toast giải thích khóa B2C');
  // Sau khi lưu audience both + 40%: phần B2B vẫn đếm Lead (forecast
  // chạy được) nhưng KPI B2B tầng kênh = 0 vì không còn quy đổi.
  const data = h.planningKpiData(rows, B2B_BENCH, ['2027-01']);
  assert.equal(data.channels.find((c) => c.channel === 'Ads B2B').months['2027-01'].b2b, 0, 'sau khi lưu, KPI B2B = 0 (Lead Gen không quy đổi ra account)');
});

test('PB2B [app static+unit]: control Audience — Objective thuần B2C khóa 2 lựa chọn B2B kèm ghi chú "chỉ chạy B2C"; Cả hai hiện ô % B2B; dispatch nối đúng 3 handler mới', () => {
  const { h } = makeHarness([], [], [], []);
  const locked = h.planningAudienceControlsHtml({ channel: 'Meta Ads', group: 'Paid Media', month: '2027-01', objective: 'traffic', audience: 'b2c', splitPct: null, lockedPureB2c: true, disAttr: '' });
  assert.ok(locked.includes('data-planning-audience-locked="1"'), 'phải hiện ghi chú khóa');
  assert.ok(locked.includes('chỉ chạy B2C'), 'ghi chú phải nói rõ chỉ chạy B2C');
  assert.ok(locked.includes('<option value="b2b" disabled>'), 'lựa chọn B2B bị disabled');
  assert.ok(locked.includes('<option value="both" disabled>'), 'lựa chọn Cả hai bị disabled');
  const both = h.planningAudienceControlsHtml({ channel: 'Ads B2B', group: 'Paid Media', month: '2027-01', objective: 'lead_gen', audience: 'both', splitPct: 40, lockedPureB2c: false, disAttr: '' });
  assert.ok(both.includes('data-action-change="planning-row-audience"'), 'select audience nối đúng action');
  assert.ok(both.includes('data-action-change="planning-row-b2b-split"'), 'Cả hai phải hiện ô % B2B');
  assert.ok(both.includes('value="40"'), 'ô % B2B hiện đúng 40');
  assert.match(src, /if \(ctxKind === 'planning-row-audience'\) \{ savePlanningRowAudience\(/);
  assert.match(src, /if \(ctxKind === 'planning-row-b2b-split'\) \{ savePlanningRowB2bSplit\(/);
  assert.match(src, /if \(ctxKind === 'planning-driven-budget'\) \{ savePlanningDrivenBudget\(/);
  const detail = section('function viewPlanning()', '// ---------- Planning Theo phase');
  assert.ok(detail.includes('planningAudienceControlsHtml({ channel: selChannel'), 'bảng chi tiết Theo tháng phải render control Audience');
  assert.ok(detail.includes('data-planning-audience-hint="1"'), 'bảng chi tiết phải có chú thích Audience/B2B');
});

test('PB2B [app unit]: Partnership/Event — lưu ngân sách trực tiếp theo tháng + tạo dòng tháng mới budget-driven; "+ Thêm dòng" ở nhóm Partnership/Event mặc định budget-driven + audience b2c', () => {
  const rows = [
    { id: 'r-pe', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Partner X', group: 'Partnership', qty: null, budget: 5000000, audience: 'b2c', phase_id: 'ph-1' },
  ];
  const brands = [{ id: 'b1', name: 'Brand 1' }];
  const { h, state } = makeHarness(rows, B2B_PHASES, [], [], brands);
  h.savePlanningDrivenBudget('Partner X', 'Partnership', '2027-01', '7000000');
  assert.equal(rows[0].budget, 7000000, 'ngân sách Partnership sửa trực tiếp theo tháng');
  h.savePlanningDrivenBudget('Partner X', 'Partnership', '2027-02', '3000000');
  const created = rows.find((r) => r.month === '2027-02');
  assert.ok(created, 'tháng chưa có dòng -> tạo dòng mới');
  assert.equal(created.budget, 3000000);
  assert.equal(created.qty, null, 'dòng tạo mới vẫn budget-driven (qty null)');
  assert.equal(created.audience, 'b2c', 'dòng tạo mới mang audience của dòng mẫu');
  // "+ Thêm dòng" nhóm Event -> qty null + budget 0 + audience 'b2c'.
  h.savePlanningAddRow({ brandId: 'b1', channelExisting: '', channelNew: 'Event Y', groupExisting: '', groupNew: 'Event', segment: 'b2c', unitPriceRaw: '', year: 2027 });
  const added = state.creates.filter((c) => c.coll === 'plan_rows').map((c) => c.item).find((it) => it.channel === 'Event Y');
  assert.ok(added, 'phải tạo dòng Event Y');
  assert.equal(added.qty, null, 'dòng Event mới mặc định budget-driven (qty null)');
  assert.equal(added.budget, 0);
  assert.equal(added.audience, 'b2c', 'dòng Event mới có audience mặc định b2c');
  // Nhóm thường (KOL) giữ nguyên qty = 0 như trước.
  h.savePlanningAddRow({ brandId: 'b1', channelExisting: '', channelNew: 'KOL Y', groupExisting: '', groupNew: 'KOL', segment: 'b2c', unitPriceRaw: '', year: 2027 });
  const addedKol = state.creates.filter((c) => c.coll === 'plan_rows').map((c) => c.item).find((it) => it.channel === 'KOL Y');
  assert.equal(addedKol.qty, 0, 'dòng nhóm thường vẫn qty = 0');
  assert.ok(addedKol.audience === undefined, 'dòng nhóm thường không gắn audience');
});

test('PB2B [app unit]: Theo phase — 3 tỉ lệ B2B theo Channel KHÔNG còn sửa được (savePhaseRate từ chối, không tạo phase_assumptions); cầu nối thay bằng ô b2b_bridge_rate ở khối vận hành Phase; khối tài chính B2B lưu qua đúng whitelist; hiển thị chỉ đọc audience + ngân sách B2C/B2B của Objective', () => {
  const rows = b2bRows();
  const phases = JSON.parse(JSON.stringify(B2B_PHASES));
  const assumptions = [];
  const { h, UI } = makeHarness(rows, phases, B2B_BENCH, assumptions);
  UI.planningOpeningPhaseIds = { 'ph-1': true }; // Phase đầu năm của Brand — nơi hiện các ô opening
  for (const f of ['paid_to_b2b', 'lead_to_account', 'demo_to_account']) {
    h.savePhaseRate('ph-1', 'KOL X', f, '10');
    assert.ok(!assumptions.find((a) => a.channel === 'KOL X'), 'savePhaseRate ' + f + ' không được tạo phase_assumptions (field đã bỏ khỏi PHASE_RATE_FIELDS)');
  }
  // Tỉ lệ phễu còn lại vẫn lưu được qua cùng đường:
  h.savePhaseRate('ph-1', 'KOL X', 'freemium_to_paid', '10');
  const asm = assumptions.find((a) => a.channel === 'KOL X');
  assert.ok(asm && asm.freemium_to_paid === 0.1, 'freemium_to_paid vẫn lưu qua phase_assumptions như cũ');
  // Tài chính B2B theo Phase: rate dạng % -> phân số; money >= 0; opening_b2b ở Phase đầu.
  h.savePhaseOperatingRate('ph-1', 'b2b_churn_rate', '4');
  assert.equal(phases[0].b2b_churn_rate, 0.04, 'b2b_churn_rate nhập 4% lưu 0,04');
  h.savePhaseOperatingMoney('ph-1', 'arppu_b2b', '100000');
  assert.equal(phases[0].arppu_b2b, 100000);
  h.savePhaseOperatingMoney('ph-1', 'cogs_per_b2b_account', '30000');
  assert.equal(phases[0].cogs_per_b2b_account, 30000);
  h.savePhaseOpening('ph-1', 'opening_b2b', '50');
  assert.equal(phases[0].opening_b2b, 50, 'opening_b2b lưu trên Phase đầu tiên như opening_free/opening_paid');
  // Hiển thị chỉ đọc ở Theo phase: Objective kèm audience + chia ngân sách.
  const budgets = h.phasePaidObjectiveBudgets(rows.filter((r) => r.channel === 'Ads B2B'));
  const lead = budgets.find((o) => o.objective === 'lead_gen');
  assert.equal(lead.audience, 'both');
  approx(lead.b2cBudget, 6000000, 'Theo phase chỉ đọc: phần B2C của Lead Gen = 6.000.000');
  approx(lead.b2bBudget, 4000000, 'Theo phase chỉ đọc: phần B2B của Lead Gen = 4.000.000');
  const block = h.planningPhaseBlockHtml(phases[0], rows, B2B_BENCH, true, '');
  assert.ok(block.includes('data-planning-phase-objective-audience="1"'), 'khối Phase phải hiện audience của Objective (chỉ đọc)');
  assert.ok(!block.includes('Paid→B2B (%)'), 'bảng tỉ lệ Channel của Phase KHÔNG còn cột Paid→B2B');
  assert.ok(!block.includes('Lead→Account (%)'), 'bảng tỉ lệ Channel của Phase KHÔNG còn cột Lead→Account');
  assert.ok(!block.includes('Demo→Account (%)'), 'bảng tỉ lệ Channel của Phase KHÔNG còn cột Demo→Account');
  assert.ok(block.includes('data-field="b2b_bridge_rate"'), 'khối vận hành Phase phải có ô Tỉ lệ Paid → B2B (b2b_bridge_rate) thay cho 3 cột cũ');
  assert.ok(block.includes('Forecast B2B Accounts'), 'bảng Channel Phase phải có cột Forecast B2B Accounts');
  assert.ok(block.includes('data-field="b2b_churn_rate"'), 'khối Phase phải có ô B2B churn rate');
  assert.ok(block.includes('data-field="opening_b2b"'), 'Phase đầu phải có ô opening_b2b');
  // Views mỗi bài (đổi ngữ nghĩa 17/11/2026): cột theo nhãn mới; KOL X
  // hiện giá trị MỖI BÀI hiệu dụng của Benchmark (output 200) kèm nhãn
  // Benchmark — KHÔNG phải tổng views cả Phase; Ads B2B (Paid, không
  // dòng qty) -> ô phase-views disabled hiện "—".
  assert.ok(block.includes('<th>Views mỗi bài (đầu phễu)</th>'), 'cột Views phải theo nhãn mới');
  const kolViews = /data-action-change="phase-views" data-phase-id="ph-1" data-channel="KOL X"[^>]*value="200"/.test(block)
    || /value="200"[^>]*data-action-change="phase-views" data-phase-id="ph-1" data-channel="KOL X"/.test(block);
  assert.ok(kolViews, 'ô Views mỗi bài của KOL X phải hiện 200 (Benchmark output mỗi bài)');
  const paidViews = block.match(/<input[^>]*data-action-change="phase-views"[^>]*data-channel="Ads B2B"[^>]*>/);
  assert.ok(paidViews && /disabled/.test(paidViews[0]) && /placeholder="—"/.test(paidViews[0]), 'ô Views mỗi bài của Paid (không qty) phải disabled và hiện —');
});

test('PB2B [app unit]: savePhaseViews — lưu views_per_unit vào phase_assumptions + toast ngữ nghĩa mỗi bài; xoá trắng quay về Benchmark', () => {
  const rows = b2bRows();
  const phases = JSON.parse(JSON.stringify(B2B_PHASES));
  const assumptions = [];
  const { h, state } = makeHarness(rows, phases, B2B_BENCH, assumptions);
  h.savePhaseViews('ph-1', 'KOL X', '5000');
  const asm = assumptions.find((a) => a.channel === 'KOL X');
  assert.ok(asm, 'savePhaseViews phải tạo phase_assumptions');
  assert.equal(asm.views_per_unit, 5000, 'nhập 5000 lưu views_per_unit = 5000');
  assert.ok(state.toasts.some((t) => t.includes('Views mỗi bài 5.000') && t.includes('Forecast tháng = Số lượng × Views mỗi bài')), 'toast lưu phải nêu rõ ngữ nghĩa mỗi bài, got: ' + state.toasts.join(' | '));
  h.savePhaseViews('ph-1', 'KOL X', '');
  assert.equal(asm.views_per_unit, null, 'xoá trắng -> views_per_unit = null');
  assert.ok(state.toasts.some((t) => t.includes('quay về Views mỗi bài của Benchmark')), 'toast xoá phải nói quay về Views mỗi bài của Benchmark');
});

test('PB2B [app unit]: bảng tài chính Theo tháng có đủ hàng B2B và tính đúng qua đường app (New B2B = 0 khi không bridge Phase / không quy đổi) — New B2B Accounts / B2B churn / B2B EOM / Revenue B2B / COGS B2B', () => {
  const rows = b2bRows();
  const phases = [{ ...B2B_PHASES[0], paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 50000, cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000, opening_free: 1000, opening_paid: 100, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000, opening_b2b: 50 }];
  const { h, UI } = makeHarness(rows, phases, B2B_BENCH, []);
  UI.planningOpeningPhaseIds = { 'ph-1': true };
  const data = h.planningOperatingData(rows, B2B_BENCH, ['2027-01']);
  const r = data.months[0];
  // Mô hình mới: fixture Phase này KHÔNG đặt b2b_bridge_rate -> bridge
  // = 0; Lead Gen không quy đổi -> New B2B tháng = 0.
  assert.equal(r.newB2b, 0, 'New B2B Accounts = 0 (không bridge Phase, không quy đổi Lead)');
  approx(r.b2bChurn, 50 * 0.04, 'B2B churn = opening_b2b x b2b_churn_rate');
  approx(r.b2bEom, 50 + 0 - 2, 'B2B EOM = 48');
  approx(r.revenueB2b, 100000 * 50, 'Revenue B2B = arppu_b2b x b2bBase (50 + 0) — mốc trước churn 20/11');
  approx(r.cogsB2b, 30000 * 50, 'COGS B2B = cogs_per_b2b_account x b2bBase 50');
  // Paid cohort = 10 + 1,65 = 11,65; Paid churn = (100 + 11,65) x 2% x 0,5
  // = 1,1165; bridge = 0 -> Paid EOM = 100 + 11,65 - 1,1165 = 110,5335.
  // Revenue/COGS Paid theo paidBase = 100 + 11,65 = 111,65.
  assert.equal(r.b2bBridge, 0, 'Phase không đặt b2b_bridge_rate -> bridge = 0');
  approx(r.paidEom, 110.5335, 'Paid EOM = 110,5335 (không trừ bridge)');
  approx(r.revenue, 50000 * 111.65, 'Revenue Paid = 5.582.500 (theo paidBase)');
  approx(r.cogsPaid, 10000 * 111.65, 'COGS Paid = 1.116.500 (theo paidBase)');
  const html = h.planningOperatingTableHtml(rows, B2B_BENCH, ['2027-01']);
  for (const key of ['newB2b', 'b2bChurn', 'b2bEom', 'revenueB2b', 'cogsB2b']) {
    assert.ok(html.includes('data-planning-operating-row="' + key + '"'), 'bảng tài chính thiếu hàng ' + key);
  }
  const cell = (key) => {
    const m = new RegExp('<td data-planning-operating-cell="' + key + '" data-month="2027-01">([^<]*)</td>').exec(html);
    return m ? m[1] : null;
  };
  assert.equal(cell('b2bEom'), '48');
  assert.equal(cell('revenueB2b'), '5.000.000 VND');
});

test('PB2B [static]: phễu tổng thêm tầng B2B Accounts; seed demo giữ nguyên hành vi — mọi dòng Paid seed có audience, SAVA Campaign Budget không thuộc phạm vi audience', () => {
  assert.ok(src.includes("b2bTail"), 'planningFunnelSteps phải có tầng B2B Accounts');
  assert.ok(src.includes("pushStep('B2B Accounts', totals.b2b)"), 'normalizeFunnelSteps phải cộng tầng B2B Accounts từ totals.b2b');
  // Phạm vi audience theo group + loại dòng thực tế trong demo:
  // - Paid Media (Meta/TikTok/Google/LinkedIn của Lumus): budget-driven -> CÓ audience.
  // - Paid Media SAVA (Meta Ads Camp 01, không Objective/không benchmark): budget-driven về mặt dòng
  //   nhưng không Objective nên UI audience theo Objective không áp; engine giữ forecast null như cũ.
  // - Partnership: demo KHÔNG có dòng nào (chỉ có khi thêm mới qua "+ Thêm dòng").
  // - Event: 'B2B Event' là dòng CONTENT có qty -> KHÔNG áp audience.
  // - Campaign Budget (SAVA): ngoài phạm vi 3 nhóm.
  const groups = new Set(demo.plan_rows.map((r) => r.group));
  assert.ok(!groups.has('Partnership'), 'demo hiện không có dòng Partnership nào');
  const savaBudget = demo.plan_rows.filter((r) => r.group === 'Campaign Budget');
  assert.ok(savaBudget.length > 0 && savaBudget.every((r) => r.audience === undefined), 'dòng Campaign Budget không gắn audience');
  const savaPaid = demo.plan_rows.filter((r) => r.brand_id === 'brand-sava-meta' && r.group === 'Paid Media');
  assert.ok(savaPaid.every((r) => domain.forecastFunnel([r], demo.benchmarks).rows[0].forecast === null), 'Paid SAVA không benchmark -> forecast null như hiện tại');
});
