// tests/phase-uplift.test.mjs
// Phase + Uplift (bổ sung Brand + Planning, 17/11/2026) — Executor A2.
// Bao phủ: demo-data (brand phases trong collection `phases`,
// phase_assumptions, plan_rows.phase_id, kpis.phase_id), forecast engine
// v2 (effectiveRate, uplift lũy kế, assumption override benchmark,
// views_per_unit, byPhase) và hợp đồng store cho phase_assumptions.
// Ca neo bắt buộc: effectiveRate(0.003, 10, 2) = 0,00363; chuỗi forecast
// có uplift tính tay; ca neo v1 KOL Nano 2027-01 giữ nguyên.
// CĂN CHỈNH PHỄU Freemium/Paid: forecast dùng key freemium (bỏ
// signups/first); tỉ lệ benchmark key cũ đi qua fallback của engine
// (v2f = visit_to_signup; f2p = signup_to_first x first_to_paid).
// Hệ quả cơ học: uplift lũy kế nay áp 2 lần trên chuỗi dưới views
// (v2f và f2p GỘP) thay vì 3 lần (v2s/s2f/f2p riêng) như phễu cũ —
// ca uplift tính tay dưới đây đã tính lại theo đúng cơ chế mới.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { moneyContract } from './fixtures/money-contract.mjs';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');
const core = require('../js/store-core.js');
const Store = require('../js/store.js');

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

// Seed SAVA CAMP 01 (17/11): plan_rows nay gồm cả dòng SAVA META 2026 — các neo
// Lumus dưới đây lọc đúng brand-lumus-ai (144 dòng FY2027) thay vì toàn bộ plan_rows.
const lumusRows = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
const brandPhases = demo.phases.filter((p) => p.brand_id);
const lumusPhases = brandPhases.filter((p) => p.brand_id === 'brand-lumus-ai');
const savaPhases = brandPhases.filter((p) => p.brand_id === 'brand-sava-meta');
const CTX = { phases: brandPhases, phaseAssumptions: demo.phase_assumptions };

// ---------------------------------------------------------------- demo-data
test('PU [demo]: phases — demo chỉ còn 7 brand phase (5 phase campaign của fixture tiền đã gỡ sang fixture ẩn), phân biệt bằng brand_id/start_month', () => {
  const campPhases = demo.phases.filter((p) => p.campaignId);
  assert.equal(campPhases.length, 0);
  assert.equal(brandPhases.length, 7);
  // Brand phase không mang campaignId -> không lẫn vào lọc campaign của app.
  assert.ok(brandPhases.every((p) => p.campaignId === undefined));
  assert.ok(brandPhases.every((p) => /^\d{4}-\d{2}$/.test(p.start_month) && /^\d{4}-\d{2}$/.test(p.end_month)));
  const ids = demo.phases.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id phase không được trùng');
});

test('PU [demo]: Lumus 4 phase đúng tên/khoảng tháng/uplift đã chốt', () => {
  assert.equal(lumusPhases.length, 4);
  const byId = Object.fromEntries(lumusPhases.map((p) => [p.id, p]));
  const expect = {
    'phase-lumus-1': ['Preparation', '2027-01', '2027-02', 0],
    'phase-lumus-2': ['Test & Validate', '2027-03', '2027-05', 5],
    'phase-lumus-3': ['Optimize & Grow', '2027-06', '2027-09', 5],
    'phase-lumus-4': ['Scale & Convert', '2027-10', '2027-12', 3]
  };
  for (const [id, [name, sm, em, up]] of Object.entries(expect)) {
    assert.ok(byId[id], `thiếu ${id}`);
    assert.equal(byId[id].name, name);
    assert.equal(byId[id].start_month, sm);
    assert.equal(byId[id].end_month, em);
    assert.equal(byId[id].uplift_percent_per_month, up);
    assert.ok(byId[id].objective, `${id} phải có objective`);
  }
});

