// tests/kpi-post-metrics.test.mjs
// LINK KPI <-> BỘ ĐẾM BÀI ĐÃ ĐĂNG — phần domain + store (executor A):
//   - domain: POST_METRIC_CODES (danh mục mã thật của metric_observations),
//     kpiDataSource (đọc definition.dataSource), postMetricActual thuần
//     (latest_sum / period_sum, khử trùng theo post, lọc kỳ, khớp object).
//   - store: kpiScopePosts (resolve theo scope qua quan hệ thật),
//     kpiAutoActual / refreshKpiAutoActuals (actual suy diễn ở state,
//     KHÔNG ghi measurement), chặn ghi measurement cho KPI auto với mã
//     KPI_AUTO_SOURCE ở mọi đường (demo + remote), đổi dataSource ->
//     push kpiTargetVersions như đổi target, roll-up cha chỉ dùng
//     kpi.actual của KPI auto như 1 fact duy nhất (không cộng lại obs).
// Mọi kiểm chứng ở tầng domain/demo-state — không đụng DB live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const domain = require('../js/domain.js');
require('../js/domain.js'); // nạp SAVA_DOMAIN cho Store._domain()
const Store = require('../js/store.js');
require('../js/demo-data.js'); // nạp SAVA_DEMO_DATA cho test tích hợp demo

const WS = 'ws-1';
const OWNER = 'u-owner';
const AUTO_MSG = 'KPI này lấy số tự động từ bài đã đăng, không nhập tay được.';

function autoKpi(extra) {
  return Object.assign({
    id: 'kpi-auto', scopeType: 'campaign', campaignId: 'camp-1', name: 'Views tự động',
    metricCode: 'lifetime_views', target: 500, actual: null, unit: 'lượt xem', periodKey: '2026-11',
    targetVersion: 1,
    definition: { description: 'Tự tính', dataSource: { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum' } },
  }, extra || {});
}

// ---------------------------------------------------------------------------
// Domain — danh mục metric + kpiDataSource
// ---------------------------------------------------------------------------
test('POST_METRIC_CODES: đúng các mã đang dùng thật cho metric_observations', () => {
  for (const code of ['lifetime_views', 'views', 'reach', 'impressions', 'likes', 'comments', 'shares']) {
    assert.ok(domain.POST_METRIC_CODES.includes(code), 'thiếu mã ' + code);
  }
});

test('kpiDataSource: manual / type khác -> null; post_metrics -> config chuẩn hoá', () => {
  assert.equal(domain.kpiDataSource(null), null);
  assert.equal(domain.kpiDataSource({}), null);
  assert.equal(domain.kpiDataSource({ definition: { description: 'chỉ mô tả' } }), null);
  assert.equal(domain.kpiDataSource({ definition: { dataSource: { type: 'manual', metric: 'views' } } }), null);
  assert.equal(domain.kpiDataSource({ definition: { dataSource: { type: 'post_metrics' } } }), null, 'thiếu metric -> null');
  assert.deepEqual(
    domain.kpiDataSource({ definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'period_sum' } } }),
    { type: 'post_metrics', metric: 'views', mode: 'period_sum' });
  // mode thiếu -> latest_sum; definition dạng chuỗi JSON cũng đọc được.
  assert.deepEqual(
    domain.kpiDataSource({ definition: '{"dataSource":{"type":"post_metrics","metric":"reach"}}' }),
    { type: 'post_metrics', metric: 'reach', mode: 'latest_sum' });
  // channelAccountId trong dataSource được giữ lại cho tầng store lọc kênh.
  assert.equal(
    domain.kpiDataSource({ definition: { dataSource: { type: 'post_metrics', metric: 'views', channelAccountId: 'chan-1' } } }).channelAccountId,
    'chan-1');
});

