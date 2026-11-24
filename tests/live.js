// Live test driver: opens a visible Chrome window (its own test profile, not your everyday one),
// loads the extension, and takes commands on http://127.0.0.1:47321 so a script or Claude can
// drive real job sites. Nothing is ever submitted by this script on its own.
//
// Run:  node tests/live.js            then send JSON commands, e.g.
//   curl -s localhost:47321 -d '{"op":"open","url":"https://example.com"}'
//   curl -s localhost:47321 -d '{"op":"fill"}'
// Ops: open {url,newTab} · targets · use {targetId} · eval {expr} · sw {expr} · click {selector|x,y}
//      text {text} · key {key} · shot {file} · fill · learn · frames · store · seed {answers} · quit
//
// The test copy of the extension gets access to every site, standing in for the access Chrome
// grants when you click the extension (activeTab). Real users get forms embedded from another
// site only after "Turn on for this site"; `frames` shows which frames those are.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.LIVE_DIR || path.join(os.homedir(), 'AppData', 'Local', 'jfa-live-test');
const PORT = Number(process.env.LIVE_PORT || 47321);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fixed folder for the extension copy, so its id (and saved answers) stay the same between runs.
function makeTestExtension() {
  const dir = path.join(BASE, 'extension');
  for (const part of ['src', 'popup', 'options', 'icons']) fs.cpSync(path.join(ROOT, part), path.join(dir, part), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function startChrome() {
  const userDir = path.join(BASE, 'profile');
  fs.mkdirSync(userDir, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${userDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1300,950',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
  );
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  let buf = Buffer.alloc(0);
  inp.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) >= 0) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
      buf = buf.subarray(i + 1);
      if (!msg.id) {
        for (const fn of listeners) fn(msg);
        continue;
      }
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  });
  function send(method, params = {}, sessionId, ms = 30000) {
    const id = nextId++;
    out.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout: ${method}`));
      }, ms);
    });
  }
  return { proc, send, on: (fn) => listeners.push(fn) };
}

async function main() {
  const extDir = makeTestExtension();
  const chrome = startChrome();
  const { send } = chrome;
  chrome.proc.on('exit', () => {
    console.log('Chrome closed; driver exiting');
    process.exit(0);
  });

  async function evaluate(sessionId, expression, ms) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, ms);
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    }
    return r.result.value;
  }
  async function waitFor(fn, what, ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const v = await fn().catch(() => null);
      if (v) return v;
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  await send('Target.setDiscoverTargets', { discover: true });
  const { id: extId } = await send('Extensions.loadUnpacked', { path: extDir });
  console.log(`extension loaded: ${extId}`);
  let swS = null;
  async function swEval(expr, ms) {
    // The worker sleeps when idle; re-attach when it has gone.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!swS) {
        const sw = await waitFor(async () => {
          const { targetInfos } = await send('Target.getTargets');
          let t = targetInfos.find((x) => x.type === 'service_worker' && x.url.startsWith(`chrome-extension://${extId}/`));
          if (!t) {
            // Wake it by opening an extension page briefly.
            const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html`, background: true });
            await sleep(800);
            await send('Target.closeTarget', { targetId });
          }
          return t;
        }, 'service worker');
        swS = (await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).sessionId;
        await waitFor(() => evaluate(swS, `typeof chrome === 'object' && !!chrome.tabs && !!globalThis.JFA`), 'extension APIs');
      }
      try {
        return await evaluate(swS, expr, ms);
      } catch (e) {
        if (attempt === 0 && /session|target|closed/i.test(e.message)) {
          swS = null;
          continue;
        }
        throw e;
      }
    }
  }
  chrome.on((msg) => {
    if (msg.method === 'Target.detachedFromTarget' && msg.params.sessionId === swS) swS = null;
    if (msg.method === 'Target.detachedFromTarget') {
      for (const [t, s] of sessions) if (s === msg.params.sessionId) sessions.delete(t);
    }
  });
  await swEval('1');

  const sessions = new Map();
  let current = null;
  async function pages() {
    const { targetInfos } = await send('Target.getTargets');
    return targetInfos.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  }
  async function session(targetId) {
    if (!sessions.has(targetId)) {
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      sessions.set(targetId, sessionId);
    }
    return sessions.get(targetId);
  }
  async function cur() {
    const list = await pages();
    if (!current || !list.some((t) => t.targetId === current)) current = list[0] && list[0].targetId;
    if (!current) current = (await send('Target.createTarget', { url: 'about:blank' })).targetId;
    return { targetId: current, sessionId: await session(current), info: list.find((t) => t.targetId === current) };
  }
  async function tabIdOf(targetId) {
    await send('Target.activateTarget', { targetId });
    await sleep(150);
    const info = (await pages()).find((t) => t.targetId === targetId);
    const tabs = await swEval(`chrome.tabs.query({ active: true }).then(ts => ts.map(t => ({ id: t.id, url: t.url })))`);
    const hit = tabs.find((t) => info && t.url === info.url) || tabs[0];
    if (!hit) throw new Error('no active tab found');
    return hit.id;
  }
  async function waitLoaded(sessionId) {
    await waitFor(() => evaluate(sessionId, `document.readyState === 'complete'`, 5000), 'page load', 30000).catch(() => null);
  }

  const ops = {
    async open({ url, newTab }) {
      if (newTab) {
        current = (await send('Target.createTarget', { url })).targetId;
      } else {
        const c = await cur();
        await send('Page.navigate', { url }, c.sessionId);
      }
      const c = await cur();
      await sleep(800);
      await waitLoaded(c.sessionId);
      return { targetId: c.targetId, url: await evaluate(c.sessionId, 'location.href'), title: await evaluate(c.sessionId, 'document.title') };
    },
    async targets() {
      return (await pages()).map((t) => ({ targetId: t.targetId, url: t.url, title: t.title, current: t.targetId === current }));
    },
    async use({ targetId }) {
      current = targetId;
      await send('Target.activateTarget', { targetId });
      return (await cur()).info;
    },
    async eval({ expr }) {
      const c = await cur();
      return evaluate(c.sessionId, expr, 60000);
    },
    async sw({ expr }) {
      return swEval(expr, 60000);
    },
    async click({ selector, index = 0, x, y }) {
      const c = await cur();
      await send('Target.activateTarget', { targetId: c.targetId });
      if (selector) {
        const box = await evaluate(
          c.sessionId,
          `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null;
            el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || el.value || '').slice(0, 80) }; })()`
        );
        if (!box) throw new Error(`nothing matches ${selector}`);
        ({ x, y } = box);
      }
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, c.sessionId);
      }
      await sleep(600);
      return { clicked: { x, y } };
    },
    async text({ text }) {
      const c = await cur();
      await send('Input.insertText', { text }, c.sessionId);
      return true;
    },
    async key({ key }) {
      const c = await cur();
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0 }, c.sessionId);
      return true;
    },
    async shot({ file }) {
      const c = await cur();
      await send('Target.activateTarget', { targetId: c.targetId });
      await sleep(200);
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, c.sessionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
    async fill() {
      const c = await cur();
      const tabId = await tabIdOf(c.targetId);
      return swEval(`JFA.inject.runInTab(${tabId}, 'fill').then(r => ({ sum: JFA.inject.sumResults(r), frames: r.map(f => ({ frameId: f.frameId, result: f.result })) }))`, 60000);
    },
    async learn() {
      const c = await cur();
      const tabId = await tabIdOf(c.targetId);
      return swEval(`JFA.inject.runInTab(${tabId}, 'learn').then(r => ({ sum: JFA.inject.sumResults(r) }))`, 60000);
    },
    async frames() {
      // Every frame's address, whether it's another site, and what fields the extension sees there.
      const c = await cur();
      const tabId = await tabIdOf(c.targetId);
      return swEval(
        `chrome.scripting.executeScript({ target: { tabId: ${tabId}, allFrames: true },
          func: () => ({ url: location.href.slice(0, 120), top: window === top, sameSiteAsTop: (() => { try { return !!top.location.host; } catch { return false; } })(),
            fields: document.querySelectorAll('input:not([type=hidden]), textarea, select, [role=combobox]').length }) })
          .then(r => r.map(f => f.result))`,
        60000
      );
    },
    async items() {
      // The questions the extension reads on the page, with what it would do for each.
      const c = await cur();
      const tabId = await tabIdOf(c.targetId);
      return swEval(
        `chrome.scripting.executeScript({ target: { tabId: ${tabId}, allFrames: true }, files: ['src/matcher.js', 'src/store.js', 'src/content.js'] })
          .then(() => chrome.scripting.executeScript({ target: { tabId: ${tabId}, allFrames: true },
            func: () => JFA.page._collect().map(i => ({ q: i.question, kind: i.kind, key: i.key, skip: i.skip || '', options: (i.options || []).slice(0, 8), frame: location.host })) }))
          .then(r => r.flatMap(f => f.result || []))`,
        60000
      );
    },
    async store() {
      return swEval(`chrome.storage.local.get(null)`);
    },
    async seed({ answers }) {
      const now = Date.now();
      const entries = {};
      for (const [key, v] of Object.entries(answers)) entries[`a:${key}`] = { question: v.question, value: v.value, values: v.values, updatedAt: now };
      entries.meta = { schemaVersion: 1 };
      await swEval(`chrome.storage.local.set(${JSON.stringify(entries)})`);
      return Object.keys(entries).length;
    },
    async clearUnknown() {
      return swEval(`chrome.storage.local.get(null).then(all => chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('u:'))))`);
    },
    async reload() {
      // Copy the latest code over the test copy and restart the extension (saved answers stay).
      makeTestExtension();
      // Loading the same folder again replaces the running copy (chrome.runtime.reload() unloads it for good).
      await send('Extensions.loadUnpacked', { path: extDir });
      swS = null;
      await sleep(1000);
      await swEval('1');
      return 'reloaded';
    },
    async quit() {
      setTimeout(() => chrome.proc.kill(), 100);
      return 'bye';
    },
  };

  http
    .createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let reply;
        try {
          const cmd = JSON.parse(body || '{}');
          const fn = ops[cmd.op];
          if (!fn) throw new Error(`unknown op ${cmd.op}; ops: ${Object.keys(ops).join(', ')}`);
          reply = { ok: true, result: await fn(cmd) };
        } catch (e) {
          reply = { ok: false, error: e.message };
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply, null, 1));
      });
    })
    .listen(PORT, '127.0.0.1', () => console.log(`driver ready on http://127.0.0.1:${PORT}`));
}

main().catch((err) => {
  console.error('live driver failed:', err);
  process.exit(1);
});
