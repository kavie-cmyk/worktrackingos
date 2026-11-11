// tests/budget-r2.test.mjs
// Kiểm thử vòng sửa R2 — PHẦN A phía store-core (js/store-core.js):
//   R2-08 payload commitments (status partial → partially_actualised,
//         settled_amount null/undefined → 0)
//   R2-09 actuals.source lạ → 'manual' (chỉ giữ enum manual/ads_sync/import/invoice)
//   R2-17 FIELD_ALIASES.brandAssets url → external_url (assets đã có cột external_url)
//   R2-18 kpis periodStart/periodEnd → period_start/period_end (chỉ alias kỳ,
//         KHÔNG có definition — chờ migration)
//   R2-04 helper timezone: toDatetimeLocalValue / fromDatetimeLocalValue /
//         dateInTz (mặc định Asia/Ho_Chi_Minh)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');

// ---------------------------------------------------------------------------
// R2-08 — commitments: status 'partial' + settled_amount null/undefined
// ---------------------------------------------------------------------------

test('R2-08 toDbPayload commitments: status partial → partially_actualised, settledAmount null → settled_amount 0', () => {
  const payload = core.toDbPayload('commitments', {
    title: 'Thanh toán một phần', amount: 1000, status: 'partial', settledAmount: null,
  });
  assert.equal(payload.status, 'partially_actualised');
  assert.equal(payload.settled_amount, 0);
  assert.equal(payload.description, 'Thanh toán một phần');
});

test('R2-08 toDbPayload commitments: settledAmount undefined (truyền tường minh) → settled_amount 0; status canonical giữ nguyên', () => {
  const payload = core.toDbPayload('commitments', {
    title: 'Cam kết mới', amount: 500, status: 'partially_actualised', settledAmount: undefined,
  });
  assert.equal(payload.status, 'partially_actualised');
  assert.equal(payload.settled_amount, 0);
  // Giá trị settled thật vẫn giữ nguyên, không bị ép về 0.
  const withValue = core.toDbPayload('commitments', { title: 'X', amount: 500, settledAmount: 250 });
  assert.equal(withValue.settled_amount, 250);
  // Không truyền settledAmount (patch một phần) thì payload không đụng trường này.
  const patch = core.toDbPayload('commitments', { status: 'settled' });
  assert.ok(!('settled_amount' in patch), 'patch không có settledAmount không được tự thêm settled_amount');
});

// ---------------------------------------------------------------------------
// R2-09 — actuals.source: chỉ giữ enum, còn lại → 'manual'
// ---------------------------------------------------------------------------

test('R2-09 toDbPayload actuals: source thuộc enum (manual/ads_sync/import/invoice) được giữ nguyên', () => {
  for (const source of ['manual', 'ads_sync', 'import', 'invoice']) {
    assert.equal(core.toDbPayload('actuals', { title: 'Chi', amount: 10, source }).source, source);
  }
});

test("R2-09 toDbPayload actuals: source lạ ('', 'Ghi kèm cam kết chi', mã chứng từ) → 'manual'", () => {
  for (const source of ['', 'Ghi kèm cam kết chi', 'INV-2026-001', 'chứng từ 123', 'sync']) {
    assert.equal(
      core.toDbPayload('actuals', { title: 'Chi', amount: 10, source }).source,
      'manual',
      `source ${JSON.stringify(source)} phải chuẩn hoá về manual`,
    );
  }
});

// ---------------------------------------------------------------------------
// R2-17 — brandAssets: url → external_url
// ---------------------------------------------------------------------------

test('R2-17 brandAssets: TABLE_COLUMNS.assets đã có external_url và FIELD_ALIASES map url → external_url', () => {
  assert.ok(core.hasColumn('assets', 'external_url'), 'bảng assets phải có cột external_url');
  assert.equal(core.FIELD_ALIASES.brandAssets.url, 'external_url');
  const payload = core.toDbPayload('brandAssets', { name: 'KV', url: 'https://example.com/kv.png' });
  assert.equal(payload.external_url, 'https://example.com/kv.png');
  assert.ok(!('url' in payload), 'tên frontend url không được gửi thẳng lên DB');
  // Chiều ngược: dòng DB external_url đọc về có cả url (alias) lẫn externalUrl.
  const item = core.fromDbRow('brandAssets', { id: 'a1', external_url: 'https://example.com/kv.png' });
  assert.equal(item.url, 'https://example.com/kv.png');
  assert.equal(item.externalUrl, 'https://example.com/kv.png');
});

