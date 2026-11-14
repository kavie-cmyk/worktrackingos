/*
 * js/col-resize.js — Kéo rộng cột kiểu Excel cho SAVA Marketing Workspace.
 *
 * CÔ LẬP HOÀN TOÀN: file riêng, không sửa logic nghiệp vụ của app.js.
 * Điểm chạm duy nhất với code chung:
 *  - index.html nạp file này SAU js/app.js (1 dòng <script>).
 *  - helper tbl() trong js/app.js nhận thêm tham số key tuỳ chọn và gắn
 *    thuộc tính data-table-key lên <table>; bảng không có key -> file này
 *    bỏ qua 100% (giữ hành vi cũ).
 *  - styles.css có 1 khối riêng ở cuối (tiền tố class .col-resize-*).
 *
 * Phạm vi: chỉ bảng có data-table-key (các bảng dữ liệu chính). KHÔNG áp
 * cho Gantt (.g2-*), lưới lịch, bảng trong form/drawer nhỏ, bảng key-value
 * chi tiết và bảng kịch bản .scene-table — các bảng đó không được gắn key.
 *
 * Tương tác (trên mỗi <th> của bảng có key, trừ cột hành động — xem dưới):
 *  - Kéo tay nắm ở mép phải th (Pointer Events, chuột + cảm ứng) -> đổi
 *    độ rộng cột realtime, lưu localStorage.
 *  - Bấm đúp tay nắm -> auto-fit: cột vừa nội dung (ô rộng nhất), trần
 *    COL_RESIZE_AUTO_MAX = 520px, sàn COL_RESIZE_MIN_WIDTH = 60px.
 *  - Shift + bấm đúp -> reset cột đó về mặc định (xoá độ rộng đã lưu).
 *  - Độ rộng tối thiểu khi kéo: 60px; tối đa khi kéo tay: 2000px.
 *
 * QUYẾT ĐỊNH cột hành động: cột CUỐI có tiêu đề "Thao tác"/"Hành động"
 * hoặc tiêu đề rỗng (vd bảng Action Plan) KHÔNG có tay nắm — đây là cột
 * nút hẹp, kéo rộng không có lợi và dễ vỡ hàng nút. Mọi cột còn lại đều
 * kéo được. Ngoài ra <th data-col-resize="off"> cũng bị loại thủ công.
 *
 * Lưu trữ: localStorage, tiền tố riêng 'sava-mkt-colwidths-v1:' + table
 * key, giá trị JSON {v:1, cols:{<chỉ số cột>: <px>}}. Chỉ lưu cột đã
 * chỉnh tay; cột chưa chỉnh dùng độ rộng tự nhiên đo lúc render. Nếu số
 * cột hiện tại khác lúc lưu -> mục lưu có chỉ số vượt quá bị bỏ qua,
 * không vỡ layout. Bảng có >= 1 cột chỉnh tay mới chuyển table-layout:
 * fixed + <colgroup>; bảng chưa chỉnh giữ nguyên hành vi cũ 100%.
 */
