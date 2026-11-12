// tests/r31-export.test.mjs
// R3.1-EXPORT (AC22) — export CSV KPI / ngân sách / thu–chi ở js/app.js.
// [static] nút + hàm export + adapter dùng đúng hàm domain của trang
// (kpiRollupFor / summarizeCampaignBudget / summarizeActivityBudget /
// D.openCommitmentTotal / D.budgetRemaining) + cổng quyền canBudget;
// [unit] trích xuất vùng thuần R3.1-EXPORT-PURE và chạy trên fixture demo
// livestream (D.1/D.2) với rollups/summaries tính bằng ĐÚNG domain mà
// adapter truyền vào: unique 140, ngân sách Ads 15/10, tổng 30/20,5/7,5/28,
// ceiling campaign 32. Export ads cũ (exportCsv) phải giữ nguyên.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const demo = require('../js/demo-data.js');
const D = require('../js/domain.js');

function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}

// ---------- Trích xuất vùng thuần của export để chạy unit thật ----------
const pureBegin = src.indexOf('// R3.1-EXPORT-PURE-BEGIN');
const pureEnd = src.indexOf('// R3.1-EXPORT-PURE-END');
assert.notEqual(pureBegin, -1, 'thiếu marker R3.1-EXPORT-PURE-BEGIN');
assert.notEqual(pureEnd, -1, 'thiếu marker R3.1-EXPORT-PURE-END');
const pureSrc = src.slice(pureBegin, pureEnd);
const X = new Function(
  pureSrc + '\nreturn { KPI_EXPORT_COLUMNS: KPI_EXPORT_COLUMNS, BUDGET_EXPORT_COLUMNS: BUDGET_EXPORT_COLUMNS, CASH_EXPORT_COLUMNS: CASH_EXPORT_COLUMNS, r31CsvCell: r31CsvCell, r31RowsToCsv: r31RowsToCsv, buildKpiExportRows: buildKpiExportRows, buildBudgetExportRows: buildBudgetExportRows, buildCashExportRows: buildCashExportRows };'
)();

// ---------- [static] ----------
test('R3.1-EXPORT [static]: có đủ 3 hàm export mới + nút ở đúng khối của trang KPI & Ngân sách + dispatcher', () => {
  for (const fn of ['function exportKpiCsv()', 'function exportBudgetCsv()', 'function exportCashCsv()', 'function downloadCsvText(']) {
    assert.ok(src.includes(fn), 'thiếu: ' + fn);
  }
  const kpiView = section('function viewKpi()', '// ---------- Kênh & Bài đã đăng ----------');
  assert.match(kpiView, /data-action="export-kpi-csv"/);
  assert.match(kpiView, /data-action="export-budget-csv"/);
  assert.match(kpiView, /data-action="export-cash-csv"/);
  // Nút KPI nằm ở khối KPI (trước heading ngân sách), nút thu–chi cạnh khối Thu–Chi.
  assert.ok(kpiView.indexOf('export-kpi-csv') < kpiView.indexOf('Ngân sách theo từng tiền tệ'), 'nút export KPI phải ở khối KPI');
  assert.ok(kpiView.indexOf('export-cash-csv') > kpiView.indexOf('Thu–Chi &amp; Ngân sách'), 'nút export thu–chi phải cạnh khối Thu–Chi');
  assert.match(src, /if \(action === 'export-kpi-csv'\) exportKpiCsv\(\)/);
  assert.match(src, /if \(action === 'export-budget-csv'\) exportBudgetCsv\(\)/);
  assert.match(src, /if \(action === 'export-cash-csv'\) exportCashCsv\(\)/);
});

