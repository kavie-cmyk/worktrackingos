// tests/r31-domain.test.mjs
// Kiểm thử vòng R3.1 — PHẦN DOMAIN tiền/KPI (js/domain.js):
//   - summarizeBudgetScope: engine ngân sách dùng chung campaign/activity,
//     chống đếm trùng theo fact ID, allocation share, tách currency (D.1).
//   - validateAllocations / allocationShareForScope: chặn over-allocation.
//   - rollupKpi: sum / unique / ratio / snapshot theo C.4 + fixture D.2.
// Fixture số theo file R3.1 phần D (triệu VND cho ngân sách livestream).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');

// ---------------------------------------------------------------------------
// Fixture D.1 — ngân sách livestream (triệu VND)
// Mỗi action: 1 commitment gốc (amount = actual + phần còn mở) + 1 actual
// liên kết commitment đó. Phần còn mở suy ra từ actuals liên kết — cùng
// một nguồn sự thật như budgetRemaining của R2.
// ---------------------------------------------------------------------------

const ACTIONS = [
  { id: 'act-invite', allocated: 8, actual: 6, open: 2 },
  { id: 'act-ads', allocated: 15, actual: 10, open: 4 },
  { id: 'act-seeding', allocated: 5, actual: 3, open: 1 },
  { id: 'act-live', allocated: 2, actual: 1.5, open: 0.5 },
];

function livestreamFacts() {
  const commitments = [];
  const actuals = [];
  for (const a of ACTIONS) {
    commitments.push({
      id: `com-${a.id}`, kind: 'commitment', amount: a.actual + a.open,
      status: 'committed', currency: 'VND', activityId: a.id,
    });
    actuals.push({
      id: `pay-${a.id}`, kind: 'actual', amount: a.actual,
      commitmentId: `com-${a.id}`, currency: 'VND', activityId: a.id,
    });
  }
  return { commitments, actuals };
}

function childAllocations() {
  return ACTIONS.map((a) => ({ id: `alloc-${a.id}`, scopeId: a.id, amount: a.allocated, currency: 'VND' }));
}

// ---------------------------------------------------------------------------
// D.1 — Tổng campaign
// ---------------------------------------------------------------------------

test('R3.1 D.1 summarizeBudgetScope: campaign allocated=30, actual=20.5, open=7.5, forecast=28, unallocated=2, available=4 (không phải 6)', () => {
  const { commitments, actuals } = livestreamFacts();
  const s = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), commitments, actuals,
  });
  assert.equal(s.allocated, 30);
  assert.equal(s.actualTotal, 20.5);
  assert.equal(s.openCommitments, 7.5);
  assert.equal(s.forecastUse, 28);
  assert.equal(s.unallocated, 2, 'chưa phân bổ = 32 − 30');
  assert.equal(s.available, 4, 'còn dùng được = 32 − 20.5 − 7.5');
  assert.notEqual(s.available, 6, 'available KHÔNG được cộng thêm unallocated (2) lần nữa thành 6');
  assert.equal(s.currency, 'VND');
  assert.equal(s.mixed, false);
  assert.equal(s.byCurrency.VND.available, 4);
});

test('R3.1 D.1 summarizeBudgetScope theo từng activity (cùng engine): còn trong hạn mức Mời khách=0, Ads=1, Seeding=1, Tổ chức live=0', () => {
  const { commitments, actuals } = livestreamFacts();
  const expected = { 'act-invite': 0, 'act-ads': 1, 'act-seeding': 1, 'act-live': 0 };
  for (const a of ACTIONS) {
    const s = domain.summarizeBudgetScope({
      ceiling: a.allocated, currency: 'VND', scopeId: a.id, commitments, actuals,
    });
    assert.equal(s.actualTotal, a.actual, `${a.id}: actual theo scope`);
    assert.equal(s.openCommitments, a.open, `${a.id}: cam kết còn mở theo scope`);
    assert.equal(s.forecastUse, a.actual + a.open, `${a.id}: dự kiến sử dụng`);
    assert.equal(s.available, expected[a.id], `${a.id}: còn trong hạn mức action`);
  }
});

