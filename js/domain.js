/*
 * js/domain.js — Logic thuần của SAVA Marketing Workspace.
 * Không chạm DOM, không đọc localStorage, không gọi mạng.
 * Dùng được ở trình duyệt (window.SAVA_DOMAIN) và trong Node (module.exports)
 * để kiểm thử bằng `node --test`.
 */
(function (global) {
  'use strict';

  // ---------- Tiện ích nội bộ ----------

  /** Chuẩn hoá trạng thái task về dạng thường. */
  function normStatus(s) { return String(s || '').trim().toLowerCase(); }
  /** Task đã hoàn thành hay chưa. */
  function isCompleted(task) {
    if (!task) return false;
    var s = normStatus(task.status);
    return s === 'completed' || s === 'complete' || s === 'done' || s === 'hoàn thành';
  }
  /** Lấy số từ nhiều tên trường có thể dùng. */
  function pickNum(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) return Number(v);
    }
    return null;
  }
  /** Lấy chuỗi ngày ISO đầu tiên tìm thấy theo danh sách trường. */
  function pickDate(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v) return v;
    }
    return null;
  }
  /** Chuyển giá trị ngày sang Date (null nếu không hợp lệ). */
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getTime());
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  /** Định dạng Date thành yyyy-mm-dd theo giờ địa phương. */
  function toISODate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  /** Cộng số ngày vào Date, trả Date mới. */
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  /** Số mili-giây trong một ngày. */
  var DAY_MS = 86400000;

  // ---------- Dependencies ----------

  /**
   * Kiểm tra thêm cạnh from → to có tạo vòng phụ thuộc không.
   * @param {Array<{predecessorId:string, successorId:string}>} edges Danh sách cạnh hiện có.
   * @param {string} from ID việc tiền nhiệm của cạnh mới.
   * @param {string} to ID việc kế tiếp của cạnh mới.
   * @returns {boolean} true nếu cạnh mới tạo vòng (kể cả from === to).
   */
  function wouldCreateCycle(edges, from, to) {
    if (!from || !to) return false;
    if (from === to) return true;
    var list = edges || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].predecessorId === from && list[i].successorId === to) {
        // Cạnh đã tồn tại không tự nó tạo vòng mới ngoài vòng sẵn có; vẫn kiểm tra đường đi.
        break;
      }
    }
    // Có đường đi to -> ... -> from thì thêm from -> to sẽ khép vòng.
    var visited = {};
    var stack = [to];
    while (stack.length) {
      var cur = stack.pop();
      if (cur === from) return true;
      if (visited[cur]) continue;
      visited[cur] = true;
      for (var j = 0; j < list.length; j++) {
        if (list[j].predecessorId === cur) stack.push(list[j].successorId);
      }
    }
    return false;
  }

  /**
   * Kiểm tra một việc đã sẵn sàng bắt đầu chưa dựa trên các việc tiền nhiệm.
   * @param {string} taskId ID việc cần kiểm tra.
   * @param {Array<object>} tasks Toàn bộ task.
   * @param {Array<{predecessorId:string, successorId:string}>} edges Cạnh phụ thuộc.
   * @returns {{ready:boolean, pendingPredecessors:string[]}} pendingPredecessors là các tiền nhiệm chưa completed.
   */
  function taskReadiness(taskId, tasks, edges) {
    var byId = {};
    (tasks || []).forEach(function (t) { byId[t.id] = t; });
    var pending = [];
    (edges || []).forEach(function (e) {
      if (e.successorId === taskId) {
        var pred = byId[e.predecessorId];
        if (!pred || !isCompleted(pred)) pending.push(e.predecessorId);
      }
    });
    return { ready: pending.length === 0, pendingPredecessors: pending };
  }

  /**
   * Xem trước ảnh hưởng khi đổi lịch của một việc lên các việc phụ thuộc.
   * Chỉ là bản xem trước — hàm này KHÔNG tự dịch lịch của việc phụ thuộc.
   * @param {string} taskId ID việc đổi lịch.
   * @param {string|Date} newStart Ngày bắt đầu đề xuất của việc gốc.
   * @param {string|Date} newDue Ngày đến hạn đề xuất của việc gốc.
   * @param {Array<object>} tasks Toàn bộ task.
   * @param {Array<{predecessorId:string, successorId:string}>} edges Cạnh phụ thuộc.
   * @returns {Array<object>} Danh sách việc phụ thuộc trực tiếp và gián tiếp bị ảnh hưởng.
   */
  function previewDependencyImpact(taskId, newStart, newDue, tasks, edges) {
    var byId = {};
    (tasks || []).forEach(function (t) { byId[t.id] = t; });
    var origin = byId[taskId];
    if (!origin) return [];
    var oldStart = toDate(pickDate(origin, ['startDate', 'start_date', 'start']));
    var oldDue = toDate(pickDate(origin, ['dueDate', 'due_date', 'due', 'deadline']));
    var nStart = toDate(newStart);
    var nDue = toDate(newDue);
    var delta = 0;
    if (oldDue && nDue) delta = Math.round((nDue - oldDue) / DAY_MS);
    else if (oldStart && nStart) delta = Math.round((nStart - oldStart) / DAY_MS);
    // BFS theo chiều xuôi: successor của successor...
    var result = [];
    var visited = {};
    var queue = [{ id: taskId, depth: 0 }];
    visited[taskId] = true;
    while (queue.length) {
      var item = queue.shift();
      (edges || []).forEach(function (e) {
        if (e.predecessorId === item.id && !visited[e.successorId]) {
          visited[e.successorId] = true;
          var t = byId[e.successorId];
          var depth = item.depth + 1;
          queue.push({ id: e.successorId, depth: depth });
          if (t) {
            var cs = pickDate(t, ['startDate', 'start_date', 'start']);
            var cd = pickDate(t, ['dueDate', 'due_date', 'due', 'deadline']);
            var csD = toDate(cs); var cdD = toDate(cd);
            result.push({
              id: t.id,
              taskId: t.id,
              title: t.title || t.name || '',
              depth: depth,
              direct: depth === 1,
              currentStart: cs ? toISODate(csD) : cs,
              currentDue: cd ? toISODate(cdD) : cd,
              startDate: cs ? toISODate(csD) : cs,
              dueDate: cd ? toISODate(cdD) : cd,
              proposedStart: csD ? toISODate(addDays(csD, delta)) : cs,
              proposedDue: cdD ? toISODate(addDays(cdD, delta)) : cd,
              suggestedStart: csD ? toISODate(addDays(csD, delta)) : cs,
              suggestedDue: cdD ? toISODate(addDays(cdD, delta)) : cd,
              deltaDays: delta
            });
          }
        }
      });
    }
    return result;
  }

  // ---------- Effort / Workload ----------

  /**
   * Phân bổ effort của một việc theo các ngày làm việc.
   * Bỏ thứ Bảy, Chủ nhật và ngày nghỉ được truyền vào.
   * @param {object} task Việc có effortHours/effort_hours và startDate/dueDate.
   * @param {Array<string>|object|number} [workdays] Ngày nghỉ dạng mảng ['yyyy-mm-dd'],
   *   hoặc { holidays: [...], days: [...] }, hoặc số ngày làm việc tính từ ngày bắt đầu.
   * @param {Array<string>} [holidaysOpt] Ngày nghỉ tuỳ chọn truyền thêm.
   * @returns {Array<{date:string, hours:number}>|{unestimated:true}} Mảng phân bổ,
   *   hoặc { unestimated: true } khi việc chưa có effort.
   */
  function distributeEffort(task, workdays, holidaysOpt) {
    if (!task) return { unestimated: true };
    var effort = pickNum(task, ['effortHours', 'effort_hours', 'effort', 'estimateHours']);
    if (effort === null || effort <= 0) return { unestimated: true };
    var holidays = {};
    function addHoliday(h) { if (h) holidays[toISODate(toDate(h) || new Date(h))] = true; }
    if (Array.isArray(holidaysOpt)) holidaysOpt.forEach(addHoliday);
    var explicitDays = null;
    var dayCount = null;
    if (Array.isArray(workdays)) {
      // Khi task đã có khoảng ngày, mảng truyền vào được hiểu là danh sách ngày nghỉ.
      if (pickDate(task, ['startDate', 'start_date', 'start']) && pickDate(task, ['dueDate', 'due_date', 'due'])) {
        workdays.forEach(addHoliday);
      } else {
        explicitDays = workdays.slice();
      }
    } else if (workdays && typeof workdays === 'object') {
      if (Array.isArray(workdays.holidays)) workdays.holidays.forEach(addHoliday);
      if (Array.isArray(workdays.exclude)) workdays.exclude.forEach(addHoliday);
      if (Array.isArray(workdays.days)) explicitDays = workdays.days.slice();
      if (Array.isArray(workdays.workdays)) explicitDays = workdays.workdays.slice();
    } else if (typeof workdays === 'number' && workdays > 0) {
      dayCount = Math.floor(workdays);
    }
    var days = [];
    if (explicitDays && explicitDays.length) {
      explicitDays.forEach(function (d) {
        var dt = toDate(d); if (dt) days.push(toISODate(dt));
      });
      days.sort();
    } else {
      var start = toDate(pickDate(task, ['startDate', 'start_date', 'start', 'dueDate', 'due_date', 'due']));
      if (!start) return { unestimated: true };
      var due = toDate(pickDate(task, ['dueDate', 'due_date', 'due', 'deadline'])) || start;
      if (dayCount !== null) {
        var cur = new Date(start.getTime());
        while (days.length < dayCount) {
          var dow = cur.getDay();
          var iso = toISODate(cur);
          if (dow !== 0 && dow !== 6 && !holidays[iso]) days.push(iso);
          cur = addDays(cur, 1);
        }
      } else {
        var c2 = new Date(start.getTime());
        var end = new Date(due.getTime());
        if (end < c2) end = c2;
        while (c2 <= end) {
          var dow2 = c2.getDay();
          var iso2 = toISODate(c2);
          if (dow2 !== 0 && dow2 !== 6 && !holidays[iso2]) days.push(iso2);
          c2 = addDays(c2, 1);
        }
        if (!days.length) days.push(toISODate(start));
      }
    }
    if (!days.length) return { unestimated: true };
    var per = effort / days.length;
    var out = [];
    var acc = 0;
    days.forEach(function (date, idx) {
      var h;
      if (idx === days.length - 1) h = Math.round((effort - acc) * 100) / 100;
      else { h = Math.round(per * 100) / 100; acc += h; }
      out.push({ date: date, hours: h });
    });
    return out;
  }

  // ---------- Ngân sách ----------

  // Cam kết còn mở (R2-01/R2-02): chỉ các status canonical
  // planned / committed / partially_actualised. 'open' và 'partial' là alias
  // frontend tương ứng committed / partially_actualised (xem docs/METRICS.md).
  // settled / released / cancelled (và mọi status khác) KHÔNG còn mở.
  var OPEN_COMMITMENT_STATUSES = { planned: 1, committed: 1, partially_actualised: 1, open: 1, partial: 1 };
  function isOpenCommitment(c) { return !!(c && OPEN_COMMITMENT_STATUSES[normStatus(c.status)]); }

  // ---------- Chuỗi duyệt ngân sách (0014) ----------
  /**
   * Trạng thái duyệt của một fact ngân sách (commitment/actual):
   * đọc approvalStatus (camel) hoặc approval_status (snake).
   * @param {object} f Fact ngân sách.
   * @returns {(string|null)} 'pending'|'approved'|'rejected' hoặc null khi fact
   *   không mang trạng thái (dữ liệu/fixture cũ).
   */
  function factApprovalStatus(f) {
    if (!f) return null;
    var v = f.approvalStatus !== undefined && f.approvalStatus !== null ? f.approvalStatus : f.approval_status;
    if (v === undefined || v === null || String(v).trim() === '') return null;
    return String(v).trim().toLowerCase();
  }
  /**
   * Fact có được tính vào các tổng ngân sách không: chỉ fact ĐÃ DUYỆT.
   * Thiếu trạng thái (null) → coi như 'approved' để tương thích dữ liệu cũ /
   * fixture cũ (khớp cột DB default 'approved' của 0014).
   * @param {object} f Fact ngân sách.
   * @returns {boolean} true khi đã duyệt (hoặc không mang trạng thái).
   */
  function isApprovedFact(f) {
    var s = factApprovalStatus(f);
    return s === null || s === 'approved';
  }

  /**
   * Tổng đã trả của một cam kết — NGUỒN SỰ THẬT DUY NHẤT (R2-01/R2-02):
   * chỉ Σ amount của actuals liên kết (commitmentId === commitment.id).
   * settledAmount/settled_amount trên cam kết KHÔNG được dùng nữa (có thể stale).
   * @param {object} commitment Cam kết có id.
   * @param {Array<object>} actuals Các khoản chi thực tế.
   * @returns {number} Tổng amount của actuals gắn với cam kết.
   */
  function commitmentPaidTotal(commitment, actuals) {
    if (!commitment || commitment.id === null || commitment.id === undefined || commitment.id === '') return 0;
    var total = 0;
    (actuals || []).forEach(function (a) {
      if (!a) return;
      if (!isApprovedFact(a)) return; // 0014: chỉ actual ĐÃ DUYỆT mới là "đã trả"
      var cid = a.commitmentId !== undefined && a.commitmentId !== null ? a.commitmentId : a.commitment_id;
      if (cid === null || cid === undefined || cid === '') return;
      if (String(cid) === String(commitment.id)) {
        total += pickNum(a, ['amount', 'actualAmount', 'actual_amount', 'value']) || 0;
      }
    });
    return total;
  }

  /**
   * Tổng cam kết còn mở (R2-01/R2-02): Σ trên cam kết còn mở của
   * max(0, amount − commitmentPaidTotal). Cam kết settled/released/cancelled
   * không tính; phần đã trả chỉ tính từ actuals liên kết.
   * @param {Array<object>} commitments Các cam kết.
   * @param {Array<object>} actuals Các khoản chi thực tế.
   * @returns {number} Tổng phần cam kết còn mở chưa thành actual.
   */
  /**
   * Phần còn mở của MỘT cam kết — NGUỒN DUY NHẤT cho cả tổng
   * openCommitmentTotal lẫn cột "Còn mở" từng cam kết ở UI (Bước B
   * I-5): 0 khi cam kết không còn mở (settled/released/cancelled…),
   * chưa duyệt hoặc đã archive; ngược lại max(0, amount − đã trả).
   */
  function openCommitmentAmount(commitment, actuals) {
    var c = commitment;
    if (!c) return 0;
    if (!isOpenCommitment(c)) return 0;
    if (!isApprovedFact(c)) return 0; // 0014: cam kết chưa duyệt không giữ ngân sách
    if (c.archivedAt || c.archived_at) return 0; // 0014: cam kết đã archive bị bỏ qua
    var amt = pickNum(c, ['amount', 'committedAmount', 'committed_amount', 'commitmentAmount', 'value']) || 0;
    return Math.max(0, amt - commitmentPaidTotal(c, actuals));
  }

  function openCommitmentTotal(commitments, actuals) {
    var total = 0;
    (commitments || []).forEach(function (c) {
      total += openCommitmentAmount(c, actuals);
    });
    return total;
  }

  /** Fact có cùng currency với currency chuẩn không (quy tắc SYN-09):
   *  phía chuẩn không có currency -> khớp; fact thiếu currency khi phía
   *  chuẩn có currency -> lệch. */
  function _factSameCurrency(f, currency) {
    if (currency === null || currency === undefined || String(currency).trim() === '') return true;
    if (!f) return false;
    var fc = f.currency !== undefined && f.currency !== null ? f.currency : (f.currencyCode !== undefined && f.currencyCode !== null ? f.currencyCode : f.currency_code);
    if (fc === undefined || fc === null || String(fc).trim() === '') return false;
    return String(fc).trim() === String(currency).trim();
  }

  /**
   * Tổng THỰC CHI ĐÃ DUYỆT của một dòng ngân sách (Bước B I-4) — nguồn
   * duy nhất cho thẻ "Đã chi", cột actualTotal và export CSV: chỉ cộng
   * actual ĐÃ DUYỆT (isApprovedFact) cùng currency với dòng (line là
   * object có currency, hoặc chính chuỗi currency, hoặc null).
   * Khớp thành phần actual của budgetUsageTotal.
   */
  function budgetActualTotal(line, actuals) {
    var currency = (line && typeof line === 'object')
      ? (line.currency || line.currencyCode || line.currency_code || null)
      : (typeof line === 'string' ? line : null);
    var total = 0;
    (actuals || []).forEach(function (a) {
      if (!a || !isApprovedFact(a)) return;
      if (!_factSameCurrency(a, currency)) return;
      total += pickNum(a, ['amount', 'actualAmount', 'actual_amount', 'value']) || 0;
    });
    return total;
  }

  /**
   * Tổng SỬ DỤNG ngân sách của một dòng (0014) — chỉ tính fact ĐÃ DUYỆT:
   * UsageTotal = Σ actuals đã duyệt + Σ nghĩa vụ mở của commitments đã duyệt,
   * nghĩa vụ của một commitment = max(0, amount − Σ actuals ĐÃ DUYỆT liên kết).
   * Commitment có status 'cancelled' (và các status không còn mở khác) hoặc
   * đã archive (archived_at) bị bỏ qua. Khi line có currency, chỉ tính fact
   * cùng currency với line: fact THIẾU currency bị coi là lệch currency
   * (SYN-09 — không tự tính như cùng currency; khớp SQL decide_* ở 0014,
   * nơi `currency is distinct from line.currency` → CURRENCY_MISMATCH và
   * usage chỉ cộng fact có currency = currency của line). Khi line KHÔNG
   * có currency thì không có chuẩn để đối chiếu nên vẫn tính mọi fact
   * (tương thích fixture cũ không khai currency ở cả hai phía).
   * settledAmount vẫn bị bỏ qua như budgetRemaining trước đây.
   * @param {object|number} line Dòng ngân sách (có currency?) hoặc số approved.
   * @param {Array<object>} commitments Các cam kết thuộc dòng.
   * @param {Array<object>} actuals Các khoản chi thuộc dòng.
   * @returns {number} Tổng đã sử dụng (đã duyệt).
   */
  function budgetUsageTotal(line, commitments, actuals) {
    var lineCurrency = (line && typeof line === 'object')
      ? (line.currency || line.currencyCode || line.currency_code || null) : null;
    function sameCurrency(f) {
      if (!lineCurrency || !f) return true;
      var fc = f.currency !== undefined && f.currency !== null ? f.currency : (f.currencyCode !== undefined && f.currencyCode !== null ? f.currencyCode : f.currency_code);
      // SYN-09: fact thiếu currency = lệch currency khi line có currency.
      if (fc === undefined || fc === null || String(fc).trim() === '') return false;
      return String(fc).trim() === String(lineCurrency).trim();
    }
    var acts = (actuals || []).filter(function (a) { return a && isApprovedFact(a) && sameCurrency(a); });
    var actualTotal = 0;
    acts.forEach(function (a) {
      actualTotal += pickNum(a, ['amount', 'actualAmount', 'actual_amount', 'value']) || 0;
    });
    var openTotal = 0;
    (commitments || []).forEach(function (c) {
      if (!c || !isApprovedFact(c) || !sameCurrency(c)) return;
      if (c.archivedAt || c.archived_at) return;
      if (!isOpenCommitment(c)) return;
      var amt = pickNum(c, ['amount', 'committedAmount', 'committed_amount', 'commitmentAmount', 'value']) || 0;
      openTotal += Math.max(0, amt - commitmentPaidTotal(c, acts));
    });
    return actualTotal + openTotal;
  }

  /**
   * Tính số tiền ngân sách còn lại của một dòng ngân sách.
   * Remaining = Approved − tổng Actual − cam kết còn mở.
   * "Đã trả" của mỗi cam kết CHỈ = Σ actuals liên kết (commitmentPaidTotal);
   * settledAmount bị bỏ qua hoàn toàn (R2-01/R2-02, một nguồn sự thật).
   * Cam kết đã có actual liên kết thì phần đã thanh toán không bị trừ hai lần.
   * @param {object} line Dòng ngân sách có approved/approvedAmount.
   * @param {Array<object>} commitments Các cam kết thuộc dòng.
   * @param {Array<object>} actuals Các khoản chi thực tế thuộc dòng.
   * @returns {number} Số tiền còn lại.
   */
  function budgetRemaining(line, commitments, actuals) {
    // line: object có approved/approvedAmount, hoặc chính số approved (number).
    var approved = (typeof line === 'number') ? line
      : (pickNum(line, ['approved', 'approvedAmount', 'approved_amount', 'budgetApproved', 'amountApproved']) || 0);
    // 0014: Remaining = Approved − UsageTotal (chỉ fact ĐÃ DUYỆT). Khi mọi
    // fact đã duyệt (hoặc không mang trạng thái) kết quả giữ nguyên như trước.
    return approved - budgetUsageTotal(line, commitments, actuals);
  }

  // ---------- KPI ----------

  /**
   * Cách hiển thị giá trị thực đạt của một KPI.
   * @param {object} kpi KPI có actual/actualValue.
   * @returns {{text:string, isMissing:boolean, value:(number|null)}} Thiếu actual thì
   *   text là "Chưa cập nhật" — không bao giờ bịa thành 0.
   */
  function kpiDisplay(kpi) {
    var actual = kpi ? pickNum(kpi, ['actual', 'actualValue', 'actual_value', 'currentValue']) : null;
    // pickNum trả null khi thiếu, nhưng actual = 0 là giá trị thật nên kiểm tra riêng.
    if (kpi && (kpi.actual === 0 || kpi.actualValue === 0 || kpi.actual_value === 0)) actual = 0;
    if (actual === null || actual === undefined) {
      return { text: 'Chưa cập nhật', isMissing: true, value: null };
    }
    return { text: String(actual), isMissing: false, value: actual };
  }

  // ---------- Chỉ số quảng cáo / nội dung ----------

  /**
   * Tính các tỷ lệ từ số liệu gốc. Giá trị không tính được trả null.
   * @param {{spend:number, impressions:number, clicks:number, results:number, conversionValue:number}} input
   * @returns {{ctr:(number|null), cpc:(number|null), cpm:(number|null), costPerResult:(number|null), roas:(number|null)}}
   */
  function computeRates(input) {
    var o = input || {};
    function num(k) {
      var v = o[k];
      return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
    }
    var spend = num('spend'), impressions = num('impressions'), clicks = num('clicks');
    var results = num('results'); if (results === null) results = num('conversions');
    var conversionValue = num('conversionValue'); if (conversionValue === null) conversionValue = num('revenue');
    function div(a, b) { return (a === null || b === null || b === 0) ? null : a / b; }
    return {
      ctr: div(clicks, impressions),
      cpc: div(spend, clicks),
      cpm: (spend === null || impressions === null || impressions === 0) ? null : spend / impressions * 1000,
      costPerResult: div(spend, results),
      roas: div(conversionValue, spend)
    };
  }

  /**
   * Gộp tỷ lệ từ nhiều dòng THEO TỪNG TIỀN TỆ (R2-21): tính lại từ TỔNG
   * tử số / TỔNG mẫu số trong từng bucket currency, không lấy trung bình
   * của các tỷ lệ và KHÔNG bao giờ cộng trộn tiền tệ (không có tổng/rates
   * gộp xuyên currency ở top-level).
   * @param {Array<object>} rows Các dòng số liệu gốc (mỗi dòng có currency?).
   * @returns {{byCurrency:object, mixed:boolean}} byCurrency[CUR] =
   *   { totals:{spend,impressions,clicks,results,conversionValue},
   *     ctr, cpc, cpm, roas }; dòng không có currency vào bucket '__unknown';
   *   mixed = true khi có hơn một bucket currency.
   */
  function aggregateRates(rows) {
    // R22/QA20 (giữ nguyên tắc trong từng bucket): trường nào THIẾU ở bất kỳ
    // dòng nào trong bucket (null/undefined/'') thì tổng của trường đó trong
    // bucket = null → tỷ lệ phụ thuộc trả null, KHÔNG ép 0.
    var fields = ['spend', 'impressions', 'clicks', 'results', 'conversionValue'];
    var buckets = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      var cur = (r.currency !== null && r.currency !== undefined && String(r.currency).trim() !== '')
        ? String(r.currency).trim() : '__unknown';
      if (!buckets[cur]) {
        buckets[cur] = { totals: {}, complete: {} };
        fields.forEach(function (f) { buckets[cur].totals[f] = 0; buckets[cur].complete[f] = true; });
      }
      var bucket = buckets[cur];
      fields.forEach(function (f) {
        var v = r[f];
        if (f === 'results' && v === undefined) v = r.conversions;
        if (f === 'conversionValue' && v === undefined) v = r.revenue;
        if (v === null || v === undefined || v === '' || isNaN(Number(v))) bucket.complete[f] = false;
        else bucket.totals[f] += Number(v);
      });
    });
    var byCurrency = {};
    Object.keys(buckets).forEach(function (cur) {
      var bucket = buckets[cur];
      var totals = {};
      fields.forEach(function (f) { totals[f] = bucket.complete[f] ? bucket.totals[f] : null; });
      var rates = computeRates(totals);
      byCurrency[cur] = { totals: totals, ctr: rates.ctr, cpc: rates.cpc, cpm: rates.cpm, roas: rates.roas };
    });
    return { byCurrency: byCurrency, mixed: Object.keys(byCurrency).length > 1 };
  }

  /**
   * Lấy snapshot trọn đời (lifetime) mới nhất theo thời điểm quan sát.
   * Số lifetime không cộng dồn — chỉ lấy giá trị ở lần quan sát mới nhất.
   * @param {Array<object>} observations Các lần quan sát có observedAt và value.
   * @returns {(number|null)} Giá trị mới nhất, hoặc null khi không có dữ liệu.
   */
  function latestLifetimeSnapshot(observations) {
    var list = (observations || []).filter(function (o) { return o && toDate(o.observedAt || o.observed_at || o.date || o.capturedAt); });
    if (!list.length) {
      // Không có mốc thời gian: lấy phần tử cuối cùng nếu có value.
      var raw = observations || [];
      if (!raw.length) return null;
      var last = raw[raw.length - 1];
      var lv = pickNum(last, ['value', 'metricValue', 'amount', 'count']);
      return lv;
    }
    list.sort(function (a, b) {
      return toDate(a.observedAt || a.observed_at || a.date || a.capturedAt) - toDate(b.observedAt || b.observed_at || b.date || b.capturedAt);
    });
    var latest = list[list.length - 1];
    return pickNum(latest, ['value', 'metricValue', 'amount', 'count']);
  }

  /**
   * Kiểm tra một tập observation có được cộng hay không.
   * Reach / lượt tiếp cận duy nhất không cộng được vì trùng lặp người xem.
   * @param {Array<object>|object} observations Observation hoặc danh sách observation.
   * @returns {{summable:boolean, reason:string, total:(number|null)}} Kết quả kiểm tra.
   */
  function sumUniqueReachGuard(observations) {
    var list = Array.isArray(observations) ? observations : (observations ? [observations] : []);
    var metricOf = function (o) { return normStatus(o && (o.metric || o.metricKey || o.metric_key || o.type || '')); };
    var hasUnique = list.some(function (o) {
      var m = metricOf(o);
      return m.indexOf('reach') !== -1 || m.indexOf('unique') !== -1 || m === 'reach' || m.indexOf('unique_reach') !== -1;
    });
    if (hasUnique) {
      return {
        summable: false,
        total: null,
        reason: 'Chỉ số reach/lượt tiếp cận duy nhất không cộng dồn được vì cùng một người có thể xuất hiện ở nhiều bài/kỳ; hãy lấy snapshot mới nhất hoặc xem theo từng bài.'
      };
    }
    var total = 0;
    list.forEach(function (o) { total += pickNum(o, ['value', 'metricValue', 'amount', 'count']) || 0; });
    return { summable: true, total: total, reason: 'Chỉ số này cộng dồn được theo các dòng đã chọn.' };
  }

  /**
   * Chỉ cộng số liệu quảng cáo ở MỘT cấp duy nhất (account/campaign/adset/ad).
   * @param {Array<object>} rows Các dòng số liệu có trường level.
   * @param {string} level Cấp được chọn: 'account' | 'campaign' | 'adset' | 'ad'.
   * @returns {object} Tổng số liệu của đúng cấp đó.
   */
  function pickLevelTotals(rows, level) {
    var filtered = (rows || []).filter(function (r) { return !level || normStatus(r.level || r.type) === normStatus(level); });
    var totals = { spend: 0, impressions: 0, clicks: 0, results: 0, conversionValue: 0 };
    filtered.forEach(function (r) {
      totals.spend += Number(r.spend || 0);
      totals.impressions += Number(r.impressions || 0);
      totals.clicks += Number(r.clicks || 0);
      totals.results += Number(r.results !== undefined ? r.results : (r.conversions || 0));
      totals.conversionValue += Number(r.conversionValue !== undefined ? r.conversionValue : (r.revenue || 0));
    });
    var rates = computeRates(totals);
    return {
      level: level || null,
      count: filtered.length,
      rows: filtered,
      spend: totals.spend,
      impressions: totals.impressions,
      clicks: totals.clicks,
      results: totals.results,
      conversionValue: totals.conversionValue,
      totals: totals,
      rates: rates, ctr: rates.ctr, cpc: rates.cpc, cpm: rates.cpm, roas: rates.roas
    };
  }

  /**
   * Kiểm tra tập dòng quảng cáo có lẫn nhiều cấp hay không và lấy tổng an toàn.
   * @param {Array<object>} rows Các dòng số liệu quảng cáo.
   * @param {string} [level] Cấp được chọn; bắt buộc khi rows lẫn nhiều cấp.
   * @returns {object} { valid, levels, totals } — valid=false khi lẫn cấp mà chưa chọn cấp.
   */
  function adsRollupGuard(rows, level) {
    var levels = [];
    (rows || []).forEach(function (r) {
      var lv = normStatus(r.level || r.type);
      if (lv && levels.indexOf(lv) === -1) levels.push(lv);
    });
    if (!level && levels.length > 1) {
      return {
        valid: false, summable: false, mixedLevels: true, levels: levels, totals: null,
        reason: 'Dữ liệu đang lẫn nhiều cấp (' + levels.join(', ') + '); phải chọn một cấp duy nhất để cộng, nếu không sẽ tính trùng.'
      };
    }
    var chosen = level || levels[0] || null;
    return { valid: true, summable: true, mixedLevels: false, levels: levels, level: chosen, totals: pickLevelTotals(rows || [], chosen) };
  }

  // ---------- Tiến độ campaign ----------

  /**
   * Tính tiến độ campaign chỉ từ các việc lá (việc không có việc con trong tập).
   * Việc cha có con thì không tính riêng; việc đã hủy bị loại khỏi mẫu số.
   * @param {Array<object>} tasks Các việc thuộc campaign.
   * @returns {{total:number, completed:number, progress:number, percentage:number}}
   */
  function campaignProgress(tasks) {
    var list = tasks || [];
    var parentIds = {};
    list.forEach(function (t) {
      var pid = t.parentId || t.parentTaskId || t.parent_id || t.parent;
      if (pid) parentIds[pid] = true;
    });
    var leaves = list.filter(function (t) {
      if (parentIds[t.id]) return false;
      var s = normStatus(t.status);
      return s !== 'cancelled' && s !== 'canceled' && s !== 'cancelled'.replace('led', 'led') && s !== 'hủy' && s !== 'đã hủy';
    });
    var completed = leaves.filter(isCompleted).length;
    var total = leaves.length;
    var progress = total === 0 ? 0 : completed / total;
    return { total: total, completed: completed, progress: progress, percentage: Math.round(progress * 100) };
  }

  // ---------- Tiến độ checklist của việc ----------

  /**
   * Tính tiến độ checklist của MỘT việc từ task.checklist = [{text, done}].
   * Nguồn sự thật duy nhất cho mọi bề mặt hiển thị (panel chi tiết, thẻ/hàng
   * việc, Gantt): đếm "done" theo đúng cách panel chi tiết đếm (mục có
   * done truthy). Checklist chỉ là hiển thị tiến độ — KHÔNG liên kết KPI,
   * KHÔNG tự đổi trạng thái việc.
   * @param {object} task Việc cần tính (có thể thiếu trường checklist).
   * @returns {{done:number, total:number, progress:number, percentage:number}}
   *   total = 0 khi việc không có checklist (bề mặt hiển thị phải ẩn chỉ dấu).
   */
  function checklistProgress(task) {
    var list = (task && Array.isArray(task.checklist)) ? task.checklist : [];
    var total = list.length;
    var done = list.filter(function (c) { return !!(c && c.done); }).length;
    var progress = total === 0 ? 0 : done / total;
    return { done: done, total: total, progress: progress, percentage: Math.round(progress * 100) };
  }

  // ---------- Timeline của màn Task (hàng cho Gantt dùng chung) ----------

  /** Task đã lưu trữ hay chưa (cùng quy ước với các builder Gantt ở app). */
  function isArchivedTask(task) {
    return !!(task && (task.archivedAt || task.archived || normStatus(task.status) === 'archived'));
  }

  /**
   * Dựng tập hàng Gantt cho Timeline của màn Task từ danh sách task THUẦN
   * (không đọc Store/DOM): chỉ task có ĐỦ ngày bắt đầu (startDate) và hạn
   * (dueDate) mới thành hàng vẽ được — đúng quy ước của engine ganttHtml
   * (hàng thiếu một trong hai mốc không vẽ thanh được); task thiếu ngày
   * trả riêng ở `unscheduled` để bề mặt hiển thị mục "Chưa xếp lịch (N)".
   * Hàng task mang đúng định dạng của ganttTaskRow ở app (key/coll/ganttId/
   * kind/status/checklist/baseline bStart-bEnd/completed/milestone +
   * cờ overdue/blocked suy ra tại đây để test độc lập được).
   * @param {Array<object>} tasks Mọi task ứng viên (đã qua lọc của màn Task
   *   ở app; hàm này còn áp lại 3 lọc campaign/người phụ trách/trạng thái
   *   nếu options.filter được truyền — 'all' = không lọc, campaignId ''
   *   = task độc lập, khớp ngữ nghĩa UI.taskFilter).
   * @param {object} [options] { campaigns, members, blockers, dependencies
   *   (hoặc edges), groupBy: 'campaign'|'assignee'|'none' (mặc định
   *   'campaign'), filter: {campaignId, ownerId|assigneeId, status},
   *   today: 'yyyy-mm-dd' (mốc tính quá hạn; thiếu thì lấy ngày hiện tại) }
   * @returns {{rows:Array, edges:Array, unscheduled:Array, datedCount:number,
   *   totalCount:number, groupBy:string}} edges chỉ còn các cạnh mà CẢ hai
   *   đầu đều là task đang hiển thị (có ngày, qua lọc) — lọc co edges.
   */
  function buildTaskTimeline(tasks, options) {
    options = options || {};
    var groupBy = ['campaign', 'assignee', 'none'].indexOf(options.groupBy) >= 0 ? options.groupBy : 'campaign';
    var today = options.today ? String(options.today).slice(0, 10) : toISODate(new Date());
    var campaigns = options.campaigns || [];
    var members = options.members || [];
    var filter = options.filter || null;
    var openBlocked = {};
    (options.blockers || []).forEach(function (b) { if (b && b.status === 'open' && b.taskId) openBlocked[b.taskId] = true; });
    function passFilter(t) {
      if (!filter) return true;
      if (filter.campaignId !== undefined && filter.campaignId !== null && filter.campaignId !== 'all' && (t.campaignId || '') !== filter.campaignId) return false;
      var ownerFilter = filter.ownerId !== undefined ? filter.ownerId : filter.assigneeId;
      if (ownerFilter !== undefined && ownerFilter !== null && ownerFilter !== 'all' && (t.assigneeId || '') !== ownerFilter) return false;
      if (filter.status !== undefined && filter.status !== null && filter.status !== 'all' && t.status !== filter.status) return false;
      return true;
    }
    var list = (tasks || []).filter(function (t) { return t && !isArchivedTask(t) && passFilter(t); });
    function isDated(t) { return !!(t.startDate && t.dueDate); }
    var dated = list.filter(isDated);
    var unscheduled = list.filter(function (t) { return !isDated(t); })
      .slice().sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'vi'); });
    var datedIds = {};
    dated.forEach(function (t) { datedIds[t.id] = true; });
    var edges = (options.dependencies || options.edges || []).filter(function (e) {
      return e && datedIds[e.predecessorId] && datedIds[e.successorId];
    });
    function byStart(a, b) {
      var sa = String(a.startDate).slice(0, 10), sb = String(b.startDate).slice(0, 10);
      if (sa !== sb) return sa < sb ? -1 : 1;
      var ea = String(a.dueDate).slice(0, 10), eb = String(b.dueDate).slice(0, 10);
      if (ea !== eb) return ea < eb ? -1 : 1;
      return String(a.title || '').localeCompare(String(b.title || ''), 'vi');
    }
    function taskRow(t, parentKey, depth, hasChildren) {
      var due = t.dueDate ? String(t.dueDate).slice(0, 10) : '';
      return {
        key: 'task:' + t.id, parentKey: parentKey, coll: 'tasks', id: t.id, ganttId: t.id, title: t.title,
        kind: 'task', depth: depth, start: t.startDate, end: t.dueDate, status: t.status, checklist: t.checklist,
        overdue: !!(due && due < today && !isCompleted(t) && normStatus(t.status) !== 'cancelled'),
        blocked: !!t.isBlocked || !!openBlocked[t.id],
        bStart: t.baselineStartDate, bEnd: t.baselineDueDate, completed: isCompleted(t),
        milestone: !!t.isMilestone, hasChildren: !!hasChildren
      };
    }
    var rows = [];
    if (groupBy === 'none') {
      dated.slice().sort(byStart).forEach(function (t) { rows.push(taskRow(t, undefined, 0, false)); });
      return { rows: rows, edges: edges, unscheduled: unscheduled, datedCount: dated.length, totalCount: list.length, groupBy: groupBy };
    }
    // Dựng nhóm theo chế độ: thứ tự nhóm theo danh sách campaign/member
    // được truyền vào; nhóm "trống chủ" (độc lập / chưa phân công) luôn cuối.
    var groups = [];
    var groupByKey = {};
    function groupFor(t) {
      var key, title, order;
      if (groupBy === 'campaign') {
        if (!t.campaignId) { key = 'tgrp:camp:none'; title = 'Không thuộc campaign'; order = campaigns.length + 1; }
        else {
          var ci = campaigns.findIndex(function (c) { return c.id === t.campaignId; });
          var camp = ci >= 0 ? campaigns[ci] : null;
          key = 'tgrp:camp:' + t.campaignId; title = camp ? camp.name : String(t.campaignId); order = ci >= 0 ? ci : campaigns.length;
        }
      } else {
        if (!t.assigneeId) { key = 'tgrp:assignee:none'; title = 'Chưa phân công'; order = members.length + 1; }
        else {
          var mi = members.findIndex(function (m) { return m.id === t.assigneeId; });
          var mem = mi >= 0 ? members[mi] : null;
          key = 'tgrp:assignee:' + t.assigneeId; title = mem ? mem.name : String(t.assigneeId); order = mi >= 0 ? mi : members.length;
        }
      }
      if (!groupByKey[key]) { groupByKey[key] = { key: key, title: title, order: order, tasks: [] }; groups.push(groupByKey[key]); }
      return groupByKey[key];
    }
    dated.forEach(function (t) { groupFor(t).tasks.push(t); });
    groups.sort(function (a, b) { return a.order - b.order || String(a.title).localeCompare(String(b.title), 'vi'); });
    groups.forEach(function (g) {
      rows.push({ key: g.key, coll: '', id: '', ganttId: '', title: g.title, kind: 'group', depth: 0, hasChildren: true });
      // Cây con trong CÙNG nhóm: task con có cha ở nhóm khác (hoặc cha
      // không có ngày/không qua lọc) thì làm gốc của nhóm mình — không
      // task nào bị mất khỏi Timeline vì quan hệ cha lệch nhóm.
      var inGroup = {};
      g.tasks.forEach(function (t) { inGroup[t.id] = true; });
      var byParent = {};
      g.tasks.forEach(function (t) { var k = (t.parentId && inGroup[t.parentId]) ? t.parentId : '__root'; (byParent[k] = byParent[k] || []).push(t); });
      Object.keys(byParent).forEach(function (k) { byParent[k].sort(byStart); });
      function walk(t, parentKey, depth) {
        var children = byParent[t.id] || [];
        rows.push(taskRow(t, parentKey, depth, children.length > 0));
        children.forEach(function (ch) { walk(ch, 'task:' + t.id, depth + 1); });
      }
      (byParent.__root || []).forEach(function (t) { walk(t, g.key, 1); });
    });
    return { rows: rows, edges: edges, unscheduled: unscheduled, datedCount: dated.length, totalCount: list.length, groupBy: groupBy };
  }

  // ---------- Timeline hợp nhất — chế độ "Cây campaign" ----------

  /**
   * Dựng tập hàng Gantt cho chế độ "Cây campaign" của view Timeline THUẦN
   * (không đọc Store/DOM): cây campaign → phase → activity → task (task con
   * lồng theo parentId), task độc lập (không campaignId, hoặc campaignId
   * không còn trong danh sách campaign) gom vào nhóm CUỐI
   * "Không thuộc campaign" (key 'grp:no-campaign').
   *
   * Hàng task mang đúng định dạng engine ganttHtml cần (như buildTaskTimeline:
   * key/coll/ganttId/kind/status/checklist/baseline/completed/milestone +
   * overdue/blocked). Task THIẾU ngày bắt đầu hoặc hạn KHÔNG thành hàng —
   * trả riêng ở `unscheduled` đúng định nghĩa của buildTaskTimeline (đếm
   * "Chưa xếp lịch (N)" như chế độ phẳng). edges chỉ còn cạnh mà CẢ hai đầu
   * đều là task đang hiển thị (có ngày, qua lọc).
   *
   * BỘ LỌC (options.filter = {campaignId, ownerId|assigneeId, status};
   * 'all'/thiếu = không lọc; campaignId '' = chỉ task độc lập):
   * - campaignId thu hẹp cây: id cụ thể → chỉ cây của campaign đó (nhóm độc
   *   lập bị loại); '' → chỉ nhóm độc lập.
   * - ownerId/status CHỈ áp lên hàng task.
   *
   * ĐỊNH NGHĨA CẮT TỈA (khi có lọc task — ownerId hoặc status khác 'all'):
   * - Hàng cấu trúc (phase / activity / nhóm "Chưa gắn phase/activity" /
   *   nhóm "Không thuộc campaign" / campaign) chỉ được giữ khi còn ÍT NHẤT
   *   MỘT hàng task hiển thị là hậu duệ của nó (qua chuỗi parentKey).
   * - NGOẠI LỆ: hàng campaign được chọn TƯỜNG MINH bằng filter.campaignId
   *   (id cụ thể) thì luôn giữ, kể cả khi không còn task hiển thị nào.
   * - Khi KHÔNG có lọc task: không cắt tỉa — giữ nguyên cấu trúc như Gantt
   *   tổng thể cũ (campaign/phase/activity hiện đủ kể cả khi chưa có task
   *   có ngày bên dưới).
   * Task có cha bị lọc mất (hoặc cha chưa xếp lịch) thì thành gốc của nhóm
   * cấu trúc của chính nó — không task nào qua lọc bị mất khỏi cây.
   * @param {object} data { campaigns, phases, activities, tasks,
   *   dependencies (hoặc edges), blockers }
   * @param {object} [options] { filter, today: 'yyyy-mm-dd' }
   * @returns {{rows:Array, edges:Array, unscheduled:Array, datedCount:number,
   *   totalCount:number, mode:string}} totalCount = số task qua lọc (kể cả
   *   chưa xếp lịch); datedCount = số task thành hàng.
   */
  function buildCampaignTreeTimeline(data, options) {
    data = data || {};
    options = options || {};
    var filter = options.filter || {};
    var today = options.today ? String(options.today).slice(0, 10) : toISODate(new Date());
    var fCamp = (filter.campaignId === undefined || filter.campaignId === null) ? 'all' : filter.campaignId;
    var fOwnerRaw = filter.ownerId !== undefined ? filter.ownerId : filter.assigneeId;
    var fOwner = (fOwnerRaw === undefined || fOwnerRaw === null) ? 'all' : fOwnerRaw;
    var fStatus = (filter.status === undefined || filter.status === null) ? 'all' : filter.status;
    var taskFilterActive = fOwner !== 'all' || fStatus !== 'all';
    function isArchivedEntity(x) { return !!(x && (x.archivedAt || x.archived || normStatus(x.status) === 'archived')); }
    var campaigns = (data.campaigns || []).filter(function (c) { return c && !isArchivedEntity(c); });
    var campById = {};
    campaigns.forEach(function (c) { campById[c.id] = c; });
    var openBlocked = {};
    (data.blockers || []).forEach(function (b) { if (b && b.status === 'open' && b.taskId) openBlocked[b.taskId] = true; });
    function isIndependent(t) { return !t.campaignId || !campById[t.campaignId]; }
    function passFilter(t) {
      if (!t || isArchivedTask(t)) return false;
      if (fCamp !== 'all') {
        if (fCamp === '') { if (!isIndependent(t)) return false; }
        else if ((t.campaignId || '') !== fCamp) return false;
      }
      if (fOwner !== 'all' && (t.assigneeId || '') !== fOwner) return false;
      if (fStatus !== 'all' && t.status !== fStatus) return false;
      return true;
    }
    var scoped = (data.tasks || []).filter(passFilter);
    function isDated(t) { return !!(t.startDate && t.dueDate); }
    var dated = scoped.filter(isDated);
    var unscheduled = scoped.filter(function (t) { return !isDated(t); })
      .slice().sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'vi'); });
    var datedIds = {};
    dated.forEach(function (t) { datedIds[t.id] = true; });
    var edges = (data.dependencies || data.edges || []).filter(function (e) {
      return e && datedIds[e.predecessorId] && datedIds[e.successorId];
    });
    function treeTaskRow(t, parentKey, depth) {
      var due = t.dueDate ? String(t.dueDate).slice(0, 10) : '';
      return {
        key: 'task:' + t.id, parentKey: parentKey, coll: 'tasks', id: t.id, ganttId: t.id, title: t.title,
        kind: 'task', depth: depth, start: t.startDate, end: t.dueDate, status: t.status, checklist: t.checklist,
        overdue: !!(due && due < today && !isCompleted(t) && normStatus(t.status) !== 'cancelled'),
        blocked: !!t.isBlocked || !!openBlocked[t.id],
        bStart: t.baselineStartDate, bEnd: t.baselineDueDate, completed: isCompleted(t),
        milestone: !!t.isMilestone, hasChildren: false
      };
    }
    // Đẩy cây task của một phạm vi cấu trúc vào rows: gốc là task có cha
    // KHÔNG nằm trong tập task có ngày của phạm vi (cha bị lọc/chưa xếp
    // lịch/thuộc phạm vi khác) — gốc nhận parentKey/depth từ hàm truyền vào.
    function appendDatedTaskTree(rows, scopeTasks, rootKeyOf, rootDepthOf) {
      var inScope = {};
      scopeTasks.forEach(function (t) { inScope[t.id] = true; });
      var byParent = {};
      scopeTasks.forEach(function (t) {
        var k = (t.parentId && inScope[t.parentId]) ? t.parentId : '__root';
        (byParent[k] = byParent[k] || []).push(t);
      });
      var seen = {};
      function walk(t, parentKey, depth) {
        if (seen[t.id]) return;
        seen[t.id] = true;
        rows.push(treeTaskRow(t, parentKey, depth));
        (byParent[t.id] || []).forEach(function (ch) { walk(ch, 'task:' + t.id, depth + 1); });
      }
      (byParent.__root || []).forEach(function (t) { walk(t, rootKeyOf(t), rootDepthOf(t)); });
    }
    var rows = [];
    var scopedCampaigns = campaigns.filter(function (c) {
      if (fCamp === 'all') return true;
      if (fCamp === '') return false;
      return c.id === fCamp;
    });
    scopedCampaigns.forEach(function (c) {
      var campKey = 'camp:' + c.id;
      var phases = (data.phases || []).filter(function (p) { return p && p.campaignId === c.id; });
      var phaseIds = {};
      phases.forEach(function (p) { phaseIds[p.id] = true; });
      var acts = (data.activities || []).filter(function (a) { return a && a.campaignId === c.id; });
      var actById = {};
      acts.forEach(function (a) { actById[a.id] = a; });
      var ctasks = dated.filter(function (t) { return t.campaignId === c.id; });
      rows.push({
        key: campKey, coll: 'campaigns', id: c.id, ganttId: c.id, title: c.name, kind: 'campaign',
        status: c.status, depth: 0, start: c.startDate, end: c.endDate,
        bStart: c.baselineStartDate, bEnd: c.baselineEndDate,
        hasChildren: false, completed: normStatus(c.status) === 'completed'
      });
      phases.forEach(function (p) {
        var pkey = 'phase:' + p.id;
        rows.push({
          key: pkey, parentKey: campKey, coll: 'phases', id: p.id, ganttId: p.id, title: p.name, kind: 'phase',
          status: p.status, depth: 1, start: p.startDate, end: p.endDate,
          bStart: p.baselineStartDate, bEnd: p.baselineEndDate, hasChildren: false
        });
        acts.filter(function (a) { return a.phaseId === p.id; }).forEach(function (a) {
          rows.push({
            key: 'act:' + a.id, parentKey: pkey, coll: 'activities', id: a.id, ganttId: a.id, title: a.name, kind: 'activity',
            status: a.status, depth: 2, start: a.startDate || p.startDate, end: a.endDate || p.endDate,
            bStart: a.baselineStartDate, bEnd: a.baselineEndDate, hasChildren: false
          });
        });
      });
      acts.filter(function (a) { return !a.phaseId || !phaseIds[a.phaseId]; }).forEach(function (a) {
        rows.push({
          key: 'act:' + a.id, parentKey: campKey, coll: 'activities', id: a.id, ganttId: a.id,
          title: a.name + (a.channel ? ' (' + a.channel + ')' : ''), kind: 'activity',
          status: a.status, depth: 1, start: a.startDate, end: a.endDate,
          bStart: a.baselineStartDate, bEnd: a.baselineEndDate, hasChildren: false
        });
      });
      function rootKeyOf(t) {
        if (t.activityId && actById[t.activityId]) return 'act:' + t.activityId;
        if (t.phaseId && phaseIds[t.phaseId]) return 'phase:' + t.phaseId;
        return 'grp:' + c.id;
      }
      function rootDepthOf(t) {
        if (t.activityId && actById[t.activityId]) {
          var a = actById[t.activityId];
          return (a.phaseId && phaseIds[a.phaseId]) ? 3 : 2;
        }
        return 2;
      }
      // Nhóm "Chưa gắn phase/activity" chỉ dựng khi có task GỐC rơi vào nó.
      var inCamp = {};
      ctasks.forEach(function (t) { inCamp[t.id] = true; });
      var needGrp = ctasks.some(function (t) {
        return !(t.parentId && inCamp[t.parentId]) && rootKeyOf(t) === 'grp:' + c.id;
      });
      if (needGrp) {
        rows.push({ key: 'grp:' + c.id, parentKey: campKey, coll: '', id: '', ganttId: '', title: 'Chưa gắn phase/activity', kind: 'group', depth: 1, hasChildren: false });
      }
      appendDatedTaskTree(rows, ctasks, rootKeyOf, rootDepthOf);
    });
    // Nhóm cuối: task độc lập.
    var indScoped = scoped.filter(isIndependent);
    if (indScoped.length) {
      rows.push({ key: 'grp:no-campaign', coll: '', id: '', ganttId: '', title: 'Không thuộc campaign', kind: 'group', depth: 0, hasChildren: false });
      appendDatedTaskTree(rows, dated.filter(isIndependent),
        function () { return 'grp:no-campaign'; }, function () { return 1; });
    }
    // Cắt tỉa nhánh rỗng khi có lọc task (định nghĩa ở đầu hàm): giữ tổ tiên
    // của mọi hàng task hiển thị; campaign được chọn tường minh luôn giữ.
    if (taskFilterActive) {
      var keep = {};
      rows.forEach(function (r) { if (r.kind === 'task') keep[r.key] = true; });
      var changed = true;
      while (changed) {
        changed = false;
        rows.forEach(function (r) {
          if (keep[r.key] && r.parentKey && !keep[r.parentKey]) { keep[r.parentKey] = true; changed = true; }
        });
      }
      if (fCamp !== 'all' && fCamp !== '') keep['camp:' + fCamp] = true;
      rows = rows.filter(function (r) { return !!keep[r.key]; });
      // edges chỉ còn cạnh giữa các hàng task đang hiển thị (hàng task không
      // bị cắt tỉa nên edges giữ nguyên như đã lọc theo datedIds).
    }
    // hasChildren tính lại trên đúng tập hàng cuối cùng.
    var hasChild = {};
    rows.forEach(function (r) { if (r.parentKey) hasChild[r.parentKey] = true; });
    rows.forEach(function (r) { r.hasChildren = !!hasChild[r.key]; });
    return { rows: rows, edges: edges, unscheduled: unscheduled, datedCount: dated.length, totalCount: scoped.length, mode: 'tree' };
  }

  /**
   * Trạng thái khởi tạo cho view Timeline khi mở từ nút "Mở Timeline" ở màn
   * Task: chế độ "Chỉ task" + bộ lọc của view nhận ĐÚNG 3 lọc campaign /
   * người phụ trách / trạng thái hiện tại của màn Task (các lọc phụ của màn
   * Task — ưu tiên/hạn/bị chặn — không thuộc bộ lọc chung của Timeline nên
   * không mang theo). Hàm thuần để kiểm thử ở tầng state.
   * @param {object} taskFilter UI.taskFilter hiện tại của màn Task.
   * @returns {{mode:string, filter:{campaignId:*, ownerId:*, status:*}}}
   */
  function timelineStateFromTaskFilter(taskFilter) {
    var tf = taskFilter || {};
    var owner = (tf.ownerId !== undefined && tf.ownerId !== null) ? tf.ownerId
      : ((tf.assigneeId !== undefined && tf.assigneeId !== null) ? tf.assigneeId : 'all');
    return {
      mode: 'tasks',
      filter: {
        campaignId: (tf.campaignId === undefined || tf.campaignId === null) ? 'all' : tf.campaignId,
        ownerId: owner,
        status: (tf.status === undefined || tf.status === null) ? 'all' : tf.status
      }
    };
  }

  // ---------- TikTok / Publish ----------

  /** Lấy platform đã chuẩn hoá của một variant. */
  function platformOf(variant) { return normStatus(variant && (variant.platform || variant.channel || variant.network)); }
  /** Lấy chế độ đăng của một variant. */
  function publishModeOf(variant) { return normStatus(variant && (variant.publishMode || variant.publish_mode || variant.mode)); }

  /**
   * App có tự đăng được lên TikTok hay không — luôn là không.
   * @param {object} variant Variant nội dung.
   * @returns {boolean} false khi platform là tiktok.
   */
  function tiktokCanPublish(variant) {
    if (platformOf(variant) === 'tiktok') return false;
    return false; // App không có kênh tự đăng TikTok; hàm này chỉ trả lời cho TikTok.
  }

  /**
   * Có nên tạo PublishJob cho variant này hay không.
   * @param {object} variant Variant nội dung.
   * @returns {boolean} false nếu đăng ngoài app (external) hoặc là TikTok.
   */
  function shouldCreatePublishJob(variant) {
    if (!variant) return false;
    if (platformOf(variant) === 'tiktok') return false;
    if (publishModeOf(variant) === 'external') return false;
    return true;
  }

  // ---------- Ngày tháng (Việt Nam, tuần từ thứ Hai) ----------

  /**
   * Định dạng ngày thành dd/mm/yyyy.
   * @param {string|Date} iso Ngày ISO hoặc Date.
   * @returns {string} Chuỗi dd/mm/yyyy, hoặc chuỗi rỗng nếu không hợp lệ.
   */
  function formatDateVN(iso) {
    var d = toDate(iso);
    if (!d) return '';
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  /**
   * Định dạng ngày giờ thành dd/mm/yyyy HH:mm (24h).
   * @param {string|Date} iso Mốc thời gian ISO hoặc Date.
   * @returns {string} Chuỗi dd/mm/yyyy HH:mm.
   */
  function formatDateTimeVN(iso) {
    var d = toDate(iso);
    if (!d) return '';
    return formatDateVN(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /**
   * Tìm thứ Hai đầu tuần chứa ngày cho trước.
   * @param {string|Date} date Ngày bất kỳ trong tuần.
   * @returns {Date} Date ở 00:00 của thứ Hai tuần đó.
   */
  function weekStartMonday(date) {
    var d = toDate(date) || new Date();
    var out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = out.getDay(); // 0 = Chủ nhật
    var diff = (dow + 6) % 7; // Số ngày lùi về thứ Hai
    out.setDate(out.getDate() - diff);
    return out;
  }


  // ======================================================================
  // R23 — Lifetime theo object (QA19)
  // ======================================================================
  function _obsObjectId(o) { return o.objectId || o.object_id || o.externalPostId || o.external_post_id || o.postId || null; }
  function _obsObjectType(o) { return o.objectType || o.object_type || (o.externalPostId ? 'external_post' : 'unknown'); }
  function _obsMetric(o) { return o.metric || o.metricCode || o.metric_code || null; }
  function _obsScope(o) { return o.scope || 'lifetime'; }
  function _obsDefinition(o) { return o.definitionVersion != null ? o.definitionVersion : (o.definition_version != null ? o.definition_version : 1); }
  /**
   * Latest lifetime THEO object+metric+scope+definition: mỗi nhóm chỉ giữ
   * observation có observedAt mới nhất. Trả mảng entry (không cộng snapshot).
   */
  function lifetimeLatestByObject(observations) {
    var groups = {};
    (observations || []).forEach(function (o, idx) {
      if (!o) return;
      var key = _obsObjectType(o) + ':' + _obsObjectId(o) + '|' + _obsMetric(o) + '|' + _obsScope(o) + '|v' + _obsDefinition(o);
      var t = toDate(o.observedAt || o.observed_at || o.date || o.capturedAt);
      var prev = groups[key];
      if (!prev || (t && (!prev._t || t >= prev._t))) {
        groups[key] = {
          objectType: _obsObjectType(o), objectId: _obsObjectId(o), metric: _obsMetric(o),
          scope: _obsScope(o), definitionVersion: _obsDefinition(o),
          value: pickNum(o, ['value', 'metricValue', 'amount', 'count']),
          observedAt: o.observedAt || o.observed_at || o.date || o.capturedAt || null,
          currency: o.currency || null, _t: t, _idx: idx
        };
      }
    });
    return Object.keys(groups).sort().map(function (k) { var e = groups[k]; delete e._t; delete e._idx; return e; });
  }
  /**
   * Tổng lifetime hợp lệ: cộng latest của từng object CHỈ khi cùng
   * metric+scope+definition (+currency nếu có). Khác định nghĩa → null.
   */
  function sumLifetimeLatest(observations, filter) {
    filter = filter || {};
    var entries = lifetimeLatestByObject(observations).filter(function (e) {
      if (filter.metric && e.metric !== filter.metric) return false;
      if (filter.scope && e.scope !== filter.scope) return false;
      return e.value !== null;
    });
    if (!entries.length) return null;
    var defs = {}, curs = {};
    entries.forEach(function (e) { defs[e.definitionVersion] = true; if (e.currency) curs[e.currency] = true; });
    if (Object.keys(defs).length > 1 || Object.keys(curs).length > 1) return null;
    return entries.reduce(function (sum, e) { return sum + e.value; }, 0);
  }

  // ======================================================================
  // R21/R24 — Lọc ads insights theo đúng cấp + tài khoản
  // ======================================================================
  var ADS_LEVEL_TO_OBJECT_TYPE = { account: 'ad_account', ad_account: 'ad_account', campaign: 'ad_campaign', ad_campaign: 'ad_campaign', adset: 'ad_group', ad_group: 'ad_group', adgroup: 'ad_group', ad: 'ad' };
  /**
   * Dataset cho selector báo cáo: chỉ giữ insights thuộc đúng object level
   * và (nếu có) đúng ad account. Row thiếu account linkage khi lọc theo
   * account bị loại (không đoán). Trả mảng row đã lọc.
   */
  function filterInsightsByLevelAndAccount(rows, options) {
    options = options || {};
    var wantType = options.level ? ADS_LEVEL_TO_OBJECT_TYPE[normStatus(options.level)] : null;
    var accountId = options.accountId || options.adAccountId || null;
    return (rows || []).filter(function (r) {
      var type = r.objectType || r.object_type || r.level || r.type;
      var normType = ADS_LEVEL_TO_OBJECT_TYPE[normStatus(type)] || type;
      if (wantType && normType !== wantType) return false;
      if (accountId) {
        var rowAccount = r.adAccountId || r.ad_account_id || r.accountId || (normType === 'ad_account' ? (r.objectId || r.object_id) : null);
        if (!rowAccount || String(rowAccount) !== String(accountId)) return false;
      }
      return true;
    });
  }

  // ======================================================================
  // R22 — CSV export: null = ô trống + cột trạng thái thiếu (QA20/QA21)
  // ======================================================================
  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    var str = String(v);
    return /[",\n;]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }
  /**
   * buildCsv(rows, columns): columns = [{key, label}].
   * Giá trị null/thiếu → ô trống (không ||0). Thêm cột cuối
   * 'missing_status' liệt kê các cột thiếu của dòng ('đầy đủ' nếu đủ).
   */
  function buildCsv(rows, columns) {
    var cols = columns || [];
    var header = cols.map(function (c) { return csvEscape(c.label || c.key); }).concat(['missing_status']);
    var lines = [header.join(',')];
    (rows || []).forEach(function (r) {
      var missing = [];
      var cells = cols.map(function (c) {
        var v = r ? r[c.key] : null;
        if (v === null || v === undefined || v === '') { missing.push(c.label || c.key); return ''; }
        return csvEscape(v);
      });
      cells.push(csvEscape(missing.length ? ('Thiếu: ' + missing.join('; ')) : 'đầy đủ'));
      lines.push(cells.join(','));
    });
    return lines.join('\n');
  }

  // ======================================================================
  // R25 — Workload theo TUẦN được chọn, chỉ leaf tasks (QA22)
  // ======================================================================
  /**
   * weeklyWorkload(tasks, options):
   *  options = { weekStart:'yyyy-mm-dd' (bắt buộc), weekEnd? (mặc định +6 ngày),
   *              holidays?: string[], capacityByMember?: {memberId:{hoursPerWeek, daysOff:[]}},
   *              defaultCapacityHoursPerWeek?: number|null }
   * Chỉ tính leaf tasks (task có subtask trong tập bị bỏ). Effort phân bổ
   * theo ngày làm việc trên TOÀN khoảng task rồi chỉ cộng phần thuộc tuần —
   * task 3 tuần không dồn hết vào 1 tuần. Capacity/ngày nghỉ lấy từ tham số,
   * KHÔNG hardcode 40h/8h: thiếu cấu hình → capacity = null.
   * Trả [{memberId, hours, capacityHours, daysOff, taskIds, overCapacity}]
   */
  function weeklyWorkload(tasks, options) {
    options = options || {};
    var list = tasks || [];
    var parentIds = {};
    list.forEach(function (t) { var pid = t.parentId || t.parent_id; if (pid) parentIds[pid] = true; });
    var weekStart = toDate(options.weekStart || options.startDate);
    if (!weekStart) return [];
    var weekEnd = toDate(options.weekEnd || options.endDate) || addDays(weekStart, 6);
    var startIso = toISODate(weekStart), endIso = toISODate(weekEnd);
    var byMember = {};
    list.forEach(function (t) {
      if (parentIds[t.id]) return; // không đếm cha khi đã có con
      var st = normStatus(t.status);
      if (st === 'cancelled' || st === 'canceled' || st === 'hủy') return;
      var memberId = t.assigneeId || t.ownerId || t.owner_id || 'unassigned';
      var capCfg = (options.capacityByMember || {})[memberId] || {};
      var holidays = (options.holidays || []).concat(capCfg.daysOff || capCfg.days_off || []);
      var dist = distributeEffort(t, { holidays: holidays });
      if (!Array.isArray(dist)) return;
      var sum = 0;
      dist.forEach(function (d) { if (d.date >= startIso && d.date <= endIso) sum += d.hours; });
      if (!byMember[memberId]) {
        var cap = capCfg.hoursPerWeek != null ? capCfg.hoursPerWeek
          : (capCfg.capacityHoursPerWeek != null ? capCfg.capacityHoursPerWeek
          : (options.defaultCapacityHoursPerWeek != null ? options.defaultCapacityHoursPerWeek : null));
        byMember[memberId] = { memberId: memberId, hours: 0, capacityHours: cap, daysOff: (capCfg.daysOff || []).slice(), taskIds: [], overCapacity: false };
      }
      byMember[memberId].hours = Math.round((byMember[memberId].hours + sum) * 100) / 100;
      if (sum > 0) byMember[memberId].taskIds.push(t.id);
    });
    return Object.keys(byMember).sort().map(function (k) {
      var r = byMember[k];
      r.overCapacity = r.capacityHours !== null && r.hours > r.capacityHours;
      return r;
    });
  }

  // ======================================================================
  // R30 — Đánh giá rủi ro trễ (chỉ khi có cơ sở thật)
  // ======================================================================
  /**
   * assessTaskRisk(task, context): context = { today, tasks, dependencies, blockers }.
   * atRisk CHỈ khi: (1) quá hạn & chưa xong; (2) có blocker đang mở gắn task;
   * (3) slack âm — predecessor kết thúc SAU ngày task bắt đầu.
   * Tiền nhiệm chưa xong nhưng còn slack (due <= start của task) KHÔNG phải rủi ro.
   */
  function assessTaskRisk(task, context) {
    context = context || {};
    if (!task) return { atRisk: false, reasons: [] };
    var reasons = [];
    var today = context.today || toISODate(new Date());
    var done = isCompleted(task) || normStatus(task.status) === 'cancelled';
    var due = pickDate(task, ['dueDate', 'due_date', 'due']);
    if (!done && due && String(due).slice(0, 10) < today) reasons.push('overdue');
    var blockers = context.blockers || [];
    var hasOpenBlocker = task.isBlocked === true || blockers.some(function (b) {
      return (b.taskId === task.id || b.task_id === task.id) && ['open', 'in_progress'].indexOf(normStatus(b.status || 'open')) !== -1;
    });
    if (hasOpenBlocker) reasons.push('blocker');
    var start = pickDate(task, ['startDate', 'start_date', 'start']);
    if (!done && start) {
      var byId = {}; (context.tasks || []).forEach(function (t) { byId[t.id] = t; });
      var slackNegative = (context.dependencies || []).some(function (e) {
        if (e.successorId !== task.id) return false;
        var pred = byId[e.predecessorId];
        if (!pred || isCompleted(pred)) return false;
        var predDue = pickDate(pred, ['dueDate', 'due_date', 'due']);
        return predDue && String(predDue).slice(0, 10) > String(start).slice(0, 10);
      });
      if (slackNegative) reasons.push('negative_slack');
    }
    return { atRisk: reasons.length > 0, reasons: reasons };
  }

  // ======================================================================
  // R3.1 — Tổng hợp ngân sách theo scope + roll-up KPI (chống đếm trùng)
  // ======================================================================
  // Nguyên tắc (đặc tả R3.1 B.3/B.4, C.4/C.5, D.1/D.2):
  // - Tiền chỉ đếm từ FACT GỐC (commitment / actual / payment), khử trùng
  //   theo fact ID. Task/content/KPI chỉ THAM CHIẾU fact — thêm tham chiếu
  //   không bao giờ làm tăng tiền.
  // - available = ceiling − actualTotal − openCommitments. KHÔNG cộng
  //   "còn trong hạn mức action" + "chưa phân bổ" vào available lần nữa:
  //   hai khoản đó là THÀNH PHẦN của available, không phải cộng thêm.
  // - Số khác currency không cộng chung: mọi tổng tách theo byCurrency
  //   (giữ pattern của aggregateRates R2-21).

  /** Làm tròn tiền tới 6 chữ số thập phân để khử nhiễu float (1.799999… → 1.8). */
  function _r31RoundMoney(x) { return Math.round(x * 1e6) / 1e6; }
  /** Làm tròn 2 chữ số thập phân (dùng cho % đạt KPI). */
  function _r31Round2(x) { return Math.round(x * 100) / 100; }

  function _r31FactId(f) {
    if (!f) return null;
    var id = f.id !== undefined && f.id !== null ? f.id : (f.factId !== undefined && f.factId !== null ? f.factId : f.fact_id);
    return (id === null || id === undefined || id === '') ? null : String(id);
  }
  function _r31FactKind(f, fallback) {
    var k = normStatus((f && (f.kind || f.factType || f.fact_type || f.type)) || fallback || '');
    if (k === 'payment' || k === 'actual' || k === 'actuals' || k === 'expense') return 'actual';
    if (k === 'commitment' || k === 'commitments') return 'commitment';
    return fallback === 'commitment' ? 'commitment' : 'actual';
  }
  function _r31FactAmount(f) { return pickNum(f, ['amount', 'actualAmount', 'actual_amount', 'value', 'total']) || 0; }
  function _r31FactCurrency(f, fallback) {
    var c = f && (f.currency || f.currencyCode || f.currency_code);
    return (c !== null && c !== undefined && String(c).trim() !== '') ? String(c).trim() : (fallback || 'VND');
  }
  function _r31AllocScopeId(a) {
    if (!a) return null;
    var v = a.scopeId !== undefined && a.scopeId !== null ? a.scopeId
      : (a.activityId !== undefined && a.activityId !== null ? a.activityId
      : (a.activity_id !== undefined && a.activity_id !== null ? a.activity_id
      : (a.targetId !== undefined && a.targetId !== null ? a.targetId : a.target_id)));
    return (v === null || v === undefined || v === '') ? null : String(v);
  }
  /** Số tiền của một allocation: amount tường minh, hoặc ratio (0–1), hoặc percent (0–100). */
  function _r31AllocAmount(a, factAmount) {
    if (!a) return 0;
    var amt = pickNum(a, ['amount', 'shareAmount', 'share_amount', 'allocatedAmount']);
    if (amt !== null) return amt;
    var ratio = pickNum(a, ['ratio', 'shareRatio', 'share_ratio']);
    if (ratio !== null) return ratio * factAmount;
    var pct = pickNum(a, ['percent', 'percentage', 'sharePercent']);
    if (pct !== null) return pct / 100 * factAmount;
    return 0;
  }
  function _r31FactAllocations(f) {
    if (!f) return [];
    var list = f.allocations || f.allocationShares || f.shares || [];
    return Array.isArray(list) ? list : [];
  }
  function _r31FactScopeId(f) {
    if (!f) return null;
    var v = f.activityId !== undefined && f.activityId !== null ? f.activityId
      : (f.activity_id !== undefined && f.activity_id !== null ? f.activity_id
      : (f.scopeId !== undefined && f.scopeId !== null ? f.scopeId : f.scope_id));
    return (v === null || v === undefined || v === '') ? null : String(v);
  }

  /**
   * Kiểm tra allocations của MỘT fact gốc: tổng share không được vượt
   * amount gốc (tiền và tỷ lệ). UI/store dùng kết quả để chặn lưu; backend
   * cũng phải chặn riêng (hàm này là tầng domain dùng chung).
   * @param {object|number} fact Fact gốc (có amount) hoặc chính amount.
   * @param {Array<object>} [allocations] Allocations; bỏ qua thì lấy fact.allocations.
   * @returns {{valid:boolean, errors:string[], totalAllocated:number,
   *   totalRatio:(number|null), amount:number, unallocated:number}}
   *   errors chứa 'over_allocated' (tổng tiền vượt gốc) và/hoặc
   *   'allocation_exceeds_100_percent' (tổng tỷ lệ vượt 100%),
   *   'negative_allocation' khi có share âm.
   */
  function validateAllocations(fact, allocations) {
    var amount = (typeof fact === 'number') ? fact : _r31FactAmount(fact || {});
    var list = allocations || (fact && typeof fact === 'object' ? _r31FactAllocations(fact) : []);
    var errors = [];
    var totalAllocated = 0;
    var totalRatio = null;
    (list || []).forEach(function (a) {
      var amt = _r31AllocAmount(a, amount);
      if (amt < 0) errors.push('negative_allocation');
      totalAllocated += amt;
      var ratio = a ? pickNum(a, ['ratio', 'shareRatio', 'share_ratio']) : null;
      var pct = a ? pickNum(a, ['percent', 'percentage', 'sharePercent']) : null;
      if (ratio !== null || pct !== null) {
        if (totalRatio === null) totalRatio = 0;
        totalRatio += (ratio !== null ? ratio : 0) + (pct !== null ? pct / 100 : 0);
      }
    });
    totalAllocated = _r31RoundMoney(totalAllocated);
    if (totalRatio !== null) {
      totalRatio = _r31RoundMoney(totalRatio);
      if (totalRatio > 1 + 1e-9 && errors.indexOf('allocation_exceeds_100_percent') === -1) {
        errors.push('allocation_exceeds_100_percent');
      }
    }
    if (amount > 0 && totalAllocated > amount + 1e-9 && errors.indexOf('over_allocated') === -1) {
      errors.push('over_allocated');
    }
    if (amount <= 0 && totalAllocated > 1e-9 && errors.indexOf('over_allocated') === -1) {
      errors.push('over_allocated');
    }
    return {
      valid: errors.length === 0,
      errors: errors,
      totalAllocated: totalAllocated,
      totalRatio: totalRatio,
      amount: amount,
      unallocated: _r31RoundMoney(amount - totalAllocated)
    };
  }

  /**
   * SYN-10: chia số tiền gốc cho các allocation theo LARGEST-REMAINDER về
   * 2 chữ số thập phân (khớp DB numeric(18,2)): mỗi share được làm tròn
   * xuống tới cent, phần cent còn thiếu so với tổng đích được cộng lần
   * lượt cho các share có phần dư thập phân lớn nhất (hòa thì theo thứ tự
   * khai báo). Tổng đích = số gốc khi các allocation phủ kín số gốc (tổng
   * thô lệch số gốc dưới 1 cent do làm tròn tỷ lệ, vd 33,333333% × 3),
   * ngược lại = tổng thô làm tròn 2 chữ số. Nhờ vậy tổng mọi share LUÔN
   * bằng đúng tổng đích ở độ chính xác cent — hóa đơn 100 chia 1/3 × 3
   * cho 33,34 + 33,33 + 33,33 = 100 (không còn 99,999999 như khi làm
   * tròn 6 chữ số từng share); hóa đơn 3tr chia 60/40 giữ 1,8tr / 1,2tr.
   * @param {number} factAmount Số tiền gốc.
   * @param {Array<object>} allocs Allocations của fact.
   * @returns {Array<number>} Share đã chốt theo đúng thứ tự allocs.
   */
  function _r31AllocSharesMoney(factAmount, allocs) {
    var raws = (allocs || []).map(function (a) { return _r31AllocAmount(a, factAmount); });
    if (!raws.length) return raws;
    // Share âm (dữ kiện lỗi — validateAllocations chặn riêng) không tham
    // gia phân phối cent: giữ nguyên làm tròn 2 chữ số cho các share đó.
    if (raws.some(function (v) { return v < 0; })) {
      return raws.map(function (v) { return Math.round(v * 100) / 100; });
    }
    var rawTotal = raws.reduce(function (s, v) { return s + v; }, 0);
    var targetCents = (Math.abs(rawTotal - factAmount) < 0.01)
      ? Math.round(factAmount * 100)
      : Math.round(rawTotal * 100);
    var cents = raws.map(function (v) { return Math.floor(v * 100 + 1e-9); });
    var remainder = targetCents - cents.reduce(function (s, v) { return s + v; }, 0);
    if (remainder > 0) {
      var order = raws.map(function (v, i) { return { i: i, frac: v * 100 - Math.floor(v * 100 + 1e-9) }; })
        .sort(function (a, b) { return (b.frac - a.frac) || (a.i - b.i); });
      var k = 0;
      while (remainder > 0 && order.length) { cents[order[k % order.length].i] += 1; remainder -= 1; k += 1; }
    }
    return cents.map(function (c) { return c / 100; });
  }

  /**
   * Share của một fact gốc nhìn từ một scope (activity): có allocations thì
   * lấy tổng share khớp scope; không có allocations thì fact thuộc đúng
   * scope mới tính trọn, fact không gắn scope nào thì tính trọn (caller
   * được hiểu là đã lọc fact theo scope). Không có scopeId → trọn amount.
   * Share theo allocation được chốt qua _r31AllocSharesMoney (SYN-10,
   * largest-remainder 2 chữ số) nên cộng share của mọi scope lại bằng
   * đúng số gốc.
   * @param {object} fact Fact gốc.
   * @param {string} [scopeId] Scope cần xem (vd activity id).
   * @returns {number} Số tiền thuộc scope.
   */
  function allocationShareForScope(fact, scopeId) {
    if (!fact) return 0;
    var amount = _r31FactAmount(fact);
    if (!scopeId) return amount;
    var allocs = _r31FactAllocations(fact);
    if (allocs.length) {
      var shares = _r31AllocSharesMoney(amount, allocs);
      var sum = 0; var matched = false;
      allocs.forEach(function (a, idx) {
        if (_r31AllocScopeId(a) === String(scopeId)) { matched = true; sum += shares[idx]; }
      });
      return matched ? _r31RoundMoney(sum) : 0;
    }
    var own = _r31FactScopeId(fact);
    if (own) return own === String(scopeId) ? amount : 0;
    return amount;
  }

  /**
   * Engine tổng hợp ngân sách DÙNG CHUNG cho campaign và activity (R3.1 C.5/D.1).
   * @param {object} input
   * @param {number|object} input.ceiling Hạn mức của scope (số, hoặc {amount, currency}).
   * @param {string} [input.currency] Currency chính của scope (mặc định suy từ ceiling/fact, cuối cùng 'VND').
   * @param {Array<object>} [input.childAllocations] Phân bổ hạn mức xuống scope con
   *   (vd 4 activity của campaign): [{id?, scopeId/activityId, amount, currency?}].
   *   Cũng chấp nhận input.activityAllocations / input.allocations.
   * @param {number} [input.directCeiling] Hạn mức giữ cho chi trực tiếp của scope
   *   (vd chi phí trực tiếp campaign) — trừ vào unallocated.
   * @param {Array<object>} [input.commitments] Fact cam kết gốc.
   * @param {Array<object>} [input.actuals] Fact thực chi gốc (payment cũng vào đây).
   * @param {Array<object>} [input.payments] Alias của actuals.
   * @param {Array<object>} [input.facts] Fact hỗn hợp (kind/type phân biệt commitment|actual).
   * @param {string} [input.scopeId] Khi xem theo MỘT activity: tiền tính theo
   *   allocation share của từng fact cho scope đó. Bỏ qua = view toàn scope cha
   *   (mỗi fact tính trọn 1 lần theo ID).
   * Các khoá tham chiếu như views/references/tasks/contents/kpis KHÔNG được
   * đọc để tính tiền — chúng chỉ là đường dẫn xem lại fact gốc.
   * @returns {object} { ceiling, allocated, unallocated, actualTotal,
   *   openCommitments, forecastUse, available, currency, mixed, byCurrency,
   *   valid, allocationErrors, factCount, duplicateFactIds }
   *   forecastUse = actualTotal + openCommitments;
   *   available = ceiling − actualTotal − openCommitments;
   *   unallocated = ceiling − allocated − directCeiling.
   *   Khi nhiều currency: các trường top-level = null (không cộng trộn),
   *   số đúng nằm trong byCurrency[CUR] với cùng công thức.
   */
  function summarizeBudgetScope(input) {
    input = input || {};
    var ceilingObj = (input.ceiling && typeof input.ceiling === 'object') ? input.ceiling : null;
    var ceiling = ceilingObj ? (pickNum(ceilingObj, ['amount', 'value']) || 0)
      : (pickNum(input, ['ceiling', 'ceilingAmount', 'approvedCeiling', 'limit', 'approved']) || 0);
    var primaryCurrency = input.currency || (ceilingObj && ceilingObj.currency) || null;
    var directCeiling = pickNum(input, ['directCeiling', 'direct_ceiling', 'directAmount']) || 0;
    var scopeId = (input.scopeId !== undefined && input.scopeId !== null && input.scopeId !== '')
      ? String(input.scopeId)
      : (input.activityId !== undefined && input.activityId !== null && input.activityId !== '' ? String(input.activityId) : null);

    // --- Thu thập fact gốc, khử trùng theo (kind, id) ---
    var seen = {};
    var duplicateFactIds = [];
    var facts = [];
    function collect(list, fallbackKind) {
      (list || []).forEach(function (f) {
        if (!f || typeof f !== 'object') return;
        var kind = _r31FactKind(f, fallbackKind);
        // 0014: fact commitment/actual CHƯA DUYỆT bị loại khỏi mọi tổng —
        // kể cả khi truyền qua input.facts. Fact bị loại thì phần allocation
        // gắn với chính fact đó cũng không được tính (fact không còn trong
        // tập tính toán nên share của nó không tới được bất kỳ scope nào).
        if ((kind === 'commitment' || kind === 'actual') && !isApprovedFact(f)) return;
        var id = _r31FactId(f);
        if (id !== null) {
          var key = kind + ':' + id;
          if (seen[key]) { duplicateFactIds.push(id); return; }
          seen[key] = true;
        }
        facts.push({ raw: f, kind: kind, id: id });
      });
    }
    collect(input.facts, null);
    collect(input.commitments, 'commitment');
    collect(input.actuals, 'actual');
    collect(input.payments, 'actual');

    // Currency chính: tham số > ceiling > fact đầu tiên > 'VND'.
    if (!primaryCurrency) {
      for (var i = 0; i < facts.length; i++) {
        var fc = facts[i].raw.currency || facts[i].raw.currencyCode;
        if (fc) { primaryCurrency = String(fc).trim(); break; }
      }
      if (!primaryCurrency) primaryCurrency = 'VND';
    }

    // --- Validate allocations của từng fact (chặn over-allocation ở tầng domain) ---
    var allocationErrors = [];
    facts.forEach(function (entry) {
      var allocs = _r31FactAllocations(entry.raw);
      if (!allocs.length) return;
      var v = validateAllocations(entry.raw, allocs);
      if (!v.valid) allocationErrors.push({ factId: entry.id, errors: v.errors, totalAllocated: v.totalAllocated, amount: v.amount });
    });

    // --- Phân bổ hạn mức xuống scope con (khử trùng theo id nếu có) ---
    var childAllocations = input.childAllocations || input.activityAllocations || input.allocations || [];
    var seenAlloc = {};
    var allocEntries = [];
    (childAllocations || []).forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      var aid = a.id !== undefined && a.id !== null && a.id !== '' ? String(a.id) : null;
      if (aid !== null) {
        if (seenAlloc[aid]) return;
        seenAlloc[aid] = true;
      }
      allocEntries.push(a);
    });

    // --- Cộng theo từng currency ---
    var buckets = {};
    function bucketFor(cur) {
      if (!buckets[cur]) {
        buckets[cur] = { currency: cur, ceiling: 0, allocated: 0, actualTotal: 0, openCommitments: 0 };
      }
      return buckets[cur];
    }
    bucketFor(primaryCurrency).ceiling = ceiling;
    if (input.ceilingsByCurrency && typeof input.ceilingsByCurrency === 'object') {
      Object.keys(input.ceilingsByCurrency).forEach(function (cur) {
        bucketFor(cur).ceiling = Number(input.ceilingsByCurrency[cur]) || 0;
      });
    }
    allocEntries.forEach(function (a) {
      var cur = _r31FactCurrency(a, primaryCurrency);
      bucketFor(cur).allocated += pickNum(a, ['amount', 'allocatedAmount', 'value']) || 0;
    });
    // Actual trước (để tính phần đã trả theo share cho cam kết của từng scope).
    var actualEntries = facts.filter(function (e) { return e.kind === 'actual'; });
    actualEntries.forEach(function (entry) {
      var cur = _r31FactCurrency(entry.raw, primaryCurrency);
      bucketFor(cur).actualTotal += allocationShareForScope(entry.raw, scopeId);
    });
    facts.filter(function (e) { return e.kind === 'commitment'; }).forEach(function (entry) {
      if (!isOpenCommitment(entry.raw)) return;
      if (entry.raw.archivedAt || entry.raw.archived_at) return; // 0014: bỏ qua cam kết đã archive
      if (!isApprovedFact(entry.raw)) return; // 0014 (phòng thủ: collect đã lọc)
      var cur = _r31FactCurrency(entry.raw, primaryCurrency);
      var scopedAmount = allocationShareForScope(entry.raw, scopeId);
      if (scopedAmount <= 0) return;
      // Đã trả trong scope = tổng share của actuals liên kết commitment này.
      var paidScoped = 0;
      actualEntries.forEach(function (ae) {
        var cid = ae.raw.commitmentId !== undefined && ae.raw.commitmentId !== null ? ae.raw.commitmentId : ae.raw.commitment_id;
        if (cid !== null && cid !== undefined && cid !== '' && entry.id !== null && String(cid) === entry.id) {
          paidScoped += allocationShareForScope(ae.raw, scopeId);
        }
      });
      bucketFor(cur).openCommitments += Math.max(0, scopedAmount - paidScoped);
    });

    // SYN-13 (Bước B I-0): currency CHƯA đặt trần -> available = null
    // (hiển thị '—'), không phải số âm giả. Nguồn quyết định nằm TẠI
    // domain: input.ceilingConfigured (cho currency chính) /
    // input.ceilingConfiguredByCurrency {CUR: bool} /
    // input.ceilingsByCurrency (có key = đã cấu hình). Không truyền
    // cờ nào -> giữ hành vi cũ (coi như đã cấu hình) cho caller cũ.
    var ceilingConfiguredMap = {};
    if (input.ceilingsByCurrency && typeof input.ceilingsByCurrency === 'object') {
      Object.keys(input.ceilingsByCurrency).forEach(function (cur) { ceilingConfiguredMap[cur] = true; });
    }
    if (input.ceilingConfiguredByCurrency && typeof input.ceilingConfiguredByCurrency === 'object') {
      Object.keys(input.ceilingConfiguredByCurrency).forEach(function (cur) { ceilingConfiguredMap[cur] = !!input.ceilingConfiguredByCurrency[cur]; });
    }
    if (typeof input.ceilingConfigured === 'boolean') ceilingConfiguredMap[primaryCurrency] = input.ceilingConfigured;
    function ceilingConfiguredFor(cur) {
      return Object.prototype.hasOwnProperty.call(ceilingConfiguredMap, cur) ? !!ceilingConfiguredMap[cur] : true;
    }
    var byCurrency = {};
    Object.keys(buckets).forEach(function (cur) {
      var b = buckets[cur];
      var actualTotal = _r31RoundMoney(b.actualTotal);
      var openCommitments = _r31RoundMoney(b.openCommitments);
      var allocated = _r31RoundMoney(b.allocated);
      var configured = ceilingConfiguredFor(cur);
      byCurrency[cur] = {
        currency: cur,
        ceiling: b.ceiling,
        ceilingConfigured: configured,
        allocated: allocated,
        unallocated: _r31RoundMoney(b.ceiling - allocated - (cur === primaryCurrency ? directCeiling : 0)),
        actualTotal: actualTotal,
        openCommitments: openCommitments,
        forecastUse: _r31RoundMoney(actualTotal + openCommitments),
        available: configured ? _r31RoundMoney(b.ceiling - actualTotal - openCommitments) : null
      };
    });
    var currencies = Object.keys(byCurrency);
    var mixed = currencies.length > 1;
    var result = {
      scopeId: scopeId,
      mixed: mixed,
      byCurrency: byCurrency,
      valid: allocationErrors.length === 0,
      allocationErrors: allocationErrors,
      factCount: facts.length,
      duplicateFactIds: duplicateFactIds
    };
    if (!mixed && currencies.length === 1) {
      var only = byCurrency[currencies[0]];
      result.ceilingConfigured = only.ceilingConfigured;
      result.ceiling = only.ceiling;
      result.allocated = only.allocated;
      result.unallocated = only.unallocated;
      result.actualTotal = only.actualTotal;
      result.openCommitments = only.openCommitments;
      result.forecastUse = only.forecastUse;
      result.available = only.available;
      result.currency = only.currency;
    } else {
      // Nhiều currency (hoặc không có dữ liệu): không xuất số gộp trộn tiền tệ.
      result.ceiling = mixed ? null : ceiling;
      result.allocated = mixed ? null : 0;
      result.unallocated = mixed ? null : _r31RoundMoney(ceiling - directCeiling);
      result.actualTotal = mixed ? null : 0;
      result.openCommitments = mixed ? null : 0;
      result.forecastUse = mixed ? null : 0;
      result.available = mixed ? null : ceiling;
      result.currency = mixed ? null : primaryCurrency;
    }
    return result;
  }

  // ---------- KPI roll-up (R3.1 C.4 / D.2) ----------

  function _r31FactMetric(f) {
    if (!f) return null;
    var v = f.metricCode || f.metric_code || f.metric || f.metricKey || f.metric_key;
    return (v === null || v === undefined || v === '') ? null : String(v);
  }
  function _r31FactUnit(f) {
    if (!f) return null;
    var v = f.unit || f.unitCode || f.unit_code;
    return (v === null || v === undefined || v === '') ? null : String(v);
  }
  function _r31FactPeriod(f) {
    if (!f) return null;
    if (f.period) return String(f.period);
    var s = f.periodStart || f.period_start;
    var e = f.periodEnd || f.period_end;
    if (s || e) return String(s || '') + '..' + String(e || '');
    return null;
  }
  function _r31NormalizeIdentityKey(k) {
    return String(k === null || k === undefined ? '' : k).trim().toLowerCase();
  }
  function _r31FactIdentityKeys(f) {
    if (!f) return null;
    var lists = [f.identities, f.identityKeys, f.identity_keys, f.keys, f.registrationIds, f.memberIds, f.leadIds];
    for (var i = 0; i < lists.length; i++) {
      if (Array.isArray(lists[i])) return lists[i].map(_r31NormalizeIdentityKey).filter(function (k) { return k !== ''; });
    }
    var single = f.identityKey || f.identity_key || f.dedupKey || f.dedup_key;
    if (single !== null && single !== undefined && String(single).trim() !== '') return [_r31NormalizeIdentityKey(single)];
    return null;
  }
  function _r31KpiAchievement(value, target) {
    if (value === null || value === undefined || target === null || target === undefined || Number(target) === 0 || isNaN(Number(target))) return null;
    return _r31Round2(value / Number(target) * 100);
  }

  /**
   * Roll-up KPI theo chế độ khai báo (R3.1 C.4/D.2) — chống đếm trùng theo fact ID.
   * @param {Array<object>} facts Fact/observation nguồn. Mỗi fact: { id,
   *   metricCode, unit, period (hoặc periodStart/periodEnd), value,
   *   identities?/identityKey? (cho unique), objectId? + observedAt? (cho
   *   snapshot), numerator?/denominator? (cho ratio) }.
   * @param {object} options { mode:'sum'|'unique'|'ratio'|'snapshot',
   *   metricCode?, unit?, period?, target?, scope?/scopeId?/scopeLabel?,
   *   numeratorFacts?, denominatorFacts?, numeratorMetricCode?,
   *   denominatorMetricCode?, numerator?, denominator?, currency? }
   * @returns {object} Kết quả luôn có { mode, value, status, scope, scopeLabel,
   *   includedFactIds, excluded:[{id, reason}], duplicateFactIds }.
   *   - sum: chỉ cộng fact cùng metric_code + unit + period; fact lệch bị
   *     loại và liệt kê trong excluded (không cộng ngầm).
   *   - unique: đếm distinct theo khóa định danh đã chuẩn hoá (trim +
   *     lowercase); fact thiếu khóa → value=null, status='insufficient_data'
   *     (không bao giờ trả tổng thô như thể đã khử trùng).
   *   - ratio: tính lại Σ tử / Σ mẫu của scope khai báo, kết quả mang
   *     scope/scopeLabel + numeratorTotal/denominatorTotal.
   *   - snapshot: mỗi object chỉ lấy observation mới nhất rồi mới cộng.
   *   Có target hợp lệ → kèm achievementPercent (làm tròn 2 chữ số).
   */
  function rollupKpi(facts, options) {
    options = options || {};
    var mode = normStatus(options.mode || 'sum');
    var scopeLabel = options.scopeLabel || options.scope || options.scopeId || null;
    var scope = options.scope || options.scopeId || scopeLabel;

    // Khử trùng theo fact ID trước mọi phép tính.
    var seen = {};
    var duplicateFactIds = [];
    var deduped = [];
    (facts || []).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var id = _r31FactId(f);
      if (id !== null) {
        if (seen[id]) { duplicateFactIds.push(id); return; }
        seen[id] = true;
      }
      deduped.push(f);
    });

    var refMetric = options.metricCode || options.metric_code || null;
    var refUnit = options.unit || null;
    var refPeriod = options.period || null;
    if (!refPeriod && (options.periodStart || options.periodEnd)) {
      refPeriod = String(options.periodStart || '') + '..' + String(options.periodEnd || '');
    }
    if (mode !== 'ratio') {
      // Tham chiếu mặc định = fact đầu tiên (khi caller không khai báo).
      for (var i = 0; i < deduped.length; i++) {
        if (!refMetric) refMetric = _r31FactMetric(deduped[i]);
        if (!refUnit) refUnit = _r31FactUnit(deduped[i]);
        if (!refPeriod) refPeriod = _r31FactPeriod(deduped[i]);
        if (refMetric && refUnit && refPeriod) break;
      }
    }

    function eligibility(f) {
      var m = _r31FactMetric(f);
      if (refMetric && m !== String(refMetric)) return 'metric_mismatch';
      var u = _r31FactUnit(f);
      if (refUnit && u !== String(refUnit)) return 'unit_mismatch';
      var p = _r31FactPeriod(f);
      if (refPeriod && p !== String(refPeriod)) return 'period_mismatch';
      return null;
    }

    var base = {
      mode: mode,
      scope: scope,
      scopeLabel: scopeLabel,
      metricCode: refMetric ? String(refMetric) : null,
      unit: refUnit ? String(refUnit) : null,
      period: refPeriod ? String(refPeriod) : null,
      duplicateFactIds: duplicateFactIds
    };

    if (mode === 'ratio') {
      var numTotal = null;
      var denTotal = null;
      var includedRatio = [];
      var ratioDuplicateFactIds = [];
      function sumFactValues(list) {
        // SYN-05: khử trùng theo fact ID TRONG từng danh sách tử/mẫu —
        // cùng một fact truyền qua 2 mapping chỉ cộng 1 lần (như nhánh
        // facts chính). Fact không có ID thì cộng bình thường.
        var total = 0; var any = false;
        var seenInList = {};
        (list || []).forEach(function (f) {
          if (!f || typeof f !== 'object') return;
          var fid = _r31FactId(f);
          if (fid !== null) {
            if (seenInList[fid]) {
              if (ratioDuplicateFactIds.indexOf(fid) === -1) ratioDuplicateFactIds.push(fid);
              return;
            }
            seenInList[fid] = true;
          }
          var v = pickNum(f, ['value', 'amount', 'count']);
          if (v !== null) { total += v; any = true; if (fid && includedRatio.indexOf(fid) === -1) includedRatio.push(fid); }
        });
        return any ? total : null;
      }
      if (Array.isArray(options.numeratorFacts) || Array.isArray(options.denominatorFacts)) {
        numTotal = sumFactValues(options.numeratorFacts);
        denTotal = sumFactValues(options.denominatorFacts);
      } else if (options.numeratorMetricCode || options.denominatorMetricCode) {
        numTotal = sumFactValues(deduped.filter(function (f) { return _r31FactMetric(f) === String(options.numeratorMetricCode); }));
        denTotal = sumFactValues(deduped.filter(function (f) { return _r31FactMetric(f) === String(options.denominatorMetricCode); }));
      } else if (deduped.some(function (f) { return f.numerator !== undefined || f.denominator !== undefined; })) {
        var nSum = 0; var dSum = 0; var nAny = false; var dAny = false;
        deduped.forEach(function (f) {
          var nv = pickNum(f, ['numerator', 'numeratorValue']);
          var dv = pickNum(f, ['denominator', 'denominatorValue']);
          if (nv !== null) { nSum += nv; nAny = true; }
          if (dv !== null) { dSum += dv; dAny = true; }
          var fid = _r31FactId(f); if (fid && includedRatio.indexOf(fid) === -1) includedRatio.push(fid);
        });
        numTotal = nAny ? nSum : null;
        denTotal = dAny ? dSum : null;
      }
      if (numTotal === null && options.numerator !== undefined && options.numerator !== null) numTotal = Number(options.numerator);
      if (denTotal === null && options.denominator !== undefined && options.denominator !== null) denTotal = Number(options.denominator);
      var ratioExcluded = deduped.filter(function (f) {
        var fid = _r31FactId(f);
        return fid && includedRatio.indexOf(fid) === -1;
      }).map(function (f) { return { id: _r31FactId(f), reason: 'not_in_ratio_scope' }; });
      var ratioResult = Object.assign({}, base, {
        includedFactIds: includedRatio,
        excluded: ratioExcluded,
        numeratorTotal: numTotal,
        denominatorTotal: denTotal,
        currency: options.currency || null,
        // Gộp trùng của nhánh chính (base) với trùng phát hiện trong tử/mẫu.
        duplicateFactIds: duplicateFactIds.concat(ratioDuplicateFactIds.filter(function (x) { return duplicateFactIds.indexOf(x) === -1; }))
      });
      if (numTotal === null || denTotal === null || denTotal === 0) {
        ratioResult.value = null;
        ratioResult.status = 'insufficient_data';
        ratioResult.reason = 'Thiếu tử số/mẫu số hoặc mẫu số bằng 0 cho scope đã khai báo.';
      } else {
        ratioResult.value = numTotal / denTotal;
        ratioResult.status = 'ok';
      }
      ratioResult.achievementPercent = _r31KpiAchievement(ratioResult.value, options.target);
      return ratioResult;
    }

    // sum / unique / snapshot: lọc theo metric + unit + period trước.
    var included = [];
    var excluded = [];
    deduped.forEach(function (f) {
      var reason = eligibility(f);
      if (reason) excluded.push({ id: _r31FactId(f), metricCode: _r31FactMetric(f), unit: _r31FactUnit(f), period: _r31FactPeriod(f), reason: reason });
      else included.push(f);
    });
    var result = Object.assign({}, base, {
      includedFactIds: included.map(_r31FactId).filter(function (x) { return x !== null; }),
      excluded: excluded
    });

    if (mode === 'unique') {
      var missingKeyFacts = [];
      var distinct = {};
      included.forEach(function (f) {
        var keys = _r31FactIdentityKeys(f);
        if (!keys || !keys.length) { missingKeyFacts.push(_r31FactId(f)); return; }
        keys.forEach(function (k) { distinct[k] = true; });
      });
      result.missingIdentityFactIds = missingKeyFacts;
      if (!included.length || missingKeyFacts.length) {
        result.value = null;
        result.status = 'insufficient_data';
        result.reason = 'Thiếu khóa định danh để khử trùng — không tuyên bố tổng unique từ tổng thô.';
      } else {
        result.value = Object.keys(distinct).length;
        result.status = 'ok';
        result.distinctCount = result.value;
      }
      result.achievementPercent = _r31KpiAchievement(result.value, options.target);
      if (options.target !== undefined && options.target !== null) result.target = Number(options.target);
      return result;
    }

    if (mode === 'snapshot') {
      var latestByObject = {};
      // SYN-17: fact THIẾU khóa object tường minh (objectId / externalPostId /
      // postId) KHÔNG được rơi về fact id / số thứ tự dòng — như vậy 2 lần đo
      // của cùng một object sẽ bị coi là 2 object và cộng dồn lặng lẽ. Thiếu
      // khóa → insufficient_data (như mode unique thiếu khóa định danh).
      var missingObjectFactIds = [];
      included.forEach(function (f) {
        var objectId = f.objectId || f.object_id || f.externalPostId || f.external_post_id || f.postId || f.post_id || null;
        if (objectId === null || objectId === undefined || String(objectId).trim() === '') {
          missingObjectFactIds.push(_r31FactId(f));
          return;
        }
        var key = String(objectId);
        var t = toDate(f.observedAt || f.observed_at || f.date || f.capturedAt);
        var prev = latestByObject[key];
        if (!prev || (t && (!prev._t || t >= prev._t)) || (!t && !prev._t)) {
          latestByObject[key] = {
            objectId: key,
            value: pickNum(f, ['value', 'metricValue', 'amount', 'count']),
            observedAt: f.observedAt || f.observed_at || f.date || f.capturedAt || null,
            _t: t
          };
        }
      });
      var perObject = Object.keys(latestByObject).sort().map(function (k) {
        var e = latestByObject[k]; return { objectId: e.objectId, value: e.value, observedAt: e.observedAt };
      });
      result.perObject = perObject;
      result.missingObjectFactIds = missingObjectFactIds;
      if (missingObjectFactIds.length) {
        result.value = null;
        result.status = 'insufficient_data';
        result.reason = 'Thiếu objectId để lấy snapshot theo đối tượng — không cộng dồn các lần đo khi chưa biết chúng thuộc object nào.';
      } else if (!perObject.length || perObject.some(function (e) { return e.value === null; })) {
        result.value = null;
        result.status = 'insufficient_data';
        result.reason = 'Thiếu observation hợp lệ để lấy snapshot mới nhất.';
      } else {
        result.value = perObject.reduce(function (sum, e) { return sum + e.value; }, 0);
        result.status = 'ok';
      }
      result.achievementPercent = _r31KpiAchievement(result.value, options.target);
      if (options.target !== undefined && options.target !== null) result.target = Number(options.target);
      return result;
    }

    // mode sum (mặc định)
    var total = 0;
    included.forEach(function (f) { total += pickNum(f, ['value', 'amount', 'count']) || 0; });
    result.value = _r31RoundMoney(total);
    result.status = 'ok';
    result.achievementPercent = _r31KpiAchievement(result.value, options.target);
    if (options.target !== undefined && options.target !== null) result.target = Number(options.target);
    return result;
  }

  // ======================================================================
  // KPI ↔ BỘ ĐẾM BÀI ĐÃ ĐĂNG — actual tự động từ metric_observations
  // ======================================================================
  // Danh mục mã chỉ số của metric_observations ĐANG DÙNG THẬT trong app:
  // - lifetime_views / views / reach / impressions: thư viện bài đã đăng +
  //   màn hình kênh (libLatestMetric / latestMetric trong app.js) và
  //   fixture demo (obs của post-1/post-2/post-3).
  // - likes / comments / shares: form nhập số liệu tay của bài/TikTok
  //   (placeholder "views, likes, comments, shares…" trong app.js).
  // UI chọn metric cho KPI auto PHẢI lấy từ danh mục này — không chế mã mới.
  var POST_METRIC_CODES = ['lifetime_views', 'views', 'reach', 'impressions', 'likes', 'comments', 'shares'];

  /** Definition của KPI dạng object (jsonb passthrough); chuỗi JSON thì parse, còn lại → null. */
  function _kpiDefinitionObject(kpi) {
    if (!kpi) return null;
    var def = kpi.definition;
    if (typeof def === 'string') {
      try { def = JSON.parse(def); } catch (e) { return null; }
    }
    if (!def || typeof def !== 'object') return null;
    return def;
  }

  /**
   * Cấu hình nguồn tự động của KPI, lưu ở kpi.definition.dataSource:
   *   { type:'post_metrics', metric:'<metric_code>', mode:'latest_sum'|'period_sum',
   *     channelAccountId? }
   * Không có dataSource hoặc type khác 'post_metrics' → KPI manual → null.
   * mode thiếu/lạ → chuẩn hoá về 'latest_sum' (ngữ nghĩa snapshot mới nhất).
   * @param {object} kpi KPI cần đọc cấu hình.
   * @returns {(object|null)} { type:'post_metrics', metric, mode, channelAccountId? } hoặc null.
   */
  function kpiDataSource(kpi) {
    if (!kpi) return null;
    var def = _kpiDefinitionObject(kpi);
    var ds = null;
    if (def) ds = def.dataSource || def.data_source || null;
    if (!ds && kpi.dataSource) ds = kpi.dataSource; // fallback: cấu hình để ở top-level
    if (!ds || typeof ds !== 'object') return null;
    if (String(ds.type || '').trim() !== 'post_metrics') return null;
    var metric = ds.metric || ds.metricCode || ds.metric_code || null;
    if (metric === null || metric === undefined || String(metric).trim() === '') return null;
    var mode = String(ds.mode || 'latest_sum').trim();
    if (mode !== 'latest_sum' && mode !== 'period_sum') mode = 'latest_sum';
    var out = { type: 'post_metrics', metric: String(metric).trim(), mode: mode };
    var chan = ds.channelAccountId || ds.channel_account_id || null;
    if (chan !== null && chan !== undefined && String(chan) !== '') out.channelAccountId = chan;
    return out;
  }

  /** 'yyyy-mm-dd' trích từ giá trị ngày/datetime (giữ nguyên ngày như đã ghi), null nếu không hợp lệ. */
  function _dateOnlyStr(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : toISODate(v);
    var s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  /**
   * Kỳ KPI dạng { start:'yyyy-mm-dd'|null, end:'yyyy-mm-dd'|null }:
   * ưu tiên periodStart/periodEnd; chỉ có periodKey 'YYYY-MM' thì suy cả
   * tháng đó; không có kỳ nào → null (không lọc).
   */
  function _kpiPeriodRange(kpi) {
    if (!kpi) return null;
    var start = _dateOnlyStr(kpi.periodStart || kpi.period_start);
    var end = _dateOnlyStr(kpi.periodEnd || kpi.period_end);
    if (!start && !end) {
      var key = kpi.periodKey || kpi.period_key || null;
      var m = key ? String(key).match(/^(\d{4})-(\d{2})$/) : null;
      if (m) {
        var mo = Number(m[2]);
        if (mo >= 1 && mo <= 12) {
          var last = new Date(Date.UTC(Number(m[1]), mo, 0)).getUTCDate();
          start = m[1] + '-' + m[2] + '-01';
          end = m[1] + '-' + m[2] + '-' + String(last).padStart(2, '0');
        }
      }
    }
    if (!start && !end) return null;
    return { start: start, end: end };
  }

  /** Ngày (yyyy-mm-dd) có nằm trong kỳ không; kỳ trống = luôn đúng, ngày trống = sai khi có kỳ. */
  function _dateInRange(dateStr, range) {
    if (!range) return true;
    if (!dateStr) return false;
    if (range.start && dateStr < range.start) return false;
    if (range.end && dateStr > range.end) return false;
    return true;
  }

  /** Khoảng [aStart, aEnd] (ngày) có GIAO với kỳ KPI không. */
  function _rangeOverlaps(aStart, aEnd, range) {
    if (!range) return true;
    var s = aStart || aEnd;
    var e = aEnd || aStart;
    if (!s && !e) return false;
    if (range.start && e && e < range.start) return false;
    if (range.end && s && s > range.end) return false;
    return true;
  }

  function _pmObsMetric(o) { return o ? (o.metric || o.metricCode || o.metric_code || null) : null; }
  function _pmObsObservedAt(o) { return o ? (o.observedAt || o.observed_at || o.date || o.capturedAt || null) : null; }

  /**
   * Observation có thuộc về post không: khớp externalPostId === post.id,
   * hoặc objectId === post.id khi objectType là 'external_post' / 'post' /
   * không có. objectType khác (vd 'ad', 'content_variant') KHÔNG khớp dù
   * objectId trùng — tránh lấy nhầm số của đối tượng khác.
   */
  function _pmObsMatchesPost(o, post) {
    if (!o || !post || post.id === null || post.id === undefined) return false;
    var ep = o.externalPostId || o.external_post_id;
    if (ep !== null && ep !== undefined && String(ep) !== '' && String(ep) === String(post.id)) return true;
    var oid = o.objectId || o.object_id;
    if (oid === null || oid === undefined || String(oid) === '' || String(oid) !== String(post.id)) return false;
    var otRaw = o.objectType || o.object_type;
    if (otRaw === null || otRaw === undefined || String(otRaw).trim() === '') return true;
    var ot = normStatus(otRaw);
    return ot === 'external_post' || ot === 'post';
  }

  /**
   * Tính actual của KPI auto từ số liệu bài đã đăng — HÀM THUẦN.
   * Chỉ xét observation khớp metric của dataSource và thuộc một post trong
   * `posts`; khử trùng theo post id (một post đóng góp đúng 1 lần).
   * - mode 'latest_sum': mỗi post lấy observation có observedAt MỚI NHẤT
   *   trong kỳ KPI rồi cộng qua các post (100 → 150 tính 150, không phải 250).
   * - mode 'period_sum': cộng mọi observation khớp mà kỳ của nó
   *   (periodStart/periodEnd nếu có, không thì observedAt) giao kỳ KPI.
   * Lưu ý reach: tổng này là TỔNG các snapshot mới nhất theo từng bài —
   * kết quả KHÔNG mang nhãn unique và không có field 'unique' nào.
   * @param {object} kpi KPI có definition.dataSource post_metrics.
   * @param {Array<object>} posts Các bài đã đăng thuộc scope của KPI.
   * @param {Array<object>} observations Toàn bộ metric_observations.
   * @returns {{value:number, postCount:number, latestObservedAt:(string|null),
   *   rows:Array<{postId:*, title:string, platform:(string|null), value:number, observedAt:(string|null)}>}}
   *   rows chỉ gồm post có ≥1 observation khớp, sắp xếp giảm dần theo value;
   *   postCount = rows.length; latestObservedAt = observedAt lớn nhất trong
   *   các observation ĐÃ DÙNG. KPI không có dataSource post_metrics → kết quả rỗng.
   */
  function postMetricActual(kpi, posts, observations) {
    var empty = { value: 0, postCount: 0, latestObservedAt: null, rows: [] };
    var cfg = kpiDataSource(kpi);
    if (!cfg) return empty;
    // Khử trùng post theo id trước mọi phép tính.
    var postById = {};
    var postList = [];
    (posts || []).forEach(function (p) {
      if (!p || p.id === null || p.id === undefined || String(p.id) === '') return;
      var k = String(p.id);
      if (postById[k]) return;
      postById[k] = p;
      postList.push(p);
    });
    if (!postList.length) return empty;
    var range = _kpiPeriodRange(kpi);
    var perPost = {};
    // SYN-16: khử trùng observation theo id ở tầng domain thuần — cùng một
    // observation truyền 2 lần (vd merge 2 nguồn) chỉ tính 1 lần, đặc biệt
    // ở mode period_sum nơi mọi observation đều được cộng. Observation
    // không có id thì không có cơ sở khử trùng nên vẫn tính như cũ.
    var seenObsIds = {};
    (observations || []).forEach(function (o) {
      if (!o) return;
      var obsId = o.id !== undefined && o.id !== null ? o.id : o.observation_id;
      if (obsId !== undefined && obsId !== null && String(obsId) !== '') {
        var obsKey = String(obsId);
        if (seenObsIds[obsKey]) return;
        seenObsIds[obsKey] = true;
      }
      var metric = _pmObsMetric(o);
      if (metric === null || metric === undefined || String(metric).trim() !== cfg.metric) return;
      var value = pickNum(o, ['value', 'metricValue', 'amount', 'count']);
      if (value === null) return;
      var post = null;
      for (var i = 0; i < postList.length; i++) {
        if (_pmObsMatchesPost(o, postList[i])) { post = postList[i]; break; }
      }
      if (!post) return;
      var observedRaw = _pmObsObservedAt(o);
      if (cfg.mode === 'period_sum') {
        var os = _dateOnlyStr(o.periodStart || o.period_start);
        var oe = _dateOnlyStr(o.periodEnd || o.period_end);
        if (!os && !oe) { var od = _dateOnlyStr(observedRaw); os = od; oe = od; }
        if (!_rangeOverlaps(os, oe, range)) return;
      } else {
        if (!_dateInRange(_dateOnlyStr(observedRaw), range)) return;
      }
      var key = String(post.id);
      var entry = perPost[key];
      if (!entry) {
        entry = perPost[key] = { post: post, sum: 0, latestValue: null, latestAtRaw: null, latestTime: null, maxAtRaw: null, maxTime: null };
      }
      entry.sum += value;
      var t = toDate(observedRaw);
      if (observedRaw && (!entry.maxTime || (t && t >= entry.maxTime) || (!t && !entry.maxTime))) {
        entry.maxAtRaw = observedRaw; entry.maxTime = t;
      }
      if (entry.latestValue === null || (t && (!entry.latestTime || t >= entry.latestTime))) {
        entry.latestValue = value; entry.latestAtRaw = observedRaw; entry.latestTime = t;
      }
    });
    var rows = [];
    var total = 0;
    var latestObservedAt = null;
    var latestTime = null;
    postList.forEach(function (p) {
      var e = perPost[String(p.id)];
      if (!e || e.latestValue === null) return;
      var v = cfg.mode === 'period_sum' ? e.sum : e.latestValue;
      var usedRaw = cfg.mode === 'period_sum' ? e.maxAtRaw : e.latestAtRaw;
      var usedTime = cfg.mode === 'period_sum' ? e.maxTime : e.latestTime;
      rows.push({ postId: p.id, title: p.title || p.name || '', platform: p.platform || null, value: v, observedAt: usedRaw || null });
      total += v;
      if (usedRaw && (!latestObservedAt || (usedTime && latestTime && usedTime >= latestTime) || (usedTime && !latestTime))) {
        latestObservedAt = usedRaw; latestTime = usedTime;
      }
    });
    rows.sort(function (a, b) { return b.value - a.value; });
    return { value: total, postCount: rows.length, latestObservedAt: latestObservedAt, rows: rows };
  }

  // =====================================================================
  // Brand + Planning (17/11/2026) — hàm THUẦN cho bản bấm thử, dữ liệu demo.
  // plan row: { brand_id, segment, month: 'YYYY-MM', channel, group, qty,
  //             budget, unit_price, objective, audience, b2b_split_pct } —
  //             budget chỉ có ở dòng ngân
  //             sách thẳng KHÔNG có số lượng (Paid Ads, qty null); unit_price
  //             là ĐƠN GIÁ ĐẶT TAY riêng của dòng (tuỳ chọn, khác null mới
  //             có hiệu lực), thắng đơn giá của benchmark khớp khi tính
  //             ngân sách. objective CHỈ có ở dòng Paid Media (mô hình
  //             Objective, xem PAID_OBJECTIVES bên dưới). audience /
  //             b2b_split_pct CHỈ có ở dòng budget-driven (qty null) thuộc
  //             nhóm Paid Media / Partnership / Event (mô hình B2B
  //             bottom-up): audience 'b2c' | 'b2b' | 'both', b2b_split_pct
  //             là % ngân sách dành cho phần B2B khi audience = 'both'.
  // benchmark: { brand_id, channel, unit_price, output_per_unit,
  //   view_to_visit, visit_to_freemium, freemium_to_paid,
  //   (fallback key CŨ: visit_to_signup cho visit_to_freemium;
  //   signup_to_first x first_to_paid cho freemium_to_paid),
  //   paid_to_b2b, lead_to_account, demo_to_account,
  //   direct_budget, cost_per_result } — chấp nhận cả khóa camelCase
  //   tương ứng. 3 tỉ lệ B2B (paid_to_b2b = cầu nối Paid User -> B2B
  //   Account theo Channel; lead_to_account / demo_to_account cho phần
  //   B2B của Objective Lead Gen / Demo) sửa theo Phase + uplift qua
  //   ĐÚNG cơ chế phase_assumptions như 4 tỉ lệ funnel. cost_per_result
  //   của Partnership/Event thêm key 'signup' (phần B2C) và 'b2b_account'
  //   (phần B2B: VNĐ / B2B Account). cost_per_result là ĐƠN GIÁ KẾT QUẢ theo Objective của
  //   benchmark Paid Media: object { [objectiveKey]: VNĐ/kết quả } (giá
  //   trị null/thiếu = objective đó CHƯA có đơn giá — không bịa số).
  //   Cơ chế cũ traffic_share / cost_per_visit (Visits = ngân sách ×
  //   traffic_share ÷ cost_per_visit) ĐÃ GỠ HOÀN TOÀN khỏi engine.
  // Mọi hàm an toàn với rows rỗng/thiếu benchmark: trả 0/null, không throw.
  // =====================================================================
  var FUNNEL_STEPS = ['views', 'visits', 'freemium', 'paid'];

  // ---------- Paid Media theo mô hình Objective (thay cơ chế cũ) ----------
  // Mỗi Objective có kết quả đặt TẠI tầng của nó, rồi chảy XUỐNG qua tỉ
  // lệ benchmark của channel (kèm uplift ở chế độ phase); KHÔNG suy
  // ngược lên tầng trên; thiếu tỉ lệ thì chuỗi dừng tại đó, không bịa số.
  var PAID_OBJECTIVES = [
    { key: 'awareness', label: 'Awareness / Reach', tier: 'views', metric: 'Views' },
    { key: 'traffic', label: 'Traffic', tier: 'visits', metric: 'Visits' },
    { key: 'signup', label: 'Signup Conversion', tier: 'freemium', metric: 'Freemium' },
    { key: 'remarketing', label: 'Remarketing', tier: 'paid', metric: 'Paid' },
    { key: 'lead_gen', label: 'Lead Generation', tier: 'freemium', metric: 'Freemium' },
    { key: 'demo', label: 'Demo / Contact', tier: 'freemium', metric: 'Freemium' }
  ];
  var PAID_OBJECTIVE_TIER = {};
  PAID_OBJECTIVES.forEach(function (o) { PAID_OBJECTIVE_TIER[o.key] = o.tier; });
  // Catalog Objective theo Channel (Paid Ads — Lumus Draft Plan).
  var PAID_CHANNEL_OBJECTIVES = {
    'Meta Ads': ['awareness', 'traffic', 'signup', 'remarketing'],
    'TikTok Ads': ['awareness', 'traffic', 'signup'],
    'Google Search B2B': ['traffic', 'lead_gen'],
    'LinkedIn Ads B2B': ['lead_gen', 'demo']
  };
  var _OBJECTIVE_ALIASES = {
    awareness: 'awareness', reach: 'awareness', 'awareness/reach': 'awareness', video_views: 'awareness', videoviews: 'awareness', 'video views': 'awareness',
    traffic: 'traffic', 'high-intent traffic': 'traffic', search: 'traffic',
    signup: 'signup', signups: 'signup', signup_conversion: 'signup', 'signup conversion': 'signup', conversion: 'signup',
    remarketing: 'remarketing',
    lead_gen: 'lead_gen', leadgen: 'lead_gen', 'lead generation': 'lead_gen', lead_generation: 'lead_gen', 'b2b lead generation': 'lead_gen',
    demo: 'demo', contact: 'demo', 'demo/contact': 'demo'
  };
  function _rowObjective(row) {
    if (!row) return null;
    var v = row.objective !== undefined && row.objective !== null ? row.objective
      : (row.objective_key !== undefined && row.objective_key !== null ? row.objective_key : row.objectiveKey);
    if (v === undefined || v === null || String(v).trim() === '') return null;
    var k = String(v).trim().toLowerCase();
    return _OBJECTIVE_ALIASES[k] || (PAID_OBJECTIVE_TIER[k] ? k : null);
  }
  // Đơn giá kết quả (VNĐ/kết quả) của 1 Objective trên benchmark:
  // đọc cost_per_result / costPerResult dạng object theo key objective
  // (chấp nhận cả key tầng: views/visits/freemium/paid) hoặc dạng
  // phẳng cost_per_result_<key> / costPerResult<Key>. Thiếu/null/<=0
  // -> null (objective chưa có đơn giá, không bịa số).
  function _costPerResult(b, objectiveKey) {
    if (!b || !objectiveKey) return null;
    var tier = PAID_OBJECTIVE_TIER[objectiveKey];
    var maps = [b.cost_per_result, b.costPerResult];
    for (var i = 0; i < maps.length; i++) {
      var m = maps[i];
      if (m && typeof m === 'object') {
        var v = _planNum(m[objectiveKey] !== undefined && m[objectiveKey] !== null ? m[objectiveKey] : m[tier]);
        if (v !== null) return v > 0 ? v : null;
      }
    }
    var cap = objectiveKey.charAt(0).toUpperCase() + objectiveKey.slice(1);
    var flat = _planNum(b['cost_per_result_' + objectiveKey] !== undefined && b['cost_per_result_' + objectiveKey] !== null
      ? b['cost_per_result_' + objectiveKey] : b['costPerResult' + cap]);
    if (flat !== null) return flat > 0 ? flat : null;
    return null;
  }
  function costPerResultFor(benchmark, objectiveKey) {
    return _costPerResult(benchmark, _OBJECTIVE_ALIASES[String(objectiveKey || '').trim().toLowerCase()] || objectiveKey);
  }

  // ---------- Mô hình B2B bottom-up: audience trên dòng budget-driven ----------
  // Objective THUẦN B2C: chỉ chạy B2C — phần B2B bị khóa ở UI và engine
  // cũng ép tỉ trọng B2B = 0 cho các Objective này, kể cả khi dòng mang
  // audience 'b2b'/'both' (dữ liệu lệch không được sinh B2B Account).
  var PURE_B2C_OBJECTIVES = { awareness: true, traffic: true, signup: true, remarketing: true };
  // Nhóm có dòng budget-driven (qty null) được áp audience + cách tính
  // B2B: Paid Media (theo Objective), Partnership, Event. Dòng content
  // có qty KHÔNG bao giờ bị phân loại lại theo cơ chế này.
  var BUDGET_DRIVEN_GROUPS = { 'Paid Media': true, 'Partnership': true, 'Event': true };
  // Kênh Email trong forecast Planning: nhận diện theo group 'Email'
  // hoặc theo channel. Chuỗi Email (opens -> clicks -> Paid từ TỒN
  // Free) cài trong forecastFunnel — xem doc ở đầu hàm đó.
  var EMAIL_CHANNELS = { 'Email Sends': true, 'Email CRM': true, 'Email': true };
  function _isEmailRow(row) {
    if (!row) return false;
    if (_rowGroup(row) === 'Email') return true;
    return !!EMAIL_CHANNELS[String(row.channel || '')];
  }
  function _rowGroup(row) {
    if (!row) return null;
    var v = row.group !== undefined && row.group !== null ? row.group : row.groupName;
    return (v === undefined || v === null || String(v) === '') ? null : String(v);
  }
  function _cfField(row, key) {
    if (!row) return undefined;
    if (row.customFields && row.customFields[key] !== undefined && row.customFields[key] !== null) return row.customFields[key];
    if (row.custom_fields && row.custom_fields[key] !== undefined && row.custom_fields[key] !== null) return row.custom_fields[key];
    return undefined;
  }
  function _rowAudience(row) {
    if (!row) return null;
    var v = row.audience !== undefined && row.audience !== null ? row.audience
      : (row.audience_type !== undefined && row.audience_type !== null ? row.audience_type
        : (row.audienceType !== undefined && row.audienceType !== null ? row.audienceType : _cfField(row, 'audience')));
    if (v === undefined || v === null || String(v).trim() === '') return null;
    var k = String(v).trim().toLowerCase();
    return (k === 'b2c' || k === 'b2b' || k === 'both') ? k : null;
  }
  function _rowB2bSplitPct(row) {
    if (!row) return null;
    var v = row.b2b_split_pct !== undefined && row.b2b_split_pct !== null ? row.b2b_split_pct
      : (row.b2bSplitPct !== undefined && row.b2bSplitPct !== null ? row.b2bSplitPct : _cfField(row, 'b2b_split_pct'));
    return _planNum(v);
  }
  /**
   * Tỉ trọng ngân sách B2C/B2B của 1 dòng budget-driven: { b2c, b2b }
   * (tổng = 1). audience tường minh thắng; thiếu audience thì suy từ
   * segment của dòng ('b2b' -> B2B, còn lại B2C) — khớp seed demo
   * (Meta/TikTok b2c, Google lead_gen b2b, LinkedIn demo b2b).
   * audience 'both' mà chưa nhập b2b_split_pct -> phần B2B = 0 (không
   * bịa tỉ lệ chia). Objective thuần B2C -> luôn { b2c: 1, b2b: 0 }.
   */
  function _audienceShare(row, objectiveKey) {
    if (objectiveKey && PURE_B2C_OBJECTIVES[objectiveKey]) return { b2c: 1, b2b: 0 };
    var aud = _rowAudience(row);
    if (!aud) {
      var seg = _planSegment(row) || '';
      aud = seg === 'b2b' ? 'b2b' : 'b2c';
    }
    if (aud === 'b2b') return { b2c: 0, b2b: 1 };
    if (aud === 'both') {
      var pct = _rowB2bSplitPct(row);
      var share = pct === null ? 0 : Math.min(100, Math.max(0, pct)) / 100;
      return { b2c: 1 - share, b2b: share };
    }
    return { b2c: 1, b2b: 0 };
  }
  function audienceShareFor(row, objectiveKey) {
    return _audienceShare(row, objectiveKey ? (_OBJECTIVE_ALIASES[String(objectiveKey).trim().toLowerCase()] || objectiveKey) : _rowObjective(row));
  }

  function _planNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function _planMonth(row) {
    if (!row) return null;
    var m = row.month || row.periodKey || row.period_key || null;
    return (typeof m === 'string' && /^\d{4}-\d{2}/.test(m)) ? m.slice(0, 7) : null;
  }
  function _planBrandId(x) {
    if (!x) return null;
    var v = x.brand_id !== undefined && x.brand_id !== null ? x.brand_id : x.brandId;
    return (v === undefined || v === null || v === '') ? null : String(v);
  }
  function _planMonthsOf(rows) {
    // Đủ 12 tháng của (các) năm xuất hiện trong dữ liệu, đã sắp xếp.
    var years = {};
    (rows || []).forEach(function (r) {
      var m = _planMonth(r);
      if (m) years[m.slice(0, 4)] = true;
    });
    var out = [];
    Object.keys(years).sort().forEach(function (y) {
      for (var i = 1; i <= 12; i++) out.push(y + '-' + String(i).padStart(2, '0'));
    });
    return out;
  }
  /** Segment của một bản ghi plan/benchmark: field segment trực tiếp,
   *  thiếu thì đọc customFields/custom_fields (nơi Store gói field phụ). */
  function _planSegment(x) {
    if (!x) return null;
    var v = x.segment !== undefined && x.segment !== null ? x.segment
      : (x.customFields && x.customFields.segment !== undefined && x.customFields.segment !== null ? x.customFields.segment
        : (x.custom_fields && x.custom_fields.segment !== undefined && x.custom_fields.segment !== null ? x.custom_fields.segment : null));
    return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim().toLowerCase();
  }
  /** Số lượng của 1 dòng plan — MỘT quy tắc fallback qty ?? quantity ??
   *  count (khớp planRowQty của app); không có/không phải số -> null. */
  function _planQty(row) {
    if (!row) return null;
    var v = row.qty !== undefined ? row.qty : (row.quantity !== undefined ? row.quantity : row.count);
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  /** Tên nhóm HIỂN THỊ của 1 dòng plan — MỘT quy tắc (Bước B II-2):
   *  group/groupName, thiếu -> 'Chưa nhóm'. (_rowGroup giữ bản thô
   *  null cho engine phân loại nhóm budget-driven.) */
  function rowGroupOf(row) {
    return _rowGroup(row) || 'Chưa nhóm';
  }
  /**
   * Thứ tự Channel của Planning — MỘT nguồn (Bước B II-1): duyệt GROUP
   * theo thứ tự xuất hiện đầu tiên, trong group duyệt Channel theo thứ
   * tự xuất hiện đầu tiên, phẳng hoá + khử trùng theo lần xuất hiện
   * đầu tiên. Trả [{ group, channel }]. Lưới Planning, planningKpiData
   * và khối Phase đều gọi helper này.
   */
  function planChannelOrder(rows) {
    var groupOrder = [], channelsByGroup = {}, seen = {}, out = [];
    (rows || []).forEach(function (r) {
      if (!r) return;
      var g = rowGroupOf(r);
      if (!channelsByGroup[g]) { channelsByGroup[g] = []; groupOrder.push(g); }
      var ch = String(r.channel || '—');
      if (channelsByGroup[g].indexOf(ch) === -1) channelsByGroup[g].push(ch);
    });
    groupOrder.forEach(function (g) {
      channelsByGroup[g].forEach(function (ch) {
        if (seen[ch]) return;
        seen[ch] = true;
        out.push({ group: g, channel: ch });
      });
    });
    return out;
  }
  /**
   * Khớp Benchmark — MỘT hàm chuẩn duy nhất (Bước B I-1), dùng cho
   * forecastFunnel / planBudget / summarize* và (qua export
   * benchmarkForRow) cho mọi đường đọc ở app:
   *  - channel phải khớp đúng;
   *  - dòng có brand_id -> benchmark phải cùng brand_id (benchmark
   *    thiếu brand_id không khớp); dòng không brand -> mọi brand;
   *  - segment: benchmark có segment khác segment của dòng -> loại;
   *    khớp segment CHÍNH XÁC thắng bản không/khác segment; trong các
   *    bản cùng mức ưu tiên, bản ĐẦU TIÊN trong danh sách thắng
   *    (không còn ghi đè theo thứ tự key như index cũ).
   */
  function _benchmarkIndex(benchmarks) {
    return (benchmarks || []).filter(function (b) { return !!b && !!b.channel; });
  }
  function _benchmarkFor(idx, row) {
    if (!row || !row.channel) return null;
    var bid = _planBrandId(row), seg = _planSegment(row), ch = String(row.channel);
    var best = null, bestExact = false;
    (idx || []).forEach(function (b) {
      if (String(b.channel) !== ch) return;
      var bb = _planBrandId(b);
      if (bid !== null) {
        if (bb === null || bb !== bid) return;
      }
      var bs = _planSegment(b);
      if (seg !== null && bs !== null && bs !== seg) return;
      var exact = seg !== null && bs === seg;
      if (!best || (exact && !bestExact)) { best = b; bestExact = exact; }
    });
    return best;
  }
  function benchmarkForRow(row, benchmarks) {
    return _benchmarkFor(_benchmarkIndex(benchmarks), row);
  }
  /** Thứ tự Group -> Channel KHÔNG khử trùng xuyên group (cho lưới
   *  Planning, nơi 1 channel có thể hiện ở nhiều group): trả
   *  [{ group, channels: [channel...] }] theo cùng quy tắc thứ tự
   *  xuất hiện đầu tiên của planChannelOrder. */
  function planChannelOrderByGroup(rows) {
    var groupOrder = [], byGroup = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      var g = rowGroupOf(r);
      if (!byGroup[g]) { byGroup[g] = { group: g, channels: [] }; groupOrder.push(byGroup[g]); }
      var ch = String(r.channel || '—');
      if (byGroup[g].channels.indexOf(ch) === -1) byGroup[g].channels.push(ch);
    });
    return groupOrder;
  }
  function _benchField(b, snake, camel) {
    if (!b) return null;
    return _planNum(b[snake] !== undefined && b[snake] !== null ? b[snake] : b[camel]);
  }

  /**
   * Tổng qty + ngân sách theo từng tháng; đủ 12 tháng/năm.
   * Bước B I-2 (QUYẾT ĐỊNH: viết lại để ỦY QUYỀN cùng công thức hiệu
   * dụng của app/domain thay vì gỡ export — vì hàm đang là API domain
   * được test và tài liệu tham chiếu): qty qua _planQty (fallback
   * qty ?? quantity ?? count như planRowQty của app); ngân sách qua
   * CHÍNH planBudget(rows, benchmarks) (dòng có qty: qty × đơn giá
   * hiệu dụng, field budget bị bỏ qua; dòng qty null: budget trực
   * tiếp). Không truyền benchmarks -> dòng có qty không có đơn giá
   * (amount 0) như planBudgetFor không benchmark.
   */
  function summarizePlanByMonth(rows, benchmarks) {
    var list = rows || [];
    var months = _planMonthsOf(list);
    var budget = planBudget(list, benchmarks);
    var budgetByMonth = {};
    Object.keys(budget.byMonth || {}).forEach(function (m) { budgetByMonth[m] = budget.byMonth[m].amount; });
    var byMonth = {};
    months.forEach(function (m) { byMonth[m] = { month: m, qty: 0, budget: budgetByMonth[m] || 0, rowCount: 0 }; });
    var totalQty = 0;
    list.forEach(function (r) {
      var m = _planMonth(r);
      if (!m || !byMonth[m]) return;
      var q = _planQty(r) || 0;
      byMonth[m].qty += q; byMonth[m].rowCount += 1;
      totalQty += q;
    });
    return { months: months, byMonth: byMonth, totalQty: totalQty, totalBudget: budget.total };
  }

  /**
   * Tổng theo channel (kèm group của channel). Bước B I-2 + II-1:
   * qty qua _planQty, ngân sách từng dòng qua planBudget (cùng công
   * thức hiệu dụng), thứ tự channel qua planChannelOrder
   * (group -> channel) — KHÔNG còn sort ABC.
   */
  function summarizePlanByChannel(rows, benchmarks) {
    var list = rows || [];
    var budget = planBudget(list, benchmarks);
    var amountByIndex = (budget.rows || []).map(function (d) { return d.amount || 0; });
    var byChannel = {};
    var totalQty = 0;
    list.forEach(function (r, i) {
      if (!r || !r.channel) return;
      var key = String(r.channel);
      var e = byChannel[key];
      if (!e) e = byChannel[key] = { channel: key, group: rowGroupOf(r), qty: 0, budget: 0, rowCount: 0, months: {} };
      var q = _planQty(r) || 0;
      e.qty += q; e.budget += amountByIndex[i] || 0; e.rowCount += 1;
      var m = _planMonth(r);
      if (m) e.months[m] = (e.months[m] || 0) + q;
      totalQty += q;
    });
    var channels = planChannelOrder(list).map(function (o) {
      var e = byChannel[o.channel];
      if (e) e.group = o.group;
      return e;
    }).filter(Boolean);
    // Channel có trong byChannel nhưng không lọt planChannelOrder
    // (không xảy ra với rows thường) -> nối cuối để không mất dữ liệu.
    Object.keys(byChannel).forEach(function (k) { if (channels.indexOf(byChannel[k]) === -1) channels.push(byChannel[k]); });
    return { channels: channels, byChannel: byChannel, totalQty: totalQty, totalBudget: budget.total };
  }

  // ---------- Forecast v2: Phase + Uplift (bổ sung 17/11/2026) ----------
  // ctx = { phases: [{id, brand_id, start_month, end_month,
  //   uplift_percent_per_month, views_uplift_percent_per_month}],
  //   phaseAssumptions: [{phase_id, channel,
  //   view_to_visit, visit_to_freemium, freemium_to_paid,
  //   views_per_unit}] } — cả hai đều tuỳ chọn; không truyền ctx thì
  // forecastFunnel giữ nguyên hành vi v1.

  /**
   * Tỉ lệ hiệu dụng sau uplift lũy kế theo tháng:
   * rate × (1 + upliftPercent/100)^monthOffset.
   * rate null → null; uplift/tháng thiếu → 0; monthOffset âm → 0.
   */
  function effectiveRate(rate, upliftPercent, monthOffset) {
    var r = _planNum(rate);
    if (r === null) return null;
    var u = _planNum(upliftPercent);
    if (u === null) u = 0;
    var n = _planNum(monthOffset);
    if (n === null || n < 0) n = 0;
    return r * Math.pow(1 + u / 100, n);
  }

  /** 'YYYY-MM' → chỉ số tháng tuyệt đối (year*12 + month-1); null nếu sai dạng. */
  function _monthIndex(m) {
    if (typeof m !== 'string') return null;
    var mm = /^(\d{4})-(\d{2})/.exec(m);
    if (!mm) return null;
    return Number(mm[1]) * 12 + (Number(mm[2]) - 1);
  }
  function _phaseMonth(p, snake, camel) {
    if (!p) return null;
    var v = p[snake] !== undefined && p[snake] !== null ? p[snake] : p[camel];
    return (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) ? v.slice(0, 7) : null;
  }
  function _phaseUplift(p) {
    if (!p) return 0;
    var v = _planNum(p.uplift_percent_per_month !== undefined && p.uplift_percent_per_month !== null
      ? p.uplift_percent_per_month : p.upliftPercentPerMonth);
    return v === null ? 0 : v;
  }
  // Uplift Views RIÊNG của Phase (0019): % tăng trưởng/tháng áp vào
  // VIEWS MỖI BÀI của đường Content — song song với _phaseUplift (áp
  // vào tỉ lệ). Cùng quy ước đọc/lưu: dạng % 0–100, null/thiếu -> 0.
  function _phaseViewsUplift(p) {
    if (!p) return 0;
    var v = _planNum(p.views_uplift_percent_per_month !== undefined && p.views_uplift_percent_per_month !== null
      ? p.views_uplift_percent_per_month : p.viewsUpliftPercentPerMonth);
    return v === null ? 0 : v;
  }
  function _rowPhaseId(r) {
    if (!r) return null;
    var v = r.phase_id !== undefined && r.phase_id !== null ? r.phase_id : r.phaseId;
    return (v === undefined || v === null || v === '') ? null : String(v);
  }
  /**
   * Xác định phase của một row: ưu tiên row.phase_id (tra trong ctx.phases);
   * nếu trống (hoặc id không có trong danh sách) thì khớp theo brand +
   * khoảng tháng start_month ≤ month ≤ end_month. Phase không mang
   * start/end_month (vd phase campaign cũ campaignId/startDate) bị bỏ qua
   * ở đường khớp tháng. Trả { phase, phaseId } — phase có thể null trong
   * khi phaseId vẫn là id khai trên row (để gom byPhase).
   */
  function _resolvePhase(phases, row, month) {
    var rid = _rowPhaseId(row);
    var list = phases || [];
    if (rid) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === rid) return { phase: list[i], phaseId: rid };
      }
      // id khai trên row nhưng không có object phase: vẫn giữ id để gom
      // byPhase, không uplift được (thiếu start_month/uplift).
      if (!month) return { phase: null, phaseId: rid };
    }
    if (month) {
      var brand = _planBrandId(row);
      var fallback = null;
      for (var j = 0; j < list.length; j++) {
        var p = list[j];
        var sm = _phaseMonth(p, 'start_month', 'startMonth');
        var em = _phaseMonth(p, 'end_month', 'endMonth');
        if (!sm || !em || month < sm || month > em) continue;
        var pb = _planBrandId(p);
        if (brand !== null && pb !== null && pb !== brand) continue;
        if (brand !== null && pb === brand) return { phase: p, phaseId: String(p.id) };
        if (!fallback) fallback = p;
      }
      if (fallback) return { phase: fallback, phaseId: String(fallback.id) };
    }
    return { phase: null, phaseId: rid };
  }
  function _assumptionIndex(assumptions) {
    var idx = {};
    (assumptions || []).forEach(function (a) {
      if (!a || !a.channel) return;
      var pid = a.phase_id !== undefined && a.phase_id !== null ? a.phase_id : a.phaseId;
      if (pid === undefined || pid === null || pid === '') return;
      idx[String(pid) + '|' + String(a.channel)] = a;
    });
    return idx;
  }
  function _assumpField(a, snake, camel) {
    if (!a) return null;
    return _planNum(a[snake] !== undefined && a[snake] !== null ? a[snake] : a[camel]);
  }
  function _assumpViewsPerUnit(a) {
    return _assumpField(a, 'views_per_unit', 'viewsPerUnit');
  }
  /**
   * Phân giải CASCADE từng field — MỘT logic chung duy nhất cho
   * effectiveRatesFor / effectiveViewsPerUnitFor / forecastFunnel
   * (chốt cascade Phase 18/11/2026):
   *   assumption(phase hiện tại × channel)
   *   -> assumption của PHASE SỚM HƠN GẦN NHẤT cùng brand × channel
   *      có giá trị khác null cho field đó
   *   -> Benchmark của channel.
   * "Null = kế thừa" áp TỪNG field độc lập. Giá trị kế thừa là giá
   * trị GỐC (chưa uplift) của phase nguồn — uplift do nơi gọi áp
   * bằng uplift của CHÍNH phase hiện tại như trước, không cộng dồn.
   * Tham số:
   *   phase      — phase hiện tại (object có id; brand qua _planBrandId)
   *   channel    — channel cần phân giải
   *   assumpIdx  — index từ _assumptionIndex (ghi đè theo thứ tự mảng:
   *                assumption sau cùng của cùng (phase, channel) thắng)
   *   phases     — danh sách phases cùng ngữ cảnh (tuỳ chọn); thiếu /
   *                không phải mảng -> KHÔNG cascade (hành vi cũ:
   *                assumption đúng phase -> benchmark)
   *   getAssump  — hàm đọc field từ 1 assumption -> số | null
   *   benchValue — giá trị benchmark đã đọc sẵn cho field -> số | null
   * "Phase sớm hơn" xác định theo start_month: phase hiện tại phải
   * có MẶT trong `phases` (khớp id) và xác định được start_month;
   * không thoả -> không cascade. Các phase ứng viên phải cùng brand
   * (brand null thì ứng viên cũng phải brand null), có start_month
   * NHỎ HƠN start_month của phase hiện tại; sắp xếp giảm dần theo
   * start_month (gần nhất trước), hoà start_month thì phần tử đứng
   * SAU trong mảng `phases` xét trước.
   * Trả { value, source } với source 'assumption' | 'benchmark' |
   * null; khi source = 'inherited' kèm sourcePhaseId và
   * sourcePhaseName (nếu phase nguồn có tên).
   */
  function _resolveFieldCascade(phase, channel, assumpIdx, phases, getAssump, benchValue) {
    var pid = phase && phase.id !== undefined && phase.id !== null && phase.id !== '' ? String(phase.id) : null;
    if (pid !== null && channel !== null && channel !== undefined && assumpIdx) {
      var cur = assumpIdx[pid + '|' + String(channel)];
      if (cur) {
        var av = getAssump(cur);
        if (av !== null && av !== undefined) return { value: av, source: 'assumption' };
      }
    }
    if (pid !== null && channel !== null && channel !== undefined && assumpIdx && Array.isArray(phases) && phases.length) {
      var curEntry = null;
      for (var ci = 0; ci < phases.length; ci++) {
        if (phases[ci] && phases[ci].id !== undefined && phases[ci].id !== null && String(phases[ci].id) === pid) { curEntry = phases[ci]; break; }
      }
      if (curEntry) {
        var curStart = _phaseMonth(curEntry, 'start_month', 'startMonth') || _phaseMonth(phase, 'start_month', 'startMonth');
        if (curStart) {
          var brand = _planBrandId(phase);
          if (brand === null) brand = _planBrandId(curEntry);
          var cands = [];
          phases.forEach(function (p, idx) {
            if (!p || p.id === undefined || p.id === null || String(p.id) === pid) return;
            var sm = _phaseMonth(p, 'start_month', 'startMonth');
            if (!sm || sm >= curStart) return;
            var pb = _planBrandId(p);
            if (brand !== null) { if (pb !== brand) return; }
            else if (pb !== null) return;
            cands.push({ phase: p, start: sm, idx: idx });
          });
          cands.sort(function (a, b) {
            if (a.start !== b.start) return a.start < b.start ? 1 : -1;
            return b.idx - a.idx;
          });
          for (var i = 0; i < cands.length; i++) {
            var candPhase = cands[i].phase;
            var candAssump = assumpIdx[String(candPhase.id) + '|' + String(channel)];
            if (!candAssump) continue;
            var cv = getAssump(candAssump);
            if (cv !== null && cv !== undefined) {
              var out = { value: cv, source: 'inherited', sourcePhaseId: String(candPhase.id) };
              var nm = candPhase.name !== undefined && candPhase.name !== null ? candPhase.name : candPhase.title;
              if (nm !== undefined && nm !== null && String(nm) !== '') out.sourcePhaseName = String(nm);
              return out;
            }
          }
        }
      }
    }
    if (benchValue !== null && benchValue !== undefined) return { value: benchValue, source: 'benchmark' };
    return { value: null, source: null };
  }

  var EFFECTIVE_RATE_FIELDS = ['view_to_visit', 'visit_to_freemium', 'freemium_to_paid', 'paid_to_b2b', 'lead_to_account', 'demo_to_account'];
  var EFFECTIVE_RATE_CAMEL = { view_to_visit: 'viewToVisit', visit_to_freemium: 'visitToFreemium', freemium_to_paid: 'freemiumToPaid', visit_to_signup: 'visitToSignup', signup_to_first: 'signupToFirst', first_to_paid: 'firstToPaid', paid_to_b2b: 'paidToB2b', lead_to_account: 'leadToAccount', demo_to_account: 'demoToAccount' };
  /**
   * Tỉ lệ HIỆU DỤNG của (phase, channel) — MỘT nguồn cho UI hiển thị
   * (Bước B II-3), cùng quy tắc engine forecastFunnel: từng field qua
   * _resolveFieldCascade (assumption phase này -> kế thừa phase sớm
   * hơn gần nhất cùng brand khi truyền `phases` -> benchmark);
   * fallback key cũ v2f = visit_to_signup, f2p = signup_to_first ×
   * first_to_paid (chỉ khi đủ cả hai ở tầng hiệu dụng) — fallback giữ
   * nguyên cách áp ở tầng hiệu dụng, chỉ nguồn từng field nay là
   * cascade. Nguồn của f2p dạng tích: có yếu tố 'assumption' ->
   * 'assumption'; không thì có yếu tố 'inherited' -> 'inherited'
   * kèm sourcePhaseId/sourcePhaseName của yếu tố inherited ĐẦU TIÊN
   * (theo thứ tự signup_to_first rồi first_to_paid); còn lại
   * 'benchmark'. Trả { [field]: {value, source[, sourcePhaseId,
   * sourcePhaseName]} }.
   * Tham số `phases` tuỳ chọn (tương thích ngược): thiếu -> không
   * cascade, hành vi như trước cascade.
   */
  function effectiveRatesFor(phase, channel, benchmarks, assumptions, phases) {
    var assumpIdx = _assumptionIndex(assumptions);
    var bm = benchmarkForRow({ brand_id: _planBrandId(phase), channel: channel }, benchmarks);
    function effField(f) {
      var camel = EFFECTIVE_RATE_CAMEL[f];
      var bv = bm ? _benchField(bm, f, camel) : null;
      return _resolveFieldCascade(phase, channel, assumpIdx, phases, function (a) { return _assumpField(a, f, camel); }, bv);
    }
    var out = {};
    EFFECTIVE_RATE_FIELDS.forEach(function (f) { out[f] = effField(f); });
    if (out.visit_to_freemium.value === null) out.visit_to_freemium = effField('visit_to_signup');
    if (out.freemium_to_paid.value === null) {
      var s2f = effField('signup_to_first');
      var f2pOld = effField('first_to_paid');
      if (s2f.value !== null && f2pOld.value !== null) {
        if (s2f.source === 'assumption' || f2pOld.source === 'assumption') {
          out.freemium_to_paid = { value: s2f.value * f2pOld.value, source: 'assumption' };
        } else if (s2f.source === 'inherited' || f2pOld.source === 'inherited') {
          var firstInh = s2f.source === 'inherited' ? s2f : f2pOld;
          var fo = { value: s2f.value * f2pOld.value, source: 'inherited', sourcePhaseId: firstInh.sourcePhaseId };
          if (firstInh.sourcePhaseName) fo.sourcePhaseName = firstInh.sourcePhaseName;
          out.freemium_to_paid = fo;
        } else {
          out.freemium_to_paid = { value: s2f.value * f2pOld.value, source: 'benchmark' };
        }
      }
    }
    return out;
  }
  /**
   * Views mỗi bài HIỆU DỤNG của (phase, channel) — MỘT nguồn (Bước B
   * II-3): qua _resolveFieldCascade — assumption.views_per_unit của
   * phase này thắng, thiếu thì kế thừa views_per_unit của phase sớm
   * hơn gần nhất cùng brand (khi truyền `phases`), thiếu nữa thì
   * benchmark output_per_unit. Trả { value, source } (+ sourcePhaseId
   * /sourcePhaseName khi source = 'inherited').
   * Tham số `phases` tuỳ chọn (tương thích ngược).
   */
  function effectiveViewsPerUnitFor(phase, channel, benchmarks, assumptions, phases) {
    var assumpIdx = _assumptionIndex(assumptions);
    var bm = benchmarkForRow({ brand_id: _planBrandId(phase), channel: channel }, benchmarks);
    var bv = bm ? _benchField(bm, 'output_per_unit', 'outputPerUnit') : null;
    return _resolveFieldCascade(phase, channel, assumpIdx, phases, function (a) { return _assumpViewsPerUnit(a); }, bv);
  }

  /** 12 tháng 'YYYY-MM' của một năm — MỘT nguồn danh sách tháng kỳ
   *  (Bước B II-9) cho lưới Planning và các nơi cần kỳ năm. */
  function planMonthsForYear(year) {
    var y = String(year);
    var out = [];
    for (var i = 1; i <= 12; i++) out.push(y + '-' + String(i).padStart(2, '0'));
    return out;
  }

  /**
   * Số dư của MỘT tài khoản Thu–Chi — MỘT công thức JS duy nhất
   * (Bước B I-6/II-12), khớp SQL view cash_account_balances:
   * opening + Σ amount(direction='in') − Σ amount(direction='out');
   * direction khác 'in'/'out' bị BỎ QUA (không coi là chi như bản sao
   * cũ). SQL view vẫn là nguồn ở chế độ supabase vì nó chạy phía DB —
   * cùng công thức này, không thể gộp code qua hai tầng.
   */
  function cashBalanceFor(account, transactions) {
    if (!account) return null;
    var bal = Number(account.openingBalance !== undefined && account.openingBalance !== null ? account.openingBalance : account.opening_balance) || 0;
    (transactions || []).forEach(function (t) {
      if (!t) return;
      var aid = t.accountId !== undefined && t.accountId !== null ? t.accountId : t.account_id;
      if (aid === null || aid === undefined || String(aid) !== String(account.id)) return;
      var amt = Number(t.amount) || 0;
      if (t.direction === 'in') bal += amt;
      else if (t.direction === 'out') bal -= amt;
    });
    return bal;
  }

  /**
   * Forecast funnel: views = qty × output_per_unit → visits → freemium →
   * paid theo chuỗi tỉ lệ của benchmark khớp brand+channel. Phễu MỚI
   * (căn chỉnh theo sheet Lumilink1) chỉ còn 2 tỉ lệ chuyển đổi dưới
   * views: visit_to_freemium (v2f) và freemium_to_paid (f2p). Tỉ lệ
   * hiệu dụng có FALLBACK key cũ để dữ liệu/benchmark/assumption đời
   * trước vẫn cho đúng số Paid: v2f = visit_to_freemium ??
   * visit_to_signup; f2p = freemium_to_paid ?? (signup_to_first x
   * first_to_paid) — fallback gộp CHỈ có khi đủ CẢ HAI key cũ, thiếu
   * một trong hai -> f2p = null (chuỗi dừng, không bịa số).
   * Row không có benchmark (hoặc benchmark thiếu output/tỉ lệ, vd Paid Ads
   * direct budget) → forecast = null ở chi tiết dòng, không cộng vào tổng.
   *
   * V2 (khi truyền ctx = { phases, phaseAssumptions }):
   * - Phase của row: row.phase_id trước, trống thì khớp brand + khoảng tháng.
   * - Tỉ lệ gốc từng bước qua _resolveFieldCascade: assumption(phase,
   *   channel) nếu khác null, thiếu thì KẾ THỪA assumption của phase
   *   sớm hơn gần nhất cùng brand × channel (từng field độc lập),
   *   thiếu nữa mới benchmark (cascade Phase 18/11/2026; giá trị kế
   *   thừa là giá trị gốc chưa uplift). Tỉ lệ hiệu dụng = effectiveRate(tỉ lệ gốc,
   *   phase.uplift_percent_per_month ?? 0, n) với n = số tháng từ
   *   start_month của phase tới tháng của row (tháng đầu phase n = 0).
   *   Uplift tỉ lệ CHỈ áp vào các tỉ lệ chuyển đổi — không áp qty.
   *   Uplift Views RIÊNG (phase.views_uplift_percent_per_month, 0019)
   *   áp vào VIEWS MỖI BÀI của đường Content với CÙNG n: views mỗi bài
   *   hiệu dụng = views mỗi bài gốc × (1 + vu/100)^n, áp TRƯỚC khi
   *   nhân qty; KHÔNG áp cho dòng budget-driven, KHÔNG áp vào qty/tỉ lệ.
   * - views_per_unit của assumption(phase, channel) là số Views MỖI BÀI
   *   (đầu phễu trên 1 KOL/content) cho phase×channel đó: row thuộc phase
   *   có assumption.views_per_unit khác null → views của row =
   *   qty × views_per_unit; ngược lại views = qty × benchmark
   *   .output_per_unit như v1. Uplift TỈ LỆ không áp vào
   *   views_per_unit/qty (như không áp vào output_per_unit); riêng
   *   Uplift Views (views_uplift_percent_per_month) áp vào views mỗi
   *   bài gốc ở cả hai nguồn trên. ĐỔI NGỮ NGHĨA 17/11/2026:
   *   trường này thay cơ chế cũ (lưu ở cùng cột DB top_funnel_override)
   *   vốn hiểu giá trị lưu là TỔNG views của cả phase rồi phân bổ ngược
   *   về từng tháng theo tỉ trọng qty — cơ chế phân bổ đó ĐÃ BỎ hẳn.
   *   Giá trị đã lưu theo ngữ nghĩa cũ đều là null (seed/demo và
   *   production đều chưa từng đặt) nên đổi ngữ nghĩa không mất dữ liệu.
   * - Channel không benchmark VÀ không assumption đủ tỉ lệ → null như v1.
   *   Assumption đủ tỉ lệ nhưng không benchmark: chỉ tính được khi có
   *   views_per_unit (để suy views = qty × views_per_unit); thiếu → null.
   * - Paid Media (benchmark direct_budget) — MÔ HÌNH OBJECTIVE: mỗi
   *   dòng Paid mang field `objective`; kết quả của objective đặt TẠI
   *   tầng của nó: result = budget ÷ cost_per_result[objective] của
   *   benchmark (Traffic = Cost/LPV từ Master Forecast 03 Inputs:
   *   Meta 20.000đ, TikTok 22.000đ; Signup / Remarketing = đơn giá SUY
   *   TỪ CHUỖI tỉ lệ của file — xem seed ở demo-data.js), rồi chảy
   *   XUỐNG qua các tỉ lệ benchmark/assumption phía dưới tầng đó
   *   (uplift phase áp vào các tỉ lệ này như kênh thường). KHÔNG suy
   *   ngược lên tầng trên; thiếu tỉ lệ thì chuỗi dừng tại đó. Objective
   *   CHƯA có đơn giá (cost_per_result thiếu/null — Awareness, Lead
   *   Gen, Demo trong file nguồn) hoặc dòng Paid không có objective →
   *   forecast null cho dòng đó (ngân sách vẫn tính vào tổng ngân sách
   *   qua planBudget, chỉ số đóng góp 0, không bịa số). Cơ chế cũ
   *   (Visits = ngân sách × traffic_share ÷ cost_per_visit) ĐÃ GỠ.
   * - KÊNH EMAIL (group 'Email' hoặc channel 'Email Sends' /
   *   'Email CRM' / 'Email') — chuỗi RIÊNG opens -> clicks -> Paid,
   *   cài bằng 2 LƯỢT trong chính hàm này (forecastFunnel vẫn là
   *   nguồn funnel duy nhất): lượt 1 tính mọi kênh KHÁC Email để lấy
   *   chuỗi TỒN Free đầu tháng theo Brand; lượt 2 tính Email từ
   *   chuỗi tồn đó rồi cộng vào byMonth/totals/byPhase như kênh
   *   thường. Công thức Email của 1 tháng:
   *     list_đầu_tháng = opening_free của Brand (Phase sớm nhất có
   *       opening_free; ctx.openingFree / ctx.openingFreeByBrand ghi
   *       đè nếu truyền; null/thiếu -> 0 — sản phẩm chưa launch)
   *       + tích luỹ (freemium − paid) của MỌI kênh khác cộng dồn
   *       tới hết tháng trước. XẤP XỈ ĐÃ BIẾT: bỏ qua free churn khi
   *       tính list (list là tồn GỘP chưa trừ churn — khớp cách
   *       Zac chốt 18/11/2026).
   *     opens = list_đầu_tháng × open_rate × qty (qty = số lượt gửi
   *       trong tháng, unit 'sends'); opens nằm ở tầng Views.
   *     visits (clicks) = opens × click/open; paid = visits ×
   *       click→paid; freemium của Email = 0 TUYỆT ĐỐI (Email không
   *       tự tạo freemium nên không tự nuôi list của chính nó).
   *     Paid của Email ở lượt 2 KHÔNG quay lại sửa list của chính
   *       tháng đó hay tháng sau (list chỉ gồm kênh khác) — và Paid
   *       Email cộng vào byMonth.paid nên
   *       computeOperatingFinancials đếm như New Paid bình thường.
   *   Ngữ nghĩa cột benchmark cho kênh Email (KHÔNG thêm cột DB):
   *     view_to_visit = open rate; visit_to_freemium = click/open
   *     (tầng Freemium ở đây là CLICK, không phải freemium thật);
   *     freemium_to_paid = click→paid. Ba tỉ lệ vẫn qua cơ chế
   *     phase_assumptions (ghi đè theo Phase × Channel) + uplift
   *     của Phase như mọi kênh. output_per_unit của Email để null —
   *     opens KHÔNG tính theo qty × views mỗi bài.
   * - Trả thêm byPhase: { [phase_id]: { phase_id, views, visits,
   *   freemium, paid, rowCount } } cộng từ CÙNG kết quả từng row đã tính
   *   (rowCount = số row có forecast thuộc phase); row chi tiết thêm
   *   field phase_id đã suy. Không truyền ctx → không phase object nào
   *   được resolve nên KHÔNG uplift (số liệu y hệt v1); byPhase vẫn gom
   *   theo phase_id khai sẵn trên row nếu có, ngược lại là {}.
   */
  function forecastFunnel(rows, benchmarks, ctx) {
    var list = rows || [];
    var idx = _benchmarkIndex(benchmarks);
    var phases = (ctx && Array.isArray(ctx.phases)) ? ctx.phases : [];
    var assumpIdx = _assumptionIndex(ctx && ctx.phaseAssumptions);
    var months = _planMonthsOf(list);
    var byMonth = {};
    months.forEach(function (m) {
      byMonth[m] = { month: m, views: 0, visits: 0, freemium: 0, paid: 0, b2b: 0, b2bBridge: 0, hasForecast: false };
    });
    var totals = { views: 0, visits: 0, freemium: 0, paid: 0, b2b: 0, b2bBridge: 0 };
    // Tiền xử lý: resolve phase cho mọi row (views mỗi bài của phase
    // được áp trực tiếp tại từng row ở dưới — không còn bước phân bổ).
    var resolved = list.map(function (r) {
      return _resolvePhase(phases, r || {}, _planMonth(r));
    });
    var byPhase = {};
    // --- Kênh Email: chuỗi tồn Free đầu tháng theo Brand ----------
    // emailStockSeries được tính GIỮA 2 lượt (sau lượt 1); trong
    // lượt 1 nó là null nên nhánh Email trong computeRowForecast
    // trả base (forecast null) và bị lượt 2 ghi đè.
    var emailStockSeries = null;
    // opening_free hiệu dụng của 1 Brand cho list Email: ưu tiên
    // ctx.openingFreeByBrand[brand] -> ctx.openingFree (khi rows chỉ
    // thuộc 1 Brand) -> opening_free trên Phase SỚM NHẤT (theo
    // start_month) của Brand có giá trị; tất cả đều thiếu -> 0.
    function _emailOpeningFree(brandKey) {
      if (ctx) {
        var byBrand = ctx.openingFreeByBrand || ctx.opening_free_by_brand;
        if (byBrand && byBrand[brandKey] !== undefined && byBrand[brandKey] !== null) {
          var vb = _planNum(byBrand[brandKey]);
          if (vb !== null) return vb;
        }
        var single = ctx.openingFree !== undefined && ctx.openingFree !== null ? ctx.openingFree : ctx.opening_free;
        if (single !== undefined && single !== null) {
          var brandsInRows = {};
          list.forEach(function (r) { brandsInRows[_planBrandId(r) || ''] = true; });
          if (Object.keys(brandsInRows).length === 1) {
            var vs = _planNum(single);
            if (vs !== null) return vs;
          }
        }
      }
      var best = null, bestStart = null;
      phases.forEach(function (p) {
        if ((_planBrandId(p) || '') !== brandKey) return;
        var of = _planNum(p.opening_free !== undefined && p.opening_free !== null ? p.opening_free : p.openingFree);
        if (of === null) return;
        var sm = _phaseMonth(p, 'start_month', 'startMonth');
        if (best === null || (sm && (bestStart === null || sm < bestStart))) { best = of; bestStart = sm; }
      });
      return best === null ? 0 : best;
    }
    // Chuỗi list đầu tháng theo Brand từ kết quả lượt 1 (chỉ kênh
    // KHÁC Email): list[m] = opening + Σ (freemium − paid) của mọi
    // tháng trước m. Bỏ qua free churn — xấp xỉ đã chốt (xem doc
    // đầu hàm).
    function _freeStockSeries(pass1Detail) {
      var net = {};
      (pass1Detail || []).forEach(function (d) {
        if (!d || !d.forecast || !d.month) return;
        var k = d.brand_id || '';
        if (!net[k]) net[k] = {};
        net[k][d.month] = (net[k][d.month] || 0) + (Number(d.forecast.freemium) || 0) - (Number(d.forecast.paid) || 0);
      });
      var keys = {};
      list.forEach(function (r) { keys[_planBrandId(r) || ''] = true; });
      var series = {};
      Object.keys(keys).forEach(function (k) {
        var stock = _emailOpeningFree(k);
        var s = {};
        months.forEach(function (m) { s[m] = stock; stock += (net[k] && net[k][m]) || 0; });
        series[k] = s;
      });
      return series;
    }
    function computeRowForecast(r, i) {
      var res = resolved[i];
      var base = {
        rowId: r && r.id !== undefined ? r.id : null,
        brand_id: _planBrandId(r), segment: r ? (r.segment || null) : null,
        month: _planMonth(r), channel: r ? (r.channel || null) : null,
        group: r ? (r.group || null) : null, qty: r ? _planQty(r) : null,
        phase_id: res.phaseId,
        forecast: null
      };
      var b = _benchmarkFor(idx, r || {});
      // Phase cho cascade: phase đã resolve (có mặt trong ctx.phases)
      // hoặc phase giả mang phaseId + brand của row khi id không tra
      // thấy — _resolveFieldCascade tự bỏ cascade khi phase không có
      // trong danh sách (chỉ còn assumption đúng phase -> benchmark
      // như cũ). Brand cho cascade lấy từ phase/row như _planBrandId.
      var cascadePhase = res.phase || (res.phaseId ? { id: res.phaseId, brand_id: _planBrandId(r) } : null);
      function baseRate(snake, camel) {
        var bv = b ? _benchField(b, snake, camel) : null;
        return _resolveFieldCascade(cascadePhase, r ? r.channel : null, assumpIdx, phases, function (a) { return _assumpField(a, snake, camel); }, bv).value;
      }
      // Tỉ lệ phễu HIỆU DỤNG (trước uplift) theo phễu MỚI 2 bước dưới
      // views: v2f = visit_to_freemium ?? visit_to_signup (fallback key
      // cũ); f2p = freemium_to_paid ?? (signup_to_first x first_to_paid)
      // — fallback gộp chỉ khi có CẢ HAI key cũ (mỗi key đã qua cơ chế
      // assumption-thắng-benchmark của baseRate), thiếu một trong hai
      // -> f2p = null. Áp tại MỌI điểm đọc tỉ lệ của forecastFunnel
      // (đường content, đường budget-driven/Objective, phase_assumptions
      // override) để số Paid không đổi khi dữ liệu còn key cũ.
      function funnelRates() {
        var v2fNew = baseRate('visit_to_freemium', 'visitToFreemium');
        var v2f = v2fNew !== null ? v2fNew : baseRate('visit_to_signup', 'visitToSignup');
        var f2p = baseRate('freemium_to_paid', 'freemiumToPaid');
        if (f2p === null) {
          var s2fOld = baseRate('signup_to_first', 'signupToFirst');
          var f2pOld = baseRate('first_to_paid', 'firstToPaid');
          if (s2fOld !== null && f2pOld !== null) f2p = s2fOld * f2pOld;
        }
        return {
          v2v: baseRate('view_to_visit', 'viewToVisit'),
          v2f: v2f,
          f2p: f2p,
          p2b: baseRate('paid_to_b2b', 'paidToB2b'),
          l2a: baseRate('lead_to_account', 'leadToAccount'),
          d2a: baseRate('demo_to_account', 'demoToAccount')
        };
      }
      // n = số tháng từ tháng đầu phase tới tháng của row (tháng đầu
      // phase n = 0; không resolve được phase/mốc -> 0). DÙNG CHUNG cho
      // uplift tỉ lệ (upliftRates) và Uplift Views (đường Content) —
      // một cơ chế đếm duy nhất, không đếm riêng từng đường.
      function monthOffset() {
        if (!res.phase) return 0;
        var startIdx = _monthIndex(_phaseMonth(res.phase, 'start_month', 'startMonth'));
        var rowIdx = _monthIndex(base.month);
        return (startIdx !== null && rowIdx !== null) ? Math.max(0, rowIdx - startIdx) : 0;
      }
      // Uplift của phase áp vào các tỉ lệ chuyển đổi được truyền vào
      // (không áp vào qty/output/ngân sách/visits suy từ ngân sách).
      function upliftRates(rates) {
        if (!res.phase) return rates;
        var n = monthOffset();
        var uplift = _phaseUplift(res.phase);
        var out = {};
        Object.keys(rates).forEach(function (k) { out[k] = effectiveRate(rates[k], uplift, n); });
        return out;
      }
      var views, visits;
      if (_isEmailRow(r)) {
        // KÊNH EMAIL — chuỗi opens -> clicks (visits) -> Paid từ
        // TỒN Free (xem doc đầu hàm). Lượt 1 (emailStockSeries còn
        // null) bỏ qua: trả base chưa forecast; lượt 2 tính thật.
        if (!emailStockSeries) return base;
        var eQty = _planQty(r);
        var eRates0 = funnelRates();
        // Ngữ nghĩa cột cho Email: v2v = open rate; v2f =
        // click/open; f2p = click→paid. Thiếu 1 trong 3 -> forecast
        // null như kênh thường (không bịa số).
        if (eQty === null || eRates0.v2v === null || eRates0.v2f === null || eRates0.f2p === null) return base;
        var eRates = upliftRates(eRates0);
        var eSeries = emailStockSeries[_planBrandId(r) || ''] || {};
        var eList = eSeries[base.month] !== undefined && eSeries[base.month] !== null ? eSeries[base.month] : 0;
        var eOpens = eList * eRates.v2v * eQty;
        var eVisits = eOpens * eRates.v2f;
        var ePaid = eVisits * eRates.f2p;
        // Freemium Email = 0 tuyệt đối; cầu nối Paid->B2B như kênh
        // content (toàn bộ b2b của Email là bridge).
        var eB2b = eRates.p2b !== null && eRates.p2b !== undefined ? ePaid * eRates.p2b : 0;
        base.forecast = { views: eOpens, visits: eVisits, freemium: 0, paid: ePaid, b2b: eB2b, b2bBridge: eB2b, emailOpens: eOpens, emailList: eList };
        var bmE = base.month && byMonth[base.month];
        if (bmE) {
          bmE.views += eOpens; bmE.visits += eVisits; bmE.paid += ePaid; bmE.b2b += eB2b; bmE.b2bBridge += eB2b;
          bmE.hasForecast = true;
        }
        totals.views += eOpens; totals.visits += eVisits; totals.paid += ePaid; totals.b2b += eB2b; totals.b2bBridge += eB2b;
        if (res.phaseId) {
          var bpE = byPhase[res.phaseId];
          if (!bpE) bpE = byPhase[res.phaseId] = { phase_id: res.phaseId, views: 0, visits: 0, freemium: 0, paid: 0, b2b: 0, b2bBridge: 0, rowCount: 0 };
          bpE.views += eOpens; bpE.visits += eVisits; bpE.paid += ePaid; bpE.b2b += eB2b; bpE.b2bBridge += eB2b;
          bpE.rowCount += 1;
        }
        return base;
      }
      var _qty0 = _planQty(r);
      var _budget0 = _planNum(r && r.budget);
      var _grp0 = _rowGroup(r);
      var _isBudgetGroup = !!(_grp0 && BUDGET_DRIVEN_GROUPS[_grp0]);
      if ((b && (b.direct_budget || b.directBudget)) || (_qty0 === null && _budget0 !== null && _isBudgetGroup)) {
        // Dòng budget-driven (qty null): Paid Media theo MÔ HÌNH
        // OBJECTIVE + Partnership/Event trực tiếp (xem doc ở đầu hàm).
        // views_per_unit (Views mỗi bài) KHÔNG áp cho các dòng này —
        // chúng không có qty/content để nhân views mỗi bài; Uplift
        // Views (0019) cũng KHÔNG áp — views ở đây suy từ ngân sách.
        var budget = _budget0;
        var objKey = _rowObjective(r);
        base.objective = objKey;
        if (budget === null) return base;
        var pRates = upliftRates(funnelRates());
        var vals = { views: 0, visits: 0, freemium: 0, paid: 0 };
        var b2bAcc = 0;
        var computed = false;
        // Chảy XUỐNG từ tầng fromIdx; thiếu tỉ lệ -> dừng chuỗi.
        function flowDown(fromIdx) {
          var transRates = [pRates.v2v, pRates.v2f, pRates.f2p];
          for (var ti = fromIdx; ti < FUNNEL_STEPS.length - 1; ti++) {
            var tr = transRates[ti];
            if (tr === null) break;
            vals[FUNNEL_STEPS[ti + 1]] = vals[FUNNEL_STEPS[ti]] * tr;
          }
        }
        if (_grp0 === 'Partnership' || _grp0 === 'Event') {
          // Partnership/Event (budget-driven, không Objective):
          // phần B2C -> Freemium = tiền_B2C / cost_per_result.signup
          // (GIỮ NGUYÊN key đơn giá 'signup' — chỉ tầng đặt kết quả đổi
          // sang Freemium) rồi chảy xuống Paid bằng f2p; phần B2B ->
          // Accounts = tiền_B2B / cost_per_result.b2b_account. Thiếu
          // cả 2 đơn giá -> null.
          var shPE = _audienceShare(r, null);
          var cprSignupPE = _costPerResult(b, 'signup');
          var cprAcctPE = _costPerResult(b, 'b2b_account');
          if (cprSignupPE !== null) {
            computed = true;
            if (shPE.b2c > 0) { vals.freemium = budget * shPE.b2c / cprSignupPE; flowDown(2); }
          }
          if (cprAcctPE !== null) {
            computed = true;
            if (shPE.b2b > 0) b2bAcc += budget * shPE.b2b / cprAcctPE;
          }
          if (!computed) return base;
        } else {
          // Paid Media — MÔ HÌNH OBJECTIVE.
          if (!objKey) return base;
          var cpr = _costPerResult(b, objKey);
          if (cpr === null) return base;
          if (objKey === 'lead_gen' || objKey === 'demo') {
            // Objective có chân B2B: chia ngân sách theo audience.
            // Phần B2C: kết quả = tiền_B2C / đơn giá kết quả, đặt tại
            // tầng Freemium rồi chảy XUỐNG Paid bằng f2p (KHÔNG áp
            // visit_to_freemium ngược). Phần B2B: Leads/Demos =
            // tiền_B2B / đơn giá, rồi
            // Accounts = Leads x lead_to_account (hoặc Demos x
            // demo_to_account); thiếu tỉ lệ -> phần B2B = 0 account.
            var sh = _audienceShare(r, objKey);
            if (sh.b2c > 0) { vals.freemium = budget * sh.b2c / cpr; flowDown(2); }
            if (sh.b2b > 0) {
              var convRate = objKey === 'lead_gen' ? pRates.l2a : pRates.d2a;
              if (convRate !== null) b2bAcc += (budget * sh.b2b / cpr) * convRate;
            }
            computed = true;
          } else {
            // Objective thuần B2C (và Traffic): kết quả đặt TẠI tầng
            // của Objective rồi chảy XUỐNG như trước — KHÔNG suy ngược.
            var tierIdx = FUNNEL_STEPS.indexOf(PAID_OBJECTIVE_TIER[objKey]);
            vals[FUNNEL_STEPS[tierIdx]] = budget / cpr;
            flowDown(tierIdx);
            computed = true;
          }
        }
        if (!computed) return base;
        // CẦU NỐI Paid -> B2B cho MỌI kênh/luồng B2C: Paid User của
        // dòng (từ phần B2C) x tỉ lệ paid_to_b2b của Channel. Chưa có
        // tỉ lệ -> 0 account từ cầu nối (không bịa số). Thay đổi B
        // (18/11): lượng cầu nối được phơi RIÊNG ở field b2bBridge
        // (row detail + byMonth + totals + byPhase) — MỘT nguồn duy
        // nhất; computeOperatingFinancials trừ đúng lượng này khỏi
        // Paid EOM, KHÔNG tính lại cầu nối ở nơi khác. Hai nguồn B2B
        // còn lại (Lead Gen/Demo trực tiếp, Partnership/Event trực
        // tiếp) nằm trong b2bAcc nhưng KHÔNG nằm trong b2bBridge.
        var bridgeAcc = 0;
        if (pRates.p2b !== null && vals.paid) bridgeAcc = vals.paid * pRates.p2b;
        b2bAcc += bridgeAcc;
        views = vals.views; visits = vals.visits;
        var pFreemium = vals.freemium, pPaid = vals.paid;
        base.forecast = { views: views, visits: visits, freemium: pFreemium, paid: pPaid, b2b: b2bAcc, b2bBridge: bridgeAcc };
        var bmP = base.month && byMonth[base.month];
        if (bmP) {
          bmP.views += views; bmP.visits += visits; bmP.freemium += pFreemium; bmP.paid += pPaid; bmP.b2b += b2bAcc; bmP.b2bBridge += bridgeAcc;
          bmP.hasForecast = true;
        }
        totals.views += views; totals.visits += visits; totals.freemium += pFreemium; totals.paid += pPaid; totals.b2b += b2bAcc; totals.b2bBridge += bridgeAcc;
        if (res.phaseId) {
          var bpP = byPhase[res.phaseId];
          if (!bpP) bpP = byPhase[res.phaseId] = { phase_id: res.phaseId, views: 0, visits: 0, freemium: 0, paid: 0, b2b: 0, b2bBridge: 0, rowCount: 0 };
          bpP.views += views; bpP.visits += visits; bpP.freemium += pFreemium; bpP.paid += pPaid; bpP.b2b += b2bAcc; bpP.b2bBridge += bridgeAcc;
          bpP.rowCount += 1;
        }
        return base;
      }
      var qty = _planQty(r);
      var output = b ? _benchField(b, 'output_per_unit', 'outputPerUnit') : null;
      // Views mỗi bài GỐC qua _resolveFieldCascade (cùng logic chung):
      // assumption.views_per_unit của phase này -> kế thừa phase sớm
      // hơn gần nhất cùng brand -> output_per_unit của Benchmark.
      var baseViewsPerUnit = _resolveFieldCascade(cascadePhase, r ? r.channel : null, assumpIdx, phases, function (a) { return _assumpViewsPerUnit(a); }, output).value;
      if (qty === null || baseViewsPerUnit === null) return base;
      // Uplift Views RIÊNG của Phase (0019): views mỗi bài HIỆU DỤNG =
      // gốc x (1 + vu/100)^n với CÙNG n của uplift tỉ lệ (monthOffset),
      // áp TRƯỚC khi nhân qty. Uplift tỉ lệ KHÔNG áp vào views mỗi bài;
      // đường budget-driven ở trên đã return nên không chạm vào đây.
      views = qty * effectiveRate(baseViewsPerUnit, _phaseViewsUplift(res.phase), monthOffset());
      var rates0 = funnelRates();
      if (rates0.v2v === null || rates0.v2f === null || rates0.f2p === null) return base;
      var rates = upliftRates(rates0);
      var v2v = rates.v2v, v2f = rates.v2f, f2p = rates.f2p;
      visits = views * v2v;
      var freemium = visits * v2f;
      var paid = freemium * f2p;
      // CẦU NỐI Paid -> B2B: Paid User của kênh content x tỉ lệ
      // paid_to_b2b của Channel (sửa theo Phase + uplift như mọi tỉ lệ
      // funnel). Chưa có tỉ lệ -> 0 account (không bịa số).
      var b2bC = rates.p2b !== null && rates.p2b !== undefined ? paid * rates.p2b : 0;
      // Đường content: toàn bộ b2b là cầu nối (b2bBridge === b2b).
      base.forecast = { views: views, visits: visits, freemium: freemium, paid: paid, b2b: b2bC, b2bBridge: b2bC };
      var bm = base.month && byMonth[base.month];
      if (bm) {
        bm.views += views; bm.visits += visits; bm.freemium += freemium; bm.paid += paid; bm.b2b += b2bC; bm.b2bBridge += b2bC;
        bm.hasForecast = true;
      }
      totals.views += views; totals.visits += visits; totals.freemium += freemium; totals.paid += paid; totals.b2b += b2bC; totals.b2bBridge += b2bC;
      if (res.phaseId) {
        var bp = byPhase[res.phaseId];
        if (!bp) bp = byPhase[res.phaseId] = { phase_id: res.phaseId, views: 0, visits: 0, freemium: 0, paid: 0, b2b: 0, b2bBridge: 0, rowCount: 0 };
        bp.views += views; bp.visits += visits; bp.freemium += freemium; bp.paid += paid; bp.b2b += b2bC; bp.b2bBridge += b2bC;
        bp.rowCount += 1;
      }
      return base;
    }
    // 2 LƯỢT TÍNH (kênh Email — xem doc đầu hàm): lượt 1 mọi kênh
    // KHÁC Email; tính chuỗi tồn Free từ kết quả lượt 1; lượt 2 tính
    // Email và cộng vào cùng byMonth/totals/byPhase.
    var detail = list.map(function (r, i) { return _isEmailRow(r) ? null : computeRowForecast(r, i); });
    emailStockSeries = _freeStockSeries(detail);
    list.forEach(function (r, i) { if (_isEmailRow(r)) detail[i] = computeRowForecast(r, i); });
    return { steps: FUNNEL_STEPS.slice(), months: months, byMonth: byMonth, totals: totals, rows: detail, byPhase: byPhase };
  }

  /**
   * Ngân sách dự kiến — CHỈ TỰ TÍNH, không có tầng "ngân sách đặt tay do
   * người dùng nhập" cho dòng có số lượng (chốt của Zac: cột Ngân sách chỉ
   * hiển thị; người dùng chỉ sửa Số lượng và Đơn giá). Thứ tự ưu tiên cho
   * MỘT dòng:
   *   1) Dòng CÓ số lượng (qty khác null): ngân sách = qty × đơn giá hiệu
   *      dụng. Đơn giá hiệu dụng CHỈ còn là giá Phase của dòng (field
   *      unit_price/unitPrice trên chính dòng plan, do ô "Đơn giá mỗi
   *      bài" ở Theo phase ghi/xoá; chốt 18/11: BỎ HẲN giá Benchmark —
   *      benchmark unit_price KHÔNG còn được đọc ở đây hay bất kỳ đường
   *      tính giá/ngân sách nào; dòng chưa đặt giá Phase thì ngân sách
   *      phần đó = 0). Field budget lưu sẵn trên dòng có qty KHÔNG được
   *      dùng (an toàn neo: dữ liệu nguồn hiện không có dòng nào vừa có
   *      qty vừa có budget).
   *   2) Dòng KHÔNG có số lượng (qty null — ngoại lệ dữ liệu nguồn Paid
   *      Ads): ngân sách = field budget đã lưu trong dữ liệu nguồn, vì
   *      không có qty × đơn giá để tính. NGOẠI LỆ UI (chốt bổ sung của
   *      Zac): riêng dòng thuộc nhóm "Paid Media" được nhập ngân sách
   *      trực tiếp theo tháng vào chính field budget này (xem
   *      savePlanningMonthPaidBudget ở app.js) vì chỉ số Paid suy ra từ
   *      ngân sách; công thức đọc ở đây KHÔNG đổi — vẫn lấy field budget.
   * Trả tổng theo tháng + kỳ; source của dòng: 'manual_unit_price' /
   * 'direct' / null ('manual' ở đây = giá Phase trên dòng — nguồn giá
   * DUY NHẤT còn lại). totalUnitPrice = totalManualUnitPrice (mọi ngân
   * sách theo đơn giá đều từ giá Phase; giữ cả hai field cho tương
   * thích nơi đọc cũ).
   */
  /** Giá trị thô của đơn giá đặt tay trên 1 dòng plan: unit_price /
   *  unitPrice top-level, thiếu thì customFields/custom_fields. */
  function _manualUnitPriceRaw(r) {
    if (!r) return null;
    if (r.unit_price !== undefined && r.unit_price !== null) return r.unit_price;
    if (r.unitPrice !== undefined && r.unitPrice !== null) return r.unitPrice;
    if (r.customFields && r.customFields.unit_price !== undefined && r.customFields.unit_price !== null) return r.customFields.unit_price;
    if (r.customFields && r.customFields.unitPrice !== undefined && r.customFields.unitPrice !== null) return r.customFields.unitPrice;
    if (r.custom_fields && r.custom_fields.unit_price !== undefined && r.custom_fields.unit_price !== null) return r.custom_fields.unit_price;
    if (r.custom_fields && r.custom_fields.unitPrice !== undefined && r.custom_fields.unitPrice !== null) return r.custom_fields.unitPrice;
    return null;
  }
  function planBudget(rows, benchmarks) {
    var list = rows || [];
    // benchmarks giữ trong chữ ký cho tương thích nơi gọi — KHÔNG còn
    // đọc unit_price của benchmark (chốt 18/11, xem doc ở trên);
    // benchmark vẫn phục vụ tỉ lệ phễu + cost_per_result ở forecast.
    var months = _planMonthsOf(list);
    var byMonth = {};
    months.forEach(function (m) { byMonth[m] = { month: m, amount: 0, directBudget: 0, unitPriceBudget: 0, manualUnitPriceBudget: 0 }; });
    var total = 0, totalDirect = 0, totalUnitPrice = 0, totalManualUnitPrice = 0;
    var detail = list.map(function (r) {
      var entry = {
        rowId: r && r.id !== undefined ? r.id : null,
        month: _planMonth(r), channel: r ? (r.channel || null) : null,
        qty: r ? _planQty(r) : null,
        unitPrice: null,
        amount: 0, source: null
      };
      var qty = r ? _planQty(r) : null;
      if (qty !== null) {
        // Đơn giá đặt tay: field top-level unit_price/unitPrice, thiếu
        // thì customFields/custom_fields (Bước B II-5 — cùng đường đọc
        // với planRowManualUnitPrice của app qua cfVal).
        var manual = r ? _planNum(_manualUnitPriceRaw(r)) : null;
        if (manual !== null) {
          entry.unitPrice = manual; entry.amount = qty * manual; entry.source = 'manual_unit_price';
        }
        // Chưa đặt giá Phase -> amount 0, source null (giá Benchmark
        // bị phớt lờ hoàn toàn — chốt 18/11).
      } else {
        var direct = r ? _planNum(r.budget) : null;
        if (direct !== null) { entry.amount = direct; entry.source = 'direct'; }
      }
      var bm = entry.month && byMonth[entry.month];
      if (bm && entry.source) {
        bm.amount += entry.amount;
        if (entry.source === 'direct') bm.directBudget += entry.amount;
        else {
          bm.unitPriceBudget += entry.amount;
          if (entry.source === 'manual_unit_price') bm.manualUnitPriceBudget += entry.amount;
        }
      }
      if (entry.source === 'direct') totalDirect += entry.amount;
      if (entry.source === 'manual_unit_price') {
        totalUnitPrice += entry.amount;
        totalManualUnitPrice += entry.amount;
      }
      total += entry.amount;
      return entry;
    });
    return {
      months: months, byMonth: byMonth,
      total: total, totalDirect: totalDirect, totalUnitPrice: totalUnitPrice,
      totalManualUnitPrice: totalManualUnitPrice,
      rows: detail
    };
  }

  // =====================================================================
  // Bảng Chỉ số vận hành & tài chính theo tháng (CĂN CHỈNH PHỄU theo
  // sheet Lumilink1 — phễu Freemium/Paid). Đầu vào THUẦN, mọi số do nơi
  // gọi chuẩn bị từ cùng engine funnel + planBudget + các ô nhập theo
  // Phase:
  //   input = { months: ['YYYY-MM', ...],
  //     funnelByMonth: { [month]: { views, visits, freemium, paid, b2b, b2bBridge } },
  //       // b2bBridge = lượng cầu nối Paid->B2B của tháng do
  //       // forecastFunnel phơi ra (field b2bBridge) — thay đổi B 18/11
  //     budgetByMonth: { [month]: VNĐ },
  //     inputsByMonth: { [month]: { paid_churn_rate, free_churn_rate,
  //       monthly_cvr, paid_price, cogs_per_free_user,
  //       cogs_per_paid_user, fixed_cost } },  // tỉ lệ dạng phân số;
  //       // paid_price = giá Paid duy nhất của Phase (VNĐ/user/tháng,
  //       // thay đổi A 18/11)
  //     openingFree, openingPaid }              // số dư trước tháng đầu
  // Ánh xạ: Budget = ngân sách plan tháng; Reach = Views; Visits =
  // Visits; Free user (dòng vào) = Freemium; New Paid = Paid (cohort
  // từ engine funnel) + Free EOM đầu kỳ x monthly_cvr (chuyển đổi từ
  // tồn Free); New Free = Free user − New Paid.
  // Chuỗi tồn (EOM_0 = opening); churn tính trên TỔN ĐẦU KỲ + DÒNG VÀO
  // trong tháng, riêng tháng ĐẦU TIÊN của mảng months cả hai churn
  // nhân thêm hệ số 0,5:
  //   Free churn_t = (Free EOM_{t-1} + Free user_t) x free_churn_rate
  //     (x 0,5 nếu t là tháng đầu)
  //   Paid churn_t = (Paid EOM_{t-1} + New Paid_t) x paid_churn_rate
  //     (x 0,5 nếu t là tháng đầu)
  //   Free EOM_t = Free EOM_{t-1} + Free user_t − New Paid_t − Free
  //     churn_t (kẹp ≥ 0, đánh dấu freeClamped nếu phải kẹp)
  //   Paid EOM_t = Paid EOM_{t-1} + New Paid_t − Paid churn_t − bridgeConverted_t
  //     (thay đổi B 18/11: bridgeConverted_t = funnelByMonth[t].b2bBridge,
  //     trừ SAU churn; nguồn Lead Gen/Demo và Partnership/Event KHÔNG trừ
  //     vì chưa từng là Paid B2C; phần New Paid từ monthly_cvr không gắn
  //     Channel nên không thuộc bridge)
  //   Total users = Free EOM + Paid EOM
  //   ARPPU hiệu dụng = paid_price của Phase chứa tháng (giá Paid
  //     duy nhất, thay đổi A 18/11). Chưa nhập giá (null) hoặc giá âm
  //     -> coi như THIẾU đầu vào giá (Revenue null tháng đó,
  //     missing.paid_price = true; 2 dòng Profit vẫn tính với
  //     Revenue tạm tính 0 — xem ngoại lệ Profit dưới đây).
  //   Revenue_t = ARPPU hiệu dụng x Paid EOM_t
  //   COGS TÁCH theo nhóm user: cogsFree_t = cogs_per_free_user x Free
  //     EOM_t; cogsPaid_t = cogs_per_paid_user x Paid EOM_t; COGS_t =
  //     cogsFree_t + cogsPaid_t (đơn giá là SỐ TIỀN trên mỗi user —
  //     VNĐ/user/tháng — KHÔNG theo % doanh thu). Thiếu MỘT trong hai
  //     đơn giá -> phần COGS tương ứng + COGS tổng null (2 dòng
  //     Profit vẫn tính với phần COGS thiếu tạm tính 0 — xem dưới).
  //   Profit (after COGS + mkt cost) = Revenue − COGS − Budget
  //   Profit (after COGS + fixed cost + mkt cost) = trên − fixed_cost
  // QUYẾT ĐỊNH ĐÃ CHỐT: monthly_cvr null -> nguồn chuyển đổi từ tồn
  // Free đóng góp 0 vào New Paid (KHÔNG null-hoá New Paid).
  // Thiếu đầu vào -> giá trị null ("—" ở UI), TUYỆT ĐỐI không điền 0
  // lặng lẽ: thiếu opening hoặc thiếu 1 tỉ lệ churn của 1 tháng thì
  // chuỗi EOM đứt từ tháng đó (các tháng sau cũng null vì phụ thuộc
  // tồn trước). NGOẠI LỆ (Zac chốt 18/11/2026): riêng 2 dòng Profit
  // thành phần nào null thì tạm tính 0 nên LUÔN là số — Profit1 =
  // (Revenue ?? 0) + (Revenue B2B ?? 0) − COGS-cho-Profit −
  // (COGS B2B ?? 0) − Budget, trong đó COGS-cho-Profit =
  // (cogsFree ?? 0) + (cogsPaid ?? 0) (= COGS khi đủ cả hai, = phần
  // còn lại khi thiếu một phần, = 0 khi thiếu cả hai); Profit2 =
  // Profit1 − (fixed_cost ?? 0) (thiếu fixed_cost thì Profit2 =
  // Profit1). Cột Tổng: dòng flow cộng dồn (null nếu có tháng null,
  // riêng 2 dòng Profit luôn cộng được vì mọi tháng đều có số),
  // dòng tồn lấy giá trị tháng cuối.
  // =====================================================================
  // Phân loại cột Tổng của bảng vận hành — MỘT nguồn (Bước B II-10):
  // dòng FLOW cộng dồn cả kỳ; dòng STOCK lấy giá trị tháng cuối.
  // arppuEffective KHÔNG thuộc hai nhóm này (tỉ lệ, không cộng dồn —
  // xem xử lý riêng ở planningOperatingData phía app / Bước B I-8).
  var OPERATING_FLOW_KEYS = ['budget', 'reach', 'visits', 'freeUser', 'newPaid', 'newFree', 'paidChurn', 'freeChurn', 'revenue', 'cogs', 'cogsFree', 'cogsPaid', 'profitAfterCogsMkt', 'profitAfterCogsFixedMkt', 'newB2b', 'b2bBridge', 'b2bChurn', 'revenueB2b', 'cogsB2b'];
  var OPERATING_STOCK_KEYS = ['paidEom', 'freeEom', 'totalUsers', 'b2bEom'];
  function computeOperatingFinancials(input) {
    var inp = input || {};
    var months = Array.isArray(inp.months) ? inp.months.slice() : [];
    var funnel = inp.funnelByMonth || {};
    var budgetMap = inp.budgetByMonth || {};
    var inputsMap = inp.inputsByMonth || {};
    function num(v) { return _planNum(v); }
    var openingFree = num(inp.openingFree !== undefined && inp.openingFree !== null ? inp.openingFree : inp.opening_free);
    var openingPaid = num(inp.openingPaid !== undefined && inp.openingPaid !== null ? inp.openingPaid : inp.opening_paid);
    var missing = { opening: openingFree === null || openingPaid === null, paid_churn_rate: false, free_churn_rate: false, paid_price: false, cogs_per_free_user: false, cogs_per_paid_user: false, fixed_cost: false };
    // --- Tài chính B2B (mô hình B2B bottom-up) + thay đổi B (18/11):
    // chuỗi tồn B2B Account RIÊNG, song song chuỗi Free/Paid: New B2B
    // Accounts lấy từ funnelByMonth[m].b2b; B2B churn = B2B EOM đầu kỳ
    // x b2b_churn_rate (theo Phase, KHÔNG nhân 0,5 tháng đầu như chuỗi
    // B2C); B2B EOM = đầu kỳ + New − churn; Revenue B2B = arppu_b2b x
    // B2B EOM; COGS B2B = cogs_per_b2b_account x B2B EOM. QUY TẮC MỚI
    // (thay đổi B, đảo quy tắc cũ): Paid User chuyển sang B2B qua cầu
    // nối paid_to_b2b (lượng bridge = funnelByMonth[m].b2bBridge do
    // forecastFunnel phơi ra, cũng chấp nhận inputsByMonth[m].b2bBridge
    // / bridgeByMonth[m] như đường dự phòng cùng cơ chế input) BỊ TRỪ
    // khỏi Paid EOM trong tháng chuyển đổi (sau churn); B2B Account
    // từ Lead Gen/Demo/Partnership/Event KHÔNG trừ (chưa từng là Paid
    // B2C). Hai dòng Profit tính trên TỔNG
    // B2C + B2B. Thiếu đầu vào B2B -> null như quy tắc chung, NGOẠI
    // TRỪ: khi tồn B2B = 0 và không có account mới (toàn kỳ không hoạt
    // động B2B, kể cả chưa nhập opening_b2b) thì B2B churn/EOM/Revenue
    // B2B/COGS B2B = 0; và ngoại lệ 2 dòng Profit (Zac chốt 18/11/2026):
    // Revenue B2B / COGS B2B null thì tạm tính 0 cho Profit nên Profit
    // luôn là số. Thiếu đầu vào B2B khi ĐANG có hoạt động B2B
    // được ghi ở missingB2b (tách khỏi `missing` B2C).
    var openingB2b = num(inp.openingB2b !== undefined && inp.openingB2b !== null ? inp.openingB2b : inp.opening_b2b);
    function funnelB2b(m) {
      var f = funnel[m] || {};
      var v = f.b2b !== undefined && f.b2b !== null ? f.b2b : (f.b2bAccounts !== undefined && f.b2bAccounts !== null ? f.b2bAccounts : f.newB2b);
      return num(v) || 0;
    }
    // Lượng BRIDGE (cầu nối Paid->B2B) của tháng — MỘT nguồn duy nhất
    // là field b2bBridge do forecastFunnel tính. Đường vào chính:
    // funnelByMonth[m].b2bBridge (app planningOperatingData truyền
    // từ byMonth của forecast). Dự phòng cùng cơ chế input hiện có:
    // inputsByMonth[m].b2bBridge / b2b_bridge / bridgeConverted,
    // hoặc inp.bridgeByMonth[m]. Thiếu field -> 0 (không suy từ
    // tổng b2b, vì tổng gồm cả nguồn không trừ).
    function funnelBridge(m) {
      var f = funnel[m] || {};
      var v = f.b2bBridge !== undefined && f.b2bBridge !== null ? f.b2bBridge
        : (f.b2b_bridge !== undefined && f.b2b_bridge !== null ? f.b2b_bridge
        : (f.bridgeConverted !== undefined && f.bridgeConverted !== null ? f.bridgeConverted : f.bridge));
      if (v !== undefined && v !== null) return num(v) || 0;
      var im = inputsMap[m] || {};
      var v2 = im.b2bBridge !== undefined && im.b2bBridge !== null ? im.b2bBridge
        : (im.b2b_bridge !== undefined && im.b2b_bridge !== null ? im.b2b_bridge
        : (im.bridgeConverted !== undefined && im.bridgeConverted !== null ? im.bridgeConverted : im.bridge_converted));
      if (v2 !== undefined && v2 !== null) return num(v2) || 0;
      var bm = inp.bridgeByMonth || inp.b2bBridgeByMonth || {};
      var v3 = bm[m];
      if (v3 !== undefined && v3 !== null) return num(v3) || 0;
      return 0;
    }
    var hasB2bActivity = (openingB2b !== null && openingB2b > 0) || months.some(function (m) { return funnelB2b(m) > 0; });
    var missingB2b = { opening_b2b: false, b2b_churn_rate: false, arppu_b2b: false, cogs_per_b2b_account: false };
    if (hasB2bActivity && openingB2b === null) missingB2b.opening_b2b = true;
    var prevB2b = openingB2b;
    var chainBrokenB2b = hasB2bActivity && openingB2b === null;
    var prevFree = openingFree, prevPaid = openingPaid;
    var chainBroken = missing.opening;
    // ARPPU hiệu dụng = giá Paid duy nhất của Phase chứa tháng:
    // paid_price / paidPrice (VNĐ/user/tháng). Trả null khi chưa nhập
    // giá hoặc giá âm (coi như thiếu đầu vào giá như hành vi thiếu
    // mức giá trước thay đổi A).
    var rows = months.map(function (m, monthIdx) {
      var isFirstMonth = monthIdx === 0;
      var f = funnel[m] || {};
      var im = inputsMap[m] || {};
      function inNum(snake, camel) {
        var v = im[snake] !== undefined && im[snake] !== null ? im[snake] : im[camel];
        return num(v);
      }
      var budget = num(budgetMap[m]);
      var cohortPaid = num(f.paid) || 0;
      var row = {
        month: m,
        budget: budget === null ? 0 : budget,
        reach: num(f.views) || 0,
        visits: num(f.visits) || 0,
        freeUser: num(f.freemium) || 0,
        newFree: 0,
        newPaid: cohortPaid,
        newB2b: funnelB2b(m),
        b2bBridge: funnelBridge(m),
        bridgeConverted: funnelBridge(m),
        paidChurn: null, freeChurn: null,
        paidEom: null, freeEom: null, totalUsers: null,
        b2bChurn: null, b2bEom: null,
        revenue: null, cogs: null, cogsFree: null, cogsPaid: null,
        arppuEffective: null,
        revenueB2b: null, cogsB2b: null,
        profitAfterCogsMkt: null, profitAfterCogsFixedMkt: null,
        freeClamped: false
      };
      row.newFree = row.freeUser - row.newPaid;
      var paidChurnRate = inNum('paid_churn_rate', 'paidChurnRate');
      var freeChurnRate = inNum('free_churn_rate', 'freeChurnRate');
      var monthlyCvr = inNum('monthly_cvr', 'monthlyCvr');
      var arppuEff = inNum('paid_price', 'paidPrice');
      if (arppuEff !== null && arppuEff < 0) arppuEff = null;
      var cogsPerFree = inNum('cogs_per_free_user', 'cogsPerFreeUser');
      var cogsPerPaid = inNum('cogs_per_paid_user', 'cogsPerPaidUser');
      var fixedCost = inNum('fixed_cost', 'fixedCost');
      var b2bChurnRate = inNum('b2b_churn_rate', 'b2bChurnRate');
      var arppuB2b = inNum('arppu_b2b', 'arppuB2b');
      var cogsPerB2b = inNum('cogs_per_b2b_account', 'cogsPerB2bAccount');
      if (paidChurnRate === null) missing.paid_churn_rate = true;
      if (freeChurnRate === null) missing.free_churn_rate = true;
      if (arppuEff === null) missing.paid_price = true;
      if (cogsPerFree === null) missing.cogs_per_free_user = true;
      if (cogsPerPaid === null) missing.cogs_per_paid_user = true;
      if (fixedCost === null) missing.fixed_cost = true;
      if (arppuEff !== null) row.arppuEffective = arppuEff;
      if (!chainBroken && paidChurnRate !== null && freeChurnRate !== null) {
        // New Paid = cohort từ engine + chuyển đổi từ tồn Free đầu kỳ
        // (monthly_cvr null -> phần chuyển đổi = 0 theo quyết định đã
        // chốt, không null-hoá New Paid).
        var converted = monthlyCvr !== null ? prevFree * monthlyCvr : 0;
        row.newPaid = cohortPaid + converted;
        row.newFree = row.freeUser - row.newPaid;
        // Churn trên (tồn đầu kỳ + dòng vào tháng); tháng đầu x 0,5.
        var churnFactor = isFirstMonth ? 0.5 : 1;
        row.freeChurn = (prevFree + row.freeUser) * freeChurnRate * churnFactor;
        row.paidChurn = (prevPaid + row.newPaid) * paidChurnRate * churnFactor;
        // Thay đổi B (18/11): trừ bridge SAU churn — Paid EOM =
        // tồn trước + New Paid − Paid churn − bridgeConverted(tháng).
        // bridgeConverted = row.b2bBridge (từ forecastFunnel, một nguồn).
        row.paidEom = prevPaid + row.newPaid - row.paidChurn - row.b2bBridge;
        var freeRaw = prevFree + row.freeUser - row.newPaid - row.freeChurn;
        if (freeRaw < 0) { row.freeClamped = true; freeRaw = 0; }
        row.freeEom = freeRaw;
        row.totalUsers = row.freeEom + row.paidEom;
        prevFree = row.freeEom; prevPaid = row.paidEom;
      } else {
        chainBroken = true;
      }
      if (row.paidEom !== null && arppuEff !== null) row.revenue = arppuEff * row.paidEom;
      if (row.freeEom !== null && cogsPerFree !== null) row.cogsFree = cogsPerFree * row.freeEom;
      if (row.paidEom !== null && cogsPerPaid !== null) row.cogsPaid = cogsPerPaid * row.paidEom;
      if (row.cogsFree !== null && row.cogsPaid !== null) row.cogs = row.cogsFree + row.cogsPaid;
      // Chuỗi tồn B2B (độc lập với chuỗi Free/Paid ở trên).
      if (!hasB2bActivity) {
        // Toàn kỳ không có B2B: tồn 0 + không account mới -> mọi số
        // B2B = 0 (ngoại lệ đã duyệt), Profit tính như B2C thuần.
        row.b2bChurn = 0; row.b2bEom = 0; row.revenueB2b = 0; row.cogsB2b = 0;
      } else {
        if (b2bChurnRate === null) missingB2b.b2b_churn_rate = true;
        if (!chainBrokenB2b && b2bChurnRate !== null) {
          row.b2bChurn = prevB2b * b2bChurnRate;
          row.b2bEom = prevB2b + row.newB2b - row.b2bChurn;
          prevB2b = row.b2bEom;
        } else {
          chainBrokenB2b = true;
        }
        if (row.b2bEom !== null) {
          if (arppuB2b !== null) row.revenueB2b = arppuB2b * row.b2bEom;
          else if (row.b2bEom === 0 && row.newB2b === 0) row.revenueB2b = 0;
          else missingB2b.arppu_b2b = true;
          if (cogsPerB2b !== null) row.cogsB2b = cogsPerB2b * row.b2bEom;
          else if (row.b2bEom === 0 && row.newB2b === 0) row.cogsB2b = 0;
          else missingB2b.cogs_per_b2b_account = true;
        }
      }
      // Profit tính trên TỔNG B2C + B2B — NGOẠI LỆ 2 dòng Profit
      // (Zac chốt 18/11/2026): thành phần nào null thì tạm tính 0,
      // 2 dòng Profit LUÔN là số ở mọi tháng (kể cả khi chuỗi tồn
      // đứt làm Revenue/COGS null). COGS cho Profit tính theo từng
      // thành phần (cogsFree ?? 0) + (cogsPaid ?? 0): bằng row.cogs
      // khi đủ cả hai, bằng phần còn lại khi thiếu một phần, bằng 0
      // khi thiếu cả hai — khớp công thức (Revenue ?? 0) +
      // (Revenue B2B ?? 0) − (COGS ?? 0) − (COGS B2B ?? 0) − Budget
      // ở mọi ca COGS đủ hoặc thiếu hẳn. Thiếu fixed_cost thì
      // Profit2 = Profit1 (fixed_cost tạm tính 0).
      var _pRev = row.revenue !== null && row.revenue !== undefined ? row.revenue : 0;
      var _pRevB2b = row.revenueB2b !== null && row.revenueB2b !== undefined ? row.revenueB2b : 0;
      var _pCogs = (row.cogsFree !== null && row.cogsFree !== undefined ? row.cogsFree : 0)
        + (row.cogsPaid !== null && row.cogsPaid !== undefined ? row.cogsPaid : 0);
      var _pCogsB2b = row.cogsB2b !== null && row.cogsB2b !== undefined ? row.cogsB2b : 0;
      row.profitAfterCogsMkt = (_pRev + _pRevB2b) - _pCogs - _pCogsB2b - row.budget;
      row.profitAfterCogsFixedMkt = row.profitAfterCogsMkt - (fixedCost !== null && fixedCost !== undefined ? fixedCost : 0);
      return row;
    });
    var FLOW_KEYS = OPERATING_FLOW_KEYS;
    var STOCK_KEYS = OPERATING_STOCK_KEYS;
    var totals = {};
    FLOW_KEYS.forEach(function (k) {
      var sum = 0, ok = rows.length > 0;
      rows.forEach(function (r) { if (r[k] === null) ok = false; else sum += r[k]; });
      totals[k] = ok ? sum : null;
    });
    STOCK_KEYS.forEach(function (k) {
      totals[k] = rows.length ? rows[rows.length - 1][k] : null;
    });
    return { months: rows, totals: totals, missing: missing, missingB2b: missingB2b, openingFree: openingFree, openingPaid: openingPaid, openingB2b: openingB2b };
  }

  var api = {
    summarizePlanByMonth: summarizePlanByMonth,
    summarizePlanByChannel: summarizePlanByChannel,
    forecastFunnel: forecastFunnel,
    effectiveRate: effectiveRate,
    planBudget: planBudget,
    computeOperatingFinancials: computeOperatingFinancials,
    PAID_OBJECTIVES: PAID_OBJECTIVES,
    PAID_OBJECTIVE_TIER: PAID_OBJECTIVE_TIER,
    PAID_CHANNEL_OBJECTIVES: PAID_CHANNEL_OBJECTIVES,
    paidObjectiveOf: _rowObjective,
    costPerResultFor: costPerResultFor,
    audienceShareFor: audienceShareFor,
    rowAudienceOf: _rowAudience,
    PURE_B2C_OBJECTIVES: PURE_B2C_OBJECTIVES,
    BUDGET_DRIVEN_GROUPS: BUDGET_DRIVEN_GROUPS,
    wouldCreateCycle: wouldCreateCycle,
    taskReadiness: taskReadiness,
    previewDependencyImpact: previewDependencyImpact,
    distributeEffort: distributeEffort,
    commitmentPaidTotal: commitmentPaidTotal,
    openCommitmentTotal: openCommitmentTotal,
    openCommitmentAmount: openCommitmentAmount,
    budgetActualTotal: budgetActualTotal,
    benchmarkForRow: benchmarkForRow,
    isEmailRow: _isEmailRow,
    rowGroupOf: rowGroupOf,
    planChannelOrder: planChannelOrder,
    planChannelOrderByGroup: planChannelOrderByGroup,
    planQtyOf: _planQty,
    resolvePhaseFor: _resolvePhase,
    effectiveRatesFor: effectiveRatesFor,
    effectiveViewsPerUnitFor: effectiveViewsPerUnitFor,
    planMonthsOf: _planMonthsOf,
    planMonthsForYear: planMonthsForYear,
    cashBalanceFor: cashBalanceFor,
    OPERATING_FLOW_KEYS: OPERATING_FLOW_KEYS,
    OPERATING_STOCK_KEYS: OPERATING_STOCK_KEYS,
    budgetRemaining: budgetRemaining,
    factApprovalStatus: factApprovalStatus,
    isApprovedFact: isApprovedFact,
    budgetUsageTotal: budgetUsageTotal,
    kpiDisplay: kpiDisplay,
    computeRates: computeRates,
    aggregateRates: aggregateRates,
    latestLifetimeSnapshot: latestLifetimeSnapshot,
    sumUniqueReachGuard: sumUniqueReachGuard,
    adsRollupGuard: adsRollupGuard,
    pickLevelTotals: pickLevelTotals,
    campaignProgress: campaignProgress,
    checklistProgress: checklistProgress,
    buildTaskTimeline: buildTaskTimeline,
    buildCampaignTreeTimeline: buildCampaignTreeTimeline,
    timelineStateFromTaskFilter: timelineStateFromTaskFilter,
    tiktokCanPublish: tiktokCanPublish,
    shouldCreatePublishJob: shouldCreatePublishJob,
    formatDateVN: formatDateVN,
    formatDateTimeVN: formatDateTimeVN,
    weekStartMonday: weekStartMonday,
    lifetimeLatestByObject: lifetimeLatestByObject,
    sumLifetimeLatest: sumLifetimeLatest,
    filterInsightsByLevelAndAccount: filterInsightsByLevelAndAccount,
    buildCsv: buildCsv,
    csvEscape: csvEscape,
    weeklyWorkload: weeklyWorkload,
    assessTaskRisk: assessTaskRisk,
    validateAllocations: validateAllocations,
    allocationShareForScope: allocationShareForScope,
    summarizeBudgetScope: summarizeBudgetScope,
    budgetScopeSummary: summarizeBudgetScope,
    rollupKpi: rollupKpi,
    kpiRollup: rollupKpi,
    POST_METRIC_CODES: POST_METRIC_CODES,
    kpiDataSource: kpiDataSource,
    postMetricActual: postMetricActual
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SAVA_DOMAIN = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
