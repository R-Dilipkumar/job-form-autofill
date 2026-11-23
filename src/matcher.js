// Matching rules: clean up question text, spot common fields, score similar questions and options.
// Plain functions only (no DOM, no chrome APIs) so Node can test them.
(function () {
  const STOP_WORDS = new Set(
    ('a an the you your yours do does did are is was were be been of to in into for please what which ' +
      'how have has had if any this that these those with on at by we us our will would can could may ' +
      'me my i and or as it its from about there their them they should kindly enter provide select ' +
      'choose one here').split(' ')
  );

  // Common fields. Checked in order, so "email address" hits email before address.
  const CANONICAL = [
    { id: 'email', label: 'Email', ac: ['email'], types: ['email'], re: /\be ?mail\b/ },
    { id: 'first_name', label: 'First name', ac: ['given-name'], re: /\b(first|given|fore) ?name\b/ },
    { id: 'middle_name', label: 'Middle name', ac: ['additional-name'], re: /\bmiddle (name|initial)\b/ },
    { id: 'last_name', label: 'Last name', ac: ['family-name'], re: /\b(last|family|sur) ?name\b/ },
    { id: 'preferred_name', label: 'Preferred name', ac: ['nickname'], re: /\bpreferred (first )?name\b|\bnick ?name\b/ },
    { id: 'full_name', label: 'Full name', ac: ['name'], re: /^(your |full |legal |full legal |candidate |applicant )?name$|\bfull (legal )?name\b/ },
    { id: 'phone', label: 'Phone', ac: ['tel', 'tel-national'], types: ['tel'], re: /\b(phone|mobile|cell|telephone|contact number)\b/, not: /\b(code|extension|ext|type)\b/ },
    { id: 'linkedin', label: 'LinkedIn profile', re: /\blinked ?in\b/ },
    { id: 'github', label: 'GitHub profile', re: /\bgit ?hub\b/ },
    { id: 'website', label: 'Website or portfolio', ac: ['url'], re: /\b(portfolio|website|personal site|blog)\b/ },
    { id: 'postal_code', label: 'Postal code', ac: ['postal-code'], re: /\b(zip|postal|post|pin) ?code\b/ },
    { id: 'city', label: 'City', ac: ['address-level2'], re: /\b(city|town)\b/ },
    { id: 'state', label: 'State or province', ac: ['address-level1'], re: /^(state|province|region)\b/ },
    { id: 'country', label: 'Country', ac: ['country', 'country-name'], re: /^(country|country of residence)\b/, not: /\b(code|phone)\b/ },
    { id: 'address', label: 'Street address', ac: ['street-address', 'address-line1'], re: /^(street |home |current |residential |mailing )?address( line 1)?$/ },
    { id: 'location', label: 'Location', re: /^(current )?location\b/ },
    { id: 'current_company', label: 'Current company', re: /\b(current|present|most recent) (company|employer|organi[sz]ation)\b/ },
    { id: 'current_title', label: 'Current job title', re: /\b(current|present|most recent) (job )?(title|role|designation|position)\b/ },
    { id: 'years_experience', label: 'Years of experience', re: /\b(years|yrs) of (total |relevant |professional |work )?experience\b|\btotal experience\b/ },
    { id: 'notice_period', label: 'Notice period', re: /\bnotice period\b/ },
    { id: 'current_salary', label: 'Current salary', re: /\b(current|present) (ctc|salary|compensation|pay)\b/ },
    { id: 'expected_salary', label: 'Expected salary', re: /\b(expected|desired) (ctc|salary|compensation|pay)\b|\bsalary expectations?\b/ },
    { id: 'work_authorization', label: 'Authorised to work', re: /\b(legally )?authori[sz]ed to work\b|\bwork authori[sz]ation\b|\bright to work\b/ },
    { id: 'sponsorship', label: 'Needs visa sponsorship', re: /\bsponsor(ship)?\b/ },
    { id: 'gender', label: 'Gender', ac: ['sex'], re: /^gender\b|\bgender identity\b/ },
    { id: 'pronouns', label: 'Pronouns', re: /\bpronouns?\b/ },
    { id: 'date_of_birth', label: 'Date of birth', ac: ['bday'], re: /\b(date of birth|birth ?date|dob)\b/ },
    { id: 'how_heard', label: 'How you heard about the job', re: /\bhow did you (hear|find|learn|come across)\b/ },
    { id: 'start_date', label: 'Earliest start date', re: /\b(earliest|available|availability) (start|to start|joining)\b|\bwhen can you (start|join)\b/ },
  ];

  // Never filled, never saved.
  const SENSITIVE = /\b(ssn|social security|social insurance|aadhaa?r|pan (card|number|no)|passport (number|no)|national (id|insurance)|tax (id|number)|credit card|debit card|card number|cvv|cvc|bank account|account number|routing|iban|swift|ifsc|password|passcode|otp|one time (code|password)|captcha|security code)\b/;
  // Checkboxes and fields the user must tick or sign themselves.
  const CONSENT = /\b(i agree|agree to|consent|terms|privacy (policy|notice|statement)|acknowledge|certify|attest|i confirm|i understand|declaration|signature|e ?sign)\b/;
  const SEARCH = /\bsearch\b/;
  const PLACEHOLDER_OPTION = /^(select|select one|select an option|choose|choose one|please select|please choose|none selected|\-+|\s*)$/;

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\((required|optional)\)|\brequired\b|\boptional\b/g, ' ')
      .replace(/[^a-z0-9+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  function stem(word) {
    if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
    if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
  }

  function tokens(text) {
    const out = new Set();
    for (const w of normalize(text).split(' ')) {
      if (w && !STOP_WORDS.has(w)) out.add(stem(w));
    }
    return out;
  }

  function dice(a, b) {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    return (2 * shared) / (a.size + b.size);
  }

  // hints: { autocomplete, type }
  function canonicalFor(question, hints) {
    const ac = String((hints && hints.autocomplete) || '').toLowerCase().split(/\s+/).pop();
    const type = String((hints && hints.type) || '').toLowerCase();
    for (const c of CANONICAL) {
      if (ac && c.ac && c.ac.includes(ac)) return c;
    }
    const q = normalize(question);
    for (const c of CANONICAL) {
      if (c.re.test(q) && !(c.not && c.not.test(q))) return c;
    }
    for (const c of CANONICAL) {
      if (type && c.types && c.types.includes(type)) return c;
    }
    return null;
  }

  function keyFor(question, hints) {
    const c = canonicalFor(question, hints);
    return c ? '@' + c.id : normalize(question);
  }

  function labelForKey(key, fallbackQuestion) {
    if (key.startsWith('@')) {
      const c = CANONICAL.find((x) => '@' + x.id === key);
      if (c) return c.label;
    }
    return String(fallbackQuestion || key).trim();
  }

  function isSensitive(question) {
    return SENSITIVE.test(normalize(question));
  }

  function isConsent(question) {
    return CONSENT.test(normalize(question));
  }

  function isSearch(question) {
    return SEARCH.test(normalize(question));
  }

  function isPlaceholderOption(text) {
    return PLACEHOLDER_OPTION.test(normalize(text));
  }

  // answers: { [key]: { question, value, values? } }
  // Returns { key, entry, how: 'exact' | 'derived' | 'guess', score, from? } or null.
  const GUESS_MIN_SCORE = 0.6;

  function findAnswer(key, question, answers) {
    if (answers[key]) return { key, entry: answers[key], how: 'exact', score: 1 };

    const derived = derive(key, answers);
    if (derived) return { key, entry: derived, how: 'derived', score: 1 };

    if (key.startsWith('@')) return null; // common fields only match by key, never by guess

    const want = tokens(question);
    let best = null;
    for (const [k, entry] of Object.entries(answers)) {
      if (k.startsWith('@')) continue;
      const score = dice(want, tokens(entry.question || k));
      if (score >= GUESS_MIN_SCORE && (!best || score > best.score)) {
        best = { key: k, entry, how: 'guess', score, from: entry.question || k };
      }
    }
    return best;
  }

  function derive(key, answers) {
    const first = answers['@first_name'];
    const last = answers['@last_name'];
    const full = answers['@full_name'];
    if (key === '@full_name' && first && last) {
      return { question: 'Full name', value: `${first.value} ${last.value}`.trim() };
    }
    if (full && (key === '@first_name' || key === '@last_name')) {
      const parts = String(full.value).trim().split(/\s+/);
      if (parts.length < 2) return null;
      const value = key === '@first_name' ? parts.slice(0, -1).join(' ') : parts[parts.length - 1];
      return { question: key === '@first_name' ? 'First name' : 'Last name', value };
    }
    return null;
  }

  // Which of the page's options best fits a saved answer. Returns the index, or -1.
  const OPTION_MIN_SCORE = 0.5;

  function bestOption(saved, options) {
    const s = normalize(saved);
    if (!s) return -1;
    const sWords = s.split(' ');
    const yesNo = sWords[0] === 'yes' || sWords[0] === 'no';
    let bestIdx = -1;
    let bestScore = 0;
    options.forEach((opt, i) => {
      const o = normalize(opt);
      if (!o || isPlaceholderOption(opt)) return;
      const oWords = o.split(' ');
      if (yesNo && oWords[0] !== sWords[0]) return;
      let score;
      if (o === s) score = 1;
      else if (startsWithWords(oWords, sWords)) score = 0.9;
      else if (startsWithWords(sWords, oWords)) score = 0.85;
      else score = dice(tokens(o), tokens(s));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    return bestScore >= OPTION_MIN_SCORE ? bestIdx : -1;
  }

  function startsWithWords(words, prefix) {
    if (prefix.length > words.length) return false;
    return prefix.every((w, i) => words[i] === w);
  }

  const api = {
    CANONICAL,
    normalize,
    tokens,
    dice,
    canonicalFor,
    keyFor,
    labelForKey,
    isSensitive,
    isConsent,
    isSearch,
    isPlaceholderOption,
    findAnswer,
    bestOption,
    GUESS_MIN_SCORE,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.JFA = globalThis.JFA || {};
  globalThis.JFA.matcher = api;
})();