// ---------------------------------------------------------------------------
// Domain — postMetricActual / latest_sum
// ---------------------------------------------------------------------------
test('latest_sum: bài đo 100 -> 150 tính 150, KHÔNG phải 250', () => {
  const posts = [{ id: 'p1', title: 'Bài 1', platform: 'facebook' }];
  const obs = [
    { externalPostId: 'p1', metric: 'lifetime_views', value: 100, observedAt: '2026-11-05T10:00:00+07:00' },
    { externalPostId: 'p1', metric: 'lifetime_views', value: 150, observedAt: '2026-11-07T10:00:00+07:00' },
  ];
  const r = domain.postMetricActual(autoKpi(), posts, obs);
  assert.equal(r.value, 150);
  assert.notEqual(r.value, 250);
  assert.equal(r.postCount, 1);
  assert.equal(r.latestObservedAt, '2026-11-07T10:00:00+07:00');
  assert.deepEqual(r.rows, [{ postId: 'p1', title: 'Bài 1', platform: 'facebook', value: 150, observedAt: '2026-11-07T10:00:00+07:00' }]);
});

test('latest_sum: 2 bài 150 + 200 = 350, rows giảm dần theo value', () => {
  const posts = [
    { id: 'p1', title: 'Bài 1', platform: 'facebook' },
    { id: 'p2', title: 'Bài 2', platform: 'tiktok' },
  ];
  const obs = [
    { externalPostId: 'p1', metric: 'lifetime_views', value: 150, observedAt: '2026-11-07T10:00:00+07:00' },
    { externalPostId: 'p2', metric: 'lifetime_views', value: 200, observedAt: '2026-11-06T10:00:00+07:00' },
    { externalPostId: 'p2', metric: 'impressions', value: 9999, observedAt: '2026-11-06T10:00:00+07:00' },
  ];
  const r = domain.postMetricActual(autoKpi(), posts, obs);
  assert.equal(r.value, 350);
  assert.equal(r.postCount, 2);
  assert.deepEqual(r.rows.map((x) => x.postId), ['p2', 'p1']);
  assert.equal(r.latestObservedAt, '2026-11-07T10:00:00+07:00');
});

test('latest_sum: cùng 1 post truyền trùng id chỉ tính 1 lần', () => {
  const post = { id: 'p1', title: 'Bài 1', platform: 'facebook' };
  const obs = [{ externalPostId: 'p1', metric: 'lifetime_views', value: 150, observedAt: '2026-11-07T10:00:00+07:00' }];
  const r = domain.postMetricActual(autoKpi(), [post, post, Object.assign({}, post)], obs);
  assert.equal(r.value, 150);
  assert.equal(r.postCount, 1);
});

test('latest_sum: chỉ lấy observation TRONG kỳ KPI (periodKey tháng + periodStart/End)', () => {
  const posts = [{ id: 'p1', title: 'Bài 1', platform: 'facebook' }];
  const obs = [
    { externalPostId: 'p1', metric: 'lifetime_views', value: 999, observedAt: '2026-10-31T10:00:00+07:00' },
    { externalPostId: 'p1', metric: 'lifetime_views', value: 100, observedAt: '2026-11-05T10:00:00+07:00' },
    { externalPostId: 'p1', metric: 'lifetime_views', value: 150, observedAt: '2026-11-07T10:00:00+07:00' },
  ];
  // periodKey '2026-11' của autoKpi: obs tháng 10 bị loại dù lớn hơn.
  assert.equal(domain.postMetricActual(autoKpi(), posts, obs).value, 150);
  // Kỳ tường minh periodStart/periodEnd.
  const k2 = autoKpi({ periodKey: undefined, periodStart: '2026-11-06', periodEnd: '2026-11-30' });
  assert.equal(domain.postMetricActual(k2, posts, obs).value, 150);
  const k3 = autoKpi({ periodKey: undefined, periodStart: '2026-11-01', periodEnd: '2026-11-06' });
  assert.equal(domain.postMetricActual(k3, posts, obs).value, 100);
});

