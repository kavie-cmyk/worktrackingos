// tests/store.test.mjs
// Kiểm thử hợp đồng js/store-core.js (UMD — module.exports khi ở Node):
// mapping camelCase ↔ snake_case 2 chiều, lọc trường nhãn/không phải cột thật,
// đóng gói custom_fields, payload khóa lạc quan (AC09), phân tích hash mời.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../js/store-core.js');
const Store = require('../js/store.js');

// ---------------------------------------------------------------------------
// Đổi tên trường 2 chiều
// ---------------------------------------------------------------------------

test('camelToSnake: đổi đúng các dạng tên trường thường gặp', () => {
  assert.equal(core.camelToSnake('campaignId'), 'campaign_id');
  assert.equal(core.camelToSnake('externalPostId'), 'external_post_id');
  assert.equal(core.camelToSnake('id'), 'id');
  assert.equal(core.camelToSnake('updatedAt'), 'updated_at');
  assert.equal(core.camelToSnake('buName'), 'bu_name');
});

test('snakeToCamel: đổi ngược đúng và là hàm ngược của camelToSnake', () => {
  assert.equal(core.snakeToCamel('campaign_id'), 'campaignId');
  assert.equal(core.snakeToCamel('external_post_id'), 'externalPostId');
  for (const camel of ['workspaceId', 'createdBy', 'effortHours', 'periodStart', 'approvedAmount']) {
    assert.equal(core.snakeToCamel(core.camelToSnake(camel)), camel, `round-trip thất bại với ${camel}`);
  }
});

// ---------------------------------------------------------------------------
// Mapping collection → bảng
// ---------------------------------------------------------------------------

test('COLLECTION_TO_TABLE: đủ các collection chính theo hợp đồng', () => {
  const expected = {
    businessUnits: 'bu_products', campaigns: 'campaigns', tasks: 'tasks',
    dependencies: 'task_dependencies', variants: 'content_variants',
    publishJobs: 'publish_jobs', brandAssets: 'assets', adSets: 'ad_groups',
    adChangeRequests: 'ads_change_requests', manualMetricEntries: 'metric_observations',
    metricObservations: 'metric_observations', reportSnapshots: 'report_snapshots',
  };
  for (const [col, table] of Object.entries(expected)) {
    assert.equal(core.COLLECTION_TO_TABLE[col], table, `${col} phải map sang ${table}`);
  }
});

test('TABLE_COLUMNS: mọi bảng được map đều có danh sách cột và chứa workspace_id (trừ memberships xử lý riêng)', () => {
  for (const [col, table] of Object.entries(core.COLLECTION_TO_TABLE)) {
    assert.ok(Array.isArray(core.TABLE_COLUMNS[table]) && core.TABLE_COLUMNS[table].length > 0, `thiếu cột cho bảng ${table}`);
  }
  assert.ok(core.hasColumn('tasks', 'workspace_id'));
  assert.ok(core.hasColumn('campaigns', 'updated_at'));
  assert.equal(core.hasColumn('tasks', 'assignee_id'), false, 'tasks không có cột assignee_id — phải alias sang owner_id');
});

// ---------------------------------------------------------------------------
// toDbPayload: lọc nhãn, alias, gói custom_fields
// ---------------------------------------------------------------------------

test('toDbPayload tasks: assigneeId → owner_id, trường nhãn bị loại, trường lạ gói vào custom_fields', () => {
  const payload = core.toDbPayload('tasks', {
    title: 'Việc A', assigneeId: 'user-1', campaignId: 'camp-1',
    statusLabel: 'Đang làm', deliverable: 'File nguồn', effortHours: 8,
  }, { workspaceId: 'ws-1' });
  assert.equal(payload.owner_id, 'user-1');
  assert.equal(payload.campaign_id, 'camp-1');
  assert.equal(payload.effort_hours, 8);
  assert.equal(payload.workspace_id, 'ws-1');
  assert.ok(!('status_label' in payload), 'trường *Label không được gửi lên server');
  assert.ok(!('deliverable' in payload), 'deliverable không phải cột thật của tasks');
  assert.equal(payload.custom_fields.deliverable, 'File nguồn', 'deliverable phải được giữ trong custom_fields');
});

test('toDbPayload: bảng không có custom_fields thì trường lạ bị bỏ hẳn, không rò cột lạ', () => {
  const payload = core.toDbPayload('phases', { name: 'Giai đoạn 1', campaignId: 'c1', somethingRandom: 42 });
  assert.equal(payload.name, 'Giai đoạn 1');
  assert.ok(!('something_random' in payload));
  assert.ok(!('custom_fields' in payload));
});