test('PU [demo]: SAVA 3 phase PLAY/BUILD/CREATE — segment + campaign_id + khoảng tháng theo file IMC', () => {
  assert.equal(savaPhases.length, 3);
  const byId = Object.fromEntries(savaPhases.map((p) => [p.id, p]));
  assert.equal(byId['phase-sava-play'].name, 'PLAY THE UNKNOWN');
  assert.equal(byId['phase-sava-play'].segment, 'b2c');
  assert.equal(byId['phase-sava-play'].campaign_id, 'camp-play-unknown');
  assert.equal(byId['phase-sava-play'].start_month, '2026-10');
  assert.equal(byId['phase-sava-play'].end_month, '2026-11');
  assert.equal(byId['phase-sava-build'].name, 'BUILD THE UNKNOWN');
  assert.equal(byId['phase-sava-build'].segment, 'b2b');
  assert.equal(byId['phase-sava-build'].campaign_id, 'camp-build-unknown');
  assert.equal(byId['phase-sava-build'].start_month, '2026-11');
  assert.equal(byId['phase-sava-build'].end_month, '2027-01');
  // CREATE: T2–T3/2027 theo sheet KPI & Budget của file IMC; campaign demo
  // camp-create-unknown đã được seed (tổng 49.349.500đ) nên campaign_id trỏ tới đó.
  assert.equal(byId['phase-sava-create'].name, 'CREATE THE UNKNOWN');
  assert.equal(byId['phase-sava-create'].campaign_id, 'camp-create-unknown');
  assert.equal(byId['phase-sava-create'].start_month, '2027-02');
  assert.equal(byId['phase-sava-create'].end_month, '2027-03');
  // Uplift SAVA là số mẫu nhỏ 0–3%.
  for (const p of savaPhases) {
    assert.ok(p.uplift_percent_per_month >= 0 && p.uplift_percent_per_month <= 3, `${p.id} uplift mẫu phải trong 0–3%`);
  }
});

test('PU [demo]: phase_assumptions đủ 3 KOL x 4 phase Lumus, toàn bộ null (kế thừa benchmark)', () => {
  assert.equal(demo.phase_assumptions.length, 12);
  const keys = new Set(demo.phase_assumptions.map((a) => `${a.phase_id}|${a.channel}`));
  for (const pid of ['phase-lumus-1', 'phase-lumus-2', 'phase-lumus-3', 'phase-lumus-4']) {
    for (const ch of ['KOL Nano', 'KOL Micro', 'KOL Expert']) {
      assert.ok(keys.has(`${pid}|${ch}`), `thiếu assumption ${pid} x ${ch}`);
    }
  }
  for (const a of demo.phase_assumptions) {
    assert.equal(a.view_to_visit, null);
    assert.equal(a.visit_to_signup, null);
    assert.equal(a.signup_to_first, null);
    assert.equal(a.first_to_paid, null);
    assert.equal(a.views_per_unit, null);
    // Key MỚI của phễu Freemium cũng phải trống (null hoặc chưa khai) —
    // engine fallback đọc key cũ null là đủ để kế thừa benchmark.
    assert.ok(a.visit_to_freemium === null || a.visit_to_freemium === undefined, 'visit_to_freemium phải trống');
    assert.ok(a.freemium_to_paid === null || a.freemium_to_paid === undefined, 'freemium_to_paid phải trống');
  }
});

test('PU [demo]: plan_rows Lumus 216 dòng đều có phase_id suy từ khoảng tháng (kể cả Paid Ads — SỬA PHẠM VI đợt Paid Objective)', () => {
  assert.equal(lumusRows.length, 216);
  const expected = (m) => (m <= '2027-02' ? 'phase-lumus-1' : m <= '2027-05' ? 'phase-lumus-2' : m <= '2027-09' ? 'phase-lumus-3' : 'phase-lumus-4');
  for (const r of lumusRows) assert.equal(r.phase_id, expected(r.month), `${r.id} sai phase`);
  assert.ok(lumusRows.filter((r) => r.channel === 'Meta Ads').every((r) => r.phase_id));
  assert.ok(lumusRows.filter((r) => r.channel === 'TikTok Ads').every((r) => r.phase_id));
  // Dòng SAVA CAMP 01 (seed 17/11) gắn phase-sava-play.
  assert.ok(demo.plan_rows.filter((r) => r.brand_id === 'brand-sava-meta').every((r) => r.phase_id === 'phase-sava-play'));
});