test('postMetricActual: khớp objectId chỉ khi objectType là external_post/post/không có', () => {
  const posts = [{ id: 'p1', title: 'Bài 1', platform: 'facebook' }];
  const mk = (extra) => Object.assign({ metric: 'lifetime_views', value: 100, observedAt: '2026-11-05T10:00:00+07:00' }, extra);
  assert.equal(domain.postMetricActual(autoKpi(), posts, [mk({ objectId: 'p1', objectType: 'external_post' })]).value, 100);
  assert.equal(domain.postMetricActual(autoKpi(), posts, [mk({ objectId: 'p1', objectType: 'post' })]).value, 100);
  assert.equal(domain.postMetricActual(autoKpi(), posts, [mk({ objectId: 'p1' })]).value, 100);
  assert.equal(domain.postMetricActual(autoKpi(), posts, [mk({ objectId: 'p1', objectType: 'ad' })]).value, 0);
  assert.equal(domain.postMetricActual(autoKpi(), posts, [mk({ objectId: 'p1', objectType: 'content_variant' })]).value, 0);
  // metricCode (snake/camel của DB) cũng khớp như metric.
  assert.equal(domain.postMetricActual(autoKpi(), posts, [mk({ externalPostId: 'p1', metric: undefined, metricCode: 'lifetime_views' })]).value, 100);
});

// ---------------------------------------------------------------------------
// Domain — postMetricActual / period_sum
// ---------------------------------------------------------------------------
test('period_sum: chỉ cộng observation trong kỳ — obs ngoài kỳ bị loại', () => {
  const kpi = autoKpi({
    periodKey: undefined, periodStart: '2026-11-01', periodEnd: '2026-11-30',
    definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'period_sum' } },
  });
  const posts = [{ id: 'p1', title: 'Bài 1', platform: 'facebook' }];
  const obs = [
    { externalPostId: 'p1', metric: 'views', value: 10, periodStart: '2026-11-01', periodEnd: '2026-11-07', observedAt: '2026-11-08T00:00:00Z' },
    { externalPostId: 'p1', metric: 'views', value: 20, observedAt: '2026-11-15T00:00:00Z' },
    { externalPostId: 'p1', metric: 'views', value: 70, observedAt: '2026-12-01T00:00:00Z' },
    { externalPostId: 'p1', metric: 'views', value: 50, periodStart: '2026-10-01', periodEnd: '2026-10-31', observedAt: '2026-11-01T00:00:00Z' },
    { externalPostId: 'p1', metric: 'views', value: 5, periodStart: '2026-11-28', periodEnd: '2026-12-05', observedAt: '2026-12-06T00:00:00Z' },
  ];
  const r = domain.postMetricActual(kpi, posts, obs);
  // 10 (kỳ obs giao kỳ KPI) + 20 (điểm trong kỳ) + 5 (kỳ obs giao một phần) = 35.
  // 70 (tháng 12) và 50 (kỳ tháng 10, dù observedAt ở tháng 11) bị loại.
  assert.equal(r.value, 35);
  assert.equal(r.postCount, 1);
  assert.equal(r.rows[0].value, 35);
});

test('reach: kết quả KHÔNG mang nhãn/field unique nào', () => {
  const kpi = autoKpi({ definition: { dataSource: { type: 'post_metrics', metric: 'reach', mode: 'latest_sum' } } });
  const posts = [
    { id: 'p1', title: 'Bài 1', platform: 'facebook' },
    { id: 'p2', title: 'Bài 2', platform: 'instagram' },
  ];
  const obs = [
    { externalPostId: 'p1', metric: 'reach', value: 800, observedAt: '2026-11-09T09:00:00+07:00' },
    { externalPostId: 'p2', metric: 'reach', value: 300, observedAt: '2026-11-09T09:00:00+07:00' },
  ];
  const r = domain.postMetricActual(kpi, posts, obs);
  assert.equal(r.value, 1100, 'tổng là cộng snapshot mới nhất từng bài — không tuyên bố khử trùng người xem');
  assert.deepEqual(Object.keys(r).sort(), ['latestObservedAt', 'postCount', 'rows', 'value']);
  assert.ok(!('unique' in r), 'kết quả không được có field unique');
  assert.ok(!JSON.stringify(r).includes('"unique"'), 'không nhãn unique ở bất kỳ field nào, kể cả trong rows');
  r.rows.forEach((row) => assert.deepEqual(Object.keys(row).sort(), ['observedAt', 'platform', 'postId', 'title', 'value']));
});

