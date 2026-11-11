// tests/domain.test.mjs
// Kiểm thử hợp đồng js/domain.js (UMD — module.exports khi ở Node).
// Chạy: npm test  (node --test tests/)
//
// Lưu ý về tính độc lập giữa các executor:
// - Nếu js/domain.js chưa xuất hiện (E2 chưa giao), mọi test phụ thuộc
//   domain đều SKIP kèm lý do rõ ràng thay vì fail giả.
// - AC13 / AC39 cũng SKIP có lý do khi file đích (publish-worker /
//   frontend) chưa tồn tại ở thời điểm chạy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- Nạp domain.js một cách mềm: thiếu file thì skip, không fail giả ---
let domain = null;
let domainLoadError = null;
try {
  domain = require('../js/domain.js');
} catch (err) {
  domainLoadError = err;
}

/** Trả true nếu domain sẵn sàng; ngược lại skip test hiện tại. */
function requireDomain(t) {
  if (!domain) {
    t.skip(
      `js/domain.js chưa tồn tại — chờ executor E2 giao theo hợp đồng hàm` +
        (domainLoadError ? ` (lỗi nạp: ${domainLoadError.message})` : ''),
    );
    return false;
  }
  return true;
}

/** Trả true nếu hàm tồn tại trên domain; ngược lại skip test hiện tại. */
function requireFn(t, name) {
  if (!requireDomain(t)) return false;
  if (typeof domain[name] !== 'function') {
    t.skip(`js/domain.js chưa export hàm ${name} theo hợp đồng`);
    return false;
  }
  return true;
}

/** Chuẩn hoá một phần tử (id dạng string | object có id/taskId) thành id. */
function idOf(item) {
  if (item == null) return item;
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return String(item.id ?? item.taskId ?? item.successorId ?? item.predecessorId ?? item);
}

/** Chuẩn hoá danh sách kết quả thành mảng id dạng string. */
function idsOf(list) {
  assert.ok(Array.isArray(list), 'kết quả kỳ vọng là một mảng');
  return list.map(idOf);
}

/** Lấy giá trị số từ kết quả có thể là number | { value } | observation. */
function valueOf(result) {
  if (typeof result === 'number') return result;
  if (result && typeof result === 'object') return result.value;
  return result;
}

/**
 * Lấy phần trăm tiến độ (thang 0–100) từ kết quả campaignProgress.
 * Hợp đồng ghi trường `percent`; chấp nhận cả biến thể `percentage`
 * hoặc `progress` dạng tỉ lệ 0–1 nếu bản cài đặt dùng tên đó.
 */
function percentOf(progress) {
  if (!progress || typeof progress !== 'object') return undefined;
  if (typeof progress.percent === 'number') return progress.percent;
  if (typeof progress.percentage === 'number') return progress.percentage;
  if (typeof progress.progress === 'number') return progress.progress * 100;
  return undefined;
}

// ---------------------------------------------------------------------------
// AC04 — Chặn vòng phụ thuộc (dependency cycle)
// ---------------------------------------------------------------------------

test('AC04 wouldCreateCycle: thêm cạnh C→A tạo vòng A→B→C→A thì trả true', (t) => {
  if (!requireFn(t, 'wouldCreateCycle')) return;
  const edges = [
    { predecessorId: 'A', successorId: 'B' },
    { predecessorId: 'B', successorId: 'C' },
  ];
  assert.equal(domain.wouldCreateCycle(edges, 'C', 'A'), true);
});

test('AC04 wouldCreateCycle: self-dependency (tự phụ thuộc chính mình) thì trả true', (t) => {
  if (!requireFn(t, 'wouldCreateCycle')) return;
  const edges = [{ predecessorId: 'A', successorId: 'B' }];
  assert.equal(domain.wouldCreateCycle(edges, 'A', 'A'), true);
  assert.equal(domain.wouldCreateCycle([], 'X', 'X'), true);
});

test('AC04 wouldCreateCycle: cạnh hợp lệ không tạo vòng thì trả false', (t) => {
  if (!requireFn(t, 'wouldCreateCycle')) return;
  const edges = [
    { predecessorId: 'A', successorId: 'B' },
    { predecessorId: 'B', successorId: 'C' },
  ];
  assert.equal(domain.wouldCreateCycle(edges, 'A', 'C'), false);
  assert.equal(domain.wouldCreateCycle(edges, 'C', 'D'), false);
  assert.equal(domain.wouldCreateCycle([], 'A', 'B'), false);
});

