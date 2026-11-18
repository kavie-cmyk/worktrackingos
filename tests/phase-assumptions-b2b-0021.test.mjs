// 0021 — VIẾT LẠI 18/11/2026 (đợt 2, mô hình bridge theo Phase):
// Bản gốc của file này khóa cơ chế "3 tỉ lệ B2B theo Channel của lưới
// Phase (paid_to_b2b, lead_to_account, demo_to_account) lưu qua
// phase_assumptions" (migration 0021 + whitelist store + round-trip).
// Zac chốt 18/11/2026 23:15: BỎ hẳn cơ chế đó — engine (domain) và UI
// (app) KHÔNG còn đọc 3 tỉ lệ này ở bất kỳ tầng nào; cầu nối Paid->B2B
// chuyển sang tỉ lệ theo Phase phases.b2b_bridge_rate (khóa riêng ở
// tests/phase-bridge-rate-0022.test.mjs). Cột DB của 0021 GIỮ NGUYÊN
// (dormant, không drop) để không mất dữ liệu lịch sử.
// File này nay khóa chiều NGƯỢC:
//  - migration 0021 vẫn tồn tại như hồ sơ lịch sử (không bị sửa/xoá).
//  - PHASE_RATE_FIELDS (app.js) và EFFECTIVE_RATE_FIELDS (domain.js)
//    CHỈ còn 3 tỉ lệ phễu B2C và KHỚP nhau; không chứa 3 field B2B cũ.
//  - forecastFunnel bỏ qua 3 tỉ lệ cũ kể cả khi benchmark/assumption
//    còn mang chúng (dữ liệu dormant): b2b tầng kênh chỉ còn account
//    trực tiếp qua cost_per_result.b2b_account.
//  - Round-trip store của 3 tỉ lệ phễu CÒN LẠI vẫn nguyên vẹn qua
//    phase_assumptions (đường lưu tỉ lệ Phase không regress).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../js/store-core.js');
const domain = require('../js/domain.js');

