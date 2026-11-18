#!/usr/bin/env node
/*
 * scripts/generate-seed-from-demo.mjs — sinh supabase/seed/from-demo-data.sql
 * TỰ ĐỘNG từ js/demo-data.js. KHÔNG gõ tay dữ liệu trong file seed.
 *
 * Cách chạy:  node scripts/generate-seed-from-demo.mjs
 * Khi demo-data hoặc schema thay đổi (vd bổ sung field B2B vào 0017), chỉ
 * cần chạy lại script này — seed được sinh lại toàn bộ.
 *
 * Nguyên tắc ánh xạ (chi tiết ở docs/MIGRATION-0017-RUNBOOK.md):
 *  - Payload từng dòng đi qua ĐÚNG store-core.toDbPayload của app (alias,
 *    custom_fields, chuẩn hoá enum) rồi mới remap khóa.
 *  - id text của demo → uuid deterministic: md5('sava-seed-v1:' + demoId)
 *    định dạng uuid (đặt version=4, variant=8/9/a/b theo vị trí chuẩn).
 *    Mọi FK trỏ tới demo id đều qua cùng hàm này nên liên kết không vỡ.
 *  - members demo KHÔNG được seed (không có bảng members; members ở app là
 *    memberships JOIN users/auth). Mọi cột FK tới users mà demo điền member
 *    id (owner_id, approver_id, approved_by, created_by…) → NULL.
 *  - businessUnits (đơn vị) → bu_products mở rộng theo products[] (mỗi sản
 *    phẩm 1 dòng, bu_name = tên đơn vị) như _loadBusinessUnits ở store.js.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = require(join(root, 'js/demo-data.js'));
const Core = require(join(root, 'js/store-core.js'));

const WORKSPACE_ID = 'a0870eed-cbdc-4fde-a3da-0b09d83d83b6';
const SEED_TS = '2026-11-17T12:00:00+07:00';

// ---------- Ánh xạ id deterministic ----------
export function demoUuid(demoId) {
  const h = createHash('md5').update('sava-seed-v1:' + String(demoId)).digest('hex');
  return (
    h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32)
  );
}

const memberIds = new Set((demo.members || []).map((m) => m.id));
const buById = {};
(demo.businessUnits || []).forEach((u) => { buById[u.id] = u; });
// bu_products mở rộng: 1 dòng / sản phẩm; id deterministic theo đơn vị + sản phẩm.
const buProductRows = [];
(demo.businessUnits || []).forEach((u) => {
  (u.products || []).forEach((p) => {
    buProductRows.push({
      demoKey: 'bu-product:' + u.id + ':' + p,
      workspace_id: WORKSPACE_ID,
      bu_name: u.name,
      name: p,
      description: null,
      status: 'active',
      custom_fields: { demo_unit_id: u.id },
      created_at: SEED_TS,
      updated_at: SEED_TS
    });
  });
});
const firstProductUuidOfUnit = {};
(demo.businessUnits || []).forEach((u) => {
  if ((u.products || []).length) firstProductUuidOfUnit[u.id] = demoUuid('bu-product:' + u.id + ':' + u.products[0]);
});

// Mọi demo id (trừ members + businessUnits) → uuid qua demoUuid.
const demoIdSet = new Set();
Object.values(demo).forEach((v) => {
  if (Array.isArray(v)) v.forEach((r) => { if (r && typeof r === 'object' && r.id) demoIdSet.add(String(r.id)); });
});
memberIds.forEach((id) => demoIdSet.delete(id));
Object.keys(buById).forEach((id) => demoIdSet.delete(id));

// ---------- Cột theo kiểu dữ liệu (để phát literal SQL đúng) ----------
const JSONB_COLS = new Set(['custom_fields', 'guidelines', 'audiences', 'baseline', 'baseline_timeline', 'definition', 'dimensions', 'scope', 'data', 'definition_versions', 'cost_per_result', 'palette', 'key_messages', 'funnel_steps', 'deliverables', 'after_state', 'before_state', 'raw', 'creative', 'targeting', 'snapshot', 'settings']);
const TEXT_ARRAY_COLS = new Set(['tags', 'granted_scopes', 'metrics_succeeded']);
const UUID_ARRAY_COLS = new Set(['collaborators', 'media_asset_ids', 'mentions']);
// Cột FK tới users: giá trị member demo → null (kể cả khi lọt qua custom remap).
const USER_FK_COLS = new Set(['owner_id', 'created_by', 'approver_id', 'approved_by', 'reported_by', 'handler_id', 'reviewer_id', 'requested_by', 'decided_by', 'generated_by', 'invited_by', 'user_id', 'assignee_id', 'entered_by']);

function remapValue(col, value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (UUID_ARRAY_COLS.has(col)) return value.filter((x) => !memberIds.has(String(x))).map((x) => (demoIdSet.has(String(x)) ? demoUuid(x) : x));
    return value;
  }
  if (typeof value === 'object') {
    // custom_fields: business_unit_id của demo (id đơn vị) → tên đơn vị,
    // khớp quy ước _loadBusinessUnits ở chế độ thật (id của BU = bu_name).
    if (col === 'custom_fields') {
      const out = {};
      Object.entries(value).forEach(([k, v]) => {
        if ((k === 'business_unit_id' || k === 'businessUnitId') && buById[String(v)]) out[k] = buById[String(v)].name;
        else out[k] = v;
      });
      return out;
    }
    return value;
  }
  if (typeof value === 'string') {
    if (memberIds.has(value)) return USER_FK_COLS.has(col) ? null : value;
    if (buById[value] && (col === 'bu_product_id' || col === 'product_id')) return firstProductUuidOfUnit[value] || null;
    if (demoIdSet.has(value)) return demoUuid(value);
    return value;
  }
  return value;
}

// ---------- Literal SQL ----------
function sqlLiteral(col, value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    if (TEXT_ARRAY_COLS.has(col)) return 'array[' + value.map((x) => sqlLiteral(col, String(x))).join(', ') + ']::text[]';
    if (UUID_ARRAY_COLS.has(col)) return value.length ? 'array[' + value.map((x) => sqlLiteral(col, String(x))).join(', ') + ']::uuid[]' : "'{}'::uuid[]";
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb";
  }
  if (typeof value === 'object') return "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb";
  const s = String(value);
  if (JSONB_COLS.has(col)) return "'" + JSON.stringify(s).replace(/'/g, "''") + "'::jsonb";
  return "'" + s.replace(/'/g, "''") + "'";
}

// ---------- Dựng dòng DB từ 1 item demo ----------
function buildRow(collection, item) {
  const payload = Core.toDbPayload(collection, item, { forInsert: true, workspaceId: WORKSPACE_ID });
  const row = {};
  Object.entries(payload).forEach(([col, v]) => { row[col] = remapValue(col, v); });
  row.id = demoUuid(item.id);
  if ('workspace_id' in (Core.TABLE_COLUMNS[Core.COLLECTION_TO_TABLE[collection]] ? Object.fromEntries(Core.TABLE_COLUMNS[Core.COLLECTION_TO_TABLE[collection]].map((c) => [c, 1])) : {})) row.workspace_id = WORKSPACE_ID;
  // Timestamps: giữ mốc demo nếu có, thiếu thì dùng mốc seed cố định để
  // INSERT không vi phạm NOT NULL và kết quả sinh lại luôn giống hệt.
  const cols = Core.TABLE_COLUMNS[Core.COLLECTION_TO_TABLE[collection]] || [];
  if (cols.includes('created_at') && !row.created_at) row.created_at = row.updated_at || SEED_TS;
  if (cols.includes('updated_at') && !row.updated_at) row.updated_at = row.created_at || SEED_TS;
  return row;
}

// Xử lý đặc thù theo collection (chỉ phần store-core thuần không làm được —
// đối chiếu Store._toPayload ở js/store.js).
const SPECIALS = {
  campaigns(item, row) {
    // Store: why → objectives khi objectives trống.
    if (item.why && !row.objectives) row.objectives = item.why;
  },
  contentItems(item, row) {
    // Store: editorialStatus → status; scheduledDate → planned_at.
    if (item.editorialStatus) row.status = item.editorialStatus;
    if (item.scheduledDate && !row.planned_at) row.planned_at = item.scheduledDate;
  },
  variants(item, row) {
    const ed = { draft: 'draft', in_review: 'ready_for_review', approved: 'final', scheduled: 'final' };
    const ap = { draft: 'draft', pending: 'pending', approved: 'approved', rejected: 'rejected', needs_reapproval: 'needs_review', changes_requested: 'needs_review' };
    if (item.editorialStatus) row.editorial_status = ed[item.editorialStatus] || 'draft';
    if (item.approvalStatus) row.approval_status = ap[item.approvalStatus] || 'draft';
    if (row.platform === 'tiktok') row.publish_mode = 'external';
  },
  brandPages(item, row) {
    // Store: version + status sống trong guidelines jsonb ở chế độ thật.
    const g = Object.assign({}, row.guidelines || {});
    if (item.version !== undefined) g.version = item.version;
    if (item.status !== undefined) g.status = item.status;
    row.guidelines = g;
  },
  brandAssets(item, row) {
    // Store: type không thuộc enum DB → tags[0]; Approved/Draft là
    // approval_status, status sử dụng giữ 'active'.
    if (item.type && !['image', 'video', 'audio', 'document', 'design', 'other'].includes(String(item.type).toLowerCase())) {
      row.asset_type = 'other';
      row.tags = [String(item.type)];
    }
    const appr = { Draft: 'draft', 'In review': 'in_review', Approved: 'approved' };
    if (item.status && appr[item.status]) { row.approval_status = appr[item.status]; row.status = 'active'; }
  },
  kpis(item, row) {
    // kpis.metric_code NOT NULL: app tự suy từ name khi tạo; seed suy từ id
    // demo cho ổn định (vd kpi-camp01-brand-follows → camp01_brand_follows).
    if (!row.metric_code) row.metric_code = String(item.id).replace(/^kpi-/, '').replace(/-/g, '_');
    if (item.periodKey) {
      const [y, m] = String(item.periodKey).split('-').map(Number);
      if (y && m) {
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        row.period_start = item.periodKey + '-01';
        row.period_end = item.periodKey + '-' + String(last).padStart(2, '0');
      }
    }
    // actual KHÔNG có cột (suy từ measurements); demo actual đều null.
    delete row.actual;
  },
  tasks(item, row) {
    // DB check: status='completed' bắt buộc có completed_at — demo không
    // lưu completed_at nên suy = due_date (ghi rõ ở runbook).
    if (row.status === 'completed' && !row.completed_at) {
      const d = row.due_date || row.start_date;
      if (d) row.completed_at = String(d).slice(0, 10) + 'T00:00:00+07:00';
    }
  },
  budgetLines(item, row) {
    // approved_by là cột uuid (0014): member demo không ánh xạ được → null
    // (remapValue đã xử lý vì 'member-owner' ∈ memberIds + USER_FK_COLS).
  },
  adAccounts(item, row) {
    // external_id NOT NULL + unique(workspace, platform, external_id):
    // demo không có external id → dùng chính demo id làm placeholder.
    if (!row.external_id) row.external_id = String(item.id);
  },
  adChangeRequests(item, row) {
    // Theo Store._toPayload khi insert: after_state từ adChangePayload,
    // target_type/change_type mặc định, reason = title khi chưa có.
    const partial = Core.adChangePayload(item, null, { forInsert: true, explicitProposal: false });
    row.after_state = partial.after_state || { title: item.title || '', target: item.target || '' };
    if (!row.target_external_id) row.target_external_id = item.target || item.title || '';
    if (!row.target_type) row.target_type = 'ad_campaign';
    if (!row.change_type) row.change_type = 'other';
    if (!row.reason) row.reason = item.title || null;
    delete row.title;
    delete row.target;
    delete row.default_state;
  },
  cashTransactions(item, row) {
    // cash_transactions không có cột title: nội dung đi vào note.
    if (item.title && !row.note) row.note = item.title;
    if (!row.idempotency_key) row.idempotency_key = 'seed-' + String(item.id);
  },
  metricObservations(item, row) {
    // Theo Store._toPayload: period = observed_at; object = external post.
    const observed = item.observedAt || SEED_TS;
    row.observed_at = observed;
    row.period_start = observed;
    row.period_end = observed;
    row.object_type = 'external_post';
    row.object_id = item.externalPostId ? demoUuid(item.externalPostId) : '';
    row.source = item.source || 'manual';
    row.dimensions = { entered_by_demo_id: item.enteredBy || null, demo_external_post_id: item.externalPostId || null, demo_id: item.id };
    delete row.external_post_id;
  },
  reportSnapshots(item, row) {
    // report_snapshots: report_type NOT NULL (enum) + data NOT NULL.
    row.report_type = 'custom';
    row.data = { metrics: item.metrics || {}, summary: item.summary || null, status: item.status || null, frozen_at: item.frozenAt || null };
    row.generated_at = item.frozenAt || SEED_TS;
    row.created_at = item.frozenAt || SEED_TS;
    delete row.metrics;
    delete row.summary;
    delete row.frozen_at;
  },
  externalPosts(item, row) {
    if (!row.source) row.source = 'manual';
  }
};

// Thứ tự INSERT tôn trọng FK (bảng cha trước bảng con).
const ORDER = [
  ['brands', 'brands'],
  ['businessUnits→bu_products', 'bu_products'],
  ['campaigns', 'campaigns'],
  ['phases', 'phases'],
  ['activities', 'activities'],
  ['contentPillars', 'content_pillars'],
  ['brandPages', 'brand_pages'],
  ['brandAssets', 'assets'],
  ['channelAccounts', 'channel_accounts'],
  ['contentItems', 'content_items'],
  ['variants', 'content_variants'],
  ['externalPosts', 'external_posts'],
  ['metricObservations', 'metric_observations'],
  ['budgetLines', 'budget_lines'],
  ['kpis', 'kpis'],
  ['tasks', 'tasks'],
  ['dependencies', 'task_dependencies'],
  ['blockers', 'blockers'],
  ['publishJobs', 'publish_jobs'],
  ['approvals→approval_steps', 'approval_steps'],
  ['adAccounts', 'ad_accounts'],
  ['adCampaigns', 'ad_campaigns'],
  ['adSets', 'ad_groups'],
  ['ads', 'ads'],
  ['adChangeRequests', 'ads_change_requests'],
  ['marketingRequests', 'marketing_requests'],
  ['cashAccounts', 'cash_accounts'],
  ['cashTransactions', 'cash_transactions'],
  ['reportSnapshots', 'report_snapshots'],
  ['benchmarks', 'benchmarks'],
  ['plan_rows', 'plan_rows'],
  ['phase_assumptions', 'phase_assumptions']
];

const rowsByTable = {};
const counts = []; // {label, demoCount, insertCount, table}
function addRows(label, collectionKey, items) {
  const table = Core.COLLECTION_TO_TABLE[collectionKey];
  if (!table) { counts.push({ label, demoCount: items.length, insertCount: 0, table: '— (không có bảng)' }); return; }
  const rows = items.map((item) => {
    const row = buildRow(collectionKey, item);
    if (SPECIALS[collectionKey]) SPECIALS[collectionKey](item, row);
    return row;
  });
  rowsByTable[table] = (rowsByTable[table] || []).concat(rows);
  counts.push({ label, demoCount: items.length, insertCount: rows.length, table });
}

// bu_products: nguồn là businessUnits mở rộng theo products[].
rowsByTable.bu_products = buProductRows.map((r) => Object.assign({}, r, { id: demoUuid(r.demoKey) }));
counts.push({ label: 'businessUnits→bu_products', demoCount: (demo.businessUnits || []).length, insertCount: buProductRows.length, table: 'bu_products' });

addRows('brands', 'brands', demo.brands || []);
ORDER.slice(1).forEach(([label, table]) => {
  if (label === 'businessUnits→bu_products') return; // đã xử lý ở trên
  const collectionKey = label.includes('→') ? null : label;
  if (!collectionKey) { counts.push({ label, demoCount: (demo[label.split('→')[0]] || []).length, insertCount: 0, table }); return; }
  addRows(label, collectionKey, demo[collectionKey] || []);
});
// Các collection demo còn lại (đều 0 dòng ở demo hiện tại) — vẫn đối chiếu:
['kpiContributions', 'budgetAllocations', 'adInsights', 'manualMetricEntries'].forEach((k) => {
  addRows(k, k, demo[k] || []);
});
// Sắp xếp bảng đối chiếu theo đúng thứ tự INSERT:
const LABEL_ORDER = ORDER.map(([l]) => l).concat(['kpiContributions', 'budgetAllocations', 'adInsights', 'manualMetricEntries']);
counts.sort((a, b) => LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label));

// asset_versions phái sinh từ brandAssets (version của demo) — không phải
// collection demo, ghi riêng ở bảng đối chiếu.
const assetVersionRows = (demo.brandAssets || []).map((a) => ({
  id: demoUuid('asset-version:' + a.id),
  workspace_id: WORKSPACE_ID,
  asset_id: demoUuid(a.id),
  version_no: a.version || 1,
  change_note: 'Seed từ dữ liệu demo (migration 0017)',
  created_at: a.updatedAt || SEED_TS
}));
if (assetVersionRows.length) rowsByTable.asset_versions = assetVersionRows;

// ---------- Tự kiểm FK nội bộ: mọi uuid FK phải trỏ tới dòng đã seed ----------
const insertedIds = {};
Object.entries(rowsByTable).forEach(([t, rows]) => { insertedIds[t] = new Set(rows.map((r) => r.id)); });
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FK_TARGET = {
  brand_id: 'brands', campaign_id: 'campaigns', phase_id: 'phases', activity_id: 'activities',
  task_id: 'tasks', content_item_id: 'content_items', pillar_id: 'content_pillars',
  bu_product_id: 'bu_products', product_id: 'bu_products', brand_page_id: 'brand_pages',
  channel_account_id: 'channel_accounts', variant_id: 'content_variants', asset_id: 'assets',
  account_id: 'cash_accounts', ad_account_id: 'ad_accounts', ad_campaign_id: 'ad_campaigns',
  ad_group_id: 'ad_groups', budget_line_id: 'budget_lines', external_post_id: 'external_posts'
};
const problems = [];
Object.entries(rowsByTable).forEach(([t, rows]) => {
  rows.forEach((r) => {
    Object.entries(r).forEach(([col, v]) => {
      const target = FK_TARGET[col];
      if (target && typeof v === 'string' && uuidRe.test(v) && v !== WORKSPACE_ID) {
        if (!insertedIds[target] || !insertedIds[target].has(v)) problems.push(t + '.' + col + ' → ' + target + ' thiếu ' + v);
      }
    });
  });
});
if (problems.length) {
  console.error('SEED TỰ KIỂM FK THẤT BẠI:\n' + problems.join('\n'));
  process.exit(1);
}

// ---------- Phát SQL ----------
const TABLE_ORDER = ['brands', 'bu_products', 'campaigns', 'phases', 'activities', 'content_pillars', 'brand_pages', 'assets', 'asset_versions', 'channel_accounts', 'content_items', 'content_variants', 'external_posts', 'metric_observations', 'budget_lines', 'kpis', 'tasks', 'task_dependencies', 'blockers', 'publish_jobs', 'approval_steps', 'ad_accounts', 'ad_campaigns', 'ad_groups', 'ads', 'ads_change_requests', 'marketing_requests', 'cash_accounts', 'cash_transactions', 'report_snapshots', 'benchmarks', 'plan_rows', 'phase_assumptions'];
function insertSql(table, row) {
  const cols = Object.keys(row).filter((c) => row[c] !== undefined && c !== 'demoKey');
  return 'insert into public.' + table + ' (' + cols.join(', ') + ') values (' + cols.map((c) => sqlLiteral(c, row[c])).join(', ') + ');';
}

const countLines = counts.map((c) => '--   ' + c.label.padEnd(28) + ' demo ' + String(c.demoCount).padStart(3) + ' → insert ' + String(c.insertCount).padStart(3) + '  (' + c.table + ')').join('\n');
const header = `-- ============================================================================
-- supabase/seed/from-demo-data.sql — SINH TỰ ĐỘNG, KHÔNG SỬA TAY.
-- Nguồn: js/demo-data.js qua scripts/generate-seed-from-demo.mjs.
-- Chạy lại: node scripts/generate-seed-from-demo.mjs
-- ============================================================================
-- TIỀN ĐIỀU KIỆN (đọc kỹ trước khi chạy — xem docs/MIGRATION-0017-RUNBOOK.md):
--   1. Đã áp migration 0017_brand_planning.sql.
--   2. Database đang TRỐNG nghiệp vụ trong workspace đích (mọi bảng dưới đây
--      chưa có dòng nào thuộc workspace này) — seed KHÔNG dùng on conflict,
--      chạy trên DB đã có dữ liệu sẽ lỗi khóa chính/ràng buộc duy nhất.
--   3. Workspace đích phải tồn tại sẵn: ${WORKSPACE_ID}
--      (workspace sava-marketing) cùng auth/membership của Owner — seed
--      KHÔNG tạo workspace, KHÔNG đụng auth.users / public.users /
--      memberships. Mọi cột người dùng (owner_id, approved_by…) để NULL vì
--      members demo không ánh xạ được sang user thật (runbook có bảng tra).
--   4. Chạy bằng SQL Editor (vai postgres/service) — bỏ qua RLS có chủ ý:
--      đây là nạp dữ liệu khởi tạo, gồm cả số đã duyệt (approved_amount,
--      budget_ceiling) mà đường app thường bị khóa bởi chuỗi duyệt 0014.
--   5. *** SEED BẢN CUỐI ***: bản seed này sinh từ js/demo-data.js SAU
--      commit mô hình B2B trên demo (3275bc7) + commit ghi tường minh
--      audience 'b2c' cho 4 dòng Meta Ads Camp 01 (3545316). Đây là bản
--      được áp lên production theo runbook 0017 — đối chiếu số dòng ở
--      bảng dưới + 4 số neo ở cuối file trước khi coi là xong.
--
-- BẢNG ĐỐI CHIẾU số dòng demo ↔ số INSERT (script tự in khi sinh):
${countLines}
--   asset_versions (phái sinh)   demo   0 → insert ${String(assetVersionRows.length).padStart(3)}  (asset_versions — version của brandAssets demo)
--   members                       demo ${String((demo.members || []).length).padStart(3)} → insert   0  (KHÔNG seed — xem tiền điều kiện 3)
--   holidays                      demo ${String((demo.holidays || []).length).padStart(3)} → insert   0  (không có bảng holidays trong schema)
-- ============================================================================

begin;
`;

let body = '';
TABLE_ORDER.forEach((t) => {
  const rows = rowsByTable[t] || [];
  if (!rows.length) return;
  body += '\n-- ' + t + ' (' + rows.length + ' dòng)\n';
  rows.forEach((r) => { body += insertSql(t, r) + '\n'; });
});

const camp01 = demoUuid('camp-play-unknown');
const lumus = demoUuid('brand-lumus-ai');
const checks = `
commit;

-- ============================================================================
-- KIỂM CHỨNG SAU SEED (các SELECT này chạy được ngay sau commit ở trên;
-- số kỳ vọng ghi ở cột phải — đối chiếu với kết quả trả về).
-- ============================================================================
-- Số dòng từng bảng trong workspace đích:
select 'brands' as bang, count(*) as so_dong, 2 as ky_vong from public.brands where workspace_id = '${WORKSPACE_ID}'
union all select 'bu_products', count(*), 5 from public.bu_products where workspace_id = '${WORKSPACE_ID}'
union all select 'campaigns', count(*), 3 from public.campaigns where workspace_id = '${WORKSPACE_ID}'
union all select 'phases', count(*), 7 from public.phases where workspace_id = '${WORKSPACE_ID}'
union all select 'activities', count(*), 3 from public.activities where workspace_id = '${WORKSPACE_ID}'
union all select 'content_pillars', count(*), 4 from public.content_pillars where workspace_id = '${WORKSPACE_ID}'
union all select 'brand_pages', count(*), 3 from public.brand_pages where workspace_id = '${WORKSPACE_ID}'
union all select 'assets', count(*), 3 from public.assets where workspace_id = '${WORKSPACE_ID}'
union all select 'asset_versions', count(*), 3 from public.asset_versions where workspace_id = '${WORKSPACE_ID}'
union all select 'channel_accounts', count(*), 4 from public.channel_accounts where workspace_id = '${WORKSPACE_ID}'
union all select 'content_items', count(*), 27 from public.content_items where workspace_id = '${WORKSPACE_ID}'
union all select 'content_variants', count(*), 33 from public.content_variants where workspace_id = '${WORKSPACE_ID}'
union all select 'external_posts', count(*), 1 from public.external_posts where workspace_id = '${WORKSPACE_ID}'
union all select 'metric_observations', count(*), 1 from public.metric_observations where workspace_id = '${WORKSPACE_ID}'
union all select 'budget_lines', count(*), 11 from public.budget_lines where workspace_id = '${WORKSPACE_ID}'
union all select 'kpis', count(*), 12 from public.kpis where workspace_id = '${WORKSPACE_ID}'
union all select 'tasks', count(*), 116 from public.tasks where workspace_id = '${WORKSPACE_ID}'
union all select 'ad_accounts', count(*), 1 from public.ad_accounts where workspace_id = '${WORKSPACE_ID}'
union all select 'ads_change_requests', count(*), 1 from public.ads_change_requests where workspace_id = '${WORKSPACE_ID}'
union all select 'marketing_requests', count(*), 1 from public.marketing_requests where workspace_id = '${WORKSPACE_ID}'
union all select 'cash_accounts', count(*), 2 from public.cash_accounts where workspace_id = '${WORKSPACE_ID}'
union all select 'cash_transactions', count(*), 6 from public.cash_transactions where workspace_id = '${WORKSPACE_ID}'
union all select 'report_snapshots', count(*), 1 from public.report_snapshots where workspace_id = '${WORKSPACE_ID}'
union all select 'benchmarks', count(*), 8 from public.benchmarks where workspace_id = '${WORKSPACE_ID}'
union all select 'plan_rows', count(*), 237 from public.plan_rows where workspace_id = '${WORKSPACE_ID}'
union all select 'phase_assumptions', count(*), 12 from public.phase_assumptions where workspace_id = '${WORKSPACE_ID}'
order by bang;

-- 4 SỐ NEO:
-- Neo 1 — Lumus 776 content (tổng qty plan_rows của Brand Lumus AI):
select sum(qty) as lumus_content_qty, 776 as ky_vong from public.plan_rows where workspace_id = '${WORKSPACE_ID}' and brand_id = '${lumus}';
-- Neo 2 — Tổng ngân sách Planning năm 2027, lọc Brand/Segment = Tất cả:
-- 1.598.700.000đ = Σ (qty × đơn giá hiệu dụng) + Σ budget trực tiếp (Paid),
-- đơn giá hiệu dụng = giá Phase trên dòng (unit_price của plan_rows;
-- giá Benchmark KHÔNG còn được đọc — chốt 18/11, khớp domain.planBudget).
select sum(case when pr.qty is not null then pr.qty * coalesce(pr.unit_price, 0) else coalesce(pr.budget, 0) end) as tong_ngan_sach_2027, 1598700000 as ky_vong
from public.plan_rows pr
where pr.workspace_id = '${WORKSPACE_ID}' and pr.month like '2027-%';
-- Neo 3 — Camp 01 budget = 51.539.000đ (Σ planned_amount budget_lines của Camp 01):
select sum(planned_amount) as camp01_budget, 51539000 as ky_vong from public.budget_lines where workspace_id = '${WORKSPACE_ID}' and campaign_id = '${camp01}';
-- Neo 4 — 115 task thuộc Camp 01:
select count(*) as camp01_tasks, 115 as ky_vong from public.tasks where workspace_id = '${WORKSPACE_ID}' and campaign_id = '${camp01}';
`;

const outPath = join(root, 'supabase/seed/from-demo-data.sql');
writeFileSync(outPath, header + body + checks);
console.log('Đã sinh ' + outPath);
console.log(countLines.replace(/^-- /gm, ''));
console.log('asset_versions (phái sinh): ' + assetVersionRows.length);
console.log('Tự kiểm FK nội bộ: PASS (mọi FK uuid đều trỏ tới dòng đã seed hoặc null).');
