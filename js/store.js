/*
 * js/store.js — Lớp Store trừu tượng của SAVA Marketing Workspace.
 * Ba chế độ:
 *  - supabase: config.js có URL + anon key hợp lệ → tạo client qua CDN supabase-js,
 *    đăng nhập email/mật khẩu, CRUD qua REST của Supabase.
 *  - demo: người dùng chủ động bật ở Thiết lập hoặc mở ?demo=1 → dữ liệu minh họa
 *    từ js/demo-data.js, sửa trong bộ nhớ và lưu ở localStorage với tiền tố demo_.
 *  - setup: chưa cấu hình và chưa bật demo → state.setupNeeded = true.
 * localStorage chỉ lưu tuỳ chọn giao diện và cờ demo (ngoài kho demo riêng ở trên).
 */
(function (global) {
  'use strict';

  var DEMO_STORAGE_KEY = 'demo_sava_workspace_v1';
  var PREFS_KEY = 'sava_ui_prefs';
  var DEMO_FLAG_KEY = 'sava_demo_enabled';

  /** Ma trận quyền: 4 vai × các quyền tách riêng. */
  var PERMISSIONS = {
    owner:  { read: true,  edit: true,  approve: true,  budget: true,  connect: true,  analytics: true,  adsRead: true, adsDraft: true,  adsApprove: true,  budgetChange: true,  publish: true },
    lead:   { read: true,  edit: true,  approve: true,  budget: true,  connect: false, analytics: true,  adsRead: true, adsDraft: true,  adsApprove: true,  budgetChange: true,  publish: true },
    member: { read: true,  edit: true,  approve: false, budget: false, connect: false, analytics: true,  adsRead: true, adsDraft: true,  adsApprove: false, budgetChange: false, publish: false },
    ceo:    { read: true,  edit: false, approve: false, budget: false, connect: false, analytics: true,  adsRead: true, adsDraft: false, adsApprove: false, budgetChange: false, publish: false }
  };
  var PERMISSION_LABELS = {
    read: 'Đọc', edit: 'Sửa', approve: 'Duyệt', budget: 'Xem ngân sách', connect: 'Kết nối kênh',
    analytics: 'Xem phân tích', adsRead: 'Quảng cáo — đọc', adsDraft: 'Quảng cáo — tạo nháp',
    adsApprove: 'Quảng cáo — duyệt', budgetChange: 'Đổi ngân sách', publish: 'Đăng bài'
  };

  var COLLECTIONS = ['members', 'businessUnits', 'campaigns', 'phases', 'activities', 'tasks', 'dependencies',
    'blockers', 'contentItems', 'variants', 'publishJobs', 'brandPages', 'brandAssets', 'approvals',
    'channelAccounts', 'externalPosts', 'metricObservations', 'budgetLines', 'commitments', 'actuals',
    'kpis', 'adAccounts', 'adCampaigns', 'adSets', 'ads', 'adChangeRequests', 'marketingRequests',
    'reportSnapshots', 'manualMetricEntries'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  function configIsValid() {
    var c = global.SAVA_CONFIG || {};
    return !!(c.supabaseUrl && c.supabaseAnonKey &&
      /^https:\/\/.+/.test(c.supabaseUrl) &&
      c.supabaseUrl.indexOf('YOUR-') === -1 && c.supabaseAnonKey.indexOf('YOUR-') === -1);
  }
  function demoRequested() {
    try {
      var q = new URLSearchParams(global.location ? global.location.search : '');
      if (q.get('demo') === '1') return true;
      return global.localStorage && global.localStorage.getItem(DEMO_FLAG_KEY) === '1';
    } catch (e) { return false; }
  }

  var Store = {
    PERMISSIONS: PERMISSIONS,
    PERMISSION_LABELS: PERMISSION_LABELS,
    mode: 'setup',
    setupNeeded: true,
    supabaseClient: null,
    supabaseUser: null,
    currentUserId: null,
    holidays: [],
    state: {},
    _listeners: [],

    /** Người dùng hiện tại (demo: chọn ở Thiết lập / Việc của tôi). */
    currentUser: function () {
      var list = this.state.members || [];
      return list.find(function (m) { return m.id === this.currentUserId; }.bind(this)) || list[0] || null;
    },
    currentRole: function () {
      var u = this.currentUser();
      return u ? u.role : 'member';
    },
    /** Kiểm tra quyền theo vai trò hiện tại. */
    can: function (perm) {
      var matrix = PERMISSIONS[this.currentRole()] || {};
      return !!matrix[perm];
    },
    canRole: function (role, perm) { return !!((PERMISSIONS[role] || {})[perm]); },

    subscribe: function (fn) { this._listeners.push(fn); },
    notify: function () {
      this._persistDemo();
      this._listeners.forEach(function (fn) { try { fn(); } catch (e) { /* bỏ qua lỗi listener */ } });
    },

    /** Nạp Store: chọn chế độ theo config và cờ demo. */
    load: function () {
      COLLECTIONS.forEach(function (k) { this.state[k] = []; }.bind(this));
      if (configIsValid()) {
        this.mode = 'supabase';
        this.setupNeeded = false;
        this._initSupabase();
        return this;
      }
      if (demoRequested()) {
        this._loadDemo();
        return this;
      }
      this.mode = 'setup';
      this.setupNeeded = true;
      return this;
    },

    _initSupabase: function () {
      try {
        if (global.supabase && global.supabase.createClient && global.SAVA_CONFIG) {
          this.supabaseClient = global.supabase.createClient(global.SAVA_CONFIG.supabaseUrl, global.SAVA_CONFIG.supabaseAnonKey);
        }
      } catch (e) { this.supabaseClient = null; }
    },
    /** Đăng nhập email/mật khẩu khi đã nối Supabase thật. */
    signIn: function (email, password) {
      if (!this.supabaseClient) return Promise.reject(new Error('Chưa kết nối Supabase.'));
      return this.supabaseClient.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) { this.supabaseUser = res.data ? res.data.user : null; return res; }.bind(this));
    },

    _loadDemo: function () {
      this.mode = 'demo';
      this.setupNeeded = false;
      var raw = null;
      try { raw = global.localStorage ? global.localStorage.getItem(DEMO_STORAGE_KEY) : null; } catch (e) { raw = null; }
      var source = null;
      if (raw) { try { source = JSON.parse(raw); } catch (e) { source = null; } }
      if (!source || !source.campaigns) source = clone(global.SAVA_DEMO_DATA || {});
      COLLECTIONS.forEach(function (k) { this.state[k] = clone(source[k] || []); }.bind(this));
      this.holidays = clone(source.holidays || []);
      if (!this.currentUserId) {
        var prefs = this.getPrefs();
        this.currentUserId = prefs.demoUserId || 'member-lead';
      }
    },
    _persistDemo: function () {
      if (this.mode !== 'demo') return;
      try {
        var snapshot = { holidays: this.holidays };
        COLLECTIONS.forEach(function (k) { snapshot[k] = this.state[k]; }.bind(this));
        global.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (e) { /* localStorage đầy hoặc bị chặn: giữ dữ liệu trong bộ nhớ */ }
    },
    /** Bật/tắt chế độ demo (lưu cờ riêng, không lẫn tuỳ chọn khác). */
    setDemoEnabled: function (enabled) {
      try { global.localStorage.setItem(DEMO_FLAG_KEY, enabled ? '1' : '0'); } catch (e) {}
      if (!enabled) { try { global.localStorage.removeItem(DEMO_STORAGE_KEY); } catch (e) {} }
    },
    isDemoEnabled: function () { return this.mode === 'demo'; },
    resetDemo: function () {
      try { global.localStorage.removeItem(DEMO_STORAGE_KEY); } catch (e) {}
      this._loadDemo();
      this.notify();
    },

    /** Tuỳ chọn giao diện — phạm vi duy nhất localStorage được dùng ngoài kho demo. */
    getPrefs: function () {
      try { return JSON.parse(global.localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) { return {}; }
    },
    setPref: function (key, value) {
      var p = this.getPrefs(); p[key] = value;
      try { global.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    },
    setCurrentUser: function (id) {
      this.currentUserId = id;
      this.setPref('demoUserId', id);
      this.notify();
    },

    // ---------- CRUD dùng chung (cùng ID ở mọi view) ----------
    list: function (collection) { return (this.state[collection] || []).slice(); },
    get: function (collection, id) { return (this.state[collection] || []).find(function (x) { return x.id === id; }) || null; },
    create: function (collection, obj) {
      if (!this.state[collection]) this.state[collection] = [];
      var item = Object.assign({}, obj);
      if (!item.id) item.id = uid(collection.replace(/s$/, ''));
      // Chống trùng bài đã đăng theo (platform, account, externalPostId).
      if (collection === 'externalPosts') {
        var dup = this.state.externalPosts.find(function (p) {
          return p.platform === item.platform && p.channelAccountId === item.channelAccountId && p.externalPostId === item.externalPostId;
        });
        if (dup) return { ok: false, error: 'Bài đã đăng này đã tồn tại (trùng platform + tài khoản + externalPostId): ' + dup.id, item: dup };
      }
      this.state[collection].push(item);
      this.notify();
      return { ok: true, item: item };
    },
    update: function (collection, id, patch) {
      if (collection === 'variants') return this.updateVariant(id, patch);
      var item = this.get(collection, id);
      if (!item) return { ok: false, error: 'Không tìm thấy bản ghi ' + id };
      Object.assign(item, patch);
      this.notify();
      return { ok: true, item: item };
    },
    remove: function (collection, id) {
      if (!this.state[collection]) return { ok: false };
      this.state[collection] = this.state[collection].filter(function (x) { return x.id !== id; });
      this.notify();
      return { ok: true };
    },

    /**
     * Cập nhật variant. Rule quan trọng: sửa caption của variant ĐÃ duyệt
     * thì approval tự hạ về "Cần duyệt lại" và job đăng liên quan bị tạm dừng.
     * (Ở bản thật rule này do trigger ở tầng DB đảm nhiệm; ở demo Store mô phỏng đúng rule đó.)
     */
    updateVariant: function (id, patch) {
      var v = this.get('variants', id);
      if (!v) return { ok: false, error: 'Không tìm thấy variant ' + id };
      var captionChanged = patch.caption !== undefined && patch.caption !== v.caption;
      var wasApproved = v.approvalStatus === 'approved';
      Object.assign(v, patch);
      var note = null;
      if (captionChanged && wasApproved) {
        v.approvalStatus = 'needs_reapproval';
        v.editorialStatus = 'in_review';
        note = 'Caption đã đổi sau khi duyệt: approval hạ về "Cần duyệt lại".';
        (this.state.publishJobs || []).forEach(function (job) {
          if (job.variantId === id && job.status !== 'paused') {
            job.status = 'paused';
            job.note = (job.note ? job.note + ' ' : '') + 'Tạm dừng vì caption đổi sau khi duyệt — cần duyệt lại.';
          }
        });
        (this.state.approvals || []).forEach(function (a) {
          if (a.variantId === id && a.status === 'approved') { a.status = 'needs_reapproval'; a.statusLabel = 'Cần duyệt lại'; }
        });
        // Tạo yêu cầu duyệt mới cho phiên bản hiện tại.
        this.state.approvals.push({
          id: uid('approval'), variantId: id, contentItemId: v.contentItemId, revision: v.revision || 1,
          status: 'pending', statusLabel: 'Chờ duyệt', requestedBy: this.currentUserId,
          requestedAt: new Date().toISOString(), note: note
        });
      }
      this.notify();
      return { ok: true, item: v, note: note };
    },

    /** Quyết định duyệt nội dung, gắn với đúng revision của variant. */
    decideApproval: function (approvalId, decision, note) {
      if (!this.can('approve')) return { ok: false, error: 'Vai trò hiện tại không có quyền duyệt nội dung.' };
      var a = this.get('approvals', approvalId);
      if (!a) return { ok: false, error: 'Không tìm thấy yêu cầu duyệt.' };
      var v = this.get('variants', a.variantId);
      a.decidedBy = this.currentUserId;
      a.decidedAt = new Date().toISOString();
      a.note = note || a.note || '';
      if (decision === 'approved') {
        a.status = 'approved'; a.statusLabel = 'Chấp thuận';
        if (v) { v.approvalStatus = 'approved'; v.editorialStatus = 'approved'; }
      } else if (decision === 'changes_requested') {
        a.status = 'changes_requested'; a.statusLabel = 'Yêu cầu chỉnh sửa';
        if (v) { v.approvalStatus = 'changes_requested'; v.editorialStatus = 'draft'; v.revision = (v.revision || 1) + 1; }
      } else if (decision === 'rejected') {
        a.status = 'rejected'; a.statusLabel = 'Từ chối';
        if (v) { v.approvalStatus = 'rejected'; v.editorialStatus = 'draft'; }
      }
      this.notify();
      return { ok: true, item: a };
    },

    /**
     * Cổng tạo PublishJob — chặn cứng ở các trường hợp:
     * chế độ demo, platform TikTok, đăng ngoài app, thiếu quyền publish.
     * Không bao giờ giả vờ thành công.
     */
    createPublishJob: function (variantOrId) {
      var v = typeof variantOrId === 'string' ? this.get('variants', variantOrId) : variantOrId;
      if (!v) return { ok: false, error: 'Không tìm thấy variant để đăng.' };
      var Domain = global.SAVA_DOMAIN;
      if (this.mode === 'demo') {
        return { ok: false, error: 'Đang ở chế độ demo: tài khoản demo không có quyền đăng bài thật. Nút đăng bị khóa — hãy kết nối Supabase và kênh thật để đăng.' };
      }
      if (this.mode !== 'supabase') return { ok: false, error: 'Chưa kết nối Supabase nên chưa thể đăng bài.' };
      if (!this.can('publish')) return { ok: false, error: 'Vai trò hiện tại không có quyền Đăng bài.' };
      if (Domain && !Domain.shouldCreatePublishJob(v)) {
        if ((v.platform || '') === 'tiktok') return { ok: false, error: 'TikTok đăng ngoài app: app không tạo PublishJob cho TikTok.' };
        return { ok: false, error: 'Variant này ở chế độ đăng ngoài app nên không tạo PublishJob.' };
      }
      if (v.approvalStatus !== 'approved') return { ok: false, error: 'Variant chưa được duyệt nên chưa thể đăng.' };
      var job = { id: uid('job'), variantId: v.id, status: 'queued', createdAt: new Date().toISOString() };
      this.state.publishJobs.push(job);
      this.notify();
      return { ok: true, item: job };
    }
  };

  global.SAVA_STORE = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