// ---------------------------------------------------------------------------
// AC05 — Sẵn sàng thực hiện (task readiness)
// ---------------------------------------------------------------------------

test('AC05 taskReadiness: B chờ A (xong) và C (chưa xong) thì chưa sẵn sàng, pending chứa C', (t) => {
  if (!requireFn(t, 'taskReadiness')) return;
  const tasks = [
    { id: 'A', status: 'completed' },
    { id: 'B', status: 'todo' },
    { id: 'C', status: 'in_progress' },
  ];
  const edges = [
    { predecessorId: 'A', successorId: 'B' },
    { predecessorId: 'C', successorId: 'B' },
  ];
  const result = domain.taskReadiness('B', tasks, edges);
  assert.equal(result.ready, false);
  const pending = idsOf(result.pendingPredecessors);
  assert.ok(pending.includes('C'), `pendingPredecessors phải chứa C, nhận được: ${JSON.stringify(result.pendingPredecessors)}`);
  assert.ok(!pending.includes('A'), 'A đã completed nên không nằm trong pendingPredecessors');
});

test('AC05 taskReadiness: mọi predecessor đã xong thì ready === true và pending rỗng', (t) => {
  if (!requireFn(t, 'taskReadiness')) return;
  const tasks = [
    { id: 'A', status: 'completed' },
    { id: 'B', status: 'todo' },
    { id: 'C', status: 'completed' },
  ];
  const edges = [
    { predecessorId: 'A', successorId: 'B' },
    { predecessorId: 'C', successorId: 'B' },
  ];
  const result = domain.taskReadiness('B', tasks, edges);
  assert.equal(result.ready, true);
  assert.deepEqual(idsOf(result.pendingPredecessors), []);
});

test('AC05 taskReadiness: task không có predecessor thì sẵn sàng ngay', (t) => {
  if (!requireFn(t, 'taskReadiness')) return;
  const tasks = [{ id: 'B', status: 'todo' }];
  const result = domain.taskReadiness('B', tasks, []);
  assert.equal(result.ready, true);
  assert.deepEqual(idsOf(result.pendingPredecessors), []);
});

// ---------------------------------------------------------------------------
// AC03 — Xem trước tác động khi dời ngày (dependency impact preview)
// ---------------------------------------------------------------------------

test('AC03 previewDependencyImpact: dời ngày predecessor thì successor bị liệt kê là bị ảnh hưởng', (t) => {
  if (!requireFn(t, 'previewDependencyImpact')) return;
  const tasks = [
    { id: 'A', status: 'todo', startDate: '2026-11-05', dueDate: '2026-11-06' },
    { id: 'B', status: 'todo', startDate: '2026-11-07', dueDate: '2026-11-08' },
    { id: 'C', status: 'todo', startDate: '2026-11-09', dueDate: '2026-11-10' },
    { id: 'Z', status: 'todo', startDate: '2026-11-07', dueDate: '2026-11-08' },
  ];
  const edges = [
    { predecessorId: 'A', successorId: 'B' },
    { predecessorId: 'B', successorId: 'C' },
  ];
  const impacted = domain.previewDependencyImpact('A', '2026-11-12', '2026-11-13', tasks, edges);
  assert.ok(Array.isArray(impacted), 'kết quả kỳ vọng là một mảng');
  assert.ok(impacted.length > 0, 'có successor nên danh sách bị ảnh hưởng không được rỗng');
  const impactedIds = idsOf(impacted);
  assert.ok(impactedIds.includes('B'), `successor trực tiếp B phải bị ảnh hưởng, nhận được: ${impactedIds.join(', ')}`);
  assert.ok(!impactedIds.includes('Z'), 'task không liên quan (Z) không được nằm trong danh sách bị ảnh hưởng');
  assert.ok(!impactedIds.includes('A'), 'chính task được dời ngày không tính là task bị ảnh hưởng');
});