test('PU [fixture ẩn]: KPI Lumus (camp-live) đều có phase_id, trải đủ GĐ1–GĐ4', () => {
  const lumusKpis = moneyContract.kpis.filter((k) => k.brand_id === 'brand-lumus-ai');
  assert.equal(lumusKpis.length, 6);
  const valid = new Set(['phase-lumus-1', 'phase-lumus-2', 'phase-lumus-3', 'phase-lumus-4']);
  for (const k of lumusKpis) assert.ok(valid.has(k.phase_id), `${k.id} thiếu phase_id hợp lệ`);
  assert.deepEqual(new Set(lumusKpis.map((k) => k.phase_id)), valid, 'phải trải đủ 4 phase');
});

// ---------------------------------------------------------------- effectiveRate
test('PU [domain]: effectiveRate CA NEO (0.003, 10, 2) = 0,00363 + các biên', () => {
  approx(domain.effectiveRate(0.003, 10, 2), 0.00363, 'ca neo');
  approx(domain.effectiveRate(0.003, 10, 0), 0.003, 'n=0 không đổi');
  approx(domain.effectiveRate(0.003, 0, 5), 0.003, 'uplift 0 không đổi');
  approx(domain.effectiveRate(0.5, 5, 1), 0.525, 'n=1');
  assert.equal(domain.effectiveRate(null, 10, 2), null);
  approx(domain.effectiveRate(0.003, null, 2), 0.003, 'uplift thiếu -> 0');
  approx(domain.effectiveRate(0.003, 10, -3), 0.003, 'n âm -> 0');
});

// ---------------------------------------------------------------- forecast v2
test('PU [domain]: forecast CÓ uplift — chuỗi tính tay (n=2, uplift 10%/tháng)', () => {
  // Fixture: output 1000, tỉ lệ key CŨ 0,01 / 0,1 / 0,5 / 0,2; phase
  // bắt đầu 2027-01 uplift 10; row 2027-03 qty 2 -> n=2, hệ số
  // 1,1^2 = 1,21 cho MỖI tỉ lệ hiệu dụng của phễu mới.
  // views = 2 x 1000 = 2000 (uplift KHÔNG áp vào qty/output)
  // visits = 2000 x (0,01x1,21=0,0121) = 24,2
  // v2f fallback = visit_to_signup 0,1 -> uplift 0,121
  // freemium = 24,2 x 0,121 = 2,9282
  // f2p fallback GỘP = 0,5 x 0,2 = 0,1 -> uplift 0,121 (áp MỘT lần
  // trên tỉ lệ gộp, không còn áp riêng cho signup_to_first/first_to_paid)
  // paid = 2,9282 x 0,121 = 0,3543122
  const benchmarks = [{ brand_id: 'b1', channel: 'X', output_per_unit: 1000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false }];
  const phases = [{ id: 'ph-test', brand_id: 'b1', name: 'T', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 10 }];
  const rows = [{ id: 'r1', brand_id: 'b1', month: '2027-03', channel: 'X', qty: 2 }];
  const f = domain.forecastFunnel(rows, benchmarks, { phases });
  const fc = f.rows[0].forecast;
  assert.ok(fc);
  assert.equal(f.rows[0].phase_id, 'ph-test', 'phase suy theo brand + khoảng tháng');
  approx(fc.views, 2000, 'views');
  approx(fc.visits, 24.2, 'visits');
  approx(fc.freemium, 2.9282, 'freemium');
  approx(fc.paid, 0.3543122, 'paid');
  // Tháng đầu phase n=0 -> không uplift.
  const f0 = domain.forecastFunnel([{ id: 'r0', brand_id: 'b1', month: '2027-01', channel: 'X', qty: 2 }], benchmarks, { phases });
  approx(f0.rows[0].forecast.visits, 20, 'n=0 visits');
  approx(f0.rows[0].forecast.paid, 0.2, 'n=0 paid');
});

