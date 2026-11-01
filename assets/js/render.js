/* 课序 ClassFlow — 视图渲染（纯字符串，无副作用） */
(function () {
  'use strict';
  var CF = window.CF = window.CF || {};
  var U = CF.Util;
  var D = CF.Data;
  var R = CF.Render = {};

  var DAY_NAMES = U.WEEKDAY_FULL;

  function esc(v) { return U.esc(v == null ? '' : v); }
  function round(n) { return Math.round(n || 0); }
  function clock(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    return U.pad2(Math.floor(mins / 60)) + ':' + U.pad2(mins % 60);
  }
  function dateRangeOf(view) {
    var start = U.parseDate(view.schedule.startDate) || U.today();
    return {
      start: U.dateOfWeek(start, view.week, 1),
      end: U.dateOfWeek(start, view.week, 7)
    };
  }
  function scheduleAccent(schedule) {
    var courses = schedule.courses || [];
    for (var i = 0; i < courses.length; i++) {
      if (courses[i].color) return D.paletteById(courses[i].color).light;
    }
    return D.paletteById('slate').light;
  }
  R.accentOf = scheduleAccent;

  function countDays(view) {
    var days = view.schedule.days || 7;
    (view.entries || []).forEach(function (e) { days = Math.max(days, e.course.day || 0); });
    (view.overlaySchedules || []).forEach(function (s) { days = Math.max(days, s.days || 0); });
    return U.clamp(days, 1, 7);
  }

  function countPeriods(view) {
    var n = (view.schedule.periods || []).length || 12;
    (view.entries || []).forEach(function (e) {
      if (e.course.endPeriod) n = Math.max(n, e.course.endPeriod);
    });
    return Math.max(1, n);
  }

  function rangeOf(entry, base) {
    var ps = (base && base.periods) || (entry.schedule && entry.schedule.periods) || [];
    var a = ps[entry.course.startPeriod - 1];
    var b = ps[entry.course.endPeriod - 1];
    return { start: a ? a.start : '', end: b ? b.end : '' };
  }

  function progressOf(entry, now) {
    return D.courseProgress(entry.course, entry.schedule, now);
  }

  function isNowPeriod(period, now) {
    var a = U.minutesOf(period.start), b = U.minutesOf(period.end);
    if (a == null || b == null) return false;
    var m = now.getHours() * 60 + now.getMinutes();
    return m >= a && m < b;
  }

  function ongoingEntry(entry, base, now) {
    var d = U.startOfDay(now);
    var start = U.parseDate(entry.schedule.startDate);
    var week = U.weekOf(d, start);
    if (!U.weeksContain(entry.course.weeks, week)) return false;
    if (entry.course.day !== ((d.getDay() + 6) % 7) + 1) return false;
    var ps = (base && base.periods) || entry.schedule.periods || [];
    var a = ps[entry.course.startPeriod - 1], b = ps[entry.course.endPeriod - 1];
    if (!a || !b) return false;
    var st = U.minutesOf(a.start), en = U.minutesOf(b.end);
    if (st == null || en == null) return false;
    var m = now.getHours() * 60 + now.getMinutes();
    return m >= st && m < en;
  }

  function courseButtonAttrs(entry) {
    return ' data-action="open-course" data-id="' + esc(entry.course.id) +
      '" data-schedule="' + esc(entry.schedule.id) + '"';
  }

  function detailTitle(entry, view) {
    var c = entry.course;
    var lines = [c.name];
    if (c.teacher) lines.push('教师：' + c.teacher);
    if (c.location) lines.push('地点：' + c.location);
    var r = rangeOf(entry, view.schedule);
    if (r.start && r.end) lines.push('时间：' + r.start + '–' + r.end);
    if (c.weeks && c.weeks.length) lines.push('周次：' + U.formatWeeks(c.weeks));
    var p = progressOf(entry, view.now);
    if (p.total) lines.push('进度：' + p.pct + '%');
    if (view.isOverlay) lines.push('课程表：' + entry.schedule.name);
    return lines.join('\n');
  }

  function metaText(entry) {
    var c = entry.course;
    var bits = [];
    if (c.teacher) bits.push(c.teacher);
    if (c.location) bits.push(c.location);
    return bits.join(' · ');
  }

  function progressBar(pct) {
    pct = U.clamp(round(pct), 0, 100);
    return '<span class="cc-progress" title="课程进度 ' + pct + '%"><span style="width:' + pct + '%"></span></span>';
  }

  /* ---------- 任务辅助 ---------- */
  function taskType(t) { return D.taskTypeInfo(t && t.type); }
  function taskPalette(t) { return D.paletteById(taskType(t).color); }
  function taskDate(t) { return U.parseDate(t && t.date) || U.today(); }
  function taskRemindText(t) {
    if (!t || t.remind == null) return '';
    if (!t.start && t.remind === 0) return '09:00';
    for (var i = 0; i < D.REMIND_OPTIONS.length; i++) {
      if (D.REMIND_OPTIONS[i].value === t.remind) return D.REMIND_OPTIONS[i].name;
    }
    return '';
  }
  function taskMetaBits(t) {
    var bits = [];
    if (t.start) bits.push(t.start + (t.end && t.end !== t.start ? '–' + t.end : ''));
    else bits.push('全天');
    if (t.location) bits.push(t.location);
    if (t.remind != null) bits.push(taskRemindText(t));
    return bits;
  }
  function taskDateLabel(date, now) {
    var d = U.startOfDay(date);
    var today = U.startOfDay(now);
    var rel = U.relativeDay(d, today);
    if (rel === '今天' || rel === '明天' || rel === '后天' || rel === '昨天') return rel;
    return U.fmtMD(d) + ' ' + U.fmtWeekday(d);
  }
  function taskItem(t, view) {
    var type = taskType(t), p = taskPalette(t), done = !!t.done;
    var bits = taskMetaBits(t);
    var pr = t.priority ? D.PRIORITIES[t.priority] : null;
    var dateText = taskDateLabel(taskDate(t), view.now);
    return '<article class="task-item type-' + esc(type.id) + (done ? ' is-done' : '') + (t.priority ? ' priority-' + t.priority : '') + '"' +
      ' style="--tc:' + p.light + '" data-task-id="' + esc(t.id) + '">' +
      '<button type="button" class="task-check" data-action="toggle-task" data-id="' + esc(t.id) + '"' +
        ' aria-label="' + (done ? '标记为未完成' : '标记为完成') + '" aria-pressed="' + (done ? 'true' : 'false') + '">' +
        (done ? U.icon('check') : '') +
      '</button>' +
      '<div class="task-item-main" data-action="open-task" data-id="' + esc(t.id) + '" role="button" tabindex="0">' +
        '<div class="task-title-row">' +
          '<span class="task-type-pill">' + esc(type.name) + '</span>' +
          '<strong class="task-title">' + esc(t.title) + '</strong>' +
          (pr ? '<span class="task-priority priority-' + t.priority + '">' + esc(pr.name) + '</span>' : '') +
        '</div>' +
        '<div class="task-meta">' +
          '<span class="task-date-chip">' + esc(dateText) + '</span>' +
          bits.map(function (b, i) { return '<span' + (i === 0 ? ' class="task-time-chip"' : '') + '>' + esc(b) + '</span>'; }).join('') +
        '</div>' +
        (t.note ? '<p class="task-note">' + esc(t.note) + '</p>' : '') +
      '</div>' +
      '<div class="task-item-actions">' +
        '<button type="button" class="icon-btn task-icon-btn" data-action="open-task" data-id="' + esc(t.id) + '" aria-label="编辑任务">' + U.icon('edit') + '</button>' +
        '<button type="button" class="icon-btn task-icon-btn task-del" data-action="delete-task" data-id="' + esc(t.id) + '" aria-label="删除任务">' + U.icon('trash') + '</button>' +
      '</div>' +
      '</article>';
  }
  function taskEmpty(title, text, action) {
    return '<div class="task-empty">' +
      '<span class="task-empty-mark">' + U.icon('check-square') + '</span>' +
      '<strong>' + esc(title) + '</strong>' +
      '<p>' + esc(text) + '</p>' +
      (action ? '<button type="button" class="btn btn-primary btn-sm" data-action="new-task">' + U.icon('plus') + '新建任务</button>' : '') +
      '</div>';
  }
  function taskGroup(label, items, view, tone) {
    if (!items.length) return '';
    return '<section class="task-group' + (tone ? ' tone-' + tone : '') + '">' +
      '<header class="task-group-head"><h3>' + esc(label) + '</h3><span>' + items.length + ' 项</span></header>' +
      '<div class="task-list">' + items.map(function (t) { return taskItem(t, view); }).join('') + '</div>' +
      '</section>';
  }
  function viewToggle(view) {
    var counts = view.taskCounts || { open: 0 };
    return '<div class="view-toggle" role="group" aria-label="切换视图">' +
      '<button type="button" data-action="set-view" data-view="week" class="' + (view.mode === 'week' ? 'is-active' : '') + '">' +
        U.icon('grid') + '<span>周视图</span></button>' +
      '<button type="button" data-action="set-view" data-view="list" class="' + (view.mode === 'list' ? 'is-active' : '') + '">' +
        U.icon('list') + '<span>列表</span></button>' +
      '<button type="button" data-action="set-view" data-view="tasks" class="' + (view.mode === 'tasks' ? 'is-active' : '') + '">' +
        U.icon('check-square') + '<span>任务</span>' +
        (counts.open ? '<b class="vt-count">' + counts.open + '</b>' : '') +
      '</button>' +
    '</div>';
  }

  /* ---------- 顶部课程表标签 ---------- */
  R.tabs = function (state) {
    var out = [];
    state.schedules.forEach(function (s) {
      var active = s.id === state.activeId;
      var accent = scheduleAccent(s);
      out.push(
        '<button type="button" class="sched-tab' + (active ? ' is-active' : '') + '"' +
        ' role="tab" aria-selected="' + (active ? 'true' : 'false') + '"' +
        ' data-action="switch-schedule" data-id="' + esc(s.id) + '"' +
        ' title="' + esc(s.name) + '">' +
          '<span class="sched-tab-dot" style="--dot:' + accent + '"></span>' +
          '<span class="sched-tab-name">' + esc(s.name) + '</span>' +
          (s.demo ? '<span class="sched-tab-badge">示例</span>' : '') +
        '</button>'
      );
    });
    out.push(
      '<button type="button" class="sched-tab-add" data-action="new-schedule" title="新建一张课程表">' +
        U.icon('plus') + '<span>新表</span>' +
      '</button>'
    );
    return out.join('');
  };

  /* ---------- 周导航 ---------- */
  R.weekbar = function (view) {
    if (view.mode === 'tasks') return R.taskbar(view);
    var days = dateRangeOf(view);
    var total = view.schedule.totalWeeks;
    var isOverlay = view.ids && view.ids.length > 1;
    var actual = view.actualWeek;
    var atStart = view.week <= 1;
    var atEnd = view.week >= total;
    var out = [];

    out.push(
      '<div class="weekbar-main">' +
        '<div class="week-nav">' +
          '<button type="button" class="icon-btn week-arrow" data-action="prev-week"' +
            (atStart ? ' disabled' : '') + ' aria-label="上一周">' + U.icon('chevron-left') + '</button>' +
          '<button type="button" class="week-pill" data-action="open-week-menu" aria-haspopup="true">' +
            '<span class="week-pill-week">第 ' + view.week + ' 周</span>' +
            '<span class="week-pill-date">' + U.fmtMD(days.start) + ' – ' + U.fmtMD(days.end) + '</span>' +
            U.icon('chevron-down', 'week-pill-chev') +
          '</button>' +
          '<button type="button" class="icon-btn week-arrow" data-action="next-week"' +
            (atEnd ? ' disabled' : '') + ' aria-label="下一周">' + U.icon('chevron-right') + '</button>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm today-jump' +
          (view.week === actual ? ' is-current' : '') + '" data-action="go-today"' +
          (view.week === actual ? ' disabled' : '') + '>' +
          U.icon('calendar') + '<span>回到本周</span>' +
        '</button>' +
      '</div>'
    );

    out.push(
      '<div class="weekbar-side">' +
        (view.semester && view.semester.status !== 'ongoing'
          ? '<span class="week-chip is-muted">' + (view.semester.status === 'upcoming' ? '学期未开始' : '学期已结束') + '</span>'
          : '') +
        viewToggle(view) +
        '<button type="button" class="btn btn-ghost btn-sm overlay-btn' + (isOverlay ? ' is-on' : '') + '"' +
          ' data-action="open-overlay" title="把多张课程表叠在一起看">' +
          U.icon('layers') + '<span>' + (isOverlay ? '叠加 · ' + view.ids.length : '叠加') + '</span>' +
        '</button>' +
      '</div>'
    );

    return out.join('');
  };

  /* ---------- 任务导航 ---------- */
  R.taskbar = function (view) {
    var c = view.taskCounts || D.taskCounts(view.tasks, view.now);
    return '<div class="taskbar">' +
      '<div class="weekbar-main taskbar-main">' +
        '<div class="taskbar-title">' +
          '<span class="taskbar-kicker">TASKS &amp; MEMOS</span>' +
          '<h1>任务与备忘</h1>' +
          '<p>今天 ' + c.today + ' 项待办 · 本周 ' + c.week + ' 项' +
            (c.overdue ? ' · <em>逾期 ' + c.overdue + ' 项</em>' : '') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="weekbar-side taskbar-side">' +
        viewToggle(view) +
        '<button type="button" class="btn btn-primary btn-sm new-task-btn" data-action="new-task">' +
          U.icon('plus') + '<span>新建任务</span></button>' +
      '</div>' +
      '</div>';
  };

  /* ---------- 周次选择菜单 ---------- */
  R.weekMenu = function (view) {
    var start = U.parseDate(view.schedule.startDate) || U.today();
    var out = ['<div class="week-menu-head"><strong>选择周次</strong><span>共 ' + view.schedule.totalWeeks + ' 周</span></div>'];
    out.push('<div class="week-menu-list">');
    for (var w = 1; w <= view.schedule.totalWeeks; w++) {
      var a = U.dateOfWeek(start, w, 1), b = U.dateOfWeek(start, w, 7);
      var cls = 'week-menu-item';
      if (w === view.week) cls += ' is-current';
      if (w === view.actualWeek) cls += ' is-today';
      out.push(
        '<button type="button" class="' + cls + '" data-action="pick-week" data-week="' + w + '">' +
          '<span class="wm-week">第 ' + w + ' 周</span>' +
          '<span class="wm-date">' + U.fmtMD(a) + ' – ' + U.fmtMD(b) + '</span>' +
          (w === view.actualWeek ? '<span class="wm-now">本周</span>' : '') +
          (w === view.week ? U.icon('check', 'wm-check') : '') +
        '</button>'
      );
    }
    out.push('</div>');
    return out.join('');
  };

  /* ---------- 课程块 ---------- */
  function courseCard(entry, view, layout) {
    var c = entry.course;
    var p = D.paletteById(c.color);
    var len = D.courseLength(c);
    var r = rangeOf(entry, view.schedule);
    var weeks = c.weeks && c.weeks.length ? U.formatWeeks(c.weeks) : '';
    var prog = progressOf(entry, view.now);
    var conflict = view.conflicts && view.conflicts.courseIds.indexOf(c.id) >= 0;
    var compact = len <= 1;
    var meta = metaText(entry);
    var pct = round(prog.pct);
    var lanes = layout.lanes || 1;
    var lane = layout.lane || 0;
    var left = (lane * 100) / lanes;
    var width = 100 / lanes;
    var style = [
      '--c-light:' + p.light,
      '--c-dark:' + p.dark,
      '--c-soft-light:' + U.hexToRgba(p.light, 0.12),
      '--c-soft-dark:' + U.hexToRgba(p.dark, 0.17),
      '--c-line-light:' + U.hexToRgba(p.light, 0.38),
      '--c-line-dark:' + U.hexToRgba(p.dark, 0.45),
      '--start:' + c.startPeriod,
      '--len:' + len,
      '--z:' + (lane + 2),
      'top:calc((var(--start) - 1) * var(--row-h) + 4px)',
      'height:calc(var(--len) * var(--row-h) - 8px)',
      'left:calc(' + left + '% + 4px)',
      'width:calc(' + width + '% - 8px)'
    ].join(';');

    var top = '<span class="cc-head"><span class="cc-name">' + esc(c.name) + '</span>' +
      (conflict ? '<span class="cc-warn" title="与其他课程时间冲突">' + U.icon('alert') + '</span>' : '') +
      (view.isOverlay ? '<span class="cc-src" title="来自：' + esc(entry.schedule.name) + '">' + esc(entry.schedule.name) + '</span>' : '') +
      '</span>';

    return '<button type="button" class="course-card' + (compact ? ' is-compact' : '') +
      (lanes > 1 ? ' is-narrow' : '') +
      (conflict ? ' is-conflict' : '') + '"' + courseButtonAttrs(entry) +
      ' style="' + style + '" title="' + esc(detailTitle(entry, view)) + '">' +
      top +
      (meta ? '<span class="cc-meta">' + esc(meta) + '</span>' : '') +
      (r.start ? '<span class="cc-time">' + esc(r.start) + '–' + esc(r.end) + (weeks ? ' · ' + esc(weeks) : '') + '</span>' : '') +
      (prog.total ? progressBar(pct) : '') +
      '</button>';
  }

  /* 把一天的课程按重叠关系分组，再分配并排的泳道 */
  function layoutDay(entries) {
    var sorted = entries.slice().sort(function (a, b) {
      if (a.course.startPeriod !== b.course.startPeriod) return a.course.startPeriod - b.course.startPeriod;
      if (a.course.endPeriod !== b.course.endPeriod) return b.course.endPeriod - a.course.endPeriod;
      return String(a.course.name).localeCompare(String(b.course.name), 'zh-Hans-CN');
    });
    var out = [];
    var group = [];
    var groupEnd = 0;

    function flush() {
      if (!group.length) return;
      var laneEnds = [];
      group.forEach(function (e) {
        var lane = 0;
        while (lane < laneEnds.length && laneEnds[lane] >= e.course.startPeriod) lane++;
        laneEnds[lane] = e.course.endPeriod;
        out.push({ entry: e, lane: lane, lanes: 0 });
      });
      out.slice(out.length - group.length).forEach(function (item) { item.lanes = laneEnds.length; });
      group = [];
    }

    sorted.forEach(function (e) {
      if (!group.length || e.course.startPeriod <= groupEnd) {
        group.push(e);
        groupEnd = Math.max(groupEnd, e.course.endPeriod);
      } else {
        flush();
        group = [e];
        groupEnd = e.course.endPeriod;
      }
    });
    flush();
    return out;
  }

  function emptyState() {
    return '<div class="empty-state">' +
      '<div class="empty-art">' + U.icon('calendar') + U.icon('sparkles', 'empty-spark') + '</div>' +
      '<h2 class="empty-title">把课表搬进来</h2>' +
      '<p class="empty-text">从教务系统导入、上传 Excel / CSV，或者先手动添加一门课。你的数据只保存在这台设备的浏览器里。</p>' +
      '<div class="empty-actions">' +
        '<button type="button" class="btn btn-primary" data-action="open-import">' + U.icon('import') + '导入课程表</button>' +
        '<button type="button" class="btn btn-ghost" data-action="new-course">' + U.icon('plus') + '手动添加</button>' +
      '</div>' +
      '<p class="empty-hint">支持教务系统页面复制、Excel、CSV 与书签抓取</p>' +
    '</div>';
  }

  /* ---------- 周视图 ---------- */
  R.weekView = function (view) {
    var hasAny = (view.schedule.courses || []).length > 0;
    (view.overlaySchedules || []).forEach(function (s) { if ((s.courses || []).length) hasAny = true; });
    if (!hasAny) return emptyState();

    var days = countDays(view);
    var count = countPeriods(view);
    var ps = view.schedule.periods || [];
    var start = U.parseDate(view.schedule.startDate) || U.today();
    var now = view.now || new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var dayDates = [];
    for (var d = 1; d <= days; d++) dayDates[d] = U.dateOfWeek(start, view.week, d);
    var hasToday = dayDates.some(function (x) { return U.sameDay(x, now); });
    var out = [];

    if (!view.entries || !view.entries.length) {
      out.push('<div class="week-note">' + U.icon('info') +
        '<span>第 ' + view.week + ' 周没有课程安排。点击空白格可以补一节，或检查课程的周次范围。</span></div>');
    }

    out.push('<div class="week-view">');
    out.push('<div class="wg-scroll" style="--days:' + days + ';--periods:' + count + '">');
    out.push('<div class="wg-head">');
    out.push('<div class="wg-corner"><span>节次</span></div>');
    for (d = 1; d <= days; d++) {
      var todayHead = U.sameDay(dayDates[d], now);
      out.push('<div class="wg-dayhead' + (todayHead ? ' is-today' : '') + (d >= 6 ? ' is-weekend' : '') + '">' +
        '<span class="wd-name">' + DAY_NAMES[d - 1] + '</span>' +
        '<span class="wd-date">' + U.fmtMD(dayDates[d]) + '</span>' +
        (todayHead ? '<span class="wd-today">今天</span>' : '') +
        '</div>');
    }
    out.push('</div>');

    out.push('<div class="wg-body">');
    out.push('<div class="wg-times">');
    for (var p = 1; p <= count; p++) {
      var pd = ps[p - 1];
      var nowCell = hasToday && pd && isNowPeriod(pd, now);
      out.push('<div class="wg-time' + (nowCell ? ' is-now' : '') + '">' +
        '<span class="wt-index">' + p + '</span>' +
        (pd ? '<span class="wt-range"><b>' + esc(pd.start) + '</b><i>' + esc(pd.end) + '</i></span>' : '<span class="wt-range is-blank">—</span>') +
        '</div>');
    }
    out.push('</div>');

    out.push('<div class="wg-cols">');
    for (d = 1; d <= days; d++) {
      var dayEntries = (view.entries || []).filter(function (e) { return e.course.day === d; });
      var laid = layoutDay(dayEntries);
      var isToday = U.sameDay(dayDates[d], now);
      out.push('<div class="wg-col' + (isToday ? ' is-today' : '') + (d >= 6 ? ' is-weekend' : '') + '" data-day="' + d + '">');
      for (p = 1; p <= count; p++) {
        out.push('<button type="button" class="wg-slot" tabindex="-1" data-action="add-course" data-day="' + d + '" data-period="' + p +
          '" aria-label="' + DAY_NAMES[d - 1] + '第 ' + p + ' 节，添加课程"></button>');
      }
      laid.forEach(function (item) { out.push(courseCard(item.entry, view, item)); });
      out.push('</div>');
    }
    out.push('</div></div></div></div>');
    return out.join('');
  };

  /* ---------- 列表视图 ---------- */
  function listItem(entry, view) {
    var c = entry.course;
    var p = D.paletteById(c.color);
    var r = rangeOf(entry, view.schedule);
    var prog = progressOf(entry, view.now);
    var conflict = view.conflicts && view.conflicts.courseIds.indexOf(c.id) >= 0;
    var meta = metaText(entry);
    var weeks = c.weeks && c.weeks.length ? U.formatWeeks(c.weeks) : '周次未设置';
    var style = '--c-light:' + p.light + ';--c-dark:' + p.dark + ';--c-soft-light:' + U.hexToRgba(p.light, 0.12) + ';--c-soft-dark:' + U.hexToRgba(p.dark, 0.17) + ';--c-line-light:' + U.hexToRgba(p.light, 0.38) + ';--c-line-dark:' + U.hexToRgba(p.dark, 0.45);
    return '<button type="button" class="list-course' + (conflict ? ' is-conflict' : '') + '"' + courseButtonAttrs(entry) +
      ' style="' + style + '" title="' + esc(detailTitle(entry, view)) + '">' +
      '<span class="lc-color"></span>' +
      '<span class="lc-time">' + (r.start ? esc(r.start) + '<i>' + esc(r.end) + '</i>' : '—') + '</span>' +
      '<span class="lc-main">' +
        '<span class="lc-name">' + esc(c.name) +
          (conflict ? '<span class="lc-warn" title="时间冲突">' + U.icon('alert') + '</span>' : '') +
        '</span>' +
        '<span class="lc-meta">' + esc(meta || '教师与地点待补充') +
          (view.isOverlay ? '<span class="lc-source">' + esc(entry.schedule.name) + '</span>' : '') +
        '</span>' +
      '</span>' +
      '<span class="lc-side">' +
        '<span class="lc-weeks">' + esc(weeks) + '</span>' +
        '<span class="lc-progress"><span class="lc-pct">' + round(prog.pct) + '%</span>' +
          '<span class="lc-bar"><i style="width:' + U.clamp(round(prog.pct), 0, 100) + '%"></i></span>' +
        '</span>' +
      '</span>' +
    '</button>';
  }

  R.listView = function (view) {
    var hasAny = (view.schedule.courses || []).length > 0;
    (view.overlaySchedules || []).forEach(function (s) { if ((s.courses || []).length) hasAny = true; });
    if (!hasAny) return emptyState();

    var days = countDays(view);
    var start = U.parseDate(view.schedule.startDate) || U.today();
    var out = ['<div class="list-view">'];
    var shown = 0;
    for (var d = 1; d <= days; d++) {
      var date = U.dateOfWeek(start, view.week, d);
      var list = (view.entries || []).filter(function (e) { return e.course.day === d; })
        .sort(function (a, b) { return a.course.startPeriod - b.course.startPeriod; });
      if (!list.length) continue;
      shown += list.length;
      var today = U.sameDay(date, view.now);
      out.push('<section class="day-block">');
      out.push('<header class="day-block-head">' +
        '<span class="day-block-name">' + DAY_NAMES[d - 1] + '</span>' +
        '<span class="day-block-date">' + U.fmtMD(date) + '</span>' +
        (today ? '<span class="day-today">今天</span>' : '') +
        '<span class="day-block-count">' + list.length + ' 节</span>' +
        '</header>');
      out.push('<div class="day-block-list">');
      list.forEach(function (e) { out.push(listItem(e, view)); });
      out.push('</div></section>');
    }
    if (!shown) {
      out.push('<div class="week-note">' + U.icon('info') + '<span>第 ' + view.week + ' 周没有课程安排。</span></div>');
    }
    out.push('</div>');
    return out.join('');
  };

  /* ---------- 任务视图 ---------- */
  R.tasksView = function (view) {
    var now = view.now || new Date();
    var today = U.startOfDay(now);
    var tomorrow = U.addDays(today, 1);
    var weekEnd = U.addDays(U.startOfWeekMonday(today), 6);
    var filter = view.taskFilter || 'open';
    var all = (view.tasks || []).slice().sort(D.taskSort);
    var open = all.filter(function (t) { return !t.done; });
    var groups = [];
    function push(label, items, tone) {
      if (items && items.length) groups.push({ label: label, items: items, tone: tone || '' });
    }
    function before(t, day) { return taskDate(t) < day; }
    function on(t, day) { return U.sameDay(taskDate(t), day); }
    function between(t, a, b) { var d = taskDate(t); return d >= a && d <= b; }

    if (filter === 'done') {
      var done = all.filter(function (t) { return t.done; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
      push('已完成', done, 'done');
    } else if (filter === 'today') {
      push('今天 · ' + U.fmtMD(today) + ' ' + U.fmtWeekday(today), open.filter(function (t) { return on(t, today); }));
    } else if (filter === 'week') {
      push('已逾期', open.filter(function (t) { return before(t, today); }), 'danger');
      push('本周 · ' + U.fmtMD(today) + ' – ' + U.fmtMD(weekEnd), open.filter(function (t) { return between(t, today, weekEnd); }));
    } else {
      push('已逾期', open.filter(function (t) { return before(t, today); }), 'danger');
      push('今天 · ' + U.fmtMD(today) + ' ' + U.fmtWeekday(today), open.filter(function (t) { return on(t, today); }));
      push('明天 · ' + U.fmtMD(tomorrow) + ' ' + U.fmtWeekday(tomorrow), open.filter(function (t) { return on(t, tomorrow); }));
      push('本周稍后', open.filter(function (t) { var d = taskDate(t); return d > tomorrow && d <= weekEnd; }));
      var later = tomorrow > weekEnd ? tomorrow : weekEnd;
      push('以后', open.filter(function (t) { return taskDate(t) > later; }));
      if (filter === 'all') push('已完成', all.filter(function (t) { return t.done; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); }), 'done');
    }

    var c = view.taskCounts || D.taskCounts(all, now);
    var filters = [
      { id: 'open', name: '待办', count: c.open },
      { id: 'today', name: '今天', count: c.today },
      { id: 'week', name: '本周', count: c.week },
      { id: 'all', name: '全部', count: c.total },
      { id: 'done', name: '已完成', count: c.done }
    ];
    var filterBar = filters.map(function (f) {
      return '<button type="button" class="task-filter' + (filter === f.id ? ' is-active' : '') + '"' +
        ' data-action="task-filter" data-filter="' + f.id + '">' + f.name +
        (f.count ? '<span>' + f.count + '</span>' : '') + '</button>';
    }).join('');

    var summary = '<div class="task-summary">' +
      '<div class="task-sum-cell is-accent"><strong>' + c.today + '</strong><span>今天待办</span></div>' +
      '<div class="task-sum-cell"><strong>' + c.week + '</strong><span>本周待办</span></div>' +
      '<div class="task-sum-cell' + (c.overdue ? ' is-danger' : '') + '"><strong>' + c.overdue + '</strong><span>已逾期</span></div>' +
      '<div class="task-sum-cell"><strong>' + c.rate + '%</strong><span>完成率</span></div>' +
    '</div>';

    var groupsHtml = groups.map(function (g) { return taskGroup(g.label, g.items, view, g.tone); }).join('');
    if (!groupsHtml) {
      var emptyText = filter === 'done' ? '完成一项任务后，它会出现在这里。' :
        filter === 'today' ? '今天还没有安排，先记一件小事吧。' :
        filter === 'week' ? '本周还没有任务，给自己留一点余地。' :
        filter === 'all' ? '还没有任务。把要做的事记下来，课表之外也能井井有条。' :
        '待办清空了。可以休息一下，或者提前安排下一件事。';
      groupsHtml = taskEmpty(filter === 'open' ? '当前没有待办' : '这里还是空的', emptyText, true);
    }

    return '<div class="task-view">' +
      summary +
      '<form class="task-quick-form" id="task-quick-form" autocomplete="off">' +
        '<span class="task-quick-mark">' + U.icon('plus') + '</span>' +
        '<input id="task-quick-input" maxlength="80" placeholder="快速记一件事：作业、会议、活动…" aria-label="快速添加今天的任务">' +
        '<button type="submit" class="btn btn-primary btn-sm">添加到今天</button>' +
      '</form>' +
      '<div class="task-toolbar">' +
        '<div class="task-filters">' + filterBar + '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm task-new-btn" data-action="new-task">' + U.icon('plus') + '<span>新建任务</span></button>' +
      '</div>' +
      '<div class="task-groups">' + groupsHtml + '</div>' +
      '</div>';
  };

  R.view = function (view) {
    if (view.mode === 'tasks') return R.tasksView(view);
    return view.mode === 'list' ? R.listView(view) : R.weekView(view);
  };

  /* ---------- 侧栏 ---------- */
  function nextCountdown(next, now) {
    if (next.kind === 'ongoing') {
      return '还剩 ' + Math.max(1, Math.ceil((next.endDate.getTime() - now.getTime()) / 60000)) + ' 分钟下课';
    }
    var diff = next.startDate.getTime() - now.getTime();
    if (diff <= 60000) return '马上开始';
    if (U.sameDay(next.date, now)) return U.fmtDuration(diff / 60000) + '后开始';
    return U.relativeDay(next.date, now) + ' ' + clock(next.start) + ' 开始';
  }

  function railNext(view) {
    var next = view.next;
    if (next === undefined) next = D.nextSession(view.allEntries || view.entries, view.schedule, view.now);
    if (!next) {
      var sem = view.semester || {};
      var msg = sem.status === 'upcoming' ? '学期还没开始，先把课表准备好。' :
        sem.status === 'ended' ? '这学期已经结束啦。' : '接下来没有课了，享受空闲时间。';
      return '<section class="rail-card next-card is-empty">' +
        '<div class="rail-kicker"><span class="kicker-dot"></span>下一节课</div>' +
        '<div class="rail-empty next-empty">' + U.icon('check') + '<span>' + msg + '</span></div>' +
        '</section>';
    }
    var e = next.entry, c = e.course, p = D.paletteById(c.color);
    var r = rangeOf(e, view.schedule);
    var extra = next.entries.length > 1 ? '另有 ' + (next.entries.length - 1) + ' 门同时段课程' : '';
    return '<section class="rail-card next-card">' +
      '<button type="button" class="next-hit" data-action="open-course" data-id="' + esc(c.id) + '" data-schedule="' + esc(e.schedule.id) + '">' +
        '<span class="rail-kicker"><span class="kicker-dot" style="--c:' + p.light + '"></span>' +
          (next.kind === 'ongoing' ? '正在上课' : '下一节课') + '</span>' +
        '<span class="next-title">' + esc(c.name) + '</span>' +
        '<span class="next-meta">' + esc(U.relativeDay(next.date, view.now)) + ' · ' +
          (r.start ? esc(r.start) + '–' + esc(r.end) : '') +
          (c.location ? ' · ' + esc(c.location) : '') + '</span>' +
        '<span class="next-countdown">' + esc(nextCountdown(next, view.now)) + '</span>' +
        (extra ? '<span class="next-alt">' + esc(extra) + '</span>' : '') +
      '</button>' +
      '</section>';
  }

  function railToday(view) {
    var list = view.todayList;
    if (!list) list = D.todayEntries(view.allEntries || view.entries || [], view.schedule, view.now);
    var out = ['<section class="rail-card"><div class="rail-head"><h3>今天</h3><span>' +
      U.fmtMD(view.now) + ' ' + U.fmtWeekday(view.now) + '</span></div>'];
    if (!list.length) {
      var sem = view.semester || {};
      var msg = sem.status === 'upcoming' ? '学期还没开始' : sem.status === 'ended' ? '学期已经结束' : '今天没有课';
      out.push('<div class="rail-empty">' + U.icon('sun') + '<span>' + msg + '</span></div>');
    } else {
      out.push('<div class="today-list">');
      list.forEach(function (e) {
        var c = e.course, p = D.paletteById(c.color);
        var r = rangeOf(e, view.schedule);
        var ongoing = ongoingEntry(e, view.schedule, view.now);
        out.push('<button type="button" class="today-item' + (ongoing ? ' is-now' : '') + '"' + courseButtonAttrs(e) + '>' +
          '<span class="today-time">' + (r.start ? esc(r.start) + '<i>' + esc(r.end) + '</i>' : '—') + '</span>' +
          '<span class="today-dot" style="--c:' + p.light + '"></span>' +
          '<span class="today-main"><span class="today-name">' + esc(c.name) + '</span>' +
            '<span class="today-meta">' + esc(c.location || c.teacher || '') + '</span></span>' +
          (ongoing ? '<span class="today-live">上课中</span>' : '') +
          '</button>');
      });
      out.push('</div>');
    }
    out.push('</section>');
    return out.join('');
  }

  function railSemester(view) {
    var sem = view.semester || D.semesterProgress(view.schedule, view.now);
    var stats = view.stats || D.weekStats(view.entries || [], view.schedule);
    var conflicts = view.conflicts || { count: 0 };
    var pct = U.clamp(round(sem.pct), 0, 100);
    var status = sem.status === 'upcoming' ? '学期尚未开始' : sem.status === 'ended' ? '学期已结束' : '第 ' + sem.week + ' 周进行中';
    return '<section class="rail-card semester-card">' +
      '<div class="rail-head"><h3>学期进度</h3><span>第 ' + sem.week + ' / ' + sem.totalWeeks + ' 周</span></div>' +
      '<div class="semester-main">' +
        '<div class="semester-ring" style="--pct:' + pct + '">' +
          '<div class="ring-inner"><strong>' + pct + '%</strong><span>学期</span></div>' +
        '</div>' +
        '<div class="semester-copy">' +
          '<strong>' + status + '</strong>' +
          '<span>' + U.fmtRange(sem.start, sem.end, 'cn') + '</span>' +
          (conflicts.count
            ? '<button type="button" class="conflict-line" data-action="open-conflicts">' + U.icon('alert') + '本周有 ' + conflicts.count + ' 处时间冲突</button>'
            : '<span class="conflict-line is-ok">' + U.icon('check') + '本周无时间冲突</span>') +
        '</div>' +
      '</div>' +
      '<div class="semester-stats">' +
        '<div class="ss-cell"><strong>' + stats.courseCount + '</strong><span>门课程</span></div>' +
        '<div class="ss-cell"><strong>' + stats.sessions + '</strong><span>节课</span></div>' +
        '<div class="ss-cell"><strong>' + stats.hours + '</strong><span>小时</span></div>' +
      '</div>' +
      '</section>';
  }

  function progressItems(view) {
    var seen = {}, list = [];
    var all = view.allEntries;
    if (!all) {
      all = [];
      (view.schedule.courses || []).forEach(function (c) { all.push({ course: c, schedule: view.schedule }); });
      (view.overlaySchedules || []).forEach(function (s) {
        (s.courses || []).forEach(function (c) { all.push({ course: c, schedule: s }); });
      });
    }
    all.forEach(function (e) {
      var key = e.schedule.id + '|' + e.course.id;
      if (seen[key]) return;
      seen[key] = 1;
      list.push({ entry: e, progress: progressOf(e, view.now) });
    });
    list.sort(function (a, b) {
      if (a.progress.pct !== b.progress.pct) return b.progress.pct - a.progress.pct;
      return String(a.entry.course.name).localeCompare(String(b.entry.course.name), 'zh-Hans-CN');
    });
    return list;
  }

  function railProgress(view) {
    var list = progressItems(view);
    if (!list.length) return '';
    var out = ['<section class="rail-card progress-card">' +
      '<div class="rail-head"><h3>课程进度</h3><span>' + list.length + ' 门</span></div>' +
      '<div class="progress-list">'];
    list.forEach(function (item) {
      var c = item.entry.course, p = D.paletteById(c.color), pr = item.progress;
      var pct = U.clamp(round(pr.pct), 0, 100);
      out.push('<button type="button" class="progress-item" data-action="open-course" data-id="' + esc(c.id) +
        '" data-schedule="' + esc(item.entry.schedule.id) + '" title="' + esc(c.name + ' · 进度 ' + pct + '%') + '">' +
        '<span class="pi-dot" style="--c:' + p.light + '"></span>' +
        '<span class="pi-name">' + esc(c.name) + '</span>' +
        (pr.manual != null ? '<span class="pi-manual">手动</span>' : '') +
        '<span class="pi-pct">' + pct + '%</span>' +
        '<span class="pi-track"><i style="width:' + pct + '%;--c:' + p.light + '"></i></span>' +
        '</button>');
    });
    out.push('</div></section>');
    return out.join('');
  }

  /* ---------- 任务侧栏与表单 ---------- */
  function taskStatsCard(view) {
    var c = view.taskCounts || D.taskCounts(view.tasks, view.now);
    var nr = D.nextReminder(view.tasks, view.now);
    var nextText = nr
      ? U.relativeDay(nr.at, view.now) + ' ' + U.pad2(nr.at.getHours()) + ':' + U.pad2(nr.at.getMinutes()) + ' · ' + nr.task.title
      : '暂无待触发的提醒';
    var perm = view.notifyPermission || 'unsupported';
    var notify = '';
    if (perm === 'granted') {
      notify = '<span class="notify-state is-on">' + U.icon('check') + '桌面提醒已开启</span>';
    } else if (perm === 'denied') {
      notify = '<span class="notify-state is-off">浏览器已拒绝通知，页面内提醒仍有效</span>';
    } else if (perm === 'default') {
      notify = '<button type="button" class="btn btn-ghost btn-sm" data-action="request-notify">' + U.icon('bell') + '开启桌面提醒</button>';
    } else {
      notify = '<span class="notify-state is-off">当前浏览器不支持桌面通知</span>';
    }
    return '<section class="rail-card task-stats-card">' +
      '<div class="rail-head"><h3>任务概览</h3><span>完成率 ' + c.rate + '%</span></div>' +
      '<div class="task-stat-grid">' +
        '<div><strong>' + c.today + '</strong><span>今天</span></div>' +
        '<div><strong>' + c.week + '</strong><span>本周</span></div>' +
        '<div' + (c.overdue ? ' class="is-danger"' : '') + '><strong>' + c.overdue + '</strong><span>逾期</span></div>' +
        '<div><strong>' + c.done + '</strong><span>完成</span></div>' +
      '</div>' +
      '<div class="task-next-reminder">' + U.icon('bell') +
        '<div><span>下一条提醒</span><strong>' + esc(nextText) + '</strong></div></div>' +
      '<div class="task-notify">' + notify +
        '<p>提醒在页面打开时触发；开启桌面通知后，切到其他标签页也能收到。</p></div>' +
      '</section>';
  }

  function memoCard(view) {
    var memos = (view.memos || []).slice().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    var list = memos.map(function (m) {
      return '<div class="memo-item' + (m.pinned ? ' is-pinned' : '') + '" data-memo-id="' + esc(m.id) + '">' +
        '<button type="button" class="memo-text" data-action="open-memo" data-id="' + esc(m.id) + '">' + esc(m.text) + '</button>' +
        '<div class="memo-actions">' +
          '<button type="button" class="icon-btn memo-btn" data-action="toggle-memo-pin" data-id="' + esc(m.id) + '"' +
            ' aria-label="' + (m.pinned ? '取消置顶' : '置顶备忘') + '">' + U.icon('pin') + '</button>' +
          '<button type="button" class="icon-btn memo-btn memo-del" data-action="delete-memo" data-id="' + esc(m.id) + '"' +
            ' aria-label="删除备忘">' + U.icon('close') + '</button>' +
        '</div>' +
        '</div>';
    }).join('');
    return '<section class="rail-card memo-card">' +
      '<div class="rail-head"><h3>快捷备忘</h3><span>' + memos.length + ' 条</span></div>' +
      '<form class="memo-form" id="memo-quick-form" autocomplete="off">' +
        '<input id="memo-quick-input" maxlength="200" placeholder="随手记一条…" aria-label="新增备忘">' +
        '<button type="submit" class="icon-btn memo-add" aria-label="添加备忘">' + U.icon('plus') + '</button>' +
      '</form>' +
      (memos.length ? '<div class="memo-list">' + list + '</div>' :
        '<div class="rail-empty memo-empty">' + U.icon('note') + '<span>还没有备忘，记一条试试。</span></div>') +
      '<p class="memo-hint">点文字可编辑；置顶的备忘会排在最前。</p>' +
      '</section>';
  }

  R.taskRail = function (view) {
    return taskStatsCard(view) + memoCard(view);
  };

  function railTasks(view) {
    var today = U.startOfDay(view.now);
    var todayKey = U.toDateInput(today);
    var tasks = (view.tasks || []).filter(function (t) { return !t.done; }).sort(D.taskSort);
    var overdue = tasks.filter(function (t) { return U.parseDate(t.date) < today; });
    var todayList = tasks.filter(function (t) { return t.date === todayKey; });
    var list = overdue.concat(todayList);
    var shown = list.slice(0, 4);
    var out = ['<section class="rail-card rail-tasks-card">' +
      '<div class="rail-head"><h3>今日待办</h3><span>' + (list.length ? list.length + ' 项' : '轻松一天') + '</span></div>'];
    if (!shown.length) {
      out.push('<div class="rail-empty">' + U.icon('check-square') + '<span>今天还没有待办</span></div>');
    } else {
      out.push('<div class="rail-task-list">');
      shown.forEach(function (t) {
        var p = taskPalette(t);
        var late = U.parseDate(t.date) < today;
        var meta = (late ? '逾期 · ' : '') + (t.start ? t.start : '全天') + (t.location ? ' · ' + t.location : '');
        out.push('<div class="rail-task" style="--tc:' + p.light + '">' +
          '<button type="button" class="rail-task-check" data-action="toggle-task" data-id="' + esc(t.id) + '" aria-label="完成任务"></button>' +
          '<button type="button" class="rail-task-main" data-action="open-task" data-id="' + esc(t.id) + '">' +
            '<span class="rail-task-title">' + esc(t.title) + '</span>' +
            '<span class="rail-task-meta">' + esc(meta) + '</span>' +
          '</button>' +
          '</div>');
      });
      out.push('</div>');
      if (list.length > shown.length) out.push('<p class="rail-task-more">还有 ' + (list.length - shown.length) + ' 项</p>');
    }
    out.push('<div class="rail-task-foot">' +
      '<button type="button" class="rail-task-link" data-action="set-view" data-view="tasks">全部任务' + U.icon('arrow-right') + '</button>' +
      '<button type="button" class="icon-btn rail-task-add" data-action="new-task" aria-label="新建任务">' + U.icon('plus') + '</button>' +
      '</div></section>');
    return out.join('');
  }

  R.taskForm = function (task, opts) {
    opts = opts || {};
    var t = task || {
      title: '', type: 'task', date: opts.date || U.toDateInput(U.today()),
      start: '', end: '', location: '', note: '', priority: 0, remind: null
    };
    var typeOpts = D.TASK_TYPES.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === t.type ? ' selected' : '') + '>' + x.name + '</option>';
    }).join('');
    var priorityOpts = D.PRIORITIES.map(function (x) {
      return '<option value="' + x.value + '"' + (+t.priority === x.value ? ' selected' : '') + '>' + x.name + '</option>';
    }).join('');
    var remindOpts = D.REMIND_OPTIONS.map(function (x) {
      var selected = (x.value == null && t.remind == null) || (x.value != null && +t.remind === x.value);
      return '<option value="' + (x.value == null ? '' : x.value) + '"' + (selected ? ' selected' : '') + '>' + x.name + '</option>';
    }).join('');
    return '<form class="task-form" id="task-form" autocomplete="off">' +
      '<div class="field field-wide"><label for="tf-title">标题 <em>*</em></label>' +
        '<input id="tf-title" class="input" maxlength="80" placeholder="例如：小组会议 / 交实验报告 / 社团活动" value="' + esc(t.title) + '"></div>' +
      '<div class="field"><label for="tf-type">类型</label>' +
        '<select id="tf-type" class="input">' + typeOpts + '</select></div>' +
      '<div class="field"><label for="tf-date">日期 <em>*</em></label>' +
        '<input id="tf-date" class="input" type="date" value="' + esc(t.date) + '"></div>' +
      '<div class="field"><label for="tf-start">开始时间</label>' +
        '<input id="tf-start" class="input" type="time" value="' + esc(t.start) + '"></div>' +
      '<div class="field"><label for="tf-end">结束时间</label>' +
        '<input id="tf-end" class="input" type="time" value="' + esc(t.end) + '"></div>' +
      '<div class="field"><label for="tf-location">地点</label>' +
        '<input id="tf-location" class="input" maxlength="60" placeholder="选填" value="' + esc(t.location) + '"></div>' +
      '<div class="field"><label for="tf-priority">优先级</label>' +
        '<select id="tf-priority" class="input">' + priorityOpts + '</select></div>' +
      '<div class="field"><label for="tf-remind">提醒</label>' +
        '<select id="tf-remind" class="input">' + remindOpts + '</select></div>' +
      '<div class="field field-wide"><label for="tf-note">备注</label>' +
        '<textarea id="tf-note" class="input" rows="3" maxlength="1000" placeholder="补充说明、会议议程、要带的东西…">' + esc(t.note) + '</textarea></div>' +
      '<p class="field-hint field-wide task-form-hint">' + U.icon('bell') +
        '时间留空即为全天；全天任务默认在当天 09:00 提醒。提醒需要在页面打开时才能触发。</p>' +
      '</form>';
  };

  R.rail = function (view) {
    if (view.mode === 'tasks') return R.taskRail(view);
    return railNext(view) + railToday(view) + railTasks(view) + railSemester(view) + railProgress(view);
  };

  /* ---------- 首次提示 ---------- */
  R.tip = function (state) {
    if (!state.settings || state.settings.tipDismissed) return '';
    if (!state.schedules.some(function (s) { return s.demo; })) return '';
    return '<div class="tip-banner">' +
      '<span class="tip-mark">' + U.icon('sparkles') + '</span>' +
      '<div class="tip-body">' +
        '<strong>已经放好两份示例课程表</strong>' +
        '<p>点上方「示例 · 辅修」看看切换效果，或用「叠加」把两张表合在一起。导入自己的课表后，可以在设置里删除示例。</p>' +
      '</div>' +
      '<div class="tip-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="open-import">导入我的课表</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="dismiss-tip">知道了</button>' +
      '</div>' +
      '<button type="button" class="tip-close" data-action="dismiss-tip" aria-label="关闭提示">' + U.icon('close') + '</button>' +
    '</div>';
  };
})();
