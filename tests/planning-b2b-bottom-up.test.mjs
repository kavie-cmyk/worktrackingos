// tests/planning-b2b-bottom-up.test.mjs
// MÔ HÌNH B2B BOTTOM-UP (đặc tả đã duyệt):
// 1) Cầu nối Paid -> B2B cho MỌI kênh: Paid User của bất kỳ luồng B2C
//    nào (content, Paid Objective B2C, phần B2C của Lead Gen/Demo)
//    sinh B2B Account qua tỉ lệ benchmark paid_to_b2b theo Channel
//    (sửa theo Phase + uplift qua ĐÚNG cơ chế phase_assumptions).
// 2) Audience trên dòng budget-driven (Paid Media theo Objective;
//    Partnership; Event): audience 'b2c'|'b2b'|'both' + b2b_split_pct.
//    Objective thuần B2C (Awareness/Traffic/Signup/Remarketing) bị
//    khóa lựa chọn B2B ở UI + engine ép phần B2B = 0.
// 3) Cách tính: Lead Gen B2C -> Freemium tại tầng Freemium chảy xuống;
//    Lead Gen B2B -> Leads x lead_to_account; Demo tương tự với
//    demo_to_account; Partnership/Event B2C -> Freemium = tiền /
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
test('PB2B [domain] (a): cầu nối Paid -> B2B ở kênh content — Paid tháng = P, paid_to_b2b = 10% -> B2B Accounts tháng = P x 10%', () => {
  const bm = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: 0.1, direct_budget: false }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 10, budget: null }];
  const f = domain.forecastFunnel(rows, bm);
  const P = f.rows[0].forecast.paid;
  approx(P, 1, 'Paid = 10 x 100 x 0,1 x 0,1 x 0,1 (freemium_to_paid 0,1 = 0,5 x 0,2 gộp)');
  approx(f.rows[0].forecast.b2b, P * 0.1, 'B2B Accounts = Paid x paid_to_b2b');
  approx(f.byMonth['2027-01'].b2b, P * 0.1, 'byMonth cộng đúng cầu nối');
  approx(f.totals.b2b, P * 0.1, 'totals cộng đúng cầu nối');
  // Chưa có tỉ lệ paid_to_b2b -> 0 account từ cầu nối, forecast B2C giữ nguyên.
  const bmNoRate = [{ ...bm[0], paid_to_b2b: null }];
  const f2 = domain.forecastFunnel(rows, bmNoRate);
  approx(f2.rows[0].forecast.paid, P, 'thiếu tỉ lệ: Paid không đổi');
  assert.equal(f2.rows[0].forecast.b2b, 0, 'thiếu tỉ lệ paid_to_b2b -> 0 account');
});

