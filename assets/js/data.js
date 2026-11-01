/* 课序 ClassFlow — 数据模型与本地存储 */
(function () {
  'use strict';
  var CF = window.CF = window.CF || {};
  var U = CF.Util;
  var D = CF.Data = {};

  D.STORAGE_KEY = 'classflow.state.v1';
  D.STORAGE_BACKUP_KEY = 'classflow.state.corrupt.v1';
  D.VERSION = 1;

  D.PALETTE = [
    { id: 'coral',  name: '珊瑚', light: '#C4473A', dark: '#FF9D8F' },
    { id: 'orange', name: '落日', light: '#B75E13', dark: '#FFB774' },
    { id: 'amber',  name: '琥珀', light: '#9A6B0B', dark: '#F2CB64' },
    { id: 'green',  name: '松绿', light: '#237A4B', dark: '#7FD9A8' },
    { id: 'teal',   name: '青瓷', light: '#0E7A72', dark: '#6FE3D6' },
    { id: 'sky',    name: '天蓝', light: '#126C93', dark: '#85D9F5' },
    { id: 'blue',   name: '群青', light: '#2C57B8', dark: '#9DBBFF' },
    { id: 'violet', name: '紫藤', light: '#7145B8', dark: '#C9B2FF' },
    { id: 'pink',   name: '胭脂', light: '#AE3B68', dark: '#FFA5C6' },
    { id: 'olive',  name: '橄榄', light: '#5D711B', dark: '#CFDD82' },
    { id: 'plum',   name: '梅子', light: '#853F62', dark: '#E7A5C8' },
    { id: 'slate',  name: '石墨', light: '#55606E', dark: '#C3CFDD' }
  ];

  /* 任务类型与提醒选项（任务/备忘是全局数据，不隶属于某张课程表） */
  D.TASK_TYPES = [
    { id: 'task',     name: '任务', color: 'blue' },
    { id: 'meeting',  name: '会议', color: 'violet' },
    { id: 'activity', name: '活动', color: 'green' },
    { id: 'exam',     name: '考试', color: 'coral' },
    { id: 'reminder', name: '提醒', color: 'amber' }
  ];
  D.PRIORITIES = [
    { value: 0, name: '普通' },
    { value: 1, name: '重要' },
    { value: 2, name: '紧急' }
  ];
  D.REMIND_OPTIONS = [
    { value: null, name: '不提醒' },
    { value: 0,    name: '开始时' },
    { value: 5,    name: '提前 5 分钟' },
    { value: 10,   name: '提前 10 分钟' },
    { value: 15,   name: '提前 15 分钟' },
    { value: 30,   name: '提前 30 分钟' },
    { value: 60,   name: '提前 1 小时' },
    { value: 120,  name: '提前 2 小时' },
    { value: 1440, name: '提前 1 天' }
  ];

  D.DEFAULT_PERIODS = [
    { start: '08:00', end: '08:45' },
    { start: '08:55', end: '09:40' },
    { start: '10:00', end: '10:45' },
    { start: '10:55', end: '11:40' },
    { start: '14:00', end: '14:45' },
    { start: '14:55', end: '15:40' },
    { start: '16:00', end: '16:45' },
    { start: '16:55', end: '17:40' },
    { start: '19:00', end: '19:45' },
    { start: '19:55', end: '20:40' },
    { start: '20:50', end: '21:35' },
    { start: '21:45', end: '22:30' }
  ];

  D.periodTemplate = function () {
    return D.DEFAULT_PERIODS.map(function (p) { return { start: p.start, end: p.end }; });
  };

  D.paletteById = function (id) {
    for (var i = 0; i < D.PALETTE.length; i++) if (D.PALETTE[i].id === id) return D.PALETTE[i];
    return D.PALETTE[0];
  };

  D.storageAvailable = (function () {
    try {
      var k = '__classflow_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  /* ---------- 规范与校验收敛 ---------- */
  function validTime(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return U.pad2(h) + ':' + U.pad2(mi);
  }

  function periodList(list) {
    var out = [];
    if (Array.isArray(list)) {
      list.slice(0, 16).forEach(function (p) {
        var s = validTime(p && p.start), e = validTime(p && p.end);
        if (s && e && U.minutesOf(e) > U.minutesOf(s)) out.push({ start: s, end: e });
      });
    }
    if (!out.length) out = D.periodTemplate();
    return out;
  }

  D.extendPeriods = function (periods, minCount) {
    var list = periodList(periods);
    minCount = Math.max(1, Math.min(16, minCount || 0));
    var lastEnd = U.minutesOf(list[list.length - 1].end);
    var guard = 0;
    while (list.length < minCount && list.length < 16 && guard < 20) {
      guard++;
      var start = Math.min(lastEnd + 10, 23 * 60 + 14);
      var end = Math.min(start + 45, 23 * 60 + 59);
      if (end <= start) { start = 22 * 60; end = 22 * 60 + 45; }
      list.push({ start: U.pad2(Math.floor(start / 60)) + ':' + U.pad2(start % 60), end: U.pad2(Math.floor(end / 60)) + ':' + U.pad2(end % 60) });
      lastEnd = end;
    }
    return list;
  };

  function normalizeCourse(c, sched, totalPeriods) {
    if (!c || !String(c.name || '').trim()) return null;
    var start = U.clamp(parseInt(c.startPeriod, 10) || 1, 1, totalPeriods);
    var end = U.clamp(parseInt(c.endPeriod, 10) || start, start, totalPeriods);
    var weeks = Array.isArray(c.weeks) ? c.weeks.map(Number).filter(function (w) { return w >= 1 && w <= 60; }) : U.parseWeeks(c.weeks, sched.totalWeeks);
    weeks = Array.from(new Set(weeks)).sort(function (a, b) { return a - b; });
    if (!weeks.length) weeks = [];
    var color = c.color;
    if (!D.PALETTE.some(function (p) { return p.id === color; })) color = D.PALETTE[0].id;
    return {
      id: c.id || U.uid('crs'),
      name: String(c.name).trim().slice(0, 60),
      teacher: String(c.teacher || '').trim().slice(0, 40),
      location: String(c.location || '').trim().slice(0, 60),
      day: U.clamp(parseInt(c.day, 10) || 1, 1, 7),
      startPeriod: start,
      endPeriod: end,
      weeks: weeks,
      color: color,
      note: String(c.note || '').trim().slice(0, 500),
      progress: (c.progress === 0 || c.progress) && !isNaN(+c.progress) ? U.clamp(Math.round(+c.progress), 0, 100) : null,
      createdAt: c.createdAt || Date.now()
    };
  }

  /* ---------- 任务 / 备忘 ---------- */
  function taskTypeInfo(id) {
    for (var i = 0; i < D.TASK_TYPES.length; i++) if (D.TASK_TYPES[i].id === id) return D.TASK_TYPES[i];
    return D.TASK_TYPES[0];
  }

  function taskTime(value) {
    var m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    var h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    var min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return U.pad2(h) + ':' + U.pad2(min);
  }

  function taskRemind(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = parseInt(value, 10);
    if (isNaN(n)) return null;
    for (var i = 0; i < D.REMIND_OPTIONS.length; i++) {
      if (D.REMIND_OPTIONS[i].value === n) return n;
    }
    return null;
  }

  D.normalizeTask = function (t) {
    if (!t || typeof t !== 'object') return null;
    var title = String(t.title || t.name || '').trim().slice(0, 80);
    if (!title) return null;
    var now = Date.now();
    var date = U.parseDate(t.date) || U.today();
    var start = taskTime(t.start);
    var end = taskTime(t.end);
    if (!start) end = '';
    if (start && !end) end = start;
    if (start && end && end < start) end = start;
    var type = taskTypeInfo(t.type).id;
    var priority = [0, 1, 2].indexOf(+t.priority) >= 0 ? +t.priority : 0;
    var remind = taskRemind(t.remind);
    var done = !!t.done;
    var createdAt = parseInt(t.createdAt, 10) || now;
    var updatedAt = parseInt(t.updatedAt, 10) || now;
    return {
      id: t.id || U.uid('task'),
      title: title,
      type: type,
      date: U.toDateInput(date),
      start: start,
      end: end,
      location: String(t.location || '').trim().slice(0, 60),
      note: String(t.note || '').trim().slice(0, 1000),
      priority: priority,
      remind: remind,
      done: done,
      doneAt: done ? (parseInt(t.doneAt, 10) || now) : null,
      remindedAt: t.remindedAt ? String(t.remindedAt) : null,
      createdAt: createdAt,
      updatedAt: updatedAt
    };
  };

  D.normalizeMemo = function (m) {
    if (!m || typeof m !== 'object') return null;
    var text = String(m.text || '').trim().slice(0, 1000);
    if (!text) return null;
    var now = Date.now();
    return {
      id: m.id || U.uid('memo'),
      text: text,
      pinned: !!m.pinned,
      createdAt: parseInt(m.createdAt, 10) || now,
      updatedAt: parseInt(m.updatedAt, 10) || now
    };
  };

  D.normalizeSchedule = function (s) {
    if (!s || typeof s !== 'object') return null;
    var now = Date.now();
    var start = U.parseDate(s.startDate) || U.startOfWeekMonday(U.today());
    start = U.startOfWeekMonday(start);
    var totalWeeks = U.clamp(parseInt(s.totalWeeks, 10) || 20, 1, 30);
    var periods = periodList(s.periods);
    var days = [5, 6, 7].indexOf(parseInt(s.days, 10)) >= 0 ? parseInt(s.days, 10) : 7;
    var maxEnd = 0;
    if (Array.isArray(s.courses)) s.courses.forEach(function (c) { if (c) maxEnd = Math.max(maxEnd, parseInt(c.endPeriod, 10) || 0); });
    if (maxEnd > periods.length) periods = D.extendPeriods(periods, maxEnd);
    var sched = {
      id: s.id || U.uid('sch'),
      name: String(s.name || '未命名课程表').trim().slice(0, 40) || '未命名课程表',
      startDate: U.toDateInput(start),
      totalWeeks: totalWeeks,
      days: days,
      periods: periods,
      courses: [],
      demo: !!s.demo,
      createdAt: s.createdAt || now,
      updatedAt: s.updatedAt || now
    };
    var seen = {};
    (Array.isArray(s.courses) ? s.courses : []).forEach(function (c) {
      var nc = normalizeCourse(c, sched, periods.length);
      if (!nc) return;
      var key = [nc.name, nc.day, nc.startPeriod, nc.endPeriod, nc.weeks.join('.')].join('|');
      if (seen[key]) return;
      seen[key] = true;
      sched.courses.push(nc);
    });
    return sched;
  };

  D.emptySchedule = function (opts) {
    opts = opts || {};
    var term = U.guessTerm();
    var now = Date.now();
    return {
      id: U.uid('sch'),
      name: opts.name || '新课程表',
      startDate: U.toDateInput(opts.startDate || term.startDate),
      totalWeeks: opts.totalWeeks || 20,
      days: opts.days || 7,
      periods: opts.periods || D.periodTemplate(),
      courses: opts.courses || [],
      demo: false,
      createdAt: now,
      updatedAt: now
    };
  };

  D.emptyState = function () {
    var s = D.emptySchedule({ name: '我的课程表' });
    return {
      version: D.VERSION,
      activeId: s.id,
      schedules: [s],
      tasks: [],
      memos: [],
      settings: { theme: 'auto', tipDismissed: true },
      createdAt: Date.now()
    };
  };

  D.normalizeState = function (raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.schedules)) return null;
    var schedules = raw.schedules.map(D.normalizeSchedule).filter(Boolean);
    if (!schedules.length) return null;
    var activeId = raw.activeId;
    if (!schedules.some(function (s) { return s.id === activeId; })) activeId = schedules[0].id;
    var settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var theme = ['auto', 'light', 'dark'].indexOf(settings.theme) >= 0 ? settings.theme : 'auto';
    var tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map(D.normalizeTask).filter(Boolean);
    var memos = (Array.isArray(raw.memos) ? raw.memos : []).map(D.normalizeMemo).filter(Boolean);
    return {
      version: D.VERSION,
      activeId: activeId,
      schedules: schedules,
      tasks: tasks,
      memos: memos,
      settings: {
        theme: theme,
        tipDismissed: !!settings.tipDismissed
      },
      createdAt: raw.createdAt || Date.now()
    };
  };

  /* ---------- 示例数据 ---------- */
  function w(a, b, parity) {
    var out = [];
    for (var i = a; i <= b; i++) {
      if (parity === 'odd' && i % 2 === 0) continue;
      if (parity === 'even' && i % 2 === 1) continue;
      out.push(i);
    }
    return out;
  }

  D.seed = function () {
    var now = Date.now();
    var start = U.addDays(U.startOfWeekMonday(U.today()), -7 * 7); // 让“今天”落在第 8 周
    var startStr = U.toDateInput(start);
    var periods = D.periodTemplate();
    var main = {
      id: 'sch_demo_main',
      name: '示例 · 主修',
      startDate: startStr,
      totalWeeks: 20,
      days: 7,
      periods: periods,
      demo: true,
      createdAt: now,
      updatedAt: now,
      courses: [
        { id: 'demo_c1', name: '高等数学（上）', teacher: '陈立群', location: '教三-201', day: 1, startPeriod: 1, endPeriod: 2, weeks: w(1, 16), color: 'blue', note: '极限与微积分基础，期中在第 9 周。' },
        { id: 'demo_c2', name: '大学英语（二）', teacher: '王雪', location: '文科楼 B203', day: 1, startPeriod: 3, endPeriod: 4, weeks: w(1, 16), color: 'sky', note: '' },
        { id: 'demo_c3', name: '数据结构', teacher: '赵明', location: '信息楼 A401', day: 2, startPeriod: 1, endPeriod: 2, weeks: w(1, 16), color: 'violet', note: '每章配套一次上机练习。' },
        { id: 'demo_c4', name: '数据结构实验', teacher: '赵明', location: '实验中心 302', day: 2, startPeriod: 5, endPeriod: 6, weeks: w(3, 15, 'odd'), color: 'teal', note: '' },
        { id: 'demo_c5', name: '线性代数', teacher: '刘敏', location: '教二-105', day: 3, startPeriod: 3, endPeriod: 4, weeks: w(1, 16), color: 'coral', note: '' },
        { id: 'demo_c6', name: '大学物理', teacher: '孙浩', location: '理科楼 210', day: 4, startPeriod: 1, endPeriod: 2, weeks: w(1, 16), color: 'orange', note: '' },
        { id: 'demo_c7', name: '羽毛球', teacher: '李强', location: '体育馆', day: 4, startPeriod: 7, endPeriod: 8, weeks: w(1, 16), color: 'green', note: '' },
        { id: 'demo_c8', name: '中国近现代史纲要', teacher: '周颖', location: '文科楼 B101', day: 5, startPeriod: 3, endPeriod: 4, weeks: w(1, 8), color: 'amber', note: '' },
        { id: 'demo_c9', name: '程序设计实践', teacher: '赵明', location: '机房 305', day: 5, startPeriod: 5, endPeriod: 6, weeks: w(2, 16, 'even'), color: 'olive', note: '' },
        { id: 'demo_c10', name: '音乐鉴赏', teacher: '何静', location: '艺术楼 101', day: 6, startPeriod: 3, endPeriod: 4, weeks: w(1, 12), color: 'pink', note: '通识选修。' }
      ]
    };
    var minor = {
      id: 'sch_demo_minor',
      name: '示例 · 辅修',
      startDate: startStr,
      totalWeeks: 20,
      days: 7,
      periods: D.periodTemplate(),
      demo: true,
      createdAt: now,
      updatedAt: now,
      courses: [
        { id: 'demo_m1', name: '经济学原理', teacher: '徐帆', location: '经管楼 402', day: 3, startPeriod: 5, endPeriod: 6, weeks: w(1, 16), color: 'plum', note: '' },
        { id: 'demo_m2', name: '日语入门（二）', teacher: '林田', location: '外语楼 108', day: 1, startPeriod: 3, endPeriod: 4, weeks: w(1, 16), color: 'teal', note: '与主修英语课时间冲突，叠加后会并排显示。' },
        { id: 'demo_m3', name: '创新创业基础', teacher: '郑凯', location: '创客空间 201', day: 6, startPeriod: 1, endPeriod: 2, weeks: w(2, 16), color: 'slate', note: '' }
      ]
    };
    return {
      version: D.VERSION,
      activeId: main.id,
      schedules: [main, minor],
      tasks: [],
      memos: [],
      settings: { theme: 'auto', tipDismissed: false },
      createdAt: now
    };
  };

  /* ---------- 存取 ---------- */
  D.load = function () {
    try {
      var raw = localStorage.getItem(D.STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var normalized = D.normalizeState(parsed);
        if (normalized) return normalized;
        try { localStorage.setItem(D.STORAGE_BACKUP_KEY, raw); } catch (e) {}
      }
    } catch (e) {
      console.warn('[课序] 读取本地数据失败：', e);
    }
    var seeded = D.seed();
    D.save(seeded);
    return seeded;
  };

  D.save = function (state) {
    if (!D.storageAvailable) return false;
    try {
      localStorage.setItem(D.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('[课序] 保存失败：', e);
      return false;
    }
  };

  /* ---------- 查询与统计 ---------- */
  D.activeSchedule = function (state) {
    if (!state) return null;
    for (var i = 0; i < state.schedules.length; i++) if (state.schedules[i].id === state.activeId) return state.schedules[i];
    return state.schedules[0] || null;
  };

  D.scheduleById = function (state, id) {
    if (!state) return null;
    for (var i = 0; i < state.schedules.length; i++) if (state.schedules[i].id === id) return state.schedules[i];
    return null;
  };

  D.actualWeek = function (schedule, date) {
    return U.weekOf(date || new Date(), U.parseDate(schedule.startDate) || U.startOfWeekMonday(U.today()));
  };

  D.semesterRange = function (schedule) {
    var start = U.parseDate(schedule.startDate) || U.startOfWeekMonday(U.today());
    var end = U.dateOfWeek(start, schedule.totalWeeks, 7);
    return { start: start, end: end };
  };

  D.semesterProgress = function (schedule, now) {
    var range = D.semesterRange(schedule);
    var today = U.startOfDay(now || new Date());
    var totalDays = U.diffDays(range.start, range.end) + 1;
    var elapsed = U.clamp(U.diffDays(range.start, today) + 1, 0, totalDays);
    var rawWeek = U.weekOf(today, range.start);
    var week = U.clamp(rawWeek, 1, schedule.totalWeeks);
    var status = today < range.start ? 'upcoming' : (today > range.end ? 'ended' : 'ongoing');
    return {
      pct: Math.round((elapsed / totalDays) * 100),
      week: week,
      rawWeek: rawWeek,
      totalWeeks: schedule.totalWeeks,
      status: status,
      start: range.start,
      end: range.end
    };
  };

  D.courseLength = function (course) { return course.endPeriod - course.startPeriod + 1; };

  D.courseSessionCount = function (course) {
    return (course.weeks ? course.weeks.length : 0) * D.courseLength(course);
  };

  /** 计算课程进度（自动按已结束的课时计算），支持手动百分比覆盖 */
  D.courseProgress = function (course, schedule, now) {
    var total = D.courseSessionCount(course);
    var done = 0;
    if (total > 0) {
      var start = U.parseDate(schedule.startDate);
      var today = U.startOfDay(now || new Date());
      var nowMin = (now || new Date()).getHours() * 60 + (now || new Date()).getMinutes();
      var isToday = U.sameDay(today, now || new Date());
      var periods = schedule.periods;
      for (var i = 0; i < course.weeks.length; i++) {
        var date = U.dateOfWeek(start, course.weeks[i], course.day);
        if (date < today) { done += D.courseLength(course); continue; }
        if (!U.sameDay(date, today)) continue;
        for (var p = course.startPeriod; p <= course.endPeriod; p++) {
          var pd = periods[p - 1];
          if (!pd) continue;
          var endMin = U.minutesOf(pd.end);
          if (endMin != null && nowMin >= endMin) done++;
        }
      }
    }
    var autoPct = total ? Math.round((done / total) * 100) : 0;
    var manual = course.progress != null && !isNaN(course.progress) ? U.clamp(Math.round(course.progress), 0, 100) : null;
    return {
      total: total,
      done: done,
      autoPct: autoPct,
      pct: manual != null ? manual : autoPct,
      manual: manual
    };
  };

  D.coursesForWeek = function (schedule, week) {
    return (schedule.courses || []).filter(function (c) { return U.weeksContain(c.weeks, week); });
  };

  D.entriesOf = function (state, ids, week) {
    var out = [];
    (ids || []).forEach(function (id) {
      var sch = D.scheduleById(state, id);
      if (!sch) return;
      (sch.courses || []).forEach(function (c) {
        if (week == null || U.weeksContain(c.weeks, week)) out.push({ course: c, schedule: sch });
      });
    });
    return out;
  };

  D.weekStats = function (entries, schedule) {
    var seenNames = {}, courseCount = 0, sessions = 0, minutes = 0;
    entries.forEach(function (e) {
      if (!seenNames[e.course.id + '|' + e.schedule.id]) { seenNames[e.course.id + '|' + e.schedule.id] = 1; courseCount++; }
      var len = D.courseLength(e.course);
      sessions += len;
      var periods = e.schedule.periods || schedule.periods;
      for (var p = e.course.startPeriod; p <= e.course.endPeriod; p++) {
        var pd = periods[p - 1];
        if (pd) {
          var a = U.minutesOf(pd.start), b = U.minutesOf(pd.end);
          if (a != null && b != null) minutes += Math.max(0, b - a);
        }
      }
    });
    return { courseCount: courseCount, sessions: sessions, minutes: minutes, hours: Math.round(minutes / 6) / 10 };
  };

  /** 本周时间冲突（按节次与周次判断），返回两两冲突的课程对 */
  D.findConflicts = function (entries, week) {
    var items = entries.filter(function (e) { return U.weeksContain(e.course.weeks, week); });
    var pairs = [];
    var ids = {};
    for (var i = 0; i < items.length; i++) {
      for (var j = i + 1; j < items.length; j++) {
        var a = items[i], b = items[j];
        if (a.course.day !== b.course.day) continue;
        if (a.course.startPeriod > b.course.endPeriod || b.course.startPeriod > a.course.endPeriod) continue;
        pairs.push({ a: a, b: b, day: a.course.day, start: Math.max(a.course.startPeriod, b.course.startPeriod), end: Math.min(a.course.endPeriod, b.course.endPeriod) });
        ids[a.course.id] = 1;
        ids[b.course.id] = 1;
      }
    }
    return { pairs: pairs, count: pairs.length, courseIds: Object.keys(ids) };
  };

  D.todayEntries = function (entries, schedule, date) {
    var d = date || U.today();
    var week = U.weekOf(d, U.parseDate(schedule.startDate));
    if (week < 1 || week > schedule.totalWeeks) return [];
    var day = ((d.getDay() + 6) % 7) + 1;
    return entries.filter(function (e) {
      return e.course.day === day && U.weeksContain(e.course.weeks, week);
    }).sort(function (a, b) { return a.course.startPeriod - b.course.startPeriod; });
  };

  function courseDate(e, schedule, week) {
    return U.dateOfWeek(U.parseDate(schedule.startDate), week, e.course.day);
  }

  /**
   * 下一节课/正在上的课。entries 为 [{course, schedule}]，以 baseSchedule 的周次日期为准。
   * 返回 { kind: 'ongoing'|'next', entry, date, start, end, startDate, endDate }
   */
  D.nextSession = function (entries, schedule, now) {
    now = now || new Date();
    var today = U.startOfDay(now);
    var start = U.parseDate(schedule.startDate);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var candidates = [];
    entries.forEach(function (e) {
      (e.course.weeks || []).forEach(function (week) {
        var date = courseDate(e, schedule, week);
        if (U.diffDays(today, date) < -1) return;
        var p1 = schedule.periods[e.course.startPeriod - 1];
        var p2 = schedule.periods[e.course.endPeriod - 1];
        if (!p1 || !p2) return;
        var st = U.minutesOf(p1.start), en = U.minutesOf(p2.end);
        if (st == null || en == null) return;
        var startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(st / 60), st % 60);
        var endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(en / 60), en % 60);
        if (endDate.getTime() <= now.getTime()) return;
        candidates.push({
          entry: e,
          week: week,
          date: date,
          start: st,
          end: en,
          startDate: startDate,
          endDate: endDate,
          ongoing: startDate.getTime() <= now.getTime() && endDate.getTime() > now.getTime()
        });
      });
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      if (a.ongoing !== b.ongoing) return a.ongoing ? -1 : 1;
      return a.startDate - b.startDate;
    });
    var pick = candidates[0];
    // 同一时间多门课（叠加冲突）时，返回同起点的全部课程
    var sameTime = candidates.filter(function (c) { return c.startDate.getTime() === pick.startDate.getTime(); });
    return {
      kind: pick.ongoing ? 'ongoing' : 'next',
      entry: pick.entry,
      entries: sameTime.map(function (c) { return c.entry; }),
      date: pick.date,
      start: pick.start,
      end: pick.end,
      startDate: pick.startDate,
      endDate: pick.endDate,
      week: pick.week
    };
  };

  /* ---------- 颜色与合并 ---------- */
  D.courseColor = function (courses, name) {
    var used = {}, same = null;
    courses.forEach(function (c) {
      used[c.color] = 1;
      if (c.name === name) same = c.color;
    });
    if (same) return same;
    for (var i = 0; i < D.PALETTE.length; i++) {
      if (!used[D.PALETTE[i].id]) return D.PALETTE[i].id;
    }
    var names = {};
    courses.forEach(function (c) { names[c.name] = 1; });
    return D.PALETTE[Object.keys(names).length % D.PALETTE.length].id;
  };

  D.recolorCourses = function (courses, preferred) {
    var colorByName = {};
    if (preferred) {
      preferred.forEach(function (c) { if (c.name && c.color) colorByName[c.name] = c.color; });
    }
    var used = {};
    Object.keys(colorByName).forEach(function (n) { used[colorByName[n]] = 1; });
    var cursor = 0;
    courses.forEach(function (c) {
      if (colorByName[c.name]) { c.color = colorByName[c.name]; return; }
      var tries = 0;
      while (tries < D.PALETTE.length && used[D.PALETTE[cursor % D.PALETTE.length].id]) { cursor++; tries++; }
      var id = D.PALETTE[cursor % D.PALETTE.length].id;
      c.color = id;
      used[id] = 1;
      colorByName[c.name] = id;
      cursor++;
    });
    return courses;
  };

  D.mergeSchedules = function (base, others) {
    var all = [base].concat(others || []);
    var periods = base.periods.map(function (p) { return { start: p.start, end: p.end }; });
    var courses = [];
    var seen = {};
    var totalWeeks = base.totalWeeks;
    var days = base.days;
    all.forEach(function (sch) {
      totalWeeks = Math.max(totalWeeks, sch.totalWeeks || 1);
      days = Math.max(days, sch.days || 1);
      (sch.courses || []).forEach(function (c) {
        var key = [c.name, c.day, c.startPeriod, c.endPeriod].join('|');
        var weekKey = (c.weeks || []).join(',');
        var fullKey = key + '|' + weekKey;
        if (seen[fullKey]) return;
        seen[fullKey] = 1;
        var copy = JSON.parse(JSON.stringify(c));
        copy.id = U.uid('crs');
        copy.createdAt = Date.now();
        if (copy.endPeriod > periods.length) periods = D.extendPeriods(periods, copy.endPeriod);
        days = Math.max(days, copy.day || 1);
        (copy.weeks || []).forEach(function (w) { totalWeeks = Math.max(totalWeeks, w); });
        courses.push(copy);
      });
    });
    courses.sort(function (a, b) { return a.day - b.day || a.startPeriod - b.startPeriod || a.name.localeCompare(b.name, 'zh'); });
    D.recolorCourses(courses, base.courses);
    var now = Date.now();
    return {
      id: U.uid('sch'),
      name: '合并课表 · ' + U.fmtMD(U.today()),
      startDate: base.startDate,
      totalWeeks: totalWeeks,
      days: days,
      periods: periods,
      courses: courses,
      demo: false,
      createdAt: now,
      updatedAt: now
    };
  };

  /* ---------- 任务查询与提醒 ---------- */
  D.taskTypeInfo = taskTypeInfo;

  D.taskDateTime = function (t) {
    var d = U.parseDate(t && t.date) || U.today();
    var mins = U.minutesOf(t && t.start);
    if (mins == null) mins = 9 * 60;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60);
  };

  D.taskEndDateTime = function (t) {
    var d = U.parseDate(t && t.date) || U.today();
    var mins = U.minutesOf(t && t.end);
    if (mins == null) mins = U.minutesOf(t && t.start);
    if (mins == null) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60);
  };

  D.taskReminderAt = function (t) {
    if (!t || t.remind == null) return null;
    var base = D.taskDateTime(t);
    return new Date(base.getTime() - (parseInt(t.remind, 10) || 0) * 60000);
  };

  D.taskTimeText = function (t) {
    if (!t || !t.start) return '全天';
    return t.start + (t.end && t.end !== t.start ? '–' + t.end : '');
  };

  D.taskSort = function (a, b) {
    var da = U.parseDate(a.date), db = U.parseDate(b.date);
    var ta = da ? da.getTime() : 0, tb = db ? db.getTime() : 0;
    if (ta !== tb) return ta - tb;
    var sa = a.start || '00:00', sb = b.start || '00:00';
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (a.priority !== b.priority) return (b.priority || 0) - (a.priority || 0);
    return (a.createdAt || 0) - (b.createdAt || 0);
  };

  D.tasksSorted = function (tasks) {
    return (Array.isArray(tasks) ? tasks.slice() : []).sort(D.taskSort);
  };

  D.tasksOnDate = function (tasks, date) {
    var key = U.toDateInput(date);
    return (Array.isArray(tasks) ? tasks : []).filter(function (t) { return t.date === key; });
  };

  D.taskCounts = function (tasks, now) {
    var today = U.startOfDay(now || new Date());
    var todayKey = U.toDateInput(today);
    var weekEnd = U.addDays(U.startOfWeekMonday(today), 6);
    var counts = { total: 0, open: 0, done: 0, today: 0, todayAll: 0, week: 0, doneWeek: 0, overdue: 0, doneToday: 0, rate: 0 };
    (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
      counts.total++;
      var d = U.parseDate(t.date);
      var isToday = t.date === todayKey;
      if (isToday) counts.todayAll++;
      if (t.done) {
        counts.done++;
        if (isToday) counts.doneToday++;
        if (d && d >= U.startOfWeekMonday(today) && d <= weekEnd) counts.doneWeek++;
        return;
      }
      counts.open++;
      if (isToday) counts.today++;
      if (d && d < today) counts.overdue++;
      if (d && d >= today && d <= weekEnd) counts.week++;
    });
    counts.rate = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
    return counts;
  };

  D.nextReminder = function (tasks, now) {
    var at = now ? new Date(now) : new Date();
    var best = null;
    (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
      if (t.done || t.remind == null) return;
      var when = D.taskReminderAt(t);
      if (!when || when.getTime() <= at.getTime()) return;
      if (!best || when < best.at) best = { task: t, at: when };
    });
    return best;
  };

  D.reminderDue = function (tasks, now, windowMs) {
    var at = now ? new Date(now) : new Date();
    var span = Math.max(1000, parseInt(windowMs, 10) || 120000);
    var out = [];
    (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
      if (t.done || t.remind == null) return;
      var when = D.taskReminderAt(t);
      if (!when) return;
      var diff = at.getTime() - when.getTime();
      if (diff < 0 || diff > span) return;
      if (t.remindedAt) {
        var old = new Date(t.remindedAt).getTime();
        if (!isNaN(old) && Math.abs(old - when.getTime()) < span) return;
      }
      out.push({ task: t, at: when, diff: diff });
    });
    return out;
  };

  /* ---------- 导出 ========== */
  D.icsEscape = function (s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  };

  function foldIcsLine(line) {
    var out = '';
    var bytes = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var b = new TextEncoder().encode(ch).length;
      if (bytes + b > 73) {
        out += '\r\n ';
        bytes = 1;
      }
      out += ch;
      bytes += b;
    }
    return out;
  }

  D.exportICS = function (schedule, tasks) {
    var start = schedule ? U.parseDate(schedule.startDate) : null;
    var calName = schedule ? schedule.name : '课序任务';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ClassFlow//课程表//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + D.icsEscape(calName),
      'X-WR-TIMEZONE:Asia/Shanghai'
    ];
    if (schedule && start) {
      (schedule.courses || []).forEach(function (c) {
        (c.weeks || []).forEach(function (week) {
          var date = U.dateOfWeek(start, week, c.day);
          var p1 = schedule.periods[c.startPeriod - 1], p2 = schedule.periods[c.endPeriod - 1];
          if (!p1 || !p2) return;
          var y = date.getFullYear(), m = U.pad2(date.getMonth() + 1), d = U.pad2(date.getDate());
          var st = p1.start.replace(':', ''), en = p2.end.replace(':', '');
          var desc = [];
          if (c.teacher) desc.push('教师：' + c.teacher);
          desc.push('周次：' + U.formatWeeks(c.weeks));
          if (c.note) desc.push(c.note);
          lines.push('BEGIN:VEVENT');
          lines.push('UID:' + c.id + '-' + week + '@classflow.local');
          lines.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'));
          lines.push('DTSTART:' + y + m + d + 'T' + st + '00');
          lines.push('DTEND:' + y + m + d + 'T' + en + '00');
          lines.push('SUMMARY:' + D.icsEscape(c.name));
          if (c.location) lines.push('LOCATION:' + D.icsEscape(c.location));
          lines.push('DESCRIPTION:' + D.icsEscape(desc.join('\n')));
          lines.push('END:VEVENT');
        });
      });
    }

    (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
      var date = U.parseDate(t.date);
      if (!date) return;
      var y = date.getFullYear(), m = U.pad2(date.getMonth() + 1), d = U.pad2(date.getDate());
      var type = taskTypeInfo(t.type);
      var desc = ['类型：' + type.name];
      if (t.priority) desc.push('优先级：' + D.PRIORITIES[t.priority].name);
      if (t.location) desc.push('地点：' + t.location);
      if (t.note) desc.push(t.note);
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + t.id + '@classflow.local');
      lines.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'));
      var startMins = U.minutesOf(t.start);
      if (startMins != null) {
        var endMins = U.minutesOf(t.end);
        if (endMins == null || endMins <= startMins) endMins = startMins + 60;
        endMins = Math.min(23 * 60 + 59, endMins);
        var sh = U.pad2(Math.floor(startMins / 60)), sm = U.pad2(startMins % 60);
        var eh = U.pad2(Math.floor(endMins / 60)), em = U.pad2(endMins % 60);
        lines.push('DTSTART:' + y + m + d + 'T' + sh + sm + '00');
        lines.push('DTEND:' + y + m + d + 'T' + eh + em + '00');
      } else {
        var next = U.addDays(date, 1);
        lines.push('DTSTART;VALUE=DATE:' + y + m + d);
        lines.push('DTEND;VALUE=DATE:' + next.getFullYear() + U.pad2(next.getMonth() + 1) + U.pad2(next.getDate()));
      }
      lines.push('SUMMARY:' + D.icsEscape('[' + type.name + '] ' + t.title));
      if (t.location) lines.push('LOCATION:' + D.icsEscape(t.location));
      lines.push('DESCRIPTION:' + D.icsEscape(desc.join('\n')));
      if (t.done) lines.push('STATUS:COMPLETED');
      if (t.start && t.remind != null) {
        lines.push('BEGIN:VALARM');
        lines.push('TRIGGER:-PT' + (parseInt(t.remind, 10) || 0) + 'M');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:' + D.icsEscape('课序提醒：' + t.title));
        lines.push('END:VALARM');
      }
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.map(foldIcsLine).join('\r\n') + '\r\n';
  };
})();
