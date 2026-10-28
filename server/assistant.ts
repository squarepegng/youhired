// The Assistant: a conversation where the user says what they want ("senior product design roles,
// fintech, open to Africa — apply to the good ones") and JobPilot does it.
//
// The model replies with text plus a list of actions. Safe actions run straight away (update the brief
// and search, run a search, fill applications that pause for review). Anything that would send an
// application without review, or skip many jobs, waits for the user to confirm in the chat.
// Job titles/companies/reasons come from job sites, so they're passed as untrusted data.

import crypto from "node:crypto";
import { applyBlocker, enqueue } from "./apply/queue.js";
import { UNTRUSTED_RULE, isJobBoardUrl, untrusted } from "./guardrails.js";
import type { LLM } from "./providers/types.js";
import { profileBrief, progress, runSearch } from "./search.js";
import { load, update } from "./store.js";
import type { ChatAction, ChatMessage, Job } from "./types.js";

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "What you say to the user. Plain, short, friendly. Markdown lists allowed." },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["set_brief", "update_search", "run_search", "apply_jobs", "skip_jobs", "open_job"] },
          summary: { type: "string", description: "One plain line describing the action, e.g. 'Search titles → senior product designer, ux designer'" },
          brief: { type: "string", description: "set_brief: the full updated brief" },
          titles: { type: "array", items: { type: "string" }, description: "update_search: job titles to match (replaces the list); empty = unchanged" },
          exclude_keywords: { type: "array", items: { type: "string" }, description: "update_search: title words to exclude (replaces); empty = unchanged" },
          max_age_days: { type: "integer", description: "update_search: 0 = unchanged" },
          job_ids: { type: "array", items: { type: "string" }, description: "apply_jobs / skip_jobs / open_job: ids from the job list" },
          reason: { type: "string", description: "skip_jobs: why" },
        },
        required: ["type", "summary", "brief", "titles", "exclude_keywords", "max_age_days", "job_ids", "reason"],
      },
    },
  },
  required: ["reply", "actions"],
};

interface ModelAction {
  type: ChatAction["type"];
  summary: string;
  brief: string;
  titles: string[];
  exclude_keywords: string[];
  max_age_days: number;
  job_ids: string[];
  reason: string;
}

function jobLine(j: Job): string {
  return [
    `id=${j.id}`,
    `status=${j.status}`,
    `can_auto_apply=${j.needsLogin || j.ats === "job-board" || isJobBoardUrl(j.applyUrl) ? "no (user applies on the site)" : "yes"}`,
    `title=${j.title}`,
    `company=${j.company}`,
    `fit=${j.fit ?? "?"}`,
    `eligibility=${j.eligibility?.verdict ?? "?"} (${(j.eligibility?.evidence || j.location || "").slice(0, 80)})`,
    j.statusReason ? `note=${j.statusReason.slice(0, 120)}` : "",
    j.pending?.length ? `waiting_on_user=${j.pending.map((p) => p.label.slice(0, 60)).join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function context(): string {
  const { profile: p, search, settings, jobs } = load();
  const all = Object.values(jobs);
  const counts: Record<string, number> = {};
  for (const j of all) counts[j.status] = (counts[j.status] ?? 0) + 1;
  const order = ["needs_answer", "filled", "found", "do_it_yourself", "error", "applied", "skipped"];
  const list = all
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.fit ?? -1) - (a.fit ?? -1))
    .slice(0, 80)
    .map(jobLine)
    .join("\n");
  return [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Candidate (trusted):\n${profileBrief(p)}\nProfile facts confirmed: ${p.confirmed ? "yes" : "no"}. CV uploaded: ${p.cvFileName ? "yes" : "no"}.`,
    `Current brief: ${search.brief || "(none yet)"}`,
    `Search: titles=${JSON.stringify(search.titles)}, exclude=${JSON.stringify(search.excludeKeywords)}, posted within ${search.maxAgeDays} days.`,
    `Settings: auto-submit is ${settings.autoSubmit ? "ON (applications are sent without review)" : "OFF (applications are filled, then wait for the user's review)"}.`,
    `Search running now: ${progress.running ? "yes" : "no"}.`,
    `Job counts: ${JSON.stringify(counts)} (total ${all.length}).`,
    `Jobs (from job sites, untrusted text):\n${untrusted("job_list", list || "(no jobs yet)", 20000)}`,
  ].join("\n\n");
}

