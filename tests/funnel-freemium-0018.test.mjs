// 0018 — Căn chỉnh phễu freemium (phần migration + store + demo-data):
//  - File migration 0018 tồn tại, thêm đủ 4 cột mới cho public.phases với
//    đúng kiểu, KHÔNG xoá cột arppu/cogs_per_user của 0017.
//  - store-core: TABLE_COLUMNS.phases có đủ 4 cột mới; ánh xạ camelCase
//    (monthlyCvr, cogsPerFreeUser, cogsPerPaidUser, paidPriceTiers) tự
//    khớp qua camelToSnake nên không cần FIELD_ALIASES; round-trip
//    toDbPayload → fromDbRow giữ nguyên giá trị, paid_price_tiers (jsonb
//    mảng object) qua lại nguyên vẹn cả hai chiều.
//  - demo-data: benchmarks Lumus dùng key phễu MỚI (visit_to_freemium
//    0.09, freemium_to_paid 0.0275), không còn key cũ chi phối;
//    view_to_visit giữ nguyên; số neo qty/ngân sách không đổi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../js/store-core.js');
const demo = require('../js/demo-data.js');

const mig = readFileSync(new URL('../supabase/migrations/0018_funnel_freemium.sql', import.meta.url), 'utf8');

test('0018 [migration]: file 0018 thêm đủ 4 cột phases với đúng kiểu, không xoá cột cũ', () => {
  assert.match(mig, /alter table public\.phases add column if not exists monthly_cvr numeric/);
  assert.match(mig, /alter table public\.phases add column if not exists cogs_per_free_user numeric/);
  assert.match(mig, /alter table public\.phases add column if not exists cogs_per_paid_user numeric/);
  assert.match(mig, /alter table public\.phases add column if not exists paid_price_tiers jsonb/);
  // KHÔNG được xoá cột tài chính cũ của 0017:
  assert.ok(!/drop column/i.test(mig), 'migration 0018 không được chứa drop column');
  assert.ok(!/arppu[^\n]*drop|drop[^\n]*arppu/i.test(mig));
  assert.ok(!/cogs_per_user[^\n]*drop|drop[^\n]*cogs_per_user/i.test(mig));
  // Quy ước đã chốt phải ghi trong migration: pct là % 0–100, monthly_cvr là phân số.
  assert.match(mig, /pct[^\n]*0–100|0–100[^\n]*pct/);
  assert.match(mig, /monthly_cvr[^\n]*phân số|phân số[^\n]*monthly_cvr/i);
});

test('0018 [store-core]: TABLE_COLUMNS.phases chứa đủ 4 cột mới', () => {
  for (const c of ['monthly_cvr', 'cogs_per_free_user', 'cogs_per_paid_user', 'paid_price_tiers']) {
    assert.ok(Core.hasColumn('phases', c), 'phases thiếu cột ' + c);
    assert.ok(Core.TABLE_COLUMNS.phases.includes(c));
  }
  // Cột cũ vẫn còn:
  assert.ok(Core.hasColumn('phases', 'arppu'));
  assert.ok(Core.hasColumn('phases', 'cogs_per_user'));
});

test('0018 [store-core]: camelCase tự khớp snake_case — không cần FIELD_ALIASES cho phases', () => {
  assert.equal(Core.camelToSnake('monthlyCvr'), 'monthly_cvr');
  assert.equal(Core.camelToSnake('cogsPerFreeUser'), 'cogs_per_free_user');
  assert.equal(Core.camelToSnake('cogsPerPaidUser'), 'cogs_per_paid_user');
  assert.equal(Core.camelToSnake('paidPriceTiers'), 'paid_price_tiers');
  assert.equal(Core.snakeToCamel('monthly_cvr'), 'monthlyCvr');
  assert.equal(Core.snakeToCamel('cogs_per_free_user'), 'cogsPerFreeUser');
  assert.equal(Core.snakeToCamel('cogs_per_paid_user'), 'cogsPerPaidUser');
  assert.equal(Core.snakeToCamel('paid_price_tiers'), 'paidPriceTiers');
  const aliases = Core.FIELD_ALIASES.phases || {};
  for (const k of ['monthlyCvr', 'cogsPerFreeUser', 'cogsPerPaidUser', 'paidPriceTiers']) {
    assert.ok(!(k in aliases), 'không cần alias cho ' + k);
  }
});

