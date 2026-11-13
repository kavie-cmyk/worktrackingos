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
  function openCommitmentTotal(commitments, actuals) {
    var total = 0;
    (commitments || []).forEach(function (c) {
      if (!isOpenCommitment(c)) return;
      if (!isApprovedFact(c)) return; // 0014: cam kết chưa duyệt không giữ ngân sách
      if (c.archivedAt || c.archived_at) return; // 0014: cam kết đã archive bị bỏ qua
      var amt = pickNum(c, ['amount', 'committedAmount', 'committed_amount', 'commitmentAmount', 'value']) || 0;
      total += Math.max(0, amt - commitmentPaidTotal(c, actuals));
    });
    return total;
  }

  /**
   * Tổng SỬ DỤNG ngân sách của một dòng (0014) — chỉ tính fact ĐÃ DUYỆT:
   * UsageTotal = Σ actuals đã duyệt + Σ nghĩa vụ mở của commitments đã duyệt,
   * nghĩa vụ của một commitment = max(0, amount − Σ actuals ĐÃ DUYỆT liên kết).
   * Commitment có status 'cancelled' (và các status không còn mở khác) hoặc
   * đã archive (archived_at) bị bỏ qua. Khi line có currency, chỉ tính fact
   * cùng currency với line (fact không ghi currency thì vẫn tính — tương
   * thích fixture cũ; khớp công thức RPC decide_*_approval ở 0014).
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
      if (fc === undefined || fc === null || String(fc).trim() === '') return true;
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
   * Share của một fact gốc nhìn từ một scope (activity): có allocations thì
   * lấy tổng share khớp scope; không có allocations thì fact thuộc đúng
   * scope mới tính trọn, fact không gắn scope nào thì tính trọn (caller
   * được hiểu là đã lọc fact theo scope). Không có scopeId → trọn amount.
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
      var sum = 0; var matched = false;
      allocs.forEach(function (a) {
        if (_r31AllocScopeId(a) === String(scopeId)) { matched = true; sum += _r31AllocAmount(a, amount); }
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

    var byCurrency = {};
    Object.keys(buckets).forEach(function (cur) {
      var b = buckets[cur];
      var actualTotal = _r31RoundMoney(b.actualTotal);
      var openCommitments = _r31RoundMoney(b.openCommitments);
      var allocated = _r31RoundMoney(b.allocated);
      byCurrency[cur] = {
        currency: cur,
        ceiling: b.ceiling,
        allocated: allocated,
        unallocated: _r31RoundMoney(b.ceiling - allocated - (cur === primaryCurrency ? directCeiling : 0)),
        actualTotal: actualTotal,
        openCommitments: openCommitments,
        forecastUse: _r31RoundMoney(actualTotal + openCommitments),
        available: _r31RoundMoney(b.ceiling - actualTotal - openCommitments)
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
      function sumFactValues(list) {
        var total = 0; var any = false;
        (list || []).forEach(function (f) {
          if (!f || typeof f !== 'object') return;
          var v = pickNum(f, ['value', 'amount', 'count']);
          if (v !== null) { total += v; any = true; var fid = _r31FactId(f); if (fid) includedRatio.push(fid); }
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
          var fid = _r31FactId(f); if (fid) includedRatio.push(fid);
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
        currency: options.currency || null
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
      included.forEach(function (f, idx) {
        var objectId = f.objectId || f.object_id || f.externalPostId || f.external_post_id || f.postId || _r31FactId(f) || ('row' + idx);
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
      if (!perObject.length || perObject.some(function (e) { return e.value === null; })) {
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
    (observations || []).forEach(function (o) {
      if (!o) return;
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

  var api = {
    wouldCreateCycle: wouldCreateCycle,
    taskReadiness: taskReadiness,
    previewDependencyImpact: previewDependencyImpact,
    distributeEffort: distributeEffort,
    commitmentPaidTotal: commitmentPaidTotal,
    openCommitmentTotal: openCommitmentTotal,
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
