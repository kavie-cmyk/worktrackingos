/*
 * js/store.js — Lớp Store trừu tượng của SAVA Marketing Workspace.
 * Ba chế độ:
 *  - supabase: config.js có URL + anon key hợp lệ → client qua CDN supabase-js,
 *    đăng nhập email/mật khẩu (Supabase Auth), nạp membership → role +
 *    workspace hiện hành, CRUD write-through qua REST (PostgREST) với khóa
 *    lạc quan theo updated_at (AC09). Chưa có phiên đăng nhập thì
 *    state.authRequired = true và state rỗng — KHÔNG rơi vào demo.
 *  - demo: người dùng chủ động bật ở Thiết lập hoặc mở ?demo=1 → dữ liệu minh họa
 *    từ js/demo-data.js, sửa trong bộ nhớ và lưu ở localStorage với tiền tố demo_.
 *  - setup: chưa cấu hình và chưa bật demo → state.setupNeeded = true.
 * Ở chế độ supabase, create/update/remove/updateVariant/decideApproval/
 * createPublishJob trả về Promise<{ok, item?, error?, conflict?}>;
 * ở chế độ demo chúng giữ nguyên hành vi đồng bộ như trước.
 * Mapping collection ↔ bảng + camelCase ↔ snake_case nằm ở js/store-core.js.
 * localStorage chỉ lưu tuỳ chọn giao diện và cờ demo (ngoài kho demo riêng ở trên).
 */
