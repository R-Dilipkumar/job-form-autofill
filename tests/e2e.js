// End-to-end test: loads the extension into a real (headless) Chrome and fills the test pages.
// Run: node tests/e2e.js        (uses installed Chrome; set CHROME_PATH to use another)
// The test copy of the extension gets host access to http://localhost only, standing in for
// the access Chrome grants when you click the extension (activeTab).
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const PAGES = path.join(__dirname, 'pages');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.env.SHOTS_DIR || '';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

// ---------- local web server on 127.0.0.1 and ::1 (so localhost and 127.0.0.1 are two origins) ----------
function startServer() {
  const handler = (req, res) => {
    const file = path.join(PAGES, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, ''));
    if (!file.startsWith(PAGES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const type = file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(file));
  };
  return new Promise((resolve) => {
    const v4 = http.createServer(handler).listen(0, '127.0.0.1', () => {
      const port = v4.address().port;
      const v6 = http.createServer(handler);
      v6.on('error', () => resolve({ port, close: () => v4.close() }));
      v6.listen(port, '::1', () => resolve({ port, close: () => (v4.close(), v6.close()) }));
    });
  });
}

// ---------- test copy of the extension ----------
function makeTestExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfa-ext-'));
  for (const part of ['src', 'popup', 'options', 'icons']) fs.cpSync(path.join(ROOT, part), path.join(dir, part), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://localhost/*'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

// ---------- Chrome DevTools protocol over a pipe ----------
function startChrome() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfa-chrome-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${userDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
  );
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let nextId = 1;
  const pending = new Map();
  let buf = Buffer.alloc(0);
  inp.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) >= 0) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
      buf = buf.subarray(i + 1);
      const p = msg.id && pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  });
  function send(method, params = {}, sessionId) {
    const id = nextId++;
    out.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout: ${method}`));
      }, 30000);
    });
  }
  return { proc, send, userDir };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = await startServer();
  const base = `http://localhost:${server.port}`;
  const otherBase = `http://127.0.0.1:${server.port}`;
  const extDir = makeTestExtension();
  const chrome = startChrome();
  const { send } = chrome;

  async function evaluate(sessionId, expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async function waitFor(fn, what, ms = 10000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const v = await fn().catch(() => null);
      if (v) return v;
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  try {
    const { id: extId } = await send('Extensions.loadUnpacked', { path: extDir });
    check('extension loads in Chrome', !!extId, extId);

    const sw = await waitFor(async () => {
      const { targetInfos } = await send('Target.getTargets');
      return targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
    }, 'service worker');
    const { sessionId: swS } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
    const swEval = (expr) => evaluate(swS, expr);
    // Right after attaching, the worker may not have its extension APIs yet.
    await waitFor(() => swEval(`typeof chrome === 'object' && !!chrome.tabs && !!globalThis.JFA`), 'extension APIs in the worker');

    const tabIds = () => swEval(`chrome.tabs.query({}).then(ts => ts.map(t => t.id))`);
    async function openPage(url) {
      // Tabs the extension can't access hide their URL, so find the new tab by its id instead.
      const before = new Set(await tabIds());
      const { targetId } = await send('Target.createTarget', { url });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await waitFor(() => evaluate(sessionId, `document.readyState === 'complete'`), `load ${url}`);
      const tabId = await waitFor(async () => (await tabIds()).find((id) => !before.has(id)) || null, `tab id for ${url}`);
      return { targetId, sessionId, tabId, eval: (expr) => evaluate(sessionId, expr) };
    }
    const run = (tabId, action) => swEval(`JFA.inject.runInTab(${tabId}, '${action}').then(r => ({ sum: JFA.inject.sumResults(r), frames: r.length }))`);
    const storage = () => swEval(`chrome.storage.local.get(null)`);

    // --- 1. Empty store: nothing filled, questions listed, sensitive ones left out ---
    let gh = await openPage(`${base}/greenhouse.html`);
    let r = await run(gh.tabId, 'fill');
    check('empty store fills nothing', r.sum.filled === 0 && r.sum.unknown >= 8, r.sum);
    let st = await storage();
    const unknownKeys = Object.keys(st).filter((k) => k.startsWith('u:'));
    check('first name listed as a new question', unknownKeys.includes('u:@first_name'), unknownKeys);
    check('SSN not listed', !unknownKeys.some((k) => /social/.test(k)), unknownKeys);
    check('privacy checkbox not listed', !unknownKeys.some((k) => /privacy/.test(k)), unknownKeys);
    check('file upload not listed', !unknownKeys.some((k) => /resume/.test(k)), unknownKeys);
    check('dropdown options kept for the popup', (st['u:@work_authorization'] || {}).options?.join('|') === 'Yes|No', st['u:@work_authorization']);

    // --- 2. Saved answers fill a Greenhouse-style page ---
    const seed = {
      'a:@first_name': { question: 'First name', value: 'Asha' },
      'a:@last_name': { question: 'Last name', value: 'Kumar' },
      'a:@email': { question: 'Email', value: 'asha@example.com' },
      'a:@phone': { question: 'Phone', value: '+91 98765 43210' },
      'a:@linkedin': { question: 'LinkedIn profile', value: 'https://linkedin.com/in/asha' },
      'a:@work_authorization': { question: 'Authorised to work', value: 'Yes' },
      'a:@sponsorship': { question: 'Needs visa sponsorship', value: 'No' },
      'a:why do you want to work here': { question: 'Why do you want to work here?', value: 'I like the work.' },
      'a:@notice_period': { question: 'Notice period', value: '30' },
      'a:@how_heard': { question: 'How you heard about the job', value: 'LinkedIn' },
      'a:@city': { question: 'City', value: 'Chennai' },
      'a:@postal_code': { question: 'Postal code', value: '600001' },
      'a:@relocate': { question: 'Willing to relocate', value: 'Yes' },
      'a:job title': { question: 'Job Title', value: 'Engineer', values: ['Engineer', 'Intern'] },
      'a:company': { question: 'Company', value: 'Acme', values: ['Acme', 'Beta'] },
      'a:social security number': { question: 'Social Security Number', value: 'SHOULD-NOT-FILL' },
    };
    await swEval(`chrome.storage.local.set(${JSON.stringify(seed)})`);
    await send('Target.closeTarget', { targetId: gh.targetId });
    gh = await openPage(`${base}/greenhouse.html`);
    r = await run(gh.tabId, 'fill');
    await sleep(300);
    const ghVals = await gh.eval(`({
      first: first_name.value, last: last_name.value, email: email.value, phone: phone.value,
      linkedin: q_linkedin.value, auth: q_auth.selectedOptions[0].text,
      sponsor: (document.querySelector('[name=q_sponsor]:checked') || {}).value,
      why: q_why.value, notice: q_notice.value,
      heard: document.querySelector('.select__single-value').textContent,
      ssn: q_ssn.value, privacy: q_privacy.checked, submits: window.submitCount,
      whyOutline: q_why.style.outlineColor, firstOutline: first_name.style.outlineColor
    })`);
    check('text fields filled', ghVals.first === 'Asha' && ghVals.last === 'Kumar' && ghVals.email === 'asha@example.com', ghVals);
    check('controlled (React-like) phone keeps its value', ghVals.phone === '+91 98765 43210', ghVals.phone);
    check('select picks "Yes"', ghVals.auth === 'Yes', ghVals.auth);
    check('radio picks "No"', ghVals.sponsor === 'no', ghVals.sponsor);
    check('similar question guessed and marked yellow', ghVals.why === 'I like the work.' && /202, 138, 4|ca8a04/.test(ghVals.whyOutline), ghVals);
    check('exact answer marked green', /22, 163, 74|16a34a/.test(ghVals.firstOutline), ghVals.firstOutline);
    check('type-to-search dropdown picks "LinkedIn"', ghVals.heard === 'LinkedIn', ghVals.heard);
    check('SSN never filled', ghVals.ssn === '', ghVals.ssn);
    check('privacy checkbox left for the user', ghVals.privacy === false);
    check('form not submitted', ghVals.submits === 0, ghVals.submits);
    check('fill summary counts', r.sum.filled >= 9 && r.sum.guessed >= 1 && r.sum.needsHand === 0, r.sum);
    st = await storage();
    check('answered questions leave the new-questions list', !st['u:@first_name'], Object.keys(st).filter((k) => k.startsWith('u:')));

    r = await run(gh.tabId, 'fill');
    check('second fill leaves filled fields alone', r.sum.filled === 0 && r.sum.alreadyFilled >= 9, r.sum);

    // --- 3. Lever-style page: derived full name, guessed radio, learning on submit ---
    const lv = await openPage(`${base}/lever.html`);
    r = await run(lv.tabId, 'fill');
    const lvVals = await lv.eval(`({
      name: document.querySelector('[name=name]').value,
      email: document.querySelector('[name=email]').value,
      relocate: (document.querySelector('[name="cards[0][field0]"]:checked') || {}).value,
      why: document.querySelector('[name="cards[0][field1]"]').value,
    })`);
    check('full name built from first + last', lvVals.name === 'Asha Kumar', lvVals.name);
    check('relocate radio guessed "Yes"', lvVals.relocate === 'Yes', lvVals.relocate);
    st = await storage();
    check('unknown Lever question listed', !!st['u:what is your favourite data tool'], Object.keys(st).filter((k) => k.startsWith('u:')));

    await lv.eval(`(() => {
      const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('[name="cards[0][field2]"]'), 'SQL');
      set(document.querySelector('[name=org]'), 'Acme');
      document.querySelector('button[type=submit]').click();
    })()`);
    await sleep(800);
    st = await storage();
    check('learned answer to new question on Submit', (st['a:what is your favourite data tool'] || {}).value === 'SQL', st['a:what is your favourite data tool']);
    check('learned current company', (st['a:@current_company'] || {}).value === 'Acme', st['a:@current_company']);
    check('learned question leaves the list', !st['u:what is your favourite data tool']);

    // --- 4. Workday-style page: button dropdown, repeated sections, skipped fields ---
    const wd = await openPage(`${base}/workday.html`);
    r = await run(wd.tabId, 'fill');
    await sleep(300);
    const wdVals = await wd.eval(`({
      search: document.querySelector('[aria-label="Search for jobs"]').value,
      first: w1.value, city: w4.value, postal: w5.value, code: w6.value, phone: w7.value,
      heard: w8.textContent, password: w9.value,
      jobs: [e1t.value, e2t.value], companies: [e1c.value, e2c.value],
    })`);
    check('Workday text fields filled', wdVals.first === 'Asha' && wdVals.city === 'Chennai' && wdVals.postal === '600001', wdVals);
    check('phone country code not mistaken for phone', wdVals.code === '' && wdVals.phone === '+91 98765 43210', wdVals);
    check('button dropdown picks "LinkedIn"', wdVals.heard === 'LinkedIn', wdVals.heard);
    check('password and search box left alone', wdVals.password === '' && wdVals.search === '', wdVals);
    check('repeated sections filled in order', wdVals.jobs.join() === 'Engineer,Intern' && wdVals.companies.join() === 'Acme,Beta', wdVals);
    await wd.eval(`(() => { w6.value = '+91'; w6.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-automation-id="bottom-navigation-next-button"]').click(); })()`);
    await sleep(800);
    st = await storage();
    check('learned on "Save and Continue"', (st['a:@phone_country_code'] || {}).value === '+91', st['a:@phone_country_code']);
    check('repeated answers kept as a list', (st['a:job title'] || {}).values?.join() === 'Engineer,Intern', st['a:job title']);
    check('password never saved', !Object.keys(st).some((k) => /password/.test(k)));

    // --- 5. Embedded forms ---
    const em = await openPage(`${base}/embed.html`);
    await sleep(500);
    r = await run(em.tabId, 'fill');
    check('fills same-site embedded form, skips the other site without error', r.frames === 2 && r.sum.errors.length === 0 && r.sum.filled >= 9, r);

    // --- 6. A page the extension has no access to fails loudly ---
    const other = await openPage(`${otherBase}/lever.html`);
    const err = await run(other.tabId, 'fill').then(() => null, (e) => e.message);
    check('no access gives a clear error', !!err && /Cannot access|permission/i.test(err), err);

    // --- 7. Popup and options pages ---
    await swEval(`chrome.storage.local.set({ 'u:do you enjoy testing': { question: 'Do you enjoy testing?', kind: 'radio', options: ['Yes', 'No'], host: 'localhost', seenAt: Date.now() + 60000 } })`);
    const pop = await openPage(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(500);
    const chipCount = await pop.eval(`document.querySelectorAll('#unknownList li:first-child [data-choice]').length`);
    check('short choice lists are one-click chips', chipCount === 2, chipCount);
    const popInfo = await pop.eval(`({ status: document.getElementById('status').textContent, items: document.querySelectorAll('#unknownList li').length, saved: document.getElementById('savedCount').textContent })`);
    check('popup lists new questions', popInfo.items >= 1 && /saved answers/.test(popInfo.saved), popInfo);
    const answered = await pop.eval(`(() => {
      const li = document.querySelector('#unknownList li');
      const chip = li.querySelector('[data-choice]');
      if (chip) { chip.click(); return 'chip'; }
      const input = li.querySelector('input, textarea, select');
      if (input.tagName === 'SELECT') input.selectedIndex = 1; else input.value = 'Answer from popup';
      li.querySelector('.save').click();
      return input.tagName;
    })()`);
    await sleep(400);
    const popAfter = await pop.eval(`document.getElementById('status').textContent`);
    const chipSaved = await swEval(`chrome.storage.local.get('a:do you enjoy testing').then(r => r['a:do you enjoy testing'])`);
    check('answering in the popup saves it', /Saved/.test(popAfter) && answered === 'chip' && chipSaved && chipSaved.value === 'Yes', { answered, popAfter, chipSaved });

    // Structure: every control has a name a screen reader can say, ids are unique, one h1.
    const structure = (page) =>
      page.eval(`(() => {
        const nameOf = (e) => (e.getAttribute('aria-label') || (e.labels && [...e.labels].map(l => l.textContent).join(' ')) ||
          (e.getAttribute('aria-labelledby') || '').split(' ').map(id => (document.getElementById(id) || {}).textContent || '').join(' ') ||
          e.textContent || e.title || '').trim();
        const controls = [...document.querySelectorAll('button, input:not([type=hidden]):not([hidden]), select, textarea, a[href]')];
        const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
        return {
          shownButHidden: [...document.querySelectorAll('[hidden]')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id || e.className),
          unnamed: controls.filter(e => !nameOf(e)).map(e => e.outerHTML.slice(0, 80)),
          dupIds: ids.filter((id, i) => ids.indexOf(id) !== i),
          h1: document.querySelectorAll('h1').length,
          lang: document.documentElement.lang,
        };
      })()`);
    for (const [name, page] of [['popup', pop]]) {
      const s = await structure(page);
      check(`${name}: every control has a name, ids unique, one h1, hidden stays hidden`, !s.shownButHidden.length && !s.unnamed.length && !s.dupIds.length && s.h1 === 1 && s.lang === 'en', s);
    }

    const opt = await openPage(`chrome-extension://${extId}/options/options.html`);
    await sleep(500);
    const optInfo = await opt.eval(`(async () => {
      const exported = await JFA.store.exportAll();
      const count = Object.keys(exported.answers).length;
      await JFA.store.clearAll();
      const afterClear = Object.keys((await JFA.store.getAll()).answers).length;
      await JFA.store.importAll(exported);
      const afterImport = Object.keys((await JFA.store.getAll()).answers).length;
      let badFile = '';
      try { await JFA.store.importAll({ hello: 1 }); } catch (e) { badFile = e.message; }
      await new Promise(r => setTimeout(r, 300));
      return { count, afterClear, afterImport, badFile, rows: document.querySelectorAll('#answers textarea').length };
    })()`);
    check('backup round-trip', optInfo.count > 10 && optInfo.afterClear === 0 && optInfo.afterImport === optInfo.count, optInfo);
    check('wrong backup file rejected', /not a Job Form Autofill backup/.test(optInfo.badFile), optInfo.badFile);
    check('options page lists answers', optInfo.rows >= optInfo.count, optInfo.rows);
    const groups = await opt.eval(`[...document.querySelectorAll('#answers h3')].map(h => h.textContent)`);
    check('saved answers grouped (About you first)', groups[0] === 'About you' && groups.includes('Your other answers'), groups);
    const s = await structure(opt);
    check('options: every control has a name, ids unique, one h1, hidden stays hidden', !s.shownButHidden.length && !s.unnamed.length && !s.dupIds.length && s.h1 === 1 && s.lang === 'en', s);

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      // Show the popup as it looks on a job page after a fill (opened as a tab here, it has no job page).
      await pop.eval(`(() => {
        for (const b of document.querySelectorAll('.hero button')) b.disabled = false;
        document.getElementById('status').textContent = '';
        const counts = [11, 1, 1, 2];
        ['rFilled', 'rGuessed', 'rHand', 'rNew'].forEach((id, i) => (document.getElementById(id).textContent = counts[i]));
        document.querySelectorAll('.meter span').forEach((b, i) => (b.style.flexGrow = counts[i]));
        document.getElementById('resultNote').textContent = 'Yellow boxes are guesses: please check them. Red boxes need you. Check the form, then submit it yourself.';
        document.getElementById('result').hidden = false;
        document.getElementById('site').hidden = false;
        document.getElementById('siteText').textContent = 'Always on for boards.greenhouse.io';
        document.getElementById('siteHint').textContent = 'Turn on to save answers when you press Submit or Next.';
      })()`);
      for (const scheme of ['light', 'dark']) {
        const suffix = scheme === 'light' ? '' : '-dark';
        for (const [name, page, w, h] of [['popup', pop, 380, 760], ['options', opt, 1280, 800], ['filled-form', gh, 1280, 800]]) {
          await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page.sessionId);
          await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, page.sessionId);
          await sleep(400);
          const { data } = await send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
          fs.writeFileSync(path.join(SHOTS, `${name}${suffix}.png`), Buffer.from(data, 'base64'));
        }
      }
      console.log(`screenshots saved to ${SHOTS}`);
    }
  } finally {
    chrome.proc.kill();
    server.close();
    await sleep(500);
    fs.rmSync(extDir, { recursive: true, force: true });
    try {
      fs.rmSync(chrome.userDir, { recursive: true, force: true });
    } catch {
      // Chrome may still hold files for a moment; the temp folder gets cleaned later.
    }
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E run failed:', err);
  process.exit(1);
});