test('R3.1-EXPORT [static]: header export có IDs, scope, kỳ, đơn vị (AC22) ở cả KPI và ngân sách', () => {
  for (const col of ['id', 'scope_type', 'campaign_id', 'activity_id', 'task_id', 'content_item_id', 'pillar_id', 'metric_code', 'definition', 'aggregation_mode', 'target', 'actual', 'unit', 'period_start', 'period_end', 'currency', 'owner_id', 'target_version', 'data_status']) {
    assert.ok(X.KPI_EXPORT_COLUMNS.includes(col), 'header KPI thiếu cột: ' + col);
  }
  for (const col of ['id', 'row_type', 'scope_type', 'campaign_id', 'activity_id', 'task_id', 'planned', 'approved', 'amount', 'allocated', 'actual_total', 'open_commitments', 'forecast_use', 'available', 'ceiling', 'currency', 'period_start', 'period_end', 'date', 'status']) {
    assert.ok(X.BUDGET_EXPORT_COLUMNS.includes(col), 'header ngân sách thiếu cột: ' + col);
  }
  for (const col of ['id', 'account_id', 'category', 'direction', 'amount', 'currency', 'occurred_on', 'campaign_id', 'activity_id']) {
    assert.ok(X.CASH_EXPORT_COLUMNS.includes(col), 'header thu–chi thiếu cột: ' + col);
  }
});

test('R3.1-EXPORT [static]: adapter dùng CÙNG hàm domain với UI (không tự tính lại) + cổng quyền canBudget cho ngân sách/thu–chi', () => {
  const adapters = section('// R3.1-EXPORT-PURE-END', 'function exportCsv()');
  assert.match(adapters, /kpiRollupFor\(k\)/);
  assert.match(adapters, /summarizeCampaignBudget\(c\)/);
  assert.match(adapters, /summarizeActivityBudget\(c, a\)/);
  assert.match(adapters, /D\.openCommitmentTotal/);
  assert.match(adapters, /D\.budgetRemaining/);
  assert.match(adapters, /Store\.list\('kpis'\)/);
  assert.match(adapters, /visibleList\('budgetLines'\)/);
  const guards = adapters.match(/if \(!canBudget\(\)\)/g) || [];
  assert.ok(guards.length >= 2, 'export ngân sách và thu–chi đều phải chặn khi !canBudget() (chỉ thấy ' + guards.length + ')');
  // Vùng thuần không chạm Store/domain — chỉ đóng gói dữ liệu đã tính.
  assert.doesNotMatch(pureSrc, /Store\.|SAVA_DOMAIN|summarizeBudgetScope|rollupKpi/);
});

test('R3.1-EXPORT [static]: export ads hiện có (exportCsv) giữ nguyên header và hành vi', () => {
  const csv = section('function exportCsv()', 'function runGlobalSearch');
  assert.match(csv, /level,name,status,currency,spend,impressions,clicks,results,conversionValue/);
  assert.match(csv, /UI\.reportRowsCache/);
  assert.match(csv, /sava-bao-cao-/);
});

// ---------- [unit] KPI trên fixture livestream ----------
// Rollups tính bằng đúng cơ chế adapter dùng: D.rollupKpi qua contributions
// (unique), tử/mẫu (ratio) hoặc fact đơn (sum) — sao chép tối thiểu của
// kpiRollupFor để test chạy độc lập với DOM.
const M = 1000000;
const kpiById = Object.fromEntries(demo.kpis.map((k) => [k.id, k]));
function rollupFor(k) {
  const mode = String(k.aggregationMode || 'direct').toLowerCase();
  const contribs = demo.kpiContributions.filter((c) => c.kpiId === k.id);
  if (contribs.length && mode !== 'ratio') {
    const facts = contribs.map((ct) => {
      const sk = kpiById[ct.sourceKpiId];
      return { id: 'fact-' + sk.id, metricCode: sk.metricCode, unit: sk.unit, period: sk.periodKey, value: sk.actual, identities: sk.identityKeys };
    });
    return D.rollupKpi(facts, { mode: mode === 'direct' || mode === 'manual' ? 'sum' : mode, metricCode: k.metricCode || null, unit: k.unit || null, period: k.periodKey || null, target: k.target ?? null });
  }
  if (mode === 'ratio') return D.rollupKpi([], { mode: 'ratio', numerator: k.numerator, denominator: k.denominator, target: k.target ?? null });
  if (mode === 'unique' || mode === 'snapshot') return D.rollupKpi([], { mode, target: k.target ?? null });
  if (k.actual === null || k.actual === undefined) return null;
  return D.rollupKpi([{ id: 'fact-' + k.id, metricCode: k.metricCode || null, unit: k.unit || null, period: k.periodKey || null, value: Number(k.actual) }], { mode: 'sum', metricCode: k.metricCode || null, unit: k.unit || null, period: k.periodKey || null, target: k.target ?? null });
}
function kpiExportRows() {
  const rollups = {};
  const ownerNames = Object.fromEntries(demo.members.map((m) => [m.id, m.name]));
  for (const k of demo.kpis) {
    const roll = rollupFor(k);
    if (roll) {
      const mode = String(k.aggregationMode || '').toLowerCase();
      rollups[k.id] = { value: roll.value === null || roll.value === undefined ? null : (mode === 'ratio' ? Math.round(roll.value) : roll.value), status: roll.status || 'ok' };
    } else {
      rollups[k.id] = (k.actual === null || k.actual === undefined) ? { value: null, status: 'insufficient_data' } : { value: k.actual, status: 'ok' };
    }
  }
  return X.buildKpiExportRows(demo.kpis, { rollups, ownerNames });
}

