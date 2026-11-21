// tests/planning-seo-articles.test.mjs
// KÊNH WEBSITE ARTICLES theo Mô hình SEO B (WITH_SUPPORT — SEO +
// Seeding; khung views chốt 18/11/2026 theo file
// SEO_forecast_final.html):
// - matureViews 350; seedPerPost 250 (chỉ tháng đăng); ageRamp /
//   domainFactor neo theo file nguồn.
// - CR (sign-up của file = Free user của kênh) + Paid tại kênh:
//   ZAC CHỐT 21/11/2026 (thay quyết định 18/11 neo theo file HTML):
//   CR = 5% và Paid = 3,5% × Free NGAY TẠI KÊNH (paidRate) — là
//   hằng số engine, KHÔNG còn lấy từ file HTML (file vẫn ghi 2,5%
//   và không có Paid tại kênh).
// - Tháng m: seoViews = round(domainFactor[m] × Σ_{k<=m} qty_k ×
//   350 × ageRamp[m−k]); views = seoViews + qty_m × 250;
//   visits = views; freemium = round(views × 5%);
//   paid = round(freemium × 3,5%) ở cấp Brand × tháng, chia cho
//   các dòng theo tỉ trọng qty như views/freemium; b2b = 0 (bridge
//   Paid -> B2B tính theo Phase ở tầng tồn, không ở tầng kênh).
//   Phần Free chưa Paid vẫn vào tồn Free chung -> Monthly cvr ở
//   tầng vận hành; phần đã Paid tại kênh trừ khỏi tồn (list Email
//   = Σ (freemium − paid) của các kênh phi-Email).
// - Bỏ qua benchmark / phase assumptions / uplift tỉ lệ /
//   Uplift Views của Phase.
// - Articles tính ở lượt 1 của forecastFunnel nên Free (ròng Paid)
//   của Articles nuôi list Email ở lượt 2 (Paid Email đổi theo).
// Ground truth ĐỘC LẬP: trích computeComparison + hằng số
// WITH_SUPPORT từ chính file HTML nguồn chạy trong node — chỉ còn
// đối chiếu phần VIEWS (và các hằng số khung views); freemium/paid
// tính lại từ định nghĩa mô hình mới ở trên.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

// ---------- Ground truth từ file HTML nguồn ----------
const SEO_HTML_URL = new URL('../../user/files/SEO_forecast_final.html', import.meta.url);
function loadGroundTruth() {
  const html = readFileSync(SEO_HTML_URL, 'utf8');
  const consts = section(html, 'const PURE_SEO_GEO', 'const fmtInt');
  const fn = section(html, 'function computeComparison', 'function renderTable');
  return new Function(consts + '\n' + fn + '\nreturn { computeComparison, WITH_SUPPORT };')();
}
const GT = loadGroundTruth();

function articlesRows(qtyByMonth, brandId = 'b1') {
  return qtyByMonth.map((q, i) => ({
    id: 'art-' + (i + 1), brand_id: brandId, segment: 'b2c',
    month: '2027-' + String(i + 1).padStart(2, '0'),
    channel: 'Website Articles', group: 'Content', unit: 'articles', qty: q, budget: null
  }));
}

test('SEO [model]: 350 / 250 / ageRamp / domainFactor khớp WITH_SUPPORT trong file nguồn; CR 5% + paidRate 3,5% là hằng số engine (Zac chốt 21/11/2026)', () => {
  assert.equal(domain.SEO_ARTICLES_MODEL.matureViews, GT.WITH_SUPPORT.matureViews);
  assert.equal(domain.SEO_ARTICLES_MODEL.seedPerPost, GT.WITH_SUPPORT.seedPerPost);
  // Điểm neo CR theo file nguồn (WITH_SUPPORT.crPct = 2,5) đã bị
  // quyết định 21/11/2026 của Zac thay thế — file HTML KHÔNG sửa,
  // engine dùng CR 5% + paidRate 3,5% làm hằng số riêng:
  assert.equal(GT.WITH_SUPPORT.crPct, 2.5, 'file nguồn vẫn ghi CR 2,5% (không sửa file của user)');
  assert.equal(domain.SEO_ARTICLES_MODEL.cr, 0.05, 'CR engine = 5% (Zac chốt 21/11/2026)');
  assert.equal(domain.SEO_ARTICLES_MODEL.paidRate, 0.035, 'paidRate engine = 3,5% (Zac chốt 21/11/2026)');
  assert.deepEqual(domain.SEO_ARTICLES_MODEL.ageRamp, GT.WITH_SUPPORT.ageRamp);
  assert.deepEqual(domain.SEO_ARTICLES_MODEL.domainFactor, GT.WITH_SUPPORT.domainFactor);
  assert.equal(domain.isSeoArticlesRow({ channel: 'Website Articles' }), true);
  assert.equal(domain.isSeoArticlesRow({ channel: 'Website' }), false, "kênh 'Website' của SAVA không phải Website Articles");
});