test('PU [domain]: row.phase_id được ưu tiên hơn khớp theo tháng khi hai phase chồng khoảng', () => {
  const benchmarks = [{ brand_id: 'b1', channel: 'X', output_per_unit: 1000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false }];
  const phases = [
    { id: 'ph-a', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0 },
    { id: 'ph-b', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 10 }
  ];
  const withId = domain.forecastFunnel([{ id: 'r', brand_id: 'b1', month: '2027-03', channel: 'X', qty: 2, phase_id: 'ph-b' }], benchmarks, { phases });
  assert.equal(withId.rows[0].phase_id, 'ph-b');
  approx(withId.rows[0].forecast.visits, 24.2, 'theo phase_id uplift 10');
  const noId = domain.forecastFunnel([{ id: 'r', brand_id: 'b1', month: '2027-03', channel: 'X', qty: 2 }], benchmarks, { phases });
  assert.equal(noId.rows[0].phase_id, 'ph-a', 'không phase_id -> khớp tháng lấy phase đầu tiên hợp lệ');
  approx(noId.rows[0].forecast.visits, 20, 'không uplift');
});

test('PU [domain]: assumption khác null ghi đè benchmark theo từng bước; null thì kế thừa', () => {
  const benchmarks = [{ brand_id: 'b1', channel: 'X', output_per_unit: 1000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false }];
  const phases = [{ id: 'ph-a', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0 }];
  const assumptions = [{ phase_id: 'ph-a', channel: 'X', view_to_visit: 0.02, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: null }];
  const f = domain.forecastFunnel([{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'X', qty: 1 }], benchmarks, { phases, phaseAssumptions: assumptions });
  const fc = f.rows[0].forecast;
  approx(fc.views, 1000, 'views');
  approx(fc.visits, 20, 'visits dùng assumption 0,02');
  approx(fc.freemium, 2, 'freemium kế thừa benchmark (v2f fallback 0,1)');
  approx(fc.paid, 0.2, 'paid = freemium x f2p gộp (0,5 x 0,2)');
});

test('PU [domain]: byPhase = tổng đúng các row thuộc phase (cộng từ cùng kết quả rows)', () => {
  const f = domain.forecastFunnel(demo.plan_rows, demo.benchmarks, CTX);
  // Cộng tay từ rows[] theo phase_id đã suy.
  const manual = {};
  for (const r of f.rows) {
    if (!r.forecast || !r.phase_id) continue;
    const m = manual[r.phase_id] || (manual[r.phase_id] = { views: 0, visits: 0, freemium: 0, paid: 0, rowCount: 0 });
    m.views += r.forecast.views; m.visits += r.forecast.visits; m.freemium += r.forecast.freemium;
    m.paid += r.forecast.paid; m.rowCount += 1;
  }
  assert.deepEqual(Object.keys(f.byPhase).sort(), Object.keys(manual).sort());
  for (const pid of Object.keys(manual)) {
    for (const k of ['views', 'visits', 'freemium', 'paid']) approx(f.byPhase[pid][k], manual[pid][k], `byPhase ${pid}.${k}`);
    assert.equal(f.byPhase[pid].rowCount, manual[pid].rowCount);
    assert.equal(f.byPhase[pid].phase_id, pid);
  }
  // Tổng byPhase = totals toàn cục (mọi row có forecast đều thuộc 1 phase Lumus).
  for (const k of ['views', 'visits', 'freemium', 'paid']) {
    approx(Object.values(f.byPhase).reduce((s, p) => s + p[k], 0), f.totals[k], `sum byPhase ${k} = totals`);
  }
  // GĐ1 (uplift 0): views KOL T1–T2 = (4+6)x4000 + (4+5)x15000 + (1+1)x25000
  // + opens Email T2 = 48,9717 (đợt Email 18/11: T1 opens 0 vì list 0;
  // T2 list = freemium − paid T1 của kênh khác = 81,6194 -> opens =
  // 81,6194 × 0,30 × 2 lượt gửi).
  approx(f.byPhase['phase-lumus-1'].views, 40000 + 135000 + 50000 + 48.971669727272726, 'GĐ1 views (KOL + opens Email T2)');
  // SỬA PHẠM VI đợt Paid Objective: GĐ1 có 8 row Paid có forecast —
  // mỗi tháng T1–T2, Meta + TikTok mỗi kênh có 2 dòng Objective tính
  // được (Traffic + Signup; Awareness chưa có đơn giá -> null,
  // Remarketing Phase 1 ngân sách 0 nên không có dòng) -> 6 + 8 = 14.
  // Đợt Email 18/11: +2 row Email Sends (T1 + T2) có forecast -> 16.
  assert.equal(f.byPhase['phase-lumus-1'].rowCount, 16, 'GĐ1: 6 row KOL + 8 row Paid Objective + 2 row Email có forecast');
  // Bỏ phase_id trên row -> khớp theo tháng phải cho cùng byPhase.
  const stripped = demo.plan_rows.map((r) => ({ ...r, phase_id: undefined }));
  const f2 = domain.forecastFunnel(stripped, demo.benchmarks, CTX);
  for (const pid of Object.keys(f.byPhase)) approx(f2.byPhase[pid].paid, f.byPhase[pid].paid, `khớp tháng ${pid}.paid`);
});