// ---------------------------------------------------------------------------
// R2-18 (phần kỳ) — kpis: periodStart/periodEnd → period_start/period_end
// ---------------------------------------------------------------------------

test('R2-18 toDbPayload kpis: periodStart → period_start, periodEnd → period_end (không thêm definition)', () => {
  const payload = core.toDbPayload('kpis', {
    name: 'Leads', target: 500, periodStart: '2026-11-01', periodEnd: '2026-11-30',
  });
  assert.equal(payload.period_start, '2026-11-01');
  assert.equal(payload.period_end, '2026-11-30');
  assert.equal(payload.target_value, 500);
  assert.ok(!('definition' in payload) && !('definition_version' in payload), 'definition chờ migration — không được tự thêm');
  const item = core.fromDbRow('kpis', { id: 'k1', period_start: '2026-11-01', period_end: '2026-11-30' });
  assert.equal(item.periodStart, '2026-11-01');
  assert.equal(item.periodEnd, '2026-11-30');
});

// ---------------------------------------------------------------------------
// R2-04 — helper timezone (mặc định Asia/Ho_Chi_Minh)
// ---------------------------------------------------------------------------

test('R2-04 toDatetimeLocalValue: instant UTC → giờ tường ICT cho datetime-local', () => {
  assert.equal(typeof core.toDatetimeLocalValue, 'function');
  assert.equal(core.toDatetimeLocalValue('2026-11-11T11:00:00.000Z'), '2026-11-11T18:00');
  assert.equal(core.toDatetimeLocalValue('2026-11-11T11:00:00.000Z', 'Asia/Ho_Chi_Minh'), '2026-11-11T18:00');
  assert.equal(core.toDatetimeLocalValue('2026-11-11T11:00:00.000Z', 'UTC'), '2026-11-11T11:00');
});

test('R2-04 fromDatetimeLocalValue: giờ tường ICT → instant UTC', () => {
  assert.equal(typeof core.fromDatetimeLocalValue, 'function');
  assert.equal(core.fromDatetimeLocalValue('2026-11-11T18:00'), '2026-11-11T11:00:00.000Z');
  assert.equal(core.fromDatetimeLocalValue('2026-11-11T18:00', 'Asia/Ho_Chi_Minh'), '2026-11-11T11:00:00.000Z');
});

test('R2-04 round-trip giữ nguyên instant cho 18:00, 00:30, 23:30 ICT', () => {
  const cases = [
    ['2026-11-11T18:00', '2026-11-11T11:00:00.000Z'],
    ['2026-11-11T00:30', '2026-11-10T17:30:00.000Z'],
    ['2026-11-11T23:30', '2026-11-11T16:30:00.000Z'],
  ];
  for (const [local, iso] of cases) {
    assert.equal(core.fromDatetimeLocalValue(local), iso, `${local} ICT phải là ${iso}`);
    assert.equal(core.toDatetimeLocalValue(iso), local, `${iso} phải về lại ${local} ICT`);
    assert.equal(
      core.toDatetimeLocalValue(core.fromDatetimeLocalValue(local)),
      local,
      `round-trip local → UTC → local phải giữ nguyên ${local}`,
    );
    assert.equal(
      core.fromDatetimeLocalValue(core.toDatetimeLocalValue(iso)),
      iso,
      `round-trip UTC → local → UTC phải giữ nguyên ${iso}`,
    );
  }
});

test('R2-04 dateInTz: ngày theo tz của instant (qua nửa đêm ICT)', () => {
  assert.equal(typeof core.dateInTz, 'function');
  // 17:30 UTC = 00:30 ngày hôm sau ở ICT.
  assert.equal(core.dateInTz('2026-11-11T17:30:00.000Z'), '2026-11-12');
  assert.equal(core.dateInTz('2026-11-11T11:00:00.000Z'), '2026-11-11');
  assert.equal(core.dateInTz('2026-11-11T17:30:00.000Z', 'UTC'), '2026-11-11');
  // Khớp todayISO sẵn có trên cùng instant/tz.
  assert.equal(
    core.dateInTz('2026-11-11T17:30:00.000Z'),
    core.todayISO('Asia/Ho_Chi_Minh', new Date('2026-11-11T17:30:00.000Z')),
  );
});
