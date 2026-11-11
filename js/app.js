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

  var NAV_GROUPS = [
    ['Công việc chung', [['overview', 'Tổng quan'], ['my-work', 'Việc của tôi']]],
    ['Kế hoạch & nội dung', [['campaigns', 'IMC & Campaigns'], ['content', 'Nội dung'], ['tasks', 'Công việc'], ['approvals', 'Duyệt nội dung']]],
    ['Thương hiệu', [['brand', 'Brand Hub']]],
    ['Hiệu quả', [['kpi', 'KPI & Ngân sách'], ['channels', 'Kênh & Bài đã đăng'], ['ads', 'Quảng cáo'], ['reports', 'Báo cáo']]],
    ['Tổ chức', [['team', 'Team & Workload'], ['settings', 'Thiết lập']]]
  ];
  var ROUTES = ['overview', 'my-work', 'brand', 'campaigns', 'content', 'tasks', 'approvals', 'team', 'kpi', 'channels', 'ads', 'reports', 'settings'];

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
    editor: null,
    taskPanelId: null,
    taskPanelReturnHash: null,
    pendingDatePreview: null,
    approveComment: {}
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
  var PLATFORMS = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['website', 'Website'], ['other', 'Kênh khác']];

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
  function todayISO() { return isoOf(new Date()); }
  function addDaysISO(iso, n) { if (!iso) return ''; var d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); }
  function isOverdue(t) {
    if (!t.dueDate) return false;
    var s = String(t.status || '').toLowerCase();
    return String(t.dueDate).slice(0, 10) < todayISO() && s !== 'completed' && s !== 'done' && s !== 'cancelled';
  }
  function isCompletedTask(t) { var s = String((t && t.status) || '').toLowerCase(); return s === 'completed' || s === 'done' || s === 'complete'; }
  function statusBadge(status, label) {
    var s = String(status || '').toLowerCase();
    var cls = 'grey';
    if (s === 'completed' || s === 'done' || s === 'approved' || s === 'active' || s === 'resolved' || s === 'settled' || s === 'final' || s === 'published') cls = 'ok';
    if (s === 'in_progress' || s === 'in_review' || s === 'pending' || s === 'pending_approval' || s === 'scheduled' || s === 'open' || s === 'planning' || s === 'partial' || s === 'needs_reapproval' || s === 'changes_requested') cls = 'warn';
    if (s === 'cancelled' || s === 'canceled' || s === 'rejected') cls = 'bad';
    return '<span class="badge ' + cls + '">' + esc(label || labelStatus(status)) + '</span>';
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
    if (r.ready) return '<span class="badge ok">Sẵn sàng</span>';
    var names = r.pendingPredecessors.map(function (id) { var t = taskById(id); return t ? t.title : id; }).join(', ');
    return '<span class="badge warn">Đang chờ: ' + esc(names) + '</span>';
  }
  function pageHead(title, sub, actions) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' +
      (actions ? '<div class="page-actions">' + actions + '</div>' : '') + '</div>';
  }
  function tbl(inner) { return '<div class="table-wrap"><table>' + inner + '</table></div>'; }
  function tabsHtml(list, active, action) {
    return '<div class="tabs" role="tablist">' + list.map(function (x) {
      return '<button type="button" class="tab' + (x[0] === active ? ' active' : '') + '" data-action="' + action + '" data-id="' + esc(x[0]) + '" role="tab">' + esc(x[1]) + '</button>';
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
      ' không có quyền sửa công việc, nên mọi ô nhập, mục kiểm tra và quan hệ phụ thuộc đã bị khóa. Dữ liệu vẫn được tầng dữ liệu chặn khi lưu.</div>';
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
  function noEditTitle() { return ' title="Vai trò hiện tại chỉ xem, không sửa được"'; }

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
    if (!v) return { ok: false, error: 'Không tìm thấy phiên bản nội dung.' };
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
    return { ok: false, error: 'Tầng dữ liệu chưa phơi hàm quyết định duyệt.' };
  }
  function publishCall(v, decisionId) {
    if (!hasFn('createPublishJob')) return { ok: false, error: 'Tầng dữ liệu chưa phơi hàm tạo lịch đăng.' };
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
    return { ok: false, error: 'Chức năng mời thành viên chưa được tầng dữ liệu phơi ra (cần hàm mời qua Edge Function invite-member). Biểu mẫu đã sẵn sàng để nối.' };
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
    if (name === 'campaigns' && route.sub && ['overview', 'plan', 'tasks', 'content', 'kpi', 'docs', 'summary'].indexOf(route.sub) !== -1) UI.campaignTab = route.sub;
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
      '<div class="form-actions"><button class="btn" type="submit"' + dis(ro) + (ro ? noEditTitle() : '') + '>' + esc(submitLabel || 'Lưu') + '</button>' +
      '<button class="btn secondary" type="button" data-action="editor-close">Hủy</button></div></form></div>';
  }
  function openEditor(kind, id, context) {
    UI.editor = { kind: kind, id: id || null, context: context || {}, error: null, errors: {}, values: null, scenes: null };
    renderOverlay();
    var first = document.querySelector('.modal input, .modal select, .modal textarea');
    if (first) first.focus();
  }
  function closeEditor() { UI.editor = null; renderOverlay(); }
  function editorFail(msg, errors) {
    if (!UI.editor) { toast(msg); return; }
    UI.editor.error = msg; UI.editor.errors = errors || {};
    renderOverlay();
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
        var audText = (c.audiences || []).map(function (a) { return a.name + (a.description ? ' | ' + a.description : ''); }).join('\n');
        return formShell('campaign', e.id ? 'Sửa campaign' : 'Tạo campaign',
          F('name', 'Tên campaign *', 'text', ev('name', c.name), { required: true, wide: true }) +
          F('status', 'Trạng thái', 'select', ev('status', c.status || 'planning'), { options: CAMPAIGN_STATUSES }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', c.ownerId || Store.currentUserId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('businessUnitId', 'BU', 'select', ev('businessUnitId', c.businessUnitId), { options: Store.list('businessUnits').map(function (b) { return [b.id, b.name]; }), emptyLabel: '— Không gắn BU —' }) +
          F('product', 'Sản phẩm', 'text', ev('product', c.product)) +
          F('startDate', 'Ngày bắt đầu', 'date', ev('startDate', c.startDate)) +
          F('endDate', 'Ngày kết thúc', 'date', ev('endDate', c.endDate)) +
          F('baselineStartDate', 'Kế hoạch đã duyệt — bắt đầu', 'date', ev('baselineStartDate', c.baselineStartDate)) +
          F('baselineEndDate', 'Kế hoạch đã duyệt — kết thúc', 'date', ev('baselineEndDate', c.baselineEndDate)) +
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
        return formShell('activity', e.id ? 'Sửa hoạt động' : 'Thêm hoạt động',
          F('name', 'Tên hoạt động *', 'text', ev('name', a.name), { required: true, wide: true }) +
          F('phaseId', 'Giai đoạn', 'select', ev('phaseId', a.phaseId), { options: phases.map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Không gắn giai đoạn —' }) +
          F('channel', 'Kênh triển khai', 'text', ev('channel', a.channel)) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', a.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('startDate', 'Ngày bắt đầu', 'date', ev('startDate', a.startDate)) +
          F('endDate', 'Ngày kết thúc', 'date', ev('endDate', a.endDate)) +
          F('deliverables', 'Đầu ra cần bàn giao', 'textarea', ev('deliverables', a.deliverables || a.deliverable), { wide: true }),
          'Lưu hoạt động');
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
          F('url', 'Đường dẫn file / link', 'url', ev('url', ba.url || ba.fileUrl), { wide: true, placeholder: 'https://…' }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', ba.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('tags', 'Thẻ (cách nhau bằng dấu phẩy)', 'text', ev('tags', Array.isArray(ba.tags) ? ba.tags.join(', ') : ba.tags)) +
          F('status', 'Trạng thái bản', 'select', ev('status', ba.status || 'Draft'), { options: BRAND_STATUSES }),
          'Lưu tài nguyên');
      }
      case 'task': {
        var t = editorItem('tasks') || {};
        return formShell('task', e.id ? 'Sửa công việc' : 'Tạo công việc',
          F('title', 'Tên việc *', 'text', ev('title', t.title), { required: true, wide: true }) +
          F('campaignId', 'Campaign (để trống = việc độc lập)', 'select', ev('campaignId', t.campaignId || e.context.campaignId), { options: campaignPairs(), emptyLabel: '— Việc độc lập —' }) +
          F('parentId', 'Việc cha', 'select', ev('parentId', t.parentId), { options: visibleList('tasks').filter(function (x) { return x.id !== e.id; }).map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không có —' }) +
          F('assigneeId', 'Người phụ trách', 'select', ev('assigneeId', t.assigneeId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('status', 'Trạng thái', 'select', ev('status', t.status || 'todo'), { options: TASK_STATUSES }) +
          F('priority', 'Ưu tiên', 'select', ev('priority', t.priority || 'Trung bình'), { options: PRIORITIES.map(function (x) { return [x, x]; }) }) +
          F('startDate', 'Ngày bắt đầu', 'date', ev('startDate', t.startDate ? String(t.startDate).slice(0, 10) : '')) +
          F('dueDate', 'Mốc cần hoàn thành', 'date', ev('dueDate', t.dueDate ? String(t.dueDate).slice(0, 10) : '')) +
          F('effortHours', 'Thời gian dự kiến (giờ)', 'number', ev('effortHours', t.effortHours), { min: 0, step: 0.5 }) +
          F('deliverable', 'Đầu ra cần bàn giao', 'text', ev('deliverable', t.deliverable), { wide: true }) +
          F('description', 'Mô tả', 'textarea', ev('description', t.description), { wide: true }),
          e.id ? 'Lưu công việc' : 'Tạo công việc');
      }
      case 'content': {
        var ci = editorItem('contentItems') || {};
        return formShell('content', e.id ? 'Sửa nội dung gốc' : 'Tạo nội dung',
          F('title', 'Tiêu đề nội dung *', 'text', ev('title', ci.title), { required: true, wide: true }) +
          F('type', 'Loại', 'select', ev('type', ci.type || 'post'), { options: [['post', 'Bài đăng'], ['video', 'Video'], ['image', 'Hình ảnh'], ['article', 'Bài viết'], ['other', 'Khác']] }) +
          F('campaignId', 'Campaign (có thể để trống)', 'select', ev('campaignId', ci.campaignId || e.context.campaignId), { options: campaignPairs(), emptyLabel: '— Chưa gắn campaign —' }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', ci.ownerId || Store.currentUserId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('scheduledDate', 'Ngày dự kiến đăng', 'date', ev('scheduledDate', ci.scheduledDate || e.context.scheduledDate)) +
          F('brief', 'Brief / ý tưởng nội dung', 'textarea', ev('brief', ci.brief || ci.description), { wide: true, rows: 4 }),
          e.id ? 'Lưu nội dung' : 'Tạo nội dung');
      }
      case 'variant': {
        var vv = editorItem('variants') || {};
        var platform = ev('platform', vv.platform || 'facebook');
        var isTiktok = platform === 'tiktok';
        var scenes = e.scenes || vv.scriptScenes || [];
        var html = F('contentItemId', 'Nội dung gốc *', 'select', ev('contentItemId', vv.contentItemId || e.context.contentItemId), { options: visibleList('contentItems').map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Chọn nội dung —' }) +
          F('platform', 'Kênh', 'select', platform, { options: PLATFORMS, attrs: ' data-editor-platform="1"' }) +
          F('channelAccountId', 'Tài khoản kênh', 'select', ev('channelAccountId', vv.channelAccountId), { options: Store.list('channelAccounts').map(function (x) { return [x.id, x.name + ' (' + labelStatus(x.platform) + ')']; }), emptyLabel: '— Chưa gắn tài khoản —' }) +
          F('ownerId', 'Người sản xuất', 'select', ev('ownerId', vv.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }) +
          F('reviewerId', 'Người duyệt', 'select', ev('reviewerId', vv.reviewerId), { options: memberPairs(), emptyLabel: '— Chưa chọn —' }) +
          F('productionDeadline', 'Hạn sản xuất', 'date', ev('productionDeadline', vv.productionDeadline)) +
          F('reviewDeadline', 'Hạn duyệt', 'date', ev('reviewDeadline', vv.reviewDeadline)) +
          F('scheduledAt', 'Lịch đăng dự kiến', 'datetime-local', ev('scheduledAt', vv.scheduledAt ? String(vv.scheduledAt).slice(0, 16) : '')) +
          F('editorialStatus', 'Trạng thái biên tập', 'select', ev('editorialStatus', vv.editorialStatus || 'draft'), { options: EDITORIAL_STATUSES }) +
          F('caption', 'Caption', 'textarea', ev('caption', vv.caption), { wide: true, rows: 4 }) +
          F('hashtags', 'Hashtag (TikTok/mạng xã hội)', 'text', ev('hashtags', vv.hashtags), { wide: true, placeholder: '#sava #...' }) +
          F('brief', 'Brief riêng cho kênh', 'textarea', ev('brief', vv.brief), { wide: true }) +
          F('mediaUrl', 'Đường dẫn file đính kèm (ảnh/video)', 'url', ev('mediaUrl', vv.mediaUrl || vv.linkUrl), { wide: true, placeholder: 'https://…' });
        if (isTiktok) {
          html += F('hook', 'Hook chính', 'textarea', ev('hook', vv.hook), { wide: true }) +
            F('cta', 'CTA chính', 'text', ev('cta', vv.cta), { wide: true }) +
            scenesEditorHtml(scenes) +
            F('externalUrl', 'Link bài TikTok đã đăng (đăng ngoài app)', 'url', ev('externalUrl', vv.externalUrl), { wide: true }) +
            F('actualPublishedAt', 'Ngày đăng thực tế', 'datetime-local', ev('actualPublishedAt', vv.actualPublishedAt ? String(vv.actualPublishedAt).slice(0, 16) : ''));
        } else {
          html += F('script', 'Kịch bản / nội dung chi tiết', 'textarea', ev('script', vv.script), { wide: true, rows: 5 });
        }
        return formShell('variant', e.id ? 'Sửa phiên bản theo kênh' : 'Thêm phiên bản theo kênh', html, e.id ? 'Lưu phiên bản' : 'Tạo phiên bản');
      }
      case 'kpi': {
        var k = editorItem('kpis') || {};
        return formShell('kpi', e.id ? 'Sửa KPI' : 'Tạo KPI',
          F('name', 'Tên KPI *', 'text', ev('name', k.name), { required: true, wide: true }) +
          F('campaignId', 'Campaign', 'select', ev('campaignId', k.campaignId || e.context.campaignId), { options: campaignPairs(), emptyLabel: '— Toàn workspace —' }) +
          F('target', 'Mục tiêu', 'number', ev('target', k.target), { step: 'any' }) +
          F('unit', 'Đơn vị', 'text', ev('unit', k.unit)) +
          F('definition', 'Định nghĩa / cách đo', 'textarea', ev('definition', k.definition), { wide: true }) +
          F('period', 'Kỳ đo', 'text', ev('period', k.period), { placeholder: 'Ví dụ: Tháng 11/2026' }) +
          F('ownerId', 'Người phụ trách', 'select', ev('ownerId', k.ownerId), { options: memberPairs(), emptyLabel: '— Chưa phân công —' }),
          'Lưu KPI');
      }
      case 'measurement': {
        var kk = Store.get('kpis', e.context.kpiId) || {};
        return formShell('measurement', 'Thêm số đo cho KPI: ' + (kk.name || ''),
          F('value', 'Giá trị thực đạt *', 'number', ev('value', ''), { required: true, step: 'any' }) +
          F('source', 'Nguồn số liệu *', 'text', ev('source', ''), { required: true, placeholder: 'Ví dụ: Báo cáo nền tảng, nhập tay…' }) +
          F('measuredAt', 'Ngày đo', 'date', ev('measuredAt', todayISO())),
          'Lưu số đo');
      }
      case 'budgetLine': {
        var b = editorItem('budgetLines') || {};
        return formShell('budgetLine', e.id ? 'Sửa dòng ngân sách' : 'Tạo dòng ngân sách',
          F('name', 'Tên dòng ngân sách *', 'text', ev('name', b.name), { required: true, wide: true }) +
          F('campaignId', 'Campaign', 'select', ev('campaignId', b.campaignId || e.context.campaignId), { options: campaignPairs(), emptyLabel: '— Chưa gắn —' }) +
          F('planned', 'Kế hoạch (planned)', 'number', ev('planned', b.planned), { min: 0, step: 'any' }) +
          F('approved', 'Đã duyệt (approved)', 'number', ev('approved', b.approved), { min: 0, step: 'any' }) +
          F('currency', 'Tiền tệ', 'select', ev('currency', b.currency || 'VND'), { options: [['VND', 'VND'], ['USD', 'USD']] }),
          'Lưu dòng ngân sách');
      }
      case 'commitment': {
        var cm = editorItem('commitments') || {};
        return formShell('commitment', e.id ? 'Sửa cam kết chi' : 'Thêm cam kết chi',
          F('budgetLineId', 'Dòng ngân sách *', 'select', ev('budgetLineId', cm.budgetLineId || e.context.budgetLineId), { options: visibleList('budgetLines').map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn dòng —' }) +
          F('title', 'Nội dung cam kết *', 'text', ev('title', cm.title), { required: true, wide: true }) +
          F('amount', 'Số tiền cam kết', 'number', ev('amount', cm.amount), { min: 0, step: 'any' }) +
          F('currency', 'Tiền tệ', 'select', ev('currency', cm.currency || 'VND'), { options: [['VND', 'VND'], ['USD', 'USD']] }) +
          F('status', 'Trạng thái', 'select', ev('status', cm.status || 'open'), { options: [['open', 'Đang mở'], ['partial', 'Thanh toán một phần'], ['settled', 'Đã thanh toán xong'], ['cancelled', 'Đã hủy']] }) +
          F('settledAmount', 'Số đã thanh toán (khi thanh toán một phần)', 'number', ev('settledAmount', cm.settledAmount), { min: 0, step: 'any', help: 'Nếu lớn hơn 0, hệ thống đồng thời ghi một khoản chi thực tế tương ứng.' }),
          'Lưu cam kết');
      }
      case 'actual': {
        var ac = editorItem('actuals') || {};
        var lineId = ev('budgetLineId', ac.budgetLineId || e.context.budgetLineId);
        return formShell('actual', e.id ? 'Sửa khoản chi thực tế' : 'Ghi khoản chi thực tế',
          F('budgetLineId', 'Dòng ngân sách *', 'select', lineId, { options: visibleList('budgetLines').map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn dòng —' }) +
          F('commitmentId', 'Cam kết liên quan (nếu có)', 'select', ev('commitmentId', ac.commitmentId), { options: visibleList('commitments').filter(function (x) { return !lineId || x.budgetLineId === lineId; }).map(function (x) { return [x.id, x.title]; }), emptyLabel: '— Không gắn cam kết —' }) +
          F('title', 'Nội dung chi *', 'text', ev('title', ac.title), { required: true, wide: true }) +
          F('amount', 'Số tiền', 'number', ev('amount', ac.amount), { min: 0, step: 'any' }) +
          F('date', 'Ngày chi', 'date', ev('date', ac.date || todayISO())) +
          F('source', 'Nguồn chi / chứng từ', 'text', ev('source', ac.source), { wide: true }),
          'Lưu khoản chi');
      }
      case 'post': {
        var po = editorItem('externalPosts') || {};
        return formShell('post', e.id ? 'Sửa bài đã đăng (nhập tay)' : 'Thêm bài đã đăng (nhập tay)',
          F('platform', 'Kênh', 'select', ev('platform', po.platform || 'facebook'), { options: PLATFORMS }) +
          F('channelAccountId', 'Tài khoản kênh', 'select', ev('channelAccountId', po.channelAccountId), { options: Store.list('channelAccounts').map(function (x) { return [x.id, x.name]; }), emptyLabel: '— Chọn tài khoản —' }) +
          F('externalPostId', 'Mã bài trên nền tảng *', 'text', ev('externalPostId', po.externalPostId), { required: true }) +
          F('title', 'Tiêu đề *', 'text', ev('title', po.title), { required: true, wide: true }) +
          F('url', 'Đường dẫn bài', 'url', ev('url', po.url), { wide: true }) +
          F('publishedAt', 'Ngày đăng', 'datetime-local', ev('publishedAt', po.publishedAt ? String(po.publishedAt).slice(0, 16) : '')) +
          F('campaignId', 'Gắn campaign', 'select', ev('campaignId', po.campaignId), { options: campaignPairs(), emptyLabel: '— Chưa gắn —' }),
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
          F('scheduledAt', 'Lịch áp dụng dự kiến', 'datetime-local', ev('scheduledAt', r.scheduledAt ? String(r.scheduledAt).slice(0, 16) : '')) +
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
          F('capacityHoursPerWeek', 'Số giờ có thể nhận việc mỗi tuần', 'number', ev('capacityHoursPerWeek', m.capacityHoursPerWeek), { min: 0, step: 1 }) +
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
          F('summary', 'Nhận xét chính', 'textarea', ev('summary', ''), { wide: true, rows: 4, help: 'Cấu trúc gợi ý: Số liệu thay đổi → lý do đã biết/giả thuyết → việc cần làm.' }),
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

  function saveEditor(kind, data, form) {
    var e = UI.editor;
    var errors = {};
    function req(name, label) { if (!data[name] || !String(data[name]).trim()) errors[name] = 'Bắt buộc nhập ' + label + '.'; }
    function done(result, okMsg, after) {
      saveResult(result, function () { finishSave(okMsg, after); }, function (msg) { editorFail(msg, errors); });
    }
    switch (kind) {
      case 'campaign': {
        req('name', 'tên campaign');
        validateDateRange(errors, data.startDate, data.endDate);
        validateDateRange(errors, data.baselineStartDate, data.baselineEndDate, 'baselineStartDate', 'baselineEndDate');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ — xem lỗi ngay dưới từng trường.', errors);
        var audiences = String(data.audiences || '').split('\n').map(function (line) {
          var parts = line.split('|'); return { name: (parts[0] || '').trim(), description: (parts.slice(1).join('|') || '').trim() };
        }).filter(function (a) { return a.name; });
        var obj = {
          name: data.name, status: data.status, statusLabel: labelStatus(data.status), ownerId: data.ownerId || null,
          businessUnitId: data.businessUnitId || null, product: data.product || '',
          startDate: data.startDate || null, endDate: data.endDate || null,
          baselineStartDate: data.baselineStartDate || null, baselineEndDate: data.baselineEndDate || null,
          why: data.why || '', businessGoal: data.businessGoal || '', marketingGoal: data.marketingGoal || '',
          desiredOutcome: data.desiredOutcome || '', audiences: audiences, audienceInsights: data.audienceInsights || '',
          bigIdea: data.bigIdea || '', keyMessage: data.keyMessage || '', creativeDirection: data.creativeDirection || '',
          risks: data.risks || '', lessons: data.lessons || ''
        };
        if (e.id) done(sUpdate('campaigns', e.id, obj), 'Đã lưu campaign.');
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
        req('name', 'tên hoạt động'); validateDateRange(errors, data.startDate, data.endDate);
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var ao = { name: data.name, phaseId: data.phaseId || null, channel: data.channel || '', ownerId: data.ownerId || null, startDate: data.startDate || null, endDate: data.endDate || null, deliverables: data.deliverables || '', campaignId: e.context.campaignId };
        if (e.id) done(sUpdate('activities', e.id, ao), 'Đã lưu hoạt động.'); else done(sCreate('activities', ao), 'Đã thêm hoạt động.');
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
        var ao2 = { name: data.name, type: data.type || 'Khác', url: data.url || '', fileUrl: data.url || '', ownerId: data.ownerId || null, tags: splitTags(data.tags), status: data.status, version: cura ? (Number(cura.version || 1) + 1) : 1, updatedAt: new Date().toISOString() };
        if (e.id) done(sUpdate('brandAssets', e.id, ao2), 'Đã lưu tài nguyên (phiên bản ' + ao2.version + ').'); else done(sCreate('brandAssets', ao2), 'Đã thêm tài nguyên.');
        return;
      }
      case 'task': {
        req('title', 'tên việc'); validateDateRange(errors, data.startDate, data.dueDate, 'startDate', 'dueDate');
        if (data.parentId && e.id && data.parentId === e.id) errors.parentId = 'Việc không thể là việc cha của chính nó.';
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var to = {
          title: data.title, campaignId: data.campaignId || null, parentId: data.parentId || null,
          assigneeId: data.assigneeId || null, ownerId: data.assigneeId || null, status: data.status,
          priority: data.priority, startDate: data.startDate || null, dueDate: data.dueDate || null,
          effortHours: data.effortHours ? Number(data.effortHours) : null,
          deliverable: data.deliverable || '', description: data.description || ''
        };
        if (e.id) done(sUpdate('tasks', e.id, to), 'Đã lưu công việc.');
        else done(sCreate('tasks', Object.assign({ checklist: [] }, to)), 'Đã tạo công việc.');
        return;
      }
      case 'content': {
        req('title', 'tiêu đề nội dung');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var co = { title: data.title, type: data.type, campaignId: data.campaignId || null, ownerId: data.ownerId || null, scheduledDate: data.scheduledDate || null, brief: data.brief || '', description: data.brief || '', editorialStatus: (editorItem('contentItems') || {}).editorialStatus || 'draft' };
        if (e.id) done(sUpdate('contentItems', e.id, co), 'Đã lưu nội dung.'); else done(sCreate('contentItems', co), 'Đã tạo nội dung.');
        return;
      }
      case 'variant': {
        req('contentItemId', 'nội dung gốc');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var vo = {
          contentItemId: data.contentItemId, platform: data.platform,
          channelLabel: labelStatus(data.platform), channelAccountId: data.channelAccountId || null,
          ownerId: data.ownerId || null, reviewerId: data.reviewerId || null,
          productionDeadline: data.productionDeadline || null, reviewDeadline: data.reviewDeadline || null,
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt).toISOString() : null,
          editorialStatus: data.editorialStatus, caption: data.caption || '', hashtags: data.hashtags || '',
          brief: data.brief || '', mediaUrl: data.mediaUrl || '', linkUrl: data.mediaUrl || '', script: data.script || ''
        };
        if (data.platform === 'tiktok') {
          vo.publishMode = 'external';
          vo.hook = data.hook || ''; vo.cta = data.cta || '';
          vo.scriptScenes = readScenes(form);
          vo.externalUrl = data.externalUrl || '';
          vo.actualPublishedAt = data.actualPublishedAt ? new Date(data.actualPublishedAt).toISOString() : null;
          if (vo.externalUrl) vo.externalStatus = 'Đã đăng ngoài app';
        }
        if (e.id) done(sUpdate('variants', e.id, vo), 'Đã lưu phiên bản theo kênh.');
        else done(sCreate('variants', Object.assign({ revision: 1, approvalStatus: 'draft', publishMode: data.platform === 'tiktok' ? 'external' : 'app' }, vo)), 'Đã tạo phiên bản theo kênh.');
        return;
      }
      case 'kpi': {
        req('name', 'tên KPI');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var ko = { name: data.name, campaignId: data.campaignId || null, target: data.target ? Number(data.target) : null, unit: data.unit || '', definition: data.definition || '', period: data.period || '', ownerId: data.ownerId || null };
        if (e.id) done(sUpdate('kpis', e.id, ko), 'Đã lưu KPI.'); else done(sCreate('kpis', ko), 'Đã tạo KPI.');
        return;
      }
      case 'measurement': {
        req('value', 'giá trị'); req('source', 'nguồn số liệu');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var when = data.measuredAt ? new Date(data.measuredAt + 'T00:00:00').toISOString() : new Date().toISOString();
        done(sUpdate('kpis', e.context.kpiId, { actual: Number(data.value), source: data.source, updatedAt: when }), 'Đã lưu số đo mới cho KPI.');
        return;
      }
      case 'budgetLine': {
        req('name', 'tên dòng ngân sách');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var blo = { name: data.name, campaignId: data.campaignId || null, planned: data.planned ? Number(data.planned) : null, approved: data.approved ? Number(data.approved) : null, currency: data.currency };
        if (e.id) done(sUpdate('budgetLines', e.id, blo), 'Đã lưu dòng ngân sách.'); else done(sCreate('budgetLines', blo), 'Đã tạo dòng ngân sách.');
        return;
      }
      case 'commitment': {
        req('budgetLineId', 'dòng ngân sách'); req('title', 'nội dung cam kết');
        var settled = data.settledAmount ? Number(data.settledAmount) : 0;
        var amount = data.amount ? Number(data.amount) : 0;
        if (settled > amount && amount > 0) errors.settledAmount = 'Số đã thanh toán không thể lớn hơn số cam kết.';
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var cmo = { budgetLineId: data.budgetLineId, title: data.title, amount: amount, currency: data.currency, status: data.status, settledAmount: settled || null };
        var commitDone = function (res) {
          if (settled > 0) {
            var cid = e.id || (res && res.item && res.item.id);
            saveResult(sCreate('actuals', { budgetLineId: data.budgetLineId, commitmentId: cid || null, title: 'Thanh toán cho: ' + data.title, amount: settled, currency: data.currency, date: todayISO(), source: 'Ghi kèm cam kết chi' }),
              function () { finishSave('Đã lưu cam kết và khoản thanh toán kèm theo.'); },
              function (msg) { editorFail('Đã lưu cam kết nhưng chưa ghi được khoản thanh toán kèm theo: ' + msg, {}); });
          } else finishSave(e.id ? 'Đã lưu cam kết.' : 'Đã thêm cam kết.');
        };
        saveResult(e.id ? sUpdate('commitments', e.id, cmo) : sCreate('commitments', cmo), commitDone, function (msg) { editorFail(msg, errors); });
        return;
      }
      case 'actual': {
        req('budgetLineId', 'dòng ngân sách'); req('title', 'nội dung chi');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var aco = { budgetLineId: data.budgetLineId, commitmentId: data.commitmentId || null, title: data.title, amount: data.amount ? Number(data.amount) : 0, date: data.date || todayISO(), source: data.source || '' };
        if (e.id) done(sUpdate('actuals', e.id, aco), 'Đã lưu khoản chi.'); else done(sCreate('actuals', aco), 'Đã ghi khoản chi thực tế.');
        return;
      }
      case 'post': {
        req('externalPostId', 'mã bài'); req('title', 'tiêu đề');
        if (Object.keys(errors).length) return editorFail('Một số trường chưa hợp lệ.', errors);
        var poo = { platform: data.platform, channelAccountId: data.channelAccountId || null, externalPostId: data.externalPostId, title: data.title, url: data.url || '', publishedAt: data.publishedAt ? new Date(data.publishedAt).toISOString() : new Date().toISOString(), campaignId: data.campaignId || null, source: 'manual' };
        if (e.id) done(sUpdate('externalPosts', e.id, poo), 'Đã lưu bài đã đăng.'); else done(sCreate('externalPosts', poo), 'Đã thêm bài đã đăng (nguồn: nhập tay).');
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
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt).toISOString() : null,
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
        done(sUpdate('members', e.context.memberId, { capacityHoursPerWeek: data.capacityHoursPerWeek ? Number(data.capacityHoursPerWeek) : 0, daysOff: days }), 'Đã lưu năng lực & ngày nghỉ.');
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
        done(saveTiktokMetricsCall(e.context.variantId, { metric: data.metric, value: Number(data.value), observedAt: new Date(data.observedAt).toISOString() }, data.source), 'Đã lưu số liệu cho đúng video này.');
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
    UI.taskPanelId = id;
    UI.taskPanelReturnHash = (window.location.hash && window.location.hash !== '#/tasks/' + id) ? window.location.hash : '#/tasks';
    try { window.history.replaceState(null, '', '#/tasks/' + id); } catch (e) {}
    renderOverlay();
  }
  function closeTaskPanel() {
    UI.taskPanelId = null;
    if (ROUTE.name === 'tasks' && ROUTE.id) { try { window.history.replaceState(null, '', '#/tasks'); } catch (e) {} ROUTE = parseRouteAfterReplace(); render(); return; }
    try { window.history.replaceState(null, '', UI.taskPanelReturnHash || '#/overview'); } catch (e) {}
    renderOverlay();
  }
  function parseRouteAfterReplace() {
    var h = (window.location.hash || '#/overview').replace(/^#\/?/, '');
    var parts = h.split('/').filter(function (x) { return x !== ''; });
    return { name: parts[0] || 'overview', id: null, sub: null };
  }
  function taskPanelHtml() {
    var id = currentTaskPanelId();
    if (!id) return '';
    var t = taskById(id);
    if (!t) return '<div class="panel-backdrop" data-action="task-close"></div><aside class="detail-panel"><div class="modal-head"><h2>Công việc</h2><button class="btn secondary small" data-action="task-close">Đóng</button></div>' + emptyState('Không tìm thấy công việc', 'Công việc có thể đã bị lưu trữ hoặc không còn tồn tại.') + '</aside>';
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
    var html = '<div class="panel-backdrop" data-action="task-close"></div><aside class="detail-panel" aria-label="Chi tiết công việc">';
    html += '<div class="modal-head"><div><h2>' + esc(t.title) + '</h2><p class="sub">' + esc(campaignName(t.campaignId)) + ' · ' + statusBadge(t.status) + (isOverdue(t) ? ' <span class="badge bad">Quá hạn</span>' : '') + '</p></div>' +
      '<button class="btn secondary small" data-action="task-close">Đóng ✕</button></div>';
    html += taskReadonlyNote();
    if (!ro && !ed && statusEd) html += '<div class="notice info" role="note">Vai trò hiện tại chỉ đổi được trạng thái công việc — các ô khác đã bị khóa.</div>';
    html += '<div class="panel-meta">' + readinessBadge(t) +
      (preds.length ? ' <span class="sub">Đang chờ: ' + esc(preds.map(function (x) { var p = taskById(x.predecessorId); return p ? p.title : x.predecessorId; }).join(', ')) + '</span>' : '') +
      (succs.length ? '<br><span class="sub">Các việc đang chờ mình: ' + esc(succs.map(function (x) { var p = taskById(x.successorId); return p ? p.title : x.successorId; }).join(', ')) + '</span>' : '') + '</div>';
    html += '<form id="task-panel-form" data-task-id="' + esc(t.id) + '" class="editor-form">' +
      F2('title', 'Tên việc *', 'text', t.title, { disabled: !ed }) +
      F2sel('assigneeId', 'Người phụ trách', t.assigneeId, memberPairs(), '— Chưa phân công —', { disabled: !ed }) +
      F2sel('campaignId', 'Campaign (để trống = việc độc lập)', t.campaignId, campaignPairs(), '— Việc độc lập —', { disabled: !ed }) +
      F2sel('parentId', 'Việc cha', t.parentId, tasks.filter(function (x) { return x.id !== t.id; }).map(function (x) { return [x.id, x.title]; }), '— Không có —', { disabled: !ed }) +
      F2sel('status', 'Trạng thái', t.status, TASK_STATUSES, null, { disabled: !statusEd }) +
      F2sel('priority', 'Ưu tiên', t.priority || 'Trung bình', PRIORITIES.map(function (x) { return [x, x]; }), null, { disabled: !ed }) +
      F2('startDate', 'Ngày bắt đầu', 'date', t.startDate ? String(t.startDate).slice(0, 10) : '', { disabled: !ed }) +
      F2('dueDate', 'Mốc cần hoàn thành', 'date', t.dueDate ? String(t.dueDate).slice(0, 10) : '', { disabled: !ed }) +
      F2('effortHours', 'Thời gian dự kiến (giờ)', 'number', t.effortHours, { step: 0.5, min: 0, disabled: !ed }) +
      F2('deliverable', 'Đầu ra cần bàn giao', 'text', t.deliverable, { wide: true, disabled: !ed }) +
      '<label class="fld wide">Mô tả<textarea name="description" rows="3"' + dis(!ed) + '>' + esc(t.description || '') + '</textarea></label>' +
      F2('availabilityNote', 'Ghi chú thời gian có thể nhận việc', 'text', t.availabilityNote, { wide: true, disabled: !ed }) +
      '<div class="form-actions"><button class="btn" type="submit"' + dis(ro) + (ro ? noEditTitle() : '') + '>Lưu thay đổi</button></div></form>';
    // Checklist
    html += '<h3>Danh sách kiểm tra (' + checklist.filter(function (c) { return c.done; }).length + '/' + checklist.length + ')</h3>';
    if (!checklist.length) html += '<p class="sub">Chưa có mục kiểm tra nào.</p>';
    else html += '<ul class="checklist">' + checklist.map(function (c, i) {
      return '<li><label><input type="checkbox" data-action-change="checklist-toggle" data-id="' + esc(t.id) + '" data-idx="' + i + '"' + (c.done ? ' checked' : '') + dis(!ed) + '> <span class="' + (c.done ? 'done-text' : '') + '">' + esc(c.text || c.title || '') + '</span></label>' +
        '<button class="btn small secondary" data-action="checklist-remove" data-id="' + esc(t.id) + '" data-idx="' + i + '"' + dis(!ed) + '>Xóa</button></li>';
    }).join('') + '</ul>';
    html += '<form class="inline" id="checklist-add-form" data-task-id="' + esc(t.id) + '"><label>Mục kiểm tra mới<input type="text" name="text" required' + dis(!ed) + '></label><button class="btn small" type="submit"' + dis(!ed) + (ro ? noEditTitle() : '') + '>Thêm mục</button></form>';
    // Phụ thuộc
    html += '<h3>Quan hệ phụ thuộc</h3>';
    html += '<p class="sub"><strong>Đang chờ:</strong> ' + (preds.length ? preds.map(function (x) { var p = taskById(x.predecessorId); return esc(p ? p.title : x.predecessorId) + ' <button class="btn small secondary" data-action="dep-remove" data-id="' + esc(x.id) + '"' + dis(!ed) + '>Bỏ</button>'; }).join(' · ') : 'Không chờ việc nào') + '</p>';
    html += '<p class="sub"><strong>Các việc đang chờ mình:</strong> ' + (succs.length ? succs.map(function (x) { var p = taskById(x.successorId); return esc(p ? p.title : x.successorId); }).join(' · ') : 'Chưa có việc nào chờ việc này') + '</p>';
    html += '<form class="inline" id="dep-add-panel-form" data-task-id="' + esc(t.id) + '"><label>Việc phải xong trước việc này<select name="predecessorId"' + dis(!ed) + '>' +
      tasks.filter(function (x) { return x.id !== t.id; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>'; }).join('') +
      '</select></label><button class="btn small secondary" type="submit"' + dis(!ed) + (ro ? noEditTitle() : '') + '>Thêm phụ thuộc</button></form>';
    if (subtasks.length) {
      html += '<h3>Việc con</h3><ul class="clean">' + subtasks.map(function (s) { return '<li><button class="linklike" data-action="open-task" data-id="' + esc(s.id) + '">' + esc(s.title) + '</button> — ' + statusBadge(s.status) + '</li>'; }).join('') + '</ul>';
    }
    if (blockers.length) {
      html += '<h3>Trở ngại</h3>' + blockers.map(function (b) {
        return '<div class="notice ' + (b.status === 'open' ? 'warn' : 'ok') + '"><strong>' + esc(b.title) + '</strong> — ' + esc(b.description || '') + ' (' + esc(labelStatus(b.status)) + ')' +
          (b.status === 'open' ? ' <button class="btn small secondary" data-action="resolve-blocker" data-id="' + esc(b.id) + '"' + dis(!ed) + '>Đánh dấu đã gỡ</button>' : '') + '</div>';
      }).join('');
    }
    // Bình luận
    html += '<h3>Bình luận</h3>';
    if (!comments.length) html += '<p class="sub">Chưa có bình luận. (Nếu tầng dữ liệu chưa hỗ trợ bình luận, nội dung gửi sẽ báo lỗi rõ thay vì báo đã lưu.)</p>';
    else html += '<ul class="clean">' + comments.map(function (c) { return '<li><strong>' + esc(memberName(c.authorId || c.createdBy)) + '</strong> · ' + esc(D.formatDateTimeVN(c.createdAt)) + '<br>' + esc(c.body || c.text || '') + '</li>'; }).join('') + '</ul>';
    html += '<form class="inline" id="comment-add-form" data-task-id="' + esc(t.id) + '"><label>Bình luận mới<input type="text" name="body" required placeholder="Gõ @ để nhắc tên trong nội dung"' + dis(!commentEd) + '></label><button class="btn small" type="submit"' + dis(!commentEd) + '>Gửi</button></form>';
    // Lịch sử + lưu trữ
    html += '<h3>Lịch sử bản ghi</h3><p class="sub">Tạo: ' + esc(D.formatDateTimeVN(t.createdAt) || '—') + ' · Cập nhật: ' + esc(D.formatDateTimeVN(t.updatedAt) || '—') + (t.updatedBy ? ' · Người sửa gần nhất: ' + esc(memberName(t.updatedBy)) : '') + '</p>';
    html += '<p>' + (isArchived(t)
      ? '<button class="btn secondary" data-action="task-restore" data-id="' + esc(t.id) + '"' + dis(!ed) + '>Khôi phục việc</button>'
      : '<button class="btn secondary" data-action="task-archive" data-id="' + esc(t.id) + '"' + dis(!ed) + '>Lưu trữ việc</button>') + '</p>';
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
  function ganttVisibleRows(rows) {
    var hidden = {};
    rows.forEach(function (r) { if (UI.ganttCollapsed[r.key]) hidden[r.key] = true; });
    return rows.filter(function (r) {
      var p = r.parentKey;
      while (p) { if (hidden[p]) return false; var pr = rows.find(function (x) { return x.key === p; }); p = pr ? pr.parentKey : null; }
      return true;
    });
  }
  function ganttHtml(rowsAll, edges) {
    var rows = ganttVisibleRows(rowsAll);
    var dated = rows.filter(function (r) { return r.start && r.end; });
    var head = '<div class="gantt-toolbar"><span class="sub">Thang thời gian: </span>' +
      '<button class="btn small ' + (UI.ganttScale === 'week' ? '' : 'secondary') + '" data-action="gantt-scale" data-id="week">Theo tuần</button> ' +
      '<button class="btn small ' + (UI.ganttScale === 'month' ? '' : 'secondary') + '" data-action="gantt-scale" data-id="month">Theo tháng</button>' +
      '<span class="sub"> Kéo thanh để dời lịch, kéo hai đầu để đổi độ dài — thay đổi chỉ áp dụng khi bấm Lưu. Thanh mờ phía dưới là kế hoạch đã duyệt.</span></div>';
    if (UI.ganttPreview) {
      var pv = UI.ganttPreview;
      head += '<div class="notice warn" role="alert"><strong>Xem trước thay đổi lịch:</strong> ' + esc(pv.title) + ' → ' + esc(D.formatDateVN(pv.newStart)) + ' — ' + esc(D.formatDateVN(pv.newEnd)) + '.' +
        (pv.impact && pv.impact.length ? '<br>Ảnh hưởng phụ thuộc: ' + pv.impact.map(function (i) { return esc(i.title) + ' (đề xuất ' + esc(D.formatDateVN(i.proposedStart)) + ' — ' + esc(D.formatDateVN(i.proposedDue)) + ')'; }).join('; ') + '. Hệ thống không tự dịch các việc này.' : '<br>Không có việc phụ thuộc nào bị ảnh hưởng.') +
        '<br><button class="btn small" data-action="gantt-apply">Lưu thay đổi</button> <button class="btn small secondary" data-action="gantt-cancel">Hủy (giữ lịch cũ)</button></div>';
    }
    if (!dated.length) return head + '<div class="state-box">Chưa có mục nào có đủ ngày bắt đầu và ngày kết thúc để vẽ biểu đồ kế hoạch.</div>';
    var mins = dated.map(function (r) { return r.start; }).concat(dated.map(function (r) { return r.bStart || r.start; }));
    var maxs = dated.map(function (r) { return r.end; }).concat(dated.map(function (r) { return r.bEnd || r.end; }));
    mins.sort(); maxs.sort();
    var minISO = addDaysISO(mins[0], -2), maxISO = addDaysISO(maxs[maxs.length - 1], 2);
    var totalDays = Math.max(1, Math.round((new Date(maxISO + 'T00:00:00') - new Date(minISO + 'T00:00:00')) / 86400000));
    function pct(iso) { return (new Date(String(iso).slice(0, 10) + 'T00:00:00') - new Date(minISO + 'T00:00:00')) / 86400000 / totalDays * 100; }
    // Trục thời gian
    var ticks = '';
    if (UI.ganttScale === 'month') {
      var cur = new Date(minISO + 'T00:00:00'); cur.setDate(1);
      while (isoOf(cur) <= maxISO) {
        ticks += '<div class="g2-tick" style="left:' + pct(isoOf(cur)) + '%">Tháng ' + (cur.getMonth() + 1) + '/' + cur.getFullYear() + '</div>';
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      var cur2 = mondayOf(new Date(minISO + 'T00:00:00'));
      while (isoOf(cur2) <= maxISO) {
        ticks += '<div class="g2-tick" style="left:' + pct(isoOf(cur2)) + '%">' + D.formatDateVN(isoOf(cur2)) + '</div>';
        cur2.setDate(cur2.getDate() + 7);
      }
    }
    var todayPct = pct(todayISO());
    var rowIndexByKey = {};
    rows.forEach(function (r, i) { rowIndexByKey[r.key] = i; });
    // SVG đường phụ thuộc (tọa độ % x, px y trong vùng track)
    var svgPaths = '';
    (edges || []).forEach(function (e) {
      var a = rows.find(function (r) { return r.ganttId === e.predecessorId; });
      var b = rows.find(function (r) { return r.ganttId === e.successorId; });
      if (!a || !b || !a.start || !b.start) return;
      var x1 = pct(a.end) * 10, x2 = pct(b.start) * 10;
      var y1 = rowIndexByKey[a.key] * GANTT_ROW_H + GANTT_ROW_H / 2, y2 = rowIndexByKey[b.key] * GANTT_ROW_H + GANTT_ROW_H / 2;
      var mx = Math.max(x1 + 12, x2 - 4);
      svgPaths += '<polyline points="' + x1 + ',' + y1 + ' ' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" fill="none" stroke="#66707e" stroke-width="1.6" marker-end="url(#g2arrow)"/>';
    });
    var bodyH = rows.length * GANTT_ROW_H;
    var body = '<div class="g2-body" style="height:' + bodyH + 'px">' +
      (todayPct >= 0 && todayPct <= 100 ? '<div class="g2-today" style="left:calc(230px + (100% - 230px) * ' + (todayPct / 100) + ')" title="Hôm nay"></div>' : '') +
      '<svg class="g2-svg" style="left:230px;width:calc(100% - 230px);height:' + bodyH + 'px" viewBox="0 0 1000 ' + bodyH + '" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="g2arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#66707e"/></marker></defs>' + svgPaths + '</svg>' +
      rows.map(function (r) {
        var indent = 8 + (r.depth || 0) * 18;
        var toggle = r.hasChildren ? '<button class="g2-toggle" data-action="gantt-toggle" data-id="' + esc(r.key) + '" aria-label="Thu/mở">' + (UI.ganttCollapsed[r.key] ? '▸' : '▾') + '</button>' : '<span class="g2-toggle-sp"></span>';
        var name = '<div class="g2-name" style="padding-left:' + indent + 'px">' + toggle + '<button class="linklike g2-title" data-action="gantt-open" data-id="' + esc(r.key) + '" data-coll="' + esc(r.coll || '') + '" data-oid="' + esc(r.ganttId || r.id) + '">' + esc(r.title) + '</button></div>';
        var track = '<div class="g2-track">';
        if (r.start && r.end) {
          var left = pct(r.start), width = Math.max(1.2, pct(addDaysISO(r.end, 1)) - left);
          var locked = r.completed || !canEdit();
          if (r.milestone) {
            track += '<div class="g2-mile" style="left:' + left + '%" title="Mốc: ' + esc(D.formatDateVN(r.start)) + '"></div>';
          } else {
            track += '<div class="g2-bar kind-' + esc(r.kind) + (r.completed ? ' is-done' : '') + '" data-gantt-drag="1" data-coll="' + esc(r.coll || '') + '" data-oid="' + esc(r.ganttId || r.id) + '" data-title="' + esc(r.title) + '" data-start="' + esc(r.start) + '" data-end="' + esc(r.end) + '" data-locked="' + (locked ? '1' : '0') + '" style="left:' + left + '%;width:' + width + '%" title="' + esc(r.title) + ' · ' + esc(D.formatDateVN(r.start)) + ' — ' + esc(D.formatDateVN(r.end)) + (r.completed ? ' · Đã hoàn thành — không kéo được' : '') + '"></div>';
          }
          if (r.bStart && r.bEnd) {
            var bl = pct(r.bStart), bw = Math.max(1.2, pct(addDaysISO(r.bEnd, 1)) - bl);
            track += '<div class="g2-bar baseline" style="left:' + bl + '%;width:' + bw + '%" title="Kế hoạch đã duyệt"></div>';
          }
        } else {
          track += '<span class="sub g2-unsched">Chưa xếp lịch</span>';
        }
        return '<div class="g2-row">' + name + track + '</div></div>';
      }).join('') + '</div>';
    return head + '<div class="g2-wrap"><div class="g2-inner" data-total-days="' + totalDays + '"><div class="g2-head"><div class="g2-name g2-headname">Tên</div><div class="g2-track g2-ticks">' + ticks + '</div></div>' + body + '</div></div>';
  }
  function ganttRowsPortfolio() {
    var rows = [];
    visibleList('campaigns').forEach(function (c) {
      var ckey = 'camp:' + c.id;
      var phases = Store.list('phases').filter(function (x) { return x.campaignId === c.id; });
      var acts = Store.list('activities').filter(function (x) { return x.campaignId === c.id; });
      var tasks = Store.list('tasks').filter(function (x) { return x.campaignId === c.id && !isArchived(x); });
      rows.push({ key: ckey, coll: 'campaigns', id: c.id, ganttId: c.id, title: c.name, kind: 'campaign', depth: 0, start: c.startDate, end: c.endDate, bStart: c.baselineStartDate, bEnd: c.baselineEndDate, hasChildren: !!(phases.length || acts.length || tasks.length), completed: c.status === 'completed' });
      phases.forEach(function (p) {
        rows.push({ key: 'phase:' + p.id, parentKey: ckey, coll: 'phases', id: p.id, ganttId: p.id, title: p.name, kind: 'phase', depth: 1, start: p.startDate, end: p.endDate, hasChildren: false });
      });
      acts.forEach(function (a) {
        var ph = phases.find(function (x) { return x.id === a.phaseId; });
        rows.push({ key: 'act:' + a.id, parentKey: ckey, coll: 'activities', id: a.id, ganttId: a.id, title: a.name + (a.channel ? ' (' + a.channel + ')' : ''), kind: 'activity', depth: 1, start: a.startDate || (ph && ph.startDate), end: a.endDate || (ph && ph.endDate), hasChildren: false });
      });
      tasks.filter(function (t) { return !t.parentId; }).forEach(function (t) {
        rows.push({ key: 'task:' + t.id, parentKey: ckey, coll: 'tasks', id: t.id, ganttId: t.id, title: t.title, kind: 'task', depth: 1, start: t.startDate, end: t.dueDate, bStart: t.baselineStartDate, bEnd: t.baselineDueDate, completed: isCompletedTask(t), milestone: !!(t.startDate && t.startDate === t.dueDate), hasChildren: tasks.some(function (x) { return x.parentId === t.id; }) });
        tasks.filter(function (x) { return x.parentId === t.id; }).forEach(function (st) {
          rows.push({ key: 'task:' + st.id, parentKey: 'task:' + t.id, coll: 'tasks', id: st.id, ganttId: st.id, title: st.title, kind: 'task', depth: 2, start: st.startDate, end: st.dueDate, bStart: st.baselineStartDate, bEnd: st.baselineDueDate, completed: isCompletedTask(st), milestone: !!(st.startDate && st.startDate === st.dueDate), hasChildren: false });
        });
      });
    });
    return rows;
  }
  function ganttRowsCampaign(c) {
    var rows = [];
    var phases = Store.list('phases').filter(function (x) { return x.campaignId === c.id; });
    var acts = Store.list('activities').filter(function (x) { return x.campaignId === c.id; });
    var tasks = Store.list('tasks').filter(function (x) { return x.campaignId === c.id && !isArchived(x); });
    phases.forEach(function (p) {
      rows.push({ key: 'phase:' + p.id, coll: 'phases', id: p.id, ganttId: p.id, title: p.name, kind: 'phase', depth: 0, start: p.startDate, end: p.endDate, hasChildren: acts.some(function (a) { return a.phaseId === p.id; }) });
      acts.filter(function (a) { return a.phaseId === p.id; }).forEach(function (a) {
        rows.push({ key: 'act:' + a.id, parentKey: 'phase:' + p.id, coll: 'activities', id: a.id, ganttId: a.id, title: a.name, kind: 'activity', depth: 1, start: a.startDate || p.startDate, end: a.endDate || p.endDate, hasChildren: false });
      });
    });
    acts.filter(function (a) { return !a.phaseId; }).forEach(function (a) {
      rows.push({ key: 'act:' + a.id, coll: 'activities', id: a.id, ganttId: a.id, title: a.name, kind: 'activity', depth: 0, start: a.startDate, end: a.endDate, hasChildren: false });
    });
    tasks.filter(function (t) { return !t.parentId; }).forEach(function (t) {
      rows.push({ key: 'task:' + t.id, coll: 'tasks', id: t.id, ganttId: t.id, title: t.title, kind: 'task', depth: 0, start: t.startDate, end: t.dueDate, bStart: t.baselineStartDate, bEnd: t.baselineDueDate, completed: isCompletedTask(t), milestone: !!(t.startDate && t.startDate === t.dueDate), hasChildren: tasks.some(function (x) { return x.parentId === t.id; }) });
      tasks.filter(function (x) { return x.parentId === t.id; }).forEach(function (st) {
        rows.push({ key: 'task:' + st.id, parentKey: 'task:' + t.id, coll: 'tasks', id: st.id, ganttId: st.id, title: st.title, kind: 'task', depth: 1, start: st.startDate, end: st.dueDate, bStart: st.baselineStartDate, bEnd: st.baselineDueDate, completed: isCompletedTask(st), milestone: !!(st.startDate && st.startDate === st.dueDate), hasChildren: false });
      });
    });
    return rows;
  }

  // Kéo / đổi kích thước thanh Gantt bằng pointer events
  var ganttDrag = null;
  document.addEventListener('pointerdown', function (ev) {
    var bar = ev.target.closest ? ev.target.closest('[data-gantt-drag]') : null;
    if (!bar || bar.getAttribute('data-locked') === '1') return;
    var track = bar.parentElement;
    var rect = track.getBoundingClientRect();
    var inner = bar.closest('.g2-inner');
    var totalDays = 30;
    // Suy ra tổng số ngày từ bề rộng: dùng thuộc tính đã render qua today? Đơn giản: đo từ hàng đầu có bar.
    ganttDrag = {
      bar: bar, mode: 'move', x0: ev.clientX, trackW: rect.width,
      start: bar.getAttribute('data-start'), end: bar.getAttribute('data-end'),
      coll: bar.getAttribute('data-coll'), id: bar.getAttribute('data-oid'), title: bar.getAttribute('data-title'),
      leftPx: bar.offsetLeft, widthPx: bar.offsetWidth, moved: false, innerW: inner ? inner.querySelector('.g2-body').getBoundingClientRect().width - 230 : rect.width
    };
    var relX = ev.clientX - bar.getBoundingClientRect().left;
    if (relX < 8) ganttDrag.mode = 'left';
    else if (relX > bar.offsetWidth - 8) ganttDrag.mode = 'right';
    // Ngày/pixel từ trục thời gian thật: bề rộng vùng track / tổng số ngày của thang.
    var totalDaysAttr = inner ? Number(inner.getAttribute('data-total-days') || 0) : 0;
    var trackAreaW = inner ? Math.max(200, inner.getBoundingClientRect().width - 230) : rect.width;
    ganttDrag.pxPerDay = totalDaysAttr > 0 ? trackAreaW / totalDaysAttr : Math.max(4, rect.width / 30);
    ev.preventDefault();
  });
  document.addEventListener('pointermove', function (ev) {
    if (!ganttDrag) return;
    var dx = ev.clientX - ganttDrag.x0;
    var dDays = Math.round(dx / Math.max(4, ganttDrag.pxPerDay));
    if (dDays === (ganttDrag.lastDays || 0)) return;
    ganttDrag.lastDays = dDays; ganttDrag.moved = true;
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
    ganttDrag.bar.style.opacity = '0.65';
  });
  document.addEventListener('pointerup', function () {
    if (!ganttDrag) return;
    var tip = document.getElementById('g2-tip'); if (tip) tip.hidden = true;
    var drag = ganttDrag; ganttDrag = null;
    if (!drag.moved || !drag.newStart || (drag.newStart === drag.start && drag.newEnd === drag.end)) { render(); return; }
    var impact = [];
    if (drag.coll === 'tasks') impact = D.previewDependencyImpact(drag.id, drag.newStart, drag.newEnd, Store.list('tasks'), Store.list('dependencies'));
    UI.ganttPreview = { coll: drag.coll, id: drag.id, title: drag.title, newStart: drag.newStart, newEnd: drag.newEnd, impact: impact };
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
      if (od.length) reasons.push(od.length + ' việc quá hạn (muộn nhất: ' + od.map(function (t) { return t.title + ' — hạn ' + D.formatDateVN(t.dueDate); }).join('; ') + ')');
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
      if (blockedReal.length) reasons.push(blockedReal.length + ' việc đang bị chặn thật (có trở ngại đang mở hoặc việc trước đã quá hạn)');
      if (c.risks) reasons.push('Rủi ro đã ghi: ' + c.risks);
      if (reasons.length) atRisk.push({ campaign: c, reason: reasons.join('. ') });
    });
    var html = pageHead('Tổng quan', 'Tình hình Marketing tại thời điểm hiện tại' + (Store.mode === 'demo' ? ' — dữ liệu minh họa' : '') + '.',
      canEdit() ? '<a class="btn" href="#/campaigns">+ Tạo campaign</a>' : '');
    html += collectionBanner('campaigns');
    if (!collLoadingOrError('campaigns') && !campaigns.length) {
      html += emptyState('Workspace chưa có campaign nào', 'Bắt đầu bằng cách tạo campaign đầu tiên, sau đó thêm giai đoạn, công việc và nội dung ngay trong trang chi tiết campaign.',
        '<p><a class="btn" href="#/campaigns">Tới mục IMC & Campaigns để tạo</a> <a class="btn secondary" href="#/settings">Thiết lập BU/sản phẩm trước</a></p>');
    }
    html += '<div class="cards">' +
      '<div class="card"><div class="big">' + running.length + '</div>Campaign đang chạy<br><a href="#/campaigns">Xem danh sách</a></div>' +
      '<div class="card"><div class="big">' + approvals.length + '</div>Nội dung chờ duyệt<br><a href="#/approvals">Tới hộp duyệt</a></div>' +
      '<div class="card"><div class="big">' + overdue.length + '</div>Việc quá hạn<br><a href="#/tasks">Xem công việc</a></div>' +
      '<div class="card"><div class="big">' + atRisk.length + '</div>Campaign có nguy cơ trễ (có căn cứ thời gian/trở ngại)</div></div>';
    html += '<h2>Campaign đang chạy</h2>';
    if (!running.length && campaigns.length) html += '<div class="state-box">Chưa có campaign nào đang chạy.</div>';
    running.forEach(function (c) {
      var p = D.campaignProgress(tasks.filter(function (t) { return t.campaignId === c.id; }));
      html += '<div class="card"><strong><a href="#/campaigns/' + esc(c.id) + '">' + esc(c.name) + '</a></strong><p class="sub">' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + ' · Người phụ trách: ' + esc(memberName(c.ownerId)) + '</p>' +
        '<div class="progress"><div style="width:' + p.percentage + '%"></div></div><p class="sub">Tiến độ (chỉ tính việc chi tiết, không tính việc cha): ' + p.completed + '/' + p.total + ' (' + p.percentage + '%)</p></div>';
    });
    html += '<h2>Nguy cơ trễ (kèm lý do cụ thể)</h2>';
    if (collLoadingOrError('tasks')) html += collectionBanner('tasks');
    else if (!atRisk.length) html += '<div class="state-box">Không có campaign nào có dấu hiệu trễ có căn cứ.</div>';
    atRisk.forEach(function (r) {
      html += '<div class="notice warn"><strong><a href="#/campaigns/' + esc(r.campaign.id) + '">' + esc(r.campaign.name) + '</a></strong> — ' + esc(r.reason) + '</div>';
    });
    html += '<h2>Chờ duyệt & quá hạn</h2><div class="grid2"><div class="panel"><h3>Chờ duyệt (' + approvals.length + ')</h3>' +
      (approvals.length ? '<ul class="clean">' + approvals.map(function (a) { return '<li><a href="#/approvals">' + esc(contentTitle(a.contentItemId)) + '</a> · phiên bản nội dung số ' + esc(a.revision) + ' · từ ' + esc(memberName(a.requestedBy)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có nội dung chờ duyệt.</p>') + '</div>' +
      '<div class="panel"><h3>Quá hạn (' + overdue.length + ')</h3>' +
      (overdue.length ? '<ul class="clean">' + overdue.map(function (t) { return '<li><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button> — hạn ' + esc(D.formatDateVN(t.dueDate)) + ' · ' + esc(memberName(t.assigneeId)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có việc quá hạn.</p>') + '</div></div>';
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
      ['Việc đang chờ mình', tasks.filter(function (t) { return !myIds[t.id] && !isCompletedTask(t) && edges.some(function (e) { return e.successorId === t.id && myIds[e.predecessorId] && !isCompletedTask(taskById(e.predecessorId) || {}); }); })]
    ];
    var myApprovals = Store.list('approvals').filter(function (a) {
      return (a.status === 'pending' || a.status === 'needs_reapproval') && a.requestedBy !== (me && me.id);
    });
    var myContent = Store.list('variants').filter(function (v2) {
      return v2.ownerId === (me && me.id) && v2.scheduledAt && String(v2.scheduledAt).slice(0, 10) >= weekStart && String(v2.scheduledAt).slice(0, 10) <= weekEnd;
    });
    var html = pageHead('Việc của tôi', 'Việc của ' + (me ? me.name : '—') + (Store.mode === 'demo' ? ' (đổi người dùng ở thanh trên — chỉ trong Chế độ demo)' : '') + '. Bấm vào tên việc để mở chi tiết và sửa ngay tại chỗ.',
      canEdit() ? '<button class="btn" data-action="editor-open" data-kind="task">+ Tạo việc</button>' : '');
    html += readonlyNote();
    function taskList(list, emptyText) {
      if (!list.length) return '<p class="sub">' + esc(emptyText) + '</p>';
      return tbl('<tr><th>Việc</th><th>Campaign</th><th>Mốc cần hoàn thành</th><th>Trạng thái</th><th>Phụ thuộc</th></tr>' +
        list.map(function (t) {
          return '<tr><td><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button></td><td>' + esc(campaignName(t.campaignId)) + '</td><td>' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : 'Chưa xếp lịch') + (isOverdue(t) ? ' <span class="badge bad">Quá hạn</span>' : '') + '</td><td>' + statusBadge(t.status) + '</td><td>' + readinessBadge(t) + '</td></tr>';
        }).join(''));
    }
    groups.forEach(function (g) { html += '<h2>' + esc(g[0]) + ' (' + g[1].length + ')</h2>' + taskList(g[1], 'Không có việc nào trong nhóm này.'); });
    html += '<h2>Chờ mình duyệt (' + myApprovals.length + ')</h2>';
    html += myApprovals.length ? '<ul class="clean">' + myApprovals.map(function (a) { return '<li><a href="#/approvals">' + esc(contentTitle(a.contentItemId)) + '</a> — phiên bản nội dung số ' + esc(a.revision) + ', gửi bởi ' + esc(memberName(a.requestedBy)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có nội dung nào chờ bạn duyệt.</p>';
    html += '<h2>Lịch nội dung của tôi tuần này (' + myContent.length + ')</h2>';
    html += myContent.length ? '<ul class="clean">' + myContent.map(function (v2) { return '<li>' + esc(D.formatDateTimeVN(v2.scheduledAt)) + ' — ' + esc(contentTitle(v2.contentItemId)) + ' (' + esc(v2.channelLabel || labelStatus(v2.platform)) + ')</li>'; }).join('') + '</ul>' : '<p class="sub">Tuần này bạn không có nội dung nào tới lịch đăng.</p>';
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
    return '<p class="sub">Hiện có phiên bản ' + esc(item.version || 1) + ' (' + esc(D.formatDateTimeVN(item.updatedAt)) + '). Lịch sử nhiều phiên bản cần tầng dữ liệu phơi danh sách phiên bản của tài sản — hiện chưa có, xem mục còn thiếu trong báo cáo bàn giao.</p>';
  }
  function viewBrand() {
    var q = UI.brandQuery.toLowerCase();
    function match(x) { return !q || JSON.stringify(x).toLowerCase().indexOf(q) !== -1; }
    var pages = visibleList('brandPages').filter(match);
    var assets = visibleList('brandAssets').filter(match);
    var archPages = archivedList('brandPages').filter(match);
    var archAssets = archivedList('brandAssets').filter(match);
    var ed = canEdit();
    var html = pageHead('Brand Hub', 'Trang thương hiệu và tài nguyên dùng chung cho toàn đội.',
      (ed ? '<button class="btn" data-action="editor-open" data-kind="brandPage">+ Thêm trang</button> <button class="btn secondary" data-action="editor-open" data-kind="brandAsset">+ Thêm tài nguyên</button>' : ''));
    html += readonlyNote() + collectionBanner('brandPages');
    html += '<form class="inline" id="brand-search-form"><label>Tìm kiếm<input type="search" id="brand-query" value="' + esc(UI.brandQuery) + '" placeholder="Tên trang, tài nguyên, loại, thẻ…"></label><button class="btn" type="submit">Tìm</button>' +
      (UI.brandQuery ? ' <button class="btn secondary" type="button" data-action="brand-clear">Xóa lọc</button>' : '') + '</form>';
    html += tabsHtml([['pages', 'Trang thương hiệu (' + pages.length + ')'], ['assets', 'Tài nguyên (' + assets.length + ')'], ['archived', 'Đã lưu trữ (' + (archPages.length + archAssets.length) + ')']], UI.brandTab, 'brand-tab');
    if (UI.brandTab === 'pages') {
      if (!pages.length && !collLoadingOrError('brandPages')) html += emptyState('Chưa có trang thương hiệu nào', 'Tạo trang đầu tiên để ghi nhận câu chuyện thương hiệu, giọng điệu, quy chuẩn trình bày…', ed ? '<p><button class="btn" data-action="editor-open" data-kind="brandPage">+ Thêm trang thương hiệu</button></p>' : '');
      else html += tbl('<tr><th>Trang</th><th>Tóm tắt</th><th>Người phụ trách</th><th>Phiên bản</th><th>Trạng thái bản</th><th>Cập nhật</th><th>Thao tác</th></tr>' + pages.map(function (p) {
        var row = '<tr><td><button class="linklike" data-action="brand-open" data-id="' + esc(p.id) + '"><strong>' + esc(p.title) + '</strong></button></td><td>' + esc(p.summary || '') + '</td><td>' + esc(memberName(p.ownerId)) + '</td><td>v' + esc(p.version || 1) + '</td><td>' + statusBadge(p.status === 'Approved' ? 'approved' : (p.status === 'Archived' ? 'archived' : 'draft'), p.status === 'Approved' ? 'Đã duyệt' : (p.status === 'Archived' ? 'Lưu trữ' : 'Bản nháp')) + '</td><td>' + esc(D.formatDateVN(p.updatedAt)) + '</td>' +
          '<td class="row-actions"><button class="btn small secondary" data-action="brand-open" data-id="' + esc(p.id) + '">Mở</button> <button class="btn small" data-action="editor-open" data-kind="brandPage" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="brandPages" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
        if (UI.brandOpenId === p.id) {
          row += '<tr class="detail-row"><td colspan="7"><h3>Nội dung trang</h3><div class="rich">' + esc(p.content || p.summary || 'Chưa có nội dung chi tiết — bấm Sửa để bổ sung.') + '</div>' +
            (Array.isArray(p.tags) && p.tags.length ? '<p class="sub">Thẻ: ' + esc(p.tags.join(', ')) + '</p>' : '') +
            '<h3>Lịch sử phiên bản</h3>' + versionHistoryHtml('brandPages', p) + '</td></tr>';
        }
        return row;
      }).join(''));
    }
    if (UI.brandTab === 'assets') {
      if (!assets.length && !collLoadingOrError('brandAssets')) html += emptyState('Chưa có tài nguyên thương hiệu nào', 'Thêm logo, KV, hướng dẫn, file nguồn… kèm đường dẫn để cả đội dùng đúng bản đã duyệt.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="brandAsset">+ Thêm tài nguyên</button></p>' : '');
      else html += tbl('<tr><th>Tài nguyên</th><th>Loại</th><th>Đường dẫn</th><th>Người phụ trách</th><th>Phiên bản</th><th>Trạng thái bản</th><th>Thao tác</th></tr>' + assets.map(function (a) {
        var url = a.url || a.fileUrl || '';
        var bi = brandStatusInfo(a);
        var row = '<tr><td><button class="linklike" data-action="brand-open" data-id="' + esc(a.id) + '"><strong>' + esc(a.name) + '</strong></button></td><td>' + esc(a.type) + '</td><td>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">Mở / tải</a>' : '—') + '</td><td>' + esc(memberName(a.ownerId)) + '</td><td>' + (a.version === null || a.version === undefined ? '—' : 'v' + esc(a.version)) + '</td><td>' + statusBadge(bi.status, bi.label) + '</td>' +
          '<td class="row-actions"><button class="btn small secondary" data-action="brand-open" data-id="' + esc(a.id) + '">Chi tiết</button> <button class="btn small" data-action="editor-open" data-kind="brandAsset" data-id="' + esc(a.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="brandAssets" data-id="' + esc(a.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
        if (UI.brandOpenId === a.id) row += '<tr class="detail-row"><td colspan="7"><h3>Lịch sử phiên bản</h3>' + versionHistoryHtml('brandAssets', a) + (Array.isArray(a.tags) && a.tags.length ? '<p class="sub">Thẻ: ' + esc(a.tags.join(', ')) + '</p>' : '') + '</td></tr>';
        return row;
      }).join(''));
    }
    if (UI.brandTab === 'archived') {
      var all = archPages.map(function (x) { return { x: x, coll: 'brandPages', label: x.title }; }).concat(archAssets.map(function (x) { return { x: x, coll: 'brandAssets', label: x.name }; }));
      if (!all.length) html += '<div class="state-box">Chưa có mục nào bị lưu trữ.</div>';
      else html += tbl('<tr><th>Mục đã lưu trữ</th><th>Loại</th><th>Thao tác</th></tr>' + all.map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td><td>' + (r.coll === 'brandPages' ? 'Trang thương hiệu' : 'Tài nguyên') + '</td><td><button class="btn small" data-action="restore-item" data-coll="' + r.coll + '" data-id="' + esc(r.x.id) + '"' + dis(!ed) + '>Khôi phục</button></td></tr>';
      }).join(''));
    }
    return html;
  }

  // ---------- IMC & Campaigns ----------
  function viewCampaigns() {
    var campaigns = visibleList('campaigns');
    var ed = canEdit();
    if (ROUTE.id) return campaignDetailHtml(ROUTE.id);
    var html = pageHead('IMC & Campaigns', 'Kế hoạch truyền thông tích hợp: biểu đồ kế hoạch tổng thể và chi tiết từng campaign.',
      ed ? '<button class="btn" data-action="editor-open" data-kind="campaign">+ Tạo campaign</button>' : '');
    html += readonlyNote() + collectionBanner('campaigns');
    if (!campaigns.length && !collLoadingOrError('campaigns')) {
      return html + emptyState('Chưa có campaign nào — bắt đầu tại đây',
        'Luồng bắt đầu: (1) vào Thiết lập để tạo BU/sản phẩm nếu cần → (2) tạo campaign → (3) trong trang chi tiết campaign, thêm giai đoạn, hoạt động, công việc và nội dung. Toàn bộ làm ngay trên giao diện.',
        '<p>' + (ed ? '<button class="btn" data-action="editor-open" data-kind="campaign">+ Tạo campaign đầu tiên</button> ' : '') + '<a class="btn secondary" href="#/settings">Tới Thiết lập</a></p>');
    }
    html += '<h2>Biểu đồ kế hoạch tổng thể (mọi campaign)</h2>' + ganttHtml(ganttRowsPortfolio(), Store.list('dependencies'));
    html += '<h2>Danh sách campaign (' + campaigns.length + ')</h2><div class="cards">' + campaigns.map(function (c) {
      var p = D.campaignProgress(Store.list('tasks').filter(function (t) { return t.campaignId === c.id && !isArchived(t); }));
      return '<div class="card"><strong><a href="#/campaigns/' + esc(c.id) + '">' + esc(c.name) + '</a></strong><p class="sub">' + statusBadge(c.status) + ' · ' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + ' · ' + esc(memberName(c.ownerId)) + '</p>' +
        '<div class="progress"><div style="width:' + p.percentage + '%"></div></div><p class="sub">Tiến độ: ' + p.completed + '/' + p.total + ' việc chi tiết (' + p.percentage + '%)</p>' +
        '<p><a class="btn small" href="#/campaigns/' + esc(c.id) + '">Mở chi tiết</a> <button class="btn small secondary" data-action="editor-open" data-kind="campaign" data-id="' + esc(c.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="campaigns" data-id="' + esc(c.id) + '"' + dis(!ed) + '>Lưu trữ</button></p></div>';
    }).join('') + '</div>';
    var archived = archivedList('campaigns');
    if (archived.length) {
      html += '<h2>Campaign đã lưu trữ</h2>' + tbl('<tr><th>Campaign</th><th>Thao tác</th></tr>' + archived.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td><button class="btn small" data-action="restore-item" data-coll="campaigns" data-id="' + esc(c.id) + '"' + dis(!ed) + '>Khôi phục</button></td></tr>';
      }).join(''));
    }
    return html;
  }

  function campaignDetailHtml(id) {
    var c = Store.get('campaigns', id);
    if (!c) return emptyState('Không tìm thấy campaign', 'Campaign có thể đã bị lưu trữ. Quay lại danh sách để kiểm tra.', '<p><a class="btn secondary" href="#/campaigns">Về danh sách campaign</a></p>');
    var ed = canEdit();
    var tab = UI.campaignTab || 'overview';
    var base = '#/campaigns/' + encodeURIComponent(id);
    var html = '<p><a href="#/campaigns">← Tất cả campaign</a></p>' + readonlyNote() + collectionBanner('campaigns');
    html += pageHead(c.name, statusBadge(c.status) + ' · ' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + ' · Người phụ trách: ' + esc(memberName(c.ownerId)),
      (ed ? '<button class="btn" data-action="editor-open" data-kind="campaign" data-id="' + esc(c.id) + '">Sửa campaign</button> <button class="btn secondary" data-action="archive-item" data-coll="campaigns" data-id="' + esc(c.id) + '">Lưu trữ</button>' : ''));
    html += '<div class="tabs" role="tablist">' + [['overview', 'Tổng quan'], ['plan', 'Kế hoạch & Timeline'], ['tasks', 'Công việc'], ['content', 'Nội dung'], ['kpi', 'KPI & Ngân sách'], ['docs', 'Tài liệu'], ['summary', 'Tổng kết']].map(function (x) {
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
    }
    if (tab === 'plan') {
      html += '<div class="toolbar"><strong>Giai đoạn (' + phases.length + ')</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="phase" data-campaign="' + esc(c.id) + '">+ Thêm giai đoạn</button>' : '') + '</div>';
      html += phases.length ? tbl('<tr><th>Giai đoạn</th><th>Thời gian</th><th>Người phụ trách</th><th>Thao tác</th></tr>' + phases.map(function (x) {
        return '<tr><td><strong>' + esc(x.name) + '</strong></td><td>' + esc(D.formatDateVN(x.startDate)) + ' — ' + esc(D.formatDateVN(x.endDate)) + '</td><td>' + esc(memberName(x.ownerId)) + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="phase" data-id="' + esc(x.id) + '" data-campaign="' + esc(c.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="phases" data-id="' + esc(x.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
      }).join('')) : '<div class="state-box">Chưa có giai đoạn nào.</div>';
      html += '<div class="toolbar"><strong>Hoạt động & Kênh triển khai (' + acts.length + ')</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="activity" data-campaign="' + esc(c.id) + '">+ Thêm hoạt động</button>' : '') + '</div>';
      html += acts.length ? tbl('<tr><th>Hoạt động</th><th>Giai đoạn</th><th>Kênh</th><th>Người phụ trách</th><th>Đầu ra</th><th>Thao tác</th></tr>' + acts.map(function (a) {
        var ph = Store.get('phases', a.phaseId);
        return '<tr><td><strong>' + esc(a.name) + '</strong></td><td>' + esc(ph ? ph.name : '—') + '</td><td>' + esc(a.channel || '—') + '</td><td>' + esc(memberName(a.ownerId)) + '</td><td>' + esc(a.deliverables || a.deliverable || '—') + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="activity" data-id="' + esc(a.id) + '" data-campaign="' + esc(c.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="editor-open" data-kind="task" data-campaign="' + esc(c.id) + '"' + dis(!ed) + '>Tạo việc từ hoạt động</button> <button class="btn small secondary" data-action="archive-item" data-coll="activities" data-id="' + esc(a.id) + '"' + dis(!ed) + '>Lưu trữ</button></td></tr>';
      }).join('')) : '<div class="state-box">Chưa có hoạt động nào.</div>';
      html += '<h3>Timeline của campaign</h3>' + ganttHtml(ganttRowsCampaign(c), Store.list('dependencies'));
      // Sửa ngày bằng biểu mẫu + xem trước ảnh hưởng
      html += '<h3>Sửa ngày công việc bằng biểu mẫu</h3>';
      if (ctasks.length) {
        html += '<form class="inline" id="task-date-form"><label>Việc<select id="date-task-id">' + ctasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
          '<label>Ngày bắt đầu mới<input type="date" id="date-new-start" required></label>' +
          '<label>Mốc cần hoàn thành mới<input type="date" id="date-new-due" required></label>' +
          '<button class="btn secondary" type="submit">Xem trước ảnh hưởng</button></form>';
        if (UI.pendingDatePreview) {
          var p = UI.pendingDatePreview;
          html += '<div class="panel"><strong>Xem trước ảnh hưởng khi đổi lịch "' + esc((taskById(p.taskId) || {}).title || '') + '"</strong>';
          if (!p.impact.length) html += '<p class="sub">Không có việc phụ thuộc nào bị ảnh hưởng. Chưa có lịch nào bị thay đổi cho tới khi bạn xác nhận.</p>';
          else html += '<p class="sub">Các việc phụ thuộc có thể bị ảnh hưởng (hệ thống không tự dịch lịch của chúng):</p>' + tbl('<tr><th>Việc phụ thuộc</th><th>Quan hệ</th><th>Ngày hiện tại</th><th>Ngày đề xuất</th></tr>' + p.impact.map(function (i) {
            return '<tr><td>' + esc(i.title) + '</td><td>' + (i.direct ? 'Trực tiếp' : 'Gián tiếp') + '</td><td>' + esc(D.formatDateVN(i.currentStart)) + ' — ' + esc(D.formatDateVN(i.currentDue)) + '</td><td>' + esc(D.formatDateVN(i.proposedStart)) + ' — ' + esc(D.formatDateVN(i.proposedDue)) + '</td></tr>';
          }).join(''));
          html += '<p><button class="btn" data-action="apply-date-change">Xác nhận áp dụng cho việc gốc</button> <button class="btn secondary" data-action="cancel-date-change">Hủy xem trước</button></p></div>';
        }
      } else html += '<p class="sub">Chưa có công việc nào trong campaign này.</p>';
    }
    if (tab === 'tasks') {
      html += '<div class="toolbar"><strong>Công việc của campaign (' + ctasks.length + ')</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="task" data-campaign="' + esc(c.id) + '">+ Thêm việc</button>' : '') + '</div>';
      html += ctasks.length ? tbl('<tr><th>Việc</th><th>Người phụ trách</th><th>Đầu ra</th><th>Thời gian</th><th>Dự kiến</th><th>Phụ thuộc</th><th>Trạng thái</th></tr>' + ctasks.map(function (t) {
        return '<tr><td><button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button></td><td>' + esc(memberName(t.assigneeId)) + '</td><td>' + esc(t.deliverable || '—') + '</td><td>' + (t.startDate ? esc(D.formatDateVN(t.startDate)) : '—') + ' → ' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : 'Chưa xếp lịch') + '</td><td>' + (t.effortHours ? esc(t.effortHours) + ' giờ' : 'Chưa ước tính') + '</td><td>' + readinessBadge(t) + '</td><td>' + statusBadge(t.status) + '</td></tr>';
      }).join('')) : emptyState('Chưa có công việc nào', 'Thêm việc đầu tiên cho campaign này.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="task" data-campaign="' + esc(c.id) + '">+ Thêm việc</button></p>' : '');
    }
    if (tab === 'content') {
      var items = visibleList('contentItems').filter(function (x) { return x.campaignId === c.id; });
      var vars = Store.list('variants').filter(function (v) { return items.some(function (x) { return x.id === v.contentItemId; }); });
      html += '<div class="toolbar"><strong>Nội dung của campaign (' + items.length + ')</strong><span>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="content" data-campaign="' + esc(c.id) + '">+ Tạo nội dung</button> <button class="btn small secondary" data-action="editor-open" data-kind="variant" data-campaign="' + esc(c.id) + '">+ Thêm phiên bản theo kênh</button>' : '') + ' <a class="btn small secondary" href="#/content">Mở mục Nội dung</a></span></div>';
      html += items.length ? tbl('<tr><th>Nội dung</th><th>Phiên bản theo kênh</th><th>Lịch đăng</th><th>Trạng thái</th></tr>' + items.map(function (x) {
        var vs = vars.filter(function (v) { return v.contentItemId === x.id; });
        return '<tr><td><strong>' + esc(x.title) + '</strong></td><td>' + (vs.length ? vs.map(function (v) { return esc(v.channelLabel || labelStatus(v.platform)); }).join(', ') : 'Chưa có') + '</td><td>' + esc(D.formatDateVN(x.scheduledDate)) + '</td><td>' + statusBadge(x.editorialStatus) + '</td></tr>';
      }).join('')) : '<div class="state-box">Chưa có nội dung nào thuộc campaign này.</div>';
    }
    if (tab === 'kpi') {
      var ckpis = Store.list('kpis').filter(function (x) { return x.campaignId === c.id; });
      var blines = visibleList('budgetLines').filter(function (b) { return b.campaignId === c.id; });
      html += '<div class="toolbar"><strong>KPI & ngân sách của campaign</strong><span>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="kpi" data-campaign="' + esc(c.id) + '">+ Tạo KPI</button> <button class="btn small secondary" data-action="editor-open" data-kind="budgetLine" data-campaign="' + esc(c.id) + '">+ Tạo dòng ngân sách</button>' : '') + ' <a class="btn small secondary" href="#/kpi">Mở mục KPI & Ngân sách</a></span></div>';
      html += ckpis.length ? '<ul class="clean">' + ckpis.map(function (k) { var d = D.kpiDisplay(k); return '<li>' + esc(k.name) + ': mục tiêu ' + fmtNum(k.target) + ' ' + esc(k.unit || '') + ' · thực đạt: ' + (d.isMissing ? 'Chưa cập nhật' : fmtNum(d.value)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có KPI.</p>';
      html += blines.length ? '<ul class="clean">' + blines.map(function (b) {
        var rem = D.budgetRemaining(b, Store.list('commitments').filter(function (x) { return x.budgetLineId === b.id; }), Store.list('actuals').filter(function (x) { return x.budgetLineId === b.id; }));
        return '<li>' + esc(b.name) + ': đã duyệt ' + fmtMoney(b.approved, b.currency) + ' · còn lại ' + fmtMoney(rem, b.currency) + '</li>';
      }).join('') + '</ul>' : '<p class="sub">Chưa có dòng ngân sách.</p>';
    }
    if (tab === 'docs') {
      var assets = visibleList('brandAssets');
      html += '<div class="toolbar"><strong>Tài liệu & tài nguyên dùng cho campaign</strong>' + (ed ? '<button class="btn small" data-action="editor-open" data-kind="brandAsset">+ Thêm tài nguyên</button>' : '') + '</div>';
      html += '<p class="sub">KV, file nguồn và hướng dẫn lấy từ Brand Hub để dùng thống nhất cho mọi campaign.</p>';
      html += assets.length ? tbl('<tr><th>Tài nguyên</th><th>Loại</th><th>Đường dẫn</th><th>Trạng thái bản</th></tr>' + assets.map(function (a) {
        var url = a.url || a.fileUrl || '';
        return '<tr><td><strong>' + esc(a.name) + '</strong></td><td>' + esc(a.type) + '</td><td>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">Mở / tải</a>' : '—') + '</td><td>' + esc(brandStatusInfo(a).label) + '</td></tr>';
      }).join('')) : '<div class="state-box">Chưa có tài nguyên nào trong Brand Hub.</div>';
      var deliverables = ctasks.filter(function (t) { return t.deliverable; });
      html += '<h3>Đầu ra cần bàn giao của các việc</h3>' + (deliverables.length ? '<ul class="clean">' + deliverables.map(function (t) { return '<li><strong>' + esc(t.title) + '</strong>: ' + esc(t.deliverable) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có việc nào ghi đầu ra.</p>');
    }
    if (tab === 'summary') {
      var prog = D.campaignProgress(ctasks);
      html += '<div class="panel"><h3>Kết quả tới hiện tại</h3><p>Tiến độ công việc: ' + prog.completed + '/' + prog.total + ' (' + prog.percentage + '%).</p>' +
        '<h3>Rủi ro</h3><p>' + esc(c.risks || 'Chưa ghi nhận rủi ro.') + '</p>' +
        '<h3>Kết quả mong muốn</h3><p>' + esc(c.desiredOutcome || '—') + '</p>' +
        '<h3>Tổng kết & rút kinh nghiệm</h3><p>' + esc(c.lessons || 'Chưa ghi nhận — bấm Sửa campaign để bổ sung khi campaign kết thúc.') + '</p>' +
        (ed ? '<p><button class="btn" data-action="editor-open" data-kind="campaign" data-id="' + esc(c.id) + '">Sửa campaign để cập nhật tổng kết</button></p>' : '') + '</div>';
    }
    return html;
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
    var variants = Store.list('variants');
    var items = visibleList('contentItems');
    var ed = canEdit();
    var html = pageHead('Nội dung', 'Lịch nội dung, bảng, bảng trạng thái và tiến độ sản xuất — tất cả dùng chung một bản ghi.',
      (ed ? '<button class="btn" data-action="editor-open" data-kind="content">+ Tạo nội dung</button> <button class="btn secondary" data-action="editor-open" data-kind="variant">+ Thêm phiên bản theo kênh</button>' : ''));
    html += readonlyNote() + collectionBanner('variants');
    html += tabsHtml([['calendar', 'Lịch'], ['table', 'Bảng'], ['board', 'Bảng trạng thái'], ['production', 'Tiến độ sản xuất']], UI.contentTab, 'content-tab');
    if (!items.length && !variants.length && !collLoadingOrError('variants')) {
      html += emptyState('Chưa có nội dung nào', 'Tạo nội dung gốc trước, sau đó thêm phiên bản cho từng kênh (caption/kịch bản riêng từng kênh).', ed ? '<p><button class="btn" data-action="editor-open" data-kind="content">+ Tạo nội dung đầu tiên</button></p>' : '');
      return html;
    }
    if (UI.contentTab === 'calendar') {
      var year = UI.calYear, month = UI.calMonth;
      html += '<form class="inline" id="cal-nav-form"><label>Tháng<input type="number" id="cal-month" min="1" max="12" value="' + (month + 1) + '"></label><label>Năm<input type="number" id="cal-year" value="' + year + '"></label><button class="btn secondary" type="submit">Xem tháng</button> <button class="btn secondary" type="button" data-action="cal-today">Về tháng hiện tại</button></form>';
      html += '<p class="sub">Bấm vào một ngày để tạo nội dung với ngày đó được điền sẵn; bấm vào mục nội dung trong ngày để mở đúng bản ghi đó.</p>';
      var first = new Date(year, month, 1);
      var start = D.weekStartMonday(first);
      var cells = [];
      for (var i = 0; i < 42; i++) { var d = new Date(start.getTime()); d.setDate(d.getDate() + i); cells.push(d); }
      html += '<div class="cal">' + ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'].map(function (x) { return '<div class="cal-head">' + x + '</div>'; }).join('') + '</div>';
      html += '<div class="cal">' + cells.map(function (d) {
        var iso = isoOf(d);
        var dayVariants = variants.filter(function (v) { return (v.scheduledAt || '').slice(0, 10) === iso; });
        return '<div class="cal-cell' + (d.getMonth() !== month ? ' dim' : '') + (iso === todayISO() ? ' today' : '') + '" data-action="cal-day" data-id="' + iso + '" role="button" tabindex="0" aria-label="Ngày ' + iso + '"><div class="day">' + d.getDate() + '/' + (d.getMonth() + 1) + '</div>' +
          dayVariants.map(function (v) { return '<span class="chip" data-action="chip-variant" data-id="' + esc(v.id) + '" role="button" tabindex="0">' + esc(v.channelLabel || labelStatus(v.platform)) + ': ' + esc(contentTitle(v.contentItemId)) + '</span>'; }).join('') + '</div>';
      }).join('') + '</div>';
      // Agenda cho màn hình nhỏ (CSS hiện thay lịch lưới ở ≤820px)
      var monthPrefix = year + '-' + String(month + 1).padStart(2, '0');
      var monthVars = variants.filter(function (v) { return (v.scheduledAt || '').slice(0, 7) === monthPrefix; }).sort(function (a, b) { return String(a.scheduledAt).localeCompare(String(b.scheduledAt)); });
      html += '<div class="cal-agenda"><h3>Danh sách theo ngày (màn hình nhỏ)</h3>' + (monthVars.length ? '<ul class="clean">' + monthVars.map(function (v) {
        return '<li>' + esc(D.formatDateTimeVN(v.scheduledAt)) + ' — <button class="linklike" data-action="editor-open" data-kind="variant" data-id="' + esc(v.id) + '">' + esc(contentTitle(v.contentItemId)) + '</button> (' + esc(v.channelLabel || labelStatus(v.platform)) + ')</li>';
      }).join('') + '</ul>' : '<p class="sub">Tháng này chưa có nội dung nào lên lịch.</p>') + '</div>';
    }
    if (UI.contentTab === 'table') {
      html += '<h2>Nội dung gốc (' + items.length + ')</h2>';
      html += items.length ? tbl('<tr><th>Nội dung</th><th>Loại</th><th>Campaign</th><th>Người phụ trách</th><th>Ngày dự kiến</th><th>Trạng thái</th><th>Thao tác</th></tr>' + items.map(function (x) {
        return '<tr><td><strong>' + esc(x.title) + '</strong>' + (x.brief ? '<br><span class="sub">' + esc(x.brief) + '</span>' : '') + '</td><td>' + esc(labelStatus(x.type)) + '</td><td>' + esc(campaignName(x.campaignId)) + '</td><td>' + esc(memberName(x.ownerId)) + '</td><td>' + esc(D.formatDateVN(x.scheduledDate)) + '</td><td>' + statusBadge(x.editorialStatus) + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="content" data-id="' + esc(x.id) + '"' + dis(!ed) + '>Sửa</button> <button class="btn small secondary" data-action="editor-open" data-kind="variant" data-content="' + esc(x.id) + '"' + dis(!ed) + '>+ Phiên bản kênh</button></td></tr>';
      }).join('')) : '<div class="state-box">Chưa có nội dung gốc nào.</div>';
      html += '<h2>Phiên bản theo kênh (' + variants.length + ')</h2>';
      html += variants.length ? tbl('<tr><th>Nội dung</th><th>Kênh</th><th>Caption</th><th>Lịch đăng</th><th>Trạng thái biên tập</th><th>Duyệt</th><th>Thao tác</th></tr>' + variants.map(function (v) {
        var pub = v.platform === 'tiktok' ? '<span class="badge warn">Đăng ngoài app</span>' : statusBadge(v.publishingStatus || '', v.publishingStatus ? labelStatus(v.publishingStatus) : '');
        return '<tr><td><strong>' + esc(contentTitle(v.contentItemId)) + '</strong></td><td>' + esc(v.channelLabel || labelStatus(v.platform)) + '</td><td>' + esc(v.caption || '') + '</td><td>' + esc(D.formatDateTimeVN(v.scheduledAt)) + '</td><td>' + statusBadge(v.editorialStatus) + '<br>' + pub + '</td><td>' + statusBadge(v.approvalStatus) + '</td><td class="row-actions">' + variantCardActions(v) + '</td></tr>';
      }).join('')) : '<div class="state-box">Chưa có phiên bản theo kênh nào.</div>';
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
      html += '<h2>Tiến độ sản xuất theo lịch đăng</h2>' + tbl('<tr><th>Lịch đăng</th><th>Nội dung</th><th>Kênh</th><th>Người sản xuất</th><th>Người duyệt</th><th>Hạn sản xuất</th><th>Hạn duyệt</th><th>Trạng thái</th><th>Thao tác</th></tr>' + sorted.map(function (v) {
        return '<tr><td>' + esc(D.formatDateTimeVN(v.scheduledAt)) + '</td><td><strong>' + esc(contentTitle(v.contentItemId)) + '</strong></td><td>' + esc(v.channelLabel || labelStatus(v.platform)) + '</td><td>' + esc(memberName(v.ownerId)) + '</td><td>' + esc(memberName(v.reviewerId)) + '</td><td>' + esc(D.formatDateVN(v.productionDeadline)) + '</td><td>' + esc(D.formatDateVN(v.reviewDeadline)) + '</td><td>' + statusBadge(v.editorialStatus) + '</td><td class="row-actions">' + variantCardActions(v) + '</td></tr>';
      }).join(''));
      var tiktok = variants.filter(function (v) { return v.platform === 'tiktok'; });
      html += '<h2>TikTok — sản xuất trong app, đăng ngoài app</h2>';
      if (!tiktok.length) html += '<div class="state-box">Chưa có nội dung TikTok nào.</div>';
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
          (v.externalUrl ? '<p>Link bài đã đăng: <a href="' + esc(v.externalUrl) + '" target="_blank" rel="noopener">' + esc(v.externalUrl) + '</a>' + (v.actualPublishedAt ? ' · Ngày đăng thực tế: ' + esc(D.formatDateTimeVN(v.actualPublishedAt)) : '') + '</p>' : '') +
          (metrics.length ? '<p class="sub">Số liệu đã nhập cho video này: ' + metrics.map(function (m) { return esc(m.metric) + ' = ' + fmtNum(m.value) + ' (' + esc(m.source || '') + ', ' + esc(D.formatDateTimeVN(m.observedAt)) + ')'; }).join(' · ') + '</p>' : '<p class="sub">Chưa có số liệu nào được nhập cho video này.</p>') +
          '<p>' + variantCardActions(v) + '</p></div>';
      });
    }
    return html;
  }

  // ---------- Công việc ----------
  function viewTasks() {
    var tasks = visibleList('tasks');
    var edges = Store.list('dependencies');
    var blockers = Store.list('blockers');
    var ed = canEdit();
    var html = pageHead('Công việc', 'Một danh sách việc dùng chung ở mọi màn hình. Bấm vào tên việc để mở chi tiết và sửa.',
      ed ? '<button class="btn" data-action="editor-open" data-kind="task">+ Tạo việc</button>' : '');
    html += readonlyNote() + collectionBanner('tasks');
    if (!tasks.length && !collLoadingOrError('tasks')) {
      html += emptyState('Chưa có công việc nào', 'Tạo việc đầu tiên — việc có thể gắn với campaign hoặc để độc lập.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="task">+ Tạo việc</button></p>' : '');
    } else {
      var roots = tasks.filter(function (t) { return !t.parentId; });
      function row(t, depth) {
        var waitingFor = edges.filter(function (e) { return e.successorId === t.id; }).map(function (e) { var x = taskById(e.predecessorId); return x ? x.title : e.predecessorId; });
        var blockingOthers = edges.filter(function (e) { return e.predecessorId === t.id; }).map(function (e) { var x = taskById(e.successorId); return x ? x.title : e.successorId; });
        var myBlockers = blockers.filter(function (b) { return b.taskId === t.id && b.status === 'open'; });
        var opts = TASK_STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (t.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('');
        return '<tr><td style="padding-left:' + (10 + depth * 22) + 'px">' + (depth ? '↳ ' : '') + '<button class="linklike" data-action="open-task" data-id="' + esc(t.id) + '"><strong>' + esc(t.title) + '</strong></button>' + (myBlockers.length ? '<br><span class="badge bad">Trở ngại: ' + esc(myBlockers[0].title) + '</span>' : '') + '</td>' +
          '<td>' + esc(memberName(t.assigneeId)) + '</td><td>' + esc(campaignName(t.campaignId)) + '</td>' +
          '<td>' + (t.startDate ? esc(D.formatDateVN(t.startDate)) : '—') + ' → ' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : 'Chưa xếp lịch') + (isOverdue(t) ? ' <span class="badge bad">Quá hạn</span>' : '') + '</td>' +
          '<td>' + (t.effortHours ? esc(t.effortHours) + ' giờ' : '<span class="badge warn">Chưa ước tính</span>') + '</td>' +
          '<td>Đang chờ: ' + (waitingFor.length ? esc(waitingFor.join(', ')) : '—') + '<br>Việc đang chờ mình: ' + (blockingOthers.length ? esc(blockingOthers.join(', ')) : '—') + '<br>' + readinessBadge(t) + '</td>' +
          '<td><select data-action-change="task-status" data-id="' + esc(t.id) + '"' + dis(!ed) + noEditTitle() + '>' + opts + '</select></td></tr>' +
          tasks.filter(function (x) { return x.parentId === t.id; }).map(function (ch) { return row(ch, depth + 1); }).join('');
      }
      html += tbl('<tr><th>Việc</th><th>Người phụ trách</th><th>Campaign</th><th>Thời gian</th><th>Dự kiến</th><th>Phụ thuộc</th><th>Trạng thái</th></tr>' + roots.map(function (t) { return row(t, 0); }).join(''));
    }
    html += '<h2>Thêm quan hệ phụ thuộc</h2><form class="inline" id="dep-add-form">' +
      '<label>Việc phải xong trước<select name="predecessorId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Việc đang chờ<select name="successorId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn secondary" type="submit"' + dis(!ed) + '>Thêm phụ thuộc</button></form>' +
      '<p class="sub">Hệ thống chặn quan hệ tạo vòng phụ thuộc.</p>';
    html += '<h2>Trở ngại</h2>';
    if (!blockers.length) html += '<p class="sub">Chưa có trở ngại nào.</p>';
    else html += tbl('<tr><th>Trở ngại</th><th>Việc</th><th>Mô tả</th><th>Trạng thái</th><th></th></tr>' + blockers.map(function (b) {
      var t = taskById(b.taskId);
      return '<tr><td>' + esc(b.title) + '</td><td>' + esc(t ? t.title : '—') + '</td><td>' + esc(b.description || '') + '</td><td>' + statusBadge(b.status) + '</td><td>' + (b.status === 'open' ? '<button class="btn small secondary" data-action="resolve-blocker" data-id="' + esc(b.id) + '">Đánh dấu đã gỡ</button>' : '') + '</td></tr>';
    }).join(''));
    html += '<form class="inline" id="blocker-add-form"><label>Việc<select name="taskId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Tên trở ngại<input type="text" name="title" required></label><label>Mô tả<input type="text" name="description"></label>' +
      '<button class="btn" type="submit"' + dis(!ed) + '>Tạo trở ngại</button></form>';
    var reqs = Store.list('marketingRequests');
    html += '<h2>Yêu cầu Marketing</h2>';
    if (!reqs.length) html += '<div class="state-box">Chưa có yêu cầu nào được ghi nhận.</div>';
    else html += tbl('<tr><th>Yêu cầu</th><th>Người yêu cầu</th><th>Campaign liên quan</th><th>Ưu tiên</th><th>Hạn mong muốn</th><th>Trạng thái</th></tr>' + reqs.map(function (r) {
      return '<tr><td><strong>' + esc(r.title) + '</strong>' + (r.note ? '<br><span class="sub">' + esc(r.note) + '</span>' : '') + '</td><td>' + esc(r.requester) + '</td><td>' + (r.campaignId ? esc(campaignName(r.campaignId)) : '—') + '</td><td>' + esc(r.priority || '—') + '</td><td>' + (r.dueDate ? esc(D.formatDateVN(r.dueDate)) : '—') + '</td><td>' + statusBadge(r.status, r.statusLabel) + '</td></tr>';
    }).join(''));
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
    var snap = (rev && (rev.snapshot || rev)) || null;
    var caption = snap ? (snap.caption || '') : (v ? (v.caption || '') : '');
    var html = '<div class="snapshot-box"><p class="sub">Đây là đúng bản nội dung đang chờ duyệt — phiên bản nội dung số ' + esc(a.revision) + '. Quyết định sẽ gắn với phiên bản này.</p>';
    if (v) {
      html += '<p><strong>Kênh:</strong> ' + esc(v.channelLabel || labelStatus(v.platform)) + ' · <strong>Nội dung:</strong> ' + esc(contentTitle(a.contentItemId || v.contentItemId)) + '</p>';
      html += '<p><strong>Caption:</strong> ' + esc(caption || '—') + '</p>';
      if (snap && snap.hashtags) html += '<p><strong>Hashtag:</strong> ' + esc(snap.hashtags) + '</p>';
      var scenes = (snap && snap.scriptScenes) || v.scriptScenes || [];
      if (v.platform === 'tiktok' || scenes.length) {
        html += '<p><strong>Hook:</strong> ' + esc((snap && snap.hook) || v.hook || '—') + '</p><p><strong>CTA:</strong> ' + esc((snap && snap.cta) || v.cta || '—') + '</p>';
        if (scenes.length) html += '<div class="table-wrap"><table class="scene-table"><tr><th>Cảnh</th><th>Hình ảnh</th><th>Lời thoại</th><th>Chữ trên màn hình</th><th>Thời lượng (giây)</th></tr>' +
          scenes.map(function (s) { return '<tr><td>' + esc(s.shot) + '</td><td>' + esc(s.visual) + '</td><td>' + esc(s.dialogue) + '</td><td>' + esc(s.onScreenText) + '</td><td>' + esc(s.durationSec) + '</td></tr>'; }).join('') + '</table></div>';
      }
      if (v.script && v.platform !== 'tiktok') html += '<p><strong>Kịch bản:</strong> ' + esc(v.script) + '</p>';
      var media = (snap && (snap.mediaUrl || snap.linkUrl)) || v.mediaUrl || v.linkUrl;
      if (media) html += '<p><strong>File đính kèm:</strong> <a href="' + esc(media) + '" target="_blank" rel="noopener">' + esc(media) + '</a></p>';
      html += '<p class="sub">Lịch đăng dự kiến: ' + esc(D.formatDateTimeVN(v.scheduledAt)) + ' · Người sản xuất: ' + esc(memberName(v.ownerId)) + '</p>';
    } else html += '<p class="sub">Không tìm thấy phiên bản nội dung tương ứng.</p>';
    return html + '</div>';
  }
  function viewApprovals() {
    var approvals = Store.list('approvals');
    var pending = approvals.filter(function (a) { return a.status === 'pending' || a.status === 'needs_reapproval'; });
    var done = approvals.filter(function (a) { return a.status !== 'pending' && a.status !== 'needs_reapproval'; });
    var ok = canApprove();
    var html = pageHead('Duyệt nội dung', 'Hộp thư chờ mình duyệt: xem đúng bản nội dung được gửi, rồi duyệt / yêu cầu sửa / từ chối kèm nhận xét. Việc sửa nội dung làm ở mục Nội dung, không sửa tại màn duyệt.');
    if (!ok) html += '<div class="notice warn">Vai trò hiện tại (' + esc(labelStatus(Store.currentRole())) + ') không có quyền duyệt — các nút quyết định bị khóa.' + (Store.mode === 'demo' ? ' Đổi sang Owner/Lead ở thanh trên (Chế độ demo) để thử duyệt.' : '') + '</div>';
    html += collectionBanner('approvals');
    html += '<h2>Chờ mình duyệt (' + pending.length + ')</h2>';
    if (!pending.length && !collLoadingOrError('approvals')) html += '<div class="state-box">Không có nội dung nào chờ duyệt. Khi thành viên bấm "Gửi duyệt" ở mục Nội dung, bản nội dung sẽ xuất hiện tại đây.</div>';
    pending.forEach(function (a) {
      html += '<div class="panel"><strong>' + esc(contentTitle(a.contentItemId)) + '</strong> — yêu cầu bởi ' + esc(memberName(a.requestedBy)) + ' lúc ' + esc(D.formatDateTimeVN(a.requestedAt)) +
        approvalSnapshotHtml(a) +
        '<label class="fld wide">Nhận xét khi quyết định<textarea id="approve-note-' + esc(a.id) + '" rows="2" placeholder="Nhận xét (bắt buộc khi yêu cầu sửa / từ chối)">' + esc(UI.approveComment[a.id] || '') + '</textarea></label>' +
        '<p><button class="btn" data-action="decide" data-decision="approved" data-id="' + esc(a.id) + '"' + dis(!ok) + '>Duyệt</button> ' +
        '<button class="btn secondary" data-action="decide" data-decision="changes_requested" data-id="' + esc(a.id) + '"' + dis(!ok) + '>Yêu cầu sửa</button> ' +
        '<button class="btn secondary" data-action="decide" data-decision="rejected" data-id="' + esc(a.id) + '"' + dis(!ok) + '>Từ chối</button></p></div>';
    });
    html += '<h2>Dòng thời gian quyết định (' + done.length + ')</h2>';
    if (!done.length) html += '<p class="sub">Chưa có quyết định nào.</p>';
    else html += tbl('<tr><th>Nội dung</th><th>Phiên bản nội dung</th><th>Quyết định</th><th>Người duyệt</th><th>Thời điểm</th><th>Nhận xét</th></tr>' + done.map(function (a) {
      return '<tr><td>' + esc(contentTitle(a.contentItemId)) + '</td><td>Số ' + esc(a.revision) + '</td><td>' + statusBadge(a.status, a.statusLabel) + '</td><td>' + esc(memberName(a.decidedBy)) + '</td><td>' + esc(D.formatDateTimeVN(a.decidedAt)) + '</td><td>' + esc(a.note || '') + '</td></tr>';
    }).join(''));
    return html;
  }

  // ---------- Team & Workload ----------
  function viewTeam() {
    var members = Store.list('members');
    var tasks = visibleList('tasks');
    var holidays = Store.holidays || [];
    var weekStart = UI.teamWeek, weekEnd = addDaysISO(weekStart, 6);
    var ed = canEdit();
    var html = pageHead('Team & Workload', 'Tải công việc theo tuần đã chọn. Chỉ tính việc chi tiết (việc cha có việc con không bị tính trùng) và chỉ phần effort rơi trong tuần này.');
    html += '<form class="inline" id="team-week-form"><label>Tuần bắt đầu từ (thứ Hai)<input type="date" id="team-week-input" value="' + esc(weekStart) + '"></label><button class="btn secondary" type="submit">Xem tuần</button> <button class="btn secondary" type="button" data-action="team-week-now">Tuần hiện tại</button></form>';
    html += '<p class="sub">Tuần đang xem: ' + esc(D.formatDateVN(weekStart)) + ' — ' + esc(D.formatDateVN(weekEnd)) + '. Ngày nghỉ chung: ' + (holidays.length ? holidays.map(function (h) { return D.formatDateVN(h); }).join(', ') : '—') + '</p>';
    html += collectionBanner('members');
    html += tbl('<tr><th>Thành viên</th><th>Vai trò</th><th>Năng lực (giờ/tuần)</th><th>Ngày nghỉ riêng</th><th>Effort trong tuần này</th><th>Chi tiết theo ngày</th><th>Cảnh báo</th><th>Thao tác</th></tr>' +
      members.map(function (m) {
        var leaves = tasks.filter(function (t) {
          return t.assigneeId === m.id && !isCompletedTask(t) && String(t.status).toLowerCase() !== 'cancelled' &&
            !tasks.some(function (x) { return x.parentId === t.id; });
        });
        var unestimated = [];
        var perDay = {};
        leaves.forEach(function (t) {
          var dist = D.distributeEffort(t, holidays.concat(m.daysOff || []));
          if (!Array.isArray(dist)) { unestimated.push(t); return; }
          dist.forEach(function (d) { if (d.date >= weekStart && d.date <= weekEnd) perDay[d.date] = (perDay[d.date] || 0) + d.hours; });
        });
        var total = Object.keys(perDay).reduce(function (s, k) { return s + perDay[k]; }, 0);
        var cap = m.capacityHoursPerWeek || 0;
        var warn = [];
        if (cap > 0 && total > cap) warn.push('Tổng ' + fmtNum(total) + ' giờ vượt năng lực ' + cap + ' giờ trong tuần này');
        Object.keys(perDay).forEach(function (date) { if (perDay[date] > 8) warn.push('Ngày ' + D.formatDateVN(date) + ': ' + fmtNum(perDay[date]) + ' giờ (quá 8 giờ/ngày)'); });
        return '<tr><td><strong>' + esc(m.name) + '</strong>' + (m.isActive === false ? ' <span class="badge grey">Ngừng hoạt động</span>' : '') + '</td><td>' + esc(m.roleLabel || labelStatus(m.role)) + '</td><td>' + (cap ? esc(cap) + ' giờ/tuần' : '—') + '</td>' +
          '<td>' + ((m.daysOff || []).length ? m.daysOff.map(function (x) { return D.formatDateVN(x); }).join(', ') : '—') + '</td>' +
          '<td>' + fmtNum(total) + ' giờ' + (unestimated.length ? '<br>' + unestimated.map(function (t) { return '<span class="badge warn">' + esc(t.title) + ': Chưa ước tính</span>'; }).join(' ') : '') + '</td>' +
          '<td><span class="sub">' + (Object.keys(perDay).sort().map(function (date) { return D.formatDateVN(date) + ': ' + fmtNum(perDay[date]) + 'h'; }).join(' · ') || '—') + '</span></td>' +
          '<td>' + (warn.length ? warn.map(function (w) { return '<span class="badge bad">' + esc(w) + '</span>'; }).join(' ') : '<span class="badge ok">Ổn</span>') + '</td>' +
          '<td><button class="btn small secondary" data-action="editor-open" data-kind="memberCap" data-member="' + esc(m.id) + '"' + dis(!canSettings()) + '>Đặt năng lực / ngày nghỉ</button></td></tr>';
      }).join(''));
    html += '<p class="sub">Việc thiếu effort hiển thị "Chưa ước tính" và không tính vào effort đã phân bổ.</p>';
    return html;
  }

  // ---------- KPI & Ngân sách ----------
  function viewKpi() {
    var ed = canEdit();
    var budgetEd = canBudgetChange();
    var html = pageHead('KPI & Ngân sách', 'KPI theo mục tiêu/thực đạt/nguồn/thời điểm; ngân sách theo Kế hoạch / Đã duyệt / Cam kết / Thực chi / Còn lại.',
      (ed ? '<button class="btn" data-action="editor-open" data-kind="kpi">+ Tạo KPI</button> ' : '') + (budgetEd ? '<button class="btn secondary" data-action="editor-open" data-kind="budgetLine">+ Tạo dòng ngân sách</button>' : ''));
    html += readonlyNote();
    if (!canBudget()) html += '<div class="notice info">Vai trò hiện tại không có quyền xem chi tiết ngân sách nhạy cảm — phần cam kết/thực chi có thể bị giới hạn ở tầng dữ liệu.</div>';
    html += collectionBanner('kpis');
    html += '<h2>KPI</h2>';
    var kpis = Store.list('kpis');
    var measurements = [];
    try { measurements = Store.list('measurements'); } catch (e) { measurements = []; }
    if (!kpis.length && !collLoadingOrError('kpis')) html += emptyState('Chưa có KPI nào', 'Tạo KPI đầu tiên và cập nhật số đo kèm nguồn để theo dõi thực đạt.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="kpi">+ Tạo KPI</button></p>' : '');
    else html += tbl('<tr><th>KPI</th><th>Campaign</th><th>Định nghĩa / kỳ</th><th>Mục tiêu</th><th>Thực đạt</th><th>Nguồn số liệu</th><th>Cập nhật</th><th>Thao tác</th></tr>' + kpis.map(function (k) {
      var d = D.kpiDisplay(k);
      var hist = measurements.filter(function (m) { return m.kpiId === k.id || m.kpi_id === k.id; });
      var main = '<tr><td><strong>' + esc(k.name) + '</strong></td><td>' + esc(campaignName(k.campaignId)) + '</td><td>' + esc(k.definition || '—') + (k.period ? '<br><span class="sub">Kỳ: ' + esc(k.period) + '</span>' : '') + '</td><td>' + fmtNum(k.target) + ' ' + esc(k.unit || '') + '</td><td>' + (d.isMissing ? '<span class="badge warn">Chưa cập nhật</span>' : fmtNum(d.value) + ' ' + esc(k.unit || '')) + '</td><td>' + esc(k.source || '—') + '</td><td>' + (k.updatedAt ? esc(D.formatDateTimeVN(k.updatedAt)) : '—') + '</td>' +
        '<td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="measurement" data-kpi="' + esc(k.id) + '"' + dis(!ed) + '>+ Thêm số đo</button> <button class="btn small secondary" data-action="editor-open" data-kind="kpi" data-id="' + esc(k.id) + '"' + dis(!ed) + '>Sửa KPI</button></td></tr>';
      if (hist.length) main += '<tr class="detail-row"><td colspan="8"><strong>Lịch sử số đo:</strong> ' + hist.map(function (m) { return fmtNum(m.value) + ' (' + esc(m.source || '—') + ', ' + esc(D.formatDateTimeVN(m.measuredAt || m.measured_at)) + ')'; }).join(' · ') + '</td></tr>';
      return main;
    }).join(''));
    html += '<h2>Ngân sách theo từng tiền tệ (không cộng khác tiền tệ)</h2>';
    var linesAll = visibleList('budgetLines');
    if (!linesAll.length) html += emptyState('Chưa có dòng ngân sách nào', 'Tạo dòng ngân sách cho campaign, sau đó ghi cam kết và khoản chi thực tế ngay tại đây.', budgetEd ? '<p><button class="btn" data-action="editor-open" data-kind="budgetLine">+ Tạo dòng ngân sách</button></p>' : '');
    var currencies = [];
    linesAll.forEach(function (b) { if (currencies.indexOf(b.currency) === -1) currencies.push(b.currency); });
    currencies.forEach(function (cur) {
      var lines = linesAll.filter(function (b) { return b.currency === cur; });
      html += '<h3>Tiền tệ: ' + esc(cur) + '</h3>';
      html += tbl('<tr><th>Dòng ngân sách</th><th>Campaign</th><th>Kế hoạch</th><th>Đã duyệt</th><th>Cam kết còn mở</th><th>Thực chi</th><th>Còn lại</th><th>Trạng thái</th><th>Thao tác</th></tr>' + lines.map(function (b) {
        var commits = Store.list('commitments').filter(function (x) { return x.budgetLineId === b.id; });
        var acts = Store.list('actuals').filter(function (x) { return x.budgetLineId === b.id; });
        var actualTotal = acts.reduce(function (s, a) { return s + Number(a.amount || 0); }, 0);
        var paidByCommit = {};
        acts.forEach(function (a) { if (a.commitmentId) paidByCommit[a.commitmentId] = (paidByCommit[a.commitmentId] || 0) + Number(a.amount || 0); });
        var openCommit = commits.reduce(function (s, cm) {
          if (String(cm.status).toLowerCase() === 'cancelled') return s;
          return s + Math.max(0, Number(cm.amount || 0) - (paidByCommit[cm.id] || 0));
        }, 0);
        var rem = D.budgetRemaining(b, commits, acts);
        var detail = '<tr class="detail-row"><td colspan="9">' +
          '<strong>Cam kết (' + commits.length + '):</strong> ' + (commits.length ? commits.map(function (cm) { return esc(cm.title) + ' — ' + fmtMoney(cm.amount, cm.currency || cur) + ' (' + esc(labelStatus(cm.status)) + ')' + (budgetEd ? ' <button class="btn small secondary" data-action="editor-open" data-kind="commitment" data-id="' + esc(cm.id) + '">Sửa</button>' : ''); }).join(' · ') : 'Chưa có') +
          (budgetEd ? ' <button class="btn small" data-action="editor-open" data-kind="commitment" data-line="' + esc(b.id) + '">+ Thêm cam kết</button>' : '') +
          '<br><strong>Thực chi (' + acts.length + '):</strong> ' + (acts.length ? acts.map(function (a) { return esc(a.title) + ' — ' + fmtMoney(a.amount, cur) + ' (' + esc(D.formatDateVN(a.date)) + (a.source ? ', ' + esc(a.source) : '') + ')' + (budgetEd ? ' <button class="btn small secondary" data-action="editor-open" data-kind="actual" data-id="' + esc(a.id) + '">Sửa</button>' : ''); }).join(' · ') : 'Chưa có') +
          (budgetEd ? ' <button class="btn small" data-action="editor-open" data-kind="actual" data-line="' + esc(b.id) + '">+ Ghi khoản chi</button>' : '') +
          '</td></tr>';
        return '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc(campaignName(b.campaignId)) + '</td><td>' + fmtMoney(b.planned, cur) + '</td><td>' + fmtMoney(b.approved, cur) + '</td><td>' + fmtMoney(openCommit, cur) + '</td><td>' + fmtMoney(actualTotal, cur) + '</td><td>' + fmtMoney(rem, cur) + '</td><td>' + (rem < 0 ? '<span class="badge bad">Vượt ngân sách ' + fmtMoney(-rem, cur) + '</span>' : '<span class="badge ok">Trong ngân sách</span>') + '</td>' +
          '<td class="row-actions"><button class="btn small secondary" data-action="editor-open" data-kind="budgetLine" data-id="' + esc(b.id) + '"' + dis(!budgetEd) + '>Sửa dòng</button></td></tr>' + detail;
      }).join(''));
    });
    html += '<p class="sub">Cam kết đã có khoản chi liên kết thì phần đã thanh toán chỉ tính một lần ở Thực chi, không trừ trùng ở Cam kết.</p>';
    return html;
  }

  // ---------- Kênh & Bài đã đăng ----------
  function viewChannels() {
    var accounts = Store.list('channelAccounts');
    var ed = canEdit();
    var html = pageHead('Kênh & Bài đã đăng', 'Trạng thái kết nối theo từng khả năng và thư viện bài đã đăng.',
      ed ? '<button class="btn" data-action="editor-open" data-kind="post">+ Thêm bài đã đăng (nhập tay)</button>' : '');
    html += readonlyNote() + collectionBanner('channelAccounts');
    html += '<h2>Kết nối kênh</h2>';
    html += accounts.length ? tbl('<tr><th>Kênh</th><th>Tài khoản</th><th>Trạng thái chung</th><th>Đọc bài</th><th>Đọc số liệu</th><th>Đăng bài</th><th>Quảng cáo</th></tr>' +
      accounts.map(function (a) {
        var cap = a.capabilities || {};
        function cb(v) { return v === 'Đã kết nối' ? '<span class="badge ok">' + esc(v) + '</span>' : '<span class="badge warn">' + esc(v || 'Chờ kết nối') + '</span>'; }
        return '<tr><td>' + esc(labelStatus(a.platform)) + '</td><td>' + esc(a.name) + '</td><td>' + cb(a.status) + '</td><td>' + cb(cap.readPosts) + '</td><td>' + cb(cap.readMetrics) + '</td><td>' + cb(cap.publish) + '</td><td>' + cb(cap.ads) + '</td></tr>';
      }).join('')) : '<div class="state-box">Chưa có tài khoản kênh nào. Kết nối kênh cần cấp quyền ở nền tảng tương ứng; trong lúc chờ, vẫn ghi nhận bài bằng cách nhập tay.</div>';
    var posts = Store.list('externalPosts');
    var filtered = posts.filter(function (p) { return UI.channelFilter === 'all' || p.platform === UI.channelFilter; });
    html += '<h2>Thư viện bài đã đăng (' + filtered.length + ')</h2>' +
      '<form class="inline" id="channel-filter-form"><label>Lọc theo kênh<select id="channel-filter"><option value="all">Tất cả kênh</option>' +
      PLATFORMS.map(function (p) { return '<option value="' + p[0] + '"' + (UI.channelFilter === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') +
      '</select></label><button class="btn secondary" type="submit">Lọc</button></form>';
    if (!filtered.length) html += emptyState('Chưa có bài đã đăng nào ở kênh đã lọc', 'Thêm bài bằng cách nhập tay (nguồn sẽ ghi rõ là nhập tay) hoặc chờ đồng bộ khi kênh được kết nối.', ed ? '<p><button class="btn" data-action="editor-open" data-kind="post">+ Thêm bài đã đăng</button></p>' : '');
    else html += tbl('<tr><th>Bài</th><th>Kênh</th><th>Mã bài trên nền tảng</th><th>Ngày đăng</th><th>Nguồn</th><th>Campaign đã gắn</th><th>Gắn / đổi campaign</th><th>Thao tác</th></tr>' + filtered.map(function (p) {
      var obs = Store.list('metricObservations').filter(function (o) { return o.externalPostId === p.id; });
      var main = '<tr><td><a href="' + esc(p.url || '#') + '" target="_blank" rel="noopener">' + esc(p.title) + '</a></td><td>' + esc(labelStatus(p.platform)) + '</td><td><code>' + esc(p.externalPostId) + '</code></td><td>' + esc(D.formatDateTimeVN(p.publishedAt)) + '</td><td>' + esc(p.source === 'manual' ? 'Nhập tay' : (p.source || 'Đồng bộ')) + '</td><td>' + (p.campaignId ? esc(campaignName(p.campaignId)) : '<span class="badge warn">Chưa gắn</span>') + '</td>' +
        '<td><form class="inline compact" data-form="attach-campaign" data-id="' + esc(p.id) + '"><select name="campaignId"><option value="">— Chưa gắn —</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (p.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select><button class="btn small" type="submit"' + dis(!ed) + '>Lưu gắn</button></form></td>' +
        '<td class="row-actions"><button class="btn small secondary" data-action="post-metrics" data-id="' + esc(p.id) + '">Số liệu (' + obs.length + ')</button> <button class="btn small secondary" data-action="editor-open" data-kind="post" data-id="' + esc(p.id) + '"' + dis(!ed) + '>Sửa</button></td></tr>';
      if (UI.postOpenId === p.id) {
        main += '<tr class="detail-row"><td colspan="8"><strong>Số liệu của bài:</strong> ' + (obs.length ? obs.map(function (o) { return esc(o.metric) + ' = ' + fmtNum(o.value) + ' (' + esc(o.source || '—') + ', ' + esc(D.formatDateTimeVN(o.observedAt)) + ')'; }).join(' · ') : 'Chưa có số liệu nào cho bài này.') + '</td></tr>';
      }
      return main;
    }).join(''));
    html += '<p class="sub">Hệ thống chống trùng bài đã đăng theo bộ ba (kênh, tài khoản, mã bài trên nền tảng) — thêm trùng sẽ bị từ chối kèm thông báo.</p>';
    return html;
  }

  // ---------- Quảng cáo ----------
  function ratesCells(r) {
    var cur = r.currency || 'VND';
    return '<td>' + fmtMoney(r.spend, cur) + '</td><td>' + fmtNum(r.impressions) + '</td><td>' + fmtNum(r.clicks) + '</td><td>' + fmtNum(r.results) + '</td>';
  }
  function viewAds() {
    var html = pageHead('Quảng cáo', 'Số liệu quảng cáo chỉ đọc. "Chiến dịch quảng cáo" ở đây khác với IMC Campaign ở mục IMC & Campaigns.',
      (can('adsDraft') && Store.currentRole() !== 'ceo') ? '<button class="btn" data-action="editor-open" data-kind="adcr">+ Tạo yêu cầu thay đổi</button>' : '');
    var isCeo = Store.currentRole() === 'ceo';
    var canDraft = can('adsDraft');
    var canApproveAds = can('adsApprove');
    if (isCeo) html += '<div class="notice info">CEO chỉ xem: mọi thao tác tạo nháp/gửi duyệt/duyệt thay đổi quảng cáo đều bị ẩn và bị tầng dữ liệu chặn.</div>';
    html += collectionBanner('adAccounts');
    if (!Store.list('adAccounts').length && !collLoadingOrError('adAccounts')) html += '<div class="state-box">Chưa kết nối tài khoản quảng cáo nào. Khi tài khoản được kết nối, cây chiến dịch/nhóm/quảng cáo và số liệu sẽ hiện tại đây.</div>';
    Store.list('adAccounts').forEach(function (acc) {
      html += '<div class="panel"><h3>' + esc(acc.name) + ' — ' + esc(acc.platform) + ' <span class="badge warn">' + esc(acc.status) + '</span></h3>';
      var acs = Store.list('adCampaigns').filter(function (x) { return x.adAccountId === acc.id; });
      if (!acs.length) html += '<p class="sub">Chưa có chiến dịch quảng cáo nào.</p>';
      acs.forEach(function (ac) {
        html += '<p><strong>Chiến dịch quảng cáo:</strong> ' + esc(ac.name) + ' — ' + statusBadge(ac.status, ac.statusLabel) + '</p>';
        var rows = '<tr><th>Cấp</th><th>Tên</th><th>Trạng thái</th><th>Chi tiêu</th><th>Hiển thị</th><th>Nhấp</th><th>Kết quả</th></tr>';
        rows += '<tr><td>Chiến dịch</td><td>' + esc(ac.name) + '</td><td>' + statusBadge(ac.status, ac.statusLabel) + '</td>' + ratesCells(ac) + '</tr>';
        Store.list('adSets').filter(function (x) { return x.adCampaignId === ac.id; }).forEach(function (as) {
          rows += '<tr><td>Nhóm</td><td>↳ ' + esc(as.name) + '</td><td>' + statusBadge(as.status, as.statusLabel) + '</td>' + ratesCells(as) + '</tr>';
          Store.list('ads').filter(function (x) { return x.adSetId === as.id; }).forEach(function (ad) {
            rows += '<tr><td>Quảng cáo</td><td>↳↳ ' + esc(ad.name) + '</td><td>' + statusBadge(ad.status, ad.statusLabel) + '</td>' + ratesCells(ad) + '</tr>';
          });
        });
        html += tbl(rows) + '<p class="sub">Tổng chỉ cộng ở một cấp duy nhất để không tính trùng giữa chiến dịch / nhóm / quảng cáo.</p>';
      });
      html += '</div>';
    });
    var reqs = Store.list('adChangeRequests');
    html += '<h2>Yêu cầu thay đổi quảng cáo (' + reqs.length + ')</h2>';
    html += '<p class="sub">Quy trình: tạo nháp → gửi duyệt → duyệt → áp dụng ngoài hệ thống quảng cáo. Đổi trạng thái chỉ đổi trạng thái, không mở biểu mẫu sửa nội dung đề xuất. Trạng thái mặc định của đối tượng sau thay đổi: <strong>Tạm dừng</strong>.</p>';
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
    }).join(''));
    return html;
  }

  // ---------- Báo cáo ----------
  function reportDataset() {
    var f = UI.report;
    var adCampaigns = Store.list('adCampaigns');
    var adSets = Store.list('adSets');
    var ads = Store.list('ads');
    function accountOfCampaign(ac) { return ac.adAccountId; }
    function accountOfSet(s) { var c = adCampaigns.find(function (x) { return x.id === s.adCampaignId; }); return c ? c.adAccountId : null; }
    function accountOfAd(a) { var s = adSets.find(function (x) { return x.id === a.adSetId; }); return s ? accountOfSet(s) : null; }
    var rows = []
      .concat(adCampaigns.map(function (x) { return Object.assign({ level: 'campaign', _accountId: accountOfCampaign(x) }, x); }))
      .concat(adSets.map(function (x) { return Object.assign({ level: 'adset', _accountId: accountOfSet(x) }, x); }))
      .concat(ads.map(function (x) { return Object.assign({ level: 'ad', _accountId: accountOfAd(x) }, x); }));
    if (f.accountId !== 'all') rows = rows.filter(function (r) { return r._accountId === f.accountId; });
    var levelRows = rows.filter(function (r) { return r.level === f.level; });
    // Quan sát số liệu: lọc theo kỳ + campaign (qua bài đã đăng)
    var obs = Store.list('metricObservations').filter(function (o) {
      if (f.from && String(o.observedAt || '').slice(0, 10) < f.from) return false;
      if (f.to && String(o.observedAt || '').slice(0, 10) > f.to) return false;
      if (f.campaignId !== 'all') {
        var post = Store.get('externalPosts', o.externalPostId);
        if (!post || post.campaignId !== f.campaignId) return false;
      }
      return true;
    });
    return { rows: rows, levelRows: levelRows, obs: obs };
  }
  function viewReports() {
    var f = UI.report;
    var ds = reportDataset();
    var levelRows = ds.levelRows;
    var agg = D.aggregateRates(levelRows);
    var hasConv = levelRows.some(function (r) { return r.conversionValue !== null && r.conversionValue !== undefined; });
    var hasSpend = levelRows.some(function (r) { return r.spend !== null && r.spend !== undefined; });
    var roasDisplay = (!hasConv || !hasSpend) ? null : agg.roas;
    UI.reportRowsCache = levelRows;
    UI.reportAggCache = { ctr: agg.ctr, cpc: agg.cpc, cpm: agg.cpm, roas: roasDisplay, totals: agg.totals, level: f.level, accountId: f.accountId, campaignId: f.campaignId, from: f.from, to: f.to };
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
    var html = pageHead('Báo cáo', 'Hai góc nhìn: vận hành công việc và hiệu quả marketing. Bộ lọc kỳ/tài khoản/campaign áp dụng thật vào tập dữ liệu bên dưới.',
      '<button class="btn" data-action="editor-open" data-kind="snapshot">Chốt báo cáo từ dữ liệu đang lọc</button> <button class="btn secondary" data-action="export-csv">Xuất CSV dữ liệu đang lọc</button>');
    html += tabsHtml([['perf', 'Hiệu quả marketing'], ['ops', 'Vận hành công việc']], f.view, 'report-view');
    html += '<form class="inline" id="report-filter-form">' +
      '<label>Từ ngày<input type="date" name="from" value="' + esc(f.from) + '"></label>' +
      '<label>Đến ngày<input type="date" name="to" value="' + esc(f.to) + '"></label>' +
      '<label>Tài khoản quảng cáo<select name="accountId"><option value="all">Tất cả tài khoản</option>' + Store.list('adAccounts').map(function (a) { return '<option value="' + esc(a.id) + '"' + (f.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Campaign (IMC)<select name="campaignId"><option value="all">Tất cả campaign</option>' + visibleList('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Cấp tổng hợp quảng cáo<select name="level">' + [['campaign', 'Chiến dịch quảng cáo'], ['adset', 'Nhóm quảng cáo'], ['ad', 'Quảng cáo']].map(function (lv) { return '<option value="' + lv[0] + '"' + (f.level === lv[0] ? ' selected' : '') + '>' + lv[1] + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn" type="submit">Áp dụng lọc</button> <button class="btn secondary" type="button" data-action="report-clear">Xóa lọc</button></form>';
    html += '<p class="sub">Đang áp dụng: kỳ ' + (f.from || f.to ? (D.formatDateVN(f.from) || '…') + ' — ' + (D.formatDateVN(f.to) || '…') : 'toàn bộ') + ' · tài khoản: ' + (f.accountId === 'all' ? 'tất cả' : esc((Store.get('adAccounts', f.accountId) || {}).name || '')) + ' · campaign: ' + (f.campaignId === 'all' ? 'tất cả' : esc(campaignName(f.campaignId))) + ' · cấp quảng cáo: ' + esc(levelLabel) + '. Số liệu quảng cáo hiện chưa tách theo kỳ trong dữ liệu nguồn — kỳ lọc áp dụng cho quan sát số liệu/bài đăng; ô thiếu dữ liệu giữ trống, không đổi thành 0.</p>';
    if (f.view === 'ops') {
      var tasks = visibleList('tasks');
      var overdue = tasks.filter(isOverdue);
      var pendingApprovals = Store.list('approvals').filter(function (a) { return a.status === 'pending' || a.status === 'needs_reapproval'; });
      html += '<div class="cards">' +
        '<div class="card"><div class="big">' + visibleList('campaigns').filter(function (c) { return c.status === 'active'; }).length + '</div>Campaign đang chạy</div>' +
        '<div class="card"><div class="big">' + overdue.length + '</div>Việc quá hạn<br><a href="#/tasks">Xem công việc</a></div>' +
        '<div class="card"><div class="big">' + pendingApprovals.length + '</div>Nội dung chờ duyệt<br><a href="#/approvals">Tới hộp duyệt</a></div>' +
        '<div class="card"><div class="big">' + tasks.filter(function (t) { return isCompletedTask(t); }).length + '/' + tasks.length + '</div>Việc đã hoàn thành</div></div>';
      html += '<h2>Tiến độ theo campaign</h2>' + tbl('<tr><th>Campaign</th><th>Tiến độ</th><th>Quá hạn</th></tr>' + visibleList('campaigns').map(function (c) {
        var ct = tasks.filter(function (t) { return t.campaignId === c.id; });
        var p = D.campaignProgress(ct);
        return '<tr><td><a href="#/campaigns/' + esc(c.id) + '">' + esc(c.name) + '</a></td><td>' + p.completed + '/' + p.total + ' (' + p.percentage + '%)</td><td>' + ct.filter(isOverdue).length + '</td></tr>';
      }).join(''));
      return html;
    }
    html += '<div class="cards">' +
      '<div class="card"><div class="big">' + (agg.ctr === null ? '—' : (agg.ctr * 100).toFixed(2) + '%') + '</div>CTR (cấp: ' + esc(levelLabel) + ')<br><span class="sub">Đơn vị: % · Tính từ tổng nhấp / tổng hiển thị của đúng cấp đã chọn · ' + levelRows.length + ' dòng dữ liệu</span></div>' +
      '<div class="card"><div class="big">' + (agg.cpc === null ? '—' : fmtNum(Math.round(agg.cpc))) + '</div>CPC (VND)<br><span class="sub">Đơn vị: VND/nhấp · Tổng chi tiêu / tổng nhấp cùng cấp</span></div>' +
      '<div class="card"><div class="big">' + (roasDisplay === null ? '—' : roasDisplay.toFixed(2)) + '</div>ROAS<br><span class="sub">Đơn vị: lần · ' + (roasDisplay === null ? 'Không tính được vì thiếu giá trị chuyển đổi hoặc chi tiêu trong tập đã lọc — không hiển thị 0 giả.' : 'Giá trị chuyển đổi / chi tiêu cùng cấp') + '</span></div>' +
      '<div class="card"><div class="big">' + (lifetimeTotal === null ? '—' : fmtNum(lifetimeTotal)) + '</div>Lượt xem trọn đời — tổng của bản mới nhất từng bài<br><span class="sub">Đơn vị: lượt · Mỗi bài chỉ lấy lần quan sát mới nhất, không cộng dồn các lần quan sát</span></div></div>';
    if (lifetimeRows.length) html += '<h3>Lượt xem trọn đời theo bài</h3>' + tbl('<tr><th>Bài</th><th>Giá trị mới nhất</th></tr>' + lifetimeRows.map(function (r) {
      var post = Store.get('externalPosts', r.postId);
      return '<tr><td>' + esc(post ? post.title : r.postId) + '</td><td>' + fmtNum(r.value) + '</td></tr>';
    }).join(''));
    if (!reachGuard.summable && ds.obs.length) html += '<div class="notice warn"><strong>Reach không cộng dồn:</strong> ' + esc(reachGuard.reason) + '</div>';
    if (missing) html += '<div class="notice warn">Có KPI chưa có giá trị thực đạt — hiển thị "Chưa cập nhật", không thay bằng 0.</div>';
    if (!levelRows.length) html += '<div class="notice warn">Không có dòng số liệu quảng cáo nào khớp bộ lọc hiện tại (cấp ' + esc(levelLabel) + (f.accountId !== 'all' ? ', tài khoản đã chọn' : '') + '). Hãy đổi bộ lọc hoặc kết nối tài khoản quảng cáo.</div>';
    else html += '<h2>Chi tiết cấp ' + esc(levelLabel) + '</h2>' + tbl('<tr><th>Tên</th><th>Trạng thái</th><th>Chi tiêu</th><th>Hiển thị</th><th>Nhấp</th><th>Kết quả</th><th>Giá trị chuyển đổi</th></tr>' + levelRows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + statusBadge(r.status, r.statusLabel) + '</td><td>' + fmtMoney(r.spend, r.currency || 'VND') + '</td><td>' + fmtNum(r.impressions) + '</td><td>' + fmtNum(r.clicks) + '</td><td>' + fmtNum(r.results) + '</td><td>' + (r.conversionValue === null || r.conversionValue === undefined ? '— (thiếu)' : fmtNum(r.conversionValue)) + '</td></tr>';
    }).join(''));
    html += '<h2>Báo cáo đã chốt</h2>';
    var snaps = Store.list('reportSnapshots');
    if (!snaps.length) html += '<div class="state-box">Chưa có báo cáo nào được chốt. Dùng nút "Chốt báo cáo" ở đầu trang để đóng băng số liệu đang lọc.</div>';
    snaps.forEach(function (s) {
      var m = s.metrics || {};
      html += '<div class="panel"><strong>' + esc(s.title) + '</strong> <span class="badge ok">' + esc(s.status || 'Đã chốt') + '</span>' +
        '<p class="sub">Chốt lúc ' + esc(D.formatDateTimeVN(s.frozenAt)) + ' · Chi tiêu: ' + (m.spend === null || m.spend === undefined ? '—' : fmtMoney(m.spend, 'VND')) + ' · Hiển thị: ' + fmtNum(m.impressions) + ' · Nhấp: ' + fmtNum(m.clicks) + '</p>' +
        '<p>' + esc(s.summary || '') + '</p><p class="sub">Báo cáo đã chốt hiển thị đóng băng — không có nút sửa.</p></div>';
    });
    return html;
  }

  // ---------- Thiết lập ----------
  function viewSettings() {
    var configured = Store.mode === 'supabase';
    var ed = canEdit();
    var isOwner = canMemberManage();
    var html = pageHead('Thiết lập', 'Kết nối dữ liệu, thành viên & vai trò, BU/sản phẩm, năng lực làm việc và kết nối kênh.',
      isOwner ? '<button class="btn" data-action="editor-open" data-kind="invite">+ Mời thành viên</button>' : '');
    html += '<h2>Trạng thái kết nối Supabase</h2><div class="panel">';
    if (configured) {
      var me = Store.currentUser();
      if (me && Store.supabaseUser) html += '<p><span class="badge ok">Đã đăng nhập</span> ' + esc(me.name) + ' (' + esc(me.email || '') + ') — vai trò: ' + esc(me.roleLabel || labelStatus(me.role)) + '.</p>' +
        '<p><button class="btn secondary" data-action="sign-out">Đăng xuất</button></p>';
      else html += '<p><span class="badge ok">Đã cấu hình</span> App đã có thông tin kết nối. Đăng nhập bằng email/mật khẩu để vào workspace.</p>' +
        '<form class="inline" id="signin-form"><label>Email<input type="email" name="email" required></label><label>Mật khẩu<input type="password" name="password" required></label><button class="btn" type="submit">Đăng nhập</button></form>';
    } else html += '<p><span class="badge warn">Chờ kết nối Supabase</span></p><p>Hướng dẫn 3 bước:</p><ol>' +
      '<li>Tạo một Supabase project riêng cho Marketing Workspace.</li>' +
      '<li>Chạy các migration trong thư mục <code>supabase/</code> theo tài liệu thiết lập đi kèm repo.</li>' +
      '<li>Điền thông tin kết nối công khai vào file <code>config.js</code> — xem mẫu ở <code>config.example.js</code> — rồi tải lại trang.</li></ol>';
    html += '</div>';
    html += '<h2>Chế độ demo</h2><div class="panel">' +
      '<p>Trạng thái hiện tại: <strong>' + (Store.mode === 'demo' ? 'Đang bật — mọi màn hình đều có banner "Dữ liệu minh họa — không phải dữ liệu thật", và bộ đổi người dùng ở thanh trên chỉ xuất hiện trong chế độ này (ghi rõ "Chế độ demo")' : 'Đang tắt') + '</strong>.</p>' +
      (Store.mode === 'demo'
        ? '<button class="btn" data-action="demo-off">Tắt chế độ demo</button> <button class="btn secondary" data-action="demo-reset">Đặt lại dữ liệu demo</button>'
        : '<button class="btn" data-action="demo-on">Bật chế độ demo</button>') + '</div>';
    html += '<h2>Thành viên & vai trò</h2>';
    var members = Store.list('members');
    if (!members.length) html += '<div class="state-box">Chưa có thành viên (chưa kết nối dữ liệu).</div>';
    else html += tbl('<tr><th>Thành viên</th><th>Email</th><th>Vai trò</th><th>Hoạt động</th><th>Năng lực / ngày nghỉ</th></tr>' + members.map(function (m) {
      var roleSel = '<select data-action-change="member-role" data-id="' + esc(m.id) + '"' + dis(!isOwner) + '>' + [['owner', 'Owner'], ['lead', 'Lead'], ['member', 'Member'], ['ceo', 'CEO (chỉ xem)']].map(function (r) { return '<option value="' + r[0] + '"' + (m.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>';
      var activeSel = '<select data-action-change="member-active" data-id="' + esc(m.id) + '"' + dis(!isOwner) + '><option value="1"' + (m.isActive !== false ? ' selected' : '') + '>Đang hoạt động</option><option value="0"' + (m.isActive === false ? ' selected' : '') + '>Ngừng hoạt động</option></select>';
      return '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.email) + '</td><td>' + (isOwner ? roleSel : esc(m.roleLabel || labelStatus(m.role))) + '</td><td>' + (isOwner ? activeSel : (m.isActive === false ? 'Ngừng hoạt động' : 'Đang hoạt động')) + '</td>' +
        '<td>' + (m.capacityHoursPerWeek ? esc(m.capacityHoursPerWeek) + ' giờ/tuần' : '—') + ((m.daysOff || []).length ? '<br><span class="sub">Nghỉ: ' + m.daysOff.map(function (x) { return D.formatDateVN(x); }).join(', ') + '</span>' : '') + ' <button class="btn small secondary" data-action="editor-open" data-kind="memberCap" data-member="' + esc(m.id) + '"' + dis(!canSettings()) + '>Sửa</button></td></tr>';
    }).join(''));
    if (!isOwner) html += '<p class="sub">Chỉ Owner mới đổi vai trò / trạng thái hoạt động của thành viên và gửi lời mời. Nếu tầng dữ liệu chưa hỗ trợ một thao tác, hệ thống sẽ báo lỗi rõ thay vì báo thành công.</p>';
    html += '<h3>Ma trận quyền (4 vai)</h3>';
    var permKeys = Object.keys(Store.PERMISSION_LABELS || {});
    html += tbl('<tr><th>Quyền</th><th>Owner</th><th>Lead</th><th>Member</th><th>CEO</th></tr>' + permKeys.map(function (k) {
      function cell(role) { return Store.canRole(role, k) ? '✓' : '—'; }
      return '<tr><td>' + esc(Store.PERMISSION_LABELS[k]) + '</td><td>' + cell('owner') + '</td><td>' + cell('lead') + '</td><td>' + cell('member') + '</td><td>' + cell('ceo') + '</td></tr>';
    }).join(''));
    html += '<div class="toolbar"><h2 style="margin:0">BU / sản phẩm</h2>' + (canSettings() ? '<button class="btn small" data-action="editor-open" data-kind="bu">+ Thêm BU</button>' : '<span class="sub">Chỉ Owner quản lý BU/sản phẩm.</span>') + '</div>';
    html += Store.list('businessUnits').length
      ? tbl('<tr><th>BU</th><th>Sản phẩm</th><th>Mô tả</th><th>Thao tác</th></tr>' + Store.list('businessUnits').map(function (b) {
        return '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc((b.products || []).join(', ')) + '</td><td>' + esc(b.description || '—') + '</td><td class="row-actions"><button class="btn small" data-action="editor-open" data-kind="bu" data-id="' + esc(b.id) + '"' + dis(!canSettings()) + '>Sửa</button> <button class="btn small secondary" data-action="archive-item" data-coll="businessUnits" data-id="' + esc(b.id) + '"' + dis(!canSettings()) + '>Lưu trữ</button></td></tr>';
      }).join(''))
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
    'content': viewContent, 'tasks': viewTasks, 'approvals': viewApprovals, 'team': viewTeam,
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
    root.innerHTML = editorHtml() + taskPanelHtml();
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
    // Điều hướng: vào route mới thì về đầu trang; ở lại cùng route (lọc/panel) thì giữ vị trí cuộn của list.
    if (baseChanged) { UI.lastBase = ROUTE.name; window.scrollTo(0, 0); }
    else if (UI.scrollMem[routeKey(ROUTE)] !== undefined && !UI.editor) {
      window.scrollTo(0, UI.scrollMem[routeKey(ROUTE)]);
    }
  }
  window.addEventListener('scroll', function () {
    if (ROUTE) UI.scrollMem[routeKey(ROUTE)] = window.scrollY;
  }, { passive: true });

  function exportCsv() {
    var rows = UI.reportRowsCache || [];
    var head = 'level,name,status,spend,impressions,clicks,results,conversionValue';
    function cell(v) { return (v === null || v === undefined) ? '' : v; }
    var lines = rows.map(function (r) {
      return [r.level, '"' + String(r.name || '').replace(/"/g, '""') + '"', cell(r.status), cell(r.spend), cell(r.impressions), cell(r.clicks), cell(r.results), cell(r.conversionValue)].join(',');
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
    visibleList('tasks').filter(function (t) { return hit(t, ['title', 'deliverable']); }).slice(0, 4).forEach(function (t) { out.push('<button type="button" data-action="open-task" data-id="' + esc(t.id) + '">Việc: ' + esc(t.title) + '</button>'); });
    visibleList('contentItems').filter(function (x) { return hit(x, ['title', 'brief']); }).slice(0, 4).forEach(function (x) { out.push('<a href="#/content">Nội dung: ' + esc(x.title) + '</a>'); });
    visibleList('brandPages').filter(function (x) { return hit(x, ['title', 'summary']); }).slice(0, 3).forEach(function (x) { out.push('<a href="#/brand">Trang thương hiệu: ' + esc(x.title) + '</a>'); });
    visibleList('brandAssets').filter(function (x) { return hit(x, ['name', 'type']); }).slice(0, 3).forEach(function (x) { out.push('<a href="#/brand">Tài nguyên: ' + esc(x.name) + '</a>'); });
    box.innerHTML = out.length ? out.join('') : '<span class="sub">Không tìm thấy kết quả.</span>';
    box.hidden = false;
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', function (ev) {
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
      if (t.getAttribute('data-content')) context.contentItemId = t.getAttribute('data-content');
      if (t.getAttribute('data-kpi')) context.kpiId = t.getAttribute('data-kpi');
      if (t.getAttribute('data-line')) context.budgetLineId = t.getAttribute('data-line');
      if (t.getAttribute('data-member')) context.memberId = t.getAttribute('data-member');
      if (kind === 'tiktokMetric') context.variantId = id;
      if (kind === 'snapshot') {
        var aggC = UI.reportAggCache || {};
        context.metrics = { spend: aggC.totals ? aggC.totals.spend : null, impressions: aggC.totals ? aggC.totals.impressions : null, clicks: aggC.totals ? aggC.totals.clicks : null, results: aggC.totals ? aggC.totals.results : null, conversionValue: aggC.totals ? aggC.totals.conversionValue : null, ctr: aggC.ctr, cpc: aggC.cpc, roas: aggC.roas };
        context.filter = { level: aggC.level, accountId: aggC.accountId, campaignId: aggC.campaignId, from: aggC.from, to: aggC.to };
      }
      if (kind === 'measurement') { openEditor('measurement', null, context); return; }
      openEditor(kind, id, context);
    }
    if (action === 'editor-close' || action === 'editor-backdrop') { if (action === 'editor-close' || ev.target === t) closeEditor(); }
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
    if (action === 'task-close') closeTaskPanel();
    if (action === 'archive-item' || action === 'restore-item') {
      var coll = t.getAttribute('data-coll');
      var fn = action === 'archive-item' ? sArchive : sRestore;
      settle(fn(coll, id), function () { toast(action === 'archive-item' ? 'Đã lưu trữ. Có thể khôi phục ở mục đã lưu trữ.' : 'Đã khôi phục.'); if (UI.taskPanelId === id) UI.taskPanelId = null; render(); });
    }
    if (action === 'task-archive') { settle(sArchive('tasks', id), function () { toast('Đã lưu trữ công việc.'); closeTaskPanel(); render(); }); }
    if (action === 'task-restore') { settle(sRestore('tasks', id), function () { toast('Đã khôi phục công việc.'); render(); }); }
    if (action === 'checklist-remove') {
      var task = taskById(id); var idx = Number(t.getAttribute('data-idx'));
      if (task) { var cl = (task.checklist || []).slice(); cl.splice(idx, 1); settle(sUpdate('tasks', id, { checklist: cl }), function () { render(); }); }
    }
    if (action === 'dep-remove') { settle(hasFn('remove') ? Store.remove('dependencies', id) : { ok: false, error: 'Tầng dữ liệu chưa hỗ trợ xóa quan hệ.' }, function () { render(); }); }
    if (action === 'brand-tab') { UI.brandTab = id; render(); }
    if (action === 'brand-open') { UI.brandOpenId = UI.brandOpenId === id ? null : id; render(); }
    if (action === 'brand-clear') { UI.brandQuery = ''; render(); }
    if (action === 'post-metrics') { UI.postOpenId = UI.postOpenId === id ? null : id; render(); }
    if (action === 'content-tab') { UI.contentTab = id; render(); }
    if (action === 'report-view') { UI.report.view = id; render(); }
    if (action === 'report-clear') { UI.report = { view: UI.report.view, level: 'campaign', accountId: 'all', campaignId: 'all', from: '', to: '' }; render(); }
    if (action === 'cal-today') { var n = new Date(); UI.calYear = n.getFullYear(); UI.calMonth = n.getMonth(); render(); }
    if (action === 'cal-day') {
      // Không kích hoạt khi bấm vào chip nội dung trong ô ngày
      if (ev.target.closest('[data-action="chip-variant"]')) return;
      openEditor('content', null, { scheduledDate: id });
    }
    if (action === 'chip-variant') { ev.stopPropagation(); openEditor('variant', id, {}); }
    if (action === 'submit-review') {
      settle(submitReviewCall(id), function () { toast('Đã gửi duyệt. Người duyệt sẽ thấy đúng bản nội dung này ở mục Duyệt nội dung.'); render(); });
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
      settle(decideCall(a, decision, note), function () { toast('Đã ghi quyết định gắn với đúng phiên bản nội dung đang hiển thị.'); render(); });
    }
    if (action === 'cancel-date-change') { UI.pendingDatePreview = null; render(); }
    if (action === 'apply-date-change' && UI.pendingDatePreview) {
      var p = UI.pendingDatePreview;
      UI.pendingDatePreview = null;
      settle(sUpdate('tasks', p.taskId, { startDate: p.newStart, dueDate: p.newDue }), function () {
        toast('Đã áp dụng đổi lịch cho việc gốc. Lịch của việc phụ thuộc không bị tự dịch.');
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
      var pv = UI.ganttPreview; UI.ganttPreview = null;
      var patch = pv.coll === 'campaigns' || pv.coll === 'phases' || pv.coll === 'activities'
        ? { startDate: pv.newStart, endDate: pv.newEnd }
        : { startDate: pv.newStart, dueDate: pv.newEnd };
      settle(sUpdate(pv.coll, pv.id, patch), function () { toast('Đã lưu lịch mới cho "' + pv.title + '".'); render(); });
    }
    if (action === 'gantt-cancel') { UI.ganttPreview = null; render(); }
    if (action === 'resolve-blocker') { settle(sUpdate('blockers', id, { status: 'resolved' }), function () { render(); }); }
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
      return;
    }
    var kind = t.getAttribute && t.getAttribute('data-action-change');
    if (kind === 'task-status') {
      if (!canEdit()) { toast('Vai trò hiện tại chỉ xem, không đổi được trạng thái.'); render(); return; }
      settle(sUpdate('tasks', t.getAttribute('data-id'), { status: t.value }), function () { render(); });
    }
    if (kind === 'checklist-toggle') {
      if (!canEditTask()) { toast('Bạn đang xem ở chế độ chỉ đọc, không sửa được danh sách kiểm tra.'); render(); return; }
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
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (UI.editor) closeEditor();
      else if (currentTaskPanelId()) closeTaskPanel();
      var sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
      var bd = document.getElementById('sidebar-backdrop'); if (bd) bd.hidden = true;
    }
    if (ev.key === 'Enter' && ev.target.getAttribute && ev.target.getAttribute('data-action') === 'cal-day') {
      openEditor('content', null, { scheduledDate: ev.target.getAttribute('data-id') });
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
      var data = {};
      fd.forEach(function (v, k) { data[k] = v; });
      var btn = f.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
      try { saveEditor(editorKind, data, f); }
      finally { if (btn && UI.editor) { btn.disabled = false; btn.textContent = 'Lưu'; } }
      return;
    }
    if (f.id === 'task-panel-form') {
      var tid = f.getAttribute('data-task-id');
      // Phòng thủ theo cùng cơ chế quyền như lúc render: chỉ-đọc thì không
      // lưu gì cả; chỉ có task.updateStatus thì chỉ ghi đúng trạng thái
      // (các ô khác đang disabled nên FormData không mang chúng theo).
      if (taskPanelReadonly()) { toast('Bạn đang xem ở chế độ chỉ đọc, không lưu được thay đổi.'); return; }
      if (!canEditTask()) {
        settle(sUpdate('tasks', tid, { status: val('status') }), function () { toast('Đã lưu trạng thái công việc.'); render(); });
        return;
      }
      var start = val('startDate'), due = val('dueDate');
      if (start && due && due < start) { toast('Mốc cần hoàn thành phải sau ngày bắt đầu.'); return; }
      if (val('parentId') === tid) { toast('Việc không thể là việc cha của chính nó.'); return; }
      settle(sUpdate('tasks', tid, {
        title: val('title'), assigneeId: val('assigneeId') || null, ownerId: val('assigneeId') || null,
        campaignId: val('campaignId') || null, parentId: val('parentId') || null, status: val('status'),
        priority: val('priority'), startDate: start || null, dueDate: due || null,
        effortHours: val('effortHours') ? Number(val('effortHours')) : null,
        deliverable: val('deliverable') || '', description: val('description') || '', availabilityNote: val('availabilityNote') || ''
      }), function () { toast('Đã lưu công việc.'); render(); });
      return;
    }
    if (f.id === 'checklist-add-form') {
      if (!canEditTask()) { toast('Bạn đang xem ở chế độ chỉ đọc, không thêm được mục kiểm tra.'); return; }
      var tid2 = f.getAttribute('data-task-id');
      var task2 = taskById(tid2);
      if (task2) settle(sUpdate('tasks', tid2, { checklist: (task2.checklist || []).concat([{ text: String(val('text')), done: false }]) }), function () { render(); });
      return;
    }
    if (f.id === 'dep-add-panel-form') {
      if (!canEditTask()) { toast('Bạn đang xem ở chế độ chỉ đọc, không thêm được phụ thuộc.'); return; }
      var tid3 = f.getAttribute('data-task-id');
      var from = val('predecessorId');
      if (D.wouldCreateCycle(Store.list('dependencies'), from, tid3)) { toast('Không thêm được: quan hệ này tạo vòng phụ thuộc.'); return; }
      settle(sCreate('dependencies', { predecessorId: from, successorId: tid3 }), function () { toast('Đã thêm quan hệ phụ thuộc.'); render(); });
      return;
    }
    if (f.id === 'comment-add-form') {
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
    if (formKind === 'attach-campaign') {
      // Gắn / đổi / bỏ gắn campaign cho bài qua đúng bảng nối (R15): giá trị rỗng = bỏ gắn.
      var mapResult = hasFn('setPostCampaign') ? Store.setPostCampaign(fid, val('campaignId') || null) : sUpdate('externalPosts', fid, { campaignId: val('campaignId') || null });
      settle(mapResult, function () { toast(val('campaignId') ? 'Đã gắn campaign cho bài đã đăng.' : 'Đã bỏ gắn campaign khỏi bài.'); render(); });
    }
  });

  window.addEventListener('hashchange', function () {
    var sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('open')) { sidebar.classList.remove('open'); var bd2 = document.getElementById('sidebar-backdrop'); if (bd2) bd2.hidden = true; }
    if (UI.taskPanelId && parseRoute().name !== 'tasks') { /* panel đang mở qua replaceState — không đổi route */ }
    render();
  });
  Store.subscribe(function () { render(); });
  var boot = Store.load();
  render();
  if (boot && typeof boot.then === 'function') boot.then(function () { UI.booted = true; render(); });
  else UI.booted = true;
})();
