// 0021 — Sửa lỗi "nhập tỉ lệ B2B ở lưới Phase bị mất số":
// 3 tỉ lệ B2B của lưới Phase (paid_to_b2b, lead_to_account,
// demo_to_account) bị lệch 3 lớp:
//  - UI (js/app.js) render + savePhaseRate/savePhaseAssumption tạo patch
//    ĐÚNG cả 6 tỉ lệ (PHASE_RATE_FIELDS) — tầng này không sửa.
//  - Store (js/store-core.js): whitelist TABLE_COLUMNS.phase_assumptions
//    THIẾU 3 field B2B → toDbPayload lược bỏ lặng lẽ khỏi payload ghi.
//  - DB (0017/0018): public.phase_assumptions KHÔNG có 3 cột B2B
//    (benchmarks có đủ từ 0017) → migration 0021 bổ sung numeric(12,8).
// File này khóa:
//  - migration 0021: đủ 3 cột đúng tên + numeric(12,8) + add column if
//    not exists + comment 0021 (null = kế thừa Benchmark) + câu kiểm
//    chứng information_schema; KHÔNG drop column.
//  - store-core: whitelist phase_assumptions ⊇ PHASE_RATE_FIELDS (đọc
//    thẳng từ js/app.js) và ⊇ EFFECTIVE_RATE_FIELDS (js/domain.js).
//  - round-trip qua đường store (create như savePhaseAssumption +
//    update patch từng field): TỪNG field trong 6 tỉ lệ lưu rồi đọc
//    lại nguyên vẹn, đặc biệt 3 field B2B; views_per_unit vẫn ánh xạ
//    top_funnel_override.
//  - benchmarks rà cùng cách: whitelist đã đủ 6 tỉ lệ + round-trip B2B
//    nguyên vẹn (không sửa gì ở benchmarks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../js/store-core.js');

