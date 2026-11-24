(async function () {
  const { store, matcher, icon, el, questionCard } = globalThis.JFA;
  const $ = (id) => document.getElementById(id);
  let rendering = false; // declared before the first render() call below
  let statusTimer = null;

  // Saved answers are shown in these groups (common fields by id); everything else goes last.
  const GROUPS = [
    ['About you', ['first_name', 'middle_name', 'last_name', 'preferred_name', 'full_name', 'email', 'phone_country_code', 'phone', 'gender', 'pronouns', 'date_of_birth', 'nationality']],
    ['Links', ['linkedin', 'github', 'website']],
    ['Where you are', ['address', 'city', 'state', 'postal_code', 'country', 'location', 'preferred_location', 'relocate']],
    ['Work', ['current_company', 'current_title', 'years_experience', 'notice_period', 'current_salary', 'expected_salary', 'work_authorization', 'sponsorship', 'start_date', 'how_heard']],
    ['Education', ['school', 'degree', 'discipline', 'gpa', 'graduation_year']],
  ];
  const OTHER = 'Your other answers';

  $('search').addEventListener('input', render);
  $('addToggle').addEventListener('click', toggleAdd);
  $('addForm').addEventListener('submit', addAnswer);
  $('export').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', importBackup);
  $('clear').addEventListener('click', clearAll);
  chrome.storage.onChanged.addListener(() => render());
  chrome.permissions.onAdded.addListener(renderSites);
  chrome.permissions.onRemoved.addListener(renderSites);
  watchSections();

  await render();
  await renderSites();

  function setStatus(text, tone) {
    $('status').textContent = text;
    $('status').className = `status ${tone || ''}`;
    clearTimeout(statusTimer);
    if (tone !== 'error') statusTimer = setTimeout(() => setStatus(''), 4000);
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
    for (const id of ['unknownCount', 'navUnknown']) {
      $(id).hidden = !list.length;
      $(id).textContent = String(list.length);
    }
    $('unknownEmpty').hidden = list.length > 0;
    $('unknownList').replaceChildren(
      ...list.map(([key, q], i) => questionCard(key, q, `u${i}`, (question) => setStatus(`Saved: ${question}`, 'ok')))
    );
  }

  function groupOf(key) {
    if (!key.startsWith('@')) return [OTHER, 0];
    const id = key.slice(1);
    for (const [name, ids] of GROUPS) {
      const at = ids.indexOf(id);
      if (at >= 0) return [name, at];
    }
    return [OTHER, 0];
  }

  function renderAnswers(answers) {
    // Don't redraw under the cursor: a change event saves, and the redraw would drop focus.
    if ($('answers').contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
    const term = matcher.normalize($('search').value);
    const all = Object.entries(answers);
    const shown = term
      ? all.filter(([, a]) => matcher.normalize(`${a.question} ${a.value} ${(a.values || []).join(' ')}`).includes(term))
      : all;
    $('answerCount').hidden = !all.length;
    $('answerCount').textContent = String(all.length);
    $('navAnswers').textContent = String(all.length);
    $('answersEmpty').hidden = all.length > 0;
    $('noMatch').hidden = !(all.length && !shown.length);

    const byGroup = new Map([...GROUPS.map(([name]) => [name, []]), [OTHER, []]]);
    for (const entry of shown) {
      const [name, order] = groupOf(entry[0]);
      byGroup.get(name).push([order, entry]);
    }
    let n = 0;
    const sections = [];
    for (const [name, rows] of byGroup) {
      if (!rows.length) continue;
      rows.sort((a, b) => a[0] - b[0] || String(a[1][1].question).localeCompare(String(b[1][1].question)));
      const hid = `g${sections.length}`;
      const group = el('section', { className: 'group' }, el('h3', { id: hid, textContent: name }));
      group.setAttribute('aria-labelledby', hid);
      for (const [, [key, a]] of rows) group.append(answerRow(key, a, n++));
      sections.push(group);
    }
    $('answers').replaceChildren(...sections);
  }

  function grow(box) {
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  }

  function answerRow(key, a, n) {
    const values = a.values && a.values.length > 1 ? a.values : [a.value];
    const boxes = values.map((v, i) => {
      const box = el('textarea', { className: 'autogrow', rows: 1, value: v, id: i === 0 ? `a${n}` : `a${n}-${i}` });
      if (i > 0) box.setAttribute('aria-label', `${a.question}, entry ${i + 1}`);
      box.addEventListener('input', () => grow(box));
      box.addEventListener('change', async () => {
        const next = boxes.map((b) => b.value.trim()).filter(Boolean);
        if (!next.length) return setStatus('An answer can’t be empty. Use the bin button to delete it.', 'warn');
        await store.saveAnswers([{ key, question: a.question, value: next[0], values: next }]);
        setStatus(`Updated: ${a.question}`, 'ok');
      });
      requestAnimationFrame(() => grow(box));
      return box;
    });

    const label = el('label', { className: 'aq', htmlFor: `a${n}`, textContent: a.question });
    const del = el('button', { className: 'icon-btn danger', type: 'button', title: 'Delete this answer' }, icon('trash'));
    del.setAttribute('aria-label', `Delete answer: ${a.question}`);
    del.addEventListener('click', async () => {
      await store.removeAnswer(key);
      setStatus(`Deleted: ${a.question}`, 'ok');
    });
    const vals = el('div', { className: 'avals' }, ...boxes);
    if (values.length > 1) vals.append(el('p', { className: 'meta', textContent: `${values.length} entries, used in order` }));
    return el('div', { className: 'arow' }, label, vals, del);
  }

  function toggleAdd() {
    const open = $('addForm').hidden;
    $('addForm').hidden = !open;
    $('addToggle').setAttribute('aria-expanded', String(open));
    if (open) $('newQuestion').focus();
  }

  async function addAnswer(event) {
    event.preventDefault();
    const question = $('newQuestion').value.trim();
    const value = $('newValue').value.trim();
    if (!question || !value) return setStatus('Type a question and an answer.', 'warn');
    const key = matcher.keyFor(question);
    if (!key) return setStatus('That question has no letters or numbers in it.', 'warn');
    await store.saveAnswer(key, matcher.labelForKey(key, question), value);
    $('newQuestion').value = '';
    $('newValue').value = '';
    $('newQuestion').focus();
    setStatus(`Added: ${matcher.labelForKey(key, question)}`, 'ok');
  }

  async function renderSites() {
    const { origins = [] } = await chrome.permissions.getAll();
    $('sitesEmpty').hidden = origins.length > 0;
    $('sites').replaceChildren(
      ...origins.map((o) => {
        const site = o.replace(/\/\*$/, '');
        const remove = el('button', { className: 'btn btn-small', type: 'button', textContent: 'Turn off' });
        remove.setAttribute('aria-label', `Turn off ${site}`);
        remove.addEventListener('click', async () => {
          const removed = await chrome.permissions.remove({ origins: [o] });
          setStatus(removed ? `Turned off: ${site}` : `Couldn't turn off ${site}.`, removed ? 'ok' : 'error');
        });
        return el('li', {}, el('span', { textContent: site }), remove);
      })
    );
  }

  // Highlight the section you're looking at in the side menu.
  function watchSections() {
    const links = [...document.querySelectorAll('.side a')];
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          links.forEach((l) => l.setAttribute('aria-current', String(l.hash === `#${e.target.id}`)));
        }
      },
      { rootMargin: '-90px 0px -60% 0px' }
    );
    links.forEach((l) => seen.observe(document.querySelector(l.hash)));
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
