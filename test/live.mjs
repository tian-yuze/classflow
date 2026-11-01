/* 线上 GitHub Pages 冒烟检查 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'C:\\Users\\Lenovo\\Downloads\\新建文件夹';
const PROFILE = path.join(ROOT, '.edge-live-profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9228;
const URL = 'https://tian-yuze.github.io/classflow/';
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let edge, cdp;
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const page = () => new Promise(async (resolve) => {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t) return resolve(t.webSocketDebuggerUrl);
    } catch {}
    await sleep(200);
  }
  resolve(null);
});

class C {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = new Map(); }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return;
      }
      (this.listeners.get(m.method) || []).forEach((f) => f(m.params));
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
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async waitFor(expression, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.eval(expression)) return;
      await sleep(100);
    }
    throw new Error('timeout: ' + expression);
  }
}

try {
  edge = spawn(EDGE, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = new C(await page());
  if (!cdp) throw new Error('CDP not available');
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push(p.entry.text); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL });
  await cdp.waitFor('window.CF && CF.App && document.querySelectorAll(".course-card").length > 0');
  const d = await cdp.eval('CF.App.debug()');
  if (d.state.schedules.length !== 2) throw new Error('expected 2 demo schedules, got ' + d.state.schedules.length);
  if (d.state.tasks.length !== 0) throw new Error('expected empty tasks');
  await cdp.eval('document.querySelector("[data-action=open-tasks]").click(); true');
  await cdp.waitFor('!!document.querySelector(".task-view")');
  const title = await cdp.eval('document.title');
  if (!title.includes('任务与备忘')) throw new Error('bad task title: ' + title);
  const storage = await cdp.eval('(function(){try{localStorage.setItem("__live__","1");localStorage.removeItem("__live__");return true}catch(e){return false}})()');
  if (!storage) throw new Error('localStorage unavailable');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(ROOT, 'test', 'live-home.png'), Buffer.from(shot.data, 'base64'));
  if (errors.length) throw new Error('browser errors: ' + errors.join(' | '));
  console.log('LIVE CHECKS PASSED', URL);
} catch (e) {
  console.error('LIVE CHECK FAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { cdp && cdp.ws.close(); } catch {}
  try { edge && edge.kill(); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
}