test('postMetricActual: KPI manual -> kết quả rỗng (value 0, không rows)', () => {
  const r = domain.postMetricActual({ definition: { description: 'tay' } },
    [{ id: 'p1', title: 'Bài 1', platform: 'facebook' }],
    [{ externalPostId: 'p1', metric: 'views', value: 10, observedAt: '2026-11-05T00:00:00Z' }]);
  assert.deepEqual(r, { value: 0, postCount: 0, latestObservedAt: null, rows: [] });
});

// ---------------------------------------------------------------------------
// Store — fixtures
// ---------------------------------------------------------------------------
const EMPTY_COLLECTIONS = () => Object.fromEntries(Store.COLLECTIONS.map((k) => [k, []]));

function baseState() {
  return {
    members: [{ id: OWNER, name: 'Owner', role: 'owner', capacityHoursPerWeek: null, daysOff: null }],
    campaigns: [{ id: 'camp-1', name: 'Camp 1', status: 'active' }, { id: 'camp-2', name: 'Camp 2', status: 'active' }],
    contentItems: [
      { id: 'content-1', campaignId: 'camp-1', activityId: 'act-1', pillarId: 'pillar-a', buProductId: 'bu-1', title: 'Nội dung 1' },
      { id: 'content-2', campaignId: 'camp-1', pillarId: 'pillar-a', buProductId: 'bu-2', title: 'Nội dung 2' },
      { id: 'content-3', campaignId: 'camp-2', taskId: 'task-9', pillarId: 'pillar-b', title: 'Nội dung 3' },
    ],
    tasks: [
      { id: 'task-9', title: 'Việc gắn nội dung 3', campaignId: 'camp-2' },
      { id: 'task-1', title: 'Việc không gắn nội dung', campaignId: 'camp-1' },
    ],
    externalPosts: [
      { id: 'post-1', platform: 'facebook', channelAccountId: 'chan-fb', campaignId: 'camp-1', contentItemId: 'content-1', title: 'Bài 1' },
      { id: 'post-2', platform: 'instagram', channelAccountId: 'chan-ig', campaignId: 'camp-1', contentItemId: 'content-2', title: 'Bài 2' },
      { id: 'post-3', platform: 'facebook', channelAccountId: 'chan-fb', campaignId: 'camp-2', contentItemId: 'content-3', title: 'Bài 3' },
    ],
    metricObservations: [
      { id: 'obs-1', externalPostId: 'post-1', metric: 'lifetime_views', value: 100, observedAt: '2026-11-05T10:00:00+07:00', source: 'manual' },
      { id: 'obs-2', externalPostId: 'post-1', metric: 'lifetime_views', value: 150, observedAt: '2026-11-07T10:00:00+07:00', source: 'manual' },
      { id: 'obs-3', externalPostId: 'post-2', metric: 'lifetime_views', value: 200, observedAt: '2026-11-06T10:00:00+07:00', source: 'manual' },
      { id: 'obs-4', externalPostId: 'post-3', metric: 'lifetime_views', value: 700, observedAt: '2026-11-06T10:00:00+07:00', source: 'manual' },
    ],
    kpis: [
      autoKpi({ id: 'kpi-auto-campaign' }),
      autoKpi({ id: 'kpi-auto-content', scopeType: 'content', campaignId: undefined, contentItemId: 'content-1' }),
      { id: 'kpi-manual', scopeType: 'campaign', campaignId: 'camp-1', name: 'KPI tay', metricCode: 'leads', target: 100, actual: 42, unit: 'lead', targetVersion: 1, definition: { description: 'Nhập tay' } },
    ],
    measurements: [
      { id: 'meas-auto-old', kpiId: 'kpi-auto-campaign', value: 1, source: 'manual', measuredAt: '2026-11-01T00:00:00Z' },
    ],
    kpiTargetVersions: [],
  };
}

