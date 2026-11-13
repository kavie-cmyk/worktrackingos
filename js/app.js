/*
 * js/app.js — SAVA Marketing Workspace (SPA hash routing, vanilla JS, không build step).
 * Vòng sửa R1 (UI/UX): khung + điều hướng theo entity, CRUD đầy đủ mọi module,
 * Gantt kéo/thả, task detail panel dùng chung, trạng thái tải theo collection.
 * Mọi dữ liệu đi qua window.SAVA_STORE; mọi phép tính qua window.SAVA_DOMAIN.
 * Các hàm Store mới theo contract (loadState, can(action), submitReview, decide,
 * createPublishJob(variant, opts), archive/restore, saveTiktokMetrics) được gọi
 * qua lớp bọc an toàn: chưa có thì dùng API hiện có hoặc khóa CTA kèm lý do.
 */
(function () {
  'use strict';
  var Store = window.SAVA_STORE;
  var D = window.SAVA_DOMAIN;
  var Core = window.SAVA_STORE_CORE || {};

  // ---------- Helper thời gian theo Asia/Ho_Chi_Minh (R2-04, contract StoreCore) ----------
  // Ưu tiên hàm của StoreCore; fallback chỉ để app không vỡ khi core chưa nạp.
  function toDatetimeLocalValue(iso) {
    if (Core && typeof Core.toDatetimeLocalValue === 'function') return Core.toDatetimeLocalValue(iso);
    return iso ? String(iso).slice(0, 16) : '';
  }
  function fromDatetimeLocalValue(value) {
    if (Core && typeof Core.fromDatetimeLocalValue === 'function') return Core.fromDatetimeLocalValue(value);
    return value ? new Date(value).toISOString() : null;
  }
  function dateInTz(iso) {
    if (Core && typeof Core.dateInTz === 'function') return Core.dateInTz(iso);
    return iso ? String(iso).slice(0, 10) : '';
  }
  // custom_fields: trường chưa có cột thật được Store gói vào custom_fields và
  // bung ngược lên top-level khi đọc — đọc cả hai chỗ cho chắc.
  function cfVal(obj, key) {
    if (!obj) return undefined;
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    if (obj.customFields && obj.customFields[key] !== undefined) return obj.customFields[key];
    if (obj.custom_fields && obj.custom_fields[key] !== undefined) return obj.custom_fields[key];
    return undefined;
  }
  function isMilestoneTask(t) { return !!cfVal(t, 'isMilestone'); }
  function baselineVersionsOf(c) {
    var v = cfVal(c, 'baselineVersions');
    return Array.isArray(v) ? v : [];
  }
  function canSetBaseline() {
    var r = Store.currentRole ? Store.currentRole() : '';
    return r === 'owner' || r === 'lead' || can('campaign.edit');
  }
  // Chốt baseline CẢ CÂY (13/11): dựng kế hoạch ghi baseline từ lịch HIỆN TẠI
  // của campaign + mọi phase/activity/task thuộc campaign. Hàm THUẦN (nhận
  // sẵn các danh sách đã lọc theo cây) để test độc lập được. Thực thể đủ cả
  // hai mốc ngày mới có mục ghi; thiếu start hoặc end/due → BỎ QUA (không
  // ghi baseline rỗng) và đếm theo loại. Campaign/phase/activity dùng
  // startDate/endDate → baselineStartDate/baselineEndDate; task dùng
  // startDate/dueDate → baselineStartDate/baselineDueDate (đúng trường mà
  // Gantt và store đang đọc).
  function baselineTreePlan(campaign, phases, activities, tasks) {
    var plan = {
      campaignItem: null,
      items: [],
      skippedByType: { campaign: 0, phase: 0, activity: 0, task: 0 },
      skipped: 0
    };
    function add(type, coll, entity, start, end, endKey) {
      if (!entity) return;
      if (!start || !end) { plan.skippedByType[type] += 1; plan.skipped += 1; return; }
      var patch = { baselineStartDate: start };
      patch[endKey] = end;
      var item = { type: type, coll: coll, id: entity.id, patch: patch };
      if (type === 'campaign') plan.campaignItem = item; else plan.items.push(item);
    }
    add('campaign', 'campaigns', campaign, campaign && campaign.startDate, campaign && campaign.endDate, 'baselineEndDate');
    (phases || []).forEach(function (p) { add('phase', 'phases', p, p.startDate, p.endDate, 'baselineEndDate'); });
    (activities || []).forEach(function (a) { add('activity', 'activities', a, a.startDate, a.endDate, 'baselineEndDate'); });
    (tasks || []).forEach(function (t) { add('task', 'tasks', t, t.startDate, t.dueDate, 'baselineDueDate'); });
    return plan;
  }
  // Tóm tắt phạm vi của một entry baselineVersions: entry CŨ (trước đợt
  // chốt-cả-cây) không có counts → trả '' để nơi hiển thị giữ nguyên như cũ.
  function baselineVersionStatsText(bv) {
    if (!bv || !bv.counts) return '';
    var total = (bv.counts.campaign || 0) + (bv.counts.phase || 0) + (bv.counts.activity || 0) + (bv.counts.task || 0);
    var s = 'đã chốt ' + total + ' mục';
    if (bv.skipped) s += ' · bỏ qua ' + bv.skipped + ' mục chưa có lịch';
    if (bv.failed) s += ' · lỗi ' + bv.failed + ' mục';
    return s;
  }

  var NAV_GROUPS = [
    ['Chung', [['overview', 'Overview'], ['my-work', 'Task của tôi']]],
    ['Kế hoạch & content', [['campaigns', 'IMC & Campaigns'], ['timeline', 'Timeline'], ['content', 'Content'], ['tasks', 'Task'], ['approvals', 'Duyệt content']]],
    ['Thương hiệu', [['brand', 'Brand Hub']]],
    ['Hiệu quả', [['kpi', 'KPI & Ngân sách'], ['channels', 'Kênh & Post'], ['ads', 'Quảng cáo'], ['reports', 'Báo cáo']]],
    ['Tổ chức', [['team', 'Team & Workload'], ['settings', 'Thiết lập']]]
  ];
  var ROUTES = ['overview', 'my-work', 'brand', 'campaigns', 'timeline', 'content', 'tasks', 'approvals', 'team', 'kpi', 'channels', 'ads', 'reports', 'settings'];

  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var diff = (x.getDay() + 6) % 7; x.setDate(x.getDate() - diff); return x; }
  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var NOW = new Date();

  var UI = {
    booted: false,
    lastBase: null,
    scrollMem: {},
    campaignTab: 'overview',
    contentTab: 'calendar',
    brandTab: 'pages',
    brandQuery: '',
    brandOpenId: null,
    postOpenId: null,
    kpiOpenId: null,
    calYear: NOW.getFullYear(),
    calMonth: NOW.getMonth(),
    channelFilter: 'all',
    adsLevel: 'campaign',
    report: { view: 'perf', level: 'campaign', accountId: 'all', campaignId: 'all', from: '', to: '' },
    reportRowsCache: [],
    teamWeek: isoOf(mondayOf(NOW)),
    ganttScale: 'week',
    ganttCollapsed: {},
    ganttPreview: null,
    ganttRange: { from: '', to: '' },
    ganttSaving: false,
    ganttError: null,
    taskDraft: null,
    taskDraftConflict: false,
    taskFilter: { campaignId: 'all', ownerId: 'all', status: 'all', priority: 'all', due: 'all', blocked: 'all', unassigned: false },
    timelineMode: 'tree',
    timelineFilter: { campaignId: 'all', ownerId: 'all', status: 'all' },
    taskTimelineGroupBy: 'campaign',
    contentFilter: { campaignId: 'all', platform: 'all', ownerId: 'all', status: 'all', pillarId: 'all', buProductId: 'all', product: 'all', format: 'all', channelAccountId: 'all', activityId: 'all', taskId: 'all', from: '', to: '' },
    contentMixUnit: 'content',
    brandFilter: { ownerId: 'all', status: 'all', type: 'all' },
    approvalsTab: 'mine',
    actionGroupBy: 'phase',
    activityDrawerId: null,
    activityTab: 'overview',
    confirmClose: null,
    editor: null,
    editorSubmitting: false,
    lastFocusEl: null,
    taskPanelId: null,
    taskPanelReturnHash: null,
    pendingDatePreview: null,
    approveComment: {},
    budgetProposalNote: {},
    kpiSection: 'kpi',
    portfolioGanttOpen: false
  };

  // ---------- Nhãn trạng thái tiếng Việt (không lộ mã nội bộ) ----------
  var STATUS_LABELS = {
    todo: 'Chưa bắt đầu', not_started: 'Chưa bắt đầu', in_progress: 'Đang làm', in_review: 'Đang chờ duyệt',
    ready_for_review: 'Đang chờ duyệt', completed: 'Hoàn thành', complete: 'Hoàn thành', done: 'Hoàn thành',
    cancelled: 'Đã hủy', canceled: 'Đã hủy', draft: 'Nháp', editing: 'Đang soạn',
    active: 'Đang chạy', planning: 'Đang chuẩn bị', paused: 'Tạm dừng', scheduled: 'Đã lên lịch',
    pending: 'Chờ duyệt', pending_approval: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Đã từ chối',
    changes_requested: 'Yêu cầu sửa', needs_reapproval: 'Cần duyệt lại', needs_review: 'Cần duyệt lại',
    open: 'Đang mở', resolved: 'Đã gỡ', settled: 'Đã thanh toán', partial: 'Thanh toán một phần',
    partially_actualised: 'Thanh toán một phần', converted: 'Đã chuyển thành task',
    new: 'Mới ghi nhận', accepted: 'Đã tiếp nhận', final: 'Bản chốt', published: 'Đã đăng',
    archived: 'Đã lưu trữ', submitted: 'Đã gửi duyệt', executed: 'Đã áp dụng', closed: 'Đã đóng'
  };
  function labelStatus(s) {
    if (s === null || s === undefined || s === '') return '—';
    var k = String(s).toLowerCase();
    if (STATUS_LABELS[k]) return STATUS_LABELS[k];
    if (/^[A-ZÀ-Ỹ]/.test(String(s)) && !/_/.test(String(s))) return String(s); // nhãn đã là tiếng Việt/chuẩn
    return String(s).replace(/_/g, ' ');
  }
  var CAMPAIGN_STATUSES = [['draft', 'Nháp'], ['planning', 'Đang chuẩn bị'], ['active', 'Đang chạy'], ['paused', 'Tạm dừng'], ['completed', 'Đã kết thúc'], ['archived', 'Đã lưu trữ']];
  var TASK_STATUSES = [['todo', 'Chưa bắt đầu'], ['in_progress', 'Đang làm'], ['in_review', 'Đang chờ duyệt'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã hủy']];
  var EDITORIAL_STATUSES = [['draft', 'Nháp'], ['in_review', 'Đang chờ duyệt'], ['approved', 'Đã duyệt'], ['scheduled', 'Đã lên lịch']];
  var BRAND_STATUSES = [['Draft', 'Bản nháp'], ['Approved', 'Đã duyệt'], ['Archived', 'Lưu trữ']];
  var PRIORITIES = ['Thấp', 'Trung bình', 'Cao', 'Khẩn cấp'];
  var PLATFORMS = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['website', 'Website'], ['other', 'Kênh khác']];
  // R3.1 C.6.1: 4 pillar GỢI Ý của đặc tả — chỉ hiện khi workspace CHƯA có
  // pillar nào; người dùng bấm vào gợi ý thì form tạo mới mở ra đã điền sẵn
  // để xem/sửa rồi mới Lưu. App KHÔNG tự tạo sẵn và KHÔNG áp cho mọi BU.
  var PILLAR_SUGGESTIONS = [
    { name: 'Kiến thức ngành', description: 'Nội dung giải thích khái niệm, xu hướng và kiến thức nền của ngành.', guide: 'Phân loại khi bài chủ yếu giúp người đọc hiểu một chủ đề của ngành. Ví dụ: giải thích một ứng dụng VR trong đào tạo.' },
    { name: 'Giải pháp & sản phẩm', description: 'Nội dung giới thiệu giải pháp, tính năng và cách sản phẩm giải quyết vấn đề.', guide: 'Phân loại khi bài tập trung vào giải pháp/sản phẩm cụ thể. Ví dụ: bài mời tham gia buổi giới thiệu giải pháp.' },
    { name: 'Dự án & ứng dụng thực tế', description: 'Case study, dự án đã triển khai và kết quả thực tế được phép công bố.', guide: 'Phân loại khi bài kể một dự án/ứng dụng có thật. Ví dụ: case study một dự án đã được phép công bố.' },
    { name: 'Con người & thương hiệu', description: 'Con người, văn hóa đội ngũ và câu chuyện thương hiệu.', guide: 'Phân loại khi bài tập trung vào con người/thương hiệu thay vì sản phẩm. Ví dụ: hậu trường đội ngũ thực hiện dự án.' }
  ];

  // ---------- Tiện ích hiển thị ----------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function memberName(id) { var m = Store.get('members', id); return m ? m.name : (id ? '—' : 'Chưa phân công'); }
  function campaignName(id) { if (!id) return '— (độc lập)'; var c = Store.get('campaigns', id); return c ? c.name : '—'; }
  function taskById(id) { return Store.get('tasks', id); }
  function contentTitle(id) { var x = Store.get('contentItems', id); return x ? x.title : '—'; }
  function fmtMoney(n, currency) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString('vi-VN') + ' ' + esc(currency || '');
  }
  function fmtNum(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
  // Bucket tiền tệ thiếu của aggregateRates là '__unknown' (và currency
  // thiếu là null/''): hiển thị nhãn người đọc, không in '__unknown' thô
  // và không gán bừa 'VND'.
  function currencyLabel(cur) { return (!cur || String(cur).trim() === '' || cur === '__unknown') ? 'Chưa rõ tiền tệ' : cur; }
  function todayISO() { return isoOf(new Date()); }
  function addDaysISO(iso, n) { if (!iso) return ''; var d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); }
  function isOverdue(t) {
    if (!t.dueDate) return false;
    var s = String(t.status || '').toLowerCase();
    return String(t.dueDate).slice(0, 10) < todayISO() && s !== 'completed' && s !== 'done' && s !== 'cancelled';
  }
  function isCompletedTask(t) { var s = String((t && t.status) || '').toLowerCase(); return s === 'completed' || s === 'done' || s === 'complete'; }
  // WAVE-A-VIZ2: statusBadge là alias tương thích của vizStatusPillHtml —
  // mọi pill trạng thái toàn app ra đúng tông chuẩn duy nhất (SPEC §2.3).
  function statusBadge(status, label) {
    return vizStatusPillHtml(status, { label: label });
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 5200);
  }
  function demoBanner() { var b = document.getElementById('demo-banner'); if (b) b.hidden = Store.mode !== 'demo'; }
  function readiness(t) {
    var r = D.taskReadiness(t.id, Store.list('tasks'), Store.list('dependencies'));
    return r;
  }
  function readinessBadge(task) {
    var r = readiness(task);
    if (r.ready) return vizStatusPillHtml('done', { label: 'Sẵn sàng' });
    var names = r.pendingPredecessors.map(function (id) { var t = taskById(id); return t ? t.title : id; }).join(', ');
    return vizStatusPillHtml('pending', { label: 'Đang chờ: ' + names });
  }
  function pageHead(title, sub, actions) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' +
      (actions ? '<div class="page-actions">' + actions + '</div>' : '') + '</div>';
  }
  // tbl(inner, key): key (tuỳ chọn) là định danh bảng cho tính năng kéo
  // rộng cột kiểu Excel (js/col-resize.js) — có key mới được resize, mọi
  // bảng không truyền key giữ nguyên hành vi cũ. Điểm chạm DUY NHẤT của
  // tính năng đó vào helper chung này.
  function tbl(inner, key) { return '<div class="table-wrap"><table' + (key ? ' data-table-key="' + esc(key) + '"' : '') + '>' + inner + '</table></div>'; }
  function tabsHtml(list, active, action) {
    return '<div class="tabs" role="tablist">' + list.map(function (x) {
      return '<button type="button" class="tab' + (x[0] === active ? ' active' : '') + '" data-action="' + action + '" data-id="' + esc(x[0]) + '" role="tab" aria-selected="' + (x[0] === active ? 'true' : 'false') + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }
  function emptyState(title, desc, cta) {
    return '<div class="state-box"><p><strong>' + esc(title) + '</strong></p>' + (desc ? '<p>' + esc(desc) + '</p>' : '') + (cta || '') + '</div>';
  }
  function setupNotice() {
    return pageHead('Chờ kết nối Supabase', 'Workspace chưa có dữ liệu thật.') +
      '<div class="state-box"><p><strong>Chờ kết nối Supabase</strong></p>' +
      '<p>App chưa được cấu hình Supabase và chế độ dữ liệu minh họa chưa bật.</p>' +
      '<p>Vào mục <a href="#/settings">Thiết lập</a> để xem hướng dẫn kết nối, hoặc bật chế độ dữ liệu minh họa để xem thử giao diện.</p></div>';
  }

  // ---------- Quyền (CEO chỉ xem ở cả demo lẫn thật) ----------
  function can(perm) { try { return Store.can ? !!Store.can(perm) : true; } catch (e) { return false; } }
  function canEdit() { return can('edit'); }
  function canApprove() { return can('approve'); }
  function canBudget() { return can('budget'); }
  function canBudgetChange() { return can('budgetChange') || can('budget'); }
  function canPublish() { return can('publish'); }

  // ---------- 0014 UI: chuỗi duyệt ngân sách (đề xuất → Owner duyệt → fact chờ duyệt) ----------
  // Hàm map lỗi DÙNG CHUNG cho cả 3 luồng quyết định (đề xuất ngân sách /
  // cam kết / khoản chi): store/RPC trả error bắt đầu bằng tiền tố ổn định,
  // UI chỉ dịch theo tiền tố — không đoán theo nội dung lỗi tự do.
  function budgetApprovalErrorMessage(error, context) {
    var msg = '';
    if (error && typeof error === 'object') msg = String(error.error || error.message || '');
    else msg = String(error || '');
    if (/^FORBIDDEN_ROLE\b/.test(msg)) return context === 'proposal' ? 'Chỉ Owner được duyệt ngân sách' : 'Bạn không có quyền duyệt mục này';
    if (/^ALREADY_DECIDED\b/.test(msg)) return 'Khoản này đã được quyết định trước đó';
    if (/^SELF_APPROVAL\b/.test(msg)) return 'Không được tự duyệt khoản do mình tạo';
    if (/^BUDGET_NOT_APPROVED\b/.test(msg)) return 'Khoản ngân sách chưa được duyệt';
    if (/^BUDGET_LIMIT_EXCEEDED\b/.test(msg)) return 'Vượt số đã duyệt';
    if (/^STALE_REVISION\b/.test(msg)) return 'Đề xuất đã thay đổi, hãy tải lại';
    if (/^CURRENCY_MISMATCH\b/.test(msg)) return 'Khác tiền tệ với khoản ngân sách';
    return msg || 'Thao tác thất bại.';
  }
  function budgetProposalChange(current, proposed) {
    var cur = (current === null || current === undefined || current === '' || isNaN(Number(current))) ? null : Number(current);
    var prop = (proposed === null || proposed === undefined || proposed === '' || isNaN(Number(proposed))) ? null : Number(proposed);
    if (prop === null) return { current: cur, proposed: prop, diff: null, pct: null };
    if (cur === null) return { current: cur, proposed: prop, diff: null, pct: null };
    var diff = prop - cur;
    var pct = cur === 0 ? null : Math.round(diff / Math.abs(cur) * 10000) / 100;
    return { current: cur, proposed: prop, diff: diff, pct: pct };
  }
  function budgetLineApprovedAmount(line) {
    if (!line) return 0;
    var v = (line.approved !== null && line.approved !== undefined) ? line.approved : (line.approvedAmount !== null && line.approvedAmount !== undefined ? line.approvedAmount : line.approved_amount);
    return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? 0 : Number(v);
  }
  function budgetLineApprovalBlockHtml(line) {
    var amt = budgetLineApprovedAmount(line);
    var cur = line ? (line.currency || 'VND') : 'VND';
    if (line && (line.approvedBy || line.approved_by)) {
      return '<p class="sub" style="margin:2px 0"><strong>Đã duyệt ' + fmtMoney(amt, cur) + ' · ' + esc(memberName(line.approvedBy || line.approved_by)) + ' · ' + esc(D.formatDateVN(line.approvedAt || line.approved_at)) + '</strong></p>';
    }
    return '<p class="sub" style="margin:2px 0"><strong>Chưa được duyệt</strong> — số đã duyệt hiện tại: ' + fmtMoney(amt, cur) + '. Số duyệt chỉ thay đổi khi một đề xuất ngân sách được Owner duyệt.</p>';
  }
  function budgetLineApprovedCellHtml(line) {
    var cur = line ? (line.currency || 'VND') : 'VND';
    var amt = budgetLineApprovedAmount(line);
    if (line && (line.approvedBy || line.approved_by)) {
      return fmtMoney(amt, cur) + '<br><span class="sub">' + esc(memberName(line.approvedBy || line.approved_by)) + ' · ' + esc(D.formatDateVN(line.approvedAt || line.approved_at)) + '</span>';
    }
    return fmtMoney(amt, cur) + '<br><span class="sub">Chưa được duyệt</span>';
  }
  function approvalStampLineHtml(obj) {
    if (obj && (obj.approvedBy || obj.approved_by)) {
      return '<span class="sub">Đã duyệt bởi ' + esc(memberName(obj.approvedBy || obj.approved_by)) + ' · ' + esc(D.formatDateVN(obj.approvedAt || obj.approved_at)) + '</span>';
    }
    return '<span class="sub">Chưa được duyệt</span>';
  }
  function campaignCeilingApprovalHtml(camp) {
    if (camp && (camp.approvedBy || camp.approved_by)) {
      return '<span class="sub">Đã duyệt bởi ' + esc(memberName(camp.approvedBy || camp.approved_by)) + ' · ' + esc(D.formatDateVN(camp.approvedAt || camp.approved_at)) + '</span>';
    }
    return '<span class="sub">Hạn mức chưa được duyệt</span>';
  }
  function factApprovalStatusOf(fact) {
    if (!fact) return 'approved';
    var st = null;
    if (D && typeof D.factApprovalStatus === 'function') st = D.factApprovalStatus(fact);
    if (st === null || st === undefined || st === '') st = fact.approvalStatus || fact.approval_status || null;
    if (st === null || st === undefined || st === '') return 'approved';
    return String(st).toLowerCase();
  }
  function factApprovalPillHtml(fact) {
    var st = factApprovalStatusOf(fact);
    return vizStatusPillHtml(st, { label: labelStatus(st) });
  }
  // Tiền kiểm phía UI cho fact chờ duyệt: trả '' khi duyệt được, hoặc lý do
  // disable HIỂN THỊ NGAY TẠI CHỖ. Trần kiểm bằng Domain.budgetUsageTotal
  // với chính fact đang xét được tính như đã duyệt (đúng công thức RPC).
  function budgetFactBlockReason(fact, kind) {
    if (!fact) return '';
    var lineId = fact.budgetLineId || fact.budget_line_id || null;
    var line = lineId ? Store.get('budgetLines', lineId) : null;
    if (!line) return '';
    if (!(line.approvedBy || line.approved_by)) return 'Khoản ngân sách chưa được duyệt';
    if (!D || typeof D.budgetUsageTotal !== 'function') return '';
    try {
      var byLine = function (x) { return String(x.budgetLineId || x.budget_line_id || '') === String(line.id); };
      var commitments = Store.list('commitments').filter(byLine);
      var actuals = Store.list('actuals').filter(byLine);
      if (kind === 'commitment') {
        commitments = commitments.map(function (x) { return x.id === fact.id ? Object.assign({}, x, { approvalStatus: 'approved' }) : x; });
      } else {
        actuals = actuals.map(function (x) { return x.id === fact.id ? Object.assign({}, x, { approvalStatus: 'approved' }) : x; });
      }
      var usage = D.budgetUsageTotal(line, commitments, actuals);
      if (usage !== null && usage !== undefined && Number(usage) > budgetLineApprovedAmount(line)) return 'Vượt số đã duyệt';
    } catch (e) { return ''; }
    return '';
  }
  function factApprovalControlsHtml(fact, kind) {
    var st = factApprovalStatusOf(fact);
    var html = factApprovalPillHtml(fact);
    if (st !== 'pending') return html;
    if (!can('approval.decide')) return html;
    var reason = budgetFactBlockReason(fact, kind);
    var disAttr = reason ? ' disabled title="' + esc(reason) + '"' : '';
    html += ' <span class="budget-fact-decide"><button type="button" class="btn small" data-action="budget-fact-decide" data-kind="' + esc(kind) + '" data-decision="approved" data-id="' + esc(fact.id) + '"' + disAttr + '>Duyệt</button> ' +
      '<button type="button" class="btn small secondary" data-action="budget-fact-decide" data-kind="' + esc(kind) + '" data-decision="rejected" data-id="' + esc(fact.id) + '"' + disAttr + '>Từ chối</button>' +
      (reason ? '<br><span class="sub budget-approval-block-reason">' + esc(reason) + '</span>' : '') + '</span>';
    return html;
  }
  function budgetProposalCurrentValue(p) {
    if (!p) return null;
    if ((p.targetType || p.target_type) === 'budget_line') {
      var line = Store.get('budgetLines', p.budgetLineId || p.budget_line_id);
      return line ? budgetLineApprovedAmount(line) : null;
    }
    var camp = Store.get('campaigns', p.campaignId || p.campaign_id);
    var ceil = camp ? campaignCeilingValue(camp) : null;
    return ceil ? ceil.amount : null;
  }
  function budgetProposalTargetLabel(p) {
    if (!p) return '—';
    var campName = campaignName(p.campaignId || p.campaign_id);
    if ((p.targetType || p.target_type) === 'budget_line') {
      var line = Store.get('budgetLines', p.budgetLineId || p.budget_line_id);
      return 'Dòng ngân sách: ' + (line ? line.name : (p.budgetLineId || p.budget_line_id || '—')) + ' — ' + campName;
    }
    return 'Hạn mức campaign: ' + campName;
  }
  function budgetProposalDeltaHtml(p) {
    var cur = budgetProposalCurrentValue(p);
    var prop = (p.proposedAmount !== null && p.proposedAmount !== undefined) ? p.proposedAmount : p.proposed_amount;
    var ch = budgetProposalChange(cur, prop);
    var curText = cur === null ? 'chưa có' : fmtMoney(cur, p.currency);
    var pctText = ch.pct === null ? (cur === null ? 'chưa có số hiện tại' : 'từ 0') : ((ch.pct > 0 ? '+' : '') + fmtPct(ch.pct));
    var max = Math.max(Math.abs(Number(cur) || 0), Math.abs(Number(prop) || 0));
    return '<span class="budget-proposal-delta">Hiện tại: <strong>' + esc(curText) + '</strong> → Đề xuất: <strong>' + fmtMoney(prop, p.currency) + '</strong> (' + esc(pctText) + ')</span>' +
      vizHBarHtml({ label: 'Đề xuất so với hiện tại', value: Number(prop) || 0, max: max > 0 ? max : null, valueText: fmtMoney(prop, p.currency) + ' (' + pctText + ')' });
  }
  function budgetProposalsQueueHtml() {
    var proposals = [];
    try { proposals = Store.list('budgetProposals') || []; } catch (e) { proposals = []; }
    var canDecideBudget = can('budget.decide');
    var html = '<div data-budget-queue="budget"><h2>Hàng đợi ngân sách (' + proposals.length + ')</h2>';
    if (!proposals.length) {
      html += '<div class="state-box">Chưa có đề xuất ngân sách nào. Dùng nút "Đề xuất ngân sách" ở màn KPI &amp; Ngân sách, trong form dòng ngân sách, hoặc ở khối hạn mức của campaign để tạo đề xuất.</div>';
      return html + '</div>';
    }
    html += proposals.map(function (p) {
      var st = String(p.status || 'pending').toLowerCase();
      var out = '<div class="panel" data-budget-proposal="' + esc(p.id) + '"><strong>' + esc(budgetProposalTargetLabel(p)) + '</strong> ' + vizStatusPillHtml(st, { label: labelStatus(st) }) +
        '<br>' + budgetProposalDeltaHtml(p) +
        '<br><span class="sub">Người đề xuất: ' + esc(memberName(p.proposerId || p.proposer_id)) + (p.reason ? ' · Lý do: ' + esc(p.reason) : '') + '</span>';
      if (st !== 'pending' && (p.decidedBy || p.decided_by)) {
        out += '<br><span class="sub">Đã quyết bởi ' + esc(memberName(p.decidedBy || p.decided_by)) + ' · ' + esc(D.formatDateVN(p.decidedAt || p.decided_at)) + (p.decisionNote || p.decision_note ? ' · ' + esc(p.decisionNote || p.decision_note) : '') + '</span>';
      }
      if (st === 'pending' && canDecideBudget) {
        out += '<label class="fld wide">Ghi chú khi quyết định<textarea id="budget-proposal-note-' + esc(p.id) + '" rows="2" placeholder="Ghi chú khi duyệt / từ chối (không bắt buộc)">' + esc(UI.budgetProposalNote[p.id] || '') + '</textarea></label>' +
          '<p><button type="button" class="btn" data-action="budget-proposal-decide" data-decision="approved" data-id="' + esc(p.id) + '">Duyệt</button> ' +
          '<button type="button" class="btn secondary" data-action="budget-proposal-decide" data-decision="rejected" data-id="' + esc(p.id) + '">Từ chối</button></p>';
      } else if (st === 'pending') {
        out += '<br><span class="sub">Chỉ Owner được duyệt ngân sách — vai trò hiện tại chỉ xem trạng thái.</span>';
      }
      return out + '</div>';
    }).join('');
    return html + '</div>';
  }
  // R2-30.6: bản duyệt đang chờ MÌNH quyết định.
  function isWaitingForMe(a, me) {
    if (!a || (a.status !== 'pending' && a.status !== 'needs_reapproval')) return false;
    if (a.approverId) return !!me && a.approverId === me.id;
    return canApprove();
  }
  // Quyền sửa task theo đúng action mà Store dùng (store.js _actionFor:
  // sửa trường thường = 'task.edit', đổi riêng trạng thái = 'task.updateStatus').
  function canEditTask() { return can('task.edit'); }
  function canUpdateTaskStatus() { return can('task.updateStatus'); }
  // Chỉ-đọc hoàn toàn khi không có CẢ hai quyền trên (vd CEO).
  function taskPanelReadonly() { return !canEditTask() && !canUpdateTaskStatus(); }
  function taskReadonlyNote() {
    if (!taskPanelReadonly()) return '';
    return '<div class="notice info" role="note">Bạn đang xem ở chế độ chỉ đọc — vai trò hiện tại' +
      (Store.currentRole ? ' (' + esc(labelStatus(Store.currentRole())) + ')' : '') +
      ' không có quyền sửa task, nên mọi ô nhập, mục checklist và quan hệ phụ thuộc đã bị khóa. Dữ liệu vẫn được tầng dữ liệu chặn khi lưu.</div>';
  }
  // Điểm vào chung cho modal sửa (formShell): kind nào là chỉ-đọc theo quyền.
  function editorReadonly(kind) {
    if (kind === 'campaign') return !can('campaign.edit');
    if (kind === 'task') return !canEditTask() && !canUpdateTaskStatus();
    return false;
  }
  function readonlyFormNote(kind) {
    return '<div class="notice info" role="note">Bạn đang xem ở chế độ chỉ đọc — vai trò hiện tại' +
      (Store.currentRole ? ' (' + esc(labelStatus(Store.currentRole())) + ')' : '') +
      ' không có quyền sửa ' + (kind === 'campaign' ? 'campaign' : 'bản ghi này') + ', nên mọi ô nhập đã bị khóa.</div>';
  }
  function readonlyNote() {
    if (canEdit()) return '';
    return '<div class="notice info">Vai trò hiện tại (' + esc(labelStatus(Store.currentRole ? Store.currentRole() : '')) + ') chỉ xem — các thao tác tạo/sửa đã bị khóa.</div>';
  }
  function dis(flag) { return flag ? ' disabled' : ''; }
  // R2-30.4: chỉ gắn tooltip khi control THẬT SỰ bị disabled.
  function noEditTitle(disabled) { return disabled ? ' title="Vai trò hiện tại chỉ xem, không sửa được"' : ''; }
  function statusOnlyTitle(disabled) { return disabled ? ' title="Vai trò hiện tại chỉ đổi được trạng thái"' : ''; }

  // ---------- Lớp bọc an toàn quanh Store (contract mới + API hiện có) ----------
  function hasFn(name) { return typeof Store[name] === 'function'; }
  function sCreate(coll, obj) {
    if (!hasFn('create')) return { ok: false, error: 'Tầng dữ liệu chưa hỗ trợ tạo bản ghi.' };
    return Store.create(coll, obj);
  }
  function sUpdate(coll, id, patch) {
    if (coll === 'variants' && hasFn('updateVariant')) return Store.updateVariant(id, patch);
    if (!hasFn('update')) return { ok: false, error: 'Tầng dữ liệu chưa hỗ trợ sửa bản ghi.' };
    return Store.update(coll, id, patch);
  }
  function sArchive(coll, id) {
    if (hasFn('archive')) return Store.archive(coll, id);
    // Store hiện hành: remove() chính là thao tác lưu trữ (archive) cho các
    // bảng có archived_at — khôi phục bằng Store.restore().
    if (hasFn('remove')) return Store.remove(coll, id);
    return sUpdate(coll, id, { archivedAt: new Date().toISOString(), archived: true });
  }
  function sRestore(coll, id) {
    if (hasFn('restore')) return Store.restore(coll, id);
    return sUpdate(coll, id, { archivedAt: null, archived: false });
  }
  function isArchived(x) { return !!(x && (x.archivedAt || x.archived || String(x.status || '').toLowerCase() === 'archived')); }
  function visibleList(coll) { return Store.list(coll).filter(function (x) { return !isArchived(x); }); }
  function archivedList(coll) {
    // Store.list mặc định đã lọc archivedAt — muốn xem mục đã lưu trữ phải xin gồm cả archived.
    var all;
    try { all = Store.list(coll, { includeArchived: true }); } catch (e) { all = Store.list(coll); }
    return all.filter(isArchived);
  }
  function canSettings() { return can('settings.manage'); }
  function canMemberManage() { return can('member.manage'); }
  function brandStatusInfo(item) {
    // Dữ liệu thật tách trạng thái duyệt (approvalStatus) khỏi trạng thái sử dụng (status);
    // dữ liệu demo gộp cả hai vào status kiểu cũ — hiển thị đúng cả hai trường hợp.
    if (item.approvalStatus) {
      var map = { draft: ['draft', 'Bản nháp'], in_review: ['in_review', 'Đang chờ duyệt'], approved: ['approved', 'Đã duyệt'], rejected: ['rejected', 'Bị từ chối'] };
      var m = map[String(item.approvalStatus).toLowerCase()] || ['draft', labelStatus(item.approvalStatus)];
      return { status: m[0], label: m[1] + (String(item.status) === 'archived' ? ' · Đã lưu trữ' : '') };
    }
    return { status: item.status === 'Approved' ? 'approved' : (item.status === 'Archived' ? 'archived' : 'draft'), label: item.status === 'Approved' ? 'Đã duyệt' : (item.status === 'Archived' ? 'Lưu trữ' : 'Bản nháp') };
  }
  function submitReviewCall(variantId) {
    if (hasFn('submitReview')) return Store.submitReview(variantId);
    var v = Store.get('variants', variantId);
    if (!v) return { ok: false, error: 'Không tìm thấy phiên bản content.' };
    var created = sCreate('approvals', {
      variantId: variantId, contentItemId: v.contentItemId, revision: v.revision || 1,
      status: 'pending', statusLabel: 'Chờ duyệt', requestedBy: Store.currentUserId,
      requestedAt: new Date().toISOString(), note: ''
    });
    if (created && created.ok === false) return created;
    var upd = sUpdate('variants', variantId, { approvalStatus: 'pending', editorialStatus: 'in_review' });
    if (upd && upd.ok === false) return upd;
    return { ok: true, item: created && created.item };
  }
  function revisionRecordFor(a) {
    var list = [];
    try { list = Store.list('contentRevisions'); } catch (e) { list = []; }
    if (!list.length) return null;
    return list.find(function (r) {
      return (a.revisionId && r.id === a.revisionId) || (r.variantId === a.variantId && (r.revision_no === a.revision || r.revisionNo === a.revision));
    }) || null;
  }
  function decideCall(a, decision, comment) {
    var rev = revisionRecordFor(a);
    var revisionId = a.revisionId || (rev && rev.id) || a.revision;
    if (hasFn('decide')) return Store.decide(a.id, revisionId, decision, comment);
    if (hasFn('decideApproval')) return Store.decideApproval(a.id, decision, comment);
    return { ok: false, error: 'Chức năng quyết định duyệt chưa sẵn sàng — hãy thử lại sau.' };
  }
  function publishCall(v, decisionId) {
    if (!hasFn('createPublishJob')) return { ok: false, error: 'Chức năng tạo lịch đăng chưa sẵn sàng — hãy thử lại sau.' };
    var opts = { accountId: v.channelAccountId || null, scheduledAt: v.scheduledAt || null, decisionId: decisionId || null };
    if (!decisionId && Store.createPublishJob.length <= 1) {
      // Bản cũ không yêu cầu decisionId — vẫn gọi được.
      return Store.createPublishJob(v);
    }
    if (!decisionId) return { ok: false, error: 'Thiếu quyết định duyệt cho phiên bản này nên chưa tạo lịch đăng được (cần quyết định duyệt đã ghi).' };
    return Store.createPublishJob(v, opts);
  }
  function saveTiktokMetricsCall(variantId, metrics, source) {
    if (hasFn('saveTiktokMetrics')) {
      // Dữ liệu thật: mã nguồn ghi nhận chỉ nhận 'manual'/'import' theo policy;
      // nguồn chi tiết người dùng nhập vẫn giữ ở chế độ demo và trong ghi chú form.
      var src = Store.mode === 'supabase' ? 'manual' : (source || 'manual');
      return Store.saveTiktokMetrics(variantId, metrics, src);
    }
    // Fallback: ghi observation nội bộ gắn ĐÚNG variant, không đoán bài đầu tiên.
    return sCreate('manualMetricEntries', {
      variantId: variantId, metric: metrics.metric, value: metrics.value,
      source: source, observedAt: metrics.observedAt, enteredBy: Store.currentUserId
    });
  }
  function inviteCall(payload) {
    if (hasFn('inviteMember')) return Store.inviteMember(payload);
    if (hasFn('invite')) return Store.invite(payload);
    return { ok: false, error: 'Chức năng mời thành viên chưa sẵn sàng — hãy thử lại sau.' };
  }

  /**
   * Chạy một kết quả Store (đồng bộ demo hoặc Promise ở dữ liệu thật).
   * QUAN TRỌNG (R12 phía UI): ok:false thì gọi onErr, KHÔNG báo "Đã lưu".
   */
  function saveResult(result, onOk, onErr) {
    function handle(r) {
      if (r && r.ok) { if (onOk) onOk(r); }
      else if (onErr) onErr((r && r.error) || 'Thao tác thất bại.');
      else toast((r && r.error) || 'Thao tác thất bại.');
    }
    if (result && typeof result.then === 'function') {
      result.then(handle).catch(function (e) { handle({ ok: false, error: e && e.message ? e.message : String(e) }); });
    } else handle(result);
    return result;
  }
  function settle(result, onOk) { return saveResult(result, onOk, null); }

  // ---------- Trạng thái tải theo collection (R13 phía UI) ----------
  function loadStateOf(coll) {
    var ls = Store.loadState;
    if (ls && ls[coll]) return ls[coll];
    if (Store.state && Store.state.loadError) return { status: 'error', error: Store.state.loadError };
    if (!UI.booted) return { status: 'loading' };
    return { status: 'ready' };
  }
  function collectionBanner(coll) {
    var st = loadStateOf(coll);
    if (st.status === 'loading') return '<div class="skeleton" aria-busy="true"><div class="sk-line w60"></div><div class="sk-line"></div><div class="sk-line w80"></div><p class="sub">Đang tải dữ liệu…</p></div>';
    if (st.status === 'error' || st.status === 'denied') {
      return '<div class="notice bad"><strong>' + (st.status === 'denied' ? 'Không có quyền đọc dữ liệu này.' : 'Không tải được dữ liệu.') + '</strong> ' +
        esc(st.error || st.message || 'Đã xảy ra lỗi khi tải.') +
        ' <button class="btn small secondary" data-action="retry-load">Thử lại</button></div>';
    }
    if (st.status === 'stale') return '<div class="notice warn">Dữ liệu đang hiển thị có thể đã cũ' + (st.updatedAt ? ' (tải lúc ' + esc(D.formatDateTimeVN(st.updatedAt)) + ')' : '') + '. <button class="btn small secondary" data-action="retry-load">Tải lại</button></div>';
    return '';
  }
  function collLoadingOrError(coll) { var s = loadStateOf(coll).status; return s === 'loading' || s === 'error' || s === 'denied'; }

  // ---------- Định tuyến theo entity ----------
  function parseRoute() {
    var h = (window.location.hash || '#/overview').replace(/^#\/?/, '');
    var parts = h.split('/').filter(function (x) { return x !== ''; });
    var name = parts[0] || 'overview';
    if (name === 'calendar') { UI.contentTab = 'calendar'; name = 'content'; }
    if (ROUTES.indexOf(name) === -1) name = 'overview';
    var route = { name: name, id: parts[1] ? decodeURIComponent(parts[1]) : null, sub: parts[2] ? decodeURIComponent(parts[2]) : null };
    if (name === 'campaigns' && route.sub && ['overview', 'action', 'plan', 'tasks', 'content', 'kpi', 'docs', 'summary'].indexOf(route.sub) !== -1) UI.campaignTab = route.sub;
    if (name === 'campaigns' && route.id && !route.sub) UI.campaignTab = 'overview';
    return route;
  }
  var ROUTE = { name: 'overview', id: null, sub: null };
  function routeKey(r) { return r.name + '/' + (r.id || '') + '/' + (r.sub || ''); }

  // ---------- Bộ dựng biểu mẫu ----------
  function optList(pairs, value, includeEmptyLabel) {
    var html = '';
    if (includeEmptyLabel !== null && includeEmptyLabel !== undefined) html += '<option value="">' + esc(includeEmptyLabel) + '</option>';
    html += pairs.map(function (p) {
      return '<option value="' + esc(p[0]) + '"' + (String(p[0]) === String(value === null || value === undefined ? '' : value) ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
    }).join('');
    return html;
  }
  function memberPairs() { return Store.list('members').filter(function (m) { return m.isActive !== false; }).map(function (m) { return [m.id, m.name]; }); }
  function campaignPairs(includeEmpty) {
    var pairs = visibleList('campaigns').map(function (c) { return [c.id, c.name]; });
    return pairs;
  }
  function F(name, label, type, value, opts) {
    opts = opts || {};
    var v = value === null || value === undefined ? '' : value;
    var err = (UI.editor && UI.editor.errors && UI.editor.errors[name]) ? '<span class="field-error">' + esc(UI.editor.errors[name]) + '</span>' : '';
    var cls = 'fld' + (opts.wide ? ' wide' : '');
    var disA = opts.disabled ? ' disabled' : '';
    var req = opts.required ? ' required' : '';
    var inner = '';
    if (type === 'select') inner = '<select name="' + esc(name) + '"' + disA + req + (opts.attrs || '') + '>' + optList(opts.options || [], v, opts.emptyLabel) + '</select>';
    else if (type === 'textarea') inner = '<textarea name="' + esc(name) + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.placeholder || '') + '"' + disA + req + '>' + esc(v) + '</textarea>';
    else inner = '<input type="' + type + '" name="' + esc(name) + '" value="' + esc(v) + '" placeholder="' + esc(opts.placeholder || '') + '"' +
      (opts.min !== undefined ? ' min="' + opts.min + '"' : '') + (opts.step !== undefined ? ' step="' + opts.step + '"' : '') + disA + req + (opts.attrs || '') + '>';
    return '<label class="' + cls + '">' + esc(label) + inner + (opts.help ? '<span class="field-help">' + esc(opts.help) + '</span>' : '') + err + '</label>';
  }
  function formShell(kind, title, fieldsHtml, submitLabel) {
    var e = UI.editor;
    // Áp nguyên tắc chỉ-đọc ở điểm vào chung: form campaign (và modal task)
    // khi vai không có quyền sửa tương ứng thì khóa mọi input/select/textarea
    // ngay trong HTML + ghi chú rõ, thay vì chỉ chặn lúc bấm Lưu.
    var ro = editorReadonly(kind);
    var body = fieldsHtml;
    if (ro) {
      body = body.replace(/<(input|select|textarea)(?=[\s>])/g, '<$1 disabled')
        .replace(/<(button)(?=[\s>][^>]*data-action="(?:scene-add|scene-remove)")/g, '<$1 disabled');
    }
    return '<div class="modal-backdrop" data-action="editor-backdrop"></div>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="modal-head"><h2>' + esc(title) + '</h2><button type="button" class="btn secondary small" data-action="editor-close">Đóng</button></div>' +
      (e && e.error ? '<div class="notice bad" role="alert"><strong>Chưa lưu được:</strong> ' + esc(e.error) + '</div>' : '') +
      (ro ? readonlyFormNote(kind) : '') +
      '<form data-editor-form="' + esc(kind) + '" class="editor-form" novalidate>' + body +
      '<div class="form-actions"><button class="btn" type="submit" data-editor-submit="1"' + dis(ro) + noEditTitle(ro) + '>' + esc(submitLabel || 'Lưu') + '</button>' +
      '<button class="btn secondary" type="button" data-action="editor-close">Hủy</button></div></form></div>';
  }
  function openEditor(kind, id, context) {
    UI.lastFocusEl = document.activeElement || null;
    UI.editor = { kind: kind, id: id || null, context: context || {}, error: null, errors: {}, values: null, scenes: null, dirty: false, initialSnapshot: null };
    UI.editorSubmitting = false;
    renderOverlay();
    snapshotEditorInitial();
    var first = document.querySelector('.modal input, .modal select, .modal textarea');
    if (first) first.focus();
  }
  function closeEditor() {
    UI.editor = null; UI.editorSubmitting = false; UI.confirmClose = null;
    renderOverlay();
    restoreFocus();
  }
  // R2-30.1: dirty check — so sánh dữ liệu form hiện tại với lúc mở.
  function editorFormSnapshot(form) {
    if (!form) return '';
    var fd = new FormData(form);
    var parts = [];
    fd.forEach(function (v, k) { parts.push(k + '=' + v); });
    return parts.join('&');
  }
  function snapshotEditorInitial() {
    var form = document.querySelector('form[data-editor-form]');
    if (form && UI.editor) UI.editor.initialSnapshot = editorFormSnapshot(form);
  }
  function editorIsDirty() {
    var e = UI.editor;
    if (!e) return false;
    if (e.dirty) return true;
    var form = document.querySelector('form[data-editor-form]');
    if (!form || e.initialSnapshot === null || e.initialSnapshot === undefined) return false;
    return editorFormSnapshot(form) !== e.initialSnapshot;
  }
  function requestCloseEditor() {
    if (!UI.editor) return;
    if (editorIsDirty()) { UI.confirmClose = { target: 'editor' }; renderOverlay(); return; }
    closeEditor();
  }
  function requestCloseTaskPanel() {
    if (taskDraftIsDirty()) { UI.confirmClose = { target: 'panel' }; renderOverlay(); return; }
    UI.taskDraft = null; UI.taskDraftConflict = false;
    closeTaskPanel();
  }
  function confirmCloseHtml() {
    if (!UI.confirmClose) return '';
    return '<div class="modal-backdrop" style="z-index:95"></div>' +
      '<div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Có thay đổi chưa lưu">' +
      '<div class="modal-head"><h2>Có thay đổi chưa lưu</h2></div>' +
      '<p>Bạn đang sửa dở. Muốn lưu thay đổi trước khi đóng, bỏ hết thay đổi, hay tiếp tục sửa?</p>' +
      '<div class="form-actions"><button class="btn" type="button" data-action="confirm-save">Lưu</button>' +
      '<button class="btn secondary" type="button" data-action="confirm-discard">Bỏ thay đổi</button>' +
      '<button class="btn secondary" type="button" data-action="confirm-continue">Tiếp tục sửa</button></div></div>';
  }
  function restoreFocus() {
    var el = UI.lastFocusEl;
    UI.lastFocusEl = null;
    if (el && document.contains(el) && typeof el.focus === 'function') { try { el.focus(); } catch (e) {} }
  }
  // R2-30.3: focus trap tối thiểu — Tab vòng trong modal/panel đang mở.
  function trapTab(ev) {
    var container = document.querySelector('.confirm-modal') || document.querySelector('.modal') || document.querySelector('.detail-panel');
    if (!container) return;
    var focusables = container.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  function editorFail(msg, errors) {
    UI.editorSubmitting = false;
    if (!UI.editor) { toast(msg); return; }
    UI.editor.error = msg; UI.editor.errors = errors || {};
    renderOverlay();
  }
  // R2-30.2: khóa nút Lưu + toàn bộ ô nhập cho tới khi Promise lưu settle.
  function setEditorSubmitting(on) {
    UI.editorSubmitting = on;
    var form = document.querySelector('form[data-editor-form]');
    if (!form) return;
    var btn = form.querySelector('[data-editor-submit]');
    if (btn) {
      if (on) { if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent; btn.disabled = true; btn.textContent = 'Đang lưu…'; }
      else { btn.disabled = false; if (btn.dataset.origLabel) btn.textContent = btn.dataset.origLabel; }
    }
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (on) { if (!el.disabled) { el.disabled = true; el.setAttribute('data-was-enabled', '1'); } }
      else if (el.getAttribute('data-was-enabled')) { el.disabled = false; el.removeAttribute('data-was-enabled'); }
    });
  }
  function captureEditorValues(form) {
    if (!form) return;
    var fd = new FormData(form);
    var vals = {};
    fd.forEach(function (v, k) { vals[k] = v; });
    UI.editor.values = vals;
    UI.editor.scenes = readScenes(form);
  }
  function readScenes(scope) {
    var rows = (scope || document).querySelectorAll('[data-scene-row]');
    var scenes = [];
    rows.forEach(function (row, i) {
      function g(n) { var el = row.querySelector('[name="' + n + '_' + i + '"]'); return el ? el.value : ''; }
      scenes.push({ shot: i + 1, hook: g('sc_hook'), visual: g('sc_visual'), dialogue: g('sc_dialogue'), onScreenText: g('sc_text'), durationSec: g('sc_dur') ? Number(g('sc_dur')) : '', cta: g('sc_cta') });
    });
    return scenes;
  }
  function scenesEditorHtml(scenes) {
    var list = (scenes && scenes.length) ? scenes : [{ shot: 1, visual: '', dialogue: '', onScreenText: '', durationSec: '', hook: '', cta: '' }];
    var rows = list.map(function (s, i) {
      return '<tr data-scene-row>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><input name="sc_hook_' + i + '" value="' + esc(s.hook || '') + '" placeholder="Câu mở đầu giữ chân"></td>' +
        '<td><input name="sc_visual_' + i + '" value="' + esc(s.visual || '') + '"></td>' +
        '<td><input name="sc_dialogue_' + i + '" value="' + esc(s.dialogue || '') + '"></td>' +
        '<td><input name="sc_text_' + i + '" value="' + esc(s.onScreenText || '') + '"></td>' +
        '<td><input name="sc_dur_' + i + '" type="number" min="0" step="0.5" value="' + esc(s.durationSec === undefined ? '' : s.durationSec) + '"></td>' +
        '<td><input name="sc_cta_' + i + '" value="' + esc(s.cta || '') + '"></td>' +
        '<td><button type="button" class="btn small secondary" data-action="scene-remove" data-id="' + i + '">Xóa cảnh</button></td></tr>';
    }).join('');
    return '<h3>Kịch bản theo cảnh</h3><div class="table-wrap"><table class="scene-table"><tr><th>Cảnh</th><th>Hook</th><th>Hình ảnh</th><th>Lời thoại</th><th>Chữ trên màn hình</th><th>Thời lượng (giây)</th><th>CTA</th><th></th></tr>' + rows + '</table></div>' +
      '<p><button type="button" class="btn small secondary" data-action="scene-add">+ Thêm cảnh</button></p>';
  }

  // ---------- Biểu mẫu theo loại đối tượng ----------
  function ev(name, fallback) {
    var e = UI.editor;
    if (e && e.values && e.values[name] !== undefined) return e.values[name];
    return fallback === null || fallback === undefined ? '' : fallback;
  }
  function editorItem(coll) { var e = UI.editor; return e && e.id ? Store.get(coll, e.id) : null; }

  function editorHtml() {
    var e = UI.editor;
    if (!e) return '';
    var v = e.values || {};
    switch (e.kind) {
      case 'campaign': {
        var c = editorItem('campaigns') || {};
        var campCeil = campaignCeilingValue(c);
        var audText = (c.audiences || []).map(function (a) { return a.name + (a.description ? ' | ' + a.description : ''); }).join('\n');
        return formShell('campaign', e.id ? 'Sửa campaign' : 'Tạo campaign',
          F('name', 'Tên campaign *', 'text', ev('name', c.name), { required: true, wide: true }) +
          F('status', 'Trạng thái', 'select', ev('status', c.status || 'planning'), { options: CAMPAIGN_STATUSES }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', c.ownerId || Store.currentUserId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('businessUnitId', 'BU', 'select', ev('businessUnitId', c.businessUnitId), { options: Store.list('businessUnits').map(function (b) { return [b.id, b.name]; }), emptyLabel: '— Không gắn BU —' }) +
          F('product', 'Sản phẩm', 'text', ev('product', c.product)) +
          // 0014 (quy tắc duyệt ngân sách của Zac, tiếp nối vòng 0014): KHÔNG còn
          // ô nhập trực tiếp hạn mức — hạn mức campaign CHỈ đổi qua đề xuất ngân
          // sách được Owner duyệt (Store đã strip budget_ceiling_* khỏi payload
          // create/update nên ô nhập cũ lưu không hiệu lực). Ở đây chỉ hiển thị
          // chỉ-đọc: số hạn mức hiện tại + dấu duyệt (campaignCeilingApprovalHtml),
          // kèm nút mở form đề xuất cho ceiling của campaign này khi đã tồn tại
          // và vai có quyền budget.propose (đúng entry point ở Tổng quan campaign).
          '<div class="fld wide" data-budget-ceiling-block="1" data-campaign-ceiling-readonly="1"><span>Hạn mức ngân sách campaign — chỉ xem</span>' +
          (!e.id
            ? '<p class="sub" style="margin:2px 0">Chưa thiết lập — hạn mức được đặt qua Đề xuất ngân sách sau khi tạo campaign</p>'
            : '<p class="sub" style="margin:2px 0"><strong>' + (campCeil ? fmtMoney(campCeil.amount, campCeil.currency) : 'chưa có') + '</strong></p>' + campaignCeilingApprovalHtml(c) +
              (can('budget.propose') ? '<p style="margin:4px 0"><button type="button" class="btn small" data-action="editor-open" data-kind="budgetProposal" data-campaign="' + esc(c.id || e.id) + '" data-target-type="campaign_ceiling">Đề xuất ngân sách</button></p>' : '')) +
          '</div>' +
          (!e.id
            ? F('template', 'Mẫu campaign', 'select', ev('template', ''), { options: [['', 'Không dùng mẫu'], ['livestream', 'Livestream — 4 activity mẫu']], emptyLabel: null, help: 'Mẫu chỉ tạo activity/task/KPI gợi ý và dòng phân bổ DỰ THẢO (chưa duyệt, chưa có khoản chi/thanh toán thật). Sửa số phân bổ ngay bên dưới trước khi tạo.' }) +
              '<div class="fld wide"><span>Phân bổ dự thảo của mẫu Livestream (VNĐ) — sửa được trước khi tạo</span></div>' +
              F('tplAlloc0', 'Mời khách mời — phân bổ dự thảo', 'number', ev('tplAlloc0', 8000000), { min: 0, step: 'any' }) +
              F('tplAlloc1', 'Chạy ads — phân bổ dự thảo', 'number', ev('tplAlloc1', 15000000), { min: 0, step: 'any' }) +
              F('tplAlloc2', 'Seeding — phân bổ dự thảo', 'number', ev('tplAlloc2', 5000000), { min: 0, step: 'any' }) +
              F('tplAlloc3', 'Tổ chức livestream — phân bổ dự thảo', 'number', ev('tplAlloc3', 2000000), { min: 0, step: 'any' })
            : '') +
          F('startDate', 'Ngày bắt đầu', 'date', ev('startDate', c.startDate)) +
          F('endDate', 'Ngày kết thúc', 'date', ev('endDate', c.endDate)) +
          // R2-28c: baseline KHÔNG nhập trực tiếp nữa — chỉ chốt qua hành động
          // "Chốt baseline" ở chi tiết campaign; ở đây hiển thị read-only + lịch sử.
          '<div class="fld wide"><span>Kế hoạch đã duyệt (baseline) — chỉ xem</span>' +
          '<p class="sub" style="margin:2px 0">' + (c.baselineStartDate || c.baselineEndDate
            ? esc(D.formatDateVN(c.baselineStartDate)) + ' — ' + esc(D.formatDateVN(c.baselineEndDate))
            : 'Chưa chốt baseline nào.') + '</p>' +
          (baselineVersionsOf(c).length
            ? '<ul class="clean">' + baselineVersionsOf(c).map(function (bv) {
              var bvStats = baselineVersionStatsText(bv);
              return '<li>Baseline v' + esc(bv.version) + ': ' + esc(D.formatDateVN(bv.startDate)) + ' — ' + esc(D.formatDateVN(bv.endDate)) + ' · chốt bởi ' + esc(memberName(bv.setBy)) + ' lúc ' + esc(D.formatDateTimeVN(bv.setAt)) + (bvStats ? ' · ' + esc(bvStats) : '') + '</li>';
            }).join('') + '</ul>'
            : '') + '</div>' +
          F('why', 'Vì sao chạy campaign này?', 'textarea', ev('why', c.why), { wide: true }) +
          F('businessGoal', 'Mục tiêu kinh doanh', 'textarea', ev('businessGoal', c.businessGoal), { wide: true }) +
          F('marketingGoal', 'Mục tiêu marketing', 'textarea', ev('marketingGoal', c.marketingGoal), { wide: true }) +
          F('desiredOutcome', 'Kết quả mong muốn', 'textarea', ev('desiredOutcome', c.desiredOutcome), { wide: true }) +
          F('audiences', 'Target audiences (mỗi dòng: Tên | Mô tả)', 'textarea', ev('audiences', audText), { wide: true, rows: 4 }) +
          F('audienceInsights', 'Audience insights', 'textarea', ev('audienceInsights', c.audienceInsights), { wide: true }) +
          F('bigIdea', 'Big idea', 'textarea', ev('bigIdea', c.bigIdea), { wide: true }) +
          F('keyMessage', 'Key message', 'textarea', ev('keyMessage', c.keyMessage), { wide: true }) +
          F('creativeDirection', 'KV & hướng sáng tạo', 'textarea', ev('creativeDirection', c.creativeDirection), { wide: true }) +
          F('risks', 'Rủi ro', 'textarea', ev('risks', c.risks), { wide: true }) +
          F('lessons', 'Tổng kết / rút kinh nghiệm', 'textarea', ev('lessons', c.lessons), { wide: true }),
          e.id ? 'Lưu campaign' : 'Tạo campaign');
      }
      case 'phase': {
        var p = editorItem('phases') || {};
        return formShell('phase', e.id ? 'Sửa giai đoạn' : 'Thêm giai đoạn',
          F('name', 'Tên giai đoạn *', 'text', ev('name', p.name), { required: true, wide: true }) +
          F('startDate', 'Ngày bắt đầu', 'date', ev('startDate', p.startDate)) +
          F('endDate', 'Ngày kết thúc', 'date', ev('endDate', p.endDate)) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', p.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }),
          'Lưu giai đoạn');
      }
      case 'activity': {
        var a = editorItem('activities') || {};
        var phases = Store.list('phases').filter(function (x) { return x.campaignId === (e.context.campaignId || a.campaignId); });
        return formShell('activity', e.id ? 'Sửa activity' : 'Thêm activity',
          F('name', 'Tên activity *', 'text', ev('name', a.name), { required: true, wide: true }) +
          F('phaseId', 'Giai đoạn', 'select', ev('phaseId', a.phaseId), { options: phases.map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Không gắn giai đoạn —' }) +
          F('channel', 'Kênh triển khai', 'text', ev('channel', a.channel)) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', a.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('status', 'Trạng thái', 'select', ev('status', a.status || ''), { options: [['not_started', 'Chưa bắt đầu'], ['in_progress', 'Đang làm'], ['blocked', 'Bị chặn'], ['completed', 'Hoàn thành']], emptyLabel: '— Tự suy từ task —' }) +
          F('startDate', 'Ngày bắt đầu', 'date', ev('startDate', a.startDate)) +
          F('endDate', 'Ngày kết thúc', 'date', ev('endDate', a.endDate)) +
          F('objective', 'Mục tiêu activity', 'textarea', ev('objective', a.objective), { wide: true }) +
          F('deliverables', 'Đầu ra cần bàn giao', 'textarea', ev('deliverables', a.deliverables || a.deliverable), { wide: true }),
          'Lưu activity');
      }
      case 'brandPage': {
        var bp = editorItem('brandPages') || {};
        return formShell('brandPage', e.id ? 'Sửa trang thương hiệu' : 'Thêm trang thương hiệu',
          F('title', 'Tiêu đề *', 'text', ev('title', bp.title), { required: true, wide: true }) +
          F('summary', 'Tóm tắt', 'textarea', ev('summary', bp.summary), { wide: true }) +
          F('content', 'Nội dung trang', 'textarea', ev('content', bp.content || bp.body), { wide: true, rows: 6 }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', bp.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('tags', 'Thẻ (cách nhau bằng dấu phẩy)', 'text', ev('tags', Array.isArray(bp.tags) ? bp.tags.join(', ') : bp.tags)) +
          F('status', 'Trạng thái bản', 'select', ev('status', bp.status || 'Draft'), { options: BRAND_STATUSES }),
          'Lưu trang');
      }
      case 'brandAsset': {
        var ba = editorItem('brandAssets') || {};
        return formShell('brandAsset', e.id ? 'Sửa tài nguyên thương hiệu' : 'Thêm tài nguyên thương hiệu',
          F('name', 'Tên tài nguyên *', 'text', ev('name', ba.name), { required: true, wide: true }) +
          F('type', 'Loại', 'text', ev('type', ba.type), { placeholder: 'Logo, Hình ảnh, Hướng dẫn…' }) +
          F('url', 'Đường dẫn file / link', 'url', ev('url', ba.externalUrl || ba.url || ba.fileUrl), { wide: true, placeholder: 'https://…' }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', ba.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('tags', 'Thẻ (cách nhau bằng dấu phẩy)', 'text', ev('tags', Array.isArray(ba.tags) ? ba.tags.join(', ') : ba.tags)) +
          F('status', 'Trạng thái bản', 'select', ev('status', ba.status || 'Draft'), { options: BRAND_STATUSES }),
          'Lưu tài nguyên');
      }
      case 'task': {
        var t = editorItem('tasks') || {};
        var tCamp = ev('campaignId', t.campaignId || e.context.campaignId || '');
        var tPhase = ev('phaseId', t.phaseId || '');
        var taskPhases = tCamp ? Store.list('phases').filter(function (x) { return x.campaignId === tCamp; }) : [];
        var taskActs = Store.list('activities').filter(function (x) {
          if (tCamp && x.campaignId !== tCamp) return false;
          if (tPhase) return x.phaseId === tPhase;
          return true;
        });
        return formShell('task', e.id ? 'Sửa task' : 'Tạo task',
          F('title', 'Tên task *', 'text', ev('title', t.title), { required: true, wide: true }) +
          F('campaignId', 'Campaign (để trống = task độc lập)', 'select', tCamp, { options: campaignPairs(), emptyLabel: '— Task độc lập —', attrs: ' data-refresh-editor="1"' }) +
          F('phaseId', 'Giai đoạn (theo campaign)', 'select', tPhase, { options: taskPhases.map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chưa gắn giai đoạn —', attrs: ' data-refresh-editor="1"' }) +
          F('activityId', 'Activity', 'select', ev('activityId', t.activityId || e.context.activityId || ''), { options: taskActs.map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chưa gắn activity —' }) +
          F('parentId', 'Task cha', 'select', ev('parentId', t.parentId), { options: visibleList('tasks').filter(function (x) { return x.id !== e.id; }).map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không có —' }) +
          F('assigneeId', 'Người phụ trách', 'select', ev('assigneeId', t.assigneeId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('status', 'Trạng thái', 'select', ev('status', t.status || 'todo'), { options: TASK_STATUSES }) +
          F('priority', 'Ưu tiên', 'select', ev('priority', t.priority || 'Trung bình'), { options: PRIORITIES.map(function (x) { return [x, x]; }) }) +
          F('startDate', 'Ngày bắt đầu', 'date', ev('startDate', t.startDate ? String(t.startDate).slice(0, 10) : '')) +
          F('dueDate', 'Mốc cần hoàn thành', 'date', ev('dueDate', t.dueDate ? String(t.dueDate).slice(0, 10) : '')) +
          '<label class="fld"><span>Loại mốc</span><span><input type="checkbox" name="isMilestone"' + (isMilestoneTask(t) ? ' checked' : '') + '> Đây là mốc quan trọng (milestone) — vẽ dạng hình thoi trên biểu đồ kế hoạch</span></label>' +
          F('effortHours', 'Thời gian dự kiến (giờ)', 'number', ev('effortHours', t.effortHours), { min: 0, step: 0.5 }) +
          F('deliverable', 'Đầu ra cần bàn giao', 'text', ev('deliverable', t.deliverable), { wide: true }) +
          F('description', 'Mô tả', 'textarea', ev('description', t.description), { wide: true }),
          e.id ? 'Lưu task' : 'Tạo task');
      }
      case 'pillar': {
        var pl = editorItem('contentPillars') || {};
        var plName = ev('name', pl.name || e.context.suggestedName || '');
        var plDesc = ev('description', pl.description || e.context.suggestedDescription || '');
        var plGuide = ev('classificationGuide', pl.classificationGuide || pl.classification_guide || e.context.suggestedGuide || '');
        return formShell('pillar', e.id ? 'Sửa Content Pillar' : 'Tạo Content Pillar',
          F('name', 'Tên pillar *', 'text', plName, { required: true, wide: true }) +
          F('buProductId', 'Phạm vi Brand / BU / sản phẩm', 'select', ev('buProductId', pl.buProductId || pl.bu_product_id || ''), { options: Store.list('businessUnits').map(function (b) { return [b.id, b.name || b.buName || b.id]; }), emptyLabel: '— Toàn workspace —', help: 'Pillar thuộc phạm vi này; mỗi BU có bộ pillar riêng, app không áp một bộ pillar cho mọi BU.' }) +
          F('description', 'Mô tả pillar', 'textarea', plDesc, { wide: true, rows: 3 }) +
          F('classificationGuide', 'Hướng dẫn phân loại & ví dụ', 'textarea', plGuide, { wide: true, rows: 4, help: 'Ghi điều kiện phân loại và ví dụ cụ thể để cả đội phân loại nhất quán.' }) +
          F('status', 'Trạng thái', 'select', ev('status', pl.status || 'active'), { options: [['active', 'Đang dùng'], ['archived', 'Đã lưu trữ']], help: 'Lưu trữ chỉ ngừng dùng cho phân loại mới — ID và lịch sử phân loại của content cũ được giữ nguyên.' }),
          e.id ? 'Lưu pillar' : 'Tạo pillar');
      }
      case 'content': {
        var ci = editorItem('contentItems') || {};
        var ciPillar = contentPillarId(ci);
        var ciChoice = contentCampaignChoice(ci);
        var ciProducts = [];
        Store.list('businessUnits').forEach(function (b) { (b.products || []).forEach(function (p) { if (ciProducts.indexOf(p) === -1) ciProducts.push(p); }); });
        var ciProduct = cfVal(ci, 'product') || ci.product || '';
        if (ciProduct && ciProducts.indexOf(ciProduct) === -1) ciProducts.push(ciProduct);
        var pillarOpts = activePillars().map(function (p) { return [p.id, p.name || p.title]; });
        if (ciPillar && !pillarOpts.some(function (p) { return p[0] === ciPillar; })) { var oldP = pillarById(ciPillar); if (oldP) pillarOpts.push([oldP.id, (oldP.name || oldP.title) + ' (đã lưu trữ)']); }
        return formShell('content', e.id ? 'Sửa content gốc' : 'Tạo content',
          F('title', 'Tiêu đề content *', 'text', ev('title', ci.title), { required: true, wide: true }) +
          F('angle', 'Góc khai thác (angle)', 'text', ev('angle', cfVal(ci, 'angle') || ''), { wide: true, placeholder: 'Góc nhìn riêng của bài này so với các bài cùng chủ đề…' }) +
          F('buProductId', 'Brand / BU', 'select', ev('buProductId', ci.buProductId || ci.bu_product_id || ''), { options: Store.list('businessUnits').map(function (b) { return [b.id, b.name || b.buName || b.id]; }), emptyLabel: '— Chưa chọn brand/BU —' }) +
          F('product', 'Sản phẩm', 'select', ev('product', ciProduct), { options: ciProducts.map(function (p) { return [p, p]; }), emptyLabel: '— Chưa chọn sản phẩm —' }) +
          F('pillarId', 'Pillar chính', 'select', ev('pillarId', ciPillar || ''), { options: pillarOpts, emptyLabel: '— Chưa chọn pillar (nằm ở Backlog) —', help: 'Một content chỉ có MỘT pillar chính để tính content mix không trùng. Chưa chọn pillar vẫn lưu được ở dạng nháp/Backlog.' }) +
          F('type', 'Định dạng (format)', 'select', ev('type', ci.type || 'post'), { options: [['post', 'Post'], ['video', 'Video'], ['image', 'Hình ảnh'], ['article', 'Bài viết'], ['other', 'Khác']] }) +
          F('campaignChoice', 'Quan hệ với campaign', 'select', ev('campaignChoice', ciChoice), { options: [['unset', 'Chưa chọn'], ['none', 'Content thường xuyên — không thuộc campaign'], ['campaign', 'Thuộc campaign — chọn campaign ở ô bên cạnh']], help: '"Content thường xuyên — không thuộc campaign" là lựa chọn tường minh và hợp lệ; "Chưa chọn" nghĩa là chưa quyết định. Campaign KHÔNG bắt buộc để lưu/lên lịch content.' }) +
          F('campaignId', 'Campaign (chỉ khi chọn "Thuộc campaign")', 'select', ev('campaignId', ci.campaignId || e.context.campaignId || ''), { options: campaignPairs(), emptyLabel: '— Chọn campaign —' }) +
          F('goal', 'Mục tiêu của content', 'textarea', ev('goal', cfVal(ci, 'goal') || cfVal(ci, 'objective') || ''), { wide: true, rows: 2 }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', ci.ownerId || Store.currentUserId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('productionDeadline', 'Hạn sản xuất', 'date', ev('productionDeadline', cfVal(ci, 'productionDeadline') ? String(cfVal(ci, 'productionDeadline')).slice(0, 10) : '')) +
          F('editorialStatus', 'Trạng thái', 'select', ev('editorialStatus', ci.editorialStatus || 'draft'), { options: EDITORIAL_STATUSES.concat([['published', 'Đã đăng']]) }) +
          F('brief', 'Brief / ý tưởng content', 'textarea', ev('brief', ci.brief || ci.description), { wide: true, rows: 4 }) +
          F('assetUrl', 'Link brief / asset đính kèm', 'url', ev('assetUrl', cfVal(ci, 'assetUrl') || ''), { wide: true, placeholder: 'https://…' }) +
          F('series', 'Series / chuỗi bài (tùy chọn)', 'text', ev('series', ci.series || '')) +
          F('audience', 'Đối tượng khán giả (tùy chọn)', 'text', ev('audience', cfVal(ci, 'audience') || '')) +
          F('sourceContentId', 'Content gốc được dùng lại (nguồn, tùy chọn)', 'select', ev('sourceContentId', ci.sourceContentId || ci.source_content_id || ''), { options: visibleList('contentItems').filter(function (x) { return x.id !== e.id; }).map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không dùng lại content nào —', help: 'Quan hệ dùng lại (repost/repurpose/remix): chỉ ghi nguồn, không tự đổi campaign của content này.' }) +
          F('tags', 'Tags / chủ đề phụ (cách nhau bằng dấu phẩy)', 'text', ev('tags', contentTags(ci).join(', ')), { wide: true, help: 'Tags phụ chỉ để lọc/tìm — báo cáo theo tags KHÔNG cộng các nhóm tags ra tổng (xem Content mix).' }) +
          '<label class="fld"><span>Vận hành</span><span><input type="checkbox" name="alwaysOn"' + (contentIsAlwaysOn(ci) ? ' checked' : '') + '> Always-on — content vận hành thường xuyên</span></label>' +
          '<label class="fld"><span>Giá trị sử dụng</span><span><input type="checkbox" name="evergreen"' + (contentIsEvergreen(ci) ? ' checked' : '') + '> Evergreen — content có giá trị lâu dài</span></label>' +
          F('expiresAt', 'Ngày hết hiệu lực (tùy chọn)', 'date', ev('expiresAt', cfVal(ci, 'expiresAt') ? String(cfVal(ci, 'expiresAt')).slice(0, 10) : ''), { help: 'Hai thuộc tính always-on và evergreen là RIÊNG BIỆT: always-on nói cách vận hành, evergreen nói giá trị lâu dài. Content evergreen vẫn có thể dùng trong campaign.' }) +
          '<div class="fld wide"><span>Task liên quan (tùy chọn — không bắt buộc, không phải quan hệ cha)</span></div>' +
          F('activityId', 'Activity liên quan (Action Plan)', 'select', ev('activityId', ci.activityId || e.context.activityId || ''), { options: visibleList('activities').map(function (x) { return [x.id, x.name + ' — ' + campaignName(x.campaignId)]; }), emptyLabel: '— Không liên kết activity —' }) +
          F('taskId', 'Task liên quan', 'select', ev('taskId', ci.taskId || cfVal(ci, 'taskId') || e.context.taskId || ''), { options: visibleList('tasks').map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không liên kết task —', help: 'Lưu content từ Content Plan là luồng bình thường — không cần qua Action Plan hay campaign. Task sản xuất chỉ được tạo khi bạn bấm nút "Tạo task sản xuất" ở danh sách content, KHÔNG tự tạo khi Lưu.' }),
          e.id ? 'Lưu content' : 'Tạo content');
      }
      case 'variant': {
        var vv = editorItem('variants') || {};
        var platform = ev('platform', vv.platform || 'facebook');
        var isTiktok = platform === 'tiktok';
        var scenes = e.scenes || vv.scriptScenes || [];
        var html = F('contentItemId', 'Content gốc *', 'select', ev('contentItemId', vv.contentItemId || e.context.contentItemId), { options: visibleList('contentItems').map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Chọn content —' }) +
          F('platform', 'Kênh', 'select', platform, { options: PLATFORMS, attrs: ' data-editor-platform="1"' }) +
          F('channelAccountId', 'Tài khoản kênh', 'select', ev('channelAccountId', vv.channelAccountId), { options: Store.list('channelAccounts').map(function (x) { return [x.id, x.name + ' (' + labelStatus(x.platform) + ')']; }), emptyLabel: '— Chưa gắn tài khoản —' }) +
          F('ownerId', 'Người sản xuất', 'select', ev('ownerId', vv.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('reviewerId', 'Người duyệt', 'select', ev('reviewerId', vv.reviewerId), { options: memberPairs(), emptyLabel: '— Chưa chọn —' }) +
          F('productionDeadline', 'Hạn sản xuất', 'date', ev('productionDeadline', vv.productionDeadline)) +
          F('reviewDeadline', 'Hạn duyệt', 'date', ev('reviewDeadline', vv.reviewDeadline)) +
          F('scheduledAt', 'Lịch đăng dự kiến của publication này', 'datetime-local', ev('scheduledAt', vv.scheduledAt ? toDatetimeLocalValue(vv.scheduledAt) : (e.context.scheduledAtLocal || ''))) +
          F('campaignId', 'Campaign của publication này', 'select', ev('campaignId', cfVal(vv, 'campaignId') || ''), { options: campaignPairs(), emptyLabel: '— Kế thừa campaign của content gốc —', help: 'Chỉ điền khi publication này dùng cho campaign KHÁC content gốc (dùng lại content) — lựa chọn lưu ở publication, không đổi campaign của content gốc.' }) +
          F('editorialStatus', 'Trạng thái biên tập', 'select', ev('editorialStatus', vv.editorialStatus || 'draft'), { options: EDITORIAL_STATUSES }) +
          F('caption', 'Caption', 'textarea', ev('caption', vv.caption), { wide: true, rows: 4 }) +
          F('hashtags', 'Hashtag (TikTok/mạng xã hội)', 'text', ev('hashtags', vv.hashtags), { wide: true, placeholder: '#sava #...' }) +
          F('brief', 'Brief riêng cho kênh', 'textarea', ev('brief', vv.brief), { wide: true }) +
          // R2-13: link đích và file đính kèm là HAI field riêng — không suy lẫn nhau.
          F('linkUrl', 'Link đích bài viết', 'url', ev('linkUrl', vv.linkUrl), { wide: true, placeholder: 'https://… (trang đích khi bấm vào bài)' }) +
          F('mediaUrl', 'Đường dẫn file đính kèm (ảnh/video)', 'url', ev('mediaUrl', vv.mediaUrl), { wide: true, placeholder: 'https://…' });
        if (isTiktok) {
          html += F('hook', 'Hook chính', 'textarea', ev('hook', vv.hook), { wide: true }) +
            F('cta', 'CTA chính', 'text', ev('cta', vv.cta), { wide: true }) +
            scenesEditorHtml(scenes) +
            F('externalUrl', 'Link bài TikTok đã đăng (đăng ngoài app)', 'url', ev('externalUrl', vv.externalUrl), { wide: true }) +
            F('actualPublishedAt', 'Ngày đăng thực tế', 'datetime-local', ev('actualPublishedAt', toDatetimeLocalValue(vv.actualPublishedAt)));
        } else {
          html += F('script', 'Kịch bản / nội dung chi tiết', 'textarea', ev('script', vv.script), { wide: true, rows: 5 });
        }
        return formShell('variant', e.id ? 'Sửa phiên bản theo kênh' : 'Thêm phiên bản theo kênh', html, e.id ? 'Lưu phiên bản' : 'Tạo phiên bản');
      }
      case 'kpi': {
        var k = editorItem('kpis') || {};
        var kScope = ev('scopeType', k.scopeType || k.scope_type || (e.context.activityId ? 'activity' : (e.context.taskId ? 'task' : (e.context.contentItemId ? 'content' : 'campaign'))));
        var kDefText = (k.definition === null || k.definition === undefined) ? '' : (typeof k.definition === 'string' ? k.definition : (k.definition.description || k.definition.how || ''));
        var kDefObj = kpiDefinitionObject(k);
        var kDs0 = kDefObj.dataSource || kDefObj.data_source || null;
        var kSourceType = ev('dataSourceType', (kDs0 && kDs0.type === 'post_metrics') ? 'post_metrics' : 'manual');
        var kIsAutoForm = kSourceType === 'post_metrics';
        var kDsMetric = ev('dataSourceMetric', (kDs0 && kDs0.metric) || 'lifetime_views');
        var kDsMode = ev('dataSourceMode', (kDs0 && kDs0.mode) || 'latest_sum');
        var kMetricOpts = POST_METRIC_OPTIONS.slice();
        if (kDsMetric && !kMetricOpts.some(function (p) { return p[0] === kDsMetric; })) kMetricOpts.push([kDsMetric, kDsMetric]);
        var kContribIds = listSafe('kpiContributions').filter(function (x) { return x.kpiId === k.id; }).map(function (x) { return x.sourceKpiId; });
        var kSourcePairs = visibleList('kpis').filter(function (x) { return x.id !== k.id; }).map(function (x) { return [x.id, x.name + (x.metricCode ? ' (' + x.metricCode + ')' : '')]; });
        var kRoll = k.id ? kpiRollupFor(k) : null;
        return formShell('kpi', e.id ? 'Sửa KPI' : 'Tạo KPI',
          F('name', 'Tên KPI *', 'text', ev('name', k.name), { required: true, wide: true }) +
          F('scopeType', 'Phạm vi (scope)', 'select', kScope, { options: [['campaign', 'Campaign'], ['activity', 'Activity'], ['task', 'Task'], ['content', 'Content'], ['pillar', 'Pillar'], ['bu_product', 'Brand / Sản phẩm']], help: 'Chọn Activity thì campaign + activity được tự điền từ activity đã chọn.' }) +
          F('campaignId', 'Campaign', 'select', ev('campaignId', k.campaignId || e.context.campaignId), { options: campaignPairs(), emptyLabel: '— Toàn workspace —' }) +
          F('activityId', 'Activity', 'select', ev('activityId', k.activityId || e.context.activityId), { options: visibleList('activities').map(function (x) { return [x.id, x.name + ' — ' + campaignName(x.campaignId)]; }), emptyLabel: '— Không gắn activity —' }) +
          F('taskId', 'Task', 'select', ev('taskId', k.taskId || e.context.taskId), { options: visibleList('tasks').map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không gắn task —' }) +
          F('contentItemId', 'Content', 'select', ev('contentItemId', k.contentItemId || e.context.contentItemId), { options: visibleList('contentItems').map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không gắn content —' }) +
          F('pillarId', 'Pillar', 'select', ev('pillarId', k.pillarId), { options: listSafe('contentPillars').map(function (x) { return [x.id, x.name || x.title]; }), emptyLabel: '— Không gắn Pillar —' }) +
          F('metricCode', 'Mã chỉ số (metric_code)', 'text', ev('metricCode', k.metricCode || k.metric_code), { placeholder: 'vd: valid_registrations' }) +
          F('definition', 'Định nghĩa / cách đo (definition)', 'textarea', ev('definition', kDefText), { wide: true, help: 'Mô tả cách đo: nguồn số liệu, điều kiện hợp lệ, khóa khử trùng nếu là chỉ số unique.' }) +
          F('dataSourceType', 'Nguồn số liệu', 'select', kSourceType, { options: [['manual', 'Tự nhập'], ['post_metrics', 'Tự động từ post']], attrs: ' data-refresh-editor="1"', help: 'Tự nhập: cập nhật thực đạt bằng form số đo như trước. Tự động: số thực đạt tự tính từ bộ đếm của các post thuộc phạm vi KPI.' }) +
          (kIsAutoForm
            ? F('dataSourceMetric', 'Chỉ số', 'select', kDsMetric, { options: kMetricOpts, help: 'Chỉ số của post được dùng để tính KPI này — danh mục đúng các mã đang dùng cho số liệu post trong app.' }) +
              F('dataSourceMode', 'Cách gộp', 'select', kDsMode, { options: [['latest_sum', 'Cộng số mới nhất của từng bài'], ['period_sum', 'Cộng theo kỳ']] })
            : '') +
          F('aggregationMode', 'Cách tổng hợp (aggregation_mode)', 'select', ev('aggregationMode', k.aggregationMode || k.aggregation_mode || 'direct'), { options: [['direct', 'Đo trực tiếp (direct)'], ['sum', 'Cộng các nguồn cùng chỉ số (sum)'], ['unique', 'Đếm không trùng theo khóa định danh (unique)'], ['ratio', 'Tỷ lệ — tính lại từ tử số/mẫu số (ratio)'], ['snapshot', 'Snapshot mới nhất theo đối tượng (snapshot)'], ['manual', 'Nhập tay có bằng chứng (manual)']] }) +
          F('numerator', 'Tử số (chỉ khi aggregation_mode = ratio)', 'number', ev('numerator', (k.numerator !== null && k.numerator !== undefined) ? k.numerator : k.numeratorValue), { step: 'any', help: 'Vd KPI kiểu CPL: tử số là tổng chi phí của đúng scope đã khai (chi ads / chi toàn campaign).' }) +
          F('denominator', 'Mẫu số (chỉ khi aggregation_mode = ratio)', 'number', ev('denominator', (k.denominator !== null && k.denominator !== undefined) ? k.denominator : k.denominatorValue), { step: 'any', help: 'Vd CPL: mẫu số là số kết quả hợp lệ của cùng scope (đăng ký hợp lệ). rollupKpi tính lại tỷ lệ = tử số / mẫu số, không lấy trung bình các tỷ lệ con.' }) +
          F('target', 'Mục tiêu', 'number', ev('target', k.target), { step: 'any' }) +
          F('unit', 'Đơn vị', 'text', ev('unit', k.unit)) +
          F('direction', 'Chiều tốt lên', 'select', ev('direction', k.direction || 'increase'), { options: [['increase', 'Càng cao càng tốt'], ['decrease', 'Càng thấp càng tốt']] }) +
          F('periodStart', 'Kỳ đo — từ ngày', 'date', ev('periodStart', k.periodStart ? String(k.periodStart).slice(0, 10) : '')) +
          F('periodEnd', 'Kỳ đo — đến ngày', 'date', ev('periodEnd', k.periodEnd ? String(k.periodEnd).slice(0, 10) : '')) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', k.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          '<label class="fld wide">KPI nguồn để roll-up (contributions) — chỉ dùng khi KPI này tổng hợp từ KPI khác cùng metric' +
          '<select name="sourceKpiIds" multiple size="4">' + kSourcePairs.map(function (p) { return '<option value="' + esc(p[0]) + '"' + (kContribIds.indexOf(p[0]) !== -1 ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select>' +
          '<span class="field-help">Chọn các KPI nguồn cùng metric_code/đơn vị/kỳ. Với unique, KPI nguồn phải có khóa định danh (identity keys) — thiếu khóa thì kết quả là "Chưa đủ dữ liệu", không cộng thô.</span></label>' +
          (kRoll ? '<div class="fld wide"><span>Kết quả roll-up hiện tại</span><p class="sub" style="margin:2px 0">Phạm vi: ' + esc(kpiScopeLabel(k)) + ' · Trạng thái: ' + (kRoll.status === 'insufficient_data' ? 'Chưa đủ dữ liệu' : 'Đủ dữ liệu') + (kRoll.value !== null && kRoll.value !== undefined ? ' · Giá trị: ' + fmtNum(kRoll.value) : '') + (kRoll.achievementPercent !== null && kRoll.achievementPercent !== undefined ? ' · Mức đạt: ' + fmtNum(kRoll.achievementPercent) + '%' : '') + '</p></div>' : ''),
          'Lưu KPI');
      }
      case 'measurement': {
        var kk = Store.get('kpis', e.context.kpiId) || {};
        var kkAuto = isKpiAuto(kk);
        if (kkAuto) {
          return formShell('measurement', 'Thêm số đo cho KPI: ' + (kk.name || ''),
            '<div class="notice info" data-kpi-auto-measurement="1">KPI này lấy số tự động từ post — số sẽ cập nhật khi bộ đếm của post thay đổi.</div>' +
            '<div class="fld wide">' + kpiAutoInfoHtml(kk) + '</div>' +
            F('value', 'Giá trị thực đạt *', 'number', ev('value', ''), { required: true, step: 'any', disabled: true }) +
            F('source', 'Nguồn số liệu *', 'text', ev('source', ''), { required: true, placeholder: 'Ví dụ: Báo cáo nền tảng, nhập tay…', disabled: true }) +
            F('measuredAt', 'Ngày đo', 'date', ev('measuredAt', todayISO()), { disabled: true }),
            'Lưu số đo');
        }
        return formShell('measurement', 'Thêm số đo cho KPI: ' + (kk.name || ''),
          F('value', 'Giá trị thực đạt *', 'number', ev('value', ''), { required: true, step: 'any' }) +
          F('source', 'Nguồn số liệu *', 'text', ev('source', ''), { required: true, placeholder: 'Ví dụ: Báo cáo nền tảng, nhập tay…' }) +
          F('measuredAt', 'Ngày đo', 'date', ev('measuredAt', todayISO())),
          'Lưu số đo');
      }
      case 'budgetLine': {
        var b = editorItem('budgetLines') || {};
        var blCamp = ev('campaignId', b.campaignId || e.context.campaignId || '');
        var blActs = visibleList('activities').filter(function (x) { return !blCamp || x.campaignId === blCamp; });
        var blAct = ev('activityId', b.activityId || e.context.activityId || '');
        var blTasks = visibleList('tasks').filter(function (x) { if (blAct) return x.activityId === blAct; if (blCamp) return x.campaignId === blCamp; return true; });
        return formShell('budgetLine', e.id ? 'Sửa dòng ngân sách' : 'Tạo dòng ngân sách',
          F('name', 'Tên dòng ngân sách *', 'text', ev('name', b.name), { required: true, wide: true }) +
          F('campaignId', 'Campaign', 'select', blCamp, { options: campaignPairs(), emptyLabel: '— Chưa gắn —', attrs: ' data-refresh-editor="1"' }) +
          F('activityId', 'Activity (thuộc campaign)', 'select', blAct, { options: blActs.map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chi trực tiếp campaign / chưa phân bổ —', attrs: ' data-refresh-editor="1"' }) +
          F('taskId', 'Task (thuộc campaign)', 'select', ev('taskId', b.taskId || e.context.taskId || ''), { options: blTasks.map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không gắn task —' }) +
          F('planned', 'Kế hoạch (planned)', 'number', ev('planned', b.planned), { min: 0, step: 'any', help: 'Số kế hoạch — lưu độc lập, không suy từ số được duyệt.' }) +
          // 0014 (quy tắc mới của Zac): KHÔNG còn ô nhập trực tiếp "Được duyệt" —
          // số duyệt chỉ đổi qua đề xuất ngân sách được Owner duyệt. Ở đây chỉ
          // hiển thị dấu duyệt hiện tại (chỉ-đọc) + nút mở form đề xuất.
          '<div class="fld wide"><span>Được duyệt</span>' + budgetLineApprovalBlockHtml(b) +
          (e.id && can('budget.propose') ? '<p style="margin:4px 0"><button type="button" class="btn small" data-action="editor-open" data-kind="budgetProposal" data-line="' + esc(b.id) + '" data-campaign="' + esc(b.campaignId || '') + '" data-target-type="budget_line">Đề xuất duyệt</button></p>' : (e.id ? '' : '<p class="sub" style="margin:2px 0">Dòng mới chưa có số duyệt — tạo dòng xong mới đề xuất duyệt được.</p>')) + '</div>' +
          F('currency', 'Tiền tệ', 'select', ev('currency', b.currency || 'VND'), { options: [['VND', 'VND'], ['USD', 'USD']] }),
          'Lưu dòng ngân sách');
      }
      case 'budgetProposal': {
        var bpCampId = ev('proposalCampaignId', e.context.campaignId || '');
        var bpLineId0 = ev('budgetLineId', e.context.budgetLineId || '');
        var bpLine0 = bpLineId0 ? Store.get('budgetLines', bpLineId0) : null;
        if (!bpCampId && bpLine0 && bpLine0.campaignId) bpCampId = bpLine0.campaignId;
        var bpTargetType = ev('targetType', e.context.targetType || (bpLineId0 ? 'budget_line' : 'campaign_ceiling'));
        var bpCamp0 = bpCampId ? Store.get('campaigns', bpCampId) : null;
        var bpLines = visibleList('budgetLines').filter(function (x) { return !bpCampId || x.campaignId === bpCampId; });
        var bpCurrent = null; var bpCurrency = 'VND';
        if (bpTargetType === 'budget_line' && bpLine0) { bpCurrent = budgetLineApprovedAmount(bpLine0); bpCurrency = bpLine0.currency || 'VND'; }
        else if (bpCamp0) { var bpCeil = campaignCeilingValue(bpCamp0); bpCurrent = bpCeil ? bpCeil.amount : null; bpCurrency = (bpCeil && bpCeil.currency) || bpCamp0.budgetCeilingCurrency || 'VND'; }
        var bpTargetLabel = bpTargetType === 'budget_line'
          ? ('Dòng ngân sách: ' + (bpLine0 ? bpLine0.name : '— chọn dòng bên dưới —') + (bpCamp0 ? ' — ' + bpCamp0.name : ''))
          : ('Hạn mức campaign: ' + (bpCamp0 ? bpCamp0.name : '— chọn campaign bên dưới —'));
        return formShell('budgetProposal', 'Đề xuất ngân sách',
          '<div class="fld wide"><span>Ngữ cảnh đối tượng</span><p class="sub" style="margin:2px 0"><strong>' + esc(bpTargetLabel) + '</strong></p>' +
          '<p class="sub" style="margin:2px 0">Hiện tại: <strong>' + (bpCurrent === null ? 'chưa có' : fmtMoney(bpCurrent, bpCurrency)) + '</strong> → Đề xuất: nhập số ở ô "Số đề xuất" bên dưới.</p></div>' +
          F('proposalCampaignId', 'Campaign *', 'select', bpCampId, { options: campaignPairs(), emptyLabel: '— Chọn campaign —', attrs: ' data-refresh-editor="1"' }) +
          F('targetType', 'Đối tượng đề xuất', 'select', bpTargetType, { options: [['campaign_ceiling', 'Hạn mức campaign'], ['budget_line', 'Dòng ngân sách']], attrs: ' data-refresh-editor="1"' }) +
          F('budgetLineId', 'Dòng ngân sách (khi đối tượng là dòng)', 'select', bpLineId0, { options: bpLines.map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn dòng —', attrs: ' data-refresh-editor="1"' }) +
          F('proposedAmount', 'Số đề xuất *', 'number', ev('proposedAmount', ''), { required: true, min: 0, step: 'any' }) +
          F('currency', 'Tiền tệ', 'select', ev('currency', bpCurrency), { options: [['VND', 'VND'], ['USD', 'USD']], help: 'Điền sẵn theo tiền tệ của đối tượng — đổi chỉ khi đề xuất dùng tiền tệ khác.' }) +
          F('reason', 'Lý do', 'textarea', ev('reason', ''), { wide: true, rows: 3, placeholder: 'Vì sao cần duyệt số này?' }),
          'Gửi đề xuất');
      }
      case 'allocation': {
        var srcKind = ev('sourceKind', e.context.sourceKind || 'actual');
        var srcId = ev('sourceId', e.context.sourceId || '');
        var srcList = srcKind === 'commitment' ? Store.list('commitments') : Store.list('actuals');
        var srcItem = srcList.find(function (x) { return x.id === srcId; }) || {};
        var existingAllocs = srcId ? (hasFn('listAllocationsForSource') ? Store.listAllocationsForSource(srcKind, srcId) : listSafe('budgetAllocations').filter(function (a) { return (a.sourceKind || 'actual') === srcKind && String(srcKind === 'actual' ? (a.actualId || a.actual_id) : (a.commitmentId || a.commitment_id)) === String(srcId); })) : [];
        return formShell('allocation', 'Phân bổ chi chung — chia một khoản cho nhiều activity',
          F('sourceKind', 'Loại khoản nguồn', 'select', srcKind, { options: [['actual', 'Khoản chi thực tế (actual)'], ['commitment', 'Cam kết (commitment)']], attrs: ' data-refresh-editor="1"' }) +
          F('sourceId', 'Khoản nguồn *', 'select', srcId, { options: srcList.map(function (x) { return [x.id, (x.title || '—') + ' — ' + fmtMoney(x.amount, x.currency)]; }), emptyLabel: '— Chọn khoản nguồn —', attrs: ' data-refresh-editor="1"' }) +
          (srcId ? '<div class="fld wide"><span>Tình trạng phân bổ của khoản nguồn</span><p class="sub" style="margin:2px 0">Số tiền gốc: <strong>' + fmtMoney(srcItem.amount, srcItem.currency) + '</strong>' + (existingAllocs.length ? ' · Đã phân bổ: ' + existingAllocs.map(function (a) { var aa = Store.get('activities', a.activityId); return esc(aa ? aa.name : (a.activityId || '—')) + ' = ' + (a.amount !== null && a.amount !== undefined ? fmtMoney(a.amount, srcItem.currency) : (a.sharePercent + '%')); }).join('; ') : ' · Chưa phân bổ cho hoạt động nào.') + '</p></div>' : '') +
          F('activityId', 'Phân bổ cho activity *', 'select', ev('activityId', ''), { options: visibleList('activities').map(function (x) { return [x.id, x.name + ' — ' + campaignName(x.campaignId)]; }), emptyLabel: '— Chọn activity —' }) +
          F('amount', 'Số tiền phân bổ', 'number', ev('amount', ''), { min: 0, step: 'any', help: 'Điền số tiền HOẶC tỷ lệ % bên dưới — tổng phân bổ không được vượt số tiền gốc / 100%.' }) +
          F('sharePercent', 'Tỷ lệ phân bổ (%)', 'number', ev('sharePercent', ''), { min: 0, step: 'any' }) +
          F('effectiveDate', 'Ngày hiệu lực', 'date', ev('effectiveDate', todayISO())),
          'Lưu phân bổ');
      }
      case 'commitment': {
        var cm = editorItem('commitments') || {};
        var cmLineId = ev('budgetLineId', cm.budgetLineId || e.context.budgetLineId || '');
        var cmLine = Store.get('budgetLines', cmLineId) || {};
        var cmCur = cmLine.currency || cm.currency || 'VND';
        // R2-01: form cam kết KHÔNG còn ô nhập số đã thanh toán — số đã trả chỉ
        // đến từ các khoản thanh toán (actuals) liên kết, hiển thị read-only.
        var paidHtml = '';
        if (e.id) {
          var cmActs = Store.list('actuals').filter(function (x) { return x.commitmentId === e.id; });
          var paidTotal = (typeof D.commitmentPaidTotal === 'function')
            ? D.commitmentPaidTotal(cm, cmActs)
            : cmActs.reduce(function (s, x) { return s + Number(x.amount || 0); }, 0);
          paidHtml = '<div class="fld wide"><span>Đã thanh toán (từ các khoản thanh toán)</span>' +
            '<p class="sub" style="margin:2px 0"><strong>' + fmtMoney(paidTotal, cmCur) + '</strong> — số này tự tính từ các khoản thanh toán đã ghi cho cam kết này; muốn ghi thêm, dùng nút "Ghi thanh toán" ở chi tiết dòng ngân sách.</p></div>';
        }
        return formShell('commitment', e.id ? 'Sửa cam kết chi' : 'Thêm cam kết chi',
          F('budgetLineId', 'Dòng ngân sách *', 'select', cmLineId, { options: visibleList('budgetLines').map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn dòng —', attrs: ' data-refresh-editor="1"' }) +
          F('title', 'Nội dung cam kết *', 'text', ev('title', cm.title), { required: true, wide: true }) +
          F('amount', 'Số tiền cam kết', 'number', ev('amount', cm.amount), { min: 0, step: 'any' }) +
          '<div class="fld"><span>Tiền tệ (theo dòng ngân sách)</span><p class="sub" style="margin:2px 0"><strong>' + esc(cmCur) + '</strong></p></div>' +
          F('status', 'Trạng thái', 'select', ev('status', cm.status || 'open'), { options: [['open', 'Đang mở'], ['partially_actualised', 'Thanh toán một phần'], ['settled', 'Đã thanh toán xong'], ['cancelled', 'Đã hủy']] }) +
          paidHtml,
          'Lưu cam kết');
      }
      case 'commitmentPayment': {
        var payCm = Store.get('commitments', e.context.commitmentId) || {};
        var payLine = Store.get('budgetLines', payCm.budgetLineId || e.context.budgetLineId) || {};
        var payCur = payLine.currency || payCm.currency || 'VND';
        return formShell('commitmentPayment', 'Ghi thanh toán — ' + (payCm.title || 'cam kết chi'),
          '<div class="fld wide"><span>Cam kết</span><p class="sub" style="margin:2px 0"><strong>' + esc(payCm.title || '—') + '</strong> · tổng cam kết ' + fmtMoney(payCm.amount, payCur) + ' · dòng ngân sách: ' + esc(payLine.name || '—') + '</p></div>' +
          F('title', 'Nội dung khoản chi', 'text', ev('title', 'Thanh toán cho: ' + (payCm.title || 'cam kết chi')), { wide: true }) +
          F('amount', 'Số tiền lần thanh toán này *', 'number', ev('amount', ''), { required: true, min: 0, step: 'any' }) +
          '<div class="fld"><span>Tiền tệ (theo dòng ngân sách)</span><p class="sub" style="margin:2px 0"><strong>' + esc(payCur) + '</strong></p></div>' +
          F('date', 'Ngày thanh toán', 'date', ev('date', todayISO())) +
          F('description', 'Ghi chú / Chứng từ', 'text', ev('description', ''), { wide: true }),
          'Lưu thanh toán');
      }
      case 'actual': {
        var ac = editorItem('actuals') || {};
        var lineId = ev('budgetLineId', ac.budgetLineId || e.context.budgetLineId);
        var acLine = Store.get('budgetLines', lineId) || {};
        var acCur = acLine.currency || ac.currency || 'VND';
        return formShell('actual', e.id ? 'Sửa khoản chi thực tế' : 'Ghi khoản chi thực tế',
          F('budgetLineId', 'Dòng ngân sách *', 'select', lineId, { options: visibleList('budgetLines').map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn dòng —', attrs: ' data-refresh-editor="1"' }) +
          F('commitmentId', 'Cam kết liên quan (nếu có)', 'select', ev('commitmentId', ac.commitmentId), { options: visibleList('commitments').filter(function (x) { return !lineId || x.budgetLineId === lineId; }).map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không gắn cam kết —' }) +
          F('title', 'Nội dung khoản chi *', 'text', ev('title', ac.title), { required: true, wide: true }) +
          F('amount', 'Số tiền', 'number', ev('amount', ac.amount), { min: 0, step: 'any' }) +
          '<div class="fld"><span>Tiền tệ (theo dòng ngân sách)</span><p class="sub" style="margin:2px 0"><strong>' + esc(acCur) + '</strong></p></div>' +
          F('date', 'Ngày chi', 'date', ev('date', ac.date || todayISO())) +
          // R2-09: nguồn là enum cố định, không còn text tự do.
          F('source', 'Nguồn chi', 'select', ev('source', ac.source || 'manual'), { options: [['manual', 'Nhập tay'], ['invoice', 'Hóa đơn'], ['import', 'Nhập từ file']] }) +
          F('description', 'Số chứng từ / ghi chú', 'text', ev('description', ac.description || ''), { wide: true, help: 'Ô Ghi chú / Chứng từ — tách riêng khỏi ô Nội dung khoản chi ở trên, hai ô lưu hai trường khác nhau.' }),
          'Lưu khoản chi');
      }
      case 'post': {
        var po = editorItem('externalPosts') || {};
        return formShell('post', e.id ? 'Sửa Post (nhập tay)' : 'Thêm Post (nhập tay)',
          F('platform', 'Kênh', 'select', ev('platform', po.platform || 'facebook'), { options: PLATFORMS }) +
          F('channelAccountId', 'Tài khoản kênh', 'select', ev('channelAccountId', po.channelAccountId), { options: Store.list('channelAccounts').map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn tài khoản —' }) +
          F('externalPostId', 'Mã bài trên nền tảng *', 'text', ev('externalPostId', po.externalPostId), { required: true }) +
          F('title', 'Tiêu đề *', 'text', ev('title', po.title), { required: true, wide: true }) +
          F('url', 'Đường dẫn bài', 'url', ev('url', po.url), { wide: true }) +
          F('publishedAt', 'Ngày đăng', 'datetime-local', ev('publishedAt', toDatetimeLocalValue(po.publishedAt))) +
          F('contentItemId', 'Content gốc của publication này', 'select', ev('contentItemId', po.contentItemId || e.context.contentItemId || ''), { options: visibleList('contentItems').map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Chưa gắn content gốc —' }) +
          F('variantId', 'Phiên bản theo kênh của publication này', 'select', ev('variantId', po.variantId || ''), { options: Store.list('variants').map(function (x) { return [x.id, contentTitle(x.contentItemId) + ' — ' + (x.channelLabel || labelStatus(x.platform))]; }), emptyLabel: '— Chưa gắn phiên bản —', help: 'Đăng lại (repost) = tạo một post/publication MỚI ở đây — không sửa đè link/số liệu của publication trước.' }) +
          F('campaignId', 'Campaign của publication này', 'select', ev('campaignId', po.campaignId), { options: campaignPairs(), emptyLabel: '— Không thuộc campaign —', help: 'Campaign lưu ở PUBLICATION: khi dùng lại content thường xuyên cho một campaign, chọn campaign tại đây — campaign của content gốc KHÔNG bị đổi.' }),
          'Lưu bài');
      }
      case 'adcr': {
        var r = editorItem('adChangeRequests') || {};
        var objects = [];
        Store.list('adCampaigns').forEach(function (x) { objects.push(['ad_campaign:' + x.id, 'Chiến dịch quảng cáo — ' + x.name]); });
        Store.list('adSets').forEach(function (x) { objects.push(['ad_group:' + x.id, 'Nhóm quảng cáo — ' + x.name]); });
        Store.list('ads').forEach(function (x) { objects.push(['ad:' + x.id, 'Quảng cáo — ' + x.name]); });
        return formShell('adcr', e.id ? 'Sửa yêu cầu thay đổi quảng cáo' : 'Tạo yêu cầu thay đổi quảng cáo',
          F('adAccountId', 'Tài khoản quảng cáo *', 'select', ev('adAccountId', r.adAccountId), { options: Store.list('adAccounts').map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn tài khoản —' }) +
          F('object', 'Đối tượng thay đổi *', 'select', ev('object', r.objectType && r.objectId ? r.objectType + ':' + r.objectId : ''), { options: objects, emptyLabel: '— Chọn đối tượng —' }) +
          F('changeType', 'Loại thay đổi', 'select', ev('changeType', r.changeType || 'budget'), { options: [['budget', 'Đổi ngân sách'], ['status', 'Bật/tạm dừng'], ['targeting', 'Đổi đối tượng'], ['creative', 'Đổi nội dung quảng cáo'], ['schedule', 'Đổi lịch'], ['other', 'Khác']] }) +
          F('beforeState', 'Trạng thái / giá trị trước', 'textarea', ev('beforeState', r.beforeState || r.before), { wide: true }) +
          F('afterState', 'Trạng thái / giá trị sau', 'textarea', ev('afterState', r.afterState || r.after), { wide: true }) +
          F('amount', 'Số tiền liên quan', 'number', ev('amount', r.amount), { min: 0, step: 'any' }) +
          F('currency', 'Tiền tệ', 'select', ev('currency', r.currency || 'VND'), { options: [['VND', 'VND'], ['USD', 'USD']] }) +
          F('scheduledAt', 'Lịch áp dụng dự kiến', 'datetime-local', ev('scheduledAt', toDatetimeLocalValue(r.scheduledAt))) +
          F('reason', 'Lý do thay đổi', 'textarea', ev('reason', r.reason), { wide: true }),
          'Lưu yêu cầu');
      }
      case 'bu': {
        var bu = editorItem('businessUnits') || {};
        return formShell('bu', e.id ? 'Sửa BU / sản phẩm' : 'Thêm BU / sản phẩm',
          F('name', 'Tên BU *', 'text', ev('name', bu.name), { required: true, wide: true }) +
          F('products', 'Sản phẩm (mỗi dòng một sản phẩm)', 'textarea', ev('products', (bu.products || []).join('\n')), { wide: true, rows: 4 }) +
          F('description', 'Mô tả', 'textarea', ev('description', bu.description), { wide: true }),
          'Lưu BU');
      }
      case 'memberCap': {
        var m = Store.get('members', e.context.memberId) || {};
        return formShell('memberCap', 'Năng lực & ngày nghỉ — ' + (m.name || ''),
          F('capacityHoursPerWeek', 'Số giờ có thể nhận task mỗi tuần', 'number', ev('capacityHoursPerWeek', m.capacityHoursPerWeek), { min: 0, step: 1 }) +
          F('daysOff', 'Ngày nghỉ (yyyy-mm-dd, cách nhau bằng dấu phẩy)', 'text', ev('daysOff', (m.daysOff || []).join(', ')), { wide: true }),
          'Lưu thiết lập');
      }
      case 'invite': {
        return formShell('invite', 'Mời thành viên',
          F('email', 'Email *', 'email', ev('email', ''), { required: true, wide: true }) +
          F('role', 'Vai trò', 'select', ev('role', 'member'), { options: [['owner', 'Owner'], ['lead', 'Lead'], ['member', 'Member'], ['ceo', 'CEO (chỉ xem)']] }) +
          '<p class="sub">Lời mời được gửi qua hệ thống tài khoản của workspace; người nhận tự đặt mật khẩu từ liên kết trong email.</p>',
          'Gửi lời mời');
      }
      case 'tiktokMetric': {
        var vt = Store.get('variants', e.context.variantId) || {};
        return formShell('tiktokMetric', 'Nhập số liệu TikTok — ' + contentTitle(vt.contentItemId),
          F('metric', 'Chỉ số *', 'text', ev('metric', 'views'), { required: true, placeholder: 'views, likes, comments, shares…' }) +
          F('value', 'Giá trị *', 'number', ev('value', ''), { required: true, step: 'any' }) +
          F('source', 'Nguồn số liệu *', 'text', ev('source', ''), { required: true, placeholder: 'Ví dụ: TikTok Studio, chụp màn hình…' }) +
          F('observedAt', 'Thời điểm quan sát *', 'datetime-local', ev('observedAt', ''), { required: true }),
          'Lưu số liệu');
      }
      case 'snapshot': {
        return formShell('snapshot', 'Chốt báo cáo (snapshot)',
          F('title', 'Tên báo cáo *', 'text', ev('title', 'Báo cáo ' + D.formatDateVN(todayISO())), { required: true, wide: true }) +
          F('summary', 'Nhận xét chính', 'textarea', ev('summary', ''), { wide: true, rows: 4, help: 'Cấu trúc gợi ý: Số liệu thay đổi → lý do đã biết/giả thuyết → task cần làm.' }),
          'Chốt báo cáo');
      }
    }
    return '';
  }

  function validateDateRange(errors, start, end, startName, endName) {
    if (start && end && String(end) < String(start)) { errors[endName || 'endDate'] = 'Ngày kết thúc phải sau ngày bắt đầu.'; return false; }
    return true;
  }
  function finishSave(okMsg, after) {
    closeEditor();
    if (okMsg) toast(okMsg);
    render();
    if (after) after();
  }

  // R3.1: mẫu campaign Livestream — 4 hoạt động + gợi ý task/KPI/phân bổ.
  // Phân bổ chỉ là DỰ THẢO (planned, approved để trống), KHÔNG tạo khoản
  // chi/thanh toán thật và KHÔNG đánh dấu đã duyệt.
  var LIVESTREAM_TEMPLATE = [
    { name: 'Mời khách mời', channel: 'Email / điện thoại', alloc: 8000000, taskTitle: 'Lập shortlist, liên hệ và chốt lịch khách mời', kpiName: 'Khách mời xác nhận', kpiTarget: 2, kpiUnit: 'khách', metricCode: 'confirmed_guests' },
    { name: 'Chạy ads', channel: 'Meta Ads', alloc: 15000000, taskTitle: 'Thiết lập và theo dõi chiến dịch quảng cáo livestream', kpiName: 'Đăng ký hợp lệ từ ads', kpiTarget: 120, kpiUnit: 'đăng ký', metricCode: 'valid_registrations' },
    { name: 'Seeding', channel: 'Cộng đồng', alloc: 5000000, taskTitle: 'Soạn và đăng bài seeding vào các cộng đồng', kpiName: 'Đăng ký hợp lệ từ seeding', kpiTarget: 80, kpiUnit: 'đăng ký', metricCode: 'valid_registrations' },
    { name: 'Tổ chức livestream', channel: 'Livestream', alloc: 2000000, taskTitle: 'Kịch bản, chạy thử và tổ chức buổi livestream', kpiName: 'Phiên livestream hoàn tất', kpiTarget: 1, kpiUnit: 'phiên', metricCode: 'livestream_sessions' }
  ];
  function createLivestreamChildren(campaignId, allocs, doneCb) {
    var idx = 0;
    function next() {
      if (idx >= LIVESTREAM_TEMPLATE.length) { doneCb(); return; }
      var tpl = LIVESTREAM_TEMPLATE[idx];
      var alloc = (allocs && allocs[idx] !== null && allocs[idx] !== undefined && !isNaN(Number(allocs[idx]))) ? Number(allocs[idx]) : tpl.alloc;
      idx++;
      saveResult(sCreate('activities', { name: tpl.name, channel: tpl.channel, campaignId: campaignId, ownerId: Store.currentUserId }), function (r) {
        var actId = r && r.item ? r.item.id : null;
        var jobs = [];
        if (actId) {
          jobs.push(function (n) { saveResult(sCreate('budgetLines', { name: 'Phân bổ dự thảo — ' + tpl.name, campaignId: campaignId, activityId: actId, planned: alloc, approved: null, currency: 'VND' }), n, n); });
          jobs.push(function (n) { saveResult(sCreate('tasks', { title: tpl.taskTitle, campaignId: campaignId, activityId: actId, assigneeId: Store.currentUserId, ownerId: Store.currentUserId, status: 'todo', priority: 'Trung bình', checklist: [] }), n, n); });
          jobs.push(function (n) { saveResult(sCreate('kpis', { name: tpl.kpiName, campaignId: campaignId, activityId: actId, scopeType: 'activity', metricCode: tpl.metricCode, target: tpl.kpiTarget, unit: tpl.kpiUnit, aggregationMode: 'manual' }), n, n); });
        }
        (function step() { var j = jobs.shift(); if (!j) { next(); return; } j(step); })();
      }, function () { next(); });
    }
    next();
  }
  // Đồng bộ kpiContributions cho 1 KPI: gỡ nguồn không còn chọn, thêm nguồn mới.
  function syncKpiContributions(kpiId, sourceIds, mode, doneCb) {
    var existing = listSafe('kpiContributions').filter(function (x) { return x.kpiId === kpiId; });
    var jobs = [];
    existing.filter(function (x) { return sourceIds.indexOf(x.sourceKpiId) === -1; }).forEach(function (x) {
      jobs.push(function (n) { if (hasFn('remove')) saveResult(Store.remove('kpiContributions', x.id), n, n); else n(); });
    });
    sourceIds.filter(function (sid) { return !existing.some(function (x) { return x.sourceKpiId === sid; }); }).forEach(function (sid) {
      jobs.push(function (n) { saveResult(sCreate('kpiContributions', { kpiId: kpiId, sourceKpiId: sid, rule: mode || 'sum', dedupKeyField: 'identityKeys' }), n, n); });
    });
    (function step() { var j = jobs.shift(); if (!j) { doneCb(); return; } j(step); })();
  }

  function saveEditor(kind, data, form) {
    var e = UI.editor;
    if (e) e.values = data; // giữ lại giá trị đã nhập khi báo lỗi cạnh từng trường
    var errors = {};
    function req(name, label) { if (!data[name] || !String(data[name]).trim()) errors[name] = 'Bắt buộc nhập ' + label + '.'; }
    function done(result, okMsg, after) {
      saveResult(result, function () { finishSave(okMsg, after); }, function (msg) { editorFail(msg, errors); });
    }
    switch (kind) {
      case 'campaign': {
        req('name', 'tên campaign');
        validateDateRange(errors, data.startDate, data.endDate);
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ — xem lỗi ngay dưới từng trường.', errors);
        var audiences = String(data.audiences || '').split('\n').map(function (line) {
          var parts = line.split('|'); return { name: (parts[0] || '').trim(), description: (parts.slice(1).join('|') || '').trim() };
        }).filter(function (a) { return a.name; });
        // Baseline không còn đi qua form này (R2-28c) — patch không đụng
        // baselineStartDate/baselineEndDate để giữ nguyên bản đã chốt.
        // Hạn mức campaign cũng KHÔNG đi qua form này nữa (0014): form không
        // còn ô budgetCeiling/budgetCeilingCurrency nên obj không đọc/gửi hai
        // giá trị này — hạn mức chỉ đổi qua đề xuất được Owner duyệt (Store
        // cũng strip budget_ceiling_* ở tầng dữ liệu làm lớp chặn thứ hai).
        var obj = {
          name: data.name, status: data.status, statusLabel: labelStatus(data.status), ownerId: data.ownerId || null,
          businessUnitId: data.businessUnitId || null, product: data.product || '',
          startDate: data.startDate || null, endDate: data.endDate || null,
          why: data.why || '', businessGoal: data.businessGoal || '', marketingGoal: data.marketingGoal || '',
          desiredOutcome: data.desiredOutcome || '', audiences: audiences, audienceInsights: data.audienceInsights || '',
          bigIdea: data.bigIdea || '', keyMessage: data.keyMessage || '', creativeDirection: data.creativeDirection || '',
          risks: data.risks || '', lessons: data.lessons || ''
        };
        if (e.id) done(sUpdate('campaigns', e.id, obj), 'Đã lưu campaign.');
        else if (data.template === 'livestream') {
          var tplAllocs = [data.tplAlloc0, data.tplAlloc1, data.tplAlloc2, data.tplAlloc3];
          saveResult(sCreate('campaigns', obj), function (r) {
            var newId = r && r.item ? r.item.id : null;
            if (!newId) { finishSave('Đã tạo campaign.'); return; }
            createLivestreamChildren(newId, tplAllocs, function () {
              finishSave('Đã tạo campaign từ mẫu Livestream: 4 activity kèm task/KPI gợi ý và phân bổ dự thảo (chưa duyệt, chưa có khoản chi thật).');
            });
          }, function (msg) { editorFail(msg, errors); });
        }
        else done(sCreate('campaigns', obj), 'Đã tạo campaign.', null);
        return;
      }
      case 'phase': {
        req('name', 'tên giai đoạn'); validateDateRange(errors, data.startDate, data.endDate);
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var po = { name: data.name, startDate: data.startDate || null, endDate: data.endDate || null, ownerId: data.ownerId || null, campaignId: e.context.campaignId };
        if (e.id) done(sUpdate('phases', e.id, po), 'Đã lưu giai đoạn.'); else done(sCreate('phases', po), 'Đã thêm giai đoạn.');
        return;
      }
      case 'activity': {
        req('name', 'tên activity'); validateDateRange(errors, data.startDate, data.endDate);
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var ao = { name: data.name, phaseId: data.phaseId || null, channel: data.channel || '', ownerId: data.ownerId || null, status: data.status || null, startDate: data.startDate || null, endDate: data.endDate || null, objective: data.objective || '', deliverables: data.deliverables || '', campaignId: e.context.campaignId || (editorItem('activities') || {}).campaignId || null };
        if (e.id) done(sUpdate('activities', e.id, ao), 'Đã lưu activity.'); else done(sCreate('activities', ao), 'Đã thêm activity.');
        return;
      }
      case 'brandPage': {
        req('title', 'tiêu đề');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var cur = e.id ? Store.get('brandPages', e.id) : null;
        var bo = { title: data.title, summary: data.summary || '', content: data.content || '', ownerId: data.ownerId || null, tags: splitTags(data.tags), status: data.status, version: cur ? (Number(cur.version || 1) + 1) : 1, updatedAt: new Date().toISOString() };
        if (e.id) done(sUpdate('brandPages', e.id, bo), 'Đã lưu trang (phiên bản ' + bo.version + ').'); else done(sCreate('brandPages', bo), 'Đã thêm trang thương hiệu.');
        return;
      }
      case 'brandAsset': {
        req('name', 'tên tài nguyên');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var cura = e.id ? Store.get('brandAssets', e.id) : null;
        var ao2 = { name: data.name, type: data.type || 'Khác', externalUrl: data.url || '', url: data.url || '', fileUrl: data.url || '', ownerId: data.ownerId || null, tags: splitTags(data.tags), status: data.status, version: cura ? (Number(cura.version || 1) + 1) : 1, updatedAt: new Date().toISOString() };
        if (e.id) done(sUpdate('brandAssets', e.id, ao2), 'Đã lưu tài nguyên (phiên bản ' + ao2.version + ').'); else done(sCreate('brandAssets', ao2), 'Đã thêm tài nguyên.');
        return;
      }
      case 'task': {
        req('title', 'tên task'); validateDateRange(errors, data.startDate, data.dueDate, 'startDate', 'dueDate');
        if (data.parentId && e.id && data.parentId === e.id) errors.parentId = 'Task không thể là task cha của chính nó.';
        // R2-27: validate liên kết phase/activity phải thuộc đúng campaign/phase.
        var vPhase = data.phaseId ? Store.get('phases', data.phaseId) : null;
        if (data.phaseId && (!vPhase || (data.campaignId && vPhase.campaignId !== data.campaignId))) errors.phaseId = 'Giai đoạn đã chọn không thuộc campaign này.';
        var vAct = data.activityId ? Store.get('activities', data.activityId) : null;
        if (data.activityId) {
          if (!vAct) errors.activityId = 'Activity đã chọn không tồn tại.';
          else {
            if (data.campaignId && vAct.campaignId !== data.campaignId) errors.activityId = 'Activity đã chọn không thuộc campaign này.';
            if (data.phaseId && vAct.phaseId !== data.phaseId) errors.activityId = 'Activity đã chọn không thuộc giai đoạn đã chọn.';
          }
        }
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ — xem lỗi ngay dưới từng trường.', errors);
        var mileEl = form ? form.querySelector('[name="isMilestone"]') : null;
        var to = {
          title: data.title, campaignId: data.campaignId || null, parentId: data.parentId || null,
          phaseId: data.phaseId || null, activityId: data.activityId || null,
          isMilestone: mileEl ? !!mileEl.checked : !!data.isMilestone,
          assigneeId: data.assigneeId || null, ownerId: data.assigneeId || null, status: data.status,
          priority: data.priority, startDate: data.startDate || null, dueDate: data.dueDate || null,
          effortHours: data.effortHours ? Number(data.effortHours) : null,
          deliverable: data.deliverable || '', description: data.description || ''
        };
        if (e.id) done(sUpdate('tasks', e.id, to), 'Đã lưu task.');
        else done(sCreate('tasks', Object.assign({ checklist: [] }, to)), 'Đã tạo task.');
        return;
      }
      case 'pillar': {
        req('name', 'tên pillar');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        // Archive qua status='archived' HOẶC nút Lưu trữ (archived_at ở Store):
        // cả hai đều GIỮ ID + lịch sử phân loại — không xóa cứng pillar.
        var plo = { name: data.name, buProductId: data.buProductId || null, description: data.description || '', classificationGuide: data.classificationGuide || '', status: data.status || 'active' };
        if (e.id) done(sUpdate('contentPillars', e.id, plo), 'Đã lưu pillar.'); else done(sCreate('contentPillars', plo), 'Đã tạo pillar.');
        return;
      }
      case 'content': {
        req('title', 'tiêu đề content');
        // R3.1: campaign là TÙY CHỌN — chỉ báo lỗi khi người dùng chọn tường
        // minh "Thuộc campaign" mà chưa chọn campaign cụ thể. Thiếu pillar
        // KHÔNG phải lỗi: nội dung nằm ở Backlog / Chờ phân loại.
        var cChoice = data.campaignChoice || (data.campaignId ? 'campaign' : 'unset');
        if (cChoice === 'campaign' && !data.campaignId) errors.campaignId = 'Đã chọn "Thuộc campaign" — hãy chọn campaign cụ thể, hoặc đổi sang "Content thường xuyên — không thuộc campaign".';
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var curCi = editorItem('contentItems') || {};
        var alwaysEl = form ? form.querySelector('[name="alwaysOn"]') : null;
        var everEl = form ? form.querySelector('[name="evergreen"]') : null;
        var co = {
          title: data.title, type: data.type,
          buProductId: data.buProductId || null, product: data.product || '',
          pillarId: data.pillarId || null,
          campaignId: cChoice === 'campaign' ? data.campaignId : null, campaignChoice: cChoice,
          angle: data.angle || '', goal: data.goal || '', objective: data.goal || '',
          ownerId: data.ownerId || null,
          productionDeadline: data.productionDeadline || null,
          brief: data.brief || '', description: data.brief || '', assetUrl: data.assetUrl || '',
          editorialStatus: data.editorialStatus || curCi.editorialStatus || 'draft',
          status: data.editorialStatus || curCi.editorialStatus || 'draft',
          series: data.series || '', audience: data.audience || '',
          sourceContentId: data.sourceContentId || null,
          activityId: data.activityId || null, taskId: data.taskId || null,
          tags: splitTags(data.tags),
          alwaysOn: alwaysEl ? !!alwaysEl.checked : !!data.alwaysOn,
          evergreen: everEl ? !!everEl.checked : !!data.evergreen,
          expiresAt: data.expiresAt || null,
          // Giữ nguyên ngày dự kiến cũ của nội dung gốc khi sửa (ngày đăng
          // thật thuộc TỪNG lần đăng/variant, không phải của nội dung gốc).
          scheduledDate: e.id ? (curCi.scheduledDate || null) : null
        };
        if (e.id) done(sUpdate('contentItems', e.id, co), 'Đã lưu content.'); else done(sCreate('contentItems', co), 'Đã tạo content (nằm ở Backlog nếu chưa có lịch đăng).');
        return;
      }
      case 'variant': {
        req('contentItemId', 'content gốc');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var vo = {
          contentItemId: data.contentItemId, platform: data.platform,
          channelLabel: labelStatus(data.platform), channelAccountId: data.channelAccountId || null,
          ownerId: data.ownerId || null, reviewerId: data.reviewerId || null,
          productionDeadline: data.productionDeadline || null, reviewDeadline: data.reviewDeadline || null,
          scheduledAt: data.scheduledAt ? fromDatetimeLocalValue(data.scheduledAt) : null,
          campaignId: data.campaignId || null,
          editorialStatus: data.editorialStatus, caption: data.caption || '', hashtags: data.hashtags || '',
          brief: data.brief || '', mediaUrl: data.mediaUrl || '', linkUrl: data.linkUrl || '', script: data.script || ''
        };
        if (data.platform === 'tiktok') {
          vo.publishMode = 'external';
          vo.hook = data.hook || ''; vo.cta = data.cta || '';
          vo.scriptScenes = readScenes(form);
          vo.externalUrl = data.externalUrl || '';
          vo.actualPublishedAt = data.actualPublishedAt ? fromDatetimeLocalValue(data.actualPublishedAt) : null;
          if (vo.externalUrl) vo.externalStatus = 'Đã đăng ngoài app';
        }
        if (e.id) done(sUpdate('variants', e.id, vo), 'Đã lưu phiên bản theo kênh.');
        else done(sCreate('variants', Object.assign({ revision: 1, approvalStatus: 'draft', publishMode: data.platform === 'tiktok' ? 'external' : 'app' }, vo)), 'Đã tạo phiên bản theo kênh.');
        return;
      }
      case 'kpi': {
        req('name', 'tên KPI');
        validateDateRange(errors, data.periodStart, data.periodEnd, 'periodStart', 'periodEnd');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var periodLabel = (data.periodStart || data.periodEnd)
          ? (D.formatDateVN(data.periodStart) || '…') + ' — ' + (D.formatDateVN(data.periodEnd) || '…')
          : '';
        var scopeType = data.scopeType || 'campaign';
        // R3.1: scope quyết định bộ FK — chọn activity thì campaign tự suy từ
        // activity (store cũng kiểm tra mâu thuẫn R31_SCOPE ở tầng dữ liệu).
        var koCampaign = data.campaignId || null;
        var koActivity = scopeType === 'activity' || scopeType === 'task' ? (data.activityId || null) : null;
        if (scopeType === 'activity' && koActivity) { var kAct = Store.get('activities', koActivity); if (kAct && kAct.campaignId) koCampaign = kAct.campaignId; }
        var koTask = scopeType === 'task' ? (data.taskId || null) : null;
        if (koTask) { var kTask = taskById(koTask); if (kTask) { if (kTask.campaignId) koCampaign = kTask.campaignId; if (kTask.activityId) koActivity = kTask.activityId; } }
        // definition: MERGE vào definition hiện có (giữ các field khác +
        // description) rồi đặt/gỡ dataSource theo "Nguồn số liệu" đã chọn —
        // không ghi đè mất field cũ khi bật/tắt nguồn tự động.
        var existingKpiForDef = e.id ? (Store.get('kpis', e.id) || {}) : {};
        var koDefinition = Object.assign({}, kpiDefinitionObject(existingKpiForDef));
        if (data.definition) koDefinition.description = data.definition;
        var koIsAuto = data.dataSourceType === 'post_metrics';
        if (koIsAuto) {
          koDefinition.dataSource = { type: 'post_metrics', metric: data.dataSourceMetric || 'lifetime_views', mode: data.dataSourceMode || 'latest_sum' };
        } else {
          delete koDefinition.dataSource;
        }
        var ko = {
          name: data.name, scopeType: scopeType,
          campaignId: koCampaign, activityId: koActivity, taskId: koTask,
          contentItemId: scopeType === 'content' ? (data.contentItemId || null) : null,
          pillarId: scopeType === 'pillar' ? (data.pillarId || null) : null,
          metricCode: data.metricCode || (koIsAuto ? (data.dataSourceMetric || null) : null),
          aggregationMode: data.aggregationMode || 'direct',
          numerator: (data.numerator === '' || data.numerator === null || data.numerator === undefined) ? null : Number(data.numerator),
          denominator: (data.denominator === '' || data.denominator === null || data.denominator === undefined) ? null : Number(data.denominator),
          target: data.target ? Number(data.target) : null, unit: data.unit || '',
          direction: data.direction || 'increase',
          definition: koDefinition,
          period: periodLabel, periodStart: data.periodStart || null, periodEnd: data.periodEnd || null,
          ownerId: data.ownerId || null
        };
        var srcSel = form ? form.querySelector('[name="sourceKpiIds"]') : null;
        var srcIds = [];
        if (srcSel && srcSel.selectedOptions) { for (var si = 0; si < srcSel.selectedOptions.length; si++) srcIds.push(srcSel.selectedOptions[si].value); }
        else if (data.sourceKpiIds) srcIds = [data.sourceKpiIds];
        function afterKpi(r) {
          var kid = (r && r.item && r.item.id) || e.id;
          if (!kid) { finishSave('Đã lưu KPI.'); return; }
          syncKpiContributions(kid, srcIds, ko.aggregationMode, function () { finishSave(e.id ? 'Đã lưu KPI.' : 'Đã tạo KPI.'); });
        }
        if (e.id) saveResult(sUpdate('kpis', e.id, ko), afterKpi, function (msg) { editorFail(msg, errors); });
        else saveResult(sCreate('kpis', ko), afterKpi, function (msg) { editorFail(msg, errors); });
        return;
      }
      case 'measurement': {
        var measureKpi = Store.get('kpis', e.context.kpiId) || {};
        if (isKpiAuto(measureKpi)) return editorFail('KPI này lấy số tự động từ post — số sẽ cập nhật khi bộ đếm của post thay đổi. (KPI_AUTO_SOURCE)', errors);
        req('value', 'giá trị'); req('source', 'nguồn số liệu');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var when = data.measuredAt ? new Date(data.measuredAt + 'T00:00:00').toISOString() : new Date().toISOString();
        done(sUpdate('kpis', e.context.kpiId, { actual: Number(data.value), source: data.source, updatedAt: when }), 'Đã lưu số đo mới cho KPI.');
        return;
      }
      case 'budgetLine': {
        req('name', 'tên dòng ngân sách');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        // 0014 (quy tắc mới của Zac): approved KHÔNG đi qua form này nữa —
        // store cũng strip approved_* khỏi mọi payload thường; số duyệt chỉ
        // đổi qua Store.createBudgetProposal + Owner quyết định. planned giữ
        // nguyên quy tắc độc lập (trống = null, không lấp bằng số khác).
        var blo = { name: data.name, campaignId: data.campaignId || null, activityId: data.activityId || null, taskId: data.taskId || null, planned: (data.planned === '' || data.planned === null || data.planned === undefined) ? null : Number(data.planned), currency: data.currency };
        if (e.id) done(sUpdate('budgetLines', e.id, blo), 'Đã lưu dòng ngân sách.'); else done(sCreate('budgetLines', blo), 'Đã tạo dòng ngân sách.');
        return;
      }
      case 'budgetProposal': {
        req('proposalCampaignId', 'campaign');
        if (data.targetType === 'budget_line') req('budgetLineId', 'dòng ngân sách');
        if (data.proposedAmount === '' || data.proposedAmount === null || data.proposedAmount === undefined || isNaN(Number(data.proposedAmount)) || Number(data.proposedAmount) < 0) errors.proposedAmount = 'Số đề xuất phải là số ≥ 0.';
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        if (!hasFn('createBudgetProposal')) return editorFail('Tầng dữ liệu chưa hỗ trợ tạo đề xuất ngân sách.', errors);
        done(Store.createBudgetProposal({
          targetType: data.targetType === 'budget_line' ? 'budget_line' : 'campaign_ceiling',
          campaignId: data.proposalCampaignId || null,
          budgetLineId: data.targetType === 'budget_line' ? (data.budgetLineId || null) : null,
          amount: Number(data.proposedAmount),
          currency: data.currency || 'VND',
          reason: data.reason || ''
        }), 'Đã gửi đề xuất ngân sách — chờ Owner duyệt ở hàng đợi Ngân sách.');
        return;
      }
      case 'allocation': {
        req('sourceId', 'khoản nguồn'); req('activityId', 'activity');
        if (!data.amount && !data.sharePercent) errors.amount = 'Điền số tiền phân bổ hoặc tỷ lệ %.';
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var alKind = data.sourceKind === 'commitment' ? 'commitment' : 'actual';
        var alSrc = Store.get(alKind === 'actual' ? 'actuals' : 'commitments', data.sourceId);
        if (!alSrc) return editorFail('Không tìm thấy khoản nguồn để phân bổ.', errors);
        var alAct = Store.get('activities', data.activityId);
        // R3.1: validate bằng domain.validateAllocations TRƯỚC khi lưu —
        // vượt 100% / vượt tiền gốc thì báo lỗi rõ, không cho lưu.
        var alExisting = hasFn('listAllocationsForSource') ? Store.listAllocationsForSource(alKind, data.sourceId)
          : listSafe('budgetAllocations').filter(function (a) { return (a.sourceKind || 'actual') === alKind && String(alKind === 'actual' ? (a.actualId || a.actual_id) : (a.commitmentId || a.commitment_id)) === String(data.sourceId); });
        var alCandidate = { amount: data.amount ? Number(data.amount) : null, percent: data.sharePercent ? Number(data.sharePercent) : null };
        var alCheck = (typeof D.validateAllocations === 'function')
          ? D.validateAllocations(alSrc, alExisting.map(function (a) { return { amount: (a.amount === null || a.amount === undefined) ? null : Number(a.amount), percent: (a.sharePercent === null || a.sharePercent === undefined) ? null : Number(a.sharePercent) }; }).concat([alCandidate]))
          : { valid: true, errors: [] };
        if (!alCheck.valid) {
          return editorFail('Phân bổ không hợp lệ: tổng phân bổ (' + fmtNum(alCheck.totalAllocated) + ') vượt quá số tiền của khoản nguồn (' + fmtNum(alCheck.amount) + ') — ' + alCheck.errors.join(', ') + '. Hãy giảm số tiền/tỷ lệ rồi lưu lại.', errors);
        }
        var alo = {
          sourceKind: alKind,
          actualId: alKind === 'actual' ? data.sourceId : null,
          commitmentId: alKind === 'commitment' ? data.sourceId : null,
          campaignId: (alAct && alAct.campaignId) || alSrc.campaignId || null,
          activityId: data.activityId,
          amount: data.amount ? Number(data.amount) : null,
          sharePercent: data.sharePercent ? Number(data.sharePercent) : null,
          effectiveDate: data.effectiveDate || todayISO(),
          currency: alSrc.currency || 'VND'
        };
        // Lỗi backend (R31_ALLOC/R31_SCOPE/409) đi qua editorFail nguyên
        // thông điệp — không nuốt thành thông báo thành công giả.
        if (e.id) done(sUpdate('budgetAllocations', e.id, alo), 'Đã lưu phân bổ.'); else done(sCreate('budgetAllocations', alo), 'Đã lưu phân bổ chi chung.');
        return;
      }
      case 'commitment': {
        req('budgetLineId', 'dòng ngân sách'); req('title', 'nội dung cam kết');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        // R2-01: lưu cam kết CHỈ ghi budget_commitments — tuyệt đối không tự
        // tạo actual ở đây. Tiền tệ kế thừa từ dòng ngân sách đã chọn.
        var cmLine2 = Store.get('budgetLines', data.budgetLineId) || {};
        var cmo = { budgetLineId: data.budgetLineId, title: data.title, amount: data.amount ? Number(data.amount) : 0, currency: cmLine2.currency || 'VND', status: data.status };
        if (e.id) done(sUpdate('commitments', e.id, cmo), 'Đã lưu cam kết.');
        else done(sCreate('commitments', cmo), 'Đã thêm cam kết.');
        return;
      }
      case 'commitmentPayment': {
        // R2-01: ghi một khoản thanh toán = tạo 1 actual liên kết cam kết.
        var payCm2 = Store.get('commitments', e.context.commitmentId) || {};
        var payLine2 = Store.get('budgetLines', payCm2.budgetLineId || e.context.budgetLineId) || {};
        req('amount', 'số tiền thanh toán');
        if (data.amount && Number(data.amount) <= 0) errors.amount = 'Số tiền thanh toán phải lớn hơn 0.';
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var payObj = {
          budgetLineId: payLine2.id || payCm2.budgetLineId || null,
          commitmentId: payCm2.id || e.context.commitmentId || null,
          title: data.title || ('Thanh toán cho: ' + (payCm2.title || 'cam kết chi')),
          amount: Number(data.amount), currency: payLine2.currency || payCm2.currency || 'VND',
          date: data.date || todayISO(), source: 'manual', description: data.description || ''
        };
        done(sCreate('actuals', payObj), 'Đã ghi thanh toán cho cam kết.');
        return;
      }
      case 'actual': {
        req('budgetLineId', 'dòng ngân sách'); req('title', 'nội dung chi');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        // R2-09/10: currency kế thừa dòng ngân sách; source là enum; ghi chú vào description.
        var acLine2 = Store.get('budgetLines', data.budgetLineId) || {};
        var srcOk = ['manual', 'invoice', 'import'].indexOf(data.source) !== -1 ? data.source : 'manual';
        var aco = { budgetLineId: data.budgetLineId, commitmentId: data.commitmentId || null, title: data.title, amount: data.amount ? Number(data.amount) : 0, currency: acLine2.currency || 'VND', date: data.date || todayISO(), source: srcOk, description: data.description || '' };
        if (e.id) done(sUpdate('actuals', e.id, aco), 'Đã lưu khoản chi.'); else done(sCreate('actuals', aco), 'Đã ghi khoản chi thực tế.');
        return;
      }
      case 'post': {
        req('externalPostId', 'mã bài'); req('title', 'tiêu đề');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var poo = { platform: data.platform, channelAccountId: data.channelAccountId || null, externalPostId: data.externalPostId, title: data.title, url: data.url || '', publishedAt: data.publishedAt ? fromDatetimeLocalValue(data.publishedAt) : new Date().toISOString(), campaignId: data.campaignId || null, contentItemId: data.contentItemId || null, variantId: data.variantId || null, source: 'manual' };
        if (e.id) done(sUpdate('externalPosts', e.id, poo), 'Đã lưu post.'); else done(sCreate('externalPosts', poo), 'Đã thêm post (nguồn: nhập tay).');
        return;
      }
      case 'adcr': {
        req('adAccountId', 'tài khoản quảng cáo'); req('object', 'đối tượng thay đổi');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var parts = String(data.object || '').split(':');
        var objType = parts[0] || ''; var objId = parts.slice(1).join(':');
        var objName = objId;
        var collMap = { ad_campaign: 'adCampaigns', ad_group: 'adSets', ad: 'ads' };
        var rec = Store.get(collMap[objType] || 'ads', objId); if (rec) objName = rec.name;
        var aro = {
          title: 'Yêu cầu thay đổi: ' + objName, target: objName, adAccountId: data.adAccountId,
          objectType: objType, objectId: objId, changeType: data.changeType,
          beforeState: data.beforeState || '', afterState: data.afterState || '',
          before: data.beforeState || '', after: data.afterState || '',
          amount: data.amount ? Number(data.amount) : null, currency: data.currency,
          scheduledAt: data.scheduledAt ? fromDatetimeLocalValue(data.scheduledAt) : null,
          reason: data.reason || '', requestedBy: Store.currentUserId, createdAt: new Date().toISOString()
        };
        if (e.id) done(sUpdate('adChangeRequests', e.id, aro), 'Đã lưu yêu cầu thay đổi.');
        else done(sCreate('adChangeRequests', Object.assign({ status: 'draft', statusLabel: 'Nháp', defaultState: 'Tạm dừng (paused)' }, aro)), 'Đã tạo nháp yêu cầu thay đổi.');
        return;
      }
      case 'bu': {
        req('name', 'tên BU');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var buo = { name: data.name, products: String(data.products || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean), description: data.description || '' };
        if (e.id) done(sUpdate('businessUnits', e.id, buo), 'Đã lưu BU.'); else done(sCreate('businessUnits', buo), 'Đã thêm BU.');
        return;
      }
      case 'memberCap': {
        var days = String(data.daysOff || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        var badDay = days.find(function (x) { return !/^\d{4}-\d{2}-\d{2}$/.test(x); });
        if (badDay) errors.daysOff = 'Ngày nghỉ phải dạng yyyy-mm-dd: ' + badDay;
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        // R3.1/R3-09: capacity lưu qua Store.saveMemberCapacity (RPC/bản ghi
        // thật); để trống = chưa cấu hình, KHÔNG tự gán số giờ mặc định.
        if (hasFn('saveMemberCapacity') && data.capacityHoursPerWeek) {
          done(Store.saveMemberCapacity(e.context.memberId, { hoursPerWeek: Number(data.capacityHoursPerWeek), daysOff: days }), 'Đã lưu năng lực & ngày nghỉ.');
        } else if (hasFn('saveMemberCapacity')) {
          return editorFail('Hãy nhập số giờ/tuần để cấu hình năng lực — để trống nghĩa là "Chưa cấu hình", hệ thống không tự gán số giờ mặc định.', errors);
        } else {
          done(sUpdate('members', e.context.memberId, { capacityHoursPerWeek: data.capacityHoursPerWeek ? Number(data.capacityHoursPerWeek) : null, daysOff: days }), 'Đã lưu năng lực & ngày nghỉ.');
        }
        return;
      }
      case 'invite': {
        req('email', 'email');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        done(inviteCall({ email: data.email, role: data.role }), 'Đã gửi lời mời tới ' + data.email + '.');
        return;
      }
      case 'tiktokMetric': {
        req('metric', 'chỉ số'); req('value', 'giá trị'); req('source', 'nguồn'); req('observedAt', 'thời điểm quan sát');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        done(saveTiktokMetricsCall(e.context.variantId, { metric: data.metric, value: Number(data.value), observedAt: fromDatetimeLocalValue(data.observedAt) }, data.source), 'Đã lưu số liệu cho đúng video này.');
        return;
      }
      case 'snapshot': {
        req('title', 'tên báo cáo');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var metrics = (e.context && e.context.metrics) || {};
        done(sCreate('reportSnapshots', { title: data.title, summary: data.summary || '', frozenAt: new Date().toISOString(), status: 'Đã chốt', metrics: metrics, filter: (e.context && e.context.filter) || {} }), 'Đã chốt báo cáo.');
        return;
      }
    }
  }
  function splitTags(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

  // ---------- Panel chi tiết công việc (dùng chung mọi view) ----------
  function currentTaskPanelId() {
    if (UI.taskPanelId) return UI.taskPanelId;
    if (ROUTE.name === 'tasks' && ROUTE.id) return ROUTE.id;
    return null;
  }
  function openTaskPanel(id) {
    if (UI.taskPanelId !== id) { UI.taskDraft = null; UI.taskDraftConflict = false; }
    UI.lastFocusEl = document.activeElement || null;
    UI.taskPanelId = id;
    UI.taskPanelReturnHash = (window.location.hash && window.location.hash !== '#/tasks/' + id) ? window.location.hash : '#/tasks';
    try { window.history.replaceState(null, '', '#/tasks/' + id); } catch (e) {}
    renderOverlay();
  }
  function closeTaskPanel() {
    UI.taskPanelId = null;
    UI.taskDraft = null; UI.taskDraftConflict = false; UI.confirmClose = null;
    if (ROUTE.name === 'tasks' && ROUTE.id) { try { window.history.replaceState(null, '', '#/tasks'); } catch (e) {} ROUTE = parseRouteAfterReplace(); render(); restoreFocus(); return; }
    try { window.history.replaceState(null, '', UI.taskPanelReturnHash || '#/overview'); } catch (e) {}
    renderOverlay();
    restoreFocus();
  }
  function parseRouteAfterReplace() {
    var h = (window.location.hash || '#/overview').replace(/^#\/?/, '');
    var parts = h.split('/').filter(function (x) { return x !== ''; });
    return { name: parts[0] || 'overview', id: null, sub: null };
  }
  // ---------- Draft của panel công việc (R2-05) ----------
  // Mọi thao tác phụ trong panel (checklist/phụ thuộc/bình luận/gỡ trở ngại)
  // và mỗi lần Store notify đều render lại panel — draft giữ nguyên phần
  // người dùng đang gõ dở cho tới khi Lưu thành công / đóng panel / đổi việc.
  function panelValuesFromTask(t) {
    return {
      title: t.title || '', assigneeId: t.assigneeId || '', campaignId: t.campaignId || '',
      phaseId: t.phaseId || '', activityId: t.activityId || '', parentId: t.parentId || '',
      status: t.status || 'todo', priority: t.priority || 'Trung bình',
      startDate: t.startDate ? String(t.startDate).slice(0, 10) : '',
      dueDate: t.dueDate ? String(t.dueDate).slice(0, 10) : '',
      effortHours: (t.effortHours === null || t.effortHours === undefined) ? '' : String(t.effortHours),
      deliverable: t.deliverable || '', description: t.description || '',
      availabilityNote: t.availabilityNote || '', isMilestone: isMilestoneTask(t) ? '1' : ''
    };
  }
  function panelSnapshotOf(vals) {
    return Object.keys(vals).sort().map(function (k) { return k + '=' + vals[k]; }).join('&');
  }
  function captureTaskDraft() {
    var form = document.getElementById('task-panel-form');
    if (!form) return;
    var fd = new FormData(form);
    var vals = {};
    fd.forEach(function (v, k) { vals[k] = v; });
    var mile = form.querySelector('[name="isMilestone"]');
    vals.isMilestone = mile && mile.checked ? '1' : '';
    var tid = form.getAttribute('data-task-id');
    var t = taskById(tid);
    var prev = UI.taskDraft;
    UI.taskDraft = { taskId: tid, values: vals, baseUpdatedAt: t ? (t.updatedAt || null) : null };
    if (prev && prev.taskId !== tid) UI.taskDraftConflict = false;
  }
  function taskDraftIsDirty() {
    var d = UI.taskDraft;
    if (!d || !d.values) return false;
    var t = taskById(d.taskId);
    if (!t) return false;
    return panelSnapshotOf(d.values) !== panelSnapshotOf(panelValuesFromTask(t));
  }

  function taskPanelHtml() {
    var id = currentTaskPanelId();
    if (!id) return '';
    var t = taskById(id);
    if (!t) return '<div class="panel-backdrop" data-action="task-close"></div><aside class="detail-panel"><div class="modal-head"><h2>Task</h2><button class="btn secondary small" data-action="task-close">Đóng</button></div>' + emptyState('Không tìm thấy task', 'Task có thể đã bị lưu trữ hoặc không còn tồn tại.') + '</aside>';
    var edges = Store.list('dependencies');
    var tasks = Store.list('tasks');
    var preds = edges.filter(function (x) { return x.successorId === t.id; });
    var succs = edges.filter(function (x) { return x.predecessorId === t.id; });
    var subtasks = tasks.filter(function (x) { return x.parentId === t.id; });
    var checklist = t.checklist || [];
    var blockers = Store.list('blockers').filter(function (b) { return b.taskId === t.id; });
    var comments = [];
    try { comments = Store.list('comments').filter(function (c) { return c.taskId === t.id; }); } catch (e) { comments = []; }
    // Quyền sửa panel theo action của task (không dùng legacy 'edit' chung):
    // ed = sửa mọi trường (task.edit); statusEd = chỉ đổi trạng thái
    // (task.updateStatus); ro = chỉ đọc hoàn toàn khi thiếu cả hai (vd CEO).
    var ed = canEditTask();
    var statusEd = canUpdateTaskStatus();
    var commentEd = canEdit();
    var ro = taskPanelReadonly();
    var html = '<div class="panel-backdrop" data-action="task-close"></div><aside class="detail-panel" aria-label="Chi tiết task">';
    html += '<div class="modal-head"><div><h2>' + esc(t.title) + '</h2><p class="sub">' + esc(campaignName(t.campaignId)) + ' · ' + statusBadge(t.status) + (isOverdue(t) ? ' ' + vizStatusPillHtml('overdue', { label: 'Quá hạn', derived: true }) + '' : '') + '</p></div>' +
      '<button class="btn secondary small" data-action="task-close">Đóng ✕</button></div>';
    // R2-05: ưu tiên draft đang gõ dở khi render lại cùng một việc.
    var draft = (UI.taskDraft && UI.taskDraft.taskId === t.id) ? UI.taskDraft.values : null;
    function pv(name, fallback) { return draft && draft[name] !== undefined ? draft[name] : fallback; }
    html += taskReadonlyNote();
    if (UI.taskDraftConflict && draft) html += '<div class="notice warn" role="alert">Task này vừa được người khác cập nhật. Bản nháp bạn đang gõ được giữ nguyên — hãy đối chiếu trước khi bấm Lưu.</div>';
    if (!ro && !ed && statusEd) html += '<div class="notice info" role="note">Vai trò hiện tại chỉ đổi được trạng thái task — các ô khác đã bị khóa.</div>';
    html += '<div class="panel-meta">' + readinessBadge(t) +
      (preds.length ? ' <span class="sub">Đang chờ: ' + esc(preds.map(function (x) { var p = taskById(x.predecessorId); return p ? p.title : x.predecessorId; }).join(', ')) + '</span>' : '') +
      (succs.length ? '<br><span class="sub">Các task đang chờ mình: ' + esc(succs.map(function (x) { var p = taskById(x.successorId); return p ? p.title : x.successorId; }).join(', ')) + '</span>' : '') + '</div>';
    var panelCamp = pv('campaignId', t.campaignId || '');
    var panelPhase = pv('phaseId', t.phaseId || '');
    var panelPhases = panelCamp ? Store.list('phases').filter(function (x) { return x.campaignId === panelCamp; }) : [];
    var panelActs = Store.list('activities').filter(function (x) {
      if (panelCamp && x.campaignId !== panelCamp) return false;
      if (panelPhase) return x.phaseId === panelPhase;
      return true;
    });
    html += '<form id="task-panel-form" data-task-id="' + esc(t.id) + '" class="editor-form">' +
      F2('title', 'Tên task *', 'text', pv('title', t.title), { disabled: !ed }) +
      F2sel('assigneeId', 'Người phụ trách', pv('assigneeId', t.assigneeId), memberPairs(), '— Chưa phân công —', { disabled: !ed }) +
      F2sel('campaignId', 'Campaign (để trống = task độc lập)', panelCamp, campaignPairs(), '— Task độc lập —', { disabled: !ed }) +
      F2sel('phaseId', 'Giai đoạn (theo campaign)', panelPhase, panelPhases.map(function (x) { return [x.id, x.name]; }), '— Chưa gắn giai đoạn —', { disabled: !ed }) +
      F2sel('activityId', 'Activity', pv('activityId', t.activityId || ''), panelActs.map(function (x) { return [x.id, x.name]; }), '— Chưa gắn activity —', { disabled: !ed }) +
      F2sel('parentId', 'Task cha', pv('parentId', t.parentId), tasks.filter(function (x) { return x.id !== t.id; }).map(function (x) { return [x.id, x.title]; }), '— Không có —', { disabled: !ed }) +
      F2sel('status', 'Trạng thái', pv('status', t.status), TASK_STATUSES, null, { disabled: !statusEd }) +
      F2sel('priority', 'Ưu tiên', pv('priority', t.priority || 'Trung bình'), PRIORITIES.map(function (x) { return [x, x]; }), null, { disabled: !ed }) +
      F2('startDate', 'Ngày bắt đầu', 'date', pv('startDate', t.startDate ? String(t.startDate).slice(0, 10) : ''), { disabled: !ed }) +
      F2('dueDate', 'Mốc cần hoàn thành', 'date', pv('dueDate', t.dueDate ? String(t.dueDate).slice(0, 10) : ''), { disabled: !ed }) +
      '<label class="fld"><span>Loại mốc</span><span><input type="checkbox" name="isMilestone"' + (pv('isMilestone', isMilestoneTask(t) ? '1' : '') === '1' ? ' checked' : '') + dis(!ed) + '> Mốc quan trọng (milestone)</span></label>' +
      F2('effortHours', 'Thời gian dự kiến (giờ)', 'number', pv('effortHours', t.effortHours), { step: 0.5, min: 0, disabled: !ed }) +
      F2('deliverable', 'Đầu ra cần bàn giao', 'text', pv('deliverable', t.deliverable), { wide: true, disabled: !ed }) +
      '<label class="fld wide">Mô tả<textarea name="description" rows="3"' + dis(!ed) + '>' + esc(pv('description', t.description || '')) + '</textarea></label>' +
      F2('availabilityNote', 'Ghi chú thời gian có thể nhận task', 'text', pv('availabilityNote', t.availabilityNote), { wide: true, disabled: !ed }) +
      '<div class="form-actions"><button class="btn" type="submit"' + dis(ro) + noEditTitle(ro) + '>Lưu thay đổi</button></div></form>';
    // Checklist
    var panelChecklistProgress = D.checklistProgress(t);
    html += '<h3>Checklist (' + panelChecklistProgress.done + '/' + panelChecklistProgress.total + ')</h3>';
    if (!checklist.length) html += '<p class="sub">Chưa có mục checklist nào.</p>';
    else html += '<ul class="checklist">' + checklist.map(function (c, i) {
      return '<li><label><input type="checkbox" data-action-change="checklist-toggle" data-id="' + esc(t.id) + '" data-idx="' + i + '"' + (c.done ? ' checked' : '') + dis(!ed) + '> <span class="' + (c.done ? 'done-text' : '') + '">' + esc(c.text || c.title || '') + '</span></label>' +
        '<button class="btn small secondary" data-action="checklist-remove" data-id="' + esc(t.id) + '" data-idx="' + i + '"' + dis(!ed) + '>Xóa</button></li>';
    }).join('') + '</ul>';
    html += '<form class="inline" id="checklist-add-form" data-task-id="' + esc(t.id) + '"><label>Mục checklist mới<input type="text" name="text" required' + dis(!ed) + '></label><button class="btn small" type="submit"' + dis(!ed) + noEditTitle(!ed) + '>Thêm mục</button></form>';
    // Phụ thuộc
    html += '<h3>Quan hệ phụ thuộc</h3>';
    html += '<p class="sub"><strong>Đang chờ:</strong> ' + (preds.length ? preds.map(function (x) { var p = taskById(x.predecessorId); return esc(p ? p.title : x.predecessorId) + ' <button class="btn small secondary" data-action="dep-remove" data-id="' + esc(x.id) + '"' + dis(!ed) + '>Bỏ</button>'; }).join(' · ') : 'Không chờ task nào') + '</p>';
    html += '<p class="sub"><strong>Các task đang chờ mình:</strong> ' + (succs.length ? succs.map(function (x) { var p = taskById(x.successorId); return esc(p ? p.title : x.successorId); }).join(' · ') : 'Chưa có task nào chờ task này') + '</p>';
    html += '<form class="inline" id="dep-add-panel-form" data-task-id="' + esc(t.id) + '"><label>Task phải xong trước task này<select name="predecessorId"' + dis(!ed) + '>' +
      tasks.filter(function (x) { return x.id !== t.id; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>'; }).join('') +
      '</select></label><button class="btn small secondary" type="submit"' + dis(!ed) + noEditTitle(!ed) + '>Thêm phụ thuộc</button></form>';
    if (subtasks.length) {
      html += '<h3>Task con</h3><ul class="clean">' + subtasks.map(function (s) { return '<li><button class="linklike" data-action="open-task" data-id="' + esc(s.id) + '">' + esc(s.title) + '</button> — ' + statusBadge(s.status) + '</li>'; }).join('') + '</ul>';
    }
    if (blockers.length) {
      html += '<h3>Trở ngại</h3>' + blockers.map(function (b) {
        return '<div class="notice ' + (b.status === 'open' ? 'warn' : 'ok') + '"><strong>' + esc(b.title) + '</strong> — ' + esc(b.description || '') + ' ' + vizStatusPillHtml(b.status, { context: 'blocker', label: labelStatus(b.status) }) +
          (b.status === 'open' ? ' <button class="btn small secondary" data-action="resolve-blocker" data-id="' + esc(b.id) + '"' + dis(!ed) + '>Đánh dấu đã gỡ</button>' : '') + '</div>';
      }).join('');
    }
    // Bình luận
    html += '<h3>Bình luận</h3>';
    if (!comments.length) html += '<p class="sub">Chưa có bình luận.</p>';
    else html += '<ul class="clean">' + comments.map(function (c) { return '<li><strong>' + esc(memberName(c.authorId || c.createdBy)) + '</strong> · ' + esc(D.formatDateTimeVN(c.createdAt)) + '<br>' + esc(c.body || c.text || '') + '</li>'; }).join('') + '</ul>';
    html += '<form class="inline" id="comment-add-form" data-task-id="' + esc(t.id) + '"><label>Bình luận mới<input type="text" name="body" required placeholder="Gõ @ để nhắc tên trong nội dung"' + dis(!commentEd) + '></label><button class="btn small" type="submit"' + dis(!commentEd) + '>Gửi</button></form>';
    // Lịch sử + lưu trữ
    html += '<h3>Lịch sử bản ghi</h3><p class="sub">Tạo: ' + esc(D.formatDateTimeVN(t.createdAt) || '—') + ' · Cập nhật: ' + esc(D.formatDateTimeVN(t.updatedAt) || '—') + (t.updatedBy ? ' · Người sửa gần nhất: ' + esc(memberName(t.updatedBy)) : '') + '</p>';
    html += '<p>' + (isArchived(t)
      ? '<button class="btn secondary" data-action="task-restore" data-id="' + esc(t.id) + '"' + dis(!ed) + '>Khôi phục task</button>'
      : '<button class="btn secondary" data-action="task-archive" data-id="' + esc(t.id) + '"' + dis(!ed) + '>Lưu trữ task</button>') + '</p>';
    html += '</aside>';
    return html;
  }
  // Field builder không phụ thuộc UI.editor (dùng cho panel)
  // opts.disabled=true → ô nhập bị khóa ngay trong HTML (chế độ chỉ đọc).
  function F2(name, label, type, value, opts) {
    opts = opts || {};
    return '<label class="fld' + (opts.wide ? ' wide' : '') + '">' + esc(label) + '<input type="' + type + '" name="' + esc(name) + '" value="' + esc(value === null || value === undefined ? '' : value) + '"' +
      (opts.step !== undefined ? ' step="' + opts.step + '"' : '') + (opts.min !== undefined ? ' min="' + opts.min + '"' : '') + dis(!!opts.disabled) + '></label>';
  }
  function F2sel(name, label, value, pairs, emptyLabel, opts) {
    opts = opts || {};
    return '<label class="fld">' + esc(label) + '<select name="' + esc(name) + '"' + dis(!!opts.disabled) + '>' + optList(pairs, value, emptyLabel) + '</select></label>';
  }

  // ---------- Gantt dùng chung (portfolio + trong campaign) ----------
  var GANTT_ROW_H = 36;
  var GANTT_NAME_W = 230;
  // R2-26: zoom THẬT — scale quyết định số px cho 1 ngày; mọi tọa độ (render,
  // kéo thả, ticks, đường phụ thuộc) dùng chung hệ px này.
  function ganttPxPerDay() { return UI.ganttScale === 'month' ? 4 : 14; }
  function ganttVisibleRows(rows) {
    var hidden = {};
    rows.forEach(function (r) { if (UI.ganttCollapsed[r.key]) hidden[r.key] = true; });
    return rows.filter(function (r) {
      var p = r.parentKey;
      while (p) { if (hidden[p]) return false; var pr = rows.find(function (x) { return x.key === p; }); p = pr ? pr.parentKey : null; }
      return true;
    });
  }
  // Ngày hiệu lực của một hàng: nếu đang xem trước kéo thả đúng hàng này thì
  // dùng ngày preview (R2-03) — áp cho cả thanh lẫn đường phụ thuộc.
  function ganttEffStart(r) {
    var pv = UI.ganttPreview;
    return (pv && pv.coll === r.coll && pv.id === (r.ganttId || r.id)) ? pv.newStart : r.start;
  }
  function ganttEffEnd(r) {
    var pv = UI.ganttPreview;
    return (pv && pv.coll === r.coll && pv.id === (r.ganttId || r.id)) ? pv.newEnd : r.end;
  }
  function ganttIsPreviewRow(r) {
    var pv = UI.ganttPreview;
    return !!(pv && pv.coll === r.coll && pv.id === (r.ganttId || r.id));
  }
  function ganttHtml(rowsAll, edges) {
    GANTT_NAME_W = (typeof window !== 'undefined' && window.innerWidth && window.innerWidth <= 820) ? 150 : 230;
    var rows = ganttVisibleRows(rowsAll);
    var dated = rows.filter(function (r) { return r.start && r.end; });
    var head = '<div class="gantt-toolbar"><span class="sub">Thang thời gian: </span>' +
      '<button class="btn small ' + (UI.ganttScale === 'week' ? '' : 'secondary') + '" data-action="gantt-scale" data-id="week">Theo tuần</button> ' +
      '<button class="btn small ' + (UI.ganttScale === 'month' ? '' : 'secondary') + '" data-action="gantt-scale" data-id="month">Theo tháng</button> ' +
      '<button class="btn small secondary" data-action="gantt-today">Hôm nay</button>' +
      '<form class="inline compact" id="gantt-range-form"><label>Từ ngày<input type="date" name="from" value="' + esc(UI.ganttRange.from) + '"></label>' +
      '<label>Đến ngày<input type="date" name="to" value="' + esc(UI.ganttRange.to) + '"></label>' +
      '<button class="btn small secondary" type="submit">Đặt khoảng xem</button>' +
      (UI.ganttRange.from || UI.ganttRange.to ? ' <button class="btn small secondary" type="button" data-action="gantt-range-clear">Bỏ khoảng</button>' : '') + '</form>' +
      '<span class="sub">Kéo thanh để dời lịch, kéo hai đầu để đổi độ dài — thay đổi chỉ áp dụng khi bấm Lưu. Thanh mờ phía dưới là kế hoạch đã duyệt.</span></div>' +
      vizLegendHtml([
        { label: 'Campaign', cat: 4 }, { label: 'Giai đoạn', cat: 3 }, { label: 'Activity', cat: 2 }, { label: 'Task', cat: 1 },
        { label: 'Hoàn thành', tone: 'done' }, { label: 'Đang chạy', tone: 'running' }, { label: 'Trễ (viền đỏ)', tone: 'overdue' }, { label: 'Bị chặn (viền tím)', tone: 'blocked' }
      ], { chartId: 'gantt-legend' });
    if (UI.ganttError) {
      head += '<div class="notice bad" role="alert"><strong>Chưa lưu được thay đổi lịch:</strong> ' + esc(UI.ganttError) +
        ' Bản xem trước vẫn được giữ để bạn thử lại.<br><button class="btn small" data-action="gantt-apply"' + dis(UI.ganttSaving) + '>Thử lại</button> <button class="btn small secondary" data-action="gantt-cancel">Hủy</button></div>';
    } else if (UI.ganttPreview) {
      var pv = UI.ganttPreview;
      head += '<div class="notice warn" role="alert"><strong>Xem trước thay đổi lịch:</strong> ' + esc(pv.title) + ' → ' + esc(D.formatDateVN(pv.newStart)) + ' — ' + esc(D.formatDateVN(pv.newEnd)) + '.' +
        (pv.impact && pv.impact.length ? '<br>Ảnh hưởng phụ thuộc: ' + pv.impact.map(function (i) { return esc(i.title) + ' (đề xuất ' + esc(D.formatDateVN(i.proposedStart)) + ' — ' + esc(D.formatDateVN(i.proposedDue)) + ')'; }).join('; ') + '. Hệ thống không tự dịch các task này.' : '<br>Không có task phụ thuộc nào bị ảnh hưởng.') +
        '<br><button class="btn small" data-action="gantt-apply"' + dis(UI.ganttSaving) + '>' + (UI.ganttSaving ? 'Đang lưu…' : 'Lưu thay đổi') + '</button> <button class="btn small secondary" data-action="gantt-cancel"' + dis(UI.ganttSaving) + '>Hủy (giữ lịch cũ)</button></div>';
    }
    if (!dated.length) return head + '<div class="state-box">Chưa có mục nào có đủ ngày bắt đầu và ngày kết thúc để vẽ biểu đồ kế hoạch.</div>';
    var pxPerDay = ganttPxPerDay();
    var mins = dated.map(function (r) { return ganttEffStart(r); }).concat(dated.map(function (r) { return r.bStart || r.start; }));
    var maxs = dated.map(function (r) { return ganttEffEnd(r); }).concat(dated.map(function (r) { return r.bEnd || r.end; }));
    mins.sort(); maxs.sort();
    var minISO = addDaysISO(mins[0], -2), maxISO = addDaysISO(maxs[maxs.length - 1], 2);
    // R2-26: khoảng xem do người dùng đặt sẽ clamp trục tọa độ.
    if (UI.ganttRange.from) minISO = UI.ganttRange.from;
    if (UI.ganttRange.to) maxISO = UI.ganttRange.to;
    if (maxISO < minISO) maxISO = minISO;
    var totalDays = Math.max(1, Math.round((new Date(maxISO + 'T00:00:00') - new Date(minISO + 'T00:00:00')) / 86400000) + 1);
    var trackW = totalDays * pxPerDay;
    function xOf(iso) { return Math.round((new Date(String(iso).slice(0, 10) + 'T00:00:00') - new Date(minISO + 'T00:00:00')) / 86400000 * pxPerDay); }
    // Trục thời gian
    var ticks = '';
    if (UI.ganttScale === 'month') {
      var cur = new Date(minISO + 'T00:00:00'); cur.setDate(1);
      if (isoOf(cur) < minISO) cur.setMonth(cur.getMonth() + 1);
      var lastTickXm = -1000;
      while (isoOf(cur) <= maxISO) {
        var tickXm = xOf(isoOf(cur));
        if (tickXm - lastTickXm >= 72) { ticks += '<div class="g2-tick" style="left:' + tickXm + 'px">Tháng ' + (cur.getMonth() + 1) + '/' + cur.getFullYear() + '</div>'; lastTickXm = tickXm; }
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      var cur2 = mondayOf(new Date(minISO + 'T00:00:00'));
      var lastTickX = -1000;
      while (isoOf(cur2) <= maxISO) {
        var tickX = Math.max(0, xOf(isoOf(cur2)));
        if (isoOf(cur2) >= addDaysISO(minISO, -6) && tickX - lastTickX >= 72) { ticks += '<div class="g2-tick" style="left:' + tickX + 'px">' + D.formatDateVN(isoOf(cur2)) + '</div>'; lastTickX = tickX; }
        cur2.setDate(cur2.getDate() + 7);
      }
    }
    var todayX = xOf(todayISO());
    var rowIndexByKey = {};
    rows.forEach(function (r, i) { rowIndexByKey[r.key] = i; });
    // SVG đường phụ thuộc — dùng ngày HIỆU LỰC (preview-aware), tọa độ px.
    var svgPaths = '';
    (edges || []).forEach(function (e) {
      var a = rows.find(function (r) { return r.ganttId === e.predecessorId; });
      var b = rows.find(function (r) { return r.ganttId === e.successorId; });
      if (!a || !b) return;
      var aS = ganttEffStart(a), aE = ganttEffEnd(a), bS = ganttEffStart(b);
      if (!aS || !aE || !bS) return;
      var x1 = xOf(aE) + pxPerDay, x2 = xOf(bS);
      var y1 = rowIndexByKey[a.key] * GANTT_ROW_H + GANTT_ROW_H / 2, y2 = rowIndexByKey[b.key] * GANTT_ROW_H + GANTT_ROW_H / 2;
      var mx = Math.max(x1 + 12, x2 - 4);
      svgPaths += '<polyline points="' + x1 + ',' + y1 + ' ' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#g2arrow)"/>';
    });
    var bodyH = rows.length * GANTT_ROW_H;
    var body = '<div class="g2-body" style="height:' + bodyH + 'px">' +
      '<div class="g2-overlay" style="left:' + GANTT_NAME_W + 'px;width:' + trackW + 'px;height:' + bodyH + 'px">' +
      (todayX >= 0 && todayX <= trackW ? '<div class="g2-today" style="left:' + todayX + 'px" title="Hôm nay"></div>' : '') +
      '<svg class="g2-svg" style="color:var(--color-text-muted);left:0;width:' + trackW + 'px;height:' + bodyH + 'px" viewBox="0 0 ' + trackW + ' ' + bodyH + '" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="g2arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="currentColor"/></marker></defs>' + svgPaths + '</svg></div>' +
      rows.map(function (r) {
        var indent = 8 + (r.depth || 0) * 18;
        var toggle = r.hasChildren ? '<button class="g2-toggle" data-action="gantt-toggle" data-id="' + esc(r.key) + '" aria-label="Thu/mở">' + (UI.ganttCollapsed[r.key] ? '▸' : '▾') + '</button>' : '<span class="g2-toggle-sp"></span>';
        var rowTone = vizGanttRowTone(r);
        // Tiến độ checklist (chỉ hàng việc, chỉ khi có checklist): badge ở cột
        // tên + lớp nền trong thanh + dòng tooltip — số qua Domain.checklistProgress.
        var clp = D.checklistProgress(r);
        var clTitle = clp.total ? 'Checklist: ' + clp.done + '/' + clp.total + ' (' + clp.percentage + '%)' : '';
        var clBadge = clp.total ? '<span class="g2-cl-badge" title="' + esc(clTitle) + '">☑ ' + clp.done + '/' + clp.total + '</span>' : '';
        var name = '<div class="g2-name" style="padding-left:' + indent + 'px">' + toggle + vizStatusDotHtml(rowTone, 'Trạng thái: ' + rowTone) + '<button class="linklike g2-title" data-action="gantt-open" data-id="' + esc(r.key) + '" data-coll="' + esc(r.coll || '') + '" data-oid="' + esc(r.ganttId || r.id) + '">' + esc(r.title) + '</button>' + clBadge + '</div>';
        var track = '<div class="g2-track">';
        if (r.start && r.end) {
          var left = xOf(r.start), width = Math.max(pxPerDay, xOf(addDaysISO(r.end, 1)) - left);
          var locked = r.completed || !canEdit();
          var isPv = ganttIsPreviewRow(r);
          var dragAttrs = ' data-gantt-drag="1" data-coll="' + esc(r.coll || '') + '" data-oid="' + esc(r.ganttId || r.id) + '" data-title="' + esc(r.title) + '" data-start="' + esc(r.start) + '" data-end="' + esc(r.end) + '" data-locked="' + (locked ? '1' : '0') + '"';
          if (r.milestone) {
            track += '<div class="g2-mile" data-mile="1"' + dragAttrs + ' style="left:' + left + 'px' + (rowTone === 'overdue' ? ';outline:2px solid var(--st-overdue)' : (rowTone === 'blocked' ? ';outline:2px solid var(--st-blocked)' : '')) + '" title="Mốc: ' + esc(r.title) + ' · ' + esc(D.formatDateVN(r.start)) + (clp.total ? ' · ' + esc(clTitle) : '') + ' (kéo để dời mốc)"></div>';
          } else {
            track += '<div class="g2-bar kind-' + esc(r.kind) + (r.completed ? ' is-done' : '') + (rowTone === 'overdue' ? ' is-overdue' : '') + (rowTone === 'blocked' ? ' is-blocked' : '') + (isPv ? ' is-original' : '') + '"' + dragAttrs + ' style="left:' + left + 'px;width:' + width + 'px" title="' + esc(r.title) + ' · ' + esc(D.formatDateVN(r.start)) + ' — ' + esc(D.formatDateVN(r.end)) + (r.completed ? ' · Đã hoàn thành — không kéo được' : '') + (clp.total ? ' · ' + esc(clTitle) : '') + '">' + (clp.total ? '<span class="g2-cl-fill" style="width:' + clp.percentage + '%"></span>' : '') + '</div>';
          }
          if (isPv) {
            var pvL = xOf(ganttEffStart(r)), pvW = Math.max(pxPerDay, xOf(addDaysISO(ganttEffEnd(r), 1)) - pvL);
            if (r.milestone) track += '<div class="g2-mile is-preview" style="left:' + pvL + 'px" title="Chưa lưu"></div>';
            else track += '<div class="g2-bar is-preview" style="left:' + pvL + 'px;width:' + pvW + 'px" title="Chưa lưu"><span class="g2-preview-label">Chưa lưu</span></div>';
          }
          if (r.bStart && r.bEnd) {
            var bl = xOf(r.bStart), bw = Math.max(pxPerDay, xOf(addDaysISO(r.bEnd, 1)) - bl);
            track += '<div class="g2-bar baseline" style="left:' + bl + 'px;width:' + bw + 'px" title="Kế hoạch đã duyệt"></div>';
          }
        } else {
          track += '<span class="sub g2-unsched">Chưa xếp lịch</span>';
        }
        return '<div class="g2-row">' + name + track + '</div></div>';
      }).join('') + '</div>';
    return head + '<div class="g2-wrap"><div class="g2-inner" style="width:' + (GANTT_NAME_W + trackW) + 'px" data-total-days="' + totalDays + '" data-px-per-day="' + pxPerDay + '" data-min-iso="' + esc(minISO) + '"><div class="g2-head"><div class="g2-name g2-headname">Tên</div><div class="g2-track g2-ticks" style="width:' + trackW + 'px;flex:0 0 ' + trackW + 'px">' + ticks + '</div></div>' + body + '</div></div>';
  }
  // R2-27: builder cây đệ quy DÙNG CHUNG cho cả 2 Gantt.
  // Thứ tự lồng: campaign → phase → activity → task (theo activityId →
  // phaseId → campaign) → subtask đệ quy KHÔNG giới hạn cấp (ưu tiên parentId).
  function ganttTaskRow(t, parentKey, depth, tasks) {
    var blocked = !!t.isBlocked;
    try { if (!blocked) blocked = Store.list('blockers').some(function (b) { return b.taskId === t.id && b.status === 'open'; }); } catch (e) { /* giữ cờ isBlocked */ }
    return {
      key: 'task:' + t.id, parentKey: parentKey, coll: 'tasks', id: t.id, ganttId: t.id, title: t.title,
      kind: 'task', depth: depth, start: t.startDate, end: t.dueDate, status: t.status, checklist: t.checklist,
      overdue: isOverdue(t), blocked: blocked,
      bStart: t.baselineStartDate, bEnd: t.baselineDueDate, completed: isCompletedTask(t),
      milestone: isMilestoneTask(t), hasChildren: tasks.some(function (x) { return x.parentId === t.id; })
    };
  }
  function appendTaskTree(rows, tasks, rootParentKeyOf, rootDepthOf) {
    var byParent = {};
    tasks.forEach(function (t) { var k = t.parentId || '__root'; (byParent[k] = byParent[k] || []).push(t); });
    function walk(t, parentKey, depth) {
      rows.push(ganttTaskRow(t, parentKey, depth, tasks));
      (byParent[t.id] || []).forEach(function (ch) { walk(ch, 'task:' + t.id, depth + 1); });
    }
    (byParent.__root || []).forEach(function (t) { walk(t, rootParentKeyOf(t), rootDepthOf(t)); });
  }
  function appendPhaseActivityRows(rows, c, phases, acts, tasks, baseDepth, campKey) {
    phases.forEach(function (p) {
      var pkey = 'phase:' + p.id;
      rows.push({ key: pkey, parentKey: campKey || undefined, coll: 'phases', id: p.id, ganttId: p.id, title: p.name, kind: 'phase', status: p.status, depth: baseDepth, start: p.startDate, end: p.endDate, bStart: p.baselineStartDate, bEnd: p.baselineEndDate, hasChildren: acts.some(function (a) { return a.phaseId === p.id; }) || tasks.some(function (t) { return t.phaseId === p.id && !t.activityId; }) });
      acts.filter(function (a) { return a.phaseId === p.id; }).forEach(function (a) {
        rows.push({ key: 'act:' + a.id, parentKey: pkey, coll: 'activities', id: a.id, ganttId: a.id, title: a.name, kind: 'activity', status: a.status, depth: baseDepth + 1, start: a.startDate || p.startDate, end: a.endDate || p.endDate, bStart: a.baselineStartDate, bEnd: a.baselineEndDate, hasChildren: tasks.some(function (t) { return t.activityId === a.id; }) });
      });
    });
    acts.filter(function (a) { return !a.phaseId; }).forEach(function (a) {
      rows.push({ key: 'act:' + a.id, parentKey: campKey || undefined, coll: 'activities', id: a.id, ganttId: a.id, title: a.name + (a.channel ? ' (' + a.channel + ')' : ''), kind: 'activity', status: a.status, depth: baseDepth, start: a.startDate, end: a.endDate, bStart: a.baselineStartDate, bEnd: a.baselineEndDate, hasChildren: tasks.some(function (t) { return t.activityId === a.id; }) });
    });
    var unassigned = tasks.some(function (t) { return !t.parentId && !t.phaseId && !t.activityId; });
    if (unassigned) {
      rows.push({ key: 'grp:' + c.id, parentKey: campKey || undefined, coll: '', id: '', ganttId: '', title: 'Chưa gắn phase/activity', kind: 'group', depth: baseDepth, hasChildren: true });
    }
    appendTaskTree(rows, tasks, function (t) {
      if (t.activityId) return 'act:' + t.activityId;
      if (t.phaseId) return 'phase:' + t.phaseId;
      return 'grp:' + c.id;
    }, function (t) {
      if (t.activityId) { var a = acts.find(function (x) { return x.id === t.activityId; }); return baseDepth + (a && a.phaseId ? 2 : 1); }
      if (t.phaseId) return baseDepth + 1;
      return baseDepth + 1;
    });
  }
  function ganttRowsPortfolio() {
    var rows = [];
    var allTasks = Store.list('tasks').filter(function (x) { return !isArchived(x); });
    visibleList('campaigns').forEach(function (c) {
      var ckey = 'camp:' + c.id;
      var phases = Store.list('phases').filter(function (x) { return x.campaignId === c.id; });
      var acts = Store.list('activities').filter(function (x) { return x.campaignId === c.id; });
      var tasks = allTasks.filter(function (x) { return x.campaignId === c.id; });
      rows.push({ key: ckey, coll: 'campaigns', id: c.id, ganttId: c.id, title: c.name, kind: 'campaign', status: c.status, depth: 0, start: c.startDate, end: c.endDate, bStart: c.baselineStartDate, bEnd: c.baselineEndDate, hasChildren: !!(phases.length || acts.length || tasks.length), completed: c.status === 'completed' });
      appendPhaseActivityRows(rows, c, phases, acts, tasks, 1, ckey);
    });
    var independent = allTasks.filter(function (t) { return !t.campaignId; });
    if (independent.length) {
      rows.push({ key: 'grp:independent', coll: '', id: '', ganttId: '', title: 'Task độc lập', kind: 'group', depth: 0, hasChildren: true });
      appendTaskTree(rows, independent, function () { return 'grp:independent'; }, function () { return 1; });
    }
    return rows;
  }
  function ganttRowsCampaign(c) {
    var rows = [];
    var phases = Store.list('phases').filter(function (x) { return x.campaignId === c.id; });
    var acts = Store.list('activities').filter(function (x) { return x.campaignId === c.id; });
    var tasks = Store.list('tasks').filter(function (x) { return x.campaignId === c.id && !isArchived(x); });
    rows.push({ key: 'camp:' + c.id, coll: 'campaigns', id: c.id, ganttId: c.id, title: c.name, kind: 'campaign', status: c.status, depth: 0, start: c.startDate, end: c.endDate, bStart: c.baselineStartDate, bEnd: c.baselineEndDate, hasChildren: !!(phases.length || acts.length || tasks.length), completed: c.status === 'completed' });
    appendPhaseActivityRows(rows, c, phases, acts, tasks, 1, 'camp:' + c.id);
    return rows;
  }

  // Kéo / đổi kích thước thanh Gantt bằng pointer events.
  // R2-03: trong lúc kéo, cập nhật TRỰC TIẾP style.left/width của thanh theo
  // pxPerDay của thang hiện tại; pointercancel = hủy kéo + khôi phục style.
  var ganttDrag = null;
  document.addEventListener('pointerdown', function (ev) {
    var bar = ev.target.closest ? ev.target.closest('[data-gantt-drag]') : null;
    if (!bar || bar.getAttribute('data-locked') === '1') return;
    var inner = bar.closest('.g2-inner');
    var isMile = bar.getAttribute('data-mile') === '1';
    ganttDrag = {
      bar: bar, mode: 'move', x0: ev.clientX,
      start: bar.getAttribute('data-start'), end: bar.getAttribute('data-end'),
      coll: bar.getAttribute('data-coll'), id: bar.getAttribute('data-oid'), title: bar.getAttribute('data-title'),
      origLeft: bar.offsetLeft, origWidth: bar.offsetWidth,
      origStyleLeft: bar.style.left, origStyleWidth: bar.style.width,
      moved: false, isMile: isMile,
      pxPerDay: inner ? Number(inner.getAttribute('data-px-per-day') || 0) || ganttPxPerDay() : ganttPxPerDay()
    };
    // Milestone: khóa resize — chỉ kéo dời (move). Thanh thường: 8px hai đầu = resize.
    if (!isMile) {
      var relX = ev.clientX - bar.getBoundingClientRect().left;
      if (relX < 8) ganttDrag.mode = 'left';
      else if (relX > bar.offsetWidth - 8) ganttDrag.mode = 'right';
    }
    try { bar.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
  });
  document.addEventListener('pointermove', function (ev) {
    if (!ganttDrag) return;
    var dx = ev.clientX - ganttDrag.x0;
    var bar = ganttDrag.bar;
    var pxPerDay = Math.max(1, ganttDrag.pxPerDay);
    // Cập nhật trực tiếp vị trí/kích thước thanh theo con trỏ.
    if (ganttDrag.mode === 'move') {
      bar.style.left = (ganttDrag.origLeft + dx) + 'px';
    } else if (ganttDrag.mode === 'left') {
      bar.style.left = (ganttDrag.origLeft + dx) + 'px';
      bar.style.width = Math.max(pxPerDay, ganttDrag.origWidth - dx) + 'px';
    } else if (ganttDrag.mode === 'right') {
      bar.style.width = Math.max(pxPerDay, ganttDrag.origWidth + dx) + 'px';
    }
    var dDays = Math.round(dx / pxPerDay);
    ganttDrag.moved = dx !== 0;
    var s = ganttDrag.start, en = ganttDrag.end;
    var ns = s, ne = en;
    if (ganttDrag.mode === 'move') { ns = addDaysISO(s, dDays); ne = addDaysISO(en, dDays); }
    if (ganttDrag.mode === 'left') { ns = addDaysISO(s, dDays); if (ns > en) ns = en; }
    if (ganttDrag.mode === 'right') { ne = addDaysISO(en, dDays); if (ne < s) ne = s; }
    ganttDrag.newStart = ns; ganttDrag.newEnd = ne;
    var tip = document.getElementById('g2-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'g2-tip'; tip.className = 'g2-tip'; document.body.appendChild(tip); }
    tip.hidden = false;
    tip.textContent = ganttDrag.title + ': ' + D.formatDateVN(ns) + ' — ' + D.formatDateVN(ne) + ' (chưa lưu)';
    tip.style.left = (ev.clientX + 12) + 'px'; tip.style.top = (ev.clientY + 12) + 'px';
    bar.style.opacity = '0.65';
  });
  document.addEventListener('pointercancel', function () {
    if (!ganttDrag) return;
    var drag = ganttDrag; ganttDrag = null;
    // Hủy kéo: khôi phục style gốc của thanh, không tạo preview.
    drag.bar.style.left = drag.origStyleLeft;
    drag.bar.style.width = drag.origStyleWidth;
    drag.bar.style.opacity = '';
    var tip = document.getElementById('g2-tip'); if (tip) tip.hidden = true;
  });
  document.addEventListener('pointerup', function () {
    if (!ganttDrag) return;
    var tip = document.getElementById('g2-tip'); if (tip) tip.hidden = true;
    var drag = ganttDrag; ganttDrag = null;
    if (!drag.moved || !drag.newStart || (drag.newStart === drag.start && drag.newEnd === drag.end)) { render(); return; }
    var impact = [];
    if (drag.coll === 'tasks') impact = D.previewDependencyImpact(drag.id, drag.newStart, drag.newEnd, Store.list('tasks'), Store.list('dependencies'));
    UI.ganttPreview = { coll: drag.coll, id: drag.id, title: drag.title, newStart: drag.newStart, newEnd: drag.newEnd, impact: impact };
    UI.ganttError = null;
    render();
  });

  // ---------- Tổng quan ----------
  function viewOverview() {
    var campaigns = visibleList('campaigns');
    var tasks = visibleList('tasks');
    var approvals = Store.list('approvals').filter(function (a) { return a.status === 'pending' || a.status === 'needs_reapproval'; });
    var overdue = tasks.filter(isOverdue);
    var running = campaigns.filter(function (c) { return c.status === 'active'; });
    var openBlockers = Store.list('blockers').filter(function (b) { return b.status === 'open'; });
    var atRisk = [];
    campaigns.forEach(function (c) {
      var ct = tasks.filter(function (t) { return t.campaignId === c.id; });
      var od = ct.filter(isOverdue);
      var reasons = [];
      if (od.length) reasons.push(od.length + ' task quá hạn (muộn nhất: ' + od.map(function (t) { return t.title + ' — hạn ' + D.formatDateVN(t.dueDate); }).join('; ') + ')');
      var blockedReal = ct.filter(function (t) {
        if (isCompletedTask(t)) return false;
        var bl = openBlockers.some(function (b) { return b.taskId === t.id; });
        var predOverdue = Store.list('dependencies').some(function (e) {
          if (e.successorId !== t.id) return false;
          var p = taskById(e.predecessorId);
          return p && !isCompletedTask(p) && isOverdue(p);
        });
        return bl || predOverdue;
      });
      if (blockedReal.length) reasons.push(blockedReal.length + ' task đang bị chặn thật (có trở ngại đang mở hoặc task trước đã quá hạn)');
      if (c.risks) reasons.push('Rủi ro đã ghi: ' + c.risks);
      if (reasons.length) {
        var odIds = {}; od.forEach(function (t) { odIds[t.id] = true; });
        var blIds = {}; blockedReal.forEach(function (t) { blIds[t.id] = true; });
        var affected = ct.filter(function (t) { return odIds[t.id] || blIds[t.id]; }).length;
        atRisk.push({ campaign: c, reason: reasons.join('. '), overdueCount: od.length, blockedCount: blockedReal.length, totalCount: ct.length, affectedCount: affected });
      }
    });
    var html = pageHead('Overview', 'Tình hình Marketing tại thời điểm hiện tại' + (Store.mode === 'demo' ? ' — dữ liệu minh họa' : '') + '.',
      canEdit() ? '<a class="btn" href="#/campaigns">+ Tạo campaign</a>' : '');
    html += collectionBanner('campaigns');
    if (!collLoadingOrError('campaigns') && !campaigns.length) {
      html += emptyState('Workspace chưa có campaign nào', 'Bắt đầu bằng cách tạo campaign đầu tiên, sau đó thêm giai đoạn, task và content ngay trong trang chi tiết campaign.',
        '<p><a class="btn" href="#/campaigns">Tới mục IMC & Campaigns để tạo</a> <a class="btn secondary" href="#/settings">Thiết lập BU/sản phẩm trước</a></p>');
    }
    html += '<div class="cards">' +
      vizKpiCardHtml({ label: 'Campaign đang chạy', valueText: String(running.length), tone: 'running', toneLabel: 'Đang chạy', href: '#/campaigns', hrefLabel: 'Xem danh sách', progress: campaigns.length ? { value: running.length, max: campaigns.length, pct: vizPct(running.length, campaigns.length), tone: 'running', detail: running.length + '/' + campaigns.length + ' campaign (' + fmtPct(vizPct(running.length, campaigns.length)) + ')' } : null }) +
      vizKpiCardHtml({ label: 'Content chờ duyệt', valueText: String(approvals.length), tone: 'pending', toneLabel: 'Chờ duyệt', href: '#/approvals', hrefLabel: 'Tới hộp duyệt' }) +
      vizKpiCardHtml({ label: 'Task quá hạn', valueText: String(overdue.length), tone: 'overdue', toneLabel: 'Quá hạn', href: '#/tasks', hrefLabel: 'Xem task', progress: tasks.length ? { value: overdue.length, max: tasks.length, pct: vizPct(overdue.length, tasks.length), tone: 'overdue', detail: overdue.length + '/' + tasks.length + ' task (' + fmtPct(vizPct(overdue.length, tasks.length)) + ')' } : null }) +
      vizKpiCardHtml({ label: 'Campaign nguy cơ trễ', valueText: String(atRisk.length), tone: 'overdue', toneLabel: 'Nguy cơ trễ', sub: 'Có căn cứ thời gian/trở ngại', progress: campaigns.length ? { value: atRisk.length, max: campaigns.length, pct: vizPct(atRisk.length, campaigns.length), tone: 'overdue', detail: atRisk.length + '/' + campaigns.length + ' campaign (' + fmtPct(vizPct(atRisk.length, campaigns.length)) + ')' } : null }) +
      '</div>';
    html += '<h2>Campaign đang chạy</h2>';
    if (!running.length && campaigns.length) html += '<div class="state-box">Chưa có campaign nào đang chạy.</div>';
    running.forEach(function (c) {
      var ctasks2 = tasks.filter(function (t) { return t.campaignId === c.id; });
      var p = D.campaignProgress(ctasks2);
      var tone = p.percentage >= 100 ? 'done' : (ctasks2.some(isOverdue) ? 'overdue' : 'running');
      html += '<div class="card"><strong><a href="#/campaigns/' + esc(c.id) + '">' + esc(c.name) + '</a></strong><p class="sub">' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + ' · Người phụ trách: ' + esc(memberName(c.ownerId)) + '</p>' +
        vizProgressBarHtml({ value: p.completed, max: p.total, pct: p.percentage, tone: tone, detail: 'Tiến độ (chỉ tính task chi tiết, không tính task cha): ' + p.completed + '/' + p.total + ' (' + p.percentage + '%)' }) + '</div>';
    });
    html += workspaceChartsHtml();
    html += '<h2>Nguy cơ trễ (kèm lý do cụ thể)</h2>';
    if (collLoadingOrError('tasks')) html += collectionBanner('tasks');
    else if (!atRisk.length) html += '<div class="state-box">Không có campaign nào có dấu hiệu trễ có căn cứ.</div>';
    else {
      html += '<div data-viz="overview-risk-table">' + tbl('<tr><th>Campaign</th><th>Task trễ</th><th>Task bị chặn</th><th>Tỉ lệ task trễ/bị chặn</th><th>Lý do cụ thể</th></tr>' + atRisk.map(function (r) {
        return '<tr><td><strong><a href="#/campaigns/' + esc(r.campaign.id) + '">' + esc(r.campaign.name) + '</a></strong></td><td>' + fmtNum(r.overdueCount) + '</td><td>' + fmtNum(r.blockedCount) + '</td><td>' +
          vizCellBarHtml({ value: r.affectedCount, max: r.totalCount, tone: 'overdue', text: r.affectedCount + '/' + r.totalCount + ' task bị ảnh hưởng (' + fmtPct(vizPct(r.affectedCount, r.totalCount)) + ')' }) +
          '</td><td><span class="sub">' + esc(r.reason) + '</span></td></tr>';
      }).join(''), 'overview-risk') + '</div>';
    }
    html += '<h2>Chờ duyệt & quá hạn</h2><div class="grid2"><div class="panel"><h3>Chờ duyệt (' + approvals.length + ') ' + (approvals.length ? vizStatusPillHtml('pending', { label: 'Chờ duyệt' }) : '') + '</h3>' +
      (approvals.length ? '<ul class="clean">' + approvals.map(function (a) { return '<li><a href="#/approvals">' + esc(contentTitle(a.contentItemId)) + '</a> · phiên bản content số ' + esc(a.revision) + ' · từ ' + esc(memberName(a.requestedBy)) + ' ' + vizStatusPillHtml(a.status) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có content chờ duyệt.</p>') + '</div>' +
      '<div class="panel"><h3>Quá hạn (' + overdue.length + ') ' + (overdue.length ? vizStatusPillHtml('overdue', { label: 'Quá hạn', derived: true }) : '') + '</h3>' +
      (overdue.length ? '<ul class="clean">' + overdue.map(function (t) { return '<li><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button> — hạn ' + esc(D.formatDateVN(t.dueDate)) + ' · ' + esc(memberName(t.assigneeId)) + ' ' + statusBadge(t.status) + ' ' + vizStatusPillHtml('overdue', { label: 'Quá hạn', derived: true }) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có task quá hạn.</p>') + '</div></div>';
    return html;
  }

  // ---------- Việc của tôi ----------
  function viewMyWork() {
    var me = Store.currentUser();
    var tasks = visibleList('tasks');
    var edges = Store.list('dependencies');
    var mine = tasks.filter(function (t) { return t.assigneeId === (me && me.id); });
    var myIds = {};
    mine.forEach(function (t) { myIds[t.id] = true; });
    var today = todayISO();
    var weekStart = isoOf(mondayOf(new Date())), weekEnd = addDaysISO(weekStart, 6);
    function inWeek(t) { var d = t.dueDate || t.startDate; return d && String(d).slice(0, 10) >= weekStart && String(d).slice(0, 10) <= weekEnd; }
    var groups = [
      ['Hôm nay', mine.filter(function (t) { return (t.dueDate === today || t.startDate === today) && !isCompletedTask(t); })],
      ['Tuần này', mine.filter(function (t) { return inWeek(t) && !isCompletedTask(t); })],
      ['Quá hạn', mine.filter(isOverdue)],
      ['Chưa có lịch', mine.filter(function (t) { return !t.startDate && !t.dueDate; })],
      ['Đang chờ người khác', mine.filter(function (t) { return !D.taskReadiness(t.id, tasks, edges).ready && !isCompletedTask(t); })],
      ['Task đang chờ mình', tasks.filter(function (t) { return !myIds[t.id] && !isCompletedTask(t) && edges.some(function (e) { return e.successorId === t.id && myIds[e.predecessorId] && !isCompletedTask(taskById(e.predecessorId) || {}); }); })]
    ];
    // R2-30.6: "Chờ mình duyệt" = đang chờ ∧ (giao đích danh cho mình) ∨
    // (không ghi người duyệt ∧ mình có quyền quyết định duyệt).
    var myApprovals = Store.list('approvals').filter(function (a) { return isWaitingForMe(a, me); });
    var myContent = Store.list('variants').filter(function (v2) {
      return v2.ownerId === (me && me.id) && v2.scheduledAt && dateInTz(v2.scheduledAt) >= weekStart && dateInTz(v2.scheduledAt) <= weekEnd;
    });
    var html = pageHead('Task của tôi', 'Task của ' + (me ? me.name : '—') + (Store.mode === 'demo' ? ' (đổi người dùng ở thanh trên — chỉ trong Chế độ demo)' : '') + '. Bấm vào tên task để mở chi tiết và sửa ngay tại chỗ.',
      canEdit() ? '<button class="btn" data-action="editor-open" data-kind="task">+ Tạo task</button>' : '');
    html += readonlyNote();
    // WAVE-B1-VIZ2: dải KPI đầu trang — số đếm lấy NGUYÊN từ chính các nhóm
    // mà view đã lọc ở trên (groups + myApprovals), không đếm lại ở đây.
    var groupTones = ['running', 'running', 'overdue', 'todo', 'blocked', 'pending'];
    var toneLabels = { running: 'Đang chạy', overdue: 'Quá hạn', blocked: 'Bị chặn', pending: 'Chờ duyệt', todo: 'Chưa bắt đầu', done: 'Hoàn thành', neutral: 'Thông tin' };
    var kpiDefs = groups.map(function (g, i) { return { label: g[0], count: g[1].length, tone: groupTones[i] || 'neutral', mineSubset: i < 5 }; });
    kpiDefs.push({ label: 'Chờ mình duyệt', count: myApprovals.length, tone: 'pending', mineSubset: false });
    html += '<div data-viz="my-work-summary"><div class="cards">' + kpiDefs.map(function (k) {
      return vizKpiCardHtml({
        label: k.label, valueText: String(k.count), tone: k.tone, toneLabel: toneLabels[k.tone] || '',
        sub: k.label === 'Task đang chờ mình' ? 'Task của người khác đang chờ task của bạn hoàn thành trước' : (k.label === 'Chờ mình duyệt' ? 'Content đang chờ bạn duyệt ở hộp duyệt' : null),
        progress: (k.mineSubset && mine.length) ? { value: k.count, max: mine.length, pct: vizPct(k.count, mine.length), tone: k.tone, detail: k.count + '/' + mine.length + ' task của tôi (' + fmtPct(vizPct(k.count, mine.length)) + ')' } : null
      });
    }).join('') + '</div>' +
      vizStackedBarHtml({
        segments: kpiDefs.map(function (k) { return { label: k.label, value: k.count, tone: k.tone }; }),
        total: kpiDefs.reduce(function (s, k) { return s + k.count; }, 0),
        unitLabel: 'lượt đếm theo nhóm (một task có thể thuộc nhiều nhóm cùng lúc)', emptyText: 'Chưa có task nào trong các nhóm để vẽ thanh phân bổ.'
      }) + '</div>';
    function taskList(list, emptyText) {
      if (!list.length) return '<p class="sub">' + esc(emptyText) + '</p>';
      return tbl('<tr><th>Task</th><th>Campaign</th><th>Mốc cần hoàn thành</th><th>Trạng thái</th><th>Phụ thuộc</th></tr>' +
        list.map(function (t) {
          return '<tr><td><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button>' + checklistBadgeHtml(t) + '</td><td>' + esc(campaignName(t.campaignId)) + '</td><td>' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : 'Chưa xếp lịch') + (isOverdue(t) ? ' ' + vizStatusPillHtml('overdue', { label: 'Quá hạn', derived: true }) + '' : '') + '</td><td>' + statusBadge(t.status) + '</td><td>' + readinessBadge(t) + '</td></tr>';
        }).join(''), 'my-work-tasks');
    }
    // WAVE-B1-VIZ2: mini timeline 7 ngày cho nhóm "Tuần này" — chỉ dùng
    // startDate/dueDate ĐÃ CÓ của task (kẹp vào tuần hiện tại); việc không
    // có ngày nào thì không xuất hiện ở đây (không bịa ngày).
    function dayDiff(a, b) { return Math.round((new Date(String(a).slice(0, 10) + 'T00:00:00') - new Date(String(b).slice(0, 10) + 'T00:00:00')) / 86400000); }
    var weekDayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    function weekTimelineHtml(list) {
      var dated = (list || []).filter(function (t) { return t.startDate || t.dueDate; });
      if (!dated.length) return vizEmptyChartHtml('Các task trong nhóm Tuần này chưa có ngày bắt đầu/hạn để vẽ timeline 7 ngày.');
      var head = '<div class="viz-week-row viz-week-head"><span class="viz-week-name sub">Task</span><span class="viz-week-days">' +
        weekDayNames.map(function (nm, i) { var d = addDaysISO(weekStart, i); return '<span class="viz-week-day' + (d === today ? ' is-today' : '') + '">' + esc(nm) + '<br>' + esc(D.formatDateVN(d)) + '</span>'; }).join('') + '</span></div>';
      var rows = dated.map(function (t) {
        var s = String(t.startDate || t.dueDate).slice(0, 10), e = String(t.dueDate || t.startDate).slice(0, 10);
        if (s > e) { var tmp = s; s = e; e = tmp; }
        var cs = s < weekStart ? weekStart : s, ce = e > weekEnd ? weekEnd : e;
        var off = Math.max(0, dayDiff(cs, weekStart)), span = Math.max(1, dayDiff(ce, cs) + 1);
        var tone = vizTaskDerivedTone(t) || vizStatusTone(t.status);
        return '<div class="viz-week-row"><span class="viz-week-name">' + vizStatusDotHtml(tone, labelStatus(t.status)) + ' <button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button></span>' +
          '<span class="viz-week-track"><span class="viz-week-bar st-fill-' + esc(tone) + '" style="left:' + (Math.round(off / 7 * 10000) / 100) + '%;width:' + (Math.round(span / 7 * 10000) / 100) + '%" title="' + esc(t.title) + ': ' + esc(D.formatDateVN(s)) + ' — ' + esc(D.formatDateVN(e)) + '"></span></span></div>';
      }).join('');
      return '<div class="viz-chart" data-viz="my-work-week-timeline"><h4>Timeline 7 ngày — tuần ' + esc(D.formatDateVN(weekStart)) + ' đến ' + esc(D.formatDateVN(weekEnd)) + '</h4>' + head + rows + '</div>';
    }
    groups.forEach(function (g) {
      html += '<h2>' + esc(g[0]) + ' (' + g[1].length + ')</h2>' + taskList(g[1], 'Không có task nào trong nhóm này.');
      if (g[0] === 'Tuần này') html += weekTimelineHtml(g[1]);
    });
    html += '<h2>Chờ mình duyệt (' + myApprovals.length + ')</h2>';
    html += myApprovals.length ? '<ul class="clean">' + myApprovals.map(function (a) { return '<li><a href="#/approvals">' + esc(contentTitle(a.contentItemId)) + '</a> — phiên bản content số ' + esc(a.revision) + ', gửi bởi ' + esc(memberName(a.requestedBy)) + ' ' + vizStatusPillHtml(a.status) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có content nào chờ bạn duyệt.</p>';
    html += '<h2>Lịch content của tôi tuần này (' + myContent.length + ')</h2>';
    if (!myContent.length) html += '<p class="sub">Tuần này bạn không có content nào tới lịch đăng.</p>';
    else {
      // WAVE-B1-VIZ2: dải lịch theo ngày — gom myContent theo ngày đăng đã
      // có (dateInTz của scheduledAt), chấm màu theo tông trạng thái biến thể.
      html += '<div class="viz-cal-strip" data-viz="my-work-cal-strip">' + weekDayNames.map(function (nm, i) {
        var d = addDaysISO(weekStart, i);
        var items = myContent.filter(function (v2) { return dateInTz(v2.scheduledAt) === d; });
        var byTone = {};
        items.forEach(function (v2) { var tn = vizStatusTone(v2.editorialStatus || v2.approvalStatus); byTone[tn] = (byTone[tn] || 0) + 1; });
        var dots = vizCalDotsHtml(Object.keys(byTone).map(function (tn) { return { tone: tn, count: byTone[tn] }; }));
        return '<div class="viz-cal-day' + (d === today ? ' is-today' : '') + '"><div class="viz-cal-day-head"><strong>' + esc(nm) + '</strong> <span class="sub">' + esc(D.formatDateVN(d)) + '</span></div>' +
          '<div>' + (items.length ? dots + ' <span class="sub">' + items.length + ' content</span>' : '<span class="sub">—</span>') + '</div>' +
          (items.length ? '<ul class="clean viz-cal-items">' + items.map(function (v2) { return '<li>' + esc(D.formatDateTimeVN(v2.scheduledAt)) + ' — ' + esc(contentTitle(v2.contentItemId)) + ' (' + esc(v2.channelLabel || labelStatus(v2.platform)) + ')</li>'; }).join('') + '</ul>' : '') + '</div>';
      }).join('') + '</div>';
    }
    return html;
  }

  // ---------- Brand Hub ----------
  function versionHistoryHtml(coll, item) {
    var hist = [];
    try { hist = Store.list(coll === 'brandAssets' ? 'assetVersions' : 'brandPageVersions'); } catch (e) { hist = []; }
    var own = hist.filter(function (h) { return h.assetId === item.id || h.pageId === item.id || h.brandAssetId === item.id || h.brandPageId === item.id; });
    var fromItem = item.versions || item.history || [];
    if (own.length) return '<ul class="clean">' + own.map(function (h) { return '<li>Phiên bản ' + esc(h.version) + ' — ' + esc(D.formatDateTimeVN(h.createdAt || h.updatedAt)) + ' · ' + esc(memberName(h.createdBy || h.updatedBy)) + '</li>'; }).join('') + '</ul>';
    if (fromItem.length) return '<ul class="clean">' + fromItem.map(function (h) { return '<li>Phiên bản ' + esc(h.version || h) + '</li>'; }).join('') + '</ul>';
    return '<p class="sub">Hiện có phiên bản ' + esc(item.version || 1) + ' (' + esc(D.formatDateTimeVN(item.updatedAt)) + ').</p>';
  }
  function viewBrand() {
    var q = UI.brandQuery.toLowerCase();
    function match(x) { return !q || JSON.stringify(x).toLowerCase().indexOf(q) !== -1; }
    var bf = UI.brandFilter;
    function matchAssetFilter(a) {
      if (bf.ownerId !== 'all' && a.ownerId !== bf.ownerId) return false;
      if (bf.status !== 'all') {
        var bi = brandStatusInfo(a);
        if (bi.status !== bf.status) return false;
      }
      if (bf.type !== 'all' && String(a.type || '') !== bf.type) return false;
      return true;
    }
    var pages = visibleList('brandPages').filter(match);
    var assets = visibleList('brandAssets').filter(match).filter(matchAssetFilter);
    var archPages = archivedList('brandPages').filter(match);
    var archAssets = archivedList('brandAssets').filter(match);
    var ed = canEdit();
    var html = pageHead('Brand Hub', 'Trang thương hiệu và tài nguyên dùng chung cho toàn đội.',
      (ed ? '<button class="btn" data-action="editor-open" data-kind="brandPage">+ Thêm trang</button> <button class="btn secondary" data-action="editor-open" data-kind="brandAsset">+ Thêm tài nguyên</button>' : ''));
    html += readonlyNote() + collectionBanner('brandPages');
    html += '<form class="inline" id="brand-search-form"><label>Tìm kiếm<input type="search" id="brand-query" value="' + esc(UI.brandQuery) + '" placeholder="Tên trang, tài nguyên, loại, thẻ…"></label><button class="btn" type="submit">Tìm</button>' +
      (UI.brandQuery ? ' <button class="btn secondary" type="button" data-action="brand-clear">Xóa lọc</button>' : '') + '</form>';
    // R2-29.2: lọc tài nguyên theo người phụ trách / trạng thái / loại.
    var assetTypes = [];
    visibleList('brandAssets').forEach(function (a) { if (a.type && assetTypes.indexOf(a.type) === -1) assetTypes.push(a.type); });
    html += '<form class="inline" id="brand-filter-form"><span class="sub">Lọc tài nguyên:</span>' +
      '<label>Người phụ trách<select name="ownerId"><option value="all">Tất cả</option>' + memberPairs().map(function (p) { return '<option value="' + esc(p[0]) + '"' + (bf.ownerId === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Trạng thái<select name="status"><option value="all">Tất cả</option>' + [['draft', 'Bản nháp'], ['approved', 'Đã duyệt'], ['archived', 'Lưu trữ']].map(function (p) { return '<option value="' + p[0] + '"' + (bf.status === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Loại<select name="type"><option value="all">Tất cả</option>' + assetTypes.map(function (tp) { return '<option value="' + esc(tp) + '"' + (bf.type === tp ? ' selected' : '') + '>' + esc(tp) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn secondary" type="submit">Lọc tài nguyên</button></form>';
    html += tabsHtml([['pages', 'Trang thương hiệu (' + pages.length + ')'], ['assets', 'Tài nguyên (' + assets.length + ')'], ['archived', 'Đã lưu trữ (' + (archPages.length + archAssets.length) + ')']], UI.brandTab, 'brand-tab');
    if (UI.brandTab === 'pages') {
      if (!pages.length && !collLoadingOrError('brandPages')) html += emptyState('Chưa có trang thương hiệu nào', 'Tạo trang đầu tiên để ghi nhận câu chuyện thương hiệu, giọng điệu, quy chuẩn trình bày…', ed ? '<p><button class="btn" data-action="editor-open" data-kind="brandPage">+ Thêm trang thương hiệu</button></p>' : '');
      else html += tbl('<tr><th>Trang</th><th>Tóm tắt</th><th>Người phụ trách</th><th>Phiên bản</th><th>Trạng thái bản</th><th>Cập nhật</th><th>Thao tác</th></tr>' + pages.map(function (p) {
        var row = '<tr><td><button class="linklike" data-action="brand-open" data-id="' + esc(p.id) + '"><strong>' + esc(p.title) + '</strong></button></td><td>' + esc(p.summary || '') + '</td><td>' + esc(memberName(p.ownerId)) + '</td><td>' + vizStatusPillHtml('', { tone: 'neutral', label: 'v' + (p.version || 1) }) + '</td><td>' + statusBadge(p.status === 'Approved' ? 'approved' : (p.status === 'Archived' ? 'archived' : 'draft'), p.status === 'Approved' ? 'Đã duyệt' : (p.status === 'Archived' ? 'Lưu trữ' : 'Bản nháp')) + '</td><td>' + esc(D.formatDateVN(p.updatedAt)) + '</td>' +
          '<td class="row-actions"><button class="btn small secondary" data-action="brand-open" data-id="' + esc(p.id) + '">Mở</button> <button class="btn small" data-action="editor-open" data-kind="brandPage" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="brandPages" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
        if (UI.brandOpenId === p.id) {
          row += '<tr class="detail-row"><td colspan="7"><h3>Nội dung trang</h3><div class="rich">' + esc(p.content || p.summary || 'Chưa có nội dung chi tiết — bấm Sửa để bổ sung.') + '</div>' +
            (Array.isArray(p.tags) && p.tags.length ? '<p class="sub">Thẻ: ' + esc(p.tags.join(', ')) + '</p>' : '') +
            '<h3>Lịch sử phiên bản</h3>' + versionHistoryHtml('brandPages', p) + '</td></tr>';
        }
        return row;
      }).join(''), 'brand-pages');
    }
    if (UI.brandTab === 'assets') {
      if (!assets.length && !collLoadingOrError('brandAssets')) html += emptyState('Chưa có tài nguyên thương hiệu nào', 'Thêm logo, KV, hướng dẫn, file nguồn… kèm đường dẫn để cả đội dùng đúng bản đã duyệt.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="brandAsset">+ Thêm tài nguyên</button></p>' : '');
      else html += tbl('<tr><th>Xem trước</th><th>Tài nguyên</th><th>Loại</th><th>Đường dẫn</th><th>Người phụ trách</th><th>Phiên bản</th><th>Trạng thái bản</th><th>Thao tác</th></tr>' + assets.map(function (a) {
        var url = a.externalUrl || a.url || a.fileUrl || '';
        var bi = brandStatusInfo(a);
        var isImg = /hình ảnh|image|logo|kv/i.test(String(a.type || '')) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
        var row = '<tr><td>' + vizBrandThumbHtml({ name: a.name, type: a.type, url: url, isImg: isImg }) + '</td><td><button class="linklike" data-action="brand-open" data-id="' + esc(a.id) + '"><strong>' + esc(a.name) + '</strong></button></td><td>' + vizCatDotHtml(vizAssetCatIndex(a.type), a.type || '') + ' ' + esc(a.type) + '</td><td>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">Mở / tải</a>' : '—') + '</td><td>' + esc(memberName(a.ownerId)) + '</td><td>' + (a.version === null || a.version === undefined ? '—' : vizStatusPillHtml('', { tone: 'neutral', label: 'v' + a.version })) + '</td><td>' + statusBadge(bi.status, bi.label) + '</td>' +
          '<td class="row-actions"><button class="btn small secondary" data-action="brand-open" data-id="' + esc(a.id) + '">Chi tiết</button> <button class="btn small" data-action="editor-open" data-kind="brandAsset" data-id="' + esc(a.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="brandAssets" data-id="' + esc(a.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
        if (UI.brandOpenId === a.id) row += '<tr class="detail-row"><td colspan="8"><h3>Lịch sử phiên bản</h3>' + versionHistoryHtml('brandAssets', a) + (Array.isArray(a.tags) && a.tags.length ? '<p class="sub">Thẻ: ' + esc(a.tags.join(', ')) + '</p>' : '') + '</td></tr>';
        return row;
      }).join(''), 'brand-assets');
    }
    if (UI.brandTab === 'archived') {
      var all = archPages.map(function (x) { return { x: x, coll: 'brandPages', label: x.title }; }).concat(archAssets.map(function (x) { return { x: x, coll: 'brandAssets', label: x.name }; }));
      if (!all.length) html += '<div class="state-box">Chưa có mục nào bị lưu trữ.</div>';
      else html += tbl('<tr><th>Mục đã lưu trữ</th><th>Loại</th><th>Trạng thái</th><th>Thao tác</th></tr>' + all.map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td><td>' + (r.coll === 'brandPages' ? 'Trang thương hiệu' : 'Tài nguyên') + '</td><td>' + vizStatusPillHtml('cancelled', { label: 'Đã lưu trữ' }) + '</td><td><button class="btn small" data-action="restore-item" data-coll="' + r.coll + '" data-id="' + esc(r.x.id) + '"' + dis(!ed) + '>Khôi phục</button></td></tr>';
      }).join(''), 'brand-archived');
    }
    return html;
  }

  // ---------- IMC & Campaigns ----------
  function viewCampaigns() {
    var campaigns = visibleList('campaigns');
    var ed = canEdit();
    if (ROUTE.id) return campaignDetailHtml(ROUTE.id);
    var html = pageHead('IMC & Campaigns', 'Kế hoạch truyền thông tích hợp: danh sách và chi tiết từng campaign. Xem biểu đồ chung ở mục Timeline.',
      ed ? '<button class="btn" data-action="editor-open" data-kind="campaign">+ Tạo campaign</button>' : '');
    html += readonlyNote() + collectionBanner('campaigns');
    if (!campaigns.length && !collLoadingOrError('campaigns')) {
      return html + emptyState('Chưa có campaign nào — bắt đầu tại đây',
        'Luồng bắt đầu: (1) vào Thiết lập để tạo BU/sản phẩm nếu cần → (2) tạo campaign → (3) trong trang chi tiết campaign, thêm giai đoạn, activity, task và content. Toàn bộ làm ngay trên giao diện.',
        '<p>' + (ed ? '<button class="btn" data-action="editor-open" data-kind="campaign">+ Tạo campaign đầu tiên</button> ' : '') + '<a class="btn secondary" href="#/settings">Tới Thiết lập</a></p>');
    }
    html += '<h2>Danh sách campaign (' + campaigns.length + ')</h2><div class="cards">' + campaigns.map(function (c) {
      var ctasks3 = Store.list('tasks').filter(function (t) { return t.campaignId === c.id && !isArchived(t); });
      var p = D.campaignProgress(ctasks3);
      var tone = p.percentage >= 100 ? 'done' : (ctasks3.some(isOverdue) ? 'overdue' : 'running');
      var seg3 = vizTaskStatusSegments(ctasks3);
      var health3 = '<span class="viz-health" data-viz="campaign-health">' +
        (seg3.overdue ? vizStatusPillHtml('overdue', { label: seg3.overdue + ' task trễ', derived: true }) + ' ' : '') +
        (seg3.blocked ? vizStatusPillHtml('blocked', { label: seg3.blocked + ' task bị chặn', derived: true }) + ' ' : '') +
        (!seg3.overdue && !seg3.blocked && p.total ? vizStatusPillHtml('done', { label: 'Không có task trễ / bị chặn' }) : '') + '</span>';
      var donut3 = p.total ? '<div class="viz-donut-small" data-viz="campaign-card-donut">' + vizDonutSvgHtml({ segments: [{ label: 'Đã xong', value: p.completed, tone: 'done' }, { label: 'Chưa xong', value: p.total - p.completed, tone: 'todo' }], total: p.total, centerLabel: 'task', unitLabel: 'task chi tiết' }) + '</div>' : '';
      return '<div class="card"><strong><a href="#/campaigns/' + esc(c.id) + '">' + esc(c.name) + '</a></strong><p class="sub">' + statusBadge(c.status) + ' · ' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + ' · ' + esc(memberName(c.ownerId)) + '</p>' +
        donut3 +
        vizProgressBarHtml({ value: p.completed, max: p.total, pct: p.percentage, tone: tone, detail: 'Tiến độ: ' + p.completed + '/' + p.total + ' task chi tiết (' + p.percentage + '%)' }) +
        '<p>' + health3 + '</p>' +
        '<p><a class="btn small" href="#/campaigns/' + esc(c.id) + '">Mở chi tiết</a> <button class="btn small secondary" data-action="editor-open" data-kind="campaign" data-id="' + esc(c.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="campaigns" data-id="' + esc(c.id) + '"' + dis(!ed) + '>Lưu trữ</button></p></div>';
    }).join('') + '</div>';
    var archived = archivedList('campaigns');
    if (archived.length) {
      html += '<h2>Campaign đã lưu trữ</h2>' + tbl('<tr><th>Campaign</th><th>Thao tác</th></tr>' + archived.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td><button class="btn small" data-action="restore-item" data-coll="campaigns" data-id="' + esc(c.id) + '"' + dis(!ed) + '>Khôi phục</button></td></tr>';
      }).join(''), 'campaigns-archived');
    }
    return html;
  }

  // ---------- R3.1-VIZ: lớp trình bày chart-first (chỉ trình bày) ----------
  // NGUYÊN TẮC: khối này KHÔNG tính lại nghiệp vụ. Mọi con số tiền/KPI đi vào
  // chart đều lấy từ D.summarizeBudgetScope / D.rollupKpi /
  // D.allocationShareForScope (qua các adapter summarizeCampaignBudget /
  // summarizeActivityBudget / kpiRollupFor ở dưới) hoặc từ đúng dữ liệu Store
  // hiện tại (content mix qua contentMixRows, Thu–Chi qua cashTransactions /
  // Store.listCashBalances). Helper thuần trong vùng PURE chỉ làm toán
  // TRÌNH BÀY (tỷ lệ % cho bề rộng thanh, gom nhóm tháng để vẽ cột) trên các
  // số đã được domain chốt — không định nghĩa công thức nghiệp vụ mới.
  // R3.1-VIZ-PURE-BEGIN
  function vizPct(part, whole) {
    if (part === null || part === undefined || whole === null || whole === undefined || whole === '' || isNaN(Number(part)) || isNaN(Number(whole)) || Number(whole) === 0) return null;
    return Math.round(Number(part) / Number(whole) * 10000) / 100;
  }
  function vizBarWidth(pct) {
    if (pct === null || pct === undefined || isNaN(Number(pct))) return 0;
    return Math.max(0, Math.min(100, Math.round(Number(pct) * 100) / 100));
  }
  function vizBudgetRowState(row) {
    row = row || {};
    var used = (row.forecastUse !== null && row.forecastUse !== undefined) ? Number(row.forecastUse) : (Number(row.actualTotal) || 0) + (Number(row.openCommitments) || 0);
    var ceiling = (row.ceiling === null || row.ceiling === undefined) ? null : Number(row.ceiling);
    var available = (row.available === null || row.available === undefined) ? null : Number(row.available);
    var over = ceiling !== null && ceiling > 0 && used > ceiling;
    var warn = over || (ceiling !== null && ceiling > 0 && available !== null && available <= 0);
    return { used: used, ceiling: ceiling, available: available, usedPct: vizPct(used, ceiling), over: over, warn: warn };
  }
  function vizKpiState(roll) {
    if (!roll || roll.status === 'insufficient_data' || roll.value === null || roll.value === undefined) {
      return { kind: 'insufficient_data', label: 'Chưa đủ dữ liệu', value: null, pct: null };
    }
    return { kind: 'ok', label: '', value: roll.value, pct: (roll.achievementPercent === null || roll.achievementPercent === undefined) ? null : roll.achievementPercent };
  }
  function vizCashMonthly(txns, currencyOf) {
    var groups = {};
    var order = [];
    (txns || []).forEach(function (t) {
      if (!t) return;
      var rawDate = t.occurredOn || t.occurred_on || t.date || t.createdAt || '';
      var month = /^\d{4}-\d{2}/.test(String(rawDate)) ? String(rawDate).slice(0, 7) : 'unknown';
      var cur = t.currency || (typeof currencyOf === 'function' ? currencyOf(t.accountId) : null) || 'VND';
      var key = month + '|' + cur;
      if (!groups[key]) { groups[key] = { month: month, currency: cur, inTotal: 0, outTotal: 0, net: 0, count: 0 }; order.push(key); }
      var amt = Number(t.amount) || 0;
      if (t.direction === 'in') groups[key].inTotal += amt; else if (t.direction === 'out') groups[key].outTotal += amt; else return;
      groups[key].net = groups[key].inTotal - groups[key].outTotal;
      groups[key].count++;
    });
    return order.map(function (k) { return groups[k]; }).sort(function (a, b) { return (a.month + a.currency).localeCompare(b.month + b.currency); });
  }
  function vizMonthLabel(month) {
    if (!month || month === 'unknown') return 'Chưa rõ tháng';
    var p = String(month).split('-');
    return 'Tháng ' + Number(p[1]) + '/' + p[0];
  }
  function fmtPct(p) { return (p === null || p === undefined || isNaN(Number(p))) ? '—' : fmtNum(Math.round(Number(p) * 100) / 100) + '%'; }
  function vizBarRowHtml(label, value, max, cls, valueText) {
    var w = (max && Number(max) > 0 && value !== null && value !== undefined && !isNaN(Number(value))) ? vizBarWidth(Number(value) / Number(max) * 100) : 0;
    return '<div class="viz-row"><span class="viz-label">' + esc(label) + '</span><span class="viz-track"><span class="viz-fill ' + esc(cls || '') + '" style="width:' + w + '%"></span></span><span class="viz-value">' + esc(valueText) + '</span></div>';
  }
  function vizBudgetBars(alloc, actual, open) {
    return [
      { label: 'Phân bổ', value: alloc, cls: 'is-alloc' },
      { label: 'Thực chi', value: actual, cls: 'is-actual' },
      { label: 'Cam kết chưa trả', value: open, cls: 'is-commit' }
    ];
  }
  function vizBudgetGroupsChartHtml(groups) {
    var legend = vizLegendHtml([{ label: 'Phân bổ', series: 'alloc' }, { label: 'Thực chi', series: 'actual' }, { label: 'Cam kết chưa trả', series: 'commit' }], { chartId: 'budget-groups-legend' });
    return '<div class="viz-chart" data-viz="budget-groups-chart"><div class="viz-scroll-inner">' + legend + (groups || []).map(function (g) {
      var max = 0;
      (g.bars || []).forEach(function (b) { var v = Number(b.value) || 0; if (v > max) max = v; });
      return '<div class="viz-group" data-viz-group="' + esc(g.title) + '"><div class="viz-group-title">' + esc(g.title) + '</div>' +
        (g.bars || []).map(function (b) { return vizBarRowHtml(b.label, b.value, max, b.cls, fmtMoney(b.value, g.currency)); }).join('') + '</div>';
    }).join('') + '</div></div>';
  }
  function vizKpiRowsHtml(rows) {
    return '<div class="viz-chart" data-viz="kpi-progress-chart">' + (rows || []).map(function (r) {
      var st = r.state || { kind: 'insufficient_data', label: 'Chưa đủ dữ liệu' };
      if (st.kind !== 'ok') {
        return '<div class="viz-row viz-kpi-row" data-viz-kpi-state="insufficient_data"><span class="viz-label"><strong>' + esc(r.name) + '</strong>' + (r.scopeLabel ? '<br><span class="sub">' + esc(r.scopeLabel) + '</span>' : '') + '</span><span class="viz-track viz-track-empty"><span class="viz-fill" style="width:0%"></span></span><span class="viz-value">' + vizStatusPillHtml('pending', { label: st.label || 'Chưa đủ dữ liệu' }) + '</span></div>';
      }
      var pctText = st.pct === null ? 'Chưa đặt mục tiêu' : fmtPct(st.pct);
      if (st.pct === null) {
        return '<div class="viz-row viz-kpi-row viz-kpi-notarget" data-viz-kpi-state="ok"><span class="viz-label"><strong>' + esc(r.name) + '</strong>' + (r.scopeLabel ? '<br><span class="sub">' + esc(r.scopeLabel) + '</span>' : '') + '</span><span class="viz-value">' + esc(r.actualText || '') + ' · chưa đặt mục tiêu</span></div>';
      }
      return '<div class="viz-row viz-kpi-row" data-viz-kpi-state="ok"><span class="viz-label"><strong>' + esc(r.name) + '</strong>' + (r.scopeLabel ? '<br><span class="sub">' + esc(r.scopeLabel) + '</span>' : '') + '</span><span class="viz-track"><span class="viz-fill series-actual" style="width:' + vizBarWidth(st.pct) + '%"></span></span><span class="viz-value">' + esc(r.actualText || '') + ' / ' + esc(r.targetText || '—') + ' (' + esc(pctText) + ')</span></div>';
    }).join('') + '</div>';
  }
  function vizShareRowsHtml(rows, denominator, unitLabel, chartId) {
    return '<div class="viz-chart" data-viz="' + esc(chartId || 'share-chart') + '"><p class="sub">Mẫu số: <strong>' + esc(denominator) + '</strong> ' + esc(unitLabel) + ' — tỷ trọng tính trên đúng mẫu số này.</p>' +
      (rows || []).map(function (r) {
        var pct = vizPct(r.total, denominator);
        return vizBarRowHtml(r.label, r.total, denominator, 'is-alloc', fmtNum(r.total) + ' (' + fmtPct(pct) + ')');
      }).join('') + '</div>';
  }
  function vizCashColumnsHtml(monthly, currency) {
    var rows = (monthly || []).filter(function (m) { return m.currency === currency; });
    var max = 0;
    rows.forEach(function (m) { max = Math.max(max, Number(m.inTotal) || 0, Number(m.outTotal) || 0); });
    return '<div class="viz-chart" data-viz="cash-columns">' + vizLegendHtml([{ label: 'Thu', series: 'in' }, { label: 'Chi', series: 'out' }, { label: 'Đơn vị tiền: ' + currency, noDot: true }], { chartId: 'cash-columns-legend' }) + '<div class="viz-cols">' + rows.map(function (m) {
      var hIn = max > 0 ? vizBarWidth(Number(m.inTotal) / max * 100) : 0;
      var hOut = max > 0 ? vizBarWidth(Number(m.outTotal) / max * 100) : 0;
      return '<div class="viz-col"><div class="viz-col-bars"><span class="viz-col-bar is-in" style="height:' + Math.max(2, hIn) + '%" title="Thu ' + esc(fmtMoney(m.inTotal, currency)) + '"></span><span class="viz-col-bar is-out" style="height:' + Math.max(2, hOut) + '%" title="Chi ' + esc(fmtMoney(m.outTotal, currency)) + '"></span></div><div class="viz-col-label">' + esc(vizMonthLabel(m.month)) + '</div><div class="sub">Thu ' + esc(fmtMoney(m.inTotal, currency)) + '<br>Chi ' + esc(fmtMoney(m.outTotal, currency)) + '<br>Ròng ' + esc(fmtMoney(m.net, currency)) + '</div></div>';
    }).join('') + '</div></div>';
  }
  // ---------- WAVE-A-VIZ2: helper thuần hệ trực quan thống nhất ----------
  // Map mã trạng thái -> tông chuẩn (DESIGN_SYSTEM_SPEC §2.3). Nhãn tiếng
  // Việt KHÔNG đổi (vẫn qua labelStatus ở adapter); đây chỉ là tông màu.
  var STATUS_TONE = {
    active: 'running', in_progress: 'running', open: 'running', scheduled: 'running',
    completed: 'done', complete: 'done', done: 'done', approved: 'done', published: 'done',
    settled: 'done', resolved: 'done', executed: 'done', converted: 'done', accepted: 'done', final: 'done',
    overdue: 'overdue', rejected: 'overdue',
    pending: 'pending', pending_approval: 'pending', in_review: 'pending', ready_for_review: 'pending',
    submitted: 'pending', needs_review: 'pending', needs_reapproval: 'pending', changes_requested: 'pending',
    partial: 'pending', partially_actualised: 'pending',
    blocked: 'blocked',
    todo: 'todo', not_started: 'todo',
    cancelled: 'cancelled', canceled: 'cancelled',
    draft: 'neutral', editing: 'neutral', planning: 'neutral', new: 'neutral',
    paused: 'neutral', archived: 'neutral', closed: 'neutral'
  };
  function vizStatusTone(status, context) {
    var s = String(status || '').toLowerCase();
    if (!s) return 'neutral';
    if (context === 'blocker' && s === 'open') return 'blocked';
    return STATUS_TONE[s] || 'neutral';
  }
  function vizStatusPillHtml(status, opts) {
    opts = opts || {};
    var tone = opts.tone || vizStatusTone(status, opts.context);
    var label = opts.label || (typeof labelStatus === 'function' ? labelStatus(status) : String(status || '—'));
    return '<span class="badge st-' + tone + (tone === 'cancelled' ? ' viz-cancelled' : '') + '" data-viz="status-pill" data-viz-tone="' + tone + '"' + (opts.derived ? ' data-viz-derived="1"' : '') + '>' + esc(label) + '</span>';
  }
  function vizStatusDotHtml(tone, title) {
    var t = tone || 'neutral';
    return '<span class="viz-dot st-bg-' + esc(t) + '" data-viz="status-dot" data-viz-tone="' + esc(t) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '></span>';
  }
  function vizLegendHtml(items, opts) {
    opts = opts || {};
    if (!items || !items.length) return '';
    return '<div class="viz-legend" data-viz="' + esc(opts.chartId || 'legend') + '">' + items.map(function (it) {
      var dotCls = it.tone ? 'st-bg-' + it.tone : (it.series ? 'series-' + it.series : (it.cat ? 'cat-' + it.cat : 'st-bg-neutral'));
      return '<span>' + (it.noDot ? '' : '<span class="viz-dot ' + dotCls + '"></span>') + esc(it.label) + (it.valueText ? ' — ' + esc(it.valueText) : '') + '</span>';
    }).join('') + '</div>';
  }
  function vizEmptyChartHtml(text) {
    return '<div class="state-box" data-viz="empty-chart">' + esc(text || 'Chưa có dữ liệu để vẽ biểu đồ.') + '</div>';
  }
  function vizSegClass(seg, idx) {
    if (seg.tone) return 'st-fill-' + seg.tone;
    if (seg.series) return 'series-' + seg.series;
    if (seg.cat) return 'cat-' + seg.cat;
    return 'cat-' + ((idx % 8) + 1);
  }
  function vizSegVar(seg, idx) {
    if (seg.tone) return 'var(--st-' + seg.tone + ')';
    if (seg.series) return 'var(--series-' + seg.series + ')';
    if (seg.cat) return 'var(--cat-' + seg.cat + ')';
    return 'var(--cat-' + ((idx % 8) + 1) + ')';
  }
  function vizSegDotItem(seg, idx, valueText) {
    var item = { label: seg.label, valueText: valueText };
    if (seg.tone) item.tone = seg.tone; else if (seg.series) item.series = seg.series; else if (seg.cat) item.cat = seg.cat; else item.cat = (idx % 8) + 1;
    return item;
  }
  function vizProgressBarHtml(opts) {
    opts = opts || {};
    var pct = (opts.pct !== null && opts.pct !== undefined) ? Number(opts.pct) : vizPct(opts.value, opts.max);
    var tone = opts.tone || (pct !== null && pct >= 100 ? 'done' : 'running');
    var detail = opts.detail || ((opts.value !== null && opts.value !== undefined && opts.max !== null && opts.max !== undefined)
      ? fmtNum(opts.value) + ' / ' + fmtNum(opts.max) + ' (' + fmtPct(pct) + ')'
      : (pct !== null ? fmtPct(pct) : '—'));
    return '<div class="viz-progress" data-viz="progress-bar" data-viz-tone="' + esc(tone) + '">' +
      (opts.label ? '<div class="sub"><strong>' + esc(opts.label) + '</strong></div>' : '') +
      '<span class="viz-track' + (pct === null ? ' viz-track-empty' : '') + '"><span class="viz-fill st-fill-' + esc(tone) + '" style="width:' + vizBarWidth(pct) + '%"></span></span>' +
      '<span class="sub">' + esc(detail) + '</span></div>';
  }
  function vizHBarHtml(opts) {
    opts = opts || {};
    var cls = opts.series ? 'series-' + opts.series : 'st-fill-' + (opts.tone || 'running');
    var w = (opts.max && Number(opts.max) > 0 && opts.value !== null && opts.value !== undefined && !isNaN(Number(opts.value))) ? vizBarWidth(Number(opts.value) / Number(opts.max) * 100) : 0;
    return '<div class="viz-row" data-viz="hbar"><span class="viz-label">' + esc(opts.label || '') + (opts.sub ? '<br><span class="sub">' + esc(opts.sub) + '</span>' : '') + '</span><span class="viz-track"><span class="viz-fill ' + cls + '" style="width:' + w + '%"></span></span><span class="viz-value">' + esc(opts.valueText || '') + '</span></div>';
  }
  function vizCellBarHtml(opts) {
    opts = opts || {};
    var pct = vizPct(opts.value, opts.max);
    var tone = opts.tone || (pct !== null && pct >= 100 ? 'done' : 'running');
    var text = opts.text || ((opts.value !== null && opts.value !== undefined ? fmtNum(opts.value) : '—') + ' / ' + (opts.max !== null && opts.max !== undefined ? fmtNum(opts.max) : '—') + ' (' + fmtPct(pct) + ')');
    return '<div class="viz-mini viz-cell" data-viz="cell-bar" data-viz-tone="' + esc(tone) + '"><span class="viz-track' + (pct === null ? ' viz-track-empty' : '') + '"><span class="viz-fill st-fill-' + esc(tone) + '" style="width:' + vizBarWidth(pct) + '%"></span></span><span class="sub">' + esc(text) + '</span></div>';
  }
  // Tiến độ checklist trên thẻ/hàng việc: "☑ x/y" + thanh mini. Số CHỈ qua
  // Domain.checklistProgress (cùng nguồn với panel chi tiết). Việc không có
  // checklist (total = 0) → chuỗi rỗng, không hiện gì. Tông màu theo hệ màu
  // trạng thái hiện hành: xong hết = done, còn lại = running.
  function checklistBadgeHtml(task) {
    var cp = D.checklistProgress(task);
    if (!cp.total) return '';
    var tone = cp.percentage >= 100 ? 'done' : 'running';
    return '<span class="task-checklist" data-viz="task-checklist" title="Checklist: ' + cp.done + '/' + cp.total + ' (' + cp.percentage + '%)">' +
      '<span class="task-checklist-label">☑ ' + cp.done + '/' + cp.total + '</span>' +
      '<span class="viz-track task-checklist-track"><span class="viz-fill st-fill-' + tone + '" style="width:' + cp.percentage + '%"></span></span></span>';
  }
  function vizStackedBarHtml(opts) {
    opts = opts || {};
    var segs = (opts.segments || []).filter(function (s) { return s && Number(s.value) > 0; });
    var total = (opts.total !== null && opts.total !== undefined) ? Number(opts.total) : segs.reduce(function (a, s) { return a + (Number(s.value) || 0); }, 0);
    if (!segs.length || !(total > 0)) return vizEmptyChartHtml(opts.emptyText || 'Chưa có dữ liệu để vẽ thanh tỉ trọng.');
    var bar = segs.map(function (s, i) {
      var pct = vizPct(s.value, total);
      return '<span class="viz-stacked-seg ' + vizSegClass(s, i) + '" style="width:' + vizBarWidth(pct) + '%" title="' + esc(s.label) + ': ' + esc(fmtNum(s.value)) + ' (' + esc(fmtPct(pct)) + ')"></span>';
    }).join('');
    var legend = vizLegendHtml(segs.map(function (s, i) { return vizSegDotItem(s, i, fmtNum(s.value) + ' (' + fmtPct(vizPct(s.value, total)) + ')'); }));
    return '<div class="viz-chart" data-viz="stacked-bar">' + (opts.unitLabel ? '<p class="sub">Mẫu số: <strong>' + esc(fmtNum(total)) + '</strong> ' + esc(opts.unitLabel) + '</p>' : '') +
      '<div class="viz-stacked">' + bar + '</div>' + legend + '</div>';
  }
  function vizDonutSvgHtml(opts) {
    opts = opts || {};
    var segs = (opts.segments || []).filter(function (s) { return s && Number(s.value) > 0; });
    var total = (opts.total !== null && opts.total !== undefined) ? Number(opts.total) : segs.reduce(function (a, s) { return a + (Number(s.value) || 0); }, 0);
    if (!segs.length || !(total > 0)) return vizEmptyChartHtml(opts.emptyText || 'Chưa có dữ liệu để vẽ biểu đồ vòng.');
    var C = 2 * Math.PI * 42;
    var cum = 0;
    var circles = segs.map(function (s, i) {
      var len = Number(s.value) / total * C;
      var html = '<circle cx="60" cy="60" r="42" fill="none" style="stroke:' + vizSegVar(s, i) + '" stroke-width="16" stroke-dasharray="' + (Math.round(len * 100) / 100) + ' ' + (Math.round((C - len) * 100) / 100) + '" stroke-dashoffset="' + (Math.round(-cum * 100) / 100) + '" transform="rotate(-90 60 60)"></circle>';
      cum += len;
      return html;
    }).join('');
    var titleText = (opts.centerLabel || 'Tổng') + ': ' + fmtNum(total) + ' — ' + segs.map(function (s) { return s.label + ' ' + fmtNum(s.value) + ' (' + fmtPct(vizPct(s.value, total)) + ')'; }).join('; ');
    var legendRows = segs.map(function (s, i) {
      var item = vizSegDotItem(s, i, '');
      var dotCls = item.tone ? 'st-bg-' + item.tone : (item.series ? 'series-' + item.series : 'cat-' + item.cat);
      return '<div class="viz-donut-row"><span class="viz-dot ' + dotCls + '"></span><span>' + esc(s.label) + '</span><strong>' + esc(fmtNum(s.value)) + ' (' + esc(fmtPct(vizPct(s.value, total))) + ')</strong></div>';
    }).join('');
    return '<div class="viz-chart" data-viz="donut"><div class="viz-donut-wrap">' +
      '<svg class="viz-donut-svg" viewBox="0 0 120 120" role="img" aria-label="' + esc(titleText) + '"><title>' + esc(titleText) + '</title>' +
      '<circle cx="60" cy="60" r="42" fill="none" stroke="var(--track)" stroke-width="16"></circle>' + circles +
      '<text x="60" y="58" text-anchor="middle" font-size="15" font-weight="800" fill="var(--text)">' + esc(fmtNum(total)) + '</text>' +
      '<text x="60" y="74" text-anchor="middle" font-size="9" fill="var(--muted)">' + esc(opts.centerLabel || 'Tổng') + '</text></svg>' +
      '<div class="viz-donut-legend">' + legendRows + (opts.unitLabel ? '<p class="sub">Mẫu số: <strong>' + esc(fmtNum(total)) + '</strong> ' + esc(opts.unitLabel) + '</p>' : '') + '</div>' +
      '</div></div>';
  }
  function vizLineAreaSvgHtml(opts) {
    opts = opts || {};
    var points = opts.points || [];
    var valid = points.filter(function (p) { return p && p.y !== null && p.y !== undefined && !isNaN(Number(p.y)); });
    if (!points.length || !valid.length) return vizEmptyChartHtml(opts.emptyText || 'Chưa có dữ liệu để vẽ biểu đồ đường.');
    var ys = valid.map(function (p) { return Number(p.y); });
    var min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    if (min === max) { min -= 1; max += 1; }
    var W = 320, H = 120, padL = 10, padR = 46, padT = 12, padB = 20;
    var plotW = W - padL - padR, plotH = H - padT - padB, baseY = padT + plotH;
    function xFor(i) { return points.length <= 1 ? padL + plotW / 2 : padL + i / (points.length - 1) * plotW; }
    function yFor(v) { return padT + (1 - (Number(v) - min) / (max - min)) * plotH; }
    var runs = [], cur = [];
    points.forEach(function (p, i) {
      if (p && p.y !== null && p.y !== undefined && !isNaN(Number(p.y))) cur.push(i);
      else if (cur.length) { runs.push(cur); cur = []; }
    });
    if (cur.length) runs.push(cur);
    var shapes = '';
    runs.forEach(function (run) {
      if (run.length < 2) return;
      var d = run.map(function (i, j) { return (j === 0 ? 'M' : 'L') + (Math.round(xFor(i) * 10) / 10) + ',' + (Math.round(yFor(points[i].y) * 10) / 10); }).join(' ');
      shapes += '<path d="' + d + ' L' + (Math.round(xFor(run[run.length - 1]) * 10) / 10) + ',' + baseY + ' L' + (Math.round(xFor(run[0]) * 10) / 10) + ',' + baseY + ' Z" fill="var(--st-running)" opacity="0.12"></path>';
      shapes += '<path d="' + d + '" fill="none" stroke="var(--st-running)" stroke-width="2"></path>';
    });
    var dots = points.map(function (p, i) {
      if (!p || p.y === null || p.y === undefined || isNaN(Number(p.y))) return '';
      return '<circle cx="' + (Math.round(xFor(i) * 10) / 10) + '" cy="' + (Math.round(yFor(p.y) * 10) / 10) + '" r="3" fill="var(--st-running)"><title>' + esc(p.x) + ': ' + esc(fmtNum(p.y)) + '</title></circle>';
    }).join('');
    var labelIdx = {};
    var step = Math.max(1, Math.ceil(points.length / 5));
    for (var li = 0; li < points.length; li += step) labelIdx[li] = true;
    labelIdx[points.length - 1] = true;
    var xlabels = points.map(function (p, i) {
      if (!labelIdx[i] || !p) return '';
      var anchor = i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle');
      return '<text x="' + (Math.round(xFor(i) * 10) / 10) + '" y="' + (H - 5) + '" text-anchor="' + anchor + '" font-size="9" fill="var(--muted)">' + esc(p.x) + '</text>';
    }).join('');
    var firstV = valid[0], lastV = valid[valid.length - 1];
    var lastIdx = points.indexOf(lastV);
    var lastLabel = '<text x="' + (W - 2) + '" y="' + (Math.round(yFor(lastV.y) * 10) / 10 + 3) + '" text-anchor="end" font-size="10" font-weight="700" fill="var(--text)">' + esc(fmtNum(lastV.y)) + '</text>';
    var titleText = (opts.yLabel ? opts.yLabel + ' — ' : '') + 'Điểm đầu: ' + firstV.x + ' = ' + fmtNum(firstV.y) + '; điểm cuối: ' + lastV.x + ' = ' + fmtNum(lastV.y);
    return '<div class="viz-chart" data-viz="line-area"><svg class="viz-line-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titleText) + '"><title>' + esc(titleText) + '</title>' +
      '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '" stroke="var(--line)"></line>' + shapes + dots + xlabels + lastLabel + '</svg>' +
      (opts.yLabel ? '<p class="sub">' + esc(opts.yLabel) + ': điểm đầu ' + esc(fmtNum(firstV.y)) + ' · điểm cuối ' + esc(fmtNum(lastV.y)) + '</p>' : '') + '</div>';
  }
  function vizDeltaHtml(opts) {
    opts = opts || {};
    if (opts.current === null || opts.current === undefined || opts.previous === null || opts.previous === undefined || isNaN(Number(opts.current)) || isNaN(Number(opts.previous))) return '';
    var cur = Number(opts.current), prev = Number(opts.previous), diff = cur - prev;
    if (prev === 0 && diff !== 0) return '';
    var pct = vizPct(diff, Math.abs(prev));
    var good = opts.invert ? diff < 0 : diff > 0;
    var tone = diff === 0 ? 'neutral' : (good ? 'done' : 'overdue');
    var arrow = diff > 0 ? '▲' : (diff < 0 ? '▼' : '—');
    return '<span class="viz-delta viz-delta-' + tone + '" data-viz="delta" data-viz-tone="' + tone + '">' + arrow + ' ' + esc(fmtNum(Math.abs(diff))) + (opts.unit ? ' ' + esc(opts.unit) : '') + (pct !== null ? ' (' + esc(fmtPct(Math.abs(pct))) + ')' : '') + '</span>';
  }
  function vizKpiCardHtml(opts) {
    opts = opts || {};
    var tone = opts.tone || 'neutral';
    var pill = (tone && opts.toneLabel) ? '<span class="badge st-' + esc(tone) + '">' + esc(opts.toneLabel) + '</span>' : '';
    var progressHtml = '';
    if (opts.progress !== null && opts.progress !== undefined) {
      progressHtml = (typeof opts.progress === 'object') ? vizProgressBarHtml(opts.progress) : vizProgressBarHtml({ pct: Number(opts.progress), tone: tone });
    }
    var deltaHtml = opts.deltaHtml || (opts.delta ? '<div class="viz-kpi-delta">' + esc(opts.delta) + '</div>' : '');
    var subHtml = opts.subHtml || (opts.sub ? '<div class="sub">' + esc(opts.sub) + '</div>' : '');
    var linkHtml = opts.href ? '<div><a href="' + esc(opts.href) + '">' + esc(opts.hrefLabel || 'Xem chi tiết') + '</a></div>' : '';
    return '<div class="card viz-kpi-card" data-viz="kpi-card" data-viz-tone="' + esc(tone) + '">' +
      '<div class="viz-kpi-top"><span class="viz-kpi-label">' + esc(opts.label || '') + '</span>' + pill + '</div>' +
      '<div class="big">' + esc(opts.valueText !== null && opts.valueText !== undefined ? opts.valueText : '—') + '</div>' +
      progressHtml + deltaHtml + subHtml + linkHtml + '</div>';
  }
  function vizCalDotsHtml(dayItems) {
    var tones = [];
    var total = 0;
    (dayItems || []).forEach(function (it) {
      if (!it) return;
      var n = Math.max(0, Math.floor(Number(it.count) || 0));
      total += n;
      for (var i = 0; i < n && tones.length < 100; i++) tones.push(it.tone || 'neutral');
    });
    if (!total) return '';
    var dots = tones.slice(0, 3).map(function (t) { return vizStatusDotHtml(t); }).join('');
    return '<span class="viz-cal-dots" data-viz="cal-dots">' + dots + (total > 3 ? '<span class="viz-cal-more">+' + (total - 3) + '</span>' : '') + '</span>';
  }
  function vizWorkloadBarHtml(row) {
    row = row || {};
    var hours = (row.hours === null || row.hours === undefined) ? null : Number(row.hours);
    var cap = (row.capacityHours === null || row.capacityHours === undefined) ? null : Number(row.capacityHours);
    var head = row.label ? '<strong>' + esc(row.label) + '</strong><br>' : '';
    if (cap === null) {
      return '<div class="viz-mini viz-workload" data-viz="workload-bar" data-viz-state="unconfigured">' + head +
        '<span class="viz-track viz-track-empty"><span class="viz-fill" style="width:0%"></span></span>' +
        '<span class="sub">' + esc(fmtNum(hours)) + ' giờ · Chưa cấu hình năng lực</span> <span class="badge st-pending">Chưa cấu hình</span></div>';
    }
    var pct = vizPct(hours, cap);
    var over = !!row.overCapacity || (pct !== null && pct > 100);
    var tone = over ? 'overdue' : 'done';
    return '<div class="viz-mini viz-workload" data-viz="workload-bar" data-viz-tone="' + tone + '">' + head +
      '<span class="viz-track"><span class="viz-fill st-fill-' + tone + '" style="width:' + vizBarWidth(pct) + '%"></span></span>' +
      '<span class="sub">' + esc(fmtNum(hours)) + ' / ' + esc(fmtNum(cap)) + ' giờ (' + esc(fmtPct(pct)) + ')</span>' +
      (over ? ' <span class="badge st-overdue">Vượt năng lực</span>' : '') + '</div>';
  }
  // WAVE-B3: điểm số dư LŨY KẾ theo tháng cho biểu đồ đường Thu–Chi.
  // Thuần trình bày: chỉ cộng dồn trường `net` (Thu − Chi) mà vizCashMonthly
  // đã gom theo tháng ở trên — không đọc fact gốc, không định nghĩa số mới.
  // Tháng không rõ ('unknown') bị loại khỏi đường lũy kế (không suy diễn kỳ).
  function vizCashCumulativePoints(monthly, currency) {
    var rows = (monthly || []).filter(function (m) { return m && /^\d{4}-\d{2}$/.test(String(m.month)) && (!currency || m.currency === currency); })
      .slice().sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });
    var bal = 0;
    return rows.map(function (m) { bal += Number(m.net) || 0; return { x: vizMonthLabel(m.month), y: bal }; });
  }
  // WAVE-B3: timeline mốc ngày ngang (vd Hạn sản xuất → Hạn duyệt → Ngày
  // đăng). points = [{label, date:'YYYY-MM-DD'|datetime|'', dateText, tone}].
  // Khi mọi mốc đều có ngày hợp lệ và không giảm dần: vị trí chấm tính theo
  // tỉ lệ thời gian thật; ngược lại chấm chia đều theo thứ tự (không bịa tỉ lệ).
  function vizTimelineHtml(points) {
    var pts = (points || []).filter(function (p) { return p && p.label; });
    if (!pts.length) return '<span class="sub">—</span>';
    var times = pts.map(function (p) { var t = Date.parse(String(p.date || '').slice(0, 10) + 'T00:00:00'); return isNaN(t) ? null : t; });
    var allValid = times.every(function (t) { return t !== null; });
    var min = allValid ? Math.min.apply(null, times) : 0;
    var max = allValid ? Math.max.apply(null, times) : 0;
    var proportional = allValid && max > min && times.every(function (t, i) { return i === 0 || t >= times[i - 1]; });
    function pctAt(i) {
      if (proportional) return vizBarWidth((times[i] - min) / (max - min) * 100);
      return pts.length <= 1 ? 50 : Math.round(i / (pts.length - 1) * 10000) / 100;
    }
    var fillTo = pctAt(pts.length - 1);
    return '<div class="viz-timeline" data-viz="timeline"><div class="viz-tl-track"><span class="viz-tl-fill" style="width:' + fillTo + '%"></span></div>' +
      pts.map(function (p, i) {
        return '<span class="viz-tl-point' + (i === 0 ? ' is-first' : '') + (i === pts.length - 1 ? ' is-last' : '') + '" style="left:' + pctAt(i) + '%">' +
          vizStatusDotHtml(p.tone || 'running') +
          '<span class="viz-tl-label">' + esc(p.label) + '<strong>' + esc(p.dateText || '—') + '</strong></span></span>';
      }).join('') + '</div>';
  }
  // ---------- WAVE-B4-VIZ2: helper thuần bổ sung (chỉ toán trình bày) ----------
  // Chênh lệch ngày giữa hai mốc ISO (chỉ phần ngày) — toán lịch thuần.
  function vizDayDiff(fromISO, toISO) {
    if (!fromISO || !toISO) return null;
    var a = String(fromISO).slice(0, 10), b = String(toISO).slice(0, 10);
    var ta = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
    var tb = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
    if (isNaN(ta) || isNaN(tb)) return null;
    return Math.round((tb - ta) / 86400000);
  }
  // Mini timeline tương đối của 1 việc: đoạn start→due đặt trong cửa sổ
  // [mốc sớm nhất, mốc muộn nhất] gồm cả hôm nay; phần đã trôi qua đậm hơn,
  // vạch mảnh = hôm nay. Thiếu cả hai mốc -> chuỗi rỗng (view tự ghi chữ).
  function vizTaskBarHtml(opts) {
    opts = opts || {};
    var start = opts.start ? String(opts.start).slice(0, 10) : null;
    var due = opts.due ? String(opts.due).slice(0, 10) : null;
    var today = opts.today ? String(opts.today).slice(0, 10) : null;
    if ((!start && !due) || !today) return '';
    var lo = [start, due, today].filter(Boolean).sort()[0];
    var hi = [start, due, today].filter(Boolean).sort().slice(-1)[0];
    var span = vizDayDiff(lo, hi);
    if (span === null) return '';
    if (span <= 0) span = 1;
    function pos(iso) { var d = vizDayDiff(lo, iso); return d === null ? 0 : Math.max(0, Math.min(100, Math.round(d / span * 10000) / 100)); }
    var barL = pos(start || due), barR = pos(due || start);
    if (barR - barL < 4) barR = Math.min(100, barL + 4);
    var todayPos = pos(today);
    var elR = Math.max(barL, Math.min(barR, todayPos));
    var tone = opts.tone || 'running';
    var label = (opts.startLabel || '—') + ' → ' + (opts.dueLabel || 'Chưa xếp lịch');
    return '<div class="viz-timeline" data-viz="task-timeline" data-viz-tone="' + esc(tone) + '">' +
      '<span class="viz-timeline-track"><span class="viz-timeline-bar st-fill-' + esc(tone) + '" style="left:' + barL + '%;width:' + (barR - barL) + '%"></span>' +
      '<span class="viz-timeline-elapsed st-fill-' + esc(tone) + '" style="left:' + barL + '%;width:' + (elR - barL) + '%"></span>' +
      '<span class="viz-timeline-today" style="left:' + todayPos + '%" title="Hôm nay"></span></span>' +
      '<span class="sub">' + esc(label) + '</span></div>';
  }
  // Badge đếm phụ thuộc: đang chờ việc khác (tông blocked) / việc khác đang
  // chờ mình (tông pending); chi tiết tên việc nằm ở title.
  function vizDepBadgesHtml(opts) {
    opts = opts || {};
    var w = Math.max(0, Math.floor(Number(opts.waitingCount) || 0));
    var b = Math.max(0, Math.floor(Number(opts.blockingCount) || 0));
    if (!w && !b) return '<span class="sub">Không phụ thuộc</span>';
    var out = '';
    if (w) out += '<span class="badge st-blocked" data-viz="dep-badge" data-viz-tone="blocked" title="Đang chờ: ' + esc((opts.waitingTitles || []).join(', ')) + '">Đang chờ: ' + w + '</span> ';
    if (b) out += '<span class="badge st-pending" data-viz="dep-badge" data-viz-tone="pending" title="Task đang chờ mình: ' + esc((opts.blockingTitles || []).join(', ')) + '">Chờ mình: ' + b + '</span>';
    return out.trim();
  }
  // Số gọn kiểu Việt: 3,5 nghìn / 1,2 triệu; số nhỏ giữ nguyên fmtNum.
  function vizCompactNum(n) {
    if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—';
    var v = Number(n), av = Math.abs(v);
    function r1(x) { return (Math.round(x * 10) / 10).toLocaleString('vi-VN'); }
    if (av >= 1000000) return r1(v / 1000000) + ' triệu';
    if (av >= 10000) return r1(v / 1000) + ' nghìn';
    return fmtNum(v);
  }
  // Phễu nhiều bước: bề rộng theo bước đầu; mỗi bước in số + % so với đầu.
  function vizFunnelHtml(opts) {
    opts = opts || {};
    var steps = (opts.steps || []).filter(function (s) { return s && s.value !== null && s.value !== undefined && !isNaN(Number(s.value)); });
    if (!steps.length || !(Number(steps[0].value) > 0)) return vizEmptyChartHtml(opts.emptyText || 'Chưa có dữ liệu để vẽ phễu.');
    var first = Number(steps[0].value);
    var rows = steps.map(function (s, i) {
      var pct = vizPct(s.value, first);
      var conv = i > 0 ? vizPct(s.value, steps[i - 1].value) : null;
      return '<div class="viz-row" data-viz="funnel-step"><span class="viz-label"><strong>' + esc(s.label) + '</strong></span>' +
        '<span class="viz-track"><span class="viz-fill series-alloc" style="width:' + vizBarWidth(pct) + '%;opacity:' + (Math.round((1 - i * 0.18) * 100) / 100) + '"></span></span>' +
        '<span class="viz-value">' + esc(fmtNum(s.value)) + ' (' + esc(fmtPct(pct)) + ')' + (conv !== null ? ' · chuyển đổi ' + esc(fmtPct(conv)) : '') + '</span></div>';
    }).join('');
    return '<div class="viz-chart" data-viz="ads-funnel">' + rows + '</div>';
  }
  // Thanh cột mini theo ngày (Team): cột > 8 giờ mang tông overdue theo đúng
  // ngưỡng cảnh báo view đang dùng; nhãn + số nằm ngay dưới/trên cột.
  function vizMiniDayBarsHtml(opts) {
    opts = opts || {};
    var days = (opts.days || []).filter(function (d) { return d && d.hours !== null && d.hours !== undefined && !isNaN(Number(d.hours)); });
    if (!days.length) return '';
    var max = Number(opts.max) || 0;
    days.forEach(function (d) { if (Number(d.hours) > max) max = Number(d.hours); });
    if (!(max > 0)) max = 8;
    var cols = days.map(function (d) {
      var h = Number(d.hours);
      var tone = h > 8 ? 'overdue' : 'running';
      var pct = Math.max(0, Math.min(100, Math.round(h / max * 10000) / 100));
      return '<span class="viz-daybar" title="' + esc(d.title || (d.label + ': ' + fmtNum(h) + ' giờ')) + '"><span class="viz-daybar-val">' + esc(fmtNum(h)) + 'h</span>' +
        '<span class="viz-daybar-track"><span class="viz-daybar-fill st-fill-' + tone + '" style="height:' + pct + '%"></span></span>' +
        '<span class="viz-daybar-label">' + esc(d.label) + '</span></span>';
    }).join('');
    return '<div class="viz-daybars" data-viz="day-bars">' + cols + '</div>';
  }
  // Chấm phân loại (pillar/kênh/loại tài nguyên) theo --cat-*.
  function vizCatDotHtml(cat, title) {
    var c = Math.max(1, Math.min(8, Math.floor(Number(cat) || 1)));
    return '<span class="viz-dot cat-' + c + '" data-viz="cat-dot" data-viz-cat="' + c + '"' + (title ? ' title="' + esc(title) + '"' : '') + '></span>';
  }
  // Chỉ số cat cho loại tài nguyên: từ khóa quen thuộc trước, còn lại băm
  // thuần từ chính chuỗi loại (cùng loại -> cùng màu ở mọi nơi).
  function vizAssetCatIndex(type) {
    var t = String(type || '').toLowerCase();
    if (/logo/.test(t)) return 1;
    if (/hình ảnh|image|kv|ảnh/.test(t)) return 2;
    if (/hướng dẫn|guide|guideline/.test(t)) return 3;
    if (/video|clip/.test(t)) return 4;
    if (/font|chữ/.test(t)) return 5;
    if (/tài liệu|document|doc/.test(t)) return 6;
    if (/âm thanh|audio|nhạc/.test(t)) return 7;
    var sum = 0;
    for (var i = 0; i < t.length; i++) sum += t.charCodeAt(i);
    return (sum % 8) + 1;
  }
  // Ô xem trước tài nguyên Brand: có ảnh thì dùng ảnh; không thì ô giữ chỗ
  // có chữ cái đầu + chấm phân loại theo loại tài nguyên.
  function vizBrandThumbHtml(opts) {
    opts = opts || {};
    var cat = vizAssetCatIndex(opts.type);
    if (opts.isImg && opts.url) {
      return '<span class="brand-thumb-wrap" data-viz="brand-thumb"><img class="asset-thumb-lg" src="' + esc(opts.url) + '" alt="" loading="lazy">' + vizCatDotHtml(cat, opts.type || '') + '</span>';
    }
    var initial = String(opts.name || opts.type || '?').trim().charAt(0).toUpperCase() || '?';
    return '<span class="brand-thumb-wrap" data-viz="brand-thumb"><span class="asset-thumb-ph cat-edge-' + cat + '">' + esc(initial) + '</span>' + vizCatDotHtml(cat, opts.type || '') + '</span>';
  }
  // R3.1-VIZ-PURE-END
  // --- Adapter: chuẩn bị dữ liệu chart TỪ các hàm domain/Store hiện có ---
  // WAVE-A-VIZ2 adapter: tông SUY RA của task (SPEC §2.3) — chỉ đọc kết quả
  // D.assessTaskRisk + isOverdue có sẵn, không định nghĩa rủi ro mới.
  // Trả 'overdue' | 'blocked' | null (không có tình huống suy ra).
  function vizTaskDerivedTone(t) {
    if (!t || isCompletedTask(t)) return null;
    try {
      var r = D.assessTaskRisk(t, { today: todayISO(), tasks: Store.list('tasks'), dependencies: Store.list('dependencies'), blockers: Store.list('blockers') });
      if (r && r.reasons && r.reasons.indexOf('overdue') !== -1) return 'overdue';
      if (r && r.reasons && (r.reasons.indexOf('blocker') !== -1 || r.reasons.indexOf('negative_slack') !== -1)) return 'blocked';
    } catch (e) { /* rơi xuống kiểm tra quá hạn đơn giản bên dưới */ }
    if (isOverdue(t)) return 'overdue';
    return null;
  }
  // Tông hiển thị của 1 hàng Gantt: hoàn thành -> done; suy ra trễ/chặn qua
  // adapter trên (với task); còn lại theo tông của status gốc.
  function vizGanttRowTone(r) {
    if (!r) return 'neutral';
    if (r.completed) return 'done';
    if (r.overdue) return 'overdue';
    if (r.blocked) return 'blocked';
    if (r.coll === 'tasks' && r.id) { var t = taskById(r.id); var dt = t ? vizTaskDerivedTone(t) : null; if (dt) return dt; }
    return vizStatusTone(r.status || '');
  }
  // ---------- WAVE-B2: adapter trực quan cho Campaigns + chi tiết campaign ----------
  // Chỉ TRÌNH BÀY: mọi số lấy từ D.campaignProgress / summarizeCampaignBudget /
  // summarizeActivityBudget / kpiRollupFor / activityStatusInfo / isOverdue +
  // blockers đang mở (đúng cách đếm của activityStatusInfo) — không công thức mới.
  function vizBlockedTaskIdSet() {
    var m = {};
    Store.list('blockers').forEach(function (b) { if (b && b.status === 'open' && b.taskId) m[b.taskId] = true; });
    return m;
  }
  function vizTaskIsBlocked(t, blockedIds) {
    if (!t) return false;
    if (t.isBlocked) return true;
    var m = blockedIds || vizBlockedTaskIdSet();
    return !!m[t.id];
  }
  // Phân bổ trạng thái việc LOẠI TRỪ nhau (xong > bị chặn > trễ > còn lại) để
  // các đoạn cộng đúng bằng tổng số việc — dùng cho stacked/donut.
  function vizTaskStatusSegments(tasks) {
    var list = tasks || [];
    var blockedIds = vizBlockedTaskIdSet();
    var done = 0, blocked = 0, overdue = 0;
    list.forEach(function (t) {
      if (isCompletedTask(t)) { done++; return; }
      if (vizTaskIsBlocked(t, blockedIds)) { blocked++; return; }
      if (isOverdue(t)) { overdue++; }
    });
    var rest = list.length - done - blocked - overdue;
    if (rest < 0) rest = 0;
    var segments = [
      { label: 'Đã xong', value: done, tone: 'done' },
      { label: 'Đang làm / chưa xong', value: rest, tone: 'running' },
      { label: 'Quá hạn', value: overdue, tone: 'overdue' },
      { label: 'Bị chặn', value: blocked, tone: 'blocked' }
    ];
    return { segments: segments, total: list.length, done: done, blocked: blocked, overdue: overdue, rest: rest };
  }
  // Thanh ngân sách 3 lớp trên hạn mức: thực chi (series-actual) / cam kết chưa
  // trả (series-commit) / còn dùng được (tông done) — số nguyên vẹn từ 1 dòng
  // summarizeCampaignBudget / summarizeActivityBudget. Vượt hạn mức: mẫu số
  // nới thành dự kiến sử dụng để các đoạn không tràn quá 100%.
  function vizBudgetStackedHtml(rows) {
    var out = '';
    (rows || []).forEach(function (r) {
      if (!r || !(Number(r.ceiling) > 0 || Number(r.actualTotal) > 0 || Number(r.openCommitments) > 0)) return;
      var avail = Number(r.available) || 0;
      var total = Number(r.ceiling) || 0;
      var segs = [
        { label: 'Thực chi', value: Number(r.actualTotal) || 0, series: 'actual' },
        { label: 'Cam kết chưa trả', value: Number(r.openCommitments) || 0, series: 'commit' },
        { label: 'Còn dùng được', value: avail > 0 ? avail : 0, tone: 'done' }
      ];
      var segSum = segs.reduce(function (a, x) { return a + x.value; }, 0);
      if (total <= 0 || segSum > total) total = segSum;
      if (!(total > 0)) return;
      out += '<div data-viz="budget-stacked-row"><p class="sub"><strong>' + esc(r.currency || 'VND') + '</strong> — đã chi / cam kết / còn dùng được trên hạn mức ' + fmtMoney(r.ceiling, r.currency) + (avail < 0 ? ' · <strong>Vượt hạn mức ' + fmtMoney(-avail, r.currency) + '</strong>' : '') + '</p>' +
        vizStackedBarHtml({ segments: segs, total: total, unitLabel: (r.currency || 'VND') + ' (hạn mức)' }) + '</div>';
    });
    return out ? '<div data-viz="budget-stacked">' + out + '</div>' : '';
  }
  // ---------- KPI tự động từ bài đã đăng (post_metrics) ----------
  // Danh mục mã chỉ số của bài đã đăng: lấy NGUYÊN các mã app đang dùng cho
  // số liệu bài đăng — thư viện bài đăng / kênh đọc lifetime_views, views,
  // reach, impressions (libLatestMetric / latestMetric) và form nhập số liệu
  // TikTok gợi ý views, likes, comments, shares. Không chế mã mới ở đây.
  var POST_METRIC_OPTIONS = [
    ['lifetime_views', 'Lượt xem lũy kế'],
    ['views', 'Lượt xem'],
    ['reach', 'Tiếp cận'],
    ['impressions', 'Hiển thị'],
    ['likes', 'Lượt thích'],
    ['comments', 'Bình luận'],
    ['shares', 'Lượt chia sẻ']
  ];
  function postMetricLabel(code) {
    var hit = POST_METRIC_OPTIONS.find(function (p) { return p[0] === code; });
    return hit ? hit[1] : String(code || '—');
  }
  function kpiDefinitionObject(k) {
    if (!k || k.definition === null || k.definition === undefined) return {};
    if (typeof k.definition === 'object') return k.definition;
    if (typeof k.definition === 'string') {
      try { var parsed = JSON.parse(k.definition); return (parsed && typeof parsed === 'object') ? parsed : {}; } catch (e) { return {}; }
    }
    return {};
  }
  function kpiDataSource(k) {
    var ds = kpiDefinitionObject(k).dataSource || kpiDefinitionObject(k).data_source || null;
    return (ds && ds.type === 'post_metrics') ? ds : null;
  }
  function isKpiAuto(k) { return !!kpiDataSource(k); }
  function kpiAutoMetric(k) {
    var ds = kpiDataSource(k);
    return ds ? (ds.metric || ds.metricCode || ds.metric_code || '') : '';
  }
  // Badge + dòng phụ cho KPI auto: "từ N bài · cập nhật <thời điểm>" đọc từ
  // kpi.autoActual do store tự tính; chưa có autoActual -> ghi rõ chưa có
  // dữ liệu bài đăng, không bịa số bài/thời điểm.
  function kpiAutoInfoHtml(k) {
    if (!isKpiAuto(k)) return '';
    var aa = k.autoActual || k.auto_actual || null;
    var sub;
    if (aa && (aa.postCount !== null && aa.postCount !== undefined)) {
      sub = 'từ ' + aa.postCount + ' bài' + (aa.latestObservedAt ? ' · cập nhật ' + D.formatDateTimeVN(aa.latestObservedAt) : '');
    } else if (aa && Array.isArray(aa.rows) && aa.rows.length) {
      sub = 'từ ' + aa.rows.length + ' bài' + (aa.latestObservedAt ? ' · cập nhật ' + D.formatDateTimeVN(aa.latestObservedAt) : '');
    } else {
      sub = 'chưa có dữ liệu post';
    }
    var html = '<span class="badge st-running" data-kpi-auto-badge="1">Tự động từ post</span>' +
      '<br><span class="sub" data-kpi-auto-sub="1">' + esc(sub) + '</span>';
    if (kpiAutoMetric(k) === 'reach') {
      html += '<br><span class="sub" data-kpi-auto-reach-note="1">Tổng lượt tiếp cận theo bài — không phải số người dùng không trùng.</span>';
    }
    return html;
  }
  // Drill-down các bài cấu thành KPI auto: đọc NGUYÊN kpi.autoActual.rows
  // (postId/title/platform/value/observedAt) do store cung cấp — tổng các
  // giá trị trong bảng này phải bằng actual đang hiển thị của KPI.
  function kpiAutoDrillHtml(k) {
    if (!isKpiAuto(k)) return '';
    var aa = k.autoActual || k.auto_actual || null;
    var rows = (aa && Array.isArray(aa.rows)) ? aa.rows : [];
    if (!rows.length) return '<div data-kpi-auto-drill="1"><p class="sub">chưa có dữ liệu post</p></div>';
    var total = rows.reduce(function (s, r) { return s + (Number(r.value) || 0); }, 0);
    return '<div data-kpi-auto-drill="1"><strong>Bài cấu thành (' + rows.length + ')</strong>' +
      tbl('<tr><th>Post</th><th>Nền tảng</th><th>Giá trị</th><th>Thời điểm đo</th></tr>' + rows.map(function (r) {
        return '<tr><td>' + esc(r.title || r.postId || '—') + '</td><td>' + esc(labelStatus(r.platform || '')) + '</td><td>' + fmtNum(r.value) + '</td><td>' + (r.observedAt ? esc(D.formatDateTimeVN(r.observedAt)) : '—') + '</td></tr>';
      }).join('')) +
      '<p class="sub">Tổng các bài: <strong>' + fmtNum(total) + '</strong>' + (k.unit ? ' ' + esc(k.unit) : '') + ' — bằng số thực đạt đang hiển thị của KPI.</p></div>';
  }
  // Mini tiến độ cho 1 KPI ở bảng Action Plan: số qua kpiRollupFor (rollupKpi).
  // KPI tỉ lệ (ratio) giữ dạng chữ vì mục tiêu của tỉ lệ không phải thang 0–100%
  // tiến độ; KPI thiếu dữ liệu giữ pill cảnh báo như kpiSummaryHtml.
  function vizKpiMiniHtml(k) {
    var mode = String(k.aggregationMode || k.aggregation_mode || 'direct').toLowerCase();
    if (mode === 'ratio') return '<div class="viz-kpi-mini" data-viz="kpi-mini"><strong>' + esc(k.name) + '</strong>: ' + kpiSummaryHtml(k) + '</div>';
    var row = vizKpiRowFor(k);
    if (!row || row.state.kind !== 'ok' || row.state.value === null || row.state.value === undefined || k.target === null || k.target === undefined || !(Number(k.target) > 0)) {
      return '<div class="viz-kpi-mini" data-viz="kpi-mini"><strong>' + esc(k.name) + '</strong>: ' + kpiSummaryHtml(k) + '</div>';
    }
    var pct = row.state.pct;
    var tone = (pct !== null && pct !== undefined && pct >= 100) ? 'done' : 'running';
    var text = fmtNum(row.state.value) + ' / ' + fmtNum(k.target) + (k.unit ? ' ' + k.unit : '') + ' (' + fmtPct(pct) + ')';
    return '<div class="viz-kpi-mini" data-viz="kpi-mini"><strong>' + esc(k.name) + '</strong>' + vizCellBarHtml({ value: row.state.value, max: Number(k.target), tone: tone, text: text }) + kpiAutoInfoHtml(k) + '</div>';
  }
  // Thanh timeline tương đối của 1 việc: vị trí "hôm nay" trong khoảng
  // startDate → dueDate (toán trình bày theo ngày, không phải công thức nghiệp vụ).
  function vizTaskTimelineHtml(t) {
    if (!t || !t.startDate || !t.dueDate) return '<span class="sub">Chưa đủ ngày để vẽ timeline</span>';
    var startMs = Date.parse(String(t.startDate).slice(0, 10) + 'T00:00:00');
    var dueMs = Date.parse(String(t.dueDate).slice(0, 10) + 'T00:00:00');
    var todayMs = Date.parse(todayISO() + 'T00:00:00');
    if (isNaN(startMs) || isNaN(dueMs) || dueMs < startMs) return '<span class="sub">Chưa đủ ngày để vẽ timeline</span>';
    var totalDays = Math.round((dueMs - startMs) / 86400000);
    var elapsed = Math.round((todayMs - startMs) / 86400000);
    if (elapsed < 0) elapsed = 0;
    if (totalDays > 0 && elapsed > totalDays) elapsed = totalDays;
    var derived = vizTaskDerivedTone(t);
    var tone = derived || (isCompletedTask(t) ? 'done' : vizStatusTone(t.status || ''));
    var pct = totalDays > 0 ? vizPct(elapsed, totalDays) : (todayMs >= dueMs ? 100 : 0);
    var text = D.formatDateVN(t.startDate) + ' → ' + D.formatDateVN(t.dueDate) + ' · Hôm nay ở ' + fmtPct(pct) + ' khoảng task';
    return '<div class="viz-mini viz-timeline" data-viz="task-timeline" data-viz-tone="' + esc(tone) + '"><span class="viz-track"><span class="viz-fill st-fill-' + esc(tone) + '" style="width:' + vizBarWidth(pct) + '%"></span></span><span class="sub">' + esc(text) + '</span></div>';
  }
  // Chấm màu chủ sở hữu: màu phân loại cat-* theo hàm băm trình bày của memberId
  // (cùng người → cùng màu ở mọi bảng của vòng B2).
  function vizOwnerDotHtml(memberId) {
    var h = 0; var str = String(memberId || '');
    for (var i = 0; i < str.length; i++) h += str.charCodeAt(i);
    var cat = str ? (h % 8) + 1 : 8;
    return '<span class="viz-dot cat-' + cat + '" data-viz="owner-dot" title="' + esc(memberName(memberId)) + '"></span> ';
  }
  // Chip đếm phiên bản theo kênh: kênh sắp xếp cố định theo tên mã kênh, màu
  // cat-* theo thứ tự đã sắp đó (màu phân loại, luôn kèm nhãn + số đếm).
  function vizChannelChipsHtml(variants) {
    var counts = {};
    var labels = {};
    (variants || []).forEach(function (v) { var key = v.platform || ''; if (!key) return; counts[key] = (counts[key] || 0) + 1; if (!labels[key] && v.channelLabel) labels[key] = v.channelLabel; });
    var keys = Object.keys(counts).sort();
    if (!keys.length) return '<span class="sub">Chưa có</span>';
    return '<span class="viz-channel-chips" data-viz="channel-chips">' + keys.map(function (key, i) {
      return '<span class="viz-channel-chip"><span class="viz-dot cat-' + ((i % 8) + 1) + '"></span>' + esc(labels[key] || labelStatus(key)) + ' ×' + counts[key] + '</span>';
    }).join(' ') + '</span>';
  }
  // Dải lịch mini của campaign: gom lần đăng theo NGÀY, mỗi ngày 1 cụm chấm
  // tông trạng thái qua vizCalDotsHtml (tối đa 3 chấm + +N như lịch tháng).
  function vizCampaignCalStripHtml(pubs) {
    if (!pubs || !pubs.length) return vizEmptyChartHtml('Chưa có publication nào thuộc campaign để vẽ lịch mini.');
    var byDay = {};
    pubs.forEach(function (p) {
      var day = p.at ? String(p.at).slice(0, 10) : (p.scheduledDate ? String(p.scheduledDate).slice(0, 10) : '');
      if (!day) return;
      if (!byDay[day]) byDay[day] = {};
      var tone = vizStatusTone(p.status || '');
      byDay[day][tone] = (byDay[day][tone] || 0) + 1;
    });
    var days = Object.keys(byDay).sort();
    if (!days.length) return vizEmptyChartHtml('Các publication chưa có ngày giờ để vẽ lịch mini.');
    return '<div class="viz-cal-strip" data-viz="campaign-cal-strip"><strong>Lịch đăng theo ngày (' + pubs.length + ' publication)</strong><div class="viz-cal-days">' + days.map(function (day) {
      var items = Object.keys(byDay[day]).map(function (tone) { return { tone: tone, count: byDay[day][tone] }; });
      var n = items.reduce(function (a, x) { return a + x.count; }, 0);
      return '<span class="viz-cal-day"><span class="sub">' + esc(D.formatDateVN(day)) + ' · ' + n + ' lần</span>' + vizCalDotsHtml(items) + '</span>';
    }).join('') + '</div></div>';
  }

  function vizKpiRowFor(k) {
    var roll = kpiRollupFor(k);
    var mode = String(k.aggregationMode || k.aggregation_mode || 'direct').toLowerCase();
    var state = vizKpiState(roll);
    if (!roll && state.kind !== 'ok') {
      var d = D.kpiDisplay(k);
      if (d.isMissing) state = { kind: 'insufficient_data', label: 'Chưa cập nhật', value: null, pct: null };
      else state = { kind: 'ok', label: '', value: d.value, pct: vizPct(d.value, k.target) };
    }
    var actualText = '';
    var targetText = fmtNum(k.target) + (k.unit ? ' ' + k.unit : '');
    if (state.kind === 'ok') {
      actualText = (mode === 'ratio' ? fmtNum(Math.round(state.value)) : fmtNum(state.value)) + (k.unit ? ' ' + k.unit : '');
    }
    return { kpi: k, name: k.name, scopeLabel: kpiScopeLabel(k), state: state, actualText: actualText, targetText: targetText, roll: roll };
  }
  function vizKpiProgressHtml(kpis) {
    if (!kpis || !kpis.length) return '<p class="sub">Chưa có KPI nào để vẽ tiến độ.</p>';
    var html = vizKpiRowsHtml(kpis.map(vizKpiRowFor));
    var autos = kpis.filter(function (k) { return isKpiAuto(k); });
    if (autos.length) {
      html += '<div data-kpi-auto-list="1">' + autos.map(function (k) {
        return '<div data-kpi-auto-item="' + esc(k.id) + '"><strong>' + esc(k.name) + '</strong> ' + kpiAutoInfoHtml(k) +
          ' <button type="button" class="btn small secondary" data-action="kpi-drill" data-id="' + esc(k.id) + '">' + (UI.kpiOpenId === k.id ? 'Ẩn post cấu thành' : 'Xem post cấu thành') + '</button>' +
          (UI.kpiOpenId === k.id ? kpiAutoDrillHtml(k) : '') + '</div>';
      }).join('') + '</div>';
    }
    return html;
  }
  function vizKpiTableHtml(kpis) {
    if (!kpis || !kpis.length) return '<p class="sub">Chưa có KPI nào.</p>';
    return tbl('<tr><th>KPI</th><th>Phạm vi</th><th>Thực đạt</th><th>Mục tiêu</th><th>Mức đạt</th><th>Trạng thái</th></tr>' + kpis.map(function (k) {
      var r = vizKpiRowFor(k);
      if (r.state.kind !== 'ok') return '<tr><td><strong>' + esc(k.name) + '</strong>' + kpiAutoInfoHtml(k) + '</td><td>' + esc(r.scopeLabel) + '</td><td><span class="badge warn">' + esc(r.state.label || 'Chưa đủ dữ liệu') + '</span></td><td>' + esc(r.targetText) + '</td><td>—</td><td>' + esc(r.state.label || 'Chưa đủ dữ liệu') + '</td></tr>';
      return '<tr><td><strong>' + esc(k.name) + '</strong>' + kpiAutoInfoHtml(k) + '</td><td>' + esc(r.scopeLabel) + '</td><td>' + esc(r.actualText) + '</td><td>' + esc(r.targetText) + '</td><td>' + fmtPct(r.state.pct) + '</td><td><span class="badge ok">Đủ dữ liệu</span></td></tr>';
    }).join(''), 'kpi-summary');
  }
  function vizBudgetUsedBarHtml(r) {
    var st = vizBudgetRowState(r);
    var cls = st.over ? 'is-over' : (st.warn ? 'is-warn' : 'is-actual');
    return '<div class="viz-mini" data-viz="budget-used-bar" data-viz-over="' + (st.over ? '1' : '0') + '" data-viz-warn="' + (st.warn ? '1' : '0') + '"><span class="viz-track"><span class="viz-fill ' + cls + '" style="width:' + vizBarWidth(st.usedPct) + '%"></span></span>' +
      '<span class="sub">Đã dùng (thực chi + cam kết) ' + fmtMoney(st.used, r.currency) + ' / Phân bổ ' + fmtMoney(r.ceiling, r.currency) + ' (' + fmtPct(st.usedPct) + ')' + (st.over ? ' — <strong>Vượt phân bổ</strong>' : (st.warn ? ' — Đã hết hạn mức còn lại' : '')) + '</span></div>';
  }
  function vizBudgetActionChartHtml(c) {
    var acts = Store.list('activities').filter(function (a) { return a.campaignId === c.id; });
    if (!acts.length) return '<div class="state-box" data-viz="campaign-budget-chart">Chưa có activity nào trong Action Plan để vẽ phân bổ ngân sách.</div>';
    var groups = [];
    acts.forEach(function (a) {
      summarizeActivityBudget(c, a).forEach(function (r) {
        groups.push({ title: a.name + ' (' + r.currency + ')', currency: r.currency, bars: vizBudgetBars(r.ceiling, r.actualTotal, r.openCommitments) });
      });
    });
    return '<div data-viz="campaign-budget-chart"><h4>Biểu đồ phân bổ ngân sách theo activity</h4>' + vizBudgetGroupsChartHtml(groups) + '</div>';
  }
  function vizMixChartHtml(mix, unit) {
    var unitLabel = unit === 'publication' ? 'publication' : 'content gốc';
    var pillarRows = mix.rows.map(function (r) { return { label: r.pillarId ? pillarName(r.pillarId) : 'Chưa phân loại', total: r.total }; });
    var chTotals = {};
    mix.rows.forEach(function (r) { Object.keys(r.byChannel || {}).forEach(function (ch) { chTotals[ch] = (chTotals[ch] || 0) + r.byChannel[ch]; }); });
    var channelRows = Object.keys(chTotals).map(function (ch) { return { label: labelStatus(ch), total: chTotals[ch] }; }).sort(function (a, b) { return b.total - a.total; });
    return '<div data-viz="content-mix-chart"><h3>Tỷ trọng theo Pillar chính</h3>' + vizShareRowsHtml(pillarRows, mix.denominator, unitLabel, 'content-mix-pillar-chart') +
      '<h3>Tỷ trọng theo kênh</h3>' + (channelRows.length ? vizShareRowsHtml(channelRows, mix.denominator, unitLabel, 'content-mix-channel-chart') : '<p class="sub">Chưa có kênh nào trong dữ liệu đang lọc.</p>') + '</div>';
  }
  function vizCashBalancesSync() {
    try {
      // Chỉ dùng kết quả ĐỒNG BỘ (demo); ở chế độ supabase hàm này trả
      // Promise (đọc view riêng) nên bản đồng bộ tính từ state hiện tại —
      // cùng công thức opening + ΣThu − ΣChi của Store.listCashBalances.
      if (Store.mode !== 'supabase' && typeof Store.listCashBalances === 'function') {
        var r = Store.listCashBalances();
        if (r && !r.then && r.ok && Array.isArray(r.balances)) return r.balances;
      }
    } catch (e) { /* rơi xuống tính từ dữ liệu Store hiện tại bên dưới */ }
    var txns = listSafe('cashTransactions');
    return listSafe('cashAccounts').map(function (acc) {
      var bal = Number(acc.openingBalance || acc.opening_balance || 0);
      txns.forEach(function (t) { if (t.accountId === acc.id) bal += t.direction === 'in' ? (Number(t.amount) || 0) : -(Number(t.amount) || 0); });
      return { accountId: acc.id, currency: acc.currency || 'VND', balance: bal };
    });
  }
  function cashChartHtml() {
    var accounts = listSafe('cashAccounts');
    var txns = listSafe('cashTransactions');
    var accById = {};
    accounts.forEach(function (a) { accById[a.id] = a; });
    function accName(id) { var a = accById[id]; return a ? (a.name || a.title || id) : '—'; }
    function accCur(id) { var a = accById[id]; return a ? (a.currency || 'VND') : 'VND'; }
    var head = '<div data-viz="cash-chart"><h3>Thu–Chi &amp; số dư</h3>';
    if (!txns.length) {
      return head + '<div class="state-box" data-viz="cash-empty">Chưa có giao dịch Thu–Chi nào — chưa có dữ liệu để vẽ biểu đồ. Khi có giao dịch, biểu đồ cột Thu/Chi theo tháng và bảng số dư sẽ hiện ở đây (không vẽ số 0 giả làm dữ liệu).</div></div>';
    }
    var monthly = vizCashMonthly(txns, accCur);
    var curs = [];
    monthly.forEach(function (m) { if (curs.indexOf(m.currency) === -1) curs.push(m.currency); });
    var html = head + '<h4>Biểu đồ cột Thu / Chi theo tháng</h4>' + curs.map(function (cur) { return vizCashColumnsHtml(monthly, cur); }).join('');
    // WAVE-B3: đường số dư lũy kế theo tháng — điểm tháng lấy từ chính
    // vizCashMonthly ở trên (net từng tháng), cộng dồn thuần trình bày qua
    // vizCashCumulativePoints; đường nằm ngay dưới cột Thu/Chi cùng tiền tệ.
    html += curs.map(function (cur) {
      var pts = vizCashCumulativePoints(monthly, cur);
      if (!pts.length) return '';
      return '<h4>Đường số dư lũy kế theo tháng (' + esc(cur) + ')</h4><div data-viz="cash-balance-line">' + vizLineAreaSvgHtml({ points: pts, yLabel: 'Số dư lũy kế (' + cur + ')', emptyText: 'Chưa có tháng rõ ràng để vẽ đường số dư lũy kế.' }) + '</div>';
    }).join('');
    var balances = vizCashBalancesSync();
    html += '<h4>Số dư theo tài khoản</h4>' + (balances.length ? tbl('<tr><th>Tài khoản</th><th>Tiền tệ</th><th>Số dư</th></tr>' + balances.map(function (b) {
      return '<tr><td>' + esc(accName(b.accountId)) + '</td><td>' + esc(b.currency || accCur(b.accountId)) + '</td><td>' + fmtMoney(b.balance, b.currency || accCur(b.accountId)) + '</td></tr>';
    }).join(''), 'cash-balances') : '<p class="sub">Chưa có tài khoản Thu–Chi nào.</p>');
    var sorted = txns.slice().sort(function (a, b) { return String(b.occurredOn || b.occurred_on || b.date || '').localeCompare(String(a.occurredOn || a.occurred_on || a.date || '')); });
    html += '<h4>Giao dịch Thu–Chi (' + txns.length + ')</h4>' + tbl('<tr><th>Ngày</th><th>Tài khoản</th><th>Thu / Chi</th><th>Số tiền</th><th>Nội dung</th></tr>' + sorted.slice(0, 50).map(function (t) {
      var cur = t.currency || accCur(t.accountId);
      return '<tr><td>' + esc(D.formatDateVN(t.occurredOn || t.occurred_on || t.date)) + '</td><td>' + esc(accName(t.accountId)) + '</td><td>' + (t.direction === 'in' ? '<span class="badge pill-series-in" data-viz="cash-pill">Thu</span>' : '<span class="badge pill-series-out" data-viz="cash-pill">Chi</span>') + '</td><td>' + fmtMoney(t.amount, cur) + '</td><td>' + esc(t.title || t.note || t.description || '—') + '</td></tr>';
    }).join(''), 'cash-transactions') + (txns.length > 50 ? '<p class="sub">Bảng giao dịch hiển thị 50 giao dịch gần nhất trong tổng số ' + txns.length + '.</p>' : '') + '</div>';
    return html;
  }
  function workspaceChartsHtml() {
    var campaigns = visibleList('campaigns');
    var html = '<h2>Biểu đồ tổng quan workspace</h2>';
    // Ngân sách theo campaign (số qua summarizeBudgetScope ở summarizeCampaignBudget)
    var groups = [];
    var detailRows = [];
    campaigns.forEach(function (c) {
      summarizeCampaignBudget(c).forEach(function (r) {
        if (r.ceiling > 0 || r.allocated > 0 || r.actualTotal > 0 || r.openCommitments > 0) {
          groups.push({ title: c.name + ' (' + r.currency + ')', currency: r.currency, bars: vizBudgetBars(r.allocated, r.actualTotal, r.openCommitments) });
          detailRows.push({ id: c.id, name: c.name, r: r });
        }
      });
    });
    html += '<h3>Ngân sách theo campaign</h3>';
    if (groups.length) {
      html += '<div data-viz="workspace-budget-chart">' + vizBudgetGroupsChartHtml(groups) + '</div>' +
        tbl('<tr><th>Campaign</th><th>Tiền tệ</th><th>Phân bổ</th><th>Thực chi</th><th>Cam kết chưa trả</th><th>Còn dùng được</th></tr>' + detailRows.map(function (x) {
          return '<tr><td><a href="#/campaigns/' + esc(x.id) + '">' + esc(x.name) + '</a></td><td>' + esc(x.r.currency) + '</td><td>' + fmtMoney(x.r.allocated, x.r.currency) + '</td><td>' + fmtMoney(x.r.actualTotal, x.r.currency) + '</td><td>' + fmtMoney(x.r.openCommitments, x.r.currency) + '</td><td>' + fmtMoney(x.r.available, x.r.currency) + '</td></tr>';
        }).join(''), 'budget-by-campaign', 'campaign-action-plan');
    } else html += '<div class="state-box" data-viz="workspace-budget-empty">Chưa có dữ liệu ngân sách ở mức workspace để vẽ biểu đồ.</div>';
    // KPI nổi bật (số qua rollupKpi ở kpiRollupFor)
    var allKpis = Store.list('kpis');
    var featured = allKpis.filter(function (k) { return kpiScopeType(k) === 'campaign'; });
    if (!featured.length) featured = allKpis;
    featured = featured.slice(0, 6);
    html += '<h3>Tiến độ KPI nổi bật</h3><div data-viz="workspace-kpi-chart">' + (featured.length ? vizKpiProgressHtml(featured) : '<div class="state-box">Chưa có KPI nào ở mức workspace.</div>') + '</div>';
    // Content mix theo pillar (đúng đơn vị đếm người dùng đang chọn)
    var mixItems = visibleList('contentItems');
    var mixPubs = buildPublications();
    var mixUnit = UI.contentMixUnit === 'publication' ? 'publication' : 'content';
    var mix = contentMixRows(mixItems, mixPubs, mixUnit);
    html += '<h3>Content mix theo Pillar</h3>';
    if (mix.denominator) html += '<div data-viz="workspace-content-mix">' + vizMixChartHtml(mix, mixUnit) + '</div>';
    else html += '<div class="state-box" data-viz="workspace-content-mix-empty">Chưa có content nào để tính content mix ở mức workspace.</div>';
    // Thu–Chi
    html += cashChartHtml();
    return html;
  }

  // ---------- R3.1: Action Plan — tổng hợp KPI/ngân sách QUA domain ----------
  // Mọi con số tiền/KPI ở các view R3.1 đều đi qua D.summarizeBudgetScope /
  // D.rollupKpi / D.validateAllocations — view không tự cộng tiền/KPI.
  function listSafe(coll) { try { return Store.list(coll) || []; } catch (e) { return []; } }
  function campaignCeilingValue(c) {
    if (!c) return null;
    var amt = (c.budgetCeiling !== null && c.budgetCeiling !== undefined && c.budgetCeiling !== '') ? Number(c.budgetCeiling)
      : ((cfVal(c, 'budgetCeiling') !== null && cfVal(c, 'budgetCeiling') !== undefined && cfVal(c, 'budgetCeiling') !== '') ? Number(cfVal(c, 'budgetCeiling')) : null);
    if (amt === null || isNaN(amt)) return null;
    return { amount: amt, currency: c.budgetCeilingCurrency || cfVal(c, 'budgetCeilingCurrency') || 'VND' };
  }
  // Fact gốc của campaign (dòng ngân sách → cam kết/thực chi), kèm allocations
  // đã gắn vào từng fact để domain chia share theo scope. Task/content/KPI chỉ
  // tham chiếu các fact này — thêm tham chiếu không làm tăng tiền.
  function budgetFacts(campaignId) {
    var lines = visibleList('budgetLines').filter(function (b) { return b.campaignId === campaignId; });
    var lineIds = {}; lines.forEach(function (l) { lineIds[l.id] = true; });
    var actIds = {}; Store.list('activities').filter(function (a) { return a.campaignId === campaignId; }).forEach(function (a) { actIds[a.id] = true; });
    function inScope(x) { return !!(lineIds[x.budgetLineId] || x.campaignId === campaignId || (x.activityId && actIds[x.activityId])); }
    var allocs = listSafe('budgetAllocations');
    function attach(f, kind) {
      var mine = allocs.filter(function (a) {
        if ((a.sourceKind || 'actual') !== kind) return false;
        var sid = kind === 'actual' ? (a.actualId || a.actual_id) : (a.commitmentId || a.commitment_id);
        return String(sid) === String(f.id);
      });
      if (!mine.length) return f;
      var copy = Object.assign({}, f);
      copy.allocations = mine.map(function (a) {
        return { scopeId: a.activityId, activityId: a.activityId, amount: (a.amount === null || a.amount === undefined) ? null : Number(a.amount), percent: (a.sharePercent === null || a.sharePercent === undefined) ? null : Number(a.sharePercent) };
      });
      return copy;
    }
    return {
      lines: lines,
      commitments: Store.list('commitments').filter(inScope).map(function (f) { return attach(f, 'commitment'); }),
      actuals: Store.list('actuals').filter(inScope).map(function (f) { return attach(f, 'actual'); })
    };
  }
  function summarizeCampaignBudget(c) {
    var facts = budgetFacts(c.id);
    var curs = [];
    function addCur(x) { if (x && curs.indexOf(x) === -1) curs.push(x); }
    facts.lines.forEach(function (l) { addCur(l.currency); });
    facts.commitments.forEach(function (f) { addCur(f.currency); });
    facts.actuals.forEach(function (f) { addCur(f.currency); });
    if (!curs.length) curs = ['VND'];
    var ceilingRaw = campaignCeilingValue(c);
    return curs.map(function (cur) {
      var child = {};
      facts.lines.filter(function (l) { return (l.currency || 'VND') === cur && l.activityId; }).forEach(function (l) { child[l.activityId] = (child[l.activityId] || 0) + Number(l.approved || 0); });
      var childAllocations = Object.keys(child).map(function (aid) { return { activityId: aid, scopeId: aid, amount: child[aid], currency: cur }; });
      var allocatedSum = childAllocations.reduce(function (s, a) { return s + a.amount; }, 0);
      var configured = !!(ceilingRaw && (ceilingRaw.currency || 'VND') === cur);
      var s = D.summarizeBudgetScope({ ceiling: configured ? ceilingRaw.amount : allocatedSum, currency: cur, childAllocations: childAllocations, commitments: facts.commitments, actuals: facts.actuals });
      var b = (s.byCurrency && s.byCurrency[cur]) || s;
      return { currency: cur, ceilingConfigured: configured, ceiling: b.ceiling, allocated: b.allocated, unallocated: b.unallocated, actualTotal: b.actualTotal, openCommitments: b.openCommitments, forecastUse: b.forecastUse, available: b.available };
    });
  }
  // Fact thuộc về một activity: qua dòng ngân sách của activity, qua chính
  // activityId trên fact, hoặc qua allocation trỏ tới activity.
  function factsForActivity(facts, act) {
    var lineAct = {};
    facts.lines.forEach(function (l) { lineAct[l.id] = l.activityId; });
    function belongs(f) {
      if (f.activityId && String(f.activityId) === String(act.id)) return true;
      if (f.budgetLineId && lineAct[f.budgetLineId] && String(lineAct[f.budgetLineId]) === String(act.id)) return true;
      return (f.allocations || []).some(function (a) { return String(a.scopeId) === String(act.id); });
    }
    return { commitments: facts.commitments.filter(belongs), actuals: facts.actuals.filter(belongs) };
  }
  function summarizeActivityBudget(c, act) {
    var facts = budgetFacts(c.id);
    var scoped = factsForActivity(facts, act);
    var curs = [];
    function addCur(x) { if (x && curs.indexOf(x) === -1) curs.push(x); }
    facts.lines.filter(function (l) { return l.activityId === act.id; }).forEach(function (l) { addCur(l.currency); });
    scoped.commitments.forEach(function (f) { addCur(f.currency); });
    scoped.actuals.forEach(function (f) { addCur(f.currency); });
    if (!curs.length) curs = ['VND'];
    var out = curs.map(function (cur) {
      var ceiling = facts.lines.filter(function (l) { return l.activityId === act.id && (l.currency || 'VND') === cur; }).reduce(function (s, l) { return s + Number(l.approved || 0); }, 0);
      var s = D.summarizeBudgetScope({ ceiling: ceiling, currency: cur, scopeId: act.id, commitments: facts.commitments, actuals: facts.actuals });
      var b = (s.byCurrency && s.byCurrency[cur]) || s;
      return { currency: cur, ceiling: b.ceiling, allocated: b.allocated, unallocated: b.unallocated, actualTotal: b.actualTotal, openCommitments: b.openCommitments, forecastUse: b.forecastUse, available: b.available };
    }).filter(function (r) { return r.ceiling > 0 || r.actualTotal > 0 || r.openCommitments > 0; });
    return out.length ? out : [{ currency: 'VND', ceiling: 0, allocated: 0, unallocated: 0, actualTotal: 0, openCommitments: 0, forecastUse: 0, available: 0 }];
  }
  function kpiPeriodKey(k) { return k.periodKey || k.period_key || null; }
  function kpiScopeType(k) { return k.scopeType || k.scope_type || (k.activityId ? 'activity' : (k.taskId ? 'task' : (k.contentItemId ? 'content' : (k.pillarId ? 'pillar' : 'campaign')))); }
  function kpiScopeLabel(k) {
    var st = kpiScopeType(k);
    if (st === 'activity') { var a = Store.get('activities', k.activityId); return 'Activity: ' + (a ? a.name : '—'); }
    if (st === 'task') { var t = taskById(k.taskId); return 'Task: ' + (t ? t.title : '—'); }
    if (st === 'content') return 'Content: ' + contentTitle(k.contentItemId);
    if (st === 'pillar') { var p = listSafe('contentPillars').find(function (x) { return x.id === k.pillarId; }); return 'Pillar: ' + (p ? (p.name || p.title) : '—'); }
    if (st === 'bu_product') return 'Brand / Sản phẩm';
    return 'Campaign: ' + campaignName(k.campaignId);
  }
  // Roll-up KPI qua domain: contributions (KPI nguồn cùng metric) khi có;
  // ratio tính lại từ tử/mẫu đã khai; unique thiếu khóa định danh →
  // insufficient_data (không hiện số bịa).
  function kpiRollupFor(k) {
    if (!k || typeof D.rollupKpi !== 'function') return null;
    var mode = String(k.aggregationMode || k.aggregation_mode || 'direct').toLowerCase();
    var contribs = listSafe('kpiContributions').filter(function (x) { return x.kpiId === k.id; });
    if (contribs.length && mode !== 'ratio') {
      var facts = [];
      contribs.forEach(function (ct) {
        var sk = Store.get('kpis', ct.sourceKpiId);
        if (!sk) return;
        facts.push({ id: 'fact-' + sk.id, metricCode: sk.metricCode || k.metricCode || null, unit: sk.unit || k.unit || null, period: kpiPeriodKey(sk) || kpiPeriodKey(k), value: (sk.actual === undefined ? null : sk.actual), identities: sk.identityKeys || sk.identity_keys || null, objectId: sk.id, observedAt: sk.updatedAt || null });
      });
      return D.rollupKpi(facts, { mode: mode === 'direct' || mode === 'manual' ? 'sum' : mode, metricCode: k.metricCode || null, unit: k.unit || null, period: kpiPeriodKey(k), target: (k.target === undefined ? null : k.target), scopeLabel: kpiScopeLabel(k) });
    }
    if (mode === 'ratio') {
      var num = (k.numerator !== null && k.numerator !== undefined) ? Number(k.numerator) : ((k.numeratorValue !== null && k.numeratorValue !== undefined) ? Number(k.numeratorValue) : null);
      var den = (k.denominator !== null && k.denominator !== undefined) ? Number(k.denominator) : ((k.denominatorValue !== null && k.denominatorValue !== undefined) ? Number(k.denominatorValue) : null);
      return D.rollupKpi([], { mode: 'ratio', numerator: num, denominator: den, target: (k.target === undefined ? null : k.target), scopeLabel: kpiScopeLabel(k), currency: k.currency || null });
    }
    if (mode === 'unique' || mode === 'snapshot') {
      return D.rollupKpi([], { mode: mode, target: (k.target === undefined ? null : k.target), scopeLabel: kpiScopeLabel(k) });
    }
    if (k.actual === null || k.actual === undefined) return null;
    return D.rollupKpi([{ id: 'fact-' + k.id, metricCode: k.metricCode || null, unit: k.unit || null, period: kpiPeriodKey(k), value: Number(k.actual) }], { mode: 'sum', metricCode: k.metricCode || null, unit: k.unit || null, period: kpiPeriodKey(k), target: (k.target === undefined ? null : k.target), scopeLabel: kpiScopeLabel(k) });
  }
  function kpiHasValidSource(k) {
    var mode = String(k.aggregationMode || 'direct').toLowerCase();
    if (mode === 'unique') {
      var contribs = listSafe('kpiContributions').filter(function (x) { return x.kpiId === k.id; });
      if (!contribs.length) return false;
      return contribs.every(function (ct) { var sk = Store.get('kpis', ct.sourceKpiId); return sk && Array.isArray(sk.identityKeys || sk.identity_keys) && (sk.identityKeys || sk.identity_keys).length > 0; });
    }
    if (mode === 'ratio') return k.numerator !== null && k.numerator !== undefined && k.denominator !== null && k.denominator !== undefined && Number(k.denominator) !== 0;
    return true;
  }
  function kpiSummaryHtml(k) {
    var r = kpiRollupFor(k);
    var mode = String(k.aggregationMode || 'direct').toLowerCase();
    var autoHtml = kpiAutoInfoHtml(k);
    if (r && r.status === 'insufficient_data') return '<span class="badge warn">Chưa đủ dữ liệu</span>' + autoHtml;
    if (r && r.value !== null && r.value !== undefined) {
      if (mode === 'ratio') return fmtNum(Math.round(r.value)) + ' ' + esc(k.unit || '') + ' <span class="sub">(phạm vi: ' + esc(kpiScopeLabel(k)) + ')</span>' + autoHtml;
      return fmtNum(r.value) + ' / ' + fmtNum(k.target) + ' ' + esc(k.unit || '') + (r.achievementPercent !== null && r.achievementPercent !== undefined ? ' (' + fmtNum(r.achievementPercent) + '%)' : '') + autoHtml;
    }
    var d = D.kpiDisplay(k);
    return (d.isMissing ? '<span class="badge warn">Chưa cập nhật</span>' : fmtNum(d.value) + ' / ' + fmtNum(k.target) + ' ' + esc(k.unit || '')) + autoHtml;
  }
  function activityTasks(act) { return Store.list('tasks').filter(function (t) { return t.activityId === act.id && !isArchived(t); }); }
  function activityStatusInfo(act, tasks) {
    var total = tasks.length;
    var done = tasks.filter(isCompletedTask).length;
    var overdue = tasks.filter(isOverdue).length;
    var blockedIds = {};
    Store.list('blockers').filter(function (b) { return b.status === 'open'; }).forEach(function (b) { blockedIds[b.taskId] = true; });
    var blocked = tasks.filter(function (t) { return blockedIds[t.id] || t.isBlocked; }).length;
    var label = act.status ? labelStatus(act.status) : (total && done === total ? 'Hoàn thành' : (tasks.some(function (t) { return t.status === 'in_progress'; }) ? 'Đang làm' : 'Chưa bắt đầu'));
    return { total: total, done: done, overdue: overdue, blocked: blocked, label: label };
  }
  function contentForActivity(actId) {
    return visibleList('contentItems').filter(function (x) { return x.activityId === actId || cfVal(x, 'activityId') === actId || cfVal(x, 'activity_id') === actId; });
  }
  function budgetSummaryText(rows) {
    return rows.map(function (r) {
      return 'Phân bổ ' + fmtMoney(r.ceiling, r.currency) + ' · Thực chi ' + fmtMoney(r.actualTotal, r.currency) + ' · Cam kết chưa trả ' + fmtMoney(r.openCommitments, r.currency) + ' · Còn trong hạn mức ' + fmtMoney(r.available, r.currency);
    }).join('<br>');
  }
  function actionPlanHtml(c) {
    var acts = Store.list('activities').filter(function (a) { return a.campaignId === c.id; });
    var ed = canEdit();
    var html = '<div class="toolbar"><strong>Action Plan — ' + acts.length + ' activity</strong><span>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="activity" data-campaign="' + esc(c.id) + '">+ Thêm activity</button>' : '') + '</span></div>';
    html += '<p class="sub">Mỗi dòng là một activity. Số KPI/ngân sách lấy qua đúng hàm tổng hợp dùng chung (rollup KPI, tổng ngân sách theo scope) — bấm vào tên activity để mở drawer chi tiết.</p>';
    html += '<div class="toolbar"><span class="sub">Nhóm theo:</span><span>' + [['phase', 'Giai đoạn'], ['owner', 'Người phụ trách'], ['channel', 'Kênh'], ['none', 'Không nhóm']].map(function (g) {
      return '<button type="button" class="btn small ' + (UI.actionGroupBy === g[0] ? '' : 'secondary') + '" data-action="action-group" data-id="' + g[0] + '">' + g[1] + '</button>';
    }).join(' ') + '</span></div>';
    if (!acts.length) return html + emptyState('Chưa có activity nào trong Action Plan', 'Thêm activity đầu tiên — mỗi activity có thể có task, KPI và ngân sách riêng.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="activity" data-campaign="' + esc(c.id) + '">+ Thêm activity</button></p>' : '');
    function groupKey(a) {
      if (UI.actionGroupBy === 'owner') return 'Người phụ trách: ' + memberName(a.ownerId);
      if (UI.actionGroupBy === 'channel') return 'Kênh: ' + (a.channel || 'Chưa rõ kênh');
      if (UI.actionGroupBy === 'none') return '';
      var ph = Store.get('phases', a.phaseId);
      return ph ? ph.name : 'Chưa gắn giai đoạn';
    }
    var groups = []; var gmap = {};
    acts.forEach(function (a) { var g = groupKey(a); if (!gmap[g]) { gmap[g] = []; groups.push(g); } gmap[g].push(a); });
    var head = '<tr><th>Activity</th><th>Người phụ trách</th><th>Bắt đầu–Hạn</th><th>Trạng thái</th><th>Đầu ra</th><th>KPI</th><th>Ngân sách</th><th>Content liên quan</th><th></th></tr>';
    html += tbl(head + groups.map(function (g) {
      var out = g ? '<tr class="group-row"><td colspan="9">' + esc(g) + '</td></tr>' : '';
      out += gmap[g].map(function (a) {
        var tasks = activityTasks(a);
        var info = activityStatusInfo(a, tasks);
        var kpis = Store.list('kpis').filter(function (k) { return k.activityId === a.id; });
        var contents = contentForActivity(a.id);
        var budgetRows = summarizeActivityBudget(c, a);
        return '<tr><td><button class="linklike" data-action="activity-open" data-id="' + esc(a.id) + '"><strong>' + esc(a.name) + '</strong></button>' + (a.channel ? '<br><span class="sub">' + esc(a.channel) + '</span>' : '') + '</td>' +
          '<td>' + esc(memberName(a.ownerId)) + '</td>' +
          '<td>' + (a.startDate ? esc(D.formatDateVN(a.startDate)) : '—') + ' – ' + (a.endDate ? esc(D.formatDateVN(a.endDate)) : '—') + '</td>' +
          '<td>' + statusBadge(a.status || '', info.label) + (info.overdue ? '<br>' + vizStatusPillHtml('overdue', { label: info.overdue + ' task trễ', derived: true }) : '') + (info.blocked ? '<br>' + vizStatusPillHtml('blocked', { label: info.blocked + ' task bị chặn', derived: true }) : '') + '</td>' +
          '<td>' + info.done + '/' + info.total + ' task xong' + (info.overdue ? '<br><span class="sub">Trễ: ' + info.overdue + ' · Bị chặn: ' + info.blocked + '</span>' : '<br><span class="sub">Bị chặn: ' + info.blocked + '</span>') + (a.deliverables || a.deliverable ? '<br><span class="sub">' + esc(a.deliverables || a.deliverable) + '</span>' : '') +
          // R3.1-VIZ 3: thanh % hoàn thành task ngay trong cột Đầu ra.
          '<div class="viz-mini" data-viz="action-task-progress"><span class="viz-track"><span class="viz-fill is-actual" style="width:' + vizBarWidth(vizPct(info.done, info.total)) + '%"></span></span><span class="sub">Hoàn thành ' + fmtPct(vizPct(info.done, info.total)) + ' (' + info.done + '/' + info.total + ' task)</span></div></td>' +
          '<td>' + (kpis.length ? kpis.slice(0, 2).map(function (k) { return vizKpiMiniHtml(k); }).join('') + (kpis.length > 2 ? '<span class="sub">+ ' + (kpis.length - 2) + ' KPI khác</span>' : '') : '—') + '</td>' +
          // R3.1-VIZ 3: thanh ngân sách đã dùng / phân bổ ngay trong cột Ngân sách.
          // WAVE-B2: thêm thanh 3 lớp thực chi / cam kết / còn dùng được.
          '<td>' + budgetSummaryText(budgetRows) + budgetRows.map(function (r) { return vizBudgetUsedBarHtml(r); }).join('') + vizBudgetStackedHtml(budgetRows) + '</td>' +
          '<td>' + (contents.length ? contents.length + ' content liên quan' : 'Không có content liên quan') + '</td>' +
          '<td class="row-actions"><button class="btn small" data-action="activity-open" data-id="' + esc(a.id) + '">Mở chi tiết</button></td></tr>';
      }).join('');
      return out;
    }).join(''));
    return html;
  }
  function activityDrawerHtml() {
    var actId = UI.activityDrawerId;
    if (!actId) return '';
    var act = Store.get('activities', actId);
    if (!act) return '';
    var c = Store.get('campaigns', act.campaignId) || {};
    var tab = UI.activityTab || 'overview';
    var ed = canEdit();
    var budgetEd = canBudgetChange();
    var tasks = activityTasks(act);
    var info = activityStatusInfo(act, tasks);
    var kpis = Store.list('kpis').filter(function (k) { return k.activityId === act.id; });
    var contents = contentForActivity(act.id);
    var facts = budgetFacts(c.id || '');
    var scopedFacts = factsForActivity(facts, act);
    var lines = facts.lines.filter(function (l) { return l.activityId === act.id; });
    var budgetRows = summarizeActivityBudget(c, act);
    var firstLine = lines[0] || facts.lines[0] || null;
    var openCommit = scopedFacts.commitments.find(function (x) { return ['open', 'committed', 'planned', 'partially_actualised', 'partial'].indexOf(String(x.status || 'open').toLowerCase()) !== -1; });
    var ph = Store.get('phases', act.phaseId);
    var html = '<div class="panel-backdrop activity-backdrop" data-action="activity-close"></div>' +
      '<div class="detail-panel activity-panel" role="dialog" aria-modal="true" aria-label="Chi tiết activity">' +
      '<div class="modal-head"><h2>' + esc(act.name) + '</h2><button type="button" class="btn secondary small" data-action="activity-close">Đóng</button></div>' +
      '<p class="sub">Campaign: ' + esc(c.name || '—') + (ph ? ' · Giai đoạn: ' + esc(ph.name) : '') + (act.channel ? ' · Kênh: ' + esc(act.channel) : '') + '<br>Người phụ trách: ' + esc(memberName(act.ownerId)) + ' · ' + (act.startDate ? esc(D.formatDateVN(act.startDate)) : '—') + ' – ' + (act.endDate ? esc(D.formatDateVN(act.endDate)) : '—') + ' · Trạng thái: ' + esc(info.label) + '</p>' +
      '<div class="drawer-actions">' +
      (ed ? '<button class="btn small" data-action="editor-open" data-kind="task" data-campaign="' + esc(c.id || '') + '" data-activity="' + esc(act.id) + '">Tạo task</button>' : '') +
      (ed ? '<button class="btn small secondary" data-action="editor-open" data-kind="kpi" data-campaign="' + esc(c.id || '') + '" data-activity="' + esc(act.id) + '">Thêm KPI</button>' : '') +
      (budgetEd ? '<button class="btn small secondary" data-action="editor-open" data-kind="budgetLine" data-campaign="' + esc(c.id || '') + '" data-activity="' + esc(act.id) + '">Thêm dòng ngân sách</button>' : '') +
      (budgetEd && firstLine ? '<button class="btn small secondary" data-action="editor-open" data-kind="commitment" data-line="' + esc(firstLine.id) + '">Ghi cam kết</button>' : '') +
      (budgetEd && openCommit ? '<button class="btn small secondary" data-action="editor-open" data-kind="commitmentPayment" data-commitment="' + esc(openCommit.id) + '">Ghi thanh toán</button>' : '') +
      '</div>' +
      tabsHtml([['overview', 'Overview'], ['tasks', 'Task'], ['kpi', 'KPI'], ['budget', 'Ngân sách'], ['docs', 'Tài liệu']], tab, 'activity-tab');
    if (tab === 'overview') {
      html += '<h3>Mục tiêu & đầu ra</h3><p>' + esc(act.objective || '—') + '</p><p><strong>Đầu ra cần bàn giao:</strong> ' + esc(act.deliverables || act.deliverable || '—') + '</p>' +
        '<h3>Tiến độ task</h3><p>' + info.done + '/' + info.total + ' task xong · Trễ: ' + info.overdue + ' · Bị chặn: ' + info.blocked + '</p>' +
        (function () { var segD = vizTaskStatusSegments(tasks); return segD.total ? '<div data-viz="activity-task-stacked">' + vizStackedBarHtml({ segments: segD.segments, total: segD.total, unitLabel: 'task của activity' }) + '</div>' : ''; })() +
        '<h3>KPI của activity</h3>' + (kpis.length ? '<ul class="clean">' + kpis.map(function (k) { return '<li>' + esc(k.name) + ': ' + kpiSummaryHtml(k) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có KPI nào cho activity này.</p>') +
        '<h3>Ngân sách của activity</h3><p>' + budgetSummaryText(budgetRows) + '</p>' +
        // R3.1-VIZ 3: mini-chart ở tab Overview của drawer — thanh ngân sách
        // của action + thanh tiến độ KPI của action (số vẫn qua domain).
        '<div data-viz="activity-mini-charts"><h3>Biểu đồ ngân sách của activity</h3><div data-viz="activity-mini-budget">' +
        vizBudgetGroupsChartHtml(budgetRows.map(function (r) { return { title: act.name + ' (' + r.currency + ')', currency: r.currency, bars: vizBudgetBars(r.ceiling, r.actualTotal, r.openCommitments) }; })) +
        budgetRows.map(function (r) { return vizBudgetUsedBarHtml(r); }).join('') + '</div>' +
        '<h3>Tiến độ KPI của activity</h3><div data-viz="activity-mini-kpi">' + (kpis.length ? vizKpiProgressHtml(kpis) : '<p class="sub">Chưa có KPI nào cho activity này.</p>') + '</div></div>' +
        '<h3>Content liên quan</h3>' + (contents.length ? '<ul class="clean">' + contents.map(function (x) { return '<li>' + esc(x.title) + ' — ' + statusBadge(x.editorialStatus) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có content liên quan</p>');
    }
    if (tab === 'tasks') {
      html += '<h3>Task của activity (' + tasks.length + ')</h3>' +
        (tasks.length ? tbl('<tr><th>Task</th><th>Người phụ trách</th><th>Hạn</th><th>Trạng thái</th></tr>' + tasks.map(function (t) {
          return '<tr><td><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button>' + checklistBadgeHtml(t) + '</td><td>' + esc(memberName(t.assigneeId)) + '</td><td>' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : '—') + (isOverdue(t) ? ' ' + vizStatusPillHtml('overdue', { label: 'Quá hạn', derived: true }) + '' : '') + '</td><td>' + statusBadge(t.status) + '</td></tr>';
        }).join('')) : '<p class="sub">Chưa có task nào — dùng nút "Tạo task" ở trên.</p>');
    }
    if (tab === 'kpi') {
      html += '<h3>KPI của activity (' + kpis.length + ')</h3>' +
        (kpis.length ? tbl('<tr><th>KPI</th><th>Phạm vi</th><th>Cách tổng hợp</th><th>Kết quả</th></tr>' + kpis.map(function (k) {
          return '<tr><td><strong>' + esc(k.name) + '</strong>' + (k.definition ? '<br><span class="sub">' + esc(typeof k.definition === 'string' ? k.definition : (k.definition.description || k.definition.how || '')) + '</span>' : '') + '</td><td>' + esc(kpiScopeLabel(k)) + '</td><td>' + esc(k.aggregationMode || 'direct') + '</td><td>' + kpiSummaryHtml(k) + '</td></tr>';
        }).join('')) : '<p class="sub">Chưa có KPI nào — dùng nút "Thêm KPI" ở trên.</p>');
    }
    if (tab === 'budget') {
      html += '<h3>Ngân sách của activity</h3><p>' + budgetSummaryText(budgetRows) + '</p>' +
        '<h3>Dòng ngân sách (' + lines.length + ')</h3>' +
        (lines.length ? tbl('<tr><th>Dòng</th><th>Kế hoạch</th><th>Được duyệt</th><th>Tỉ lệ đã dùng</th><th>Tiền tệ</th></tr>' + lines.map(function (l) {
          var lineCommits = scopedFacts.commitments.filter(function (x) { return x.budgetLineId === l.id; });
          var lineActuals = scopedFacts.actuals.filter(function (x) { return x.budgetLineId === l.id; });
          var lineRem = D.budgetRemaining(l, lineCommits, lineActuals);
          var lineApproved = Number(l.approved) || 0;
          var lineUsed = lineApproved - lineRem;
          var lineBar = lineApproved > 0 ? vizCellBarHtml({ value: Math.max(0, lineUsed), max: lineApproved, tone: lineRem < 0 ? 'overdue' : (lineRem === 0 ? 'pending' : 'running'), text: 'Đã dùng ' + fmtMoney(lineUsed, l.currency) + ' / Được duyệt ' + fmtMoney(lineApproved, l.currency) + ' · Còn lại ' + fmtMoney(lineRem, l.currency) }) : '<span class="sub">Chưa được duyệt ngân sách</span>';
          return '<tr><td>' + esc(l.name) + '</td><td>' + (l.planned === null || l.planned === undefined ? '—' : fmtMoney(l.planned, l.currency)) + '</td><td>' + budgetLineApprovedCellHtml(l) + '</td><td><div data-viz="activity-budget-line-bar">' + lineBar + '</div></td><td>' + esc(l.currency || 'VND') + '</td></tr>';
        }).join('')) : '<p class="sub">Chưa có dòng ngân sách nào gắn activity này.</p>') +
        '<h3>Cam kết (' + scopedFacts.commitments.length + ')</h3>' +
        (scopedFacts.commitments.length ? tbl('<tr><th>Cam kết</th><th>Số tiền</th><th>Trạng thái</th><th>Duyệt</th><th>Thao tác</th></tr>' + scopedFacts.commitments.map(function (cm) {
          return '<tr><td>' + esc(cm.title) + '</td><td>' + fmtMoney(cm.amount, cm.currency) + '</td><td>' + statusBadge(cm.status) + '</td><td>' + factApprovalControlsHtml(cm, 'commitment') + '</td><td class="row-actions">' + (budgetEd ? '<button class="btn small" data-action="editor-open" data-kind="commitmentPayment" data-commitment="' + esc(cm.id) + '">Ghi thanh toán</button> <button class="btn small secondary" data-action="editor-open" data-kind="allocation" data-source-kind="commitment" data-source-id="' + esc(cm.id) + '">Phân bổ chi chung</button>' : '') + '</td></tr>';
        }).join('')) : '<p class="sub">Chưa có cam kết nào.</p>') +
        '<h3>Thực chi (' + scopedFacts.actuals.length + ')</h3>' +
        (scopedFacts.actuals.length ? tbl('<tr><th>Khoản chi</th><th>Số tiền</th><th>Ngày</th><th>Duyệt</th><th>Thao tác</th></tr>' + scopedFacts.actuals.map(function (a) {
          return '<tr><td>' + esc(a.title) + '</td><td>' + fmtMoney(a.amount, a.currency) + '</td><td>' + esc(D.formatDateVN(a.date)) + '</td><td>' + factApprovalControlsHtml(a, 'actual') + '</td><td class="row-actions">' + (budgetEd ? '<button class="btn small secondary" data-action="editor-open" data-kind="allocation" data-source-kind="actual" data-source-id="' + esc(a.id) + '">Phân bổ chi chung</button>' : '') + '</td></tr>';
        }).join('')) : '<p class="sub">Chưa có khoản chi nào.</p>');
    }
    if (tab === 'docs') {
      var links = hasFn('listCampaignAssets') ? (Store.listCampaignAssets(c.id || '') || []) : [];
      var assetRows = links.map(function (lk) { var a = Store.get('brandAssets', lk.assetId); return a ? '<li><strong>' + esc(a.name) + '</strong>' + (lk.role ? ' — ' + esc(lk.role) : '') + '</li>' : ''; }).join('');
      var dels = tasks.filter(function (t) { return t.deliverable; });
      html += '<h3>Tài liệu</h3>' + (assetRows ? '<ul class="clean">' + assetRows + '</ul>' : '<p class="sub">Chưa có tài liệu nào được liên kết với campaign này.</p>') +
        '<h3>Đầu ra cần bàn giao của các task</h3>' + (dels.length ? '<ul class="clean">' + dels.map(function (t) { return '<li><strong>' + esc(t.title) + '</strong>: ' + esc(t.deliverable) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có task nào ghi đầu ra.</p>') +
        '<h3>Content liên quan</h3>' + (contents.length ? '<ul class="clean">' + contents.map(function (x) { return '<li>' + esc(x.title) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có content liên quan</p>');
    }
    return html + '</div>';
  }

  function campaignDetailHtml(id) {
    var c = Store.get('campaigns', id);
    if (!c) return emptyState('Không tìm thấy campaign', 'Campaign có thể đã bị lưu trữ. Quay lại danh sách để kiểm tra.', '<p><a class="btn secondary" href="#/campaigns">Về danh sách campaign</a></p>');
    var ed = canEdit();
    var tab = UI.campaignTab || 'overview';
    var base = '#/campaigns/' + encodeURIComponent(id);
    var html = '<p><a href="#/campaigns">← Tất cả campaign</a></p>' + readonlyNote() + collectionBanner('campaigns');
    // R2-07: subtitle của pageHead chỉ còn TEXT THUẦN (pageHead escape mặc
    // định) — badge trạng thái render trong block HTML riêng bên dưới.
    html += pageHead(c.name, D.formatDateVN(c.startDate) + ' — ' + D.formatDateVN(c.endDate) + ' · Người phụ trách: ' + memberName(c.ownerId),
      (ed ? '<button class="btn" data-action="editor-open" data-kind="campaign" data-id="' + esc(c.id) + '">Sửa campaign</button> <button class="btn secondary" data-action="archive-item" data-coll="campaigns" data-id="' + esc(c.id) + '">Lưu trữ</button>' : ''));
    var campVersions = baselineVersionsOf(c);
    var campLatestStats = campVersions.length ? baselineVersionStatsText(campVersions[campVersions.length - 1]) : '';
    html += '<div class="campaign-status-block">' + statusBadge(c.status) +
      ' <span class="sub">Kế hoạch đã duyệt (baseline): ' + (c.baselineStartDate || c.baselineEndDate ? esc(D.formatDateVN(c.baselineStartDate)) + ' — ' + esc(D.formatDateVN(c.baselineEndDate)) : 'chưa chốt') + (campLatestStats ? ' · v' + esc(campVersions[campVersions.length - 1].version) + ' · ' + esc(campLatestStats) : '') + '</span>' +
      (canSetBaseline() ? ' <button class="btn small secondary" data-action="campaign-baseline" data-id="' + esc(c.id) + '">Chốt baseline theo lịch hiện tại</button>' : '') + '</div>';
    html += '<div class="tabs" role="tablist">' + [['overview', 'Overview'], ['action', 'Action Plan'], ['plan', 'Kế hoạch & Timeline'], ['tasks', 'Task'], ['content', 'Content'], ['kpi', 'KPI & Ngân sách'], ['docs', 'Tài liệu'], ['summary', 'Tổng kết']].map(function (x) {
      return '<a class="tab' + (tab === x[0] ? ' active' : '') + '" href="' + base + '/' + x[0] + '" role="tab">' + esc(x[1]) + '</a>';
    }).join('') + '</div>';
    var ctasks = Store.list('tasks').filter(function (t) { return t.campaignId === c.id && !isArchived(t); });
    var phases = Store.list('phases').filter(function (x) { return x.campaignId === c.id; });
    var acts = Store.list('activities').filter(function (x) { return x.campaignId === c.id; });
    if (tab === 'overview') {
      html += '<div class="panel"><h3>Mục tiêu</h3>' + tbl(
        '<tr><th>Vì sao chạy campaign này?</th><td>' + esc(c.why || '—') + '</td></tr>' +
        '<tr><th>Mục tiêu kinh doanh</th><td>' + esc(c.businessGoal || '—') + '</td></tr>' +
        '<tr><th>Mục tiêu marketing</th><td>' + esc(c.marketingGoal || '—') + '</td></tr>' +
        '<tr><th>Kết quả mong muốn</th><td>' + esc(c.desiredOutcome || '—') + '</td></tr>') +
        '<h3>Target audiences</h3>' + ((c.audiences || []).length ? '<ul class="clean">' + c.audiences.map(function (a) { return '<li><strong>' + esc(a.name) + '</strong> — ' + esc(a.description || '') + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa ghi nhận — bấm Sửa campaign để bổ sung.</p>') +
        '<h3>Audience insights</h3><p>' + esc(c.audienceInsights || 'Chưa ghi nhận.') + '</p>' +
        '<h3>Big idea & Key message</h3><p><strong>Big idea:</strong> ' + esc(c.bigIdea || '—') + '</p><p><strong>Key message:</strong> ' + esc(c.keyMessage || '—') + '</p>' +
        '<h3>KV & hướng sáng tạo</h3><p>' + esc(c.creativeDirection || 'Chưa ghi nhận.') + '</p>' +
        '<h3>Rủi ro</h3><p>' + esc(c.risks || 'Chưa ghi nhận rủi ro.') + '</p></div>';
      // R3.1 C.7: khối ngân sách cấp campaign qua summarizeBudgetScope +
      // KPI kết quả chung + đếm action đúng hạn/trễ/bị chặn.
      var ovBudget = summarizeCampaignBudget(c);
      html += '<h3>Ngân sách campaign</h3>';
      // 0014: khối hạn mức campaign — dấu duyệt hạn mức + điểm mở đề xuất cho
      // chính ceiling của campaign này (target campaign_ceiling).
      var ovCeil = campaignCeilingValue(c);
      html += '<div class="panel" data-budget-ceiling-block="1"><strong>Hạn mức campaign:</strong> ' + (ovCeil ? fmtMoney(ovCeil.amount, ovCeil.currency) : 'chưa có') + '<br>' + campaignCeilingApprovalHtml(c) +
        (can('budget.propose') ? ' <p style="margin:6px 0 0"><button type="button" class="btn small" data-action="editor-open" data-kind="budgetProposal" data-campaign="' + esc(c.id) + '" data-target-type="campaign_ceiling">Đề xuất ngân sách</button></p>' : '') + '</div>';
      // R3.1-VIZ 1(a): chart-first — biểu đồ cột ngang phân bổ theo từng action
      // (số qua summarizeBudgetScope ở summarizeActivityBudget), ngay trên
      // bảng số chi tiết C.7.
      html += vizBudgetActionChartHtml(c);
      html += vizBudgetStackedHtml(ovBudget);
      ovBudget.forEach(function (r) {
        if (!r.ceilingConfigured) html += '<div class="notice warn">Chưa thiết lập hạn mức campaign cho ' + esc(r.currency) + ' — các số dưới đây tạm lấy tổng phân bổ đã duyệt làm hạn mức. Đặt hạn mức qua Đề xuất ngân sách ở khối hạn mức campaign phía trên (hạn mức chỉ đổi khi đề xuất được Owner duyệt) để tách rõ "Chưa phân bổ" và "Còn dùng được".</div>';
        html += '<p class="sub" data-viz="campaign-budget-note">Hạn mức campaign (' + esc(r.currency) + '): <strong>' + fmtMoney(r.ceiling, r.currency) + '</strong> · Chưa phân bổ: <strong>' + fmtMoney(r.unallocated, r.currency) + '</strong> · Còn dùng được: <strong>' + fmtMoney(r.available, r.currency) + '</strong> — "Chưa phân bổ" và "Còn dùng được" là hai số tách biệt, không gộp.</p>';
        html += '<h4>Bảng số chi tiết ngân sách (' + esc(r.currency) + ')</h4>' + tbl('<tr><th>Hạn mức</th><th>Đã phân bổ</th><th>Chưa phân bổ</th><th>Thực chi</th><th>Cam kết chưa trả</th><th>Dự kiến sử dụng</th><th>Còn dùng được</th></tr>' +
          '<tr><td>' + fmtMoney(r.ceiling, r.currency) + '</td><td>' + fmtMoney(r.allocated, r.currency) + '</td><td>' + fmtMoney(r.unallocated, r.currency) + '</td><td>' + fmtMoney(r.actualTotal, r.currency) + '</td><td>' + fmtMoney(r.openCommitments, r.currency) + '</td><td>' + fmtMoney(r.forecastUse, r.currency) + '</td><td>' + fmtMoney(r.available, r.currency) + '</td></tr>', 'campaign-budget-detail') +
          '<p class="sub">"Chưa phân bổ" = hạn mức − đã phân bổ cho các activity. "Còn dùng được" = hạn mức − thực chi − cam kết chưa trả. Hai số này khác nhau và không cộng lẫn nhau.</p>';
      });
      var ovKpis = Store.list('kpis').filter(function (k) { return k.campaignId === c.id && kpiScopeType(k) === 'campaign'; });
      html += '<h3>KPI kết quả chung</h3>';
      if (ovKpis.length) {
        ovKpis.forEach(function (k) {
          if (!kpiHasValidSource(k)) html += '<div class="notice warn">KPI "' + esc(k.name) + '" chưa có nguồn/cách tổng hợp hợp lệ (chế độ ' + esc(k.aggregationMode || 'direct') + ') — chưa thể tuyên bố số tổng hợp cho KPI này.</div>';
        });
        // R3.1-VIZ 1(b): thanh tiến độ KPI (số qua rollupKpi) + bảng số ngay dưới.
        html += '<div data-viz="campaign-kpi-chart">' + vizKpiProgressHtml(ovKpis) + '</div>' + vizKpiTableHtml(ovKpis);
      } else html += '<p class="sub">Chưa có KPI kết quả chung ở cấp campaign.</p>';
      var onTrack = 0, lateActs = 0, blockedActs = 0;
      acts.forEach(function (a) { var inf = activityStatusInfo(a, activityTasks(a)); if (inf.blocked > 0) blockedActs++; else if (inf.overdue > 0) lateActs++; else onTrack++; });
      var segOv = vizTaskStatusSegments(ctasks);
      html += '<h3>Tiến độ Action Plan</h3><div class="cards">' +
        vizKpiCardHtml({ label: 'Activity đúng hạn', valueText: String(onTrack), tone: 'done', toneLabel: 'Đúng hạn', progress: acts.length ? { value: onTrack, max: acts.length, pct: vizPct(onTrack, acts.length), tone: 'done', detail: onTrack + '/' + acts.length + ' activity (' + fmtPct(vizPct(onTrack, acts.length)) + ')' } : null }) +
        vizKpiCardHtml({ label: 'Activity có task trễ', valueText: String(lateActs), tone: 'overdue', toneLabel: 'Có task trễ', progress: acts.length ? { value: lateActs, max: acts.length, pct: vizPct(lateActs, acts.length), tone: 'overdue', detail: lateActs + '/' + acts.length + ' activity (' + fmtPct(vizPct(lateActs, acts.length)) + ')' } : null }) +
        vizKpiCardHtml({ label: 'Activity bị chặn', valueText: String(blockedActs), tone: 'blocked', toneLabel: 'Bị chặn', progress: acts.length ? { value: blockedActs, max: acts.length, pct: vizPct(blockedActs, acts.length), tone: 'blocked', detail: blockedActs + '/' + acts.length + ' activity (' + fmtPct(vizPct(blockedActs, acts.length)) + ')' } : null }) + '</div>' +
        '<h4>Phân bổ trạng thái task của campaign</h4><div data-viz="campaign-overview-task-stacked">' + (segOv.total ? vizStackedBarHtml({ segments: segOv.segments, total: segOv.total, unitLabel: 'task của campaign' }) : vizEmptyChartHtml('Chưa có task nào trong campaign để phân bổ trạng thái.')) + '</div>';
    }
    if (tab === 'action') {
      html += actionPlanHtml(c);
    }
    if (tab === 'plan') {
      html += '<div class="toolbar"><strong>Giai đoạn (' + phases.length + ')</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="phase" data-campaign="' + esc(c.id) + '">+ Thêm giai đoạn</button>' : '') + '</div>';
      html += phases.length ? tbl('<tr><th>Giai đoạn</th><th>Thời gian</th><th>Trạng thái</th><th>Người phụ trách</th><th>Thao tác</th></tr>' + phases.map(function (x) {
        var phTasks = ctasks.filter(function (t) { return t.phaseId === x.id; });
        var phSeg = vizTaskStatusSegments(phTasks);
        var phPill = x.status ? statusBadge(x.status) : (phSeg.total && phSeg.done === phSeg.total ? vizStatusPillHtml('completed', { label: 'Hoàn thành' }) : (phSeg.blocked ? vizStatusPillHtml('blocked', { label: phSeg.blocked + ' task bị chặn', derived: true }) : (phSeg.overdue ? vizStatusPillHtml('overdue', { label: phSeg.overdue + ' task trễ', derived: true }) : vizStatusPillHtml('in_progress', { label: phSeg.total ? 'Đang triển khai' : 'Chưa có task' }))));
        return '<tr><td><strong>' + esc(x.name) + '</strong>' + (phSeg.total ? '<br><span class="sub">' + phSeg.done + '/' + phSeg.total + ' task xong</span>' : '') + '</td><td>' + esc(D.formatDateVN(x.startDate)) + ' — ' + esc(D.formatDateVN(x.endDate)) + '</td><td>' + phPill + '</td><td>' + vizOwnerDotHtml(x.ownerId) + esc(memberName(x.ownerId)) + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="phase" data-id="' + esc(x.id) + '" data-campaign="' + esc(c.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="phases" data-id="' + esc(x.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
      }).join(''), 'campaign-phases') : '<div class="state-box">Chưa có giai đoạn nào.</div>';
      html += '<div class="toolbar"><strong>Activity & Kênh triển khai (' + acts.length + ')</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="activity" data-campaign="' + esc(c.id) + '">+ Thêm activity</button>' : '') + '</div>';
      html += acts.length ? tbl('<tr><th>Activity</th><th>Giai đoạn</th><th>Kênh</th><th>Trạng thái</th><th>Người phụ trách</th><th>Đầu ra</th><th>Thao tác</th></tr>' + acts.map(function (a) {
        var ph = Store.get('phases', a.phaseId);
        var aInfo = activityStatusInfo(a, activityTasks(a));
        return '<tr><td><strong>' + esc(a.name) + '</strong></td><td>' + esc(ph ? ph.name : '—') + '</td><td>' + esc(a.channel || '—') + '</td><td>' + statusBadge(a.status || '', aInfo.label) + (aInfo.overdue ? '<br>' + vizStatusPillHtml('overdue', { label: aInfo.overdue + ' task trễ', derived: true }) : '') + (aInfo.blocked ? '<br>' + vizStatusPillHtml('blocked', { label: aInfo.blocked + ' task bị chặn', derived: true }) : '') + '</td><td>' + vizOwnerDotHtml(a.ownerId) + esc(memberName(a.ownerId)) + '</td><td>' + esc(a.deliverables || a.deliverable || '—') + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="activity" data-id="' + esc(a.id) + '" data-campaign="' + esc(c.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="editor-open" data-kind="task" data-campaign="' + esc(c.id) + '"' + dis(!ed) + '>Tạo task từ activity</button> <button class="btn small secondary" data-action="archive-item" data-coll="activities" data-id="' + esc(a.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
      }).join(''), 'campaign-activities') : '<div class="state-box">Chưa có activity nào.</div>';
      html += '<h3>Timeline của campaign</h3>' + ganttHtml(ganttRowsCampaign(c), Store.list('dependencies'));
      // Sửa ngày bằng biểu mẫu + xem trước ảnh hưởng
      html += '<h3>Sửa ngày task bằng biểu mẫu</h3>';
      if (ctasks.length) {
        html += '<form class="inline" id="task-date-form"><label>Task<select id="date-task-id">' + ctasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
          '<label>Ngày bắt đầu mới<input type="date" id="date-new-start" required></label>' +
          '<label>Mốc cần hoàn thành mới<input type="date" id="date-new-due" required></label>' +
          '<button class="btn secondary" type="submit">Xem trước ảnh hưởng</button></form>';
        if (UI.pendingDatePreview) {
          var p = UI.pendingDatePreview;
          html += '<div class="panel"><strong>Xem trước ảnh hưởng khi đổi lịch "' + esc((taskById(p.taskId) || {}).title || '') + '"</strong>';
          if (!p.impact.length) html += '<p class="sub">Không có task phụ thuộc nào bị ảnh hưởng. Chưa có lịch nào bị thay đổi cho tới khi bạn xác nhận.</p>';
          else html += '<p class="sub">Các task phụ thuộc có thể bị ảnh hưởng (hệ thống không tự dịch lịch của chúng):</p>' + tbl('<tr><th>Task phụ thuộc</th><th>Quan hệ</th><th>Ngày hiện tại</th><th>Ngày đề xuất</th></tr>' + p.impact.map(function (i) {
            return '<tr><td>' + esc(i.title) + '</td><td>' + (i.direct ? 'Trực tiếp' : 'Gián tiếp') + '</td><td>' + esc(D.formatDateVN(i.currentStart)) + ' — ' + esc(D.formatDateVN(i.currentDue)) + '</td><td>' + esc(D.formatDateVN(i.proposedStart)) + ' — ' + esc(D.formatDateVN(i.proposedDue)) + '</td></tr>';
          }).join(''));
          html += '<p><button class="btn" data-action="apply-date-change">Xác nhận áp dụng cho task gốc</button> <button class="btn secondary" data-action="cancel-date-change">Hủy xem trước</button></p></div>';
        }
      } else html += '<p class="sub">Chưa có task nào trong campaign này.</p>';
    }
    if (tab === 'tasks') {
      html += '<div class="toolbar"><strong>Task của campaign (' + ctasks.length + ')</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="task" data-campaign="' + esc(c.id) + '">+ Thêm task</button>' : '') + '</div>';
      html += ctasks.length ? tbl('<tr><th>Task</th><th>Người phụ trách</th><th>Đầu ra</th><th>Thời gian</th><th>Timeline tương đối</th><th>Dự kiến</th><th>Phụ thuộc</th><th>Trạng thái</th></tr>' + ctasks.map(function (t) {
        return '<tr><td><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button>' + checklistBadgeHtml(t) + '</td><td>' + esc(memberName(t.assigneeId)) + '</td><td>' + esc(t.deliverable || '—') + '</td><td>' + (t.startDate ? esc(D.formatDateVN(t.startDate)) : '—') + ' → ' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : 'Chưa xếp lịch') + '</td><td>' + vizTaskTimelineHtml(t) + '</td><td>' + (t.effortHours ? esc(t.effortHours) + ' giờ' : 'Chưa ước tính') + '</td><td>' + readinessBadge(t) + '</td><td>' + statusBadge(t.status) + (isOverdue(t) ? '<br>' + vizStatusPillHtml('overdue', { label: 'Quá hạn', derived: true }) : '') + (vizTaskIsBlocked(t) && !isCompletedTask(t) ? '<br>' + vizStatusPillHtml('blocked', { label: 'Bị chặn', derived: true }) : '') + '</td></tr>';
      }).join(''), 'campaign-tasks') : emptyState('Chưa có task nào', 'Thêm task đầu tiên cho campaign này.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="task" data-campaign="' + esc(c.id) + '">+ Thêm task</button></p>' : '');
    }
    if (tab === 'content') {
      // R3.1: tab này chỉ lấy content/publication GẮN campaign này — gồm cả
      // nội dung gốc thuộc campaign VÀ nội dung thường xuyên được dùng lại
      // qua một lần đăng mang campaign này (campaign ở publication, nội
      // dung gốc giữ nguyên). Bài chỉ cùng pillar KHÔNG xuất hiện ở đây.
      var directItems = visibleList('contentItems').filter(function (x) { return x.campaignId === c.id; });
      var directIds = {}; directItems.forEach(function (x) { directIds[x.id] = true; });
      var pubsForCamp = buildPublications().filter(function (p) { return p.campaignId === c.id; });
      var viaPubItems = [];
      pubsForCamp.forEach(function (p) { if (p.contentItemId && !directIds[p.contentItemId]) { var xi = Store.get('contentItems', p.contentItemId); if (xi && viaPubItems.indexOf(xi) === -1) viaPubItems.push(xi); } });
      var items = directItems.concat(viaPubItems);
      var vars = Store.list('variants').filter(function (v) { return items.some(function (x) { return x.id === v.contentItemId; }); });
      html += '<div class="toolbar"><strong>Content của campaign (' + items.length + ')</strong><span>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="content" data-campaign="' + esc(c.id) + '">+ Tạo content</button> <button class="btn small secondary" data-action="editor-open" data-kind="variant" data-campaign="' + esc(c.id) + '">+ Thêm phiên bản theo kênh</button>' : '') + ' <a class="btn small secondary" href="#/content">Mở mục Content</a></span></div>';
      html += vizCampaignCalStripHtml(pubsForCamp);
      html += items.length ? tbl('<tr><th>Content</th><th>Cách gắn campaign</th><th>Số phiên bản kênh</th><th>Lịch đăng</th><th>Trạng thái</th></tr>' + items.map(function (x) {
        var vs = vars.filter(function (v) { return v.contentItemId === x.id; });
        return '<tr><td><strong>' + esc(x.title) + '</strong></td><td>' + (directIds[x.id] ? 'Content thuộc campaign' : 'Qua publication dùng lại') + '</td><td>' + vizChannelChipsHtml(vs) + (vs.length ? '<br><span class="sub">' + vs.length + ' phiên bản</span>' : '') + '</td><td>' + esc(D.formatDateVN(x.scheduledDate)) + '</td><td>' + statusBadge(x.editorialStatus) + '</td></tr>';
      }).join(''), 'campaign-content') : '<div class="state-box">Chưa có content nào thuộc campaign này.</div>';
      if (pubsForCamp.length) html += '<h3>Publication thuộc campaign (' + pubsForCamp.length + ')</h3>' + tbl('<tr><th>Ngày giờ</th><th>Content</th><th>Kênh / Tài khoản</th><th>Trạng thái</th></tr>' + pubsForCamp.map(function (p) {
        return '<tr><td>' + esc(D.formatDateTimeVN(p.at)) + '</td><td>' + esc(p.title) + '</td><td>' + esc(labelStatus(p.platform)) + ' · ' + esc(accountName(p.channelAccountId)) + '</td><td>' + statusBadge(p.status) + '</td></tr>';
      }).join(''), 'campaign-publications');
    }
    if (tab === 'kpi') {
      var ckpis = Store.list('kpis').filter(function (x) { return x.campaignId === c.id; });
      var blines = visibleList('budgetLines').filter(function (b) { return b.campaignId === c.id; });
      html += '<div class="toolbar"><strong>KPI & ngân sách của campaign</strong><span>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="kpi" data-campaign="' + esc(c.id) + '">+ Tạo KPI</button> <button class="btn small secondary" data-action="editor-open" data-kind="budgetLine" data-campaign="' + esc(c.id) + '">+ Tạo dòng ngân sách</button>' : '') + (can('budget.propose') ? ' <button type="button" class="btn small secondary" data-action="editor-open" data-kind="budgetProposal" data-campaign="' + esc(c.id) + '" data-target-type="campaign_ceiling">Đề xuất ngân sách</button>' : '') + ' <a class="btn small secondary" href="#/kpi">Mở mục KPI & Ngân sách</a></span></div>';
      html += ckpis.length ? '<div data-viz="campaign-tab-kpi-chart">' + vizKpiProgressHtml(ckpis) + '</div>' + '<ul class="clean">' + ckpis.map(function (k) { var d = D.kpiDisplay(k); return '<li>' + esc(k.name) + kpiAutoInfoHtml(k) + ': mục tiêu ' + fmtNum(k.target) + ' ' + esc(k.unit || '') + ' · thực đạt: ' + (d.isMissing ? 'Chưa cập nhật' : fmtNum(d.value)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có KPI.</p>';
      html += blines.length ? '<ul class="clean">' + blines.map(function (b) {
        var rem = D.budgetRemaining(b, Store.list('commitments').filter(function (x) { return x.budgetLineId === b.id; }), Store.list('actuals').filter(function (x) { return x.budgetLineId === b.id; }));
        return '<li>' + esc(b.name) + ': đã duyệt ' + fmtMoney(b.approved, b.currency) + ' · còn lại ' + fmtMoney(rem, b.currency) + '<br>' + approvalStampLineHtml(b) + '</li>';
      }).join('') + '</ul>' : '<p class="sub">Chưa có dòng ngân sách.</p>';
    }
    if (tab === 'docs') {
      var assets = visibleList('brandAssets');
      html += '<div class="toolbar"><strong>Tài liệu & tài nguyên dùng cho campaign</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="brandAsset">+ Thêm tài nguyên</button>' : '') + '</div>';
      html += '<p class="sub">KV, file nguồn và hướng dẫn lấy từ Brand Hub để dùng thống nhất cho mọi campaign.</p>';
      html += assets.length ? tbl('<tr><th>Tài nguyên</th><th>Loại</th><th>Đường dẫn</th><th>Trạng thái bản</th></tr>' + assets.map(function (a) {
        var url = a.externalUrl || a.url || a.fileUrl || '';
        return '<tr><td><strong>' + esc(a.name) + '</strong></td><td>' + esc(a.type) + '</td><td>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">Mở / tải</a>' : '—') + '</td><td>' + esc(brandStatusInfo(a).label) + '</td></tr>';
      }).join(''), 'campaign-assets', 'content-backlog') : '<div class="state-box">Chưa có tài nguyên nào trong Brand Hub.</div>';
      var deliverables = ctasks.filter(function (t) { return t.deliverable; });
      html += '<h3>Đầu ra cần bàn giao của các task</h3>' + (deliverables.length ? '<ul class="clean">' + deliverables.map(function (t) { return '<li><strong>' + esc(t.title) + '</strong>: ' + esc(t.deliverable) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có task nào ghi đầu ra.</p>');
    }
    if (tab === 'summary') {
      var prog = D.campaignProgress(ctasks);
      var segSum = vizTaskStatusSegments(ctasks);
      html += '<div class="panel"><h3>Kết quả tới hiện tại</h3>' +
        (prog.total ? '<div class="viz-summary-donut" data-viz="campaign-summary-donut">' + vizDonutSvgHtml({ segments: [{ label: 'Đã xong', value: prog.completed, tone: 'done' }, { label: 'Chưa xong', value: prog.total - prog.completed, tone: 'todo' }], total: prog.total, centerLabel: 'task', unitLabel: 'task chi tiết của campaign' }) + '</div>' +
          '<div data-viz="campaign-summary-task-stacked">' + vizStackedBarHtml({ segments: segSum.segments, total: segSum.total, unitLabel: 'task của campaign' }) + '</div>' : vizEmptyChartHtml('Chưa có task nào trong campaign để vẽ tiến độ.')) +
        '<p>Tiến độ task: ' + prog.completed + '/' + prog.total + ' (' + prog.percentage + '%).</p>' +
        '<h3>Rủi ro</h3><p>' + esc(c.risks || 'Chưa ghi nhận rủi ro.') + '</p>' +
        '<h3>Kết quả mong muốn</h3><p>' + esc(c.desiredOutcome || '—') + '</p>' +
        '<h3>Tổng kết & rút kinh nghiệm</h3><p>' + esc(c.lessons || 'Chưa ghi nhận — bấm Sửa campaign để bổ sung khi campaign kết thúc.') + '</p>' +
        (ed ? '<p><button class="btn" data-action="editor-open" data-kind="campaign" data-id="' + esc(c.id) + '">Sửa campaign để cập nhật tổng kết</button></p>' : '') + '</div>';
    }
    return html;
  }

  // ---------- R3.1: Content Plan — pillar / publication / content mix ----------
  // Pillar, campaign và lịch đăng là BA chiều độc lập của cùng một dữ liệu:
  // pillar = nội dung nói về chủ đề gì; campaign = phục vụ chiến dịch nào
  // (nếu có); lịch đăng = bản nào đăng ở tài khoản nào, lúc nào (publication).
  function pillarById(id) { if (!id) return null; return listSafe('contentPillars').find(function (p) { return p.id === id; }) || null; }
  function contentPillarId(x) { if (!x) return null; return x.pillarId || x.pillar_id || cfVal(x, 'pillarId') || cfVal(x, 'pillar_id') || null; }
  function pillarName(id) { var p = pillarById(id); return p ? (p.name || p.title || '—') : 'Chưa phân loại'; }
  function isPillarArchived(p) { return !p || isArchived(p) || String(p.status || '').toLowerCase() === 'archived'; }
  function activePillars() { return listSafe('contentPillars').filter(function (p) { return !isPillarArchived(p); }); }
  function allPillars() {
    var map = {}; var out = [];
    visibleList('contentPillars').concat(archivedList('contentPillars')).forEach(function (p) { if (!map[p.id]) { map[p.id] = true; out.push(p); } });
    return out;
  }
  function contentCampaignChoice(x) {
    if (!x) return 'unset';
    if (x.campaignId) return 'campaign';
    var ch = cfVal(x, 'campaignChoice') || cfVal(x, 'campaign_choice');
    return ch === 'none' ? 'none' : 'unset';
  }
  function contentCampaignBadge(x) {
    var ch = contentCampaignChoice(x);
    if (ch === 'campaign') return esc(campaignName(x.campaignId));
    if (ch === 'none') return '<span class="badge ok">Content thường xuyên — không thuộc campaign</span>';
    return '<span class="badge grey">Chưa chọn campaign</span>';
  }
  function contentTags(x) {
    if (!x) return [];
    var t = (x.tags !== undefined && x.tags !== null) ? x.tags : cfVal(x, 'tags');
    if (Array.isArray(t)) return t.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return splitTags(t || '');
  }
  function contentIsAlwaysOn(x) { if (!x) return false; var v = (x.alwaysOn !== undefined) ? x.alwaysOn : cfVal(x, 'alwaysOn'); return v === true || v === 'true' || v === 1 || v === '1'; }
  function contentIsEvergreen(x) { if (!x) return false; var v = (x.evergreen !== undefined) ? x.evergreen : cfVal(x, 'evergreen'); return v === true || v === 'true' || v === 1 || v === '1'; }
  function contentFlagsHtml(x) {
    var out = '';
    if (contentIsAlwaysOn(x)) out += '<span class="badge">Always-on</span> ';
    if (contentIsEvergreen(x)) out += '<span class="badge ok">Evergreen</span> ';
    var exp = cfVal(x, 'expiresAt'); if (exp) out += '<span class="badge warn">Hết hiệu lực: ' + esc(D.formatDateVN(exp)) + '</span> ';
    return out;
  }
  function accountName(id) { if (!id) return 'Chưa gắn tài khoản'; var a = Store.get('channelAccounts', id); return a ? a.name : '—'; }
  function contentBuLabel(x) {
    var bu = Store.list('businessUnits').find(function (b) { return b.id === (x.buProductId || x.bu_product_id); });
    var prod = cfVal(x, 'product') || x.product || '';
    return (bu ? (bu.name || bu.buName) : '') + (prod ? (bu ? ' / ' : '') + prod : '') || '—';
  }
  // Publication = MỘT lần đăng cụ thể. Nguồn dữ liệu là publishJobs (job chờ
  // đăng), externalPosts (bài đã đăng) và variant có lịch (lần đăng dự kiến)
  // — job và external post của CÙNG một variant là CÙNG một lần đăng nên
  // chỉ hiện MỘT entry; đăng lại (repost) là external post MỚI nên hiện
  // thêm một entry riêng, không ghi đè lần trước.
  function buildPublications() {
    var posts = []; try { posts = Store.list('externalPosts'); } catch (e) { posts = []; }
    var jobs = []; try { jobs = Store.list('publishJobs'); } catch (e) { jobs = []; }
    var variants = []; try { variants = Store.list('variants'); } catch (e) { variants = []; }
    var variantById = {}; variants.forEach(function (v) { variantById[v.id] = v; });
    var itemById = {}; visibleList('contentItems').forEach(function (x) { itemById[x.id] = x; });
    var pubs = [];
    var variantsWithPost = {};
    var variantsWithJob = {};
    posts.forEach(function (p) { if (p.variantId) variantsWithPost[p.variantId] = true; });
    jobs.forEach(function (j) { if (j.variantId) variantsWithJob[j.variantId] = true; });
    function effCampaign(explicit, variant, item) {
      if (explicit) return explicit;
      var vc = variant ? cfVal(variant, 'campaignId') : null;
      if (vc) return vc;
      return item ? (item.campaignId || null) : null;
    }
    posts.forEach(function (p) {
      var v = p.variantId ? variantById[p.variantId] : null;
      var item = (p.contentItemId && itemById[p.contentItemId]) || (v && itemById[v.contentItemId]) || null;
      pubs.push({ id: 'post:' + p.id, kind: 'post', refId: p.id, variantId: p.variantId || null, contentItemId: item ? item.id : (p.contentItemId || null), platform: p.platform, channelAccountId: p.channelAccountId || (v && v.channelAccountId) || null, at: p.publishedAt || null, status: 'published', campaignId: effCampaign(p.campaignId || cfVal(p, 'campaignId'), v, item), url: p.url || '', title: p.title || (item ? item.title : '—') });
    });
    jobs.forEach(function (j) {
      if (j.variantId && variantsWithPost[j.variantId]) return; // job đã thành bài đăng: cùng 1 lần đăng
      var v2 = j.variantId ? variantById[j.variantId] : null;
      var item2 = v2 ? itemById[v2.contentItemId] : null;
      pubs.push({ id: 'job:' + j.id, kind: 'job', refId: j.id, variantId: j.variantId || null, contentItemId: item2 ? item2.id : null, platform: j.platform || (v2 && v2.platform) || '', channelAccountId: j.channelAccountId || (v2 && v2.channelAccountId) || null, at: j.scheduledAt || (v2 && v2.scheduledAt) || null, status: j.status || 'scheduled', campaignId: effCampaign(j.campaignId || cfVal(j, 'campaignId'), v2, item2), url: '', title: item2 ? item2.title : '—' });
    });
    variants.forEach(function (v) {
      if (variantsWithPost[v.id] || variantsWithJob[v.id]) return; // đã có entry job/post cho lần đăng này
      if (!v.scheduledAt) return;
      var item3 = itemById[v.contentItemId];
      pubs.push({ id: 'variant:' + v.id, kind: 'planned', refId: v.id, variantId: v.id, contentItemId: v.contentItemId, platform: v.platform, channelAccountId: v.channelAccountId || null, at: v.scheduledAt, status: v.publishingStatus || v.editorialStatus || 'scheduled', campaignId: effCampaign(null, v, item3), url: '', title: item3 ? item3.title : '—' });
    });
    return pubs;
  }
  function publicationsOfContent(contentId) { return buildPublications().filter(function (p) { return p.contentItemId === contentId; }); }
  // Content mix theo pillar × channel. Đơn vị đếm do người dùng chọn:
  // 'content' = nội dung gốc (pillar chính tính 1 lần cho 1 content);
  // 'publication' = lần đăng. Mẫu số luôn ghi rõ; tags phụ KHÔNG tham gia
  // phép đếm này nên tổng theo pillar luôn bằng mẫu số.
  function contentMixRows(items, pubs, unit) {
    var channels = [];
    function addCh(c) { if (c && channels.indexOf(c) === -1) channels.push(c); }
    var variantPlatform = {};
    Store.list('variants').forEach(function (v) { variantPlatform[v.id] = v.platform; });
    var byPillar = {};
    var denominator = 0;
    function bump(pillarId, channel) {
      var key = pillarId || '__none';
      if (!byPillar[key]) byPillar[key] = { pillarId: pillarId || null, total: 0, byChannel: {} };
      byPillar[key].total++; denominator++;
      if (channel) { byPillar[key].byChannel[channel] = (byPillar[key].byChannel[channel] || 0) + 1; addCh(channel); }
    }
    if (unit === 'publication') {
      pubs.forEach(function (p) { var it = items.find(function (x) { return x.id === p.contentItemId; }); if (it) bump(contentPillarId(it), p.platform || variantPlatform[p.variantId] || ''); });
    } else {
      items.forEach(function (x) {
        var chs = {};
        Store.list('variants').filter(function (v) { return v.contentItemId === x.id; }).forEach(function (v) { if (v.platform) chs[v.platform] = true; });
        var firstCh = Object.keys(chs)[0] || '';
        // Đếm content 1 lần ở pillar chính; kênh chỉ để chia cột theo kênh
        // ĐẦU TIÊN của content (không nhân tổng theo số kênh).
        bump(contentPillarId(x), firstCh);
      });
    }
    var rows = Object.keys(byPillar).map(function (k) { return byPillar[k]; }).sort(function (a, b) { return b.total - a.total; });
    var tagCounts = {};
    items.forEach(function (x) { contentTags(x).forEach(function (t) { tagCounts[t] = (tagCounts[t] || 0) + 1; }); });
    return { rows: rows, channels: channels, denominator: denominator, tagCounts: tagCounts };
  }
  var PRODUCTION_TASK_TEMPLATES = ['Viết nội dung', 'Thiết kế / sản xuất media', 'Quay / dựng', 'Duyệt nội dung'];
  function createProductionTasks(contentId) {
    var ci = Store.get('contentItems', contentId);
    if (!ci) { toast('Không tìm thấy content.'); return; }
    // CHỈ tạo khi người dùng bấm nút này (template sản xuất) — thao tác Lưu
    // nội dung không bao giờ tự tạo task. Task chỉ gắn content là đủ:
    // campaign/activity lấy theo liên kết sẵn có của content (có thể trống).
    var jobs = PRODUCTION_TASK_TEMPLATES.map(function (label) {
      return { title: label + ': ' + ci.title, contentItemId: ci.id, campaignId: ci.campaignId || null, activityId: ci.activityId || null, assigneeId: ci.ownerId || Store.currentUserId, ownerId: ci.ownerId || Store.currentUserId, status: 'todo', priority: 'Trung bình', checklist: [] };
    });
    (function step() {
      var job = jobs.shift();
      if (!job) { toast('Đã tạo ' + PRODUCTION_TASK_TEMPLATES.length + ' task sản xuất từ template cho content "' + ci.title + '".'); render(); return; }
      saveResult(sCreate('tasks', job), step, function (msg) { toast(msg); });
    })();
  }

  // ---------- Nội dung (Content) ----------
  function variantCardActions(v) {
    var ed = canEdit();
    var html = '<button class="btn small" data-action="editor-open" data-kind="variant" data-id="' + esc(v.id) + '"' + dis(!ed) + '>Mở / sửa</button> ';
    if (v.platform === 'tiktok') html += '<button class="btn small secondary" data-action="editor-open" data-kind="tiktokMetric" data-id="' + esc(v.id) + '"' + dis(!ed) + '>Nhập số liệu</button>';
    else if (v.approvalStatus === 'approved') html += '<button class="btn small secondary" data-action="publish-variant" data-id="' + esc(v.id) + '"' + dis(!canPublish()) + '>Tạo lịch đăng</button>';
    else html += '<button class="btn small secondary" data-action="submit-review" data-id="' + esc(v.id) + '"' + dis(!ed) + '>Gửi duyệt</button>';
    return html;
  }
  function viewContent() {
    // R3.1 C.6: Content Plan là điểm vào RIÊNG của đội content — mọi view ở
    // đây (Backlog / Theo Pillar / Lịch đăng / Bảng / Board / Tiến độ /
    // Thư viện / Content mix / Chờ phân loại / Quản lý Pillar) đọc CÙNG một
    // dữ liệu contentItems + variants + publications, không copy bản ghi.
    var cf = UI.contentFilter;
    var ed = canEdit();
    var allItems = visibleList('contentItems');
    var allVariants = Store.list('variants');
    var allPubs = buildPublications();
    function pubsOfItem(id) { return allPubs.filter(function (p) { return p.contentItemId === id; }); }
    function itemPass(x) {
      if (cf.buProductId !== 'all' && (x.buProductId || x.bu_product_id || '') !== cf.buProductId) return false;
      if (cf.product !== 'all' && (cfVal(x, 'product') || x.product || '') !== cf.product) return false;
      if (cf.pillarId !== 'all' && (contentPillarId(x) || '') !== cf.pillarId) return false;
      if (cf.campaignId === 'none' && contentCampaignChoice(x) !== 'none') return false;
      if (cf.campaignId === 'unset' && contentCampaignChoice(x) !== 'unset') return false;
      if (cf.campaignId !== 'all' && cf.campaignId !== 'none' && cf.campaignId !== 'unset' && x.campaignId !== cf.campaignId) return false;
      if (cf.ownerId !== 'all' && x.ownerId !== cf.ownerId) return false;
      if (cf.status !== 'all' && x.editorialStatus !== cf.status) return false;
      if (cf.format !== 'all' && (x.type || '') !== cf.format) return false;
      if (cf.activityId !== 'all' && (x.activityId || cfVal(x, 'activityId') || '') !== cf.activityId) return false;
      if (cf.taskId !== 'all' && (x.taskId || cfVal(x, 'taskId') || '') !== cf.taskId) return false;
      if (cf.platform !== 'all' || cf.channelAccountId !== 'all') {
        var vs = allVariants.filter(function (v) { return v.contentItemId === x.id; });
        var okPlat = vs.some(function (v) {
          if (cf.platform !== 'all' && v.platform !== cf.platform) return false;
          if (cf.channelAccountId !== 'all' && (v.channelAccountId || '') !== cf.channelAccountId) return false;
          return true;
        });
        if (!okPlat) return false;
      }
      if (cf.from || cf.to) {
        var dates = pubsOfItem(x.id).map(function (p) { return dateInTz(p.at); }).filter(Boolean);
        if (x.scheduledDate) dates.push(String(x.scheduledDate).slice(0, 10));
        var inRange = dates.some(function (d) { return (!cf.from || d >= cf.from) && (!cf.to || d <= cf.to); });
        if (!inRange) return false;
      }
      return true;
    }
    var items = allItems.filter(itemPass);
    var itemIds = {};
    items.forEach(function (x) { itemIds[x.id] = true; });
    var variants = allVariants.filter(function (v) {
      if (!itemIds[v.contentItemId]) return false;
      if (cf.platform !== 'all' && v.platform !== cf.platform) return false;
      if (cf.channelAccountId !== 'all' && (v.channelAccountId || '') !== cf.channelAccountId) return false;
      if (cf.ownerId !== 'all' && v.ownerId !== cf.ownerId) return false;
      if (cf.status !== 'all' && v.editorialStatus !== cf.status) return false;
      return true;
    });
    var pubs = allPubs.filter(function (p) {
      if (!p.contentItemId || !itemIds[p.contentItemId]) return false;
      if (cf.platform !== 'all' && p.platform !== cf.platform) return false;
      if (cf.channelAccountId !== 'all' && (p.channelAccountId || '') !== cf.channelAccountId) return false;
      if (cf.campaignId !== 'all' && cf.campaignId !== 'none' && cf.campaignId !== 'unset' && p.campaignId !== cf.campaignId) return false;
      if (cf.campaignId === 'none' && p.campaignId) return false;
      if (cf.from || cf.to) { var d = dateInTz(p.at); if (!d) return false; if (cf.from && d < cf.from) return false; if (cf.to && d > cf.to) return false; }
      return true;
    });
    var productsAll = [];
    Store.list('businessUnits').forEach(function (b) { (b.products || []).forEach(function (p) { if (productsAll.indexOf(p) === -1) productsAll.push(p); }); });
    var html = pageHead('Content Plan', 'Lập kế hoạch content theo Pillar, campaign (tùy chọn), kênh và lịch đăng. Tạo content ngay tại đây là luồng bình thường — không cần qua Action Plan hay campaign.',
      (ed ? '<button class="btn" data-action="editor-open" data-kind="content">+ Tạo content</button> <button class="btn secondary" data-action="editor-open" data-kind="variant">+ Thêm phiên bản theo kênh</button> <button class="btn secondary" data-action="editor-open" data-kind="pillar">+ Tạo Pillar</button>' : ''));
    html += readonlyNote() + collectionBanner('variants');
    html += '<details class="filter-details"' + ((typeof window !== 'undefined' && window.innerWidth && window.innerWidth > 820) ? ' open' : '') + '><summary class="filter-summary">Bộ lọc</summary><form class="inline filter-panel" id="content-filter-form"><span class="sub">Lọc:</span>' +
      '<label>Brand / BU<select name="buProductId"><option value="all">Tất cả</option>' + Store.list('businessUnits').map(function (b) { return '<option value="' + esc(b.id) + '"' + (cf.buProductId === b.id ? ' selected' : '') + '>' + esc(b.name || b.buName || b.id) + '</option>'; }).join('') + '</select></label>' +
      '<label>Sản phẩm<select name="product"><option value="all">Tất cả</option>' + productsAll.map(function (p) { return '<option value="' + esc(p) + '"' + (cf.product === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></label>' +
      '<label>Pillar<select name="pillarId"><option value="all">Tất cả pillar</option><option value=""' + (cf.pillarId === '' ? ' selected' : '') + '>Chưa phân loại</option>' + allPillars().map(function (p) { return '<option value="' + esc(p.id) + '"' + (cf.pillarId === p.id ? ' selected' : '') + '>' + esc(p.name || p.title) + (isPillarArchived(p) ? ' (đã lưu trữ)' : '') + '</option>'; }).join('') + '</select></label>' +
      '<label>Campaign<select name="campaignId"><option value="all">Tất cả</option><option value="none"' + (cf.campaignId === 'none' ? ' selected' : '') + '>Không thuộc campaign (content thường xuyên)</option><option value="unset"' + (cf.campaignId === 'unset' ? ' selected' : '') + '>Chưa chọn campaign</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (cf.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Kênh<select name="platform"><option value="all">Tất cả kênh</option>' + PLATFORMS.map(function (p) { return '<option value="' + p[0] + '"' + (cf.platform === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Tài khoản kênh<select name="channelAccountId"><option value="all">Tất cả tài khoản</option>' + Store.list('channelAccounts').map(function (a) { return '<option value="' + esc(a.id) + '"' + (cf.channelAccountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Định dạng<select name="format"><option value="all">Tất cả</option>' + [['post', 'Post'], ['video', 'Video'], ['image', 'Hình ảnh'], ['article', 'Bài viết'], ['other', 'Khác']].map(function (p) { return '<option value="' + p[0] + '"' + (cf.format === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Người phụ trách<select name="ownerId"><option value="all">Tất cả</option>' + memberPairs().map(function (p) { return '<option value="' + esc(p[0]) + '"' + (cf.ownerId === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Trạng thái<select name="status"><option value="all">Tất cả</option>' + EDITORIAL_STATUSES.map(function (p) { return '<option value="' + p[0] + '"' + (cf.status === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Từ ngày<input type="date" name="from" value="' + esc(cf.from) + '"></label>' +
      '<label>Đến ngày<input type="date" name="to" value="' + esc(cf.to) + '"></label>' +
      '<label>Activity (nâng cao)<select name="activityId"><option value="all">Tất cả</option>' + visibleList('activities').map(function (a) { return '<option value="' + esc(a.id) + '"' + (cf.activityId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Task (nâng cao)<select name="taskId"><option value="all">Tất cả</option>' + visibleList('tasks').map(function (t) { return '<option value="' + esc(t.id) + '"' + (cf.taskId === t.id ? ' selected' : '') + '>' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn secondary" type="submit">Lọc</button></form></details>' +
      '<p class="sub">Lọc theo Activity/Task là bộ lọc nâng cao theo liên kết task (tùy chọn). Lọc Pillar thấy cả content thuộc campaign lẫn content thường xuyên; lọc Campaign chỉ thấy content/publication thuộc campaign đó.</p>';
    html += tabsHtml([['backlog', 'Backlog / Ý tưởng'], ['pillars', 'Theo Pillar'], ['calendar', 'Lịch đăng'], ['table', 'Bảng content'], ['board', 'Board sản xuất / duyệt'], ['production', 'Tiến độ sản xuất'], ['library', 'Thư viện Post'], ['mix', 'Content mix'], ['queue', 'Chờ phân loại'], ['manage', 'Quản lý Pillar']], UI.contentTab, 'content-tab');
    function itemActions(x) {
      return '<button class="btn small" data-action="editor-open" data-kind="content" data-id="' + esc(x.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="editor-open" data-kind="variant" data-content="' + esc(x.id) + '"' + dis(!ed) + '>+ Phiên bản kênh</button> <button class="btn small secondary" data-action="content-prod-tasks" data-id="' + esc(x.id) + '"' + dis(!ed) + '>Tạo task sản xuất</button>';
    }
    function itemRow(x) {
      var myPubs = pubsOfItem(x.id);
      return '<tr><td><strong>' + esc(x.title) + '</strong>' + (cfVal(x, 'angle') ? '<br><span class="sub">Góc: ' + esc(cfVal(x, 'angle')) + '</span>' : '') + (x.brief ? '<br><span class="sub">' + esc(x.brief) + '</span>' : '') + '<br>' + contentFlagsHtml(x) + '</td>' +
        '<td>' + esc(contentBuLabel(x)) + '</td>' +
        '<td>' + esc(pillarName(contentPillarId(x))) + '</td>' +
        '<td>' + contentCampaignBadge(x) + '</td>' +
        '<td>' + esc(labelStatus(x.type)) + (contentTags(x).length ? '<br><span class="sub">Tags: ' + esc(contentTags(x).join(', ')) + '</span>' : '') + (x.series ? '<br><span class="sub">Series: ' + esc(x.series) + '</span>' : '') + '</td>' +
        '<td>' + esc(memberName(x.ownerId)) + '</td>' +
        '<td>' + (cfVal(x, 'productionDeadline') ? esc(D.formatDateVN(cfVal(x, 'productionDeadline'))) : '—') + '</td>' +
        '<td>' + statusBadge(x.editorialStatus) + '<br><span class="sub">' + myPubs.length + ' publication</span></td>' +
        '<td class="row-actions">' + itemActions(x) + '</td></tr>';
    }
    var itemHead = '<tr><th>Content</th><th>Brand / Sản phẩm</th><th>Pillar chính</th><th>Campaign</th><th>Định dạng / Tags</th><th>Người phụ trách</th><th>Hạn sản xuất</th><th>Trạng thái</th><th>Thao tác</th></tr>';
    if (UI.contentTab === 'backlog') {
      // Backlog/Ý tưởng: nội dung CHƯA có lịch đăng nào — không gán ngày giả.
      var backlog = items.filter(function (x) { return !pubsOfItem(x.id).length && !x.scheduledDate; });
      html += '<h2>Backlog / Ý tưởng (' + backlog.length + ')</h2><p class="sub">Ý tưởng chưa có lịch đăng chỉ nằm ở đây — hệ thống không tự gán ngày hôm nay hay ngày bất kỳ để lấp ô lịch.</p>';
      if (backlog.length) {
        var blSegs = EDITORIAL_STATUSES.map(function (st) {
          var n = backlog.filter(function (x) { return x.editorialStatus === st[0]; }).length;
          return { label: st[1], value: n, tone: vizStatusTone(st[0]) };
        }).filter(function (s) { return s.value > 0; });
        var blOther = backlog.length - blSegs.reduce(function (a, s) { return a + s.value; }, 0);
        if (blOther > 0) blSegs.push({ label: 'Trạng thái khác', value: blOther, tone: 'neutral' });
        html += '<div data-viz="content-backlog-pipeline"><h3>Pipeline trạng thái của Backlog</h3>' + vizStackedBarHtml({ segments: blSegs, total: backlog.length, unitLabel: 'content trong Backlog' }) + '</div>';
      }
      html += backlog.length ? tbl(itemHead + backlog.map(itemRow).join(''), 'content-grouped') : emptyState('Backlog đang trống', 'Mọi content đang lọc đều đã có lịch đăng, hoặc chưa có content nào.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="content">+ Tạo ý tưởng mới</button></p>' : '');
    }
    if (UI.contentTab === 'pillars') {
      html += '<h2>Content theo Pillar</h2><p class="sub">Mỗi content nằm ở đúng MỘT pillar chính. Lọc pillar thấy cả content campaign lẫn content thường xuyên (pillar khác campaign).</p>';
      var groups = {};
      var order = [];
      items.forEach(function (x) { var k = contentPillarId(x) || '__none'; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(x); });
      if (!order.length) html += emptyState('Chưa có content nào', 'Tạo content đầu tiên cho Content Plan.', '');
      var pillarMix = contentMixRows(items, pubs, 'content');
      order.forEach(function (k) {
        var mixRow = pillarMix.rows.find(function (r) { return (r.pillarId || '__none') === k; });
        var shareVal = mixRow ? mixRow.total : groups[k].length;
        html += '<h3>' + esc(k === '__none' ? 'Chưa phân loại pillar' : pillarName(k)) + ' (' + groups[k].length + ')</h3>' +
          '<div data-viz="content-pillar-share">' + vizProgressBarHtml({ value: shareVal, max: pillarMix.denominator || items.length, pct: vizPct(shareVal, pillarMix.denominator || items.length), tone: 'running', label: 'Tỉ trọng pillar trong Content mix', detail: shareVal + ' / ' + (pillarMix.denominator || items.length) + ' content gốc (' + fmtPct(vizPct(shareVal, pillarMix.denominator || items.length)) + ')' }) + '</div>' +
          tbl(itemHead + groups[k].map(itemRow).join(''));
      });
    }
    if (UI.contentTab === 'calendar') {
      var year = UI.calYear, month = UI.calMonth;
      html += '<form class="inline" id="cal-nav-form"><label>Tháng<input type="number" id="cal-month" min="1" max="12" value="' + (month + 1) + '"></label><label>Năm<input type="number" id="cal-year" value="' + year + '"></label><button class="btn secondary" type="submit">Xem tháng</button> <button class="btn secondary" type="button" data-action="cal-today">Về tháng hiện tại</button></form>';
      html += '<p class="sub">Lịch hiển thị theo TỪNG PUBLICATION: ngày + giờ, tài khoản, trạng thái, nhãn pillar/campaign. Bấm vào một ngày chỉ mở form phiên bản/publication với lịch của ngày đó được điền sẵn — không tự gán campaign/action. Ý tưởng chưa có lịch nằm ở Backlog, không hiện ở lịch.</p>';
      var first = new Date(year, month, 1);
      var start = D.weekStartMonday(first);
      var cells = [];
      for (var i = 0; i < 42; i++) { var d = new Date(start.getTime()); d.setDate(d.getDate() + i); cells.push(d); }
      html += '<div class="cal">' + ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'].map(function (x) { return '<div class="cal-head">' + x + '</div>'; }).join('') + '</div>';
      html += '<div class="cal">' + cells.map(function (d) {
        var iso = isoOf(d);
        var dayPubs = pubs.filter(function (p) { return dateInTz(p.at) === iso; });
        // Lưới an toàn timezone (R2-04): variant có lịch đăng nhưng vì bất kỳ
        // lý do dữ liệu nào chưa thành một publication ở trên (vd lần đăng
        // của nó bị lọc khỏi tập đang xem) vẫn phải hiện đúng ngày ICT của
        // lịch variant — không để mất lịch khỏi calendar.
        var representedVar = {};
        allPubs.forEach(function (p) { if (p.variantId) representedVar[p.variantId] = true; });
        var dayVariants = variants.filter(function (v) { return dateInTz(v.scheduledAt) === iso; }).filter(function (v) { return !representedVar[v.id]; });
        var dayItems = [];
        dayPubs.forEach(function (p) { dayItems.push({ tone: vizStatusTone(p.status), count: 1 }); });
        dayVariants.forEach(function (v) { dayItems.push({ tone: vizStatusTone(v.editorialStatus), count: 1 }); });
        return '<div class="cal-cell' + (d.getMonth() !== month ? ' dim' : '') + (iso === todayISO() ? ' today' : '') + '" data-action="cal-day" data-id="' + iso + '" role="button" tabindex="0" aria-label="Ngày ' + iso + '"><div class="day">' + d.getDate() + '/' + (d.getMonth() + 1) + ' ' + vizCalDotsHtml(dayItems) + '</div>' +
          dayPubs.map(function (p) {
            var it = items.find(function (x) { return x.id === p.contentItemId; }) || Store.get('contentItems', p.contentItemId) || {};
            var time = toDatetimeLocalValue(p.at).slice(11, 16);
            return '<span class="chip st-edge-' + vizStatusTone(p.status) + '" data-action="' + (p.variantId ? 'chip-variant' : 'editor-open') + '"' + (p.variantId ? ' data-id="' + esc(p.variantId) + '"' : ' data-kind="post" data-id="' + esc(p.refId) + '"') + ' role="button" tabindex="0" title="' + esc(p.title) + ' · ' + esc(accountName(p.channelAccountId)) + ' · Pillar: ' + esc(pillarName(contentPillarId(it))) + ' · Campaign: ' + esc(p.campaignId ? campaignName(p.campaignId) : 'Không thuộc campaign') + '">' + esc(time) + ' ' + esc(labelStatus(p.platform)) + ': ' + esc(p.title) + '</span>';
          }).join('') +
          dayVariants.map(function (v) { return '<span class="chip st-edge-' + vizStatusTone(v.editorialStatus) + '" data-action="chip-variant" data-id="' + esc(v.id) + '" role="button" tabindex="0">' + esc(v.channelLabel || labelStatus(v.platform)) + ': ' + esc(contentTitle(v.contentItemId)) + '</span>'; }).join('') + '</div>';
      }).join('') + '</div>';
      var monthPrefix = year + '-' + String(month + 1).padStart(2, '0');
      var monthPubs = pubs.filter(function (p) { return dateInTz(p.at).slice(0, 7) === monthPrefix; }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
      html += '<div class="cal-agenda"><h3>Danh sách publication theo ngày (màn hình nhỏ)</h3>' + (monthPubs.length ? '<ul class="clean">' + monthPubs.map(function (p) {
        var it2 = Store.get('contentItems', p.contentItemId) || {};
        return '<li>' + vizStatusDotHtml(vizStatusTone(p.status)) + esc(D.formatDateTimeVN(p.at)) + ' — <button class="linklike" data-action="editor-open" data-kind="' + (p.variantId ? 'variant' : 'post') + '" data-id="' + esc(p.variantId || p.refId) + '">' + esc(p.title) + '</button> (' + esc(labelStatus(p.platform)) + ' · ' + esc(accountName(p.channelAccountId)) + ') ' + statusBadge(p.status) + '<br><span class="sub">Pillar: ' + esc(pillarName(contentPillarId(it2))) + ' · Campaign: ' + esc(p.campaignId ? campaignName(p.campaignId) : 'Không thuộc campaign') + '</span></li>';
      }).join('') + '</ul>' : '<p class="sub">Tháng này chưa có publication nào.</p>') + '</div>';
      html += '<h3>Tất cả publication trong tháng (' + monthPubs.length + ')</h3>' + (monthPubs.length ? tbl('<tr><th>Ngày giờ đăng</th><th>Content</th><th>Kênh / Tài khoản</th><th>Pillar</th><th>Campaign của publication</th><th>Trạng thái</th></tr>' + monthPubs.map(function (p) {
        var it3 = Store.get('contentItems', p.contentItemId) || {};
        return '<tr><td>' + esc(D.formatDateTimeVN(p.at)) + '</td><td><strong>' + esc(p.title) + '</strong></td><td>' + esc(labelStatus(p.platform)) + '<br><span class="sub">' + esc(accountName(p.channelAccountId)) + '</span></td><td>' + esc(pillarName(contentPillarId(it3))) + '</td><td>' + (p.campaignId ? esc(campaignName(p.campaignId)) : 'Không thuộc campaign') + '</td><td>' + statusBadge(p.status) + '</td></tr>';
      }).join(''), 'content-month-publications', 'content-items') : '<p class="sub">Chưa có publication nào trong tháng đang xem.</p>');
    }
    if (UI.contentTab === 'table') {
      html += '<h2>Content gốc (' + items.length + ')</h2>';
      html += items.length ? tbl(itemHead + items.map(itemRow).join('')) : '<div class="state-box">Chưa có content gốc nào khớp bộ lọc.</div>';
      html += '<h2>Phiên bản theo kênh (' + variants.length + ')</h2>';
      html += variants.length ? tbl('<tr><th>Content</th><th>Kênh</th><th>Caption</th><th>Lịch đăng</th><th>Trạng thái biên tập</th><th>Duyệt</th><th>Thao tác</th></tr>' + variants.map(function (v) {
        var pub = v.platform === 'tiktok' ? '<span class="badge warn">Đăng ngoài app</span>' : statusBadge(v.publishingStatus || '', v.publishingStatus ? labelStatus(v.publishingStatus) : '');
        return '<tr><td><strong>' + esc(contentTitle(v.contentItemId)) + '</strong></td><td>' + esc(v.channelLabel || labelStatus(v.platform)) + '</td><td>' + esc(v.caption || '') + '</td><td>' + esc(D.formatDateTimeVN(v.scheduledAt)) + '</td><td>' + statusBadge(v.editorialStatus) + '<br>' + pub + '</td><td>' + statusBadge(v.approvalStatus) + '</td><td class="row-actions">' + variantCardActions(v) + '</td></tr>';
      }).join(''), 'content-variants') : '<div class="state-box">Chưa có phiên bản theo kênh nào.</div>';
    }
    if (UI.contentTab === 'board') {
      html += '<div class="kanban">';
      EDITORIAL_STATUSES.forEach(function (st) {
        var col = variants.filter(function (v) { return v.editorialStatus === st[0]; });
        html += '<div class="kanban-col"><strong>' + esc(st[1]) + ' (' + col.length + ')</strong>' + col.map(function (v) {
          return '<div class="card"><strong>' + esc(contentTitle(v.contentItemId)) + '</strong><br><span class="sub">' + esc(v.channelLabel || labelStatus(v.platform)) + ' · ' + esc(D.formatDateVN(v.scheduledAt)) + '</span><br>' + variantCardActions(v) + '</div>';
        }).join('') + '</div>';
      });
      html += '</div>';
    }
    if (UI.contentTab === 'production') {
      var sorted = variants.slice().sort(function (a, b) { return String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')); });
      html += '<h2>Tiến độ sản xuất theo lịch đăng</h2><p class="sub">Task sản xuất chỉ được tạo khi bạn bấm nút "Tạo task sản xuất" ở bảng content (theo template Viết / Thiết kế / Quay dựng / Duyệt) — Lưu content không tự tạo task, và task sản xuất có thể chỉ gắn content, không bắt campaign/action.</p>' + tbl('<tr><th>Lịch đăng</th><th>Nội dung</th><th>Kênh</th><th>Người sản xuất</th><th>Người duyệt</th><th>Hạn sản xuất</th><th>Hạn duyệt</th><th>Timeline hạn → ngày đăng</th><th>Trạng thái</th><th>Thao tác</th></tr>' + sorted.map(function (v) {
        var tlPts = [
          { label: 'Hạn sản xuất', date: v.productionDeadline ? String(v.productionDeadline).slice(0, 10) : '', dateText: D.formatDateVN(v.productionDeadline) || '—', tone: 'running' },
          { label: 'Hạn duyệt', date: v.reviewDeadline ? String(v.reviewDeadline).slice(0, 10) : '', dateText: D.formatDateVN(v.reviewDeadline) || '—', tone: 'pending' },
          { label: 'Ngày đăng', date: v.scheduledAt ? String(v.scheduledAt).slice(0, 10) : '', dateText: D.formatDateVN(v.scheduledAt) || '—', tone: 'done' }
        ];
        var tlHave = tlPts.filter(function (p) { return p.date; }).length;
        return '<tr><td>' + esc(D.formatDateTimeVN(v.scheduledAt)) + '</td><td><strong>' + esc(contentTitle(v.contentItemId)) + '</strong></td><td>' + esc(v.channelLabel || labelStatus(v.platform)) + '</td><td>' + esc(memberName(v.ownerId)) + '</td><td>' + esc(memberName(v.reviewerId)) + '</td><td>' + esc(D.formatDateVN(v.productionDeadline)) + '</td><td>' + esc(D.formatDateVN(v.reviewDeadline)) + '</td><td>' + (tlHave >= 2 ? vizTimelineHtml(tlPts) : '<span class="sub">Chưa đủ mốc ngày để vẽ timeline</span>') + '</td><td>' + statusBadge(v.editorialStatus) + '</td><td class="row-actions">' + variantCardActions(v) + '</td></tr>';
      }).join(''), 'content-production');
      var tiktok = variants.filter(function (v) { return v.platform === 'tiktok'; });
      html += '<h2>TikTok — sản xuất trong app, đăng ngoài app</h2>';
      if (!tiktok.length) html += '<div class="state-box">Chưa có content TikTok nào.</div>';
      tiktok.forEach(function (v) {
        var metrics = [];
        try {
          metrics = Store.list('manualMetricEntries').filter(function (m) { return m.variantId === v.id; })
            .concat(Store.list('metricObservations').filter(function (m) { return m.objectId === v.id || m.variantId === v.id; }));
        } catch (e) { metrics = []; }
        html += '<div class="panel"><h3>' + esc(contentTitle(v.contentItemId)) + ' — ' + statusBadge('pending', v.externalStatus || 'Chờ đăng ngoài app') + '</h3>' +
          '<p><strong>Hook:</strong> ' + esc(v.hook || '—') + '</p><p><strong>CTA:</strong> ' + esc(v.cta || '—') + '</p>' +
          '<p><strong>Caption:</strong> ' + esc(v.caption || '') + (v.hashtags ? ' <span class="sub">' + esc(v.hashtags) + '</span>' : '') + '</p>' +
          (v.scriptScenes && v.scriptScenes.length ? '<div class="table-wrap"><table class="scene-table"><tr><th>Cảnh</th><th>Hook</th><th>Hình ảnh</th><th>Lời thoại</th><th>Chữ trên màn hình</th><th>Thời lượng (giây)</th><th>CTA</th></tr>' +
            v.scriptScenes.map(function (s) { return '<tr><td>' + esc(s.shot) + '</td><td>' + esc(s.hook || '') + '</td><td>' + esc(s.visual) + '</td><td>' + esc(s.dialogue) + '</td><td>' + esc(s.onScreenText) + '</td><td>' + esc(s.durationSec) + '</td><td>' + esc(s.cta || '') + '</td></tr>'; }).join('') + '</table></div>' : '<p class="sub">Chưa có kịch bản theo cảnh — mở sửa để thêm.</p>') +
          (v.externalUrl ? '<p>Link post: <a href="' + esc(v.externalUrl) + '" target="_blank" rel="noopener">' + esc(v.externalUrl) + '</a>' + (v.actualPublishedAt ? ' · Ngày đăng thực tế: ' + esc(D.formatDateTimeVN(v.actualPublishedAt)) : '') + '</p>' : '') +
          (metrics.length ? '<div data-viz="tiktok-metrics"><p>' + metrics.map(function (m) { return '<span class="metric-chip">' + esc(m.metric) + ' = <strong>' + fmtNum(m.value) + '</strong></span>'; }).join('') + '</p>' + tbl('<tr><th>Chỉ số</th><th>Giá trị</th><th>Nguồn</th><th>Thời điểm</th></tr>' + metrics.map(function (m) { return '<tr><td>' + esc(m.metric) + '</td><td>' + fmtNum(m.value) + '</td><td>' + esc(m.source || '—') + '</td><td>' + esc(D.formatDateTimeVN(m.observedAt)) + '</td></tr>'; }).join('')) + '</div>' : '<p class="sub">Chưa có số liệu nào được nhập cho video này.</p>') +
          '<p>' + variantCardActions(v) + '</p></div>';
      });
    }
    if (UI.contentTab === 'library') {
      var posted = pubs.filter(function (p) { return p.kind === 'post'; });
      html += '<h2>Thư viện Post (' + posted.length + ' publication)</h2><p class="sub">Mỗi dòng là MỘT publication. Đăng lại cùng content tạo một dòng mới riêng — link và số liệu của publication trước không bị ghi đè.</p>';
      // WAVE-B3: số liệu của lần đăng lấy từ metricObservations đã có trong
      // Store (khóa externalPostId = refId của lần đăng) — chỉ lấy bản ghi
      // MỚI NHẤT cho từng chỉ số; lần đăng không có quan trắc thì để trống.
      var libObs = listSafe('metricObservations');
      function libLatestMetric(postId, names) {
        var cand = libObs.filter(function (o) { return o.externalPostId === postId && names.indexOf(o.metric) !== -1; })
          .sort(function (a, b) { return String(a.observedAt || '').localeCompare(String(b.observedAt || '')); });
        if (!cand.length) return null;
        var v = Number(cand[cand.length - 1].value);
        return isNaN(v) ? null : v;
      }
      var libViews = posted.map(function (p) { return libLatestMetric(p.refId, ['views', 'lifetime_views']); });
      var libMaxViews = 0;
      libViews.forEach(function (v) { if (v !== null && v > libMaxViews) libMaxViews = v; });
      html += posted.length ? tbl('<tr><th>Post</th><th>Content gốc</th><th>Kênh / Tài khoản</th><th>Ngày đăng</th><th>Pillar</th><th>Campaign của publication</th><th>Số liệu publication</th><th>Link</th></tr>' + posted.map(function (p, pi) {
        var it4 = Store.get('contentItems', p.contentItemId) || {};
        var views = libViews[pi];
        var reach = libLatestMetric(p.refId, ['reach']);
        var impressions = libLatestMetric(p.refId, ['impressions']);
        var metricCell;
        if (views === null && reach === null && impressions === null) metricCell = '—';
        else {
          var parts = [];
          if (views !== null) parts.push('Lượt xem: ' + fmtNum(views));
          if (reach !== null) parts.push('Reach: ' + fmtNum(reach));
          if (impressions !== null) parts.push('Hiển thị: ' + fmtNum(impressions));
          metricCell = (views !== null && libMaxViews > 0 ? vizCellBarHtml({ value: views, max: libMaxViews, tone: 'running', text: parts.join(' · ') }) : '<span class="sub">' + esc(parts.join(' · ')) + '</span>');
        }
        return '<tr><td><strong>' + esc(p.title) + '</strong></td><td>' + esc(it4.title || '—') + '</td><td>' + esc(labelStatus(p.platform)) + '<br><span class="sub">' + esc(accountName(p.channelAccountId)) + '</span></td><td>' + esc(D.formatDateTimeVN(p.at)) + '</td><td>' + esc(pillarName(contentPillarId(it4))) + '</td><td>' + (p.campaignId ? esc(campaignName(p.campaignId)) : 'Không thuộc campaign') + '</td><td>' + metricCell + '</td><td>' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">Mở bài</a>' : '—') + '</td></tr>';
      }).join(''), 'content-library', 'content-mix-matrix') : '<div class="state-box">Chưa có post nào khớp bộ lọc.</div>';
    }
    if (UI.contentTab === 'mix') {
      var unit = UI.contentMixUnit === 'publication' ? 'publication' : 'content';
      var mix = contentMixRows(items, pubs, unit);
      html += '<h2>Content mix theo Pillar × Kênh</h2>' +
        '<div class="toolbar"><span class="sub">Đơn vị đếm:</span><span>' +
        '<button type="button" class="btn small ' + (unit === 'content' ? '' : 'secondary') + '" data-action="content-mix-unit" data-id="content">Content gốc</button> ' +
        '<button type="button" class="btn small ' + (unit === 'publication' ? '' : 'secondary') + '" data-action="content-mix-unit" data-id="publication">Publication</button></span></div>' +
        '<p class="sub">Đơn vị đếm đang chọn: <strong>' + (unit === 'publication' ? 'publication' : 'content gốc') + '</strong> · Mẫu số (tổng số ' + (unit === 'publication' ? 'publication' : 'content gốc') + ' trong kỳ/bộ lọc hiện tại): <strong>' + mix.denominator + '</strong>. Pillar chính tính đúng 1 lần cho 1 content gốc ở đơn vị "content gốc". Kỳ được xác định bằng bộ lọc Từ ngày/Đến ngày ở trên (để trống = toàn bộ).</p>';
      if (!mix.denominator) html += '<div class="state-box">Chưa có dữ liệu để tính content mix trong kỳ/bộ lọc này.</div>';
      else {
        // R3.1-VIZ 4: biểu đồ tỷ trọng theo pillar + theo kênh, dùng ĐÚNG
        // đơn vị đếm đang chọn và in mẫu số ngay tại chart; bảng số ở dưới.
        html += vizMixChartHtml(mix, unit);
        var heatMax = 0;
        mix.rows.forEach(function (r) { mix.channels.forEach(function (c) { heatMax = Math.max(heatMax, Number(r.byChannel[c]) || 0); }); });
        html += '<div data-viz="content-mix-heat"><h3>Ma trận Pillar × Kênh (tô nền theo mật độ ô)</h3>' + tbl('<tr><th>Pillar chính</th>' + mix.channels.map(function (c) { return '<th>' + esc(labelStatus(c)) + '</th>'; }).join('') + '<th>Tổng</th><th>Tỷ trọng</th></tr>' + mix.rows.map(function (r) {
          return '<tr><td><strong>' + esc(r.pillarId ? pillarName(r.pillarId) : 'Chưa phân loại') + '</strong></td>' + mix.channels.map(function (c) {
            var v = Number(r.byChannel[c]) || 0;
            var ratio = heatMax > 0 ? v / heatMax : 0;
            var heatCls = v === 0 ? 'heat-0' : (ratio <= 0.25 ? 'heat-1' : (ratio <= 0.5 ? 'heat-2' : (ratio <= 0.75 ? 'heat-3' : 'heat-4')));
            return '<td class="' + heatCls + '" title="' + esc(labelStatus(c)) + ': ' + v + ' / ô đậm nhất ' + heatMax + '">' + v + '</td>';
          }).join('') + '<td><strong>' + r.total + '</strong></td><td>' + (mix.denominator ? (Math.round(r.total / mix.denominator * 1000) / 10) + '%' : '—') + '</td></tr>';
        }).join('') + '<tr><td><strong>Tổng (mẫu số)</strong></td>' + mix.channels.map(function (c) { return '<td></td>'; }).join('') + '<td><strong>' + mix.denominator + '</strong></td><td><strong>100%</strong></td></tr>', 'content-queue') + '</div>';
        html += '<div data-viz="content-mix-stacked"><h3>Cơ cấu kênh trong từng Pillar (thanh 100%)</h3>' + mix.rows.map(function (r) {
          var segs = mix.channels.map(function (c, ci) { return { label: labelStatus(c), value: Number(r.byChannel[c]) || 0, cat: (ci % 8) + 1 }; }).filter(function (s) { return s.value > 0; });
          if (!segs.length) return '';
          return '<p class="sub"><strong>' + esc(r.pillarId ? pillarName(r.pillarId) : 'Chưa phân loại') + '</strong> — tổng ' + r.total + '</p>' + vizStackedBarHtml({ segments: segs, total: r.total, unitLabel: (unit === 'publication' ? 'publication' : 'content gốc') + ' của pillar này' });
        }).join('') + '</div>';
        var tagList = Object.keys(mix.tagCounts);
        html += '<p class="sub">Tỷ trọng theo tags phụ (chỉ tham khảo): ' + (tagList.length ? tagList.map(function (t) { return esc(t) + ': ' + mix.tagCounts[t]; }).join(' · ') : '—') + '. <strong>Lưu ý: tỷ trọng theo tags KHÔNG cộng ra tổng</strong> — một content có nhiều tags được tính ở mọi tag của nó, trong khi tổng chính thức chỉ tính theo pillar chính (mỗi content 1 lần).</p>';
      }
    }
    if (UI.contentTab === 'queue') {
      // Hàng đợi phân loại: bài import/sync (hoặc mọi bài) THIẾU pillar.
      // Không tự gán pillar/campaign giả. Bài đủ phân loại nhưng không
      // thuộc campaign là HỢP LỆ và không nằm ở hàng đợi này.
      var queueItems = items.filter(function (x) { return !contentPillarId(x); });
      var orphanPosts = [];
      try { orphanPosts = Store.list('externalPosts').filter(function (p) { return !p.contentItemId; }); } catch (e) { orphanPosts = []; }
      html += '<h2>Chờ phân loại (' + queueItems.length + ' content)</h2>' +
        '<p class="sub">Post import/đồng bộ về mà thiếu pillar nằm ở hàng đợi riêng này cho tới khi được phân loại thủ công — hệ thống không tự gán pillar và không tạo campaign giả cho chúng. Post đã đủ pillar nhưng không thuộc campaign là dữ liệu hợp lệ, không phải lỗi và không nằm ở đây.</p>' +
        '<div class="cards" data-viz="content-queue-cards">' +
        vizKpiCardHtml({ label: 'Content chờ phân loại', valueText: String(queueItems.length), tone: 'pending', toneLabel: 'Chờ phân loại', sub: 'Thiếu pillar chính — cần phân loại thủ công' }) +
        vizKpiCardHtml({ label: 'Post chưa gắn content gốc', valueText: String(orphanPosts.length), tone: 'blocked', toneLabel: 'Chưa gắn gốc', sub: 'Post ngoài hệ thống chưa nối về content gốc' }) +
        vizKpiCardHtml({ label: 'Tổng cần xử lý', valueText: String(queueItems.length + orphanPosts.length), tone: 'running', toneLabel: 'Hàng đợi', sub: 'Tổng hai nhóm chờ xử lý ở tab này' }) +
        '</div>';
      if (queueItems.length) {
        html += '<h3>Tuổi chờ phân loại</h3><ul class="clean" data-viz="content-queue-age">' + queueItems.map(function (x) {
          var raw = x.createdAt || x.created_at || x.updatedAt || x.updated_at || '';
          var d0 = raw ? String(raw).slice(0, 10) : '';
          var days = (/^\d{4}-\d{2}-\d{2}$/.test(d0)) ? Math.max(0, Math.floor((Date.parse(todayISO() + 'T00:00:00') - Date.parse(d0 + 'T00:00:00')) / 86400000)) : null;
          var badge = days === null
            ? vizStatusPillHtml('neutral', { label: 'Chưa rõ ngày vào hàng đợi', tone: 'neutral' })
            : vizStatusPillHtml('pending', { label: 'Đã chờ ' + days + ' ngày', tone: days >= 7 ? 'overdue' : (days >= 3 ? 'pending' : 'neutral') });
          return '<li><strong>' + esc(x.title) + '</strong> ' + badge + '</li>';
        }).join('') + '</ul>';
      }
      html += queueItems.length ? tbl(itemHead + queueItems.map(itemRow).join('')) : '<div class="state-box">Không có content nào đang chờ phân loại pillar.</div>';
      if (orphanPosts.length) {
        html += '<h3>Post chưa gắn content gốc (' + orphanPosts.length + ')</h3>' + tbl('<tr><th>Post</th><th>Kênh</th><th>Ngày đăng</th><th>Thao tác</th></tr>' + orphanPosts.map(function (p) {
          return '<tr><td><strong>' + esc(p.title) + '</strong></td><td>' + esc(labelStatus(p.platform)) + '</td><td>' + esc(D.formatDateTimeVN(p.publishedAt)) + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="post" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Gắn content gốc / phân loại</button></td></tr>';
        }).join(''), 'content-orphan-posts');
      }
    }
    if (UI.contentTab === 'manage') {
      var pillarsAll = allPillars();
      html += '<div class="toolbar"><strong>Quản lý Content Pillar (' + pillarsAll.length + ')</strong><span>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="pillar">+ Tạo Pillar</button>' : '') + '</span></div>' +
        '<p class="sub">Pillar được quản lý theo brand/BU/sản phẩm, có mô tả + hướng dẫn phân loại/ví dụ để đội phân loại nhất quán. Sửa/lưu trữ pillar giữ nguyên ID và lịch sử phân loại của content cũ — không xóa cứng. App không hardcode một bộ pillar cho mọi BU.</p>';
      if (!pillarsAll.length) {
        html += emptyState('Chưa có pillar nào', 'Tạo pillar đầu tiên cho phạm vi của đội, hoặc dùng một gợi ý mẫu bên dưới — gợi ý chỉ điền sẵn vào form, bạn xem/sửa rồi mới bấm Lưu tạo.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="pillar">+ Tạo Pillar</button></p>' : '');
        html += '<h3>Gợi ý 4 pillar mẫu (từ đặc tả — bấm để tạo nếu muốn)</h3><div class="cards">' + PILLAR_SUGGESTIONS.map(function (s) {
          return '<div class="card"><strong>' + esc(s.name) + '</strong><br><span class="sub">' + esc(s.description) + '</span><br>' + (ed ? '<button class="btn small" data-action="pillar-suggest" data-name="' + esc(s.name) + '">Dùng gợi ý này</button>' : '') + '</div>';
        }).join('') + '</div>';
      } else {
        var pillarCounts = pillarsAll.map(function (p) { return allItems.filter(function (x) { return contentPillarId(x) === p.id; }).length; });
        var pillarMaxCnt = Math.max.apply(null, pillarCounts.concat([0]));
        html += tbl('<tr><th>Pillar</th><th>Phạm vi Brand/BU</th><th>Mô tả</th><th>Hướng dẫn phân loại & ví dụ</th><th>Số content</th><th>Trạng thái</th><th>Thao tác</th></tr>' + pillarsAll.map(function (p, pIdx) {
          var cnt = pillarCounts[pIdx];
          var bu = Store.list('businessUnits').find(function (b) { return b.id === (p.buProductId || p.bu_product_id); });
          var arch = isPillarArchived(p);
          return '<tr><td><strong>' + esc(p.name || p.title) + '</strong></td><td>' + esc(bu ? (bu.name || bu.buName) : 'Toàn workspace') + '</td><td>' + esc(p.description || '—') + '</td><td>' + esc(p.classificationGuide || p.classification_guide || '—') + '</td><td>' + (pillarMaxCnt > 0 ? vizCellBarHtml({ value: cnt, max: pillarMaxCnt, tone: 'running', text: fmtNum(cnt) + ' content (' + fmtPct(vizPct(cnt, allItems.length)) + ' tổng số)' }) : String(cnt)) + '</td><td>' + (arch ? '<span class="badge grey">Đã lưu trữ</span>' : '<span class="badge ok">Đang dùng</span>') + '</td>' +
            '<td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="pillar" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Sửa</button> ' + (arch
              ? '<button class="btn small secondary" data-action="restore-item" data-coll="contentPillars" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Khôi phục</button>'
              : '<button class="btn small secondary" data-action="archive-item" data-coll="contentPillars" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Lưu trữ</button>') + '</td></tr>';
        }).join(''), 'content-pillars');
      }
    }
    return html;
  }

  // ---------- Timeline hợp nhất (view riêng, route 'timeline') ----------
  // GỘP hai Timeline cũ làm một: Gantt tổng thể ở trang Campaigns + tab
  // Timeline ở màn Task. View dùng LẠI engine ganttHtml + cùng UI.gantt*
  // (zoom/khoảng xem/đường hôm nay/preview kéo–thả qua gantt-apply) — không
  // engine thứ hai. Hai chế độ: 'tree' (Cây campaign — hàm thuần
  // D.buildCampaignTreeTimeline, có cắt tỉa nhánh rỗng khi lọc theo
  // người/trạng thái) và 'tasks' (Chỉ task — hàm thuần D.buildTaskTimeline,
  // nhóm theo campaign/người phụ trách/không nhóm). MỘT bộ lọc chung
  // UI.timelineFilter (campaign/người phụ trách/trạng thái) cho cả hai chế
  // độ. Bấm tên/thanh mở chi tiết qua data-action gantt-open có sẵn;
  // kéo–thả khóa theo canEdit() ngay trong ganttHtml như mọi Gantt khác.
  function unscheduledHtml(list) {
    var html = '<h3>Chưa xếp lịch (' + list.length + ')</h3>';
    if (!list.length) html += '<p class="sub">Mọi task trong bộ lọc hiện tại đều đã có đủ ngày bắt đầu và mốc cần hoàn thành.</p>';
    else html += '<ul class="clean">' + list.map(function (t) {
      return '<li><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button> · ' + esc(memberName(t.assigneeId)) + ' · ' + esc(campaignName(t.campaignId)) + ' · ' + statusBadge(t.status) + ' <span class="sub">(thiếu ngày bắt đầu hoặc mốc cần hoàn thành)</span></li>';
    }).join('') + '</ul>';
    return html;
  }
  function taskTimelineHtml(tasks, edges, blockers, filter) {
    var tf = filter || UI.timelineFilter;
    var tl = D.buildTaskTimeline(tasks, {
      campaigns: visibleList('campaigns'), members: Store.list('members'), blockers: blockers, dependencies: edges,
      groupBy: UI.taskTimelineGroupBy, today: todayISO(),
      filter: { campaignId: tf.campaignId, ownerId: tf.ownerId, status: tf.status }
    });
    var groupBtn = function (id, label) {
      return '<button type="button" class="btn small ' + (UI.taskTimelineGroupBy === id ? '' : 'secondary') + '" data-action="task-timeline-group" data-id="' + id + '">' + label + '</button>';
    };
    var html = '<div data-viz="tasks-timeline"><div class="gantt-toolbar"><span class="sub">Nhóm hàng: </span>' +
      groupBtn('campaign', 'Theo campaign') + ' ' + groupBtn('assignee', 'Theo người phụ trách') + ' ' + groupBtn('none', 'Không nhóm') +
      ' <span class="sub">Đang hiển thị ' + tl.datedCount + '/' + tl.totalCount + ' task có đủ ngày để vẽ Timeline.</span></div>';
    html += ganttHtml(tl.rows, tl.edges);
    html += '</div>';
    html += unscheduledHtml(tl.unscheduled);
    return html;
  }
  function viewTimeline() {
    var edges = Store.list('dependencies');
    var blockers = Store.list('blockers');
    var tf = UI.timelineFilter;
    var html = pageHead('Timeline', 'Một Timeline chung cho mọi campaign và task: xem theo cây campaign hoặc chỉ xem task, với một bộ lọc chung.');
    html += readonlyNote() + collectionBanner('tasks');
    var modeBtn = function (id, label) {
      return '<button type="button" class="btn small ' + (UI.timelineMode === id ? '' : 'secondary') + '" data-action="timeline-mode" data-id="' + id + '">' + label + '</button>';
    };
    html += '<div class="gantt-toolbar"><span class="sub">Chế độ xem: </span>' +
      modeBtn('tree', 'Cây campaign') + ' ' + modeBtn('tasks', 'Chỉ task') + '</div>';
    html += '<details class="filter-details"' + ((typeof window !== 'undefined' && window.innerWidth && window.innerWidth > 820) ? ' open' : '') + '><summary class="filter-summary">Bộ lọc</summary><form class="inline filter-panel" id="timeline-filter-form"><span class="sub">Lọc Timeline:</span>' +
      '<label>Campaign<select name="campaignId"><option value="all">Tất cả</option><option value=""' + (tf.campaignId === '' ? ' selected' : '') + '>Không thuộc campaign</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (tf.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Người phụ trách<select name="ownerId"><option value="all">Tất cả</option>' + memberPairs().map(function (p) { return '<option value="' + esc(p[0]) + '"' + (tf.ownerId === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Trạng thái<select name="status"><option value="all">Tất cả</option>' + TASK_STATUSES.map(function (p) { return '<option value="' + p[0] + '"' + (tf.status === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn secondary" type="submit">Lọc</button>' +
      ((tf.campaignId !== 'all' || tf.ownerId !== 'all' || tf.status !== 'all') ? ' <button class="btn secondary" type="button" data-action="timeline-filter-clear">Xóa lọc</button>' : '') +
      '</form></details>';
    if (UI.timelineMode === 'tasks') {
      html += taskTimelineHtml(visibleList('tasks'), edges, blockers, tf);
      return html;
    }
    var tree = D.buildCampaignTreeTimeline(
      { campaigns: visibleList('campaigns'), phases: Store.list('phases'), activities: Store.list('activities'), tasks: Store.list('tasks'), dependencies: edges, blockers: blockers },
      { filter: tf, today: todayISO() }
    );
    html += '<div data-viz="timeline-tree"><p class="sub">Đang hiển thị ' + tree.datedCount + '/' + tree.totalCount + ' task có đủ ngày để vẽ Timeline.</p>';
    html += ganttHtml(tree.rows, tree.edges);
    html += '</div>';
    html += unscheduledHtml(tree.unscheduled);
    return html;
  }

  // ---------- Công việc ----------
  function viewTasks() {
    var allTasks = visibleList('tasks');
    var edges = Store.list('dependencies');
    var blockers = Store.list('blockers');
    var ed = canEdit();
    // R2-29.5: lọc client-side tại danh sách việc.
    var tf = UI.taskFilter;
    var openBlockerTaskIds = {};
    blockers.forEach(function (b) { if (b.status === 'open') openBlockerTaskIds[b.taskId] = true; });
    var tasks = allTasks.filter(function (t) {
      if (tf.campaignId !== 'all' && (t.campaignId || '') !== tf.campaignId) return false;
      if (tf.ownerId !== 'all' && t.assigneeId !== tf.ownerId) return false;
      if (tf.status !== 'all' && t.status !== tf.status) return false;
      if (tf.priority !== 'all' && (t.priority || 'Trung bình') !== tf.priority) return false;
      if (tf.due === 'overdue' && !isOverdue(t)) return false;
      if (tf.due === 'today' && t.dueDate !== todayISO()) return false;
      if (tf.due === 'week') { var ws = isoOf(mondayOf(new Date())); var we = addDaysISO(ws, 6); if (!t.dueDate || t.dueDate < ws || t.dueDate > we) return false; }
      if (tf.due === 'none' && t.dueDate) return false;
      if (tf.blocked === 'blocked' && !openBlockerTaskIds[t.id]) return false;
      if (tf.blocked === 'unblocked' && openBlockerTaskIds[t.id]) return false;
      if (tf.unassigned && t.assigneeId) return false;
      return true;
    });
    var html = pageHead('Task', 'Một danh sách task dùng chung ở mọi màn hình. Bấm vào tên task để mở chi tiết và sửa.',
      '<button class="btn secondary" data-action="open-timeline">Mở Timeline</button>' + (ed ? ' <button class="btn" data-action="editor-open" data-kind="task">+ Tạo task</button>' : ''));
    html += readonlyNote() + collectionBanner('tasks');
    html += '<details class="filter-details"' + ((typeof window !== 'undefined' && window.innerWidth && window.innerWidth > 820) ? ' open' : '') + '><summary class="filter-summary">Bộ lọc</summary><form class="inline filter-panel" id="task-filter-form"><span class="sub">Lọc task:</span>' +
      '<label>Campaign<select name="campaignId"><option value="all">Tất cả</option><option value=""' + (tf.campaignId === '' ? ' selected' : '') + '>Task độc lập</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (tf.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Người phụ trách<select name="ownerId"><option value="all">Tất cả</option>' + memberPairs().map(function (p) { return '<option value="' + esc(p[0]) + '"' + (tf.ownerId === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Trạng thái<select name="status"><option value="all">Tất cả</option>' + TASK_STATUSES.map(function (p) { return '<option value="' + p[0] + '"' + (tf.status === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Ưu tiên<select name="priority"><option value="all">Tất cả</option>' + PRIORITIES.map(function (p) { return '<option value="' + esc(p) + '"' + (tf.priority === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></label>' +
      '<label>Hạn<select name="due"><option value="all">Tất cả</option>' + [['overdue', 'Quá hạn'], ['today', 'Đến hạn hôm nay'], ['week', 'Tuần này'], ['none', 'Chưa xếp lịch']].map(function (p) { return '<option value="' + p[0] + '"' + (tf.due === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Bị chặn<select name="blocked"><option value="all">Tất cả</option><option value="blocked"' + (tf.blocked === 'blocked' ? ' selected' : '') + '>Đang bị chặn</option><option value="unblocked"' + (tf.blocked === 'unblocked' ? ' selected' : '') + '>Không bị chặn</option></select></label>' +
      '<label><span><input type="checkbox" name="unassigned"' + (tf.unassigned ? ' checked' : '') + '> Chỉ task chưa phân công</span></label>' +
      '<button class="btn secondary" type="submit">Lọc</button></form></details>' +
      '<p class="sub">Đang hiển thị ' + tasks.length + '/' + allTasks.length + ' task.</p>';
    if (!tasks.length && !collLoadingOrError('tasks')) {
      html += emptyState('Chưa có task nào', 'Tạo task đầu tiên — task có thể gắn với campaign hoặc để độc lập.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="task">+ Tạo task</button></p>' : '');
    } else {
      var roots = tasks.filter(function (t) { return !t.parentId; });
      function row(t, depth) {
        var waitingFor = edges.filter(function (e) { return e.successorId === t.id; }).map(function (e) { var x = taskById(e.predecessorId); return x ? x.title : e.predecessorId; });
        var blockingOthers = edges.filter(function (e) { return e.predecessorId === t.id; }).map(function (e) { var x = taskById(e.successorId); return x ? x.title : e.successorId; });
        var myBlockers = blockers.filter(function (b) { return b.taskId === t.id && b.status === 'open'; });
        var opts = TASK_STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (t.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('');
        // R2-30.4: select trạng thái theo quyền task.updateStatus; tooltip chỉ
        // gắn đúng tình trạng quyền (chỉ-đổi-trạng-thái / chỉ xem).
        var stDisabled = !canUpdateTaskStatus();
        var stTitle = stDisabled ? noEditTitle(true) : (!canEditTask() ? statusOnlyTitle(true) : '');
        var tlTone = isCompletedTask(t) ? 'done' : (isOverdue(t) ? 'overdue' : (t.startDate || t.dueDate ? 'running' : 'todo'));
        return '<tr><td style="padding-left:' + (10 + depth * 22) + 'px">' + (depth ? '↳ ' : '') + '<button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button>' + checklistBadgeHtml(t) + (myBlockers.length ? '<br>' + vizStatusPillHtml('blocked', { label: 'Bị chặn: ' + myBlockers[0].title, derived: true }) : '') + '</td>' +
          '<td>' + esc(memberName(t.assigneeId)) + '</td><td>' + esc(campaignName(t.campaignId)) + '</td>' +
          '<td>' + ((t.startDate || t.dueDate) ? vizTaskBarHtml({ start: t.startDate, due: t.dueDate, today: todayISO(), tone: tlTone, startLabel: t.startDate ? D.formatDateVN(t.startDate) : '—', dueLabel: t.dueDate ? D.formatDateVN(t.dueDate) : 'Chưa xếp lịch' }) : '<span class="sub">Chưa xếp lịch</span>') + (isOverdue(t) ? ' ' + vizStatusPillHtml('overdue', { label: 'Quá hạn', derived: true }) + '' : '') + '</td>' +
          '<td>' + (t.effortHours ? esc(t.effortHours) + ' giờ' : '<span class="badge warn">Chưa ước tính</span>') + '</td>' +
          '<td>' + vizDepBadgesHtml({ waitingCount: waitingFor.length, blockingCount: blockingOthers.length, waitingTitles: waitingFor, blockingTitles: blockingOthers }) + (waitingFor.length ? '' : '<br>' + readinessBadge(t)) + '</td>' +
          '<td><select data-action-change="task-status" data-id="' + esc(t.id) + '"' + dis(stDisabled) + stTitle + '>' + opts + '</select></td></tr>' +
          tasks.filter(function (x) { return x.parentId === t.id; }).map(function (ch) { return row(ch, depth + 1); }).join('');
      }
      html += tbl('<tr><th>Task</th><th>Người phụ trách</th><th>Campaign</th><th>Thời gian</th><th>Dự kiến</th><th>Phụ thuộc</th><th>Trạng thái</th></tr>' + roots.map(function (t) { return row(t, 0); }).join(''), 'tasks-main');
    }
    html += '<h2>Thêm quan hệ phụ thuộc</h2><form class="inline" id="dep-add-form">' +
      '<label>Task phải xong trước<select name="predecessorId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Task đang chờ<select name="successorId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn secondary" type="submit"' + dis(!ed) + '>Thêm phụ thuộc</button></form>' +
      '<p class="sub">Hệ thống chặn quan hệ tạo vòng phụ thuộc.</p>';
    html += '<h2>Trở ngại</h2>';
    if (!blockers.length) html += '<p class="sub">Chưa có trở ngại nào.</p>';
    else html += tbl('<tr><th>Trở ngại</th><th>Task</th><th>Mô tả</th><th>Trạng thái</th><th></th></tr>' + blockers.map(function (b) {
      var t = taskById(b.taskId);
      return '<tr><td>' + esc(b.title) + (b.status === 'open' ? '<br>' + vizStatusPillHtml('blocked', { label: 'Bị chặn', derived: true }) : '') + '</td><td>' + esc(t ? t.title : '—') + '</td><td>' + esc(b.description || '') + '</td><td>' + vizStatusPillHtml(b.status, { context: 'blocker', label: labelStatus(b.status) }) + '</td><td>' + (b.status === 'open' ? '<button class="btn small secondary" data-action="resolve-blocker" data-id="' + esc(b.id) + '">Đánh dấu đã gỡ</button>' : '') + '</td></tr>';
    }).join(''), 'tasks-blockers');
    html += '<form class="inline" id="blocker-add-form"><label>Task<select name="taskId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Tên trở ngại<input type="text" name="title" required></label><label>Mô tả<input type="text" name="description"></label>' +
      '<button class="btn" type="submit"' + dis(!ed) + '>Tạo trở ngại</button></form>';
    var reqs = Store.list('marketingRequests');
    html += '<h2>Yêu cầu Marketing</h2>';
    if (reqs.length) {
      // WAVE-B4: dải KPI + tỉ trọng theo trạng thái/ưu tiên — số đếm tại view
      // trên đúng tập reqs đang hiển thị (đếm hiển thị, không phải công thức).
      var reqByStatus = {}, reqByPri = {};
      reqs.forEach(function (r) {
        var sk = String(r.status || 'new'); reqByStatus[sk] = (reqByStatus[sk] || 0) + 1;
        var pk = String(r.priority || 'Trung bình'); reqByPri[pk] = (reqByPri[pk] || 0) + 1;
      });
      var reqStatusSegs = Object.keys(reqByStatus).map(function (k) { return { label: labelStatus(k), value: reqByStatus[k], tone: vizStatusTone(k) }; });
      var priTone = { 'Cao': 'overdue', 'Trung bình': 'pending', 'Thấp': 'todo' };
      var reqPriSegs = Object.keys(reqByPri).map(function (k) { return { label: 'Ưu tiên ' + k, value: reqByPri[k], tone: priTone[k] || 'neutral' }; });
      html += '<div class="cards" data-viz="requests-kpi-strip">' +
        vizKpiCardHtml({ label: 'Tổng yêu cầu', valueText: String(reqs.length), tone: 'running', toneLabel: 'Đang theo dõi' }) +
        vizKpiCardHtml({ label: 'Mới ghi nhận', valueText: String(reqByStatus['new'] || 0), tone: 'neutral', toneLabel: 'Mới' }) +
        vizKpiCardHtml({ label: 'Ưu tiên cao', valueText: String(reqByPri['Cao'] || 0), tone: 'overdue', toneLabel: 'Cao' }) + '</div>';
      html += '<h3>Tỉ trọng yêu cầu theo trạng thái</h3><div data-viz="requests-status-chart">' + vizStackedBarHtml({ segments: reqStatusSegs, total: reqs.length, unitLabel: 'yêu cầu' }) + '</div>';
      html += '<h3>Tỉ trọng yêu cầu theo ưu tiên</h3><div data-viz="requests-priority-chart">' + vizStackedBarHtml({ segments: reqPriSegs, total: reqs.length, unitLabel: 'yêu cầu' }) + '</div>';
    }
    if (!reqs.length) html += '<div class="state-box">Chưa có yêu cầu nào được ghi nhận.</div>';
    else html += tbl('<tr><th>Yêu cầu</th><th>Người yêu cầu</th><th>Campaign liên quan</th><th>Ưu tiên</th><th>Hạn mong muốn</th><th>Trạng thái</th><th>Thao tác</th></tr>' + reqs.map(function (r) {
      var convertedTask = Store.list('tasks').find(function (t) { return cfVal(t, 'marketingRequestId') === r.id; });
      var acts = '';
      if (ed && r.status !== 'converted' && r.status !== 'rejected') {
        acts = '<button class="btn small" data-action="request-accept" data-id="' + esc(r.id) + '">Nhận xử lý</button> ' +
          '<button class="btn small secondary" data-action="request-convert" data-id="' + esc(r.id) + '"' + dis(!!convertedTask) + '>' + (convertedTask ? 'Đã thành task' : 'Chuyển thành task') + '</button> ' +
          '<button class="btn small secondary" data-action="request-reject" data-id="' + esc(r.id) + '">Từ chối</button>' +
          '<form class="inline compact" data-form="request-due" data-id="' + esc(r.id) + '"><input type="date" name="dueDate" value="' + esc(r.dueDate ? String(r.dueDate).slice(0, 10) : '') + '"><button class="btn small secondary" type="submit">Đổi hạn</button></form>';
      } else if (convertedTask) acts = '<span class="sub">Đã chuyển thành task: ' + esc(convertedTask.title) + '</span>';
      if (r.status === 'rejected' && r.rejectionReason) acts += '<span class="sub">Lý do từ chối: ' + esc(r.rejectionReason) + '</span>';
      var reqPriTone = { 'Cao': 'overdue', 'Trung bình': 'pending', 'Thấp': 'todo' }[r.priority] || 'neutral';
      return '<tr><td><strong>' + esc(r.title) + '</strong>' + (r.note ? '<br><span class="sub">' + esc(r.note) + '</span>' : '') + '</td><td>' + esc(r.requester) + '</td><td>' + (r.campaignId ? esc(campaignName(r.campaignId)) : '—') + '</td><td>' + (r.priority ? vizStatusPillHtml('', { tone: reqPriTone, label: r.priority }) : '—') + '</td><td>' + (r.dueDate ? esc(D.formatDateVN(r.dueDate)) : '—') + '</td><td>' + statusBadge(r.status, r.statusLabel) + (r.assigneeId ? '<br><span class="sub">Người xử lý: ' + esc(memberName(r.assigneeId)) + '</span>' : '') + '</td><td class="row-actions">' + acts + '</td></tr>';
    }).join(''), 'tasks-requests');
    html += '<form class="inline" id="request-add-form"><label>Tiêu đề yêu cầu<input type="text" name="title" required></label>' +
      '<label>Người / đội yêu cầu<input type="text" name="requester" required></label>' +
      '<label>Campaign<select name="campaignId"><option value="">— Chưa gắn —</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Ưu tiên<select name="priority"><option>Thấp</option><option selected>Trung bình</option><option>Cao</option></select></label>' +
      '<label>Hạn mong muốn<input type="date" name="dueDate"></label>' +
      '<button class="btn" type="submit"' + dis(!ed) + '>Ghi nhận yêu cầu</button></form>';
    return html;
  }

  // ---------- Duyệt nội dung ----------
  function approvalSnapshotHtml(a) {
    var v = Store.get('variants', a.variantId);
    var rev = revisionRecordFor(a);
    // R2-15: CHỈ đọc snapshot của revision đã đóng băng — tuyệt đối không
    // fallback sang nội dung hiện tại của variant. Field không có trong
    // snapshot thì ghi rõ "không có trong bản đóng băng".
    var snap = (rev && (rev.snapshot || rev)) || null;
    var MISSING = '— (không có trong bản đóng băng)';
    function snapField(name) {
      if (!snap) return MISSING;
      var val = snap[name];
      return (val === null || val === undefined || val === '') ? MISSING : val;
    }
    var html = '<div class="snapshot-box"><p class="sub">Đây là đúng bản content đang chờ duyệt — phiên bản content số ' + esc(a.revision) + '. Quyết định sẽ gắn với phiên bản này.</p>';
    if (!snap) html += '<div class="notice warn">Chưa có bản đóng băng (snapshot) cho phiên bản này — không hiển thị content hiện tại để tránh duyệt nhầm bản đã sửa.</div>';
    if (v) {
      html += '<p><strong>Kênh:</strong> ' + esc(v.channelLabel || labelStatus(v.platform)) + ' · <strong>Content:</strong> ' + esc(contentTitle(a.contentItemId || v.contentItemId)) + '</p>';
      html += '<p><strong>Caption:</strong> ' + esc(snapField('caption')) + '</p>';
      html += '<p><strong>Hashtag:</strong> ' + esc(snapField('hashtags')) + '</p>';
      var scenes = snap ? (snap.scriptScenes || snap.scenes || []) : [];
      html += '<p><strong>Hook:</strong> ' + esc(snapField('hook')) + '</p><p><strong>CTA:</strong> ' + esc(snapField('cta')) + '</p>';
      if (scenes.length) html += '<div class="table-wrap"><table class="scene-table"><tr><th>Cảnh</th><th>Hình ảnh</th><th>Lời thoại</th><th>Chữ trên màn hình</th><th>Thời lượng (giây)</th></tr>' +
        scenes.map(function (s) { return '<tr><td>' + esc(s.shot) + '</td><td>' + esc(s.visual) + '</td><td>' + esc(s.dialogue) + '</td><td>' + esc(s.onScreenText) + '</td><td>' + esc(s.durationSec) + '</td></tr>'; }).join('') + '</table></div>';
      else html += '<p><strong>Kịch bản theo cảnh:</strong> ' + MISSING + '</p>';
      html += '<p><strong>Kịch bản:</strong> ' + esc(snapField('script')) + '</p>';
      var media = snap ? (snap.mediaUrl || snap.linkUrl || '') : '';
      html += '<p><strong>File đính kèm:</strong> ' + (media ? '<a href="' + esc(media) + '" target="_blank" rel="noopener">' + esc(media) + '</a>' : MISSING) + '</p>';
      html += '<p class="sub">Lịch đăng dự kiến: ' + esc(D.formatDateTimeVN(v.scheduledAt)) + ' · Người sản xuất: ' + esc(memberName(v.ownerId)) + '</p>';
    } else html += '<p class="sub">Không tìm thấy phiên bản content tương ứng.</p>';
    return html + '</div>';
  }
  function viewApprovals() {
    var approvals = Store.list('approvals');
    var me = Store.currentUser();
    var allPending = approvals.filter(function (a) { return a.status === 'pending' || a.status === 'needs_reapproval'; });
    var minePending = allPending.filter(function (a) { return isWaitingForMe(a, me); });
    var pending = UI.approvalsTab === 'mine' ? minePending : allPending;
    var done = approvals.filter(function (a) { return a.status !== 'pending' && a.status !== 'needs_reapproval'; });
    var ok = canApprove();
    var html = pageHead('Duyệt content', 'Hộp thư chờ mình duyệt: xem đúng bản content được gửi, rồi duyệt / yêu cầu sửa / từ chối kèm nhận xét. Việc sửa content làm ở mục Content, không sửa tại màn duyệt.');
    if (!ok) html += '<div class="notice warn">Vai trò hiện tại (' + esc(labelStatus(Store.currentRole())) + ') không có quyền duyệt — các nút quyết định bị khóa.' + (Store.mode === 'demo' ? ' Đổi sang Owner/Lead ở thanh trên (Chế độ demo) để thử duyệt.' : '') + '</div>';
    html += collectionBanner('approvals');
    // WAVE-B4: dải hàng đợi — số chờ theo tab + tuổi chờ lâu nhất (từ mốc
    // gửi duyệt sẵn có requestedAt; thiếu thì lùi createdAt/created_at).
    function approvalWaitDays(a) {
      var raw = a.requestedAt || a.createdAt || a.created_at || '';
      if (!raw) return null;
      return vizDayDiff(String(raw).slice(0, 10), todayISO());
    }
    var oldestPending = null, oldestDays = null;
    allPending.forEach(function (a) { var d = approvalWaitDays(a); if (d !== null && (oldestDays === null || d > oldestDays)) { oldestDays = d; oldestPending = a; } });
    html += '<div class="cards" data-viz="approval-queue-strip">' +
      vizKpiCardHtml({ label: 'Chờ mình duyệt', valueText: String(minePending.length), tone: 'pending', toneLabel: 'Chờ duyệt' }) +
      vizKpiCardHtml({ label: 'Tất cả đang chờ', valueText: String(allPending.length), tone: 'pending', toneLabel: 'Đang chờ' }) +
      vizKpiCardHtml({ label: 'Đã quyết định', valueText: String(done.length), tone: 'done', toneLabel: 'Đã xong' }) +
      vizKpiCardHtml({ label: 'Chờ lâu nhất', valueText: oldestDays === null ? '—' : (oldestDays + ' ngày'), tone: (oldestDays !== null && oldestDays >= 3) ? 'overdue' : 'pending', toneLabel: oldestDays === null ? 'Không có' : 'Tuổi chờ', sub: oldestPending ? contentTitle(oldestPending.contentItemId) : '' }) + '</div>';
    if (allPending.length || done.length) {
      html += '<h3>Tỉ trọng hàng đợi duyệt</h3><div data-viz="approval-queue-chart">' + vizStackedBarHtml({ segments: [
        { label: 'Chờ mình duyệt', value: minePending.length, tone: 'pending' },
        { label: 'Chờ người khác', value: Math.max(0, allPending.length - minePending.length), tone: 'todo' },
        { label: 'Đã quyết định', value: done.length, tone: 'done' }
      ], total: approvals.length, unitLabel: 'yêu cầu duyệt' }) + '</div>';
    }
    html += tabsHtml([['mine', 'Chờ mình duyệt (' + minePending.length + ')'], ['all', 'Tất cả đang chờ (' + allPending.length + ')']], UI.approvalsTab, 'approvals-tab');
    html += '<h2>' + (UI.approvalsTab === 'mine' ? 'Chờ mình duyệt' : 'Tất cả đang chờ') + ' (' + pending.length + ')</h2>';
    if (!pending.length && !collLoadingOrError('approvals')) html += '<div class="state-box">Không có content nào chờ duyệt. Khi thành viên bấm "Gửi duyệt" ở mục Content, bản content sẽ xuất hiện tại đây.</div>';
    pending.forEach(function (a) {
      var waitDays = approvalWaitDays(a);
      html += '<div class="panel"><strong>' + esc(contentTitle(a.contentItemId)) + '</strong> — yêu cầu bởi ' + esc(memberName(a.requestedBy)) + ' lúc ' + esc(D.formatDateTimeVN(a.requestedAt)) +
        (waitDays !== null ? ' ' + vizStatusPillHtml('', { tone: waitDays >= 3 ? 'overdue' : 'pending', label: waitDays === 0 ? 'Chờ hôm nay' : 'Đã chờ ' + waitDays + ' ngày', derived: true }) : '') +
        approvalSnapshotHtml(a) +
        '<label class="fld wide">Nhận xét khi quyết định<textarea id="approve-note-' + esc(a.id) + '" rows="2" placeholder="Nhận xét (bắt buộc khi yêu cầu sửa / từ chối)">' + esc(UI.approveComment[a.id] || '') + '</textarea></label>' +
        '<p><button class="btn" data-action="decide" data-decision="approved" data-id="' + esc(a.id) + '"' + dis(!ok) + '>Duyệt</button> ' +
        '<button class="btn secondary" data-action="decide" data-decision="changes_requested" data-id="' + esc(a.id) + '"' + dis(!ok) + '>Yêu cầu sửa</button> ' +
        '<button class="btn secondary" data-action="decide" data-decision="rejected" data-id="' + esc(a.id) + '"' + dis(!ok) + '>Từ chối</button></p></div>';
    });
    // 0014: hàng đợi "Ngân sách" — cùng màn Requests/Duyệt với duyệt nội dung,
    // liệt kê Store.budgetProposals (đối tượng, Hiện tại → Đề xuất + chênh lệch,
    // người đề xuất, lý do, pill trạng thái đúng hệ màu; Owner quyết tại chỗ).
    html += budgetProposalsQueueHtml();
    html += '<h2>Dòng thời gian quyết định (' + done.length + ')</h2>';
    if (!done.length) html += '<p class="sub">Chưa có quyết định nào.</p>';
    else html += tbl('<tr><th>Content</th><th>Phiên bản content</th><th>Quyết định</th><th>Người duyệt</th><th>Thời điểm</th><th>Thời gian chờ</th><th>Nhận xét</th></tr>' + done.map(function (a) {
      var waited = (a.requestedAt && a.decidedAt) ? vizDayDiff(String(a.requestedAt).slice(0, 10), String(a.decidedAt).slice(0, 10)) : null;
      return '<tr><td>' + esc(contentTitle(a.contentItemId)) + '</td><td>Số ' + esc(a.revision) + '</td><td>' + vizStatusPillHtml(a.status, { label: a.statusLabel }) + '</td><td>' + esc(memberName(a.decidedBy)) + '</td><td>' + esc(D.formatDateTimeVN(a.decidedAt)) + '</td><td>' + (waited === null ? '—' : (waited === 0 ? 'Trong ngày' : waited + ' ngày')) + '</td><td>' + esc(a.note || '') + '</td></tr>';
    }).join(''), 'approvals-decisions');
    return html;
  }

  // ---------- Team & Workload ----------
  function viewTeam() {
    var members = Store.list('members');
    var tasks = visibleList('tasks');
    var holidays = Store.holidays || [];
    var weekStart = UI.teamWeek, weekEnd = addDaysISO(weekStart, 6);
    var ed = canEdit();
    var html = pageHead('Team & Workload', 'Tải task theo tuần đã chọn. Chỉ tính task chi tiết (task cha có task con không bị tính trùng) và chỉ phần effort rơi trong tuần này.');
    html += '<form class="inline" id="team-week-form"><label>Tuần bắt đầu từ (thứ Hai)<input type="date" id="team-week-input" value="' + esc(weekStart) + '"></label><button class="btn secondary" type="submit">Xem tuần</button> <button class="btn secondary" type="button" data-action="team-week-now">Tuần hiện tại</button></form>';
    html += '<p class="sub">Tuần đang xem: ' + esc(D.formatDateVN(weekStart)) + ' — ' + esc(D.formatDateVN(weekEnd)) + '. Ngày nghỉ chung: ' + (holidays.length ? holidays.map(function (h) { return D.formatDateVN(h); }).join(', ') : '—') + '</p>';
    html += collectionBanner('members');
    // R3.1/R3-09: capacity lấy từ Store.capacityByMember() — member chưa
    // cấu hình thì capacity = null và hiển thị "Chưa cấu hình", TUYỆT ĐỐI
    // không hiển thị số giờ mặc định bịa (vd 40h).
    var capMap = hasFn('capacityByMember') ? Store.capacityByMember() : {};
    html += tbl('<tr><th>Thành viên</th><th>Vai trò</th><th>Năng lực (giờ/tuần)</th><th>Ngày nghỉ riêng</th><th>Effort trong tuần này</th><th>Chi tiết theo ngày</th><th>Cảnh báo</th><th>Thao tác</th></tr>' +
      members.map(function (m) {
        var capCfg = capMap[m.id] || null;
        var mDaysOff = capCfg ? (capCfg.daysOff || []) : (m.daysOff || []);
        var leaves = tasks.filter(function (t) {
          return t.assigneeId === m.id && !isCompletedTask(t) && String(t.status).toLowerCase() !== 'cancelled' &&
            !tasks.some(function (x) { return x.parentId === t.id; });
        });
        var unestimated = [];
        var perDay = {};
        leaves.forEach(function (t) {
          var dist = D.distributeEffort(t, holidays.concat(mDaysOff || []));
          if (!Array.isArray(dist)) { unestimated.push(t); return; }
          dist.forEach(function (d) { if (d.date >= weekStart && d.date <= weekEnd) perDay[d.date] = (perDay[d.date] || 0) + d.hours; });
        });
        var total = Object.keys(perDay).reduce(function (s, k) { return s + perDay[k]; }, 0);
        var cap = capCfg ? capCfg.hoursPerWeek : null;
        var warn = [];
        if (cap !== null && cap !== undefined && total > cap) warn.push('Tổng ' + fmtNum(total) + ' giờ vượt năng lực ' + cap + ' giờ trong tuần này');
        Object.keys(perDay).forEach(function (date) { if (perDay[date] > 8) warn.push('Ngày ' + D.formatDateVN(date) + ': ' + fmtNum(perDay[date]) + ' giờ (quá 8 giờ/ngày)'); });
        return '<tr><td><strong>' + esc(m.name) + '</strong>' + (m.isActive === false ? ' ' + vizStatusPillHtml('', { tone: 'cancelled', label: 'Ngừng hoạt động' }) : '') + '</td><td>' + esc(m.roleLabel || labelStatus(m.role)) + '</td><td>' + (cap !== null && cap !== undefined ? esc(cap) + ' giờ/tuần' : vizStatusPillHtml('pending', { label: 'Chưa cấu hình' })) + '</td>' +
          '<td>' + ((mDaysOff || []).length ? mDaysOff.map(function (x) { return D.formatDateVN(x); }).join(', ') : '—') + '</td>' +
          '<td>' + fmtNum(total) + ' giờ' + vizWorkloadBarHtml({ hours: total, capacityHours: cap, overCapacity: (cap !== null && cap !== undefined && total > cap) }) + (unestimated.length ? '<br>' + unestimated.map(function (t) { return vizStatusPillHtml('', { tone: 'pending', label: t.title + ': Chưa ước tính' }); }).join(' ') : '') + '</td>' +
          '<td>' + (Object.keys(perDay).length ? vizMiniDayBarsHtml({ days: Object.keys(perDay).sort().map(function (date) { return { label: String(D.formatDateVN(date)).slice(0, 5), hours: perDay[date], title: D.formatDateVN(date) + ': ' + fmtNum(perDay[date]) + ' giờ' }; }) }) + '<span class="sub">' + Object.keys(perDay).sort().map(function (date) { return D.formatDateVN(date) + ': ' + fmtNum(perDay[date]) + 'h'; }).join(' · ') + '</span>' : '<span class="sub">—</span>') + '</td>' +
          '<td>' + (warn.length ? warn.map(function (w) { return vizStatusPillHtml('overdue', { label: w, derived: true }); }).join(' ') : vizStatusPillHtml('done', { label: 'Ổn' })) + '</td>' +
          '<td><button class="btn small secondary" data-action="editor-open" data-kind="memberCap" data-member="' + esc(m.id) + '"' + dis(!canSettings()) + '>Đặt năng lực / ngày nghỉ</button></td></tr>';
      }).join(''), 'team-workload');
    html += '<p class="sub">Task thiếu effort hiển thị "Chưa ước tính" và không tính vào effort đã phân bổ.</p>';
    return html;
  }

  // ---------- KPI & Ngân sách ----------
  function viewKpi() {
    var ed = canEdit();
    var budgetEd = canBudgetChange();
    var html = pageHead('KPI & Ngân sách', 'KPI theo mục tiêu/thực đạt/nguồn/thời điểm; ngân sách theo Kế hoạch / Đã duyệt / Đã chi / Cam kết chưa trả / Còn lại.',
      (ed ? '<button class="btn" data-action="editor-open" data-kind="kpi">+ Tạo KPI</button> ' : '') + (budgetEd ? '<button class="btn secondary" data-action="editor-open" data-kind="budgetLine">+ Tạo dòng ngân sách</button>' : '') + (can('budget.propose') ? ' <button type="button" class="btn secondary" data-action="editor-open" data-kind="budgetProposal">Đề xuất ngân sách</button>' : ''));
    html += readonlyNote();
    html += collectionBanner('kpis');
    html += '<nav class="inpage-nav" aria-label="Mục trong trang KPI & Ngân sách"><a href="#/kpi" data-kpi-anchor="kpi">KPI</a><a href="#/kpi" data-kpi-anchor="budget">Ngân sách</a><a href="#/kpi" data-kpi-anchor="cash">Thu–Chi</a></nav>';
    html += '<h2 id="kpi-sec-kpi">KPI</h2>';
    // AC22: export KPI của đúng tập đang hiển thị ở trang này (kèm IDs, scope, kỳ, đơn vị).
    html += '<p><button class="btn secondary" data-action="export-kpi-csv">Xuất CSV KPI (IDs, scope, kỳ, đơn vị)</button></p>';
    var kpis = Store.list('kpis');
    var measurements = [];
    try { measurements = Store.list('measurements'); } catch (e) { measurements = []; }
    if (!kpis.length && !collLoadingOrError('kpis')) html += emptyState('Chưa có KPI nào', 'Tạo KPI đầu tiên và cập nhật số đo kèm nguồn để theo dõi thực đạt.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="kpi">+ Tạo KPI</button></p>' : '');
    // R3.1-VIZ 5: bảng so sánh KPI dạng thanh tỉ lệ (actual vs target, số qua
    // rollupKpi) ngay trên bảng chi tiết.
    else html += '<h3>Biểu đồ so sánh KPI — thực đạt / mục tiêu</h3><div data-viz="kpi-page-chart">' + vizKpiProgressHtml(kpis) + '</div>' + tbl('<tr><th>KPI</th><th>Campaign</th><th>Định nghĩa / kỳ</th><th>Mục tiêu</th><th>Thực đạt</th><th>Nguồn số liệu</th><th>Cập nhật</th><th>Thao tác</th></tr>' + kpis.map(function (k) {
      var d = D.kpiDisplay(k);
      var roll = kpiRollupFor(k);
      var contribs = listSafe('kpiContributions').filter(function (x) { return x.kpiId === k.id; });
      var hist = measurements.filter(function (m) { return m.kpiId === k.id || m.kpi_id === k.id; });
      var periodText = (k.periodStart || k.periodEnd)
        ? (D.formatDateVN(k.periodStart) || '…') + ' — ' + (D.formatDateVN(k.periodEnd) || '…')
        : (k.period || '');
      var defText = (k.definition === null || k.definition === undefined) ? '—' : (typeof k.definition === 'string' ? k.definition : (k.definition.description || k.definition.how || '—'));
      var actualCell;
      if (roll && roll.status === 'insufficient_data') actualCell = '<span class="badge warn">Chưa đủ dữ liệu</span>';
      else if (roll && roll.value !== null && roll.value !== undefined) actualCell = fmtNum(String(k.aggregationMode || '').toLowerCase() === 'ratio' ? Math.round(roll.value) : roll.value) + ' ' + esc(k.unit || '') + (roll.achievementPercent !== null && roll.achievementPercent !== undefined ? '<br><span class="sub">Mức đạt: ' + fmtNum(roll.achievementPercent) + '%</span>' : '');
      else actualCell = d.isMissing ? '<span class="badge warn">Chưa cập nhật</span>' : fmtNum(d.value) + ' ' + esc(k.unit || '');
      var kAuto = isKpiAuto(k);
      var kAutoAa = k.autoActual || k.auto_actual || null;
      var kUpdatedAt = kAuto && kAutoAa && kAutoAa.latestObservedAt ? kAutoAa.latestObservedAt : k.updatedAt;
      var main = '<tr><td><strong>' + esc(k.name) + '</strong>' + (k.metricCode ? '<br><span class="sub">' + esc(k.metricCode) + ' · ' + esc(k.aggregationMode || 'direct') + '</span>' : '') + (kAuto ? '<br>' + kpiAutoInfoHtml(k) : '') + '</td><td>' + esc(campaignName(k.campaignId)) + '<br><span class="sub">' + esc(kpiScopeLabel(k)) + '</span></td><td>' + esc(defText) + (periodText ? '<br><span class="sub">Kỳ: ' + esc(periodText) + '</span>' : '') + '</td><td>' + fmtNum(k.target) + ' ' + esc(k.unit || '') + '</td><td>' + actualCell + '</td><td>' + (kAuto ? 'Tự động từ post' : esc(k.source || '—')) + '</td><td>' + (kUpdatedAt ? esc(D.formatDateTimeVN(kUpdatedAt)) : '—') + '</td>' +
        '<td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="measurement" data-kpi="' + esc(k.id) + '"' + dis(!ed || kAuto) + (kAuto ? ' title="KPI này lấy số tự động từ post — số sẽ cập nhật khi bộ đếm của post thay đổi."' : '') + '>+ Thêm số đo</button> <button class="btn small secondary" data-action="editor-open" data-kind="kpi" data-id="' + esc(k.id) + '"' + dis(!ed) + '>Sửa KPI</button>' + (kAuto ? ' <button class="btn small secondary" data-action="kpi-drill" data-id="' + esc(k.id) + '">' + (UI.kpiOpenId === k.id ? 'Ẩn post cấu thành' : 'Xem post cấu thành') + '</button>' : '') + '</td></tr>';
      if (kAuto && UI.kpiOpenId === k.id) {
        main += '<tr class="detail-row"><td colspan="8">' + kpiAutoDrillHtml(k) + '</td></tr>';
      }
      if (contribs.length) {
        main += '<tr class="detail-row"><td colspan="8"><strong>Roll-up từ ' + contribs.length + ' KPI nguồn</strong> (phạm vi: ' + esc(kpiScopeLabel(k)) + '): ' + (roll && roll.status === 'insufficient_data' ? '<span class="badge warn">Chưa đủ dữ liệu</span> — thiếu khóa định danh/nguồn hợp lệ nên không tuyên bố tổng đã khử trùng.' : 'giá trị ' + fmtNum(roll ? roll.value : null) + ' ' + esc(k.unit || '') + (roll && roll.achievementPercent !== null && roll.achievementPercent !== undefined ? ' · mức đạt ' + fmtNum(roll.achievementPercent) + '%' : '')) + '</td></tr>';
      }
      if (hist.length) main += '<tr class="detail-row"><td colspan="8"><strong>Lịch sử số đo:</strong> ' + hist.map(function (m) { return fmtNum(m.value) + ' (' + esc(m.source || '—') + ', ' + esc(D.formatDateTimeVN(m.measuredAt || m.measured_at)) + ')'; }).join(' · ') + '</td></tr>';
      return main;
    }).join(''), 'kpi-main');
    html += '<h2 id="kpi-sec-budget">Ngân sách theo từng tiền tệ (không cộng khác tiền tệ)</h2>';
    // R2-30.5: vai không có quyền xem ngân sách (vd CEO) → ẨN hẳn khối số
    // ngân sách chi tiết, chỉ hiện thông báo.
    if (!canBudget()) {
      html += '<div class="notice info">Vai trò hiện tại không có quyền xem số liệu ngân sách chi tiết nên phần này được ẩn. KPI ở trên vẫn xem được bình thường.</div>';
      return html;
    }
    // AC22: export ngân sách — chỉ tới được đây khi vai có quyền xem ngân sách (cùng cổng với khối số ở dưới).
    html += '<p><button class="btn secondary" data-action="export-budget-csv">Xuất CSV ngân sách (dòng + fact + tổng hợp theo scope)</button></p>';
    var linesAll = visibleList('budgetLines');
    var allCommits = Store.list('commitments');
    var allActuals = Store.list('actuals');
    if (!linesAll.length) html += emptyState('Chưa có dòng ngân sách nào', 'Tạo dòng ngân sách cho campaign, sau đó ghi cam kết và khoản chi thực tế ngay tại đây.', budgetEd ? '<p><button class="btn" data-action="editor-open" data-kind="budgetLine">+ Tạo dòng ngân sách</button></p>' : '');
    var currencies = [];
    linesAll.forEach(function (b) { if (currencies.indexOf(b.currency) === -1) currencies.push(b.currency); });
    // R3.1-VIZ 5: biểu đồ so sánh ngân sách theo campaign VÀ theo hoạt động
    // (số qua summarizeBudgetScope) — bảng chi tiết theo tiền tệ ở ngay dưới.
    if (linesAll.length) {
      var cmpGroups = [];
      visibleList('campaigns').forEach(function (c2) {
        summarizeCampaignBudget(c2).forEach(function (r) {
          if (r.allocated > 0 || r.actualTotal > 0 || r.openCommitments > 0) cmpGroups.push({ title: 'Campaign: ' + c2.name + ' (' + r.currency + ')', currency: r.currency, bars: vizBudgetBars(r.allocated, r.actualTotal, r.openCommitments) });
        });
        Store.list('activities').filter(function (a) { return a.campaignId === c2.id; }).forEach(function (a) {
          summarizeActivityBudget(c2, a).forEach(function (r) {
            if (r.ceiling > 0 || r.actualTotal > 0 || r.openCommitments > 0) cmpGroups.push({ title: 'Activity: ' + a.name + ' — ' + c2.name + ' (' + r.currency + ')', currency: r.currency, bars: vizBudgetBars(r.ceiling, r.actualTotal, r.openCommitments) });
          });
        });
      });
      if (cmpGroups.length) html += '<h3>Biểu đồ so sánh ngân sách theo campaign và activity</h3><div data-viz="kpi-page-budget-chart">' + vizBudgetGroupsChartHtml(cmpGroups) + '</div>';
    }
    currencies.forEach(function (cur) {
      var lines = linesAll.filter(function (b) { return b.currency === cur; });
      // R2-25 + R2-02: summary cards theo currency — MỌI con số đều từ cùng
      // một nguồn: Σ actuals liên kết (D.commitmentPaidTotal /
      // D.openCommitmentTotal) và D.budgetRemaining.
      var sum = { planned: 0, approved: 0, spent: 0, open: 0, remaining: 0 };
      lines.forEach(function (b) {
        var commits = allCommits.filter(function (x) { return x.budgetLineId === b.id; });
        var acts = allActuals.filter(function (x) { return x.budgetLineId === b.id; });
        sum.planned += Number(b.planned || 0);
        sum.approved += Number(b.approved || 0);
        sum.spent += acts.reduce(function (s, a) { return s + Number(a.amount || 0); }, 0);
        sum.open += (typeof D.openCommitmentTotal === 'function') ? D.openCommitmentTotal(commits, acts) : 0;
        sum.remaining += D.budgetRemaining(b, commits, acts);
      });
      var projected = sum.approved - sum.remaining; // dự kiến sử dụng = đã duyệt − còn phân bổ
      html += '<h3>Tiền tệ: ' + esc(cur) + '</h3>';
      // WAVE-B3: 6 thẻ tiền trần -> vizKpiCardHtml (số giữ nguyên nguồn cộng
      // hiện tại của view: planned/approved từ dòng ngân sách, spent từ
      // actuals, open qua D.openCommitmentTotal, remaining qua
      // D.budgetRemaining) + 1 thanh xếp chồng dòng tiền trên hạn mức duyệt.
      html += '<div class="cards" data-viz="kpi-money-cards">' +
        vizKpiCardHtml({ label: 'Kế hoạch', valueText: fmtMoney(sum.planned, cur), tone: 'neutral', toneLabel: 'Kế hoạch', sub: 'Tổng kế hoạch các dòng ngân sách (' + cur + ')' }) +
        vizKpiCardHtml({ label: 'Được duyệt', valueText: fmtMoney(sum.approved, cur), tone: 'running', toneLabel: 'Hạn mức', sub: 'Tổng hạn mức đã duyệt (' + cur + ')' }) +
        vizKpiCardHtml({ label: 'Đã chi', valueText: fmtMoney(sum.spent, cur), tone: 'running', toneLabel: 'Thực chi', sub: 'Tổng thực chi đã ghi (' + cur + ')' }) +
        vizKpiCardHtml({ label: 'Cam kết chưa trả', valueText: fmtMoney(sum.open, cur), tone: 'pending', toneLabel: 'Cam kết mở', sub: 'Cam kết còn mở chưa thanh toán (' + cur + ')' }) +
        vizKpiCardHtml({ label: 'Còn phân bổ', valueText: fmtMoney(sum.remaining, cur), tone: sum.remaining < 0 ? 'overdue' : 'done', toneLabel: sum.remaining < 0 ? 'Vượt ngân sách' : 'Còn dùng được', sub: 'Đã duyệt trừ dự kiến sử dụng (' + cur + ')' }) +
        vizKpiCardHtml({ label: 'Dự kiến sử dụng', valueText: fmtMoney(projected, cur), tone: 'pending', toneLabel: 'Dự kiến', sub: 'Đã chi + cam kết chưa trả (' + cur + ')', progress: sum.approved > 0 ? { value: projected, max: sum.approved, pct: vizPct(projected, sum.approved), tone: projected > sum.approved ? 'overdue' : 'pending', detail: fmtMoney(projected, cur) + ' / ' + fmtMoney(sum.approved, cur) + ' (' + fmtPct(vizPct(projected, sum.approved)) + ')' } : null }) +
        '</div>';
      if (sum.approved > 0) {
        html += '<div data-viz="kpi-budget-stacked"><h4>Dòng tiền trên hạn mức đã duyệt (' + esc(cur) + ')</h4>' + vizStackedBarHtml({ segments: [
          { label: 'Đã chi', value: sum.spent, series: 'actual' },
          { label: 'Cam kết chưa trả', value: sum.open, series: 'commit' },
          { label: 'Còn dùng được', value: Math.max(0, sum.remaining), tone: 'done' }
        ], total: sum.approved, unitLabel: cur + ' đã duyệt' }) + '</div>';
      }
      html += tbl('<tr><th>Dòng ngân sách</th><th>Campaign</th><th>Kế hoạch</th><th>Đã duyệt</th><th>Cam kết còn mở</th><th>Thực chi</th><th>Còn lại</th><th>Trạng thái</th><th>Thao tác</th></tr>' + lines.map(function (b) {
        var commits = allCommits.filter(function (x) { return x.budgetLineId === b.id; });
        var acts = allActuals.filter(function (x) { return x.budgetLineId === b.id; });
        var actualTotal = acts.reduce(function (s, a) { return s + Number(a.amount || 0); }, 0);
        // R2-02: "Cam kết còn mở" lấy thẳng từ D.openCommitmentTotal — không
        // còn phép tính riêng ở view.
        var openCommit = (typeof D.openCommitmentTotal === 'function') ? D.openCommitmentTotal(commits, acts) : 0;
        var rem = D.budgetRemaining(b, commits, acts);
        // R2-25: cam kết / thực chi hiển thị dạng BẢNG CON từng hàng.
        var commitRows = commits.length ? tbl('<tr><th>Cam kết</th><th>Số tiền</th><th>Đã thanh toán</th><th>Còn mở</th><th>Trạng thái</th><th>Duyệt</th><th>Thao tác</th></tr>' + commits.map(function (cm) {
          var cmActs = acts.filter(function (x) { return x.commitmentId === cm.id; });
          var paid = (typeof D.commitmentPaidTotal === 'function') ? D.commitmentPaidTotal(cm, cmActs) : cmActs.reduce(function (s, x) { return s + Number(x.amount || 0); }, 0);
          var cmOpen = String(cm.status).toLowerCase() === 'cancelled' ? 0 : Math.max(0, Number(cm.amount || 0) - paid);
          return '<tr><td>' + esc(cm.title) + '</td><td>' + fmtMoney(cm.amount, cm.currency || cur) + '</td><td>' + fmtMoney(paid, cm.currency || cur) + '</td><td>' + fmtMoney(cmOpen, cm.currency || cur) + '</td><td>' + statusBadge(cm.status) + '</td><td>' + factApprovalControlsHtml(cm, 'commitment') + '</td>' +
            '<td class="row-actions">' + (budgetEd ? '<button class="btn small secondary" data-action="editor-open" data-kind="commitment" data-id="' + esc(cm.id) + '">Sửa cam kết</button> <button class="btn small" data-action="editor-open" data-kind="commitmentPayment" data-commitment="' + esc(cm.id) + '">Ghi thanh toán</button> <button class="btn small secondary" data-action="editor-open" data-kind="allocation" data-source-kind="commitment" data-source-id="' + esc(cm.id) + '">Phân bổ chi chung</button>' : '') + '</td></tr>';
        }).join(''), 'budget-commitments') : '<p class="sub">Chưa có cam kết nào.</p>';
        var actRows = acts.length ? tbl('<tr><th>Khoản chi</th><th>Số tiền</th><th>Ngày chi</th><th>Nguồn</th><th>Ghi chú / chứng từ</th><th>Duyệt</th><th>Thao tác</th></tr>' + acts.map(function (a) {
          var srcLabel = { manual: 'Nhập tay', invoice: 'Hóa đơn', import: 'Nhập từ file' }[a.source] || a.source || 'Nhập tay';
          var aAllocs = hasFn('listAllocationsForSource') ? Store.listAllocationsForSource('actual', a.id) : [];
          var allocText = aAllocs.length ? '<br><span class="sub">Phân bổ: ' + aAllocs.map(function (al) { var aa = Store.get('activities', al.activityId); return esc(aa ? aa.name : (al.activityId || '—')) + ' = ' + (al.amount !== null && al.amount !== undefined ? fmtMoney(al.amount, a.currency || cur) : (al.sharePercent + '%')); }).join('; ') + '</span>' : '';
          return '<tr><td>' + esc(a.title) + allocText + '</td><td>' + fmtMoney(a.amount, a.currency || cur) + '</td><td>' + esc(D.formatDateVN(a.date)) + '</td><td>' + esc(srcLabel) + '</td><td>' + esc(a.description || '') + '</td><td>' + factApprovalControlsHtml(a, 'actual') + '</td>' +
            '<td class="row-actions">' + (budgetEd ? '<button class="btn small secondary" data-action="editor-open" data-kind="actual" data-id="' + esc(a.id) + '">Sửa</button> <button class="btn small secondary" data-action="editor-open" data-kind="allocation" data-source-kind="actual" data-source-id="' + esc(a.id) + '">Phân bổ chi chung</button>' : '') + '</td></tr>';
        }).join(''), 'budget-actuals') : '<p class="sub">Chưa có khoản chi nào.</p>';
        var detail = '<tr class="detail-row"><td colspan="9">' +
          '<strong>Cam kết (' + commits.length + ')</strong>' + (budgetEd ? ' <button class="btn small" data-action="editor-open" data-kind="commitment" data-line="' + esc(b.id) + '">+ Thêm cam kết</button>' : '') + commitRows +
          '<strong>Thực chi (' + acts.length + ')</strong>' + (budgetEd ? ' <button class="btn small" data-action="editor-open" data-kind="actual" data-line="' + esc(b.id) + '">+ Ghi khoản chi</button>' : '') + actRows +
          '</td></tr>';
        var lineUsed = actualTotal + openCommit;
        return '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc(campaignName(b.campaignId)) + '</td><td>' + fmtMoney(b.planned, cur) + '</td><td>' + budgetLineApprovedCellHtml(b) + '</td><td>' + fmtMoney(openCommit, cur) + '</td><td>' + fmtMoney(actualTotal, cur) + '</td><td>' + fmtMoney(rem, cur) + (Number(b.approved) > 0 ? vizCellBarHtml({ value: lineUsed, max: Number(b.approved), tone: rem < 0 ? 'overdue' : (rem === 0 ? 'pending' : 'running'), text: 'Đã dùng ' + fmtMoney(lineUsed, cur) + ' / hạn mức dòng ' + fmtMoney(b.approved, cur) + ' (' + fmtPct(vizPct(lineUsed, Number(b.approved))) + ')' }) : '') + '</td><td>' + (rem < 0 ? vizStatusPillHtml('overdue', { label: 'Vượt ngân sách ' + fmtMoney(-rem, cur), derived: true }) : vizStatusPillHtml('done', { label: 'Trong ngân sách' })) + '</td>' +
          '<td class="row-actions"><button class="btn small secondary" data-action="editor-open" data-kind="budgetLine" data-id="' + esc(b.id) + '"' + dis(!budgetEd) + '>Sửa dòng</button></td></tr>' + detail;
      }).join(''), 'budget-lines');
    });
    html += '<p class="sub">Phần đã thanh toán của một cam kết được tính từ các khoản thanh toán liên kết và chỉ tính một lần ở cột Đã chi.</p>';
    // R3.1-VIZ 5: khối Thu–Chi (sổ cash, tách hẳn ngân sách campaign) —
    // chart cột Thu/Chi theo tháng + số dư + bảng giao dịch ngay dưới.
    html += '<h2 id="kpi-sec-cash">Thu–Chi &amp; Ngân sách (sổ quỹ)</h2><p><button class="btn secondary" data-action="export-cash-csv">Xuất CSV Thu–Chi (giao dịch kèm tài khoản, scope)</button></p>' + cashChartHtml();
    return html;
  }

  // ---------- Kênh & Bài đã đăng ----------
  function viewChannels() {
    var accounts = Store.list('channelAccounts');
    var ed = canEdit();
    var html = pageHead('Kênh & Post', 'Trạng thái kết nối theo từng khả năng và thư viện Post.',
      ed ? '<button class="btn" data-action="editor-open" data-kind="post">+ Thêm Post (nhập tay)</button>' : '');
    html += readonlyNote() + collectionBanner('channelAccounts');
    html += '<h2>Kết nối kênh</h2>';
    // R2-23: hiển thị HAI trục riêng — mức triển khai code (api_implementation)
    // và trạng thái tài khoản thật (connection_status), không gộp một nhãn.
    var API_IMPL_LABELS = { not_implemented: 'Chưa triển khai', implemented_needs_credentials: 'Đã có code — chờ thông tin kết nối', verified: 'Đã kiểm chứng' };
    // WAVE-B4: mức code/khả năng gộp thành nhóm chấm — tông là lớp trình bày,
    // nhãn đầy đủ giữ ở title + dòng chữ phụ dưới nhóm chấm.
    function implTone(v) { return v === 'verified' ? 'done' : (v === 'implemented_needs_credentials' ? 'pending' : 'todo'); }
    function capTone(v) {
      var s = String(v || '');
      if (s === 'Đã kết nối') return 'done';
      if (s.indexOf('Đăng ngoài app') !== -1) return 'running';
      if (s.indexOf('Chưa có quyền') !== -1) return 'todo';
      if (s.indexOf('Chờ') !== -1) return 'pending';
      return s ? 'neutral' : 'todo';
    }
    function dotCell(tone, shortLabel, fullLabel) {
      return '<span class="viz-dot-cell" title="' + esc(shortLabel + ': ' + fullLabel) + '">' + vizStatusDotHtml(tone, shortLabel + ': ' + fullLabel) + esc(shortLabel) + '</span>';
    }
    if (accounts.length) {
      html += '<div data-viz="channel-legend">' + vizLegendHtml([
        { label: 'Đã kiểm chứng / Đã kết nối', tone: 'done' },
        { label: 'Đã có code — chờ thông tin / Chờ kết nối', tone: 'pending' },
        { label: 'Đăng ngoài app', tone: 'running' },
        { label: 'Chưa triển khai / Chưa có quyền', tone: 'todo' }
      ], { chartId: 'channel-legend' }) + '<p class="sub">Mỗi chấm kèm tên mục; rê chuột (hoặc xem dòng chữ phụ) để thấy nhãn đầy đủ của từng mức code và khả năng.</p></div>';
    }
    html += accounts.length ? tbl('<tr><th>Kênh</th><th>Tài khoản</th><th>Trạng thái tài khoản</th><th>Mức code (OAuth · Đăng bài · Đồng bộ · Quảng cáo)</th><th>Khả năng (Đọc bài · Đọc số liệu · Đăng bài · Quảng cáo)</th></tr>' +
      accounts.map(function (a) {
        var cap = a.capabilities || {};
        var impl = a.apiImplementation || a.api_implementation || {};
        var implParts = [['OAuth', impl.oauth], ['Đăng bài', impl.publish], ['Đồng bộ', impl.sync], ['Quảng cáo', impl.ads]];
        var capParts = [['Đọc bài', cap.readPosts], ['Đọc số liệu', cap.readMetrics], ['Đăng bài', cap.publish], ['Quảng cáo', cap.ads]];
        var accTone = a.status === 'Đã kết nối' ? 'done' : 'pending';
        return '<tr><td>' + esc(labelStatus(a.platform)) + '</td><td><strong>' + esc(a.name) + '</strong></td>' +
          '<td>' + vizStatusPillHtml('', { tone: accTone, label: a.status || 'Chờ kết nối' }) + '</td>' +
          '<td><span class="viz-dot-group">' + implParts.map(function (p) { return dotCell(implTone(p[1]), p[0], API_IMPL_LABELS[p[1]] || 'Chưa triển khai'); }).join('') + '</span><br><span class="sub">' + implParts.map(function (p) { return esc(p[0] + ': ' + (API_IMPL_LABELS[p[1]] || 'Chưa triển khai')); }).join(' · ') + '</span></td>' +
          '<td><span class="viz-dot-group">' + capParts.map(function (p) { return dotCell(capTone(p[1]), p[0], p[1] || 'Chờ kết nối'); }).join('') + '</span><br><span class="sub">' + capParts.map(function (p) { return esc(p[0] + ': ' + (p[1] || 'Chờ kết nối')); }).join(' · ') + '</span></td></tr>';
      }).join(''), 'channels-accounts') : '<div class="state-box">Chưa có tài khoản kênh nào. Kết nối kênh cần cấp quyền ở nền tảng tương ứng; trong lúc chờ, vẫn ghi nhận bài bằng cách nhập tay.</div>';
    var posts = Store.list('externalPosts');
    var filtered = posts.filter(function (p) { return UI.channelFilter === 'all' || p.platform === UI.channelFilter; });
    html += '<h2>Thư viện Post (' + filtered.length + ')</h2>' +
      '<form class="inline" id="channel-filter-form"><label>Lọc theo kênh<select id="channel-filter"><option value="all">Tất cả kênh</option>' +
      PLATFORMS.map(function (p) { return '<option value="' + p[0] + '"' + (UI.channelFilter === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') +
      '</select></label><button class="btn secondary" type="submit">Lọc</button></form>';
    if (!filtered.length) html += emptyState('Chưa có post nào ở kênh đã lọc', 'Thêm post bằng cách nhập tay (nguồn sẽ ghi rõ là nhập tay) hoặc chờ đồng bộ khi kênh được kết nối.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="post">+ Thêm Post</button></p>' : '');
    else html += tbl('<tr><th>Post</th><th>Kênh</th><th>Mã bài trên nền tảng</th><th>Ngày đăng</th><th>Lượt xem</th><th>Tiếp cận</th><th>Nguồn</th><th>Campaign đã gắn</th><th>Gắn / đổi campaign</th><th>Thao tác</th></tr>' + filtered.map(function (p) {
      var obs = Store.list('metricObservations').filter(function (o) { return o.externalPostId === p.id; });
      // WAVE-B4: số mới nhất của từng chỉ số lấy qua đúng helper domain cho
      // snapshot trọn đời (không cộng các lần quan sát, không tự chọn tay).
      function latestMetric(metrics) {
        var list = obs.filter(function (o) { return metrics.indexOf(String(o.metric || '')) !== -1; });
        if (!list.length) return null;
        if (typeof D.latestLifetimeSnapshot === 'function') { var v = D.latestLifetimeSnapshot(list); if (v !== null && v !== undefined) return v; }
        var sorted = list.slice().sort(function (x, y) { return String(x.observedAt || '').localeCompare(String(y.observedAt || '')); });
        return sorted.length ? sorted[sorted.length - 1].value : null;
      }
      var views = latestMetric(['views', 'lifetime_views']);
      var reach = latestMetric(['reach']);
      var main = '<tr><td><a href="' + esc(p.url || '#') + '" target="_blank" rel="noopener">' + esc(p.title) + '</a></td><td>' + esc(labelStatus(p.platform)) + '</td><td><code>' + esc(p.externalPostId) + '</code></td><td>' + esc(D.formatDateTimeVN(p.publishedAt)) + '</td>' +
        '<td>' + (views === null || views === undefined ? '—' : '<strong title="' + esc(fmtNum(views)) + '">' + esc(vizCompactNum(views)) + '</strong>') + '</td>' +
        '<td>' + (reach === null || reach === undefined ? '—' : '<strong title="' + esc(fmtNum(reach)) + '">' + esc(vizCompactNum(reach)) + '</strong>') + '</td>' +
        '<td>' + esc(p.source === 'manual' ? 'Nhập tay' : (p.source || 'Đồng bộ')) + '</td><td>' + (p.campaignId ? esc(campaignName(p.campaignId)) : '<span class="badge warn">Chưa gắn</span>') + '</td>' +
        '<td><form class="inline compact" data-form="attach-campaign" data-id="' + esc(p.id) + '"><select name="campaignId"><option value="">— Chưa gắn —</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (p.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select><button class="btn small" type="submit"' + dis(!ed) + '>Lưu gắn</button></form></td>' +
        '<td class="row-actions"><button class="btn small secondary" data-action="post-metrics" data-id="' + esc(p.id) + '">Số liệu (' + obs.length + ')</button> <button class="btn small secondary" data-action="editor-open" data-kind="post" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Sửa</button></td></tr>';
      if (UI.postOpenId === p.id) {
        main += '<tr class="detail-row"><td colspan="10"><strong>Số liệu của bài:</strong> ' + (obs.length ? obs.map(function (o) { return esc(o.metric) + ' = ' + fmtNum(o.value) + ' (' + esc(o.source || '—') + ', ' + esc(D.formatDateTimeVN(o.observedAt)) + ')'; }).join(' · ') : 'Chưa có số liệu nào cho bài này.') + '</td></tr>';
      }
      return main;
    }).join(''), 'channels-posts', 'ads-main');
    html += '<p class="sub">Mỗi bài chỉ ghi nhận một lần theo kênh, tài khoản và mã bài — thêm trùng sẽ được báo lại.</p>';
    return html;
  }

  // ---------- Quảng cáo ----------
  function ratesCells(r, maxSpend) {
    var cur = r.currency || 'VND';
    var spendCell = fmtMoney(r.spend, cur);
    if (maxSpend && Number(maxSpend) > 0 && r.spend !== null && r.spend !== undefined && Number(r.spend) > 0) {
      spendCell += vizCellBarHtml({ value: Number(r.spend), max: Number(maxSpend), tone: 'running', text: 'So với dòng chi cao nhất: ' + fmtPct(vizPct(r.spend, maxSpend)) });
    }
    return '<td>' + spendCell + '</td><td>' + fmtNum(r.impressions) + '</td><td>' + fmtNum(r.clicks) + '</td><td>' + fmtNum(r.results) + '</td>';
  }
  function viewAds() {
    var html = pageHead('Quảng cáo', 'Số liệu quảng cáo chỉ đọc. "Chiến dịch quảng cáo" ở đây khác với IMC Campaign ở mục IMC & Campaigns.',
      (can('adsDraft') && Store.currentRole() !== 'ceo') ? '<button class="btn" data-action="editor-open" data-kind="adcr">+ Tạo yêu cầu thay đổi</button>' : '');
    var isCeo = Store.currentRole() === 'ceo';
    var canDraft = can('adsDraft');
    var canApproveAds = can('adsApprove');
    if (isCeo) html += '<div class="notice info">CEO chỉ xem: mọi thao tác tạo nháp/gửi duyệt/duyệt thay đổi quảng cáo đều bị ẩn và bị tầng dữ liệu chặn.</div>';
    html += collectionBanner('adAccounts');
    // WAVE-B4: phễu Hiển thị -> Nhấp -> Kết quả ở cấp chiến dịch quảng cáo —
    // tổng qua đúng hàm tổng hợp sẵn có D.aggregateRates (tử/mẫu cộng theo
    // từng tiền tệ), KHÔNG cộng chéo cấp chiến dịch/nhóm/quảng cáo.
    var allAdCampaigns = Store.list('adCampaigns');
    if (allAdCampaigns.length && typeof D.aggregateRates === 'function') {
      var aggAds = D.aggregateRates(allAdCampaigns);
      var funnelHtml = '';
      Object.keys(aggAds.byCurrency || {}).forEach(function (curKey) {
        var t = aggAds.byCurrency[curKey].totals || {};
        if (t.impressions === null || t.impressions === undefined) return;
        funnelHtml += '<p class="sub">Tiền tệ: ' + esc(currencyLabel(curKey)) + ' — chỉ cộng ở cấp chiến dịch quảng cáo</p>' + vizFunnelHtml({ steps: [
          { label: 'Hiển thị', value: t.impressions },
          { label: 'Nhấp', value: t.clicks },
          { label: 'Kết quả', value: t.results }
        ], emptyText: 'Chưa có số hiển thị để vẽ phễu quảng cáo.' });
      });
      if (funnelHtml) html += '<h2>Phễu hiệu quả quảng cáo</h2>' + funnelHtml;
    }
    if (!Store.list('adAccounts').length && !collLoadingOrError('adAccounts')) html += '<div class="state-box">Chưa kết nối tài khoản quảng cáo nào. Khi tài khoản được kết nối, cây chiến dịch/nhóm/quảng cáo và số liệu sẽ hiện tại đây.</div>';
    Store.list('adAccounts').forEach(function (acc) {
      html += '<div class="panel"><h3>' + esc(acc.name) + ' — ' + esc(acc.platform) + ' ' + vizStatusPillHtml('', { tone: acc.status === 'Đã kết nối' ? 'done' : 'pending', label: acc.status }) + '</h3>';
      var acs = Store.list('adCampaigns').filter(function (x) { return x.adAccountId === acc.id; });
      if (!acs.length) html += '<p class="sub">Chưa có chiến dịch quảng cáo nào.</p>';
      acs.forEach(function (ac) {
        html += '<p><strong>Chiến dịch quảng cáo:</strong> ' + esc(ac.name) + ' — ' + statusBadge(ac.status, ac.statusLabel) + '</p>';
        var acSets = Store.list('adSets').filter(function (x) { return x.adCampaignId === ac.id; });
        var acAds = [];
        acSets.forEach(function (s0) { Store.list('ads').filter(function (x) { return x.adSetId === s0.id; }).forEach(function (x) { acAds.push(x); }); });
        var maxSpend = 0;
        [ac].concat(acSets).concat(acAds).forEach(function (x) { var sv = Number(x.spend) || 0; if (sv > maxSpend) maxSpend = sv; });
        var rows = '<tr><th>Cấp</th><th>Tên</th><th>Trạng thái</th><th>Chi tiêu</th><th>Hiển thị</th><th>Nhấp</th><th>Kết quả</th></tr>';
        rows += '<tr><td>Chiến dịch</td><td>' + esc(ac.name) + '</td><td>' + statusBadge(ac.status, ac.statusLabel) + '</td>' + ratesCells(ac, maxSpend) + '</tr>';
        acSets.forEach(function (as) {
          rows += '<tr><td>Nhóm</td><td>↳ ' + esc(as.name) + '</td><td>' + statusBadge(as.status, as.statusLabel) + '</td>' + ratesCells(as, maxSpend) + '</tr>';
          Store.list('ads').filter(function (x) { return x.adSetId === as.id; }).forEach(function (ad) {
            rows += '<tr><td>Quảng cáo</td><td>↳↳ ' + esc(ad.name) + '</td><td>' + statusBadge(ad.status, ad.statusLabel) + '</td>' + ratesCells(ad, maxSpend) + '</tr>';
          });
        });
        html += tbl(rows) + '<p class="sub">Tổng chỉ cộng ở một cấp duy nhất để không tính trùng giữa chiến dịch / nhóm / quảng cáo.</p>';
      });
      html += '</div>';
    });
    var reqs = Store.list('adChangeRequests');
    html += '<h2>Yêu cầu thay đổi quảng cáo (' + reqs.length + ')</h2>';
    html += '<p class="sub">Quy trình: tạo nháp → gửi duyệt → duyệt → áp dụng trên nền tảng quảng cáo. Sau thay đổi, đối tượng mặc định ở trạng thái <strong>Tạm dừng</strong>.</p>';
    if (!reqs.length) html += '<div class="state-box">Chưa có yêu cầu thay đổi nào.</div>';
    else html += tbl('<tr><th>Yêu cầu</th><th>Tài khoản / Đối tượng</th><th>Loại thay đổi</th><th>Trước → Sau</th><th>Số tiền</th><th>Lịch dự kiến</th><th>Lý do</th><th>Trạng thái</th><th>Người tạo</th><th>Thao tác</th></tr>' + reqs.map(function (r) {
      var actions = '';
      if (!isCeo && r.status === 'draft') {
        if (canDraft) actions += '<button class="btn small" data-action="adcr-submit" data-id="' + esc(r.id) + '">Gửi duyệt</button> ';
        actions += '<button class="btn small secondary" data-action="editor-open" data-kind="adcr" data-id="' + esc(r.id) + '"' + dis(!canDraft) + '>Sửa nháp</button>';
      }
      if (!isCeo && r.status === 'pending_approval') actions = canApproveAds ? '<button class="btn small" data-action="adcr-approve" data-id="' + esc(r.id) + '">Duyệt</button>' : '<span class="sub">Chờ người có quyền duyệt quảng cáo</span>';
      if (isCeo) actions = '<span class="sub">Chỉ xem</span>';
      var accName = (Store.get('adAccounts', r.adAccountId) || {}).name || '—';
      return '<tr><td>' + esc(r.title) + '</td><td>' + esc(accName) + '<br>' + esc(r.target) + '</td><td>' + esc(labelStatus(r.changeType || 'other')) + '</td><td>' + esc(r.beforeState || r.before || '—') + ' → ' + esc(r.afterState || r.after || '—') + '</td><td>' + (r.amount != null ? fmtMoney(r.amount, r.currency) : '—') + '</td><td>' + (r.scheduledAt ? esc(D.formatDateTimeVN(r.scheduledAt)) : '—') + '</td><td>' + esc(r.reason || '—') + '</td><td>' + statusBadge(r.status, r.statusLabel) + '</td><td>' + esc(memberName(r.requestedBy)) + '</td><td>' + actions + '</td></tr>';
    }).join(''), 'ads-change-requests');
    return html;
  }

  // ---------- Báo cáo ----------
  // R2-06: số liệu quảng cáo của báo cáo lấy TỪ adInsights (đúng grain kỳ),
  // KHÔNG dùng số lifetime trên adCampaigns/adSets/ads nữa.
  var INSIGHT_LEVEL_OF = { account: 'account', ad_account: 'account', campaign: 'campaign', ad_campaign: 'campaign', adset: 'adset', ad_set: 'adset', ad_group: 'adset', ad: 'ad' };
  function insightLevel(ins) { return INSIGHT_LEVEL_OF[String(ins.objectType || '').toLowerCase()] || null; }
  function reportDataset() {
    var f = UI.report;
    var insights = [];
    try { insights = Store.list('adInsights'); } catch (e) { insights = []; }
    var adCampaigns = Store.list('adCampaigns');
    var adSets = Store.list('adSets');
    var ads = Store.list('ads');
    function chainOf(ins) {
      // Chuỗi ad → adset → campaign → account + IMC campaign của ad campaign.
      var lvl = insightLevel(ins);
      var out = { level: lvl, accountId: null, imcCampaignId: null, name: ins.objectId || '' };
      var ac = null, as = null, ad = null;
      if (lvl === 'account') { out.accountId = ins.objectId; var acc = Store.get('adAccounts', ins.objectId); out.name = acc ? acc.name : out.name; out.imcCampaignId = acc ? (acc.campaignId || null) : null; }
      if (lvl === 'campaign') { ac = adCampaigns.find(function (x) { return x.id === ins.objectId; }); }
      if (lvl === 'adset') { as = adSets.find(function (x) { return x.id === ins.objectId; }); if (as) ac = adCampaigns.find(function (x) { return x.id === as.adCampaignId; }); }
      if (lvl === 'ad') { ad = ads.find(function (x) { return x.id === ins.objectId; }); if (ad) as = adSets.find(function (x) { return x.id === ad.adSetId; }); if (as) ac = adCampaigns.find(function (x) { return x.id === as.adCampaignId; }); }
      if (ac) { out.accountId = ac.adAccountId; out.imcCampaignId = ac.campaignId || null; }
      var named = ad || as || ac;
      if (named && named.name) out.name = named.name;
      out._chain = { adCampaign: ac, adSet: as, ad: ad };
      return out;
    }
    var scoped = insights.filter(function (ins) {
      if (!insightLevel(ins)) return false;
      // Kỳ: lấy insight có [periodStart, periodEnd] GIAO với [from, to].
      var ps = dateInTz(ins.periodStart), pe = dateInTz(ins.periodEnd);
      if (f.from && pe && pe < f.from) return false;
      if (f.to && ps && ps > f.to) return false;
      var chain = chainOf(ins);
      ins._reportChain = chain;
      if (f.accountId !== 'all' && chain.accountId !== f.accountId) return false;
      if (f.campaignId !== 'all' && chain.imcCampaignId !== f.campaignId) return false;
      return true;
    });
    var levelInsights = scoped.filter(function (ins) { return insightLevel(ins) === f.level; });
    // Quan sát số liệu (lượt xem trọn đời / reach): lọc theo kỳ + campaign.
    var obs = Store.list('metricObservations').filter(function (o) {
      var obsDate = dateInTz(o.observedAt);
      if (f.from && obsDate < f.from) return false;
      if (f.to && obsDate > f.to) return false;
      if (f.campaignId !== 'all') {
        var post = Store.get('externalPosts', o.externalPostId);
        if (!post || post.campaignId !== f.campaignId) return false;
      }
      return true;
    });
    return { insights: scoped, levelInsights: levelInsights, obs: obs };
  }
  // Gộp insight cùng một đối tượng + cùng tiền tệ thành 1 dòng hiển thị.
  function groupInsights(rows) {
    var map = {};
    var order = [];
    (rows || []).forEach(function (r) {
      var chain = r._reportChain || {};
      // Thiếu currency: giữ null (không gán bừa 'VND') để khớp bucket
      // '__unknown' của D.aggregateRates; key dùng '__unknown' cho nhóm này.
      var curNorm = (r.currency !== null && r.currency !== undefined && String(r.currency).trim() !== '') ? String(r.currency).trim() : null;
      var key = (r.objectId || '') + '|' + (curNorm || '__unknown');
      if (!map[key]) {
        map[key] = { level: insightLevel(r), name: chain.name || r.objectId || '', status: '', currency: curNorm, spend: 0, impressions: 0, clicks: 0, results: 0, conversionValue: 0 };
        order.push(key);
      }
      var g = map[key];
      ['spend', 'impressions', 'clicks', 'results', 'conversionValue'].forEach(function (k) { g[k] += Number(r[k] || 0); });
    });
    return order.map(function (k) { return map[k]; });
  }
  function viewReports() {
    var f = UI.report;
    var ds = reportDataset();
    var levelInsights = ds.levelInsights;
    // R2-20/21: tổng hợp THEO TỪNG TIỀN TỆ từ aggregateRates mới (byCurrency).
    var agg = (typeof D.aggregateRates === 'function') ? D.aggregateRates(levelInsights) : { byCurrency: {}, mixed: false };
    var buckets = agg.byCurrency || {};
    var bucketCurs = Object.keys(buckets);
    var hasAdsData = levelInsights.length > 0;
    var groupedRows = groupInsights(levelInsights);
    UI.reportRowsCache = groupedRows;
    UI.reportAggCache = { byCurrency: buckets, mixed: !!agg.mixed, hasData: hasAdsData, level: f.level, accountId: f.accountId, campaignId: f.campaignId, from: f.from, to: f.to };
    // Lượt xem trọn đời: lấy bản mới nhất THEO TỪNG BÀI rồi mới tổng hợp
    var lifetimeByPost = {};
    ds.obs.filter(function (o) { return o.metric === 'lifetime_views'; }).forEach(function (o) {
      var key = o.externalPostId || 'unknown';
      if (!lifetimeByPost[key]) lifetimeByPost[key] = [];
      lifetimeByPost[key].push(o);
    });
    var lifetimeRows = Object.keys(lifetimeByPost).map(function (k) { return { postId: k, value: D.latestLifetimeSnapshot(lifetimeByPost[k]) }; });
    var lifetimeTotal = lifetimeRows.length ? lifetimeRows.reduce(function (s, r) { return s + (r.value || 0); }, 0) : null;
    var reachGuard = D.sumUniqueReachGuard(ds.obs.filter(function (o) { return o.metric === 'reach'; }));
    var missing = Store.list('kpis').some(function (k) { return D.kpiDisplay(k).isMissing; });
    var levelLabel = { account: 'Tài khoản', campaign: 'Chiến dịch quảng cáo', adset: 'Nhóm quảng cáo', ad: 'Quảng cáo' }[f.level] || f.level;
    var html = pageHead('Báo cáo', 'Hai góc nhìn: vận hành task và hiệu quả marketing. Bộ lọc kỳ/tài khoản/campaign áp dụng thật vào tập dữ liệu bên dưới.',
      '<button class="btn" data-action="editor-open" data-kind="snapshot">Chốt báo cáo từ dữ liệu đang lọc</button> <button class="btn secondary" data-action="export-csv">Xuất CSV dữ liệu đang lọc</button>');
    html += tabsHtml([['perf', 'Hiệu quả marketing'], ['ops', 'Vận hành task']], f.view, 'report-view');
    html += '<form class="inline" id="report-filter-form">' +
      '<label>Từ ngày<input type="date" name="from" value="' + esc(f.from) + '"></label>' +
      '<label>Đến ngày<input type="date" name="to" value="' + esc(f.to) + '"></label>' +
      '<label>Tài khoản quảng cáo<select name="accountId"><option value="all">Tất cả tài khoản</option>' + Store.list('adAccounts').map(function (a) { return '<option value="' + esc(a.id) + '"' + (f.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Campaign (IMC)<select name="campaignId"><option value="all">Tất cả campaign</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Cấp tổng hợp quảng cáo<select name="level">' + [['campaign', 'Chiến dịch quảng cáo'], ['adset', 'Nhóm quảng cáo'], ['ad', 'Quảng cáo']].map(function (lv) { return '<option value="' + lv[0] + '"' + (f.level === lv[0] ? ' selected' : '') + '>' + lv[1] + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn" type="submit">Áp dụng lọc</button> <button class="btn secondary" type="button" data-action="report-clear">Xóa lọc</button></form>';
    html += '<p class="sub">Đang áp dụng: kỳ ' + (f.from || f.to ? (D.formatDateVN(f.from) || '…') + ' — ' + (D.formatDateVN(f.to) || '…') : 'toàn bộ') + ' · tài khoản: ' + (f.accountId === 'all' ? 'tất cả' : esc((Store.get('adAccounts', f.accountId) || {}).name || '')) + ' · campaign: ' + (f.campaignId === 'all' ? 'tất cả' : esc(campaignName(f.campaignId))) + ' · cấp quảng cáo: ' + esc(levelLabel) + '. Số liệu quảng cáo lấy từ dữ liệu theo kỳ của đúng cấp đã chọn; ô thiếu dữ liệu giữ trống, không đổi thành 0.</p>';
    if (f.view === 'ops') {
      var tasks = visibleList('tasks');
      var overdue = tasks.filter(isOverdue);
      var pendingApprovals = Store.list('approvals').filter(function (a) { return a.status === 'pending' || a.status === 'needs_reapproval'; });
      var allCampaigns = visibleList('campaigns');
      var runningCampaigns = allCampaigns.filter(function (c) { return c.status === 'active'; });
      var completedTasks = tasks.filter(function (t) { return isCompletedTask(t); });
      // WAVE-B1-VIZ2: 4 thẻ trần -> vizKpiCardHtml (số đếm giữ nguyên như trước).
      html += '<div class="cards" data-viz="reports-ops-cards">' +
        vizKpiCardHtml({ label: 'Campaign đang chạy', valueText: String(runningCampaigns.length), tone: 'running', toneLabel: 'Đang chạy', href: '#/campaigns', hrefLabel: 'Xem danh sách', progress: allCampaigns.length ? { value: runningCampaigns.length, max: allCampaigns.length, pct: vizPct(runningCampaigns.length, allCampaigns.length), tone: 'running', detail: runningCampaigns.length + '/' + allCampaigns.length + ' campaign (' + fmtPct(vizPct(runningCampaigns.length, allCampaigns.length)) + ')' } : null }) +
        vizKpiCardHtml({ label: 'Task quá hạn', valueText: String(overdue.length), tone: 'overdue', toneLabel: 'Quá hạn', href: '#/tasks', hrefLabel: 'Xem task', progress: tasks.length ? { value: overdue.length, max: tasks.length, pct: vizPct(overdue.length, tasks.length), tone: 'overdue', detail: overdue.length + '/' + tasks.length + ' task (' + fmtPct(vizPct(overdue.length, tasks.length)) + ')' } : null }) +
        vizKpiCardHtml({ label: 'Content chờ duyệt', valueText: String(pendingApprovals.length), tone: 'pending', toneLabel: 'Chờ duyệt', href: '#/approvals', hrefLabel: 'Tới hộp duyệt' }) +
        vizKpiCardHtml({ label: 'Task đã hoàn thành', valueText: completedTasks.length + '/' + tasks.length, tone: 'done', toneLabel: 'Hoàn thành', progress: tasks.length ? { value: completedTasks.length, max: tasks.length, pct: vizPct(completedTasks.length, tasks.length), tone: 'done', detail: completedTasks.length + '/' + tasks.length + ' task (' + fmtPct(vizPct(completedTasks.length, tasks.length)) + ')' } : null }) +
        '</div>';
      html += '<h2>Tiến độ theo campaign</h2><div data-viz="reports-ops-progress">' + tbl('<tr><th>Campaign</th><th>Tiến độ</th><th>Quá hạn</th></tr>' + allCampaigns.map(function (c) {
        var ct = tasks.filter(function (t) { return t.campaignId === c.id; });
        var p = D.campaignProgress(ct);
        var odCount = ct.filter(isOverdue).length;
        var pTone = p.percentage >= 100 ? 'done' : (odCount ? 'overdue' : 'running');
        return '<tr><td><a href="#/campaigns/' + esc(c.id) + '">' + esc(c.name) + '</a></td><td>' +
          vizCellBarHtml({ value: p.completed, max: p.total, tone: pTone, text: p.completed + '/' + p.total + ' (' + p.percentage + '%)' }) +
          '</td><td>' + (odCount > 0 ? vizStatusPillHtml('overdue', { label: odCount + ' quá hạn', derived: true }) : '0') + '</td></tr>';
      }).join(''), 'reports-campaign-progress') + '</div>';
      return html;
    }
    // R2-06: không có insight trong scope → nói rõ không đủ dữ liệu, TUYỆT
    // ĐỐI không hiển thị số lifetime cũ của cây quảng cáo.
    if (!hasAdsData) {
      html += '<div class="notice warn"><strong>Không đủ dữ liệu trong kỳ đã chọn.</strong> Chưa có số liệu quảng cáo theo kỳ nào khớp bộ lọc (kỳ / tài khoản / campaign / cấp ' + esc(levelLabel) + '). Hãy mở rộng kỳ, đổi bộ lọc hoặc chờ dữ liệu được đồng bộ.</div>';
    } else {
      if (agg.mixed) html += '<div class="notice warn">Dữ liệu gồm nhiều tiền tệ — các chỉ số được tách theo từng tiền tệ bên dưới, không cộng chéo.</div>';
      bucketCurs.forEach(function (cur) {
        var b = buckets[cur];
        var t = b.totals || {};
        var curLabel = currencyLabel(cur);
        var curMoney = cur === '__unknown' ? '' : cur;
        // WAVE-B1-VIZ2: 5 thẻ số trần -> vizKpiCardHtml (số giữ NGUYÊN từ
        // b = D.aggregateRates(levelInsights).byCurrency[cur] ở trên).
        html += '<h3>Đơn vị tiền: ' + esc(curLabel) + ' — cấp ' + esc(levelLabel) + '</h3><div class="cards" data-viz="reports-perf-cards">' +
          vizKpiCardHtml({ label: 'CTR (' + curLabel + ')', valueText: (b.ctr === null || b.ctr === undefined ? '—' : (b.ctr * 100).toFixed(2) + '%'), tone: 'running', sub: 'Tổng nhấp / tổng hiển thị của cấp đã chọn' }) +
          vizKpiCardHtml({ label: 'CPC (' + curLabel + '/nhấp)', valueText: (b.cpc === null || b.cpc === undefined ? '—' : fmtMoney(Math.round(b.cpc), curMoney)), tone: 'running', sub: 'Tổng chi tiêu / tổng nhấp' }) +
          vizKpiCardHtml({ label: 'CPM (' + curLabel + '/1.000 hiển thị)', valueText: (b.cpm === null || b.cpm === undefined ? '—' : fmtMoney(Math.round(b.cpm), curMoney)), tone: 'running' }) +
          vizKpiCardHtml({ label: 'ROAS (' + curLabel + ')', valueText: (b.roas === null || b.roas === undefined ? '—' : Number(b.roas).toFixed(2)), tone: 'running', sub: 'Giá trị chuyển đổi / chi tiêu' }) +
          vizKpiCardHtml({ label: 'Tổng chi tiêu (' + curLabel + ')', valueText: fmtMoney(t.spend, curMoney), tone: 'running' }) +
          '</div>';
      });
      // WAVE-B1-VIZ2: biểu đồ theo kỳ — gom levelInsights theo đúng cặp
      // [periodStart, periodEnd] đã có trên từng insight, rồi gọi LẠI
      // D.aggregateRates cho riêng kỳ đó để lấy totals (cấm cộng tay).
      var periodKeys = [];
      var periodSeen = {};
      levelInsights.forEach(function (ins) {
        var ps = dateInTz(ins.periodStart), pe = dateInTz(ins.periodEnd);
        var key = (ps || '') + '|' + (pe || '');
        if (!periodSeen[key]) { periodSeen[key] = true; periodKeys.push({ key: key, ps: ps, pe: pe }); }
      });
      periodKeys.sort(function (a, b) { return String(a.ps || '').localeCompare(String(b.ps || '')); });
      if (periodKeys.length) {
        html += '<h2>Theo kỳ (cấp ' + esc(levelLabel) + ')</h2>';
        bucketCurs.forEach(function (cur) {
          var curLabel2 = currencyLabel(cur);
          var curMoney2 = cur === '__unknown' ? '' : cur;
          var perPeriod = periodKeys.map(function (pk) {
            var rowsInPeriod = levelInsights.filter(function (ins) { return (dateInTz(ins.periodStart) || '') + '|' + (dateInTz(ins.periodEnd) || '') === pk.key; });
            var aggP = (typeof D.aggregateRates === 'function') ? D.aggregateRates(rowsInPeriod) : { byCurrency: {} };
            var bp = (aggP.byCurrency || {})[cur] || null;
            return { pk: pk, totals: bp ? (bp.totals || {}) : {} };
          });
          var periodLabel = function (pk) { return (pk.ps ? D.formatDateVN(pk.ps) : '…') + ' – ' + (pk.pe ? D.formatDateVN(pk.pe) : '…'); };
          var periodLabelShort = function (pk) {
            function dm(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '…'; }
            return dm(pk.ps) + '–' + dm(pk.pe);
          };
          var maxClicks = 0, maxResults = 0;
          perPeriod.forEach(function (pp) {
            if (pp.totals.clicks !== null && pp.totals.clicks !== undefined) maxClicks = Math.max(maxClicks, Number(pp.totals.clicks) || 0);
            if (pp.totals.results !== null && pp.totals.results !== undefined) maxResults = Math.max(maxResults, Number(pp.totals.results) || 0);
          });
          html += '<div data-viz="reports-perf-period"><h3>Đơn vị tiền: ' + esc(curLabel2) + '</h3>' +
            '<h4>Chi tiêu theo kỳ</h4>' + vizLineAreaSvgHtml({ points: perPeriod.map(function (pp) { return { x: periodLabelShort(pp.pk), y: (pp.totals.spend === null || pp.totals.spend === undefined) ? null : Number(pp.totals.spend) }; }), yLabel: 'Chi tiêu (' + curLabel2 + ')', emptyText: 'Chưa có chi tiêu theo kỳ để vẽ biểu đồ.' }) +
            '<h4>Nhấp &amp; kết quả theo kỳ</h4><div class="viz-chart" data-viz="reports-perf-period-bars">' +
            perPeriod.map(function (pp) {
              return vizHBarHtml({ label: 'Nhấp — ' + periodLabel(pp.pk), value: pp.totals.clicks, max: maxClicks, series: 'actual', valueText: (pp.totals.clicks === null || pp.totals.clicks === undefined) ? '—' : fmtNum(pp.totals.clicks) }) +
                vizHBarHtml({ label: 'Kết quả — ' + periodLabel(pp.pk), value: pp.totals.results, max: maxResults, series: 'alloc', valueText: (pp.totals.results === null || pp.totals.results === undefined) ? '—' : fmtNum(pp.totals.results) });
            }).join('') + '</div></div>';
        });
      }
      html += '<h2>Chi tiết cấp ' + esc(levelLabel) + '</h2>' + tbl('<tr><th>Tên</th><th>Tiền tệ</th><th>Chi tiêu</th><th>Hiển thị</th><th>Nhấp</th><th>Kết quả</th><th>Giá trị chuyển đổi</th></tr>' + groupedRows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td>' + esc(currencyLabel(r.currency)) + '</td><td>' + fmtMoney(r.spend, r.currency || '') + '</td><td>' + fmtNum(r.impressions) + '</td><td>' + fmtNum(r.clicks) + '</td><td>' + fmtNum(r.results) + '</td><td>' + fmtNum(r.conversionValue) + '</td></tr>';
      }).join(''), 'reports-detail');
    }
    html += '<div class="cards">' +
      vizKpiCardHtml({ label: 'Lượt xem trọn đời — tổng của bản mới nhất từng bài', valueText: (lifetimeTotal === null ? '—' : fmtNum(lifetimeTotal)), tone: 'neutral', sub: 'Đơn vị: lượt · Mỗi bài chỉ lấy lần quan sát mới nhất, không cộng dồn các lần quan sát' }) + '</div>';
    if (lifetimeRows.length) html += '<h3>Lượt xem trọn đời theo bài</h3><div data-viz="reports-lifetime-bars">' + tbl('<tr><th>Bài</th><th>Giá trị mới nhất</th><th>Tỉ trọng</th></tr>' + lifetimeRows.map(function (r) {
      var post = Store.get('externalPosts', r.postId);
      return '<tr><td>' + esc(post ? post.title : r.postId) + '</td><td>' + fmtNum(r.value) + '</td><td>' +
        ((lifetimeTotal && r.value !== null && r.value !== undefined) ? vizCellBarHtml({ value: r.value, max: lifetimeTotal, tone: 'running', text: fmtNum(r.value) + ' (' + fmtPct(vizPct(r.value, lifetimeTotal)) + ')' }) : '—') + '</td></tr>';
    }).join(''), 'reports-lifetime') + '</div>';
    if (!reachGuard.summable && ds.obs.length) html += '<div class="notice warn"><strong>Reach không cộng dồn:</strong> ' + esc(reachGuard.reason) + '</div>';
    if (missing) html += '<div class="notice warn">Có KPI chưa có giá trị thực đạt — hiển thị "Chưa cập nhật", không thay bằng 0.</div>';
    html += '<h2>Báo cáo đã chốt</h2>';
    var snaps = Store.list('reportSnapshots');
    if (!snaps.length) html += '<div class="state-box">Chưa có báo cáo nào được chốt. Dùng nút "Chốt báo cáo" ở đầu trang để đóng băng số liệu đang lọc.</div>';
    snaps.forEach(function (s) {
      var m = s.metrics || {};
      var sf = s.filter || {};
      // R2-22: in lại PHẠM VI đã khôi phục từ item.filter của snapshot.
      var scopeText = 'Phạm vi: kỳ ' + (sf.from || sf.to ? (D.formatDateVN(sf.from) || '…') + ' — ' + (D.formatDateVN(sf.to) || '…') : 'toàn bộ') +
        ' · tài khoản: ' + (!sf.accountId || sf.accountId === 'all' ? 'tất cả' : esc((Store.get('adAccounts', sf.accountId) || {}).name || sf.accountId)) +
        ' · campaign: ' + (!sf.campaignId || sf.campaignId === 'all' ? 'tất cả' : esc(campaignName(sf.campaignId))) +
        ' · cấp: ' + esc(sf.level || '—') +
        ' · đơn vị: ' + esc(sf.currencies && sf.currencies.length ? sf.currencies.map(currencyLabel).join(', ') : (m.byCurrency ? Object.keys(m.byCurrency).map(currencyLabel).join(', ') : 'VND'));
      var metricsText = '';
      if (m.byCurrency) {
        metricsText = Object.keys(m.byCurrency).map(function (cur2) {
          var bt = (m.byCurrency[cur2] && m.byCurrency[cur2].totals) || {};
          return 'Chi tiêu (' + esc(currencyLabel(cur2)) + '): ' + fmtMoney(bt.spend, cur2 === '__unknown' ? '' : cur2) + ' · Hiển thị: ' + fmtNum(bt.impressions) + ' · Nhấp: ' + fmtNum(bt.clicks);
        }).join(' | ');
      } else {
        metricsText = 'Chi tiêu: ' + (m.spend === null || m.spend === undefined ? '—' : fmtMoney(m.spend, 'VND')) + ' · Hiển thị: ' + fmtNum(m.impressions) + ' · Nhấp: ' + fmtNum(m.clicks);
      }
      html += '<div class="panel"><strong>' + esc(s.title) + '</strong> <span class="badge ok">' + esc(s.status || 'Đã chốt') + '</span>' +
        '<p class="sub">Chốt lúc ' + esc(D.formatDateTimeVN(s.frozenAt)) + ' · ' + scopeText + '<br>' + metricsText + '</p>' +
        '<p>' + esc(s.summary || '') + '</p><p class="sub">Báo cáo đã chốt hiển thị đóng băng — không có nút sửa.</p></div>';
    });
    return html;
  }

  // ---------- Thiết lập ----------
  // Panel "Trạng thái kết nối Supabase": phân biệt ĐÚNG 4 trạng thái theo mode.
  // - 'supabase' + đã đăng nhập / chưa đăng nhập: giữ nguyên như trước.
  // - 'demo': Supabase ĐÃ cấu hình — người dùng chỉ đang xem dữ liệu demo nên
  //   app chưa dùng dữ liệu thật; TUYỆT ĐỐI không hiện "Chờ kết nối Supabase"
  //   hay 3 bước tự cài đặt (hai thứ đó chỉ đúng cho mode 'setup').
  // - 'setup' (mọi mode còn lại): chưa cấu hình thật → badge warn + 3 bước.
  function supabaseConnectionHtml(mode, me, hasSupabaseUser) {
    if (mode === 'supabase') {
      if (me && hasSupabaseUser) return '<p><span class="badge ok">Đã đăng nhập</span> ' + esc(me.name) + ' (' + esc(me.email || '') + ') — vai trò: ' + esc(me.roleLabel || labelStatus(me.role)) + '.</p>' +
        '<p><button class="btn secondary" data-action="sign-out">Đăng xuất</button></p>';
      return '<p><span class="badge ok">Đã cấu hình</span> App đã có thông tin kết nối. Đăng nhập bằng email/mật khẩu để vào workspace.</p>' +
        '<form class="inline" id="signin-form"><label>Email<input type="email" name="email" required></label><label>Mật khẩu<input type="password" name="password" required></label><button class="btn" type="submit">Đăng nhập</button></form>';
    }
    if (mode === 'demo') {
      return '<p><span class="badge ok">Supabase đã cấu hình</span></p>' +
        '<p>Bạn đang xem dữ liệu demo nên app chưa dùng dữ liệu thật. Supabase đã được cấu hình sẵn — bạn không cần tự cài đặt hay kết nối lại.</p>' +
        '<p>Để vào workspace thật, hãy tắt chế độ demo ở panel "Chế độ demo" bên dưới rồi đăng nhập bằng email/mật khẩu.</p>';
    }
    return '<p><span class="badge warn">Chờ kết nối Supabase</span></p><p>Hướng dẫn 3 bước:</p><ol>' +
      '<li>Tạo một Supabase project riêng cho Marketing Workspace.</li>' +
      '<li>Chạy các migration trong thư mục <code>supabase/</code> theo tài liệu thiết lập đi kèm repo.</li>' +
      '<li>Điền thông tin kết nối công khai vào file <code>config.js</code> — xem mẫu ở <code>config.example.js</code> — rồi tải lại trang.</li></ol>';
  }
  function viewSettings() {
    var ed = canEdit();
    var isOwner = canMemberManage();
    var html = pageHead('Thiết lập', 'Kết nối dữ liệu, thành viên & vai trò, BU/sản phẩm, năng lực làm việc và kết nối kênh.',
      isOwner ? '<button class="btn" data-action="editor-open" data-kind="invite">+ Mời thành viên</button>' : '');
    html += '<h2>Trạng thái kết nối Supabase</h2><div class="panel">';
    html += supabaseConnectionHtml(Store.mode, Store.currentUser(), !!Store.supabaseUser);
    html += '</div>';
    html += '<h2>Chế độ demo</h2><div class="panel">' +
      '<p>Trạng thái hiện tại: <strong>' + (Store.mode === 'demo' ? 'Đang bật — mọi màn hình đều có banner "Dữ liệu minh họa — không phải dữ liệu thật", và bộ đổi người dùng ở thanh trên chỉ xuất hiện trong chế độ này (ghi rõ "Chế độ demo")' : 'Đang tắt') + '</strong>.</p>' +
      (Store.mode === 'demo'
        ? '<button class="btn" data-action="demo-off">Tắt chế độ demo</button> <button class="btn secondary" data-action="demo-reset">Đặt lại dữ liệu demo</button>'
        : '<button class="btn" data-action="demo-on">Bật chế độ demo</button>') + '</div>';
    html += '<h2>Thành viên & vai trò</h2>';
    var members = Store.list('members');
    if (!members.length) html += '<div class="state-box">Chưa có thành viên (chưa kết nối dữ liệu).</div>';
    else html += tbl('<tr><th>Thành viên</th><th>Email</th><th>Vai trò</th><th>Activity</th><th>Năng lực / ngày nghỉ</th></tr>' + members.map(function (m) {
      var roleSel = '<select data-action-change="member-role" data-id="' + esc(m.id) + '"' + dis(!isOwner) + '>' + [['owner', 'Owner'], ['lead', 'Lead'], ['member', 'Member'], ['ceo', 'CEO (chỉ xem)']].map(function (r) { return '<option value="' + r[0] + '"' + (m.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>';
      var activeSel = '<select data-action-change="member-active" data-id="' + esc(m.id) + '"' + dis(!isOwner) + '><option value="1"' + (m.isActive !== false ? ' selected' : '') + '>Đang hoạt động</option><option value="0"' + (m.isActive === false ? ' selected' : '') + '>Ngừng hoạt động</option></select>';
      return '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.email) + '</td><td>' + (isOwner ? roleSel : esc(m.roleLabel || labelStatus(m.role))) + '</td><td>' + (isOwner ? activeSel : (m.isActive === false ? 'Ngừng hoạt động' : 'Đang hoạt động')) + '</td>' +
        '<td>' + (m.capacityHoursPerWeek !== null && m.capacityHoursPerWeek !== undefined ? esc(m.capacityHoursPerWeek) + ' giờ/tuần' : 'Chưa cấu hình') + ((m.daysOff || []).length ? '<br><span class="sub">Nghỉ: ' + m.daysOff.map(function (x) { return D.formatDateVN(x); }).join(', ') + '</span>' : '') + ' <button class="btn small secondary" data-action="editor-open" data-kind="memberCap" data-member="' + esc(m.id) + '"' + dis(!canSettings()) + '>Sửa</button></td></tr>';
    }).join(''), 'settings-members');
    if (!isOwner) html += '<p class="sub">Chỉ Owner mới đổi vai trò / trạng thái hoạt động của thành viên và gửi lời mời.</p>';
    html += '<h3>Ma trận quyền (4 vai)</h3>';
    var permKeys = Object.keys(Store.PERMISSION_LABELS || {});
    html += tbl('<tr><th>Quyền</th><th>Owner</th><th>Lead</th><th>Member</th><th>CEO</th></tr>' + permKeys.map(function (k) {
      function cell(role) {
        return Store.canRole(role, k)
          ? '<td class="perm-cell"><span class="perm-yes" title="Có quyền">✓</span></td>'
          : '<td class="perm-cell"><span class="perm-no" title="Không có quyền">—</span></td>';
      }
      return '<tr><td>' + esc(Store.PERMISSION_LABELS[k]) + '</td>' + cell('owner') + cell('lead') + cell('member') + cell('ceo') + '</tr>';
    }).join(''), 'settings-permissions');
    html += '<div class="toolbar"><h2 style="margin:0">BU / sản phẩm</h2>' + (canSettings() ? '<button class="btn small" data-action="editor-open" data-kind="bu">+ Thêm BU</button>' : '<span class="sub">Chỉ Owner quản lý BU/sản phẩm.</span>') + '</div>';
    html += Store.list('businessUnits').length
      ? tbl('<tr><th>BU</th><th>Sản phẩm</th><th>Mô tả</th><th>Thao tác</th></tr>' + Store.list('businessUnits').map(function (b) {
        return '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc((b.products || []).join(', ')) + '</td><td>' + esc(b.description || '—') + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="bu" data-id="' + esc(b.id) + '"' + dis(!canSettings()) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="businessUnits" data-id="' + esc(b.id) + '"' + dis(!canSettings()) + '>Lưu trữ</button></td></tr>';
      }).join(''), 'settings-bu')
      : '<div class="state-box">Chưa cấu hình BU/sản phẩm.</div>';
    html += '<h2>Danh sách kết nối kênh</h2>' + (Store.list('channelAccounts').length
      ? '<ul class="clean">' + Store.list('channelAccounts').map(function (a) { return '<li>' + esc(a.name) + ' (' + esc(labelStatus(a.platform)) + ') — ' + esc(a.status) + '</li>'; }).join('') + '</ul>'
      : '<div class="state-box">Chưa có kết nối kênh nào.</div>');
    return html;
  }

  // ---------- Đăng nhập / nhận lời mời / đặt mật khẩu ----------
  function viewInviteExpired() {
    return pageHead('Liên kết đã hết hạn', 'Liên kết mời / đặt lại mật khẩu không còn hiệu lực.') +
      '<div class="state-box"><p><strong>Liên kết đã hết hạn hoặc đã được dùng</strong></p>' +
      '<p>Liên kết trong email chỉ dùng được một lần và có thời hạn. Hãy nhờ Owner gửi lại lời mời mới, rồi mở liên kết mới nhất trong email.</p>' +
      '<p><button class="btn secondary" data-action="dismiss-invite">Đến trang đăng nhập</button></p></div>';
  }
  function viewSetPassword() {
    var inv = Store.pendingInvite || {};
    return pageHead(inv.type === 'recovery' ? 'Đặt lại mật khẩu' : 'Nhận lời mời — đặt mật khẩu',
      'Tạo mật khẩu cho tài khoản của bạn để bắt đầu dùng SAVA Marketing Workspace.') +
      '<div class="panel"><form class="inline" id="invite-password-form">' +
      '<label>Mật khẩu mới (tối thiểu 8 ký tự)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>' +
      '<label>Nhập lại mật khẩu<input type="password" name="passwordConfirm" required minlength="8" autocomplete="new-password"></label>' +
      '<button class="btn" type="submit">Đặt mật khẩu và vào app</button></form>' +
      '<p class="sub">Sau khi đặt mật khẩu thành công, bạn sẽ được đưa vào app với phiên đăng nhập chính thức.</p></div>';
  }
  function viewLogin() {
    return pageHead('Đăng nhập', 'Đăng nhập bằng email và mật khẩu để vào SAVA Marketing Workspace.') +
      '<div class="panel"><form class="inline" id="login-form">' +
      '<label>Email<input type="email" name="email" required autocomplete="username"></label>' +
      '<label>Mật khẩu<input type="password" name="password" required autocomplete="current-password"></label>' +
      '<button class="btn" type="submit">Đăng nhập</button></form>' +
      '<p class="sub">Chưa có tài khoản? Tài khoản do Owner mời qua email — hãy mở liên kết trong email mời để đặt mật khẩu lần đầu. Quên mật khẩu: nhờ Owner gửi liên kết đặt lại, hoặc dùng tính năng khôi phục của hệ thống tài khoản nếu đã bật.</p></div>';
  }
  function viewNoMembership() {
    return pageHead('Tài khoản chưa được gán quyền', 'Bạn đã đăng nhập nhưng chưa thuộc workspace nào.') +
      '<div class="state-box"><p><strong>Tài khoản chưa được gán quyền — liên hệ Owner</strong></p>' +
      '<p>Chủ workspace (Owner) cần thêm tài khoản của bạn vào workspace và gán vai trò (Owner / Lead / Member / CEO) thì dữ liệu mới hiện ra.</p>' +
      '<p><button class="btn secondary" data-action="sign-out">Đăng xuất</button></p></div>';
  }

  // ---------- Router / khởi tạo ----------
  var VIEWS = {
    'overview': viewOverview, 'my-work': viewMyWork, 'brand': viewBrand, 'campaigns': viewCampaigns,
    'timeline': viewTimeline, 'content': viewContent, 'tasks': viewTasks, 'approvals': viewApprovals, 'team': viewTeam,
    'kpi': viewKpi, 'channels': viewChannels, 'ads': viewAds, 'reports': viewReports, 'settings': viewSettings
  };
  function authGateView() {
    if (Store.pendingInvite && Store.pendingInvite.expired) return viewInviteExpired();
    if (Store.pendingInvite) return viewSetPassword();
    if (Store.state.noMembership) return viewNoMembership();
    if (Store.state.authRequired) return viewLogin();
    return null;
  }
  function renderNav() {
    var route = ROUTE;
    var nav = document.getElementById('main-nav');
    if (nav) {
      nav.innerHTML = NAV_GROUPS.map(function (g) {
        return '<div class="nav-group"><div class="nav-group-title">' + esc(g[0]) + '</div>' + g[1].map(function (n) {
          return '<a href="#/' + n[0] + '"' + (route.name === n[0] ? ' class="active"' : '') + '>' + esc(n[1]) + '</a>';
        }).join('') + '</div>';
      }).join('');
    }
    var me = Store.currentUser ? Store.currentUser() : null;
    var userEl = document.getElementById('topbar-user');
    if (userEl) userEl.innerHTML = me ? '<strong>' + esc(me.name) + '</strong> <span class="sub">· ' + esc(me.roleLabel || labelStatus(me.role)) + '</span>' : '';
    var pickerWrap = document.getElementById('demo-user-picker');
    if (pickerWrap) pickerWrap.hidden = Store.mode !== 'demo';
    var sel = document.getElementById('current-user-select');
    if (sel) {
      var members = Store.list('members');
      sel.innerHTML = members.length ? members.map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (Store.currentUserId === m.id ? ' selected' : '') + '>' + esc(m.name) + ' (' + esc(m.roleLabel || labelStatus(m.role)) + ')</option>';
      }).join('') : '<option>— Chưa có người dùng —</option>';
      sel.disabled = Store.mode !== 'demo';
    }
    var signOutBtn = document.getElementById('sign-out-btn');
    if (signOutBtn) signOutBtn.hidden = Store.mode === 'demo' || !Store.supabaseUser;
    var conn = document.getElementById('connection-status');
    if (conn) conn.textContent = Store.mode === 'demo' ? 'Chế độ: Dữ liệu minh họa (demo)' : (Store.mode === 'supabase' ? 'Chế độ: Dữ liệu thật' : 'Chờ kết nối Supabase');
    var wsName = document.getElementById('workspace-name');
    if (wsName) wsName.textContent = 'SAVA Marketing Workspace';
  }
  function renderOverlay() {
    var root = document.getElementById('overlay-root');
    if (!root) return;
    root.innerHTML = editorHtml() + taskPanelHtml() + activityDrawerHtml() + confirmCloseHtml();
  }
  function render() {
    ROUTE = parseRoute();
    demoBanner();
    renderNav();
    var app = document.getElementById('app');
    var gate = authGateView();
    var baseChanged = UI.lastBase !== ROUTE.name;
    if (gate) { app.innerHTML = gate; }
    else if (Store.setupNeeded && ROUTE.name !== 'settings') { app.innerHTML = setupNotice(); }
    else {
      try { app.innerHTML = VIEWS[ROUTE.name](); }
      catch (e) { app.innerHTML = '<div class="notice bad">Đã xảy ra lỗi khi hiển thị: ' + esc(e.message) + '</div>'; }
    }
    renderOverlay();
    // R2-26: nút "Hôm nay" — cuộn biểu đồ kế hoạch tới vạch hôm nay.
    if (UI.ganttScrollToday) {
      UI.ganttScrollToday = false;
      var tw = document.querySelector('.g2-today');
      var wrap = document.querySelector('.g2-wrap');
      if (tw && wrap) { var tl = parseFloat(tw.style.left) || 0; wrap.scrollLeft = Math.max(0, GANTT_NAME_W + tl - 320); }
    }
    // Điều hướng: vào route mới thì về đầu trang; ở lại cùng route (lọc/panel) thì giữ vị trí cuộn của list.
    if (baseChanged) { UI.lastBase = ROUTE.name; window.scrollTo(0, 0); }
    else if (UI.scrollMem[routeKey(ROUTE)] !== undefined && !UI.editor) {
      window.scrollTo(0, UI.scrollMem[routeKey(ROUTE)]);
    }
  }
  window.addEventListener('scroll', function () {
    if (ROUTE) UI.scrollMem[routeKey(ROUTE)] = window.scrollY;
  }, { passive: true });

  // ---------- R3.1-EXPORT (AC22): export CSV KPI / ngân sách / thu–chi ----------
  // Cấu trúc đã chọn — mỗi loại dữ liệu là MỘT file CSV với header rõ nghĩa:
  // - KPI (sava-kpi.csv): 1 dòng / KPI thuộc đúng tập trang "KPI & Ngân sách"
  //   đang hiển thị (Store.list('kpis') như viewKpi — trang này không có bộ
  //   lọc riêng, nên phạm vi export = phạm vi trang). Giá trị actual và trạng
  //   thái dữ liệu do ADAPTER tính bằng kpiRollupFor (D.rollupKpi — cùng số
  //   UI đang hiển thị) rồi truyền vào qua opts.rollups; builder không tự
  //   tính lại KPI.
  // - Ngân sách (sava-ngan-sach.csv): 1 file, nhiều row_type trên CÙNG header:
  //   budget_line (dòng gốc, planned/approved riêng + actual/open/remaining
  //   theo đúng cách viewKpi tính cho từng dòng: Σ actual liên kết,
  //   D.openCommitmentTotal, D.budgetRemaining), commitment / actual /
  //   allocation (fact gốc có ID), và summary_activity / summary_campaign
  //   (tổng hợp qua summarizeActivityBudget / summarizeCampaignBudget →
  //   D.summarizeBudgetScope, kèm ceiling của campaign). row_type +
  //   scope_type giúp người đọc Excel lọc từng lớp mà không cộng lẫn hạn
  //   mức với fact gốc.
  // - Thu–Chi (sava-thu-chi.csv): 1 dòng / giao dịch cashTransactions.
  // Quyền: export lấy đúng nguồn dữ liệu trang đã dùng (đã qua quyền/scope
  // của Store); riêng ngân sách + thu–chi bị chặn khi !canBudget() — cùng
  // cổng ẩn số liệu của viewKpi — nên vai chỉ xem (CEO) vẫn export được KPI
  // mình được xem nhưng không lộ thêm ngân sách.
  // Vùng PURE dưới đây chỉ ĐÓNG GÓI dòng + escape CSV từ dữ liệu và kết quả
  // domain đã tính — không chạm Store/D, không định nghĩa công thức mới.
  // R3.1-EXPORT-PURE-BEGIN
  var KPI_EXPORT_COLUMNS = ['id', 'scope_type', 'campaign_id', 'activity_id', 'task_id', 'content_item_id', 'pillar_id', 'metric_code', 'name', 'definition', 'aggregation_mode', 'target', 'actual', 'unit', 'period_start', 'period_end', 'period_key', 'currency', 'owner_id', 'owner_name', 'target_version', 'data_status'];
  var BUDGET_EXPORT_COLUMNS = ['id', 'row_type', 'scope_type', 'campaign_id', 'activity_id', 'task_id', 'budget_line_id', 'commitment_id', 'title', 'planned', 'approved', 'amount', 'share_percent', 'allocated', 'unallocated', 'actual_total', 'open_commitments', 'forecast_use', 'available', 'ceiling', 'currency', 'period_start', 'period_end', 'date', 'status'];
  var CASH_EXPORT_COLUMNS = ['id', 'account_id', 'account_name', 'category_id', 'category', 'direction', 'amount', 'currency', 'occurred_on', 'campaign_id', 'activity_id', 'title', 'note', 'status'];
  function r31CsvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function r31RowsToCsv(columns, rows) {
    var lines = [columns.map(r31CsvCell).join(',')];
    (rows || []).forEach(function (r) {
      lines.push(columns.map(function (c) { return r31CsvCell(r ? r[c] : ''); }).join(','));
    });
    return lines.join('\n');
  }
  function r31Field(obj, camel, snake) {
    if (!obj) return undefined;
    if (obj[camel] !== undefined && obj[camel] !== null) return obj[camel];
    if (snake && obj[snake] !== undefined && obj[snake] !== null) return obj[snake];
    if (obj.customFields && obj.customFields[camel] !== undefined && obj.customFields[camel] !== null) return obj.customFields[camel];
    if (obj.custom_fields && obj.custom_fields[camel] !== undefined && obj.custom_fields[camel] !== null) return obj.custom_fields[camel];
    return undefined;
  }
  function r31NumOrEmpty(v) { return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? '' : Number(v); }
  function r31KpiDefinitionText(k) {
    var d = r31Field(k, 'definition');
    if (d === undefined || d === null) return '';
    if (typeof d === 'string') return d;
    if (typeof d === 'object') return d.description || d.how || JSON.stringify(d);
    return String(d);
  }
  function buildKpiExportRows(kpis, opts) {
    opts = opts || {};
    var rollups = opts.rollups || {};
    var ownerNames = opts.ownerNames || {};
    return (kpis || []).map(function (k) {
      var activityId = r31Field(k, 'activityId', 'activity_id') || '';
      var taskId = r31Field(k, 'taskId', 'task_id') || '';
      var contentItemId = r31Field(k, 'contentItemId', 'content_item_id') || '';
      var pillarId = r31Field(k, 'pillarId', 'pillar_id') || '';
      var scopeType = r31Field(k, 'scopeType', 'scope_type') || (activityId ? 'activity' : (taskId ? 'task' : (contentItemId ? 'content' : (pillarId ? 'pillar' : 'campaign'))));
      var roll = rollups[k.id];
      var actual = '';
      var dataStatus = 'insufficient_data';
      if (roll) {
        if (roll.status !== 'insufficient_data' && roll.value !== null && roll.value !== undefined && roll.value !== '' && !isNaN(Number(roll.value))) { actual = Number(roll.value); dataStatus = 'ok'; }
      } else {
        var av = r31Field(k, 'actual');
        if (av !== undefined && av !== null && av !== '' && !isNaN(Number(av))) { actual = Number(av); dataStatus = 'ok'; }
      }
      var ownerId = r31Field(k, 'ownerId', 'owner_id') || '';
      var targetRaw = (k.target !== undefined && k.target !== null) ? k.target : ((k.targetValue !== undefined && k.targetValue !== null) ? k.targetValue : r31Field(k, 'target', 'target_value'));
      var targetVersion = r31Field(k, 'targetVersion', 'target_version');
      return {
        id: k.id || '', scope_type: scopeType,
        campaign_id: r31Field(k, 'campaignId', 'campaign_id') || '',
        activity_id: activityId, task_id: taskId, content_item_id: contentItemId, pillar_id: pillarId,
        metric_code: r31Field(k, 'metricCode', 'metric_code') || '',
        name: r31Field(k, 'name') || '', definition: r31KpiDefinitionText(k),
        aggregation_mode: r31Field(k, 'aggregationMode', 'aggregation_mode') || '',
        target: r31NumOrEmpty(targetRaw), actual: actual,
        unit: r31Field(k, 'unit') || '',
        period_start: r31Field(k, 'periodStart', 'period_start') || '',
        period_end: r31Field(k, 'periodEnd', 'period_end') || '',
        period_key: r31Field(k, 'periodKey', 'period_key') || r31Field(k, 'period') || '',
        currency: r31Field(k, 'currency') || '',
        owner_id: ownerId, owner_name: ownerId ? (ownerNames[ownerId] || '') : '',
        target_version: (targetVersion === undefined || targetVersion === null) ? '' : targetVersion,
        data_status: dataStatus
      };
    });
  }
  function buildBudgetExportRows(input) {
    input = input || {};
    var lines = input.lines || [];
    var commitments = input.commitments || [];
    var actuals = input.actuals || [];
    var allocations = input.allocations || [];
    var summaries = input.summaries || [];
    var lineStats = input.lineStats || {};
    var lineById = {};
    lines.forEach(function (l) { lineById[l.id] = l; });
    var rows = [];
    function factScope(fact, line) {
      var campaignId = r31Field(fact, 'campaignId', 'campaign_id') || (line ? (r31Field(line, 'campaignId', 'campaign_id') || '') : '');
      var activityId = r31Field(fact, 'activityId', 'activity_id') || (line ? (r31Field(line, 'activityId', 'activity_id') || '') : '');
      var taskId = r31Field(fact, 'taskId', 'task_id') || (line ? (r31Field(line, 'taskId', 'task_id') || '') : '');
      return { campaignId: campaignId, activityId: activityId, taskId: taskId, scopeType: activityId ? 'activity' : 'campaign' };
    }
    lines.forEach(function (l) {
      var st = lineStats[l.id] || {};
      var activityId = r31Field(l, 'activityId', 'activity_id') || '';
      var forecast = (st.forecastUse !== undefined && st.forecastUse !== null) ? r31NumOrEmpty(st.forecastUse)
        : ((st.actualTotal !== undefined && st.actualTotal !== null && st.openCommitments !== undefined && st.openCommitments !== null) ? Number(st.actualTotal) + Number(st.openCommitments) : '');
      rows.push({
        id: l.id || '', row_type: 'budget_line', scope_type: activityId ? 'activity' : 'campaign',
        campaign_id: r31Field(l, 'campaignId', 'campaign_id') || '', activity_id: activityId,
        task_id: r31Field(l, 'taskId', 'task_id') || '', budget_line_id: l.id || '', commitment_id: '',
        title: r31Field(l, 'name') || r31Field(l, 'title') || '',
        planned: r31NumOrEmpty((l.planned !== undefined && l.planned !== null) ? l.planned : r31Field(l, 'planned', 'planned_amount')),
        approved: r31NumOrEmpty((l.approved !== undefined && l.approved !== null) ? l.approved : r31Field(l, 'approved', 'approved_amount')),
        amount: '', share_percent: '', allocated: '', unallocated: '',
        actual_total: r31NumOrEmpty(st.actualTotal), open_commitments: r31NumOrEmpty(st.openCommitments),
        forecast_use: forecast,
        // Với dòng ngân sách, "available" = còn phân bổ theo D.budgetRemaining (khớp cột "Còn lại" của UI).
        available: r31NumOrEmpty(st.remaining), ceiling: '',
        currency: r31Field(l, 'currency') || '',
        period_start: r31Field(l, 'periodStart', 'period_start') || '', period_end: r31Field(l, 'periodEnd', 'period_end') || '',
        date: '',
        status: r31Field(l, 'status') || ((st.remaining !== undefined && st.remaining !== null) ? (Number(st.remaining) < 0 ? 'over_budget' : 'within_budget') : '')
      });
    });
    commitments.forEach(function (f) {
      var line = lineById[r31Field(f, 'budgetLineId', 'budget_line_id')];
      var sc = factScope(f, line);
      rows.push({
        id: f.id || '', row_type: 'commitment', scope_type: sc.scopeType,
        campaign_id: sc.campaignId, activity_id: sc.activityId, task_id: sc.taskId,
        budget_line_id: r31Field(f, 'budgetLineId', 'budget_line_id') || '', commitment_id: '',
        title: r31Field(f, 'title') || r31Field(f, 'description') || '',
        planned: '', approved: '', amount: r31NumOrEmpty(r31Field(f, 'amount')), share_percent: '',
        allocated: '', unallocated: '', actual_total: '', open_commitments: '', forecast_use: '', available: '', ceiling: '',
        currency: r31Field(f, 'currency') || (line ? (r31Field(line, 'currency') || '') : ''),
        period_start: line ? (r31Field(line, 'periodStart', 'period_start') || '') : '', period_end: line ? (r31Field(line, 'periodEnd', 'period_end') || '') : '',
        date: r31Field(f, 'date') || r31Field(f, 'committedAt', 'committed_at') || r31Field(f, 'expectedAt', 'expected_at') || '',
        status: r31Field(f, 'status') || ''
      });
    });
    actuals.forEach(function (f) {
      var line = lineById[r31Field(f, 'budgetLineId', 'budget_line_id')];
      var sc = factScope(f, line);
      rows.push({
        id: f.id || '', row_type: 'actual', scope_type: sc.scopeType,
        campaign_id: sc.campaignId, activity_id: sc.activityId, task_id: sc.taskId,
        budget_line_id: r31Field(f, 'budgetLineId', 'budget_line_id') || '', commitment_id: r31Field(f, 'commitmentId', 'commitment_id') || '',
        title: r31Field(f, 'title') || r31Field(f, 'description') || '',
        planned: '', approved: '', amount: r31NumOrEmpty(r31Field(f, 'amount')), share_percent: '',
        allocated: '', unallocated: '', actual_total: '', open_commitments: '', forecast_use: '', available: '', ceiling: '',
        currency: r31Field(f, 'currency') || (line ? (r31Field(line, 'currency') || '') : ''),
        period_start: line ? (r31Field(line, 'periodStart', 'period_start') || '') : '', period_end: line ? (r31Field(line, 'periodEnd', 'period_end') || '') : '',
        date: r31Field(f, 'date') || r31Field(f, 'spentAt', 'spent_at') || '',
        status: r31Field(f, 'status') || ''
      });
    });
    allocations.forEach(function (a) {
      var srcKind = r31Field(a, 'sourceKind', 'source_kind') || 'actual';
      var srcId = srcKind === 'commitment' ? (r31Field(a, 'commitmentId', 'commitment_id') || '') : (r31Field(a, 'actualId', 'actual_id') || '');
      var srcFact = (srcKind === 'commitment' ? commitments : actuals).filter(function (x) { return String(x.id) === String(srcId); })[0] || null;
      var line = srcFact ? lineById[r31Field(srcFact, 'budgetLineId', 'budget_line_id')] : null;
      var sc = srcFact ? factScope(srcFact, line) : { campaignId: '', activityId: '', taskId: '', scopeType: 'campaign' };
      var activityId = r31Field(a, 'activityId', 'activity_id') || sc.activityId;
      rows.push({
        id: a.id || '', row_type: 'allocation', scope_type: activityId ? 'activity' : sc.scopeType,
        campaign_id: r31Field(a, 'campaignId', 'campaign_id') || sc.campaignId, activity_id: activityId, task_id: sc.taskId,
        budget_line_id: srcFact ? (r31Field(srcFact, 'budgetLineId', 'budget_line_id') || '') : '',
        commitment_id: srcKind === 'commitment' ? srcId : (srcFact ? (r31Field(srcFact, 'commitmentId', 'commitment_id') || '') : ''),
        title: srcFact ? (r31Field(srcFact, 'title') || r31Field(srcFact, 'description') || '') : '',
        planned: '', approved: '', amount: r31NumOrEmpty(r31Field(a, 'amount')), share_percent: r31NumOrEmpty(r31Field(a, 'sharePercent', 'share_percent')),
        allocated: '', unallocated: '', actual_total: '', open_commitments: '', forecast_use: '', available: '', ceiling: '',
        currency: r31Field(a, 'currency') || (srcFact ? (r31Field(srcFact, 'currency') || '') : '') || (line ? (r31Field(line, 'currency') || '') : ''),
        period_start: line ? (r31Field(line, 'periodStart', 'period_start') || '') : '', period_end: line ? (r31Field(line, 'periodEnd', 'period_end') || '') : '',
        date: r31Field(a, 'effectiveDate', 'effective_date') || '',
        status: ''
      });
    });
    summaries.forEach(function (s) {
      rows.push({
        id: s.scopeType === 'campaign' ? (s.campaignId || '') : (s.activityId || ''),
        row_type: s.scopeType === 'campaign' ? 'summary_campaign' : 'summary_activity', scope_type: s.scopeType || '',
        campaign_id: s.campaignId || '', activity_id: s.activityId || '', task_id: '', budget_line_id: '', commitment_id: '',
        title: s.title || '', planned: '', approved: '', amount: '', share_percent: '',
        allocated: r31NumOrEmpty(s.allocated), unallocated: r31NumOrEmpty(s.unallocated),
        actual_total: r31NumOrEmpty(s.actualTotal), open_commitments: r31NumOrEmpty(s.openCommitments),
        forecast_use: r31NumOrEmpty(s.forecastUse), available: r31NumOrEmpty(s.available), ceiling: r31NumOrEmpty(s.ceiling),
        currency: s.currency || '', period_start: '', period_end: '', date: '', status: ''
      });
    });
    return rows;
  }
  function buildCashExportRows(txns, opts) {
    opts = opts || {};
    var accountNames = opts.accountNames || {};
    var accountCurrencies = opts.accountCurrencies || {};
    var categoryNames = opts.categoryNames || {};
    return (txns || []).map(function (t) {
      var accountId = r31Field(t, 'accountId', 'account_id') || '';
      var categoryId = r31Field(t, 'categoryId', 'category_id') || '';
      return {
        id: t.id || '', account_id: accountId, account_name: accountId ? (accountNames[accountId] || '') : '',
        category_id: categoryId, category: categoryId ? (categoryNames[categoryId] || '') : (r31Field(t, 'category') || ''),
        direction: r31Field(t, 'direction') || '', amount: r31NumOrEmpty(r31Field(t, 'amount')),
        currency: r31Field(t, 'currency') || (accountId ? (accountCurrencies[accountId] || '') : ''),
        occurred_on: r31Field(t, 'occurredOn', 'occurred_on') || r31Field(t, 'date') || '',
        campaign_id: r31Field(t, 'campaignId', 'campaign_id') || '', activity_id: r31Field(t, 'activityId', 'activity_id') || '',
        title: r31Field(t, 'title') || '', note: r31Field(t, 'note') || r31Field(t, 'description') || '',
        status: r31Field(t, 'status') || ''
      };
    });
  }
  // R3.1-EXPORT-PURE-END
  // --- Adapter export: lấy đúng dữ liệu + hàm domain mà trang KPI & Ngân sách đang dùng ---
  function downloadCsvText(filename, csvText) {
    var blob = new Blob(['\ufeff' + csvText], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exportKpiCsv() {
    var kpis = Store.list('kpis');
    var ownerNames = {};
    Store.list('members').forEach(function (m) { ownerNames[m.id] = m.name || ''; });
    var rollups = {};
    kpis.forEach(function (k) {
      var roll = kpiRollupFor(k);
      if (roll) {
        var mode = String(k.aggregationMode || k.aggregation_mode || '').toLowerCase();
        // Khớp cách viewKpi hiển thị: ratio làm tròn về số nguyên, còn lại giữ nguyên giá trị rollup.
        rollups[k.id] = { value: (roll.value === null || roll.value === undefined) ? null : (mode === 'ratio' ? Math.round(roll.value) : roll.value), status: roll.status || 'ok' };
      } else {
        var d = D.kpiDisplay(k);
        rollups[k.id] = d.isMissing ? { value: null, status: 'insufficient_data' } : { value: d.value, status: 'ok' };
      }
    });
    downloadCsvText('sava-kpi.csv', r31RowsToCsv(KPI_EXPORT_COLUMNS, buildKpiExportRows(kpis, { rollups: rollups, ownerNames: ownerNames })));
  }
  function exportBudgetCsv() {
    if (!canBudget()) { toast('Vai trò hiện tại không có quyền xem ngân sách nên không xuất được dữ liệu ngân sách.'); return; }
    var lines = visibleList('budgetLines');
    var lineIds = {};
    lines.forEach(function (l) { lineIds[l.id] = true; });
    var commitments = Store.list('commitments').filter(function (x) { return !!lineIds[x.budgetLineId]; });
    var actuals = Store.list('actuals').filter(function (x) { return !!lineIds[x.budgetLineId]; });
    var actualIds = {};
    var commitmentIds = {};
    actuals.forEach(function (x) { actualIds[x.id] = true; });
    commitments.forEach(function (x) { commitmentIds[x.id] = true; });
    var allocations = listSafe('budgetAllocations').filter(function (a) {
      var kind = a.sourceKind || a.source_kind || 'actual';
      return kind === 'commitment' ? !!commitmentIds[a.commitmentId || a.commitment_id] : !!actualIds[a.actualId || a.actual_id];
    });
    var lineStats = {};
    lines.forEach(function (l) {
      var cs = commitments.filter(function (x) { return x.budgetLineId === l.id; });
      var as = actuals.filter(function (x) { return x.budgetLineId === l.id; });
      lineStats[l.id] = {
        actualTotal: as.reduce(function (s, x) { return s + Number(x.amount || 0); }, 0),
        openCommitments: (typeof D.openCommitmentTotal === 'function') ? D.openCommitmentTotal(cs, as) : 0,
        remaining: D.budgetRemaining(l, cs, as)
      };
    });
    var summaries = [];
    visibleList('campaigns').forEach(function (c) {
      summarizeCampaignBudget(c).forEach(function (r) {
        if (r.ceiling > 0 || r.allocated > 0 || r.actualTotal > 0 || r.openCommitments > 0) {
          summaries.push({ scopeType: 'campaign', campaignId: c.id, title: c.name, currency: r.currency, ceiling: r.ceiling, allocated: r.allocated, unallocated: r.unallocated, actualTotal: r.actualTotal, openCommitments: r.openCommitments, forecastUse: r.forecastUse, available: r.available });
        }
      });
      Store.list('activities').filter(function (a) { return a.campaignId === c.id; }).forEach(function (a) {
        summarizeActivityBudget(c, a).forEach(function (r) {
          if (r.ceiling > 0 || r.actualTotal > 0 || r.openCommitments > 0) {
            summaries.push({ scopeType: 'activity', campaignId: c.id, activityId: a.id, title: a.name, currency: r.currency, ceiling: r.ceiling, allocated: r.allocated, unallocated: r.unallocated, actualTotal: r.actualTotal, openCommitments: r.openCommitments, forecastUse: r.forecastUse, available: r.available });
          }
        });
      });
    });
    downloadCsvText('sava-ngan-sach.csv', r31RowsToCsv(BUDGET_EXPORT_COLUMNS, buildBudgetExportRows({ lines: lines, commitments: commitments, actuals: actuals, allocations: allocations, summaries: summaries, lineStats: lineStats })));
  }
  function exportCashCsv() {
    if (!canBudget()) { toast('Vai trò hiện tại không có quyền xem ngân sách nên không xuất được dữ liệu thu–chi.'); return; }
    var accountNames = {};
    var accountCurrencies = {};
    var categoryNames = {};
    listSafe('cashAccounts').forEach(function (a) { accountNames[a.id] = a.name || a.title || ''; accountCurrencies[a.id] = a.currency || 'VND'; });
    listSafe('cashCategories').forEach(function (ct) { categoryNames[ct.id] = ct.name || ''; });
    downloadCsvText('sava-thu-chi.csv', r31RowsToCsv(CASH_EXPORT_COLUMNS, buildCashExportRows(listSafe('cashTransactions'), { accountNames: accountNames, accountCurrencies: accountCurrencies, categoryNames: categoryNames })));
  }

  function exportCsv() {
    var rows = UI.reportRowsCache || [];
    // R2-21: CSV có cột currency — mỗi dòng thuộc đúng một tiền tệ, không cộng chéo.
    var head = 'level,name,status,currency,spend,impressions,clicks,results,conversionValue';
    function cell(v) { return (v === null || v === undefined) ? '' : v; }
    var lines = rows.map(function (r) {
      return [r.level, '"' + String(r.name || '').replace(/"/g, '""') + '"', cell(r.status), cell(r.currency || ''), cell(r.spend), cell(r.impressions), cell(r.clicks), cell(r.results), cell(r.conversionValue)].join(',');
    });
    var blob = new Blob(['\ufeff' + head + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sava-bao-cao-' + UI.report.level + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------- Tìm kiếm toàn cục ----------
  function runGlobalSearch(q) {
    var box = document.getElementById('search-results');
    if (!box) return;
    q = String(q || '').trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    function hit(x, fields) { return fields.some(function (f) { return String(x[f] || '').toLowerCase().indexOf(q) !== -1; }); }
    var out = [];
    visibleList('campaigns').filter(function (c) { return hit(c, ['name', 'bigIdea', 'keyMessage']); }).slice(0, 4).forEach(function (c) { out.push('<a href="#/campaigns/' + esc(c.id) + '">Campaign: ' + esc(c.name) + '</a>'); });
    visibleList('tasks').filter(function (t) { return hit(t, ['title', 'deliverable']); }).slice(0, 4).forEach(function (t) { out.push('<button type="button" data-action="open-task" data-id="' + esc(t.id) + '">Task: ' + esc(t.title) + '</button>'); });
    visibleList('contentItems').filter(function (x) { return hit(x, ['title', 'brief']); }).slice(0, 4).forEach(function (x) { out.push('<a href="#/content">Content: ' + esc(x.title) + '</a>'); });
    visibleList('brandPages').filter(function (x) { return hit(x, ['title', 'summary']); }).slice(0, 3).forEach(function (x) { out.push('<a href="#/brand">Trang thương hiệu: ' + esc(x.title) + '</a>'); });
    visibleList('brandAssets').filter(function (x) { return hit(x, ['name', 'type']); }).slice(0, 3).forEach(function (x) { out.push('<a href="#/brand">Tài nguyên: ' + esc(x.name) + '</a>'); });
    box.innerHTML = out.length ? out.join('') : '<span class="sub">Không tìm thấy kết quả.</span>';
    box.hidden = false;
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', function (ev) {
    var anchorEl = ev.target.closest ? ev.target.closest('[data-kpi-anchor]') : null;
    if (anchorEl) { ev.preventDefault(); var target = document.getElementById('kpi-sec-' + anchorEl.getAttribute('data-kpi-anchor')); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    var sb = document.getElementById('search-results');
    if (sb && !ev.target.closest('#global-search-form')) sb.hidden = true;
    var t = ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!t) return;
    var action = t.getAttribute('data-action');
    var id = t.getAttribute('data-id');
    if (action === 'nav-toggle') {
      var sidebar = document.getElementById('sidebar');
      var backdrop = document.getElementById('sidebar-backdrop');
      var open = sidebar.classList.toggle('open');
      if (backdrop) backdrop.hidden = !open;
    }
    if (action === 'sidebar-close') {
      document.getElementById('sidebar').classList.remove('open');
      var bd = document.getElementById('sidebar-backdrop'); if (bd) bd.hidden = true;
    }
    if (action === 'retry-load') {
      if (hasFn('reload')) { settle(Store.reload(), function () { UI.booted = true; render(); }); }
      else if (hasFn('load')) { Store.load().then(function () { UI.booted = true; render(); }); }
      else window.location.reload();
    }
    if (action === 'editor-open') {
      if (!canEdit() && t.getAttribute('data-kind') !== 'snapshot' && t.getAttribute('data-kind') !== 'tiktokMetric') { /* các nút đã disabled; phòng thủ thêm */ }
      var kind = t.getAttribute('data-kind');
      var context = {};
      if (t.getAttribute('data-campaign')) context.campaignId = t.getAttribute('data-campaign');
      if (t.getAttribute('data-activity')) context.activityId = t.getAttribute('data-activity');
      if (t.getAttribute('data-task')) context.taskId = t.getAttribute('data-task');
      if (t.getAttribute('data-source-kind')) context.sourceKind = t.getAttribute('data-source-kind');
      if (t.getAttribute('data-source-id')) context.sourceId = t.getAttribute('data-source-id');
      if (t.getAttribute('data-content')) context.contentItemId = t.getAttribute('data-content');
      if (t.getAttribute('data-kpi')) context.kpiId = t.getAttribute('data-kpi');
      if (t.getAttribute('data-line')) context.budgetLineId = t.getAttribute('data-line');
      if (t.getAttribute('data-commitment')) context.commitmentId = t.getAttribute('data-commitment');
      if (t.getAttribute('data-member')) context.memberId = t.getAttribute('data-member');
      if (t.getAttribute('data-target-type')) context.targetType = t.getAttribute('data-target-type');
      if (kind === 'tiktokMetric') context.variantId = id;
      if (kind === 'snapshot') {
        var aggC = UI.reportAggCache || {};
        // R2-22: snapshot chỉ chốt metrics ĐÚNG scope đang lọc (theo từng
        // tiền tệ) kèm filter đầy đủ để in lại phạm vi khi xem.
        context.metrics = { byCurrency: aggC.byCurrency || {}, mixed: !!aggC.mixed, hasData: !!aggC.hasData };
        context.filter = { level: aggC.level, accountId: aggC.accountId, campaignId: aggC.campaignId, from: aggC.from, to: aggC.to, currencies: Object.keys(aggC.byCurrency || {}) };
      }
      if (kind === 'measurement') { openEditor('measurement', null, context); return; }
      openEditor(kind, id, context);
    }
    if (action === 'editor-close' || action === 'editor-backdrop') { if (action === 'editor-close' || ev.target === t) requestCloseEditor(); }
    if (action === 'confirm-continue') { UI.confirmClose = null; renderOverlay(); }
    if (action === 'confirm-discard') {
      var target = UI.confirmClose && UI.confirmClose.target;
      UI.confirmClose = null;
      if (target === 'panel') { UI.taskDraft = null; UI.taskDraftConflict = false; closeTaskPanel(); }
      else closeEditor();
    }
    if (action === 'confirm-save') {
      var target2 = UI.confirmClose && UI.confirmClose.target;
      UI.confirmClose = null;
      renderOverlay();
      var formToSubmit = document.querySelector(target2 === 'panel' ? '#task-panel-form' : 'form[data-editor-form]');
      if (formToSubmit) { if (formToSubmit.requestSubmit) formToSubmit.requestSubmit(); else formToSubmit.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
    }
    if (action === 'scene-add' || action === 'scene-remove') {
      var form = t.closest('form');
      captureEditorValues(form);
      var scenes = UI.editor.scenes || [];
      if (action === 'scene-add') scenes.push({ shot: scenes.length + 1, visual: '', dialogue: '', onScreenText: '', durationSec: '', hook: '', cta: '' });
      else scenes.splice(Number(id), 1);
      UI.editor.scenes = scenes;
      renderOverlay();
    }
    if (action === 'open-task') openTaskPanel(id);
    if (action === 'task-close') requestCloseTaskPanel();
    if (action === 'archive-item' || action === 'restore-item') {
      var coll = t.getAttribute('data-coll');
      var fn = action === 'archive-item' ? sArchive : sRestore;
      settle(fn(coll, id), function () { toast(action === 'archive-item' ? 'Đã lưu trữ. Có thể khôi phục ở mục đã lưu trữ.' : 'Đã khôi phục.'); if (UI.taskPanelId === id) UI.taskPanelId = null; render(); });
    }
    if (action === 'task-archive') { settle(sArchive('tasks', id), function () { toast('Đã lưu trữ task.'); closeTaskPanel(); render(); }); }
    if (action === 'task-restore') { settle(sRestore('tasks', id), function () { toast('Đã khôi phục task.'); render(); }); }
    if (action === 'checklist-remove') {
      captureTaskDraft();
      var task = taskById(id); var idx = Number(t.getAttribute('data-idx'));
      if (task) { var cl = (task.checklist || []).slice(); cl.splice(idx, 1); settle(sUpdate('tasks', id, { checklist: cl }), function () { render(); }); }
    }
    if (action === 'dep-remove') { captureTaskDraft(); settle(hasFn('remove') ? Store.remove('dependencies', id) : { ok: false, error: 'Tầng dữ liệu chưa hỗ trợ xóa quan hệ.' }, function () { render(); }); }
    if (action === 'brand-tab') { UI.brandTab = id; render(); }
    if (action === 'brand-open') { UI.brandOpenId = UI.brandOpenId === id ? null : id; render(); }
    if (action === 'brand-clear') { UI.brandQuery = ''; render(); }
    if (action === 'post-metrics') { UI.postOpenId = UI.postOpenId === id ? null : id; render(); }
    if (action === 'kpi-drill') { UI.kpiOpenId = UI.kpiOpenId === id ? null : id; render(); }
    if (action === 'content-tab') { UI.contentTab = id; render(); }
    if (action === 'activity-open') { UI.activityDrawerId = id; UI.activityTab = 'overview'; renderOverlay(); }
    if (action === 'activity-close') { UI.activityDrawerId = null; renderOverlay(); }
    if (action === 'activity-tab') { UI.activityTab = id; renderOverlay(); }
    if (action === 'action-group') { UI.actionGroupBy = id || 'phase'; render(); }
    if (action === 'report-view') { UI.report.view = id; render(); }
    if (action === 'report-clear') { UI.report = { view: UI.report.view, level: 'campaign', accountId: 'all', campaignId: 'all', from: '', to: '' }; render(); }
    if (action === 'cal-today') { var n = new Date(); UI.calYear = n.getFullYear(); UI.calMonth = n.getMonth(); render(); }
    if (action === 'cal-day') {
      // Không kích hoạt khi bấm vào chip nội dung trong ô ngày
      if (ev.target.closest('[data-action="chip-variant"]')) return;
      // R3.1 C.6.3: tạo từ ô ngày CHỈ điền lịch cho lần đăng đó (form phiên
      // bản theo kênh, giờ mặc định 09:00) — không tự gán campaign/action.
      openEditor('variant', null, { scheduledAtLocal: id + 'T09:00' });
    }
    if (action === 'content-mix-unit') { UI.contentMixUnit = id === 'publication' ? 'publication' : 'content'; UI.contentTab = 'mix'; render(); }
    if (action === 'pillar-suggest') {
      var sug = PILLAR_SUGGESTIONS.find(function (s) { return s.name === t.getAttribute('data-name'); });
      if (sug) openEditor('pillar', null, { suggestedName: sug.name, suggestedDescription: sug.description, suggestedGuide: sug.guide });
    }
    if (action === 'content-prod-tasks') { createProductionTasks(id); }
    if (action === 'chip-variant') { ev.stopPropagation(); openEditor('variant', id, {}); }
    if (action === 'submit-review') {
      settle(submitReviewCall(id), function () { toast('Đã gửi duyệt. Người duyệt sẽ thấy đúng bản content này ở mục Duyệt content.'); render(); });
    }
    if (action === 'publish-variant') {
      var v = Store.get('variants', id);
      if (!v) return;
      var decision = Store.list('approvals').find(function (a) { return a.variantId === id && a.status === 'approved'; });
      var decisionId = decision ? (decision.decisionId || decision.id) : null;
      settle(publishCall(v, decisionId), function () { toast('Đã tạo lịch đăng bài.'); render(); });
    }
    if (action === 'decide') {
      var a = Store.get('approvals', id);
      var noteEl = document.getElementById('approve-note-' + id);
      var note = noteEl ? noteEl.value.trim() : '';
      var decision = t.getAttribute('data-decision');
      if ((decision === 'changes_requested' || decision === 'rejected') && !note) { toast('Hãy nhập nhận xét khi yêu cầu sửa hoặc từ chối, để người sản xuất biết cần sửa gì.'); if (noteEl) noteEl.focus(); return; }
      if (!a) return;
      settle(decideCall(a, decision, note), function () { toast('Đã ghi quyết định gắn với đúng phiên bản content đang hiển thị.'); render(); });
    }
    if (action === 'budget-proposal-decide') {
      var bp = null;
      try { bp = Store.get('budgetProposals', id); } catch (e) { bp = null; }
      if (!bp) { toast('Không tìm thấy đề xuất ngân sách.'); return; }
      var bpNoteEl = document.getElementById('budget-proposal-note-' + id);
      var bpNote = bpNoteEl ? bpNoteEl.value.trim() : (UI.budgetProposalNote[id] || '');
      var bpDecision = t.getAttribute('data-decision');
      if (!hasFn('decideBudgetProposal')) { toast(budgetApprovalErrorMessage('FORBIDDEN_ROLE: tầng dữ liệu chưa hỗ trợ quyết định đề xuất', 'proposal')); return; }
      saveResult(Store.decideBudgetProposal(id, bpDecision, bpNote, bp.revision !== null && bp.revision !== undefined ? bp.revision : undefined),
        function () { toast(bpDecision === 'approved' ? 'Đã duyệt đề xuất ngân sách — số duyệt của đối tượng đích đã cập nhật.' : 'Đã từ chối đề xuất ngân sách.'); render(); },
        function (msg) { toast(budgetApprovalErrorMessage(msg, 'proposal')); });
    }
    if (action === 'budget-fact-decide') {
      var bfKind = t.getAttribute('data-kind');
      var bfDecision = t.getAttribute('data-decision');
      var bfNote = window.prompt('Ghi chú khi quyết định (có thể bỏ trống):', '');
      if (bfNote === null) return;
      var bfCall = null;
      if (bfKind === 'commitment') bfCall = hasFn('decideCommitmentApproval') ? Store.decideCommitmentApproval(id, bfDecision, bfNote) : { ok: false, error: 'FORBIDDEN_ROLE: tầng dữ liệu chưa hỗ trợ duyệt cam kết' };
      else bfCall = hasFn('decidePaymentApproval') ? Store.decidePaymentApproval(id, bfDecision, bfNote) : { ok: false, error: 'FORBIDDEN_ROLE: tầng dữ liệu chưa hỗ trợ duyệt khoản chi' };
      saveResult(bfCall,
        function () { toast(bfDecision === 'approved' ? 'Đã duyệt khoản — khoản đã được tính vào ngân sách.' : 'Đã từ chối khoản.'); render(); },
        function (msg) { toast(budgetApprovalErrorMessage(msg, 'fact')); });
    }
    if (action === 'cancel-date-change') { UI.pendingDatePreview = null; render(); }
    if (action === 'apply-date-change' && UI.pendingDatePreview) {
      var p = UI.pendingDatePreview;
      UI.pendingDatePreview = null;
      settle(sUpdate('tasks', p.taskId, { startDate: p.newStart, dueDate: p.newDue }), function () {
        toast('Đã áp dụng đổi lịch cho task gốc. Lịch của task phụ thuộc không bị tự dịch.');
        render();
      });
    }
    if (action === 'gantt-scale') { UI.ganttScale = id; render(); }
    if (action === 'gantt-toggle') { UI.ganttCollapsed[id] = !UI.ganttCollapsed[id]; render(); }
    if (action === 'gantt-open') {
      var oid = t.getAttribute('data-oid'); var coll2 = t.getAttribute('data-coll');
      if (coll2 === 'tasks') openTaskPanel(oid);
      else if (coll2 === 'campaigns') window.location.hash = '#/campaigns/' + oid;
      else if (coll2 === 'phases' || coll2 === 'activities') {
        var rec = Store.get(coll2, oid);
        if (rec) openEditor(coll2 === 'phases' ? 'phase' : 'activity', oid, { campaignId: rec.campaignId });
      }
    }
    if (action === 'gantt-apply' && UI.ganttPreview) {
      // R2-28a: KHÔNG xóa preview trước khi gửi — chỉ xóa khi lưu THÀNH CÔNG;
      // lỗi thì giữ preview + hiện lỗi kèm nút Thử lại/Hủy; khóa nút khi đang gửi.
      if (UI.ganttSaving) return;
      var pv = UI.ganttPreview;
      UI.ganttSaving = true; UI.ganttError = null;
      render();
      var patch = pv.coll === 'campaigns' || pv.coll === 'phases' || pv.coll === 'activities'
        ? { startDate: pv.newStart, endDate: pv.newEnd }
        : { startDate: pv.newStart, dueDate: pv.newEnd };
      saveResult(sUpdate(pv.coll, pv.id, patch), function () {
        UI.ganttPreview = null; UI.ganttSaving = false; UI.ganttError = null;
        toast('Đã lưu lịch mới cho "' + pv.title + '".'); render();
      }, function (msg) {
        UI.ganttSaving = false; UI.ganttError = msg;
        render();
      });
    }
    if (action === 'gantt-cancel') { UI.ganttPreview = null; UI.ganttError = null; UI.ganttSaving = false; render(); }
    if (action === 'gantt-today') { UI.ganttScrollToday = true; render(); }
    if (action === 'gantt-range-clear') { UI.ganttRange = { from: '', to: '' }; render(); }
    if (action === 'approvals-tab') { UI.approvalsTab = id; render(); }
    if (action === 'timeline-mode') { UI.timelineMode = (id === 'tasks' ? 'tasks' : 'tree'); render(); }
    if (action === 'timeline-filter-clear') { UI.timelineFilter = { campaignId: 'all', ownerId: 'all', status: 'all' }; render(); }
    if (action === 'open-timeline') {
      // Mở Timeline từ màn Task: chế độ "Chỉ task" + mang theo đúng 3 lọc
      // campaign/người phụ trách/trạng thái hiện tại của màn Task (hàm
      // thuần D.timelineStateFromTaskFilter — không mang các lọc phụ).
      var tlState = D.timelineStateFromTaskFilter(UI.taskFilter);
      UI.timelineMode = tlState.mode;
      UI.timelineFilter = tlState.filter;
      if (window.location.hash !== '#/timeline') window.location.hash = '#/timeline';
      render();
    }
    if (action === 'task-timeline-group') { UI.taskTimelineGroupBy = id; render(); }
    if (action === 'campaign-baseline') {
      // R2-28c + chốt CẢ CÂY (13/11): một lần bấm chụp mốc cho campaign +
      // mọi phase/activity/task thuộc campaign, mỗi thực thể nhận baseline
      // = lịch hiện tại của chính nó; mục thiếu ngày bị bỏ qua và đếm.
      // Ghi các mục con TRƯỚC (tuần tự, đếm kết quả thật từng mục); campaign
      // + entry baselineVersions (kèm thống kê phạm vi) ghi CUỐI — entry
      // chỉ tồn tại khi phần ghi campaign thành công; campaign ghi lỗi thì
      // dừng và báo lỗi như pattern settle hiện tại. Toàn bộ là ghi phía
      // client qua Store, KHÔNG có transaction: lỗi giữa chừng = một phần
      // cây đã có baseline mới nhưng chưa có version mới (bấm chốt lại để
      // đồng bộ). Sau mỗi mục còn ĐỌC LẠI để kiểm chứng baseline thật sự
      // nằm trên bản ghi — tầng dữ liệu lặng lẽ bỏ trường (vd cột chưa có
      // ở DB) bị tính là lỗi, không báo thành công giả.
      var bc = Store.get('campaigns', id);
      if (!bc) return;
      if (!canSetBaseline()) { toast('Chỉ Owner/Lead mới chốt được baseline.'); return; }
      if (!bc.startDate || !bc.endDate) { toast('Campaign chưa có ngày bắt đầu/kết thúc — hãy sửa campaign trước khi chốt baseline.'); return; }
      var bPhases = Store.list('phases').filter(function (x) { return x.campaignId === id; });
      var bPhaseIds = {}; bPhases.forEach(function (p) { bPhaseIds[p.id] = true; });
      var bActs = Store.list('activities').filter(function (x) {
        return x.campaignId === id || (!x.campaignId && x.phaseId && bPhaseIds[x.phaseId]);
      });
      var bActIds = {}; bActs.forEach(function (a) { bActIds[a.id] = true; });
      var bTasks = Store.list('tasks').filter(function (t) {
        if (isArchived(t)) return false;
        if (t.campaignId === id) return true;
        if (t.campaignId) return false;
        return !!((t.activityId && bActIds[t.activityId]) || (t.phaseId && bPhaseIds[t.phaseId]));
      });
      var bPlan = baselineTreePlan(bc, bPhases, bActs, bTasks);
      var bDone = { phase: 0, activity: 0, task: 0 };
      var bFailed = 0;
      var bIdx = 0;
      function finishBaselineTree() {
        var versions = baselineVersionsOf(bc).slice();
        var nv = {
          version: versions.length + 1, startDate: bc.startDate, endDate: bc.endDate,
          setBy: Store.currentUserId, setAt: new Date().toISOString(),
          counts: { campaign: 1, phase: bDone.phase, activity: bDone.activity, task: bDone.task },
          skipped: bPlan.skipped, skippedByType: bPlan.skippedByType, failed: bFailed
        };
        versions.push(nv);
        settle(sUpdate('campaigns', id, { baselineStartDate: nv.startDate, baselineEndDate: nv.endDate, baselineVersions: versions }), function () {
          var msg = 'Đã chốt baseline v' + nv.version + ': 1 campaign, ' + bDone.phase + ' phase, ' + bDone.activity + ' activity, ' + bDone.task + ' task';
          if (bPlan.skipped) msg += ' — bỏ qua ' + bPlan.skipped + ' mục chưa có lịch';
          if (bFailed) msg += ' — lỗi ' + bFailed + ' mục chưa ghi được, hãy thử chốt lại';
          toast(msg);
          render();
        });
      }
      function writeBaselineNext() {
        if (bIdx >= bPlan.items.length) { finishBaselineTree(); return; }
        var bit = bPlan.items[bIdx++];
        saveResult(sUpdate(bit.coll, bit.id, bit.patch), function () {
          var cur = Store.get(bit.coll, bit.id);
          var written = !!cur && Object.keys(bit.patch).every(function (k) { return String(cfVal(cur, k) || '') === String(bit.patch[k]); });
          if (written) bDone[bit.type] += 1; else bFailed += 1;
          writeBaselineNext();
        }, function () { bFailed += 1; writeBaselineNext(); });
      }
      writeBaselineNext();
    }
    if (action === 'request-accept') {
      var rq = Store.get('marketingRequests', id);
      if (!rq) return;
      settle(sUpdate('marketingRequests', id, { assigneeId: Store.currentUserId, assignee: Store.currentUserId, status: 'in_progress', statusLabel: 'Đang xử lý' }), function () { toast('Đã nhận xử lý yêu cầu.'); render(); });
    }
    if (action === 'request-reject') {
      var reason = window.prompt('Lý do từ chối yêu cầu (bắt buộc):');
      if (reason === null) return;
      if (!String(reason).trim()) { toast('Phải nhập lý do khi từ chối yêu cầu.'); return; }
      settle(sUpdate('marketingRequests', id, { status: 'rejected', statusLabel: 'Đã từ chối', rejectionReason: String(reason).trim(), rejection_reason: String(reason).trim() }), function () { toast('Đã từ chối yêu cầu.'); render(); });
    }
    if (action === 'request-convert') {
      var rq2 = Store.get('marketingRequests', id);
      if (!rq2) return;
      var dup = Store.list('tasks').find(function (t) { return cfVal(t, 'marketingRequestId') === id; });
      if (dup) { toast('Yêu cầu này đã được chuyển thành task: ' + dup.title); return; }
      settle(sCreate('tasks', { title: rq2.title, campaignId: rq2.campaignId || null, assigneeId: Store.currentUserId, ownerId: Store.currentUserId, status: 'todo', priority: rq2.priority || 'Trung bình', dueDate: rq2.dueDate || null, description: rq2.note || '', checklist: [], marketingRequestId: id }), function () {
        settle(sUpdate('marketingRequests', id, { status: 'converted', statusLabel: 'Đã chuyển thành task' }), function () { toast('Đã chuyển yêu cầu thành task.'); render(); });
      });
    }
    if (action === 'resolve-blocker') { captureTaskDraft(); settle(sUpdate('blockers', id, { status: 'resolved' }), function () { render(); }); }
    if (action === 'adcr-submit') {
      var r0 = Store.get('adChangeRequests', id);
      var patch0 = { status: 'pending_approval', statusLabel: 'Chờ duyệt' };
      if (r0) { patch0.title = r0.title; patch0.target = r0.target; if (r0.afterState) patch0.afterState = r0.afterState; }
      settle(sUpdate('adChangeRequests', id, patch0), function () { render(); });
    }
    if (action === 'adcr-approve') {
      if (!can('adsApprove')) { toast('Vai trò hiện tại không có quyền duyệt quảng cáo.'); return; }
      var r1 = Store.get('adChangeRequests', id);
      var patch1 = { status: 'approved', statusLabel: 'Đã duyệt — đối tượng giữ trạng thái Tạm dừng cho tới khi áp dụng' };
      if (r1) { patch1.title = r1.title; patch1.target = r1.target; if (r1.afterState) patch1.afterState = r1.afterState; }
      settle(sUpdate('adChangeRequests', id, patch1), function () { render(); });
    }
    if (action === 'sign-out') { settle(Store.signOut(), function () { toast('Đã đăng xuất.'); render(); }); }
    if (action === 'dismiss-invite') {
      Store.pendingInvite = null;
      Store.state.authRequired = true;
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/overview'); } catch (e) {}
      render();
    }
    if (action === 'export-csv') exportCsv();
    if (action === 'export-kpi-csv') exportKpiCsv();
    if (action === 'export-budget-csv') exportBudgetCsv();
    if (action === 'export-cash-csv') exportCashCsv();
    if (action === 'demo-on') { Store.setDemoEnabled(true); window.location.hash = '#/overview'; window.location.reload(); }
    if (action === 'demo-off') { Store.setDemoEnabled(false); window.location.hash = '#/settings'; window.location.reload(); }
    if (action === 'demo-reset') { Store.resetDemo(); render(); toast('Đã đặt lại dữ liệu minh họa về trạng thái ban đầu.'); }
    if (action === 'team-week-now') { UI.teamWeek = isoOf(mondayOf(new Date())); render(); }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'current-user-select') { Store.setCurrentUser(t.value); render(); return; }
    if (t.hasAttribute && t.hasAttribute('data-editor-platform')) {
      var form = t.closest('form');
      captureEditorValues(form);
      renderOverlay();
      snapshotEditorInitial();
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-refresh-editor')) {
      // Đổi select cha (campaign/dòng ngân sách) → nạp lại các select con
      // (phase/activity/tiền tệ) nhưng giữ nguyên giá trị đang nhập.
      var form2 = t.closest('form');
      captureEditorValues(form2);
      renderOverlay();
      snapshotEditorInitial();
      return;
    }
    if (UI.editor && t.closest && t.closest('form[data-editor-form]')) UI.editor.dirty = true;
    var kind = t.getAttribute && t.getAttribute('data-action-change');
    if (kind === 'task-status') {
      if (!canUpdateTaskStatus()) { toast('Vai trò hiện tại chỉ xem, không đổi được trạng thái.'); render(); return; }
      settle(sUpdate('tasks', t.getAttribute('data-id'), { status: t.value }), function () { render(); });
    }
    if (kind === 'checklist-toggle') {
      captureTaskDraft();
      if (!canEditTask()) { toast('Bạn đang xem ở chế độ chỉ đọc, không sửa được checklist.'); render(); return; }
      var task = taskById(t.getAttribute('data-id'));
      var idx = Number(t.getAttribute('data-idx'));
      if (task) { var cl = (task.checklist || []).map(function (c, i) { return i === idx ? Object.assign({}, c, { done: t.checked }) : c; }); settle(sUpdate('tasks', task.id, { checklist: cl }), function () { render(); }); }
    }
    if (kind === 'member-role') {
      settle(sUpdate('members', t.getAttribute('data-id'), { role: t.value }), function () { toast('Đã đổi vai trò thành viên.'); render(); });
    }
    if (kind === 'member-active') {
      settle(sUpdate('members', t.getAttribute('data-id'), { isActive: t.value === '1' }), function () { toast('Đã cập nhật trạng thái hoạt động.'); render(); });
    }
  });

  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'global-search') runGlobalSearch(ev.target.value);
    if (UI.editor && ev.target.closest && ev.target.closest('form[data-editor-form]')) UI.editor.dirty = true;
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Tab') trapTab(ev);
    if (ev.key === 'Escape') {
      if (UI.confirmClose) { UI.confirmClose = null; renderOverlay(); }
      else if (UI.editor) requestCloseEditor();
      else if (UI.activityDrawerId) { UI.activityDrawerId = null; renderOverlay(); }
      else if (currentTaskPanelId()) requestCloseTaskPanel();
      var sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
      var bd = document.getElementById('sidebar-backdrop'); if (bd) bd.hidden = true;
    }
    if (ev.key === 'Enter' && ev.target.getAttribute && ev.target.getAttribute('data-action') === 'cal-day') {
      openEditor('variant', null, { scheduledAtLocal: ev.target.getAttribute('data-id') + 'T09:00' });
    }
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    ev.preventDefault();
    var fd = new FormData(f);
    function val(n) { return fd.get(n); }
    // Biểu mẫu trong trình sửa (modal)
    var editorKind = f.getAttribute && f.getAttribute('data-editor-form');
    if (editorKind) {
      if (UI.editorSubmitting) return;
      var data = {};
      fd.forEach(function (v, k) { data[k] = v; });
      // R2-30.2: KHÔNG còn finally đồng bộ — nút Lưu + fieldset chỉ được khôi
      // phục khi Promise của saveResult settle (finishSave đóng editor, hoặc
      // editorFail mở khóa lại). Nhãn gốc của nút được giữ nguyên khi khôi phục.
      setEditorSubmitting(true);
      try { saveEditor(editorKind, data, f); }
      catch (err) { setEditorSubmitting(false); editorFail(err && err.message ? err.message : String(err), {}); }
      return;
    }
    if (f.id === 'gantt-range-form') {
      var gf = String(val('from') || ''), gt = String(val('to') || '');
      if (gf && gt && gt < gf) { toast('Ngày kết thúc khoảng xem phải sau ngày bắt đầu.'); return; }
      UI.ganttRange = { from: gf, to: gt };
      render(); return;
    }
    if (f.id === 'task-filter-form') {
      UI.taskFilter = {
        campaignId: String(val('campaignId') || 'all'), ownerId: String(val('ownerId') || 'all'),
        status: String(val('status') || 'all'), priority: String(val('priority') || 'all'),
        due: String(val('due') || 'all'), blocked: String(val('blocked') || 'all'),
        unassigned: !!fd.get('unassigned')
      };
      render(); return;
    }
    if (f.id === 'timeline-filter-form') {
      // Select campaign có option value="" (Không thuộc campaign) — KHÔNG
      // được || 'all' vì '' là giá trị lọc có nghĩa; chỉ thiếu field mới all.
      var tlCampVal = val('campaignId');
      UI.timelineFilter = {
        campaignId: (tlCampVal === null || tlCampVal === undefined) ? 'all' : String(tlCampVal),
        ownerId: String(val('ownerId') || 'all'),
        status: String(val('status') || 'all')
      };
      render(); return;
    }
    if (f.id === 'content-filter-form') {
      UI.contentFilter = {
        campaignId: String(val('campaignId') || 'all'), platform: String(val('platform') || 'all'),
        ownerId: String(val('ownerId') || 'all'), status: String(val('status') || 'all'),
        pillarId: (val('pillarId') === null || val('pillarId') === undefined) ? 'all' : String(val('pillarId')),
        buProductId: String(val('buProductId') || 'all'), product: String(val('product') || 'all'),
        format: String(val('format') || 'all'), channelAccountId: String(val('channelAccountId') || 'all'),
        activityId: String(val('activityId') || 'all'), taskId: String(val('taskId') || 'all'),
        from: String(val('from') || ''), to: String(val('to') || '')
      };
      render(); return;
    }
    if (f.id === 'brand-filter-form') {
      UI.brandFilter = { ownerId: String(val('ownerId') || 'all'), status: String(val('status') || 'all'), type: String(val('type') || 'all') };
      render(); return;
    }
    if (f.id === 'task-panel-form') {
      var tid = f.getAttribute('data-task-id');
      // Phòng thủ theo cùng cơ chế quyền như lúc render: chỉ-đọc thì không
      // lưu gì cả; chỉ có task.updateStatus thì chỉ ghi đúng trạng thái
      // (các ô khác đang disabled nên FormData không mang chúng theo).
      if (taskPanelReadonly()) { toast('Bạn đang xem ở chế độ chỉ đọc, không lưu được thay đổi.'); return; }
      if (!canEditTask()) {
        settle(sUpdate('tasks', tid, { status: val('status') }), function () { UI.taskDraft = null; UI.taskDraftConflict = false; toast('Đã lưu trạng thái task.'); render(); });
        return;
      }
      var start = val('startDate'), due = val('dueDate');
      if (start && due && due < start) { toast('Mốc cần hoàn thành phải sau ngày bắt đầu.'); return; }
      if (val('parentId') === tid) { toast('Task không thể là task cha của chính nó.'); return; }
      // R2-27: validate phase/activity thuộc đúng campaign/phase.
      var pPhase = val('phaseId') ? Store.get('phases', val('phaseId')) : null;
      if (val('phaseId') && (!pPhase || (val('campaignId') && pPhase.campaignId !== val('campaignId')))) { toast('Giai đoạn đã chọn không thuộc campaign này.'); return; }
      var pAct = val('activityId') ? Store.get('activities', val('activityId')) : null;
      if (val('activityId') && (!pAct || (val('campaignId') && pAct.campaignId !== val('campaignId')) || (val('phaseId') && pAct && pAct.phaseId !== val('phaseId')))) { toast('Activity đã chọn không thuộc giai đoạn/campaign đã chọn.'); return; }
      var milePanel = f.querySelector('[name="isMilestone"]');
      settle(sUpdate('tasks', tid, {
        title: val('title'), assigneeId: val('assigneeId') || null, ownerId: val('assigneeId') || null,
        campaignId: val('campaignId') || null, phaseId: val('phaseId') || null, activityId: val('activityId') || null,
        parentId: val('parentId') || null, status: val('status'),
        isMilestone: milePanel ? !!milePanel.checked : false,
        priority: val('priority'), startDate: start || null, dueDate: due || null,
        effortHours: val('effortHours') ? Number(val('effortHours')) : null,
        deliverable: val('deliverable') || '', description: val('description') || '', availabilityNote: val('availabilityNote') || ''
      }), function () { UI.taskDraft = null; UI.taskDraftConflict = false; toast('Đã lưu task.'); render(); });
      return;
    }
    if (f.id === 'checklist-add-form') {
      captureTaskDraft();
      if (!canEditTask()) { toast('Bạn đang xem ở chế độ chỉ đọc, không thêm được mục checklist.'); return; }
      var tid2 = f.getAttribute('data-task-id');
      var task2 = taskById(tid2);
      if (task2) settle(sUpdate('tasks', tid2, { checklist: (task2.checklist || []).concat([{ text: String(val('text')), done: false }]) }), function () { render(); });
      return;
    }
    if (f.id === 'dep-add-panel-form') {
      captureTaskDraft();
      if (!canEditTask()) { toast('Bạn đang xem ở chế độ chỉ đọc, không thêm được phụ thuộc.'); return; }
      var tid3 = f.getAttribute('data-task-id');
      var from = val('predecessorId');
      if (D.wouldCreateCycle(Store.list('dependencies'), from, tid3)) { toast('Không thêm được: quan hệ này tạo vòng phụ thuộc.'); return; }
      settle(sCreate('dependencies', { predecessorId: from, successorId: tid3 }), function () { toast('Đã thêm quan hệ phụ thuộc.'); render(); });
      return;
    }
    if (f.id === 'comment-add-form') {
      captureTaskDraft();
      if (!canEdit()) { toast('Vai trò hiện tại chỉ xem, không gửi được bình luận.'); return; }
      var tid4 = f.getAttribute('data-task-id');
      settle(sCreate('comments', { taskId: tid4, body: String(val('body')), authorId: Store.currentUserId, createdBy: Store.currentUserId, createdAt: new Date().toISOString() }),
        function () { toast('Đã gửi bình luận.'); render(); });
      return;
    }
    if (f.id === 'brand-search-form') { UI.brandQuery = String(document.getElementById('brand-query').value || ''); render(); return; }
    if (f.id === 'cal-nav-form') {
      UI.calendarMonth = Math.min(12, Math.max(1, Number(document.getElementById('cal-month').value) || 1)) - 1;
      UI.calendarYear = Number(document.getElementById('cal-year').value) || new Date().getFullYear();
      render(); return;
    }
    if (f.id === 'task-date-form') {
      var taskId = document.getElementById('date-task-id').value;
      var ns = document.getElementById('date-new-start').value;
      var nd = document.getElementById('date-new-due').value;
      if (ns && nd && nd < ns) { toast('Mốc cần hoàn thành mới phải sau ngày bắt đầu mới.'); return; }
      UI.pendingDatePreview = { taskId: taskId, newStart: ns, newDue: nd, impact: D.previewDependencyImpact(taskId, ns, nd, Store.list('tasks'), Store.list('dependencies')) };
      render(); return;
    }
    if (f.id === 'dep-add-form') {
      var from2 = val('predecessorId'), to2 = val('successorId');
      if (D.wouldCreateCycle(Store.list('dependencies'), from2, to2)) { toast('Không thêm được: quan hệ này tạo vòng phụ thuộc.'); return; }
      settle(sCreate('dependencies', { predecessorId: from2, successorId: to2 }), function () { toast('Đã thêm quan hệ phụ thuộc.'); render(); });
      return;
    }
    if (f.id === 'blocker-add-form') {
      settle(sCreate('blockers', { taskId: val('taskId'), title: val('title'), description: val('description') || '', status: 'open', createdBy: Store.currentUserId, createdAt: new Date().toISOString() }),
        function () { toast('Đã tạo trở ngại.'); render(); });
      return;
    }
    if (f.id === 'request-add-form') {
      settle(sCreate('marketingRequests', { title: val('title'), requester: val('requester'), campaignId: val('campaignId') || null, priority: val('priority'), dueDate: val('dueDate') || null, status: 'new', statusLabel: 'Mới ghi nhận', note: '' }),
        function () { toast('Đã ghi nhận yêu cầu Marketing.'); render(); });
      return;
    }
    if (f.id === 'channel-filter-form') { UI.channelFilter = document.getElementById('channel-filter').value; render(); return; }
    if (f.id === 'team-week-form') {
      var wv = document.getElementById('team-week-input').value;
      if (wv) UI.teamWeek = isoOf(mondayOf(new Date(wv + 'T00:00:00')));
      render(); return;
    }
    if (f.id === 'report-filter-form') {
      UI.report.from = String(val('from') || '');
      UI.report.to = String(val('to') || '');
      UI.report.accountId = String(val('accountId') || 'all');
      UI.report.campaignId = String(val('campaignId') || 'all');
      UI.report.level = String(val('level') || 'campaign');
      UI.adsLevel = UI.report.level;
      render(); return;
    }
    if (f.id === 'global-search-form') { runGlobalSearch(document.getElementById('global-search').value); return; }
    if (f.id === 'signin-form' || f.id === 'login-form') {
      Store.signIn(String(val('email')), String(val('password')))
        .then(function () { toast('Đăng nhập thành công.'); render(); })
        .catch(function (e) { toast('Đăng nhập thất bại: ' + e.message); });
      return;
    }
    if (f.id === 'invite-password-form') {
      var pw = String(val('password') || '');
      var pw2 = String(val('passwordConfirm') || '');
      if (pw.length < 8) { toast('Mật khẩu phải có tối thiểu 8 ký tự.'); return; }
      if (pw !== pw2) { toast('Hai lần nhập mật khẩu chưa khớp nhau.'); return; }
      settle(Store.completeInvite(pw, pw2), function (r) {
        if (r && r.noMembership) { render(); return; }
        toast('Đã đặt mật khẩu thành công. Chào mừng bạn đến với SAVA Marketing Workspace.');
        render();
      });
      return;
    }
    var formKind = f.getAttribute && f.getAttribute('data-form');
    var fid = f.getAttribute && f.getAttribute('data-id');
    if (formKind === 'request-due') {
      // R2-30.7: đổi hạn yêu cầu Marketing.
      settle(sUpdate('marketingRequests', fid, { dueDate: val('dueDate') || null }), function () { toast('Đã đổi hạn yêu cầu.'); render(); });
      return;
    }
    if (formKind === 'attach-campaign') {
      // Gắn / đổi / bỏ gắn campaign cho bài qua đúng bảng nối (R15): giá trị rỗng = bỏ gắn.
      var mapResult = hasFn('setPostCampaign') ? Store.setPostCampaign(fid, val('campaignId') || null) : sUpdate('externalPosts', fid, { campaignId: val('campaignId') || null });
      settle(mapResult, function () { toast(val('campaignId') ? 'Đã gắn campaign cho post.' : 'Đã bỏ gắn campaign khỏi post.'); render(); });
    }
  });

  window.addEventListener('hashchange', function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('open')) { sidebar.classList.remove('open'); var bd2 = document.getElementById('sidebar-backdrop'); if (bd2) bd2.hidden = true; }
    if (UI.taskPanelId && parseRoute().name !== 'tasks') { /* panel đang mở qua replaceState — không đổi route */ }
    render();
  });
  Store.subscribe(function () {
    // R2-05: notify từ thay đổi của người khác trong lúc draft đang bẩn →
    // giữ draft và bật cảnh báo xung đột trong panel.
    if (UI.taskDraft && taskDraftIsDirty()) {
      var cur = taskById(UI.taskDraft.taskId);
      if (cur && UI.taskDraft.baseUpdatedAt && cur.updatedAt && String(cur.updatedAt) !== String(UI.taskDraft.baseUpdatedAt)) UI.taskDraftConflict = true;
    }
    render();
  });
  var boot = Store.load();
  render();
  if (boot && typeof boot.then === 'function') boot.then(function () { UI.booted = true; render(); });
  else UI.booted = true;
})();
