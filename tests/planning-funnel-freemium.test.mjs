// tests/planning-funnel-freemium.test.mjs
// CĂN CHỈNH PHỄU Freemium/Paid (theo sheet Lumilink1):
// - Phễu còn 4 tầng: views -> visits -> freemium -> paid. Tỉ lệ mới:
//   visit_to_freemium (v2f) và freemium_to_paid (f2p).
// - FALLBACK key cũ: v2f = visit_to_freemium ?? visit_to_signup;
//   f2p = freemium_to_paid ?? (signup_to_first x first_to_paid) — chỉ
//   khi có CẢ HAI key cũ. Nhờ fallback, benchmark đời cũ và benchmark
//   đời mới cho SỐ PAID GIỐNG HỆT (khẳng định (a)).
// - Objective signup / lead_gen / demo đặt kết quả TẠI tầng Freemium
//   rồi chảy xuống Paid bằng f2p (khẳng định (b)); Partnership/Event
//   B2C cũng đặt tại Freemium (đơn giá vẫn đọc qua key
//   cost_per_result.signup — KHÔNG đổi tên key đơn giá).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

// Fixture dùng chung cho (a): 1 dòng content + 1 dòng Paid Traffic.
// Content: qty 10 x output 1.000 = 10.000 views; v2v 0,1 -> 1.000
// visits; v2f 0,09 -> 90 freemium; f2p 0,0275 -> Paid 2,475.
// Paid Traffic: ngân sách 1.000.000đ / Cost-LPV 20.000đ = 50 visits;
// -> freemium 4,5 -> Paid 0,12375. Tổng Paid = 2,59875.
const CONTENT_ROW = { id: 'r-content', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 10, budget: null };
const TRAFFIC_ROW = { id: 'r-traffic', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Ads X', group: 'Paid Media', qty: null, budget: 1000000, objective: 'traffic' };
const BM_OLD = [
  { brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 1000, view_to_visit: 0.1, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, direct_budget: false },
  { brand_id: 'b1', channel: 'Ads X', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_signup: 0.09, signup_to_first: 0.5, first_to_paid: 0.055, cost_per_result: { traffic: 20000 } }
];
const BM_NEW = [
  { brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 1000, view_to_visit: 0.1, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, direct_budget: false },
  { brand_id: 'b1', channel: 'Ads X', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, cost_per_result: { traffic: 20000 } }
];

test('PFF (a): benchmark key CŨ (visit_to_signup 0,09 + signup_to_first 0,5 + first_to_paid 0,055) cho Paid GIỐNG HỆT benchmark key MỚI (visit_to_freemium 0,09 + freemium_to_paid 0,0275) — content + Paid Traffic', () => {
  const rows = [CONTENT_ROW, TRAFFIC_ROW];
  const fOld = domain.forecastFunnel(rows, BM_OLD);
  const fNew = domain.forecastFunnel(rows, BM_NEW);
  // Shape phễu mới ở cả hai đường (fallback không hồi sinh tầng cũ).
  assert.deepEqual(fOld.steps, ['views', 'visits', 'freemium', 'paid']);
  assert.deepEqual(fNew.steps, ['views', 'visits', 'freemium', 'paid']);
  for (const f of [fOld, fNew]) {
    for (const r of f.rows) {
      assert.ok(r.forecast, 'phải có forecast');
      assert.ok(!('signups' in r.forecast) && !('first' in r.forecast), 'forecast không còn key signups/first');
    }
    assert.ok(!('signups' in f.totals) && !('first' in f.totals), 'totals không còn key signups/first');
  }
  // Từng dòng: freemium + paid bằng nhau tuyệt đối giữa cũ và mới.
  const byId = (f) => Object.fromEntries(f.rows.map((r) => [r.rowId, r.forecast]));
  const o = byId(fOld), n = byId(fNew);
  approx(o['r-content'].freemium, 90, 'content freemium (key cũ, fallback)');
  approx(n['r-content'].freemium, 90, 'content freemium (key mới)');
  approx(o['r-content'].paid, 2.475, 'content Paid key cũ = 90 x (0,5 x 0,055)');
  approx(n['r-content'].paid, 2.475, 'content Paid key mới = 90 x 0,0275');
  approx(o['r-traffic'].visits, 50, 'traffic visits');
  approx(o['r-traffic'].freemium, 4.5, 'traffic freemium key cũ');
  approx(n['r-traffic'].freemium, 4.5, 'traffic freemium key mới');
  approx(o['r-traffic'].paid, n['r-traffic'].paid, 'traffic Paid cũ = mới');
  approx(fOld.totals.paid, 2.59875, 'TỔNG Paid key cũ');
  approx(fNew.totals.paid, 2.59875, 'TỔNG Paid key mới — GIỐNG HỆT key cũ');
  approx(fOld.totals.freemium, fNew.totals.freemium, 'tổng freemium cũ = mới');
  approx(fOld.byMonth['2027-01'].paid, fNew.byMonth['2027-01'].paid, 'byMonth Paid cũ = mới');
});

test('PFF (a2): fallback gộp f2p CHỈ khi đủ CẢ HAI key cũ — thiếu signup_to_first hoặc first_to_paid thì f2p = null (content forecast null; Traffic dừng tại Freemium)', () => {
  const bmMissingFirst = [{ ...BM_OLD[0], first_to_paid: null }];
  assert.equal(domain.forecastFunnel([CONTENT_ROW], bmMissingFirst).rows[0].forecast, null,
    'thiếu first_to_paid -> không gộp được f2p -> content forecast null, không bịa số');
  const bmMissingSignup = [{ ...BM_OLD[0], signup_to_first: null }];
  assert.equal(domain.forecastFunnel([CONTENT_ROW], bmMissingSignup).rows[0].forecast, null,
    'thiếu signup_to_first -> không gộp được f2p -> content forecast null');
  // Key MỚI freemium_to_paid thắng fallback kể cả khi key cũ thiếu.
  const bmNewWins = [{ ...BM_OLD[0], signup_to_first: null, freemium_to_paid: 0.0275 }];
  const fc = domain.forecastFunnel([CONTENT_ROW], bmNewWins).rows[0].forecast;
  approx(fc.paid, 2.475, 'có freemium_to_paid (key mới) thì không cần fallback gộp');
  // Traffic với f2p null: chuỗi dừng tại Freemium, Paid = 0.
  const bmTrafficNoF2p = [{ ...BM_OLD[1], first_to_paid: null }];
  const fcT = domain.forecastFunnel([TRAFFIC_ROW], bmTrafficNoF2p).rows[0].forecast;
  approx(fcT.freemium, 4.5, 'Traffic vẫn ra Freemium');
  assert.equal(fcT.paid, 0, 'thiếu f2p -> Paid = 0 (dừng chuỗi)');
});

test('PFF (b): catalog Objective — signup / lead_gen / demo cùng đặt tại tầng Freemium; awareness -> views, traffic -> visits, remarketing -> paid', () => {
  assert.deepEqual(domain.PAID_OBJECTIVES.map((o) => [o.key, o.tier]), [
    ['awareness', 'views'], ['traffic', 'visits'], ['signup', 'freemium'],
    ['remarketing', 'paid'], ['lead_gen', 'freemium'], ['demo', 'freemium']
  ]);
});

test('PFF (b2): Objective Signup đặt kết quả TẠI Freemium rồi chảy xuống Paid bằng f2p — không suy ngược Visits/Views', () => {
  const bm = [{ brand_id: 'b1', channel: 'Ads X', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, cost_per_result: { signup: 100000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Ads X', group: 'Paid Media', qty: null, budget: 1000000, objective: 'signup' }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.freemium, 10, 'Freemium = 1.000.000 / 100.000');
  approx(fc.paid, 10 * 0.0275, 'Paid = Freemium x f2p');
  assert.equal(fc.visits, 0, 'không suy ngược lên Visits');
  assert.equal(fc.views, 0, 'không suy ngược lên Views');
});

test('PFF (b3): Lead Gen + Demo — phần B2C đặt tại Freemium chảy xuống Paid bằng f2p; phần B2B chỉ đếm Lead/Demo, accounts từ quy đổi = 0 (mô hình 18/11)', () => {
  const bmLead = [{ brand_id: 'b1', channel: 'Google-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.2, cost_per_result: { lead_gen: 100000 } }];
  const rowLead = [{ id: 'rl', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Google-like', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }];
  const fcL = domain.forecastFunnel(rowLead, bmLead).rows[0].forecast;
  approx(fcL.freemium, 60, 'Lead Gen B2C: 6.000.000 / 100.000 = 60 Freemium');
  approx(fcL.paid, 60 * 0.0275, 'Lead Gen Paid = 60 x f2p = 1,65');
  assert.equal(fcL.b2b, 0, 'Lead Gen B2B: 40 Leads — accounts từ quy đổi lead_to_account = 0 (đã bỏ quy đổi)');
  assert.equal(fcL.visits, 0); assert.equal(fcL.views, 0);

  const bmDemo = [{ brand_id: 'b1', channel: 'LinkedIn-like', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, demo_to_account: 0.25, cost_per_result: { demo: 200000 } }];
  const rowDemo = [{ id: 'rd', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'LinkedIn-like', group: 'Paid Media', qty: null, budget: 10000000, objective: 'demo', audience: 'both', b2b_split_pct: 40 }];
  const fcD = domain.forecastFunnel(rowDemo, bmDemo).rows[0].forecast;
  approx(fcD.freemium, 30, 'Demo B2C: 6.000.000 / 200.000 = 30 Freemium (trước đặt tại First)');
  approx(fcD.paid, 30 * 0.0275, 'Demo Paid = 30 x f2p = 0,825');
  assert.equal(fcD.b2b, 0, 'Demo B2B: 20 Demos — accounts từ quy đổi demo_to_account = 0 (đã bỏ quy đổi)');
});

test('PFF (b4): Partnership/Event B2C đặt tại Freemium qua key đơn giá cost_per_result.signup (GIỮ NGUYÊN key), chảy xuống Paid bằng f2p', () => {
  const bm = [{ brand_id: 'b1', channel: 'Partner X', group: 'Partnership', direct_budget: true, view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.0275, cost_per_result: { signup: 50000, b2b_account: 500000 } }];
  const rows = [{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Partner X', group: 'Partnership', qty: null, budget: 10000000, audience: 'both', b2b_split_pct: 40 }];
  const fc = domain.forecastFunnel(rows, bm).rows[0].forecast;
  approx(fc.freemium, 120, 'B2C 6.000.000 / cost_per_result.signup 50.000 = 120 Freemium');
  approx(fc.paid, 120 * 0.0275, 'Paid = 120 x f2p = 3,3');
  approx(fc.b2b, 8, 'B2B 4.000.000 / 500.000 = 8 Accounts (không đổi)');
});
