// 0022 — Cầu nối Paid -> B2B THEO PHASE (Zac chốt 18/11/2026 23:15):
// BỎ tỉ lệ theo Channel paid_to_b2b / lead_to_account / demo_to_account
// (engine không đọc nữa; cột DB giữ dormant). Bridge của tháng:
//   bridge(m) = phases.b2b_bridge_rate (phân số; null -> 0)
//             x PaidEOM_pre(m)
//   PaidEOM_pre(m) = Paid đầu kỳ + New Paid(m) − Paid churn(m)
//   Paid EOM(m)    = PaidEOM_pre(m) − bridge(m)
//   bridge cộng vào New B2B Accounts của tháng m.
// File này khóa wiring của b2b_bridge_rate theo mẫu paid-price-0020:
//  - migration 0022: thêm cột phases.b2b_bridge_rate numeric(9,6),
//    KHÔNG drop cột nào (3 cột tỉ lệ Channel cũ giữ dormant).
//  - store-core: TABLE_COLUMNS.phases chứa b2b_bridge_rate; camelCase
//    b2bBridgeRate tự khớp, không cần alias; round-trip nguyên vẹn.
//  - app.js: ô nhập "Tỉ lệ Paid → B2B" (data-field="b2b_bridge_rate",
//    handler phase-operating-rate, hiển thị %, lưu phân số) ở khối
//    Phase; planningOperatingData map field từ Phase vào
//    inputsByMonth; PHASE_OPERATING_RATE_FIELDS có field.
//  - domain: công thức bridge ở trên qua cả 2 đường đọc (inputsByMonth
//    và input.phases); không nguồn tỉ lệ -> bridge = 0 KỂ CẢ khi
//    funnel/inputs còn mang lượng b2bBridge kiểu cũ (đường dự phòng
//    đã gỡ — micro-fix đợt 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../js/store-core.js');
const domain = require('../js/domain.js');
const demo = require('../js/demo-data.js');

