/* 课序 ClassFlow — 课表解析（教务系统页面 / CSV / XLSX / 书签数据） */
(function () {
  'use strict';
  var CF = window.CF = window.CF || {};
  var U = CF.Util;
  var D = CF.Data;
  var P = CF.Parse = {};

  var DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };
  var DAY_EN = { monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7 };

  var LABEL_RE = /^(课程名称|课程名|课程|科目|授课教师|任课教师|教师|老师|上课地点|地点|教室|周次|上课周次|节次|上课节次|时间|教学班|班级|学分|备注|说明)\s*[:：]\s*(.*)$/;
  var PERIOD_RE = /(\d{1,2})\s*[-–—~至]\s*(\d{1,2})\s*节|第\s*(\d{1,2})\s*节|(\d{1,2})\s*[-–—~至]\s*(\d{1,2})(?=\D|$)/;

  function parseError(msg, detail) {
    var err = new Error(msg);
    err.isParseError = true;
    err.detail = detail || '';
    return err;
  }

  function optsWith(base) {
    base = base || {};
    var periods = Array.isArray(base.periods) && base.periods.length ? base.periods : D.DEFAULT_PERIODS;
    return {
      totalWeeks: U.clamp(parseInt(base.totalWeeks, 10) || 20, 1, 30),
      periods: periods
    };
  }

  /* ---------- 基础解析 ---------- */
  function normalizeText(s) {
    return U.normalizeDigits(String(s == null ? '' : s)).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseDayText(input) {
    var s = normalizeText(input).toLowerCase().replace(/星期|礼拜/g, '周').replace(/\s+/g, '');
    if (!s) return 0;
    var m = s.match(/^周([一二三四五六日天1-7])/);
    if (m) return DAY_MAP[m[1]] || 0;
    m = s.match(/^([一二三四五六日天1-7])$/);
    if (m) return DAY_MAP[m[1]] || 0;
    m = s.match(/^([1-7])/);
    if (m) return +m[1];
    if (DAY_EN[s]) return DAY_EN[s];
    var keys = Object.keys(DAY_EN);
    for (var i = 0; i < keys.length; i++) {
      if (s.indexOf(keys[i]) === 0) return DAY_EN[keys[i]];
    }
    return 0;
  }

  function parsePeriodText(input) {
    var s = U.normalizeDigits(input || '').replace(/\s+/g, '');
    if (!s) return null;
    if (!/节/.test(s) && !/\d{1,2}:\d{2}/.test(s)) return null;
    if (/\d{1,2}:\d{2}/.test(s)) {
      // 由 clockRange 单独处理
      return null;
    }
    var m = s.match(PERIOD_RE);
    if (!m) return null;
    var a = m[1] ? +m[1] : (m[3] ? +m[3] : (m[4] ? +m[4] : 0));
    var b = m[2] ? +m[2] : (m[3] ? +m[3] : (m[5] ? +m[5] : 0));
    if (!a) return null;
    if (!b) b = a;
    if (a > b) { var t = a; a = b; b = t; }
    if (a > 20 || b > 20) return null;
    return { start: a, end: b };
  }

  function clockRange(input, periods) {
    var s = U.normalizeDigits(input || '');
    var ms = [], re = /(\d{1,2})[:：](\d{2})/g, m;
    while ((m = re.exec(s))) {
      var h = +m[1], mi = +m[2];
      if (h <= 23 && mi <= 59) ms.push(h * 60 + mi);
    }
    if (!ms.length) return null;
    var startMin = ms[0];
    var endMin = ms.length > 1 ? ms[ms.length - 1] : null;
    var bestStart = -1, bestDelta = 25;
    for (var i = 0; i < periods.length; i++) {
      var ps = U.minutesOf(periods[i].start);
      if (ps == null) continue;
      var d = Math.abs(ps - startMin);
      if (d < bestDelta || (d === bestDelta && bestStart < 0)) { bestDelta = d; bestStart = i + 1; }
    }
    if (bestStart < 0) return null;
    var endPeriod = bestStart;
    if (endMin != null) {
      var bestEnd = -1, bestEndDelta = 25;
      for (var j = 0; j < periods.length; j++) {
        var pe = U.minutesOf(periods[j].end);
        if (pe == null) continue;
        var dd = Math.abs(pe - endMin);
        if (dd < bestEndDelta || (dd === bestEndDelta && bestEnd < 0)) { bestEndDelta = dd; bestEnd = j + 1; }
      }
      if (bestEnd >= bestStart) endPeriod = bestEnd;
    }
    return { start: bestStart, end: endPeriod };
  }

  function isWeekLine(line) {
    if (!/周/.test(line)) return false;
    if (/节|星期|礼拜/.test(line)) return false;
    if (/周[一二三四五六日天]/.test(line)) return false;
    if (/单周|双周|单双/.test(line)) return true;
    var s = U.normalizeDigits(line).replace(/\s+/g, '');
    return /(\d{1,2}\s*[-–—~至]\s*\d{1,2}|\d{1,2}\s*周)/.test(s);
  }

  function isTimeLine(line) {
    if (!/节/.test(line)) return false;
    if (!/\d/.test(line)) return false;
    if (isWeekLine(line)) return false;
    return true;
  }

  function isNoiseLine(line) {
    var s = normalizeText(line);
    if (!s) return true;
    if (/^(无课|暂无|未安排|未排课|休息|空|无|--|—)$/.test(s)) return true;
    if (/^\d{1,2}[\/.\-]\d{1,2}(日|号)?$/.test(s)) return true;
    if (/^\d{1,2}月\d{1,2}日?$/.test(s)) return true;
    if (/^\d{1,2}[:：]\d{2}(\s*[-–~]\s*\d{1,2}[:：]\d{2})?$/.test(s)) return true;
    if (/^第?\s*\d{1,2}\s*节$/.test(s)) return true;
    return false;
  }

  function isSeparator(line) {
    return /^[-—_=*~·]{3,}$/.test(line) || line === '@@SPLIT@@';
  }

  function looksLocation(s) {
    if (!s) return false;
    if (/(教学楼|实验楼|综合楼|主楼|图书馆|体育馆|体育场|报告厅|阶梯教室|机房|实验室|校区|书院|宿舍|食堂|中心|基地|教室|楼|室|馆|场|厅)/.test(s)) return true;
    if (/[A-Za-z]{0,4}\s*[-—]?\s*\d{2,}[A-Za-z]?$/.test(s)) return true;
    if (/^[A-Za-z]\s*[-—]?\s*\d+/.test(s)) return true;
    return false;
  }

  function looksClass(s) {
    return /(年级|级|班|专业|学院|系别)/.test(s) && !/楼|室|馆/.test(s);
  }

  function looksTeacher(s) {
    if (!s) return false;
    var t = s.replace(/\s+/g, ' ').trim();
    if (t.length > 40) return false;
    if (looksLocation(t) || looksClass(t)) return false;
    if (/老师$/.test(t)) t = t.replace(/\s*老师$/, '');
    if (/^[\u4e00-\u9fa5·]{2,10}$/.test(t)) return true;
    if (/^[A-Za-z][A-Za-z .\-']{1,32}$/.test(t)) return true;
    if (/^[\u4e00-\u9fa5·]{2,8}([,，、/][\u4e00-\u9fa5·]{2,8})+$/.test(t)) return true;
    return false;
  }

  function cleanLine(line) {
    return normalizeText(line)
      .replace(/^[•·▪◆◇○●*※]+\s*/, '')
      .replace(/^(课程内容|上课内容|课程信息)\s*[:：]\s*/, '')
      .trim();
  }

  function cleanName(name) {
    var s = normalizeText(name).replace(/^[•·▪◆◇○●*※]+\s*/, '');
    s = s.replace(/^【(.{1,8})】/, '');
    return s.slice(0, 60);
  }

  /* ---------- 字段解析 ---------- */
  function parseCourseChunk(rawLines, opts) {
    var lines = (rawLines || []).map(cleanLine).filter(function (l) { return l && !isSeparator(l); });
    if (!lines.length) return null;

    var fields = [], weeks = [], periodHint = null, noteParts = [];
    lines.forEach(function (line) {
      var lm = line.match(LABEL_RE);
      if (lm) {
        var key = lm[1], val = normalizeText(lm[2]);
        if (!val) return;
        if (/周次/.test(key)) { if (!weeks.length) weeks = U.parseWeeks(val, opts.totalWeeks); return; }
        if (/节次|时间/.test(key)) { if (!periodHint) periodHint = parsePeriodText(val) || clockRange(val, opts.periods); return; }
        if (/教师|老师/.test(key)) { fields.push({ v: val, hint: 'teacher' }); return; }
        if (/地点|教室/.test(key)) { fields.push({ v: val, hint: 'location' }); return; }
        if (/课程名称|课程名|课程|科目/.test(key)) { fields.push({ v: val, hint: 'name' }); return; }
        if (/教学班|班级|学分/.test(key)) { noteParts.push(val); return; }
        if (/备注|说明/.test(key)) { noteParts.push(val); return; }
      }
      if (isWeekLine(line)) {
        if (!weeks.length) weeks = U.parseWeeks(line, opts.totalWeeks);
        return;
      }
      if (isTimeLine(line)) {
        if (!periodHint) periodHint = parsePeriodText(line) || clockRange(line, opts.periods);
        return;
      }
      if (isNoiseLine(line)) return;
      fields.push({ v: line, hint: null });
    });

    if (!fields.length) return null;
    var nameIdx = -1;
    for (var i = 0; i < fields.length; i++) if (fields[i].hint === 'name') { nameIdx = i; break; }
    if (nameIdx < 0) nameIdx = 0;
    var name = cleanName(fields[nameIdx].v);
    if (!name || /^(课程名称|课程|名称|时间|节次|周次)$/.test(name)) return null;

    var rest = fields.filter(function (_, idx) { return idx !== nameIdx; });
    var teacher = '', location = '', extras = [];

    function nameOf(v) {
      return v.replace(/\s*老师$/, '').trim();
    }

    rest.forEach(function (f) {
      var v = f.v;
      if (f.hint === 'teacher' && !teacher) { teacher = nameOf(v); return; }
      if (f.hint === 'location' && !location) { location = v; return; }
      if (/老师/.test(v) && !teacher && !looksLocation(v)) { teacher = nameOf(v); return; }
      if (looksClass(v)) { extras.push(v); return; }
      if (!location && looksLocation(v)) { location = v; return; }
      if (!teacher && looksTeacher(v)) { teacher = nameOf(v); return; }
      extras.push(v);
    });

    // 二次兜底：把还未识别的字段补成教师 / 地点
    if (!teacher) {
      for (var j = 0; j < extras.length; j++) {
        if (looksTeacher(extras[j])) { teacher = nameOf(extras.splice(j, 1)[0]); break; }
      }
    }
    if (!location) {
      for (var k = 0; k < extras.length; k++) {
        if (!looksClass(extras[k]) && extras[k].length <= 30) { location = extras.splice(k, 1)[0]; break; }
      }
    }
    if (!teacher && !location && extras.length > 1) {
      teacher = nameOf(extras.shift());
      location = extras.shift();
    }

    var missing = [];
    if (!weeks.length) {
      missing.push('weeks');
      for (var w = 1; w <= opts.totalWeeks; w++) weeks.push(w);
    }
    if (!teacher) missing.push('teacher');
    if (!location) missing.push('location');

    var note = noteParts.concat(extras.map(function (x) { return String(x).slice(0, 80); })).join(' · ').slice(0, 500);
    return {
      name: name,
      teacher: teacher,
      location: location,
      weeks: weeks,
      note: note,
      periodHint: periodHint,
      missing: missing
    };
  }

  /* ---------- 单元格文本 ---------- */
  function cellLines(el) {
    var clone = el.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('script,style,noscript,iframe')).forEach(function (n) { n.remove(); });
    Array.prototype.slice.call(clone.querySelectorAll('img')).forEach(function (img) {
      if (img.alt) img.replaceWith(document.createTextNode(img.alt));
      else img.remove();
    });
    Array.prototype.slice.call(clone.querySelectorAll('hr')).forEach(function (hr) {
      hr.replaceWith(document.createTextNode('\n@@SPLIT@@\n'));
    });
    Array.prototype.slice.call(clone.querySelectorAll('br')).forEach(function (br) {
      br.replaceWith(document.createTextNode('\n'));
    });
    Array.prototype.slice.call(clone.querySelectorAll('div,p,li,tr,section,article,header,footer,h1,h2,h3,h4,h5,h6')).forEach(function (block) {
      block.appendChild(document.createTextNode('\n'));
    });
    var text = (clone.textContent || '').replace(/\u00a0/g, ' ');
    return text.split(/\r?\n/).map(function (l) { return l.replace(/[ \t\f\v]+/g, ' ').trim(); });
  }

  function splitChunkLines(lines) {
    var out = [], cur = [];
    lines.forEach(function (l) {
      if (!l) return;
      if (l.indexOf('@@SPLIT@@') >= 0) {
        if (cur.length) out.push(cur);
        cur = [];
        return;
      }
      if (isSeparator(l)) return;
      cur.push(l);
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function splitByWeekGroups(lines) {
    var weekCount = lines.filter(isWeekLine).length;
    if (weekCount <= 1) return [lines];
    for (var size = 6; size >= 2; size--) {
      if (lines.length % size !== 0) continue;
      var groups = [], ok = true;
      for (var i = 0; i < lines.length; i += size) {
        var group = lines.slice(i, i + size);
        var wc = group.filter(isWeekLine).length;
        if (wc !== 1 || group.length < 2) { ok = false; break; }
        groups.push(group);
      }
      if (ok && groups.length === weekCount) return groups;
    }
    // 尝试在连续两个“周次行”之间切分
    return [lines];
  }

  function htmlCellChunks(cell) {
    var nodes = Array.prototype.slice.call(cell.querySelectorAll('.kbcontent,.kb_content,.course-item'));
    var chunks = [];
    if (nodes.length > 1) {
      nodes.forEach(function (n) {
        var lines = cellLines(n).filter(function (l) { return l; });
        if (lines.length) chunks.push(lines);
      });
      if (chunks.length) return chunks;
    } else if (nodes.length === 1) {
      var only = cellLines(nodes[0]).filter(function (l) { return l; });
      if (only.length) chunks.push(only);
      return chunks;
    }
    var raw = cellLines(cell);
    var segs = splitChunkLines(raw);
    if (!segs.length) return [];
    var result = [];
    segs.forEach(function (seg) {
      splitByWeekGroups(seg).forEach(function (g) { if (g.length) result.push(g); });
    });
    return result;
  }

  /* ---------- 表格模型 ---------- */
  function htmlTableModel(table) {
    var trs = Array.prototype.slice.call(table.rows || []);
    var grid = [];
    trs.forEach(function (tr, r) {
      var c = 0;
      Array.prototype.slice.call(tr.cells || []).forEach(function (cell) {
        while (grid[r] && grid[r][c]) c++;
        var rs = Math.max(1, parseInt(cell.rowSpan, 10) || 1);
        var cs = Math.max(1, parseInt(cell.colSpan, 10) || 1);
        var chunks = htmlCellChunks(cell);
        var lines = [];
        chunks.forEach(function (ch) { lines = lines.concat(ch); });
        var text = normalizeText(lines.join(' '));
        var slot = { text: text, lines: lines, chunks: chunks, el: cell, r0: r, c0: c, rs: rs, cs: cs, origin: true };
        for (var rr = r; rr < Math.min(trs.length, r + rs); rr++) {
          grid[rr] = grid[rr] || [];
          for (var cc = c; cc < c + cs; cc++) {
            grid[rr][cc] = { text: text, lines: lines, chunks: chunks, el: cell, r0: r, c0: c, rs: Math.min(rs, trs.length - r), cs: cs, origin: rr === r && cc === c };
          }
        }
        c += cs;
      });
    });
    var nCols = 0;
    grid.forEach(function (row) { if (row) nCols = Math.max(nCols, row.length); });
    return { grid: grid, nRows: trs.length, nCols: nCols };
  }

  function matrixModel(rows, merges) {
    rows = (rows || []).map(function (row) {
      return (row || []).map(function (v) { return v == null ? '' : String(v).trim(); });
    });
    var nRows = rows.length;
    var nCols = 0;
    rows.forEach(function (row) { nCols = Math.max(nCols, row.length); });
    (merges || []).forEach(function (m) { nCols = Math.max(nCols, m.e.c + 1); });
    var grid = [];
    for (var r = 0; r < nRows; r++) {
      grid[r] = [];
      for (var c = 0; c < nCols; c++) {
        var val = rows[r] && rows[r][c] != null ? String(rows[r][c]).trim() : '';
        if (!val) { grid[r][c] = null; continue; }
        var lines = val.split(/\r?\n/).map(function (l) { return normalizeText(l); }).filter(Boolean);
        grid[r][c] = { text: normalizeText(val), lines: lines, chunks: [lines], r0: r, c0: c, rs: 1, cs: 1, origin: true, value: val };
      }
    }
    (merges || []).forEach(function (m) {
      if (!m || !m.s || !m.e) return;
      var anchor = null;
      for (var rr = m.s.r; rr <= m.e.r && !anchor; rr++) {
        for (var cc = m.s.c; cc <= m.e.c; cc++) {
          if (grid[rr] && grid[rr][cc]) { anchor = grid[rr][cc]; break; }
        }
      }
      if (!anchor) anchor = { text: '', lines: [], chunks: [], r0: m.s.r, c0: m.s.c, rs: 1, cs: 1, origin: true };
      anchor.r0 = m.s.r; anchor.c0 = m.s.c;
      anchor.rs = m.e.r - m.s.r + 1; anchor.cs = m.e.c - m.s.c + 1;
      for (var rr2 = m.s.r; rr2 <= m.e.r; rr2++) {
        grid[rr2] = grid[rr2] || [];
        for (var cc2 = m.s.c; cc2 <= m.e.c; cc2++) {
          grid[rr2][cc2] = { text: anchor.text, lines: anchor.lines, chunks: anchor.chunks, r0: anchor.r0, c0: anchor.c0, rs: anchor.rs, cs: anchor.cs, origin: rr2 === m.s.r && cc2 === m.s.c };
        }
      }
    });
    return { grid: grid, nRows: nRows, nCols: nCols };
  }

  function weekdayFromHeader(text) {
    var s = normalizeText(text).replace(/\s+/g, '');
    var m = s.match(/(?:星期|周|礼拜)([一二三四五六日天1-7])/);
    if (m) return DAY_MAP[m[1]] || 0;
    if (/^[一二三四五六日天]$/.test(s)) return DAY_MAP[s] || 0;
    return 0;
  }

  function findWeekdayHeader(model) {
    var best = null;
    var limit = Math.min(model.nRows, 20);
    for (var r = 0; r < limit; r++) {
      var map = {}, count = 0;
      for (var c = 0; c < model.nCols; c++) {
        var slot = model.grid[r] && model.grid[r][c];
        if (!slot || !slot.text) continue;
        var day = weekdayFromHeader(slot.text);
        if (day && map[day] == null) { map[day] = c; count++; }
      }
      if (count >= 3 && (!best || count > best.count)) best = { row: r, cols: map, count: count };
    }
    return best;
  }

  function roleOfHeader(text) {
    var s = normalizeText(text).replace(/\s+/g, '').replace(/[（(].*?[）)]/g, '');
    if (/^(课程名称|课程名|课程|科目|教学班名称|教学班)/.test(s)) return 'name';
    if (/^(开始节次|起始节次|开始节|起始节)/.test(s)) return 'startPeriod';
    if (/^(结束节次|终止节次|结束节|终止节)/.test(s)) return 'endPeriod';
    if (/^(上课周次|周次|起止周|周数|weeks)/i.test(s)) return 'weeks';
    if (/^(星期几|上课星期|星期|周几|上课日|day|weekday)/i.test(s)) return 'day';
    if (/^(授课教师|任课教师|教师|老师|teacher)/i.test(s)) return 'teacher';
    if (/^(上课地点|地点|教室|场地|location|room)/i.test(s)) return 'location';
    if (/^(上课时间|节次|上课节次|时间|课时段|period)/i.test(s)) return 'period';
    if (/^(备注|说明|note|remark)/i.test(s)) return 'note';
    return null;
  }

  function findListHeader(model) {
    var best = null;
    var limit = Math.min(model.nRows, 8);
    for (var r = 0; r < limit; r++) {
      var roles = {}, valid = 0;
      for (var c = 0; c < model.nCols; c++) {
        var slot = model.grid[r] && model.grid[r][c];
        if (!slot || !slot.text) continue;
        var role = roleOfHeader(slot.text);
        if (role && roles[role] == null) { roles[role] = c; valid++; }
      }
      if (roles.name != null && roles.day != null && (roles.period != null || roles.startPeriod != null || roles.weeks != null)) {
        if (!best || valid > best.valid) best = { row: r, roles: roles, valid: valid };
      }
    }
    return best;
  }

  function rowPeriodTexts(model, r, minDayCol) {
    var seen = {}, parts = [];
    for (var c = 0; c < minDayCol; c++) {
      var slot = model.grid[r] && model.grid[r][c];
      if (!slot) continue;
      var key = slot.r0 + ':' + slot.c0;
      if (seen[key]) continue;
      seen[key] = 1;
      if (slot.text) parts.push(slot.text);
    }
    return parts.join(' ');
  }

  function hasCellContent(model, r, dayCols) {
    for (var d = 1; d <= 7; d++) {
      var col = dayCols[d];
      if (col == null) continue;
      var slot = model.grid[r] && model.grid[r][col];
      if (slot && slot.origin && slot.text && !isNoiseCell(slot.text)) return true;
    }
    return false;
  }

  function isNoiseCell(text) {
    var s = normalizeText(text);
    if (!s) return true;
    if (/^(无课|暂无|未安排|未排课|休息|空|无|--|—)$/.test(s)) return true;
    if (/^\d{1,2}[\/.\-]\d{1,2}(日|号)?/.test(s) && s.length <= 12) return true;
    if (/^\d{1,2}月\d{1,2}日/.test(s) && s.length <= 12) return true;
    if (/^(上午|下午|中午|晚上|早晨)$/.test(s)) return true;
    if (/^第?\s*\d{1,2}\s*[-–]?\s*\d{0,2}\s*节$/.test(s)) return true;
    if (/^\d{1,2}[:：]\d{2}(\s*[-–~]\s*\d{1,2}[:：]\d{2})?$/.test(s)) return true;
    return false;
  }

  function chunksForSlot(slot) {
    var out = [];
    (slot.chunks && slot.chunks.length ? slot.chunks : [slot.lines || []]).forEach(function (ch) {
      var segs = splitChunkLines(ch);
      if (!segs.length) return;
      segs.forEach(function (seg) {
        splitByWeekGroups(seg).forEach(function (g) { if (g.length) out.push(g); });
      });
    });
    return out;
  }

  function extractGrid(model, header, opts, warnings) {
    var courses = [];
    var dayCols = header.cols;
    var dayList = Object.keys(dayCols).map(Number);
    var minDayCol = Math.min.apply(null, dayList.map(function (d) { return dayCols[d]; }));
    var periods = {};
    var explicitCount = 0, firstContentRow = -1;
    var hasContent = {};

    for (var r = header.row + 1; r < model.nRows; r++) {
      hasContent[r] = hasCellContent(model, r, dayCols);
      if (hasContent[r] && firstContentRow < 0) firstContentRow = r;
      var timeText = rowPeriodTexts(model, r, minDayCol);
      var pr = parsePeriodText(timeText) || clockRange(timeText, opts.periods);
      if (pr && pr.start >= 1) { periods[r] = pr; explicitCount++; }
    }

    if (explicitCount === 0) {
      var startRow = firstContentRow >= 0 ? firstContentRow : header.row + 1;
      for (var rr = startRow; rr < model.nRows; rr++) {
        var seq = rr - startRow + 1;
        periods[rr] = { start: seq, end: seq };
      }
      warnings.push('未识别到节次信息，已按表格行序编号，导入后请核对每节课的节次。');
    } else {
      var prevEnd = 0;
      for (var r2 = header.row + 1; r2 < model.nRows; r2++) {
        if (periods[r2]) { prevEnd = periods[r2].end; continue; }
        if (r2 >= firstContentRow) {
          periods[r2] = { start: prevEnd + 1, end: prevEnd + 1 };
          prevEnd += 1;
        }
      }
    }

    dayList.forEach(function (day) {
      var col = dayCols[day];
      for (var row = header.row + 1; row < model.nRows; row++) {
        var slot = model.grid[row] && model.grid[row][col];
        if (!slot || !slot.origin) continue;
        if (isNoiseCell(slot.text)) continue;
        var lastRow = Math.min(row + slot.rs - 1, model.nRows - 1);
        var start = periods[row] ? periods[row].start : null;
        if (!start) {
          for (var fr = row; fr <= lastRow; fr++) if (periods[fr]) { start = periods[fr].start; break; }
        }
        var end = null;
        for (var lr = lastRow; lr >= row; lr--) if (periods[lr]) { end = periods[lr].end; break; }
        if (!start) continue;
        if (!end) end = start + Math.max(0, slot.rs - 1);
        if (end < start) end = start;

        var chunks = chunksForSlot(slot);
        chunks.forEach(function (chunk) {
          var parsed = parseCourseChunk(chunk, opts);
          if (!parsed) return;
          var s2 = start, e2 = end;
          if (explicitCount === 0 && parsed.periodHint) {
            s2 = parsed.periodHint.start;
            e2 = parsed.periodHint.end;
          }
          if (s2 < 1) s2 = 1;
          if (e2 < s2) e2 = s2;
          parsed.day = day;
          parsed.startPeriod = Math.min(s2, 20);
          parsed.endPeriod = Math.min(e2, 20);
          courses.push(parsed);
        });
      }
    });
    return courses;
  }

  function cellTextAt(model, r, c) {
    var slot = model.grid[r] && model.grid[r][c];
    return slot ? slot.text : '';
  }

  function slotAt(model, r, c) {
    return model.grid[r] && model.grid[r][c] ? model.grid[r][c] : null;
  }

  function extractList(model, header, opts, warnings) {
    var courses = [];
    var roles = header.roles;
    for (var r = header.row + 1; r < model.nRows; r++) {
      var nameSlot = roles.name != null ? slotAt(model, r, roles.name) : null;
      if (!nameSlot || !nameSlot.text) continue;
      if (isNoiseCell(nameSlot.text)) continue;

      var base = parseCourseChunk(nameSlot.lines || [nameSlot.text], opts) || {
        name: cleanName(nameSlot.text), teacher: '', location: '', weeks: [], note: '', missing: []
      };
      var name = base.name;
      if (!name) continue;

      var dayText = roles.day != null ? cellTextAt(model, r, roles.day) : '';
      var day = parseDayText(dayText);
      if (!day) {
        warnings.push('有一行「' + U.foldText(name, 18) + '」无法识别星期，已跳过。');
        continue;
      }

      var teacher = (roles.teacher != null ? cellTextAt(model, r, roles.teacher) : '') || base.teacher;
      var location = (roles.location != null ? cellTextAt(model, r, roles.location) : '') || base.location;
      var note = (roles.note != null ? cellTextAt(model, r, roles.note) : '') || base.note;

      var weeks = [];
      var weeksText = roles.weeks != null ? cellTextAt(model, r, roles.weeks) : '';
      if (weeksText) weeks = U.parseWeeks(weeksText, opts.totalWeeks);
      if (!weeks.length) weeks = base.weeks.slice();
      if (!weeks.length) {
        // 扫描整行的其它文本，尝试找周次
        for (var c = 0; c < model.nCols; c++) {
          var t = cellTextAt(model, r, c);
          if (isWeekLine(t)) { weeks = U.parseWeeks(t, opts.totalWeeks); if (weeks.length) break; }
        }
      }
      if (!weeks.length) {
        for (var w = 1; w <= opts.totalWeeks; w++) weeks.push(w);
        warnings.push('「' + U.foldText(name, 18) + '」没有周次信息，已默认贯穿整学期，请核对。');
      }

      var range = null;
      if (roles.startPeriod != null || roles.endPeriod != null) {
        var sp = parseInt(cellTextAt(model, r, roles.startPeriod), 10);
        var ep = parseInt(cellTextAt(model, r, roles.endPeriod), 10);
        if (sp) range = { start: sp, end: ep && ep >= sp ? ep : sp };
      }
      if (!range && roles.period != null) {
        var ptxt = cellTextAt(model, r, roles.period);
        range = parsePeriodText(ptxt) || clockRange(ptxt, opts.periods);
      }
      if (!range && base.periodHint) range = base.periodHint;
      if (!range) {
        range = { start: 1, end: 2 };
        warnings.push('「' + U.foldText(name, 18) + '」没有节次信息，已默认第 1-2 节，请核对。');
      }

      courses.push({
        name: name,
        teacher: teacher || '',
        location: location || '',
        day: day,
        startPeriod: Math.min(Math.max(1, range.start), 20),
        endPeriod: Math.min(Math.max(range.start, range.end), 20),
        weeks: weeks,
        note: note || '',
        missing: (!teacher ? ['teacher'] : []).concat(!location ? ['location'] : [])
      });
    }
    return courses;
  }

  /* ---------- 结果清洗 ---------- */
  function mergeAdjacent(courses) {
    var groups = {};
    courses.forEach(function (c) {
      var key = [c.day, c.name, c.teacher, c.location, c.weeks.join(',')].join('|');
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    var out = [];
    Object.keys(groups).forEach(function (key) {
      var arr = groups[key].sort(function (a, b) { return a.startPeriod - b.startPeriod || a.endPeriod - b.endPeriod; });
      var current = null;
      arr.forEach(function (c) {
        if (current && c.startPeriod <= current.endPeriod + 1) {
          current.endPeriod = Math.max(current.endPeriod, c.endPeriod);
          if (current.missing && c.missing) {
            current.missing = current.missing.filter(function (m) { return c.missing.indexOf(m) < 0; });
          }
        } else {
          current = Object.assign({}, c);
          out.push(current);
        }
      });
    });
    out.sort(function (a, b) { return a.day - b.day || a.startPeriod - b.startPeriod || a.name.localeCompare(b.name, 'zh'); });
    // 去掉完全重复项
    var seen = {}, final = [];
    out.forEach(function (c) {
      var key = [c.name, c.teacher, c.location, c.day, c.startPeriod, c.endPeriod, c.weeks.join(',')].join('|');
      if (seen[key]) return;
      seen[key] = 1;
      final.push(c);
    });
    return final;
  }

  function summarize(courses, warnings) {
    var noLocation = courses.filter(function (c) { return !c.location; }).length;
    var noTeacher = courses.filter(function (c) { return !c.teacher; }).length;
    if (noLocation) warnings.push('有 ' + noLocation + ' 门课程未识别到上课地点，导入后可在课程详情里补充。');
    if (noTeacher) warnings.push('有 ' + noTeacher + ' 门课程未识别到授课教师。');
    var unique = [], seen = {};
    warnings.forEach(function (w) { if (!seen[w]) { seen[w] = 1; unique.push(w); } });
    return unique.slice(0, 12);
  }

  function finish(courses, warnings, opts, meta) {
    var cleaned = mergeAdjacent(courses.filter(function (c) {
      return c && c.name && c.day >= 1 && c.day <= 7 && c.startPeriod >= 1 && c.weeks && c.weeks.length;
    }));
    if (!cleaned.length) {
      throw parseError('没有识别到课程。', '请确认复制/上传的是教务系统的课表页面，并且表格中的课程单元格包含课程名称与周次。');
    }
    var maxWeek = 0;
    cleaned.forEach(function (c) { c.weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; }); });
    return {
      courses: cleaned,
      warnings: summarize(cleaned, warnings || []),
      meta: Object.assign({ totalWeeks: Math.max(opts.totalWeeks, Math.min(30, maxWeek)) }, meta || {})
    };
  }

  /* ---------- HTML ---------- */
  function parseHtmlTables(html, opts) {
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    var tables = Array.prototype.slice.call(doc.querySelectorAll('table'));
    if (!tables.length) {
      throw parseError('内容里没有找到表格。', '请直接在课表页面按 Ctrl+A、Ctrl+C 复制，或把课表页面另存为网页后上传。');
    }
    var gridResults = [], listResults = [], warnings = [];
    tables.forEach(function (table) {
      var cells = table.querySelectorAll('td,th').length;
      if (!cells || !normalizeText(table.textContent)) return;
      var model = htmlTableModel(table);
      var header = findWeekdayHeader(model);
      if (header) {
        try {
          var res = extractGrid(model, header, opts, warnings);
          if (res.length) gridResults.push(res);
          return;
        } catch (e) { /* 继续尝试列表模式 */ }
      }
      var listHeader = findListHeader(model);
      if (listHeader) {
        try {
          var lres = extractList(model, listHeader, opts, warnings);
          if (lres.length) listResults.push(lres);
        } catch (e2) {}
      }
    });
    var picked = gridResults.length ? gridResults : listResults;
    if (!picked.length) {
      throw parseError('找到了表格，但没认出课程内容。', '表格可能不是教务系统课表，或使用了特殊排版。可以尝试改用「上传文件」导入导出的 CSV/Excel。');
    }
    var courses = [];
    picked.forEach(function (arr) { courses = courses.concat(arr); });
    return finish(courses, warnings, opts, {
      mode: gridResults.length ? 'grid' : 'list',
      tableCount: tables.length,
      title: doc.title || ''
    });
  }

  /* ---------- 文本表格 / CSV ---------- */
  function splitDelimited(text, delim) {
    var rows = [], row = [], field = '', inQuotes = false;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"' && field === '') inQuotes = true;
        else if (ch === delim) { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch === '\r') { if (text[i + 1] === '\n') continue; row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
      }
    }
    row.push(field);
    rows.push(row);
    while (rows.length && rows[rows.length - 1].every(function (v) { return !String(v).trim(); })) rows.pop();
    return rows;
  }

  function detectDelimiter(text) {
    var sample = String(text || '').split(/\r?\n/).slice(0, 12).join('\n');
    var cands = [',', '\t', ';', '|'];
    var best = ',', bestCount = -1;
    cands.forEach(function (d) {
      var count = sample.split(d).length;
      if (count > bestCount) { bestCount = count; best = d; }
    });
    return best;
  }

  function parseMatrix(rows, merges, opts) {
    opts = optsWith(opts);
    var model = matrixModel(rows, merges);
    var warnings = [];
    var header = findWeekdayHeader(model);
    var listHeader = null;
    var result;
    if (header) {
      result = extractGrid(model, header, opts, warnings);
      if (!result.length && (listHeader = findListHeader(model))) {
        result = extractList(model, listHeader, opts, warnings);
      }
    } else if ((listHeader = findListHeader(model))) {
      result = extractList(model, listHeader, opts, warnings);
    } else {
      throw parseError('没有识别到课程表表头。', '表头需要包含「课程名称」「星期」「节次/周次」等列，或包含星期一到星期日的课表网格。');
    }
    return finish(result, warnings, opts, { mode: header ? 'grid' : 'list', tableCount: 1, title: '' });
  }

  function parseCsv(text, opts) {
    var delim = detectDelimiter(text);
    var rows = splitDelimited(text, delim);
    if (!rows.length) throw parseError('文件是空的。');
    var maxCols = 0;
    rows.forEach(function (r) { maxCols = Math.max(maxCols, r.length); });
    if (maxCols < 2) {
      throw parseError('没有识别到分列数据。', '如果是从网页复制的纯文本，建议直接粘贴网页内容；或者把文件另存为 CSV/Excel。');
    }
    var res = parseMatrix(rows, null, opts);
    res.meta.source = 'table';
    return res;
  }

  /* ---------- XLSX ---------- */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function findEocd(bytes) {
    var start = Math.max(0, bytes.length - 65557);
    for (var i = bytes.length - 22; i >= start; i--) {
      if (u32(bytes, i) === 0x06054b50) return i;
    }
    return -1;
  }

  function zipEntries(bytes) {
    var eocd = findEocd(bytes);
    if (eocd < 0) throw new Error('不是有效的 xlsx 文件');
    var count = u16(bytes, eocd + 10);
    var offset = u32(bytes, eocd + 16);
    var entries = [];
    var pos = offset;
    for (var i = 0; i < count; i++) {
      if (u32(bytes, pos) !== 0x02014b50) break;
      var method = u16(bytes, pos + 10);
      var compSize = u32(bytes, pos + 20);
      var uncompSize = u32(bytes, pos + 24);
      var nameLen = u16(bytes, pos + 28);
      var extraLen = u16(bytes, pos + 30);
      var commentLen = u16(bytes, pos + 32);
      var localOff = u32(bytes, pos + 42);
      var name = new TextDecoder('utf-8').decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      entries.push({ name: name, method: method, compSize: compSize, uncompSize: uncompSize, localOff: localOff });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压 xlsx，请把文件另存为 CSV 后导入。');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntry(bytes, entry) {
    if (!entry) return '';
    var nameLen = u16(bytes, entry.localOff + 26);
    var extraLen = u16(bytes, entry.localOff + 28);
    var dataStart = entry.localOff + 30 + nameLen + extraLen;
    var raw = bytes.subarray(dataStart, dataStart + entry.compSize);
    var data;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8) data = await inflateRaw(raw);
    else throw new Error('xlsx 使用了不支持的压缩方式');
    return new TextDecoder('utf-8').decode(data);
  }

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('xlsx 内部 XML 解析失败');
    return doc;
  }

  function xmlChildren(el, tag) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 1 && n.nodeName === tag) out.push(n);
    }
    return out;
  }

  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function refToPos(ref) {
    var m = String(ref || '').match(/([A-Z]+)(\d+)/i);
    if (!m) return null;
    return { c: colIndex(m[1].toUpperCase()), r: parseInt(m[2], 10) - 1 };
  }

  function resolveZipPath(target) {
    var t = String(target || '').replace(/\\/g, '/');
    if (t.charAt(0) === '/') return t.slice(1);
    var parts = ('xl/' + t).split('/');
    var out = [];
    parts.forEach(function (p) {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    });
    return out.join('/');
  }

  async function readXlsx(buffer, opts) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var entries = zipEntries(bytes);
    var byName = {};
    entries.forEach(function (e) { if (!byName[e.name]) byName[e.name] = e; });

    async function get(name) {
      if (!byName[name]) return null;
      return await readEntry(bytes, byName[name]);
    }

    var wbText = await get('xl/workbook.xml');
    if (!wbText) throw new Error('xlsx 中缺少 workbook.xml');
    var wbDoc = parseXml(wbText);
    var sheets = wbDoc.getElementsByTagName('sheet');
    var sheetName = sheets.length ? (sheets[0].getAttribute('name') || '') : '';
    var relId = '';
    if (sheets.length) {
      relId = sheets[0].getAttribute('r:id') || sheets[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || '';
    }
    var sheetPath = '';
    if (relId) {
      var relText = await get('xl/_rels/workbook.xml.rels');
      if (relText) {
        var relDoc = parseXml(relText);
        var rels = relDoc.getElementsByTagName('Relationship');
        for (var i = 0; i < rels.length; i++) {
          if (rels[i].getAttribute('Id') === relId) { sheetPath = resolveZipPath(rels[i].getAttribute('Target')); break; }
        }
      }
    }
    if (!sheetPath || !byName[sheetPath]) {
      var worksheets = entries.filter(function (e) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (!worksheets.length) throw new Error('xlsx 中找不到工作表');
      sheetPath = worksheets[0].name;
    }
    var sheetText = await get(sheetPath);
    if (!sheetText) throw new Error('xlsx 工作表读取失败');

    var shared = [];
    var ssText = await get('xl/sharedStrings.xml');
    if (ssText) {
      var ssDoc = parseXml(ssText);
      var sis = ssDoc.getElementsByTagName('si');
      for (var s = 0; s < sis.length; s++) {
        var ts = sis[s].getElementsByTagName('t');
        var str = '';
        for (var t = 0; t < ts.length; t++) {
          var p = ts[t].parentNode;
          var skip = false;
          while (p && p !== sis[s]) { if (p.nodeName === 'rPh') { skip = true; break; } p = p.parentNode; }
          if (!skip) str += ts[t].textContent;
        }
        shared.push(str);
      }
    }

    var sheetDoc = parseXml(sheetText);
    var rowEls = sheetDoc.getElementsByTagName('row');
    var rows = [];
    for (var ri = 0; ri < rowEls.length; ri++) {
      var rowEl = rowEls[ri];
      var rIdx = parseInt(rowEl.getAttribute('r'), 10) - 1;
      if (isNaN(rIdx) || rIdx < 0) rIdx = rows.length;
      var arr = rows[rIdx] = rows[rIdx] || [];
      var cellEls = rowEl.getElementsByTagName('c');
      var autoCol = 0;
      for (var ci = 0; ci < cellEls.length; ci++) {
        var c = cellEls[ci];
        var ref = c.getAttribute('r');
        var pos = ref ? refToPos(ref) : null;
        var col = pos ? pos.c : autoCol;
        autoCol = col + 1;
        var type = c.getAttribute('t') || '';
        var value = '';
        if (type === 'inlineStr') {
          var tNodes = c.getElementsByTagName('t');
          for (var tn = 0; tn < tNodes.length; tn++) value += tNodes[tn].textContent;
        } else {
          var v = null;
          var kids = xmlChildren(c, 'v');
          if (kids.length) v = kids[0].textContent;
          if (v != null && v !== '') {
            if (type === 's') value = shared[parseInt(v, 10)] || '';
            else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
            else if (type === 'e') value = '';
            else value = v;
          }
        }
        if (value !== '') arr[col] = String(value);
      }
    }

    var merges = [];
    var mergeEls = sheetDoc.getElementsByTagName('mergeCell');
    for (var mi = 0; mi < mergeEls.length; mi++) {
      var ref = mergeEls[mi].getAttribute('ref') || '';
      var pair = ref.split(':');
      if (pair.length !== 2) continue;
      var a = refToPos(pair[0]), b = refToPos(pair[1]);
      if (a && b) merges.push({ s: a, e: b });
    }
    return { rows: rows, merges: merges, sheetName: sheetName };
  }

  async function parseXlsx(buffer, opts) {
    opts = optsWith(opts);
    var data;
    try {
      data = await readXlsx(buffer, opts);
    } catch (e) {
      throw parseError('读取 Excel 失败：' + (e.message || '未知错误'), '如果文件来自旧版 .xls 或加密文件，请用 Excel/WPS 打开后另存为 .xlsx 或 CSV 再导入。');
    }
    var res = parseMatrix(data.rows, data.merges, opts);
    res.meta.source = 'xlsx';
    res.meta.sheetName = data.sheetName;
    return res;
  }

  function decodeBuffer(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(bytes).replace(/^\uFEFF/, '');
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(bytes).replace(/^\uFEFF/, '');
    }
    var utf8 = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    if (utf8.indexOf('\uFFFD') >= 0) {
      try { return new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, ''); } catch (e) {}
    }
    return utf8;
  }

  function isOle(buffer) {
    var b = new Uint8Array(buffer);
    return b.length > 8 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;
  }

  function isZip(buffer) {
    var b = new Uint8Array(buffer);
    return b.length > 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
  }

  async function parseFile(file, opts) {
    opts = optsWith(opts);
    var name = (file.name || '').toLowerCase();
    var buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (e) {
      throw parseError('读取文件失败。', e.message || '');
    }
    if (/\.xlsx$/.test(name) || (isZip(buffer) && !/\.(docx|zip)$/.test(name))) {
      return await parseXlsx(buffer, opts);
    }
    if (/\.xls$/.test(name) || isOle(buffer)) {
      if (isOle(buffer)) {
        throw parseError('这是旧版 .xls 二进制文件，暂时无法直接读取。', '请用 Excel/WPS 打开，另存为 .xlsx 或 CSV 后再导入；如果教务系统导出的 .xls 其实是网页，请把扩展名改为 .html 再试。');
      }
    }
    if (/\.ics$/.test(name)) {
      throw parseError('暂不支持 .ics 日历文件导入。', '可以把课程表导出为 CSV 或 Excel 后再导入。');
    }
    var text = decodeBuffer(buffer);
    if (!text.trim()) throw parseError('文件是空的。');
    var res = parseInput(text, opts);
    res.meta.source = res.meta.source || 'file';
    res.meta.fileName = file.name || '';
    return res;
  }

  /* ---------- 统一入口 ---------- */
  function parseInput(input, opts) {
    opts = optsWith(opts);
    var text = String(input == null ? '' : input).trim();
    if (!text) throw parseError('还没有内容。', '请粘贴课表页面、选择文件，或使用导入书签。');

    if (text.charAt(0) === '{' || text.charAt(0) === '[') {
      var data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (data) {
        if (data.type === 'timetable-capture' && Array.isArray(data.tables)) {
          var res = parseHtmlTables(data.tables.join('\n'), opts);
          res.meta.title = data.title || res.meta.title;
          res.meta.capturedFrom = data.url || '';
          return res;
        }
        if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
          return parseMatrix(data, null, opts);
        }
        if (data.rows && Array.isArray(data.rows)) {
          return parseMatrix(data.rows, data.merges || null, opts);
        }
        if (data.schedules) {
          throw parseError('这是「课序」的完整备份文件。', '请到「设置 → 通用 → 数据与备份」中恢复备份，而不是在这里导入课表。');
        }
        throw parseError('无法识别这段 JSON 数据。', '它既不是课表抓取数据，也不是表格数据。');
      }
    }

    if (/<table|<html|<!doctype|<body/i.test(text)) {
      return parseHtmlTables(text, opts);
    }

    return parseCsv(text, opts);
  }

  /* ---------- 书签工具 ---------- */
  P.bookmarklet = function () {
    var fn = function () {
      try {
        var tables = Array.prototype.slice.call(document.querySelectorAll('table')).filter(function (t) {
          var s = t.innerText || t.textContent || '';
          return /(星期|周|礼拜)[一二三四五六日天]/.test(s) && /节/.test(s);
        }).map(function (t) { return t.outerHTML; });
        if (!tables.length) {
          alert('没有找到课程表。请先打开教务系统的课表页面，等表格加载完成后再点这个书签。');
          return;
        }
        var payload = JSON.stringify({
          app: 'classflow',
          type: 'timetable-capture',
          title: document.title,
          url: location.href,
          capturedAt: new Date().toISOString(),
          tables: tables
        });
        function fallback() {
          var w = window.open('', '_blank');
          if (!w) {
            window.prompt('复制下面的课表数据，粘贴到课序的导入框：', payload);
            return;
          }
          w.document.write('<meta charset="utf-8"><title>课序 · 课表数据</title><body style="font:14px/1.6 sans-serif;padding:24px;color:#222"><p>按 Ctrl+A 全选，再按 Ctrl+C 复制，然后回到「课序」粘贴导入。</p><textarea readonly style="width:100%;height:70vh;font:12px/1.5 monospace;padding:12px;box-sizing:border-box"></textarea></body>');
          var ta = w.document.querySelector('textarea');
          ta.value = payload;
          ta.focus();
          ta.select();
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(payload).then(function () {
            alert('已复制课表数据。回到「课序」的导入窗口粘贴即可。');
          }, fallback);
        } else {
          fallback();
        }
      } catch (e) {
        alert('抓取失败：' + e.message);
      }
    };
    return 'javascript:(' + fn.toString().replace(/\s+/g, ' ') + ')()';
  };

  P.csvTemplate = function () {
    return '\uFEFF课程名称,教师,地点,星期,节次,周次,备注\n高等数学,陈立群,教三-201,周一,1-2节,1-16周,\n大学英语,王雪,文科楼B203,周一,3-4节,1-16周,含听力\n程序设计实践,赵明,机房305,周五,5-6节,2-16周(双),';
  };

  P.parseInput = parseInput;
  P.parseHtml = function (html, opts) { return parseHtmlTables(html, optsWith(opts)); };
  P.parseMatrix = parseMatrix;
  P.parseCsv = parseCsv;
  P.parseXlsx = parseXlsx;
  P.parseFile = parseFile;
  P.decodeBuffer = decodeBuffer;
  P.parseDayText = parseDayText;
  P.parsePeriodText = parsePeriodText;
  P.clockRange = clockRange;
})();
