/* 课序 ClassFlow — 应用逻辑与交互 */
(function () {
  'use strict';
  var CF = window.CF = window.CF || {};
  var U = CF.Util, D = CF.Data, R = CF.Render, UI = CF.UI, P = CF.Parse;
  var App = CF.App = {};

  var state = null;
  var view = { week: 1, mode: 'week', overlayIds: [], taskFilter: 'open' };
  var now = new Date();
  var weekMenuOpen = false;
  var storageWarned = false;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var liveTimer = null;
  var reminderTimer = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) { return U.esc(v == null ? '' : v); }
  function toast(msg, type, ms) { UI.toast(msg, type, ms); }
  function clock(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    return U.pad2(Math.floor(mins / 60)) + ':' + U.pad2(mins % 60);
  }

  /* ---------- 状态 ---------- */
  function saveState() {
    var ok = D.save(state);
    if (!ok && !storageWarned) {
      storageWarned = true;
      toast('本地保存失败，刷新页面后改动可能丢失。请检查浏览器存储权限。', 'warn', 6000);
    }
  }

  function activeSchedule() { return D.activeSchedule(state); }

  function buildView() {
    var schedule = activeSchedule();
    if (!schedule) {
      schedule = D.emptySchedule({ name: '我的课程表' });
      state.schedules.push(schedule);
      state.activeId = schedule.id;
    }
    var total = schedule.totalWeeks;
    var actual = U.clamp(D.actualWeek(schedule, now), 1, total);
    if (!view.week || !isFinite(view.week)) view.week = actual;
    view.week = U.clamp(Math.round(view.week), 1, total);

    var ids = [schedule.id];
    (view.overlayIds || []).forEach(function (id) {
      if (id !== schedule.id && D.scheduleById(state, id) && ids.indexOf(id) < 0) ids.push(id);
    });
    view.overlayIds = ids.slice(1);
    var overlaySchedules = ids.slice(1).map(function (id) { return D.scheduleById(state, id); });

    var entries = D.entriesOf(state, ids, view.week);
    var allEntries = D.entriesOf(state, ids, null);
    var conflicts = D.findConflicts(entries, view.week);
    var stats = D.weekStats(entries, schedule);
    var semester = D.semesterProgress(schedule, now);
    var todayList = D.todayEntries(allEntries, schedule, now);
    var next = D.nextSession(allEntries, schedule, now);
    var tasks = Array.isArray(state.tasks) ? state.tasks : [];
    var todayKey = U.toDateInput(now);
    var todayTime = U.startOfDay(now);
    var openTasks = tasks.filter(function (t) { return !t.done; });
    var todayTasks = openTasks.filter(function (t) { return t.date === todayKey; }).sort(D.taskSort);
    var overdueTasks = openTasks.filter(function (t) { return U.parseDate(t.date) < todayTime; }).sort(D.taskSort);
    var taskCounts = D.taskCounts(tasks, now);

    return {
      state: state,
      schedule: schedule,
      ids: ids,
      overlaySchedules: overlaySchedules,
      isOverlay: ids.length > 1,
      week: view.week,
      actualWeek: actual,
      mode: view.mode,
      now: now,
      entries: entries,
      allEntries: allEntries,
      conflicts: conflicts,
      stats: stats,
      semester: semester,
      todayList: todayList,
      next: next,
      tasks: tasks,
      memos: Array.isArray(state.memos) ? state.memos : [],
      taskCounts: taskCounts,
      todayTasks: todayTasks,
      overdueTasks: overdueTasks,
      taskFilter: view.taskFilter || 'open',
      notifyPermission: notificationPermission()
    };
  }

  /* ---------- 渲染 ---------- */
  function resolvedTheme() {
    var t = state.settings.theme || 'auto';
    if (t === 'auto') return mq && mq.matches ? 'dark' : 'light';
    return t;
  }

  function applyTheme() {
    var theme = resolvedTheme();
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1b1a17' : '#f5f3ee');
    var btn = $('#theme-btn');
    if (btn) {
      btn.innerHTML = U.icon(theme === 'dark' ? 'sun' : 'moon');
      var label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
  }

  function renderWeekMenu(v) {
    var menu = $('#week-menu');
    if (!menu) return;
    menu.innerHTML = R.weekMenu(v);
    menu.hidden = false;
    positionWeekMenu();
    var list = $('.week-menu-list', menu);
    var cur = $('.week-menu-item.is-current', menu);
    if (list && cur) list.scrollTop = Math.max(0, cur.offsetTop - list.clientHeight / 2 + cur.offsetHeight / 2);
  }

  function renderAll() {
    now = new Date();
    var v = buildView();
    $('#schedule-tabs').innerHTML = R.tabs(state);
    $('#weekbar').innerHTML = R.weekbar(v);
    $('#view-root').innerHTML = R.view(v);
    $('#rail').innerHTML = R.rail(v);
    $('#tip-slot').innerHTML = v.mode === 'tasks' ? '' : R.tip(state);
    var badge = $('#task-count-badge');
    if (badge) {
      badge.textContent = v.taskCounts.open;
      badge.hidden = !v.taskCounts.open;
    }
    applyTheme();
    document.title = v.mode === 'tasks' ? '任务与备忘 | 课序 ClassFlow' :
      v.schedule.name + ' · 第 ' + v.week + ' 周 | 课序 ClassFlow';
    if (weekMenuOpen) renderWeekMenu(v);
  }

  function renderLive() {
    if (UI.isModalOpen()) return;
    now = new Date();
    var wb = $('#weekbar'), rail = $('#rail'), vr = $('#view-root');
    if ((wb && wb.contains(document.activeElement)) || (rail && rail.contains(document.activeElement)) ||
        (vr && vr.contains(document.activeElement))) return;
    var v = buildView();
    if (wb) wb.innerHTML = R.weekbar(v);
    if (rail) rail.innerHTML = R.rail(v);
    if (v.mode === 'tasks' && vr) vr.innerHTML = R.view(v);
    var badge = $('#task-count-badge');
    if (badge) {
      badge.textContent = v.taskCounts.open;
      badge.hidden = !v.taskCounts.open;
    }
  }

  /* ---------- 周次菜单 ---------- */
  function positionWeekMenu() {
    var menu = $('#week-menu');
    var pill = $('.week-pill');
    if (!menu || !pill || menu.hidden) return;
    var r = pill.getBoundingClientRect();
    var width = menu.offsetWidth || 280;
    var left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    var top = r.bottom + 8;
    if (top + Math.min(menu.offsetHeight || 360, 380) > window.innerHeight - 12) {
      top = Math.max(12, r.top - Math.min(menu.offsetHeight || 360, 380) - 8);
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function openWeekMenu() {
    if (weekMenuOpen) { closeWeekMenu(); return; }
    weekMenuOpen = true;
    renderWeekMenu(buildView());
    requestAnimationFrame(positionWeekMenu);
  }

  function closeWeekMenu() {
    if (!weekMenuOpen) return;
    weekMenuOpen = false;
    var menu = $('#week-menu');
    if (menu) {
      menu.hidden = true;
      menu.innerHTML = '';
    }
  }

  /* ---------- 课程表切换 / 新建 ---------- */
  function switchSchedule(id) {
    if (!D.scheduleById(state, id)) return;
    state.activeId = id;
    view.overlayIds = view.overlayIds.filter(function (x) { return x !== id; });
    view.mode = 'week';
    saveState();
    renderAll();
  }

  function createSchedule() {
    var names = {};
    state.schedules.forEach(function (s) { names[s.name] = 1; });
    var name = '我的课程表', i = 2;
    while (names[name]) name = '我的课程表 ' + (i++);
    var term = U.guessTerm();
    var sched = D.emptySchedule({ name: name, startDate: term.startDate, totalWeeks: 20 });
    state.schedules.push(sched);
    state.activeId = sched.id;
    view.overlayIds = [];
    view.mode = 'week';
    view.week = U.clamp(D.actualWeek(sched, now), 1, sched.totalWeeks);
    saveState();
    renderAll();
    toast('已新建「' + name + '」，可在设置中重命名', 'success');
  }

  function goWeek(n) {
    var s = activeSchedule();
    view.week = U.clamp(n, 1, s.totalWeeks);
    renderAll();
  }

  function goToday() {
    var s = activeSchedule();
    view.week = U.clamp(D.actualWeek(s, now), 1, s.totalWeeks);
    view.mode = 'week';
    renderAll();
  }

  function dismissTip() {
    state.settings.tipDismissed = true;
    saveState();
    $('#tip-slot').innerHTML = '';
  }

  /* ---------- 通知与提醒 ---------- */
  function notificationPermission() {
    return ('Notification' in window) ? Notification.permission : 'unsupported';
  }

  function requestNotificationPermission() {
    if (!('Notification' in window)) {
      toast('当前浏览器不支持桌面通知，页面内的提醒仍然有效', 'info');
      return Promise.resolve('unsupported');
    }
    if (Notification.permission === 'granted') {
      toast('桌面提醒已经开启', 'success');
      renderAll();
      return Promise.resolve('granted');
    }
    if (Notification.permission === 'denied') {
      toast('浏览器已拒绝通知，请在地址栏的网站设置中重新允许', 'warn', 5000);
      renderAll();
      return Promise.resolve('denied');
    }
    return Notification.requestPermission().then(function (permission) {
      if (permission === 'granted') toast('桌面提醒已开启', 'success');
      else toast('没有开启桌面提醒，页面内提醒仍然有效', 'info');
      renderAll();
      return permission;
    }).catch(function () {
      toast('无法请求通知权限，页面内提醒仍然有效', 'warn');
      return 'default';
    });
  }

  function showTaskNotification(t) {
    if (notificationPermission() !== 'granted') return;
    try {
      var type = D.taskTypeInfo(t.type);
      var body = type.name + ' · ' + D.taskTimeText(t) + (t.location ? ' · ' + t.location : '');
      var n = new Notification('课序提醒 · ' + t.title, {
        body: body,
        tag: 'classflow-task-' + t.id,
        renotify: false
      });
      n.onclick = function () {
        window.focus();
        try { n.close(); } catch (e) {}
        openTaskForm(t.id);
      };
    } catch (e) {}
  }

  function checkReminders() {
    if (!state || !Array.isArray(state.tasks)) return;
    var due = D.reminderDue(state.tasks, new Date(), 120000);
    if (!due.length) return;
    due.forEach(function (item) {
      var t = item.task;
      t.remindedAt = item.at.toISOString();
      t.updatedAt = Date.now();
      var type = D.taskTypeInfo(t.type);
      toast('提醒 · ' + t.title + '（' + type.name + ' · ' + D.taskTimeText(t) + '）', 'warn', 12000);
      showTaskNotification(t);
    });
    saveState();
  }

  /* ---------- 任务与备忘 ---------- */
  function findTask(id) {
    var list = Array.isArray(state.tasks) ? state.tasks : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function findMemo(id) {
    var list = Array.isArray(state.memos) ? state.memos : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function openTaskForm(taskId, opts) {
    opts = opts || {};
    var editing = taskId ? findTask(taskId) : null;
    if (taskId && !editing) { toast('任务不存在，可能已被删除', 'error'); return; }
    var modal = UI.openModal({
      title: editing ? '编辑任务' : '新建任务',
      subtitle: editing ? D.taskTypeInfo(editing.type).name + ' · ' + editing.date : '活动、会议、作业和提醒都可以记在这里',
      size: 'lg',
      body: R.taskForm(editing || null, { date: opts.date }),
      footer:
        '<button type="button" class="btn btn-ghost" data-modal-close="1">取消</button>' +
        (editing ? '<button type="button" class="btn btn-danger-ghost task-delete-btn" id="tf-delete">' + U.icon('trash') + '删除</button>' : '') +
        '<button type="button" class="btn btn-primary" id="tf-save">' + (editing ? '保存修改' : '添加任务') + '</button>',
      onMount: function (panel, bodyEl, foot) {
        function fail(msg, selector) {
          toast(msg, 'error');
          var el = $(selector, bodyEl);
          if (el) el.focus();
        }

        function save() {
          var title = $('#tf-title', bodyEl).value.trim();
          if (!title) { fail('请填写任务标题', '#tf-title'); return; }
          var date = $('#tf-date', bodyEl).value;
          if (!U.parseDate(date)) { fail('请选择有效的日期', '#tf-date'); return; }
          var start = $('#tf-start', bodyEl).value;
          var end = $('#tf-end', bodyEl).value;
          if (!start && end) { fail('先填写开始时间，或把结束时间也留空', '#tf-start'); return; }
          if (start && end && U.minutesOf(end) <= U.minutesOf(start)) {
            fail('结束时间需要晚于开始时间', '#tf-end'); return;
          }
          var candidate = D.normalizeTask({
            id: editing ? editing.id : undefined,
            title: title,
            type: $('#tf-type', bodyEl).value,
            date: date,
            start: start,
            end: end,
            location: $('#tf-location', bodyEl).value,
            note: $('#tf-note', bodyEl).value,
            priority: parseInt($('#tf-priority', bodyEl).value, 10) || 0,
            remind: $('#tf-remind', bodyEl).value === '' ? null : parseInt($('#tf-remind', bodyEl).value, 10),
            done: editing ? editing.done : false,
            doneAt: editing ? editing.doneAt : null,
            createdAt: editing ? editing.createdAt : undefined,
            updatedAt: Date.now()
          });
          if (!candidate) { toast('任务内容不完整', 'error'); return; }
          var reminderChanged = !editing || editing.date !== candidate.date ||
            editing.start !== candidate.start || editing.remind !== candidate.remind;
          candidate.remindedAt = editing && !reminderChanged ? editing.remindedAt : null;
          if (editing) {
            var idx = -1;
            state.tasks.forEach(function (t, i) { if (t.id === editing.id) idx = i; });
            if (idx >= 0) state.tasks[idx] = candidate;
          } else {
            state.tasks.push(candidate);
          }
          if (view.mode === 'tasks' && !editing) view.taskFilter = 'open';
          saveState();
          UI.closeModal(true);
          renderAll();
          toast(editing ? '任务已更新' : '已加入任务清单', 'success');
        }

        $('#tf-save', foot).addEventListener('click', save);
        bodyEl.addEventListener('keydown', function (e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
        });

        var del = $('#tf-delete', foot);
        if (del) {
          del.addEventListener('click', function () {
            UI.confirm({
              title: '删除这个任务？',
              message: '「' + esc(editing.title) + '」将从任务清单中移除。',
              detail: '此操作无法撤销。',
              confirmText: '删除任务',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              state.tasks = state.tasks.filter(function (t) { return t.id !== editing.id; });
              saveState();
              UI.closeModal(true);
              renderAll();
              toast('任务已删除', 'success');
            });
          });
        }
      }
    });
    return modal;
  }

  function openMemoForm(memoId) {
    var editing = memoId ? findMemo(memoId) : null;
    if (memoId && !editing) { toast('备忘不存在', 'error'); return; }
    UI.openModal({
      title: editing ? '编辑备忘' : '新建备忘',
      subtitle: '随手记下想法、网址、要买的东西…',
      size: 'sm',
      body:
        '<form class="memo-form-modal" id="memo-form" autocomplete="off">' +
          '<textarea id="mf-text" class="input" rows="6" maxlength="1000" placeholder="写点什么…">' +
            esc(editing ? editing.text : '') + '</textarea>' +
          '<label class="memo-pin-row"><input type="checkbox" id="mf-pinned"' + (editing && editing.pinned ? ' checked' : '') + '>' +
            '<span>置顶这条备忘</span></label>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-ghost" data-modal-close="1">取消</button>' +
        (editing ? '<button type="button" class="btn btn-danger-ghost task-delete-btn" id="mf-delete">' + U.icon('trash') + '删除</button>' : '') +
        '<button type="button" class="btn btn-primary" id="mf-save">' + (editing ? '保存修改' : '添加备忘') + '</button>',
      onMount: function (panel, bodyEl, foot) {
        $('#mf-save', foot).addEventListener('click', function () {
          var text = $('#mf-text', bodyEl).value.trim();
          if (!text) { toast('备忘不能为空', 'error'); $('#mf-text', bodyEl).focus(); return; }
          var pinned = $('#mf-pinned', bodyEl).checked;
          if (editing) {
            editing.text = text;
            editing.pinned = pinned;
            editing.updatedAt = Date.now();
          } else {
            state.memos.push(D.normalizeMemo({ text: text, pinned: pinned }));
          }
          saveState();
          UI.closeModal(true);
          renderAll();
          toast(editing ? '备忘已更新' : '备忘已添加', 'success');
        });
        var del = $('#mf-delete', foot);
        if (del) {
          del.addEventListener('click', function () {
            UI.confirm({
              title: '删除这条备忘？',
              message: '「' + esc(editing.text.slice(0, 40)) + (editing.text.length > 40 ? '…' : '') + '」',
              detail: '此操作无法撤销。',
              confirmText: '删除备忘',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              state.memos = state.memos.filter(function (m) { return m.id !== editing.id; });
              saveState();
              UI.closeModal(true);
              renderAll();
              toast('备忘已删除', 'success');
            });
          });
        }
      }
    });
  }

  function toggleTask(id) {
    var t = findTask(id);
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    t.updatedAt = Date.now();
    saveState();
    renderAll();
    toast(t.done ? '完成「' + t.title + '」' : '已恢复「' + t.title + '」', t.done ? 'success' : 'info');
  }

  function toggleMemoPin(id) {
    var m = findMemo(id);
    if (!m) return;
    m.pinned = !m.pinned;
    m.updatedAt = Date.now();
    saveState();
    renderAll();
  }

  function deleteTask(id) {
    var t = findTask(id);
    if (!t) return;
    UI.confirm({
      title: '删除这个任务？',
      message: '「' + esc(t.title) + '」将从任务清单中移除。',
      detail: '此操作无法撤销。',
      confirmText: '删除任务',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
      saveState();
      renderAll();
      toast('任务已删除', 'success');
    });
  }

  function deleteMemo(id) {
    var m = findMemo(id);
    if (!m) return;
    UI.confirm({
      title: '删除这条备忘？',
      message: '「' + esc(m.text.slice(0, 40)) + (m.text.length > 40 ? '…' : '') + '」',
      detail: '此操作无法撤销。',
      confirmText: '删除备忘',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      state.memos = state.memos.filter(function (x) { return x.id !== id; });
      saveState();
      renderAll();
      toast('备忘已删除', 'success');
    });
  }

  function addQuickTask(text) {
    text = String(text || '').trim();
    if (!text) { toast('先写下要做的事', 'warn'); $('#task-quick-input') && $('#task-quick-input').focus(); return false; }
    state.tasks.push(D.normalizeTask({ title: text, date: U.toDateInput(now), type: 'task' }));
    view.taskFilter = 'open';
    saveState();
    renderAll();
    toast('已加入今天待办', 'success');
    var input = $('#task-quick-input');
    if (input) input.focus();
    return true;
  }

  function addQuickMemo(text) {
    text = String(text || '').trim();
    if (!text) { var input = $('#memo-quick-input'); if (input) input.focus(); return false; }
    state.memos.push(D.normalizeMemo({ text: text }));
    saveState();
    renderAll();
    toast('备忘已添加', 'success');
    var again = $('#memo-quick-input');
    if (again) again.focus();
    return true;
  }

  /* ---------- 课程详情 ---------- */
  function findCourse(scheduleId, courseId) {
    var schedule = D.scheduleById(state, scheduleId);
    if (!schedule) return null;
    var course = null;
    (schedule.courses || []).forEach(function (c) { if (c.id === courseId) course = c; });
    if (!course) return null;
    return { schedule: schedule, course: course };
  }

  function periodRange(schedule, course) {
    var a = schedule.periods[course.startPeriod - 1];
    var b = schedule.periods[course.endPeriod - 1];
    return { start: a ? a.start : '', end: b ? b.end : '' };
  }

  function courseDates(schedule, course) {
    if (!course.weeks || !course.weeks.length) return '';
    var start = U.parseDate(schedule.startDate);
    var first = U.dateOfWeek(start, course.weeks[0], course.day);
    var last = U.dateOfWeek(start, course.weeks[course.weeks.length - 1], course.day);
    return U.fmtRange(first, last, 'cn');
  }

  function openCourseDetail(scheduleId, courseId) {
    var found = findCourse(scheduleId, courseId);
    if (!found) { toast('课程不存在，可能已被删除', 'error'); return; }
    var schedule = found.schedule, course = found.course;
    var p = D.paletteById(course.color);
    var range = periodRange(schedule, course);
    var prog = D.courseProgress(course, schedule, now);
    var weeks = course.weeks && course.weeks.length ? U.formatWeeks(course.weeks) : '未设置';
    var dates = courseDates(schedule, course);
    var pct = U.clamp(Math.round(prog.pct), 0, 100);
    var style = '--c-light:' + p.light + ';--c-dark:' + p.dark + ';--c-soft-light:' + U.hexToRgba(p.light, 0.12) + ';--c-soft-dark:' + U.hexToRgba(p.dark, 0.17);

    var body =
      '<div class="course-detail" style="' + style + '">' +
        '<div class="cd-hero">' +
          '<span class="cd-color"></span>' +
          '<div class="cd-hero-main"><strong>' + esc(course.name) + '</strong>' +
            '<span>' + esc(schedule.name) + ' · ' + U.WEEKDAY_FULL[course.day - 1] + ' 第 ' + course.startPeriod +
            (course.endPeriod !== course.startPeriod ? '–' + course.endPeriod : '') + ' 节</span></div>' +
          (schedule.demo ? '<span class="cd-badge">示例</span>' : '') +
        '</div>' +
        '<div class="cd-grid">' +
          '<div class="cd-cell"><span>授课教师</span><strong>' + esc(course.teacher || '未填写') + '</strong></div>' +
          '<div class="cd-cell"><span>上课地点</span><strong>' + esc(course.location || '未填写') + '</strong></div>' +
          '<div class="cd-cell"><span>上课时间</span><strong>' + (range.start ? esc(range.start) + ' – ' + esc(range.end) : '节次待调整') + '</strong></div>' +
          '<div class="cd-cell"><span>上课周次</span><strong>' + esc(weeks) + '</strong>' +
            (dates ? '<small>' + esc(dates) + '</small>' : '') + '</div>' +
        '</div>' +
        '<div class="cd-progress">' +
          '<div class="cd-progress-head"><span>课程进度</span><strong>' + pct + '%</strong></div>' +
          '<div class="cd-progress-track"><i style="width:' + pct + '%"></i></div>' +
          '<p>' + (prog.manual != null ? '手动设置' : '按周次自动计算') + ' · 已完成 ' + prog.done + ' / ' + prog.total + ' 节' + '</p>' +
        '</div>' +
        (course.note ? '<div class="cd-note"><span>备注</span><p>' + esc(course.note) + '</p></div>' : '') +
      '</div>';

    var modal = UI.openModal({
      title: course.name,
      subtitle: '课程详情',
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="btn btn-danger-ghost" id="cd-delete">' + U.icon('trash') + '删除</button>' +
        '<span class="foot-spacer"></span>' +
        '<button type="button" class="btn btn-ghost" data-modal-close="1">关闭</button>' +
        '<button type="button" class="btn btn-primary" id="cd-edit">' + U.icon('edit') + '编辑</button>'
    });

    var foot = modal.foot;
    $('#cd-edit', foot).addEventListener('click', function () {
      UI.closeModal(true);
      openCourseForm({ scheduleId: schedule.id, courseId: course.id });
    });
    $('#cd-delete', foot).addEventListener('click', function () {
      UI.confirm({
        title: '删除这门课程？',
        message: '「' + esc(course.name) + '」会从「' + esc(schedule.name) + '」中移除。',
        detail: '此操作无法撤销。',
        confirmText: '删除',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        schedule.courses = schedule.courses.filter(function (c) { return c.id !== course.id; });
        schedule.updatedAt = Date.now();
        saveState();
        UI.closeModal(true);
        renderAll();
        toast('已删除「' + course.name + '」', 'success');
      });
    });
  }

  /* ---------- 课程表单 ---------- */
  function courseConflictNames(schedule, candidate) {
    var names = {};
    candidate.weeks.forEach(function (week) {
      var entries = [{ course: candidate, schedule: schedule }];
      (schedule.courses || []).forEach(function (c) {
        if (c.id !== candidate.id) entries.push({ course: c, schedule: schedule });
      });
      var res = D.findConflicts(entries, week);
      res.pairs.forEach(function (pair) {
        var a = pair.a.course, b = pair.b.course;
        if (a.id === candidate.id) names[b.name] = 1;
        else if (b.id === candidate.id) names[a.name] = 1;
      });
    });
    return Object.keys(names);
  }

  function openCourseForm(opts) {
    opts = opts || {};
    var schedule = D.scheduleById(state, opts.scheduleId) || activeSchedule();
    if (!schedule) return;
    var editing = null;
    if (opts.courseId) {
      (schedule.courses || []).forEach(function (c) { if (c.id === opts.courseId) editing = c; });
      if (!editing) { toast('课程不存在', 'error'); return; }
    }
    var total = schedule.totalWeeks;
    var periodCount = Math.max((schedule.periods || []).length, 1);
    var defaultDay = editing ? editing.day : (opts.day || ((new Date().getDay() + 6) % 7) + 1);
    defaultDay = U.clamp(defaultDay, 1, 7);
    var defaultStart = editing ? editing.startPeriod : (opts.period || 1);
    var defaultEnd = editing ? editing.endPeriod : Math.min(defaultStart + 1, Math.max(defaultStart, periodCount));
    var defaultWeeks = editing && editing.weeks && editing.weeks.length ? editing.weeks.slice() : [];
    if (!defaultWeeks.length) for (var w = 1; w <= total; w++) defaultWeeks.push(w);
    var selectedColor = editing ? editing.color : D.courseColor(schedule.courses || [], '');
    var days = [];
    for (var d = 1; d <= 7; d++) days.push('<option value="' + d + '"' + (d === defaultDay ? ' selected' : '') + '>' + U.WEEKDAY_FULL[d - 1] + '</option>');
    var startOpts = [], endOpts = [];
    for (var p = 1; p <= Math.max(periodCount, defaultEnd); p++) {
      var pd = schedule.periods[p - 1];
      var label = '第 ' + p + ' 节' + (pd ? ' · ' + pd.start : '');
      startOpts.push('<option value="' + p + '"' + (p === defaultStart ? ' selected' : '') + '>' + label + '</option>');
      endOpts.push('<option value="' + p + '"' + (p === defaultEnd ? ' selected' : '') + '>' + label + '</option>');
    }
    var colorButtons = D.PALETTE.map(function (cp) {
      return '<button type="button" class="color-swatch' + (cp.id === selectedColor ? ' is-active' : '') + '"' +
        ' data-color="' + cp.id + '" style="--c:' + cp.light + '" title="' + esc(cp.name) + '"' +
        ' aria-label="' + esc(cp.name) + '" aria-pressed="' + (cp.id === selectedColor ? 'true' : 'false') + '">' +
        '<span></span></button>';
    }).join('');

    var body =
      '<form class="course-form" id="course-form" novalidate>' +
        '<p class="form-error" id="cf-error" hidden></p>' +
        '<div class="field field-wide">' +
          '<label for="cf-name">课程名称 <em>*</em></label>' +
          '<input id="cf-name" class="input" maxlength="60" autocomplete="off" value="' + esc(editing ? editing.name : '') + '" placeholder="例如：高等数学">' +
        '</div>' +
        '<div class="field"><label for="cf-teacher">授课教师</label>' +
          '<input id="cf-teacher" class="input" maxlength="40" autocomplete="off" value="' + esc(editing ? editing.teacher : '') + '" placeholder="选填"></div>' +
        '<div class="field"><label for="cf-location">上课地点</label>' +
          '<input id="cf-location" class="input" maxlength="40" autocomplete="off" value="' + esc(editing ? editing.location : '') + '" placeholder="选填"></div>' +
        '<div class="field"><label for="cf-day">星期</label>' +
          '<select id="cf-day" class="input">' + days.join('') + '</select></div>' +
        '<div class="field"><label>节次</label>' +
          '<div class="period-pair"><select id="cf-start" class="input">' + startOpts.join('') + '</select>' +
          '<span>–</span><select id="cf-end" class="input">' + endOpts.join('') + '</select></div></div>' +
        '<div class="field field-wide">' +
          '<label for="cf-weeks">上课周次 <em>*</em></label>' +
          '<input id="cf-weeks" class="input" autocomplete="off" value="' + esc(U.formatWeeks(defaultWeeks)) + '" placeholder="例如：1-16周、1-15单周、2,4,6周">' +
          '<div class="quick-row">' +
            '<button type="button" class="chip" data-quick="all">全部周</button>' +
            '<button type="button" class="chip" data-quick="odd">单周</button>' +
            '<button type="button" class="chip" data-quick="even">双周</button>' +
            '<button type="button" class="chip" data-quick="clear">清空</button>' +
          '</div>' +
          '<p class="field-hint" id="cf-weeks-hint"></p>' +
        '</div>' +
        '<div class="field field-wide"><label>课程颜色</label>' +
          '<div class="color-picker" id="cf-colors">' + colorButtons + '</div></div>' +
        '<div class="field"><label for="cf-progress">手动进度</label>' +
          '<div class="input-suffix"><input id="cf-progress" class="input" type="number" min="0" max="100" step="1" placeholder="自动" value="' + (editing && editing.progress != null ? esc(editing.progress) : '') + '"><span>%</span></div>' +
          '<p class="field-hint" id="cf-progress-hint">留空则按周次自动计算</p></div>' +
        '<div class="field"><label for="cf-note">备注</label>' +
          '<input id="cf-note" class="input" maxlength="120" autocomplete="off" value="' + esc(editing ? editing.note : '') + '" placeholder="选填"></div>' +
      '</form>';

    var modal = UI.openModal({
      title: editing ? '编辑课程' : '添加课程',
      subtitle: schedule.name,
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="btn btn-ghost" data-modal-close="1">取消</button>' +
        '<button type="button" class="btn btn-primary" id="cf-save">' + (editing ? '保存修改' : '添加课程') + '</button>',
      onMount: function (panel, bodyEl) {
        var nameEl = $('#cf-name', bodyEl);
        var teacherEl = $('#cf-teacher', bodyEl);
        var locationEl = $('#cf-location', bodyEl);
        var dayEl = $('#cf-day', bodyEl);
        var startEl = $('#cf-start', bodyEl);
        var endEl = $('#cf-end', bodyEl);
        var weeksEl = $('#cf-weeks', bodyEl);
        var weeksHint = $('#cf-weeks-hint', bodyEl);
        var progressEl = $('#cf-progress', bodyEl);
        var progressHint = $('#cf-progress-hint', bodyEl);
        var noteEl = $('#cf-note', bodyEl);
        var errorEl = $('#cf-error', bodyEl);

        nameEl.focus();

        function parsedWeeks() {
          var raw = U.parseWeeks(weeksEl.value, total);
          var over = raw.filter(function (x) { return x > total; });
          var valid = raw.filter(function (x) { return x >= 1 && x <= total; });
          return { raw: raw, valid: valid, over: over };
        }

        function tempCourse() {
          return {
            name: nameEl.value.trim(),
            day: +dayEl.value,
            startPeriod: +startEl.value,
            endPeriod: +endEl.value,
            weeks: parsedWeeks().valid,
            progress: null,
            color: selectedColor
          };
        }

        function updateWeeksHint() {
          var res = parsedWeeks();
          weeksEl.classList.remove('is-invalid');
          if (!res.valid.length) {
            weeksHint.className = 'field-hint is-error';
            weeksHint.textContent = '没有识别到有效周次，请填写如 1-16周。';
            weeksEl.classList.add('is-invalid');
          } else {
            weeksHint.className = 'field-hint';
            weeksHint.textContent = '共 ' + res.valid.length + ' 周 · ' + U.formatWeeks(res.valid) +
              (res.over.length ? '；有 ' + res.over.length + ' 个周次超出本学期（' + total + ' 周），保存时会提示' : '');
          }
          updateProgressHint();
        }

        function updateProgressHint() {
          if (progressEl.value !== '') {
            var v = +progressEl.value;
            progressHint.className = 'field-hint';
            progressHint.textContent = isNaN(v) ? '请输入 0–100 的数字' : '将覆盖自动进度（' + U.clamp(Math.round(v), 0, 100) + '%）';
            return;
          }
          var tc = tempCourse();
          var pr = D.courseProgress(tc, schedule, now);
          progressHint.className = 'field-hint';
          progressHint.textContent = '自动进度 ' + pr.pct + '%（已完成 ' + pr.done + ' / ' + pr.total + ' 节）';
        }

        weeksEl.addEventListener('input', updateWeeksHint);
        progressEl.addEventListener('input', updateProgressHint);
        startEl.addEventListener('change', function () {
          if (+endEl.value < +startEl.value) endEl.value = startEl.value;
          updateProgressHint();
        });
        endEl.addEventListener('change', function () {
          if (+endEl.value < +startEl.value) startEl.value = endEl.value;
          updateProgressHint();
        });

        $$('[data-quick]', bodyEl).forEach(function (btn) {
          btn.addEventListener('click', function () {
            var kind = btn.getAttribute('data-quick');
            var arr = [];
            if (kind === 'all') {
              weeksEl.value = '1-' + total + '周';
            } else if (kind === 'odd' || kind === 'even') {
              for (var x = 1; x <= total; x++) if ((kind === 'odd' && x % 2 === 1) || (kind === 'even' && x % 2 === 0)) arr.push(x);
              weeksEl.value = U.formatWeeks(arr);
            } else {
              weeksEl.value = '';
            }
            updateWeeksHint();
          });
        });

        $$('#cf-colors .color-swatch', bodyEl).forEach(function (btn) {
          btn.addEventListener('click', function () {
            selectedColor = btn.getAttribute('data-color');
            $$('#cf-colors .color-swatch', bodyEl).forEach(function (b) {
              var on = b === btn;
              b.classList.toggle('is-active', on);
              b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
          });
        });

        function showError(msg) {
          errorEl.textContent = msg;
          errorEl.hidden = false;
          errorEl.scrollIntoView({ block: 'nearest' });
        }

        function save() {
          errorEl.hidden = true;
          var name = nameEl.value.trim();
          if (!name) {
            nameEl.classList.add('is-invalid');
            nameEl.focus();
            showError('请填写课程名称。');
            return;
          }
          nameEl.classList.remove('is-invalid');
          var res = parsedWeeks();
          if (!res.valid.length) {
            weeksEl.classList.add('is-invalid');
            weeksEl.focus();
            showError('周次格式无法识别，请填写如 1-16周、1-15单周。');
            return;
          }
          if (res.over.length) {
            weeksEl.classList.add('is-invalid');
            weeksEl.focus();
            showError('有 ' + res.over.length + ' 个周次超过本学期总周数（' + total + ' 周），请先修改周次或到设置中调整总周数。');
            return;
          }
          var start = U.clamp(+startEl.value, 1, Math.max(periodCount, +endEl.value));
          var end = U.clamp(+endEl.value, start, 60);
          var progress = null;
          if (progressEl.value !== '') {
            var pv = +progressEl.value;
            if (isNaN(pv) || pv < 0 || pv > 100) {
              progressEl.classList.add('is-invalid');
              progressEl.focus();
              showError('进度请填写 0 到 100 之间的数字，或留空使用自动进度。');
              return;
            }
            progress = Math.round(pv);
          }
          var candidate = {
            id: editing ? editing.id : U.uid('crs'),
            name: name,
            teacher: teacherEl.value.trim(),
            location: locationEl.value.trim(),
            day: +dayEl.value,
            startPeriod: start,
            endPeriod: end,
            weeks: res.valid,
            color: selectedColor,
            note: noteEl.value.trim(),
            progress: progress,
            createdAt: editing ? editing.createdAt : Date.now()
          };
          var conflicts = courseConflictNames(schedule, candidate);

          function commit() {
            if (editing) {
              for (var i = 0; i < schedule.courses.length; i++) {
                if (schedule.courses[i].id === editing.id) { schedule.courses[i] = candidate; break; }
              }
            } else {
              schedule.courses.push(candidate);
            }
            schedule.courses.sort(function (a, b) {
              return a.day - b.day || a.startPeriod - b.startPeriod || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
            });
            schedule.updatedAt = Date.now();
            saveState();
            UI.closeModal(true);
            renderAll();
            toast(editing ? '课程已更新' : '已添加「' + name + '」', 'success');
          }

          if (conflicts.length) {
            UI.confirm({
              title: '时间有重叠',
              message: '这门课与「' + esc(conflicts.join('、')) + '」的周次和节次有重叠。',
              detail: '保存后两门课会并排显示，并在课程表上标记冲突。仍然保存吗？',
              confirmText: '仍然保存'
            }).then(function (ok) { if (ok) commit(); });
          } else {
            commit();
          }
        }

        $('#cf-save', modal.foot).addEventListener('click', save);
        $('#course-form', bodyEl).addEventListener('submit', function (e) { e.preventDefault(); save(); });
        updateWeeksHint();
      }
    });
  }

  /* ---------- 设置 ---------- */
  function periodRow(p, i) {
    return '<div class="period-row" data-orig="' + i + '">' +
      '<span class="period-no">' + (i + 1) + '</span>' +
      '<input type="time" class="input period-start" value="' + esc(p.start) + '" step="60">' +
      '<span class="period-dash">–</span>' +
      '<input type="time" class="input period-end" value="' + esc(p.end) + '" step="60">' +
      '<button type="button" class="icon-btn period-del" data-del-period aria-label="删除第 ' + (i + 1) + ' 节">' + U.icon('trash') + '</button>' +
      '</div>';
  }

  function openSettings(startTab) {
    var schedule = activeSchedule();
    if (!schedule) return;
    var tab = startTab === 'general' ? 'general' : 'schedule';
    var periodRows = (schedule.periods || []).map(periodRow).join('');
    var theme = state.settings.theme || 'auto';
    var body =
      '<div class="settings-tabs" role="tablist">' +
        '<button type="button" class="settings-tab' + (tab === 'schedule' ? ' is-active' : '') + '" data-settings-tab="schedule">课程表</button>' +
        '<button type="button" class="settings-tab' + (tab === 'general' ? ' is-active' : '') + '" data-settings-tab="general">通用</button>' +
      '</div>' +
      '<section class="settings-panel" data-panel="schedule"' + (tab !== 'schedule' ? ' hidden' : '') + '>' +
        '<div class="settings-grid">' +
          '<div class="field field-wide"><label for="set-name">课程表名称</label>' +
            '<input id="set-name" class="input" maxlength="40" value="' + esc(schedule.name) + '"></div>' +
          '<div class="field"><label for="set-start">第一周周一</label>' +
            '<input id="set-start" class="input" type="date" value="' + esc(schedule.startDate) + '"></div>' +
          '<div class="field"><label for="set-weeks">总周数</label>' +
            '<input id="set-weeks" class="input" type="number" min="1" max="30" value="' + schedule.totalWeeks + '"></div>' +
          '<div class="field"><label for="set-days">每周显示天数</label>' +
            '<select id="set-days" class="input">' +
              '<option value="5"' + (schedule.days === 5 ? ' selected' : '') + '>周一到周五（5 天）</option>' +
              '<option value="6"' + (schedule.days === 6 ? ' selected' : '') + '>周一到周六（6 天）</option>' +
              '<option value="7"' + (schedule.days === 7 ? ' selected' : '') + '>完整一周（7 天）</option>' +
            '</select></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<div class="section-head"><div><h3>作息时间</h3><p>修改后课程会按节次自动对齐；删除正在被课程使用的节次会被阻止。</p></div>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="add-period">' + U.icon('plus') + '添加一节</button></div>' +
          '<div class="period-editor" id="period-editor">' + periodRows + '</div>' +
        '</div>' +
        '<div class="danger-zone">' +
          '<div><strong>删除这张课程表</strong><p>课程、周次和进度会一并删除，且无法撤销。</p></div>' +
          '<button type="button" class="btn btn-danger-ghost" id="delete-schedule"' + (state.schedules.length <= 1 ? ' disabled' : '') + '>' +
            U.icon('trash') + '删除</button>' +
        '</div>' +
      '</section>' +
      '<section class="settings-panel" data-panel="general"' + (tab !== 'general' ? ' hidden' : '') + '>' +
        '<div class="settings-section">' +
          '<div class="section-head"><div><h3>外观</h3><p>主题只影响当前浏览器。</p></div></div>' +
          '<div class="theme-options">' +
            '<label><input type="radio" name="settings-theme" value="auto"' + (theme === 'auto' ? ' checked' : '') + '><span>跟随系统</span></label>' +
            '<label><input type="radio" name="settings-theme" value="light"' + (theme === 'light' ? ' checked' : '') + '><span>浅色</span></label>' +
            '<label><input type="radio" name="settings-theme" value="dark"' + (theme === 'dark' ? ' checked' : '') + '><span>深色</span></label>' +
          '</div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<div class="section-head"><div><h3>任务提醒</h3><p>任务与备忘保存在本机；提醒在页面打开时触发，开启桌面通知后可在后台弹出。</p></div></div>' +
          '<div class="settings-actions settings-notify-row">' +
            '<button type="button" class="btn btn-ghost" id="settings-notify">' + U.icon('bell') + '开启桌面提醒</button>' +
            '<span class="settings-notify-status" id="settings-notify-status"></span>' +
          '</div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<div class="section-head"><div><h3>数据与备份</h3><p>所有数据只保存在本机浏览器；导出备份可以换设备或防止误删。</p></div></div>' +
          '<div class="settings-actions">' +
            '<button type="button" class="btn btn-ghost" id="export-json">' + U.icon('download') + '导出 JSON 备份</button>' +
            '<button type="button" class="btn btn-ghost" id="restore-json">' + U.icon('upload') + '恢复备份</button>' +
            '<button type="button" class="btn btn-ghost" id="export-ics">' + U.icon('calendar') + '导出 .ics 日历</button>' +
            '<input type="file" id="restore-file" accept="application/json,.json" hidden>' +
          '</div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<div class="section-head"><div><h3>危险操作</h3><p>清空后无法恢复，请先导出备份。</p></div></div>' +
          '<button type="button" class="btn btn-danger-ghost" id="reset-all">' + U.icon('trash') + '清空全部数据</button>' +
        '</div>' +
        '<div class="about-box"><strong>课序 ClassFlow</strong><span>v1.0 · 本地优先的课程表</span>' +
          '<p>支持从教务系统页面抓取、Excel / CSV 导入、多表叠加、冲突检查与课程进度。数据不会上传到任何服务器。</p></div>' +
      '</section>';

    var modal = UI.openModal({
      title: '设置',
      subtitle: schedule.name,
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="btn btn-ghost" data-modal-close="1">取消</button>' +
        '<button type="button" class="btn btn-primary" id="settings-save">保存设置</button>',
      onMount: function (panel, bodyEl, foot) {
        var deletedPeriods = {};
        var editor = $('#period-editor', bodyEl);

        var notifyBtn = $('#settings-notify', bodyEl);
        var notifyStatus = $('#settings-notify-status', bodyEl);
        function refreshNotifyUI() {
          if (!notifyBtn || !notifyStatus) return;
          var perm = notificationPermission();
          if (perm === 'granted') {
            notifyBtn.disabled = true;
            notifyBtn.innerHTML = U.icon('check') + '桌面提醒已开启';
            notifyStatus.textContent = '任务到点会弹出系统通知（页面需保持打开）。';
          } else if (perm === 'denied') {
            notifyBtn.disabled = true;
            notifyBtn.innerHTML = U.icon('bell') + '通知已被浏览器拒绝';
            notifyStatus.textContent = '可在地址栏的网站设置中重新允许。';
          } else if (perm === 'default') {
            notifyBtn.disabled = false;
            notifyBtn.innerHTML = U.icon('bell') + '开启桌面提醒';
            notifyStatus.textContent = '开启后，切到其他标签页也能收到提醒。';
          } else {
            notifyBtn.disabled = true;
            notifyBtn.innerHTML = U.icon('bell') + '当前浏览器不支持通知';
            notifyStatus.textContent = '页面内提醒仍然有效。';
          }
        }
        refreshNotifyUI();
        if (notifyBtn) {
          notifyBtn.addEventListener('click', function () {
            requestNotificationPermission().then(refreshNotifyUI);
          });
        }

        $$('[data-settings-tab]', bodyEl).forEach(function (btn) {
          btn.addEventListener('click', function () {
            var name = btn.getAttribute('data-settings-tab');
            $$('[data-settings-tab]', bodyEl).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
            $$('[data-panel]', bodyEl).forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
          });
        });

        function renumber() {
          $$('.period-row', editor).forEach(function (row, i) {
            $('.period-no', row).textContent = String(i + 1);
            $('.period-del', row).setAttribute('aria-label', '删除第 ' + (i + 1) + ' 节');
          });
        }

        editor.addEventListener('click', function (e) {
          var del = e.target.closest('[data-del-period]');
          if (!del) return;
          var row = del.closest('.period-row');
          var rows = $$('.period-row', editor);
          if (rows.length <= 1) { toast('至少保留一节课', 'warn'); return; }
          var orig = row.getAttribute('data-orig');
          if (orig !== 'new') {
            var idx = +orig + 1;
            var used = (schedule.courses || []).some(function (c) { return c.startPeriod === idx || c.endPeriod === idx; });
            if (used) { toast('第 ' + idx + ' 节正在被课程使用，不能删除', 'error'); return; }
            deletedPeriods[orig] = 1;
          }
          row.remove();
          renumber();
        });

        $('#add-period', bodyEl).addEventListener('click', function () {
          var rows = $$('.period-row', editor);
          if (rows.length >= 24) { toast('最多支持 24 节课', 'warn'); return; }
          var last = rows[rows.length - 1];
          var endMin = U.minutesOf(last ? $('.period-end', last).value : '') || 600;
          var startMin = Math.min(23 * 60 + 14, endMin + 10);
          var endMin2 = Math.min(23 * 60 + 59, startMin + 45);
          var row = document.createElement('div');
          row.className = 'period-row';
          row.setAttribute('data-orig', 'new');
          row.innerHTML = '<span class="period-no"></span>' +
            '<input type="time" class="input period-start" value="' + clock(startMin) + '" step="60">' +
            '<span class="period-dash">–</span>' +
            '<input type="time" class="input period-end" value="' + clock(endMin2) + '" step="60">' +
            '<button type="button" class="icon-btn period-del" data-del-period>' + U.icon('trash') + '</button>';
          editor.appendChild(row);
          renumber();
        });

        $('#settings-save', foot).addEventListener('click', function () {
          var name = $('#set-name', bodyEl).value.trim() || '我的课程表';
          var startDate = $('#set-start', bodyEl).value;
          var total = U.clamp(parseInt($('#set-weeks', bodyEl).value, 10) || schedule.totalWeeks, 1, 30);
          var days = parseInt($('#set-days', bodyEl).value, 10) || schedule.days;
          if (!U.parseDate(startDate)) { toast('请选择有效的第一周周一日期', 'error'); return; }
          var periods = [];
          var rows = $$('.period-row', editor);
          for (var i = 0; i < rows.length; i++) {
            var st = $('.period-start', rows[i]).value;
            var en = $('.period-end', rows[i]).value;
            var a = U.minutesOf(st), b = U.minutesOf(en);
            if (a == null || b == null) { toast('第 ' + (i + 1) + ' 节的起止时间不完整', 'error'); return; }
            if (b <= a) { toast('第 ' + (i + 1) + ' 节的结束时间需要晚于开始时间', 'error'); return; }
            periods.push({ start: st, end: en });
          }
          var maxWeek = 0, maxDay = 0;
          (schedule.courses || []).forEach(function (c) {
            (c.weeks || []).forEach(function (w) { if (w > maxWeek) maxWeek = w; });
            if (c.day > maxDay) maxDay = c.day;
          });
          if (maxWeek > total) { toast('有课程上到第 ' + maxWeek + ' 周，总周数不能小于它', 'error'); return; }
          if (maxDay > days) { toast('有课程安排在周' + U.WEEKDAY_SHORT[maxDay - 1] + '，显示天数不能少于它', 'error'); return; }

          var removed = Object.keys(deletedPeriods).map(Number).sort(function (x, y) { return x - y; });
          if (removed.length) {
            var bad = (schedule.courses || []).some(function (c) {
              return removed.indexOf(c.startPeriod - 1) >= 0 || removed.indexOf(c.endPeriod - 1) >= 0;
            });
            if (bad) { toast('删除的节次仍被课程使用，请先调整课程', 'error'); return; }
            (schedule.courses || []).forEach(function (c) {
              var shiftStart = removed.filter(function (d) { return d < c.startPeriod - 1; }).length;
              var shiftEnd = removed.filter(function (d) { return d < c.endPeriod - 1; }).length;
              c.startPeriod -= shiftStart;
              c.endPeriod -= shiftEnd;
            });
          }

          schedule.name = name;
          schedule.startDate = startDate;
          schedule.totalWeeks = total;
          schedule.days = days;
          schedule.periods = periods;
          schedule.updatedAt = Date.now();
          var themeEl = $('input[name="settings-theme"]:checked', bodyEl);
          state.settings.theme = themeEl ? themeEl.value : 'auto';
          saveState();
          applyTheme();
          UI.closeModal(true);
          renderAll();
          toast('设置已保存', 'success');
        });

        $('#delete-schedule', bodyEl).addEventListener('click', function () {
          if (state.schedules.length <= 1) { toast('至少保留一张课程表', 'warn'); return; }
          UI.confirm({
            title: '删除这张课程表？',
            message: '「' + esc(schedule.name) + '」中的 ' + schedule.courses.length + ' 门课程会一并删除。',
            detail: '此操作无法撤销。',
            confirmText: '删除课程表',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            state.schedules = state.schedules.filter(function (s) { return s.id !== schedule.id; });
            view.overlayIds = view.overlayIds.filter(function (id) { return D.scheduleById(state, id); });
            if (state.activeId === schedule.id) state.activeId = state.schedules[0].id;
            view.week = U.clamp(D.actualWeek(activeSchedule(), now), 1, activeSchedule().totalWeeks);
            saveState();
            UI.closeModal(true);
            renderAll();
            toast('已删除课程表', 'success');
          });
        });

        $('#export-json', bodyEl).addEventListener('click', function () {
          UI.download('课序备份-' + U.toDateInput(new Date()) + '.json', JSON.stringify(state, null, 2), 'application/json');
          toast('备份已导出', 'success');
        });

        $('#export-ics', bodyEl).addEventListener('click', function () {
          UI.download('课序日历-' + U.toDateInput(new Date()) + '.ics', D.exportICS(schedule, state.tasks), 'text/calendar;charset=utf-8');
          toast('日历文件已导出（含课程与任务）', 'success');
        });

        var restoreFile = $('#restore-file', bodyEl);
        $('#restore-json', bodyEl).addEventListener('click', function () { restoreFile.click(); });
        restoreFile.addEventListener('change', function () {
          var file = restoreFile.files && restoreFile.files[0];
          if (!file) return;
          restoreFile.value = '';
          file.text().then(function (text) {
            var parsed = null;
            try { parsed = JSON.parse(text); } catch (e) {}
            var normalized = parsed ? D.normalizeState(parsed) : null;
            if (!normalized) { toast('这个文件不是有效的课序备份', 'error'); return; }
            UI.confirm({
              title: '恢复备份？',
              message: '会覆盖当前 ' + state.schedules.length + ' 张课程表、' + state.tasks.length + ' 个任务和全部设置。',
              detail: '恢复后无法撤销，建议先导出当前备份。',
              confirmText: '恢复'
            }).then(function (ok) {
              if (!ok) return;
              state = normalized;
              view.overlayIds = [];
              view.taskFilter = 'open';
              view.week = U.clamp(D.actualWeek(activeSchedule(), now), 1, activeSchedule().totalWeeks);
              saveState();
              applyTheme();
              UI.closeModal(true);
              renderAll();
              toast('备份已恢复', 'success');
            });
          }).catch(function () { toast('读取备份文件失败', 'error'); });
        });

        $('#reset-all', bodyEl).addEventListener('click', function () {
          UI.confirm({
            title: '清空全部数据？',
            message: '会删除本机保存的全部课程表、课程、任务、备忘和设置，并重新载入示例课程表。',
            detail: '此操作无法撤销。',
            confirmText: '清空全部',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            try {
              localStorage.removeItem(D.STORAGE_KEY);
              localStorage.removeItem(D.STORAGE_BACKUP_KEY);
            } catch (e) {}
            state = D.seed();
            view = { week: 1, mode: 'week', overlayIds: [], taskFilter: 'open' };
            view.week = U.clamp(D.actualWeek(activeSchedule(), now), 1, activeSchedule().totalWeeks);
            saveState();
            applyTheme();
            UI.closeModal(true);
            renderAll();
            toast('已清空并重新载入示例', 'success');
          });
        });
      }
    });
    return modal;
  }

  function safeFile(name) {
    return String(name || '课程表').replace(/[\\/:*?"<>|]/g, '-');
  }

  /* ---------- 叠加 ---------- */
  function openOverlay() {
    var current = activeSchedule();
    var others = state.schedules.filter(function (s) { return s.id !== current.id; });
    if (!others.length) {
      toast('只有一张课程表，先新建或导入另一张吧', 'info');
      return;
    }
    var selected = {};
    (view.overlayIds || []).forEach(function (id) { selected[id] = 1; });
    var rows = others.map(function (s) {
      return '<label class="overlay-row">' +
        '<input type="checkbox" name="overlay-schedule" value="' + esc(s.id) + '"' + (selected[s.id] ? ' checked' : '') + '>' +
        '<span class="overlay-dot" style="--c:' + R.accentOf(s) + '"></span>' +
        '<span class="overlay-main"><strong>' + esc(s.name) + '</strong>' +
          '<small>' + (s.courses || []).length + ' 门课程 · ' + s.totalWeeks + ' 周</small></span>' +
        (s.demo ? '<span class="mini-badge">示例</span>' : '') +
        '</label>';
    }).join('');
    var modal = UI.openModal({
      title: '叠加课程表',
      subtitle: '把多张表放在同一张网格里看，方便发现时间冲突',
      size: 'sm',
      body:
        '<div class="overlay-picker">' +
          '<p class="overlay-note">以当前「' + esc(current.name) + '」的时间与周次为准。叠加只影响查看，不会修改任何课程表的数据。</p>' +
          '<div class="overlay-current">' +
            '<span class="overlay-dot" style="--c:' + R.accentOf(current) + '"></span>' +
            '<span class="overlay-main"><strong>' + esc(current.name) + '</strong><small>当前课程表 · 始终显示</small></span>' +
          '</div>' +
          '<div class="overlay-list">' + rows + '</div>' +
          '<div class="overlay-merge">' +
            '<p>叠加只影响查看。想把几张表长期放在一起，可合并成一张新课程表；原表会保留。</p>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="overlay-merge">' + U.icon('layers') + '合并为新课程表</button>' +
          '</div>' +
        '</div>',
      footer:
        '<button type="button" class="btn btn-ghost" id="overlay-clear">' + (view.overlayIds.length ? '取消叠加' : '关闭') + '</button>' +
        '<button type="button" class="btn btn-primary" id="overlay-apply">应用叠加</button>',
      onMount: function (panel, bodyEl, foot) {
        $('#overlay-apply', foot).addEventListener('click', function () {
          var ids = $$('input[name="overlay-schedule"]:checked', bodyEl).map(function (el) { return el.value; });
          view.overlayIds = ids;
          UI.closeModal(true);
          renderAll();
          toast(ids.length ? '正在叠加 ' + (ids.length + 1) + ' 张课程表' : '已取消叠加', 'success');
        });
        $('#overlay-clear', foot).addEventListener('click', function () {
          view.overlayIds = [];
          UI.closeModal(true);
          renderAll();
          if (view.overlayIds.length === 0) toast('已取消叠加', 'info');
        });
        $('#overlay-merge', bodyEl).addEventListener('click', function () {
          var ids = $$('input[name="overlay-schedule"]:checked', bodyEl).map(function (el) { return el.value; });
          if (!ids.length) { toast('先勾选要合并的课程表', 'info'); return; }
          var others = ids.map(function (id) { return D.scheduleById(state, id); }).filter(Boolean);
          if (!others.length) return;
          var merged = D.mergeSchedules(current, others);
          var n = 2, baseName = merged.name;
          while (state.schedules.some(function (s) { return s.name === merged.name; })) merged.name = baseName + ' ' + (n++);
          state.schedules.push(merged);
          state.activeId = merged.id;
          view.overlayIds = [];
          view.week = U.clamp(D.actualWeek(merged, now), 1, merged.totalWeeks);
          state.settings.tipDismissed = true;
          saveState();
          UI.closeModal(true);
          renderAll();
          toast('已合并为「' + merged.name + '」，原课程表已保留', 'success', 4500);
        });
      }
    });
    return modal;
  }

  /* ---------- 冲突 ---------- */
  function openConflicts() {
    var v = buildView();
    if (!v.conflicts.count) { toast('本周没有时间冲突', 'success'); return; }
    var rows = v.conflicts.pairs.map(function (pair) {
      var ps = v.schedule.periods;
      var a = ps[pair.start - 1], b = ps[pair.end - 1];
      var time = a ? a.start : '';
      if (b && b.end) time += ' – ' + b.end;
      return '<div class="conflict-row">' +
        '<div class="conflict-when">' + U.WEEKDAY_FULL[pair.day - 1] + ' 第 ' + pair.start +
          (pair.end !== pair.start ? '–' + pair.end : '') + ' 节' + (time ? '<span>' + esc(time) + '</span>' : '') + '</div>' +
        '<div class="conflict-what"><strong>' + esc(pair.a.course.name) + '</strong>' +
          '<span>' + esc(pair.a.schedule.name) + '</span></div>' +
        '<div class="conflict-vs">VS</div>' +
        '<div class="conflict-what"><strong>' + esc(pair.b.course.name) + '</strong>' +
          '<span>' + esc(pair.b.schedule.name) + '</span></div>' +
        '</div>';
    }).join('');
    UI.openModal({
      title: '本周时间冲突',
      subtitle: '第 ' + v.week + ' 周共有 ' + v.conflicts.count + ' 处重叠',
      size: 'lg',
      body: '<div class="conflict-list">' + rows + '</div>',
      footer: '<button type="button" class="btn btn-ghost" data-modal-close="1">知道了</button>'
    });
  }

  /* ---------- 导入 ---------- */
  function importSourceLabel(meta) {
    var m = (meta && (meta.mode || meta.source)) || '';
    if (m === 'html' || m === 'table') return '网页 / HTML';
    if (m === 'xlsx' || m === 'excel') return 'Excel';
    if (m === 'csv') return 'CSV / 文本';
    if (m === 'json' || m === 'bookmarklet') return '书签抓取数据';
    return '导入数据';
  }

  function suggestImportName(meta) {
    var raw = (meta && meta.title || '').trim();
    if (raw && raw.length <= 32 && !/教务|管理系统|课程表$/.test(raw)) return raw;
    var fn = (meta && meta.fileName || '').replace(/\.[^.]+$/, '');
    if (fn) return fn.slice(0, 32);
    return '导入的课程表';
  }

  function openImport() {
    var base = activeSchedule();
    var modal = UI.openModal({
      title: '导入课程表',
      subtitle: '从教务系统、Excel 或 CSV 导入，导入前可以逐条核对',
      size: 'xl',
      body: '',
      footer: '<button type="button" class="btn btn-ghost" data-modal-close="1">取消</button>',
      onMount: function (panel, bodyEl, foot) {
        showSource(panel, bodyEl, foot);
      }
    });
    return modal;

    function showSource(panel, bodyEl, foot) {
      foot.innerHTML = '<button type="button" class="btn btn-ghost" data-modal-close="1">取消</button>';
      bodyEl.innerHTML =
        '<div class="import-source">' +
          '<div class="import-error" id="import-error" hidden></div>' +
          '<div class="import-drop" id="import-drop">' +
            '<span class="drop-icon">' + U.icon('upload') + '</span>' +
            '<strong class="drop-title">粘贴课表，或把文件拖到这里</strong>' +
            '<p>在教务系统课表页按 Ctrl+A 全选、Ctrl+C 复制，回到这里直接按 Ctrl+V。</p>' +
            '<div class="drop-actions">' +
              '<button type="button" class="btn btn-primary" id="import-pick">' + U.icon('file') + '选择文件</button>' +
              '<button type="button" class="btn btn-ghost" id="import-template">' + U.icon('download') + 'CSV 模板</button>' +
            '</div>' +
            '<p class="drop-hint">支持网页 HTML、Excel (.xlsx)、CSV / TSV，以及书签抓取数据</p>' +
            '<input type="file" id="import-file" accept=".html,.htm,.xls,.xlsx,.csv,.txt,.json" hidden>' +
          '</div>' +
          '<div class="import-text-box">' +
            '<label for="import-text">也可以直接把文字粘贴在这里</label>' +
            '<textarea id="import-text" rows="3" placeholder="课程名称,教师,地点,星期,节次,周次&#10;高等数学,陈立群,教三-201,周一,1-2节,1-16周"></textarea>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="import-text-go">解析这段内容</button>' +
          '</div>' +
          '<div class="bookmarklet-card">' +
            '<span class="bookmarklet-icon">' + U.icon('bookmark') + '</span>' +
            '<div class="bookmarklet-copy"><strong>用书签一键抓取</strong>' +
              '<p>把「课序抓取」拖到浏览器书签栏。打开教务系统课表页后点它，数据会复制到剪贴板，再回来粘贴。</p></div>' +
            '<div class="bookmarklet-actions">' +
              '<a id="bookmarklet-link" class="btn btn-ghost btn-sm" href="#">课序抓取</a>' +
              '<button type="button" class="btn btn-ghost btn-sm" id="copy-bookmarklet">复制代码</button>' +
            '</div>' +
          '</div>' +
          '<details class="import-help"><summary>导入遇到问题？</summary>' +
            '<ul><li>先确认教务系统页面上的课表已经完整加载。</li>' +
            '<li>复制时尽量选中整张课表，而不是只选文字。</li>' +
            '<li>Excel 请使用 .xlsx；旧版 .xls 可以先另存为 .xlsx。</li>' +
            '<li>识别不完整时，可以下载 CSV 模板手动填写。</li></ul></details>' +
        '</div>';

      var error = $('#import-error', bodyEl);
      var drop = $('#import-drop', bodyEl);
      var fileInput = $('#import-file', bodyEl);
      var textArea = $('#import-text', bodyEl);
      var busy = false;

      function showError(err) {
        if (!bodyEl.isConnected) return;
        busy = false;
        drop.classList.remove('is-busy');
        $('.drop-title', drop).textContent = '粘贴课表，或把文件拖到这里';
        error.hidden = false;
        error.innerHTML = '<strong>' + esc(err && err.message ? err.message : '解析失败') + '</strong>' +
          (err && err.detail ? '<p>' + esc(err.detail) + '</p>' : '');
      }

      function parseInput(input) {
        if (busy) return;
        busy = true;
        error.hidden = true;
        drop.classList.add('is-busy');
        $('.drop-title', drop).textContent = '正在解析，请稍等…';
        var opts = { totalWeeks: base.totalWeeks || 20, periods: base.periods };
        var promise;
        if (input instanceof File) promise = P.parseFile(input, opts);
        else promise = Promise.resolve().then(function () { return P.parseInput(input, opts); });
        Promise.resolve(promise).then(function (res) {
          busy = false;
          drop.classList.remove('is-busy');
          if (!res || !res.courses || !res.courses.length) {
            showError({ message: '没有识别到课程', detail: '试试在教务系统页面全选复制，或上传导出的 Excel / CSV。' });
            return;
          }
          if (!bodyEl.isConnected) return;
          showPreview(res, panel, bodyEl, foot);
        }).catch(function (err) {
          showError(err);
        });
      }

      function handleFile(file) {
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) { showError({ message: '文件太大了', detail: '请选择小于 20 MB 的课表文件。' }); return; }
        parseInput(file);
      }

      $('#import-pick', bodyEl).addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        handleFile(fileInput.files && fileInput.files[0]);
        fileInput.value = '';
      });
      $('#import-text-go', bodyEl).addEventListener('click', function () {
        if (!textArea.value.trim()) { showError({ message: '还没有粘贴内容', detail: '把课表页面或 CSV 文本粘贴到上面再解析。' }); return; }
        parseInput(textArea.value);
      });

      $('#import-template', bodyEl).addEventListener('click', function () {
        UI.download('课序-课程表模板.csv', P.csvTemplate(), 'text/csv;charset=utf-8');
        toast('CSV 模板已下载', 'success');
      });

      var bookmarklet = P.bookmarklet();
      $('#bookmarklet-link', bodyEl).setAttribute('href', bookmarklet);
      $('#bookmarklet-link', bodyEl).addEventListener('click', function (e) {
        e.preventDefault();
        toast('请把按钮拖到浏览器书签栏，在教务系统页面点击它', 'info', 5000);
      });
      $('#copy-bookmarklet', bodyEl).addEventListener('click', function () {
        UI.copy(bookmarklet, '书签代码已复制');
      });

      bodyEl.addEventListener('paste', function (e) {
        if (e.target.closest && e.target.closest('.import-preview')) return;
        if (e.target === textArea) return;
        var cd = e.clipboardData;
        if (!cd) return;
        var html = cd.getData('text/html');
        var text = cd.getData('text/plain');
        if (!html && !text) return;
        e.preventDefault();
        if (html && /<table/i.test(html)) parseInput(html);
        else parseInput(text || html);
      });

      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      });
      ['dragleave', 'dragend'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-over');
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFile(file);
      });
      bodyEl.scrollTop = 0;
      setTimeout(function () { if (bodyEl.isConnected) drop.focus(); }, 0);
    }

    function showPreview(result, panel, bodyEl, foot) {
      var total = U.clamp(parseInt(result.meta && result.meta.totalWeeks, 10) || base.totalWeeks || 20, 1, 30);
      var nameDefault = suggestImportName(result.meta);
      var startDefault = base.startDate;
      var missingWeeks = 0, warningList = (result.warnings || []).slice();
      var rows = result.courses.map(function (c, i) {
        var weeks = c.weeks && c.weeks.length ? c.weeks : [];
        if (!weeks.length) { missingWeeks++; weeks = []; }
        var weeksText = weeks.length ? U.formatWeeks(weeks) : '1-' + total + '周';
        var dayOpts = '';
        for (var d = 1; d <= 7; d++) dayOpts += '<option value="' + d + '"' + (d === c.day ? ' selected' : '') + '>' + U.WEEKDAY_FULL[d - 1] + '</option>';
        return '<tr class="preview-row" data-index="' + i + '">' +
          '<td class="pc-check-cell"><input type="checkbox" class="pc-check" checked aria-label="导入这门课程"></td>' +
          '<td><input class="pc-input pc-name" maxlength="60" value="' + esc(c.name) + '" aria-label="课程名称"></td>' +
          '<td><input class="pc-input pc-teacher" maxlength="40" value="' + esc(c.teacher || '') + '" placeholder="未识别" aria-label="教师"></td>' +
          '<td><input class="pc-input pc-location" maxlength="40" value="' + esc(c.location || '') + '" placeholder="未识别" aria-label="地点"></td>' +
          '<td><select class="pc-input pc-day" aria-label="星期">' + dayOpts + '</select></td>' +
          '<td class="pc-period"><input class="pc-input pc-start" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="' + (c.startPeriod || 1) + '" aria-label="开始节">' +
            '<span>–</span><input class="pc-input pc-end" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="' + (c.endPeriod || c.startPeriod || 1) + '" aria-label="结束节"></td>' +
          '<td><input class="pc-input pc-weeks" maxlength="40" value="' + esc(weeksText) + '" aria-label="周次"></td>' +
        '</tr>';
      }).join('');

      if (missingWeeks) warningList.unshift('有 ' + missingWeeks + ' 门课程没有识别到周次，已先填入全部周次，请核对后再导入。');
      if ((result.courses || []).some(function (c) { return !c.teacher || !c.location; })) {
        warningList.push('部分课程没有识别到教师或地点，可以留空，导入后也能补填。');
      }

      var summary = '<div class="preview-head">' +
        '<div class="preview-stats">' +
          '<div><strong>' + result.courses.length + '</strong><span>门课程</span></div>' +
          '<div><strong>' + (result.meta && result.meta.tableCount || 1) + '</strong><span>个表格</span></div>' +
          '<div><strong>' + esc(importSourceLabel(result.meta)) + '</strong><span>来源</span></div>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="import-back">' + U.icon('chevron-left') + '重新选择</button>' +
      '</div>';

      bodyEl.innerHTML =
        '<div class="import-preview">' + summary +
          (warningList.length ? '<div class="import-warnings">' + warningList.map(function (w) { return '<p>' + U.icon('alert') + esc(w) + '</p>'; }).join('') + '</div>' : '') +
          '<div class="preview-table-wrap"><table class="preview-table">' +
            '<thead><tr><th></th><th>课程</th><th>教师</th><th>地点</th><th>星期</th><th>节次</th><th>周次</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>' +
          '<div class="import-options">' +
            '<div class="option-row"><span class="option-label">导入方式</span>' +
              '<label class="radio"><input type="radio" name="import-mode" value="new" checked><span>新建课程表</span></label>' +
              '<label class="radio"><input type="radio" name="import-mode" value="merge"><span>合并到当前「' + esc(base.name) + '」</span></label>' +
            '</div>' +
            '<div class="import-new-fields" id="import-new-fields">' +
              '<div class="field"><label for="import-name">课程表名称</label>' +
                '<input id="import-name" class="input" maxlength="40" value="' + esc(nameDefault) + '"></div>' +
              '<div class="field"><label for="import-start">第一周周一</label>' +
                '<input id="import-start" class="input" type="date" value="' + esc(startDefault) + '"></div>' +
              '<div class="field"><label for="import-total">总周数</label>' +
                '<input id="import-total" class="input" type="number" min="1" max="30" value="' + total + '"></div>' +
            '</div>' +
            '<div class="import-merge-note" id="import-merge-note" hidden>' +
              '<p>会追加到「' + esc(base.name) + '」，保留原课程；第一周、节次时间沿用当前课程表。若周次超出当前总周数，会自动延长总周数。</p>' +
            '</div>' +
            '<p class="import-tip">导入后仍可在设置里修改名称、第一周和作息时间。</p>' +
          '</div>' +
        '</div>';

      foot.innerHTML =
        '<button type="button" class="btn btn-ghost" data-modal-close="1">取消</button>' +
        '<button type="button" class="btn btn-primary" id="import-confirm">导入 ' + result.courses.length + ' 门课程</button>';

      var modeInputs = $$('input[name="import-mode"]', bodyEl);
      var newFields = $('#import-new-fields', bodyEl);
      var mergeNote = $('#import-merge-note', bodyEl);
      function updateMode() {
        var merge = $('input[name="import-mode"]:checked', bodyEl).value === 'merge';
        newFields.hidden = merge;
        mergeNote.hidden = !merge;
      }
      modeInputs.forEach(function (el) { el.addEventListener('change', updateMode); });

      $('#import-back', bodyEl).addEventListener('click', function () { showSource(panel, bodyEl, foot); });

      function updateCount() {
        var n = $$('.preview-row', bodyEl).filter(function (row) { return $('.pc-check', row).checked; }).length;
        var btn = $('#import-confirm', foot);
        btn.textContent = '导入 ' + n + ' 门课程';
        btn.disabled = n === 0;
        $$('.preview-row', bodyEl).forEach(function (row) {
          row.classList.toggle('is-off', !$('.pc-check', row).checked);
        });
      }
      bodyEl.addEventListener('change', function (e) {
        if (e.target.classList && e.target.classList.contains('pc-check')) updateCount();
      });
      updateMode();
      updateCount();
      bodyEl.scrollTop = 0;

      $('#import-confirm', foot).addEventListener('click', function () {
        var mode = $('input[name="import-mode"]:checked', bodyEl).value;
        var current = activeSchedule();
        var picked = [];
        var invalid = [];
        var overWeek = 0;
        var rowsEls = $$('.preview-row', bodyEl);
        rowsEls.forEach(function (row) {
          if (!$('.pc-check', row).checked) return;
          row.classList.remove('is-invalid');
          var name = $('.pc-name', row).value.trim();
          var teacher = $('.pc-teacher', row).value.trim();
          var location = $('.pc-location', row).value.trim();
          var day = U.clamp(parseInt($('.pc-day', row).value, 10) || 1, 1, 7);
          var start = U.clamp(parseInt($('.pc-start', row).value, 10) || 1, 1, 24);
          var end = U.clamp(parseInt($('.pc-end', row).value, 10) || start, start, 24);
          var weeksRaw = U.parseWeeks($('.pc-weeks', row).value, 30);
          if (!name || !weeksRaw.length) {
            row.classList.add('is-invalid');
            invalid.push(row);
            return;
          }
          picked.push({
            name: name, teacher: teacher, location: location, day: day,
            startPeriod: start, endPeriod: end, weeks: weeksRaw
          });
        });
        if (invalid.length) {
          toast('有 ' + invalid.length + ' 门课程信息不完整，已用红色标出', 'error');
          invalid[0].scrollIntoView({ block: 'center' });
          return;
        }
        if (!picked.length) { toast('至少选择一门课程', 'warn'); return; }

        var targetTotal;
        if (mode === 'new') {
          var name = $('#import-name', bodyEl).value.trim() || '导入的课程表';
          var startDate = $('#import-start', bodyEl).value;
          if (!U.parseDate(startDate)) { toast('请选择有效的第一周日期', 'error'); return; }
          targetTotal = U.clamp(parseInt($('#import-total', bodyEl).value, 10) || total, 1, 30);
          picked.forEach(function (c) {
            var filtered = c.weeks.filter(function (w) { return w <= targetTotal; });
            if (filtered.length !== c.weeks.length) overWeek += c.weeks.length - filtered.length;
            c.weeks = filtered;
          });
          if (picked.some(function (c) { return !c.weeks.length; })) {
            toast('有课程的所有周次都超出了总周数，请调整总周数', 'error');
            return;
          }
          var maxEnd = 1, maxDay = 5;
          picked.forEach(function (c) { maxEnd = Math.max(maxEnd, c.endPeriod); maxDay = Math.max(maxDay, c.day); });
          var basePeriods = (base.periods || []).map(function (p) { return { start: p.start, end: p.end }; });
          var periods = D.extendPeriods(basePeriods, maxEnd);
          var courses = [];
          picked.forEach(function (c) {
            var course = {
              id: U.uid('crs'), name: c.name, teacher: c.teacher, location: c.location,
              day: c.day, startPeriod: c.startPeriod, endPeriod: c.endPeriod, weeks: c.weeks,
              color: D.courseColor(courses, c.name), note: '', progress: null, createdAt: Date.now()
            };
            courses.push(course);
          });
          courses.sort(function (a, b) { return a.day - b.day || a.startPeriod - b.startPeriod; });
          var sched = D.emptySchedule({
            name: name, startDate: startDate, totalWeeks: targetTotal, days: maxDay,
            periods: periods, courses: courses
          });
          sched.updatedAt = Date.now();
          state.schedules.push(sched);
          state.activeId = sched.id;
          state.settings.tipDismissed = true;
          view.overlayIds = [];
          view.week = U.clamp(D.actualWeek(sched, now), 1, sched.totalWeeks);
          saveState();
          UI.closeModal(true);
          renderAll();
          toast('已导入 ' + courses.length + ' 门课程' + (overWeek ? '，' + overWeek + ' 个超出周次已忽略' : ''), 'success', 4500);
        } else {
          var maxWeek = 0;
          picked.forEach(function (c) { c.weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; }); });
          targetTotal = Math.min(30, Math.max(current.totalWeeks, maxWeek));
          if (targetTotal > current.totalWeeks) current.totalWeeks = targetTotal;
          picked.forEach(function (c) {
            var filtered = c.weeks.filter(function (w) { return w <= targetTotal; });
            if (filtered.length !== c.weeks.length) overWeek += c.weeks.length - filtered.length;
            c.weeks = filtered;
          });
          var seen = {};
          current.courses.forEach(function (c) {
            seen[[c.name, c.day, c.startPeriod, c.endPeriod, (c.weeks || []).join(',')].join('|')] = 1;
          });
          var added = 0;
          picked.forEach(function (c) {
            var key = [c.name, c.day, c.startPeriod, c.endPeriod, c.weeks.join(',')].join('|');
            if (seen[key] || !c.weeks.length) return;
            seen[key] = 1;
            current.courses.push({
              id: U.uid('crs'), name: c.name, teacher: c.teacher, location: c.location,
              day: c.day, startPeriod: c.startPeriod, endPeriod: c.endPeriod, weeks: c.weeks,
              color: D.courseColor(current.courses, c.name), note: '', progress: null, createdAt: Date.now()
            });
            added++;
          });
          current.courses.sort(function (a, b) { return a.day - b.day || a.startPeriod - b.startPeriod; });
          current.periods = D.extendPeriods(current.periods, Math.max.apply(null, picked.map(function (c) { return c.endPeriod; })));
          current.days = Math.max(current.days, Math.max.apply(null, picked.map(function (c) { return c.day; })));
          current.updatedAt = Date.now();
          state.settings.tipDismissed = true;
          saveState();
          UI.closeModal(true);
          renderAll();
          toast(added ? '已合并 ' + added + ' 门课程' : '没有新增课程，可能都已经存在', added ? 'success' : 'info', 4500);
        }
      });
    }
  }

  /* ---------- 事件 ---------- */
  function handleAction(action, el) {
    switch (action) {
      case 'today': goToday(); break;
      case 'prev-week': goWeek(view.week - 1); break;
      case 'next-week': goWeek(view.week + 1); break;
      case 'go-today': goToday(); break;
      case 'pick-week': goWeek(parseInt(el.getAttribute('data-week'), 10) || view.week); break;
      case 'set-view':
        var mode = el.getAttribute('data-view');
        view.mode = (mode === 'list' || mode === 'tasks') ? mode : 'week';
        if (view.mode === 'tasks') view.taskFilter = view.taskFilter || 'open';
        renderAll();
        break;
      case 'open-tasks':
        view.mode = 'tasks';
        view.taskFilter = view.taskFilter || 'open';
        renderAll();
        break;
      case 'task-filter':
        view.taskFilter = el.getAttribute('data-filter') || 'open';
        renderAll();
        break;
      case 'new-task':
        openTaskForm(null, { date: U.toDateInput(now) });
        break;
      case 'open-task':
        openTaskForm(el.getAttribute('data-id'));
        break;
      case 'toggle-task':
        toggleTask(el.getAttribute('data-id'));
        break;
      case 'delete-task':
        deleteTask(el.getAttribute('data-id'));
        break;
      case 'open-memo':
        openMemoForm(el.getAttribute('data-id'));
        break;
      case 'delete-memo':
        deleteMemo(el.getAttribute('data-id'));
        break;
      case 'toggle-memo-pin':
        toggleMemoPin(el.getAttribute('data-id'));
        break;
      case 'request-notify':
        requestNotificationPermission();
        break;
      case 'switch-schedule': switchSchedule(el.getAttribute('data-id')); break;
      case 'new-schedule': createSchedule(); break;
      case 'new-course': openCourseForm({}); break;
      case 'add-course':
        openCourseForm({ day: parseInt(el.getAttribute('data-day'), 10), period: parseInt(el.getAttribute('data-period'), 10) });
        break;
      case 'open-course':
        openCourseDetail(el.getAttribute('data-schedule'), el.getAttribute('data-id'));
        break;
      case 'open-import': openImport(); break;
      case 'open-settings': openSettings('schedule'); break;
      case 'open-overlay': openOverlay(); break;
      case 'open-conflicts': openConflicts(); break;
      case 'dismiss-tip': dismissTip(); break;
      case 'toggle-theme':
        state.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
        saveState();
        applyTheme();
        toast(state.settings.theme === 'dark' ? '已切换到深色模式' : '已切换到浅色模式', 'success', 1800);
        break;
    }
  }

  function bindEvents() {
    document.addEventListener('submit', function (e) {
      if (e.target && e.target.id === 'task-quick-form') {
        e.preventDefault();
        addQuickTask($('#task-quick-input') ? $('#task-quick-input').value : '');
        return;
      }
      if (e.target && e.target.id === 'memo-quick-form') {
        e.preventDefault();
        addQuickMemo($('#memo-quick-input') ? $('#memo-quick-input').value : '');
      }
    });

    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el) {
        if (weekMenuOpen) closeWeekMenu();
        return;
      }
      var action = el.getAttribute('data-action');
      if (action === 'open-week-menu') {
        e.preventDefault();
        openWeekMenu();
        return;
      }
      if (action === 'today') e.preventDefault();
      closeWeekMenu();
      handleAction(action, el);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && weekMenuOpen && !UI.isModalOpen()) {
        e.preventDefault();
        closeWeekMenu();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches &&
          e.target.matches('.task-item-main[data-action="open-task"]')) {
        e.preventDefault();
        openTaskForm(e.target.getAttribute('data-id'));
      }
    });

    window.addEventListener('resize', closeWeekMenu);
    window.addEventListener('scroll', function (e) {
      if (!weekMenuOpen) return;
      var menu = $('#week-menu');
      if (menu && e.target instanceof Node && menu.contains(e.target)) return;
      closeWeekMenu();
    }, true);

    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', function () { if (state.settings.theme === 'auto') applyTheme(); });
      else if (mq.addListener) mq.addListener(function () { if (state.settings.theme === 'auto') applyTheme(); });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var old = now;
      now = new Date();
      if (!U.sameDay(old, now)) renderAll();
      else renderLive();
      checkReminders();
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    state = D.load();
    view = { week: 1, mode: 'week', overlayIds: [], taskFilter: 'open' };
    now = new Date();
    view.week = U.clamp(D.actualWeek(activeSchedule(), now), 1, activeSchedule().totalWeeks);
    renderAll();
    bindEvents();
    applyTheme();

    if (!D.storageAvailable) {
      setTimeout(function () {
        toast('浏览器本地存储不可用，刷新页面后课程会丢失', 'warn', 7000);
      }, 700);
    }

    liveTimer = setInterval(function () {
      if (UI.isModalOpen()) return;
      var old = now;
      now = new Date();
      if (!U.sameDay(old, now)) renderAll();
      else renderLive();
    }, 30000);

    reminderTimer = setInterval(checkReminders, 20000);
    setTimeout(checkReminders, 1200);

    App.debug = function () {
      return { state: state, view: view, now: now };
    };
    App.render = renderAll;
    App.openImport = openImport;
    App.openSettings = openSettings;
    App.openCourseForm = openCourseForm;
    App.openCourseDetail = openCourseDetail;
    App.checkReminders = checkReminders;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
