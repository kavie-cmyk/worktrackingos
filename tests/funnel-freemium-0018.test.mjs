// 0018 — Căn chỉnh phễu freemium (phần migration + store + demo-data):
//  - File migration 0018 tồn tại, thêm đủ 4 cột mới cho public.phases với
//    đúng kiểu, KHÔNG xoá cột arppu/cogs_per_user của 0017. (Phần
//    migration 0018 là LỊCH SỬ — giữ nguyên kiểm chứng file đó.)
//  - store-core: TABLE_COLUMNS.phases có các cột 0018 còn vận hành
//    (monthly_cvr, cogsPerFreeUser, cogsPerPaidUser); cột giá cũ của
//    0018 đã được thay bởi paid_price (0020, thay đổi A 18/11) nên
//    whitelist nay chứa paid_price và KHÔNG còn cột giá cũ; ánh xạ
//    camelCase tự khớp qua camelToSnake nên không cần FIELD_ALIASES;
//    round-trip toDbPayload → fromDbRow giữ nguyên giá trị paid_price.
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
const seed = readFileSync(new URL('../supabase/seed/from-demo-data.sql', import.meta.url), 'utf8');

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

test('0018+0020 [store-core]: TABLE_COLUMNS.phases chứa cột 0018 còn vận hành + paid_price (0020), không còn cột giá cũ', () => {
  for (const c of ['monthly_cvr', 'cogs_per_free_user', 'cogs_per_paid_user', 'paid_price']) {
    assert.ok(Core.hasColumn('phases', c), 'phases thiếu cột ' + c);
    assert.ok(Core.TABLE_COLUMNS.phases.includes(c));
  }
  // Thay đổi A (0020): app không còn đọc/ghi cột giá nhiều mức của 0018
  // (cột DB vẫn tồn tại để tra lịch sử, chỉ whitelist app là bỏ):
  assert.ok(!Core.TABLE_COLUMNS.phases.includes('paid_price_' + 'tiers'), 'whitelist phases không được còn cột giá cũ');
  // Cột cũ vẫn còn:
  assert.ok(Core.hasColumn('phases', 'arppu'));
  assert.ok(Core.hasColumn('phases', 'cogs_per_user'));
});

test('0018+0020 [store-core]: camelCase tự khớp snake_case — không cần FIELD_ALIASES cho phases', () => {
  assert.equal(Core.camelToSnake('monthlyCvr'), 'monthly_cvr');
  assert.equal(Core.camelToSnake('cogsPerFreeUser'), 'cogs_per_free_user');
  assert.equal(Core.camelToSnake('cogsPerPaidUser'), 'cogs_per_paid_user');
  assert.equal(Core.camelToSnake('paidPrice'), 'paid_price');
  assert.equal(Core.snakeToCamel('monthly_cvr'), 'monthlyCvr');
  assert.equal(Core.snakeToCamel('cogs_per_free_user'), 'cogsPerFreeUser');
  assert.equal(Core.snakeToCamel('cogs_per_paid_user'), 'cogsPerPaidUser');
  assert.equal(Core.snakeToCamel('paid_price'), 'paidPrice');
  const aliases = Core.FIELD_ALIASES.phases || {};
  for (const k of ['monthlyCvr', 'cogsPerFreeUser', 'cogsPerPaidUser', 'paidPrice']) {
    assert.ok(!(k in aliases), 'không cần alias cho ' + k);
  }
});

