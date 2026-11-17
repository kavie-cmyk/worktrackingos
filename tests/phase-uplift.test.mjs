// tests/phase-uplift.test.mjs
// Phase + Uplift (bổ sung Brand + Planning, 17/11/2026) — Executor A2.
// Bao phủ: demo-data (brand phases trong collection `phases`,
// phase_assumptions, plan_rows.phase_id, kpis.phase_id), forecast engine
// v2 (effectiveRate, uplift lũy kế, assumption override benchmark,
// top_funnel_override, byPhase) và hợp đồng store cho phase_assumptions.
// Ca neo bắt buộc: effectiveRate(0.003, 10, 2) = 0,00363; chuỗi forecast
// có uplift tính tay; ca neo v1 KOL Nano 2027-01 giữ nguyên.

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
    assert.equal(a.top_funnel_override, null);
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
  // Fixture: output 1000, tỉ lệ 0,01 / 0,1 / 0,5 / 0,2; phase bắt đầu
  // 2027-01 uplift 10; row 2027-03 qty 2 -> n=2, hệ số 1,1^2 = 1,21.
  // views = 2 x 1000 = 2000 (uplift KHÔNG áp vào qty/output)
  // visits = 2000 x (0,01x1,21=0,0121) = 24,2
  // signups = 24,2 x (0,1x1,21=0,121) = 2,9282
  // first = 2,9282 x (0,5x1,21=0,605) = 1,771561
  // paid = 1,771561 x (0,2x1,21=0,242) = 0,428717762
  const benchmarks = [{ brand_id: 'b1', channel: 'X', output_per_unit: 1000, view_to_visit: 0.01, visit_to_signup: 0.1, signup_to_first: 0.5, first_to_paid: 0.2, direct_budget: false }];
  const phases = [{ id: 'ph-test', brand_id: 'b1', name: 'T', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 10 }];
  const rows = [{ id: 'r1', brand_id: 'b1', month: '2027-03', channel: 'X', qty: 2 }];
  const f = domain.forecastFunnel(rows, benchmarks, { phases });
  const fc = f.rows[0].forecast;
  assert.ok(fc);
  assert.equal(f.rows[0].phase_id, 'ph-test', 'phase suy theo brand + khoảng tháng');
  approx(fc.views, 2000, 'views');
  approx(fc.visits, 24.2, 'visits');
  approx(fc.signups, 2.9282, 'signups');
  approx(fc.first, 1.771561, 'first');
  approx(fc.paid, 0.428717762, 'paid');
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
  const assumptions = [{ phase_id: 'ph-a', channel: 'X', view_to_visit: 0.02, visit_to_signup: null, signup_to_first: null, first_to_paid: null, top_funnel_override: null }];
  const f = domain.forecastFunnel([{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'X', qty: 1 }], benchmarks, { phases, phaseAssumptions: assumptions });
  const fc = f.rows[0].forecast;
  approx(fc.views, 1000, 'views');
  approx(fc.visits, 20, 'visits dùng assumption 0,02');
  approx(fc.signups, 2, 'signups kế thừa benchmark 0,1');
  approx(fc.first, 1, 'first');
  approx(fc.paid, 0.2, 'paid');
});