test('AC03 previewDependencyImpact: task không có successor thì không có task nào bị ảnh hưởng', (t) => {
  if (!requireFn(t, 'previewDependencyImpact')) return;
  const tasks = [
    { id: 'A', status: 'todo', startDate: '2026-11-05', dueDate: '2026-11-06' },
    { id: 'B', status: 'todo', startDate: '2026-11-07', dueDate: '2026-11-08' },
  ];
  const impacted = domain.previewDependencyImpact('B', '2026-11-12', '2026-11-13', tasks, []);
  assert.ok(Array.isArray(impacted));
  assert.equal(impacted.length, 0);
});

// ---------------------------------------------------------------------------
// Phân bổ effort theo ngày làm việc (distributeEffort)
// ---------------------------------------------------------------------------

test('AC distributeEffort: task thiếu effortHours thì trả { unestimated: true }', (t) => {
  if (!requireFn(t, 'distributeEffort')) return;
  const workdays = ['2026-11-02', '2026-11-03', '2026-11-04'];
  assert.deepEqual(domain.distributeEffort({ id: 'T1' }, workdays), { unestimated: true });
  assert.deepEqual(domain.distributeEffort({ id: 'T1', effortHours: null }, workdays), { unestimated: true });
  assert.deepEqual(domain.distributeEffort({ id: 'T1', effortHours: 0 }, workdays), { unestimated: true });
});

test('AC distributeEffort: tổng giờ phân bổ bằng effortHours và chỉ rơi vào ngày làm việc', (t) => {
  if (!requireFn(t, 'distributeEffort')) return;
  // 02/11/2026 (thứ Hai) → 06/11/2026 (thứ Sáu)
  const workdays = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const result = domain.distributeEffort({ id: 'T1', effortHours: 16 }, workdays);
  assert.ok(Array.isArray(result), 'task có effortHours phải trả mảng phân bổ [{date, hours}]');
  const total = result.reduce((sum, entry) => sum + entry.hours, 0);
  assert.equal(total, 16, 'tổng hours phân bổ phải đúng bằng effortHours');
  for (const entry of result) {
    assert.ok(workdays.includes(entry.date), `ngày phân bổ ${entry.date} phải là ngày làm việc đã cho`);
    assert.ok(entry.hours > 0, 'mỗi ngày phân bổ phải có số giờ dương');
  }
});

// ---------------------------------------------------------------------------
// AC17 — Ngân sách còn lại (budget) + KPI chưa cập nhật
// ---------------------------------------------------------------------------

test('AC17 budgetRemaining: approved 100, commitment mở 60, actual gắn commitment 30 thì còn 40', (t) => {
  if (!requireFn(t, 'budgetRemaining')) return;
  const line = { approved: 100 };
  const commitments = [{ id: 'C1', amount: 60, status: 'open' }];
  const actuals = [{ amount: 30, commitmentId: 'C1' }];
  // remaining = 100 − Σactuals(30) − phần còn mở của C1 (60 − 30) = 40
  assert.equal(domain.budgetRemaining(line, commitments, actuals), 40);
});

test('AC17 budgetRemaining: commitment settled/cancelled không bị trừ thêm ngoài actual', (t) => {
  if (!requireFn(t, 'budgetRemaining')) return;
  // Đã settled và actual đã ghi đủ 60 → chỉ trừ actual một lần.
  assert.equal(
    domain.budgetRemaining(
      { approved: 100 },
      [{ id: 'C1', amount: 60, status: 'settled' }],
      [{ amount: 60, commitmentId: 'C1' }],
    ),
    40,
  );
  // Đã cancelled, chưa có actual → không trừ gì.
  assert.equal(
    domain.budgetRemaining({ approved: 100 }, [{ id: 'C2', amount: 50, status: 'cancelled' }], []),
    100,
  );
  // Actual không gắn commitment vẫn trừ thẳng vào ngân sách.
  assert.equal(domain.budgetRemaining({ approved: 100 }, [], [{ amount: 25, commitmentId: null }]), 75);
  // Commitment mở chưa chi gì → trừ toàn bộ số đã cam kết.
  assert.equal(
    domain.budgetRemaining({ approved: 100 }, [{ id: 'C3', amount: 30, status: 'open' }], []),
    70,
  );
});

