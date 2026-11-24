// Runs inside the job page (each frame). Finds fields, reads their questions, fills saved
// answers, lists unknown questions, and learns answers when you press Submit / Next.
// It never submits a form, never presses Enter, and never clicks a submit button.
(function () {
  const JFA = globalThis.JFA;
  if (JFA.page) return; // already set up in this frame
  const M = JFA.matcher;
  const store = JFA.store;

  const FIELD_SELECTOR = 'input, textarea, select, [role="combobox"], button[aria-haspopup="listbox"]';
  const SKIP_INPUT_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset', 'range', 'color', 'search']);
  // Outline per result. The line style differs too, so it reads without colour: solid, dashed, dotted.
  const OUTLINES = { ok: '2px solid #16a34a', guess: '2px dashed #ca8a04', hand: '3px dotted #dc2626' };
  const OPTION_WAIT_MS = 1500;
  const OPTION_POLL_MS = 100;
  const SEARCH_WAIT_MS = 3000; // search lists load from the site's server as you type
  const SEARCH_SETTLE_MS = 250;
  const SUGGEST_WAIT_MS = 4000;
  const SUGGEST_KEYS = new Set(['@location', '@city', '@preferred_location']); // place boxes
  const LEARN_BUTTON_TEXT = /\b(submit|apply|next|continue|save|review|send|proceed)\b/i;
  const LEARN_DEBOUNCE_MS = 1000;
  const MAX_QUESTION_CHARS = 300;
  const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  const YES = /^(yes|y|true|checked|on|1)$/i;

  const pendingCustom = new WeakMap(); // custom dropdown -> option text the user or we picked
  const marked = new Map(); // element -> original title
  let lastCustom = null;
  let lastLearnAt = 0;

  // ---------- finding fields ----------

  function deepQueryAll(root, selector) {
    const out = [...root.querySelectorAll(selector)];
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) out.push(...deepQueryAll(node.shadowRoot, selector));
    }
    return out;
  }

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  function kindOf(el) {
    const tag = el.tagName;
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'BUTTON') return 'custom';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) return null;
      if (type === 'radio') return 'radio';
      if (type === 'checkbox') return 'checkbox';
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') return 'custom';
      return 'text';
    }
    if (el.getAttribute('role') === 'combobox' && !el.querySelector('input')) return 'custom';
    return null;
  }

  function textOf(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, ' ').trim();
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll('input, select, textarea, option, [role="listbox"], [role="option"], script, style, svg')
      .forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function textByIds(ids, el) {
    const root = el.getRootNode();
    return ids
      .split(/\s+/)
      .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
      .filter(Boolean)
      .map(textOf)
      .join(' ')
      .trim();
  }

  function ownLabel(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = textByIds(labelledBy, el);
      if (t) return t;
    }
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map((label) => labelText(label, el)).join(' ').trim();
      if (t) return t;
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    return '';
  }

  // A <label> that wraps its field can also wrap the field's dropdown ("No location found...").
  // Read only the text before the field; if there's none (a tick box with text after it), read all.
  function labelText(label, el) {
    if (label.contains(el) && label.firstChild && label.firstChild !== el) {
      const range = document.createRange();
      range.setStartBefore(label.firstChild);
      range.setEndBefore(el);
      const before = textOf(range.cloneContents());
      if (before) return before;
    }
    return textOf(label);
  }

  // Very long text before a field is usually an explanation ending in the real question.
  function lastSentence(text) {
    const parts = text.split(/(?<=[.?!:])\s+/).filter((s) => s.trim());
    const last = parts.length ? parts[parts.length - 1] : text;
    return last.length <= MAX_QUESTION_CHARS ? last : '';
  }

  function holdsOtherField(node, ownEls) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const fields = node.matches(FIELD_SELECTOR) ? [node] : [...node.querySelectorAll(FIELD_SELECTOR)];
    return fields.some((f) => kindOf(f) && !ownEls.includes(f) && f.getAttribute('aria-hidden') !== 'true');
  }

  // Walk up from `start`; at each level read the text just before it. Stops at another field.
  function headingIn(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const h = node.matches(HEADING) ? node : node.querySelector(HEADING);
    return h ? textOf(h) : '';
  }

  function nearbyText(start, ownEls) {
    let node = start;
    let wantHeading = false; // passed a long explanation: the question is the heading just above it
    let headingUntil = 0;
    let lastOfLong = '';
    for (let depth = 0; node && depth < 6; depth++) {
      // Only a nearby heading belongs to this question; further up it's the form's own title.
      if (wantHeading && depth > headingUntil) return lastOfLong;
      for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
        if (holdsOtherField(sib, ownEls)) return lastOfLong;
        if (wantHeading) {
          const h = headingIn(sib);
          if (h && h.length <= MAX_QUESTION_CHARS) return h;
          continue;
        }
        const t = textOf(sib);
        if (!t) continue;
        if (t.length <= MAX_QUESTION_CHARS) return t;
        const h = headingIn(sib);
        if (h && h.length <= MAX_QUESTION_CHARS) return h;
        const last = lastSentence(t);
        if (last.endsWith('?') || last.endsWith(':')) return last;
        wantHeading = true;
        headingUntil = depth + 1;
        lastOfLong = last;
      }
      node = node.parentElement;
      if (!node || node === document.body || node.tagName === 'FORM') return lastOfLong;
      if (node.tagName === 'FIELDSET') {
        const legend = node.querySelector('legend');
        if (legend && textOf(legend)) return textOf(legend);
      }
    }
    return lastOfLong;
  }

  function humanize(s) {
    return String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-\[\].]+/g, ' ')
      .trim();
  }

  function questionFor(el) {
    return (
      ownLabel(el) ||
      nearbyText(el, [el]) ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      humanize(el.getAttribute('name') || el.id)
    );
  }

  function commonAncestor(els) {
    let node = els[0].parentElement;
    while (node && !els.every((e) => node.contains(e))) node = node.parentElement;
    return node;
  }

  function groupQuestion(els) {
    const fieldset = els[0].closest('fieldset');
    if (fieldset && els.every((e) => fieldset.contains(e))) {
      const legend = fieldset.querySelector('legend');
      if (legend && textOf(legend)) return textOf(legend);
    }
    const group = els[0].closest('[role="radiogroup"], [role="group"]');
    if (group && els.every((e) => group.contains(e))) {
      const t = ownLabel(group);
      if (t) return t;
    }
    const common = els.length > 1 ? commonAncestor(els) : els[0];
    return (common && nearbyText(common, els)) || humanize(els[0].getAttribute('name'));
  }

  function optionLabel(el) {
    const own = ownLabel(el);
    if (own) return own;
    const next = el.nextSibling && textOf(el.nextSibling);
    return next || el.value || '';
  }

  function cleanQuestion(q) {
    return String(q || '')
      .replace(/[*✱]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s*\(?required\)?\s*[.:]?\s*|\s*\(?\b(required|optional)\b\)?\s*[.:]?\s*$/gi, '') // "First name Required"
      .trim()
      .slice(0, MAX_QUESTION_CHARS);
  }

  function collectItems() {
    const items = [];
    const groups = new Map();
    const formIds = new Map();
    for (const el of deepQueryAll(document, FIELD_SELECTOR)) {
      const kind = kindOf(el);
      if (!kind || el.disabled) continue;
      if ((kind === 'text' || kind === 'textarea') && el.readOnly) continue;
      // Helper inputs that dropdown widgets hide from people (react-select's "required" input).
      if (el.getAttribute('aria-hidden') === 'true') continue;
      const shown = isVisible(el) || (el.labels && [...el.labels].some(isVisible));
      if (!shown) continue;

      if ((kind === 'radio' || kind === 'checkbox') && el.name) {
        if (!formIds.has(el.form)) formIds.set(el.form, formIds.size);
        const gid = `${kind}|${formIds.get(el.form)}|${el.name}`;
        if (groups.has(gid)) {
          groups.get(gid).els.push(el);
          continue;
        }
        const item = { kind, el, els: [el] };
        groups.set(gid, item);
        items.push(item);
        continue;
      }
      items.push(kind === 'radio' ? { kind, el, els: [el] } : { kind, el });
    }

    for (const item of items) {
      if (item.kind === 'checkbox' && item.els && item.els.length > 1) item.kind = 'checkgroup';
      if (item.kind === 'checkbox') delete item.els;

      if (item.els) {
        item.question = cleanQuestion(groupQuestion(item.els));
        item.options = item.els.map(optionLabel);
        item.key = M.keyFor(item.question);
      } else {
        item.question = cleanQuestion(questionFor(item.el));
        // A lone checkbox ("Current role", "I currently work here") is a yes/no of its own,
        // never one of the common text fields.
        item.key =
          item.kind === 'checkbox'
            ? M.normalize(item.question)
            : M.keyFor(item.question, {
                autocomplete: item.el.getAttribute('autocomplete'),
                type: item.el.getAttribute('type'),
              });
        if (item.kind === 'select') item.options = [...item.el.options].map((o) => o.text.trim());
      }

      if (!item.key) item.skip = 'no question';
      else if (M.isSensitive(item.question)) item.skip = 'sensitive';
      else if (M.isSearch(item.question)) item.skip = 'search box';
      else if (M.isConsent(item.question)) item.skip = 'consent'; // any kind: "I agree", "Please confirm receipt of the privacy notice"
    }
    return items;
  }

  // ---------- reading values ----------

  function singleValueText(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const v = node.querySelector('[class*="singleValue"], [class*="single-value"], [class*="selected-value"]');
      if (v) return textOf(v);
    }
    return '';
  }

  function customValue(item) {
    const el = item.el;
    const picked = pendingCustom.get(el);
    if (picked) return picked;
    const shown = el.tagName === 'BUTTON' ? textOf(el) : singleValueText(el) || (el.value || '').trim();
    return shown && !M.isPlaceholderOption(shown) ? shown : '';
  }

  function currentValue(item) {
    switch (item.kind) {
      case 'text':
      case 'textarea':
        return item.el.value.trim();
      case 'select': {
        const o = item.el.selectedOptions[0];
        if (!o || (!o.value && !o.text.trim()) || M.isPlaceholderOption(o.text)) return '';
        return o.text.trim();
      }
      case 'radio': {
        const c = item.els.find((e) => e.checked);
        return c ? optionLabel(c) : '';
      }
      case 'checkbox':
        return item.el.checked ? 'Yes' : '';
      case 'checkgroup':
        return item.els.filter((e) => e.checked).map(optionLabel).join('; ');
      case 'custom':
        return customValue(item);
      default:
        return '';
    }
  }

  // ---------- filling ----------

  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function typeValue(el, value, { blur = true } = {}) {
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    setNativeValue(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    fire(el, 'change');
    if (blur) {
      el.dispatchEvent(new FocusEvent('blur'));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
  }

  function press(el) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function isSubmitControl(el) {
    return (el.tagName === 'BUTTON' || el.tagName === 'INPUT') && String(el.type).toLowerCase() === 'submit';
  }

  // Choices in an open list: standard ones, Lever's place list, Google Places suggestions.
  const OPTION_SELECTOR = '[role="option"], .dropdown-location, .pac-item';

  function visibleOptions() {
    return deepQueryAll(document, OPTION_SELECTOR).filter(isVisible);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForNewOptions(before) {
    const until = Date.now() + OPTION_WAIT_MS;
    while (Date.now() < until) {
      await sleep(OPTION_POLL_MS);
      const now = visibleOptions().filter((o) => !before.has(o));
      if (now.length) {
        await sleep(OPTION_POLL_MS); // let the list finish drawing
        return visibleOptions().filter((o) => !before.has(o));
      }
    }
    return [];
  }

  function closeMenu(el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  function typeSearch(el, text) {
    el.focus({ preventScroll: true });
    typeValue(el, text, { blur: false });
    // Some sites (Greenhouse) update their list on key-up, not on input.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true }));
  }

  // After typing, wait until the list shows something other than `prevTexts` (search results
  // replacing the full list), or until time runs out.
  async function waitForListChange(others, prevTexts, ms) {
    const until = Date.now() + ms;
    const same = (list) => list.length === prevTexts.length && list.every((o, i) => textOf(o) === prevTexts[i]);
    await sleep(SEARCH_SETTLE_MS);
    let list = visibleOptions().filter((o) => !others.has(o));
    while (Date.now() < until && (!list.length || same(list))) {
      await sleep(OPTION_POLL_MS);
      list = visibleOptions().filter((o) => !others.has(o));
    }
    return list;
  }

  // Returns 'ok', 'guess' (a loose match, or typed text the box kept with no list) or 'hand'.
  async function fillCustom(item, value) {
    const el = item.el;
    if (isSubmitControl(el)) return 'hand';
    const others = new Set(visibleOptions()); // lists already open for other fields
    const typable = el.tagName === 'INPUT' && !el.readOnly;

    // 1. Open the list as it is: fixed lists show every choice. Typing the whole answer first
    //    would filter "Bachelor's Degree" out when the saved answer is "Bachelor's Degree (B.E.)".
    press(el);
    let options = await waitForNewOptions(others);
    let pick = M.bestOptionScored(value, options.map(textOf));

    // 2. Not there, or only loosely: type to search (long lists and place boxes load as you type).
    if (typable && pick.score < M.CLOSE_OPTION_SCORE) {
      const loose = pick.index >= 0 ? textOf(options[pick.index]) : '';
      const shown = options.map(textOf);
      typeSearch(el, value);
      options = await waitForListChange(others, shown, SEARCH_WAIT_MS);
      let typed = M.bestOptionScored(value, options.map(textOf));
      const head = value.split(',')[0].trim();
      if (typed.score < M.CLOSE_OPTION_SCORE && head && head !== value) {
        // Place searches often find "Karur" but not "Karur, Tamil Nadu, India".
        typeSearch(el, head);
        const more = await waitForListChange(others, options.map(textOf), SEARCH_WAIT_MS);
        const byHead = M.bestOptionScored(head, more.map(textOf));
        if (byHead.index >= 0 && byHead.score >= typed.score) {
          options = more;
          typed = { index: byHead.index, score: Math.min(byHead.score, M.CLOSE_OPTION_SCORE - 0.05) }; // matched on part: check it
        }
      }
      if (typed.index >= 0 && typed.score >= pick.score) {
        pick = typed;
      } else if (loose) {
        // The search found nothing better: clear it and take the loose match from the full list.
        typeSearch(el, '');
        options = await waitForListChange(others, options.map(textOf), SEARCH_WAIT_MS);
        const again = options.findIndex((o) => textOf(o) === loose);
        pick = again >= 0 ? { index: again, score: pick.score } : { index: -1, score: 0 };
      } else {
        pick = { index: -1, score: 0 };
      }
    }

    if (pick.index < 0 || isSubmitControl(options[pick.index])) {
      closeMenu(el);
      await sleep(OPTION_POLL_MS);
      // A free-text box that kept what we typed is a guess; an emptied one needs the user.
      return typable && el.value.trim() ? 'guess' : 'hand';
    }
    pendingCustom.set(el, textOf(options[pick.index]));
    press(options[pick.index]);
    await sleep(OPTION_POLL_MS);
    return pick.score >= M.CLOSE_OPTION_SCORE ? 'ok' : 'guess';
  }

  // Place boxes look like plain text boxes but want a pick from their suggestions; some (Lever)
  // empty themselves if you leave without picking. Type, wait for suggestions, pick the closest.
  async function fillSuggestBox(item, value) {
    const el = item.el;
    const others = new Set(visibleOptions());
    typeSearch(el, value);
    const options = await waitForListChange(others, [], SUGGEST_WAIT_MS);
    const pick = M.bestOptionScored(value, options.map(textOf));
    if (pick.index >= 0 && !isSubmitControl(options[pick.index])) {
      press(options[pick.index]);
      await sleep(OPTION_POLL_MS);
      if (el.value.trim()) return pick.score >= M.CLOSE_OPTION_SCORE ? 'ok' : 'guess';
    }
    // No list, or nothing close: leave the typed text.
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await sleep(OPTION_POLL_MS);
    return el.value === value ? 'ok' : el.value ? 'guess' : 'hand';
  }

  function samePhone(shown, typed) {
    const a = shown.replace(/\D/g, '');
    const b = typed.replace(/\D/g, '');
    return a.length >= 7 && b.endsWith(a);
  }

  function clickIfNeeded(el, wantChecked) {
    if (el.checked !== wantChecked) el.click();
    return el.checked === wantChecked;
  }

  // Returns 'ok', 'guess' or 'hand'.
  async function setValue(item, value) {
    const el = item.el;
    switch (item.kind) {
      case 'text':
      case 'textarea': {
        // "Notice period (in days)" wants 0, not "Immediate joiner"; "CTC in INR" wants 600000, not "6 LPA".
        const wanted = item.kind === 'text' && M.wantsNumber(item.question, el.type) ? M.numberFrom(value, item.question) : null;
        const text = wanted === null ? value : wanted;
        if (item.kind === 'text' && SUGGEST_KEYS.has(item.key)) return fillSuggestBox(item, text);
        typeValue(el, text);
        if (el.value === text) return 'ok';
        // Phone boxes with a flag picker move "+91" into the flag and keep "98765 43210".
        if (item.key === '@phone' && samePhone(el.value, text)) return 'ok';
        return el.value ? 'guess' : 'hand';
      }
      case 'select': {
        const { index, score } = M.bestOptionScored(value, item.options);
        if (index < 0) return 'hand';
        el.selectedIndex = index;
        fire(el, 'input');
        fire(el, 'change');
        if (el.selectedIndex !== index) return 'hand';
        return score >= M.CLOSE_OPTION_SCORE ? 'ok' : 'guess';
      }
      case 'radio': {
        const { index, score } = M.bestOptionScored(value, item.options);
        if (index < 0) return 'hand';
        if (!clickIfNeeded(item.els[index], true)) return 'hand';
        return score >= M.CLOSE_OPTION_SCORE ? 'ok' : 'guess';
      }
      case 'checkbox':
        if (!YES.test(String(value).trim())) return 'ok'; // saved as unticked: leave it
        return clickIfNeeded(el, true) ? 'ok' : 'hand';
      case 'checkgroup': {
        const wanted = String(value).split(/;\s*/).filter(Boolean);
        let all = true;
        item.els.forEach((box, i) => {
          if (wanted.some((w) => M.bestOption(w, [item.options[i]]) === 0)) all = clickIfNeeded(box, true) && all;
        });
        return all ? 'ok' : 'hand';
      }
      case 'custom':
        return fillCustom(item, value);
      default:
        return 'hand';
    }
  }

  // Type-to-search dropdowns hide a tiny input inside a bigger box: outline the box people see.
  function visibleBox(el) {
    let box = el;
    for (let depth = 0; depth < 4; depth++) {
      const r = box.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 24) break;
      const up = box.parentElement;
      if (!up || up === document.body || holdsOtherField(up, [el])) break;
      box = up;
    }
    return box;
  }

  function markTargets(item) {
    if (item.kind === 'custom' && item.el.tagName === 'INPUT') return [visibleBox(item.el)];
    if (!item.els) return [item.el];
    const checked = item.els.filter((e) => e.checked);
    const list = checked.length ? checked : item.els;
    return list.map((e) => (e.labels && e.labels[0]) || e);
  }

  function mark(item, status, note) {
    for (const t of markTargets(item)) {
      if (!marked.has(t)) marked.set(t, t.getAttribute('title'));
      t.style.outline = OUTLINES[status];
      t.style.outlineOffset = '2px';
      if (note) t.setAttribute('title', note);
      t.addEventListener('input', () => unmark(t), { once: true });
      t.addEventListener('change', () => unmark(t), { once: true });
    }
  }

  function unmark(t) {
    if (!marked.has(t)) return;
    const title = marked.get(t);
    t.style.outline = '';
    t.style.outlineOffset = '';
    if (title === null) t.removeAttribute('title');
    else t.setAttribute('title', title);
    marked.delete(t);
  }

  function pickValue(entry, occurrence) {
    if (entry.values && entry.values.length) return entry.values[occurrence] ?? null;
    return occurrence === 0 ? entry.value : null;
  }

  // Bot checks embedded in job sites (DataDome, reCAPTCHA, hCaptcha, Cloudflare): never touch them.
  const BOT_CHECK_HOST = /captcha|challenges\.cloudflare\.com|arkoselabs|funcaptcha/i;

  async function fill() {
    if (BOT_CHECK_HOST.test(location.hostname)) return { fields: 0, host: location.hostname, top: window === window.top };
    const { answers } = await store.getAll();
    const items = collectItems();
    const counts = { fields: 0, filled: 0, guessed: 0, needsHand: 0, alreadyFilled: 0, unknown: 0, skipped: 0 };
    const unknown = [];
    const answered = new Set(); // keys filled now, so they leave the new-questions list
    const seen = new Map();

    for (const item of items) {
      if (item.skip) {
        counts.skipped++;
        continue;
      }
      counts.fields++;
      const occurrence = seen.get(item.key) || 0;
      seen.set(item.key, occurrence + 1);

      if (currentValue(item)) {
        counts.alreadyFilled++;
        continue;
      }
      const found = M.findAnswer(item.key, item.question, answers);
      if (!found) {
        if (occurrence === 0) unknown.push({ key: item.key, question: item.question, kind: item.kind, options: (item.options || []).filter((o) => o && !M.isPlaceholderOption(o)) });
        continue;
      }
      const value = pickValue(found.entry, occurrence);
      if (value === null || value === '') continue;

      let status;
      try {
        status = await setValue(item, value);
      } catch (err) {
        console.error('[Job Form Autofill] could not fill', item.question, err);
        status = 'hand';
      }
      if (status === 'ok' && found.how === 'guess') status = 'guess';
      if (status !== 'hand') answered.add(item.key);
      if (status === 'ok') counts.filled++;
      else if (status === 'guess') counts.guessed++;
      else counts.needsHand++;

      const note =
        status === 'guess' && found.how === 'guess'
          ? `Job Form Autofill guessed this from your answer to "${found.from || found.entry.question}". Please check it.`
          : status === 'guess'
            ? `Job Form Autofill picked the closest match to your answer ("${value}"). Please check it.`
          : status === 'hand'
            ? `Job Form Autofill has an answer ("${value}") but couldn't set it here. Please fill it yourself.`
            : '';
      mark(item, status, note);
    }

    await store.addUnknown(unknown, location.hostname);
    await store.removeUnknown([...answered]);
    counts.unknown = unknown.length;
    return { ...counts, host: location.hostname, top: window === window.top };
  }

  // ---------- learning ----------

  const CHOICE_KINDS = new Set(['select', 'radio', 'custom', 'checkgroup']);
  const DIAL_CODE = /^\+\d{1,4}$/;

  async function learn({ auto }) {
    if (BOT_CHECK_HOST.test(location.hostname)) return { saved: 0, host: location.hostname };
    const items = collectItems();
    const byKey = new Map();
    for (const item of items) {
      if (item.skip) continue;
      const v = currentValue(item);
      if (!v) continue;
      if (!byKey.has(item.key)) {
        byKey.set(item.key, { key: item.key, question: M.labelForKey(item.key, item.question), values: [], choice: [], asked: [] });
      }
      byKey.get(item.key).values.push(v);
      byKey.get(item.key).choice.push(CHOICE_KINDS.has(item.kind));
      byKey.get(item.key).asked.push(item.question);
    }
    // A click on "Apply" on a page with just a search box is not an application.
    let filled = 0;
    for (const b of byKey.values()) filled += b.values.length;
    if (auto && filled < 2) return { saved: 0, host: location.hostname };

    const { answers } = await store.getAll();
    const batch = [...byKey.values()].map((b) => {
      const old = answers[b.key];
      const oldValues = old ? old.values || [old.value] : [];
      // A dropdown shows the site's wording ("Engineering", "India +91"). If that still fits the
      // saved answer ("Mechatronics Engineering", "India"), keep the saved one: it works on more sites.
      // A pick that doesn't fit is a real change and replaces it.
      // Phone country boxes (Greenhouse) show just "+91": never save that over a country answer.
      // A number we worked out from the saved answer ("0" from "Immediate joiner") isn't a change either.
      const keepOld = (v, i) =>
        oldValues[i] &&
        ((b.choice[i] && M.bestOption(oldValues[i], [v]) === 0) ||
          (DIAL_CODE.test(v) && b.key !== '@phone_country_code') ||
          (!b.choice[i] && oldValues[i] !== v && M.numberFrom(oldValues[i], b.asked[i]) === v));
      const picked = b.values.map((v, i) => (keepOld(v, i) ? oldValues[i] : v));
      const values = picked.concat(oldValues.slice(picked.length));
      return { key: b.key, question: b.question, value: values[0], values };
    });
    const saved = await store.saveAnswers(batch);
    return { saved, host: location.hostname, top: window === window.top };
  }

  function eventTarget(ev) {
    const path = ev.composedPath ? ev.composedPath() : [];
    return path[0] && path[0].nodeType === Node.ELEMENT_NODE ? path[0] : ev.target;
  }

  function learnSoon() {
    if (Date.now() - lastLearnAt < LEARN_DEBOUNCE_MS) return;
    lastLearnAt = Date.now();
    learn({ auto: true }).catch((err) => console.error('[Job Form Autofill] saving answers failed', err));
  }

  document.addEventListener(
    'click',
    (ev) => {
      const target = eventTarget(ev);
      if (!target || !target.closest) return;

      const option = target.closest('[role="option"]');
      if (option) {
        const owner = document.querySelector('[aria-expanded="true"][role="combobox"], [aria-expanded="true"][aria-haspopup="listbox"]') || lastCustom;
        if (owner) pendingCustom.set(owner, textOf(option));
        return;
      }

      const button = target.closest('button, input[type="submit"], input[type="button"], [role="button"], a');
      if (!button) return;
      const words = `${button.value || ''} ${textOf(button)} ${button.getAttribute('aria-label') || ''}`;
      if (LEARN_BUTTON_TEXT.test(words)) learnSoon();
    },
    true
  );
  document.addEventListener('submit', learnSoon, true);
  document.addEventListener(
    'focusin',
    (ev) => {
      const t = eventTarget(ev);
      if (t && t.matches && t.matches(FIELD_SELECTOR) && kindOf(t) === 'custom') lastCustom = t;
    },
    true
  );

  function safe(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        console.error('[Job Form Autofill]', err);
        return { error: String((err && err.message) || err), host: location.hostname };
      }
    };
  }

  JFA.page = {
    fill: safe(fill),
    learn: safe(() => learn({ auto: false })),
    frames: () => [...document.querySelectorAll('iframe[src]')].map((f) => f.src),
    // for the test pages only
    _collect: () =>
      collectItems().map((item) => ({
        kind: item.kind,
        question: item.question,
        key: item.key,
        skip: item.skip,
        options: item.options,
        value: item.skip ? '' : currentValue(item),
        outline: (markTargets(item)[0] || { style: {} }).style.outlineColor || '',
      })),
  };
})();