test('SEO [ground-truth]: qty đều 8/tháng — views khớp TUYỆT ĐỐI computeComparison Mô hình B từng tháng; freemium = round(views × 5%), paid = round(freemium × 3,5%) (chốt 21/11)', () => {
  const gt = GT.computeComparison(8);
  // Tham chiếu tính tay (điều phối viên đã kiểm chứng độc lập):
  assert.deepEqual(gt.map((r) => r.bTotal), [2042, 2200, 2650, 3613, 5199, 7432, 10191, 13397, 17000, 20731, 24736, 29216]);
  // bSignups của file nguồn vẫn ở CR 2,5% — chỉ giữ làm mốc đối
  // chiếu lịch sử, KHÔNG còn là kỳ vọng freemium của engine:
  assert.deepEqual(gt.map((r) => r.bSignups), [51, 55, 66, 90, 130, 186, 255, 335, 425, 518, 618, 730]);
  // Kỳ vọng theo mô hình MỚI, tính lại từ views ground truth:
  // freemium = round(views × 5%): 2042→102, 2200→110, 2650→133,
  // 3613→181, 5199→260, 7432→372, 10191→510, 13397→670, 17000→850,
  // 20731→1037, 24736→1237, 29216→1461 (tổng 6.923).
  // paid = round(freemium × 3,5%): 102→4, 110→4, 133→5, 181→6,
  // 260→9, 372→13, 510→18, 670→23, 850→30, 1037→36, 1237→43,
  // 1461→51 (tổng 242).
  const EXP_FREE = [102, 110, 133, 181, 260, 372, 510, 670, 850, 1037, 1237, 1461];
  const EXP_PAID = [4, 4, 5, 6, 9, 13, 18, 23, 30, 36, 43, 51];
  const f = domain.forecastFunnel(articlesRows(Array(12).fill(8)), []);
  assert.deepEqual(f.rows.map((r) => r.forecast.views), gt.map((r) => r.bTotal), 'views từng tháng phải khớp ground truth');
  assert.deepEqual(f.rows.map((r) => r.forecast.freemium), EXP_FREE, 'freemium = round(views × 5%) từng tháng');
  assert.deepEqual(f.rows.map((r) => r.forecast.paid), EXP_PAID, 'paid = round(freemium × 3,5%) từng tháng');
  assert.deepEqual(Object.values(f.byMonth).map((v) => v.views), gt.map((r) => r.bTotal), 'byMonth views khớp');
  f.rows.forEach((r, i) => {
    assert.equal(r.forecast.visits, r.forecast.views, 'visits = views');
    assert.equal(r.forecast.paid, EXP_PAID[i], 'paid tại kênh theo paidRate');
    assert.equal(r.forecast.b2b, 0, 'b2b = 0 tuyệt đối');
    assert.equal(r.forecast.b2bBridge, 0, 'bridge = 0');
  });
  assert.equal(f.totals.paid, 242, 'tổng Paid tại kênh = 242');
  assert.equal(f.totals.b2b, 0);
});

test('SEO [ground-truth]: qty đều 20/tháng — views khớp computeComparison (T1 views 5.105) cả 12 tháng; freemium/paid theo mô hình mới (T1: 255 / 9)', () => {
  const gt = GT.computeComparison(20);
  assert.equal(gt[0].bTotal, 5105);
  assert.equal(gt[0].bSignups, 128, 'signups của file nguồn ở CR 2,5% (mốc lịch sử — engine không còn dùng)');
  const f = domain.forecastFunnel(articlesRows(Array(12).fill(20)), []);
  assert.deepEqual(f.rows.map((r) => r.forecast.views), gt.map((r) => r.bTotal));
  // freemium = round(views × 5%) trên views ground truth
  // [5105, 5501, 6624, 9032, 12997, 18580, 25476, 33493, 42499,
  // 51827, 61840, 73040]; paid = round(freemium × 3,5%):
  assert.deepEqual(f.rows.map((r) => r.forecast.freemium), [255, 275, 331, 452, 650, 929, 1274, 1675, 2125, 2591, 3092, 3652], 'freemium = round(views × 5%)');
  assert.deepEqual(f.rows.map((r) => r.forecast.paid), [9, 10, 12, 16, 23, 33, 45, 59, 74, 91, 108, 128], 'paid = round(freemium × 3,5%)');
});

