# Plan: Job Form Autofill (Chrome extension, Manifest V3)

_Draft 2026-11-24. Working name; suggested repo name `job-form-autofill` (others: `job-apply-autofill`, `apply-helper-extension`)._

## 1. Goal

Fill job application forms from answers saved on this computer. Fill an application once, and every answer is saved; the next application gets them as fills or suggestions. No AI, no screenshots, no Claude use per application, so no token cost. Never submits a form.

## 2. Hard rules

- **Local only.** All data in `chrome.storage.local` on this PC. No server, no analytics, no network calls, no remote code. Nothing leaves the computer.
- **Never auto-submit.** The extension fills fields; the user reviews and clicks Submit.
- **Never store secrets.** Skip password fields and anything that looks like ID numbers, bank or card details.
- **Minimal permissions:** `storage`, `activeTab`, `scripting`. Site access only when the user clicks Fill (or on job sites the user allows).

## 3. How it works

1. **Read each field's question** (best source first): `<label for>`, wrapping `<label>`, `aria-labelledby`, `aria-label`, fieldset `<legend>`, text just before the field, `placeholder`, then `name`/`id`.
2. **Clean it up:** lowercase, strip `*`, "(required)", punctuation and extra spaces → a "question key".
3. **Match it** against saved answers:
   - exact key match;
   - a built-in synonym list for common fields (first name, last name, email, phone, LinkedIn, city, notice period, expected salary, work authorisation, years of experience...);
   - word-overlap score for the rest; low scores become a suggestion, not a fill.
4. **Fill it** in a way modern sites accept: set the value with the native setter, then fire `input` and `change` events (needed for React/Angular forms). Handle text, textarea, select (match option text), radio, checkbox, and custom dropdowns where possible.
5. **Learn:** when the user clicks a Submit/Next button (or "Save answers" in the popup), read every filled field and save new or changed answers. Sending is not blocked or touched.
6. **Unknown questions** go to a list in the popup. Answer once there; reused from then on.

## 4. Parts

| Part | Does |
|---|---|
| `manifest.json` | MV3, permissions, popup, content script |
| `content.js` | finds fields, reads labels, fills, learns on submit, highlights filled fields |
| `popup.html/js` | Fill this page, Save answers, unknown-questions list, counts |
| `options.html/js` | edit/delete saved answers, export/import a backup file (JSON) |
| `matcher.js` | clean-up, synonyms, scoring (tested on its own) |

## 5. Features by stage

**Stage 1 (first version)**
- Fill this page (button + keyboard shortcut)
- Learn from a filled application
- Unknown-questions list in the popup
- Edit/delete saved answers
- Green outline on filled fields, yellow on suggestions
- Works inside frames (many company sites embed Greenhouse/Lever in an iframe)

**Stage 2**
- Export/import backup file (move to a new PC; still local)
- Per-company answers (e.g. "Why do you want to work here?") alongside the default
- Undo last fill
- Small application log: company, job title, page, date (local)
- Tuned support for common job sites: Workday, Greenhouse, Lever, Ashby, SmartRecruiters, iCIMS, LinkedIn Easy Apply, Naukri

**Stage 3 (only if wanted)**
- Optional passphrase lock (WebCrypto encryption of the saved answers)
- Several profiles (e.g. different resume versions or roles)
- Reusable text snippets (cover letter paragraphs)

## 6. Limits to expect

- **Resume upload** can't be filled by an extension in a reliable way; user attaches the file.
- **Custom dropdowns** (Workday especially) need site-specific handling; first version may only suggest.
- Pages that load fields step by step need "Fill" pressed again on each step (or auto-fill on new fields in stage 2).
- Matching is word-based, not AI: odd wordings land in the unknown list once, then work.

## 7. Testing

- `matcher.js` unit tests (Node, no browser).
- Local test pages copying the structure of Greenhouse, Lever and Workday forms (served on localhost).
- Real application pages by hand, without submitting.

## 8. Publishing on the Chrome Web Store (needs the user)

- Developer account and one-time sign-up fee: **user does this** (check current fee then).
- Needed: zip of the extension, icons (128px), 1+ screenshots (1280x800), short and long description, a **privacy policy page** (can be GitHub Pages: "all data stays on your device, nothing collected"), and a reason for each permission.
- Store data-use form: declares personal info handled locally only, not sold or sent.
- Review usually takes a few days.

## 9. Checked before starting

- Lessons applied: set long text directly instead of typing and re-check after fill (tools.md, form filling); fail loudly, never silently pass (standards); version the saved data format from day one (general.md); list user-hands steps up front (Web Store account and fee).
- Checked 2026-11-24 (official docs):
  - `chrome.storage.local` holds 10 MB without `unlimitedStorage`: plenty for text answers.
  - `activeTab` reaches the top page and same-site frames only. Forms embedded from another site need that site's host permission, so the popup asks for it per site ("Turn on for this site", optional host permissions).
  - Web Store: one-time $5 developer fee (amount set by Google, check on sign-up); a privacy policy link is required because the extension handles personal data.
  - Workday-style dropdowns are buttons that open a list: setting a value does nothing, so the extension clicks the button and then the matching option. Tested on a look-alike page only.

## 10. Order of work

1. Research the open checks above (short).
2. Build matcher + tests.
3. Build content script, popup, options; load unpacked in Chrome.
4. Test on local sample forms, then real pages (no submitting).
5. README, MIT license, icons, privacy policy page, store zip.
6. GitHub repo (after the user OKs it), then Web Store submission by the user.