test('0018+0020 [round-trip]: phase có field mới qua toDbPayload → fromDbRow không rớt, paid_price (giá đơn 0020) giữ nguyên', () => {
  // Giá đơn 47.000 = ARPPU trọng số của bộ giá cũ 25.000x50% +
  // 49.000x30% + 99.000x20% (quy đổi ở migration 0020).
  const phase = {
    name: 'Phase 0018', brand_id: 'brand-lumus-ai', start_month: '2027-01', end_month: '2027-02',
    monthlyCvr: 0.0275, cogsPerFreeUser: 3000, cogsPerPaidUser: 12000, paidPrice: 47000
  };
  const payload = Core.toDbPayload('phases', phase, { forInsert: true, workspaceId: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6' });
  assert.equal(payload.monthly_cvr, 0.0275);
  assert.equal(payload.cogs_per_free_user, 3000);
  assert.equal(payload.cogs_per_paid_user, 12000);
  assert.equal(payload.paid_price, 47000);
  const back = Core.fromDbRow('phases', payload);
  assert.equal(back.monthlyCvr, 0.0275);
  assert.equal(back.cogsPerFreeUser, 3000);
  assert.equal(back.cogsPerPaidUser, 12000);
  assert.equal(back.paidPrice, 47000);
  // Dạng snake_case (như demo-data / dữ liệu đọc thẳng) cũng phải qua được:
  const payload2 = Core.toDbPayload('phases', {
    monthly_cvr: 0.05, cogs_per_free_user: 1000, cogs_per_paid_user: 9000, paid_price: 47000
  }, { forInsert: true });
  assert.equal(payload2.monthly_cvr, 0.05);
  assert.equal(payload2.cogs_per_free_user, 1000);
  assert.equal(payload2.cogs_per_paid_user, 9000);
  assert.equal(payload2.paid_price, 47000);
  // null (chưa nhập) giữ nguyên null cả hai chiều:
  const payload3 = Core.toDbPayload('phases', { monthlyCvr: null, cogsPerFreeUser: null, cogsPerPaidUser: null, paidPrice: null }, {});
  assert.equal(payload3.monthly_cvr, null);
  assert.equal(payload3.paid_price, null);
  assert.equal(Core.fromDbRow('phases', payload3).paidPrice, null);
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
  // Đợt Email 18/11: benchmark 'Email Sends' dùng CÙNG 2 cột này với
  // ngữ nghĩa Email (visit_to_freemium = click/open 0,10;
  // freemium_to_paid = click→paid 0,01) nên tách khỏi vòng 0,09/0,0275.
  const withRates = lumus.filter((b) => b.visit_to_freemium != null && b.channel !== 'Email Sends');
  assert.ok(withRates.length >= 5, 'KOL + Meta + TikTok phải có tỉ lệ mới');
  for (const b of withRates) {
    assert.equal(b.visit_to_freemium, 0.09, b.channel + ': visit_to_freemium phải = 0.09');
    assert.equal(b.freemium_to_paid, 0.0275, b.channel + ': freemium_to_paid phải = 0.0275 (= 0.5 × 0.055)');
  }
  const emailBm = lumus.find((b) => b.channel === 'Email Sends');
  assert.ok(emailBm, 'phải có benchmark Email Sends (đợt Email 18/11)');
  assert.equal(emailBm.view_to_visit, 0.30, 'Email: view_to_visit = open rate 0,30');
  assert.equal(emailBm.visit_to_freemium, 0.10, 'Email: visit_to_freemium = click/open 0,10');
  assert.equal(emailBm.freemium_to_paid, 0.01, 'Email: freemium_to_paid = click→paid 0,01');
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

test('0018 [migration bổ sung]: benchmarks + phase_assumptions có đủ cột phễu mới numeric(12,8), cột cũ giữ nguyên', () => {
  assert.match(mig, /alter table public\.benchmarks add column if not exists visit_to_freemium numeric\(12,8\)/);
  assert.match(mig, /alter table public\.benchmarks add column if not exists freemium_to_paid numeric\(12,8\)/);
  assert.match(mig, /alter table public\.phase_assumptions add column if not exists visit_to_freemium numeric\(12,8\)/);
  assert.match(mig, /alter table public\.phase_assumptions add column if not exists freemium_to_paid numeric\(12,8\)/);
  // Cột cũ không bị xoá (đã khẳng định ở test migration phases, nhắc lại cho 2 bảng này):
  assert.ok(!/drop column/i.test(mig), 'migration 0018 không được chứa drop column');
});

test('0018 [store-core bổ sung]: TABLE_COLUMNS.benchmarks và TABLE_COLUMNS.phase_assumptions chứa 2 cột phễu mới', () => {
  for (const table of ['benchmarks', 'phase_assumptions']) {
    for (const c of ['visit_to_freemium', 'freemium_to_paid']) {
      assert.ok(Core.hasColumn(table, c), table + ' thiếu cột ' + c);
      assert.ok(Core.TABLE_COLUMNS[table].includes(c), table + ' TABLE_COLUMNS thiếu ' + c);
    }
    // Cột cũ vẫn còn để engine fallback:
    assert.ok(Core.hasColumn(table, 'visit_to_signup'), table + ' mất cột cũ visit_to_signup');
    assert.ok(Core.hasColumn(table, 'first_to_paid'), table + ' mất cột cũ first_to_paid');
  }
  // camelCase tự khớp, không cần FIELD_ALIASES:
  assert.equal(Core.camelToSnake('visitToFreemium'), 'visit_to_freemium');
  assert.equal(Core.camelToSnake('freemiumToPaid'), 'freemium_to_paid');
  assert.equal(Core.snakeToCamel('visit_to_freemium'), 'visitToFreemium');
  assert.equal(Core.snakeToCamel('freemium_to_paid'), 'freemiumToPaid');
});

test('0018 [round-trip benchmarks]: visitToFreemium 0.09 + freemiumToPaid 0.0275 qua toDbPayload → fromDbRow giữ nguyên', () => {
  const bench = {
    brand_id: 'brand-lumus-ai', channel: 'KOL Nano', group: 'KOL',
    view_to_visit: 0.003, visitToFreemium: 0.09, freemiumToPaid: 0.0275
  };
  const payload = Core.toDbPayload('benchmarks', bench, { forInsert: true, workspaceId: 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6' });
  assert.equal(payload.visit_to_freemium, 0.09);
  assert.equal(payload.freemium_to_paid, 0.0275);
  assert.equal(payload.view_to_visit, 0.003);
  const back = Core.fromDbRow('benchmarks', payload);
  assert.equal(back.visitToFreemium, 0.09);
  assert.equal(back.freemiumToPaid, 0.0275);
  // Dạng snake_case (như demo-data) cũng phải qua được:
  const payload2 = Core.toDbPayload('benchmarks', { visit_to_freemium: 0.09, freemium_to_paid: 0.0275 }, { forInsert: true });
  assert.equal(payload2.visit_to_freemium, 0.09);
  assert.equal(payload2.freemium_to_paid, 0.0275);
  const back2 = Core.fromDbRow('benchmarks', payload2);
  assert.equal(back2.visitToFreemium, 0.09);
  assert.equal(back2.freemiumToPaid, 0.0275);
  // phase_assumptions cùng cơ chế (cột đã có trong whitelist):
  const paPayload = Core.toDbPayload('phase_assumptions', { phase_id: 'phase-lumus-1', channel: 'KOL Nano', visitToFreemium: 0.09, freemiumToPaid: 0.0275 }, { forInsert: true });
  assert.equal(paPayload.visit_to_freemium, 0.09);
  assert.equal(paPayload.freemium_to_paid, 0.0275);
  const paBack = Core.fromDbRow('phase_assumptions', paPayload);
  assert.equal(paBack.visitToFreemium, 0.09);
  assert.equal(paBack.freemiumToPaid, 0.0275);
});

test('0018 [seed]: seed chứa visit_to_freemium + freemium_to_paid trong phần insert benchmarks', () => {
  const benchInserts = seed.match(/^insert into public\.benchmarks .*$/gm) || [];
  assert.ok(benchInserts.length > 0, 'seed phải có insert benchmarks');
  assert.ok(benchInserts.some((l) => l.includes('visit_to_freemium')), 'insert benchmarks trong seed thiếu cột visit_to_freemium');
  assert.ok(benchInserts.some((l) => l.includes('freemium_to_paid')), 'insert benchmarks trong seed thiếu cột freemium_to_paid');
  // Giá trị tỉ lệ mới của Lumus phải xuất hiện trong các dòng insert đó:
  assert.ok(benchInserts.some((l) => l.includes('0.09') && l.includes('0.0275')), 'insert benchmarks phải mang giá trị 0.09 / 0.0275');
});

test('0018 [demo-data]: số neo không đổi — tổng qty Lumus 776, tổng ngân sách năm 1.598.700.000đ', () => {
  const domain = require('../js/domain.js');
  const lumus = demo.plan_rows.filter((r) => r.brand_id === 'brand-lumus-ai');
  assert.equal(lumus.reduce((s, r) => s + (r.qty || 0), 0), 776);
  assert.equal(domain.planBudget(lumus, demo.benchmarks).total, 1598700000);
});