test('SEO [qty biến thiên]: cohort trộn qty [2, 0, 5] — tính tay 3 tháng đầu; tháng qty = 0 vẫn có forecast từ cohort cũ', () => {
  // T1: seo = round(0,50 × 2×350×0,03) = round(10,5) = 11 (JS
  // Math.round làm tròn .5 lên); seed = 2×250 = 500 -> views 511;
  // freemium = round(511 × 5%) = round(25,55) = 26;
  // paid = round(26 × 3,5%) = round(0,91) = 1.
  // T2 (qty 0): seo = round(0,65 × 2×350×0,08) = round(36,4) = 36;
  // seed 0 -> views 36; freemium = round(1,8) = 2;
  // paid = round(2 × 3,5%) = round(0,07) = 0.
  // T3: seo = round(0,80 × (2×350×0,18 + 0 + 5×350×0,03)) =
  // round(142,8) = 143; seed = 5×250 = 1.250 -> views 1.393;
  // freemium = round(69,65) = 70; paid = round(70 × 3,5%) =
  // round(2,45) = 2.
  const f = domain.forecastFunnel(articlesRows([2, 0, 5]), []);
  assert.deepEqual(f.rows.map((r) => [r.forecast.views, r.forecast.freemium, r.forecast.paid]), [[511, 26, 1], [36, 2, 0], [1393, 70, 2]]);
  assert.equal(f.byMonth['2027-02'].hasForecast, true, 'tháng qty = 0 vẫn hasForecast = true nhờ cohort cũ');
  assert.ok(f.rows[1].forecast, 'dòng qty = 0 vẫn có forecast (không null)');
});

