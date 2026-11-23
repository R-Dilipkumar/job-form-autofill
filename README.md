# Job Form Autofill

Fill in a job application once. Every application after that fills itself from your saved answers, which never leave your computer.

[![Release](https://img.shields.io/github/v/release/R-Dilipkumar/job-form-autofill?include_prereleases)](https://github.com/R-Dilipkumar/job-form-autofill/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platform: Chrome](https://img.shields.io/badge/platform-Chrome%20(Manifest%20V3)-4285F4)
![Language: JavaScript](https://img.shields.io/badge/language-JavaScript-F7DF1E)

![Job Form Autofill filling a form: green = saved answer, yellow = guessed, please check](store/screenshot-1-fill.png)

## Features

- **Fills job forms from your saved answers.** It reads each field's question (its label), finds your answer, and fills it in. Works with text boxes, dropdowns, radio buttons, checkboxes, and the custom dropdowns many job sites use.
- **Learns as you apply.** When you press Submit, Next or Save and Continue, your answers are saved. You can also press **Save answers from this page** in the popup.
- **New questions list.** Questions it doesn't know yet go to a list in the popup. Answer once there and it's reused from then on.
- **Shows what it did.** Green outline: filled from a saved answer. Yellow: guessed from a similar question, please check. Red: it has an answer but couldn't set it, so fill it yourself.
- **Never submits.** It fills fields only. You check the form and press Submit yourself.
- **Stays on your computer.** No account, no server, no tracking, no AI. Your answers are kept in Chrome's local storage on this PC only.
- **Leaves sensitive fields alone.** It never fills or saves passwords, ID numbers (SSN, Aadhaar, PAN, passport) or bank and card details, and never ticks "I agree" or consent boxes for you.
- **Repeated sections.** For forms with several jobs or schools, it remembers each entry and fills them in order.
- **Common fields work across sites.** First name, email, phone, LinkedIn, city, notice period, expected salary and more are recognised however each site words them. Full name is built from first and last name, or split the other way.
- **Backup file.** Download your answers as a file and load them on another computer.
- **Keyboard shortcut:** `Alt+Shift+F` fills the page without opening the popup.

## Download and install

**From the Chrome Web Store:** coming soon.

**By hand (works now):**
1. Download `job-form-autofill-<version>.zip` from the [latest release](https://github.com/R-Dilipkumar/job-form-autofill/releases) and unzip it into a folder you'll keep.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the extension (puzzle-piece icon → pin) so its button is always visible.

## Setup and use

1. Open a job application page and click the extension's button, then **Fill this page**.
2. The first time, it knows nothing: fill the form yourself and press Submit or Next as usual. If the site didn't save your answers automatically, press **Save answers from this page** before you submit.
3. On the next application, press **Fill this page** again. Known answers fill in; new questions appear in the popup. Answer them there, then press Fill again.
4. Optional: **Turn on for this site** (in the popup) for sites you use a lot. On those sites it saves your answers whenever you press Submit or Next, even if you didn't press Fill, and it can reach forms embedded from another site (for example a Greenhouse form inside a company's careers page).
5. **Manage answers** (popup footer) lets you edit, delete, add, back up and restore answers.

## How it works

For each field on the page it reads the question from the field's label (or the text next to it), cleans it up, and looks for a saved answer:

1. Common fields (name, email, phone, LinkedIn, salary, notice period…) are matched by meaning, so "Mobile" and "Phone number" both use your phone answer.
2. Other questions are matched by their exact words, then by similar wording ("Would you be willing to relocate?" ↔ "Are you willing to relocate?"). Similar-wording matches are marked yellow for you to check.
3. Dropdown and radio answers are matched to the option text on each site ("Yes" picks "Yes, I am authorized").

It runs only when you press Fill or the shortcut (Chrome's `activeTab` access), or on sites you turned on.

## Good to know / limits

- **Resume upload:** browsers don't let extensions attach files, so attach your resume yourself.
- **Multi-step forms:** press Fill again on each step.
- **Unusual custom dropdowns** may not open for it; it marks them red so you can pick by hand.
- **Guesses can be wrong**, for example a company-specific "Why do you want to join X?" answer reused for another company. Always read the form before you submit.
- **Your data lives in this browser profile.** Removing the extension deletes it, so download a backup now and then.
- Tested on test pages built like Greenhouse, Lever and Workday forms (43 automatic checks in real Chrome). Real job sites change often; if one doesn't work, please open an issue.

## Privacy

Nothing is sent anywhere. The extension makes no network requests and has no analytics. Full policy: [privacy policy](https://r-dilipkumar.github.io/job-form-autofill/privacy.html).

## Build from source

Needs Node.js 20+ (tests), Python 3 with Pillow (icons, store images, zip) and Google Chrome.

```
git clone https://github.com/R-Dilipkumar/job-form-autofill.git
cd job-form-autofill
npm test            # matching rules (Node)
npm run e2e         # loads the extension into headless Chrome and fills the test pages
npm run zip         # makes dist/job-form-autofill-<version>.zip for the Chrome Web Store
```

To try your changes, load the folder itself with **Load unpacked** and press the reload button on `chrome://extensions` after each change.

Project layout: `manifest.json`, `src/` (page script, matching rules, storage, background worker), `popup/`, `options/` (Manage answers page), `icons/`, `tests/` (unit tests, end-to-end test, test pages), `tools/` (icons, store images, zip), `store/` (Web Store listing text and images), `docs/` (privacy policy page).

## License

[MIT](LICENSE) © 2026 Dilipkumar R
