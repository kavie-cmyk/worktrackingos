/*
 * js/app.js — SAVA Marketing Workspace (SPA hash routing, vanilla JS, không build step).
 * Mọi dữ liệu đi qua window.SAVA_STORE; mọi phép tính qua window.SAVA_DOMAIN.
 */
(function () {
  'use strict';
  var Store = window.SAVA_STORE;
  var D = window.SAVA_DOMAIN;

  var NAV = [
    ['overview', 'Tổng quan'],
    ['my-work', 'Việc của tôi'],
    ['brand', 'Brand Hub'],
    ['campaigns', 'IMC & Campaigns'],
    ['calendar', 'Content Calendar'],
    ['tasks', 'Action Plan & Công việc'],
    ['approvals', 'Duyệt nội dung'],
    ['team', 'Team & Workload'],
    ['kpi', 'KPI & Ngân sách'],
    ['channels', 'Kênh & Bài đã đăng'],
    ['ads', 'Quảng cáo'],
    ['reports', 'Dashboard & Báo cáo'],
    ['settings', 'Thiết lập']
  ];

  var UI = {
    selectedCampaignId: 'camp-1',
    brandQuery: '',
    calendarYear: 2026,
    calendarMonth: 10, // tháng 11 (0-based) — tháng có nhiều nội dung demo nhất
    channelFilter: 'all',
    adsLevel: 'campaign',
    pendingDatePreview: null,
    reportRowsCache: []
  };

  // ---------- Tiện ích hiển thị ----------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function memberName(id) {
    var m = Store.get('members', id);
    return m ? m.name : (id || '—');
  }
  function campaignName(id) {
    var c = Store.get('campaigns', id);
    return c ? c.name : (id || '—');
  }
  function taskById(id) { return Store.get('tasks', id); }
  function fmtMoney(n, currency) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('vi-VN') + ' ' + esc(currency || '');
  }
  function fmtNum(n) { return (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('vi-VN'); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function isOverdue(t) {
    if (!t.dueDate) return false;
    var s = String(t.status || '').toLowerCase();
    return t.dueDate < todayISO() && s !== 'completed' && s !== 'done' && s !== 'cancelled';
  }
  function statusBadge(status, label) {
    var s = String(status || '').toLowerCase();
    var cls = 'grey';
    if (s === 'completed' || s === 'done' || s === 'approved' || s === 'active') cls = 'ok';
    if (s === 'in_progress' || s === 'in_review' || s === 'pending' || s === 'scheduled') cls = 'warn';
    if (s === 'cancelled' || s === 'rejected' || s === 'overdue') cls = 'bad';
    return '<span class="badge ' + cls + '">' + esc(label || status || '—') + '</span>';
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 5200);
  }
  function demoBanner() {
    document.getElementById('demo-banner').hidden = Store.mode !== 'demo';
  }
  function readinessBadge(task) {
    var r = D.taskReadiness(task.id, Store.list('tasks'), Store.list('dependencies'));
    if (r.ready) return '<span class="badge ok">Sẵn sàng</span>';
    var names = r.pendingPredecessors.map(function (id) { var t = taskById(id); return t ? t.title : id; }).join(', ');
    return '<span class="badge warn">Đang chờ: ' + esc(names) + '</span>';
  }
  function pageHead(title, sub) {
    return '<h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '');
  }
  function setupNotice() {
    return pageHead('Chờ kết nối Supabase', 'Workspace chưa có dữ liệu thật.') +
      '<div class="state-box"><p><strong>Chờ kết nối Supabase</strong></p>' +
      '<p>App chưa được cấu hình Supabase và chế độ dữ liệu minh họa chưa bật.</p>' +
      '<p>Vào mục <a href="#/settings">Thiết lập</a> để xem hướng dẫn 3 bước kết nối, ' +
      'hoặc bật chế độ dữ liệu minh họa để xem thử giao diện (mọi màn hình đều gắn nhãn dữ liệu minh họa).</p></div>';
  }

  // ---------- Đăng nhập / nhận lời mời / đặt mật khẩu ----------
  // Chạy một kết quả Store có thể là object đồng bộ (demo) hoặc Promise (supabase).
  function settle(result, onOk) {
    if (result && typeof result.then === 'function') {
      result.then(function (r) {
        if (r && r.ok) { if (onOk) onOk(r); }
        else toast((r && r.error) || 'Thao tác thất bại.');
      }).catch(function (e) { toast('Thao tác thất bại: ' + (e && e.message ? e.message : e)); });
    } else if (result && result.ok) { if (onOk) onOk(result); }
    else if (result) toast(result.error || 'Thao tác thất bại.');
    return result;
  }
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
      '<p class="sub">Chưa có tài khoản? Tài khoản do Owner mời qua email — hãy mở liên kết trong email mời để đặt mật khẩu lần đầu.</p></div>';
  }
  function viewNoMembership() {
    return pageHead('Tài khoản chưa được gán quyền', 'Bạn đã đăng nhập nhưng chưa thuộc workspace nào.') +
      '<div class="state-box"><p><strong>Tài khoản chưa được gán quyền — liên hệ Owner</strong></p>' +
      '<p>Chủ workspace (Owner) cần thêm tài khoản của bạn vào workspace và gán vai trò (Owner / Lead / Member / CEO) thì dữ liệu mới hiện ra.</p>' +
      '<p><button class="btn secondary" data-action="sign-out">Đăng xuất</button></p></div>';
  }

  // ---------- Tổng quan ----------
  function viewOverview() {
    var campaigns = Store.list('campaigns');
    var tasks = Store.list('tasks');
    var approvals = Store.list('approvals').filter(function (a) { return a.status === 'pending'; });
    var overdue = tasks.filter(isOverdue);
    var running = campaigns.filter(function (c) { return c.status === 'active'; });
    var atRisk = [];
    campaigns.forEach(function (c) {
      var ct = tasks.filter(function (t) { return t.campaignId === c.id; });
      var od = ct.filter(isOverdue);
      var blocked = ct.filter(function (t) { return !D.taskReadiness(t.id, tasks, Store.list('dependencies')).ready && t.status !== 'completed'; });
      if (od.length || blocked.length) {
        atRisk.push({ campaign: c, reason: (od.length ? od.length + ' việc quá hạn. ' : '') + (blocked.length ? blocked.length + ' việc đang chờ việc khác. ' : '') + (c.risks ? c.risks : '') });
      }
    });
    var html = pageHead('Tổng quan', 'Tình hình Marketing tại thời điểm hiện tại' + (Store.mode === 'demo' ? ' — dữ liệu minh họa' : '') + '.');
    html += '<div class="cards">' +
      '<div class="card"><div class="big">' + running.length + '</div>Campaign đang chạy</div>' +
      '<div class="card"><div class="big">' + approvals.length + '</div>Nội dung chờ duyệt</div>' +
      '<div class="card"><div class="big">' + overdue.length + '</div>Việc quá hạn</div>' +
      '<div class="card"><div class="big">' + atRisk.length + '</div>Campaign có nguy cơ trễ</div></div>';
    html += '<h2>Campaign đang chạy</h2>';
    if (!running.length) html += '<div class="state-box">Chưa có campaign nào đang chạy.</div>';
    running.forEach(function (c) {
      var p = D.campaignProgress(tasks.filter(function (t) { return t.campaignId === c.id; }));
      html += '<div class="card"><strong>' + esc(c.name) + '</strong><p class="sub">' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + ' · Người phụ trách: ' + esc(memberName(c.ownerId)) + '</p>' +
        '<div class="progress"><div style="width:' + p.percentage + '%"></div></div><p class="sub">Tiến độ việc lá: ' + p.completed + '/' + p.total + ' (' + p.percentage + '%)</p></div>';
    });
    html += '<h2>Nguy cơ trễ (có lý do)</h2>';
    if (!atRisk.length) html += '<div class="state-box">Không có campaign nào có dấu hiệu trễ.</div>';
    atRisk.forEach(function (r) {
      html += '<div class="notice warn"><strong>' + esc(r.campaign.name) + '</strong> — ' + esc(r.reason) + '</div>';
    });
    html += '<h2>Chờ duyệt & quá hạn</h2><div class="grid2"><div class="panel"><h3>Chờ duyệt (' + approvals.length + ')</h3>' +
      (approvals.length ? '<ul class="clean">' + approvals.map(function (a) { return '<li>Variant ' + esc(a.variantId) + ' · phiên bản (revision) ' + esc(a.revision) + ' · từ ' + esc(memberName(a.requestedBy)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có nội dung chờ duyệt.</p>') + '</div>' +
      '<div class="panel"><h3>Quá hạn (' + overdue.length + ')</h3>' +
      (overdue.length ? '<ul class="clean">' + overdue.map(function (t) { return '<li>' + esc(t.title) + ' — hạn ' + esc(D.formatDateVN(t.dueDate)) + ' · ' + esc(memberName(t.assigneeId)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có việc quá hạn.</p>') + '</div></div>';
    html += '<h2>Tình trạng dữ liệu</h2><div class="panel">' +
      (Store.mode === 'demo'
        ? 'Chế độ: <strong>Dữ liệu minh họa</strong> — toàn bộ số liệu trên màn hình này là minh họa, không phải dữ liệu thật. Kênh ở trạng thái "Chờ kết nối" nên số liệu kênh chưa tự động cập nhật.'
        : 'Chế độ: <strong>Supabase</strong>. Kiểm tra trạng thái từng kênh ở mục Kênh & Bài đã đăng.') + '</div>';
    return html;
  }

  // ---------- Việc của tôi ----------
  function viewMyWork() {
    var me = Store.currentUser();
    var tasks = Store.list('tasks');
    var edges = Store.list('dependencies');
    var mine = tasks.filter(function (t) { return t.assigneeId === (me && me.id); });
    var waiting = mine.filter(function (t) { return !D.taskReadiness(t.id, tasks, edges).ready && t.status !== 'completed'; });
    var myIds = {};
    mine.forEach(function (t) { myIds[t.id] = true; });
    var blocking = tasks.filter(function (t) {
      return edges.some(function (e) { return e.successorId === t.id && myIds[e.predecessorId]; }) && t.status !== 'completed' && !myIds[t.id];
    });
    var overdue = mine.filter(isOverdue);
    var unscheduled = mine.filter(function (t) { return !t.startDate && !t.dueDate; });
    var html = pageHead('Việc của tôi', 'Việc của ' + (me ? me.name : '—') + '. Đổi người dùng ở cột trái (chế độ demo) để xem góc nhìn khác.');
    function taskList(list, emptyText) {
      if (!list.length) return '<p class="sub">' + esc(emptyText) + '</p>';
      return '<table><tr><th>Việc</th><th>Campaign</th><th>Mốc cần hoàn thành</th><th>Trạng thái</th><th>Thứ tự thực hiện / Việc đang chờ</th></tr>' +
        list.map(function (t) {
          return '<tr><td>' + esc(t.title) + '</td><td>' + esc(campaignName(t.campaignId)) + '</td><td>' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : 'Chưa xếp lịch') + (isOverdue(t) ? ' <span class="badge bad">Quá hạn</span>' : '') + '</td><td>' + statusBadge(t.status, t.status) + '</td><td>' + readinessBadge(t) + '</td></tr>';
        }).join('') + '</table>';
    }
    html += '<h2>Việc được giao (' + mine.length + ')</h2>' + taskList(mine, 'Chưa có việc nào được giao.');
    html += '<h2>Đang chờ (' + waiting.length + ')</h2><p class="sub">Các việc của bạn chưa sẵn sàng vì việc trước chưa xong (blocked by).</p>' + taskList(waiting, 'Không có việc nào đang chờ.');
    html += '<h2>Các việc đang chờ mình (' + blocking.length + ')</h2><p class="sub">Việc của người khác đang chờ một việc của bạn hoàn thành (blocking).</p>' + taskList(blocking, 'Không có việc nào đang chờ bạn.');
    html += '<h2>Quá hạn (' + overdue.length + ')</h2>' + taskList(overdue, 'Không có việc quá hạn.');
    html += '<h2>Chưa xếp lịch (' + unscheduled.length + ')</h2>' + taskList(unscheduled, 'Mọi việc đều đã có lịch.');
    return html;
  }

  // ---------- Brand Hub ----------
  function viewBrand() {
    var q = UI.brandQuery.toLowerCase();
    function match(x) { return !q || JSON.stringify(x).toLowerCase().indexOf(q) !== -1; }
    var pages = Store.list('brandPages').filter(match);
    var assets = Store.list('brandAssets').filter(match);
    var html = pageHead('Brand Hub', 'Trang thương hiệu và tài nguyên dùng chung cho toàn đội.');
    html += '<form class="inline" id="brand-search-form"><label>Tìm kiếm<input type="search" id="brand-query" value="' + esc(UI.brandQuery) + '" placeholder="Tên trang, tài nguyên, loại…"></label><button class="btn" type="submit">Tìm</button></form>';
    html += '<h2>Trang thương hiệu</h2>';
    if (!pages.length) html += '<div class="state-box">Không có trang nào khớp tìm kiếm.</div>';
    else html += '<table><tr><th>Trang</th><th>Tóm tắt</th><th>Phiên bản</th><th>Trạng thái</th><th>Cập nhật</th></tr>' + pages.map(function (p) {
      return '<tr><td><strong>' + esc(p.title) + '</strong></td><td>' + esc(p.summary || '') + '</td><td>v' + esc(p.version) + '</td><td>' + statusBadge(p.status === 'Approved' ? 'approved' : (p.status === 'Archived' ? 'cancelled' : 'pending'), p.status) + '</td><td>' + esc(D.formatDateVN(p.updatedAt)) + '</td></tr>';
    }).join('') + '</table>';
    html += '<h2>Tài nguyên</h2>';
    if (!assets.length) html += '<div class="state-box">Không có tài nguyên nào khớp tìm kiếm.</div>';
    else html += '<table><tr><th>Tài nguyên</th><th>Loại</th><th>Phiên bản</th><th>Trạng thái</th><th>Cập nhật</th></tr>' + assets.map(function (a) {
      return '<tr><td><strong>' + esc(a.name) + '</strong></td><td>' + esc(a.type) + '</td><td>v' + esc(a.version) + '</td><td>' + statusBadge(a.status === 'Approved' ? 'approved' : (a.status === 'Archived' ? 'cancelled' : 'pending'), a.status) + '</td><td>' + esc(D.formatDateVN(a.updatedAt)) + '</td></tr>';
    }).join('') + '</table>';
    return html;
  }

  // ---------- IMC & Campaigns + Gantt ----------
  function ganttHtml(campaign) {
    var tasks = Store.list('tasks').filter(function (t) { return t.campaignId === campaign.id; });
    var scheduled = tasks.filter(function (t) { return t.startDate && t.dueDate; });
    var unscheduled = tasks.filter(function (t) { return !t.startDate || !t.dueDate; });
    var html = '<h3>Gantt — Kế hoạch đã duyệt (baseline) so với hiện hành</h3>';
    if (!scheduled.length) html += '<div class="state-box">Chưa có việc nào có đủ ngày bắt đầu và ngày đến hạn để vẽ Gantt.</div>';
    else {
      var starts = scheduled.map(function (t) { return t.startDate; }).concat(scheduled.map(function (t) { return t.baselineStartDate || t.startDate; }));
      var ends = scheduled.map(function (t) { return t.dueDate; }).concat(scheduled.map(function (t) { return t.baselineDueDate || t.dueDate; }));
      starts.sort(); ends.sort();
      var min = new Date(starts[0] + 'T00:00:00'); var max = new Date(ends[ends.length - 1] + 'T00:00:00');
      var span = Math.max(1, (max - min) / 86400000 + 1);
      var today = new Date(todayISO() + 'T00:00:00');
      var todayPct = ((today - min) / 86400000) / span * 100;
      html += '<div class="gantt"><p class="sub">Thanh đậm: lịch hiện hành · thanh mảnh phía dưới: Kế hoạch đã duyệt · vạch đỏ: hôm nay (' + esc(D.formatDateVN(todayISO())) + ')</p>';
      scheduled.forEach(function (t) {
        function pct(dateStr) { return ((new Date(dateStr + 'T00:00:00') - min) / 86400000) / span * 100; }
        var left = pct(t.startDate), width = Math.max(2, pct(t.dueDate) - left + 100 / span);
        var bLeft = pct(t.baselineStartDate || t.startDate), bWidth = Math.max(2, pct(t.baselineDueDate || t.dueDate) - bLeft + 100 / span);
        html += '<div class="gantt-row"><div>' + esc(t.title) + '<br><span class="sub">' + esc(D.formatDateVN(t.startDate)) + ' — ' + esc(D.formatDateVN(t.dueDate)) + '</span></div>' +
          '<div class="gantt-track"><div class="gantt-bar" style="left:' + left + '%;width:' + width + '%"></div>' +
          '<div class="gantt-bar baseline" style="left:' + bLeft + '%;width:' + bWidth + '%"></div>' +
          (todayPct >= 0 && todayPct <= 100 ? '<div class="gantt-today" style="left:' + todayPct + '%"></div>' : '') + '</div></div>';
      });
      html += '</div>';
    }
    html += '<h3>Việc chưa có lịch</h3>';
    if (!unscheduled.length) html += '<p class="sub">Mọi việc đều đã có lịch.</p>';
    else html += '<ul class="clean">' + unscheduled.map(function (t) { return '<li>' + esc(t.title) + ' — chưa có ' + (!t.startDate ? 'ngày bắt đầu' : '') + (!t.startDate && !t.dueDate ? ' và ' : '') + (!t.dueDate ? 'Mốc cần hoàn thành' : '') + '</li>'; }).join('') + '</ul>';
    // Form sửa ngày + preview ảnh hưởng
    html += '<h3>Sửa ngày việc (xem trước ảnh hưởng trước khi áp dụng)</h3>';
    html += '<form class="inline" id="task-date-form"><label>Việc<select id="date-task-id">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Ngày bắt đầu mới<input type="date" id="date-new-start" required></label>' +
      '<label>Mốc cần hoàn thành mới<input type="date" id="date-new-due" required></label>' +
      '<button class="btn secondary" type="submit">Xem trước ảnh hưởng</button></form>';
    if (UI.pendingDatePreview) {
      var p = UI.pendingDatePreview;
      html += '<div class="panel"><strong>Xem trước ảnh hưởng của việc đổi lịch "' + esc((taskById(p.taskId) || {}).title || p.taskId) + '"</strong>';
      if (!p.impact.length) html += '<p class="sub">Không có việc phụ thuộc nào bị ảnh hưởng. Đây chỉ là bản xem trước — chưa có lịch nào bị tự động dịch.</p>';
      else {
        html += '<p class="sub">Các việc phụ thuộc dưới đây có thể bị ảnh hưởng nếu áp dụng. Đây chỉ là bản xem trước — hệ thống không tự dịch lịch của chúng.</p>' +
          '<table><tr><th>Việc phụ thuộc</th><th>Quan hệ</th><th>Ngày hiện tại</th><th>Ngày đề xuất</th></tr>' +
          p.impact.map(function (i) {
            return '<tr><td>' + esc(i.title) + '</td><td>' + (i.direct ? 'Trực tiếp' : 'Gián tiếp') + '</td><td>' + esc(D.formatDateVN(i.currentStart)) + ' — ' + esc(D.formatDateVN(i.currentDue)) + '</td><td>' + esc(D.formatDateVN(i.proposedStart)) + ' — ' + esc(D.formatDateVN(i.proposedDue)) + '</td></tr>';
          }).join('') + '</table>';
      }
      html += '<p><button class="btn" data-action="apply-date-change">Xác nhận áp dụng đổi lịch cho việc gốc</button> <button class="btn secondary" data-action="cancel-date-change">Hủy xem trước</button></p></div>';
    }
    return html;
  }

  function viewCampaigns() {
    var campaigns = Store.list('campaigns');
    var html = pageHead('IMC & Campaigns', 'Kế hoạch truyền thông tích hợp và chi tiết từng campaign.');
    if (!campaigns.length) return html + '<div class="state-box">Chưa có campaign nào.</div>';
    html += '<div class="cards">' + campaigns.map(function (c) {
      var p = D.campaignProgress(Store.list('tasks').filter(function (t) { return t.campaignId === c.id; }));
      return '<div class="card"><strong>' + esc(c.name) + '</strong><p class="sub">' + esc(c.statusLabel || c.status) + ' · ' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + '</p>' +
        '<div class="progress"><div style="width:' + p.percentage + '%"></div></div><p class="sub">Tiến độ: ' + p.completed + '/' + p.total + ' việc lá (' + p.percentage + '%)</p>' +
        '<button class="btn small" data-action="select-campaign" data-id="' + esc(c.id) + '">Xem chi tiết</button></div>';
    }).join('') + '</div>';
    var c = Store.get('campaigns', UI.selectedCampaignId) || campaigns[0];
    var ctasks = Store.list('tasks').filter(function (t) { return t.campaignId === c.id; });
    var phases = Store.list('phases').filter(function (x) { return x.campaignId === c.id; });
    var acts = Store.list('activities').filter(function (x) { return x.campaignId === c.id; });
    var ckpis = Store.list('kpis').filter(function (x) { return x.campaignId === c.id; });
    html += '<h2>Chi tiết campaign</h2><div class="panel">';
    html += '<h3>Thông tin campaign</h3><table><tr><th>Tên</th><td>' + esc(c.name) + '</td></tr>' +
      '<tr><th>Trạng thái</th><td>' + esc(c.statusLabel || c.status) + '</td></tr>' +
      '<tr><th>Thời gian</th><td>' + esc(D.formatDateVN(c.startDate)) + ' — ' + esc(D.formatDateVN(c.endDate)) + ' (Kế hoạch đã duyệt: ' + esc(D.formatDateVN(c.baselineStartDate)) + ' — ' + esc(D.formatDateVN(c.baselineEndDate)) + ')</td></tr>' +
      '<tr><th>Người phụ trách</th><td>' + esc(memberName(c.ownerId)) + '</td></tr>' +
      '<tr><th>Sản phẩm</th><td>' + esc(c.product || '—') + '</td></tr></table>';
    html += '<h3>Mục tiêu</h3><table>' +
      '<tr><th>Vì sao chạy campaign này?</th><td>' + esc(c.why || '—') + '</td></tr>' +
      '<tr><th>Mục tiêu kinh doanh</th><td>' + esc(c.businessGoal || '—') + '</td></tr>' +
      '<tr><th>Mục tiêu marketing</th><td>' + esc(c.marketingGoal || '—') + '</td></tr>' +
      '<tr><th>Kết quả mong muốn</th><td>' + esc(c.desiredOutcome || '—') + '</td></tr></table>';
    html += '<h3>Target audiences</h3>' + ((c.audiences || []).length ? '<ul class="clean">' + c.audiences.map(function (a) { return '<li><strong>' + esc(a.name) + '</strong> — ' + esc(a.description || '') + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa ghi nhận.</p>');
    html += '<h3>Audience insights</h3><p>' + esc(c.audienceInsights || 'Chưa ghi nhận.') + '</p>';
    html += '<h3>Big idea & Key message</h3><p><strong>Big idea:</strong> ' + esc(c.bigIdea || '—') + '</p><p><strong>Key message:</strong> ' + esc(c.keyMessage || '—') + '</p>';
    html += '<h3>KV & Creative direction</h3><p>' + esc(c.creativeDirection || 'Chưa ghi nhận.') + '</p>';
    html += '<h3>Các giai đoạn</h3>' + (phases.length ? '<ul class="clean">' + phases.map(function (x) { return '<li>' + esc(x.name) + ': ' + esc(D.formatDateVN(x.startDate)) + ' — ' + esc(D.formatDateVN(x.endDate)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có giai đoạn.</p>');
    html += '<h3>Hoạt động & Kênh triển khai</h3>' + (acts.length ? '<table><tr><th>Hoạt động</th><th>Kênh</th><th>Người phụ trách</th></tr>' + acts.map(function (a) { return '<tr><td>' + esc(a.name) + '</td><td>' + esc(a.channel) + '</td><td>' + esc(memberName(a.ownerId)) + '</td></tr>'; }).join('') + '</table>' : '<p class="sub">Chưa có hoạt động.</p>');
    html += '<h3>Timeline & Mốc cần hoàn thành</h3>' + ganttHtml(c);
    html += '<h3>Phân công</h3>' + (ctasks.length ? '<table><tr><th>Việc</th><th>Người phụ trách</th><th>Đầu ra cần bàn giao</th><th>Thời gian có thể nhận việc</th><th>Thời gian dự kiến</th><th>Thứ tự thực hiện / Việc đang chờ</th></tr>' + ctasks.map(function (t) {
      return '<tr><td>' + esc(t.title) + '</td><td>' + esc(memberName(t.assigneeId)) + '</td><td>' + esc(t.deliverable || '—') + '</td><td>' + esc(t.availabilityNote || '—') + '</td><td>' + (t.effortHours ? esc(t.effortHours) + ' giờ' : 'Chưa ước tính') + '</td><td>' + readinessBadge(t) + '</td></tr>';
    }).join('') + '</table>' : '<p class="sub">Chưa có việc.</p>');
    html += '<h3>KPI</h3>' + (ckpis.length ? '<ul class="clean">' + ckpis.map(function (k) { var d = D.kpiDisplay(k); return '<li>' + esc(k.name) + ': mục tiêu ' + fmtNum(k.target) + ' ' + esc(k.unit || '') + ' · thực đạt: ' + (d.isMissing ? 'Chưa cập nhật' : fmtNum(d.value)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Chưa có KPI.</p>');
    var blines = Store.list('budgetLines').filter(function (b) { return b.campaignId === c.id; });
    html += '<h3>Ngân sách</h3>' + (blines.length ? '<ul class="clean">' + blines.map(function (b) {
      var rem = D.budgetRemaining(b, Store.list('commitments').filter(function (x) { return x.budgetLineId === b.id; }), Store.list('actuals').filter(function (x) { return x.budgetLineId === b.id; }));
      return '<li>' + esc(b.name) + ': đã duyệt ' + fmtMoney(b.approved, b.currency) + ' · còn lại ' + fmtMoney(rem, b.currency) + '</li>';
    }).join('') + '</ul>' : '<p class="sub">Chưa có dòng ngân sách.</p>');
    var waiting = ctasks.filter(function (t) { return !D.taskReadiness(t.id, Store.list('tasks'), Store.list('dependencies')).ready && t.status !== 'completed'; });
    html += '<h3>Việc đang chờ & Rủi ro</h3>' +
      (waiting.length ? '<ul class="clean">' + waiting.map(function (t) { return '<li>' + esc(t.title) + ' — ' + readinessBadge(t) + '</li>'; }).join('') + '</ul>' : '<p class="sub">Không có việc đang chờ.</p>') +
      '<p>' + esc(c.risks || 'Chưa ghi nhận rủi ro.') + '</p>';
    html += '<h3>Kết quả & Rút kinh nghiệm</h3><p>' + esc(c.lessons || 'Chưa ghi nhận — sẽ bổ sung khi campaign kết thúc.') + '</p>';
    html += '</div>';
    return html;
  }

  // ---------- Content Calendar ----------
  function variantOf(id) { return Store.get('variants', id); }
  function contentTitle(id) { var x = Store.get('contentItems', id); return x ? x.title : id; }
  function viewCalendar() {
    var variants = Store.list('variants');
    var year = UI.calendarYear, month = UI.calendarMonth;
    var html = pageHead('Content Calendar', 'Lịch nội dung theo tháng (tuần bắt đầu thứ Hai), kèm bảng và kanban theo trạng thái biên tập.');
    html += '<form class="inline" id="cal-nav-form"><label>Tháng<input type="number" id="cal-month" min="1" max="12" value="' + (month + 1) + '"></label><label>Năm<input type="number" id="cal-year" value="' + year + '"></label><button class="btn secondary" type="submit">Xem tháng</button></form>';
    var first = new Date(year, month, 1);
    var start = D.weekStartMonday(first);
    var cells = [];
    for (var i = 0; i < 42; i++) { var d = new Date(start.getTime()); d.setDate(d.getDate() + i); cells.push(d); }
    html += '<div class="cal">' + ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'].map(function (x) { return '<div class="cal-head">' + x + '</div>'; }).join('') + '</div>';
    html += '<div class="cal">' + cells.map(function (d) {
      var iso = d.toISOString().slice(0, 10);
      // toISOString dùng UTC; hiệu chỉnh theo ngày địa phương:
      iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var dayVariants = variants.filter(function (v) { return (v.scheduledAt || '').slice(0, 10) === iso; });
      return '<div class="cal-cell' + (d.getMonth() !== month ? ' dim' : '') + '"><div class="day">' + d.getDate() + '/' + (d.getMonth() + 1) + '</div>' +
        dayVariants.map(function (v) { return '<span class="chip">' + esc(v.channelLabel || v.platform) + ': ' + esc(contentTitle(v.contentItemId)) + '</span>'; }).join('') + '</div>';
    }).join('') + '</div>';
    html += '<h2>Bảng nội dung & variant theo kênh</h2>';
    if (!variants.length) html += '<div class="state-box">Chưa có nội dung nào.</div>';
    else html += '<table><tr><th>Nội dung</th><th>Kênh</th><th>Caption riêng của kênh</th><th>Lịch đăng</th><th>Trạng thái biên tập</th><th>Đăng bài</th></tr>' + variants.map(function (v) {
      var pub = v.platform === 'tiktok'
        ? '<span class="badge warn">Chờ đăng ngoài app</span><br><span class="sub">App không tạo PublishJob cho TikTok.</span>'
        : (Store.mode === 'demo'
          ? '<button class="btn small" disabled title="Chế độ demo">Đăng bài (khóa ở demo)</button><br><span class="sub">Tài khoản demo không có quyền đăng thật.</span>'
          : '<button class="btn small" data-action="publish-variant" data-id="' + esc(v.id) + '">Đăng bài</button>');
      return '<tr><td>' + esc(contentTitle(v.contentItemId)) + '</td><td>' + esc(v.channelLabel || v.platform) + '</td><td>' + esc(v.caption || '') + '</td><td>' + esc(D.formatDateTimeVN(v.scheduledAt)) + '</td><td>' + statusBadge(v.editorialStatus, v.editorialStatus) + '</td><td>' + pub + '</td></tr>';
    }).join('') + '</table>';
    html += '<h2>Kanban theo trạng thái biên tập</h2><div class="kanban">';
    ['draft', 'in_review', 'approved', 'scheduled'].forEach(function (st) {
      var col = variants.filter(function (v) { return v.editorialStatus === st; });
      html += '<div class="kanban-col"><strong>' + esc(st) + ' (' + col.length + ')</strong>' + col.map(function (v) {
        return '<div class="card"><strong>' + esc(contentTitle(v.contentItemId)) + '</strong><br><span class="sub">' + esc(v.channelLabel || v.platform) + ' · ' + esc(D.formatDateVN(v.scheduledAt)) + '</span></div>';
      }).join('') + '</div>';
    });
    html += '</div>';
    // TikTok: script theo cảnh + form lưu link / nhập số liệu tay
    var tiktok = variants.filter(function (v) { return v.platform === 'tiktok'; });
    html += '<h2>TikTok — nội dung đăng ngoài app</h2>';
    if (!tiktok.length) html += '<div class="state-box">Chưa có variant TikTok.</div>';
    tiktok.forEach(function (v) {
      html += '<div class="panel"><h3>' + esc(contentTitle(v.contentItemId)) + ' — ' + statusBadge('pending', v.externalStatus || 'Chờ đăng ngoài app') + '</h3>' +
        '<p><strong>Hook:</strong> ' + esc(v.hook || '—') + '</p><p><strong>CTA:</strong> ' + esc(v.cta || '—') + '</p>' +
        '<p><strong>Caption TikTok:</strong> ' + esc(v.caption || '') + '</p>' +
        '<h3>Script theo cảnh / shot</h3><table class="scene-table"><tr><th>Shot</th><th>Hình ảnh / động tác</th><th>Lời thoại</th><th>Chữ trên màn hình</th><th>Thời lượng (giây)</th></tr>' +
        (v.scriptScenes || []).map(function (s) { return '<tr><td>' + esc(s.shot) + '</td><td>' + esc(s.visual) + '</td><td>' + esc(s.dialogue) + '</td><td>' + esc(s.onScreenText) + '</td><td>' + esc(s.durationSec) + '</td></tr>'; }).join('') + '</table>' +
        (v.externalUrl ? '<p>Link bài đã đăng: <a href="' + esc(v.externalUrl) + '" target="_blank" rel="noopener">' + esc(v.externalUrl) + '</a></p>' : '') +
        '<form class="inline" data-form="tiktok-link" data-id="' + esc(v.id) + '"><label>Link bài TikTok đã đăng<input type="url" name="externalUrl" required placeholder="https://www.tiktok.com/…"></label><button class="btn" type="submit">Lưu link</button></form>' +
        '<form class="inline" data-form="tiktok-metric" data-id="' + esc(v.id) + '"><label>Chỉ số<input type="text" name="metric" required placeholder="views"></label>' +
        '<label>Giá trị<input type="number" name="value" required></label>' +
        '<label>Nguồn số liệu<input type="text" name="source" required></label>' +
        '<label>Thời điểm quan sát<input type="datetime-local" name="observedAt" required></label>' +
        '<label>Người nhập<input type="text" name="enteredBy" required value="' + esc(memberName(Store.currentUserId)) + '"></label>' +
        '<button class="btn secondary" type="submit">Nhập số liệu tay</button></form>' +
        '<p class="sub">Số liệu nhập tay bắt buộc có nguồn, thời điểm quan sát và người nhập. Không có nút tạo PublishJob cho TikTok.</p></div>';
    });
    return html;
  }

  // ---------- Action Plan & Công việc + Yêu cầu Marketing ----------
  function viewTasks() {
    var tasks = Store.list('tasks');
    var edges = Store.list('dependencies');
    var blockers = Store.list('blockers');
    var html = pageHead('Action Plan & Công việc', 'Một bảng việc dùng chung ID ở mọi màn hình. Việc cha có việc con thì tiến độ chỉ tính ở việc lá.');
    html += '<h2>Danh sách việc</h2>';
    if (!tasks.length) html += '<div class="state-box">Chưa có việc nào.</div>';
    else {
      var roots = tasks.filter(function (t) { return !t.parentId; });
      var childrenOf = function (pid) { return tasks.filter(function (t) { return t.parentId === pid; }); };
      function row(t, depth) {
        var waitingFor = edges.filter(function (e) { return e.successorId === t.id; }).map(function (e) { var x = taskById(e.predecessorId); return x ? x.title : e.predecessorId; });
        var blockingOthers = edges.filter(function (e) { return e.predecessorId === t.id; }).map(function (e) { var x = taskById(e.successorId); return x ? x.title : e.successorId; });
        var myBlockers = blockers.filter(function (b) { return b.taskId === t.id && b.status === 'open'; });
        var opts = ['todo', 'in_progress', 'completed', 'cancelled'].map(function (s) { return '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('');
        return '<tr><td>' + esc(t.id) + '</td><td style="padding-left:' + (10 + depth * 22) + 'px">' + (depth ? '↳ ' : '') + esc(t.title) + (myBlockers.length ? '<br><span class="badge bad">Blocker: ' + esc(myBlockers[0].title) + '</span>' : '') + '</td>' +
          '<td>' + esc(memberName(t.assigneeId)) + '</td><td>' + esc(campaignName(t.campaignId)) + '</td>' +
          '<td>' + (t.startDate ? esc(D.formatDateVN(t.startDate)) : '—') + ' → ' + (t.dueDate ? esc(D.formatDateVN(t.dueDate)) : 'Chưa xếp lịch') + '</td>' +
          '<td>' + (t.effortHours ? esc(t.effortHours) + ' giờ' : '<span class="badge warn">Chưa ước tính</span>') + '</td>' +
          '<td>Đang chờ: ' + (waitingFor.length ? esc(waitingFor.join(', ')) : '—') + '<br>Các việc đang chờ mình: ' + (blockingOthers.length ? esc(blockingOthers.join(', ')) : '—') + '<br>' + readinessBadge(t) + '</td>' +
          '<td><select data-action-change="task-status" data-id="' + esc(t.id) + '">' + opts + '</select></td></tr>' +
          childrenOf(t.id).map(function (ch) { return row(ch, depth + 1); }).join('');
      }
      html += '<table><tr><th>ID</th><th>Việc</th><th>Người phụ trách</th><th>Campaign</th><th>Thời gian</th><th>Thời gian dự kiến</th><th>Thứ tự thực hiện / Việc đang chờ</th><th>Trạng thái</th></tr>' +
        roots.map(function (t) { return row(t, 0); }).join('') + '</table>';
    }
    html += '<h2>Thêm việc</h2><form class="inline" id="task-add-form">' +
      '<label>Tiêu đề<input type="text" name="title" required></label>' +
      '<label>Campaign<select name="campaignId">' + Store.list('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Việc cha<select name="parentId"><option value="">— Không có —</option>' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Người phụ trách<select name="assigneeId">' + Store.list('members').map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Ngày bắt đầu<input type="date" name="startDate"></label><label>Mốc cần hoàn thành<input type="date" name="dueDate"></label>' +
      '<label>Thời gian dự kiến (giờ)<input type="number" name="effortHours" min="0" step="0.5"></label>' +
      '<label>Đầu ra cần bàn giao<input type="text" name="deliverable"></label>' +
      '<button class="btn" type="submit">Thêm việc</button></form>';
    html += '<h2>Thêm quan hệ phụ thuộc</h2><form class="inline" id="dep-add-form">' +
      '<label>Việc phải xong trước<select name="predecessorId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Việc đang chờ<select name="successorId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn secondary" type="submit">Thêm phụ thuộc</button></form>' +
      '<p class="sub">Hệ thống chặn quan hệ tạo vòng phụ thuộc.</p>';
    html += '<h2>Blocker</h2>';
    if (!blockers.length) html += '<p class="sub">Chưa có blocker nào.</p>';
    else html += '<table><tr><th>Blocker</th><th>Việc</th><th>Mô tả</th><th>Trạng thái</th><th></th></tr>' + blockers.map(function (b) {
      var t = taskById(b.taskId);
      return '<tr><td>' + esc(b.title) + '</td><td>' + esc(t ? t.title : b.taskId) + '</td><td>' + esc(b.description || '') + '</td><td>' + esc(b.status) + '</td><td>' + (b.status === 'open' ? '<button class="btn small secondary" data-action="resolve-blocker" data-id="' + esc(b.id) + '">Đánh dấu đã gỡ</button>' : '') + '</td></tr>';
    }).join('') + '</table>';
    html += '<form class="inline" id="blocker-add-form"><label>Việc<select name="taskId">' + tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>' +
      '<label>Tên blocker<input type="text" name="title" required></label><label>Mô tả<input type="text" name="description"></label>' +
      '<button class="btn" type="submit">Tạo blocker</button></form>';
    // Yêu cầu Marketing — nằm trong view này
    var reqs = Store.list('marketingRequests');
    html += '<h2>Yêu cầu Marketing</h2>';
    if (!reqs.length) html += '<div class="state-box">Chưa có yêu cầu nào được ghi nhận.</div>';
    else html += '<table><tr><th>Yêu cầu</th><th>Người yêu cầu</th><th>Campaign liên quan</th><th>Ưu tiên</th><th>Hạn mong muốn</th><th>Trạng thái</th></tr>' + reqs.map(function (r) {
      return '<tr><td><strong>' + esc(r.title) + '</strong>' + (r.note ? '<br><span class="sub">' + esc(r.note) + '</span>' : '') + '</td><td>' + esc(r.requester) + '</td><td>' + (r.campaignId ? esc(campaignName(r.campaignId)) : '—') + '</td><td>' + esc(r.priority || '—') + '</td><td>' + (r.dueDate ? esc(D.formatDateVN(r.dueDate)) : '—') + '</td><td>' + statusBadge(r.status, r.statusLabel || r.status) + '</td></tr>';
    }).join('') + '</table>';
    html += '<form class="inline" id="request-add-form"><label>Tiêu đề yêu cầu<input type="text" name="title" required></label>' +
      '<label>Người / đội yêu cầu<input type="text" name="requester" required></label>' +
      '<label>Campaign<select name="campaignId"><option value="">— Chưa gắn —</option>' + Store.list('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Ưu tiên<select name="priority"><option>Thấp</option><option selected>Trung bình</option><option>Cao</option></select></label>' +
      '<label>Hạn mong muốn<input type="date" name="dueDate"></label>' +
      '<button class="btn" type="submit">Ghi nhận yêu cầu</button></form>';
    return html;
  }

  // ---------- Duyệt nội dung ----------
  function viewApprovals() {
    var approvals = Store.list('approvals');
    var pending = approvals.filter(function (a) { return a.status === 'pending' || a.status === 'needs_reapproval'; });
    var done = approvals.filter(function (a) { return a.status !== 'pending' && a.status !== 'needs_reapproval'; });
    var canApprove = Store.can('approve');
    var html = pageHead('Duyệt nội dung', 'Inbox duyệt nội dung. Mỗi quyết định gắn với đúng phiên bản (revision) của variant.');
    if (!canApprove) html += '<div class="notice warn">Vai trò hiện tại (' + esc(Store.currentRole()) + ') không có quyền duyệt — các nút quyết định bị khóa. Hãy đổi sang Owner/Lead ở cột trái (demo) để thử duyệt.</div>';
    html += '<h2>Chờ duyệt (' + pending.length + ')</h2>';
    if (!pending.length) html += '<div class="state-box">Không có nội dung nào chờ duyệt.</div>';
    pending.forEach(function (a) {
      var v = variantOf(a.variantId);
      html += '<div class="panel"><strong>' + esc(contentTitle(a.contentItemId)) + '</strong> — ' + esc(v ? (v.channelLabel || v.platform) : '') + ' · revision ' + esc(a.revision) + ' · yêu cầu bởi ' + esc(memberName(a.requestedBy)) + ' lúc ' + esc(D.formatDateTimeVN(a.requestedAt)) +
        (v ? '<p><strong>Caption:</strong> ' + esc(v.caption || '') + '</p>' : '') +
        (v && v.platform === 'tiktok' ? '<p class="sub">Variant TikTok: duyệt nội dung/script trong app, đăng ngoài app.</p>' : '') +
        '<p><button class="btn" data-action="approve" data-id="' + esc(a.id) + '"' + (canApprove ? '' : ' disabled') + '>Chấp thuận</button> ' +
        '<button class="btn secondary" data-action="request-changes" data-id="' + esc(a.id) + '"' + (canApprove ? '' : ' disabled') + '>Yêu cầu chỉnh sửa</button> ' +
        '<button class="btn secondary" data-action="reject" data-id="' + esc(a.id) + '"' + (canApprove ? '' : ' disabled') + '>Từ chối</button></p></div>';
    });
    html += '<h2>Đã quyết định (' + done.length + ')</h2>';
    if (!done.length) html += '<p class="sub">Chưa có quyết định nào.</p>';
    else html += '<table><tr><th>Nội dung</th><th>Revision</th><th>Quyết định</th><th>Người duyệt</th><th>Ghi chú</th></tr>' + done.map(function (a) {
      return '<tr><td>' + esc(contentTitle(a.contentItemId)) + ' (' + esc(a.variantId) + ')</td><td>' + esc(a.revision) + '</td><td>' + statusBadge(a.status, a.statusLabel || a.status) + '</td><td>' + esc(memberName(a.decidedBy)) + '</td><td>' + esc(a.note || '') + '</td></tr>';
    }).join('') + '</table>';
    html += '<h2>Sửa caption variant (kiểm tra quy tắc duyệt lại)</h2><form class="inline" id="variant-caption-form">' +
      '<label>Variant<select name="variantId">' + Store.list('variants').map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.channelLabel || v.platform) + ' — ' + esc(contentTitle(v.contentItemId)) + ' (' + esc(v.approvalStatus || '') + ')</option>'; }).join('') + '</select></label>' +
      '<label>Caption mới<input type="text" name="caption" required size="42"></label>' +
      '<button class="btn secondary" type="submit">Lưu caption</button></form>' +
      '<p class="sub">Nếu variant đã được Chấp thuận mà caption thay đổi, Store tự hạ approval về "Cần duyệt lại" và tạm dừng job đăng liên quan.</p>';
    return html;
  }

  // ---------- Team & Workload ----------
  function viewTeam() {
    var members = Store.list('members');
    var tasks = Store.list('tasks');
    var holidays = Store.holidays || [];
    var html = pageHead('Team & Workload', 'Tải công việc theo người: effort được phân bổ theo ngày làm việc (bỏ thứ Bảy, Chủ nhật và ngày nghỉ ' + (holidays.length ? holidays.map(function (h) { return D.formatDateVN(h); }).join(', ') : '—') + ').');
    html += '<table><tr><th>Thành viên</th><th>Vai trò</th><th>Thời gian có thể nhận việc (giờ/tuần)</th><th>Ngày nghỉ đã khai</th><th>Effort đã phân bổ (kỳ đang xét)</th><th>Cảnh báo</th></tr>';
    members.forEach(function (m) {
      var mine = tasks.filter(function (t) { return t.assigneeId === m.id && t.status !== 'cancelled' && t.status !== 'completed'; });
      var unestimated = mine.filter(function (t) { return D.distributeEffort(t, holidays).unestimated; });
      var perDay = {};
      mine.forEach(function (t) {
        var dist = D.distributeEffort(t, holidays.concat(m.daysOff || []));
        if (Array.isArray(dist)) dist.forEach(function (d) { perDay[d.date] = (perDay[d.date] || 0) + d.hours; });
      });
      var total = Object.keys(perDay).reduce(function (s, k) { return s + perDay[k]; }, 0);
      var cap = m.capacityHoursPerWeek || 0;
      var warn = [];
      if (cap > 0 && total > cap) warn.push('Tổng effort ' + fmtNum(total) + ' giờ vượt capacity ' + cap + ' giờ/tuần trong kỳ đang xét');
      Object.keys(perDay).forEach(function (date) { if (perDay[date] > 8) warn.push('Ngày ' + D.formatDateVN(date) + ': ' + fmtNum(perDay[date]) + ' giờ (quá 8 giờ/ngày)'); });
      html += '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.roleLabel || m.role) + '</td><td>' + (cap ? esc(cap) + ' giờ/tuần' : '—') + '</td>' +
        '<td>' + ((m.daysOff || []).length ? m.daysOff.map(function (x) { return D.formatDateVN(x); }).join(', ') : '—') + '</td>' +
        '<td>' + fmtNum(total) + ' giờ' + (unestimated.length ? '<br>' + unestimated.map(function (t) { return '<span class="badge warn">' + esc(t.title) + ': Chưa ước tính</span>'; }).join(' ') : '') + '<br><span class="sub">' +
        Object.keys(perDay).sort().slice(0, 10).map(function (date) { return D.formatDateVN(date) + ': ' + fmtNum(perDay[date]) + 'h'; }).join(' · ') + '</span></td>' +
        '<td>' + (warn.length ? warn.map(function (w) { return '<span class="badge bad">' + esc(w) + '</span>'; }).join(' ') : '<span class="badge ok">Ổn</span>') + '</td></tr>';
    });
    html += '</table><p class="sub">Việc thiếu effort hiển thị "Chưa ước tính" và không được tính vào effort đã phân bổ.</p>';
    return html;
  }

  // ---------- KPI & Ngân sách ----------
  function viewKpi() {
    var html = pageHead('KPI & Ngân sách', 'KPI theo mục tiêu/thực đạt/nguồn/thời điểm; ngân sách theo Planned / Approved / Committed / Actual / Remaining.');
    html += '<h2>KPI</h2>';
    var kpis = Store.list('kpis');
    if (!kpis.length) html += '<div class="state-box">Chưa có KPI nào.</div>';
    else html += '<table><tr><th>KPI</th><th>Campaign</th><th>Mục tiêu</th><th>Thực đạt</th><th>Nguồn số liệu</th><th>Thời điểm cập nhật</th></tr>' + kpis.map(function (k) {
      var d = D.kpiDisplay(k);
      return '<tr><td><strong>' + esc(k.name) + '</strong></td><td>' + esc(campaignName(k.campaignId)) + '</td><td>' + fmtNum(k.target) + ' ' + esc(k.unit || '') + '</td><td>' + (d.isMissing ? '<span class="badge warn">Chưa cập nhật</span>' : fmtNum(d.value) + ' ' + esc(k.unit || '')) + '</td><td>' + esc(k.source || '—') + '</td><td>' + (k.updatedAt ? esc(D.formatDateTimeVN(k.updatedAt)) : '—') + '</td></tr>';
    }).join('') + '</table>';
    html += '<h2>Ngân sách theo từng tiền tệ (không cộng khác tiền tệ)</h2>';
    var currencies = [];
    Store.list('budgetLines').forEach(function (b) { if (currencies.indexOf(b.currency) === -1) currencies.push(b.currency); });
    currencies.forEach(function (cur) {
      var lines = Store.list('budgetLines').filter(function (b) { return b.currency === cur; });
      html += '<h3>Tiền tệ: ' + esc(cur) + '</h3><table><tr><th>Dòng ngân sách</th><th>Campaign</th><th>Planned</th><th>Approved</th><th>Committed (còn mở)</th><th>Actual</th><th>Remaining</th><th>Cảnh báo</th></tr>';
      lines.forEach(function (b) {
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
        html += '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc(campaignName(b.campaignId)) + '</td><td>' + fmtMoney(b.planned, cur) + '</td><td>' + fmtMoney(b.approved, cur) + '</td><td>' + fmtMoney(openCommit, cur) + '</td><td>' + fmtMoney(actualTotal, cur) + '</td><td>' + fmtMoney(rem, cur) + '</td><td>' + (rem < 0 ? '<span class="badge bad">Vượt ngân sách ' + fmtMoney(-rem, cur) + '</span>' : '<span class="badge ok">Trong ngân sách</span>') + '</td></tr>';
      });
      html += '</table>';
    });
    html += '<p class="sub">Cam kết đã có khoản chi thực tế liên kết thì phần đã thanh toán chỉ tính một lần ở Actual, không trừ trùng ở Committed.</p>';
    return html;
  }

  // ---------- Kênh & Bài đã đăng ----------
  function viewChannels() {
    var accounts = Store.list('channelAccounts');
    var html = pageHead('Kênh & Bài đã đăng', 'Trạng thái kết nối theo từng khả năng riêng và thư viện bài đã đăng ngoài app.');
    html += '<h2>Kết nối kênh</h2><table><tr><th>Kênh</th><th>Tài khoản</th><th>Trạng thái chung</th><th>Đọc bài</th><th>Đọc số liệu</th><th>Đăng bài</th><th>Quảng cáo</th></tr>' +
      accounts.map(function (a) {
        var cap = a.capabilities || {};
        function cb(v) { return v === 'Đã kết nối' ? '<span class="badge ok">' + esc(v) + '</span>' : '<span class="badge warn">' + esc(v || 'Chờ kết nối') + '</span>'; }
        return '<tr><td>' + esc(a.platform) + '</td><td>' + esc(a.name) + '</td><td>' + cb(a.status) + '</td><td>' + cb(cap.readPosts) + '</td><td>' + cb(cap.readMetrics) + '</td><td>' + cb(cap.publish) + '</td><td>' + cb(cap.ads) + '</td></tr>';
      }).join('') + '</table>';
    var posts = Store.list('externalPosts');
    var filtered = posts.filter(function (p) { return UI.channelFilter === 'all' || p.platform === UI.channelFilter; });
    html += '<h2>Thư viện bài đã đăng (ExternalPost)</h2>' +
      '<form class="inline" id="channel-filter-form"><label>Lọc theo kênh<select id="channel-filter"><option value="all">Tất cả kênh</option>' +
      ['facebook', 'instagram', 'tiktok', 'youtube'].map(function (p) { return '<option value="' + p + '"' + (UI.channelFilter === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
      '</select></label><button class="btn secondary" type="submit">Lọc</button></form>';
    if (!filtered.length) html += '<div class="state-box">Chưa có bài đã đăng nào ở kênh đã lọc.</div>';
    else html += '<table><tr><th>Bài</th><th>Kênh</th><th>Mã bài ngoài (externalPostId)</th><th>Ngày đăng</th><th>Campaign đã gắn</th><th>Gắn campaign</th></tr>' + filtered.map(function (p) {
      return '<tr><td><a href="' + esc(p.url || '#') + '" target="_blank" rel="noopener">' + esc(p.title) + '</a></td><td>' + esc(p.platform) + '</td><td><code>' + esc(p.externalPostId) + '</code></td><td>' + esc(D.formatDateTimeVN(p.publishedAt)) + '</td><td>' + (p.campaignId ? esc(campaignName(p.campaignId)) : '<span class="badge warn">Chưa gắn</span>') + '</td>' +
        '<td><form class="inline" data-form="attach-campaign" data-id="' + esc(p.id) + '" style="margin:0"><select name="campaignId">' + Store.list('campaigns').map(function (c) { return '<option value="' + esc(c.id) + '"' + (p.campaignId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select><button class="btn small" type="submit">Gắn</button></form></td></tr>';
    }).join('') + '</table>';
    html += '<p class="sub">Store chống trùng bài đã đăng theo bộ ba (platform, tài khoản, externalPostId) — thêm trùng sẽ bị từ chối kèm thông báo.</p>';
    html += '<h2>Thêm bài đã đăng (ghi nhận tay)</h2><form class="inline" id="post-add-form">' +
      '<label>Kênh<select name="platform"><option>facebook</option><option>instagram</option><option>tiktok</option><option>youtube</option></select></label>' +
      '<label>Tài khoản<select name="channelAccountId">' + accounts.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>externalPostId<input type="text" name="externalPostId" required></label>' +
      '<label>Tiêu đề<input type="text" name="title" required></label><label>Link<input type="url" name="url"></label>' +
      '<button class="btn" type="submit">Thêm bài</button></form>';
    return html;
  }

  // ---------- Quảng cáo ----------
  function ratesCells(r) {
    return '<td>' + fmtMoney(r.spend, 'VND') + '</td><td>' + fmtNum(r.impressions) + '</td><td>' + fmtNum(r.clicks) + '</td><td>' + fmtNum(r.results) + '</td>';
  }
  function viewAds() {
    var html = pageHead('Quảng cáo', 'Số liệu quảng cáo chỉ đọc. "Chiến dịch quảng cáo" ở đây khác với IMC Campaign ở mục IMC & Campaigns.');
    var isCeo = Store.currentRole() === 'ceo';
    var canDraft = Store.can('adsDraft');
    var canApproveAds = Store.can('adsApprove');
    if (isCeo) html += '<div class="notice info">CEO chỉ xem: mọi thao tác tạo nháp/gửi duyệt/duyệt thay đổi quảng cáo đều bị ẩn và bị Store chặn.</div>';
    Store.list('adAccounts').forEach(function (acc) {
      html += '<div class="panel"><h3>' + esc(acc.name) + ' — ' + esc(acc.platform) + ' <span class="badge warn">' + esc(acc.status) + '</span></h3>';
      Store.list('adCampaigns').filter(function (x) { return x.adAccountId === acc.id; }).forEach(function (ac) {
        html += '<p><strong>Chiến dịch quảng cáo:</strong> ' + esc(ac.name) + ' — ' + esc(ac.statusLabel || ac.status) + '</p>';
        html += '<table><tr><th>Cấp</th><th>Tên</th><th>Trạng thái</th><th>Chi tiêu</th><th>Hiển thị</th><th>Nhấp</th><th>Kết quả</th></tr>';
        html += '<tr><td>campaign</td><td>' + esc(ac.name) + '</td><td>' + esc(ac.statusLabel || ac.status) + '</td>' + ratesCells(ac) + '</tr>';
        Store.list('adSets').filter(function (x) { return x.adCampaignId === ac.id; }).forEach(function (as) {
          html += '<tr><td>adset</td><td>↳ ' + esc(as.name) + '</td><td>' + esc(as.statusLabel || as.status) + '</td>' + ratesCells(as) + '</tr>';
          Store.list('ads').filter(function (x) { return x.adSetId === as.id; }).forEach(function (ad) {
            html += '<tr><td>ad</td><td>↳↳ ' + esc(ad.name) + '</td><td>' + esc(ad.statusLabel || ad.status) + '</td>' + ratesCells(ad) + '</tr>';
          });
        });
        html += '</table><p class="sub">Tổng chỉ cộng ở một cấp duy nhất để không tính trùng giữa campaign / ad set / ad.</p>';
      });
      html += '</div>';
    });
    var reqs = Store.list('adChangeRequests');
    html += '<h2>Yêu cầu thay đổi quảng cáo (change request)</h2>';
    html += '<p class="sub">Quy trình: tạo nháp → gửi duyệt → duyệt. Trạng thái mặc định của đối tượng quảng cáo sau thay đổi: <strong>Tạm dừng (paused)</strong>.</p>';
    if (!reqs.length) html += '<div class="state-box">Chưa có yêu cầu thay đổi nào.</div>';
    else html += '<table><tr><th>Yêu cầu</th><th>Đối tượng</th><th>Trạng thái</th><th>Người tạo</th><th>Thao tác</th></tr>' + reqs.map(function (r) {
      var actions = '';
      if (!isCeo && r.status === 'draft' && canDraft) actions += '<button class="btn small" data-action="adcr-submit" data-id="' + esc(r.id) + '">Gửi duyệt</button> ';
      if (!isCeo && r.status === 'pending_approval') actions = canApproveAds ? '<button class="btn small" data-action="adcr-approve" data-id="' + esc(r.id) + '">Duyệt</button>' : '<span class="sub">Chờ người có quyền duyệt quảng cáo</span>';
      if (isCeo) actions = '<span class="sub">Chỉ xem</span>';
      return '<tr><td>' + esc(r.title) + '</td><td>' + esc(r.target) + '</td><td>' + statusBadge(r.status, r.statusLabel || r.status) + '</td><td>' + esc(memberName(r.requestedBy)) + '</td><td>' + actions + '</td></tr>';
    }).join('') + '</table>';
    if (!isCeo && canDraft) {
      html += '<form class="inline" id="adcr-add-form"><label>Tiêu đề yêu cầu<input type="text" name="title" required size="38"></label><label>Đối tượng<input type="text" name="target" required></label><button class="btn" type="submit">Tạo nháp</button></form>';
    }
    return html;
  }

  // ---------- Dashboard & Báo cáo ----------
  function viewReports() {
    var obs = Store.list('metricObservations');
    var adRows = []
      .concat(Store.list('adCampaigns').map(function (x) { return Object.assign({ level: 'campaign' }, x); }))
      .concat(Store.list('adSets').map(function (x) { return Object.assign({ level: 'adset' }, x); }))
      .concat(Store.list('ads').map(function (x) { return Object.assign({ level: 'ad' }, x); }));
    var levelRows = adRows.filter(function (r) { return r.level === UI.adsLevel; });
    var agg = D.aggregateRates(levelRows);
    var lifetimeObs = obs.filter(function (o) { return o.metric === 'lifetime_views'; });
    var lifetime = D.latestLifetimeSnapshot(lifetimeObs);
    var reachGuard = D.sumUniqueReachGuard(obs.filter(function (o) { return o.metric === 'reach'; }));
    UI.reportRowsCache = levelRows;
    var missing = Store.list('kpis').some(function (k) { return D.kpiDisplay(k).isMissing; });
    var html = pageHead('Dashboard & Báo cáo', 'Mỗi widget ghi rõ đơn vị, kỳ, nguồn và thời điểm đồng bộ; tỷ lệ được tính lại từ tổng tử số / tổng mẫu số.');
    html += '<div class="cards">' +
      '<div class="card"><div class="big">' + (agg.ctr === null ? '—' : (agg.ctr * 100).toFixed(2) + '%') + '</div>CTR (cấp: ' + esc(UI.adsLevel) + ')<br><span class="sub">Đơn vị: % · Kỳ: toàn bộ dữ liệu hiện có · Nguồn: số liệu quảng cáo chỉ đọc (minh họa) · Đồng bộ: chưa kết nối kênh</span></div>' +
      '<div class="card"><div class="big">' + (agg.cpc === null ? '—' : fmtNum(Math.round(agg.cpc))) + '</div>CPC (VND)<br><span class="sub">Đơn vị: VND/nhấp · Tính từ tổng chi tiêu / tổng nhấp ở một cấp duy nhất</span></div>' +
      '<div class="card"><div class="big">' + (agg.roas === null ? '—' : agg.roas.toFixed(2)) + '</div>ROAS<br><span class="sub">Đơn vị: lần · Giá trị chuyển đổi / chi tiêu</span></div>' +
      '<div class="card"><div class="big">' + (lifetime === null ? '—' : fmtNum(lifetime)) + '</div>Lượt xem trọn đời (lifetime) — snapshot mới nhất<br><span class="sub">Đơn vị: lượt · Không cộng dồn các lần quan sát (100 → 150 → 200, lấy 200) · Nguồn: nhập tay minh họa</span></div></div>';
    html += '<form class="inline" id="report-level-form"><label>Cấp số liệu quảng cáo để tổng hợp<select id="report-level">' +
      ['account', 'campaign', 'adset', 'ad'].map(function (lv) { return '<option value="' + lv + '"' + (UI.adsLevel === lv ? ' selected' : '') + '>' + lv + '</option>'; }).join('') +
      '</select></label><button class="btn secondary" type="submit">Áp dụng</button> ' +
      '<button class="btn" type="button" data-action="export-csv">Xuất CSV dữ liệu đang lọc</button></form>';
    if (!reachGuard.summable) html += '<div class="notice warn"><strong>Reach không cộng dồn:</strong> ' + esc(reachGuard.reason) + '</div>';
    if (missing) html += '<div class="notice warn">Trạng thái thiếu dữ liệu: có KPI chưa có giá trị thực đạt — hiển thị "Chưa cập nhật", không thay bằng 0.</div>';
    html += '<h2>Báo cáo đã chốt (snapshot)</h2>';
    var snaps = Store.list('reportSnapshots');
    if (!snaps.length) html += '<div class="state-box">Chưa có báo cáo nào được chốt.</div>';
    snaps.forEach(function (s) {
      html += '<div class="panel"><strong>' + esc(s.title) + '</strong> <span class="badge ok">' + esc(s.status) + '</span>' +
        '<p class="sub">Chốt lúc ' + esc(D.formatDateTimeVN(s.frozenAt)) + ' · Chi tiêu: ' + fmtMoney(s.metrics.spend, 'VND') + ' · Hiển thị: ' + fmtNum(s.metrics.impressions) + ' · Nhấp: ' + fmtNum(s.metrics.clicks) + '</p>' +
        '<p>' + esc(s.summary) + '</p><p class="sub">Snapshot đã chốt hiển thị đóng băng — không có nút sửa.</p></div>';
    });
    return html;
  }

  // ---------- Thiết lập ----------
  function viewSettings() {
    var configured = Store.mode === 'supabase';
    var html = pageHead('Thiết lập', 'Kết nối dữ liệu, chế độ dữ liệu minh họa, thành viên & vai trò, cấu hình BU/sản phẩm và kết nối kênh.');
    html += '<h2>Trạng thái kết nối Supabase</h2><div class="panel">';
    if (configured) {
      var me = Store.currentUser();
      if (me && Store.supabaseUser) html += '<p><span class="badge ok">Đã đăng nhập</span> ' + esc(me.name) + ' (' + esc(me.email || '') + ') — vai trò: ' + esc(me.roleLabel || me.role) + '.</p>' +
        '<p><button class="btn secondary" data-action="sign-out">Đăng xuất</button></p>';
      else html += '<p><span class="badge ok">Đã cấu hình</span> config.js có URL và anon key hợp lệ. Đăng nhập bằng email/mật khẩu qua Supabase Auth.</p>' +
        '<form class="inline" id="signin-form"><label>Email<input type="email" name="email" required></label><label>Mật khẩu<input type="password" name="password" required></label><button class="btn" type="submit">Đăng nhập</button></form>';
    }
    else html += '<p><span class="badge warn">Chờ kết nối Supabase</span></p><p>Hướng dẫn 3 bước:</p><ol>' +
      '<li>Tạo một Supabase project riêng cho Marketing Workspace.</li>' +
      '<li>Chạy các migration trong thư mục <code>supabase/</code> theo tài liệu thiết lập đi kèm repo.</li>' +
      '<li>Điền <code>supabaseUrl</code> và <code>supabaseAnonKey</code> (khóa công khai, không phải service_role) vào file <code>config.js</code> — xem mẫu ở <code>config.example.js</code> — rồi tải lại trang.</li></ol>';
    html += '</div>';
    html += '<h2>Chế độ dữ liệu minh họa (demo)</h2><div class="panel">' +
      '<p>Trạng thái hiện tại: <strong>' + (Store.mode === 'demo' ? 'Đang bật — mọi màn hình đều có banner "Dữ liệu minh họa — không phải dữ liệu thật"' : 'Đang tắt') + '</strong>.</p>' +
      '<p class="sub">Cảnh báo: dữ liệu demo là dữ liệu minh họa tách biệt hoàn toàn với dữ liệu thật. Tài khoản demo không có quyền đăng bài thật — nút Đăng bài bị khóa kèm giải thích. Có thể mở nhanh bằng tham số <code>?demo=1</code> trên địa chỉ trang.</p>' +
      (Store.mode === 'demo'
        ? '<button class="btn" data-action="demo-off">Tắt chế độ demo</button> <button class="btn secondary" data-action="demo-reset">Đặt lại dữ liệu demo</button>'
        : '<button class="btn" data-action="demo-on">Bật chế độ demo</button>') + '</div>';
    html += '<h2>Thành viên & vai trò</h2>';
    var members = Store.list('members');
    if (!members.length) html += '<div class="state-box">Chưa có thành viên (chưa kết nối dữ liệu).</div>';
    else html += '<table><tr><th>Thành viên</th><th>Email</th><th>Vai trò</th></tr>' + members.map(function (m) {
      return '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.email) + '</td><td>' + esc(m.roleLabel || m.role) + '</td></tr>';
    }).join('') + '</table>';
    html += '<h3>Ma trận quyền (4 vai × quyền tách riêng)</h3>';
    var permKeys = Object.keys(Store.PERMISSION_LABELS);
    html += '<table><tr><th>Quyền</th><th>Owner</th><th>Lead</th><th>Member</th><th>CEO</th></tr>' + permKeys.map(function (k) {
      function cell(role) { return Store.canRole(role, k) ? '✓' : '—'; }
      return '<tr><td>' + esc(Store.PERMISSION_LABELS[k]) + ' (<code>' + esc(k) + '</code>)</td><td>' + cell('owner') + '</td><td>' + cell('lead') + '</td><td>' + cell('member') + '</td><td>' + cell('ceo') + '</td></tr>';
    }).join('') + '</table>';
    html += '<h2>BU / sản phẩm</h2>' + (Store.list('businessUnits').length
      ? '<ul class="clean">' + Store.list('businessUnits').map(function (b) { return '<li><strong>' + esc(b.name) + '</strong>: ' + esc((b.products || []).join(', ')) + '</li>'; }).join('') + '</ul>'
      : '<div class="state-box">Chưa cấu hình BU/sản phẩm.</div>');
    html += '<h2>Danh sách kết nối kênh</h2>' + (Store.list('channelAccounts').length
      ? '<ul class="clean">' + Store.list('channelAccounts').map(function (a) { return '<li>' + esc(a.name) + ' (' + esc(a.platform) + ') — ' + esc(a.status) + '</li>'; }).join('') + '</ul>'
      : '<div class="state-box">Chưa có kết nối kênh nào.</div>');
    return html;
  }

  // ---------- Router / khởi tạo ----------
  var VIEWS = {
    'overview': viewOverview, 'my-work': viewMyWork, 'brand': viewBrand, 'campaigns': viewCampaigns,
    'calendar': viewCalendar, 'tasks': viewTasks, 'approvals': viewApprovals, 'team': viewTeam,
    'kpi': viewKpi, 'channels': viewChannels, 'ads': viewAds, 'reports': viewReports, 'settings': viewSettings
  };
  function currentRoute() {
    var h = (window.location.hash || '#/overview').replace(/^#\/?/, '');
    return VIEWS[h] ? h : 'overview';
  }
  function authGateView() {
    if (Store.pendingInvite && Store.pendingInvite.expired) return viewInviteExpired();
    if (Store.pendingInvite) return viewSetPassword();
    if (Store.state.noMembership) return viewNoMembership();
    if (Store.state.authRequired) return viewLogin();
    return null;
  }
  function renderNav() {
    var route = currentRoute();
    document.getElementById('main-nav').innerHTML = NAV.map(function (n) {
      return '<a href="#/' + n[0] + '"' + (route === n[0] ? ' class="active"' : '') + '>' + esc(n[1]) + '</a>';
    }).join('');
    var sel = document.getElementById('current-user-select');
    var members = Store.list('members');
    sel.innerHTML = members.length ? members.map(function (m) {
      return '<option value="' + esc(m.id) + '"' + (Store.currentUserId === m.id ? ' selected' : '') + '>' + esc(m.name) + ' (' + esc(m.roleLabel || m.role) + ')</option>';
    }).join('') : '<option>— Chưa có người dùng —</option>';
    sel.disabled = Store.mode === 'supabase';
    document.getElementById('connection-status').textContent =
      Store.mode === 'demo' ? 'Chế độ: Dữ liệu minh họa (demo)' : (Store.mode === 'supabase' ? 'Chế độ: Supabase' : 'Chờ kết nối Supabase');
  }
  function render() {
    demoBanner();
    renderNav();
    var route = currentRoute();
    var app = document.getElementById('app');
    var gate = authGateView();
    if (gate) { app.innerHTML = gate; return; }
    if (Store.setupNeeded && route !== 'settings') { app.innerHTML = setupNotice(); return; }
    try { app.innerHTML = VIEWS[route](); }
    catch (e) { app.innerHTML = '<div class="notice bad">Đã xảy ra lỗi khi hiển thị: ' + esc(e.message) + '</div>'; }
  }

  function exportCsv() {
    var rows = UI.reportRowsCache || [];
    var head = 'level,name,status,spend,impressions,clicks,results,conversionValue';
    var lines = rows.map(function (r) {
      return [r.level, '"' + String(r.name || '').replace(/"/g, '""') + '"', r.status, r.spend || 0, r.impressions || 0, r.clicks || 0, r.results || 0, r.conversionValue || 0].join(',');
    });
    var blob = new Blob(['\ufeff' + head + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sava-bao-cao-' + UI.adsLevel + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    var id = t.getAttribute('data-id');
    if (action === 'select-campaign') { UI.selectedCampaignId = id; UI.pendingDatePreview = null; render(); }
    if (action === 'cancel-date-change') { UI.pendingDatePreview = null; render(); }
    if (action === 'apply-date-change' && UI.pendingDatePreview) {
      var p = UI.pendingDatePreview;
      UI.pendingDatePreview = null;
      settle(Store.update('tasks', p.taskId, { startDate: p.newStart, dueDate: p.newDue }), function () {
        toast('Đã áp dụng đổi lịch cho việc gốc. Lịch của việc phụ thuộc không bị tự dịch — hãy kiểm tra danh sách ảnh hưởng vừa xem trước.');
        render();
      });
    }
    if (action === 'publish-variant') {
      settle(Store.createPublishJob(id), function () { toast('Đã tạo job đăng bài.'); render(); });
    }
    if (action === 'approve' || action === 'request-changes' || action === 'reject') {
      var decision = action === 'approve' ? 'approved' : (action === 'request-changes' ? 'changes_requested' : 'rejected');
      var note = window.prompt('Ghi chú cho quyết định (có thể để trống):', '') || '';
      settle(Store.decideApproval(id, decision, note), function () {
        toast('Đã ghi quyết định duyệt gắn với revision hiện tại.');
        render();
      });
    }
    if (action === 'resolve-blocker') { settle(Store.update('blockers', id, { status: 'resolved' }), function () { render(); }); }
    if (action === 'adcr-submit') { settle(Store.update('adChangeRequests', id, { status: 'pending_approval', statusLabel: 'Chờ duyệt' }), function () { render(); }); }
    if (action === 'adcr-approve') {
      if (!Store.can('adsApprove')) { toast('Vai trò hiện tại không có quyền duyệt quảng cáo.'); return; }
      settle(Store.update('adChangeRequests', id, { status: 'approved', statusLabel: 'Đã duyệt — đối tượng giữ trạng thái Tạm dừng (paused) cho tới khi áp dụng ngoài app' }), function () { render(); });
    }
    if (action === 'sign-out') {
      settle(Store.signOut(), function () { toast('Đã đăng xuất.'); render(); });
    }
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
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'current-user-select') { Store.setCurrentUser(t.value); render(); return; }
    var kind = t.getAttribute && t.getAttribute('data-action-change');
    if (kind === 'task-status') {
      settle(Store.update('tasks', t.getAttribute('data-id'), { status: t.value }), function () { render(); });
    }
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    ev.preventDefault();
    var fd = new FormData(f);
    function val(n) { return fd.get(n); }
    if (f.id === 'brand-search-form') { UI.brandQuery = String(document.getElementById('brand-query').value || ''); render(); }
    if (f.id === 'cal-nav-form') {
      UI.calendarMonth = Math.min(12, Math.max(1, Number(document.getElementById('cal-month').value) || 1)) - 1;
      UI.calendarYear = Number(document.getElementById('cal-year').value) || 2026;
      render();
    }
    if (f.id === 'task-date-form') {
      var taskId = document.getElementById('date-task-id').value;
      var ns = document.getElementById('date-new-start').value;
      var nd = document.getElementById('date-new-due').value;
      UI.pendingDatePreview = { taskId: taskId, newStart: ns, newDue: nd, impact: D.previewDependencyImpact(taskId, ns, nd, Store.list('tasks'), Store.list('dependencies')) };
      render();
    }
    if (f.id === 'task-add-form') {
      if (!Store.can('edit')) { toast('Vai trò hiện tại không có quyền sửa.'); return; }
      settle(Store.create('tasks', {
        campaignId: val('campaignId'), parentId: val('parentId') || null, title: val('title'),
        assigneeId: val('assigneeId'), ownerId: val('assigneeId'), status: 'todo',
        startDate: val('startDate') || null, dueDate: val('dueDate') || null,
        effortHours: val('effortHours') ? Number(val('effortHours')) : null, deliverable: val('deliverable') || ''
      }), function (r) { toast('Đã thêm việc: ' + r.item.title); render(); });
    }
    if (f.id === 'dep-add-form') {
      var from = val('predecessorId'), to = val('successorId');
      if (D.wouldCreateCycle(Store.list('dependencies'), from, to)) { toast('Không thêm được: quan hệ này tạo vòng phụ thuộc.'); return; }
      settle(Store.create('dependencies', { predecessorId: from, successorId: to }), function () { toast('Đã thêm quan hệ phụ thuộc.'); render(); });
    }
    if (f.id === 'blocker-add-form') {
      settle(Store.create('blockers', { taskId: val('taskId'), title: val('title'), description: val('description') || '', status: 'open', createdBy: Store.currentUserId, createdAt: new Date().toISOString() }),
        function () { toast('Đã tạo blocker.'); render(); });
    }
    if (f.id === 'request-add-form') {
      settle(Store.create('marketingRequests', { title: val('title'), requester: val('requester'), campaignId: val('campaignId') || null, priority: val('priority'), dueDate: val('dueDate') || null, status: 'new', statusLabel: 'Mới ghi nhận', note: '' }),
        function () { toast('Đã ghi nhận yêu cầu Marketing.'); render(); });
    }
    if (f.id === 'variant-caption-form') {
      settle(Store.updateVariant(String(val('variantId')), { caption: String(val('caption')) }), function (rv) {
        toast('Đã lưu caption.' + (rv.note ? ' ' + rv.note : ''));
        render();
      });
    }
    if (f.id === 'channel-filter-form') { UI.channelFilter = document.getElementById('channel-filter').value; render(); }
    if (f.id === 'post-add-form') {
      settle(Store.create('externalPosts', { platform: val('platform'), channelAccountId: val('channelAccountId'), externalPostId: val('externalPostId'), title: val('title'), url: val('url') || '', publishedAt: new Date().toISOString(), campaignId: null }),
        function () { toast('Đã thêm bài đã đăng.'); render(); });
    }
    if (f.id === 'adcr-add-form') {
      if (!Store.can('adsDraft')) { toast('Vai trò hiện tại không có quyền tạo nháp quảng cáo.'); return; }
      settle(Store.create('adChangeRequests', { title: val('title'), target: val('target'), status: 'draft', statusLabel: 'Nháp', requestedBy: Store.currentUserId, defaultState: 'Tạm dừng (paused)', createdAt: new Date().toISOString() }),
        function () { toast('Đã tạo nháp yêu cầu thay đổi (mặc định Tạm dừng (paused)).'); render(); });
    }
    if (f.id === 'report-level-form') { UI.adsLevel = document.getElementById('report-level').value; render(); }
    if (f.id === 'signin-form' || f.id === 'login-form') {
      Store.signIn(String(val('email')), String(val('password')))
        .then(function () { toast('Đăng nhập thành công.'); render(); })
        .catch(function (e) { toast('Đăng nhập thất bại: ' + e.message); });
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
    }
    var formKind = f.getAttribute && f.getAttribute('data-form');
    var fid = f.getAttribute && f.getAttribute('data-id');
    if (formKind === 'attach-campaign') {
      settle(Store.update('externalPosts', fid, { campaignId: val('campaignId') }), function () { toast('Đã gắn campaign cho bài đã đăng.'); render(); });
    }
    if (formKind === 'tiktok-link') {
      settle(Store.update('variants', fid, { externalUrl: String(val('externalUrl')), externalStatus: 'Đã đăng ngoài app' }), function () { toast('Đã lưu link bài TikTok đã đăng ngoài app.'); render(); });
    }
    if (formKind === 'tiktok-metric') {
      var post = Store.list('externalPosts').find(function (p) { return p.platform === 'tiktok'; });
      var metricPayload = {
        externalPostId: post ? post.id : null, variantId: fid,
        metric: String(val('metric')), value: Number(val('value')),
        source: String(val('source')), observedAt: String(val('observedAt')),
        enteredBy: String(val('enteredBy')), enteredByName: String(val('enteredBy'))
      };
      // Đồng thời ghi nhận bản ghi nhập tay có đủ nguồn/thời điểm/người nhập.
      var manualPayload = { variantId: fid, metric: String(val('metric')), value: Number(val('value')), source: String(val('source')), observedAt: String(val('observedAt')), enteredBy: String(val('enteredBy')) };
      if (Store.mode === 'supabase') {
        settle(Store.create('manualMetricEntries', manualPayload), function () { toast('Đã ghi số liệu nhập tay kèm nguồn, thời điểm và người nhập.'); render(); });
      } else {
        var rm = Store.create('metricObservations', metricPayload);
        Store.create('manualMetricEntries', manualPayload);
        toast(rm.ok ? 'Đã ghi số liệu nhập tay kèm nguồn, thời điểm và người nhập.' : rm.error);
        if (rm.ok) render();
      }
    }
  });

  window.addEventListener('hashchange', render);
  Store.subscribe(function () { render(); });
  // Store.load() trả Promise ở chế độ supabase (khôi phục phiên + nạp dữ liệu);
  // demo/setup thì dữ liệu sẵn sàng gần như ngay lập tức.
  var boot = Store.load();
  render();
  if (boot && typeof boot.then === 'function') boot.then(function () { render(); });
})();