test('PU [domain]: ca neo v1 giữ nguyên khi KHÔNG truyền ctx và khi CÓ ctx (GĐ1 uplift 0)', () => {
  const nanoJan = demo.plan_rows.find((r) => r.channel === 'KOL Nano' && r.month === '2027-01');
  for (const f of [domain.forecastFunnel([nanoJan], demo.benchmarks), domain.forecastFunnel([nanoJan], demo.benchmarks, CTX)]) {
    const fc = f.rows[0].forecast;
    approx(fc.views, 16000, 'views');
    approx(fc.visits, 48, 'visits');
    approx(fc.freemium, 4.32, 'freemium');
    approx(fc.paid, 0.1188, 'paid');
  }
  const withCtx = domain.forecastFunnel([nanoJan], demo.benchmarks, CTX);
  assert.equal(withCtx.rows[0].phase_id, 'phase-lumus-1');
  approx(withCtx.byPhase['phase-lumus-1'].views, 16000, 'byPhase GĐ1 views');
  // Row không phase_id + không ctx -> phase_id null, byPhase rỗng.
  const plain = domain.forecastFunnel([{ id: 'x', brand_id: 'brand-lumus-ai', month: '2027-01', channel: 'KOL Nano', qty: 4 }], demo.benchmarks);
  assert.equal(plain.rows[0].phase_id, null);
  assert.deepEqual(plain.byPhase, {});
});

test('PU [domain]: views_per_unit = Views MỖI BÀI của Phase — views tháng = qty × views_per_unit (đổi ngữ nghĩa 17/11/2026)', () => {
  // Ca kiểm bắt buộc: phase 2 tháng qty 4 và 5, benchmark output 4000,
  // views_per_unit đặt 5000 -> views 2 tháng = 20.000 / 25.000,
  // tổng phase 45.000 (KHÔNG còn phân bổ tổng phase theo qty như cũ).
  const benchmarks = [{ brand_id: 'b1', channel: 'KOL Nano', output_per_unit: 4000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false }];
  const phases = [{ id: 'ph-vpu', brand_id: 'b1', start_month: '2027-01', end_month: '2027-02', uplift_percent_per_month: 0 }];
  const rows = [
    { id: 'r1', brand_id: 'b1', month: '2027-01', channel: 'KOL Nano', qty: 4, phase_id: 'ph-vpu' },
    { id: 'r2', brand_id: 'b1', month: '2027-02', channel: 'KOL Nano', qty: 5, phase_id: 'ph-vpu' }
  ];
  const withVpu = [{ phase_id: 'ph-vpu', channel: 'KOL Nano', view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null, views_per_unit: 5000 }];
  let f = domain.forecastFunnel(rows, benchmarks, { phases, phaseAssumptions: withVpu });
  assert.deepEqual(f.rows.map((r) => r.forecast.views), [20000, 25000]);
  approx(f.totals.views, 45000, 'tổng phase = 45.000');
  approx(f.byPhase['ph-vpu'].views, 45000, 'byPhase = 45.000');
  // Uplift KHÔNG áp vào views_per_unit: phase uplift 10%/tháng vẫn
  // cho views y hệt (chỉ tỉ lệ chuyển đổi mới được uplift).
  const phasesUp = [{ ...phases[0], uplift_percent_per_month: 10 }];
  f = domain.forecastFunnel(rows, benchmarks, { phases: phasesUp, phaseAssumptions: withVpu });
  assert.deepEqual(f.rows.map((r) => r.forecast.views), [20000, 25000], 'uplift không áp vào views mỗi bài');
  // Xoá override (views_per_unit = null) -> về benchmark 4000:
  // 16.000 / 20.000.
  f = domain.forecastFunnel(rows, benchmarks, { phases, phaseAssumptions: [{ ...withVpu[0], views_per_unit: null }] });
  assert.deepEqual(f.rows.map((r) => r.forecast.views), [16000, 20000]);
  approx(f.totals.views, 36000, 'xoá override -> tổng về benchmark');
});