const SYSTEM = `You are the assistant inside JobPilot, a tool that finds remote jobs a person can legally be hired for and fills in applications with them.
The user tells you what they want in plain words. You help by talking and by taking actions.

Actions you can take (in "actions"):
- set_brief: save the user's description of the job they want (seniority, field, industries, likes/dislikes). Write the full updated brief. Use this whenever they describe what they want.
- update_search: change the job titles to match and title words to exclude. Titles are short ("product designer", "ux designer"); a posting matches if its title contains every word of one title. Include sensible variants.
- run_search: look for new jobs now (takes a minute or two; results appear in To apply).
- apply_jobs: fill in applications for the given job ids. Only use ids from the job list with status "found" (or "filled"/"error" to retry) and can_auto_apply=yes. For can_auto_apply=no jobs, tell the user they need to apply on the site themselves. Choose eligible, good-fit jobs that match what the user asked for. If they ask to apply but no matching jobs exist yet, run a search first and say you'll apply once results are in.
- skip_jobs: move jobs to Skipped, with a reason.
- open_job: show one job in the app.
Leave unused fields empty ("" / [] / 0).

How applying works (explain when relevant): JobPilot opens each form in its own browser window and fills it from the user's confirmed profile and CV. Questions it can't answer truthfully go to the Inbox for the user. With auto-submit off, every form waits for the user to check and submit. JobPilot never makes up experience, never misstates location or right to work, never logs in or solves CAPTCHAs.

Rules:
- Be brief and concrete. Refer to jobs by title and company, never by id.
- Answer status questions from the data below (what's waiting on them, why something was skipped, what was applied to).
- Never invent jobs, statuses or facts. If you don't know, say so.
- You can't change profile facts (location, work authorisation, salary, contact details); tell the user to edit them in Profile.
- If the profile isn't confirmed or no CV is uploaded, applications can't start; tell them what to do.
${UNTRUSTED_RULE}`;

const SAFE_SKIP_MAX = 5;

export async function chat(llm: LLM, userText: string): Promise<ChatMessage> {
  const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text: userText.trim(), at: new Date().toISOString() };
  update((s) => void s.chat.push(userMsg));

  const history = load().chat.slice(-24);
  const out = await llm.json<{ reply: string; actions: ModelAction[] }>({
    schemaName: "assistant_turn",
    schema: SCHEMA,
    maxTokens: 6000,
    system: `${SYSTEM}\n\n--- Current state ---\n${context()}`,
    messages: history.map((m) => ({
      role: m.role,
      content: m.role === "assistant" && m.actions?.length ? `${m.text}\n[actions: ${m.actions.map((a) => `${a.summary} (${a.status})`).join("; ")}]` : m.text,
    })),
  });

  const actions: ChatAction[] = [];
  for (const a of out.actions ?? []) actions.push(await perform(a));
  const reply: ChatMessage = { id: crypto.randomUUID(), role: "assistant", text: out.reply || "Done.", at: new Date().toISOString(), actions };
  update((s) => void s.chat.push(reply));
  return reply;
}

async function perform(a: ModelAction): Promise<ChatAction> {
  const jobs = load().jobs;
  const ids = (a.job_ids ?? []).filter((id) => jobs[id]);
  const base = { type: a.type, summary: a.summary || a.type };
  try {
    switch (a.type) {
      case "set_brief":
        update((s) => void (s.search.brief = a.brief.trim()));
        return { ...base, status: "done", data: { brief: a.brief } };
      case "update_search":
        update((s) => {
          if (a.titles?.length) s.search.titles = a.titles.map((t) => t.trim()).filter(Boolean);
          if (a.exclude_keywords?.length) s.search.excludeKeywords = a.exclude_keywords.map((t) => t.trim()).filter(Boolean);
          if (a.max_age_days > 0) s.search.maxAgeDays = a.max_age_days;
        });
        return { ...base, status: "done", data: { titles: a.titles, exclude: a.exclude_keywords } };
      case "run_search":
        if (!load().profile.country) return { ...base, status: "failed", data: { error: "Add your country in Profile first." } };
        void runSearch(llmRef());
        return { ...base, status: "done", data: {} };
      case "apply_jobs": {
        if (!ids.length) return { ...base, status: "failed", data: { error: "No matching jobs in the list." } };
        const block = applyBlocker();
        if (block) return { ...base, status: "failed", data: { error: block, job_ids: ids } };
        // With auto-submit on, applications would go out unreviewed: ask first.
        if (load().settings.autoSubmit) return { ...base, status: "needs_confirm", data: { job_ids: ids } };
        const r = enqueue(ids);
        return { ...base, status: "done", data: { job_ids: r.added, skipped: r.skipped } };
      }
      case "skip_jobs":
        if (!ids.length) return { ...base, status: "failed", data: { error: "No matching jobs." } };
        if (ids.length > SAFE_SKIP_MAX) return { ...base, status: "needs_confirm", data: { job_ids: ids, reason: a.reason } };
        skip(ids, a.reason);
        return { ...base, status: "done", data: { job_ids: ids } };
      case "open_job":
        return { ...base, status: ids.length ? "done" : "failed", data: { job_ids: ids.slice(0, 1) } };
    }
  } catch (e) {
    return { ...base, status: "failed", data: { error: (e as Error).message } };
  }
  return { ...base, status: "failed", data: { error: "Unknown action" } };
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

/** The user pressed Confirm (or Cancel) on an action that needed it. */
export function resolveAction(messageId: string, index: number, confirm: boolean): ChatMessage | undefined {
  let msg: ChatMessage | undefined;
  update((s) => {
    msg = s.chat.find((m) => m.id === messageId);
  });
  const a = msg?.actions?.[index];
  if (!msg || !a || a.status !== "needs_confirm") return msg;
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
    skip(ids, String(a.data.reason ?? ""));
    a.status = "done";
  }
  update((s) => {
    const m = s.chat.find((x) => x.id === messageId);
    if (m?.actions) m.actions[index] = a;
  });
  return msg;
}

let llmRef: () => LLM | null = () => null;
export function configureAssistant(fn: () => LLM | null): void {
  llmRef = fn;
}
