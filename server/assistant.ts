// The Assistant: an agent you talk to. You say what you want ("senior product design roles in fintech
// that hire in Africa, apply to the good ones") and it works through it with tools: searching job
// boards, reading postings, checking companies' public job boards, applying, and reporting back.
//
// It runs a tool loop that works with every provider: each round the model returns JSON with tool calls
// (or a final reply); we run the tools and feed the results back, up to MAX_ROUNDS.
//
// Safety: read-only tools and filling applications (which pause for review) run straight away.
// Sending applications unreviewed (auto-submit on) or skipping many jobs waits for a Confirm click.
// Profile facts can't be changed from chat. Job-site text is passed as untrusted data.

import crypto from "node:crypto";
import { applyBlocker, enqueue } from "./apply/queue.js";
import { UNTRUSTED_RULE, isJobBoardUrl, untrusted } from "./guardrails.js";
import type { LLM } from "./providers/types.js";
import { profileBrief, progress, runSearch } from "./search.js";
import { ashby, greenhouse, lever, recruitee, workable, type RawJob } from "./sources/index.js";
import { load, update } from "./store.js";
import type { ChatAction, ChatMessage, Job } from "./types.js";

const MAX_ROUNDS = 10;

const TOOLS = ["list_jobs", "get_job", "search_jobs", "check_companies", "add_companies", "set_brief", "update_search", "apply_jobs", "skip_jobs", "open_job"] as const;
type Tool = (typeof TOOLS)[number];

interface Call {
  tool: Tool;
  job_ids: string[];
  status: string;
  query: string;
  min_fit: number;
  limit: number;
  titles: string[];
  exclude_keywords: string[];
  brief: string;
  reason: string;
  companies: string[];
}

interface Turn {
  thought: string;
  calls: Call[];
  done: boolean;
  reply: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    thought: { type: "string", description: "Your private plan for this round, one or two sentences" },
    calls: {
      type: "array",
      description: "Tools to run now (they run in order). Empty when done.",
      items: {
        type: "object",
        properties: {
          tool: { type: "string", enum: [...TOOLS] },
          job_ids: { type: "array", items: { type: "string" } },
          status: { type: "string", description: "list_jobs filter: found | filled | applied | needs_answer | do_it_yourself | skipped | error | all" },
          query: { type: "string", description: "list_jobs: words to match in title/company" },
          min_fit: { type: "integer" },
          limit: { type: "integer" },
          titles: { type: "array", items: { type: "string" } },
          exclude_keywords: { type: "array", items: { type: "string" } },
          brief: { type: "string" },
          reason: { type: "string" },
          companies: { type: "array", items: { type: "string" }, description: "check_companies/add_companies: company names or board slugs, e.g. 'zapier', 'gitlab'" },
        },
        required: ["tool", "job_ids", "status", "query", "min_fit", "limit", "titles", "exclude_keywords", "brief", "reason", "companies"],
      },
    },
    done: { type: "boolean", description: "true when you have the final answer for the user" },
    reply: { type: "string", description: "When done: your message to the user (markdown lists and **bold** allowed). Otherwise empty." },
  },
  required: ["thought", "calls", "done", "reply"],
};