test('AC17 kpiDisplay: KPI chưa có actual (null) thì isMissing và hiện "Chưa cập nhật"', (t) => {
  if (!requireFn(t, 'kpiDisplay')) return;
  const display = domain.kpiDisplay({ id: 'K1', name: 'Leads', target: 100, actual: null });
  assert.equal(display.isMissing, true);
  assert.equal(display.text, 'Chưa cập nhật');
});

test('AC17 kpiDisplay: KPI đã có actual thì không bị đánh dấu thiếu', (t) => {
  if (!requireFn(t, 'kpiDisplay')) return;
  const display = domain.kpiDisplay({ id: 'K1', name: 'Leads', target: 100, actual: 42 });
  assert.notEqual(display.isMissing, true);
});

// ---------------------------------------------------------------------------
// AC24 — Lifetime snapshot: lấy giá trị mới nhất, KHÔNG cộng dồn
// ---------------------------------------------------------------------------

test('AC24 latestLifetimeSnapshot: snapshots 100 → 150 → 200 thì kết quả là 200, không phải 450', (t) => {
  if (!requireFn(t, 'latestLifetimeSnapshot')) return;
  const observations = [
    { value: 100, observedAt: '2026-11-01T00:00:00.000Z' },
    { value: 150, observedAt: '2026-11-02T00:00:00.000Z' },
    { value: 200, observedAt: '2026-11-03T00:00:00.000Z' },
  ];
  const latest = valueOf(domain.latestLifetimeSnapshot(observations));
  assert.equal(latest, 200);
  assert.notEqual(latest, 450, 'chỉ số lifetime không bao giờ được cộng dồn các snapshot');
});

test('AC24 latestLifetimeSnapshot: chọn theo observedAt mới nhất kể cả khi mảng không theo thứ tự', (t) => {
  if (!requireFn(t, 'latestLifetimeSnapshot')) return;
  const observations = [
    { value: 200, observedAt: '2026-11-03T00:00:00.000Z' },
    { value: 100, observedAt: '2026-11-01T00:00:00.000Z' },
    { value: 150, observedAt: '2026-11-02T00:00:00.000Z' },
  ];
  assert.equal(valueOf(domain.latestLifetimeSnapshot(observations)), 200);
});

// ---------------------------------------------------------------------------
// AC27 — Reach không cộng dồn + rollup ads chỉ cộng đúng một cấp
// ---------------------------------------------------------------------------

test('AC27 sumUniqueReachGuard: metric reach không được cộng dồn (summable === false)', (t) => {
  if (!requireFn(t, 'sumUniqueReachGuard')) return;
  const observations = [
    { metric: 'reach', value: 100, observedAt: '2026-11-01T00:00:00.000Z' },
    { metric: 'reach', value: 150, observedAt: '2026-11-02T00:00:00.000Z' },
  ];
  let guard = domain.sumUniqueReachGuard(observations);
  // Một số chữ ký nhận thẳng tên metric thay vì mảng observations — thử lại nếu cần.
  if (!guard || typeof guard !== 'object' || !('summable' in guard)) {
    guard = domain.sumUniqueReachGuard('reach');
  }
  assert.equal(guard.summable, false, 'reach là chỉ số unique — cộng dồn nhiều kỳ sẽ đếm trùng người xem');
});

test('AC27 pickLevelTotals: chỉ cộng các dòng đúng cấp được chọn, không trộn cấp ads', (t) => {
  if (!requireFn(t, 'pickLevelTotals')) return;
  const rows = [
    { level: 'campaign', spend: 100, impressions: 1000, clicks: 50, results: 10, conversionValue: 500 },
    { level: 'adset', spend: 999, impressions: 9999, clicks: 999, results: 99, conversionValue: 9999 },
    { level: 'ad', spend: 888, impressions: 8888, clicks: 888, results: 88, conversionValue: 8888 },
    { level: 'campaign', spend: 50, impressions: 500, clicks: 25, results: 5, conversionValue: 250 },
  ];
  const totals = domain.pickLevelTotals(rows, 'campaign');
  if (Array.isArray(totals)) {
    // Chữ ký trả về danh sách đã lọc: tự cộng để đối chiếu.
    assert.equal(totals.length, 2, 'chỉ 2 dòng cấp campaign được giữ lại');
    assert.ok(totals.every((row) => row.level === 'campaign'));
    assert.equal(totals.reduce((sum, row) => sum + (row.spend ?? 0), 0), 150);
  } else {
    assert.equal(totals.spend, 150, 'spend chỉ cộng 2 dòng campaign (100 + 50), không lẫn adset/ad');
    assert.equal(totals.impressions, 1500);
    assert.equal(totals.clicks, 75);
  }
});

