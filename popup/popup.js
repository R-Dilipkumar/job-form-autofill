(async function () {
  const { store, inject, matcher } = globalThis.JFA;
  const $ = (id) => document.getElementById(id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let tab = null;
  let siteOrigins = [];

  $('fill').addEventListener('click', () => run('fill'));
  $('learn').addEventListener('click', () => run('learn'));
  $('manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('allow').addEventListener('click', allowSite);

  render().catch((err) => setStatus(`Couldn't read saved answers: ${err.message}`, 'error'));
  showShortcut().catch((err) => console.error('[Job Form Autofill] shortcut lookup failed', err));
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || '')) {
      $('fill').disabled = true;
      $('learn').disabled = true;
      setStatus('Open a job application page first.', 'muted');
    } else {
      await prepareSite();
    }
  } catch (err) {
    setStatus(`Something went wrong: ${err.message}`, 'error');
  }

  function setStatus(text, tone) {
    $('status').textContent = text;
    $('status').className = `status ${tone || ''}`;
  }

  function friendly(err) {
    const msg = String((err && err.message) || err);
    if (/cannot be scripted|Cannot access|chrome:\/\/|extensions gallery/i.test(msg)) {
      return "Chrome doesn't let extensions work on this page.";
    }
    return `Something went wrong: ${msg}`;
  }

  async function showShortcut() {
    const cmds = await chrome.commands.getAll();
    const fill = cmds.find((c) => c.name === 'fill-page');
    $('shortcut').textContent = fill && fill.shortcut ? fill.shortcut : 'not set';
  }

  async function prepareSite() {
    let frameUrls = [];
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => [...document.querySelectorAll('iframe[src]')].map((f) => f.src),
      });
      frameUrls = (first && first.result) || [];
    } catch (err) {
      $('fill').disabled = true;
      $('learn').disabled = true;
      setStatus(friendly(err), 'muted');
      return;
    }
    siteOrigins = [...new Set([tab.url, ...frameUrls].map(inject.originPattern).filter(Boolean))];
    const host = new URL(tab.url).hostname;
    const on = await chrome.permissions.contains({ origins: siteOrigins });
    $('site').hidden = false;
    $('allow').hidden = on;
    if (on) {
      $('siteText').textContent = `On for ${host}: answers are saved when you press Submit or Next.`;
    } else {
      const others = siteOrigins.slice(1).map((o) => new URL(o.replace('/*', '/')).hostname);
      $('siteText').textContent =
        `Turn on for ${host} to save answers whenever you press Submit or Next, and to reach forms embedded from another site` +
        (others.length ? ` (${others.join(', ')}).` : '.');
    }
  }

  function allowSite() {
    // Must be called straight from the click, before any await.
    chrome.permissions
      .request({ origins: siteOrigins })
      .then(async (granted) => {
        if (!granted) return setStatus('Not turned on.', 'muted');
        setStatus('Turned on. Reload the page once so it starts saving answers.', 'ok');
        await prepareSite();
      })
      .catch((err) => setStatus(friendly(err), 'error'));
  }

  async function run(action) {
    $('fill').disabled = true;
    $('learn').disabled = true;
    setStatus(action === 'fill' ? 'Filling…' : 'Saving…', 'muted');
    try {
      const sum = inject.sumResults(await inject.runInTab(tab.id, action));
      const text = action === 'fill' ? fillMessage(sum) : learnMessage(sum);
      setStatus(text, sum.errors.length || sum.needsHand ? 'warn' : 'ok');
    } catch (err) {
      setStatus(friendly(err), 'error');
    } finally {
      $('fill').disabled = false;
      $('learn').disabled = false;
      await render();
    }
  }

  function fillMessage(s) {
    if (!s.fields && !s.errors.length) return 'No form fields found on this page.';
    const parts = [`Filled ${plural(s.filled, 'field')}.`];
    if (s.guessed) parts.push(`${s.guessed} guessed (yellow): please check.`);
    if (s.needsHand) parts.push(`${s.needsHand} need you (red).`);
    if (s.unknown) parts.push(`${plural(s.unknown, 'new question')} below.`);
    if (s.alreadyFilled) parts.push(`${s.alreadyFilled} already had an answer.`);
    if (s.errors.length) parts.push(`Problem: ${s.errors[0]}`);
    parts.push('Check the form, then submit it yourself.');
    return parts.join(' ');
  }

  function learnMessage(s) {
    if (s.errors.length) return `Problem: ${s.errors[0]}`;
    return s.saved ? `Saved ${plural(s.saved, 'answer')} from this page.` : 'No filled-in fields found to save.';
  }

  async function render() {
    const { answers, unknown } = await store.getAll();
    const n = Object.keys(answers).length;
    $('savedCount').textContent = `${plural(n, 'saved answer')}`;
    const list = Object.entries(unknown).sort((a, b) => (b[1].seenAt || 0) - (a[1].seenAt || 0));
    $('unknownCount').hidden = !list.length;
    $('unknownCount').textContent = String(list.length);
    $('unknownEmpty').hidden = list.length > 0;
    $('unknownList').replaceChildren(...list.map(([key, q], i) => unknownItem(key, q, i)));
  }

  function choicesFor(q) {
    if (q.kind === 'checkbox') return ['Yes', 'No'];
    if (['select', 'radio'].includes(q.kind) && q.options && q.options.length) return q.options;
    return null;
  }

  function unknownItem(key, q, i) {
    const li = document.createElement('li');
    const id = `unknown-${i}`;

    const label = document.createElement('label');
    label.className = 'q';
    label.htmlFor = id;
    label.textContent = q.question;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = q.host ? `Seen on ${q.host}` : '';

    let input;
    const choices = choicesFor(q);
    if (choices) {
      input = document.createElement('select');
      input.append(new Option('Pick an answer…', ''));
      for (const c of choices) input.append(new Option(c, c));
    } else if (q.kind === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      if (q.kind === 'checkgroup' && q.options) input.placeholder = `e.g. ${q.options.slice(0, 2).join('; ')}`;
    }
    input.id = id;

    const row = document.createElement('div');
    row.className = 'row';
    const save = document.createElement('button');
    save.textContent = 'Save';
    const skip = document.createElement('button');
    skip.className = 'link';
    skip.textContent = 'Skip';
    row.append(save, skip, meta);

    save.addEventListener('click', async () => {
      const value = input.value.trim();
      if (!value) return input.focus();
      await store.saveAnswer(key, matcher.labelForKey(key, q.question), value);
      setStatus('Saved. Press Fill again to use it.', 'ok');
      await render();
    });
    skip.addEventListener('click', async () => {
      await store.removeUnknown(key);
      await render();
    });
    if (input.tagName === 'INPUT') {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save.click();
      });
    }

    li.append(label, input, row);
    return li;
  }
})();
