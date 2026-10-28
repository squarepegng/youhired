import { checkLocation } from "./eligibility.js";
import { UNTRUSTED_RULE, detectAiScreening, detectInjection, isNeverApply, untrusted } from "./guardrails.js";
import type { LLM } from "./providers/types.js";
import { type RawJob, fetchAll } from "./sources/index.js";
import { load, update } from "./store.js";
import type { Eligibility, Job, Profile, SearchPrefs } from "./types.js";

export function titleMatches(title: string, targets: string[]): boolean {
  const t = title.toLowerCase();
  return targets.some((target) =>
    target
      .toLowerCase()
      .split(/[\s/,-]+/)
      .filter((w) => w.length > 1)
      .every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)),
  );
}

export function excluded(title: string, words: string[]): string | null {
  const t = title.toLowerCase();
  return words.find((w) => w.trim() && t.includes(w.trim().toLowerCase())) ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

/** The AI must quote the posting. If its quote isn't really there, we don't trust its verdict. */
export function evidenceIsReal(evidence: string, job: Pick<Job, "location" | "description" | "title">): boolean {
  const e = norm(evidence).replace(/^["']|["']$/g, "");
  if (e.length < 3) return false;
  return norm(`${job.title}\n${job.location}\n${job.description}`).includes(e);
}

export function profileBrief(p: Profile): string {
  const auth = Object.entries(p.workAuth)
    .map(([c, s]) => `${c}: ${s.replace(/_/g, " ")}`)
    .join("; ");
  return [
    `Lives in: ${[p.city, p.country].filter(Boolean).join(", ") || "unknown"} (timezone ${p.timezone || "unknown"})`,
    `Work authorisation: ${auth || "only country of residence"}. Needs sponsorship elsewhere: ${p.needsSponsorship ? "yes" : "no"}. Open to contractor arrangements: ${p.openToContractor ? "yes" : "no"}.`,
    `Headline: ${p.headline}`,
    `Years of experience: ${p.yearsExperience ?? "unknown"}`,
    `Skills: ${p.skills.join(", ")}`,
    `Roles: ${p.experience.map((e) => `${e.title} at ${e.company}`).join("; ")}`,
  ].join("\n");
}

interface Score {
  fit: number;
  why_fit: string;
  eligibility: "eligible" | "ineligible" | "unclear";
  evidence: string;
  reason: string;
  job_type: "full_time" | "contract" | "part_time" | "unknown";
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    fit: { type: "integer", description: "0-100 match between candidate and role" },
    why_fit: { type: "string", description: "One or two plain sentences on why it fits or not" },
    eligibility: { type: "string", enum: ["eligible", "ineligible", "unclear"] },
    evidence: { type: "string", description: "Exact words copied from the posting that decide eligibility, or empty" },
    reason: { type: "string", description: "Short reason for the eligibility verdict" },
    job_type: { type: "string", enum: ["full_time", "contract", "part_time", "unknown"] },
  },
  required: ["fit", "why_fit", "eligibility", "evidence", "reason", "job_type"],
};

export async function scoreJob(llm: LLM, job: Pick<Job, "title" | "company" | "location" | "description">, p: Profile): Promise<Score> {
  return llm.json<Score>({
    schemaName: "job_score",
    schema: SCORE_SCHEMA,
    maxTokens: 4000,
    system:
      "You screen remote job postings for one candidate. Judge two things: (1) fit with their experience, and (2) whether they can legally be hired from where they live. " +
      "A role open worldwide, to their region (e.g. EMEA for Africa), or to contractors anywhere is eligible. A role limited to countries where they lack work authorisation is ineligible. " +
      "If the posting doesn't say, answer unclear. For evidence, copy the exact deciding words from the posting; never paraphrase or invent. " +
      UNTRUSTED_RULE,
    messages: [
      {
        role: "user",
        content: `Candidate:\n${profileBrief(p)}\n\nPosting: ${job.title} at ${job.company}\nLocation field: ${job.location || "(none)"}\n${untrusted("job_posting", job.description, 9000)}`,
      },
    ],
  });
}

export interface SearchProgress {
  running: boolean;
  log: string[];
  found: number;
  skipped: number;
  scored: number;
  errors: string[];
}

export const progress: SearchProgress = { running: false, log: [], found: 0, skipped: 0, scored: 0, errors: [] };

/** Pre-AI filtering. Pure, so it's easy to test. */
export function triage(raw: RawJob, prefs: SearchPrefs, p: Profile, now = Date.now()): { keep: boolean; status?: Job["status"]; reason?: string; eligibility: Eligibility; flags: string[] } {
  const flags: string[] = [];
  const eligibility = checkLocation(raw.location, p, raw.description.slice(0, 3000));
  if (!titleMatches(raw.title, prefs.titles)) return { keep: false, reason: "Title doesn't match", eligibility, flags };
  const ex = excluded(raw.title, prefs.excludeKeywords);
  if (ex) return { keep: false, reason: `Title contains "${ex}"`, eligibility, flags };
  if (raw.postedAt && prefs.maxAgeDays > 0) {
    const age = (now - new Date(raw.postedAt).getTime()) / 86400_000;
    if (age > prefs.maxAgeDays) return { keep: false, reason: `Older than ${prefs.maxAgeDays} days`, eligibility, flags };
  }
  const injected = detectInjection([raw.description, ...raw.hiddenText].join("\n"));
  if (injected.length) flags.push("hidden-instructions");
  if (raw.hiddenText.length) flags.push("hidden-text");
  if (isNeverApply(raw.company, p.neverApply)) return { keep: true, status: "skipped", reason: "On your never-apply list", eligibility, flags };
  if (eligibility.verdict === "ineligible") return { keep: true, status: "skipped", reason: eligibility.reason, eligibility, flags };
  const screening = detectAiScreening(raw.description);
  if (screening) {
    flags.push("ai-screening");
    return { keep: true, status: "do_it_yourself", reason: `The posting says it screens out AI-assisted applications: "${screening.slice(0, 160)}"`, eligibility, flags };
  }
  if (raw.needsLogin) return { keep: true, status: "do_it_yourself", reason: "This site needs an account to apply. JobPilot never creates accounts or signs in.", eligibility, flags };
  return { keep: true, status: "found", eligibility, flags };
}

export async function runSearch(llm: LLM | null): Promise<void> {
  if (progress.running) return;
  Object.assign(progress, { running: true, log: [], found: 0, skipped: 0, scored: 0, errors: [] });
  const say = (m: string) => {
    progress.log.push(m);
    if (progress.log.length > 300) progress.log.shift();
  };
  try {
    const { search: prefs, profile: p, jobs: existing } = load();
    say("Fetching postings from public sources…");
    const { jobs: raws, errors } = await fetchAll(prefs, say);
    progress.errors = errors;
    const seen = new Set<string>();
    const fresh = raws.filter((r) => {
      const key = `${r.company.toLowerCase()}|${r.title.toLowerCase()}`;
      if (seen.has(key) || existing[r.id]) return false;
      seen.add(key);
      return true;
    });
    say(`${raws.length} postings fetched, ${fresh.length} new. Filtering…`);

    const now = new Date().toISOString();
    const toScore: Job[] = [];
    for (const r of fresh) {
      const t = triage(r, prefs, p);
      if (!t.keep) continue;
      const { hiddenText: _h, ...rest } = r;
      const job: Job = { ...rest, flags: t.flags, eligibility: t.eligibility, status: t.status ?? "found", statusReason: t.reason, statusDate: now, foundAt: now };
      if (job.status === "found") toScore.push(job);
      else progress.skipped += job.status === "skipped" ? 1 : 0;
      update((s) => void (s.jobs[job.id] = job));
    }
    say(`${toScore.length} jobs passed the filters.`);

    if (!llm) {
      say("No AI model set up, so jobs weren't scored. Add your key in Settings to score fit and eligibility.");
      progress.found = toScore.length;
      return;
    }
    // Most promising first: clearly eligible before unclear.
    toScore.sort((a, b) => (a.eligibility?.verdict === "eligible" ? 0 : 1) - (b.eligibility?.verdict === "eligible" ? 0 : 1));
    const batch = toScore.slice(0, prefs.maxToScore);
    let i = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (i < batch.length) {
          const job = batch[i++];
          try {
            const s = await scoreJob(llm, job, p);
            progress.scored++;
            applyScore(job, s);
            if (job.status === "found") progress.found++;
            else progress.skipped++;
            say(`${job.company} — ${job.title}: fit ${job.fit}, ${job.eligibility?.verdict}`);
          } catch (e) {
            say(`Couldn't score ${job.company} — ${job.title}: ${(e as Error).message}`);
            if ((e as { kind?: string }).kind === "auth") throw e;
          }
          update((st) => void (st.jobs[job.id] = job));
        }
      }),
    );
    if (toScore.length > batch.length) say(`${toScore.length - batch.length} more jobs were left unscored (limit ${prefs.maxToScore} per search).`);
    say("Done.");
  } catch (e) {
    say(`Search stopped: ${(e as Error).message}`);
    progress.errors.push((e as Error).message);
  } finally {
    progress.running = false;
  }
}