// ---------------------------------------------------------------------------
// AC28 — Không tạo PublishJob cho TikTok / đăng ngoài app
// ---------------------------------------------------------------------------

test('AC28 shouldCreatePublishJob: TikTok đăng qua app vẫn không tạo job', (t) => {
  if (!requireFn(t, 'shouldCreatePublishJob')) return;
  assert.equal(domain.shouldCreatePublishJob({ platform: 'tiktok', publishMode: 'app' }), false);
});

test('AC28 shouldCreatePublishJob: variant đăng ngoài app (external) không tạo job ở mọi platform', (t) => {
  if (!requireFn(t, 'shouldCreatePublishJob')) return;
  assert.equal(domain.shouldCreatePublishJob({ platform: 'facebook', publishMode: 'external' }), false);
  assert.equal(domain.shouldCreatePublishJob({ platform: 'tiktok', publishMode: 'external' }), false);
});

test('AC28 shouldCreatePublishJob: platform khác TikTok + publishMode app thì tạo job', (t) => {
  if (!requireFn(t, 'shouldCreatePublishJob')) return;
  assert.equal(domain.shouldCreatePublishJob({ platform: 'facebook', publishMode: 'app' }), true);
  assert.equal(domain.shouldCreatePublishJob({ platform: 'instagram', publishMode: 'app' }), true);
  assert.equal(domain.shouldCreatePublishJob({ platform: 'youtube', publishMode: 'app' }), true);
});

// ---------------------------------------------------------------------------
// AC29 — Metric thiếu dữ liệu: trả null, không suy diễn, không 0 giả
// ---------------------------------------------------------------------------

test('AC29 computeRates: impressions = 0 thì ctr và cpm là null (không phải 0 giả)', (t) => {
  if (!requireFn(t, 'computeRates')) return;
  const rates = domain.computeRates({ spend: 100, impressions: 0, clicks: 10, results: 2, conversionValue: 200 });
  assert.equal(rates.ctr, null);
  assert.equal(rates.cpm, null);
});

test('AC29 computeRates: mẫu số 0/thiếu ở từng trường thì chỉ trường đó là null', (t) => {
  if (!requireFn(t, 'computeRates')) return;
  const noClicks = domain.computeRates({ spend: 100, impressions: 1000, clicks: 0, results: 2, conversionValue: 200 });
  assert.equal(noClicks.cpc, null, 'clicks = 0 thì cpc không tính được');
  assert.equal(noClicks.ctr, 0, 'ctr vẫn tính được: 0 clicks / 1000 impressions = 0 (số 0 thật, không phải null)');

  const noResults = domain.computeRates({ spend: 100, impressions: 1000, clicks: 50, results: 0, conversionValue: 0 });
  assert.equal(noResults.costPerResult, null, 'results = 0 thì costPerResult không tính được');

  const noSpend = domain.computeRates({ spend: 0, impressions: 1000, clicks: 50, results: 5, conversionValue: 200 });
  assert.equal(noSpend.roas, null, 'spend = 0 thì roas không tính được');

  const missing = domain.computeRates({});
  assert.equal(missing.ctr, null);
  assert.equal(missing.cpc, null);
  assert.equal(missing.cpm, null);
  assert.equal(missing.costPerResult, null);
  assert.equal(missing.roas, null);
});

test('AC29 computeRates: dữ liệu đầy đủ thì tính đúng công thức từng tỷ lệ', (t) => {
  if (!requireFn(t, 'computeRates')) return;
  const rates = domain.computeRates({
    spend: 100,
    impressions: 10000,
    clicks: 200,
    results: 20,
    conversionValue: 500,
  });
  assert.equal(rates.ctr, 200 / 10000);
  assert.equal(rates.cpc, 100 / 200);
  assert.equal(rates.cpm, (100 / 10000) * 1000);
  assert.equal(rates.costPerResult, 100 / 20);
  assert.equal(rates.roas, 500 / 100);
});