test('R3.1 D.1 hóa đơn chung 3tr chia Ads 60% / Seeding 40%: Ads thấy 1.8, Seeding 1.2, campaign chỉ +3 (không phải +6)', () => {
  const invoice = {
    id: 'pay-shared-invoice', kind: 'actual', amount: 3, currency: 'VND',
    allocations: [
      { scopeId: 'act-ads', ratio: 0.6 },
      { scopeId: 'act-seeding', ratio: 0.4 },
    ],
  };
  assert.equal(domain.allocationShareForScope(invoice, 'act-ads'), 1.8);
  assert.equal(domain.allocationShareForScope(invoice, 'act-seeding'), 1.2);
  assert.equal(domain.allocationShareForScope(invoice, null), 3, 'view campaign lấy trọn fact gốc 1 lần');

  const { commitments, actuals } = livestreamFacts();
  const withInvoice = [...actuals, invoice];
  const campaign = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), commitments, actuals: withInvoice,
  });
  assert.equal(campaign.actualTotal, 23.5, 'campaign = 20.5 + 3 đúng một lần, không phải 20.5 + 6');
  const ads = domain.summarizeBudgetScope({ ceiling: 15, currency: 'VND', scopeId: 'act-ads', commitments, actuals: withInvoice });
  assert.equal(ads.actualTotal, 11.8, 'Ads = 10 + share 1.8');
  const seeding = domain.summarizeBudgetScope({ ceiling: 5, currency: 'VND', scopeId: 'act-seeding', commitments, actuals: withInvoice });
  assert.equal(seeding.actualTotal, 4.2, 'Seeding = 3 + share 1.2');
});

test('R3.1 D.1 thêm task + 2 content + KPI thứ hai vào Ads (chỉ thêm tham chiếu, trùng fact ID): actual campaign vẫn 20.5, actual Ads vẫn 10', () => {
  const { commitments, actuals } = livestreamFacts();
  // Fact gốc của Ads bị tham chiếu lại từ view task/content/KPI và bị liệt
  // kê trùng trong danh sách actuals — engine khử trùng theo fact ID.
  const adsActual = actuals.find((a) => a.id === 'pay-act-ads');
  const s = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), commitments,
    actuals: [...actuals, adsActual, { ...adsActual }],
    views: [
      { type: 'task', id: 'task-ads-video', factIds: ['pay-act-ads'] },
      { type: 'content', id: 'content-ads-1', factIds: ['pay-act-ads'] },
      { type: 'content', id: 'content-ads-2', factIds: ['pay-act-ads'] },
      { type: 'kpi', id: 'kpi-ads-2', factIds: ['pay-act-ads'] },
    ],
    references: [{ factId: 'pay-act-ads', via: 'kpi-2' }, { factId: 'pay-act-ads', via: 'content-1' }],
  });
  assert.equal(s.actualTotal, 20.5, 'thêm tham chiếu không tạo thêm chi phí');
  assert.ok(s.duplicateFactIds.includes('pay-act-ads'), 'fact trùng ID phải bị ghi nhận là đã khử trùng');

  const ads = domain.summarizeBudgetScope({
    ceiling: 15, currency: 'VND', scopeId: 'act-ads', commitments,
    actuals: [...actuals, adsActual],
  });
  assert.equal(ads.actualTotal, 10, 'chi Ads không tăng từ 10 lên 20 khi thêm KPI/content');
});

test('R3.1 summarizeBudgetScope: unallocated trừ thêm hạn mức chi trực tiếp campaign khi có tham số directCeiling', () => {
  const { commitments, actuals } = livestreamFacts();
  const s = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND', childAllocations: childAllocations(), directCeiling: 1, commitments, actuals,
  });
  assert.equal(s.unallocated, 1, '32 − 30 đã phân bổ − 1 trực tiếp campaign');
  assert.equal(s.available, 4, 'available vẫn = ceiling − actual − open, không đổi theo directCeiling');
});

// ---------------------------------------------------------------------------
// validateAllocations — chặn over-allocation
// ---------------------------------------------------------------------------