const mig = readFileSync(new URL('../supabase/migrations/0021_phase_assumptions_b2b_rates.sql', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const domainSrc = readFileSync(new URL('../js/domain.js', import.meta.url), 'utf8');

const OLD_B2B_FIELDS = ['paid_to_b2b', 'lead_to_account', 'demo_to_account'];
const RATE_FIELDS = [
  ['view_to_visit', 'viewToVisit', 0.11],
  ['visit_to_freemium', 'visitToFreemium', 0.22],
  ['freemium_to_paid', 'freemiumToPaid', 0.33]
];

function extractArrayLiteral(src, varName) {
  const m = src.match(new RegExp(varName + "\\s*=\\s*\\[([^\\]]*)\\]"));
  assert.ok(m, 'không tìm thấy ' + varName);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('0021 [migration — hồ sơ lịch sử]: file 0021 còn nguyên, cột giữ dormant (không drop ở 0021 lẫn 0022)', () => {
  for (const snake of OLD_B2B_FIELDS) {
    assert.match(
      mig,
      new RegExp('alter table public\\.phase_assumptions add column if not exists ' + snake + ' numeric\\(12,8\\)'),
      'hồ sơ 0021 phải còn cột ' + snake
    );
  }
  assert.ok(!/drop column/i.test(mig), 'migration 0021 không được chứa drop column');
  const mig22 = readFileSync(new URL('../supabase/migrations/0022_phase_bridge_rate.sql', import.meta.url), 'utf8');
  assert.ok(!/drop column/i.test(mig22), 'migration 0022 cũng không drop cột cũ (giữ dormant)');
});

test('0021 [mô hình mới]: PHASE_RATE_FIELDS (app) và EFFECTIVE_RATE_FIELDS (domain) chỉ còn 3 tỉ lệ phễu, khớp nhau, không chứa field B2B cũ', () => {
  const phaseRateFields = extractArrayLiteral(appSrc, 'PHASE_RATE_FIELDS');
  assert.deepEqual(phaseRateFields, RATE_FIELDS.map((r) => r[0]), 'PHASE_RATE_FIELDS phải chỉ còn 3 tỉ lệ phễu B2C');
  const effectiveFields = extractArrayLiteral(domainSrc, 'EFFECTIVE_RATE_FIELDS');
  assert.deepEqual(effectiveFields, phaseRateFields, 'EFFECTIVE_RATE_FIELDS phải khớp PHASE_RATE_FIELDS');
  for (const f of OLD_B2B_FIELDS) {
    assert.ok(!phaseRateFields.includes(f) && !effectiveFields.includes(f), f + ' không được nằm trong danh sách tỉ lệ hiệu dụng');
    assert.ok(!appSrc.includes(f), 'app.js không còn dùng ' + f);
  }
  // views_per_unit (UI) ↔ top_funnel_override (DB) vẫn thẳng hàng:
  assert.ok(Core.TABLE_COLUMNS.phase_assumptions.includes('top_funnel_override'));
  assert.equal((Core.FIELD_ALIASES.phase_assumptions || {}).views_per_unit, 'top_funnel_override');
});

test('0021 [domain]: forecastFunnel BỎ QUA 3 tỉ lệ cũ kể cả khi dữ liệu dormant còn mang — content/Lead Gen/Demo cho b2b = 0; Partnership trực tiếp giữ nguyên', () => {
  const bmContent = [{ brand_id: 'b1', channel: 'KOL X', group: 'KOL', unit_price: 1000, output_per_unit: 100, view_to_visit: 0.1, visit_to_freemium: 0.1, freemium_to_paid: 0.1, paid_to_b2b: 0.5, direct_budget: false }];
  const fc = domain.forecastFunnel([{ id: 'r1', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'KOL X', group: 'KOL', qty: 10, budget: null }], bmContent).rows[0].forecast;
  assert.equal(fc.b2b, 0, 'paid_to_b2b dormant 50% vẫn cho b2b = 0 ở tầng kênh');
  assert.equal(fc.b2bBridge, 0, 'b2bBridge tầng kênh luôn 0 (bridge tính ở tầng tồn theo Phase)');
  const bmLead = [{ brand_id: 'b1', channel: 'Ads B2B', group: 'Paid Media', direct_budget: true, view_to_visit: null, visit_to_freemium: 0.09, freemium_to_paid: 0.0275, lead_to_account: 0.9, demo_to_account: 0.9, cost_per_result: { lead_gen: 100000, demo: 100000 } }];
  const fcLead = domain.forecastFunnel([{ id: 'r2', brand_id: 'b1', segment: 'b2b', month: '2027-01', channel: 'Ads B2B', group: 'Paid Media', qty: null, budget: 10000000, objective: 'lead_gen', audience: 'both', b2b_split_pct: 40 }], bmLead).rows[0].forecast;
  assert.equal(fcLead.b2b, 0, 'lead_to_account dormant 90% vẫn cho b2b = 0 (Lead Gen chỉ đếm Lead)');
  const bmPE = [{ brand_id: 'b1', channel: 'Partner X', group: 'Partnership', direct_budget: true, view_to_visit: null, visit_to_freemium: null, freemium_to_paid: 0.0275, paid_to_b2b: 0.5, cost_per_result: { signup: 50000, b2b_account: 500000 } }];
  const fcPE = domain.forecastFunnel([{ id: 'r3', brand_id: 'b1', segment: 'b2c', month: '2027-01', channel: 'Partner X', group: 'Partnership', qty: null, budget: 10000000, audience: 'both', b2b_split_pct: 40 }], bmPE).rows[0].forecast;
  assert.equal(fcPE.b2b, 8, 'Partnership trực tiếp qua cost_per_result.b2b_account giữ nguyên: 4.000.000 / 500.000 = 8');
});

test('0021 [round-trip còn lại]: 3 tỉ lệ phễu qua create/update của phase_assumptions vẫn nguyên vẹn; views_per_unit ánh xạ top_funnel_override', () => {
  for (const [snake, camel, value] of RATE_FIELDS) {
    const obj = {
      phase_id: 'phase-lumus-1', channel: 'KOL Nano',
      view_to_visit: null, visit_to_freemium: null, freemium_to_paid: null,
      visit_to_signup: null, signup_to_first: null, first_to_paid: null,
      views_per_unit: null
    };
    obj[snake] = value;
    const payload = Core.toDbPayload('phase_assumptions', obj, { forInsert: true, workspaceId: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6' });
    assert.equal(payload[snake], value, 'create: payload mất field ' + snake);
    assert.equal(Core.fromDbRow('phase_assumptions', payload)[camel], value, 'create: đọc lại mất field ' + snake);
    const patch = {};
    patch[snake] = value;
    assert.equal(Core.toDbPayload('phase_assumptions', patch, {})[snake], value, 'update: payload mất field ' + snake);
    const clear = {};
    clear[snake] = null;
    assert.equal(Core.toDbPayload('phase_assumptions', clear, {})[snake], null, 'update: xoá trắng phải giữ null cho ' + snake);
  }
  const obj = { phase_id: 'phase-lumus-1', channel: 'Meta Ads', views_per_unit: 1234.5 };
  for (const [snake, , value] of RATE_FIELDS) obj[snake] = value;
  const payload = Core.toDbPayload('phase_assumptions', obj, { forInsert: true });
  assert.equal(payload.top_funnel_override, 1234.5, 'views_per_unit phải ánh xạ top_funnel_override');
  assert.equal(Core.fromDbRow('phase_assumptions', payload).views_per_unit, 1234.5);
});