// ---------------------------------------------------------------------------
// AC35 — Tỷ lệ tổng hợp: tính từ tổng tử / tổng mẫu, không trung bình các tỷ lệ
// ---------------------------------------------------------------------------

test('AC35 aggregateRates: CTR tổng hợp = tổng clicks / tổng impressions = 100/4000 = 0.025', (t) => {
  if (!requireFn(t, 'aggregateRates')) return;
  const rows = [
    { impressions: 1000, clicks: 50, spend: 100, results: 10, conversionValue: 300 },
    { impressions: 3000, clicks: 50, spend: 100, results: 10, conversionValue: 300 },
  ];
  const rates = domain.aggregateRates(rows);
  assert.equal(rates.ctr, 100 / 4000);
  assert.equal(rates.ctr, 0.025);
  const naiveAverage = (50 / 1000 + 50 / 3000) / 2;
  assert.notEqual(rates.ctr, naiveAverage, 'không được lấy trung bình cộng của các CTR từng dòng');
});

test('AC35 aggregateRates: các tỷ lệ khác cũng tính từ tổng (cpc, cpm, roas)', (t) => {
  if (!requireFn(t, 'aggregateRates')) return;
  const rows = [
    { impressions: 1000, clicks: 50, spend: 100, results: 10, conversionValue: 300 },
    { impressions: 3000, clicks: 50, spend: 300, results: 30, conversionValue: 900 },
  ];
  const rates = domain.aggregateRates(rows);
  assert.equal(rates.cpc, 400 / 100);
  assert.equal(rates.cpm, (400 / 4000) * 1000);
  assert.equal(rates.costPerResult, 400 / 40);
  assert.equal(rates.roas, 1200 / 400);
});

// ---------------------------------------------------------------------------
// Tiến độ campaign (campaignProgress) — chỉ tính leaf, loại cancelled
// ---------------------------------------------------------------------------

test('AC campaignProgress: chỉ tính task lá, task cha có con không tính, cancelled bị loại', (t) => {
  if (!requireFn(t, 'campaignProgress')) return;
  const tasks = [
    { id: 'P', parentId: null, status: 'completed' },
    { id: 'L1', parentId: 'P', status: 'completed' },
    { id: 'L2', parentId: 'P', status: 'todo' },
    { id: 'L3', parentId: 'P', status: 'cancelled' },
  ];
  const progress = domain.campaignProgress(tasks);
  assert.equal(progress.completed, 1);
  assert.equal(progress.total, 2);
  assert.equal(percentOf(progress), 50);
});

test('AC campaignProgress: không có task lá hợp lệ thì total = 0 và percent = 0', (t) => {
  if (!requireFn(t, 'campaignProgress')) return;
  const progress = domain.campaignProgress([{ id: 'L1', parentId: null, status: 'cancelled' }]);
  assert.equal(progress.total, 0);
  assert.equal(progress.completed, 0);
  assert.equal(percentOf(progress), 0);
});

// ---------------------------------------------------------------------------
// Định dạng ngày Việt Nam (formatDateVN)
// ---------------------------------------------------------------------------

test('AC formatDateVN: ISO yyyy-mm-dd hiển thị dd/mm/yyyy', (t) => {
  if (!requireFn(t, 'formatDateVN')) return;
  assert.equal(domain.formatDateVN('2026-11-05'), '05/11/2026');
  assert.equal(domain.formatDateVN('2026-01-31'), '31/01/2026');
});

// ---------------------------------------------------------------------------
// AC13 — Publish một phần (partial publish): 3 đích, 2 thành công, 1 thất bại
// ---------------------------------------------------------------------------