/** Merge the AI verdict with the rule-based one. A rule-based "ineligible" never becomes eligible. */
export function applyScore(job: Job, s: Score): void {
  job.fit = Math.max(0, Math.min(100, Math.round(s.fit)));
  job.whyFit = s.why_fit;
  const real = s.evidence ? evidenceIsReal(s.evidence, job) : false;
  const rule = job.eligibility;
  if (rule?.verdict === "ineligible") {
    // Rule-based "ineligible" stands, whatever the AI says.
  } else if (s.eligibility === "ineligible" && real) {
    job.eligibility = { verdict: "ineligible", reason: s.reason, evidence: s.evidence };
  } else if (s.eligibility === "eligible" && real) {
    job.eligibility = { verdict: "eligible", reason: s.reason, evidence: s.evidence };
  } else if (rule?.verdict !== "eligible") {
    job.eligibility = { verdict: "unclear", reason: real || !s.evidence ? s.reason : `${s.reason} (AI quote not found in posting, so not trusted)`, evidence: rule?.evidence ?? job.location };
  }
  if (job.eligibility?.verdict === "ineligible") {
    job.status = "skipped";
    job.statusReason = job.eligibility.reason;
  } else if (job.fit < 35) {
    job.status = "skipped";
    job.statusReason = `Weak fit (${job.fit}/100): ${s.why_fit}`;
  }
}
