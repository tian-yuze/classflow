import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = 'C:\\Users\\Lenovo\\Downloads\\新建文件夹';
const PROFILE = path.join(ROOT, '.edge-extra-profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9225;
const BASE = 'http://127.0.0.1:8765/';
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
    `--user-data-dir=${PROFILE}`, '--window-size=1440,1000', 'about:blank'
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

const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('missing ' + ${JSON.stringify(sel)}); el.click(); return true; })()`);
const setVal = (sel, value, ev = 'input') => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('missing ' + ${JSON.stringify(sel)}); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })); return el.value; })()`);

async function waitFor(expr, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await evaluate(expr)) return true; } catch {}
    await sleep(80);
  }
  throw new Error('timed out waiting for: ' + expr);
}

async function waitGone(sel, timeout = 6000) {
  return waitFor(`!document.querySelector(${JSON.stringify(sel)})`, timeout);
}

async function appReady() {
  await waitFor('!!window.CF && !!CF.App && !!document.querySelector(".course-card")');
  await sleep(250);
}

async function reset() {
  await send('Page.navigate', { url: BASE });
  await waitFor('!!window.CF && !!CF.App');
  await evaluate('localStorage.clear(); location.reload(); true');
  await appReady();
}

async function settings() {
  await click('[data-action="open-settings"]');
  await waitFor('!!document.querySelector("#period-editor")');
  await sleep(120);
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
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
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args?.map((a) => a.value || a.description).join(' '));
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  console.log('== settings: period time edit ==');
  await reset();
  await settings();
  let rowCount = await evaluate('document.querySelectorAll(".period-row").length');
  assert(rowCount === 12, 'seed has 12 periods, got ' + rowCount);
  await setVal('.period-row:nth-child(1) .period-start', '07:55');
  await setVal('.period-row:nth-child(1) .period-end', '08:40');
  await click('#settings-save');
  await waitGone('.modal-layer');
  const times = await evaluate(`Array.from(document.querySelectorAll('.wg-time')).slice(0, 1).map((x) => x.innerText)`);
  assert(times[0].includes('07:55') && times[0].includes('08:40'), 'grid shows edited period time: ' + times[0]);
  console.log('  ok:', times[0].replace(/\n/g, ' '));

  console.log('== settings: add / delete unused period ==');
  await settings();
  await click('#add-period');
  rowCount = await evaluate('document.querySelectorAll(".period-row").length');
  assert(rowCount === 13, 'add period -> 13, got ' + rowCount);
  await click('#settings-save');
  await waitGone('.modal-layer');
  let timeRows = await evaluate('document.querySelectorAll(".wg-time").length');
  assert(timeRows === 13, 'grid rows -> 13, got ' + timeRows);
  await settings();
  await click('.period-row:last-child .period-del');
  rowCount = await evaluate('document.querySelectorAll(".period-row").length');
  assert(rowCount === 12, 'delete last -> 12, got ' + rowCount);
  await click('#settings-save');
  await waitGone('.modal-layer');
  timeRows = await evaluate('document.querySelectorAll(".wg-time").length');
  assert(timeRows === 12, 'grid rows -> 12, got ' + timeRows);
  console.log('  ok: add/remove period');

  console.log('== settings: used period cannot be deleted ==');
  await settings();
  await click('.period-row:nth-child(1) .period-del');
  await waitFor(`Array.from(document.querySelectorAll('.toast')).some((t) => /不能删除/.test(t.innerText))`);
  const toastText = await evaluate(`Array.from(document.querySelectorAll('.toast')).map((t) => t.innerText).find((t) => /不能删除/.test(t))`);
  assert(/不能删除/.test(toastText), 'used period delete toast: ' + toastText);
  rowCount = await evaluate('document.querySelectorAll(".period-row").length');
  assert(rowCount === 12, 'used period row remains, got ' + rowCount);
  await click('.modal-foot [data-modal-close]');
  await waitGone('.modal-layer');
  console.log('  ok:', toastText.replace(/\n/g, ' '));

  console.log('== course: conflict confirm / cancel ==');
  await reset();
  const before = await evaluate('document.querySelectorAll(".course-card").length');
  await click('[data-action="new-course"]');
  await waitFor('!!document.querySelector("#cf-name")');
  await setVal('#cf-name', '冲突测试');
  await setVal('#cf-day', '1', 'change');
  await setVal('#cf-start', '1', 'change');
  await setVal('#cf-end', '2', 'change');
  await setVal('#cf-weeks', '1-16周');
  await click('#cf-save');
  await waitFor('!!document.querySelector(".confirm-layer")');
  const confirmText = await evaluate('document.querySelector(".confirm-card").innerText');
  assert(/时间有重叠/.test(confirmText), 'conflict confirm shown: ' + confirmText.slice(0, 80));
  await click('.confirm-actions [data-confirm-cancel]');
  await waitGone('.confirm-layer');
  await click('.modal-foot [data-modal-close]');
  await waitGone('.modal-layer');
  const afterCancel = await evaluate('document.querySelectorAll(".course-card").length');
  assert(afterCancel === before, 'cancel conflict leaves count unchanged');
  console.log('  ok: conflict detected, cancel works');

  console.log('== course: edit and delete ==');
  await evaluate(`(() => { const card = Array.from(document.querySelectorAll('.course-card')).find((c) => c.innerText.includes('高等数学')); if (!card) throw new Error('high math card missing'); card.click(); return true; })()`);
  await waitFor('!!document.querySelector("#cd-edit")');
  await click('#cd-edit');
  await waitFor('!!document.querySelector("#cf-name")');
  await setVal('#cf-name', '高等数学（上）·修改');
  await click('#cf-save');
  await waitFor('!document.querySelector("#cf-name")');
  await sleep(200);
  const edited = await evaluate('document.body.innerText.includes("高等数学（上）·修改")');
  assert(edited, 'edited name appears');
  await evaluate(`(() => { const card = Array.from(document.querySelectorAll('.course-card')).find((c) => c.innerText.includes('高等数学（上）·修改')); if (!card) throw new Error('edited card missing'); card.click(); return true; })()`);
  await waitFor('!!document.querySelector("#cd-delete")');
  await click('#cd-delete');
  await waitFor('!!document.querySelector(".confirm-layer")');
  await click('.confirm-actions [data-confirm-ok]');
  await waitFor('!document.querySelector(".modal-layer")');
  await sleep(250);
  const still = await evaluate(`Array.from(document.querySelectorAll('.course-card')).some((c) => c.innerText.includes('高等数学（上）·修改'))`);
  assert(!still, 'deleted course removed');
  console.log('  ok: edit + delete');

  console.log('== schedule: create new + empty state + switch back ==');
  await reset();
  const tabsBefore = await evaluate('document.querySelectorAll("#schedule-tabs [data-action=switch-schedule]").length');
  await click('[data-action="new-schedule"]');
  await sleep(250);
  const tabsAfter = await evaluate('document.querySelectorAll("#schedule-tabs [data-action=switch-schedule]").length');
  assert(tabsAfter === tabsBefore + 1, 'new schedule tab added');
  const empty = await evaluate('!!document.querySelector(".empty-state")');
  assert(empty, 'new schedule shows empty state');
  await evaluate(`(() => { const tab = document.querySelector('#schedule-tabs [data-action=switch-schedule]'); if (!tab) throw new Error('tab missing'); tab.click(); return true; })()`);
  await sleep(250);
  const cards = await evaluate('document.querySelectorAll(".course-card").length');
  assert(cards > 0, 'switch back to demo shows cards');
  console.log('  ok: new schedule / switch');

  console.log('== import: merge into current ==');
  await reset();
  const beforeSchedules = await evaluate('CF.App.debug().state.schedules.length');
  const beforeCourses = await evaluate('CF.App.debug().state.schedules.find((s) => s.id === CF.App.debug().state.activeId).courses.length');
  await click('[data-action="open-import"]');
  await waitFor('!!document.querySelector("#import-text")');
  await setVal('#import-text', '课程名称,教师,地点,星期,节次,周次\n合并课程A,张老师,教一-101,周一,1-8周\n合并课程B,李老师,教二-202,周三,3-4节,1-16周');
  await click('#import-text-go');
  await waitFor('!!document.querySelector(".preview-row")');
  const rows = await evaluate('document.querySelectorAll(".preview-row").length');
  assert(rows === 2, 'merge preview rows 2, got ' + rows);
  await evaluate(`(() => { const el = document.querySelector('input[name="import-mode"][value="merge"]'); if (!el) throw new Error('merge radio missing'); el.click(); return true; })()`);
  await click('#import-confirm');
  await waitGone('.modal-layer');
  await sleep(300);
  const afterSchedules = await evaluate('CF.App.debug().state.schedules.length');
  const afterCourses = await evaluate('CF.App.debug().state.schedules.find((s) => s.id === CF.App.debug().state.activeId).courses.length');
  assert(afterSchedules === beforeSchedules, 'merge does not add schedule');
  assert(afterCourses === beforeCourses + 2, 'merge adds 2 courses, got ' + afterCourses);
  console.log('  ok: merged into current, courses', beforeCourses, '->', afterCourses);

  console.log('== import: paste html and preview guard ==');
  await reset();
  await click('[data-action="open-import"]');
  await waitFor('!!document.querySelector("#import-text")');
  const pasteResult = await evaluate(`(async () => {
    const res = await fetch('/test/fixtures/sample-timetable.html');
    const html = await res.text();
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', '');
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    const target = document.querySelector('.import-source');
    const notCanceled = target.dispatchEvent(ev);
    return { notCanceled };
  })()`);
  assert(pasteResult.notCanceled === false, 'html paste intercepted');
  await waitFor('!!document.querySelector(".preview-row")');
  const pasteRows = await evaluate('document.querySelectorAll(".preview-row").length');
  assert(pasteRows === 5, 'html paste preview 5 rows, got ' + pasteRows);
  const guard = await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'x');
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    document.querySelector('.pc-name').dispatchEvent(ev);
    return { prevented: ev.defaultPrevented };
  })()`);
  assert(guard.prevented === false, 'preview field paste is not intercepted');
  console.log('  ok: html paste', pasteRows, 'rows; preview field paste untouched');
  await click('.modal-foot [data-modal-close]');
  await waitGone('.modal-layer');

  console.log('== import: file input xlsx preview ==');
  await reset();
  await click('[data-action="open-import"]');
  await waitFor('!!document.querySelector("#import-file")');
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#import-file' });
  assert(q.nodeId, 'file input node found');
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [path.join(ROOT, 'test', 'fixtures', 'sample.xlsx')] });
  await waitFor('!!document.querySelector(".preview-row")');
  const fileRows = await evaluate('document.querySelectorAll(".preview-row").length');
  const starts = await evaluate(`Array.from(document.querySelectorAll('.pc-start')).map((x) => x.value)`);
  assert(fileRows === 3, 'xlsx preview 3 rows, got ' + fileRows);
  assert(starts.join(',') === '1,3,5', 'xlsx period values, got ' + starts);
  console.log('  ok: xlsx upload preview', fileRows, starts.join(','));
  await click('.modal-foot [data-modal-close]');
  await waitGone('.modal-layer');

  console.log('errors:', errors.length ? errors : 'none');
  if (errors.length) throw new Error('browser errors: ' + errors.join(' | '));
  console.log('EXTRA CHECKS PASSED');
}

main().catch((err) => {
  console.error('EXTRA FAILED:', err);
  process.exitCode = 1;
}).finally(async () => {
  try { await send('Browser.close'); } catch {}
  try { ws && ws.close(); } catch {}
  try { edge && edge.kill(); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
});