test('R3.1 validateAllocations: chia 60/40 hợp lệ; tổng allocation vượt 100% / vượt amount gốc bị trả lỗi', () => {
  const fact = { id: 'inv-1', amount: 3 };
  const ok = domain.validateAllocations(fact, [
    { scopeId: 'act-ads', ratio: 0.6 },
    { scopeId: 'act-seeding', ratio: 0.4 },
  ]);
  assert.equal(ok.valid, true);
  assert.equal(ok.totalAllocated, 3);
  assert.equal(ok.unallocated, 0);

  const overRatio = domain.validateAllocations(fact, [
    { scopeId: 'act-ads', ratio: 0.6 },
    { scopeId: 'act-seeding', ratio: 0.5 },
  ]);
  assert.equal(overRatio.valid, false);
  assert.ok(overRatio.errors.includes('allocation_exceeds_100_percent'));
  assert.ok(overRatio.errors.includes('over_allocated'));

  const overAmount = domain.validateAllocations(fact, [
    { scopeId: 'act-ads', amount: 2 },
    { scopeId: 'act-seeding', amount: 1.5 },
  ]);
  assert.equal(overAmount.valid, false);
  assert.ok(overAmount.errors.includes('over_allocated'));
  assert.equal(overAmount.totalAllocated, 3.5);

  const overPercent = domain.validateAllocations({ id: 'inv-2', amount: 10 }, [
    { scopeId: 'a', percent: 70 },
    { scopeId: 'b', percent: 40 },
  ]);
  assert.equal(overPercent.valid, false);
  assert.ok(overPercent.errors.includes('allocation_exceeds_100_percent'));

  // summarize cũng phải lộ lỗi allocation của fact bị chia vượt.
  const s = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND',
    actuals: [{
      id: 'inv-bad', kind: 'actual', amount: 3, currency: 'VND',
      allocations: [{ scopeId: 'act-ads', ratio: 0.6 }, { scopeId: 'act-seeding', ratio: 0.6 }],
    }],
  });
  assert.equal(s.valid, false);
  assert.equal(s.allocationErrors.length, 1);
  assert.equal(s.allocationErrors[0].factId, 'inv-bad');
});

test('R3.1 summarizeBudgetScope: tách currency — USD không cộng chung vào VND, không có số gộp trộn ở top-level', () => {
  const s = domain.summarizeBudgetScope({
    ceiling: 32, currency: 'VND',
    commitments: [],
    actuals: [
      { id: 'a-vnd', kind: 'actual', amount: 20.5, currency: 'VND' },
      { id: 'a-usd', kind: 'actual', amount: 100, currency: 'USD' },
    ],
  });
  assert.equal(s.mixed, true);
  assert.equal(s.actualTotal, null, 'nhiều currency thì top-level không xuất số gộp trộn');
  assert.equal(s.byCurrency.VND.actualTotal, 20.5);
  assert.equal(s.byCurrency.USD.actualTotal, 100);
  assert.notEqual(s.byCurrency.VND.actualTotal, 120.5);
});

// ---------------------------------------------------------------------------
// Fixture D.2 — KPI livestream
// ---------------------------------------------------------------------------

function registrationSumFacts() {
  return [
    { id: 'reg-ads', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', value: 100 },
    { id: 'reg-seeding', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', value: 60 },
  ];
}

function idRange(prefix, from, to, messy = false) {
  const out = [];
  for (let i = from; i <= to; i++) {
    const raw = `${prefix}-${String(i).padStart(3, '0')}`;
    out.push(messy ? ` ${raw.toUpperCase()} ` : raw);
  }
  return out;
}

test('R3.1 D.2 rollupKpi sum: chỉ cộng cùng metric_code/unit/period — 2 khách + 20 bài seeding KHÔNG lọt vào SUM đăng ký', () => {
  const facts = [
    ...registrationSumFacts(),
    { id: 'kpi-guests', metricCode: 'guests_confirmed', unit: 'person', period: '2026-11', value: 2 },
    { id: 'kpi-posts', metricCode: 'seeding_posts', unit: 'post', period: '2026-11', value: 20 },
  ];
  const r = domain.rollupKpi(facts, { mode: 'sum', metricCode: 'valid_registrations', unit: 'person', period: '2026-11' });
  assert.equal(r.value, 160, 'chỉ 100 + 60 đăng ký hợp lệ');
  assert.notEqual(r.value, 182, 'không cộng 2 khách + 20 bài vào SUM đăng ký');
  const excludedIds = r.excluded.map((e) => e.id);
  assert.ok(excludedIds.includes('kpi-guests') && excludedIds.includes('kpi-posts'), 'fact khác metric phải bị loại và báo riêng');
  assert.ok(r.excluded.every((e) => e.reason === 'metric_mismatch' || e.reason === 'unit_mismatch'));
});

test('R3.1 rollupKpi sum: fact khác unit hoặc khác period bị loại và báo riêng, không cộng ngầm', () => {
  const facts = [
    { id: 'ok-1', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', value: 100 },
    { id: 'bad-unit', metricCode: 'valid_registrations', unit: 'registration_form', period: '2026-11', value: 999 },
    { id: 'bad-period', metricCode: 'valid_registrations', unit: 'person', period: '2026-10', value: 888 },
  ];
  const r = domain.rollupKpi(facts, { mode: 'sum', metricCode: 'valid_registrations', unit: 'person', period: '2026-11' });
  assert.equal(r.value, 100);
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reason]));
  assert.equal(byId['bad-unit'], 'unit_mismatch');
  assert.equal(byId['bad-period'], 'period_mismatch');
});

