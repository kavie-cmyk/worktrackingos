// tests/r31-ui-content.test.mjs
// R3.1 — PHẦN UI CONTENT PLAN (js/app.js + js/demo-data.js), đặc tả C.6/D.4
// AC23–AC30. Tầng kiểm: [static] đọc source js/app.js (IIFE trình duyệt,
// không DOM trong node --test) + [unit] kiểm fixture demo bằng bản sao
// trung thực của thuật toán publication/content-mix mà UI dùng
// (buildPublications / contentMixRows trong app.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const demo = require('../js/demo-data.js');

function section(startMarker, endMarker, fromIndex) {
  const a = src.indexOf(startMarker, fromIndex || 0);
  assert.notEqual(a, -1, 'không thấy điểm bắt đầu: ' + startMarker);
  const b = src.indexOf(endMarker, a);
  assert.notEqual(b, -1, 'không thấy điểm kết thúc: ' + endMarker);
  return src.slice(a, b);
}
const saveStart = src.indexOf('function saveEditor(');

// ---------- 1. Quản lý Content Pillar (C.6.1) ----------
test('R3.1-CONTENT [static]: có tab Quản lý Pillar + editor pillar (mô tả, hướng dẫn phân loại/ví dụ, phạm vi BU, archive giữ ID)', () => {
  assert.match(src, /\['manage', 'Quản lý Pillar'\]/);
  const form = section("case 'pillar': {", "case 'content': {");
  assert.match(form, /F\('name', 'Tên pillar \*', 'text'/);
  assert.match(form, /F\('buProductId', 'Phạm vi Brand \/ BU \/ sản phẩm', 'select'/);
  assert.match(form, /F\('description', 'Mô tả pillar', 'textarea'/);
  assert.match(form, /F\('classificationGuide', 'Hướng dẫn phân loại & ví dụ', 'textarea'/);
  assert.match(form, /giữ nguyên ID và lịch sử phân loại|giữ ID và lịch sử phân loại|ID và lịch sử phân loại của nội dung cũ được giữ nguyên/);
  const save = section("case 'pillar': {", "case 'content': {", saveStart);
  assert.match(save, /sCreate\('contentPillars', plo\)/);
  assert.match(save, /sUpdate\('contentPillars', e\.id, plo\)/);
  // Archive/restore qua Store (archived_at) — không xóa cứng.
  assert.match(src, /data-action="archive-item" data-coll="contentPillars"/);
  assert.match(src, /data-action="restore-item" data-coll="contentPillars"/);
});

test('R3.1-CONTENT [static]: pillar gợi ý chỉ là GỢI Ý (4 mẫu của đặc tả), không tự tạo sẵn, không hardcode cho mọi BU', () => {
  const sug = section('var PILLAR_SUGGESTIONS = [', '];');
  for (const n of ['Kiến thức ngành', 'Giải pháp & sản phẩm', 'Dự án & ứng dụng thực tế', 'Con người & thương hiệu']) {
    assert.ok(sug.includes("name: '" + n + "'"), 'thiếu pillar gợi ý: ' + n);
  }
  assert.doesNotMatch(sug, /sCreate/);
  assert.match(src, /data-action="pillar-suggest"/);
  assert.match(src, /Gợi ý 4 pillar mẫu \(từ đặc tả — bấm để tạo nếu muốn\)/);
  assert.match(src, /không áp một bộ pillar cho mọi BU|không hardcode một bộ pillar cho mọi BU/);
});

// ---------- 2. Form Content item (C.6.1) ----------
test('R3.1-CONTENT [static]: form content có pillar chính, brand/product, angle, mục tiêu, hạn sản xuất, brief/asset, trạng thái', () => {
  const form = section("case 'content': {", "case 'variant': {");
  assert.match(form, /F\('pillarId', 'Pillar chính', 'select'/);
  assert.match(form, /— Chưa chọn pillar \(nằm ở Backlog\) —/);
  assert.match(form, /F\('buProductId', 'Brand \/ BU', 'select'/);
  assert.match(form, /F\('product', 'Sản phẩm', 'select'/);
  assert.match(form, /F\('angle', 'Góc khai thác \(angle\)', 'text'/);
  assert.match(form, /F\('goal', 'Mục tiêu của nội dung', 'textarea'/);
  assert.match(form, /F\('productionDeadline', 'Hạn sản xuất', 'date'/);
  assert.match(form, /F\('assetUrl', 'Link brief \/ asset đính kèm', 'url'/);
  assert.match(form, /F\('editorialStatus', 'Trạng thái', 'select'/);
  assert.match(form, /F\('series', 'Series \/ chuỗi bài \(tùy chọn\)', 'text'/);
  assert.match(form, /F\('audience', 'Đối tượng khán giả \(tùy chọn\)', 'text'/);
  assert.match(form, /F\('sourceContentId', 'Nội dung gốc được dùng lại \(nguồn, tùy chọn\)', 'select'/);
});

test('R3.1-CONTENT [static]: form content phân biệt "Nội dung thường xuyên — không thuộc campaign" với "Chưa chọn"; nhóm Việc liên quan tùy chọn', () => {
  const form = section("case 'content': {", "case 'variant': {");
  assert.match(form, /F\('campaignChoice', 'Quan hệ với campaign', 'select'/);
  assert.ok(form.includes("['unset', 'Chưa chọn']"), 'thiếu lựa chọn Chưa chọn');
  assert.ok(form.includes("['none', 'Nội dung thường xuyên — không thuộc campaign']"), 'thiếu lựa chọn tường minh không thuộc campaign');
  assert.ok(form.includes("['campaign', 'Thuộc campaign"), 'thiếu lựa chọn Thuộc campaign');
  assert.match(form, /Việc liên quan \(tùy chọn — không bắt buộc, không phải quan hệ cha\)/);
  assert.match(form, /F\('activityId', 'Hoạt động liên quan \(Action Plan\)', 'select'/);
  assert.match(form, /F\('taskId', 'Việc liên quan', 'select'/);
  // Lưu từ Content Plan là luồng bình thường + task chỉ tạo khi bấm nút riêng.
  assert.match(form, /Lưu nội dung từ Content Plan là luồng bình thường/);
  assert.match(form, /KHÔNG tự tạo khi Lưu/);
});

test('R3.1-CONTENT [static]: always-on và evergreen là HAI thuộc tính riêng + ngày hết hiệu lực tùy chọn', () => {
  const form = section("case 'content': {", "case 'variant': {");
  assert.match(form, /name="alwaysOn"/);
  assert.match(form, /Always-on — nội dung vận hành thường xuyên/);
  assert.match(form, /name="evergreen"/);
  assert.match(form, /Evergreen — nội dung có giá trị lâu dài/);
  assert.match(form, /F\('expiresAt', 'Ngày hết hiệu lực \(tùy chọn\)', 'date'/);
  assert.match(form, /always-on và evergreen là RIÊNG BIỆT/);
});

test('R3.1-CONTENT [static]: lưu content gửi pillar/campaignChoice/flags/tags/source qua Store; campaign chỉ bắt buộc khi chọn tường minh "Thuộc campaign"; KHÔNG tự tạo task khi Lưu', () => {
  const save = section("case 'content': {", "case 'variant': {", saveStart);
  assert.match(save, /pillarId: data\.pillarId \|\| null/);
  assert.match(save, /campaignId: cChoice === 'campaign' \? data\.campaignId : null, campaignChoice: cChoice/);
  assert.match(save, /cChoice === 'campaign' && !data\.campaignId/);
  assert.match(save, /tags: splitTags\(data\.tags\)/);
  assert.match(save, /sourceContentId: data\.sourceContentId \|\| null/);
  assert.match(save, /activityId: data\.activityId \|\| null, taskId: data\.taskId \|\| null/);
  assert.match(save, /alwaysOn: alwaysEl \? !!alwaysEl\.checked/);
  assert.match(save, /evergreen: everEl \? !!everEl\.checked/);
  assert.doesNotMatch(save, /sCreate\('tasks'/);
});

// ---------- 3. Các view cùng một dữ liệu (C.6.3) ----------
test('R3.1-CONTENT [static]: Content Plan có đủ view Backlog / Theo Pillar / Lịch đăng / Bảng / Board / Thư viện / Mix / Chờ phân loại trên cùng dữ liệu', () => {
  assert.match(src, /\['backlog', 'Backlog \/ Ý tưởng'\], \['pillars', 'Theo Pillar'\], \['calendar', 'Lịch đăng'\], \['table', 'Bảng nội dung'\], \['board', 'Board sản xuất \/ duyệt'\], \['production', 'Tiến độ sản xuất'\], \['library', 'Thư viện đã đăng'\], \['mix', 'Content mix'\], \['queue', 'Chờ phân loại'\], \['manage', 'Quản lý Pillar'\]/);
  // Backlog: chưa có lịch thì KHÔNG gán ngày giả.
  assert.match(src, /Ý tưởng chưa có lịch đăng chỉ nằm ở đây — hệ thống không tự gán ngày hôm nay/);
  assert.match(src, /!pubsOfItem\(x\.id\)\.length && !x\.scheduledDate/);
});

test('R3.1-CONTENT [static]: bộ lọc đủ chiều — brand/product, pillar, campaign (gồm "không thuộc campaign"), kênh/tài khoản, format, owner, trạng thái, khoảng ngày; activity/task là nâng cao', () => {
  const view = section('function viewContent()', '// ---------- Công việc ----------');
  for (const name of ['buProductId', 'product', 'pillarId', 'campaignId', 'platform', 'channelAccountId', 'format', 'ownerId', 'status', 'from', 'to', 'activityId', 'taskId']) {
    assert.ok(view.includes('name="' + name + '"'), 'filter thiếu field: ' + name);
  }
  assert.match(view, /Không thuộc campaign \(nội dung thường xuyên\)/);
  assert.match(view, /Hoạt động \(nâng cao\)/);
  assert.match(view, /Task \(nâng cao\)/);
  const submit = section("if (f.id === 'content-filter-form')", "if (f.id === 'brand-filter-form')");
  assert.match(submit, /pillarId:/);
  assert.match(submit, /channelAccountId:/);
  assert.match(submit, /activityId:/);
});

// ---------- 4. Content mix (C.6.3 / AC28) ----------
test('R3.1-CONTENT [static]: content mix có chọn đơn vị đếm nội dung gốc / lần đăng và ghi rõ mẫu số; tags không cộng ra tổng', () => {
  assert.match(src, /function contentMixRows\(items, pubs, unit\)/);
  assert.match(src, /data-action="content-mix-unit" data-id="content">Nội dung gốc</);
  assert.match(src, /data-action="content-mix-unit" data-id="publication">Lần đăng \(publication\)</);
  assert.match(src, /Mẫu số \(tổng số/);
  assert.match(src, /tỷ trọng theo tags KHÔNG cộng ra tổng/);
  assert.match(src, /Pillar chính tính đúng 1 lần cho 1 nội dung gốc/);
});

// ---------- 5. Publication / lần đăng (C.6.2 / AC26 / AC29) ----------
test('R3.1-CONTENT [static]: buildPublications gộp job + external post cùng variant thành MỘT lần đăng; repost là entry mới', () => {
  assert.match(src, /function buildPublications\(\)/);
  assert.match(src, /if \(j\.variantId && variantsWithPost\[j\.variantId\]\) return; \/\/ job đã thành bài đăng: cùng 1 lần đăng/);
  assert.match(src, /if \(variantsWithPost\[v\.id\] \|\| variantsWithJob\[v\.id\]\) return;/);
  assert.match(src, /Mỗi dòng là MỘT lần đăng\. Đăng lại cùng nội dung tạo một dòng mới riêng/);
  // Campaign hiệu lực của lần đăng: explicit của publication trước, rồi mới kế thừa content.
  assert.match(src, /function effCampaign\(explicit, variant, item\)/);
});

test('R3.1-CONTENT [static]: tạo từ ô ngày chỉ điền lịch cho lần đăng (form variant), không tự gán campaign/action; tab Content của campaign lấy cả qua publication', () => {
  assert.match(src, /openEditor\('variant', null, \{ scheduledAtLocal: id \+ 'T09:00' \}\)/);
  assert.match(src, /tạo từ ô ngày CHỈ điền lịch cho lần đăng đó/);
  const detail = section('function campaignDetailHtml(id)', '// ---------- Nội dung (Content) ----------');
  assert.match(detail, /Qua lần đăng dùng lại/);
  assert.match(detail, /buildPublications\(\)\.filter\(function \(p\) \{ return p\.campaignId === c\.id; \}\)/);
  // Form bài đã đăng: campaign lưu ở LẦN ĐĂNG, không đổi content gốc.
  const postForm = section("case 'post': {", "case 'adcr': {");
  assert.match(postForm, /F\('campaignId', 'Campaign của lần đăng này', 'select'/);
  assert.match(postForm, /campaign của nội dung gốc KHÔNG bị đổi/);
  assert.match(postForm, /F\('contentItemId', 'Nội dung gốc của lần đăng này', 'select'/);
});

// ---------- 6. Hàng đợi phân loại (C.6.4) ----------
test('R3.1-CONTENT [static]: hàng đợi Chờ phân loại cho bài thiếu pillar; không gán campaign giả; đủ phân loại + không campaign là hợp lệ', () => {
  const view = section('function viewContent()', '// ---------- Công việc ----------');
  assert.match(view, /Chờ phân loại \(/);
  assert.match(view, /hệ thống không tự gán pillar và không tạo campaign giả/);
  assert.match(view, /Bài đã đủ pillar nhưng không thuộc campaign là dữ liệu hợp lệ/);
  assert.match(view, /queueItems = items\.filter\(function \(x\) \{ return !contentPillarId\(x\); \}\)/);
});

// ---------- 7. Tạo việc sản xuất theo template — chỉ khi bấm (C.6.4) ----------
test('R3.1-CONTENT [static]: nút Tạo việc sản xuất theo template 4 bước, việc chỉ gắn nội dung (campaign/activity có thể trống)', () => {
  assert.match(src, /var PRODUCTION_TASK_TEMPLATES = \['Viết nội dung', 'Thiết kế \/ sản xuất media', 'Quay \/ dựng', 'Duyệt nội dung'\]/);
  assert.match(src, /data-action="content-prod-tasks"/);
  assert.match(src, /if \(action === 'content-prod-tasks'\) \{ createProductionTasks\(id\); \}/);
  const fn = section('function createProductionTasks(contentId)', '// ---------- Nội dung (Content) ----------');
  assert.match(fn, /sCreate\('tasks', job\)/);
  assert.match(fn, /contentItemId: ci\.id, campaignId: ci\.campaignId \|\| null, activityId: ci\.activityId \|\| null/);
  assert.match(fn, /CHỈ tạo khi người dùng bấm nút này/);
});

// ---------- 8. KPI ratio: tử số / mẫu số nhập từ UI ----------
test('R3.1-CONTENT [static]: form KPI có ô Tử số / Mẫu số cho aggregation_mode=ratio và lưu vào KPI cho rollupKpi', () => {
  const form = section("case 'kpi': {", "case 'measurement': {");
  assert.match(form, /F\('numerator', 'Tử số \(chỉ khi aggregation_mode = ratio\)', 'number'/);
  assert.match(form, /F\('denominator', 'Mẫu số \(chỉ khi aggregation_mode = ratio\)', 'number'/);
  assert.match(form, /rollupKpi tính lại tỷ lệ = tử số \/ mẫu số/);
  const save = section("case 'kpi': {", "case 'measurement': {", saveStart);
  assert.match(save, /numerator: \(data\.numerator === '' \|\| data\.numerator === null \|\| data\.numerator === undefined\) \? null : Number\(data\.numerator\)/);
  assert.match(save, /denominator: \(data\.denominator === '' \|\| data\.denominator === null \|\| data\.denominator === undefined\) \? null : Number\(data\.denominator\)/);
});

// ---------- 9. TikTok giữ nguyên tắc R1/R2 ----------
test('R3.1-CONTENT [static]: TikTok vẫn chỉ script + đăng ngoài app (publishMode external), không tạo PublishJob từ form variant', () => {
  const save = section("case 'variant': {", "case 'kpi': {", saveStart);
  assert.match(save, /vo\.publishMode = 'external'/);
  assert.match(src, /TikTok — sản xuất trong app, đăng ngoài app/);
});

// ---------- 10. Fixture demo (unit) ----------
// Bản sao trung thực của buildPublications cho dữ liệu demo: external post
// là 1 publication; job của variant đã có post bị gộp; variant có lịch mà
// chưa có job/post là 1 publication dự kiến.
function demoPublications() {
  const posts = demo.externalPosts || [];
  const jobs = demo.publishJobs || [];
  const variants = demo.variants || [];
  const withPost = new Set(posts.map((p) => p.variantId).filter(Boolean));
  const withJob = new Set(jobs.map((j) => j.variantId).filter(Boolean));
  const pubs = [];
  posts.forEach((p) => pubs.push({ kind: 'post', id: p.id, contentItemId: p.contentItemId || null, variantId: p.variantId || null, campaignId: p.campaignId || null, url: p.url || '' }));
  jobs.forEach((j) => { if (j.variantId && withPost.has(j.variantId)) return; const v = variants.find((x) => x.id === j.variantId); pubs.push({ kind: 'job', id: j.id, contentItemId: v ? v.contentItemId : null, variantId: j.variantId || null, campaignId: null, url: '' }); });
  variants.forEach((v) => { if (withPost.has(v.id) || withJob.has(v.id) || !v.scheduledAt) return; pubs.push({ kind: 'planned', id: 'planned-' + v.id, contentItemId: v.contentItemId, variantId: v.id, campaignId: null, url: '' }); });
  return pubs;
}
const pubs = demoPublications();
const byId = Object.fromEntries((demo.contentItems || []).map((x) => [x.id, x]));

test('R3.1-FIX [unit] AC23: action "Mời khách mời" của demo livestream không có content nào — action vẫn hợp lệ', () => {
  assert.ok(demo.activities.some((a) => a.id === 'act-live-invite'));
  assert.equal((demo.contentItems || []).filter((x) => x.activityId === 'act-live-invite').length, 0);
});

test('R3.1-FIX [unit] AC24: content thường xuyên có pillar + lịch đăng, campaign/activity trống tường minh', () => {
  const c = byId['content-always-1'];
  assert.ok(c, 'thiếu fixture content-always-1');
  assert.equal(c.pillarId, 'pillar-knowledge');
  assert.equal(c.campaignId, null);
  assert.equal(c.campaignChoice, 'none');
  assert.equal(c.activityId, null);
  assert.equal(c.alwaysOn, true);
  assert.equal(c.evergreen, true);
  assert.ok(pubs.filter((p) => p.contentItemId === c.id).length >= 1, 'content thường xuyên phải có ít nhất 1 lần đăng/lịch đăng');
});

test('R3.1-FIX [unit] AC26: 1 content gốc, 2 variant kênh, 3 publication (có repost) — tiền sản xuất không nhân 3', () => {
  const c = byId['content-multi-1'];
  assert.ok(c);
  assert.equal((demo.contentItems || []).filter((x) => x.id === 'content-multi-1').length, 1, 'content gốc phải là 1');
  assert.equal((demo.variants || []).filter((v) => v.contentItemId === c.id).length, 2, 'phải có 2 variant kênh');
  const mine = pubs.filter((p) => p.contentItemId === c.id);
  assert.equal(mine.length, 3, 'phải có đúng 3 publication');
  assert.equal(new Set(mine.map((p) => p.url)).size, 3, '3 lần đăng có 3 link riêng — repost không ghi đè');
  const uniqueContents = [...new Set(mine.map((p) => p.contentItemId))];
  const prodTotal = uniqueContents.reduce((s, id) => s + (byId[id].productionCost || 0), 0);
  assert.equal(prodTotal, 4000000, 'tiền sản xuất tính 1 lần cho content gốc, không nhân 3 theo lần đăng');
});

test('R3.1-FIX [unit] AC25+AC28: filter pillar thấy cả bài campaign lẫn bài thường xuyên; mix theo pillar chính không tăng vì tags', () => {
  const items = demo.contentItems || [];
  // Pillar Knowledge: bài thường xuyên (không campaign). Pillar Case: bài campaign.
  const byPillar = (pid) => items.filter((x) => x.pillarId === pid);
  assert.ok(byPillar('pillar-knowledge').every((x) => !x.campaignId), 'pillar Knowledge gồm bài không campaign');
  assert.ok(byPillar('pillar-case').every((x) => !!x.campaignId), 'pillar Case gồm bài có campaign');
  // Filter campaign (cấp content) KHÔNG thấy bài thường xuyên cùng pillar.
  assert.ok(!items.filter((x) => x.campaignId === 'camp-live').some((x) => x.id === 'content-always-1'));
  // Mix đơn vị content: tổng theo pillar chính == số content có pillar.
  const withPillar = items.filter((x) => x.pillarId);
  const sumByPillar = [...new Set(withPillar.map((x) => x.pillarId))].reduce((s, pid) => s + byPillar(pid).length, 0);
  assert.equal(sumByPillar, withPillar.length);
  // Ca tags: content-tags-1 có 2 tags + 1 pillar chính -> tính đúng 1 lần.
  const tagged = byId['content-tags-1'];
  assert.equal(tagged.tags.length, 2);
  assert.equal(tagged.pillarId, 'pillar-people');
  assert.equal(byPillar('pillar-people').filter((x) => x.id === tagged.id).length, 1);
  // Mix đơn vị publication: pillar Case có 3 lần đăng dù chỉ 1 content gốc.
  const casePubs = pubs.filter((p) => (byId[p.contentItemId] || {}).pillarId === 'pillar-case');
  assert.equal(casePubs.length, 3);
});

test('R3.1-FIX [unit] AC29: evergreen dùng lại cho campaign khác bằng publication mang campaign riêng — content gốc giữ nguyên', () => {
  const c = byId['content-always-1'];
  assert.equal(c.campaignId, null, 'content gốc vẫn không thuộc campaign');
  assert.equal(c.campaignChoice, 'none');
  const reuse = (demo.externalPosts || []).find((p) => p.id === 'post-evergreen-live');
  assert.ok(reuse, 'thiếu publication dùng lại');
  assert.equal(reuse.contentItemId, c.id);
  assert.equal(reuse.campaignId, 'camp-live', 'campaign nằm ở lần đăng');
  // Nguồn dùng lại truy được: publication trỏ về đúng content gốc.
  assert.equal(reuse.variantId, 'variant-always-fb');
});

test('R3.1-FIX [unit]: fixture hàng đợi phân loại — bài thiếu pillar tồn tại và không bị gán campaign giả', () => {
  const q = byId['content-queue-1'];
  assert.ok(q);
  assert.equal(q.pillarId, null);
  assert.equal(q.campaignId, null);
  assert.equal(q.campaignChoice, 'unset');
  // Pillar demo đủ 4 mẫu gợi ý của đặc tả (ở demo, phạm vi từng BU).
  assert.deepEqual((demo.contentPillars || []).map((p) => p.name), ['Kiến thức ngành', 'Giải pháp & sản phẩm', 'Dự án & ứng dụng thực tế', 'Con người & thương hiệu']);
});
