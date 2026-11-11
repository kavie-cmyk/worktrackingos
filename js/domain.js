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

  /**
   * Tính số tiền ngân sách còn lại của một dòng ngân sách.
   * Remaining = Approved − tổng Actual − cam kết còn mở.
   * Cam kết đã có actual liên kết (actual.commitmentId) thì phần đã thanh toán
   * không bị trừ hai lần.
   * @param {object} line Dòng ngân sách có approved/approvedAmount.
   * @param {Array<object>} commitments Các cam kết thuộc dòng.
   * @param {Array<object>} actuals Các khoản chi thực tế thuộc dòng.
   * @returns {number} Số tiền còn lại.
   */
  function budgetRemaining(line, commitments, actuals) {
    // line: object có approved/approvedAmount, hoặc chính số approved (number).
    var approved = (typeof line === 'number') ? line
      : (pickNum(line, ['approved', 'approvedAmount', 'approved_amount', 'budgetApproved', 'amountApproved']) || 0);
    var acts = actuals || [];
    var actualTotal = 0;
    var paidByCommitment = {};
    acts.forEach(function (a) {
      var amt = pickNum(a, ['amount', 'actualAmount', 'actual_amount', 'value']) || 0;
      actualTotal += amt;
      var cid = a.commitmentId || a.commitment_id;
      if (cid) paidByCommitment[cid] = (paidByCommitment[cid] || 0) + amt;
    });
    var OPEN = { open: 1, committed: 1, planned: 1, partial: 1, partially_actualised: 1, partially_paid: 1, in_progress: 1 };
    var openCommitmentTotal = 0;
    (commitments || []).forEach(function (c) {
      var st = normStatus(c.status);
      // settled / cancelled / released / closed: KHÔNG trừ phần chưa settle ở đây;
      // phần đã thanh toán của chúng nằm trong Σactuals (hoặc settled_amount đã khớp actuals).
      if (!OPEN[st]) return;
      var amt = pickNum(c, ['amount', 'committedAmount', 'committed_amount', 'commitmentAmount', 'value']) || 0;
      var settled = pickNum(c, ['settledAmount', 'settled_amount']);
      if (settled === null) settled = paidByCommitment[c.id] || 0;
      openCommitmentTotal += Math.max(0, amt - settled);
    });
    return approved - actualTotal - openCommitmentTotal;
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
   * Gộp tỷ lệ từ nhiều dòng: tính lại từ TỔNG tử số / TỔNG mẫu số,
   * không lấy trung bình của các tỷ lệ.
   * @param {Array<object>} rows Các dòng số liệu gốc.
   * @returns {{ctr:(number|null), cpc:(number|null), cpm:(number|null), costPerResult:(number|null), roas:(number|null), totals:object}}
   */
  function aggregateRates(rows) {
    // R22/QA20: trường nào THIẾU ở bất kỳ dòng nào (null/undefined/'') thì
    // tổng của trường đó = null → tỷ lệ phụ thuộc trả null, KHÔNG ép 0.
    var fields = ['spend', 'impressions', 'clicks', 'results', 'conversionValue'];
    var totals = {}; var complete = {};
    fields.forEach(function (f) { totals[f] = 0; complete[f] = (rows || []).length > 0; });
    (rows || []).forEach(function (r) {
      fields.forEach(function (f) {
        var v = r[f];
        if (f === 'results' && v === undefined) v = r.conversions;
        if (f === 'conversionValue' && v === undefined) v = r.revenue;
        if (v === null || v === undefined || v === '' || isNaN(Number(v))) complete[f] = false;
        else totals[f] += Number(v);
      });
    });
    fields.forEach(function (f) { if (!complete[f]) totals[f] = null; });
    var rates = computeRates(totals);
    rates.totals = totals;
    rates.complete = complete;
    return rates;
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

  var api = {
    wouldCreateCycle: wouldCreateCycle,
    taskReadiness: taskReadiness,
    previewDependencyImpact: previewDependencyImpact,
    distributeEffort: distributeEffort,
    budgetRemaining: budgetRemaining,
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
    assessTaskRisk: assessTaskRisk
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SAVA_DOMAIN = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