test('R3.1 D.2 rollupKpi unique: ads 100 + seeding 60, giao nhau 20 ID đã chuẩn hoá → 140; đạt 93.33% của target 150', () => {
  const facts = [
    {
      id: 'uniq-ads', metricCode: 'valid_registrations', unit: 'person', period: '2026-11',
      value: 100, identities: idRange('reg', 1, 100),
    },
    {
      id: 'uniq-seeding', metricCode: 'valid_registrations', unit: 'person', period: '2026-11',
      value: 60,
      // 20 ID trùng với ads nhưng viết hoa + thừa khoảng trắng → chuẩn hoá vẫn khử trùng.
      identities: [...idRange('reg', 81, 100, true), ...idRange('reg', 101, 140)],
    },
  ];
  const r = domain.rollupKpi(facts, {
    mode: 'unique', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', target: 150,
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 140, '100 + 60 − 20 trùng');
  assert.notEqual(r.value, 160);
  assert.equal(r.achievementPercent, 93.33, '140/150 làm tròn 2 chữ số');
});

test('R3.1 D.2 rollupKpi unique: thiếu khóa định danh → value null + insufficient_data, TUYỆT ĐỐI không trả 160', () => {
  const facts = [
    { id: 'noid-ads', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', value: 100 },
    { id: 'noid-seeding', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', value: 60, identities: idRange('reg', 1, 60) },
  ];
  const r = domain.rollupKpi(facts, {
    mode: 'unique', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', target: 150,
  });
  assert.equal(r.value, null);
  assert.equal(r.status, 'insufficient_data');
  assert.notEqual(r.value, 160);
  assert.ok(r.missingIdentityFactIds.includes('noid-ads'));
  assert.equal(r.achievementPercent, null);
});

test('R3.1 D.2 rollupKpi ratio: CPL tính lại từ Σ tử/Σ mẫu theo scope — Ads 100000 khác campaign ≈146429, nhãn scope khác nhau', () => {
  const ads = domain.rollupKpi([], {
    mode: 'ratio', scope: 'activity:act-ads', scopeLabel: 'Ads', currency: 'VND',
    numeratorFacts: [{ id: 'spend-ads', value: 10000000 }],
    denominatorFacts: [{ id: 'reg-ads-only', value: 100 }],
  });
  assert.equal(ads.value, 100000, '10.000.000 / 100 đăng ký scope Ads');
  assert.equal(ads.scopeLabel, 'Ads');
  assert.equal(ads.numeratorTotal, 10000000);
  assert.equal(ads.denominatorTotal, 100);

  const campaign = domain.rollupKpi([], {
    mode: 'ratio', scope: 'campaign', scopeLabel: 'Toàn campaign', currency: 'VND',
    numeratorFacts: [{ id: 'spend-campaign', value: 20500000 }],
    denominatorFacts: [{ id: 'reg-unique', value: 140 }],
  });
  assert.equal(Math.round(campaign.value), 146429, '20.500.000 / 140 unique toàn campaign');
  assert.equal(campaign.scopeLabel, 'Toàn campaign');
  assert.notEqual(campaign.value, ads.value, 'hai scope cho hai kết quả khác nhau');
  assert.notEqual(campaign.scope, ads.scope);
});

test('R3.1 rollupKpi ratio: mẫu số 0/thiếu → value null + insufficient_data (không chia cho 0, không 0 giả)', () => {
  const r = domain.rollupKpi([], {
    mode: 'ratio', scopeLabel: 'Ads',
    numeratorFacts: [{ id: 'spend', value: 1000 }],
    denominatorFacts: [{ id: 'reg', value: 0 }],
  });
  assert.equal(r.value, null);
  assert.equal(r.status, 'insufficient_data');
});

test('R3.1 D.2 rollupKpi snapshot: cùng một post đo 100 rồi 150 views → lấy 150, không phải 250', () => {
  const facts = [
    { id: 'obs-1', objectId: 'post-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 100, observedAt: '2026-11-10T10:00:00.000Z' },
    { id: 'obs-2', objectId: 'post-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 150, observedAt: '2026-11-11T10:00:00.000Z' },
  ];
  const r = domain.rollupKpi(facts, { mode: 'snapshot', metricCode: 'views', unit: 'view', period: '2026-11' });
  assert.equal(r.value, 150);
  assert.notEqual(r.value, 250);
  assert.equal(r.perObject.length, 1);
  assert.equal(r.perObject[0].value, 150);
});

test('R3.1 rollupKpi snapshot: nhiều object thì cộng snapshot mới nhất của từng object (150 + 80 = 230)', () => {
  const facts = [
    { id: 'o1', objectId: 'post-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 100, observedAt: '2026-11-10T10:00:00.000Z' },
    { id: 'o2', objectId: 'post-1', metricCode: 'views', unit: 'view', period: '2026-11', value: 150, observedAt: '2026-11-11T10:00:00.000Z' },
    { id: 'o3', objectId: 'post-2', metricCode: 'views', unit: 'view', period: '2026-11', value: 80, observedAt: '2026-11-09T10:00:00.000Z' },
  ];
  const r = domain.rollupKpi(facts, { mode: 'snapshot', metricCode: 'views', unit: 'view', period: '2026-11' });
  assert.equal(r.value, 230);
  assert.equal(r.perObject.length, 2);
});

test('R3.1 rollupKpi: cùng một fact xuất hiện qua 2 mapping/KPI khác nhau → khử trùng theo fact ID, tính 1 lần', () => {
  const shared = { id: 'reg-shared', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', value: 100 };
  const facts = [
    shared,
    { ...shared }, // mapping thứ hai trỏ cùng fact gốc
    { id: 'reg-seeding', metricCode: 'valid_registrations', unit: 'person', period: '2026-11', value: 60 },
  ];
  const r = domain.rollupKpi(facts, { mode: 'sum', metricCode: 'valid_registrations', unit: 'person', period: '2026-11' });
  assert.equal(r.value, 160, 'fact trùng ID chỉ tính 1 lần: 100 + 60, không phải 260');
  assert.ok(r.duplicateFactIds.includes('reg-shared'));
  assert.deepEqual(r.includedFactIds, ['reg-shared', 'reg-seeding']);
});

test('R3.1 rollupKpi unique: fact trùng ID qua 2 mapping vẫn chỉ đóng góp tập ID của nó 1 lần', () => {
  const shared = {
    id: 'u-shared', metricCode: 'valid_registrations', unit: 'person', period: '2026-11',
    value: 3, identities: ['reg-001', 'reg-002', 'reg-003'],
  };
  const r = domain.rollupKpi([shared, { ...shared }], {
    mode: 'unique', metricCode: 'valid_registrations', unit: 'person', period: '2026-11',
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.value, 3);
  assert.ok(r.duplicateFactIds.includes('u-shared'));
});

// ---------------------------------------------------------------------------
// Hồi quy R2 — budgetRemaining giữ nguyên hành vi theo payment (không đổi)
// ---------------------------------------------------------------------------

test('R3.1 hồi quy: budgetRemaining R2 vẫn theo payment liên kết (approved 1000, commitment 1000, actual 400 → còn 0)', () => {
  const commitments = [{ id: 'C1', amount: 1000, status: 'partially_actualised', settledAmount: 0 }];
  const actuals = [{ amount: 400, commitmentId: 'C1' }];
  assert.equal(domain.openCommitmentTotal(commitments, actuals), 600);
  assert.equal(domain.budgetRemaining({ approved: 1000 }, commitments, actuals), 0);
});
