// Background worker: keyboard shortcut, badge, and the "always on" sites list.
importScripts('inject.js');

const { runInTab, sumResults, syncSiteScripts } = globalThis.JFA.inject;

function logError(what) {
  return (err) => console.error(`[Job Form Autofill] ${what} failed:`, err);
}

chrome.runtime.onInstalled.addListener(() => syncSiteScripts().catch(logError('site script setup')));
chrome.permissions.onAdded.addListener(() => syncSiteScripts().catch(logError('site script update')));
chrome.permissions.onRemoved.addListener(() => syncSiteScripts().catch(logError('site script update')));

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-page' || !tab || !tab.id) return;
  try {
    const sum = sumResults(await runInTab(tab.id, 'fill'));
    await showBadge(tab.id, sum);
  } catch (err) {
    logError('fill from shortcut')(err);
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#dc2626' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: `Job Form Autofill: couldn't fill this page (${err.message})` });
  }
});

async function showBadge(tabId, sum) {
  const done = sum.filled + sum.guessed;
  const color = sum.errors.length || sum.needsHand ? '#dc2626' : sum.guessed || sum.unknown ? '#ca8a04' : '#16a34a';
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text: done ? String(done) : sum.unknown ? '?' : '' });
  await chrome.action.setTitle({
    tabId,
    title: `Job Form Autofill: filled ${sum.filled}, guessed ${sum.guessed}, needs you ${sum.needsHand}, new questions ${sum.unknown}`,
  });
}
