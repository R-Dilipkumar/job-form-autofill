(async function () {
  const { store, matcher } = globalThis.JFA;
  const $ = (id) => document.getElementById(id);
  let rendering = false; // declared before the first render() call below

  $('search').addEventListener('input', render);
  $('add').addEventListener('click', addAnswer);
  $('export').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', importBackup);
  $('clear').addEventListener('click', clearAll);
  chrome.storage.onChanged.addListener(() => render());
  chrome.permissions.onAdded.addListener(renderSites);
  chrome.permissions.onRemoved.addListener(renderSites);

  await render();
  await renderSites();

  function setStatus(text, tone) {
    $('status').textContent = text;
    $('status').className = `status ${tone || ''}`;
  }

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  async function render() {
    if (rendering) return;
    rendering = true;
    try {
      const { answers, unknown } = await store.getAll();
      renderUnknown(unknown);
      renderAnswers(answers);
    } finally {
      rendering = false;
    }
  }

  function renderUnknown(unknown) {
    const list = Object.entries(unknown).sort((a, b) => (b[1].seenAt || 0) - (a[1].seenAt || 0));
    $('unknownCount').hidden = !list.length;
    $('unknownCount').textContent = String(list.length);
    $('unknownEmpty').hidden = list.length > 0;
    $('unknownList').replaceChildren(
      ...list.map(([key, q], i) => {
        const id = `u-${i}`;
        const choices = q.kind === 'checkbox' ? ['Yes', 'No'] : ['select', 'radio'].includes(q.kind) && q.options && q.options.length ? q.options : null;
        let input;
        if (choices) {
          input = el('select', { id }, el('option', { value: '', textContent: 'Pick an answer…' }));
          choices.forEach((c) => input.append(el('option', { value: c, textContent: c })));
        } else {
          input = el(q.kind === 'textarea' ? 'textarea' : 'input', { id, rows: 2, type: 'text' });
        }
        const save = el('button', { textContent: 'Save' });
        const skip = el('button', { className: 'link', textContent: 'Skip' });
        save.addEventListener('click', async () => {
          const value = input.value.trim();
          if (!value) return input.focus();
          await store.saveAnswer(key, matcher.labelForKey(key, q.question), value);
          setStatus(`Saved: ${q.question}`, 'ok');
        });
        skip.addEventListener('click', () => store.removeUnknown(key));
        return el(
          'li',
          {},
          el('label', { className: 'q', htmlFor: id, textContent: q.question }),
          input,
          el('div', { className: 'row' }, save, skip, el('span', { className: 'meta', textContent: q.host ? `Seen on ${q.host}` : '' }))
        );
      })
    );
  }

  function renderAnswers(answers) {
    const term = matcher.normalize($('search').value);
    const all = Object.entries(answers).sort((a, b) => String(a[1].question).localeCompare(String(b[1].question)));
    const shown = term
      ? all.filter(([k, a]) => matcher.normalize(`${a.question} ${a.value} ${(a.values || []).join(' ')}`).includes(term))
      : all;
    $('answerCount').hidden = !all.length;
    $('answerCount').textContent = String(all.length);
    $('answersEmpty').hidden = all.length > 0;

    const cells = [];
    for (const [key, a] of shown) {
      const values = a.values && a.values.length > 1 ? a.values : [a.value];
      const boxes = values.map((v, i) =>
        el('textarea', { rows: Math.min(6, Math.max(1, Math.ceil(String(v).length / 60))), value: v, ariaLabel: `${a.question} answer ${i + 1}` })
      );
      boxes.forEach((box) =>
        box.addEventListener('change', async () => {
          const next = boxes.map((b) => b.value.trim()).filter(Boolean);
          if (!next.length) return setStatus('An answer can’t be empty. Use Delete instead.', 'warn');
          await store.saveAnswers([{ key, question: a.question, value: next[0], values: next }]);
          setStatus(`Updated: ${a.question}`, 'ok');
        })
      );
      const del = el('button', { className: 'danger', textContent: 'Delete' });
      del.addEventListener('click', async () => {
        await store.removeAnswer(key);
        setStatus(`Deleted: ${a.question}`, 'ok');
      });
      const vals = el('div', { className: 'vals' }, ...boxes);
      if (values.length > 1) vals.append(el('span', { className: 'meta', textContent: 'Used in order for repeated sections (e.g. several jobs).' }));
      cells.push(el('div', { className: 'q', textContent: a.question, title: key.startsWith('@') ? 'Common field' : '' }), vals, del);
    }
    $('answers').replaceChildren(...cells);
  }

  async function addAnswer() {
    const question = $('newQuestion').value.trim();
    const value = $('newValue').value.trim();
    if (!question || !value) return setStatus('Type a question and an answer.', 'warn');
    const key = matcher.keyFor(question);
    if (!key) return setStatus('That question has no letters or numbers in it.', 'warn');
    await store.saveAnswer(key, matcher.labelForKey(key, question), value);
    $('newQuestion').value = '';
    $('newValue').value = '';
    setStatus(`Added: ${matcher.labelForKey(key, question)}`, 'ok');
  }

  async function renderSites() {
    const { origins = [] } = await chrome.permissions.getAll();
    $('sitesEmpty').hidden = origins.length > 0;
    $('sites').replaceChildren(
      ...origins.map((o) => {
        const remove = el('button', { className: 'link', textContent: 'Turn off' });
        remove.addEventListener('click', async () => {
          const removed = await chrome.permissions.remove({ origins: [o] });
          setStatus(removed ? `Turned off: ${o}` : `Couldn't turn off ${o}.`, removed ? 'ok' : 'error');
        });
        return el('li', {}, el('span', { textContent: o.replace(/\/\*$/, '') }), remove);
      })
    );
  }

  async function exportBackup() {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `job-form-autofill-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus(`Backup downloaded (${Object.keys(data.answers).length} answers).`, 'ok');
  }

  async function importBackup() {
    const file = $('importFile').files[0];
    $('importFile').value = '';
    if (!file) return;
    try {
      const count = await store.importAll(JSON.parse(await file.text()));
      setStatus(`Loaded ${count} entries from ${file.name}.`, 'ok');
    } catch (err) {
      setStatus(`Couldn't load that file: ${err.message}`, 'error');
    }
  }

  async function clearAll() {
    if (!confirm('Delete every saved answer and new question? This can’t be undone. Download a backup first if unsure.')) return;
    await store.clearAll();
    setStatus('All saved answers deleted.', 'ok');
  }
})();
