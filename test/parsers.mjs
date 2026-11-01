import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = 'C:\\Users\\Lenovo\\Downloads\\新建文件夹';
const PROFILE = path.join(ROOT, '.edge-probe-profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9224;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let edge, ws;
const pending = new Map();
let seq = 0;
const errors = [];

function launch() {
  edge = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`, '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
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
  throw new Error('no CDP endpoint');
}

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true
  });
  if (r.exceptionDetails) {
    const ex = r.exceptionDetails;
    throw new Error(ex.exception?.description || ex.text);
  }
  return r.result?.value;
}

async function main() {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  launch();
  ws = new WebSocket(await endpoint());
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'exception');
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/' });
  for (let i = 0; i < 80; i++) {
    if (await evaluate('!!window.CF && !!CF.App')) break;
    await sleep(100);
  }
  await sleep(400);

  const xlsx = await evaluate(`(async () => {
    const res = await fetch('/test/fixtures/sample.xlsx');
    const buf = await res.arrayBuffer();
    const app = CF.App.debug();
    const s = app.state.schedules.find((x) => x.id === app.state.activeId);
    const out = await CF.Parse.parseXlsx(buf, { totalWeeks: 20, periods: s.periods });
    return { courses: out.courses, warnings: out.warnings, meta: out.meta };
  })()`);
  console.log('XLSX:', JSON.stringify(xlsx, null, 2));

  const html = await evaluate(`(async () => {
    const res = await fetch('/test/fixtures/sample-timetable.html');
    const text = await res.text();
    const app = CF.App.debug();
    const s = app.state.schedules.find((x) => x.id === app.state.activeId);
    const out = CF.Parse.parseHtml(text, { totalWeeks: 20, periods: s.periods });
    return { courses: out.courses, warnings: out.warnings, meta: out.meta };
  })()`);
  console.log('HTML:', JSON.stringify(html, null, 2));

  const ics = await evaluate(`(() => {
    const app = CF.App.debug();
    const s = app.state.schedules.find((x) => x.id === app.state.activeId);
    const text = CF.Data.exportICS(s);
    return { length: text.length, events: (text.match(/BEGIN:VEVENT/g) || []).length, head: text.slice(0, 120) };
  })()`);
  console.log('ICS:', JSON.stringify(ics));

  const bookmarklet = await evaluate('(() => { const s = CF.Parse.bookmarklet(); return { prefix: s.slice(0, 30), length: s.length }; })()');
  console.log('BOOKMARKLET:', JSON.stringify(bookmarklet));

  const fileParsed = await evaluate(`(async () => {
    const res = await fetch('/test/fixtures/sample.xlsx');
    const blob = await res.blob();
    const file = new File([blob], 'sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const app = CF.App.debug();
    const s = app.state.schedules.find((x) => x.id === app.state.activeId);
    const out = await CF.Parse.parseFile(file, { totalWeeks: 20, periods: s.periods });
    return { courses: out.courses.length, names: out.courses.map((c) => c.name), source: out.meta.source };
  })()`);
  console.log('FILE PARSER:', JSON.stringify(fileParsed));

  console.log('== file:// page ==');
  await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!!window.CF && !!CF.App && !!document.querySelector(".course-card")')) break;
    await sleep(100);
  }
  await sleep(500);
  const filePage = await evaluate(`(() => ({
    title: document.title,
    theme: document.documentElement.getAttribute('data-theme'),
    cards: document.querySelectorAll('.course-card').length,
    schedules: CF.App.debug ? CF.App.debug().state.schedules.length : null,
    storage: (() => { try { localStorage.setItem('cf-probe', '1'); localStorage.removeItem('cf-probe'); return true; } catch { return false; } })()
  }))()`);
  console.log('FILE PAGE:', JSON.stringify(filePage));
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(ROOT, 'test', '18-file-home.png'), Buffer.from(shot.data, 'base64'));

  console.log('errors:', errors.length ? errors : 'none');
  const ok = xlsx.courses?.length === 3 && html.courses?.length >= 4 && ics.events > 0 &&
    bookmarklet.prefix.startsWith('javascript:') && fileParsed.courses === 3 &&
    filePage.cards > 0 && filePage.storage === true;
  if (!ok) throw new Error('probe assertions failed');
  console.log('PARSER PROBE PASSED');
}

main().catch((e) => {
  console.error('PROBE FAILED:', e.stack || e.message);
  process.exitCode = 1;
}).finally(async () => {
  try { await send('Browser.close'); } catch {}
  await sleep(500);
  try { if (edge && !edge.killed) edge.kill(); } catch {}
  process.exit(process.exitCode || 0);
});