test('PU [domain]: không views_per_unit ở đâu -> mọi số neo cũ giữ nguyên', () => {
  // Toàn bộ phase_assumptions demo đều views_per_unit = null nên
  // forecast có ctx phải cho đúng ca neo v1 (KOL Nano T1/2027).
  const nanoJan = demo.plan_rows.find((r) => r.channel === 'KOL Nano' && r.month === '2027-01');
  const f = domain.forecastFunnel([nanoJan], demo.benchmarks, CTX);
  approx(f.rows[0].forecast.views, 16000, 'KOL Nano T1 views neo');
  approx(f.rows[0].forecast.paid, 0.1188, 'KOL Nano T1 paid neo');
  // Cùng phases (uplift giữ nguyên) nhưng BỎ HẲN assumptions so với
  // assumptions toàn null: kết quả phải giống hệt nhau — views_per_unit
  // null không được đổi bất kỳ số nào (kể cả views).
  const year = domain.forecastFunnel(lumusRows, demo.benchmarks, CTX);
  const yearNoAsm = domain.forecastFunnel(lumusRows, demo.benchmarks, { phases: brandPhases });
  assert.deepEqual(year.totals, yearNoAsm.totals, 'assumption toàn null -> totals bằng khi không có assumption');
  // Neo views cập nhật đợt Email 18/11: 1.460.000 (KOL) + 9.085,8553
  // opens Email (có uplift theo Phase như mọi tỉ lệ).
  approx(year.totals.views, 1469085.8552589684, 'tổng views Lumus (KOL + opens Email)');
});

test('PU [domain]: không benchmark — assumption đủ tỉ lệ CHỈ tính được khi có views_per_unit', () => {
  const phases = [{ id: 'ph-z', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0 }];
  const rows = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'Z', qty: 5, phase_id: 'ph-z' }];
  const base = { phase_id: 'ph-z', channel: 'Z', view_to_visit: 0.2, visit_to_signup: 0.5, signup_to_first: 0.5, first_to_paid: 0.4, views_per_unit: null };
  const noOv = domain.forecastFunnel(rows, [], { phases, phaseAssumptions: [base] });
  assert.equal(noOv.rows[0].forecast, null, 'thiếu Views mỗi bài -> null, không bịa');
  const withOv = domain.forecastFunnel(rows, [], { phases, phaseAssumptions: [{ ...base, views_per_unit: 100 }] });
  const fc = withOv.rows[0].forecast;
  assert.ok(fc);
  approx(fc.views, 500, 'views = qty 5 × views_per_unit 100');
  approx(fc.visits, 100, 'visits');
  approx(fc.freemium, 50, 'freemium');
  approx(fc.paid, 10, 'paid = freemium x f2p gộp (0,5 x 0,4)');
  // Không benchmark + không assumption -> null như v1.
  const none = domain.forecastFunnel(rows, [], { phases });
  assert.equal(none.rows[0].forecast, null);
});

test('PU [domain]: ctx rỗng / assumption vắng mặt -> hành vi v1 trên toàn bộ demo', () => {
  const v1 = domain.forecastFunnel(lumusRows, demo.benchmarks);
  const v2 = domain.forecastFunnel(lumusRows, demo.benchmarks, {});
  assert.deepEqual(v2.totals, v1.totals);
  assert.deepEqual(v2.byMonth, v1.byMonth);
  // planBudget / summarize không đổi hành vi (neo trên tập Lumus 216
  // dòng — SỬA PHẠM VI đợt Paid Objective: tổng ngân sách cộng thêm
  // 83.200.000đ của 2 kênh Paid B2B mới).
  assert.equal(domain.planBudget(lumusRows, demo.benchmarks).total, 65 * 1500000 + 60 * 5500000 + 12 * 30000000 + 546000000 + 182000000 + 41600000 + 41600000);
});