function resetDemo(extraState) {
  Store.mode = 'demo';
  Store.supabaseClient = null;
  Store.workspaceId = WS;
  Store._membership = null;
  Store.currentUserId = OWNER;
  Store.state = Object.assign(EMPTY_COLLECTIONS(), baseState(), extraState || {});
  Store.loadState = {};
  Store._postMappings = [];
  return Store;
}

const ids = (posts) => posts.map((p) => p.id).sort();

// ---------------------------------------------------------------------------
// Store — kpiScopePosts theo từng scope
// ---------------------------------------------------------------------------
test('kpiScopePosts: campaign / content / pillar / bu / activity / task / channel resolve qua quan hệ thật', () => {
  resetDemo();
  const S = (kpi) => ids(Store.kpiScopePosts(kpi));
  assert.deepEqual(S(autoKpi({ scopeType: 'campaign', campaignId: 'camp-1' })), ['post-1', 'post-2']);
  assert.deepEqual(S(autoKpi({ scopeType: 'content', campaignId: undefined, contentItemId: 'content-1' })), ['post-1']);
  assert.deepEqual(S(autoKpi({ scopeType: 'pillar', campaignId: undefined, pillarId: 'pillar-a' })), ['post-1', 'post-2'], 'pillar qua contentItems.pillarId');
  assert.deepEqual(S(autoKpi({ scopeType: 'bu_product', campaignId: undefined, buProductId: 'bu-1' })), ['post-1'], 'brand/product qua contentItems.buProductId');
  assert.deepEqual(S(autoKpi({ scopeType: 'activity', campaignId: undefined, activityId: 'act-1' })), ['post-1'], 'activity qua contentItems.activityId');
  assert.deepEqual(S(autoKpi({ scopeType: 'task', campaignId: undefined, taskId: 'task-9' })), ['post-3'], 'task qua contentItems.taskId');
  assert.deepEqual(S(autoKpi({ scopeType: 'task', campaignId: undefined, taskId: 'task-1' })), [], 'task không có content liên kết -> [] (không bịa quan hệ)');
  assert.deepEqual(S(autoKpi({
    scopeType: 'channel', campaignId: undefined,
    definition: { dataSource: { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum', channelAccountId: 'chan-fb' } },
  })), ['post-1', 'post-3'], 'channel qua dataSource.channelAccountId');
  // channelAccountId trong dataSource lọc THÊM trên scope campaign.
  assert.deepEqual(S(autoKpi({
    scopeType: 'campaign', campaignId: 'camp-1',
    definition: { dataSource: { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum', channelAccountId: 'chan-ig' } },
  })), ['post-2']);
  assert.deepEqual(Store.kpiScopePosts(null), []);
});

test('kpiScopePosts + postMetricActual: cùng 1 post qua 2 đường scope chỉ tính 1 lần', () => {
  resetDemo();
  const byCampaign = Store.kpiScopePosts(Store.get('kpis', 'kpi-auto-campaign'));
  const byContent = Store.kpiScopePosts(Store.get('kpis', 'kpi-auto-content'));
  const union = byCampaign.concat(byContent); // post-1 xuất hiện ở cả 2 scope
  const r = domain.postMetricActual(Store.get('kpis', 'kpi-auto-campaign'), union, Store.state.metricObservations);
  assert.equal(r.value, 350, 'post-1 (150) chỉ tính 1 lần + post-2 (200) = 350');
  assert.equal(r.postCount, 2);
});

// ---------------------------------------------------------------------------
// Store — kpiAutoActual / refreshKpiAutoActuals
// ---------------------------------------------------------------------------
test('kpiAutoActual + refresh: KPI auto có actual/autoActual đúng; KPI manual -> null và không bị đụng', () => {
  resetDemo();
  const auto = Store.get('kpis', 'kpi-auto-campaign');
  const r = Store.kpiAutoActual(auto);
  assert.equal(r.value, 350);
  assert.equal(r.postCount, 2);
  assert.equal(r.latestObservedAt, '2026-11-07T10:00:00+07:00');
  assert.deepEqual(r.rows.map((x) => [x.postId, x.value]), [['post-2', 200], ['post-1', 150]]);

  const manual = Store.get('kpis', 'kpi-manual');
  assert.equal(Store.kpiAutoActual(manual), null, 'KPI manual -> kpiAutoActual null');

  const updated = Store.refreshKpiAutoActuals();
  assert.deepEqual(updated.map((k) => k.id).sort(), ['kpi-auto-campaign', 'kpi-auto-content']);
  assert.equal(auto.actual, 350);
  assert.equal(auto.autoActual.postCount, 2);
  assert.equal(Store.get('kpis', 'kpi-auto-content').actual, 150);
  assert.equal(manual.actual, 42, 'refresh không đụng actual của KPI manual');
  assert.ok(!('autoActual' in manual));
});

test('refreshKpiAutoActuals: KHÔNG tạo measurement và KHÔNG đổi lịch sử version', () => {
  resetDemo();
  const measBefore = Store.state.measurements.length;
  const verBefore = Store.state.kpiTargetVersions.length;
  Store.refreshKpiAutoActuals();
  assert.equal(Store.state.measurements.length, measBefore, 'actual tự động chỉ ở state — không ghi measurement xuống DB');
  assert.equal(Store.state.kpiTargetVersions.length, verBefore);
});

// ---------------------------------------------------------------------------
// Store — chặn ghi measurement cho KPI auto; manual vẫn lưu được
// ---------------------------------------------------------------------------
test('KPI manual: measurement vẫn lưu được (create measurements + update kpis actual)', () => {
  resetDemo();
  const c = Store.create('measurements', { kpiId: 'kpi-manual', value: 55, source: 'manual' });
  assert.equal(c.ok, true);
  assert.ok(Store.state.measurements.some((m) => m.kpiId === 'kpi-manual' && m.value === 55));
  const u = Store.update('kpis', 'kpi-manual', { actual: 77 });
  assert.equal(u.ok, true);
  assert.equal(Store.get('kpis', 'kpi-manual').actual, 77);
});

test('KPI auto: mọi đường ghi measurement bị chặn KPI_AUTO_SOURCE (demo)', () => {
  resetDemo();
  Store.refreshKpiAutoActuals();
  const measBefore = Store.state.measurements.length;

  const c1 = Store.create('measurements', { kpiId: 'kpi-auto-campaign', value: 999, source: 'manual' });
  assert.equal(c1.ok, false);
  assert.equal(c1.code, 'KPI_AUTO_SOURCE');
  assert.equal(c1.error, AUTO_MSG);

  const c2 = Store.create('kpis', { name: 'Auto mới', actual: 5, definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'latest_sum' } } });
  assert.equal(c2.ok, false);
  assert.equal(c2.code, 'KPI_AUTO_SOURCE');

  const u1 = Store.update('kpis', 'kpi-auto-campaign', { actual: 999 });
  assert.equal(u1.ok, false);
  assert.equal(u1.code, 'KPI_AUTO_SOURCE');
  assert.equal(u1.error, AUTO_MSG);
  assert.equal(Store.get('kpis', 'kpi-auto-campaign').actual, 350, 'actual vẫn là số tự động, không bị ghi đè');

  const u2 = Store.update('measurements', 'meas-auto-old', { value: 123 });
  assert.equal(u2.ok, false);
  assert.equal(u2.code, 'KPI_AUTO_SOURCE');

  assert.equal(Store.state.measurements.length, measBefore, 'không measurement nào được tạo cho KPI auto');
});

test('KPI auto: chặn cả ở đường remote (create / _createRemote / update)', async () => {
  resetDemo();
  Store.mode = 'supabase';
  Store.supabaseClient = null; // chặn phải xảy ra TRƯỚC mọi lần chạm client
  const c1 = await Store.create('measurements', { kpiId: 'kpi-auto-campaign', value: 1, source: 'manual' });
  assert.equal(c1.ok, false);
  assert.equal(c1.code, 'KPI_AUTO_SOURCE');
  const c2 = await Store._createRemote('kpis', { name: 'Auto', actual: 5, definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'latest_sum' } } });
  assert.equal(c2.ok, false);
  assert.equal(c2.code, 'KPI_AUTO_SOURCE');
  const u1 = await Store.update('kpis', 'kpi-auto-campaign', { actual: 5 });
  assert.equal(u1.ok, false);
  assert.equal(u1.code, 'KPI_AUTO_SOURCE');
  assert.equal(u1.error, AUTO_MSG);
});

