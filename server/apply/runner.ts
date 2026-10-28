// The apply flow for one job: open → check for blockers → read form → map → AI answers → fill → verify →
// pause for your review (default) or submit (if you turned auto-submit on) → confirm success.

import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { detectAiScreening, detectInjection, isJobBoardUrl, isNeverApply } from "../guardrails.js";
import type { LLM } from "../providers/types.js";
import { alreadyApplied, appliedReason } from "../dedupe.js";
import { checkLiveness } from "../liveness.js";
import { tailorCv } from "../tailor.js";
import { checkLocation } from "../eligibility.js";
import { connectedHosts } from "../sites.js";
import { findEmployerForm } from "../sources/index.js";
import { DATA_DIR, cvPath, load, update } from "../store.js";
import type { Job, PendingQuestion } from "../types.js";
import { type AgentResult, runAgent } from "./agent.js";
import { answerWithChecks, draftPending } from "./answers.js";
import { detectBlocker, getContext, hiddenText, isHeadless, pageText, readForm } from "./browser.js";
import { fillField, findSubmit, looksSubmitted, peekComboOptions, visibleErrors } from "./filler.js";
import { type FormField, type Mapped, mapAll, normQ } from "./mapper.js";

interface Session {
  page: Page;
  mapped: Mapped[];
  values: Map<string, string | string[]>; // by normalised label, for refilling
  files: { cv: string; cover?: string };
}
const sessions = new Map<string, Session>();
export const logs = new Map<string, string[]>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(id: string, m: string) {
  const l = logs.get(id) ?? [];
  l.push(`${new Date().toLocaleTimeString()}  ${m}`);
  logs.set(id, l.slice(-200));
}

function save(job: Job, status: Job["status"], reason?: string): Job {
  if (status !== "filled" && status !== "needs_answer") job.handoff = undefined;
  job.status = status;
  job.statusReason = reason;
  job.statusDate = new Date().toISOString();
  update((s) => void (s.jobs[job.id] = job));
  return job;
}

export function hasSession(id: string): boolean {
  return sessions.has(id) && !sessions.get(id)!.page.isClosed();
}

export interface ApplyOptions {
  autoSubmit: boolean;
  channel: "chrome" | "msedge" | "chromium";
  headless?: boolean;
  dryRun?: boolean; // never submit (demo)
  fillEvenIfPending?: boolean; // demo: fill what we can even if some questions need the user
  profileOverride?: ReturnType<typeof load>["profile"];
  cvOverride?: string;
  waitForHuman?: boolean; // the user pressed Finish: wait (visible window) for them to pass a CAPTCHA
}

