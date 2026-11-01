/* 生成 README 预览图：课程页（含今日待办）+ 任务页 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'C:\\Users\\Lenovo\\Downloads\\新建文件夹';
const PROFILE = path.join(ROOT, '.edge-preview-profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9227;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let edge, cdp;

try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}

function launch() {
  edge = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
}

async function endpoint() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async waitFor(expression, timeout = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.eval(expression)) return true;
      await sleep(80);
    }
    throw new Error('Timed out: ' + expression);
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('wrote', file);
  }
}

try {
  launch();
  cdp = new CDP(await endpoint());
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' });
  await cdp.waitFor('window.CF && CF.App && document.querySelectorAll(".course-card").length > 0', 10000);
  await cdp.eval('localStorage.clear(); location.reload(); true');
  await cdp.waitFor('window.CF && CF.App && document.querySelectorAll(".course-card").length > 0', 10000);
  await sleep(300);

  await cdp.eval(`(() => {
    const d = CF.App.debug();
    const now = new Date();
    const add = (n) => { const x = new Date(now); x.setDate(x.getDate() + n); return CF.Util.toDateInput(x); };
    const stamp = Date.now();
    d.state.settings.theme = 'dark';
    d.state.settings.tipDismissed = true;
    d.state.tasks = [
      CF.Data.normalizeTask({ title: '项目周会', type: 'meeting', date: add(0), start: '18:00', end: '19:00', location: '线上会议室', priority: 2, remind: 5, note: '同步本周进度，准备演示。', remindedAt: stamp }),
      CF.Data.normalizeTask({ title: '提交实验报告', type: 'task', date: add(1), priority: 1, remind: 0 }),
      CF.Data.normalizeTask({ title: '社团招新摆摊', type: 'activity', date: add(2), start: '14:00', end: '16:00', location: '中心广场', remind: null }),
      CF.Data.normalizeTask({ title: '英语听力练习', type: 'task', date: add(0), start: '21:00', end: '21:30', done: true, doneAt: stamp, remind: null }),
      CF.Data.normalizeTask({ title: '预约体测', type: 'reminder', date: add(9), start: '10:00', end: '10:30', location: '校医院', remind: 60 })
    ];
    d.state.memos = [
      CF.Data.normalizeMemo({ text: '周三前把实验报告打印出来', pinned: true }),
      CF.Data.normalizeMemo({ text: '图书馆借《数据结构》第 2 版' })
    ];
    CF.Data.save(d.state);
    location.reload();
    return true;
  })()`);
  await cdp.waitFor('window.CF && CF.App && document.querySelectorAll(".course-card").length > 0', 10000);
  await sleep(900);
  await cdp.shot(path.join(ROOT, 'preview.png'));

  await cdp.eval('document.querySelector("[data-action=open-tasks]").click(); true');
  await cdp.waitFor('!!document.querySelector(".task-view")');
  await sleep(500);
  await cdp.shot(path.join(ROOT, 'preview-tasks.png'));
} catch (e) {
  console.error(e.stack || e.message);
  process.exitCode = 1;
} finally {
  try { cdp && cdp.ws.close(); } catch {}
  try { edge && edge.kill(); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
}