test('PU [domain]: byPhase = tổng đúng các row thuộc phase (cộng từ cùng kết quả rows)', () => {
  const f = domain.forecastFunnel(demo.plan_rows, demo.benchmarks, CTX);
  // Cộng tay từ rows[] theo phase_id đã suy.
  const manual = {};
  for (const r of f.rows) {
    if (!r.forecast || !r.phase_id) continue;
    const m = manual[r.phase_id] || (manual[r.phase_id] = { views: 0, visits: 0, signups: 0, first: 0, paid: 0, rowCount: 0 });
    m.views += r.forecast.views; m.visits += r.forecast.visits; m.signups += r.forecast.signups;
    m.first += r.forecast.first; m.paid += r.forecast.paid; m.rowCount += 1;
  }
  assert.deepEqual(Object.keys(f.byPhase).sort(), Object.keys(manual).sort());
  for (const pid of Object.keys(manual)) {
    for (const k of ['views', 'visits', 'signups', 'first', 'paid']) approx(f.byPhase[pid][k], manual[pid][k], `byPhase ${pid}.${k}`);
    assert.equal(f.byPhase[pid].rowCount, manual[pid].rowCount);
    assert.equal(f.byPhase[pid].phase_id, pid);
  }
  // Tổng byPhase = totals toàn cục (mọi row có forecast đều thuộc 1 phase Lumus).
  for (const k of ['views', 'visits', 'signups', 'first', 'paid']) {
    approx(Object.values(f.byPhase).reduce((s, p) => s + p[k], 0), f.totals[k], `sum byPhase ${k} = totals`);
  }
  // GĐ1 (uplift 0): views KOL T1–T2 = (4+6)x4000 + (4+5)x15000 + (1+1)x25000.
  approx(f.byPhase['phase-lumus-1'].views, 40000 + 135000 + 50000, 'GĐ1 views');
  // SỬA PHẠM VI đợt Paid Objective: GĐ1 có 8 row Paid có forecast —
  // mỗi tháng T1–T2, Meta + TikTok mỗi kênh có 2 dòng Objective tính
  // được (Traffic + Signup; Awareness chưa có đơn giá -> null,
  // Remarketing Phase 1 ngân sách 0 nên không có dòng) -> 6 + 8 = 14.
  assert.equal(f.byPhase['phase-lumus-1'].rowCount, 14, 'GĐ1: 6 row KOL + 8 row Paid Objective có forecast');
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
    approx(fc.signups, 4.32, 'signups');
    approx(fc.first, 2.16, 'first');
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

test('PU [domain]: top_funnel_override phân bổ theo qty, tổng đúng bằng override (largest remainder)', () => {
  const benchmarks = [{ brand_id: 'b1', channel: 'Y', output_per_unit: 100, view_to_visit: 0.1, visit_to_signup: 0.1, signup_to_first: 0.1, first_to_paid: 0.1, direct_budget: false }];
  const phases = [{ id: 'ph-ov', brand_id: 'b1', start_month: '2027-01', end_month: '2027-03', uplift_percent_per_month: 0 }];
  const mkRows = (qtys) => qtys.map((q, i) => ({ id: `r${i}`, brand_id: 'b1', month: `2027-0${i + 1}`, channel: 'Y', qty: q, phase_id: 'ph-ov' }));
  // Tỉ lệ theo qty 1:3:0 với override 1000 -> 250 / 750 / 0.
  let assumptions = [{ phase_id: 'ph-ov', channel: 'Y', view_to_visit: null, visit_to_signup: null, signup_to_first: null, first_to_paid: null, top_funnel_override: 1000 }];
  let f = domain.forecastFunnel(mkRows([1, 3, 0]), benchmarks, { phases, phaseAssumptions: assumptions });
  assert.deepEqual(f.rows.map((r) => r.forecast.views), [250, 750, 0]);
  approx(f.totals.views, 1000, 'tổng = override');
  // Largest remainder: override 100 chia 3 row qty bằng nhau -> 34/33/33.
  assumptions = [{ ...assumptions[0], top_funnel_override: 100 }];
  f = domain.forecastFunnel(mkRows([1, 1, 1]), benchmarks, { phases, phaseAssumptions: assumptions });
  assert.deepEqual(f.rows.map((r) => r.forecast.views), [34, 33, 33]);
  approx(f.totals.views, 100, 'tổng vẫn đúng override');
  // Mọi qty đều 0 -> chia đều theo số row.
  assumptions = [{ ...assumptions[0], top_funnel_override: 90 }];
  f = domain.forecastFunnel(mkRows([0, 0]), benchmarks, { phases, phaseAssumptions: assumptions });
  assert.deepEqual(f.rows.map((r) => r.forecast.views), [45, 45]);
});

test('PU [domain]: không benchmark — assumption đủ tỉ lệ CHỈ tính được khi có top_funnel_override', () => {
  const phases = [{ id: 'ph-z', brand_id: 'b1', start_month: '2027-01', end_month: '2027-12', uplift_percent_per_month: 0 }];
  const rows = [{ id: 'r', brand_id: 'b1', month: '2027-01', channel: 'Z', qty: 5, phase_id: 'ph-z' }];
  const base = { phase_id: 'ph-z', channel: 'Z', view_to_visit: 0.2, visit_to_signup: 0.5, signup_to_first: 0.5, first_to_paid: 0.4, top_funnel_override: null };
  const noOv = domain.forecastFunnel(rows, [], { phases, phaseAssumptions: [base] });
  assert.equal(noOv.rows[0].forecast, null, 'thiếu đầu phễu -> null, không bịa');
  const withOv = domain.forecastFunnel(rows, [], { phases, phaseAssumptions: [{ ...base, top_funnel_override: 500 }] });
  const fc = withOv.rows[0].forecast;
  assert.ok(fc);
  approx(fc.views, 500, 'views = override');
  approx(fc.visits, 100, 'visits');
  approx(fc.signups, 50, 'signups');
  approx(fc.first, 25, 'first');
  approx(fc.paid, 10, 'paid');
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

// ---------------------------------------------------------------- store
test('PU [store]: COLLECTIONS có phase_assumptions; chế độ thật an toàn (không ánh xạ bảng)', () => {
  assert.ok(Store.COLLECTIONS.includes('phase_assumptions'));
  assert.ok(Store.COLLECTIONS.includes('phases'), 'phases vốn đã có từ trước');
  assert.equal(core.COLLECTION_TO_TABLE.phase_assumptions, undefined, 'phase_assumptions chưa được có bảng ở bản bấm thử');
  return Store._loadCollection('phase_assumptions').then(() => {
    assert.deepEqual(Store.state.phase_assumptions, []);
  });
});
