# JobPilot

JobPilot finds remote jobs you can actually be hired for, writes honest answers from your CV, and fills in the application forms for you in a real browser window. It keeps a tracker of everything it did. It runs on your Mac and uses **your own AI key**: Claude, Gemini, Grok, OpenAI, or any OpenAI-compatible service (OpenRouter, Ollama on your machine).

By default it **stops before submitting** so you can check every form.

> "JobPilot" is a working name.

---

## Start it

You need [Node.js 20+](https://nodejs.org) and Google Chrome (or Microsoft Edge).

```bash
npm install
```

```bash
npm start
```

Then open **http://localhost:5173**. The sidebar has a four-step checklist to get you set up:

1. **Settings**: pick a provider and model, paste your API key, then press **Save & test**.
2. **Profile**: upload your CV (PDF or DOCX). Your AI reads it and fills in your experience. Then fill in the facts only you can confirm and press **Confirm facts**. Changes save automatically.
3. **Assistant**: tell it the kind of job you want, in your own words.
4. **Inbox**: check what needs you, then submit.

## Getting around

- **Assistant.** A chat where you say what you want and JobPilot does it. Try "I'm a senior product designer, I want fintech roles that hire in Africa. Find them and apply to the best ones." It can:
  - save your brief, which steers how the AI scores fit
  - change the job titles it searches for
  - run a search
  - fill applications for the jobs you pick
  - skip jobs
  - answer questions like "what's waiting on me?" or "why was this skipped?"

  Each step it takes shows as a card in the chat, with live status for each job. Filled applications still wait for your review. If auto-submit is on, it asks you to confirm before applying, and it also asks before skipping more than five jobs. It can't change your profile facts.
- **Inbox.** Everything that needs you: questions only you can answer, and forms that are filled and waiting to be submitted.
- **Find jobs.** Your brief, job titles, sources and company boards, plus the live search log.
- **To apply / Applied / Do it yourself / Skipped / All jobs.** The tracker, grouped by status. Click a job to open it beside the list. The panel shows the next step (fill, answer, submit, or open the link yourself), the evidence about where they hire, the answers filled in, a screenshot and the activity log.
- **Keyboard.** <kbd>⌘K</kbd> opens a command menu that jumps to any page or job. In job lists, <kbd>J</kbd>/<kbd>K</kbd> moves between jobs, <kbd>Esc</kbd> closes the panel and <kbd>/</kbd> filters.

Applications run one at a time from a queue, so you can line up several and leave them to finish.

The app only listens on `localhost`, so nobody else on your network can reach it.

## How a search works

1. JobPilot pulls postings from public job sources that allow it:
   - Greenhouse, Lever and Ashby company boards
   - Himalayas
   - Remote OK
   - We Work Remotely RSS
   - Remotive (off by default; see the note below)
2. It throws out titles that don't match, postings older than your limit, and companies on your never-apply list.
3. **Eligibility.** It reads the exact location wording and compares it with where you live and where you're authorised to work.
   - "Worldwide", "EMEA", "Africa", "contractors anywhere" and a timezone window that includes yours are kept.
   - "US only", "Remote, United Kingdom" and "Europe" are skipped if you aren't authorised there.
   - The wording is saved as evidence, so you can see why.
4. Your AI scores each remaining job for fit (0 to 100) and gives a second opinion on eligibility.
   - It must quote the posting word for word. A quote that isn't really in the posting is ignored.
   - The AI can never overrule a clear "US only".
5. Results land in **Jobs & tracker**. You can filter by status, fit and eligibility.

Each scored job costs one AI call. "Score at most" in Search sets the limit per run.

## How applying works

When you press **Apply**, JobPilot works through these steps:

1. **Opens the form.** It opens the application in its own browser window. That window has a separate profile, so it never sees your everyday browser, passwords or cookies.
2. **Checks for blockers.** Login walls, CAPTCHAs, and pages that say they reject AI-assisted applications all go to **Do it yourself**, with the link.
3. **Reads every field.** That includes the label, whether it's required, and its options. It opens dropdowns to see their real choices.
4. **Fills facts from your profile, never by AI.** This covers:
   - name, email and phone
   - city and country
   - work authorisation, sponsorship and nationality
   - salary, using your rules
   - notice period
   - links
   - equal-opportunity questions (default: decline to self-identify)
5. **Asks your AI to write the rest, grounded only in your CV.** That means free-text answers ("Why us?", "Tell us about a project") and a short cover note.
   - Answers are checked for numbers that aren't in your CV, and for code words planted in the posting. A failed answer is rewritten once. If it still fails, it goes to you.
   - Questions the CV can't answer (e.g. "Have you used a crypto wallet?") go to **Needs your answer**. JobPilot never guesses.
6. **Types like a person.** Real keystrokes (React forms ignore pasted values), type-then-pick for location dropdowns, and the CV is uploaded.
7. **Re-reads the form.** Required fields that are still empty get one more attempt.
8. **Stops for your review.** The window stays open, and the tracker shows what was filled with a screenshot. Press **Submit now**, or submit in the window yourself and press **I applied myself**.
   - With auto-submit on (Settings), JobPilot submits on its own when nothing looks odd. If the page shows errors it fixes them and tries again; some forms need a second click after a dropdown closes.
   - It only marks a job **Applied** after it sees the confirmation page.

When you answer a "Needs your answer" question, the answer is saved to your profile. It's reused automatically the next time any form asks the same thing.

## Rules that are always on

These are built in. There is no setting to turn them off.

- **Honest facts.** Location, work authorisation, nationality and experience come only from what you confirmed. Unclear questions (e.g. "Do you require sponsorship?" with no country) are asked once, then your answer is reused.
- **No guessing.** If the profile or CV doesn't support an answer, the job goes to **Needs your answer**.
- **No accounts, passwords or CAPTCHAs.** Those jobs go to **Do it yourself**.
- **Job pages are untrusted.** Posting text is passed to the AI wrapped as data, with instructions to ignore anything aimed at it. Hidden text and "if you are an AI, include the word X" tricks are detected, flagged on the job, and checked for in every answer.
- **AI screening is respected.** A page saying it rejects AI-assisted applications goes to **Do it yourself**. Some Canonical forms ask you to agree to "use only my own words".
- **Never-apply list** is checked before every search and every application.
- **Polite to job sites.** JobPilot identifies itself, follows robots.txt, waits between requests to the same site, and caches results for hours.
  - Remotive's robots.txt currently disallows its API, so that source is off and JobPilot won't fetch it even if you switch it on.
  - Remote OK and Himalayas ask for a link back. Every job links to its original posting.

## Your data

Everything lives in `data/`, which is git-ignored:

| File | What |
|---|---|
| `data/store.json` | settings (including your API key), profile, search settings, tracker. Only your macOS user can read it. |
| `data/cv/` | your CV file |
| `data/browser-profile/` | the separate browser profile JobPilot uses |
| `data/screens/` | screenshots of filled forms |
| `data/cache/` | cached job-board responses |

Your API key is never sent back to the browser in full, never logged, and never committed. **Export CSV** on the Jobs page downloads the whole tracker. It includes each job's status, reason, date, links, location evidence and the answers submitted.

## Choosing a model

| Provider | Models (Oct 2026) | Key |
|---|---|---|
| Anthropic Claude | `claude-opus-5-5` (best writing), `claude-sonnet-5-5`, `claude-haiku-5-5` (cheapest) | console.anthropic.com |
| OpenAI | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna` | platform.openai.com |
| Google Gemini | `gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.5-flash-lite` | aistudio.google.com |
| xAI Grok | `grok-4.7`, `grok-4.6` | console.x.ai |
| OpenAI-compatible | anything, e.g. OpenRouter (`https://openrouter.ai/api/v1`) or Ollama (`http://localhost:11434/v1`) | depends |

**Load models from my account** in Settings lists what your key can use. A cheap model is fine for scoring a lot of jobs. A stronger one writes better answers.

## Adding company boards

Many companies post jobs on Greenhouse, Lever or Ashby. Find the board name in the company's careers link and add it under **Search → Sources**:

- `boards.greenhouse.io/`**`gitlab`**
- `jobs.lever.co/`**`toptal`**
- `jobs.ashbyhq.com/`**`zapier`**

You can also paste any single job link under **Add one job by link**.

## Demo (fills a real form, never submits)

```bash
npm run demo
```

The demo does this:

1. Pulls live postings from public Greenhouse boards.
2. Picks one that's open to someone in Nigeria.
3. Fills its application with a **fictional** sample candidate ("Ada Example") and a generated sample CV.
4. Prints what it filled and what it left for a human.
5. Leaves the browser open. Nothing is submitted.

Options:

- `npm run demo -- --headless` runs without a window and saves a screenshot to `data/demo/screens/`.
- `npm run demo -- --board <name>` uses a specific Greenhouse board.
- If `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or `XAI_API_KEY` is set, free-text questions are also answered by that model.

In testing, the Canonical forms were correctly routed to "do it yourself" because they ask applicants to use only their own words. A form on another board was filled with name, contact, location (type-then-select "Lagos, Nigeria"), CV upload, salary text and EEO declines. Its role-specific questions were left for a human.

## Tests

```bash
npm test
```

There are 109 tests covering:

- **Provider adapters**, with the SDKs mocked: request shapes, JSON schema, images, refusals, errors that don't leak keys.
- **Field mapping**: names, location, authorisation, sponsorship, salary rules, EEO, consent, saved answers.
- **Eligibility**: worldwide, EMEA, US-only, timezone windows, AI quotes that aren't in the posting.
- **Guardrails**: hidden instructions, AI-screening wording, invented numbers, never-apply, robots.txt.
- **Assistant actions**: brief and search updates, queued applications, confirmation when auto-submit is on, no applying before the profile is ready, untrusted job text.

```bash
npm run typecheck
```

## Project layout

```
server/
  index.ts            local web server (Express + Vite), API routes
  store.ts            JSON storage in data/
  providers/          one LLM interface + Anthropic, OpenAI(+xAI/compatible), Gemini adapters
  sources/            Greenhouse, Lever, Ashby, Himalayas, Remote OK, WWR, Remotive; polite HTTP
  eligibility.ts      location rules
  search.ts           fetch → filter → AI score → tracker
  assistant.ts        the chat: reply + actions (brief, search, apply, skip)
  cv.ts               CV text extraction + AI profile extraction
  guardrails.ts       injection / AI-screening / login detection, answer checks
  apply/
    dom-reader.js     runs in the page: finds and labels form fields
    mapper.ts         field → profile rules (facts never come from AI)
    answers.ts        AI answers grounded in the CV, with checks
    filler.ts         typing, dropdowns, uploads, submit, success detection
    runner.ts         the whole apply flow
    queue.ts          runs applications one at a time
  tracker.ts          CSV export
web/src/              React UI
tests/                vitest
scripts/demo-greenhouse.ts
```

## Known limits

- **Supported forms.** Built and tested against Greenhouse forms. Lever, Ashby, Workable and Recruitee use the same generic reader and filler, but each site has quirks. Watch the first few runs and use **Fill again** if something was missed.
- **Login-only systems** (Workday, iCIMS, Taleo, LinkedIn Easy Apply) always go to **Do it yourself**.
- **Background mode.** Settings → "Work in the background" fills forms with no window; you review the screenshot and answers in the app, then press Submit.
- **Bundled browser.** Playwright's bundled Chromium doesn't run on macOS 13, so JobPilot drives your installed Chrome by default. It uses a separate profile, so your normal browsing data is untouched.
- **Fit scores are a guide.** They come from your AI. Check the "why" line.