// ---------------------------------------------------------------------------
// Store — observation mới -> refresh -> actual tăng; roll-up không cộng trùng
// ---------------------------------------------------------------------------
test('Thêm observation mới -> actual của KPI auto tăng tương ứng (create + refresh tay)', () => {
  resetDemo();
  Store.refreshKpiAutoActuals();
  const auto = Store.get('kpis', 'kpi-auto-campaign');
  assert.equal(auto.actual, 350);
  const measBefore = Store.state.measurements.length;

  // Tạo observation qua Store.create: hook tự refresh ngay.
  const c = Store.create('metricObservations', { externalPostId: 'post-2', metric: 'lifetime_views', value: 260, observedAt: '2026-11-10T10:00:00+07:00', source: 'manual' });
  assert.equal(c.ok, true);
  assert.equal(auto.actual, 410, 'post-2 latest 200 -> 260: 150 + 260 = 410');

  // Đẩy observation thẳng vào state rồi refresh tay.
  Store.state.metricObservations.push({ id: 'obs-x', externalPostId: 'post-1', metric: 'lifetime_views', value: 180, observedAt: '2026-11-11T10:00:00+07:00', source: 'manual' });
  Store.refreshKpiAutoActuals();
  assert.equal(auto.actual, 440, 'post-1 latest 150 -> 180: 180 + 260 = 440');
  assert.equal(auto.autoActual.latestObservedAt, '2026-11-11T10:00:00+07:00');

  // Số liệu nhập tay (manualMetricEntries) cũng là observation của bài.
  const e = Store.create('manualMetricEntries', { externalPostId: 'post-1', metric: 'lifetime_views', value: 190, observedAt: '2026-11-12T10:00:00+07:00', source: 'manual' });
  assert.equal(e.ok, true);
  assert.equal(auto.actual, 450, 'post-1 latest -> 190: 190 + 260 = 450');

  assert.equal(Store.state.measurements.length, measBefore, 'toàn bộ quá trình không tạo measurement nào');
});

