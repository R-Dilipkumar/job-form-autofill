// The "new question" card shared by the popup and the Manage answers page.
// Short choice lists become one-click chips; everything else gets a box and a Save button.
(function () {
  const { store, matcher, icon } = globalThis.JFA;
  const MAX_CHIPS = 6;
  const MAX_CHIP_CHARS = 40;

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function choicesFor(q) {
    if (q.kind === 'checkbox') return ['Yes', 'No'];
    if (['select', 'radio'].includes(q.kind) && q.options && q.options.length) return q.options;
    return null;
  }

  // key, q: the stored question; idPrefix keeps ids unique per page; onSaved(question) after a save.
  function questionCard(key, q, idPrefix, onSaved) {
    const qid = `${idPrefix}-q`;
    const save = async (value) => {
      const v = String(value || '').trim();
      if (!v) return false;
      await store.saveAnswer(key, matcher.labelForKey(key, q.question), v);
      onSaved(q.question);
      return true;
    };

    const skip = el('button', { className: 'icon-btn skip', type: 'button', title: 'Skip this question' }, icon('x'));
    skip.setAttribute('aria-label', `Skip: ${q.question}`);
    skip.addEventListener('click', () => store.removeUnknown(key));

    const meta = el('p', { className: 'meta' });
    if (q.host) meta.append(icon('globe'), `from ${q.host}`);

    const choices = choicesFor(q);
    let answer;
    let heading;
    if (choices && choices.length <= MAX_CHIPS && choices.every((c) => c.length <= MAX_CHIP_CHARS)) {
      heading = el('p', { className: 'q', id: qid, textContent: q.question });
      answer = el('div', { className: 'chips', role: 'group' });
      answer.setAttribute('aria-labelledby', qid);
      for (const c of choices) {
        const chip = el('button', { className: 'chip', type: 'button', textContent: c });
        chip.dataset.choice = c;
        chip.addEventListener('click', () => save(c));
        answer.append(chip);
      }
    } else {
      const inputId = `${idPrefix}-a`;
      heading = el('label', { className: 'q', htmlFor: inputId, textContent: q.question });
      let input;
      if (choices) {
        input = el('select', { id: inputId }, el('option', { value: '', textContent: 'Pick an answer…' }));
        for (const c of choices) input.append(el('option', { value: c, textContent: c }));
      } else if (q.kind === 'textarea') {
        input = el('textarea', { id: inputId, rows: 3 });
      } else {
        input = el('input', { id: inputId, type: 'text', autocomplete: 'off' });
        if (q.kind === 'checkgroup' && q.options) input.placeholder = `e.g. ${q.options.slice(0, 2).join('; ')}`;
      }
      const saveBtn = el('button', { className: 'btn btn-small save', type: 'button', textContent: 'Save' });
      saveBtn.addEventListener('click', async () => {
        if (!(await save(input.value))) input.focus();
      });
      if (input.tagName === 'INPUT') {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveBtn.click();
        });
      }
      answer = el('div', { className: 'answer-row' }, input, saveBtn);
    }

    return el('li', { className: 'qcard' }, heading, ...(q.host ? [meta] : []), answer, skip);
  }

  globalThis.JFA.questionCard = questionCard;
  globalThis.JFA.el = el;
})();
