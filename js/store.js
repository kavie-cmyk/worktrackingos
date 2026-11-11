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

  /**
   * Ma trận quyền DÙNG CHUNG (R32): nguồn sự thật là PERMISSIONS ở
   * store-core (actions dạng 'task.updateStatus', 'approval.decide'…).
   * PERMISSIONS ở đây chỉ là bản chiếu legacy (read/edit/approve…) suy ra
   * từ matrix chung để app cũ + bảng quyền ở Thiết lập vẫn đọc được —
   * KHÔNG định nghĩa riêng, tránh demo/real lệch nhau.
   */
  var PERMISSIONS = {};
  ['owner', 'lead', 'member', 'ceo'].forEach(function (role) {
    var legacy = {};
    Object.keys(Core && Core.LEGACY_PERMISSION_MAP || {}).forEach(function (k) {
      legacy[k] = Core ? Core.canRole(role, k) : false;
    });
    // publish là legacy không nằm trong LEGACY_PERMISSION_MAP (map sang publish.create ở can()).
    legacy.publish = Core ? Core.canRole(role, 'publish.create') : false;
    PERMISSIONS[role] = legacy;
  });
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
    /**
     * R13 — Trạng thái tải theo collection:
     * loadState[collection] = { status:'idle|loading|ready|error|denied|empty|stale',
     *   error:(string|null), updatedAt:(ISO|null — lần tải THÀNH CÔNG gần nhất) }.
     * App đọc qua Store.getLoadState(collection) / Store.loadState.
     * Lỗi refresh khi đã có dữ liệu cũ → status 'stale' + giữ nguyên dữ liệu cũ.
     */
    loadState: {},
    _postMappings: [],
    getLoadState: function (collection) {
      return this.loadState[collection] || { status: 'idle', error: null, updatedAt: null };
    },
    _setLoadState: function (collection, status, error) {
      var prev = this.loadState[collection] || { status: 'idle', error: null, updatedAt: null };
      this.loadState[collection] = {
        status: status,
        error: error ? friendlyError(error) : null,
        updatedAt: (status === 'ready' || status === 'empty') ? new Date().toISOString() : prev.updatedAt
      };
    },
    _isDeniedError: function (err) {
      if (!err) return false;
      var code = String(err.code || err.status || '');
      return code === '403' || code === '42501' || /row-level security|permission denied|42501/i.test(String(err.message || err));
    },
    _loadFailed: function (collection, err) {
      var hasOld = (this.state[collection] || []).length > 0;
      this._setLoadState(collection, hasOld ? 'stale' : (this._isDeniedError(err) ? 'denied' : 'error'), err);
    },
    // ======================================================================
    // R12 — Helper gọi Supabase DUY NHẤT: mọi đường ghi/đọc qua đây đều kiểm
    // res.error; requireRows=true thì 0 dòng cũng là lỗi (phân biệt quyền/xoá).
    // _attempt không throw: trả {ok:true,data} | {ok:false, failedStep, error}.
    // ======================================================================
    _attempt: function (step, query, opts) {
      opts = opts || {};
      return Promise.resolve(query).then(function (res) {
        if (!res || res.error) {
          var e = (res && res.error) || new Error('Không nhận được phản hồi từ server.');
          return { ok: false, failedStep: step, error: friendlyError(e), code: e.code || null };
        }
        if (opts.requireRows && (!res.data || (Array.isArray(res.data) && !res.data.length))) {
          return { ok: false, failedStep: step, code: 'no_rows', error: 'Thao tác không ảnh hưởng bản ghi nào — bản ghi có thể đã bị xoá, đã archive hoặc vai trò hiện tại không có quyền ghi.' };
        }
        return { ok: true, data: res.data };
      }).catch(function (err) {
        return { ok: false, failedStep: step, error: friendlyError(err), code: err && err.code || null };
      });
    },
    /** RPC dùng chung: kiểm error, trả {ok, data} | {ok:false, failedStep, error, code}. */
    _rpc: function (name, args) {
      if (!this.supabaseClient || !this.supabaseClient.rpc) {
        return Promise.resolve({ ok: false, failedStep: 'rpc.' + name, error: 'Chưa kết nối Supabase nên chưa gọi được RPC ' + name + '.' });
      }
      return this._attempt('rpc.' + name, this.supabaseClient.rpc(name, args || {}));
    },

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
    /** Kiểm tra quyền theo vai trò hiện tại — nhận cả action mới lẫn tên legacy. */
    can: function (perm) {
      if (Core && Core.canRole) return Core.canRole(this.currentRole(), perm);
      return !!((PERMISSIONS[this.currentRole()] || {})[perm]);
    },
    canRole: function (role, perm) {
      if (Core && Core.canRole) return Core.canRole(role, perm);
      return !!((PERMISSIONS[role] || {})[perm]);
    },
    /** Action cần cho 1 thao tác ghi (dùng chung guard demo & remote). */
    _actionFor: function (collection, patch, op) {
      patch = patch || {};
      var keys = Object.keys(patch);
      switch (collection) {
        case 'tasks': return (op === 'update' && keys.length && keys.every(function (k) { return k === 'status' || k === 'statusLabel'; })) ? 'task.updateStatus' : 'task.edit';
        case 'dependencies': case 'blockers': return 'task.edit';
        case 'campaigns': case 'phases': case 'activities': return 'campaign.edit';
        case 'variants': case 'contentItems': return 'content.edit';
        case 'brandPages': case 'brandAssets': return 'asset.edit';
        case 'budgetLines': case 'commitments': case 'actuals': return 'budget.edit';
        case 'kpis': return 'kpi.edit';
        case 'approvals': return op === 'create' ? 'content.edit' : 'approval.decide';
        case 'adChangeRequests': return (op === 'update' && patch.status !== undefined) ? 'ads.approve' : 'ads.draft';
        case 'publishJobs': return 'publish.create';
        case 'members': case 'businessUnits': return 'settings.manage';
        default: return 'data.edit';
      }
    },
    /** Guard quyền: trả {ok:false,error} khi vai hiện tại không có action, else null. */
    _guard: function (collection, patch, op) {
      var action = this._actionFor(collection, patch, op);
      if (this.can(action)) return null;
      return { ok: false, error: 'Vai trò hiện tại (' + this.currentRole() + ') không có quyền "' + action + '".', action: action };
    },
    /** Validation dùng chung (store-core.validateEntity + parent/dependency cycle). */
    _validate: function (collection, obj, existing) {
      if (Core && Core.validateEntity) {
        var r = Core.validateEntity(collection, obj || {}, existing || null);
        if (!r.ok) return { ok: false, error: r.error, errors: r.errors };
      }
      var merged = Object.assign({}, existing || {}, obj || {});
      if (collection === 'tasks' && merged.parentId) {
        var tasks = (this.state.tasks || []).map(function (t) { return t.id === merged.id ? merged : t; });
        if (Core && Core.wouldCreateParentCycle(tasks, merged.id, merged.parentId)) {
          return { ok: false, error: 'Không gán được: quan hệ cha–con này tạo vòng.' };
        }
      }
      if (collection === 'dependencies' && merged.predecessorId && merged.successorId) {
        var Domain = global.SAVA_DOMAIN;
        var edges = (this.state.dependencies || []).filter(function (e) { return e.id !== merged.id; });
        var cyclic = Domain && Domain.wouldCreateCycle ? Domain.wouldCreateCycle(edges, merged.predecessorId, merged.successorId)
          : merged.predecessorId === merged.successorId;
        if (cyclic) return { ok: false, error: 'Không thêm được: quan hệ phụ thuộc này tạo vòng.' };
      }
      return null;
    },

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
      COLLECTIONS.forEach(function (k) { this.state[k] = []; this.loadState[k] = { status: 'idle', error: null, updatedAt: null }; }.bind(this));
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
            .then(function (ins) { if (ins && ins.error) self.state.profileError = friendlyError(ins.error); return null; },
                  function (err) { self.state.profileError = friendlyError(err); return null; });
        })
        .catch(function (err) { self.state.profileError = friendlyError(err); return null; });
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
      this._setLoadState(collection, 'loading', null);
      return this._fetchWorkspaceTable(table).then(function (rows) {
        self.state[collection] = rows.map(function (r) { return self._rowToItem(collection, r); });
        self._setLoadState(collection, self.state[collection].filter(function (x) { return !x.archivedAt; }).length ? 'ready' : 'empty', null);
      }).catch(function (err) { self._loadFailed(collection, err); });
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
          self._setLoadState('members', memberships.length ? 'ready' : 'empty', null);
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
      }).catch(function (err) { self._loadFailed('members', err); });
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
        self._setLoadState('businessUnits', order.length ? 'ready' : 'empty', null);
      }).catch(function (err) { self._loadFailed('businessUnits', err); });
    },
    _loadApprovals: function () {
      var self = this;
      return Promise.all([
        this._fetchWorkspaceTable('approval_steps'),
        this._fetchWorkspaceTable('approval_decisions'),
        this._fetchWorkspaceTable('content_revisions')
      ]).then(function (results) {
        var steps = results[0], decisions = results[1], revisions = results[2];
        var revNoById = {}; var revNoByVariant = {}; var revIdByVariant = {};
        revisions.forEach(function (r) {
          revNoById[r.id] = r.revision_no; revIdByVariant[r.variant_id] = (!revIdByVariant[r.variant_id] || r.revision_no > (revNoById[revIdByVariant[r.variant_id]] || 0)) ? r.id : revIdByVariant[r.variant_id];
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
        self._setLoadState('approvals', items.length ? 'ready' : 'empty', null);
      }).catch(function (err) { self._loadFailed('approvals', err); });
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
        this._fetchWorkspaceTable('content_revisions').catch(function (err) { self._loadFailed('variants', err); return []; }),
        this._fetchWorkspaceTable('tiktok_scripts').catch(function (err) { self._loadFailed('variants', err); return []; })
      ]).then(function (res) {
        var revMax = {};
        res[0].forEach(function (r) { if (!revMax[r.variant_id] || r.revision_no > revMax[r.variant_id]) revMax[r.variant_id] = r.revision_no; });
        self._revisionByVariant = revMax;
        var scripts = {};
        res[1].forEach(function (s) { scripts[s.variant_id] = s; });
        (self.state.variants || []).forEach(function (v) {
          v.revision = revMax[v.id] || 1;
          var cur = res[0].find(function (r) { return r.id === v.currentRevisionId; });
          if (cur) v.revision = cur.revision_no;
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
        self._postMappings = maps.slice();
        var byPost = {};
        maps.forEach(function (m) { if (!byPost[m.external_post_id]) byPost[m.external_post_id] = m; });
        (self.state.externalPosts || []).forEach(function (p) {
          var m = byPost[p.id]; if (!m) return;
          if (m.campaign_id) p.campaignId = m.campaign_id;
          if (m.variant_id) p.variantId = m.variant_id;
          if (m.content_item_id) p.contentItemId = m.content_item_id;
          p.mappingId = m.id;
        });
      }).catch(function (err) { self._loadFailed('externalPosts', err); }));
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
      }).catch(function (err) { self._loadFailed('kpis', err); }));
      // Ads: số liệu từ ads_insights theo external_id của từng cấp
      jobs.push(this._fetchWorkspaceTable('ads_insights').then(function (rows) {
        var byKey = {};
        rows.slice().sort(function (a, b) { return String(a.observed_at).localeCompare(String(b.observed_at)); })
          .forEach(function (r) { byKey[r.object_type + ':' + r.object_id] = r; });
        function merge(list, type) {
          (list || []).forEach(function (x) {
            var ins = byKey[type + ':' + x.externalId];
            if (!ins) return;
            x.spend = ins.spend != null ? Number(ins.spend) : null;
            x.impressions = ins.impressions != null ? Number(ins.impressions) : null;
            x.clicks = ins.clicks != null ? Number(ins.clicks) : null;
            x.results = ins.results != null ? Number(ins.results) : null;
            x.conversionValue = ins.conversion_value != null ? Number(ins.conversion_value) : null;
            x.level = x.level || ({ ad_account: 'account', ad_campaign: 'campaign', ad_group: 'adset', ad: 'ad' })[type] || type;
            x.adAccountId = x.adAccountId || (type === 'ad_account' ? x.id : null);
          });
        }
        merge(self.state.adAccounts, 'ad_account');
        merge(self.state.adCampaigns, 'ad_campaign');
        merge(self.state.adSets, 'ad_group');
        merge(self.state.ads, 'ad');
      }).catch(function (err) { self._loadFailed('ads', err); }));
      // Assets: version = max(asset_versions.version_no) — nguồn version thật (R17)
      jobs.push(this._fetchWorkspaceTable('asset_versions').then(function (rows) {
        var maxByAsset = {};
        rows.forEach(function (r) { if (!maxByAsset[r.asset_id] || r.version_no > maxByAsset[r.asset_id]) maxByAsset[r.asset_id] = r.version_no; });
        self._assetVersionById = maxByAsset;
        (self.state.brandAssets || []).forEach(function (a) { if (maxByAsset[a.id] != null) a.version = maxByAsset[a.id]; });
      }).catch(function (err) { self._loadFailed('brandAssets', err); }));
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
          // R17: status = trạng thái SỬ DỤNG (active/archived); approvalStatus tách riêng.
          // active KHÔNG còn bị dịch thành 'Approved'. version lấy từ asset_versions
          // ở _loadDerivedMerges (null cho tới khi merge xong — không hardcode 1).
          item.status = row.status || 'active';
          item.approvalStatus = row.approval_status || 'draft';
          item.version = (this._assetVersionById && this._assetVersionById[row.id]) || null;
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
          item.afterState = after;
          item.beforeState = row.before_state || null;
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
      // Giữ cờ explicit/currentItem cho các adapter riêng ở dưới đọc qua `options`.
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
          // R17: approval_status là cột riêng. Giá trị duyệt kiểu cũ
          // (Draft/In review/Approved) đi vào approval_status, KHÔNG vào status.
          var appr = obj.approvalStatus || obj.approval_status;
          if (appr !== undefined && appr !== null) payload.approval_status = String(appr).toLowerCase().replace(' ', '_');
          else if (obj.status !== undefined && ['Draft', 'In review', 'Approved'].indexOf(obj.status) !== -1) {
            payload.approval_status = { Draft: 'draft', 'In review': 'in_review', Approved: 'approved' }[obj.status];
            delete payload.status;
          }
          if (obj.usageStatus !== undefined) payload.status = obj.usageStatus;
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
          // R16: object_type PHẢI rõ đối tượng: có external post -> 'external_post';
          // chưa có post -> 'content_variant' với object_id = variantId.
          // (Không dùng 'channel_account' + variant id nữa.)
          if (!payload.object_type) payload.object_type = obj.objectType || (obj.externalPostId ? 'external_post' : (obj.variantId ? 'content_variant' : 'external_post'));
          if (!payload.object_id) payload.object_id = obj.objectId || obj.externalPostId || obj.variantId || '';
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
          // R19/QA24: partial update chỉ gửi field thực sửa; after_state chỉ khi
          // explicitProposal (options.explicitProposal hoặc patch._explicitProposal)
          // hoặc khi insert. Status-only patch không đụng after/before_state.
          var explicit = !!(options.explicitProposal || obj._explicitProposal || obj._proposalEdited);
          var partial = Core && Core.adChangePayload ? Core.adChangePayload(obj, options.currentItem || null, { forInsert: !!options.forInsert, explicitProposal: explicit }) : {};
          if (partial.after_state !== undefined) payload.after_state = partial.after_state; else delete payload.after_state;
          if (partial.target_external_id !== undefined) payload.target_external_id = partial.target_external_id;
          else if (!options.forInsert) delete payload.target_external_id;
          if (!options.forInsert) { delete payload.before_state; if (!explicit && obj.reason === undefined) delete payload.reason; }
          if (options.forInsert) {
            if (!payload.target_external_id) payload.target_external_id = obj.target || obj.title || '';
            if (!payload.target_type) payload.target_type = 'ad_campaign';
            if (!payload.change_type) payload.change_type = 'other';
            if (obj.title && !payload.reason) payload.reason = obj.title;
          }
          delete payload._explicit_proposal; delete payload._proposal_edited;
          break;
        }
        case 'externalPosts': {
          if (options.forInsert && !payload.source) payload.source = 'manual';
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
      this._postMappings = (source.postMappings || (this.state.externalPosts || []).filter(function (pp) { return pp.campaignId || pp.variantId; }).map(function (pp) {
        return { id: 'demo-map-' + pp.id, external_post_id: pp.id, campaign_id: pp.campaignId || null, variant_id: pp.variantId || null, content_item_id: pp.contentItemId || null, mapping_source: 'manual' };
      })).slice();
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
    list: function (collection, opts) {
      var rows = (this.state[collection] || []).slice();
      if (!(opts && opts.includeArchived)) rows = rows.filter(function (x) { return !x.archivedAt; });
      return rows;
    },
    get: function (collection, id) { return (this.state[collection] || []).find(function (x) { return x.id === id; }) || null; },

    create: function (collection, obj) {
      if (this.mode === 'supabase') return this._createRemote(collection, obj || {});
      // Demo dùng CÙNG guard quyền + validation như real (R32/R30).
      var guard = this._guard(collection, obj || {}, 'create');
      if (guard) return guard;
      var invalid = this._validate(collection, obj || {}, null);
      if (invalid) return invalid;
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
      // Gắn campaign trong demo cũng qua mapping (R15): giữ mapping ở _postMappings.
      if (collection === 'externalPosts' && item.campaignId) {
        this._postMappings.push({ id: uid('mapping'), external_post_id: item.id, campaign_id: item.campaignId, variant_id: item.variantId || null, content_item_id: item.contentItemId || null, mapping_source: 'manual' });
      }
      this.notify();
      return { ok: true, item: item };
    },
    _createRemote: function (collection, obj) {
      var self = this;
      if (!this.workspaceId) return Promise.resolve({ ok: false, error: 'Chưa xác định được workspace hiện hành.' });
      if (collection === 'members') {
        return Promise.resolve({ ok: false, error: 'Thành viên được thêm bằng lời mời của Owner (Supabase Auth + memberships), không tạo trực tiếp ở đây.' });
      }
      var guard = this._guard(collection, obj, 'create');
      if (guard) return Promise.resolve(guard);
      var invalid = this._validate(collection, obj, null);
      if (invalid) return Promise.resolve(invalid);
      if (collection === 'businessUnits') return this._createBusinessUnit(obj);
      if (collection === 'approvals') return this._createApprovalStep(obj);
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) return Promise.resolve({ ok: false, error: 'Collection chưa được ánh xạ lên bảng dữ liệu: ' + collection });
      var payload = this._toPayload(collection, obj, { forInsert: true, workspaceId: this.workspaceId });
      // ID do frontend tự sinh (không phải uuid) không gửi lên — để server sinh.
      if (payload.id && !isUuid(payload.id)) delete payload.id;
      // R12: bước chính qua _attempt — lỗi {error} resolved KHÔNG còn thành ok giả.
      return this._attempt(table + '.insert', this.supabaseClient.from(table).insert(payload).select().single())
        .then(function (main) {
          if (!main.ok) return main;
          var item = self._rowToItem(collection, main.data);
          if (!self.state[collection]) self.state[collection] = [];
          self.state[collection].push(item);
          if (collection === 'metricObservations' && item._manualEntry) self.state.manualMetricEntries.push(item);
          if (collection === 'manualMetricEntries') self.state.metricObservations.push(item);
          // Các bước phụ: lỗi → {ok:false, partial:true, failedStep} rõ ràng (R12).
          var secondary = null;
          if (collection === 'kpis' && obj.actual != null) {
            secondary = self._attempt('measurements.insert', self.supabaseClient.from('measurements').insert({
              workspace_id: self.workspaceId, kpi_id: main.data.id, value: Number(obj.actual),
              source: 'manual', created_by: self.currentUserId
            })).then(function (r) { if (r.ok) item.actual = Number(obj.actual); return r; });
          } else if (collection === 'externalPosts' && obj.campaignId) {
            secondary = self.setPostCampaign(main.data.id, obj.campaignId)
              .then(function (r) { if (r.ok) item.campaignId = obj.campaignId; return r; });
          } else if (collection === 'brandAssets') {
            // R17: tạo asset → asset_versions v1 là nguồn version thật.
            secondary = self._attempt('asset_versions.insert', self.supabaseClient.from('asset_versions').insert({
              workspace_id: self.workspaceId, asset_id: main.data.id, version_no: 1,
              storage_bucket: payload.storage_bucket || null, storage_path: payload.storage_path || null,
              external_url: payload.external_url || null, change_note: 'Phiên bản đầu tiên', created_by: self.currentUserId
            })).then(function (r) { if (r.ok) item.version = 1; return r; });
          }
          if (!secondary) { self.notify(); return { ok: true, item: item }; }
          return secondary.then(function (r) {
            self.notify();
            if (!r.ok) return { ok: false, partial: true, failedStep: r.failedStep, error: r.error, item: item };
            return { ok: true, item: item };
          });
        });
    },
    /**
     * R15 — Gắn/đổi/bỏ gắn campaign cho external post CHỈ qua
     * post_content_mappings (insert/update/delete). KHÔNG update external_posts.
     * campaignId=null → bỏ gắn (xoá mapping của post).
     */
    setPostCampaign: function (postId, campaignId) {
      var self = this;
      if (this.mode !== 'supabase') {
        var post = this.get('externalPosts', postId);
        if (!post) return { ok: false, error: 'Không tìm thấy bài đã đăng ' + postId };
        this._postMappings = (this._postMappings || []).filter(function (m) { return m.external_post_id !== postId; });
        post.campaignId = campaignId || null;
        if (campaignId) this._postMappings.push({ id: uid('mapping'), external_post_id: postId, campaign_id: campaignId, variant_id: post.variantId || null, content_item_id: post.contentItemId || null, mapping_source: 'manual' });
        this.notify();
        return { ok: true, item: post };
      }
      var del = this._attempt('post_content_mappings.delete', this.supabaseClient.from('post_content_mappings').delete().eq('external_post_id', postId));
      return del.then(function (r) {
        if (!r.ok) return r;
        self._postMappings = (self._postMappings || []).filter(function (m) { return m.external_post_id !== postId; });
        var post = self.get('externalPosts', postId);
        if (post) post.campaignId = campaignId || null;
        if (!campaignId) { self.notify(); return { ok: true, item: post || null }; }
        return self._attempt('post_content_mappings.insert', self.supabaseClient.from('post_content_mappings').insert({
          workspace_id: self.workspaceId, external_post_id: postId, campaign_id: campaignId,
          mapping_source: 'manual', created_by: self.currentUserId
        }).select().single()).then(function (ins) {
          if (!ins.ok) return ins;
          self._postMappings.push(ins.data);
          self.notify();
          return { ok: true, item: post || null, mapping: ins.data };
        });
      });
    },
    _createBusinessUnit: function (obj) {
      var self = this;
      var products = (obj.products && obj.products.length) ? obj.products : [obj.name];
      var rows = products.map(function (p) {
        return { workspace_id: self.workspaceId, bu_name: obj.name, name: p, status: 'active', created_by: self.currentUserId };
      });
      return this._attempt('bu_products.insert', this.supabaseClient.from('bu_products').insert(rows).select())
        .then(function (res) {
          if (!res.ok) return res;
          var item = { id: obj.name, name: obj.name, products: products.slice(), _rows: (res.data || []).map(function (r) { return r.id; }) };
          self.state.businessUnits.push(item);
          self.notify();
          return { ok: true, item: item };
        });
    },
    _createApprovalStep: function (obj) {
      var self = this;
      var payload = {
        workspace_id: this.workspaceId,
        variant_id: obj.variantId || null, content_item_id: obj.contentItemId || null, campaign_id: obj.campaignId || null,
        name: obj.note || 'Yêu cầu duyệt nội dung', approver_id: null, status: 'pending'
      };
      return this._attempt('approval_steps.insert', this.supabaseClient.from('approval_steps').insert(payload).select().single())
        .then(function (res) {
          if (!res.ok) return res;
          return self._refreshCollections(['approvals']).then(function () {
            var item = self.get('approvals', res.data.id);
            return { ok: true, item: item || res.data };
          });
        });
    },

    update: function (collection, id, patch) {
      if (collection === 'variants') return this.updateVariant(id, patch);
      if (this.mode === 'supabase') return this._updateRemote(collection, id, patch || {});
      var guard = this._guard(collection, patch || {}, 'update');
      if (guard) return guard;
      var item = this.get(collection, id);
      if (!item) return { ok: false, error: 'Không tìm thấy bản ghi ' + id };
      var invalid = this._validate(collection, patch || {}, item);
      if (invalid) return invalid;
      // R18 demo: custom_fields merge như DB trigger — field vào custom_fields
      // (deliverable…) hoặc patch.customFields đều merge, '__UNSET__' = xoá.
      var effective = Object.assign({}, patch);
      if (Core && Core.CUSTOM_FIELDS_TABLES[Core.COLLECTION_TO_TABLE[collection]]) {
        var cfPatch = {};
        Object.keys(effective).forEach(function (k) {
          if (k === 'customFields' || k === 'custom_fields') return;
          var snake = Core.camelToSnake(k);
          var table = Core.COLLECTION_TO_TABLE[collection];
          if (!Core.hasColumn(table, Core.FIELD_ALIASES[collection] && Core.FIELD_ALIASES[collection][k] || snake)) cfPatch[k] = effective[k];
        });
        if (effective.customFields) Object.assign(cfPatch, effective.customFields);
        if (Object.keys(cfPatch).length) item.customFields = Core.mergeCustomFields(item.customFields || {}, cfPatch);
      } else if (effective.customFields) {
        item.customFields = Core ? Core.mergeCustomFields(item.customFields || {}, effective.customFields) : effective.customFields;
      }
      delete effective.customFields;
      Object.assign(item, effective);
      // Đồng bộ các field đã gói vào customFields lên top-level như fromDbRow.
      if (item.customFields) Object.keys(item.customFields).forEach(function (k) { if (effective[k] !== undefined) item[k] = item.customFields[k]; });
      if (item.customFields) Object.keys(cfPatch || {}).forEach(function (k) { if (cfPatch[k] === '__UNSET__') delete item[k]; });
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
      var guard = this._guard(collection, patch, 'update');
      if (guard) return Promise.resolve(guard);
      var invalid = this._validate(collection, patch, item);
      if (invalid) return Promise.resolve(invalid);
      if (collection === 'approvals') return this._updateApproval(collection, item, patch);
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) return Promise.resolve({ ok: false, error: 'Collection chưa được ánh xạ: ' + collection });
      // R15: externalPosts — campaignId KHÔNG BAO GIỜ update lên external_posts;
      // chỉ thao tác post_content_mappings. Field khác của post (chỉ khi
      // source='manual') mới update bảng post, và là bước riêng/partial rõ ràng.
      if (collection === 'externalPosts') {
        var rest = Object.assign({}, patch); var hasCampaign = rest.campaignId !== undefined;
        delete rest.campaignId;
        var postStep = Object.keys(rest).length
          ? this._updateTableRow(collection, table, item, rest)
          : Promise.resolve({ ok: true, item: item });
        return postStep.then(function (r) {
          if (!r.ok) return r;
          if (!hasCampaign) return r;
          return self.setPostCampaign(id, patch.campaignId).then(function (m) {
            if (!m.ok) return { ok: false, partial: true, failedStep: m.failedStep, error: m.error, item: r.item };
            if (r.item) r.item.campaignId = patch.campaignId;
            return r;
          });
        });
      }
      return this._updateTableRow(collection, table, item, patch).then(function (r) {
        if (!r.ok) return r;
        var fresh = r.item;
        // Bước phụ (partial rõ ràng khi lỗi — R12):
        if (collection === 'kpis' && patch.actual != null) {
          return self._attempt('measurements.insert', self.supabaseClient.from('measurements').insert({
            workspace_id: self.workspaceId, kpi_id: id, value: Number(patch.actual), source: 'manual', created_by: self.currentUserId
          })).then(function (m) {
            if (!m.ok) return { ok: false, partial: true, failedStep: m.failedStep, error: m.error, item: fresh };
            fresh.actual = Number(patch.actual); self.notify();
            return { ok: true, item: fresh };
          });
        }
        if (collection === 'brandAssets') {
          // R17: sửa NỘI DUNG asset (đường dẫn/url/tên…) → asset_versions mới.
          var contentKeys = ['name', 'storagePath', 'storage_path', 'externalUrl', 'external_url', 'mimeType', 'sizeBytes'];
          var touchesContent = contentKeys.some(function (k) { return patch[k] !== undefined; });
          if (touchesContent) {
            var nextVer = (item.version || 0) + 1;
            return self._attempt('asset_versions.insert', self.supabaseClient.from('asset_versions').insert({
              workspace_id: self.workspaceId, asset_id: id, version_no: nextVer,
              storage_bucket: patch.storageBucket || item.storageBucket || null,
              storage_path: patch.storagePath || item.storagePath || null,
              external_url: patch.externalUrl || item.externalUrl || null,
              change_note: patch.changeNote || 'Cập nhật nội dung', created_by: self.currentUserId
            })).then(function (m) {
              if (!m.ok) return { ok: false, partial: true, failedStep: m.failedStep, error: m.error, item: fresh };
              fresh.version = nextVer; self.notify();
              return { ok: true, item: fresh };
            });
          }
        }
        return r;
      });
    },
    /**
     * Ghi 1 dòng qua REST với: khóa lạc quan AC09, R18 read-before-write cho
     * custom_fields (đọc bản hiện tại trên server, merge, '__UNSET__' = xoá),
     * và _attempt kiểm lỗi + row count. Dùng cho _updateRemote và các đường
     * update variant. Trả {ok,item} | {ok:false, failedStep|conflict, error}.
     */
    _updateTableRow: function (collection, table, item, patch, extraOptions) {
      var self = this;
      var effectivePatch = patch;
      if (collection === 'tasks' && patch.status !== undefined && patch.completedAt === undefined) {
        effectivePatch = Object.assign({}, patch, { completedAt: patch.status === 'completed' ? (item.completedAt || new Date().toISOString()) : null });
      }
      var needsCustomMerge = !!(Core && Core.CUSTOM_FIELDS_TABLES[table] && (
        patch.customFields || Object.keys(patch).some(function (k) {
          return !Core.hasColumn(table, (Core.FIELD_ALIASES[collection] || {})[k] || Core.camelToSnake(k)) && !Core.isLabelField(k);
        })));
      var basePromise = needsCustomMerge
        ? this._attempt(table + '.select.custom_fields', this.supabaseClient.from(table).select('custom_fields').eq('id', item.id).limit(1))
            .then(function (r) {
              // Đọc-trước-ghi thất bại thì DỪNG (không ghi đè mù custom_fields).
              if (!r.ok) return r;
              var serverCf = (r.data && r.data[0] && r.data[0].custom_fields) || {};
              var mergedBase = Core.mergeCustomFields(serverCf, {});
              return { ok: true, customBase: mergedBase };
            })
        : Promise.resolve({ ok: true, customBase: null });
      return basePromise.then(function (base) {
        if (!base.ok) return base;
        var opts = Object.assign({}, extraOptions || {}, { currentItem: item });
        var payloadPatch = effectivePatch;
        if (base.customBase) {
          // Base = custom_fields HIỆN TẠI trên server; patch.customFields merge
          // lên base (kèm '__UNSET__'); field lẻ của patch đi qua stash ở _toPayload.
          payloadPatch = Object.assign({}, effectivePatch, { customFields: Core.mergeCustomFields(base.customBase, effectivePatch.customFields || {}) });
        }
        var payload = self._toPayload(collection, payloadPatch, opts);
        delete payload.id; delete payload.created_at; delete payload.created_by; delete payload.workspace_id;
        if (Core.hasColumn(table, 'updated_at')) payload.updated_at = new Date().toISOString();
        if (!Object.keys(payload).length) return { ok: true, item: item };
        var useLock = !!(item.updatedAt && Core.hasColumn(table, 'updated_at') && Core.buildOptimisticUpdate(collection, effectivePatch, item));
        var q = self.supabaseClient.from(table).update(payload).eq('id', item.id);
        if (useLock) q = q.eq('updated_at', item.updatedAt);
        return self._attempt(table + '.update', q.select(), { requireRows: true }).then(function (res) {
          if (!res.ok) {
            if (res.code === 'no_rows' && useLock) {
              return self._reloadOne(collection, item.id).then(function () {
                return { ok: false, conflict: true, failedStep: res.failedStep, error: 'Bản ghi đã bị người khác sửa. Đã tải lại bản mới nhất từ server — hãy kiểm tra lại rồi thử lại.' };
              });
            }
            return res;
          }
          var fresh = self._rowToItem(collection, res.data[0]);
          // Giữ các field phái sinh không nằm trên dòng (vd campaignId qua mapping, actual KPI).
          if (item.campaignId !== undefined && fresh.campaignId === undefined) fresh.campaignId = item.campaignId;
          if (item.actual !== undefined && fresh.actual === undefined) fresh.actual = item.actual;
          if (item.version !== undefined && fresh.version == null) fresh.version = item.version;
          self._replaceInState(collection, fresh);
          self.notify();
          return { ok: true, item: fresh };
        });
      });
    },
    _updateApproval: function (collection, item, patch) {
      // Sửa yêu cầu duyệt = sửa approval_steps (quyết định duyệt đi qua decideApproval).
      var self = this;
      var payload = {};
      if (patch.note !== undefined) payload.name = patch.note;
      if (patch.status !== undefined && ['pending', 'approved', 'rejected', 'skipped', 'cancelled'].indexOf(patch.status) !== -1) payload.status = patch.status;
      payload.updated_at = new Date().toISOString();
      return this._attempt('approval_steps.update', this.supabaseClient.from('approval_steps').update(payload).eq('id', item.id).select(), { requireRows: true })
        .then(function (res) {
          if (!res.ok) return res;
          return self._refreshCollections(['approvals']).then(function () {
            return { ok: true, item: self.get('approvals', item.id) };
          });
        });
    },
    _updateBusinessUnit: function (id, patch) {
      var self = this;
      var bu = this.get('businessUnits', id);
      if (!bu) return Promise.resolve({ ok: false, error: 'Không tìm thấy BU ' + id });
      var newName = patch.name || bu.name;
      return this._attempt('bu_products.update', this.supabaseClient.from('bu_products').update({ bu_name: newName }).eq('workspace_id', this.workspaceId).eq('bu_name', bu.name))
        .then(function (res) {
          if (!res.ok) return res;
          bu.name = newName; bu.id = newName;
          if (patch.products) bu.products = patch.products;
          self.notify();
          return { ok: true, item: bu };
        });
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

    /**
     * R31 — remove = ARCHIVE (set archived_at) cho entity chính, demo và
     * remote cùng hành vi. list() mặc định lọc archived; restore() khôi phục.
     * Archive variant còn huỷ các publish_jobs đang chờ của variant đó.
     * Bảng không có archived_at (quan hệ/phụ) mới hard-delete qua _attempt.
     */
    remove: function (collection, id) {
      if (this.mode === 'supabase') return this._removeRemote(collection, id);
      var guard = this._guard(collection, {}, 'remove');
      if (guard) return guard;
      var item = this.get(collection, id);
      if (!item) return { ok: false, error: 'Không tìm thấy bản ghi ' + id };
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (Core && table && Core.ARCHIVABLE_TABLES[table]) {
        item.archivedAt = new Date().toISOString();
        if (collection === 'variants') this._cancelPendingJobsDemo(id);
        this.notify();
        return { ok: true, item: item, archived: true };
      }
      this.state[collection] = this.state[collection].filter(function (x) { return x.id !== id; });
      this.notify();
      return { ok: true };
    },
    _cancelPendingJobsDemo: function (variantId) {
      (this.state.publishJobs || []).forEach(function (job) {
        if (job.variantId === variantId && ['queued', 'unscheduled', 'scheduled'].indexOf(job.status) !== -1) {
          job.status = 'cancelled';
          job.cancelReason = 'Variant đã archive.';
        }
      });
    },
    restore: function (collection, id) {
      var item = this.get(collection, id);
      if (!item) return this.mode === 'supabase'
        ? Promise.resolve({ ok: false, error: 'Không tìm thấy bản ghi ' + id })
        : { ok: false, error: 'Không tìm thấy bản ghi ' + id };
      if (this.mode === 'supabase') {
        var self = this;
        var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
        if (!table || !(Core.ARCHIVABLE_TABLES || {})[table]) {
          return Promise.resolve({ ok: false, error: 'Collection này không hỗ trợ khôi phục (không có archived_at): ' + collection });
        }
        return this._attempt(table + '.restore', this.supabaseClient.from(table).update({ archived_at: null }).eq('id', id).select(), { requireRows: true })
          .then(function (res) {
            if (!res.ok) return res;
            var fresh = self._rowToItem(collection, res.data[0]);
            self._replaceInState(collection, fresh);
            self.notify();
            return { ok: true, item: fresh };
          });
      }
      delete item.archivedAt;
      this.notify();
      return { ok: true, item: item };
    },
    _removeRemote: function (collection, id) {
      var self = this;
      if (collection === 'members') return Promise.resolve({ ok: false, error: 'Chỉ Owner xoá/ngừng membership — thao tác này làm ở Supabase Dashboard / Edge Function mời thành viên.' });
      if (collection === 'reportSnapshots') return Promise.resolve({ ok: false, error: 'Báo cáo đã chốt không xoá được (snapshot đóng băng).' });
      if (collection === 'businessUnits') {
        var bu = this.get('businessUnits', id);
        if (!bu) return Promise.resolve({ ok: false });
        // bu_products có archived_at (0005): archive các dòng của BU.
        return this._attempt('bu_products.archive', this.supabaseClient.from('bu_products').update({ archived_at: new Date().toISOString() }).eq('workspace_id', this.workspaceId).eq('bu_name', bu.name))
          .then(function (res) {
            if (!res.ok) return res;
            var item = self.get('businessUnits', id);
            if (item) item.archivedAt = new Date().toISOString();
            self.notify();
            return { ok: true, archived: true };
          });
      }
      var table = Core ? Core.COLLECTION_TO_TABLE[collection] : null;
      if (!table) return Promise.resolve({ ok: false, error: 'Collection chưa được ánh xạ: ' + collection });
      if (Core && Core.ARCHIVABLE_TABLES[table]) {
        return this._attempt(table + '.archive', this.supabaseClient.from(table).update({ archived_at: new Date().toISOString() }).eq('id', id).select(), { requireRows: true })
          .then(function (res) {
            if (!res.ok) return res;
            var item = self.get(collection, id);
            if (item) item.archivedAt = new Date().toISOString();
            if (collection === 'variants') {
              // Huỷ publish_jobs đang chờ của variant (bước phụ — partial nếu lỗi).
              return self._attempt('publish_jobs.cancel', self.supabaseClient.from('publish_jobs')
                .update({ status: 'cancelled', cancel_reason: 'Variant đã archive.' })
                .eq('variant_id', id).in('status', ['queued', 'unscheduled']))
                .then(function (c) {
                  (self.state.publishJobs || []).forEach(function (job) {
                    if (job.variantId === id && ['queued', 'unscheduled', 'scheduled'].indexOf(job.status) !== -1) job.status = 'cancelled';
                  });
                  self.notify();
                  if (!c.ok) return { ok: false, partial: true, failedStep: c.failedStep, error: c.error, item: item, archived: true };
                  return { ok: true, item: item, archived: true };
                });
            }
            self.notify();
            return { ok: true, item: item, archived: true };
          });
      }
      // Bảng quan hệ/phụ không có archived_at → hard-delete (vẫn qua _attempt).
      return this._attempt(table + '.delete', this.supabaseClient.from(table).delete().eq('id', id))
        .then(function (res) {
          if (!res.ok) return res;
          self.state[collection] = (self.state[collection] || []).filter(function (x) { return x.id !== id; });
          self.notify();
          return { ok: true };
        });
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
      var guard = this._guard('variants', patch || {}, 'update');
      if (guard) return guard;
      var v = this.get('variants', id);
      if (!v) return { ok: false, error: 'Không tìm thấy variant ' + id };
      // R27 demo: sửa caption/media → revision MỚI (không ghi đè revision cũ).
      var contentChanged = this._variantContentChanged(v, patch);
      var wasApproved = v.approvalStatus === 'approved';
      Object.assign(v, patch);
      var note = null;
      if (contentChanged) {
        v.revision = (v.revision || 1) + 1;
        v.currentRevisionId = uid('revision');
        v.currentRevision = {
          id: v.currentRevisionId, revisionNo: v.revision,
          caption: v.caption || null, mediaAssetIds: v.mediaAssetIds || [],
          snapshot: { caption: v.caption || null, media_asset_ids: v.mediaAssetIds || [] }
        };
        if (!this.state.contentRevisions) this.state.contentRevisions = [];
        this.state.contentRevisions.push(Object.assign({ variantId: id }, v.currentRevision));
      }
      if (contentChanged && wasApproved) {
        v.approvalStatus = 'needs_reapproval';
        v.editorialStatus = 'in_review';
        note = 'Nội dung đã đổi sau khi duyệt: approval hạ về "Cần duyệt lại".';
        (this.state.publishJobs || []).forEach(function (job) {
          if (job.variantId === id && job.status !== 'paused' && job.status !== 'cancelled') {
            job.status = 'paused';
            job.note = (job.note ? job.note + ' ' : '') + 'Tạm dừng vì nội dung đổi sau khi duyệt — cần duyệt lại.';
          }
        });
        (this.state.approvals || []).forEach(function (a) {
          if (a.variantId === id && a.status === 'approved') { a.status = 'needs_reapproval'; a.statusLabel = 'Cần duyệt lại'; }
        });
        this.state.approvals.push({
          id: uid('approval'), variantId: id, contentItemId: v.contentItemId, revision: v.revision || 1,
          revisionId: v.currentRevisionId || null,
          status: 'pending', statusLabel: 'Chờ duyệt', requestedBy: this.currentUserId,
          requestedAt: new Date().toISOString(), note: note
        });
      }
      this.notify();
      return { ok: true, item: v, note: note };
    },
    _variantContentChanged: function (v, patch) {
      if (!patch) return false;
      if (patch.caption !== undefined && patch.caption !== v.caption) return true;
      if (patch.mediaAssetIds !== undefined && JSON.stringify(patch.mediaAssetIds || []) !== JSON.stringify(v.mediaAssetIds || [])) return true;
      if (patch.linkUrl !== undefined && patch.linkUrl !== v.linkUrl) return true;
      if (patch.visibility !== undefined && patch.visibility !== v.visibility) return true;
      return false;
    },
    _updateVariantRemote: function (id, patch) {
      var self = this;
      var v = this.get('variants', id);
      if (!v) return Promise.resolve({ ok: false, error: 'Không tìm thấy variant ' + id });
      var guard = this._guard('variants', patch, 'update');
      if (guard) return Promise.resolve(guard);
      var contentChanged = this._variantContentChanged(v, patch);
      var wasApproved = v.approvalStatus === 'approved';
      var tiktokPatch = null;
      if (v.platform === 'tiktok' && (patch.hook !== undefined || patch.cta !== undefined || patch.scriptScenes !== undefined || patch.externalUrl !== undefined)) {
        tiktokPatch = {
          workspace_id: this.workspaceId, variant_id: id,
          hook: patch.hook != null ? patch.hook : (v.hook || null),
          cta: patch.cta != null ? patch.cta : (v.cta || null),
          scenes: (patch.scriptScenes || v.scriptScenes || []).map(function (sc) {
            return { shot: sc.shot, visual: sc.visual, dialogue: sc.dialogue, on_screen_text: sc.onScreenText, duration_sec: sc.durationSec };
          }),
          caption: patch.caption != null ? patch.caption : (v.caption || null),
          external_url: patch.externalUrl != null ? patch.externalUrl : (v.externalUrl || null),
          updated_at: new Date().toISOString()
        };
      }
      // R27: nội dung đổi → tạo revision MỚI trước, rồi mới update variant +
      // current_revision_id. Revision insert lỗi → DỪNG, không update variant.
      var revisionStep = contentChanged ? this._createRevisionForVariant(v, patch) : Promise.resolve({ ok: true, revision: null });
      return revisionStep.then(function (revRes) {
        if (!revRes.ok) return revRes;
        var mainPatch = Object.assign({}, patch);
        if (revRes.revision) mainPatch.currentRevisionId = revRes.revision.id;
        return self._updateTableRow('variants', 'content_variants', v, mainPatch).then(function (res) {
          if (!res.ok) {
            if (revRes.revision) return { ok: false, partial: true, failedStep: 'content_variants.update', error: res.error, revision: revRes.revision };
            return res;
          }
          if (revRes.revision) { res.item.revision = revRes.revision.revision_no; res.item.currentRevisionId = revRes.revision.id; }
          var jobs = [];
          if (tiktokPatch) {
            jobs.push(self._attempt('tiktok_scripts.upsert', self.supabaseClient.from('tiktok_scripts').upsert(tiktokPatch, { onConflict: 'variant_id' })));
          }
          if (!jobs.length) return res;
          return Promise.all(jobs).then(function (results) {
            var failed = results.find(function (r) { return !r.ok; });
            if (failed) return { ok: false, partial: true, failedStep: failed.failedStep, error: failed.error, item: res.item };
            if (contentChanged && wasApproved) res.note = 'Nội dung đã đổi sau khi duyệt: approval hạ về "Cần duyệt lại" (trigger DB).';
            return self._refreshCollections(['publishJobs', 'approvals']).then(function () { return res; });
          });
        });
      });
    },
    /** Tạo content_revisions mới (revision_no+1, snapshot nội dung SAU sửa). */
    _createRevisionForVariant: function (v, patch) {
      var self = this;
      var nextNo = (v.revision || 1) + 1;
      // Nếu variant chưa từng có revision (revision=1 chỉ là nhãn hiển thị),
      // revision mới vẫn là bản chốt đầu tiên theo số đang hiển thị + 1 khi
      // đã có currentRevisionId; chưa có thì dùng số hiện tại làm revision 1.
      if (!v.currentRevisionId && !v.approvedRevisionId) nextNo = v.revision || 1;
      var caption = patch.caption !== undefined ? patch.caption : (v.caption || null);
      var media = patch.mediaAssetIds !== undefined ? patch.mediaAssetIds : (v.mediaAssetIds || []);
      var snapshot = {
        caption: caption, media_asset_ids: media,
        link_url: patch.linkUrl !== undefined ? patch.linkUrl : (v.linkUrl || null),
        visibility: patch.visibility !== undefined ? patch.visibility : (v.visibility || 'public')
      };
      snapshot.hash = Core ? Core.stableHash(snapshot) : null;
      return this._attempt('content_revisions.insert', this.supabaseClient.from('content_revisions').insert({
        workspace_id: this.workspaceId, variant_id: v.id, revision_no: nextNo,
        caption: caption, media_asset_ids: media,
        link_url: snapshot.link_url, visibility: snapshot.visibility,
        snapshot: snapshot, created_by: this.currentUserId
      }).select().single()).then(function (r) {
        if (!r.ok) return r;
        return { ok: true, revision: r.data };
      });
    },

    /**
     * R27 — Gửi duyệt qua RPC submit_for_review(p_variant_id).
     * Variant chưa có current_revision_id (remote) → chốt revision hiện tại
     * trước (đây là chốt nội dung, không phải quyết định duyệt).
     */
    submitReview: function (variantId) {
      var v = this.get('variants', variantId);
      if (!v) {
        var nf = { ok: false, error: 'Không tìm thấy variant ' + variantId };
        return this.mode === 'supabase' ? Promise.resolve(nf) : nf;
      }
      if (this.mode !== 'supabase') {
        var guard = this._guard('variants', {}, 'create');
        if (guard) return guard;
        if (!v.currentRevisionId) { v.currentRevisionId = uid('revision'); v.revision = v.revision || 1; }
        var step = {
          id: uid('approval'), variantId: variantId, contentItemId: v.contentItemId,
          revision: v.revision || 1, revisionId: v.currentRevisionId,
          status: 'pending', statusLabel: 'Chờ duyệt', requestedBy: this.currentUserId,
          requestedAt: new Date().toISOString(), note: ''
        };
        this.state.approvals.push(step);
        v.editorialStatus = 'in_review'; v.approvalStatus = 'pending';
        this.notify();
        return { ok: true, item: step };
      }
      var self = this;
      var ensure = v.currentRevisionId ? Promise.resolve({ ok: true }) : this._createRevisionForVariant(v, {}).then(function (r) {
        if (!r.ok) return r;
        return self._updateTableRow('variants', 'content_variants', v, { currentRevisionId: r.revision.id });
      });
      return ensure.then(function (e) {
        if (!e.ok) return e;
        return self._rpc('submit_for_review', { p_variant_id: variantId }).then(function (r) {
          if (!r.ok) return r;
          return self._refreshCollections(['approvals', 'variants']).then(function () { return { ok: true, item: r.data }; });
        });
      });
    },

    /**
     * R27 — Quyết định duyệt CHỈ qua RPC decide_approval.
     * decide(stepId, revisionId, decision, comment): revisionId là tham số
     * BẮT BUỘC lấy từ state đang hiển thị — store KHÔNG tự fetch latest.
     * RPC trả REVISION_MISMATCH → lỗi rõ "nội dung đã thay đổi, cần tải lại".
     */
    decide: function (stepId, revisionId, decision, comment) {
      if (!revisionId) {
        var missing = { ok: false, code: 'revision_required', error: 'Thiếu revisionId: quyết định duyệt phải gắn đúng revision đang hiển thị.' };
        return this.mode === 'supabase' ? Promise.resolve(missing) : missing;
      }
      if (this.mode === 'supabase') return this._decideRemote(stepId, revisionId, decision, comment);
      // Demo: cùng contract — revisionId phải khớp revision hiện hành của variant.
      var a = this.get('approvals', stepId);
      if (!a) return { ok: false, error: 'Không tìm thấy yêu cầu duyệt.' };
      return this.decideApproval(stepId, decision, comment, revisionId);
    },
    _decideRemote: function (stepId, revisionId, decision, comment) {
      var self = this;
      if (!this.can('approval.decide')) return Promise.resolve({ ok: false, error: 'Vai trò hiện tại không có quyền duyệt nội dung.' });
      return this._rpc('decide_approval', {
        p_step_id: stepId, p_revision_id: revisionId, p_decision: decision, p_comment: comment || null
      }).then(function (r) {
        if (!r.ok) {
          if (/REVISION_MISMATCH/i.test(r.error || '')) {
            return { ok: false, code: 'revision_mismatch', failedStep: r.failedStep, error: 'Nội dung đã thay đổi, cần tải lại trước khi duyệt.' };
          }
          return r;
        }
        return self._refreshCollections(['approvals', 'variants']).then(function () {
          return { ok: true, item: r.data, decision: r.data };
        });
      });
    },
    /**
     * Wrapper tương thích app cũ: decideApproval(approvalId, decision, note[, revisionId]).
     * revisionId không truyền → lấy từ approval item / variant TRONG STATE
     * đang hiển thị (revisionId của step, hoặc currentRevisionId của variant),
     * tuyệt đối không query latest từ server.
     */
    decideApproval: function (approvalId, decision, note, revisionId) {
      var a = this.get('approvals', approvalId);
      if (!a) {
        var nf = { ok: false, error: 'Không tìm thấy yêu cầu duyệt.' };
        return this.mode === 'supabase' ? Promise.resolve(nf) : nf;
      }
      var v = this.get('variants', a.variantId);
      var revId = revisionId || a.revisionId || (v && v.currentRevisionId) || null;
      if (this.mode === 'supabase') {
        if (a._kind === 'decision') return Promise.resolve({ ok: false, error: 'Yêu cầu này đã có quyết định rồi.' });
        if (!revId) return Promise.resolve({ ok: false, code: 'revision_required', error: 'Không xác định được revision đang hiển thị — hãy tải lại trang duyệt.' });
        return this.decide(a.id, revId, decision, note);
      }
      if (!this.can('approve')) return { ok: false, error: 'Vai trò hiện tại không có quyền duyệt nội dung.' };
      if (revId && v && v.currentRevisionId && revId !== v.currentRevisionId) {
        return { ok: false, code: 'revision_mismatch', error: 'Nội dung đã thay đổi, cần tải lại trước khi duyệt.' };
      }
      a.decidedBy = this.currentUserId;
      a.decidedAt = new Date().toISOString();
      a.note = note || a.note || '';
      a.decisionId = uid('decision');
      if (decision === 'approved') {
        a.status = 'approved'; a.statusLabel = 'Chấp thuận';
        if (v) { v.approvalStatus = 'approved'; v.editorialStatus = 'approved'; v.approvedRevisionId = revId; v.decisionId = a.decisionId; }
      } else if (decision === 'changes_requested') {
        a.status = 'changes_requested'; a.statusLabel = 'Yêu cầu chỉnh sửa';
        if (v) { v.approvalStatus = 'changes_requested'; v.editorialStatus = 'draft'; }
      } else if (decision === 'rejected') {
        a.status = 'rejected'; a.statusLabel = 'Từ chối';
        if (v) { v.approvalStatus = 'rejected'; v.editorialStatus = 'draft'; }
      }
      this.notify();
      return { ok: true, item: a, decisionId: a.decisionId };
    },

    /**
     * R16 — Lưu metric TikTok cho 1 variant:
     * tìm external_post đã map với content_item của variant qua
     * post_content_mappings (variant_id hoặc content_item_id khớp).
     *  - Có post → observation object_type='external_post', object_id=post.id.
     *  - Chưa có → object_type='content_variant', object_id=variantId.
     * metrics: {views: n, likes: n, …} hoặc [{metric, value}] hoặc {metric, value}.
     * source mặc định 'manual' (chỉ 'manual'/'import' được ghi — policy 0005).
     */
    saveTiktokMetrics: function (variantId, metrics, source) {
      var v = this.get('variants', variantId);
      if (!v) {
        var nf = { ok: false, error: 'Không tìm thấy variant ' + variantId };
        return this.mode === 'supabase' ? Promise.resolve(nf) : nf;
      }
      var entries = [];
      if (Array.isArray(metrics)) entries = metrics.slice();
      else if (metrics && metrics.metric) entries = [{ metric: metrics.metric, value: metrics.value }];
      else if (metrics) Object.keys(metrics).forEach(function (k) { entries.push({ metric: k, value: metrics[k] }); });
      entries = entries.filter(function (e) { return e && e.metric && e.value != null && !isNaN(Number(e.value)); });
      if (!entries.length) {
        var em = { ok: false, error: 'Chưa có metric hợp lệ để lưu.' };
        return this.mode === 'supabase' ? Promise.resolve(em) : em;
      }
      var mapping = (this._postMappings || []).find(function (m) {
        return m.variant_id === variantId || (v.contentItemId && m.content_item_id === v.contentItemId);
      }.bind(this));
      var post = null;
      if (mapping) post = this.get('externalPosts', mapping.external_post_id);
      if (!post) {
        post = (this.state.externalPosts || []).find(function (pp) {
          return pp.platform === 'tiktok' && (pp.variantId === variantId || (v.contentItemId && pp.contentItemId === v.contentItemId));
        }) || null;
      }
      var target = post
        ? { objectType: 'external_post', objectId: post.id, externalPostId: post.id }
        : { objectType: 'content_variant', objectId: variantId, externalPostId: null };
      var now = new Date().toISOString();
      var self = this;
      var rows = entries.map(function (e) {
        return {
          objectType: target.objectType, objectId: target.objectId, externalPostId: target.externalPostId,
          metric: e.metric, value: Number(e.value), source: source || 'manual',
          observedAt: now, periodStart: now, periodEnd: now, periodGrain: 'lifetime', scope: 'organic'
        };
      });
      if (this.mode !== 'supabase') {
        var items = rows.map(function (r) {
          var item = Object.assign({ id: uid('obs') }, r);
          this.state.metricObservations.push(item);
          return item;
        }.bind(this));
        this.notify();
        return { ok: true, items: items, target: target };
      }
      var payloads = rows.map(function (r) { return self._toPayload('metricObservations', r, { forInsert: true, workspaceId: self.workspaceId }); });
      return this._attempt('metric_observations.insert', this.supabaseClient.from('metric_observations').insert(payloads).select())
        .then(function (res) {
          if (!res.ok) return res;
          var items = (res.data || []).map(function (row) { return self._rowToItem('metricObservations', row); });
          items.forEach(function (it) { self.state.metricObservations.push(it); });
          self.notify();
          return { ok: true, items: items, target: target };
        });
    },

    /**
     * R29 phía store — ghi nhận trạng thái sync từ server NGUYÊN TRẠNG:
     * 'incomplete' giữ nguyên 'incomplete', store không tự nâng thành complete.
     */
    recordSyncStatus: function (run) {
      if (!run) return null;
      if (!this.state.syncRuns) this.state.syncRuns = [];
      var entry = Object.assign({}, run, { status: run.status || 'incomplete', complete: run.status === 'complete' });
      var idx = this.state.syncRuns.findIndex(function (r) { return r.id === entry.id; });
      if (idx !== -1) this.state.syncRuns[idx] = entry; else this.state.syncRuns.push(entry);
      return entry;
    },

    /**
     * R28 — Cổng tạo PublishJob theo contract mới:
     * createPublishJob(variantOrId, { accountId, scheduledAt|null, decisionId }).
     *  - Thiếu decisionId → từ chối (không có quyết định duyệt = không đăng).
     *  - scheduledAt null = đăng ngay → scheduled_at = now.
     *  - idempotency_key ổn định từ variant+revision+account+slot (khớp phút):
     *    double-click cùng intent → cùng key; server trả trùng key → trả job cũ.
     *  - Snapshot chứa decision_id + revision_id + approved hash; cột
     *    publish_jobs.decision_id được ghi cùng job.
     */
    createPublishJob: function (variantOrId, options) {
      options = options || {};
      var v = typeof variantOrId === 'string' ? this.get('variants', variantOrId) : variantOrId;
      if (!v) return { ok: false, error: 'Không tìm thấy variant để đăng.' };
      var Domain = global.SAVA_DOMAIN || (typeof require === 'function' ? (function () { try { return require('./domain.js'); } catch (e) { return null; } })() : null);
      if (this.mode === 'demo') {
        return { ok: false, error: 'Đang ở chế độ demo: tài khoản demo không có quyền đăng bài thật. Nút đăng bị khóa — hãy kết nối Supabase và kênh thật để đăng.' };
      }
      if (this.mode !== 'supabase') return { ok: false, error: 'Chưa kết nối Supabase nên chưa thể đăng bài.' };
      if (!this.can('publish.create')) return { ok: false, error: 'Vai trò hiện tại không có quyền Đăng bài.' };
      if (Domain && !Domain.shouldCreatePublishJob(v)) {
        if ((v.platform || '') === 'tiktok') return { ok: false, error: 'TikTok đăng ngoài app: app không tạo PublishJob cho TikTok.' };
        return { ok: false, error: 'Variant này ở chế độ đăng ngoài app nên không tạo PublishJob.' };
      }
      if (v.approvalStatus !== 'approved') return { ok: false, error: 'Variant chưa được duyệt nên chưa thể đăng.' };
      var decisionId = options.decisionId || v.decisionId || null;
      if (!decisionId) {
        return { ok: false, code: 'decision_required', error: 'Thiếu decisionId: job đăng phải gắn quyết định duyệt cụ thể (approval_decisions.id).' };
      }
      var accountId = options.accountId || v.channelAccountId || null;
      if (!accountId) {
        return { ok: false, error: 'Variant chưa gắn tài khoản kênh nên chưa thể tạo job đăng. Hãy gắn Channel Account cho variant trước.' };
      }
      var revisionId = options.revisionId || v.approvedRevisionId || v.currentRevisionId || null;
      if (!revisionId) {
        return { ok: false, code: 'revision_required', error: 'Variant chưa có revision được duyệt nên chưa thể tạo job đăng.' };
      }
      return this._createPublishJobRemote(v, { accountId: accountId, decisionId: decisionId, revisionId: revisionId, scheduledAt: options.scheduledAt !== undefined ? options.scheduledAt : (v.scheduledAt || null) });
    },
    /** Dựng payload job (thuần — test được không cần client). */
    buildPublishJobPayload: function (v, opts) {
      var scheduledAt = opts.scheduledAt || new Date().toISOString(); // null = đăng ngay → now
      var platformDb = Core && Core.PLATFORM_TO_DB[String(v.platform || '').toLowerCase()] || v.platform;
      var approvedHash = Core ? Core.stableHash({ caption: v.caption || null, media_asset_ids: v.mediaAssetIds || [], revision_id: opts.revisionId }) : null;
      var snapshot = {
        caption: v.caption || null,
        media_asset_ids: v.mediaAssetIds || [],
        channel_account_id: opts.accountId,
        platform: platformDb,
        approval: { decision_id: opts.decisionId, revision_id: opts.revisionId, approved_hash: approvedHash },
        destinations: [{ channel_account_id: opts.accountId, platform: platformDb }]
      };
      return {
        workspace_id: this.workspaceId, variant_id: v.id, revision_id: opts.revisionId,
        decision_id: opts.decisionId,
        channel_account_id: opts.accountId, platform: platformDb,
        idempotency_key: Core ? Core.publishIdempotencyKey(v.id, opts.revisionId, opts.accountId, scheduledAt) : ('job-' + v.id + '-' + opts.revisionId),
        snapshot: snapshot, status: 'queued',
        scheduled_at: scheduledAt,
        authorized_by: this.currentUserId, created_by: this.currentUserId
      };
    },
    _createPublishJobRemote: function (v, opts) {
      var self = this;
      var payload = this.buildPublishJobPayload(v, opts);
      return this._attempt('publish_jobs.insert', this.supabaseClient.from('publish_jobs').insert(payload).select().single())
        .then(function (res) {
          if (!res.ok) {
            // Trùng idempotency_key (double-click/retry) → lấy job đã có, không tạo trùng.
            if (/duplicate|unique|idempotency/i.test(res.error || '')) {
              return self._attempt('publish_jobs.select.by_key', self.supabaseClient.from('publish_jobs').select('*').eq('idempotency_key', payload.idempotency_key).limit(1))
                .then(function (found) {
                  if (found.ok && found.data && found.data.length) {
                    var existing = self._rowToItem('publishJobs', found.data[0]);
                    if (!self.get('publishJobs', existing.id)) self.state.publishJobs.push(existing);
                    self.notify();
                    return { ok: true, item: existing, deduped: true };
                  }
                  return res;
                });
            }
            return res;
          }
          var item = self._rowToItem('publishJobs', res.data);
          item.decisionId = payload.decision_id;
          self.state.publishJobs.push(item);
          self.notify();
          return { ok: true, item: item };
        });
    }
  };

  global.SAVA_STORE = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