test('R3.1-EXPORT [unit]: dòng KPI unique toàn campaign có id + scope campaign + actual 140 + unit + kỳ (D.2)', () => {
  const rows = kpiExportRows();
  const r = rows.find((x) => x.id === 'kpi-live-campaign-reg');
  assert.ok(r, 'thiếu dòng KPI unique');
  assert.equal(r.scope_type, 'campaign');
  assert.equal(r.campaign_id, 'camp-live');
  assert.equal(r.activity_id, '');
  assert.equal(r.metric_code, 'valid_registrations');
  assert.equal(r.aggregation_mode, 'unique');
  assert.equal(r.target, 150);
  assert.equal(r.actual, 140);
  assert.equal(r.unit, 'người');
  assert.equal(r.period_key, '2026-11');
  assert.equal(r.data_status, 'ok');
  assert.match(r.definition, /COUNT DISTINCT/);
  // KPI hoạt động Ads: scope activity + actual 100 (không bị roll-up nuốt).
  const ads = rows.find((x) => x.id === 'kpi-live-ads-reg');
  assert.equal(ads.scope_type, 'activity');
  assert.equal(ads.activity_id, 'act-live-ads');
  assert.equal(ads.actual, 100);
  // CPL ratio của Ads qua rollup = 100.000, khác CPL toàn campaign ≈146.429.
  assert.equal(rows.find((x) => x.id === 'kpi-live-ads-cpl').actual, 100000);
  assert.equal(rows.find((x) => x.id === 'kpi-live-campaign-cpl').actual, 146429);
  // KPI chưa có actual (kpi-2) → actual trống + insufficient_data, KHÔNG bịa 0.
  const missing = rows.find((x) => x.id === 'kpi-2');
  assert.equal(missing.actual, '');
  assert.equal(missing.data_status, 'insufficient_data');
});

