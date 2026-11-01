/* 课序 ClassFlow — 通用工具 */
(function () {
  'use strict';
  var CF = window.CF = window.CF || {};

  var U = CF.Util = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };

  U.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  U.clamp = function (n, min, max) { return Math.min(max, Math.max(min, n)); };

  U.icon = function (name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  };

  U.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  };

  /* ---------- 日期 ---------- */
  U.startOfDay = function (d) {
    d = d ? new Date(d) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  U.today = function () { return U.startOfDay(); };

  U.ymd = function (y, m, d) { return new Date(y, m - 1, d); };

  U.parseDate = function (str) {
    if (!str) return null;
    var m = String(str).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return U.ymd(+m[1], +m[2], +m[3]);
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : U.startOfDay(d);
  };

  U.toDateInput = function (d) {
    if (!d) return '';
    d = new Date(d);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  U.addDays = function (d, n) {
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return U.startOfDay(x);
  };

  // 以周一为一周的第一天
  U.startOfWeekMonday = function (d) {
    var x = U.startOfDay(d);
    var dow = x.getDay(); // 0=周日
    var diff = dow === 0 ? 6 : dow - 1;
    return U.addDays(x, -diff);
  };

  // 只用年月日做差，避开时区与夏令时
  U.diffDays = function (a, b) {
    var ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
  };

  U.weekOf = function (date, startDate) {
    return Math.floor(U.diffDays(startDate, U.startOfDay(date)) / 7) + 1;
  };

  U.dateOfWeek = function (startDate, week, day) {
    return U.addDays(startDate, (week - 1) * 7 + (day - 1));
  };

  U.sameDay = function (a, b) {
    return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  };

  U.WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
  U.WEEKDAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  U.fmtMD = function (d) {
    d = new Date(d);
    return (d.getMonth() + 1) + '/' + d.getDate();
  };
  U.fmtCNMD = function (d) {
    d = new Date(d);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };
  U.fmtWeekday = function (d) {
    var d2 = d instanceof Date ? d : new Date(d);
    return '周' + U.WEEKDAY_SHORT[(d2.getDay() + 6) % 7];
  };
  U.fmtMonthDayWeek = function (d) {
    return U.fmtMD(d) + ' ' + U.fmtWeekday(d);
  };

  U.fmtRange = function (start, end, style) {
    var a = new Date(start), b = new Date(end);
    if (style === 'cn') return U.fmtCNMD(a) + ' – ' + U.fmtCNMD(b);
    return U.fmtMD(a) + ' – ' + U.fmtMD(b);
  };

  U.minutesOf = function (hhmm) {
    var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  };

  U.fmtDuration = function (mins) {
    mins = Math.max(0, Math.round(mins));
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return h + ' 小时 ' + m + ' 分';
    if (h) return h + ' 小时';
    return m + ' 分钟';
  };

  U.relativeDay = function (date, base) {
    var days = U.diffDays(base || U.today(), date);
    if (days === 0) return '今天';
    if (days === 1) return '明天';
    if (days === 2) return '后天';
    if (days === -1) return '昨天';
    return U.fmtWeekday(date);
  };

  U.timeGreeting = function () {
    var h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  };

  /* ---------- 周次 ---------- */
  var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20 };

  U.cnNumber = function (s) { return CN_NUM[s] || null; };

  U.normalizeDigits = function (s) {
    return String(s || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
  };

  /**
   * 解析周次文本。支持：1-16周 / 第1-16周 / 1-16周(单) / 2-16双周 / 1,3,5-9周 / 单周。
   * 返回去重升序数组；无法解析时返回 []。
   */
  U.parseWeeks = function (input, totalWeeks) {
    if (input == null) return [];
    var s = U.normalizeDigits(input).replace(/[，、；;]/g, ',').replace(/[—–~～至]/g, '-').replace(/\s+/g, '');
    if (!s) return [];
    var parity = null;
    if (/(单双|全周)/.test(s)) parity = null;
    else if (/单周|[(（]单[)）]|周单/.test(s)) parity = 'odd';
    else if (/双周|[(（]双[)）]|周双/.test(s)) parity = 'even';
    else if (/单/.test(s) && !/星期/.test(s)) parity = 'odd';
    else if (/双/.test(s) && !/星期/.test(s)) parity = 'even';

    var cleaned = s.replace(/单双周?|单周|双周|周次|周|第|节|星期[一二三四五六日天]?/g, '');
    cleaned = cleaned.replace(/[()（）]/g, '');
    var weeks = [];
    var re = /(\d{1,2})(?:\s*-\s*(\d{1,2}))?/g;
    var m;
    while ((m = re.exec(cleaned))) {
      var a = +m[1];
      var b = m[2] ? +m[2] : a;
      if (a > b) { var t = a; a = b; b = t; }
      if (b - a > 40) b = a + 40;
      for (var w = a; w <= b; w++) if (w >= 1 && w <= 60) weeks.push(w);
    }
    if (!weeks.length && parity) {
      var total = Math.max(1, Math.min(60, totalWeeks || 20));
      for (var i = 1; i <= total; i++) weeks.push(i);
    }
    weeks = Array.from(new Set(weeks)).sort(function (a, b) { return a - b; });
    if (parity === 'odd') weeks = weeks.filter(function (w) { return w % 2 === 1; });
    if (parity === 'even') weeks = weeks.filter(function (w) { return w % 2 === 0; });
    return weeks;
  };

  /** 将周次压缩成易读文本：1-16周 / 1-15单周 / 1-3,5,7周 */
  U.formatWeeks = function (weeks) {
    if (!weeks || !weeks.length) return '';
    var arr = Array.from(new Set(weeks)).sort(function (a, b) { return a - b; });
    var min = arr[0], max = arr[arr.length - 1];
    var allOdd = arr.length >= 3 && arr[0] % 2 === 1 && arr.every(function (w, i) { return w % 2 === 1 && (i === 0 || w === arr[i - 1] + 2); });
    var allEven = arr.length >= 3 && arr[0] % 2 === 0 && arr.every(function (w, i) { return w % 2 === 0 && (i === 0 || w === arr[i - 1] + 2); });
    if (allOdd) return min + '-' + max + '单周';
    if (allEven) return min + '-' + max + '双周';
    var parts = [];
    var start = arr[0], prev = arr[0];
    for (var i = 1; i < arr.length; i++) {
      if (arr[i] === prev + 1) { prev = arr[i]; continue; }
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = prev = arr[i];
    }
    parts.push(start === prev ? String(start) : start + '-' + prev);
    return parts.join(',') + '周';
  };

  U.weeksContain = function (weeks, week) {
    return !!weeks && weeks.indexOf(week) !== -1;
  };

  /* ---------- 其他 ---------- */
  U.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  U.foldText = function (str, len) {
    var s = String(str || '');
    if (s.length <= len) return s;
    return s.slice(0, Math.max(1, len - 1)) + '…';
  };

  U.download = function (filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  };

  U.copyText = function (text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return U.copyTextFallback(text); });
    }
    return U.copyTextFallback(text);
  };

  U.copyTextFallback = function (text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try {
        var ok = document.execCommand('copy');
        ta.remove();
        ok ? resolve() : reject(new Error('copy-failed'));
      } catch (e) {
        ta.remove();
        reject(e);
      }
    });
  };

  U.isTypingTarget = function (el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  };

  U.guessTerm = function (now) {
    var today = U.startOfDay(now);
    var y = today.getFullYear();
    var m = today.getMonth() + 1;
    var start, name;
    if (m >= 8) {
      start = U.startOfWeekMonday(U.ymd(y, 9, 1));
      name = y + ' 秋季学期';
    } else if (m === 1) {
      start = U.startOfWeekMonday(U.ymd(y - 1, 9, 1));
      name = (y - 1) + ' 秋季学期';
    } else {
      start = U.startOfWeekMonday(U.ymd(y, 2, 24));
      name = y + ' 春季学期';
    }
    return { startDate: start, name: name, totalWeeks: 20 };
  };

  /** hex -> rgba string */
  U.hexToRgba = function (hex, alpha) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    if (isNaN(n)) return 'rgba(120,120,120,' + alpha + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  };
})();