test('toDbPayload variants: platform facebook → facebook_page (enum DB), tiktok giữ nguyên', () => {
  assert.equal(core.toDbPayload('variants', { platform: 'facebook' }).platform, 'facebook_page');
  assert.equal(core.toDbPayload('variants', { platform: 'tiktok' }).platform, 'tiktok');
  assert.equal(core.toDbPayload('variants', { platform: 'instagram' }).platform, 'instagram');
});

test('toDbPayload budgetLines/kpis/commitments: alias số tiền và tiêu đề đúng cột thật', () => {
  const bl = core.toDbPayload('budgetLines', { name: 'Ads', approved: 1000, currency: 'VND' });
  assert.equal(bl.approved_amount, 1000);
  assert.ok(!('approved' in bl));
  const kpi = core.toDbPayload('kpis', { name: 'Leads', target: 500 });
  assert.equal(kpi.target_value, 500);
  const cm = core.toDbPayload('commitments', { title: 'Đặt cọc', amount: 10, status: 'open' });
  assert.equal(cm.description, 'Đặt cọc');
  assert.equal(cm.status, 'committed', 'status open của frontend phải đổi sang enum committed ở DB');
});

test('toDbPayload: id không phải uuid bị loại khi insert để server tự sinh', () => {
  const payload = core.toDbPayload('tasks', { id: 'task-a', title: 'X' }, { forInsert: true });
  assert.ok(!('id' in payload));
  const withUuid = core.toDbPayload('tasks', { id: '123e4567-e89b-12d3-a456-426614174000', title: 'X' }, { forInsert: true });
  assert.equal(withUuid.id, '123e4567-e89b-12d3-a456-426614174000');
});

test('toDbPayload marketingRequests: requester → requester_unit, ưu tiên tiếng Việt → enum', () => {
  const payload = core.toDbPayload('marketingRequests', { title: 'Yêu cầu', requester: 'Đội Sản phẩm', priority: 'Cao', dueDate: '2026-11-20' });
  assert.equal(payload.requester_unit, 'Đội Sản phẩm');
  assert.equal(payload.priority, 'high');
  assert.equal(payload.desired_due_date, '2026-11-20');
});

// ---------------------------------------------------------------------------
// fromDbRow: chiều ngược
// ---------------------------------------------------------------------------

test('fromDbRow tasks: owner_id → assigneeId + ownerId, custom_fields bung ngược lên top-level', () => {
  const item = core.fromDbRow('tasks', {
    id: 't1', workspace_id: 'ws', owner_id: 'u1', title: 'Việc A', effort_hours: 4,
    custom_fields: { deliverable: 'Bản dựng', availability_note: 'Từ thứ Hai' },
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
  });
  assert.equal(item.ownerId, 'u1');
  assert.equal(item.assigneeId, 'u1');
  assert.equal(item.effortHours, 4);
  assert.equal(item.deliverable, 'Bản dựng');
  assert.equal(item.availabilityNote, 'Từ thứ Hai');
  assert.equal(item.updatedAt, '2026-11-02T00:00:00Z');
});

test('fromDbRow variants: platform facebook_page → facebook + channelLabel hiển thị', () => {
  const item = core.fromDbRow('variants', { id: 'v1', platform: 'facebook_page', caption: 'Xin chào' });
  assert.equal(item.platform, 'facebook');
  assert.equal(item.channelLabel, 'Facebook');
});

test('round-trip: object frontend → payload → (giả lập dòng DB) → object giữ được trường nghiệp vụ chính', () => {
  const original = { title: 'Quay video', campaignId: 'c1', assigneeId: 'u9', dueDate: '2026-11-15', deliverable: 'Video 30s' };
  const payload = core.toDbPayload('tasks', original, { workspaceId: 'ws' });
  const row = { id: 't9', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...payload };
  const back = core.fromDbRow('tasks', row);
  assert.equal(back.title, original.title);
  assert.equal(back.campaignId, original.campaignId);
  assert.equal(back.assigneeId, original.assigneeId);
  assert.equal(back.dueDate, original.dueDate);
  assert.equal(back.deliverable, original.deliverable);
});

// ---------------------------------------------------------------------------
// buildOptimisticUpdate (AC09)
// ---------------------------------------------------------------------------

test('buildOptimisticUpdate: payload đã lọc nhãn + match chứa id và updated_at cũ', () => {
  const current = { id: 't1', updatedAt: '2026-11-02T10:00:00.000Z', title: 'Cũ' };
  const built = core.buildOptimisticUpdate('tasks', { title: 'Mới', statusLabel: 'X', effortHours: 3 }, current, '2026-11-03T10:00:00.000Z');
  assert.ok(built, 'tasks có updated_at nên phải dựng được khóa lạc quan');
  assert.equal(built.table, 'tasks');
  assert.deepEqual(built.match, { id: 't1', updated_at: '2026-11-02T10:00:00.000Z' });
  assert.equal(built.payload.title, 'Mới');
  assert.equal(built.payload.effort_hours, 3);
  assert.equal(built.payload.updated_at, '2026-11-03T10:00:00.000Z', 'payload phải mang updated_at mới');
  assert.ok(!('id' in built.payload) && !('status_label' in built.payload));
});