// ---------- [unit] Ngân sách trên fixture livestream ----------
function liveLines() { return demo.budgetLines.filter((b) => b.campaignId === 'camp-live'); }
function budgetExportRows() {
  const lines = liveLines();
  const lineIds = new Set(lines.map((l) => l.id));
  const commitments = demo.commitments.filter((x) => lineIds.has(x.budgetLineId));
  const actuals = demo.actuals.filter((x) => lineIds.has(x.budgetLineId));
  const camp = demo.campaigns.find((c) => c.id === 'camp-live');
  // summary_campaign: cùng công thức adapter (childAllocations = Σ approved
  // theo activity; ceiling = hạn mức campaign đã cấu hình).
  const child = demo.activities.filter((a) => a.campaignId === 'camp-live').map((a) => ({
    activityId: a.id, scopeId: a.id, currency: 'VND',
    amount: lines.filter((l) => l.activityId === a.id).reduce((s, l) => s + l.approved, 0),
  }));
  const campSum = D.summarizeBudgetScope({ ceiling: camp.budgetCeiling, currency: 'VND', childAllocations: child, commitments, actuals });
  const summaries = [{ scopeType: 'campaign', campaignId: camp.id, title: camp.name, currency: 'VND', ceiling: campSum.ceiling, allocated: campSum.allocated, unallocated: campSum.unallocated, actualTotal: campSum.actualTotal, openCommitments: campSum.openCommitments, forecastUse: campSum.forecastUse, available: campSum.available }];
  // summary_activity: ceiling = Σ approved của dòng thuộc activity, scopeId = activity.
  const ceilings = { 'act-live-invite': 8, 'act-live-ads': 15, 'act-live-seeding': 5, 'act-live-show': 2 };
  for (const a of demo.activities.filter((x) => x.campaignId === 'camp-live')) {
    const s = D.summarizeBudgetScope({ ceiling: ceilings[a.id] * M, currency: 'VND', scopeId: a.id, commitments, actuals });
    summaries.push({ scopeType: 'activity', campaignId: camp.id, activityId: a.id, title: a.name, currency: 'VND', ceiling: s.ceiling, allocated: s.allocated, unallocated: s.unallocated, actualTotal: s.actualTotal, openCommitments: s.openCommitments, forecastUse: s.forecastUse, available: s.available });
  }
  const lineStats = {};
  for (const l of lines) {
    const cs = commitments.filter((x) => x.budgetLineId === l.id);
    const as = actuals.filter((x) => x.budgetLineId === l.id);
    lineStats[l.id] = {
      actualTotal: as.reduce((s, x) => s + Number(x.amount || 0), 0),
      openCommitments: D.openCommitmentTotal(cs, as),
      remaining: D.budgetRemaining(l, cs, as),
    };
  }
  return X.buildBudgetExportRows({ lines, commitments, actuals, allocations: demo.budgetAllocations, summaries, lineStats });
}

test('R3.1-EXPORT [unit]: dòng ngân sách Ads có planned 16 / approved 15 / actual 10 (triệu) và scope activity (D.1)', () => {
  const rows = budgetExportRows();
  const line = rows.find((x) => x.row_type === 'budget_line' && x.id === 'bl-live-ads');
  assert.ok(line, 'thiếu dòng ngân sách Ads');
  assert.equal(line.scope_type, 'activity');
  assert.equal(line.campaign_id, 'camp-live');
  assert.equal(line.activity_id, 'act-live-ads');
  assert.equal(line.planned, 16 * M);
  assert.equal(line.approved, 15 * M);
  assert.equal(line.actual_total, 10 * M);
  assert.equal(line.currency, 'VND');
  // Fact gốc Ads có ID riêng, không phải bản sao của dòng.
  const fact = rows.find((x) => x.row_type === 'actual' && x.id === 'pay-live-ads');
  assert.equal(fact.amount, 10 * M);
  assert.equal(fact.budget_line_id, 'bl-live-ads');
  assert.equal(fact.commitment_id, 'cm-live-ads');
  assert.equal(fact.scope_type, 'activity');
  const commit = rows.find((x) => x.row_type === 'commitment' && x.id === 'cm-live-ads');
  assert.equal(commit.amount, 14 * M);
});

test('R3.1-EXPORT [unit]: summary theo scope khớp D.1 — campaign 32/30/20,5/7,5/28/4 và Ads còn 1tr', () => {
  const rows = budgetExportRows();
  const camp = rows.find((x) => x.row_type === 'summary_campaign' && x.campaign_id === 'camp-live');
  assert.equal(camp.ceiling, 32 * M);
  assert.equal(camp.allocated, 30 * M);
  assert.equal(camp.unallocated, 2 * M);
  assert.equal(camp.actual_total, 20.5 * M);
  assert.equal(camp.open_commitments, 7.5 * M);
  assert.equal(camp.forecast_use, 28 * M);
  assert.equal(camp.available, 4 * M);
  const ads = rows.find((x) => x.row_type === 'summary_activity' && x.activity_id === 'act-live-ads');
  assert.equal(ads.ceiling, 15 * M);
  assert.equal(ads.actual_total, 10 * M);
  assert.equal(ads.open_commitments, 4 * M);
  assert.equal(ads.forecast_use, 14 * M);
  assert.equal(ads.available, 1 * M);
});