test('SEO [nhiều dòng cùng tháng]: cộng qty làm cohort tháng; forecast tháng chia theo tỉ trọng qty, tổng khớp ground truth', () => {
  const rows = [
    { id: 'a1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Website Articles', group: 'Content', qty: 3, budget: null },
    { id: 'a2', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Website Articles', group: 'Content', qty: 5, budget: null },
    ...articlesRows(Array(11).fill(8)).map((r, i) => ({ ...r, id: 'b' + i, month: '2027-' + String(i + 2).padStart(2, '0') }))
  ];
  const f = domain.forecastFunnel(rows, []);
  const jan = f.rows.filter((r) => r.month === '2027-01');
  approx(jan.reduce((s, r) => s + r.forecast.views, 0), 2042, 'tổng views T1 của 2 dòng = ground truth posts=8');
  approx(jan[0].forecast.views, 2042 * 3 / 8, 'dòng qty 3 nhận 3/8 forecast tháng');
  approx(jan[1].forecast.views, 2042 * 5 / 8, 'dòng qty 5 nhận 5/8 forecast tháng');
  approx(f.byMonth['2027-01'].freemium, 102, 'freemium T1 tổng = round(2.042 × 5%) = 102');
});

test('SEO [khóa mô hình]: benchmark / phase assumptions / uplift tỉ lệ 10% / Uplift Views KHÔNG đổi số Articles; paid_to_b2b cũng không sinh B2B', () => {
  const rows = articlesRows([8, 8, 8, 8]);
  const plain = domain.forecastFunnel(rows, []);
  const benchmarks = [{ brand_id: 'b1', channel: 'Website Articles', group: 'Content', output_per_unit: 99999, view_to_visit: 0.99, visit_to_freemium: 0.99, freemium_to_paid: 0.99, paid_to_b2b: 0.5, direct_budget: false }];
  const phases = [{ id: 'ph-1', brand_id: 'b1', start_month: '2027-01', end_month: '2027-04', uplift_percent_per_month: 10, views_uplift_percent_per_month: 10 }];
  const assumptions = [{ phase_id: 'ph-1', channel: 'Website Articles', view_to_visit: 0.5, visit_to_freemium: 0.5, freemium_to_paid: 0.5, paid_to_b2b: 0.5, views_per_unit: 9999 }];
  const rowsP = rows.map((r) => ({ ...r, phase_id: 'ph-1' }));
  const loaded = domain.forecastFunnel(rowsP, benchmarks, { phases, phaseAssumptions: assumptions });
  assert.deepEqual(loaded.rows.map((r) => r.forecast), plain.rows.map((r) => r.forecast), 'forecast Articles phải giống hệt khi thêm benchmark/assumption/uplift');
  assert.deepEqual(loaded.totals, plain.totals, 'totals không đổi');
  for (const r of loaded.rows) assert.equal(r.forecast.b2b, 0, 'paid_to_b2b 0,5 vẫn cho b2b = 0 (bridge tính theo Phase ở tầng tồn, không sinh ở tầng kênh — kể cả nay Paid tại kênh > 0)');
});

test('SEO [dây chuyền Email]: Free của Articles nuôi list Email lượt 2 — Email T2 opens/paid tính từ Free Articles T1', () => {
  const BM = [
    { brand_id: 'b1', segment: 'b2c', channel: 'Email Sends', group: 'Email', output_per_unit: null, view_to_visit: 0.30, visit_to_freemium: 0.10, freemium_to_paid: 0.01, direct_budget: false }
  ];
  const rows = [
    ...articlesRows([8, 8]),
    { id: 'em-2', brand_id: 'b1', segment: 'b2c', month: '2027-02', channel: 'Email Sends', group: 'Email', unit: 'sends', qty: 2, budget: null }
  ];
  const f = domain.forecastFunnel(rows, BM);
  const email = f.rows.find((r) => r.rowId === 'em-2');
  // list T2 = freemium Articles T1 − paid Articles T1
  // = round(2.042 × 5%) − round(102 × 3,5%) = 102 − 4 = 98;
  // opens = 98 × 0,30 × 2 = 58,8; visits = 5,88; paid = 0,0588.
  approx(email.forecast.emailList, 98, 'list Email T2 = Free Articles T1 − Paid Articles T1');
  approx(email.forecast.views, 58.8, 'opens Email T2');
  approx(email.forecast.paid, 0.0588, 'Paid Email T2');
});

test('SEO [fixture Lumus]: series Articles 12 tháng + neo mới — Paid Articles tại kênh 332; Email Paid 19,4655 -> 28,5554; Paid tổng 448,5513; Paid phi-Email 419,9960; CAC T1 = 6.081.190đ; content/ngân sách giữ nguyên', () => {
  const rows = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(rows.reduce((s, r) => s + (r.qty || 0), 0), 764, '764 content (giữ)');
  const budget = domain.planBudget(rows, demo.benchmarks);
  assert.equal(budget.total, 1238700000, 'tổng ngân sách 1.238.700.000đ (giữ)');
  const ctx = { phases: demo.phases, phaseAssumptions: demo.phase_assumptions };
  const f = domain.forecastFunnel(rows, demo.benchmarks, ctx);
  const arts = f.rows.filter((r) => r.channel === 'Website Articles');
  assert.deepEqual(arts.map((r) => r.forecast.views), [2808, 3025, 3643, 4968, 7148, 10219, 14012, 18421, 23374, 28505, 33750, 39876], 'views Articles fixture (qty 11×10 + 10×2)');
  // freemium = round(views × 5%) từng tháng (tổng 9.487; trước ở
  // CR 2,5%: [70, 76, 91, 124, 179, 255, 350, 461, 584, 713, 844,
  // 997], tổng 4.744):
  assert.deepEqual(arts.map((r) => r.forecast.freemium), [140, 151, 182, 248, 357, 511, 701, 921, 1169, 1425, 1688, 1994], 'freemium Articles fixture (tổng 9.487)');
  // paid = round(freemium × 3,5%) từng tháng (tổng 332):
  assert.deepEqual(arts.map((r) => r.forecast.paid), [5, 5, 6, 9, 12, 18, 25, 32, 41, 50, 59, 70], 'Paid Articles tại kênh (tổng 332)');
  const emails = f.rows.filter((r) => r.channel === 'Email Sends');
  // List Email phình theo tồn (Free − Paid) phi-Email: phần Articles
  // đóng góp ròng 9.487 − 332 = 9.155 (trước: 4.744) -> Paid Email
  // tăng 19,4655 -> 28,5554 (kiểm chứng: list từng tháng của engine
  // khớp đúng tồn cộng dồn (freemium − paid) của các dòng phi-Email).
  approx(emails.reduce((s, r) => s + r.forecast.paid, 0), 28.5553525536942, 'Paid Email cả năm sau Articles (trước: 19,465485950231425)');
  approx(f.totals.paid, 448.5513053315356, 'Paid tổng gồm Email (trước: 107,46143872807268; delta = 332 Paid Articles + 9,0899 ΔPaid Email)');
  approx(f.totals.freemium, 12203.831132798625, 'freemium tổng (trước: 7.460,8311; = 2.716,8311 phi-Articles + 9.487 Articles)');
  approx(domain.forecastFunnel(rows.filter((r) => r.channel !== 'Email Sends'), demo.benchmarks, ctx).totals.paid, 419.9959527778414, 'Paid phi-Email = 87,9960 (cũ) + 332 Paid Articles tại kênh');
  // Paid T1 = 1,99863 (cũ) + 5 Paid Articles T1 (round(140 × 3,5%))
  // = 6,99863 -> CAC T1 = round(42.560.000 / 6,99863) = 6.081.190đ:
  assert.equal(Math.round(budget.byMonth['2027-01'].amount / f.byMonth['2027-01'].paid), 6081190, 'CAC Tất cả T1 = 6.081.190đ (trước: 21.294.587đ — Paid T1 tăng do Paid Articles tại kênh)');
});

// ---------- Snapshot production (ngoài repo; bỏ qua nếu vắng) ----------
const SNAP_URL = new URL('../../planning-audit-20261118/executor/snapshot-lumus-2027.json', import.meta.url);
test('SEO [snapshot production]: Articles qty 20/tháng có series 12 tháng; Paid Email 68,1127 -> 83,8913; Paid tổng 4.006,6127', { skip: !existsSync(SNAP_URL) }, () => {
  const ds = JSON.parse(readFileSync(SNAP_URL, 'utf8'));
  const ctx = { phases: ds.phases, phaseAssumptions: ds.phase_assumptions };
  const f = domain.forecastFunnel(ds.plan_rows, ds.benchmarks, ctx);
  const arts = f.rows.filter((r) => r.channel === 'Website Articles');
  assert.deepEqual(arts.map((r) => r.forecast.views), [5105, 5501, 6624, 9032, 12997, 18580, 25476, 33493, 42499, 51827, 61840, 73040], 'views Articles snapshot (qty 20/tháng)');
  // freemium = round(views × 5%) (tổng 17.301; trước ở CR 2,5%
  // tổng 8.652); paid = round(freemium × 3,5%) (tổng 608):
  assert.deepEqual(arts.map((r) => r.forecast.freemium), [255, 275, 331, 452, 650, 929, 1274, 1675, 2125, 2591, 3092, 3652], 'freemium Articles snapshot (tổng 17.301)');
  assert.deepEqual(arts.map((r) => r.forecast.paid), [9, 10, 12, 16, 23, 33, 45, 59, 74, 91, 108, 128], 'Paid Articles snapshot tại kênh (tổng 608)');
  for (const r of arts) { assert.equal(r.forecast.b2b, 0); }
  const emails = f.rows.filter((r) => r.channel === 'Email Sends');
  approx(emails.reduce((s, r) => s + r.forecast.paid, 0), 83.89131038095948, 'Paid Email snapshot sau Articles (trước: 68,11269726312686)');
  approx(f.totals.freemium, 34920.09474861488, 'freemium tổng snapshot (trước: 26.271,0947; = 17.619,0947 phi-Articles + 17.301 Articles)');
  approx(f.totals.paid, 4006.6126741099943, 'Paid tổng snapshot (trước: 3.382,8341; delta = 608 Paid Articles + 15,7786 ΔPaid Email)');
});

// ---------- UI: lưới Phase + đường lưu ----------
test('SEO [UI static]: lưới Phase của Website Articles — 4 field khóa không render input, có nhãn Mô hình SEO; paid_to_b2b không nằm trong danh sách khóa (field đã bỏ khỏi lưới Phase theo mô hình 18/11)', () => {
  const block = section(appSrc, 'function planningPhaseBlockHtml(phase, rows, benchmarks, editable, disAttr)', '// --- 3 bảng KPI chi tiết theo tháng (chế độ Theo tháng) ---');
  assert.match(block, /isSeoArticlesChannel\(ch\)/, 'khối Phase phải nhận diện kênh Website Articles');
  assert.match(block, /data-seo-articles-locked="views_per_unit"/, 'ô Views mỗi bài của Articles là ô khóa chỉ đọc');
  assert.match(block, /data-phase-seo-views-note="1">Mô hình SEO — tính tự động/, 'nhãn Mô hình SEO ở ô Views');
  assert.match(block, /SEO_ARTICLES_LOCKED_RATE_FIELDS\.indexOf\(rh\[0\]\) !== -1/, '3 tỉ lệ phễu khóa theo danh sách field');
  assert.match(block, /data-seo-articles-locked="[^"]*esc\(rh\[0\]\)/, 'ô tỉ lệ khóa render dạng chỉ đọc theo field');
  assert.match(block, /data-phase-seo-note="1">Mô hình SEO: 350 view tối đa\/bài · \+250 view seeding\/bài mới · CR 5% → Free user · Paid = 3,5% × Free/, 'dòng ghi chú hằng số mô hình ở dòng kênh');
  // paid_to_b2b KHÔNG nằm trong danh sách khóa (và không còn là field
  // tỉ lệ của lưới Phase nói chung — PHASE_RATE_FIELDS chỉ còn 3 tỉ lệ phễu):
  assert.match(appSrc, /var SEO_ARTICLES_LOCKED_RATE_FIELDS = \['view_to_visit', 'visit_to_freemium', 'freemium_to_paid'\];/);
  assert.match(appSrc, /var PHASE_RATE_FIELDS = \['view_to_visit', 'visit_to_freemium', 'freemium_to_paid'\];/);
});

