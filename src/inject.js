// Shared by the popup and the background worker: run the page script in a tab, and keep the
// "always on" sites' content script in step with the site permissions the user granted.
(function () {
  const PAGE_FILES = ['src/matcher.js', 'src/store.js', 'src/content.js'];
  const SITE_SCRIPT_ID = 'jfa-allowed-sites';

  // action: 'fill' | 'learn'. Returns one result per frame the extension may access.
  async function runInTab(tabId, action) {
    const target = { tabId, allFrames: true };
    await chrome.scripting.executeScript({ target, files: PAGE_FILES });
    const results = await chrome.scripting.executeScript({
      target,
      func: (a) => (globalThis.JFA && globalThis.JFA.page ? globalThis.JFA.page[a]() : { error: 'Page script did not load.' }),
      args: [action],
    });
    return results.map((r) => r.result).filter(Boolean);
  }

  function sumResults(results) {
    const sum = { fields: 0, filled: 0, guessed: 0, needsHand: 0, alreadyFilled: 0, unknown: 0, skipped: 0, saved: 0, errors: [] };
    for (const r of results) {
      if (r.error) {
        sum.errors.push(`${r.host || 'page'}: ${r.error}`);
        continue;
      }
      for (const k of Object.keys(sum)) if (typeof r[k] === 'number') sum[k] += r[k];
    }
    return sum;
  }

  function originPattern(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.protocol}//${u.hostname}/*` : null;
    } catch {
      return null;
    }
  }

  async function syncSiteScripts() {
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = origins.filter((o) => /^https?:\/\/[^*]/.test(o));
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SITE_SCRIPT_ID] });
    if (!matches.length) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SITE_SCRIPT_ID] });
      return [];
    }
    const script = { id: SITE_SCRIPT_ID, matches, js: PAGE_FILES, allFrames: true, runAt: 'document_idle', persistAcrossSessions: true };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
    return matches;
  }

  globalThis.JFA = globalThis.JFA || {};
  globalThis.JFA.inject = { runInTab, sumResults, originPattern, syncSiteScripts };
})();
