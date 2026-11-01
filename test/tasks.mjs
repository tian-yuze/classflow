/* 课序 ClassFlow — 任务/备忘功能冒烟测试 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'C:\\Users\\Lenovo\\Downloads\\新建文件夹';
const OUT = path.join(ROOT, 'test');
const PROFILE = path.join(ROOT, '.edge-task-profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9226;
fs.mkdirSync(OUT, { recursive: true });
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let edge, cdp;

function launch() {
  edge = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`, '--window-size=1440,1100', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  edge.on('error', (e) => errors.push('spawn: ' + e.message));
}

async function endpoint() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Edge CDP endpoint not available');
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
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
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        return;
      }
      (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
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
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('JS eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  async waitFor(expression, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.eval(expression)) return true;
      await sleep(80);
    }
    throw new Error('Timed out waiting for: ' + expression);
  }
  async click(selector) {
    const ok = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error('Click target not found: ' + selector);
    await sleep(180);
  }
  async setVal(selector, value) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error('Input not found: ' + selector);
  }
  async shot(name) {
    const data = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64'));
    console.log('  screenshot:', name);
  }
}

function check(ok, msg) {
  if (!ok) throw new Error('CHECK FAILED: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  launch();
  cdp = new CDP(await endpoint());
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.exceptionThrown', (p) => errors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') errors.push('console: ' + p.entry.text);
  });

  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' });
  await cdp.waitFor('window.CF && CF.App && document.querySelectorAll(".course-card").length > 0', 8000);
  await cdp.eval('localStorage.clear(); location.reload(); true');
  await cdp.waitFor('window.CF && CF.App && document.querySelectorAll(".course-card").length > 0', 8000);
  await sleep(400);

  let d = await cdp.eval('CF.App.debug()');
  check(Array.isArray(d.state.tasks) && d.state.tasks.length === 0, '初始任务为空');
  check(Array.isArray(d.state.memos) && d.state.memos.length === 0, '初始备忘为空');

  await cdp.click('[data-action="open-tasks"]');
  await cdp.waitFor('document.querySelector(".taskbar-title h1")');
  check((await cdp.eval('document.querySelector(".taskbar-title h1").textContent')) === '任务与备忘', '任务视图标题');
  check(await cdp.eval('!!document.querySelector(".task-empty")'), '初始显示空状态');
  await cdp.shot('task-01-empty.png');

  await cdp.setVal('#task-quick-input', '写任务测试');
  await cdp.eval('document.querySelector("#task-quick-form").requestSubmit(); true');
  await cdp.waitFor('document.querySelectorAll(".task-item").length === 1');
  check((await cdp.eval('document.querySelector(".task-title").textContent')) === '写任务测试', '快速添加任务');
  check((await cdp.eval('CF.App.debug().state.tasks.length')) === 1, '任务已写入 state');
  check((await cdp.eval('document.querySelector("#task-count-badge").textContent')) === '1', '顶栏待办角标');

  await cdp.click('.task-item-main');
  await cdp.waitFor('!!document.querySelector("#task-form")');
  check((await cdp.eval('document.querySelector("#tf-title").value')) === '写任务测试', '编辑表单回填标题');
  await cdp.setVal('#tf-title', '项目周会');
  await cdp.setVal('#tf-type', 'meeting');
  await cdp.setVal('#tf-start', '18:00');
  await cdp.setVal('#tf-end', '19:00');
  await cdp.setVal('#tf-location', '线上会议室');
  await cdp.setVal('#tf-priority', '2');
  await cdp.setVal('#tf-remind', '5');
  await cdp.setVal('#tf-note', '同步本周进度，准备演示。');
  await cdp.click('#tf-save');
  await cdp.waitFor('!document.querySelector("#task-form")');
  check((await cdp.eval('document.querySelector(".task-type-pill").textContent')) === '会议', '类型显示为会议');
  check((await cdp.eval('document.querySelector(".task-priority").textContent')) === '紧急', '优先级显示为紧急');
  check((await cdp.eval('document.querySelector(".task-note").textContent')).includes('同步本周进度'), '备注回显');
  check((await cdp.eval('document.querySelector(".task-meta").textContent')).includes('18:00'), '时间回显');
  check((await cdp.eval('document.querySelector(".task-meta").textContent')).includes('线上会议室'), '地点回显');
  await cdp.shot('task-02-view.png');
  await cdp.click('.task-item-main');
  await cdp.waitFor('!!document.querySelector("#task-form")');
  await cdp.shot('task-02b-task-form.png');
  await cdp.click('.modal-close');
  await cdp.waitFor('!document.querySelector("#task-form")');

  await cdp.click('.task-check');
  await cdp.click('[data-action="task-filter"][data-filter="done"]');
  await cdp.waitFor('!!document.querySelector(".task-item.is-done")');
  check((await cdp.eval('document.querySelectorAll(".task-item.is-done").length')) === 1, '完成筛选显示已完成任务');
  await cdp.click('[data-action="task-filter"][data-filter="open"]');
  await cdp.waitFor('!!document.querySelector(".task-empty")');
  check(true, '待办清空后的空状态');

  await cdp.click('[data-action="new-task"]');
  await cdp.waitFor('!!document.querySelector("#task-form")');
  await cdp.setVal('#tf-title', '明天交实验报告');
  await cdp.setVal('#tf-date', await cdp.eval('(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()'));
  await cdp.setVal('#tf-type', 'task');
  await cdp.click('#tf-save');
  await cdp.waitFor('!document.querySelector("#task-form")');
  check((await cdp.eval('document.querySelector(".task-group-head h3").textContent')).includes('明天'), '明天分组');
  await cdp.shot('task-03-tomorrow.png');

  await cdp.setVal('#memo-quick-input', '买一本方格本');
  await cdp.eval('document.querySelector("#memo-quick-form").requestSubmit(); true');
  await cdp.waitFor('document.querySelectorAll(".memo-item").length === 1');
  check((await cdp.eval('document.querySelector(".memo-text").textContent')) === '买一本方格本', '快速添加备忘');
  await cdp.click('[data-action="toggle-memo-pin"]');
  check(await cdp.eval('document.querySelector(".memo-item").classList.contains("is-pinned")'), '备忘置顶');
  await cdp.click('.memo-text');
  await cdp.waitFor('!!document.querySelector("#memo-form")');
  await cdp.shot('task-03b-memo-form.png');
  await cdp.setVal('#mf-text', '买一本方格本和两支笔');
  await cdp.click('#mf-save');
  await cdp.waitFor('!document.querySelector("#memo-form")');
  check((await cdp.eval('document.querySelector(".memo-text").textContent')) === '买一本方格本和两支笔', '编辑备忘');

  const ics = await cdp.eval(`(() => {
    const d = CF.App.debug();
    const text = CF.Data.exportICS(d.state.schedules[0], d.state.tasks);
    return { events: (text.match(/BEGIN:VEVENT/g) || []).length, alarms: (text.match(/BEGIN:VALARM/g) || []).length, hasMeeting: text.includes('项目周会') };
  })()`);
  check(ics.events > 0 && ics.alarms > 0 && ics.hasMeeting, 'ICS 导出包含任务与提醒');

  await cdp.click('[data-action="open-settings"]');
  await cdp.waitFor('!!document.querySelector("#settings-notify")');
  check(await cdp.eval('!!document.querySelector(".settings-notify-status")'), '设置中存在通知状态');
  await cdp.click('#settings-notify');
  await sleep(300);
  check(await cdp.eval('!!document.querySelector("#settings-notify")'), '通知按钮点击后弹窗仍可用');
  await cdp.click('.modal-close');

  await cdp.eval(`(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const t = CF.Data.normalizeTask({ title: '到点提醒测试', date: CF.Util.toDateInput(now), start: hh, remind: 0 });
    CF.App.debug().state.tasks.push(t);
    CF.Data.save(CF.App.debug().state);
    CF.App.checkReminders();
    return true;
  })()`);
  await sleep(250);
  const toastTexts = await cdp.eval('[...document.querySelectorAll(".toast-text")].map(x => x.textContent)');
  check(toastTexts.some((x) => x.includes('提醒') && x.includes('到点提醒测试')), '到点提醒触发 Toast');
  check((await cdp.eval('CF.App.debug().state.tasks.filter(t => t.remindedAt).length')) >= 1, '提醒记录 remindedAt');

  await cdp.eval('location.reload(); true');
  await cdp.waitFor('window.CF && CF.App && document.querySelectorAll(".course-card").length > 0', 8000);
  await cdp.click('[data-action="open-tasks"]');
  await cdp.waitFor('document.querySelectorAll(".task-item").length >= 2');
  check((await cdp.eval('document.querySelectorAll(".memo-item").length')) === 1, '刷新后备忘持久化');
  check((await cdp.eval('CF.App.debug().state.tasks.length')) >= 3, '刷新后任务持久化');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  await cdp.shot('task-04-mobile.png');
  const overflow = await cdp.eval('(() => { const a = document.documentElement.scrollWidth - window.innerWidth; const b = document.body.scrollWidth - window.innerWidth; return a + "|" + b; })()');
  check(overflow === '0|0', '移动端任务视图无横向溢出: ' + overflow);

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  await cdp.shot('task-05-desktop.png');

  if (errors.length) throw new Error('浏览器错误:\n' + errors.join('\n'));
  console.log('TASK CHECKS PASSED');
}

try {
  await main();
} catch (e) {
  console.error(e.stack || e.message);
  process.exitCode = 1;
} finally {
  try { cdp && cdp.ws.close(); } catch {}
  try { edge && edge.kill(); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
}