test('SEO [UI static]: đường lưu bỏ qua field khóa của Website Articles (savePhaseRate + savePhaseViews)', () => {
  const rate = section(appSrc, 'function savePhaseRate(phaseId, channel, field, raw)', 'function savePhaseViews(phaseId, channel, raw)');
  assert.match(rate, /isSeoArticlesChannel\(channel\) && SEO_ARTICLES_LOCKED_RATE_FIELDS\.indexOf\(field\) !== -1\) \{ render\(\); return; \}/, 'savePhaseRate phải bỏ qua 3 tỉ lệ khóa của Articles');
  const views = section(appSrc, 'function savePhaseViews(phaseId, channel, raw)', 'function savePhaseQty(phaseId, channel, raw)');
  assert.match(views, /isSeoArticlesChannel\(channel\)\) \{ render\(\); return; \}/, 'savePhaseViews phải bỏ qua kênh Articles');
});

test('SEO [UI render]: render thật khối Phase — dòng Website Articles không có input phase-views/3 tỉ lệ khóa và không còn input paid_to_b2b (đã bỏ khỏi lưới), vẫn có input qty; kênh khác vẫn có đủ input', async () => {
  // Harness theo mẫu tests/planning-count-int-display.test.mjs:
  // helpers Brand+Planning + khối Theo phase với stub Store/D/UI.
  const helpers = section(appSrc, '// ---------- Brand + Planning: ngữ cảnh Brand / Segment toàn cục ----------', 'function canSettings()');
  const phaseBlock = section(appSrc, '// ---------- Planning Theo phase (Phase + Uplift, bổ sung) ----------', '// ---------- Brand Hub ----------');
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
  const rows = [
    { id: 'r-art', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Website Articles', group: 'Content', qty: 8, budget: null, phase_id: 'ph-1' },
    { id: 'r-kol', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL Nano', group: 'KOL', qty: 4, budget: null, phase_id: 'ph-1', unit_price: 1500000 }
  ];
  const phases = [{ id: 'ph-1', brand_id: 'b1', name: 'Preparation', start_month: '2027-01', end_month: '2027-01', uplift_percent_per_month: 0 }];
  const benchmarks = [
    { brand_id: 'b1', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.003, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, direct_budget: false },
    { brand_id: 'b1', channel: 'Website Articles', output_per_unit: 100, view_to_visit: 0.01, visit_to_freemium: 0.1, freemium_to_paid: 0.02, paid_to_b2b: 0.03, direct_budget: false }
  ];
  const UI = { brandFilter: 'all', segmentFilter: 'all', kpiPhaseFilter: 'all', planningKpiCollapsed: {}, planningPhaseCollapsed: {} };
  const Store = { mode: 'demo', list: (coll) => (coll === 'plan_rows' ? rows : coll === 'phases' ? phases : coll === 'benchmarks' ? benchmarks : coll === 'phase_assumptions' ? [] : []), get: () => null };
  const factory = new Function('Store', 'D', 'UI', 'cfVal', 'canEdit', 'toast', 'render', 'sUpdate', 'sCreate', 'saveResult', 'esc', 'fmtNum', 'fmtMoney', 'tbl', 'vizMonthLabel', 'vizFunnelHtml',
    helpers + '\n' + phaseBlock + '\nreturn { planningPhaseBlockHtml: planningPhaseBlockHtml };');
  const h = factory(Store, domain, UI, cfValStub, () => true, () => {}, () => {}, () => ({ ok: true }), () => ({ ok: true }), (r, ok) => { if (r && r.ok && ok) ok(r); },
    escStub, fmtNumStub, fmtMoneyStub,
    (inner, key) => '<div class="table-wrap"><table data-table-key="' + key + '">' + inner + '</table></div>',
    (m) => 'Tháng ' + Number(String(m).slice(5, 7)) + '/' + String(m).slice(0, 4),
    () => '<div data-viz-stub="funnel"></div>');
  const html = h.planningPhaseBlockHtml(phases[0], rows, benchmarks, true, '');
  const rowOf = (ch) => {
    const m = new RegExp('<tr data-planning-phase-channel="' + ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">([\\s\\S]*?)</tr>').exec(html);
    assert.ok(m, 'phải có dòng kênh ' + ch);
    return m[1];
  };
  const art = rowOf('Website Articles');
  assert.ok(!art.includes('data-action-change="phase-views"'), 'Articles: không có input Views mỗi bài');
  for (const f of ['view_to_visit', 'visit_to_freemium', 'freemium_to_paid']) {
    assert.ok(!art.includes('data-field="' + f + '"'), 'Articles: không có input tỉ lệ ' + f);
    assert.ok(art.includes('data-seo-articles-locked="' + f + '"'), 'Articles: ô khóa chỉ đọc cho ' + f);
  }
  assert.ok(!art.includes('data-field="paid_to_b2b"'), 'Articles: không còn input paid_to_b2b (field tỉ lệ theo Channel đã bỏ khỏi lưới Phase 18/11)');
  assert.ok(art.includes('data-action-change="phase-qty"'), 'Articles: vẫn có input Số lượng');
  assert.ok(art.includes('Mô hình SEO — tính tự động'), 'Articles: nhãn Mô hình SEO');
  assert.ok(art.includes('350 view tối đa/bài'), 'Articles: ghi chú hằng số mô hình');
  const kol = rowOf('KOL Nano');
  assert.ok(kol.includes('data-action-change="phase-views"'), 'KOL Nano: vẫn có input Views mỗi bài như cũ');
  assert.ok(kol.includes('data-field="view_to_visit"'), 'KOL Nano: vẫn có input tỉ lệ như cũ');
  assert.ok(!kol.includes('data-field="paid_to_b2b"'), 'KOL Nano: cũng không còn input paid_to_b2b');
});

test('SEO [static domain]: forecastFunnel có đường riêng Articles trước đường content thường; Email vẫn 2 lượt', () => {
  const funnel = section(domainSrc, 'function forecastFunnel(rows, benchmarks, ctx)', 'function _manualUnitPriceRaw(r)');
  assert.match(funnel, /_isSeoArticlesRow\(r\)/, 'forecastFunnel phải có nhánh Website Articles');
  assert.match(funnel, /seoSeriesByBrand/, 'cohort Articles tính theo series Brand × tháng');
  const idxSeo = funnel.indexOf('if (_isSeoArticlesRow(r))');
  const idxContent = funnel.indexOf('var qty = _planQty(r);');
  assert.ok(idxSeo !== -1 && idxContent !== -1 && idxSeo < idxContent, 'nhánh Articles phải đứng trước đường content thường');
});
