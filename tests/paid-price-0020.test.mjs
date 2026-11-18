// 0020 — Thay đổi A (Zac chốt 18/11/2026): BỎ nhiều mức giá Paid,
// CHỈ CÒN 1 giá Paid duy nhất theo Phase (phases.paid_price).
//  - File migration 0020 tồn tại, thêm cột paid_price numeric(18,2)
//    (khớp kiểu tiền của phases ở 0017), KHÔNG xoá cột giá cũ (giữ
//    lịch sử), quy đổi paid_price = ARPPU trọng số của bộ giá cũ:
//    Σ price x pct / 100 với pct là % 0–100 trên mảng object
//    [{price, pct}] (shape đã đọc từ domain/migration 0018).
//  - store-core: TABLE_COLUMNS.phases chứa paid_price, không còn
//    cột giá cũ; camelCase paidPrice tự khớp, không cần alias.
//  - domain: ARPPU hiệu dụng = paid_price trực tiếp; thiếu paid_price
//    -> missing.paid_price + Revenue null (đã khóa chi tiết ở
//    planning-operating-financials.test.mjs ca (e); ở đây khóa thêm
//    ca quy đổi chuẩn: bộ giá cũ 25.000x50% + 49.000x30% +
//    99.000x20% = 47.000 -> paid_price 47.000 cho Revenue 5.118.300đ
//    với Paid EOM 108,9 như ca tính tay chuẩn).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../js/store-core.js');
const domain = require('../js/domain.js');

const mig = readFileSync(new URL('../supabase/migrations/0020_paid_price.sql', import.meta.url), 'utf8');

test('0020 [migration]: thêm paid_price numeric(18,2), không xoá cột cũ, có quy đổi trọng số + câu kiểm chứng', () => {
  assert.match(mig, /alter table public\.phases add column if not exists paid_price numeric\(18,2\)/);
  // KHÔNG được xoá cột giá cũ (giữ lịch sử):
  assert.ok(!/drop column/i.test(mig), 'migration 0020 không được chứa drop column');
  // Quy đổi đúng shape + công thức: mảng object {price, pct}, pct % 0–100:
  assert.match(mig, /jsonb_array_elements\(ph\.paid_price_tiers\)/);
  assert.match(mig, /\(elem ->> 'price'\)::numeric\) \* \(\(elem ->> 'pct'\)::numeric\) \/ 100/);
  assert.match(mig, /paid_price is null/, 'quy đổi phải idempotent (chỉ ghi khi paid_price còn null)');
  // Câu kiểm chứng sau khi áp phải có trong file:
  assert.match(mig, /KIỂM CHỨNG SAU KHI ÁP/);
  assert.match(mig, /phases_with_paid_price/);
  assert.match(mig, /arppu_from_tiers/);
});

test('0020 [store-core]: TABLE_COLUMNS.phases chứa paid_price, ánh xạ camel tự khớp', () => {
  assert.ok(Core.hasColumn('phases', 'paid_price'), 'phases thiếu cột paid_price');
  assert.ok(Core.TABLE_COLUMNS.phases.includes('paid_price'));
  assert.equal(Core.camelToSnake('paidPrice'), 'paid_price');
  assert.equal(Core.snakeToCamel('paid_price'), 'paidPrice');
  const aliases = Core.FIELD_ALIASES.phases || {};
  assert.ok(!('paidPrice' in aliases), 'không cần alias cho paidPrice');
  const payload = Core.toDbPayload('phases', { paidPrice: 47000 }, { forInsert: true });
  assert.equal(payload.paid_price, 47000);
  assert.equal(Core.fromDbRow('phases', payload).paidPrice, 47000);
});

test('0020 [domain]: ca quy đổi chuẩn — paid_price 47.000 (từ bộ giá cũ 25.000x50% + 49.000x30% + 99.000x20%) cho Revenue 5.118.300đ, Paid EOM 108,9', () => {
  const out = domain.computeOperatingFinancials({
    months: ['2027-01'],
    funnelByMonth: { '2027-01': { views: 5000, visits: 900, freemium: 210, paid: 10 } },
    budgetByMonth: { '2027-01': 1000000 },
    inputsByMonth: { '2027-01': { paid_churn_rate: 0.02, free_churn_rate: 0.05, monthly_cvr: null, paid_price: 47000, cogs_per_free_user: 10000, cogs_per_paid_user: 20000, fixed_cost: 200000 } },
    openingFree: 1000, openingPaid: 100
  });
  const r = out.months[0];
  assert.ok(Math.abs(r.paidEom - 108.9) < 1e-6, 'Paid EOM = 108,9, got ' + r.paidEom);
  assert.ok(Math.abs(r.freeEom - 1169.75) < 1e-6, 'Free EOM = 1.169,75, got ' + r.freeEom);
  assert.ok(Math.abs(r.arppuEffective - 47000) < 1e-6, 'ARPPU = paid_price trực tiếp');
  assert.ok(Math.abs(r.revenue - 5118300) < 1e-6, 'Revenue = 47.000 x 108,9 = 5.118.300, got ' + r.revenue);
  assert.equal(out.missing.paid_price, false);
});
