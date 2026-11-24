(async function () {
  const { store, inject, questionCard } = globalThis.JFA;
  const $ = (id) => document.getElementById(id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let tab = null;
  let siteOrigins = [];

  $('fill').addEventListener('click', () => run('fill'));
  $('learn').addEventListener('click', () => run('learn'));
  $('manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('allow').addEventListener('change', toggleSite);

  render().catch((err) => setStatus(`Couldn't read saved answers: ${err.message}`, 'error'));
  showShortcut().catch((err) => console.error('[Job Form Autofill] shortcut lookup failed', err));
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || '')) {
      setButtons(false);
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

  function setButtons(on) {
    $('fill').disabled = !on;
    $('learn').disabled = !on;
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
    if (fill && fill.shortcut) $('shortcut').textContent = fill.shortcut;
    else $('shortcut').hidden = true;
  }

  // ---------- "always on for this site" switch ----------

  async function prepareSite() {
    let frameUrls = [];
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => [...document.querySelectorAll('iframe[src]')].map((f) => f.src),
      });
      frameUrls = (first && first.result) || [];
    } catch (err) {
      setButtons(false);
      setStatus(friendly(err), 'muted');
      return;
    }
    siteOrigins = [...new Set([tab.url, ...frameUrls].map(inject.originPattern).filter(Boolean))];
    const host = new URL(tab.url).hostname.replace(/^www\./, '');
    const on = await chrome.permissions.contains({ origins: siteOrigins });
    const others = siteOrigins.slice(1).map((o) => new URL(o.replace('/*', '/')).hostname);
    $('site').hidden = false;
    $('allow').checked = on;
    $('siteText').textContent = `Always on for ${host}`;
    $('siteHint').textContent = on
      ? 'Saves your answers whenever you press Submit or Next here.'
      : 'Turn on to save answers when you press Submit or Next' +
        (others.length ? `, and to reach the form embedded from ${others.join(', ')}.` : '.');
  }

  function toggleSite() {
    const want = $('allow').checked;
    // permissions.request must run straight from the click, before any await.
    const change = want ? chrome.permissions.request({ origins: siteOrigins }) : chrome.permissions.remove({ origins: siteOrigins });
    change
      .then(async (done) => {
        if (!done) setStatus(want ? 'Not turned on.' : "Couldn't turn it off.", 'muted');
        else setStatus(want ? 'Turned on. Reload the page once so it starts saving answers.' : 'Turned off for this site.', 'ok');
        await prepareSite();
      })
      .catch(async (err) => {
        setStatus(friendly(err), 'error');
        await prepareSite();
      });
  }

  // ---------- fill and save ----------

  async function run(action) {
    setButtons(false);
    setStatus(action === 'fill' ? 'Filling…' : 'Saving…', 'muted');
    try {
      const sum = inject.sumResults(await inject.runInTab(tab.id, action));
      if (action === 'fill') showFill(sum);
      else showSaved(sum);
    } catch (err) {
      setStatus(friendly(err), 'error');
    } finally {
      setButtons(true);
      await render();
    }
  }

  function showFill(s) {
    if (!s.fields && !s.errors.length) {
      $('result').hidden = true;
      return setStatus('No form fields found on this page. If the form is still loading, press Fill again.', 'muted');
    }
    const counts = { rFilled: s.filled, rGuessed: s.guessed, rHand: s.needsHand, rNew: s.unknown };
    for (const [id, n] of Object.entries(counts)) $(id).textContent = String(n);
    const bars = $('result').querySelectorAll('.meter span');
    [s.filled, s.guessed, s.needsHand, s.unknown].forEach((n, i) => (bars[i].style.flexGrow = String(n)));

    const notes = [];
    if (s.guessed) notes.push('Yellow boxes are guesses: please check them.');
    if (s.needsHand) notes.push('Red boxes need you.');
    if (s.unknown) notes.push('Answer the new questions below, then press Fill again.');
    if (s.alreadyFilled) notes.push(`${plural(s.alreadyFilled, 'field')} already had an answer.`);
    notes.push('Check the form, then submit it yourself.');
    $('resultNote').textContent = notes.join(' ');
    $('result').hidden = false;
    setStatus(s.errors.length ? `Problem: ${s.errors[0]}` : '', 'error');
  }

  function showSaved(s) {
    if (s.errors.length) return setStatus(`Problem: ${s.errors[0]}`, 'error');
    setStatus(s.saved ? `Saved ${plural(s.saved, 'answer')} from this page.` : 'No filled-in fields found to save.', s.saved ? 'ok' : 'muted');
  }

  // ---------- new questions ----------

  async function render() {
    const { answers, unknown } = await store.getAll();
    $('savedCount').textContent = plural(Object.keys(answers).length, 'saved answer');
    const list = Object.entries(unknown).sort((a, b) => (b[1].seenAt || 0) - (a[1].seenAt || 0));
    $('unknownCount').hidden = !list.length;
    $('unknownCount').textContent = String(list.length);
    $('unknownEmpty').hidden = list.length > 0;
    $('unknownList').replaceChildren(
      ...list.map(([key, q], i) =>
        questionCard(key, q, `p${i}`, async (question) => {
          setStatus(`Saved "${question}". Press Fill again to use it.`, 'ok');
          await render();
        })
      )
    );
  }

  // Skips made in a card update storage; redraw the list when it changes.
  chrome.storage.onChanged.addListener(() => render().catch(() => {}));
})();