(function (global) {
  'use strict';

  var Core = global.SAVA_STORE_CORE || (typeof require === 'function' ? null : null);
  if (!Core && typeof module !== 'undefined' && module.exports) {
    try { Core = require('./store-core.js'); } catch (e) { Core = null; }
  }

  var DEMO_STORAGE_KEY = 'demo_sava_workspace_v1';
  var PREFS_KEY = 'sava_ui_prefs';
  var DEMO_FLAG_KEY = 'sava_demo_enabled';
  var PAGE_SIZE = 1000;

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
  var ROLE_LABELS = { owner: 'Owner', lead: 'Lead', member: 'Member', ceo: 'CEO' };

  var COLLECTIONS = ['members', 'businessUnits', 'campaigns', 'phases', 'activities', 'tasks', 'dependencies',
    'blockers', 'contentItems', 'variants', 'publishJobs', 'brandPages', 'brandAssets', 'approvals',
    'channelAccounts', 'externalPosts', 'metricObservations', 'budgetLines', 'commitments', 'actuals',
    'kpis', 'adAccounts', 'adCampaigns', 'adSets', 'ads', 'adChangeRequests', 'marketingRequests',
    'reportSnapshots', 'manualMetricEntries'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')); }

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
  /** Dịch lỗi REST/PostgREST thành thông điệp dễ hiểu cho người dùng. */
  function friendlyError(err) {
    if (!err) return 'Đã xảy ra lỗi không xác định.';
    var msg = err.message || String(err);
    if (/duplicate key|already exists/i.test(msg)) return 'Bản ghi đã tồn tại (trùng khóa duy nhất trên server).';
    if (/row-level security|permission denied|RLS/i.test(msg)) return 'Vai trò hiện tại không có quyền thực hiện thao tác này trên server.';
    if (/violates check constraint|check constraint/i.test(msg)) return 'Giá trị không hợp lệ với ràng buộc dữ liệu trên server: ' + msg;
    if (/violates not-null/i.test(msg)) return 'Thiếu trường bắt buộc khi lưu lên server: ' + msg;
    if (/violates foreign key/i.test(msg)) return 'Bản ghi liên kết không tồn tại trên server: ' + msg;
    if (/JWT|token is expired|session/i.test(msg)) return 'Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.';
    return msg;
  }

  var Store = {
    PERMISSIONS: PERMISSIONS,
    PERMISSION_LABELS: PERMISSION_LABELS,
    COLLECTIONS: COLLECTIONS,
    mode: 'setup',
    setupNeeded: true,
    supabaseClient: null,
    supabaseUser: null,
    currentUserId: null,
    workspaceId: null,
    holidays: [],
    state: { authRequired: false, noMembership: false },
    /** Thông tin link mời / khôi phục lấy từ URL hash: { type } hoặc { expired: true, … }. */
    pendingInvite: null,
    _membership: null,
    _loadedForUserId: null,
    _bootstrapping: false,
    _listeners: [],

    /** Người dùng hiện tại (demo: chọn ở Thiết lập / Việc của tôi). */
    currentUser: function () {
      var list = this.state.members || [];
      return list.find(function (m) { return m.id === this.currentUserId; }.bind(this)) || list[0] || null;
    },
    currentRole: function () {
      if (this.mode === 'supabase' && this._membership) return this._membership.role;
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

    // ======================================================================
    // Khởi tạo / phiên đăng nhập
    // ======================================================================
    /** Nạp Store: chọn chế độ theo config và cờ demo. Luôn trả về Promise. */
    load: function () {
      COLLECTIONS.forEach(function (k) { this.state[k] = []; }.bind(this));
      this.state.authRequired = false;
      this.state.noMembership = false;
      if (demoRequested()) {
        this._loadDemo();
        return Promise.resolve(this);
      }
      if (configIsValid()) {
        this.mode = 'supabase';
        this.setupNeeded = false;
        this._initSupabase();
        return this._handleAuthEntry();
      }
      this.mode = 'setup';
      this.setupNeeded = true;
      return Promise.resolve(this);
    },

    _initSupabase: function () {
      try {
        if (global.supabase && global.supabase.createClient && global.SAVA_CONFIG) {
          // detectSessionInUrl mặc định bật: supabase-js tự đọc access_token
          // trong hash (link mời / khôi phục) và lập phiên tạm.
          this.supabaseClient = global.supabase.createClient(global.SAVA_CONFIG.supabaseUrl, global.SAVA_CONFIG.supabaseAnonKey);
          var self = this;
          if (this.supabaseClient.auth && this.supabaseClient.auth.onAuthStateChange) {
            this.supabaseClient.auth.onAuthStateChange(function (event, session) {
              if (event === 'SIGNED_OUT') {
                self.supabaseUser = null; self.currentUserId = null; self.workspaceId = null;
                self._membership = null; self._loadedForUserId = null;
                COLLECTIONS.forEach(function (k) { self.state[k] = []; });
                self.state.authRequired = true; self.state.noMembership = false;
                self.notify();
              } else if (session && session.user && session.user.id !== self._loadedForUserId && !self.pendingInvite) {
                self._bootstrapSession();
              }
            });
          }
        }
      } catch (e) { this.supabaseClient = null; }
    },

    /**
     * Điểm vào sau khi tạo client: xử lý hash mời/khôi phục trước,
     * rồi khôi phục phiên đăng nhập (nếu có) sau khi tải lại trang.
     */
    _handleAuthEntry: function () {
      var parsed = Core ? Core.parseAuthHash(global.location ? global.location.hash : '') : { isAuthCallback: false };
      if (parsed.isAuthCallback && parsed.hasError) {
        // Link hết hạn / đã dùng: KHÔNG hiện form đặt mật khẩu.
        this.pendingInvite = { expired: true, error: parsed.error, errorCode: parsed.errorCode, errorDescription: parsed.errorDescription };
        this.state.authRequired = false;
        return Promise.resolve(this);
      }
      if (parsed.isAuthCallback && (parsed.type === 'invite' || parsed.type === 'recovery')) {
        this.pendingInvite = { type: parsed.type };
        this.state.authRequired = false;
        // Lập phiên tạm từ hash để completeInvite() gọi được updateUser.
        return this._bootstrapSession(true).then(function () { return this; }.bind(this));
      }
      return this._bootstrapSession();
    },

    /** Lấy phiên hiện tại → nạp membership + dữ liệu workspace. */
    _bootstrapSession: function (inviteSession) {
      var self = this;
      if (!this.supabaseClient) { this.state.authRequired = true; return Promise.resolve(this); }
      if (this._bootstrapping) return Promise.resolve(this);
      this._bootstrapping = true;
      return this.supabaseClient.auth.getSession()
        .then(function (res) {
          var session = res && res.data ? res.data.session : null;
          if (!session || !session.user) {
            self.supabaseUser = null;
            if (!self.pendingInvite) self.state.authRequired = true;
            return null;
          }
          self.supabaseUser = session.user;
          self._loadedForUserId = session.user.id;
          if (inviteSession || self.pendingInvite) return session; // chờ đặt mật khẩu xong mới nạp dữ liệu
          return self._loadMembershipAndData().then(function () { return session; });
        })
        .catch(function () { if (!self.pendingInvite) self.state.authRequired = true; return null; })
        .then(function (s) { self._bootstrapping = false; self.notify(); return s; });
    },

    _loadMembershipAndData: function () {
      var self = this;
      var user = this.supabaseUser;
      if (!user) return Promise.resolve();
      return this.supabaseClient.from('memberships')
        .select('*').eq('user_id', user.id).eq('is_active', true)
        .order('created_at', { ascending: true })
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          if (!rows.length) {
            self.state.noMembership = true;
            self.state.authRequired = false;
            self._membership = null; self.workspaceId = null;
            COLLECTIONS.forEach(function (k) { self.state[k] = []; });
            return null;
          }
          self._membership = rows[0];
          self.workspaceId = rows[0].workspace_id;
          self.currentUserId = user.id;
          self.state.noMembership = false;
          self.state.authRequired = false;
          return self._ensureUserProfile().then(function () { return self._loadWorkspaceData(); });
        })
        .catch(function (err) {
          self.state.loadError = friendlyError(err);
        });
    },

    /** User được mời có thể chưa có dòng public.users — tự tạo hồ sơ của chính mình (RLS cho phép). */
    _ensureUserProfile: function () {
      var self = this;
      var user = this.supabaseUser;
      return this.supabaseClient.from('users').select('id').eq('id', user.id).limit(1)
        .then(function (res) {
          if (res.data && res.data.length) return null;
          var display = (user.email || 'Người dùng').split('@')[0];
          return self.supabaseClient.from('users')
            .insert({ id: user.id, email: user.email || '', display_name: display })
            .then(function () { return null; }, function () { return null; });
        })
        .catch(function () { return null; });
    },

    // ======================================================================
    // Nạp dữ liệu workspace (phân trang 1000/trang)
    // ======================================================================
    _fetchAll: function (table, applyFilters) {
      var self = this;
      var rows = [];
      function page(from) {
        var q = self.supabaseClient.from(table).select('*');
        if (applyFilters) q = applyFilters(q);
        return q.range(from, from + PAGE_SIZE - 1).then(function (res) {
          if (res.error) throw res.error;
          var batch = res.data || [];
          rows = rows.concat(batch);
          if (batch.length === PAGE_SIZE) return page(from + PAGE_SIZE);
          return rows;
        });
      }
      return page(0);
    },
    _fetchWorkspaceTable: function (table) {
      var ws = this.workspaceId;
      var hasWs = !Core || Core.hasColumn(table, 'workspace_id');
      return this._fetchAll(table, function (q) {
        var x = hasWs ? q.eq('workspace_id', ws) : q;
        return x.order('created_at', { ascending: true });
      });
    },

    _loadWorkspaceData: function () {
      var self = this;
      var jobs = COLLECTIONS.filter(function (c) {
        return c !== 'members' && c !== 'businessUnits' && c !== 'approvals' && c !== 'manualMetricEntries';
      }).map(function (c) { return self._loadCollection(c); });
      jobs.push(self._loadMembers());
      jobs.push(self._loadBusinessUnits());
      jobs.push(self._loadApprovals());
      return Promise.all(jobs).then(function () { return self._loadDerivedMerges(); });
    },
    _refreshCollections: function (names) {
      var self = this;
      return Promise.all(names.map(function (n) {
        if (n === 'members') return self._loadMembers();
        if (n === 'businessUnits') return self._loadBusinessUnits();
        if (n === 'approvals') return self._loadApprovals();
        return self._loadCollection(n);
      })).then(function () { return self._loadDerivedMerges(); }).then(function () { self.notify(); });
    },
    _loadCollection: function (collection) {
      var self = this;
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) { this.state[collection] = []; return Promise.resolve(); }
      return this._fetchWorkspaceTable(table).then(function (rows) {
        self.state[collection] = rows.map(function (r) { return self._rowToItem(collection, r); });
      }).catch(function () { self.state[collection] = self.state[collection] || []; });
    },
    _loadMembers: function () {
      var self = this;
      return this._fetchAll('memberships', function (q) {
        return q.eq('workspace_id', self.workspaceId).eq('is_active', true).order('created_at', { ascending: true });
      }).then(function (memberships) {
        var ids = memberships.map(function (m) { return m.user_id; });
        if (!ids.length) { self.state.members = []; return null; }
        return self._fetchAll('users', function (q) { return q.in('id', ids); }).then(function (users) {
          var byId = {};
          users.forEach(function (u) { byId[u.id] = u; });
          self.state.members = memberships.map(function (m) {
            var u = byId[m.user_id] || {};
            return {
              id: m.user_id, membershipId: m.id, workspaceId: m.workspace_id,
              name: u.display_name || u.email || m.user_id,
              email: u.email || '', avatarUrl: u.avatar_url || null,
              role: m.role, roleLabel: ROLE_LABELS[m.role] || m.role,
              isActive: m.is_active !== false,
              capacityHoursPerWeek: m.role === 'ceo' ? 0 : 40, daysOff: [],
              createdAt: m.created_at, updatedAt: m.updated_at
            };
          });
        });
      }).catch(function () { self.state.members = []; });
    },
    _loadBusinessUnits: function () {
      var self = this;
      return this._fetchWorkspaceTable('bu_products').then(function (rows) {
        var order = []; var byName = {};
        rows.forEach(function (r) {
          var bu = byName[r.bu_name];
          if (!bu) { bu = { id: r.bu_name, name: r.bu_name, products: [], _rows: [] }; byName[r.bu_name] = bu; order.push(bu); }
          bu.products.push(r.name); bu._rows.push(r.id);
          if (r.description && !bu.description) bu.description = r.description;
        });
        self.state.businessUnits = order;
      }).catch(function () { self.state.businessUnits = []; });
    },
    _loadApprovals: function () {
      var self = this;
      return Promise.all([
        this._fetchWorkspaceTable('approval_steps'),
        this._fetchWorkspaceTable('approval_decisions'),
        this._fetchWorkspaceTable('content_revisions')
      ]).then(function (results) {
        var steps = results[0], decisions = results[1], revisions = results[2];
        var revNoById = {}; var revNoByVariant = {};
        revisions.forEach(function (r) {
          revNoById[r.id] = r.revision_no;
          if (!revNoByVariant[r.variant_id] || r.revision_no > revNoByVariant[r.variant_id]) revNoByVariant[r.variant_id] = r.revision_no;
        });
        self._revisionByVariant = revNoByVariant;
        var stepIds = {};
        var items = steps.map(function (s) {
          stepIds[s.id] = true;
          return {
            id: s.id, _kind: 'step', variantId: s.variant_id, contentItemId: s.content_item_id, campaignId: s.campaign_id,
            revision: revNoByVariant[s.variant_id] || 1,
            status: s.status, statusLabel: s.status,
            requestedBy: s.approver_id, requestedAt: s.created_at,
            decidedBy: null, note: s.name || '', createdAt: s.created_at, updatedAt: s.updated_at
          };
        });
        decisions.forEach(function (d) {
          if (d.step_id && stepIds[d.step_id]) {
            var it = items.find(function (x) { return x.id === d.step_id; });
            if (it) {
              it.status = d.decision; it.statusLabel = d.decision;
              it.decidedBy = d.decided_by; it.decidedAt = d.decided_at;
              it.note = d.comment || it.note; it.revision = revNoById[d.revision_id] || it.revision;
              it._kind = 'step+decision';
            }
            return;
          }
          items.push({
            id: d.id, _kind: 'decision', variantId: d.variant_id, contentItemId: null,
            revision: revNoById[d.revision_id] || 1,
            status: d.decision, statusLabel: d.decision,
            requestedBy: null, requestedAt: d.created_at,
            decidedBy: d.decided_by, decidedAt: d.decided_at, note: d.comment || '',
            createdAt: d.created_at, updatedAt: d.created_at
          });
        });
        self.state.approvals = items;
      }).catch(function () { self.state.approvals = []; });
    },
    /**
     * Gộp dữ liệu phụ sau khi các collection chính đã nạp:
     * revision hiện tại + script TikTok vào variants; campaign của external
     * posts qua post_content_mappings; actual của KPI qua measurements;
     * số liệu ads_insights vào cây quảng cáo; metric nhập tay tách từ
     * metric_observations (dimensions.manual_entry = true).
     */
    _loadDerivedMerges: function () {
      var self = this;
      var jobs = [];
      // Variants: revision + tiktok_scripts
      jobs.push(Promise.all([
        this._fetchWorkspaceTable('content_revisions').catch(function () { return []; }),
        this._fetchWorkspaceTable('tiktok_scripts').catch(function () { return []; })
      ]).then(function (res) {
        var revMax = {};
        res[0].forEach(function (r) { if (!revMax[r.variant_id] || r.revision_no > revMax[r.variant_id]) revMax[r.variant_id] = r.revision_no; });
        self._revisionByVariant = revMax;
        var scripts = {};
        res[1].forEach(function (s) { scripts[s.variant_id] = s; });
        (self.state.variants || []).forEach(function (v) {
          v.revision = revMax[v.id] || 1;
          var sc = scripts[v.id];
          if (sc) {
            v.hook = sc.hook || ''; v.cta = sc.cta || '';
            v.scriptScenes = (sc.scenes || []).map(function (s) {
              return { shot: s.shot, visual: s.visual, dialogue: s.dialogue, onScreenText: s.on_screen_text != null ? s.on_screen_text : s.onScreenText, durationSec: s.duration_sec != null ? s.duration_sec : s.durationSec };
            });
            if (sc.external_url && !v.externalUrl) v.externalUrl = sc.external_url;
          } else if (v.platform === 'tiktok' && !v.scriptScenes) v.scriptScenes = [];
          if (v.platform === 'tiktok') v.externalStatus = v.publishingStatus === 'published_external' ? 'Đã đăng ngoài app' : 'Chờ đăng ngoài app';
        });
      }));
      // External posts: campaign qua bảng nối
      jobs.push(this._fetchWorkspaceTable('post_content_mappings').then(function (maps) {
        var byPost = {};
        maps.forEach(function (m) { if (m.campaign_id && !byPost[m.external_post_id]) byPost[m.external_post_id] = m.campaign_id; });
        (self.state.externalPosts || []).forEach(function (p) { if (byPost[p.id]) p.campaignId = byPost[p.id]; });
      }).catch(function () {}));
      // KPI: actual mới nhất từ measurements
      jobs.push(this._fetchWorkspaceTable('measurements').then(function (rows) {
        var latest = {};
        rows.slice().sort(function (a, b) { return String(a.measured_at).localeCompare(String(b.measured_at)); })
          .forEach(function (m) { latest[m.kpi_id] = m; });
        (self.state.kpis || []).forEach(function (k) {
          var m = latest[k.id];
          k.actual = m ? (m.value === null ? null : Number(m.value)) : null;
          if (m) { k.source = m.source || 'manual'; k.updatedAt = m.measured_at; }
        });
      }).catch(function () {}));
      // Ads: số liệu từ ads_insights theo external_id của từng cấp
      jobs.push(this._fetchWorkspaceTable('ads_insights').then(function (rows) {
        var byKey = {};
        rows.slice().sort(function (a, b) { return String(a.observed_at).localeCompare(String(b.observed_at)); })
          .forEach(function (r) { byKey[r.object_type + ':' + r.object_id] = r; });
        function merge(list, type) {
          (list || []).forEach(function (x) {
            var ins = byKey[type + ':' + x.externalId];
            if (!ins) return;
            x.spend = ins.spend != null ? Number(ins.spend) : 0;
            x.impressions = ins.impressions != null ? Number(ins.impressions) : 0;
            x.clicks = ins.clicks != null ? Number(ins.clicks) : 0;
            x.results = ins.results != null ? Number(ins.results) : 0;
            x.conversionValue = ins.conversion_value != null ? Number(ins.conversion_value) : 0;
          });
        }
        merge(self.state.adAccounts, 'ad_account');
        merge(self.state.adCampaigns, 'ad_campaign');
        merge(self.state.adSets, 'ad_group');
        merge(self.state.ads, 'ad');
      }).catch(function () {}));
      // Số liệu nhập tay = một phần của metric_observations
      jobs.push(Promise.resolve().then(function () {
        self.state.manualMetricEntries = (self.state.metricObservations || []).filter(function (o) {
          return o._manualEntry === true;
        });
      }));
      return Promise.all(jobs).then(function () { return null; });
    },

    // ======================================================================
    // Chuyển đổi dòng ↔ item (adapter theo collection, trên nền store-core)
    // ======================================================================
    _rowToItem: function (collection, row) {
      var item = Core ? Core.fromDbRow(collection, row) : clone(row);
      if (!item) return item;
      switch (collection) {
        case 'campaigns': {
          var b = row.baseline || {};
          item.baselineStartDate = b.start_date || b.startDate || null;
          item.baselineEndDate = b.end_date || b.endDate || null;
          if (item.why === undefined && row.objectives) item.why = row.objectives;
          break;
        }
        case 'brandPages': {
          var g = row.guidelines || {};
          item.version = g.version != null ? g.version : 1;
          item.status = g.status || 'Draft';
          break;
        }
        case 'brandAssets': {
          item.type = (row.asset_type === 'other' && (row.tags || [])[0]) ? row.tags[0] : row.asset_type;
          item.status = row.status === 'archived' ? 'Archived' : 'Approved';
          item.version = 1;
          break;
        }
        case 'channelAccounts': {
          var stMap = { not_connected: 'Chờ kết nối', connected: 'Đã kết nối', needs_reauth: 'Cần đăng nhập lại', disconnected: 'Đã ngắt kết nối', error: 'Lỗi' };
          item.status = stMap[row.status] || row.status;
          item.capabilities = {
            readPosts: 'Chờ kết nối', readMetrics: 'Chờ kết nối',
            publish: item.platform === 'tiktok' ? 'Đăng ngoài app' : 'Chờ kết nối', ads: 'Chờ kết nối'
          };
          break;
        }
        case 'variants': {
          var edMap = { draft: 'draft', editing: 'draft', ready_for_review: 'in_review', changes_requested: 'in_review', final: 'approved' };
          var apMap = { draft: 'draft', pending: 'pending', approved: 'approved', rejected: 'rejected', needs_review: 'needs_reapproval' };
          item.editorialStatus = edMap[row.editorial_status] || row.editorial_status;
          item.approvalStatus = apMap[row.approval_status] || row.approval_status;
          break;
        }
        case 'contentItems': {
          item.editorialStatus = row.status;
          item.scheduledDate = row.planned_at ? String(row.planned_at).slice(0, 10) : null;
          break;
        }
        case 'blockers': {
          item.title = row.description;
          break;
        }
        case 'metricObservations':
        case 'manualMetricEntries': {
          var dims = row.dimensions || {};
          item.metric = row.metric_code;
          if (row.object_type === 'external_post') item.externalPostId = row.object_id;
          ['spend', 'clicks', 'impressions', 'results'].forEach(function (k) { if (dims[k] != null) item[k] = dims[k]; });
          if (dims.conversion_value != null) item.conversionValue = dims.conversion_value;
          if (dims.entered_by) item.enteredBy = dims.entered_by;
          item._manualEntry = dims.manual_entry === true;
          break;
        }
        case 'budgetLines': {
          if (item.planned === undefined) item.planned = row.approved_amount;
          break;
        }
        case 'adChangeRequests': {
          var after = row.after_state || {};
          item.title = after.title || row.reason || '';
          item.target = after.target || row.target_external_id || '';
          item.defaultState = 'Tạm dừng (paused)';
          break;
        }
        case 'marketingRequests': {
          var prMap = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', urgent: 'Khẩn cấp' };
          if (prMap[row.priority]) item.priority = prMap[row.priority];
          break;
        }
        case 'reportSnapshots': {
          var d = row.data || {};
          item.title = row.name;
          item.frozenAt = row.generated_at;
          item.status = d.status || 'Đã chốt';
          item.summary = d.summary || '';
          item.metrics = d.metrics || {};
          break;
        }
        case 'adAccounts': {
          var apMap2 = { meta_ads: 'Meta Ads', google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads', linkedin_ads: 'LinkedIn Ads' };
          item.platform = apMap2[row.platform] || row.platform;
          break;
        }
      }
      return item;
    },
    /** object frontend → payload snake_case (qua store-core + adapter riêng). */
    _toPayload: function (collection, obj, options) {
      options = options || {};
      var payload = Core ? Core.toDbPayload(collection, obj, {
        workspaceId: options.workspaceId, forInsert: !!options.forInsert, userId: this.currentUserId
      }) : {};
      switch (collection) {
        case 'campaigns': {
          if (obj.why !== undefined && obj.objectives === undefined) payload.objectives = obj.why;
          if (obj.baselineStartDate !== undefined || obj.baselineEndDate !== undefined) {
            payload.baseline = { start_date: obj.baselineStartDate || null, end_date: obj.baselineEndDate || null };
          }
          break;
        }
        case 'brandPages': {
          var g = Object.assign({}, obj.guidelines || {});
          if (obj.version !== undefined) g.version = obj.version;
          if (obj.status !== undefined) g.status = obj.status;
          if (Object.keys(g).length) payload.guidelines = g;
          break;
        }
        case 'brandAssets': {
          if (obj.type !== undefined && ['image', 'video', 'audio', 'document', 'design', 'other'].indexOf(String(obj.type).toLowerCase()) === -1) {
            payload.tags = [String(obj.type)];
          }
          break;
        }
        case 'variants': {
          var edMap = { draft: 'draft', in_review: 'ready_for_review', approved: 'final', scheduled: 'final' };
          var apMap = { draft: 'draft', pending: 'pending', approved: 'approved', rejected: 'rejected', needs_reapproval: 'needs_review', changes_requested: 'needs_review' };
          if (obj.editorialStatus !== undefined) payload.editorial_status = edMap[obj.editorialStatus] || 'draft';
          if (obj.approvalStatus !== undefined) payload.approval_status = apMap[obj.approvalStatus] || 'draft';
          if (payload.platform === 'tiktok') payload.publish_mode = 'external';
          delete payload.editorial_status_label;
          break;
        }
        case 'contentItems': {
          if (obj.editorialStatus !== undefined && obj.status === undefined) payload.status = obj.editorialStatus;
          if (obj.scheduledDate !== undefined && obj.plannedAt === undefined) payload.planned_at = obj.scheduledDate;
          break;
        }
        case 'blockers': {
          if (obj.title !== undefined) {
            payload.description = obj.description ? String(obj.title) + ' — ' + String(obj.description) : String(obj.title);
          }
          if (obj.createdBy !== undefined && payload.reported_by === undefined) payload.reported_by = isUuid(obj.createdBy) ? obj.createdBy : null;
          break;
        }
        case 'metricObservations':
        case 'manualMetricEntries': {
          var observed = obj.observedAt || new Date().toISOString();
          payload.observed_at = observed;
          if (!payload.period_start) payload.period_start = observed;
          if (!payload.period_end) payload.period_end = observed;
          if (!payload.object_type) payload.object_type = obj.variantId ? 'channel_account' : 'external_post';
          if (!payload.object_id) payload.object_id = obj.externalPostId || obj.objectId || obj.variantId || '';
          if (!payload.source) payload.source = obj.source || 'manual';
          var dims = Object.assign({}, obj.dimensions || {});
          ['spend', 'clicks', 'impressions', 'results'].forEach(function (k) { if (obj[k] != null) dims[k] = obj[k]; });
          if (obj.conversionValue != null) dims.conversion_value = obj.conversionValue;
          if (obj.enteredBy) dims.entered_by = obj.enteredBy;
          if (collection === 'manualMetricEntries') dims.manual_entry = true;
          payload.dimensions = dims;
          break;
        }
        case 'kpis': {
          if (!payload.metric_code) {
            payload.metric_code = obj.metricCode || obj.metric || (obj.name ? String(obj.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) : 'custom');
          }
          break;
        }
        case 'adChangeRequests': {
          payload.after_state = Object.assign({}, obj.afterState || {}, {
            title: obj.title || '', target: obj.target || ''
          });
          if (!payload.target_external_id) payload.target_external_id = obj.target || obj.title || '';
          if (!payload.target_type) payload.target_type = 'ad_campaign';
          if (!payload.change_type) payload.change_type = 'other';
          if (obj.title && !payload.reason) payload.reason = obj.title;
          break;
        }
        case 'reportSnapshots': {
          payload.data = { metrics: obj.metrics || {}, summary: obj.summary || '', status: obj.status || 'Đã chốt' };
          if (!payload.report_type) payload.report_type = 'custom';
          if (obj.frozenAt) payload.generated_at = obj.frozenAt;
          break;
        }
        case 'tasks': {
          if (obj.status !== undefined) {
            payload.completed_at = obj.status === 'completed' ? (obj.completedAt || new Date().toISOString()) : null;
          }
          break;
        }
      }
      // PostgREST từ chối cột lạ: lọc lần cuối theo danh sách cột thật.
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (table && Core) {
        Object.keys(payload).forEach(function (k) { if (!Core.hasColumn(table, k)) delete payload[k]; });
      }
      return payload;
    },

    // ======================================================================
    // Đăng nhập / đăng xuất / lời mời
    // ======================================================================
    /** Đăng nhập email/mật khẩu khi đã nối Supabase thật. */
    signIn: function (email, password) {
      if (!this.supabaseClient) return Promise.reject(new Error('Chưa kết nối Supabase.'));
      var self = this;
      return this.supabaseClient.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) throw res.error;
          self.supabaseUser = res.data ? res.data.user : null;
          if (self.supabaseUser) self._loadedForUserId = self.supabaseUser.id;
          self.state.authRequired = false;
          return self._loadMembershipAndData().then(function () { self.notify(); return res; });
        });
    },
    signOut: function () {
      var self = this;
      var done = function () {
        self.supabaseUser = null; self.currentUserId = null; self.workspaceId = null;
        self._membership = null; self._loadedForUserId = null; self.pendingInvite = null;
        COLLECTIONS.forEach(function (k) { self.state[k] = []; });
        self.state.authRequired = true; self.state.noMembership = false;
        self.notify();
        return { ok: true };
      };
      if (!this.supabaseClient) return Promise.resolve(done());
      return this.supabaseClient.auth.signOut().then(done, done);
    },
    /**
     * Hoàn tất nhận lời mời / khôi phục: đặt mật khẩu mới trên phiên tạm từ
     * hash → phiên thành chính thức → xoá hash → nạp membership + dữ liệu.
     */
    completeInvite: function (password, passwordConfirm) {
      var check = Core ? Core.validateNewPassword(password, passwordConfirm != null ? passwordConfirm : password)
        : { ok: !!password && password.length >= 8, error: 'Mật khẩu phải có tối thiểu 8 ký tự.' };
      if (!check.ok) return Promise.resolve({ ok: false, error: check.error });
      if (!this.supabaseClient) return Promise.resolve({ ok: false, error: 'Chưa kết nối Supabase.' });
      var self = this;
      return this.supabaseClient.auth.getSession().then(function (res) {
        var session = res && res.data ? res.data.session : null;
        if (!session) return { ok: false, error: 'Không tìm thấy phiên từ liên kết mời — liên kết có thể đã hết hạn. Hãy xin Owner gửi lại lời mời.' };
        return self.supabaseClient.auth.updateUser({ password: password }).then(function (upd) {
          if (upd.error) return { ok: false, error: friendlyError(upd.error) };
          self.pendingInvite = null;
          self.supabaseUser = session.user;
          self._loadedForUserId = session.user.id;
          try {
            var clean = (global.location ? global.location.pathname + global.location.search : '') + '#/overview';
            global.history.replaceState(null, '', clean);
          } catch (e) { /* bỏ qua nếu không sửa được URL */ }
          return self._loadMembershipAndData().then(function () {
            self.notify();
            if (self.state.noMembership) {
              return { ok: false, noMembership: true, error: 'Tài khoản chưa được gán quyền — liên hệ Owner.' };
            }
            return { ok: true };
          });
        });
      }).catch(function (err) { return { ok: false, error: friendlyError(err) }; });
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
      if (this.mode === 'supabase') return; // danh tính thật do Supabase Auth quyết định
      this.currentUserId = id;
      this.setPref('demoUserId', id);
      this.notify();
    },

    // ======================================================================
    // CRUD dùng chung (cùng ID ở mọi view)
    // ======================================================================
    list: function (collection) { return (this.state[collection] || []).slice(); },
    get: function (collection, id) { return (this.state[collection] || []).find(function (x) { return x.id === id; }) || null; },

    create: function (collection, obj) {
      if (this.mode === 'supabase') return this._createRemote(collection, obj || {});
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
    _createRemote: function (collection, obj) {
      var self = this;
      if (!this.workspaceId) return Promise.resolve({ ok: false, error: 'Chưa xác định được workspace hiện hành.' });
      if (collection === 'members') {
        return Promise.resolve({ ok: false, error: 'Thành viên được thêm bằng lời mời của Owner (Supabase Auth + memberships), không tạo trực tiếp ở đây.' });
      }
      if (collection === 'businessUnits') return this._createBusinessUnit(obj);
      if (collection === 'approvals') return this._createApprovalStep(obj);
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) return Promise.resolve({ ok: false, error: 'Collection chưa được ánh xạ lên bảng dữ liệu: ' + collection });
      var payload = this._toPayload(collection, obj, { forInsert: true, workspaceId: this.workspaceId });
      // ID do frontend tự sinh (không phải uuid) không gửi lên — để server sinh.
      if (payload.id && !isUuid(payload.id)) delete payload.id;
      var chain = this.supabaseClient.from(table).insert(payload).select().single()
        .then(function (res) {
          if (res.error) throw res.error;
          var item = self._rowToItem(collection, res.data);
          // KPI: actual nằm ở measurements, không nằm trên dòng kpis.
          if (collection === 'kpis' && obj.actual != null) {
            return self.supabaseClient.from('measurements').insert({
              workspace_id: self.workspaceId, kpi_id: res.data.id, value: Number(obj.actual),
              source: 'manual', created_by: self.currentUserId
            }).then(function () { item.actual = Number(obj.actual); return item; }, function () { return item; });
          }
          // Bài đã đăng gắn campaign qua bảng nối post_content_mappings.
          if (collection === 'externalPosts' && obj.campaignId) {
            return self.supabaseClient.from('post_content_mappings').insert({
              workspace_id: self.workspaceId, external_post_id: res.data.id,
              campaign_id: obj.campaignId, mapping_source: 'manual', created_by: self.currentUserId
            }).then(function () { item.campaignId = obj.campaignId; return item; }, function () { return item; });
          }
          return item;
        });
      return chain.then(function (item) {
        if (!self.state[collection]) self.state[collection] = [];
        self.state[collection].push(item);
        if (collection === 'metricObservations' && item._manualEntry) self.state.manualMetricEntries.push(item);
        if (collection === 'manualMetricEntries') self.state.metricObservations.push(item);
        self.notify();
        return { ok: true, item: item };
      }).catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    },
    _createBusinessUnit: function (obj) {
      var self = this;
      var products = (obj.products && obj.products.length) ? obj.products : [obj.name];
      var rows = products.map(function (p) {
        return { workspace_id: self.workspaceId, bu_name: obj.name, name: p, status: 'active', created_by: self.currentUserId };
      });
      return this.supabaseClient.from('bu_products').insert(rows).select()
        .then(function (res) {
          if (res.error) throw res.error;
          var item = { id: obj.name, name: obj.name, products: products.slice(), _rows: (res.data || []).map(function (r) { return r.id; }) };
          self.state.businessUnits.push(item);
          self.notify();
          return { ok: true, item: item };
        })
        .catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    },
    _createApprovalStep: function (obj) {
      var self = this;
      var payload = {
        workspace_id: this.workspaceId,
        variant_id: obj.variantId || null, content_item_id: obj.contentItemId || null, campaign_id: obj.campaignId || null,
        name: obj.note || 'Yêu cầu duyệt nội dung', approver_id: null, status: 'pending'
      };
      return this.supabaseClient.from('approval_steps').insert(payload).select().single()
        .then(function (res) {
          if (res.error) throw res.error;
          return self._refreshCollections(['approvals']).then(function () {
            var item = self.get('approvals', res.data.id);
            return { ok: true, item: item || res.data };
          });
        })
        .catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    },

    update: function (collection, id, patch) {
      if (collection === 'variants') return this.updateVariant(id, patch);
      if (this.mode === 'supabase') return this._updateRemote(collection, id, patch || {});
      var item = this.get(collection, id);
      if (!item) return { ok: false, error: 'Không tìm thấy bản ghi ' + id };
      Object.assign(item, patch);
      this.notify();
      return { ok: true, item: item };
    },
    _updateRemote: function (collection, id, patch) {
      var self = this;
      if (collection === 'members') return Promise.resolve({ ok: false, error: 'Chỉ Owner sửa membership (vai trò) — thao tác này làm ở Supabase Dashboard / Edge Function mời thành viên.' });
      if (collection === 'reportSnapshots') return Promise.resolve({ ok: false, error: 'Báo cáo đã chốt là snapshot đóng băng — không sửa được.' });
      if (collection === 'businessUnits') return this._updateBusinessUnit(id, patch);
      var item = this.get(collection, id);
      if (!item) return Promise.resolve({ ok: false, error: 'Không tìm thấy bản ghi ' + id });
      if (collection === 'approvals') return this._updateApproval(collection, item, patch);
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) return Promise.resolve({ ok: false, error: 'Collection chưa được ánh xạ: ' + collection });
      var effectivePatch = patch;
      if (collection === 'tasks' && patch.status !== undefined && patch.completedAt === undefined) {
        effectivePatch = Object.assign({}, patch, { completedAt: patch.status === 'completed' ? (item.completedAt || new Date().toISOString()) : null });
      }
      // Khóa lạc quan AC09 (buildOptimisticUpdate ở store-core): chỉ khóa khi
      // bảng có updated_at và bản đang giữ có mốc đó; payload mang updated_at mới.
      var useLock = !!(Core && item.updatedAt && Core.hasColumn(table, 'updated_at') &&
        Core.buildOptimisticUpdate(collection, effectivePatch, item));
      var payload = this._toPayload(collection, effectivePatch, {});
      delete payload.id; delete payload.created_at; delete payload.created_by; delete payload.workspace_id;
      if (Core.hasColumn(table, 'updated_at')) payload.updated_at = new Date().toISOString();
      if (!Object.keys(payload).length) return Promise.resolve({ ok: true, item: item });
      var q = this.supabaseClient.from(table).update(payload).eq('id', id);
      if (useLock) q = q.eq('updated_at', item.updatedAt);
      return q.select().then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        if (!rows.length) {
          // 0 dòng khớp với updated_at cũ → xung đột: nạp lại bản server, KHÔNG ghi đè.
          return self._reloadOne(collection, id).then(function () {
            return { ok: false, conflict: true, error: 'Bản ghi đã bị người khác sửa. Đã tải lại bản mới nhất từ server — hãy kiểm tra lại rồi thử lại.' };
          });
        }
        var fresh = self._rowToItem(collection, rows[0]);
        self._replaceInState(collection, fresh);
        // KPI: actual ghi thành measurement mới.
        if (collection === 'kpis' && patch.actual != null) {
          return self.supabaseClient.from('measurements').insert({
            workspace_id: self.workspaceId, kpi_id: id, value: Number(patch.actual), source: 'manual', created_by: self.currentUserId
          }).then(function () { fresh.actual = Number(patch.actual); self.notify(); return { ok: true, item: fresh }; },
                  function () { self.notify(); return { ok: true, item: fresh }; });
        }
        if (collection === 'externalPosts' && patch.campaignId) {
          return self.supabaseClient.from('post_content_mappings').insert({
            workspace_id: self.workspaceId, external_post_id: id, campaign_id: patch.campaignId,
            mapping_source: 'manual', created_by: self.currentUserId
          }).then(function () { fresh.campaignId = patch.campaignId; self.notify(); return { ok: true, item: fresh }; },
                  function () { self.notify(); return { ok: true, item: fresh }; });
        }
        self.notify();
        return { ok: true, item: fresh };
      }).catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    },
    _updateApproval: function (collection, item, patch) {
      // Sửa yêu cầu duyệt = sửa approval_steps (quyết định duyệt đi qua decideApproval).
      var self = this;
      var payload = {};
      if (patch.note !== undefined) payload.name = patch.note;
      if (patch.status !== undefined && ['pending', 'approved', 'rejected', 'skipped', 'cancelled'].indexOf(patch.status) !== -1) payload.status = patch.status;
      payload.updated_at = new Date().toISOString();
      return this.supabaseClient.from('approval_steps').update(payload).eq('id', item.id).select()
        .then(function (res) {
          if (res.error) throw res.error;
          return self._refreshCollections(['approvals']).then(function () {
            return { ok: true, item: self.get('approvals', item.id) };
          });
        })
        .catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    },
    _updateBusinessUnit: function (id, patch) {
      var self = this;
      var bu = this.get('businessUnits', id);
      if (!bu) return Promise.resolve({ ok: false, error: 'Không tìm thấy BU ' + id });
      var newName = patch.name || bu.name;
      return this.supabaseClient.from('bu_products').update({ bu_name: newName }).eq('workspace_id', this.workspaceId).eq('bu_name', bu.name)
        .then(function (res) {
          if (res.error) throw res.error;
          bu.name = newName; bu.id = newName;
          if (patch.products) bu.products = patch.products;
          self.notify();
          return { ok: true, item: bu };
        })
        .catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    },
    _reloadOne: function (collection, id) {
      var self = this;
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) return Promise.resolve(null);
      return this.supabaseClient.from(table).select('*').eq('id', id).limit(1).then(function (res) {
        if (res.data && res.data.length) self._replaceInState(collection, self._rowToItem(collection, res.data[0]));
        self.notify();
        return null;
      }).catch(function () { return null; });
    },
    _replaceInState: function (collection, fresh) {
      var list = this.state[collection] || [];
      var idx = list.findIndex(function (x) { return x.id === fresh.id; });
      if (idx !== -1) list[idx] = fresh; else list.push(fresh);
      this.state[collection] = list;
    },

    remove: function (collection, id) {
      if (this.mode === 'supabase') return this._removeRemote(collection, id);
      if (!this.state[collection]) return { ok: false };
      this.state[collection] = this.state[collection].filter(function (x) { return x.id !== id; });
      this.notify();
      return { ok: true };
    },
    _removeRemote: function (collection, id) {
      var self = this;
      if (collection === 'members') return Promise.resolve({ ok: false, error: 'Chỉ Owner xoá/ngừng membership — thao tác này làm ở Supabase Dashboard / Edge Function mời thành viên.' });
      if (collection === 'reportSnapshots') return Promise.resolve({ ok: false, error: 'Báo cáo đã chốt không xoá được (snapshot đóng băng).' });
      if (collection === 'businessUnits') {
        var bu = this.get('businessUnits', id);
        if (!bu) return Promise.resolve({ ok: false });
        return this.supabaseClient.from('bu_products').delete().eq('workspace_id', this.workspaceId).eq('bu_name', bu.name)
          .then(function (res) {
            if (res.error) throw res.error;
            self.state.businessUnits = self.state.businessUnits.filter(function (x) { return x.id !== id; });
            self.notify();
            return { ok: true };
          }).catch(function (err) { return { ok: false, error: friendlyError(err) }; });
      }
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) return Promise.resolve({ ok: false, error: 'Collection chưa được ánh xạ: ' + collection });
      var softCol = Core ? Core.SOFT_DELETE_COLUMNS[table] : null;
      var op;
      if (softCol && Core.hasColumn(table, softCol)) {
        var patch = {}; patch[softCol] = new Date().toISOString();
        op = this.supabaseClient.from(table).update(patch).eq('id', id);
      } else {
        // Các bảng nghiệp vụ không có archived_at/deleted_at → xoá thật.
        op = this.supabaseClient.from(table).delete().eq('id', id);
      }
      return op.then(function (res) {
        if (res.error) throw res.error;
        self.state[collection] = (self.state[collection] || []).filter(function (x) { return x.id !== id; });
        self.notify();
        return { ok: true };
      }).catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    },

    /**
     * Cập nhật variant. Rule quan trọng: sửa caption của variant ĐÃ duyệt
     * thì approval tự hạ về "Cần duyệt lại" và job đăng liên quan bị tạm dừng.
     * Ở chế độ supabase, rule này do trigger DB (0003) đảm nhiệm
     * (approval_status → needs_review + hủy publish_jobs queued); Store tạo
     * thêm một yêu cầu duyệt mới và nạp lại publishJobs/approvals để khớp.
     */
    updateVariant: function (id, patch) {
      if (this.mode === 'supabase') return this._updateVariantRemote(id, patch || {});
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
        this.state.approvals.push({
          id: uid('approval'), variantId: id, contentItemId: v.contentItemId, revision: v.revision || 1,
          status: 'pending', statusLabel: 'Chờ duyệt', requestedBy: this.currentUserId,
          requestedAt: new Date().toISOString(), note: note
        });
      }
      this.notify();
      return { ok: true, item: v, note: note };
    },
    _updateVariantRemote: function (id, patch) {
      var self = this;
      var v = this.get('variants', id);
      if (!v) return Promise.resolve({ ok: false, error: 'Không tìm thấy variant ' + id });
      var captionChanged = patch.caption !== undefined && patch.caption !== v.caption;
      var wasApproved = v.approvalStatus === 'approved';
      var mainPatch = Object.assign({}, patch);
      var tiktokPatch = null;
      if (v.platform === 'tiktok' && (patch.hook !== undefined || patch.cta !== undefined || patch.scriptScenes !== undefined || patch.externalUrl !== undefined)) {
        tiktokPatch = {
          workspace_id: this.workspaceId, variant_id: id,
          hook: patch.hook != null ? patch.hook : (v.hook || null),
          cta: patch.cta != null ? patch.cta : (v.cta || null),
          scenes: (patch.scriptScenes || v.scriptScenes || []).map(function (s) {
            return { shot: s.shot, visual: s.visual, dialogue: s.dialogue, on_screen_text: s.onScreenText, duration_sec: s.durationSec };
          }),
          caption: patch.caption != null ? patch.caption : (v.caption || null),
          external_url: patch.externalUrl != null ? patch.externalUrl : (v.externalUrl || null),
          updated_at: new Date().toISOString()
        };
      }
      var result = this._updateRemote('variants', id, mainPatch);
      return result.then(function (res) {
        if (!res.ok) return res;
        var jobs = [];
        if (tiktokPatch) {
          jobs.push(self.supabaseClient.from('tiktok_scripts').upsert(tiktokPatch, { onConflict: 'variant_id' })
            .then(function () { return null; }, function () { return null; }));
        }
        if (captionChanged && wasApproved) {
          res.note = 'Caption đã đổi sau khi duyệt: approval hạ về "Cần duyệt lại".';
          jobs.push(self._createApprovalStep({ variantId: id, contentItemId: v.contentItemId, note: res.note }));
        }
        return Promise.all(jobs).then(function () {
          return self._refreshCollections(['publishJobs']).then(function () {
            return self._refreshCollections(['approvals']).then(function () { return res; });
          });
        });
      });
    },

    /** Quyết định duyệt nội dung, gắn với đúng revision của variant. */
    decideApproval: function (approvalId, decision, note) {
      if (this.mode === 'supabase') return this._decideApprovalRemote(approvalId, decision, note);
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
    _decideApprovalRemote: function (approvalId, decision, note) {
      var self = this;
      if (!this.can('approve')) return Promise.resolve({ ok: false, error: 'Vai trò hiện tại không có quyền duyệt nội dung.' });
      var a = this.get('approvals', approvalId);
      if (!a) return Promise.resolve({ ok: false, error: 'Không tìm thấy yêu cầu duyệt.' });
      if (a._kind === 'decision') return Promise.resolve({ ok: false, error: 'Yêu cầu này đã có quyết định rồi.' });
      var v = this.get('variants', a.variantId);
      if (!v) return Promise.resolve({ ok: false, error: 'Không tìm thấy variant của yêu cầu duyệt.' });
      // Quyết định phải gắn 1 revision cụ thể: lấy revision mới nhất, chưa có thì chốt revision hiện tại.
      return this.supabaseClient.from('content_revisions').select('*')
        .eq('variant_id', v.id).order('revision_no', { ascending: false }).limit(1)
        .then(function (res) {
          if (res.error) throw res.error;
          if (res.data && res.data.length) return res.data[0];
          var revNo = (self._revisionByVariant && self._revisionByVariant[v.id]) || v.revision || 1;
          return self.supabaseClient.from('content_revisions').insert({
            workspace_id: self.workspaceId, variant_id: v.id, revision_no: revNo,
            caption: v.caption || null, media_asset_ids: v.mediaAssetIds || [],
            link_url: v.linkUrl || null, visibility: v.visibility || 'public',
            snapshot: { caption: v.caption || null }, created_by: self.currentUserId
          }).select().single().then(function (ins) {
            if (ins.error) throw ins.error;
            return ins.data;
          });
        })
        .then(function (revision) {
          return self.supabaseClient.from('approval_decisions').insert({
            workspace_id: self.workspaceId, step_id: a._kind === 'step' || a._kind === 'step+decision' ? a.id : null,
            variant_id: v.id, revision_id: revision.id, decision: decision,
            decided_by: self.currentUserId, comment: note || null
          }).select().single().then(function (ins) { if (ins.error) throw ins.error; return revision; });
        })
        .then(function (revision) {
          // Cập nhật bước duyệt (nếu có) + trạng thái variant.
          var jobs = [];
          if (a._kind === 'step' || a._kind === 'step+decision') {
            var stepStatus = decision === 'approved' ? 'approved' : (decision === 'rejected' ? 'rejected' : 'pending');
            jobs.push(self.supabaseClient.from('approval_steps').update({ status: stepStatus, updated_at: new Date().toISOString() }).eq('id', a.id)
              .then(function () { return null; }, function () { return null; }));
          }
          var variantPatch = {};
          if (decision === 'approved') {
            variantPatch = { approvalStatus: 'approved', editorialStatus: 'approved' };
            jobs.push(self.supabaseClient.from('content_variants')
              .update({ approved_revision_id: revision.id }).eq('id', v.id)
              .then(function () { return null; }, function () { return null; }));
          } else if (decision === 'changes_requested') {
            variantPatch = { approvalStatus: 'changes_requested', editorialStatus: 'draft' };
          } else if (decision === 'rejected') {
            variantPatch = { approvalStatus: 'rejected', editorialStatus: 'draft' };
          }
          jobs.push(self._updateRemote('variants', v.id, variantPatch));
          return Promise.all(jobs);
        })
        .then(function () {
          return self._refreshCollections(['approvals']).then(function () {
            return { ok: true, item: self.get('approvals', approvalId) || a };
          });
        })
        .catch(function (err) { return { ok: false, error: friendlyError(err) }; });
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
      return this._createPublishJobRemote(v);
    },
    _createPublishJobRemote: function (v) {
      var self = this;
      if (!v.channelAccountId) {
        return Promise.resolve({ ok: false, error: 'Variant chưa gắn tài khoản kênh nên chưa thể tạo job đăng. Hãy gắn Channel Account cho variant trước.' });
      }
      return this.supabaseClient.from('content_revisions').select('*')
        .eq('variant_id', v.id).order('revision_no', { ascending: false }).limit(1)
        .then(function (res) {
          if (res.error) throw res.error;
          if (res.data && res.data.length) return res.data[0];
          var revNo = v.revision || 1;
          return self.supabaseClient.from('content_revisions').insert({
            workspace_id: self.workspaceId, variant_id: v.id, revision_no: revNo,
            caption: v.caption || null, media_asset_ids: v.mediaAssetIds || [],
            link_url: v.linkUrl || null, visibility: v.visibility || 'public',
            snapshot: { caption: v.caption || null }, created_by: self.currentUserId
          }).select().single().then(function (ins) { if (ins.error) throw ins.error; return ins.data; });
        })
        .then(function (revision) {
          var platformDb = Core && Core.PLATFORM_TO_DB[String(v.platform || '').toLowerCase()] || v.platform;
          var snapshot = {
            caption: v.caption || null,
            media_asset_ids: v.mediaAssetIds || [],
            channel_account_id: v.channelAccountId,
            platform: platformDb,
            approval: { revision_id: revision.id },
            destinations: [{ channel_account_id: v.channelAccountId, platform: platformDb }]
          };
          return self.supabaseClient.from('publish_jobs').insert({
            workspace_id: self.workspaceId, variant_id: v.id, revision_id: revision.id,
            channel_account_id: v.channelAccountId, platform: platformDb,
            idempotency_key: 'job-' + v.id + '-' + revision.id + '-' + Date.now().toString(36),
            snapshot: snapshot, status: 'queued',
            scheduled_at: v.scheduledAt || null,
            authorized_by: self.currentUserId, created_by: self.currentUserId
          }).select().single();
        })
        .then(function (res) {
          if (res.error) throw res.error;
          var item = self._rowToItem('publishJobs', res.data);
          self.state.publishJobs.push(item);
          self.notify();
          return { ok: true, item: item };
        })
        .catch(function (err) { return { ok: false, error: friendlyError(err) }; });
    }
  };

  global.SAVA_STORE = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
