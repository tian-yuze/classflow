/* 课序 ClassFlow — Edge/CDP 冒烟测试（无外部依赖） */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'C:\\Users\\Lenovo\\Downloads\\新建文件夹';
const OUT = path.join(ROOT, 'test');
const PROFILE = path.join(ROOT, '.edge-test-profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9223;
fs.mkdirSync(OUT, { recursive: true });
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { console.warn('profile cleanup skipped:', e.message); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const logs = [];
let edge;
let cdp;

function launch() {
  edge = spawn(EDGE, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`,
    '--window-size=1440,1100',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  edge.on('error', (err) => { errors.push('spawn: ' + err.message); });
}

async function waitEndpoint() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Edge CDP endpoint not available');
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      const list = this.listeners.get(msg.method) || [];
      list.forEach((fn) => fn(msg.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch {} }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails;
      throw new Error('JS eval failed: ' + (ex.exception?.description || ex.text));
    }
    return r.result?.value;
  }
  async waitFor(expression, timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.eval(expression)) return true;
      await sleep(80);
    }
    throw new Error('Timed out waiting for: ' + expression);
  }
  async click(selector) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error('Click target not found: ' + selector);
    await sleep(180);
  }
  async shot(name) {
    const data = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64'));
    console.log('  screenshot:', name);
  }
  async metrics(label) {
    const m = await this.eval(`(() => {
      const app = window.CF && CF.App && CF.App.debug ? CF.App.debug() : null;
      const wb = document.querySelector('.week-pill-week');
      const cards = [...document.querySelectorAll('.course-card')];
      return {
        title: document.title,
        week: wb ? wb.textContent : null,
        theme: document.documentElement.getAttribute('data-theme'),
        schedules: app ? app.state.schedules.length : null,
        active: app ? app.state.activeId : null,
        overlay: app ? app.view.overlayIds.slice() : null,
        cards: cards.length,
        cardNames: cards.slice(0, 6).map((c) => c.querySelector('.cc-name')?.textContent),
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        bodyOverflow: document.body.scrollWidth - window.innerWidth,
        viewport: [window.innerWidth, window.innerHeight],
        modalOpen: !!document.querySelector('.modal-layer.is-open'),
        toast: document.querySelector('.toast')?.textContent.trim() || null
      };
    })()`);
    console.log(`[${label}]`, JSON.stringify(m));
    return m;
  }
}

async function main() {
  launch();
  const wsUrl = await waitEndpoint();
  cdp = new CDP(wsUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.exceptionThrown', (p) => {
    errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception');
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry;
    if (e.level === 'error') errors.push('console: ' + e.text + (e.url ? ' @ ' + e.url : ''));
    else logs.push(e.level + ': ' + e.text);
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') logs.push('console.error: ' + p.args.map((a) => a.value ?? a.description).join(' '));
  });

  console.log('== load ==');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8765/' });
  await cdp.waitFor('!!window.CF && !!CF.App && !!document.querySelector(".course-card")', 8000);
  await cdp.eval('localStorage.clear()');
  await cdp.send('Page.reload', { ignoreCache: true });
  await cdp.waitFor('!!window.CF && !!CF.App && !!document.querySelector(".course-card")', 8000);
  await sleep(400);
  await cdp.metrics('home');
  await cdp.shot('01-dark-home.png');

  console.log('== light theme ==');
  await cdp.click('#theme-btn');
  await sleep(250);
  const light = await cdp.metrics('light');
  if (light.theme !== 'light') throw new Error('theme did not switch to light');
  await cdp.shot('02-light-home.png');

  console.log('== week navigation ==');
  const week0 = (await cdp.metrics('before-nav')).week;
  await cdp.click('[data-action="next-week"]');
  const week1 = (await cdp.metrics('next-week')).week;
  if (week0 === week1) throw new Error('next-week did not change week');
  await cdp.click('[data-action="prev-week"]');
  const week2 = (await cdp.metrics('prev-week')).week;
  if (week2 !== week0) throw new Error('prev-week did not restore week');
  await cdp.click('[data-action="go-today"]');
  const week3 = (await cdp.metrics('today')).week;
  if (week3 !== week0) throw new Error('today did not restore week');
  await cdp.shot('03-week-nav.png');

  console.log('== week menu ==');
  await cdp.click('.week-pill');
  await sleep(350);
  const menuState = await cdp.eval(`(() => {
    const m = document.querySelector('#week-menu');
    return m ? { hidden: m.hidden, cls: m.className, style: m.getAttribute('style'), items: m.querySelectorAll('.week-menu-item').length, html: m.innerHTML.slice(0, 80) } : null;
  })()`);
  console.log('  menu state:', JSON.stringify(menuState));
  console.log('  errors so far:', errors.length ? errors : 'none');
  await cdp.waitFor('!!document.querySelector("#week-menu:not([hidden]) .week-menu-item")');
  await cdp.shot('03b-week-menu.png');
  await cdp.click('.week-menu-item[data-week="10"]');
  await sleep(300);
  const menuWeek = (await cdp.metrics('week-menu-pick')).week;
  if (menuWeek !== '第 10 周') throw new Error('week menu did not switch to week 10, got ' + menuWeek);
  await cdp.click('[data-action="go-today"]');
  await sleep(250);

  console.log('== list view ==');
  await cdp.click('[data-view="list"]');
  await cdp.waitFor('!!document.querySelector(".list-view")');
  await cdp.shot('03c-list-view.png');
  await cdp.click('[data-view="week"]');
  await cdp.waitFor('!!document.querySelector(".week-view")');

  console.log('== course detail ==');
  await cdp.click('.course-card');
  await cdp.waitFor('!!document.querySelector(".modal-layer.is-open .course-detail")');
  await cdp.shot('04-course-detail.png');
  await cdp.click('.modal-close');
  await cdp.waitFor('!document.querySelector(".modal-layer")');

  console.log('== add course ==');
  await cdp.click('[data-action="new-course"]');
  await cdp.waitFor('!!document.querySelector("#course-form")');
  const filled = await cdp.eval(`(() => {
    const set = (id, value) => {
      const el = document.querySelector(id);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#cf-name', '测试课程');
    set('#cf-teacher', '测试老师');
    set('#cf-location', '测试楼 101');
    set('#cf-day', '7');
    set('#cf-start', '11');
    set('#cf-end', '12');
    set('#cf-weeks', '1-16周');
    return {
      name: document.querySelector('#cf-name').value,
      weeksHint: document.querySelector('#cf-weeks-hint').textContent,
      start: document.querySelector('#cf-start').value
    };
  })()`);
  console.log('  form:', JSON.stringify(filled));
  await cdp.shot('05-course-form.png');
  await cdp.click('#cf-save');
  await cdp.waitFor('!document.querySelector(".modal-layer")', 6000);
  await sleep(500);
  const added = await cdp.eval(`(() => {
    const app = CF.App.debug();
    const s = app.state.schedules.find((x) => x.id === app.state.activeId);
    const c = s.courses.find((x) => x.name === '测试课程');
    return c ? { day: c.day, start: c.startPeriod, end: c.endPeriod, weeks: c.weeks.length, color: c.color } : null;
  })()`);
  console.log('  added:', JSON.stringify(added));
  if (!added) throw new Error('manual course was not saved');
  await cdp.metrics('after-add');
  await cdp.shot('06-after-add.png');

  console.log('== settings ==');
  await cdp.click('[data-action="open-settings"]');
  await cdp.waitFor('!!document.querySelector(".settings-tabs")');
  await cdp.shot('07-settings-schedule.png');
  await cdp.click('[data-settings-tab="general"]');
  await cdp.shot('08-settings-general.png');
  await cdp.click('.modal-close');
  await cdp.waitFor('!document.querySelector(".modal-layer")');

  console.log('== overlay ==');
  await cdp.click('[data-action="open-overlay"]');
  await cdp.waitFor('!!document.querySelector(".overlay-list")');
  const overlayRows = await cdp.eval('document.querySelectorAll(".overlay-row").length');
  console.log('  overlay rows:', overlayRows);
  await cdp.eval(`(() => {
    const inputs = [...document.querySelectorAll('input[name="overlay-schedule"]')];
    if (inputs[0]) { inputs[0].checked = true; inputs[0].dispatchEvent(new Event('change', { bubbles: true })); }
  })()`);
  await cdp.shot('09-overlay-picker.png');
  await cdp.click('#overlay-apply');
  await sleep(400);
  const ov = await cdp.metrics('overlay-applied');
  if (!ov.overlay || ov.overlay.length < 1) throw new Error('overlay was not applied');
  await cdp.shot('10-overlay-view.png');

  console.log('== conflicts ==');
  const conflictBtn = await cdp.eval('!!document.querySelector(".conflict-line:not(.is-ok)")');
  if (conflictBtn) {
    await cdp.click('.conflict-line:not(.is-ok)');
    await cdp.waitFor('!!document.querySelector(".conflict-list")');
    await cdp.shot('11-conflicts.png');
    await cdp.click('.modal-close');
    await cdp.waitFor('!document.querySelector(".modal-layer")');
  } else {
    console.log('  no conflict button, skip');
  }

  console.log('== clear overlay ==');
  await cdp.click('[data-action="open-overlay"]');
  await cdp.waitFor('!!document.querySelector("#overlay-clear")');
  await cdp.click('#overlay-clear');
  await sleep(300);

  console.log('== import preview ==');
  await cdp.click('[data-action="open-import"]');
  await cdp.waitFor('!!document.querySelector("#import-text")');
  await cdp.shot('12-import-source.png');
  await cdp.eval(`(() => {
    const t = document.querySelector('#import-text');
    t.value = '课程名称,教师,地点,星期,节次,周次\\n导入课程A,张老师,教一-101,周一,1-2节,1-8周\\n导入课程B,李老师,教一-202,周三,3-4节,1-16周\\n导入课程C,王老师,教一-303,周五,5-6节,2-16双周';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await cdp.click('#import-text-go');
  await cdp.waitFor('!!document.querySelector(".preview-row")', 6000);
  const preview = await cdp.eval('({rows:document.querySelectorAll(".preview-row").length, stats:document.querySelector(".preview-stats").textContent.replace(/\\s+/g," ").trim(), warnings:document.querySelector(".import-warnings")?.textContent.trim()||""})');
  console.log('  preview:', JSON.stringify(preview));
  if (preview.rows !== 3) throw new Error('expected 3 preview rows');
  const previewPeriods = await cdp.eval('[...document.querySelectorAll(".pc-start, .pc-end")].map((el) => el.value)');
  console.log('  preview periods:', JSON.stringify(previewPeriods));
  if (previewPeriods.join(',') !== '1,2,3,4,5,6') throw new Error('period inputs not populated');
  await cdp.shot('13-import-preview.png');

  console.log('== import confirm ==');
  await cdp.click('#import-confirm');
  await cdp.waitFor('!document.querySelector(".modal-layer")', 6000);
  await sleep(500);
  const imported = await cdp.metrics('imported');
  if (imported.schedules !== 3) throw new Error('expected 3 schedules after import');
  await cdp.shot('14-imported.png');

  console.log('== switch back to demo ==');
  const switched = await cdp.eval(`(() => {
    const tabs = [...document.querySelectorAll('.sched-tab')];
    const t = tabs.find((x) => x.textContent.includes('主修'));
    if (!t) return false;
    t.click();
    return true;
  })()`);
  if (!switched) throw new Error('demo tab not found');
  await sleep(400);
  await cdp.metrics('demo-again');

  console.log('== merge overlay into new schedule ==');
  await cdp.click('[data-action="open-overlay"]');
  await cdp.waitFor('!!document.querySelector("#overlay-merge")');
  await cdp.eval(`(() => {
    const inputs = [...document.querySelectorAll('input[name="overlay-schedule"]')];
    if (inputs[0]) { inputs[0].checked = true; inputs[0].dispatchEvent(new Event('change', { bubbles: true })); }
  })()`);
  await cdp.shot('14b-overlay-merge.png');
  await cdp.click('#overlay-merge');
  await cdp.waitFor('!document.querySelector(".modal-layer")', 6000);
  await sleep(500);
  const merged = await cdp.metrics('merged');
  if (merged.schedules !== 4) throw new Error('expected 4 schedules after merge, got ' + merged.schedules);
  const mergedInfo = await cdp.eval(`(() => {
    const app = CF.App.debug();
    const s = app.state.schedules.find((x) => x.id === app.state.activeId);
    return { name: s.name, courses: s.courses.length, days: s.days, totalWeeks: s.totalWeeks, demo: s.demo };
  })()`);
  console.log('  merged:', JSON.stringify(mergedInfo));
  if (mergedInfo.courses !== 14) throw new Error('merged schedule should contain 14 courses');
  await cdp.shot('15-merged.png');
  const back = await cdp.eval(`(() => {
    const t = [...document.querySelectorAll('.sched-tab')].find((x) => x.textContent.includes('主修'));
    if (!t) return false; t.click(); return true;
  })()`);
  if (!back) throw new Error('could not switch back to demo after merge');
  await sleep(350);

  console.log('== persistence reload ==');
  await cdp.send('Page.reload', { ignoreCache: true });
  await cdp.waitFor('!!window.CF && !!CF.App && !!document.querySelector(".course-card")', 8000);
  await sleep(400);
  const persisted = await cdp.metrics('reloaded');
  const persistedCourse = await cdp.eval(`(() => {
    const app = CF.App.debug();
    return app.state.schedules.some((s) => s.courses.some((c) => c.name === '测试课程'));
  })()`);
  console.log('  course persisted:', persistedCourse);
  if (!persistedCourse) throw new Error('manual course did not persist after reload');
  if (persisted.schedules !== 4) throw new Error('schedules did not persist');
  await cdp.shot('15-reloaded.png');

  console.log('== mobile ==');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Page.reload', { ignoreCache: true });
  await cdp.waitFor('!!window.CF && !!CF.App && !!document.querySelector(".course-card")', 8000);
  await sleep(500);
  const mobile = await cdp.metrics('mobile');
  if (mobile.bodyOverflow > 1) throw new Error('mobile body overflows horizontally: ' + mobile.bodyOverflow);
  if (mobile.pageOverflow > 1) throw new Error('mobile page overflows horizontally: ' + mobile.pageOverflow);
  await cdp.shot('16-mobile-home.png');
  console.log('== mobile course form ==');
  await cdp.click('[data-action="new-course"]');
  await cdp.waitFor('!!document.querySelector("#course-form")');
  await cdp.shot('17-mobile-form.png');
  const mform = await cdp.eval(`(() => {
    const panel = document.querySelector('.modal');
    const r = panel.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight, overflow: document.body.scrollWidth - innerWidth };
  })()`);
  console.log('  mobile form rect:', JSON.stringify(mform));
  if (mform.left < -1 || mform.right > mform.vw + 1) throw new Error('mobile modal is off-screen');
  await cdp.click('.modal-close');
  await cdp.waitFor('!document.querySelector(".modal-layer")');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  console.log('\n== console errors ==');
  if (errors.length) {
    errors.forEach((e) => console.log('ERROR:', e));
    throw new Error(errors.length + ' browser error(s)');
  }
  console.log('none');
  console.log('\nALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err.stack || err.message);
  process.exitCode = 1;
}).finally(async () => {
  try { await cdp.send('Browser.close'); } catch {}
  await sleep(500);
  try { if (edge && !edge.killed) edge.kill(); } catch {}
  process.exit(process.exitCode || 0);
});