test('Roll-up: KPI cha dùng actual của KPI auto như 1 fact duy nhất — không cộng lại observations', () => {
  resetDemo();
  Store.refreshKpiAutoActuals();
  const auto = Store.get('kpis', 'kpi-auto-campaign');
  // Pattern của app (kpiRollupFor): mỗi KPI nguồn đóng góp đúng 1 fact
  // mang actual của nó — rollupKpi nhận fact đó, KHÔNG nhận observations.
  const facts = [{ id: 'fact-' + auto.id, metricCode: 'lifetime_views', unit: 'lượt xem', period: '2026-11', value: auto.actual }];
  const r = domain.rollupKpi(facts, { mode: 'sum', metricCode: 'lifetime_views', unit: 'lượt xem', period: '2026-11', target: 500 });
  assert.equal(r.value, 350);
  const obsTotal = Store.state.metricObservations
    .filter((o) => o.metric === 'lifetime_views' && ['post-1', 'post-2'].includes(o.externalPostId))
    .reduce((s, o) => s + o.value, 0);
  assert.notEqual(r.value, 350 + obsTotal, 'không được cộng actual (đã gồm latest từng bài) với tổng observations lần nữa');
});

// ---------------------------------------------------------------------------
// Store — đổi cấu hình nguồn -> kpiTargetVersions (như đổi target)
// ---------------------------------------------------------------------------
test('Đổi definition.dataSource -> push kpiTargetVersions với snapshot definition mới; không đổi nguồn -> không push', () => {
  resetDemo();
  const u = Store.update('kpis', 'kpi-manual', {
    definition: { description: 'Nhập tay', dataSource: { type: 'post_metrics', metric: 'views', mode: 'latest_sum' } },
  });
  assert.equal(u.ok, true);
  const vers = Store.state.kpiTargetVersions.filter((v) => v.kpiId === 'kpi-manual');
  assert.equal(vers.length, 1, 'đổi cấu hình nguồn phải ghi 1 phiên bản target mới');
  assert.equal(vers[0].version, 2);
  assert.equal(Store.get('kpis', 'kpi-manual').targetVersion, 2);
  assert.deepEqual(vers[0].definition.dataSource, { type: 'post_metrics', metric: 'views', mode: 'latest_sum' }, 'snapshot là definition MỚI');

  // Sửa description nhưng GIỮ NGUYÊN dataSource -> không push thêm.
  const u2 = Store.update('kpis', 'kpi-auto-campaign', {
    definition: { description: 'Mô tả mới', dataSource: { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum' } },
  });
  assert.equal(u2.ok, true);
  assert.equal(Store.state.kpiTargetVersions.filter((v) => v.kpiId === 'kpi-auto-campaign').length, 0);

  // Payload remote: đổi dataSource -> target_version tăng; giữ nguyên -> không tăng.
  const cur = Store.get('kpis', 'kpi-auto-campaign');
  const p1 = Store._toPayload('kpis', { definition: { dataSource: { type: 'post_metrics', metric: 'views', mode: 'period_sum' } } }, { currentItem: cur });
  assert.equal(p1.target_version, (Number(cur.targetVersion) || 1) + 1);
  const p2 = Store._toPayload('kpis', { definition: { description: 'Mô tả mới', dataSource: { type: 'post_metrics', metric: 'lifetime_views', mode: 'latest_sum' } } }, { currentItem: cur });
  assert.equal(p2.target_version, undefined);
});

// ---------------------------------------------------------------------------
// Tích hợp demo: KPI mẫu của executor B tự tính đúng khi nạp demo
// ---------------------------------------------------------------------------
test('Demo load: kpi-auto-post-views tự tính actual = 200 (post-1, latest lifetime_views), postCount = 1', () => {
  Store.currentUserId = 'member-lead';
  Store._loadDemo();
  const k = Store.get('kpis', 'kpi-auto-post-views');
  assert.ok(k, 'demo phải có KPI mẫu kpi-auto-post-views');
  assert.equal(k.actual, 200);
  assert.equal(k.autoActual.postCount, 1);
  assert.equal(k.autoActual.rows.length, 1);
  assert.equal(k.autoActual.rows[0].postId, 'post-1');
  assert.equal(k.autoActual.rows[0].value, 200);
  assert.equal(k.autoActual.latestObservedAt, '2026-11-09T10:00:00+07:00');
  const manual = Store.get('kpis', 'kpi-1');
  assert.equal(manual.actual, 6200, 'KPI manual trong demo giữ nguyên actual ghi tay');
  assert.ok(!('autoActual' in manual));
});