(function () {
  'use strict';

  // COLRESIZE-PURE-BEGIN
  // Vùng THUẦN: chỉ toán số/chuỗi, không DOM, không localStorage — test
  // unit trích xuất vùng này (tests/col-resize.test.mjs).
  var COL_RESIZE_MIN_WIDTH = 60;
  var COL_RESIZE_MAX_WIDTH = 2000;
  var COL_RESIZE_AUTO_MAX = 520;
  var COL_RESIZE_FALLBACK_WIDTH = 160;
  var COL_RESIZE_STORAGE_PREFIX = 'sava-mkt-colwidths-v1:';

  function colResizeClampWidth(w, maxW) {
    var n = Number(w);
    if (w === null || w === undefined || w === '' || isNaN(n)) return null;
    var max = (maxW === null || maxW === undefined || isNaN(Number(maxW))) ? COL_RESIZE_MAX_WIDTH : Number(maxW);
    if (max < COL_RESIZE_MIN_WIDTH) max = COL_RESIZE_MIN_WIDTH;
    return Math.max(COL_RESIZE_MIN_WIDTH, Math.min(max, Math.round(n)));
  }
  // Auto-fit: lấy ô rộng nhất trong các số đo được, kẹp [60, 520].
  function colResizeAutoFitWidth(measured) {
    var best = null;
    (measured || []).forEach(function (w) {
      var n = Number(w);
      if (w === null || w === undefined || w === '' || isNaN(n) || n <= 0) return;
      if (best === null || n > best) best = n;
    });
    if (best === null) return null;
    return colResizeClampWidth(best, COL_RESIZE_AUTO_MAX);
  }
  function colResizeStorageKey(tableKey) {
    var k = String(tableKey === null || tableKey === undefined ? '' : tableKey).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(k)) return null;
    return COL_RESIZE_STORAGE_PREFIX + k;
  }
  // Chuẩn hoá map đã lưu {chỉ số cột: px} theo số cột HIỆN TẠI: bỏ chỉ số
  // âm/vượt số cột, bỏ giá trị không phải số, kẹp độ rộng về [60, 2000].
  function colResizeNormalizeSaved(raw, colCount) {
    var out = {};
    var count = Math.floor(Number(colCount) || 0);
    if (!raw || typeof raw !== 'object' || count <= 0) return out;
    var cols = (raw.cols && typeof raw.cols === 'object') ? raw.cols : raw;
    Object.keys(cols).forEach(function (k) {
      var idx = Number(k);
      if (!isFinite(idx) || Math.floor(idx) !== idx || idx < 0 || idx >= count) return;
      var w = colResizeClampWidth(cols[k]);
      if (w !== null) out[idx] = w;
    });
    return out;
  }
  function colResizeParseStored(text, colCount) {
    if (!text) return {};
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { return {}; }
    return colResizeNormalizeSaved(parsed, colCount);
  }
  function colResizeSerializeSaved(manual) {
    var cols = {};
    Object.keys(manual || {}).forEach(function (k) { cols[k] = manual[k]; });
    return JSON.stringify({ v: 1, cols: cols });
  }
  function colResizeHasManual(manual) {
    return !!manual && Object.keys(manual).length > 0;
  }
  // Độ rộng HIỂN THỊ của từng cột: ưu tiên độ rộng chỉnh tay đã lưu, sau
  // đó độ rộng tự nhiên đo lúc render, cuối cùng mức dự phòng 160px.
  function colResizeDisplayWidths(colCount, natural, manual) {
    var count = Math.floor(Number(colCount) || 0);
    var out = [];
    for (var i = 0; i < count; i++) {
      var m = manual ? manual[i] : undefined;
      if (m !== undefined && m !== null && !isNaN(Number(m))) { out.push(colResizeClampWidth(m)); continue; }
      var n = natural ? Number(natural[i]) : NaN;
      out.push(!isNaN(n) && n > 0 ? Math.round(n) : COL_RESIZE_FALLBACK_WIDTH);
    }
    return out;
  }
  // Cột hành động/nút: nhận diện theo NHÃN tiêu đề (đã trim, thường là
  // cột cuối). Chuỗi rỗng cũng tính là cột hành động khi ở vị trí cuối —
  // phần DOM kiểm tra vị trí, hàm thuần này chỉ xét nhãn.
  function colResizeIsActionLabel(headerText) {
    var t = String(headerText === null || headerText === undefined ? '' : headerText).trim().toLowerCase();
    return t === '' || t === 'thao tác' || t === 'hành động' || t === 'action' || t === 'actions';
  }
  // COLRESIZE-PURE-END

  var HANDLE_TITLE = 'Kéo để đổi độ rộng cột · bấm đúp: tự vừa nội dung';
  var tableState = (typeof WeakMap === 'function') ? new WeakMap() : null;
  var stateList = []; // fallback khi không có WeakMap (trình duyệt rất cũ)
  function stateFor(table) {
    if (tableState) {
      var s = tableState.get(table);
      if (!s) { s = { natural: null, manual: {}, display: [] }; tableState.set(table, s); }
      return s;
    }
    for (var i = 0; i < stateList.length; i++) if (stateList[i].table === table) return stateList[i].state;
    var st = { natural: null, manual: {}, display: [] };
    stateList.push({ table: table, state: st });
    return st;
  }
  function storageGet(key) {
    try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { if (window.localStorage) window.localStorage.setItem(key, value); } catch (e) { /* hết quota/tắt storage: bỏ qua, kéo vẫn chạy trong phiên */ }
  }
  function storageRemove(key) {
    try { if (window.localStorage) window.localStorage.removeItem(key); } catch (e) { /* bỏ qua */ }
  }
  function saveManual(table, state) {
    var key = colResizeStorageKey(table.getAttribute('data-table-key'));
    if (!key) return;
    if (colResizeHasManual(state.manual)) storageSet(key, colResizeSerializeSaved(state.manual));
    else storageRemove(key);
  }
  function headerCells(table) {
    var rows = table.rows;
    for (var i = 0; i < rows.length; i++) {
      var ths = [];
      var cells = rows[i].cells;
      for (var j = 0; j < cells.length; j++) if (cells[j].tagName === 'TH') ths.push(cells[j]);
      if (ths.length) return ths;
    }
    return [];
  }
  function isExcludedColumn(ths, idx) {
    var th = ths[idx];
    if (!th) return true;
    if (th.getAttribute('data-col-resize') === 'off') return true;
    var label = th.textContent || '';
    if (idx === ths.length - 1 && colResizeIsActionLabel(label)) return true;
    // Nhãn hành động ở vị trí khác cuối cũng loại (phòng bảng lạ).
    var t = String(label).trim().toLowerCase();
    return t === 'thao tác' || t === 'hành động';
  }
  function applyFixed(table, state) {
    var ths = headerCells(table);
    var count = ths.length;
    if (!count) return;
    var old = table.querySelector('colgroup[data-col-resize-group]');
    if (!colResizeHasManual(state.manual)) {
      if (old) old.parentNode.removeChild(old);
      table.classList.remove('col-resized');
      table.style.width = '';
      return;
    }
    state.display = colResizeDisplayWidths(count, state.natural, state.manual);
    var group = old;
    if (!group) {
      group = document.createElement('colgroup');
      group.setAttribute('data-col-resize-group', '1');
      table.insertBefore(group, table.firstChild);
    }
    while (group.children.length < count) group.appendChild(document.createElement('col'));
    while (group.children.length > count) group.removeChild(group.lastChild);
    var total = 0;
    for (var i = 0; i < count; i++) {
      group.children[i].style.width = state.display[i] + 'px';
      total += state.display[i];
    }
    table.classList.add('col-resized');
    table.style.width = total + 'px';
  }
  function measureNatural(table, ths) {
    var out = [];
    for (var i = 0; i < ths.length; i++) out.push(ths[i].offsetWidth || 0);
    return out;
  }
  // Đo độ rộng tự nhiên của 1 cột ở chế độ "không xuống dòng" tạm thời:
  // gỡ layout fixed + bật class measuring (CSS ép white-space:nowrap),
  // đọc ô rộng nhất trong các hàng có đủ số ô (bỏ hàng colspan/gộp nhóm).
  function measureAutoFit(table, idx, colCount) {
    var group = table.querySelector('colgroup[data-col-resize-group]');
    var savedColWidths = null;
    if (group) {
      savedColWidths = [];
      for (var i = 0; i < group.children.length; i++) savedColWidths.push(group.children[i].style.width);
      for (var j = 0; j < group.children.length; j++) group.children[j].style.width = '';
    }
    var savedTableWidth = table.style.width;
    table.classList.remove('col-resized');
    table.style.width = '';
    table.classList.add('col-resize-measuring');
    void table.offsetWidth; // ép trình duyệt tính lại layout trước khi đo
    var measured = [];
    var rows = table.rows;
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].cells;
      if (cells.length !== colCount) continue;
      var cell = cells[idx];
      if (!cell || (cell.colSpan && cell.colSpan > 1)) continue;
      measured.push(Math.max(cell.offsetWidth || 0, cell.scrollWidth || 0));
    }
    table.classList.remove('col-resize-measuring');
    if (group && savedColWidths) {
      for (var k = 0; k < group.children.length && k < savedColWidths.length; k++) group.children[k].style.width = savedColWidths[k];
    }
    table.style.width = savedTableWidth;
    return colResizeAutoFitWidth(measured);
  }
  function startDrag(ev, table, state, idx, handle) {
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
    var ths = headerCells(table);
    if (!ths.length) return;
    if (!state.natural) state.natural = measureNatural(table, ths);
    if (!colResizeHasManual(state.manual)) {
      state.display = colResizeDisplayWidths(ths.length, state.natural, state.manual);
    }
    var startX = ev.clientX;
    var startW = (state.display && state.display[idx]) || ths[idx].offsetWidth || COL_RESIZE_FALLBACK_WIDTH;
    var moved = false;
    var pid = ev.pointerId;
    try { handle.setPointerCapture(pid); } catch (e) { /* trình duyệt cũ: vẫn nghe move trên handle */ }
    ev.preventDefault();
    ev.stopPropagation();
    function onMove(e2) {
      if (pid !== undefined && e2.pointerId !== undefined && e2.pointerId !== pid) return;
      var w = colResizeClampWidth(startW + (e2.clientX - startX));
      if (w === null) return;
      if (!moved && Math.abs(e2.clientX - startX) < 2) return;
      moved = true;
      state.manual[idx] = w;
      applyFixed(table, state);
    }
    function onUp(e3) {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('col-resize-dragging');
      if (e3) { e3.stopPropagation(); }
      if (moved) saveManual(table, state);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    document.body.classList.add('col-resize-dragging');
  }
  function enhanceTable(table) {
    if (!table || table.tagName !== 'TABLE') return;
    if (table.dataset && table.dataset.colResizeEnhanced === '1') return;
    var key = table.getAttribute('data-table-key');
    if (!colResizeStorageKey(key)) return;
    if (table.classList.contains('scene-table')) return;
    if (table.closest && (table.closest('.g2-wrap') || table.closest('.gantt'))) return;
    var ths = headerCells(table);
    if (ths.length < 2) return;
    if (table.dataset) table.dataset.colResizeEnhanced = '1';
    var state = stateFor(table);
    state.manual = colResizeParseStored(storageGet(colResizeStorageKey(key)), ths.length);
    state.natural = measureNatural(table, ths);
    if (colResizeHasManual(state.manual)) applyFixed(table, state);
    ths.forEach(function (th, idx) {
      if (isExcludedColumn(ths, idx)) return;
      th.classList.add('col-resize-th');
      var handle = document.createElement('span');
      handle.className = 'col-resize-handle';
      handle.setAttribute('data-col-resize-handle', String(idx));
      handle.setAttribute('title', HANDLE_TITLE);
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('pointerdown', function (ev) { startDrag(ev, table, state, idx, handle); });
      // Tay nắm không được nuốt/để lọt click sang th (sort/hành động khác).
      handle.addEventListener('click', function (ev) { ev.stopPropagation(); });
      handle.addEventListener('dblclick', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.shiftKey) {
          // Shift + bấm đúp: reset cột về mặc định.
          if (state.manual[idx] !== undefined) {
            delete state.manual[idx];
            applyFixed(table, state);
            saveManual(table, state);
          }
          return;
        }
        var w = measureAutoFit(table, idx, ths.length);
        if (w !== null) {
          state.manual[idx] = w;
          applyFixed(table, state);
          saveManual(table, state);
        }
      });
      th.appendChild(handle);
    });
  }
  function enhanceAll(root) {
    var scope = root || document;
    if (scope.querySelectorAll) {
      var tables = scope.querySelectorAll('table[data-table-key]');
      for (var i = 0; i < tables.length; i++) enhanceTable(tables[i]);
    }
    if (scope.tagName === 'TABLE') enhanceTable(scope);
  }
  function boot() {
    enhanceAll(document);
    if (typeof MutationObserver === 'function' && document.body) {
      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node && node.nodeType === 1) enhanceAll(node);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.SAVA_COL_RESIZE = {
    enhanceAll: enhanceAll,
    enhanceTable: enhanceTable,
    storagePrefix: COL_RESIZE_STORAGE_PREFIX,
    minWidth: COL_RESIZE_MIN_WIDTH,
    autoMax: COL_RESIZE_AUTO_MAX,
    pure: {
      colResizeClampWidth: colResizeClampWidth,
      colResizeAutoFitWidth: colResizeAutoFitWidth,
      colResizeStorageKey: colResizeStorageKey,
      colResizeNormalizeSaved: colResizeNormalizeSaved,
      colResizeParseStored: colResizeParseStored,
      colResizeSerializeSaved: colResizeSerializeSaved,
      colResizeHasManual: colResizeHasManual,
      colResizeDisplayWidths: colResizeDisplayWidths,
      colResizeIsActionLabel: colResizeIsActionLabel
    }
  };
})();