export async function prepare(jobOrId: string | Job, llm: LLM | null, opts: ApplyOptions): Promise<Job> {
  const store = load();
  const job: Job = typeof jobOrId === "string" ? store.jobs[jobOrId] : jobOrId;
  if (!job) throw new Error("Job not found");
  const p = opts.profileOverride ?? store.profile;
  const id = job.id;
  logs.set(id, []);

  // Guardrails that need no browser
  if (job.status === "applied") return job;
  const dup = alreadyApplied(job, Object.values(store.jobs));
  if (dup) return save(job, "skipped", appliedReason(dup));
  if (isNeverApply(job.company, p.neverApply)) return save(job, "skipped", "On your never-apply list");
  if (!p.confirmed && !opts.profileOverride) throw new Error("Confirm your profile facts first (Profile → Confirm).");
  const cvFile = opts.cvOverride ?? cvPath();
  if (!fs.existsSync(cvFile)) throw new Error("Upload your CV in Profile first.");
  const host = (() => {
    try {
      return new URL(job.applyUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const signedIn = connectedHosts().some((h) => host === h || host.endsWith(`.${h}`));
  if (job.needsLogin && !signedIn)
    return save(job, "do_it_yourself", `${host} needs an account. Connect it under Settings → Connected sites (you sign in once yourself) and JobPilot can apply there. It never creates accounts or types passwords.`);
  if (job.ats === "job-board" || isJobBoardUrl(job.applyUrl)) {
    log(id, `Looking for ${job.company}'s own application form…`);
    const hit = await findEmployerForm(job.company, job.title, job.url).catch(() => null);
    if (hit) {
      log(id, `Found it on ${hit.ats}: ${hit.applyUrl}`);
      const dup2 = alreadyApplied({ ...job, applyUrl: hit.applyUrl, url: hit.url }, Object.values(load().jobs));
      if (dup2) return save(job, "skipped", appliedReason(dup2));
      const own = checkLocation(hit.location, p, "");
      if (own.verdict === "ineligible" && !job.flags.includes("apply-anyway")) {
        job.eligibility = { ...own, reason: `${own.reason} (the employer's own posting; the job board said "${job.location}")` };
        log(id, `The employer's posting says "${hit.location}". Not open to you, so JobPilot won't apply.`);
        return save(job, "skipped", job.eligibility.reason);
      }
      job.applyUrl = hit.applyUrl;
      job.ats = hit.ats;
      update((s) => void (s.jobs[id] = job));
    }
  }
  const boardOnly = job.ats === "job-board" || isJobBoardUrl(job.applyUrl) || (job.needsLogin && signedIn);
  if (boardOnly && !llm) {
    const host = new URL(job.applyUrl).hostname.replace(/^www\./, "");
    return save(job, "do_it_yourself", `This job is listed on ${host}. Connect your AI in Settings so JobPilot can follow "Apply" to the employer's form, or open the link yourself.`);
  }
  // Employers that ban AI-written answers: JobPilot fills the facts, you write the open answers.
  let ownWords = job.flags.includes("ai-screening");

  // Still open? (Cheap check before opening a browser.)
  if (!opts.dryRun || process.env.JOBPILOT_CHECK_LIVENESS) {
    const live = await checkLiveness(job);
    log(id, live.open === false ? `Posting closed: ${live.reason}` : `Still open: ${live.reason}`);
    if (live.open === false) return save(job, "skipped", `This posting has closed. ${live.reason}.`);
  }

  // A CV tailored to this job (fact-checked); falls back to your original file.
  let cv = cvFile;
  if (llm && store.settings.tailorCv !== false && !opts.cvOverride) {
    try {
      const t = await tailorCv(llm, p, job, (m) => log(id, m));
      if (t) {
        cv = t;
        log(id, "Tailored your CV for this role (same facts, re-emphasised).");
      }
    } catch (e) {
      log(id, `Couldn't tailor the CV (${(e as Error).message.slice(0, 80)}); using your original.`);
    }
  }

  const ctx = await getContext(opts.channel, opts.headless);
  const old = sessions.get(id);
  if (old && !old.page.isClosed()) await old.page.close().catch(() => {});
  const page = await ctx.newPage();
  log(id, `Opening ${job.applyUrl}`);
  await page.goto(job.applyUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  // Page-level guardrails
  const text = await pageText(page);
  const screening = detectAiScreening(text);
  if (screening) {
    job.flags = [...new Set([...job.flags, "ai-screening"])];
    ownWords = true;
    log(id, `This employer doesn't accept AI-written answers ("${screening.slice(0, 120)}"). JobPilot fills your details; the open answers will be yours.`);
  }
  const hidden = await hiddenText(page);
  const injected = detectInjection(`${text}\n${hidden}`);
  if (injected.length) {
    job.flags = [...new Set([...job.flags, "hidden-instructions"])];
    log(id, `Ignored instructions aimed at AI on this page: "${injected[0].snippet.slice(0, 120)}"`);
  }
  let blocker = await detectBlocker(page);
  if (blocker.kind === "captcha") {
    log(id, blocker.detail);
    sessions.set(id, { page, mapped: [], values: new Map(), files: { cv } });
    if (opts.headless || !opts.waitForHuman) return handOffCaptcha(job, opts);
    if (!(await waitForHuman(job, page))) return handOffCaptcha(job, opts);
    blocker = await detectBlocker(page);
  }
  if (blocker.kind !== "none") {
    log(id, blocker.detail);
    sessions.set(id, { page, mapped: [], values: new Map(), files: { cv } });
    return save(job, "do_it_yourself", `${blocker.detail} ${opts.headless ? "Open the link to finish it yourself." : "The page is open in the JobPilot browser for you."}`);
  }

  if (boardOnly && llm) {
    log(id, "Listed on a job board: following Apply to the employer's form");
    return finishWithAgent(job, page, llm, p, { cv }, opts, ownWords);
  }

  let fields = await readForm(page);
  if (!fields.some((f) => f.kind === "email" || /e-?mail/i.test(f.label))) {
    // Form not on this page yet: click Apply once.
    const btn = page.getByRole("link", { name: /^apply|apply (?:now|for this job)/i }).or(page.getByRole("button", { name: /^apply|apply (?:now|for this job)/i })).first();
    if (await btn.count()) {
      log(id, "Clicking Apply");
      await btn.click().catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await sleep(2000);
      blocker = await detectBlocker(page);
      if (blocker.kind === "captcha") {
        sessions.set(id, { page, mapped: [], values: new Map(), files: { cv } });
        if (opts.headless || !opts.waitForHuman || !(await waitForHuman(job, page))) return handOffCaptcha(job, opts);
        blocker = await detectBlocker(page);
      }
      if (blocker.kind !== "none") {
        sessions.set(id, { page, mapped: [], values: new Map(), files: { cv } });
        return save(job, "do_it_yourself", `${blocker.detail} ${opts.headless ? "Open the link to finish it yourself." : "The page is open in the JobPilot browser for you."}`);
      }
      fields = await readForm(page);
    }
  }
  const isApplication = fields.some((f) => f.kind === "file") || (fields.some((f) => /e-?mail/i.test(f.label + f.name)) && fields.some((f) => /name/i.test(f.label + f.name)));
  if (!isApplication) {
    if (llm) {
      log(id, "No standard form here: the AI agent takes over");
      return finishWithAgent(job, page, llm, p, { cv }, opts, ownWords);
    }
    await page.close().catch(() => {});
    return save(job, "do_it_yourself", "Couldn't find an application form. Connect your AI in Settings so JobPilot can work through custom pages, or open the link yourself.");
  }
  log(id, `Found ${fields.length} fields (${fields.filter((f) => f.required).length} required)`);

  // Comboboxes hide their options until opened: peek so mapping/AI see the real choices.
  for (const f of fields) if (f.kind === "combobox" && !f.options.length && !/location|city|country|phone/i.test(f.label)) f.options = await peekComboOptions(page, f);

  const mapped = mapAll(fields, p, job);
  const aiFields = mapped.filter((m) => m.need === "ai");
  let coverNote = "";
  if (aiFields.length || mapped.some((m) => m.source === "cover-file")) {
    if (!llm || ownWords) {
      for (const m of aiFields) Object.assign(m, m.field.required ? { need: "user", source: "user", note: ownWords ? "This employer wants this in your own words" : undefined } : { need: undefined, source: "rule", value: null, note: "Optional, left blank" });
    } else {
      log(id, `Writing ${aiFields.length} answers with ${llm.provider}/${llm.model}`);
      const res = await answerWithChecks(llm, p, job, aiFields, hidden);
      coverNote = res.coverNote;
      for (const w of res.warnings) log(id, `Check: ${w}`);
      for (const m of aiFields) {
        const a = res.answers.get(m.field.id);
        if (a) Object.assign(m, { value: a.value, source: "ai", need: undefined, note: a.basis });
        else if (m.field.required) Object.assign(m, { source: "user", need: "user", note: res.needUser.get(m.field.id) });
        else Object.assign(m, { source: "rule", need: undefined, value: null, note: "Optional, no grounded answer" });
      }
      // A free-text "cover letter" field gets the cover note.
      for (const m of mapped) if (/cover letter|cover note|why (?:do you want|are you interested)/i.test(m.field.label) && m.field.kind === "textarea" && !m.value && coverNote) Object.assign(m, { value: coverNote, source: "ai", need: undefined });
    }
  }
  job.coverNote = coverNote || job.coverNote;

  const pending: PendingQuestion[] = mapped
    .filter((m) => m.need === "user" && m.field.required)
    .map((m) => ({ fieldId: m.field.id, label: m.field.label || m.field.name, required: true, options: m.field.options.length ? m.field.options : undefined, hint: m.note && m.note !== m.field.label ? m.note : undefined }));
  job.pending = pending;
  job.answers = summarise(mapped, coverNote);
  if (ownWords && pending.length) job.handoff = "own_words";
  if (pending.length && llm) {
    log(id, "Drafting answers from your CV, LinkedIn and portfolio for you to approve…");
    await draftPending(llm, p, job, pending);
  }
  if (pending.length && !opts.fillEvenIfPending) {
    for (const q of pending) log(id, `Needs your answer: ${q.label}`);
    await page.close().catch(() => {});
    return save(job, "needs_answer", `${pending.length} question${pending.length > 1 ? "s" : ""} only you can answer`);
  }

  // Fill
  let coverFile: string | undefined;
  if (mapped.some((m) => m.source === "cover-file")) {
    if (!coverNote) return save(job, "needs_answer", "This form needs a cover letter file and none passed the checks. Write one or skip.");
    coverFile = path.join(DATA_DIR, "cover", `${id.replace(/[^\w-]/g, "_")}.txt`);
    fs.mkdirSync(path.dirname(coverFile), { recursive: true });
    fs.writeFileSync(coverFile, coverNote);
  }
  const files = { cv, cover: coverFile };
  const order = (m: Mapped) => (m.field.kind === "file" ? 0 : m.field.kind === "combobox" ? 2 : 1);
  for (const m of [...mapped].sort((a, b) => order(a) - order(b))) {
    if (m.value == null || m.value === "") continue;
    const r = await fillField(page, m.field, m.value, files);
    if (!r.ok) log(id, `Couldn't fill "${m.field.label}": ${r.note}`);
  }

  const values = new Map<string, string | string[]>();
  for (const m of mapped) if (m.value != null && m.value !== "") values.set(normQ(m.field.label), m.value);
  sessions.set(id, { page, mapped, values, files });
  let missing = await refillMissing(id);
  if (missing.length && llm && !pending.length) {
    log(id, `${missing.length} required field(s) still empty: the AI agent will finish them`);
    const r = await runAgent({ page, llm, job, profile: p, files, autoSubmit: false, ownWords, log: (m) => log(id, m), maxSteps: 15, hint: `The form is partly filled already. Fill only the remaining required fields: ${missing.map((f) => f.label).join("; ")}. Then answer ready_to_submit.` });
    job.answers = [...(job.answers ?? []), ...r.answers];
    if (r.outcome === "need_user") {
      job.pending = r.questions.map((q, i) => ({ fieldId: `agent-${i}`, label: q.label, required: true, options: q.options.length ? q.options : undefined }));
      await page.close().catch(() => {});
      sessions.delete(id);
      return save(job, "needs_answer", r.reason);
    }
    if (r.outcome === "captcha") return humanCheck(job, r.page, opts);
    if (r.outcome === "blocked") return save(job, "do_it_yourself", r.reason);
    missing = await refillMissing(id);
  }
  await page.screenshot({ path: shotPath(id), fullPage: true }).catch(() => {});

  if (missing.length || pending.length) {
    job.pending = [...pending, ...missing.filter((f) => !pending.some((q) => q.fieldId === f.id)).map((f) => ({ fieldId: f.id, label: f.label, required: true, options: f.options.length ? f.options : undefined }))];
    log(id, `Still empty after filling: ${job.pending.map((f) => f.label).join("; ")}`);
    return save(job, "filled", `Filled, but ${job.pending.length} required field(s) are still empty. Check the browser window.`);
  }
  // Autopilot still holds back pages that tried to instruct the AI.
  const flagged = job.flags.includes("hidden-instructions");
  if (opts.autoSubmit && !opts.dryRun && !flagged) return submit(id);
  log(id, opts.dryRun ? "Demo mode: filled but not submitted." : "Filled. Waiting for your review.");
  return save(job, "filled", opts.dryRun ? "Demo: filled, not submitted" : opts.headless ? "Filled in the background. Check the screenshot, then submit." : "Ready for your review in the browser window");
}

/** Hand the page to the AI agent and turn its outcome into a tracker status. */
async function finishWithAgent(job: Job, page: Page, llm: LLM, p: ReturnType<typeof load>["profile"], files: { cv: string; cover?: string }, opts: ApplyOptions, ownWords = false): Promise<Job> {
  const id = job.id;
  const auto = opts.autoSubmit && !opts.dryRun;
  const r: AgentResult = await runAgent({ page, llm, job, profile: p, files, autoSubmit: auto, ownWords, log: (m) => log(id, m) });
  // Latest value per question (re-runs shouldn't duplicate the list).
  const byLabel = new Map([...(job.answers ?? []), ...r.answers].map((x) => [x.label, x]));
  job.answers = [...byLabel.values()];
  const pg = r.page;
  sessions.set(id, { page: pg, mapped: [], values: new Map(), files });
  await pg.screenshot({ path: shotPath(id), fullPage: true }).catch(() => {});
  switch (r.outcome) {
    case "submitted":
      log(id, "Confirmation shown. Applied.");
      return save(job, "applied", "Confirmation page shown");
    case "ready_to_submit":
      if (auto && !job.flags.includes("hidden-instructions")) return submit(id);
      log(id, "Filled. Waiting for your review.");
      return save(job, "filled", opts.headless ? "Filled in the background. Check the screenshot, then submit." : "Ready for your review in the browser window");
    case "captcha":
      return humanCheck(job, pg, opts, () => finishWithAgent(job, pg, llm, p, files, { ...opts, waitForHuman: true }, ownWords));
    case "need_user":
      if (r.ownWords) {
        job.handoff = "own_words";
        job.flags = [...new Set([...job.flags, "ai-screening"])];
      }
      job.pending = r.questions.map((q, i) => ({ fieldId: `agent-${i}`, label: q.label, required: true, options: q.options.length ? q.options : undefined }));
      for (const q of job.pending) log(id, `Needs your answer: ${q.label}`);
      log(id, "Drafting answers from your CV, LinkedIn and portfolio for you to approve…");
      await draftPending(llm, p, job, job.pending);
      await pg.close().catch(() => {});
      sessions.delete(id);
      return save(job, "needs_answer", r.reason);
    case "blocked":
      log(id, r.reason);
      return save(job, "do_it_yourself", `${r.reason} Open the link to finish it yourself.`);
    default:
      log(id, `Stopped: ${r.reason}`);
      return save(job, "error", `JobPilot couldn't finish this form: ${r.reason} Try again, or open the link.`);
  }
}

// ── Human checks (CAPTCHA) ──────────────────────────────────────────────────
// JobPilot never solves CAPTCHAs. When one appears it keeps the filled form, tells you, and waits:
// you tick the box in the JobPilot window, it carries on and submits.

const watching = new Set<string>();

/** Wait up to 10 minutes for the user to pass the check in the visible window. */
async function waitForHuman(job: Job, page: Page): Promise<boolean> {
  const id = job.id;
  job.handoff = "captcha";
  save(job, "filled", "Waiting for you: tick the human check (CAPTCHA) in the JobPilot window. JobPilot carries on by itself.");
  log(id, "Waiting for you to pass the human check in the JobPilot browser window…");
  await page.bringToFront().catch(() => {});
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    if (page.isClosed()) return false;
    await sleep(2000);
    const b = await detectBlocker(page).catch(() => ({ kind: "none" as const, detail: "" }));
    if (b.kind !== "captcha") {
      log(id, "Human check passed. Continuing.");
      return true;
    }
  }
  log(id, "Gave up waiting for the human check.");
  return false;
}

function handOffCaptcha(job: Job, opts: Pick<ApplyOptions, "headless">): Job {
  job.handoff = "captcha";
  log(job.id, "A human check (CAPTCHA) appeared. JobPilot never solves those; it needs one tap from you.");
  return save(
    job,
    "filled",
    opts.headless
      ? "One quick human check (CAPTCHA) left. Press Finish: JobPilot reopens the filled form in a window, you tick the check, it submits."
      : "One quick human check (CAPTCHA) left. Press Finish and tick it; JobPilot does the rest.",
  );
}

/** A CAPTCHA appeared mid-application. Visible window: wait for you, then resume. Background: hand off. */
async function humanCheck(job: Job, page: Page, opts: Pick<ApplyOptions, "headless">, resume?: () => Promise<Job>): Promise<Job> {
  const id = job.id;
  if (!sessions.has(id)) sessions.set(id, { page, mapped: [], values: new Map(), files: { cv: cvPath() } });
  if (isHeadless() || opts.headless) return handOffCaptcha(job, { headless: true });
  if (!watching.has(id)) {
    watching.add(id);
    // Watch in the background so other applications in the queue keep going.
    void (async () => {
      try {
        if (!(await waitForHuman(job, page))) return void handOffCaptcha(job, { headless: false });
        if (await looksSubmitted(page)) return void save(job, "applied", "Confirmation page shown");
        await (resume ? resume() : submit(id));
      } catch (e) {
        log(id, `Stopped: ${(e as Error).message}`);
      } finally {
        watching.delete(id);
      }
    })();
  }
  job.handoff = "captcha";
  return save(job, "filled", "Waiting for you: tick the human check (CAPTCHA) in the JobPilot window. JobPilot carries on by itself.");
}

/** The user pressed Finish on a job that needs a human check. */
export function finishHandoff(id: string): "watching" | "reopen" {
  const s = sessions.get(id);
  const job = load().jobs[id];
  if (s && !s.page.isClosed() && !isHeadless() && job) {
    void s.page.bringToFront().catch(() => {});
    void humanCheck(job, s.page, { headless: false });
    return "watching";
  }
  return "reopen";
}

export function shotPath(id: string): string {
  const dir = path.join(DATA_DIR, "screens");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id.replace(/[^\w-]/g, "_")}.png`);
}

function summarise(mapped: Mapped[], coverNote: string): Job["answers"] {
  const out = mapped
    .filter((m) => m.value != null && m.value !== "")
    .map((m) => ({
      label: m.field.label || m.field.name,
      value: m.source === "cv-file" ? "(your CV)" : m.source === "cover-file" ? "(cover letter file)" : Array.isArray(m.value) ? m.value.join(", ") : String(m.value),
      source: m.source + (m.note ? ` · ${m.note}` : ""),
    }));
  if (coverNote) out.push({ label: "Cover note (drafted)", value: coverNote, source: "ai" });
  return out;
}

/** Re-read the form; required fields that are still empty get one more attempt. Returns what's still empty. */
async function refillMissing(id: string): Promise<FormField[]> {
  const s = sessions.get(id)!;
  const fields = await readForm(s.page);
  const empty = fields.filter((f) => f.required && !f.value && f.kind !== "file");
  const still: FormField[] = [];
  for (const f of empty) {
    const v = s.values.get(normQ(f.label));
    if (v == null) {
      still.push(f);
      continue;
    }
    await fillField(s.page, f, v, s.files);
  }
  if (still.length === empty.length) return still;
  const again = await readForm(s.page);
  return again.filter((f) => f.required && !f.value && f.kind !== "file");
}

export async function submit(id: string): Promise<Job> {
  const job = load().jobs[id];
  const s = sessions.get(id);
  if (!job) throw new Error("Job not found");
  if (!s || s.page.isClosed()) throw new Error("The browser window for this job was closed. Click Apply again.");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const btn = await findSubmit(s.page);
    if (!btn) return save(job, "filled", "Couldn't find the submit button. Submit in the browser window, then mark it applied.");
    log(id, `Clicking submit (attempt ${attempt})`);
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch(() => {});
    await s.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await sleep(2500);
    if (await looksSubmitted(s.page)) {
      log(id, "Confirmation shown. Applied.");
      await s.page.screenshot({ path: shotPath(id), fullPage: true }).catch(() => {});
      return save(job, "applied", "Confirmation page shown");
    }
    const blocker = await detectBlocker(s.page);
    if (blocker.kind === "captcha") return humanCheck(job, s.page, { headless: isHeadless() } as ApplyOptions);
    if (blocker.kind !== "none") {
      log(id, blocker.detail);
      return save(job, "do_it_yourself", `${blocker.detail} Finish it in the open browser window, then mark it applied.`);
    }
    const errs = await visibleErrors(s.page);
    if (errs.length) log(id, `Form says: ${errs.join(" · ")}`);
    const missing = await refillMissing(id);
    if (missing.length) {
      job.pending = missing.map((f) => ({ fieldId: f.id, label: f.label, required: true, options: f.options.length ? f.options : undefined }));
      return save(job, "filled", `The form wants: ${missing.map((f) => f.label).join("; ")}. Fix in the browser, then submit there.`);
    }
    // Ashby: the first click sometimes only closes an open dropdown. Loop clicks again.
  }
  return save(job, "filled", "Clicked submit but couldn't confirm success. Check the browser window.");
}

export async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  sessions.delete(id);
  await s?.page.close().catch(() => {});
}