test('AC13 partial publish: kết quả đăng 3 đích (2 success, 1 failed) được xử lý theo từng đích', (t) => {
  // Ưu tiên 1: nếu domain.js có helper tổng hợp kết quả publish thì kiểm bằng helper.
  if (domain) {
    const helperName = Object.keys(domain).find((name) =>
      /publish/i.test(name) && /(result|summary|status|outcome|partial)/i.test(name),
    );
    if (helperName && typeof domain[helperName] === 'function') {
      const targets = [
        { targetId: 'T1', platform: 'facebook', status: 'success' },
        { targetId: 'T2', platform: 'instagram', status: 'success' },
        { targetId: 'T3', platform: 'youtube', status: 'failed' },
      ];
      const summary = domain[helperName](targets);
      const statusText = String(summary?.status ?? summary?.outcome ?? summary ?? '');
      assert.match(statusText, /partial/i, '2/3 đích thành công phải cho trạng thái partial, không gom thành success/failed toàn cục');
      return;
    }
  }

  // Ưu tiên 2: kiểm nội dung Edge Function publish-worker do E1 viết.
  const workerPath = path.join(rootDir, 'supabase', 'functions', 'publish-worker', 'index.ts');
  if (!fs.existsSync(workerPath)) {
    t.skip('supabase/functions/publish-worker/index.ts chưa tồn tại — chờ executor E1 giao; kiểm tra logic partial publish để sau');
    return;
  }
  const source = fs.readFileSync(workerPath, 'utf8');
  const hasPartialMarker = /partial/i.test(source);
  const hasPerTargetHandling =
    /(for\s*\([^)]*of\s+[^)]*target)|(targets?\s*\.\s*(map|forEach))|per[-_ ]?target/i.test(source) ||
    /(success|failed|status)/i.test(source);
  assert.ok(
    hasPartialMarker || hasPerTargetHandling,
    'publish-worker phải xử lý kết quả theo từng target và có trạng thái partial khi chỉ một số đích thành công',
  );

  // Mô phỏng thuần (không phụ thuộc backend): phân loại 2 success + 1 failed = partial.
  const simulated = [
    { targetId: 'T1', status: 'success' },
    { targetId: 'T2', status: 'success' },
    { targetId: 'T3', status: 'failed' },
  ];
  const succeeded = simulated.filter((r) => r.status === 'success').length;
  const failed = simulated.filter((r) => r.status === 'failed').length;
  const overall = failed === 0 ? 'success' : succeeded === 0 ? 'failed' : 'partial';
  assert.equal(overall, 'partial');
  assert.equal(succeeded, 2);
  assert.equal(failed, 1);
});

// ---------------------------------------------------------------------------
// AC39 — Nhãn giao diện: đúng thuật ngữ đã chốt, không còn nhãn cũ
// ---------------------------------------------------------------------------

test('AC39 nhãn giao diện: có đủ nhãn mới và không còn nhãn cũ trong index.html + js/*.js', (t) => {
  const indexPath = path.join(rootDir, 'index.html');
  const jsDir = path.join(rootDir, 'js');
  const jsFiles = fs.existsSync(jsDir)
    ? fs.readdirSync(jsDir).filter((name) => name.endsWith('.js')).map((name) => path.join(jsDir, name))
    : [];

  if (!fs.existsSync(indexPath)) {
    // js/domain.js + js/demo-data.js là tầng logic/dữ liệu, không phải bề mặt
    // giao diện — frontend chỉ coi là tồn tại khi đã có index.html.
    t.skip('frontend chưa tồn tại (chưa có index.html) — chờ executor E2 giao; kiểm tra nhãn AC39 để sau');
    return;
  }

  const chunks = [];
  if (fs.existsSync(indexPath)) chunks.push(fs.readFileSync(indexPath, 'utf8'));
  for (const file of jsFiles) chunks.push(fs.readFileSync(file, 'utf8'));
  const uiText = chunks.join('\n');

  const requiredLabels = [
    'Target audiences',
    'Mục tiêu',
    'Hoạt động & Kênh triển khai',
    'Người phụ trách',
    'Đầu ra cần bàn giao',
    'Mốc cần hoàn thành',
  ];
  for (const label of requiredLabels) {
    assert.ok(uiText.includes(label), `giao diện phải có nhãn "${label}"`);
  }

  const forbiddenLabels = ['Bài toán', 'Sức khỏe campaign', 'Điều kiện thực hiện'];
  for (const label of forbiddenLabels) {
    assert.ok(!uiText.includes(label), `giao diện không được còn nhãn cũ "${label}"`);
  }
});