test('buildOptimisticUpdate: bảng không có updated_at (task_dependencies) thì trả null', () => {
  const built = core.buildOptimisticUpdate('dependencies', { lagDays: 2 }, { id: 'd1' });
  assert.equal(built, null);
});

test('buildOptimisticUpdate: bản ghi chưa có updatedAt thì trả null (không khóa được)', () => {
  assert.equal(core.buildOptimisticUpdate('tasks', { title: 'X' }, { id: 't1' }), null);
});

// ---------------------------------------------------------------------------
// parseAuthHash: link mời / khôi phục / hết hạn
// ---------------------------------------------------------------------------

test('parseAuthHash: hash invite hợp lệ được nhận diện kèm token', () => {
  const parsed = core.parseAuthHash('#access_token=tok123&refresh_token=ref456&type=invite');
  assert.equal(parsed.isAuthCallback, true);
  assert.equal(parsed.type, 'invite');
  assert.equal(parsed.accessToken, 'tok123');
  assert.equal(parsed.expired, false);
});

test('parseAuthHash: hash recovery cũng là callback đặt mật khẩu', () => {
  const parsed = core.parseAuthHash('#access_token=tok&type=recovery');
  assert.equal(parsed.isAuthCallback, true);
  assert.equal(parsed.type, 'recovery');
});

test('parseAuthHash: error_code=otp_expired → expired=true, không coi là callback hợp lệ để đặt mật khẩu', () => {
  const parsed = core.parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(parsed.hasError, true);
  assert.equal(parsed.expired, true);
});

test('parseAuthHash: hash route của app (#/overview) và hash rỗng không phải auth callback', () => {
  assert.equal(core.parseAuthHash('#/overview').isAuthCallback, false);
  assert.equal(core.parseAuthHash('').isAuthCallback, false);
  assert.equal(core.parseAuthHash('#/tasks').isAuthCallback, false);
});

// ---------------------------------------------------------------------------
// validateNewPassword
// ---------------------------------------------------------------------------

test('validateNewPassword: tối thiểu 8 ký tự và hai lần nhập phải khớp', () => {
  assert.equal(core.validateNewPassword('1234567', '1234567').ok, false);
  assert.equal(core.validateNewPassword('12345678', '12345679').ok, false);
  assert.equal(core.validateNewPassword('mat-khau-manh', 'mat-khau-manh').ok, true);
});

test('Store._toPayload reportSnapshots (R2-22): giữ scope.filter + period_start/period_end + data.rows; _rowToItem khôi phục filter/kỳ', () => {
  Store.state = { budgetLines: [] };
  const payload = Store._toPayload('reportSnapshots', {
    title: 'Báo cáo tháng 1', metrics: { spend: 100 }, summary: 'Tóm tắt', rows: [{ id: 'r1', spend: 100 }],
    filter: { from: '2027-01-01', to: '2027-01-31', accountId: 'acc-1', campaignId: 'camp-1', level: 'campaign' },
    definitionVersions: { ads: 'v1' },
  }, { workspaceId: 'ws-1', forInsert: true });
  assert.deepEqual(payload.scope, {
    filter: { from: '2027-01-01', to: '2027-01-31', accountId: 'acc-1', campaignId: 'camp-1', level: 'campaign' },
    source: 'reportDataset', definitionVersions: { ads: 'v1' },
  });
  assert.equal(payload.period_start, '2027-01-01');
  assert.equal(payload.period_end, '2027-01-31');
  assert.equal(payload.data.metrics.spend, 100);
  assert.deepEqual(payload.data.rows, [{ id: 'r1', spend: 100 }], 'rows phải đi vào data.rows');
  const item = Store._rowToItem('reportSnapshots', {
    id: 'snap-1', name: 'Báo cáo tháng 1', scope: payload.scope,
    period_start: payload.period_start, period_end: payload.period_end,
    data: payload.data, generated_at: '2027-02-01T00:00:00Z',
  });
  assert.deepEqual(item.filter, payload.scope.filter);
  assert.equal(item.periodStart, '2027-01-01');
  assert.equal(item.periodEnd, '2027-01-31');
  assert.deepEqual(item.definitionVersions, { ads: 'v1' });
});

test('isLabelField: chỉ khớp trường kết thúc bằng Label', () => {
  assert.equal(core.isLabelField('statusLabel'), true);
  assert.equal(core.isLabelField('roleLabel'), true);
  assert.equal(core.isLabelField('status'), false);
  assert.equal(core.isLabelField('label'), false);
});