const SYSTEM = `You are JobPilot's assistant: a sharp, proactive job-search agent working for one candidate.
You find remote jobs they can legally be hired for, judge fit, and get applications done. You have tools; use them.

TOOLS (call several per round; results come back next round):
- list_jobs(status?, query?, min_fit?, limit?): jobs in the tracker with status, fit, eligibility, whether JobPilot can apply automatically.
- get_job(job_ids): full details for up to 3 jobs: where they hire (exact wording), why it fits, pay, the posting text.
- search_jobs(titles?, brief?): run a fresh search across all job sources NOW and wait for results (1-3 minutes). Optionally update titles/brief first. Returns the new jobs.
- check_companies(companies): look up companies' public Greenhouse/Lever/Ashby/Recruitee/Workable boards; returns which exist and their open roles matching the candidate's titles. Use your own knowledge of companies that hire remotely internationally (e.g. GitLab, Automattic, Zapier, Canonical, Toggl, Doist, Remote, Deel, Hotjar, Buffer, Wikimedia, Kraken, Sourcegraph, PostHog, Supabase, Vercel, Grafana Labs, Elastic, Sentry, Linear, Mozilla, DuckDuckGo, Andela, Paystack, Flutterwave, Moniepoint, Chipper Cash, Kuda, Yoco...) to suggest board names.
- add_companies(companies): add verified boards to future searches.
- set_brief(brief): save what the candidate wants (seniority, field, industries, likes/dislikes). Fit scoring uses it.
- update_search(titles, exclude_keywords): change which titles searches match. Titles are short ("product designer"); a posting matches if its title contains every word.
- apply_jobs(job_ids): JobPilot applies itself (queued, one at a time): it opens the employer's form, fills it from the profile and CV, answers questions, uploads the CV. Use for jobs with status found/error/filled and auto_apply=yes, including job-board listings. With review on, each waits for the candidate to press Submit; with auto-submit on it sends them. Never tell the user to apply manually unless a job came back as do_it_yourself (login/CAPTCHA/AI-screening).
- skip_jobs(job_ids, reason), open_job(job_ids).

HOW TO BEHAVE:
- Be proactive. Don't ask permission to search, read or check things; just do it, then report. When the user states what they want, set the brief, adjust titles, and search in the same turn.
- "Jobs available in <country>" means remote roles the candidate can be hired for from there. Answer with real jobs from tools, not guesses.
- If results are thin (fewer than ~5 good matches), widen: add title variants, check 8-15 relevant companies' boards, add those with matching roles, and search again. Say what you did.
- When asked to apply, pick eligible jobs with good fit (≥60) and auto_apply=yes, call apply_jobs, and list what was queued. Offer to apply to good matches; don't send the user off to apply by hand. Only jobs already marked do_it_yourself (or auto_apply=no) need the user, and say why.
- Explain decisions with evidence: quote the posting's location words, give fit scores and the reason.
- Final replies: short, concrete, skimmable. Lead with the answer. Use job titles and companies, never ids. End with the obvious next step only if useful, not a question every time.
- Never invent jobs, companies' openings, statuses or facts. Only claim what tool results show.
- You can't change profile facts (location, work authorisation, salary, contact details); point to Profile.
- If the profile isn't confirmed or the CV is missing, applications can't start: say exactly what to do.
${UNTRUSTED_RULE}`;

// ── State shown to the UI while a turn runs ──
export const activity: { running: boolean; steps: string[] } = { running: false, steps: [] };
const note = (s: string) => {
  activity.steps.push(s);
  if (activity.steps.length > 40) activity.steps.shift();
};

/** Login-only sites are out. Job-board listings are tried: JobPilot finds the employer's form or follows Apply. */
function autoApply(j: Job): boolean {
  return !j.needsLogin;
}
const viaBoard = (j: Job) => j.ats === "job-board" || isJobBoardUrl(j.applyUrl);

function jobLine(j: Job): string {
  return [
    `id=${j.id}`,
    `status=${j.status}`,
    `title=${j.title}`,
    `company=${j.company}`,
    `fit=${j.fit ?? "?"}`,
    `eligibility=${j.eligibility?.verdict ?? "?"} ("${(j.eligibility?.evidence || j.location || "").slice(0, 70)}")`,
    `auto_apply=${!autoApply(j) ? "no (login-only site)" : viaBoard(j) ? "yes (job-board listing: JobPilot finds the employer's form or follows Apply; some boards turn out to need an account)" : "yes"}`,
    `source=${j.source}`,
    j.statusReason ? `note=${j.statusReason.slice(0, 110)}` : "",
    j.pending?.length ? `waiting_on_user=${j.pending.map((p) => p.label.slice(0, 60)).join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function stateSummary(): string {
  const { profile: p, search, settings, jobs } = load();
  const all = Object.values(jobs);
  const counts: Record<string, number> = {};
  for (const j of all) counts[j.status] = (counts[j.status] ?? 0) + 1;
  return [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Candidate (trusted):\n${profileBrief(p)}\nProfile facts confirmed: ${p.confirmed ? "yes" : "NO"}. CV uploaded: ${p.cvFileName ? "yes" : "NO"}.`,
    `Brief: ${search.brief || "(none yet)"}`,
    `Search titles: ${JSON.stringify(search.titles)}; excluded: ${JSON.stringify(search.excludeKeywords)}; posted within ${search.maxAgeDays} days; company boards: greenhouse ${search.greenhouseBoards.length}, lever ${search.leverCompanies.length}, ashby ${search.ashbyOrgs.length}.`,
    `Applying: ${settings.autoSubmit ? "AUTO-SUBMIT ON (applications are sent without review)" : "review on (forms are filled, then wait for the candidate to submit)"}; ${settings.background ? "in the background" : "in a visible browser"}.`,
    `Tracker: ${JSON.stringify(counts)} (total ${all.length}). Search running: ${progress.running ? "yes" : "no"}.`,
  ].join("\n");
}

