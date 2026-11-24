# Chrome Web Store listing (copy into the developer dashboard)

Upload: `dist/job-form-autofill-<version>.zip` (make it with `npm run zip`).

## Store listing tab

- **Name:** Job Form Autofill (from the manifest)
- **Short description (max 132 chars, from the manifest):** Fills job application forms with answers saved on your computer. Learns as you apply. Never submits for you.
- **Category:** Workflow & Planning (or Tools)
- **Language:** English
- **Icon:** `icons/icon128.png`
- **Screenshots (1280x800):** `store/screenshot-1-fill.png`, `store/screenshot-2-answers.png`
- **Small promo tile (440x280):** `store/promo-small-440x280.png`
- **Homepage:** https://github.com/R-Dilipkumar/job-form-autofill
- **Support:** https://github.com/R-Dilipkumar/job-form-autofill/issues

**Detailed description:**

```
Applying to many jobs means typing the same answers again and again. Job Form Autofill fills them in for you, from answers saved only on your own computer.

HOW IT WORKS
• Press "Fill this page" (or Alt+Shift+F) on a job application.
• It reads each question on the form and fills in your saved answer.
• Questions it doesn't know yet go to a list in the popup. Answer once, and it's reused on every application after that.
• When you press Submit, Next or Save and Continue, your answers are saved for next time.

WHAT IT FILLS
• Text boxes, dropdowns, radio buttons, checkboxes, and the custom dropdowns many job sites use.
• Common fields however each site words them: name, email, phone, LinkedIn, GitHub, website, city, postal code, notice period, current and expected salary, work authorisation, sponsorship, how you heard about the job, and more.
• Repeated sections such as several past jobs, filled in order.

SAFE BY DESIGN
• Never submits a form. You check it and press Submit yourself.
• Green outline = filled from your answer. Yellow = guessed from a similar question, please check. Red = fill it yourself.
• Never fills or saves passwords, ID numbers, or bank and card details, and never ticks "I agree" boxes for you.

PRIVATE
• Your answers stay in Chrome on your computer. No account, no server, no analytics, no AI.
• It only reads a page when you press Fill, Save or the shortcut, or on sites you turn on yourself.
• Edit, delete, back up or restore your answers on the Manage answers page.

LIMITS
• Browsers don't let extensions attach files, so attach your resume yourself.
• On multi-step forms, press Fill on each step.

Free and open source (MIT): https://github.com/R-Dilipkumar/job-form-autofill
```

## Privacy practices tab

- **Single purpose:** Fill job application forms with answers the user saved earlier, and save the user's answers for reuse.
- **Permission justifications:**
  - `storage`: keeps the user's saved answers and unanswered questions on their computer (chrome.storage.local).
  - `activeTab`: reads and fills the form on the current page only when the user presses Fill, Save or the keyboard shortcut.
  - `scripting`: runs the form-filling script in the current tab (and its embedded form frames) when the user asks, and on sites the user turned on.
  - Optional host permissions (`https://*/*`, `http://*/*`): asked for one site at a time, only when the user flips "Always on for this site" in the popup, so answers can be saved when they press Submit and forms embedded from another site can be filled. Not granted at install.
- **Remote code:** No, I am not using remote code.
- **Data usage — what the extension handles:** Personally identifiable information (name, email, phone, address the user types into forms); Website content (form questions). Stored only on the user's device; never transmitted.
- **Certify:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used or transferred to determine creditworthiness or for lending.
- **Privacy policy URL:** https://r-dilipkumar.github.io/job-form-autofill/privacy.html

## Before submitting (the user does these)

1. Sign in to the Chrome Web Store developer dashboard and register (one-time fee, $5 as of 2026; check the current amount there).
2. Make sure GitHub Pages is live, so the privacy policy URL opens.
3. Upload the zip, fill both tabs from this file, and submit for review (usually a few days).