test('PB2B [domain] (a2): cầu nối áp cho CẢ Paid Objective thuần B2C và phần B2C của Lead Gen — không kênh/luồng B2C nào được miễn', () => {
  // Traffic (Objective thuần B2C) vẫn sinh B2B qua cầu nối từ Paid của nó.
  const bmTraffic = [{ brand_id: 'b1', channel: 'Meta-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, cost_per_result: { traffic: 20000 } }];
  const rowTraffic = [{ id: 'rt', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Meta-like', group: 'Paid Media', qty: null, budget: 5460000, objective: 'traffic', audience: 'b2c' }];
  const fcT = domain.forecastFunnel(rowTraffic, bmTraffic).rows[0].forecast;
  approx(fcT.paid, 0.675675, 'Traffic Paid như ca neo Meta T1');
  approx(fcT.b2b, 0.675675 * 0.1, 'Traffic (thuần B2C) vẫn qua cầu nối');
  // Lead Gen 'both': Paid của PHẦN B2C cũng qua cầu nối, cộng với phần B2B trực tiếp.
  const bmLead = [{ brand_id: 'b1', channel: 'Ads B2B', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, paid_to_b2b: 0.1, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const rowLead = [{ id: 'rl', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }];
  const fcL = domain.forecastFunnel(rowLead, bmLead).rows[0].forecast;
  approx(fcL.b2b, 8 + 1.65 * 0.1, 'B2B = Lead->Account (8) + cầu nối từ Paid phần B2C (1,65 x 10%)');
});

test('PB2B [domain] (a3): paid_to_b2b sửa theo Phase + uplift qua phase_assumptions như các tỉ lệ funnel khác', () => {
  const phases = [{ id: 'ph-1', brand_id: 'b1', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 10 }];
  const assumptions = [{ phase_id: 'ph-1', channel: 'KOL X', view_to_visit: null, visit_to_freemium: null, freemium_to_paid: null, paid_to_b2b: 0.2, lead_to_account: null, demo_to_account: null, views_per_unit: null }];
  const bm = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: null, direct_budget: false }];
  const mk = (month) => [{ id: 'r-' + month, brand_id: 'b1', segment: 'b2c', month, channel: 'KOL X', group: 'KOL', qty: 10, budget: null, phase_id: 'ph-1' }];
  const ctx = { phases, phaseAssumptions: assumptions };
  const jan = domain.forecastFunnel(mk('2027-01'), bm, ctx).rows[0].forecast;
  approx(jan.paid, 1, 'Paid tháng đầu = 1 (10 x 100 x 0,1 x 0,1 x 0,1)');
  approx(jan.b2b, jan.paid * 0.2, 'tháng đầu phase: assumption 20% thắng benchmark null, uplift n=0');
  const feb = domain.forecastFunnel(mk('2027-02'), bm, ctx).rows[0].forecast;
  approx(feb.b2b, feb.paid * 0.2 * 1.1, 'tháng 2: uplift 10% lũy kế n=1 áp vào paid_to_b2b như tỉ lệ funnel (b2b = Paid tháng đó x 22%)');
});

// ============================================================ (b) split
test('PB2B [domain] (b): CA NEO SPLIT Lead Gen — 10.000.000đ, both, B2B 40%, CPL 100.000, lead_to_account 20%, freemium_to_paid 2,75% (= 50% x 5,5% gộp): B2C 60 Freemium -> 1,65 Paid; B2B 40 Leads -> 8 Accounts', () => {
  const bm = [{ brand_id: 'b1', channel: 'Google-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Google-like', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.freemium, 60, 'phần B2C 6.000.000 / 100.000 = 60 Freemium (đặt tại tầng Freemium, KHÔNG áp visit_to_freemium ngược)');
  assert.equal(fc.visits, 0, 'không suy ngược lên Visits');
  assert.equal(fc.views, 0, 'không suy ngược lên Views');
  approx(fc.paid, 1.65, 'Paid = 60 x 2,75%');
  approx(fc.b2b, 8, 'phần B2B 4.000.000 / 100.000 = 40 Leads x 20% = 8 Accounts');
});

test('PB2B [domain] (b2): Demo split — phần B2C đặt tại Freemium rồi chảy xuống; phần B2B Demos x demo_to_account', () => {
  const bm = [{ brand_id: 'b1', channel: 'LinkedIn-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, demo_to_account: 0.25, cost_per_result: { demo: 200000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'LinkedIn-like', group: 'Paid Media', qty: null, budget: 10000000, objective: 'demo', audience: 'both', b2b_split_pct: 40 }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.freemium, 30, 'B2C 6.000.000 / 200.000 = 30 Freemium');
  approx(fc.paid, 0.825, 'Paid = 30 x 2,75%');
  approx(fc.b2b, 5, 'B2B 4.000.000 / 200.000 = 20 Demos x 25% = 5 Accounts');
  // Audience b2b thuần (như seed LinkedIn): toàn bộ ngân sách vào chân B2B.
  const fcB = domain.forecastFunnel([{ ...rows[0], id: 'r2', audience: 'b2b', b2b_split_pct: null }], bm).rows[0].forecast;
  approx(fcB.freemium, 0, 'audience b2b: phần B2C = 0');
  approx(fcB.b2b, 12.5, 'audience b2b: 10.000.000 / 200.000 = 50 Demos x 25% = 12,5 Accounts');
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
test('PB2B [domain] (c): CA NEO TÀI CHÍNH B2B — opening_b2b 50, New 8, b2b churn 4% -> churn 2, EOM 56, Revenue B2B = arppu_b2b x 56; Profit gồm cả B2B; Paid EOM giữ nguyên vì fixture chỉ truyền tổng b2b (không truyền b2bBridge — tổng B2B không tự suy thành bridge, thay đổi B 18/11)', () => {
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
  approx(r.revenueB2b, 100000 * 56, 'Revenue B2B = arppu_b2b x B2B EOM');
  approx(r.cogsB2b, 30000 * 56, 'COGS B2B = cogs_per_b2b_account x B2B EOM');
  // LOẠI 3 — tính lại theo công thức tài chính MỚI (tháng đầu, churn x0,5 trên đầu kỳ + dòng vào):
  //   Free churn = (1.000 + 300) x 5% x 0,5 = 32,5; Free EOM = 1.000 + 300 - 10 - 32,5 = 1.257,5
  //   Paid churn = (100 + 10) x 2% x 0,5 = 1,1; Paid EOM = 100 + 10 - 1,1 = 108,9
  //   Revenue B2C = 50.000 x 108,9 = 5.445.000; COGS B2C = 10.000 x 1.257,5 + 10.000 x 108,9 = 13.664.000
  approx(r.paidEom, 108.9, 'Paid EOM = 100 + 10 - 1,1 = 108,9 — fixture không có b2bBridge nên bridgeConverted = 0, không trừ (chỉ lượng bridge do forecastFunnel phơi ra mới trừ)');
  assert.equal(r.b2bBridge, 0, 'không truyền b2bBridge -> bridgeConverted = 0');
  approx(r.profitAfterCogsMkt, (5445000 + 5600000) - (13664000 + 1680000) - 1000000, 'Profit 1 = (Revenue + Revenue B2B) - (COGS + COGS B2B) - Budget');
  approx(r.profitAfterCogsFixedMkt, (5445000 + 5600000) - (13664000 + 1680000) - 1000000 - 200000, 'Profit 2 trừ thêm fixed cost');
  assert.equal(out.totals.b2bEom, 56, 'Tổng B2B EOM = giá trị tháng cuối (dòng tồn)');
  approx(out.totals.newB2b, 8, 'Tổng New B2B Accounts cộng dồn (dòng flow)');
  assert.deepEqual(out.missingB2b, { opening_b2b: false, b2b_churn_rate: false, arppu_b2b: false, cogs_per_b2b_account: false });
});

test('PB2B [domain] (c2): ngoại lệ tồn B2B = 0 — chưa nhập bất kỳ đầu vào B2B nào thì Revenue B2B / COGS B2B = 0 và Profit KHÔNG hiện "—" oan; thiếu arppu_b2b KHI CÓ account thì mới null', () => {
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
  // LOẠI 3 — tính lại theo công thức MỚI: Free churn = (1.000 + 0) x 5% x 0,5 = 25 -> Free EOM 965;
  // Paid churn = (100 + 10) x 2% x 0,5 = 1,1 -> Paid EOM 108,9; Revenue = 50.000 x 108,9 = 5.445.000;
  // COGS = 10.000 x 965 + 10.000 x 108,9 = 10.739.000; Profit 2 = 5.445.000 - 10.739.000 - 1.000.000 - 200.000.
  approx(r.profitAfterCogsFixedMkt, -6494000, 'Profit bằng đúng ca B2C thuần (công thức MỚI) khi không có B2B');
  assert.deepEqual(out.missingB2b, { opening_b2b: false, b2b_churn_rate: false, arppu_b2b: false, cogs_per_b2b_account: false }, 'không hoạt động B2B thì không báo thiếu đầu vào B2B');
  // Có account mới + opening_b2b nhưng thiếu arppu_b2b -> Revenue B2B null, Profit null, missingB2b.arppu_b2b = true.
  const out2 = domain.computeOperatingFinancials({
    ...base,
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 0, paid: 10, b2b: 8 } },
    inputsByMonth: { '2027-01': { ...base.inputsByMonth['2027-01'], b2b_churn_rate: 0.04, cogs_per_b2b_account: 30000 } },
    openingB2b: 50
  });
  assert.equal(out2.months[0].revenueB2b, null, 'có tồn B2B mà thiếu arppu_b2b -> Revenue B2B null');
  assert.equal(out2.months[0].profitAfterCogsMkt, null, 'Profit null theo Revenue B2B');
  assert.equal(out2.missingB2b.arppu_b2b, true);
  approx(out2.months[0].cogsB2b, 30000 * 56, 'COGS B2B vẫn tính được');
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

test('PB2B [app unit]: planningKpiData + bảng KPI thứ 5 "B2B Accounts" — Channel x tháng cộng cả cầu nối + Lead->Account, có hàng Tất cả, thu gọn như các bảng kia', () => {
  const rows = b2bRows();
  const { h } = makeHarness(rows, B2B_PHASES, B2B_BENCH, []);
  const data = h.planningKpiData(rows, B2B_BENCH, ['2027-01']);
  const kol = data.channels.find((c) => c.channel === 'KOL X');
  const lead = data.channels.find((c) => c.channel === 'Ads B2B');
  approx(kol.months['2027-01'].b2b, 10 * 0.1, 'KOL X: Paid 10 (200 x 1 x 1 x 0,05) x paid_to_b2b 10% = 1');
  approx(lead.months['2027-01'].b2b, 8, 'Ads B2B: 8 Accounts từ phần B2B Lead Gen');
  approx(data.blended.months['2027-01'].b2b, 9, 'Tất cả tháng = 1 + 8');
  approx(data.blended.totals.b2b, 9, 'Tất cả cả kỳ = 9');
  const html = h.planningKpiTablesHtml(rows, B2B_BENCH, ['2027-01']);
  assert.ok(html.includes('data-planning-kpi-section="b2b"'), 'phải có section KPI b2b');
  assert.ok(html.includes('KPI chi tiết theo tháng — B2B Accounts (Forecast)'), 'tiêu đề bảng thứ 5');
  assert.ok(html.includes('data-planning-kpi-row="b2b" data-channel="Tất cả"'), 'bảng B2B Accounts phải có hàng Tất cả');
  const cell = /<td data-planning-kpi-cell="b2b" data-channel="Ads B2B" data-month="2027-01">([^<]*)<\/td>/.exec(html);
  assert.ok(cell && cell[1] === '8', 'ô B2B của Ads B2B tháng 1 = 8, got: ' + (cell && cell[1]));
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
  // Sau khi lưu audience both + 40%, engine qua planningKpiData cho đúng 8 account.
  const data = h.planningKpiData(rows, B2B_BENCH, ['2027-01']);
  approx(data.channels.find((c) => c.channel === 'Ads B2B').months['2027-01'].b2b, 8, 'sau khi lưu, KPI B2B tính lại ngay từ field đã ghi');
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

test('PB2B [app unit]: Theo phase — 3 tỉ lệ B2B sửa được tại cùng chỗ tỉ lệ Channel (savePhaseRate qua phase_assumptions); khối tài chính B2B lưu qua đúng whitelist; hiển thị chỉ đọc audience + ngân sách B2C/B2B của Objective', () => {
  const rows = b2bRows();
  const phases = JSON.parse(JSON.stringify(B2B_PHASES));
  const assumptions = [];
  const { h, UI } = makeHarness(rows, phases, B2B_BENCH, assumptions);
  UI.planningOpeningPhaseIds = { 'ph-1': true }; // Phase đầu năm của Brand — nơi hiện các ô opening
  h.savePhaseRate('ph-1', 'KOL X', 'paid_to_b2b', '10');
  const asm = assumptions.find((a) => a.channel === 'KOL X');
  assert.ok(asm, 'savePhaseRate paid_to_b2b phải tạo phase_assumptions');
  assert.equal(asm.paid_to_b2b, 0.1, 'nhập 10% lưu 0,1 như cơ chế tỉ lệ phase');
  assert.ok('lead_to_account' in asm && 'demo_to_account' in asm, 'assumption mới có sẵn 2 field B2B còn lại (null)');
  // Sau khi có assumption, cầu nối của KOL X đổi ngay (benchmark vốn 0,1 — dùng kênh khác để phân biệt):
  h.savePhaseRate('ph-1', 'Ads B2B', 'lead_to_account', '30');
  const asmLead = assumptions.find((a) => a.channel === 'Ads B2B');
  assert.equal(asmLead.lead_to_account, 0.3, 'lead_to_account sửa theo Phase được');
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
  assert.ok(block.includes('Paid→B2B (%)'), 'bảng tỉ lệ Phase phải có cột Paid→B2B');
  assert.ok(block.includes('Lead→Account (%)'), 'bảng tỉ lệ Phase phải có cột Lead→Account');
  assert.ok(block.includes('Demo→Account (%)'), 'bảng tỉ lệ Phase phải có cột Demo→Account');
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

test('PB2B [app unit]: bảng tài chính Theo tháng có đủ hàng B2B và tính đúng ca (c) qua đường app — New B2B Accounts / B2B churn / B2B EOM / Revenue B2B / COGS B2B', () => {
  const rows = b2bRows();
  const phases = [{ ...B2B_PHASES[0], paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 50000, cogs_per_free_user: 10000, cogs_per_paid_user: 10000, fixed_cost: 200000, opening_free: 1000, opening_paid: 100, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000, opening_b2b: 50 }];
  const { h, UI } = makeHarness(rows, phases, B2B_BENCH, []);
  UI.planningOpeningPhaseIds = { 'ph-1': true };
  const data = h.planningOperatingData(rows, B2B_BENCH, ['2027-01']);
  const r = data.months[0];
  // New B2B tháng = KOL cầu nối 1 + Lead->Account 8 = 9.
  approx(r.newB2b, 9, 'New B2B Accounts = cả 3 nguồn cộng qua engine');
  approx(r.b2bChurn, 50 * 0.04, 'B2B churn = opening_b2b x b2b_churn_rate');
  approx(r.b2bEom, 50 + 9 - 2, 'B2B EOM = 57');
  approx(r.revenueB2b, 100000 * 57, 'Revenue B2B = arppu_b2b x B2B EOM');
  approx(r.cogsB2b, 30000 * 57, 'COGS B2B = cogs_per_b2b_account x B2B EOM');
  // Thay đổi B (18/11): fixture này CÓ bridge qua đường app — KOL Paid 10 x
  // paid_to_b2b 10% = bridge 1 (Lead Gen benchmark paid_to_b2b null -> 0).
  // Paid cohort = 10 + 1,65 = 11,65; Paid churn = (100 + 11,65) x 2% x 0,5
  // = 1,1165; Paid EOM CŨ (trước thay đổi B) = 100 + 11,65 - 1,1165
  // = 110,5335 -> MỚI = 110,5335 - bridge 1 = 109,5335.
  approx(r.b2bBridge, 1, 'bridge qua app = cầu nối KOL 1 (một nguồn từ forecastFunnel)');
  approx(r.paidEom, 109.5335, 'Paid EOM MỚI = 110,5335 (cũ) - bridge 1');
  approx(r.revenue, 50000 * 109.5335, 'Revenue Paid theo Paid EOM mới = 5.476.675 (cũ 5.526.675)');
  approx(r.cogsPaid, 10000 * 109.5335, 'COGS Paid theo Paid EOM mới = 1.095.335 (cũ 1.105.335)');
  const html = h.planningOperatingTableHtml(rows, B2B_BENCH, ['2027-01']);
  for (const key of ['newB2b', 'b2bChurn', 'b2bEom', 'revenueB2b', 'cogsB2b']) {
    assert.ok(html.includes('data-planning-operating-row="' + key + '"'), 'bảng tài chính thiếu hàng ' + key);
  }
  const cell = (key) => {
    const m = new RegExp('<td data-planning-operating-cell="' + key + '" data-month="2027-01">([^<]*)</td>').exec(html);
    return m ? m[1] : null;
  };
  assert.equal(cell('b2bEom'), '57');
  assert.equal(cell('revenueB2b'), '5.700.000 VND');
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
