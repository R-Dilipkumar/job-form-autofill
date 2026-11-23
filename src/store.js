// Saved answers and unanswered questions, kept only in chrome.storage.local on this computer.
// One storage key per entry ("a:<key>" answers, "u:<key>" unanswered) so pages in
// several frames can save at once without overwriting each other.
(function () {
  const SCHEMA_VERSION = 1;
  const ANSWER = 'a:';
  const UNKNOWN = 'u:';
  const MAX_UNKNOWN_OPTIONS = 60;

  const local = () => chrome.storage.local;

  async function ensureSchema() {
    const { meta } = await local().get('meta');
    if (!meta) {
      await local().set({ meta: { schemaVersion: SCHEMA_VERSION, createdAt: Date.now() } });
      return;
    }
    if (meta.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`Saved data is from a newer version (${meta.schemaVersion}). Update the extension.`);
    }
    // Future format changes: migrate here, step by step, then bump meta.schemaVersion.
  }

  async function getAll() {
    const all = await local().get(null);
    const answers = {};
    const unknown = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(ANSWER)) answers[k.slice(ANSWER.length)] = v;
      else if (k.startsWith(UNKNOWN)) unknown[k.slice(UNKNOWN.length)] = v;
    }
    return { answers, unknown };
  }

  // items: [{ key, question, value, values? }]
  async function saveAnswers(items) {
    if (!items.length) return 0;
    await ensureSchema();
    const set = {};
    const removeKeys = [];
    const now = Date.now();
    for (const it of items) {
      const entry = { question: it.question, value: it.value, updatedAt: now };
      if (it.values && it.values.length > 1) entry.values = it.values;
      set[ANSWER + it.key] = entry;
      removeKeys.push(UNKNOWN + it.key);
    }
    await local().set(set);
    await local().remove(removeKeys);
    return items.length;
  }

  async function saveAnswer(key, question, value) {
    return saveAnswers([{ key, question, value }]);
  }

  async function removeAnswer(key) {
    await local().remove(ANSWER + key);
  }

  // items: [{ key, question, kind, options? }]. Skips ones already answered.
  async function addUnknown(items, host) {
    if (!items.length) return 0;
    await ensureSchema();
    const keys = items.flatMap((it) => [ANSWER + it.key, UNKNOWN + it.key]);
    const existing = await local().get(keys);
    const set = {};
    for (const it of items) {
      if (existing[ANSWER + it.key] || existing[UNKNOWN + it.key] || set[UNKNOWN + it.key]) continue;
      set[UNKNOWN + it.key] = {
        question: it.question,
        kind: it.kind,
        options: (it.options || []).slice(0, MAX_UNKNOWN_OPTIONS),
        host,
        seenAt: Date.now(),
      };
    }
    await local().set(set);
    return Object.keys(set).length;
  }

  // key: one key or a list of keys
  async function removeUnknown(key) {
    const keys = Array.isArray(key) ? key : [key];
    if (keys.length) await local().remove(keys.map((k) => UNKNOWN + k));
  }

  async function exportAll() {
    const { answers, unknown } = await getAll();
    return {
      app: 'job-form-autofill',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      answers,
      unknown,
    };
  }

  // Adds the backup's entries to what's saved; an entry with the same key is replaced.
  async function importAll(data) {
    if (!data || data.app !== 'job-form-autofill' || typeof data.answers !== 'object') {
      throw new Error('This file is not a Job Form Autofill backup.');
    }
    if (data.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`Backup is from a newer version (${data.schemaVersion}). Update the extension first.`);
    }
    await ensureSchema();
    const set = {};
    for (const [k, v] of Object.entries(data.answers)) {
      if (v && typeof v.value === 'string') set[ANSWER + k] = v;
    }
    for (const [k, v] of Object.entries(data.unknown || {})) {
      if (v && typeof v.question === 'string' && !set[ANSWER + k]) set[UNKNOWN + k] = v;
    }
    await local().set(set);
    await removeUnknown(Object.keys(data.answers));
    return Object.keys(set).length;
  }

  async function clearAll() {
    const all = await local().get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(ANSWER) || k.startsWith(UNKNOWN));
    await local().remove(keys);
  }

  globalThis.JFA = globalThis.JFA || {};
  globalThis.JFA.store = {
    SCHEMA_VERSION,
    getAll,
    saveAnswers,
    saveAnswer,
    removeAnswer,
    addUnknown,
    removeUnknown,
    exportAll,
    importAll,
    clearAll,
  };
})();