test('0018 [round-trip]: phase có 4 field mới qua toDbPayload → fromDbRow không rớt, paid_price_tiers nguyên cấu trúc', () => {
  const tiers = [{ price: 25000, pct: 50 }, { price: 49000, pct: 30 }, { price: 99000, pct: 20 }];
  const phase = {
    name: 'Phase 0018', brand_id: 'brand-lumus-ai', start_month: '2027-01', end_month: '2027-02',
    monthlyCvr: 0.0275, cogsPerFreeUser: 3000, cogsPerPaidUser: 12000, paidPriceTiers: tiers
  };
  const payload = Core.toDbPayload('phases', phase, { forInsert: true, workspaceId: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6' });
  assert.equal(payload.monthly_cvr, 0.0275);
  assert.equal(payload.cogs_per_free_user, 3000);
  assert.equal(payload.cogs_per_paid_user, 12000);
  assert.deepEqual(payload.paid_price_tiers, tiers);
  const back = Core.fromDbRow('phases', payload);
  assert.equal(back.monthlyCvr, 0.0275);
  assert.equal(back.cogsPerFreeUser, 3000);
  assert.equal(back.cogsPerPaidUser, 12000);
  assert.deepEqual(back.paidPriceTiers, tiers);
  // Dạng snake_case (như demo-data / dữ liệu đọc thẳng) cũng phải qua được:
  const payload2 = Core.toDbPayload('phases', {
    monthly_cvr: 0.05, cogs_per_free_user: 1000, cogs_per_paid_user: 9000, paid_price_tiers: tiers
  }, { forInsert: true });
  assert.equal(payload2.monthly_cvr, 0.05);
  assert.equal(payload2.cogs_per_free_user, 1000);
  assert.equal(payload2.cogs_per_paid_user, 9000);
  assert.deepEqual(payload2.paid_price_tiers, tiers);
  // null (chưa nhập) giữ nguyên null cả hai chiều:
  const payload3 = Core.toDbPayload('phases', { monthlyCvr: null, cogsPerFreeUser: null, cogsPerPaidUser: null, paidPriceTiers: null }, {});
  assert.equal(payload3.monthly_cvr, null);
  assert.equal(payload3.paid_price_tiers, null);
  assert.equal(Core.fromDbRow('phases', payload3).paidPriceTiers, null);
});

test('0018 [demo-data]: benchmarks Lumus dùng key phễu freemium mới, bỏ key cũ, view_to_visit giữ nguyên', () => {
  const lumus = demo.benchmarks.filter((b) => b.brand_id === 'brand-lumus-ai');
  assert.ok(lumus.length >= 5, 'phải có benchmarks Lumus');
  for (const b of lumus) {
    assert.ok(!('visit_to_signup' in b), b.channel + ': còn key cũ visit_to_signup');
    assert.ok(!('signup_to_first' in b), b.channel + ': còn key cũ signup_to_first');
    assert.ok(!('first_to_paid' in b), b.channel + ': còn key cũ first_to_paid');
    assert.ok('visit_to_freemium' in b, b.channel + ': thiếu visit_to_freemium');
    assert.ok('freemium_to_paid' in b, b.channel + ': thiếu freemium_to_paid');
  }
  const withRates = lumus.filter((b) => b.visit_to_freemium != null);
  assert.ok(withRates.length >= 5, 'KOL + Meta + TikTok phải có tỉ lệ mới');
  for (const b of withRates) {
    assert.equal(b.visit_to_freemium, 0.09, b.channel + ': visit_to_freemium phải = 0.09');
    assert.equal(b.freemium_to_paid, 0.0275, b.channel + ': freemium_to_paid phải = 0.0275 (= 0.5 × 0.055)');
  }
  // view_to_visit giữ nguyên như trước:
  const v2v = Object.fromEntries(lumus.map((b) => [b.channel, b.view_to_visit]));
  assert.equal(v2v['KOL Nano'], 0.003);
  assert.equal(v2v['KOL Micro'], 0.004);
  assert.equal(v2v['KOL Expert'], 0.005);
  // cost_per_result của Paid Ads không đổi giá trị (chuỗi mới cho cùng số):
  const meta = lumus.find((b) => b.channel === 'Meta Ads');
  assert.equal(meta.cost_per_result.signup, 20000 / 0.09);
  assert.equal(meta.cost_per_result.remarketing, 20000 / (0.09 * 0.0275));
  const tiktok = lumus.find((b) => b.channel === 'TikTok Ads');
  assert.equal(tiktok.cost_per_result.remarketing, 22000 / (0.09 * 0.0275));
});

test('0018 [demo-data]: số neo không đổi — tổng qty Lumus 776, tổng ngân sách năm 1.598.700.000đ', () => {
  const domain = require('../js/domain.js');
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776);
  assert.equal(domain.planBudget(lumus, demo.benchmarks).total, 1598700000);
});