test('PU [domain]: uplift áp trên tỉ lệ MỚI + assumption key mới override benchmark key cũ (fallback theo từng key hiệu dụng)', () => {
  // Benchmark key MỚI: v2f 0,1 / f2p 0,1; phase uplift 10%, row ở
  // tháng thứ 3 của phase (n=2, hệ số 1,21 mỗi tỉ lệ):
  // views 2000 -> visits 2000 x 0,0121 = 24,2 -> freemium 24,2 x
  // (0,1x1,21) = 2,9282 -> paid 2,9282 x (0,1x1,21) = 0,3543122.
  const benchmarksNew = [{ brand_id: 'b1', channel: 'X', output_per_unit: 1000, view_to_visit: 0.01, visit_to_freemium: 0.1, freemium_to_paid: 0.1, direct_budget: false }];
  const phases = [{ id: 'ph-test', brand_id: 'b1', name: 'T', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 10 }];
  const rows = [{ id: 'r1', brand_id: 'b1', month: '2027-03', channel: 'X', qty: 2 }];
  const fc = domain.forecastFunnel(rows, benchmarksNew, { phases }).rows[0].forecast;
  approx(fc.freemium, 2.9282, 'freemium key mới + uplift');
  approx(fc.paid, 0.3543122, 'paid key mới + uplift');
  // Assumption mang freemium_to_paid MỚI (0,2) phải thắng benchmark
  // key cũ: benchmark cũ cho f2p gộp 0,5 x 0,2 = 0,1; nếu assumption
  // thắng thì paid (n=0, không uplift) = freemium 2 x 0,2 = 0,4.
  const benchmarksOld = [{ brand_id: 'b1', channel: 'X', output_per_unit: 1000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false }];
  const phases0 = [{ id: 'ph-a', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0 }];
  const assumptionsNew = [{ phase_id: 'ph-a', channel: 'X', view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.2, views_per_unit: null }];
  const fc2 = domain.forecastFunnel([{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'X', qty: 1 }], benchmarksOld, { phases: phases0, phaseAssumptions: assumptionsNew }).rows[0].forecast;
  approx(fc2.freemium, 1, 'freemium = 1000 x 0,01 x 0,1 (fallback v2f từ benchmark cũ)');
  approx(fc2.paid, 0.2, 'paid dùng freemium_to_paid của assumption (0,2), không dùng fallback gộp 0,1');
});

// ---------------------------------------------------------------- store
test('PU [store]: COLLECTIONS có phase_assumptions; 0017 đã có ánh xạ bảng phase_assumptions', () => {
  assert.ok(Store.COLLECTIONS.includes('phase_assumptions'));
  assert.ok(Store.COLLECTIONS.includes('phases'), 'phases vốn đã có từ trước');
  assert.equal(core.COLLECTION_TO_TABLE.phase_assumptions, 'phase_assumptions', 'phase_assumptions phải có bảng sau 0017');
  const q = { eq: () => q, order: () => q, range: () => Promise.resolve({ data: [{ id: '22222222-2222-4222-8222-222222222222', workspace_id: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6', phase_id: '11111111-1111-4111-8111-111111111111', channel: 'KOL Nano', view_to_visit: 0.003, created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z' }], error: null }) };
  const prevClient = Store.supabaseClient; const prevWs = Store.workspaceId;
  Store.supabaseClient = { from: () => ({ select: () => q }) };
  Store.workspaceId = 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6';
  return Store._loadCollection('phase_assumptions').then(() => {
    assert.equal(Store.state.phase_assumptions.length, 1);
    assert.equal(Store.state.phase_assumptions[0].channel, 'KOL Nano');
    Store.supabaseClient = prevClient; Store.workspaceId = prevWs;
  });
});