const mig = readFileSync(new URL('../supabase/migrations/0022_phase_bridge_rate.sql', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function approx(actual, expected, label) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

const FULL = { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 47000, cogs_per_free_user: 10000, cogs_per_paid_user: 20000, fixed_cost: 200000, b2b_churn_rate: 0.04, arppu_b2b: 100000, cogs_per_b2b_account: 30000 };
const FUNNEL_1M = { '2027-01': { views: 5000, visits: 900, freemium: 210, paid: 10, b2b: 5 } };

test('0022 [migration]: thêm phases.b2b_bridge_rate numeric(9,6), không drop cột, 3 cột Channel cũ giữ dormant', () => {
  assert.match(mig, /alter table public\.phases\s+add column if not exists b2b_bridge_rate numeric\(9,6\)/);
  assert.ok(!/drop column/i.test(mig), 'migration 0022 không được chứa drop column');
  assert.match(mig, /comment on column public\.phases\.b2b_bridge_rate/);
  assert.match(mig, /dormant/, 'migration phải ghi rõ 3 cột tỉ lệ Channel cũ giữ dormant');
});

test('0022 [store-core]: TABLE_COLUMNS.phases chứa b2b_bridge_rate, ánh xạ camel tự khớp, round-trip nguyên vẹn', () => {
  assert.ok(Core.hasColumn('phases', 'b2b_bridge_rate'), 'phases thiếu cột b2b_bridge_rate');
  assert.ok(Core.TABLE_COLUMNS.phases.includes('b2b_bridge_rate'));
  assert.equal(Core.camelToSnake('b2bBridgeRate'), 'b2b_bridge_rate');
  assert.equal(Core.snakeToCamel('b2b_bridge_rate'), 'b2bBridgeRate');
  const aliases = Core.FIELD_ALIASES.phases || {};
  assert.ok(!('b2bBridgeRate' in aliases), 'không cần alias cho b2bBridgeRate');
  const payload = Core.toDbPayload('phases', { b2bBridgeRate: 0.01 }, { forInsert: true });
  assert.equal(payload.b2b_bridge_rate, 0.01);
  assert.equal(Core.fromDbRow('phases', payload).b2bBridgeRate, 0.01);
  // Xoá trắng ô = ghi null (bridge về 0) cũng phải qua được:
  assert.equal(Core.toDbPayload('phases', { b2b_bridge_rate: null }, {}).b2b_bridge_rate, null);
});

test('0022 [app static]: ô nhập Tỉ lệ Paid → B2B ở khối Phase + wiring planningOperatingData + PHASE_OPERATING_RATE_FIELDS', () => {
  assert.match(appSrc, /<label>Tỉ lệ Paid → B2B<input[^>]*data-action-change="phase-operating-rate" data-field="b2b_bridge_rate"/, 'khối Phase phải có ô nhập Tỉ lệ Paid → B2B ghi qua phase-operating-rate');
  assert.match(appSrc, /b2b_bridge_rate: phaseNumField\(ph, 'b2b_bridge_rate', 'b2bBridgeRate'\)/, 'planningOperatingData phải map b2b_bridge_rate từ Phase vào inputsByMonth');
  const m = appSrc.match(/PHASE_OPERATING_RATE_FIELDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m && m[1].includes("'b2b_bridge_rate'"), 'PHASE_OPERATING_RATE_FIELDS phải có b2b_bridge_rate (lưu % -> phân số)');
  // 3 tỉ lệ Channel cũ không còn xuất hiện trong app.js:
  for (const f of ['paid_to_b2b', 'lead_to_account', 'demo_to_account']) {
    assert.ok(!appSrc.includes(f), 'app.js còn dùng field cũ ' + f);
  }
});

test('0022 [domain]: bridge = b2b_bridge_rate x PaidEOM_pre qua inputsByMonth; bị trừ khỏi Paid EOM, cộng vào New B2B', () => {
  // Paid churn T1 = (100 + 10) x 2% x 0,5 = 1,1 -> PaidEOM_pre = 108,9;
  // bridge = 10% x 108,9 = 10,89; Paid EOM = 98,01.
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: FUNNEL_1M,
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { ...FULL, b2b_bridge_rate: 0.1 } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  const r = out.months[0];
  approx(r.b2bBridgeRate, 0.1, 'row phơi tỉ lệ bridge của Phase');
  approx(r.b2bBridge, 10.89, 'bridge = 0,1 x PaidEOM_pre 108,9');
  approx(r.bridgeConverted, 10.89, 'bridgeConverted là alias của bridge');
  approx(r.paidEom, 98.01, 'Paid EOM = 108,9 − 10,89');
  approx(r.newB2b, 5 + 10.89, 'New B2B = account trực tiếp 5 + bridge 10,89');
  approx(r.b2bEom, 50 + 15.89 - 2, 'B2B EOM = 63,89');
  approx(r.revenue, 47000 * 110, 'Revenue tính trên paidBase TRƯỚC churn + TRƯỚC bridge (100 + 10 = 110) — mốc thu phí đầu kỳ 20/11, bridge không còn làm giảm Revenue');
});

test('0022 [domain]: đọc tỉ lệ từ input.phases khi inputsByMonth không mang; null -> bridge 0', () => {
  const viaPhases = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: FUNNEL_1M,
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': FULL },
    phases: [{ id: 'p1', start_month: '2027-01', end_month: '2027-01', b2b_bridge_rate: 0.1 }],
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  approx(viaPhases.months[0].b2bBridge, 10.89, 'tự tra Phase chứa tháng trong input.phases');
  const nullRate = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: FUNNEL_1M,
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { ...FULL, b2b_bridge_rate: null } },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  assert.equal(nullRate.months[0].b2bBridge, 0, 'b2b_bridge_rate null -> bridge = 0');
  approx(nullRate.months[0].paidEom, 108.9, 'Paid EOM giữ nguyên khi bridge = 0');
});

test('0022 [domain]: KHÔNG còn đường dự phòng — lượng b2bBridge kiểu cũ ở funnel/inputs/bridgeByMonth bị bỏ qua khi không có tỉ lệ Phase', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 0, visits: 0, freemium: 210, paid: 10, b2b: 5, b2bBridge: 5 } },
    budgetByMonth: { '2027-01': 0 },
    inputsByMonth: { '2027-01': { ...FULL, b2bBridge: 5 } },
    bridgeByMonth: { '2027-01': 5 },
    openingFree: 1000, openingPaid: 100, openingB2b: 50
  });
  assert.equal(out.months[0].b2bBridge, 0, 'không nguồn tỉ lệ nào -> bridge = 0 dù 3 đường cũ đều mang lượng 5');
  approx(out.months[0].paidEom, 108.9, 'Paid EOM không bị trừ bởi lượng bridge cũ');
  approx(out.months[0].newB2b, 5, 'New B2B chỉ gồm account trực tiếp');
});

test('0022 [demo seed]: fixture phases KHÔNG mang b2b_bridge_rate khác null; seed không còn 3 key tỉ lệ Channel cũ', () => {
  for (const p of demo.phases) {
    assert.ok(p.b2b_bridge_rate === undefined || p.b2b_bridge_rate === null, 'phase ' + p.id + ': b2b_bridge_rate phải trống (bridge fixture = 0)');
  }
  for (const b of demo.benchmarks) {
    for (const f of ['paid_to_b2b', 'lead_to_account', 'demo_to_account']) {
      assert.ok(!(f in b), 'benchmark ' + b.channel + ' còn key cũ ' + f);
    }
  }
  for (const a of demo.phase_assumptions) {
    for (const f of ['paid_to_b2b', 'lead_to_account', 'demo_to_account']) {
      assert.ok(!(f in a), 'phase_assumptions còn key cũ ' + f);
    }
  }
});