// ── Tools ──
const asJobs = (ids: string[]) => ids.map((id) => load().jobs[id]).filter(Boolean) as Job[];

function listJobs(c: Call): string {
  const t = c.query.trim().toLowerCase();
  const order = ["needs_answer", "filled", "found", "do_it_yourself", "error", "applied", "skipped"];
  const jobs = Object.values(load().jobs)
    .filter((j) => !c.status || c.status === "all" || j.status === c.status)
    .filter((j) => !t || `${j.title} ${j.company}`.toLowerCase().includes(t))
    .filter((j) => !c.min_fit || (j.fit ?? 0) >= c.min_fit)
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.fit ?? -1) - (a.fit ?? -1))
    .slice(0, Math.min(c.limit || 40, 80));
  note(`Looked through ${jobs.length} jobs in your tracker`);
  return untrusted("job_list", jobs.map(jobLine).join("\n") || "(no matching jobs)", 16000);
}

function getJob(c: Call): string {
  const jobs = asJobs(c.job_ids.slice(0, 3));
  for (const j of jobs) note(`Read ${j.title} at ${j.company}`);
  return jobs
    .map((j) =>
      untrusted(
        "job",
        [
          jobLine(j),
          `why_fit: ${j.whyFit ?? "(not scored)"}`,
          `eligibility_reason: ${j.eligibility?.reason ?? ""}`,
          j.salaryText ? `pay: ${j.salaryText}` : "",
          j.answers?.length ? `answers_filled: ${j.answers.map((a) => `${a.label}: ${a.value.slice(0, 80)}`).join(" | ")}` : "",
          `posting:\n${j.description.slice(0, 2500)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        4000,
      ),
    )
    .join("\n\n") || "No such job.";
}

async function searchJobs(c: Call, llm: LLM): Promise<string> {
  if (c.titles.length || c.brief) {
    update((s) => {
      if (c.titles.length) s.search.titles = c.titles.map((t) => t.trim()).filter(Boolean);
      if (c.brief) s.search.brief = c.brief.trim();
    });
  }
  if (!load().profile.country) return "Can't search: the candidate's country isn't set in Profile.";
  const before = new Set(Object.keys(load().jobs));
  note(`Searching job boards for ${load().search.titles.join(", ")}…`);
  if (!progress.running) void runSearch(llm);
  const start = Date.now();
  let lastLen = 0;
  while ((progress.running || Date.now() - start < 1500) && Date.now() - start < 6 * 60_000) {
    await new Promise((r) => setTimeout(r, 1500));
    if (progress.log.length !== lastLen) {
      lastLen = progress.log.length;
      const last = progress.log.at(-1) ?? "";
      if (/passed the filters|Looking for the employer|fit \d+|Done/.test(last)) note(last.slice(0, 120));
    }
  }
  const fresh = Object.values(load().jobs).filter((j) => !before.has(j.id));
  const kept = fresh.filter((j) => j.status !== "skipped");
  note(`Search finished: ${kept.length} new jobs kept, ${fresh.length - kept.length} skipped`);
  const skippedWhy = fresh
    .filter((j) => j.status === "skipped")
    .slice(0, 12)
    .map((j) => `${j.title} @ ${j.company}: ${j.statusReason?.slice(0, 90)}`);
  return [
    `Search done. New jobs: ${fresh.length} (kept ${kept.length}). Errors: ${progress.errors.slice(0, 4).join("; ") || "none"}.`,
    untrusted("new_jobs", kept.map(jobLine).join("\n") || "(none kept)", 14000),
    skippedWhy.length ? untrusted("skipped_examples", skippedWhy.join("\n"), 3000) : "",
  ].join("\n");
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function checkCompanies(c: Call): Promise<string> {
  const titles = load().search.titles;
  const words = titles.flatMap((t) => t.toLowerCase().split(/\s+/)).filter((w) => w.length > 2);
  const out: string[] = [];
  for (const name of c.companies.slice(0, 15)) {
    const s = slug(name);
    note(`Checking ${name}'s job board…`);
    const found: string[] = [];
    for (const [ats, fn] of [["ashby", ashby], ["greenhouse", greenhouse], ["lever", lever], ["recruitee", recruitee], ["workable", workable]] as [string, (x: string) => Promise<RawJob[]>][]) {
      try {
        const jobs = await fn(s);
        const matches = jobs.filter((j) => words.some((w) => j.title.toLowerCase().includes(w)));
        found.push(`${ats}:${s} (${jobs.length} open roles; matching: ${matches.slice(0, 5).map((j) => `${j.title} [${j.location.slice(0, 40)}]`).join("; ") || "none"})`);
        break;
      } catch {
        /* not on this ATS under this name */
      }
    }
    out.push(`${name}: ${found.length ? found.join(", ") : "no public Greenhouse/Lever/Ashby board found under that name"}`);
  }
  return untrusted("company_boards", out.join("\n"), 8000);
}

function addCompanies(c: Call): ChatAction {
  const added: string[] = [];
  update((s) => {
    for (const raw of c.companies) {
      const m = raw.match(/^(ashby|greenhouse|lever):([a-z0-9._-]+)$/i);
      if (!m) continue;
      const [_, ats, sl] = m;
      const list = ats === "ashby" ? s.search.ashbyOrgs : ats === "greenhouse" ? s.search.greenhouseBoards : s.search.leverCompanies;
      if (!list.includes(sl)) {
        list.push(sl);
        added.push(`${sl} (${ats})`);
      }
    }
  });
  note(`Added ${added.length} company boards to your sources`);
  return { type: "add_companies", summary: added.length ? `Added company boards: ${added.join(", ")}` : "No new company boards to add", status: "done", data: { companies: added } };
}

function skip(ids: string[], reason: string) {
  update((s) => {
    for (const id of ids) {
      const j = s.jobs[id];
      if (!j || j.status === "applied") continue;
      j.status = "skipped";
      j.statusReason = reason ? `Skipped via Assistant: ${reason}` : "Skipped via Assistant";
      j.statusDate = new Date().toISOString();
    }
  });
}

async function runTool(c: Call, llm: LLM, actions: ChatAction[]): Promise<string> {
  const ids = (c.job_ids ?? []).filter((id) => load().jobs[id]);
  switch (c.tool) {
    case "list_jobs":
      return listJobs(c);
    case "get_job":
      return getJob({ ...c, job_ids: ids });
    case "search_jobs": {
      const r = await searchJobs(c, llm);
      actions.push({ type: "run_search", summary: `Searched job boards for ${load().search.titles.join(", ")}`, status: "done", data: {} });
      return r;
    }
    case "check_companies":
      return checkCompanies(c);
    case "add_companies": {
      const a = addCompanies(c);
      actions.push(a);
      return a.summary;
    }
    case "set_brief":
      update((s) => void (s.search.brief = c.brief.trim()));
      actions.push({ type: "set_brief", summary: "Saved your brief", status: "done", data: { brief: c.brief } });
      note("Saved your brief");
      return "Brief saved.";
    case "update_search":
      update((s) => {
        if (c.titles.length) s.search.titles = c.titles.map((t) => t.trim()).filter(Boolean);
        if (c.exclude_keywords.length) s.search.excludeKeywords = c.exclude_keywords.map((t) => t.trim()).filter(Boolean);
      });
      actions.push({ type: "update_search", summary: `Search titles → ${load().search.titles.join(", ")}`, status: "done", data: {} });
      note("Updated your search titles");
      return `Titles now: ${load().search.titles.join(", ")}; excluded: ${load().search.excludeKeywords.join(", ")}`;
    case "apply_jobs": {
      const jobs = asJobs(ids);
      const ok = jobs.filter((j) => autoApply(j) && ["found", "error", "filled"].includes(j.status));
      const notOk = jobs.filter((j) => !ok.includes(j));
      if (!ok.length) return `Nothing to apply to. ${notOk.map((j) => `${j.title} @ ${j.company}: status ${j.status}, auto_apply ${autoApply(j) ? "yes" : "no"}`).join("; ")}`;
      const block = applyBlocker();
      if (block) {
        actions.push({ type: "apply_jobs", summary: `Apply to ${ok.length} jobs`, status: "failed", data: { error: block, job_ids: ok.map((j) => j.id) } });
        return `Can't apply: ${block}`;
      }
      if (load().settings.autoSubmit) {
        actions.push({ type: "apply_jobs", summary: `Apply to ${ok.length} jobs (sent without review)`, status: "needs_confirm", data: { job_ids: ok.map((j) => j.id) } });
        return "Waiting for the candidate to press Confirm, because auto-submit is on.";
      }
      const r = enqueue(ok.map((j) => j.id));
      note(`Queued ${r.added.length} applications`);
      actions.push({ type: "apply_jobs", summary: `Filling ${r.added.length} application${r.added.length === 1 ? "" : "s"}`, status: "done", data: { job_ids: r.added } });
      return `Queued ${r.added.length}: ${asJobs(r.added).map((j) => `${j.title} @ ${j.company}`).join("; ")}. Not applicable: ${notOk.map((j) => `${j.title} @ ${j.company} (${autoApply(j) ? j.status : "needs applying on the site"})`).join("; ") || "none"}.`;
    }
    case "skip_jobs": {
      if (!ids.length) return "No matching jobs.";
      if (ids.length > 5) {
        actions.push({ type: "skip_jobs", summary: `Skip ${ids.length} jobs: ${c.reason}`, status: "needs_confirm", data: { job_ids: ids, reason: c.reason } });
        return "Waiting for the candidate to confirm skipping these.";
      }
      skip(ids, c.reason);
      actions.push({ type: "skip_jobs", summary: `Skipped ${ids.length} job${ids.length === 1 ? "" : "s"}: ${c.reason}`, status: "done", data: { job_ids: ids } });
      return `Skipped ${ids.length}.`;
    }
    case "open_job":
      actions.push({ type: "open_job", summary: "Open in JobPilot", status: ids.length ? "done" : "failed", data: { job_ids: ids.slice(0, 3) } });
      return "Shown to the candidate.";
  }
  return "Unknown tool.";
}

export async function chat(llm: LLM, userText: string): Promise<ChatMessage> {
  const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text: userText.trim(), at: new Date().toISOString() };
  update((s) => void s.chat.push(userMsg));
  activity.running = true;
  activity.steps = [];
  note("Thinking…");

  const history = load()
    .chat.slice(-16)
    .map((m) => ({
      role: m.role,
      content: m.role === "assistant" && m.actions?.length ? `${m.text}\n[actions: ${m.actions.map((a) => `${a.summary} (${a.status})`).join("; ")}]` : m.text,
    }));
  const actions: ChatAction[] = [];
  const toolLog: string[] = [];
  let reply = "";
  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS;
      const turn = await llm.json<Turn>({
        schemaName: "assistant_round",
        schema: SCHEMA,
        maxTokens: 6000,
        system: `${SYSTEM}\n\n--- Current state ---\n${stateSummary()}`,
        messages: [
          ...history.slice(0, -1),
          {
            role: "user",
            content: [
              history.at(-1)?.content ?? userText,
              toolLog.length ? `\n--- Tool results so far (round ${round}) ---\n${toolLog.join("\n\n")}` : "",
              last ? "\nThis is your last round: reply to the user now (done=true)." : "",
            ].join(""),
          },
        ],
      });
      if (turn.done || !turn.calls?.length || last) {
        reply = turn.reply || (last ? "I ran out of steps. Here's where things stand." : "Done.");
        break;
      }
      for (const c of turn.calls.slice(0, 6)) {
        const result = await runTool(c, llm, actions).catch((e) => `Tool failed: ${(e as Error).message}`);
        toolLog.push(`[${c.tool}] ${result}`);
      }
    }
  } finally {
    activity.running = false;
  }

  const msg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", text: reply, at: new Date().toISOString(), actions, steps: activity.steps.filter((s) => s !== "Thinking…") };
  update((s) => void s.chat.push(msg));
  return msg;
}

/** The user pressed Confirm (or Cancel) on an action that needed it. */
export function resolveAction(messageId: string, index: number, confirm: boolean): ChatMessage | undefined {
  let msg: ChatMessage | undefined;
  update((s) => {
    msg = s.chat.find((m) => m.id === messageId);
    const a = msg?.actions?.[index];
    if (!a || a.status !== "needs_confirm") return;
    const ids = (a.data.job_ids as string[]) ?? [];
    if (!confirm) a.status = "cancelled";
    else if (a.type === "apply_jobs") {
      const block = applyBlocker();
      if (block) {
        a.status = "failed";
        a.data.error = block;
      } else {
        enqueue(ids);
        a.status = "done";
      }
    } else if (a.type === "skip_jobs") {
      a.status = "done";
      queueMicrotask(() => skip(ids, String(a.data.reason ?? "")));
    }
  });
  return msg;
}

/** Kept for index.ts wiring; the assistant gets its model per turn. */
export function configureAssistant(_fn: () => LLM | null): void {}
