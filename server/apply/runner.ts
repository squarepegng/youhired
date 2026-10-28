// The apply flow for one job: open → check for blockers → read form → map → AI answers → fill → verify →
// pause for your review (default) or submit (if you turned auto-submit on) → confirm success.

import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { detectAiScreening, detectInjection, isNeverApply } from "../guardrails.js";
import type { LLM } from "../providers/types.js";
import { DATA_DIR, cvPath, load, update } from "../store.js";
import type { Job, PendingQuestion } from "../types.js";
import { answerWithChecks } from "./answers.js";
import { detectBlocker, getContext, hiddenText, pageText, readForm } from "./browser.js";
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
}

export async function prepare(jobOrId: string | Job, llm: LLM | null, opts: ApplyOptions): Promise<Job> {
  const store = load();
  const job: Job = typeof jobOrId === "string" ? store.jobs[jobOrId] : jobOrId;
  if (!job) throw new Error("Job not found");
  const p = opts.profileOverride ?? store.profile;
  const id = job.id;
  logs.set(id, []);

  // Guardrails that need no browser
  if (isNeverApply(job.company, p.neverApply)) return save(job, "skipped", "On your never-apply list");
  if (!p.confirmed && !opts.profileOverride) throw new Error("Confirm your profile facts first (Profile → Confirm).");
  const cv = opts.cvOverride ?? cvPath();
  if (!fs.existsSync(cv)) throw new Error("Upload your CV in Profile first.");
  if (job.needsLogin) return save(job, "do_it_yourself", "This site needs an account. JobPilot never creates accounts or signs in.");
  if (job.flags.includes("ai-screening")) return save(job, "do_it_yourself", job.statusReason);

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
    log(id, "The page says it screens out AI-assisted applications. Leaving this one to you.");
    return save(job, "do_it_yourself", `The page says: "${screening.slice(0, 200)}"`);
  }
  const hidden = await hiddenText(page);
  const injected = detectInjection(`${text}\n${hidden}`);
  if (injected.length) {
    job.flags = [...new Set([...job.flags, "hidden-instructions"])];
    log(id, `Ignored instructions aimed at AI on this page: "${injected[0].snippet.slice(0, 120)}"`);
  }
  let blocker = await detectBlocker(page);
  if (blocker.kind !== "none") {
    log(id, blocker.detail);
    sessions.set(id, { page, mapped: [], values: new Map(), files: { cv } });
    return save(job, "do_it_yourself", `${blocker.detail} ${opts.headless ? "Open the link to finish it yourself." : "The page is open in the JobPilot browser for you."}`);
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
      if (blocker.kind !== "none") {
        sessions.set(id, { page, mapped: [], values: new Map(), files: { cv } });
        return save(job, "do_it_yourself", `${blocker.detail} ${opts.headless ? "Open the link to finish it yourself." : "The page is open in the JobPilot browser for you."}`);
      }
      fields = await readForm(page);
    }
  }
  const isApplication = fields.some((f) => f.kind === "file") || (fields.some((f) => /e-?mail/i.test(f.label + f.name)) && fields.some((f) => /name/i.test(f.label + f.name)));
  if (!isApplication) {
    await page.close().catch(() => {});
    return save(job, "do_it_yourself", "Couldn't find an application form JobPilot can fill. Open the link and apply yourself.");
  }
  log(id, `Found ${fields.length} fields (${fields.filter((f) => f.required).length} required)`);

  // Comboboxes hide their options until opened: peek so mapping/AI see the real choices.
  for (const f of fields) if (f.kind === "combobox" && !f.options.length && !/location|city|country|phone/i.test(f.label)) f.options = await peekComboOptions(page, f);

  const mapped = mapAll(fields, p, job);
  const aiFields = mapped.filter((m) => m.need === "ai");
  let coverNote = "";
  if (aiFields.length || mapped.some((m) => m.source === "cover-file")) {
    if (!llm) {
      for (const m of aiFields) Object.assign(m, { need: m.field.required ? "user" : undefined, source: "user" });
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
  const missing = await refillMissing(id);
  await page.screenshot({ path: shotPath(id), fullPage: true }).catch(() => {});

  if (missing.length || pending.length) {
    job.pending = [...pending, ...missing.filter((f) => !pending.some((q) => q.fieldId === f.id)).map((f) => ({ fieldId: f.id, label: f.label, required: true, options: f.options.length ? f.options : undefined }))];
    log(id, `Still empty after filling: ${job.pending.map((f) => f.label).join("; ")}`);
    return save(job, "filled", `Filled, but ${job.pending.length} required field(s) are still empty. Check the browser window.`);
  }
  const flagged = job.flags.includes("hidden-instructions") || mapped.some((m) => /consent/i.test(m.note ?? ""));
  if (opts.autoSubmit && !opts.dryRun && !flagged) return submit(id);
  log(id, opts.dryRun ? "Demo mode: filled but not submitted." : "Filled. Waiting for your review.");
  return save(job, "filled", opts.dryRun ? "Demo: filled, not submitted" : opts.headless ? "Filled in the background. Check the screenshot, then submit." : "Ready for your review in the browser window");
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
