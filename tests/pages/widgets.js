// Test-page helpers that behave like the custom widgets on real job sites.
// Not part of the extension.

window.submitCount = 0;
document.addEventListener('submit', (e) => {
  e.preventDefault();
  window.submitCount++;
  document.body.dataset.submitted = String(window.submitCount);
});

// A "controlled" input like React: it keeps its own state and puts it back on blur,
// so a value set without an input event is lost.
for (const el of document.querySelectorAll('[data-controlled]')) {
  let state = el.value;
  el.addEventListener('input', () => (state = el.value));
  el.addEventListener('blur', () => (el.value = state));
  el.addEventListener('focusout', () => (el.value = state));
}

function showList(owner, options, onPick) {
  document.querySelectorAll('.test-listbox').forEach((n) => n.remove());
  const list = document.createElement('ul');
  list.className = 'test-listbox';
  list.setAttribute('role', 'listbox');
  list.id = owner.id + '-listbox';
  const r = owner.getBoundingClientRect();
  Object.assign(list.style, { position: 'absolute', left: r.left + 'px', top: r.bottom + window.scrollY + 'px', background: '#fff', border: '1px solid #999', margin: 0, padding: '4px', listStyle: 'none', zIndex: 10 });
  for (const text of options) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.textContent = text;
    li.style.padding = '2px 6px';
    li.addEventListener('click', () => {
      onPick(text);
      list.remove();
      owner.setAttribute('aria-expanded', 'false');
    });
    list.append(li);
  }
  document.body.append(list);
  owner.setAttribute('aria-controls', list.id);
  owner.setAttribute('aria-expanded', 'true');
}

// Workday-style dropdown: a button that opens a list of options in a popup.
for (const btn of document.querySelectorAll('[data-test-dropdown]')) {
  const options = btn.dataset.testDropdown.split('|');
  btn.addEventListener('click', () => showList(btn, options, (text) => (btn.textContent = text)));
}

// react-select style: type to filter, pick from the list, the choice shows in a separate div.
for (const input of document.querySelectorAll('[data-test-combobox]')) {
  const options = input.dataset.testCombobox.split('|');
  const shown = input.parentElement.querySelector('.select__single-value');
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    const matches = options.filter((o) => o.toLowerCase().includes(q));
    showList(input, matches.length ? matches : [], (text) => {
      shown.textContent = text;
      input.value = '';
    });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.test-listbox').forEach((n) => n.remove());
  });
}