// ---------- [unit] Thu–Chi + escape CSV ----------
test('R3.1-EXPORT [unit]: dòng thu–chi có đủ account_id, category, direction, amount, currency, occurred_on, campaign/activity, id', () => {
  const rows = X.buildCashExportRows([
    { id: 'cash-1', accountId: 'acc-1', categoryId: 'cat-ads', direction: 'out', amount: 2500000, occurredOn: '2026-11-24', campaignId: 'camp-live', activityId: 'act-live-ads', note: 'Chi ads đợt 1' },
    { id: 'cash-2', account_id: 'acc-1', category_id: 'cat-fund', direction: 'in', amount: 32000000, occurred_on: '2026-11-16', campaign_id: 'camp-live' },
  ], { accountNames: { 'acc-1': 'Quỹ Marketing' }, accountCurrencies: { 'acc-1': 'VND' }, categoryNames: { 'cat-ads': 'Quảng cáo', 'cat-fund': 'Cấp vốn' } });
  assert.equal(rows[0].account_id, 'acc-1');
  assert.equal(rows[0].account_name, 'Quỹ Marketing');
  assert.equal(rows[0].category, 'Quảng cáo');
  assert.equal(rows[0].direction, 'out');
  assert.equal(rows[0].amount, 2500000);
  assert.equal(rows[0].currency, 'VND');
  assert.equal(rows[0].occurred_on, '2026-11-24');
  assert.equal(rows[0].campaign_id, 'camp-live');
  assert.equal(rows[0].activity_id, 'act-live-ads');
  assert.equal(rows[1].direction, 'in');
  assert.equal(rows[1].category, 'Cấp vốn');
});

test('R3.1-EXPORT [unit]: CSV escape dấu phẩy / ngoặc kép / xuống dòng đúng chuẩn (ô được bọc, quote nhân đôi)', () => {
  assert.equal(X.r31CsvCell('a,b'), '"a,b"');
  assert.equal(X.r31CsvCell('nói "xin chào"'), '"nói ""xin chào"""');
  assert.equal(X.r31CsvCell('dòng 1\ndòng 2'), '"dòng 1\ndòng 2"');
  assert.equal(X.r31CsvCell('thường'), 'thường');
  assert.equal(X.r31CsvCell(null), '');
  assert.equal(X.r31CsvCell(140), '140');
  const rows = X.buildKpiExportRows([
    { id: 'kpi-esc', scopeType: 'campaign', campaignId: 'camp-x', name: 'Đăng ký, "hợp lệ"', metricCode: 'valid_registrations', aggregationMode: 'sum', target: 10, actual: 5, unit: 'người', periodKey: '2026-11', definition: { description: 'Đếm "duy nhất", theo khóa; tách dòng\nkhi cần.' } },
  ], { rollups: { 'kpi-esc': { value: 5, status: 'ok' } }, ownerNames: {} });
  const csv = X.r31RowsToCsv(X.KPI_EXPORT_COLUMNS, rows);
  const lines = csv.split('\n');
  assert.equal(lines[0], X.KPI_EXPORT_COLUMNS.join(','));
  assert.ok(csv.includes('"Đăng ký, ""hợp lệ"""'), 'tên KPI chứa phẩy + quote phải được escape: ' + csv);
  assert.ok(csv.includes('"Đếm ""duy nhất"", theo khóa; tách dòng'), 'definition chứa phẩy/quote phải được escape: ' + csv);
  // Dòng ngân sách: tiêu đề fact chứa phẩy vẫn nằm trong 1 ô khi ra CSV.
  const brows = X.buildBudgetExportRows({
    lines: [{ id: 'bl-1', campaignId: 'camp-x', name: 'Ads, đợt 1', currency: 'VND', planned: 100, approved: 90 }],
    commitments: [], actuals: [], allocations: [], summaries: [], lineStats: {},
  });
  const bcsv = X.r31RowsToCsv(X.BUDGET_EXPORT_COLUMNS, brows);
  assert.ok(bcsv.includes('"Ads, đợt 1"'), 'title chứa phẩy phải được bọc quote: ' + bcsv);
});