const mig = readFileSync(new URL('../supabase/migrations/0021_phase_assumptions_b2b_rates.sql', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const domainSrc = readFileSync(new URL('../js/domain.js', import.meta.url), 'utf8');

// 6 tỉ lệ của lưới Phase theo đúng thứ tự PHASE_RATE_FIELDS (js/app.js)
// + giá trị phân biệt cho từng field để bắt lỗi lẫn field.
const RATE_FIELDS = [
  ['view_to_visit', 'viewToVisit', 0.11],
  ['visit_to_freemium', 'visitToFreemium', 0.22],
  ['freemium_to_paid', 'freemiumToPaid', 0.33],
  ['paid_to_b2b', 'paidToB2b', 0.44],
  ['lead_to_account', 'leadToAccount', 0.55],
  ['demo_to_account', 'demoToAccount', 0.66]
];
const B2B_FIELDS = RATE_FIELDS.slice(3);

function extractArrayLiteral(src, varName) {
  const m = src.match(new RegExp(varName + "\\s*=\\s*\\[([^\\]]*)\\]"));
  assert.ok(m, 'không tìm thấy ' + varName);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('0021 [migration]: thêm đủ 3 cột B2B cho phase_assumptions, numeric(12,8), idempotent, không drop', () => {
  for (const [snake] of B2B_FIELDS) {
    assert.match(
      mig,
      new RegExp('alter table public\\.phase_assumptions add column if not exists ' + snake + ' numeric\\(12,8\\)'),
      'migration 0021 thiếu cột ' + snake + ' numeric(12,8)'
    );
    // comment on column cho từng cột, ghi 0021 + ý nghĩa kế thừa Benchmark:
    assert.match(
      mig,
      new RegExp('comment on column public\\.phase_assumptions\\.' + snake + " is '0021:[^']*kế thừa Benchmark"),
      'thiếu comment 0021 (null = kế thừa Benchmark) cho cột ' + snake
    );
  }
  assert.ok(!/drop column/i.test(mig), 'migration 0021 không được chứa drop column');
  // Header phải ghi rõ CHƯA áp production khi commit:
  assert.match(mig, /CHƯA áp lên production/);
  // Câu kiểm chứng information_schema ở cuối file (mẫu 0020):
  assert.match(mig, /KIỂM CHỨNG SAU KHI ÁP/);
  assert.match(mig, /information_schema\.columns/);
  assert.match(mig, /phase_assumptions/);
});

test('0021 [store-core tĩnh]: whitelist phase_assumptions ⊇ PHASE_RATE_FIELDS (app.js) và EFFECTIVE_RATE_FIELDS (domain.js)', () => {
  const phaseRateFields = extractArrayLiteral(appSrc, 'PHASE_RATE_FIELDS');
  assert.deepEqual(phaseRateFields, RATE_FIELDS.map((r) => r[0]), 'PHASE_RATE_FIELDS đổi — cập nhật test này');
  const effectiveFields = extractArrayLiteral(domainSrc, 'EFFECTIVE_RATE_FIELDS');
  assert.deepEqual(effectiveFields, phaseRateFields, 'EFFECTIVE_RATE_FIELDS phải khớp PHASE_RATE_FIELDS');
  for (const f of phaseRateFields) {
    assert.ok(Core.TABLE_COLUMNS.phase_assumptions.includes(f), 'whitelist phase_assumptions thiếu ' + f);
    assert.ok(Core.hasColumn('phase_assumptions', f), 'hasColumn(phase_assumptions, ' + f + ') phải true');
  }
  // views_per_unit (UI) ↔ top_funnel_override (DB) vẫn thẳng hàng:
  assert.ok(Core.TABLE_COLUMNS.phase_assumptions.includes('top_funnel_override'));
  assert.equal((Core.FIELD_ALIASES.phase_assumptions || {}).views_per_unit, 'top_funnel_override');
  // 3 field cũ fallback vẫn còn trong whitelist:
  for (const f of ['visit_to_signup', 'signup_to_first', 'first_to_paid']) {
    assert.ok(Core.TABLE_COLUMNS.phase_assumptions.includes(f), 'whitelist phase_assumptions mất field cũ ' + f);
  }
  // camelCase tự khớp snake_case cho 3 field B2B, không cần alias:
  for (const [snake, camel] of B2B_FIELDS) {
    assert.equal(Core.camelToSnake(camel), snake);
    assert.equal(Core.snakeToCamel(snake), camel);
    assert.ok(!(camel in (Core.FIELD_ALIASES.phase_assumptions || {})), 'không cần alias cho ' + camel);
  }
});

test('0021 [round-trip create]: lưu TỪNG field trong 6 tỉ lệ qua đường create của savePhaseAssumption rồi đọc lại — nguyên vẹn', () => {
  for (const [snake, camel, value] of RATE_FIELDS) {
    // Đúng shape object mà savePhaseAssumption (js/app.js) tạo khi chưa
    // có assumption: mọi tỉ lệ null + patch ghi đè field vừa nhập.
    const obj = {
      phase_id: 'phase-lumus-1', channel: 'KOL Nano',
      view_to_visit: null, visit_to_freemium: null, freemium_to_paid: null,
      visit_to_signup: null, signup_to_first: null, first_to_paid: null,
      paid_to_b2b: null, lead_to_account: null, demo_to_account: null,
      views_per_unit: null
    };
    obj[snake] = value;
    const payload = Core.toDbPayload('phase_assumptions', obj, { forInsert: true, workspaceId: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6' });
    assert.equal(payload[snake], value, 'create: payload mất field ' + snake);
    const back = Core.fromDbRow('phase_assumptions', payload);
    assert.equal(back[camel], value, 'create: đọc lại mất field ' + snake);
  }
});

test('0021 [round-trip update]: patch TỪNG field trong 6 tỉ lệ (đường update của savePhaseAssumption) — nguyên vẹn cả snake lẫn camel', () => {
  for (const [snake, camel, value] of RATE_FIELDS) {
    const patch = {};
    patch[snake] = value;
    const payload = Core.toDbPayload('phase_assumptions', patch, {});
    assert.equal(payload[snake], value, 'update (snake): payload mất field ' + snake);
    assert.equal(Core.fromDbRow('phase_assumptions', payload)[camel], value, 'update (snake): đọc lại mất field ' + snake);
    const patchCamel = {};
    patchCamel[camel] = value;
    const payloadCamel = Core.toDbPayload('phase_assumptions', patchCamel, {});
    assert.equal(payloadCamel[snake], value, 'update (camel): payload mất field ' + snake);
    // Xoá trắng ô = ghi null (kế thừa lại Benchmark) cũng phải qua được:
    const clear = {};
    clear[snake] = null;
    assert.equal(Core.toDbPayload('phase_assumptions', clear, {})[snake], null, 'update: xoá trắng phải giữ null cho ' + snake);
  }
});

test('0021 [round-trip gộp]: assumption đủ 6 tỉ lệ + views_per_unit qua create → đọc lại nguyên vẹn, views ánh xạ top_funnel_override', () => {
  const obj = { phase_id: 'phase-lumus-1', channel: 'Meta Ads', views_per_unit: 1234.5 };
  for (const [snake, , value] of RATE_FIELDS) obj[snake] = value;
  const payload = Core.toDbPayload('phase_assumptions', obj, { forInsert: true });
  for (const [snake, , value] of RATE_FIELDS) assert.equal(payload[snake], value, 'payload mất ' + snake);
  assert.equal(payload.top_funnel_override, 1234.5, 'views_per_unit phải ánh xạ top_funnel_override');
  const back = Core.fromDbRow('phase_assumptions', payload);
  for (const [snake, camel, value] of RATE_FIELDS) assert.equal(back[camel], value, 'đọc lại mất ' + snake);
  assert.equal(back.views_per_unit, 1234.5);
});

test('0021 [rà benchmarks]: whitelist benchmarks đã đủ 6 tỉ lệ + round-trip 3 field B2B nguyên vẹn (không sửa benchmarks)', () => {
  for (const [snake] of RATE_FIELDS) {
    assert.ok(Core.TABLE_COLUMNS.benchmarks.includes(snake), 'whitelist benchmarks thiếu ' + snake);
  }
  const bench = { brand_id: 'brand-lumus-ai', channel: 'KOL Nano' };
  for (const [snake, , value] of B2B_FIELDS) bench[snake] = value;
  const payload = Core.toDbPayload('benchmarks', bench, { forInsert: true });
  const back = Core.fromDbRow('benchmarks', payload);
  for (const [snake, camel, value] of B2B_FIELDS) {
    assert.equal(payload[snake], value, 'benchmarks payload mất ' + snake);
    assert.equal(back[camel], value, 'benchmarks đọc lại mất ' + snake);
  }
});
