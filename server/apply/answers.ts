// AI-written answers for free-text and judgement questions. Grounded ONLY in the user's profile/CV.
// Every answer is checked afterwards: invented numbers or planted code words → rewrite once, then ask the user.

import { UNTRUSTED_RULE, containsPlantedWord, detectInjection, inventedNumbers, untrusted } from "../guardrails.js";
import type { LLM } from "../providers/types.js";
import type { Job, Profile } from "../types.js";
import type { Mapped } from "./mapper.js";

export interface AiAnswer {
  id: string;
  answer: string;
  can_answer: boolean;
  basis: string; // which CV/profile fact supports it
  question_for_user: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          answer: { type: "string" },
          can_answer: { type: "boolean" },
          basis: { type: "string" },
          question_for_user: { type: "string" },
        },
        required: ["id", "answer", "can_answer", "basis", "question_for_user"],
      },
    },
    cover_note: { type: "string" },
  },
  required: ["answers", "cover_note"],
};

/** Everything JobPilot knows about you from your own documents: CV, LinkedIn export, portfolio site. */
export function knowledge(p: Profile, max = 30000): string {
  return [
    p.cvText ? `<cv>\n${p.cvText}\n</cv>` : "",
    p.linkedinText ? `<linkedin_profile>\n${p.linkedinText}\n</linkedin_profile>` : "",
    p.portfolioText ? `<portfolio_site>\n${p.portfolioText}\n</portfolio_site>` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, max);
}

export function groundTruth(p: Profile): string {
  const { savedAnswers, cvText, linkedinText, portfolioText, ...rest } = p;
  void savedAnswers;
  void cvText;
  void linkedinText;
  void portfolioText;
  return `${JSON.stringify(rest)}\n${knowledge(p, 200000)}\n${p.savedAnswers.map((s) => `${s.question}: ${s.answer}`).join("\n")}`;
}

const SYSTEM = [
  "You fill in job application questions for one candidate, in their voice (first person, plain and warm, no clichés, no em dashes).",
  "Use ONLY facts from the candidate's profile, CV, LinkedIn and portfolio below. Never invent employers, projects, tools, metrics, numbers, dates or experience.",
  "If a question asks about something the CV doesn't clearly show (e.g. 'Have you used a crypto wallet?', 'Have you shipped React Native?', years with a specific tool), set can_answer=false, leave answer empty and write question_for_user as a short plain question to the candidate.",
  "Never answer questions about location, work authorisation, visas, salary, age, criminal record or demographics; set can_answer=false for those.",
  "For questions with options, the answer must be exactly one of the options (or for multi-select, options joined by ' | ').",
  "Keep free-text answers under 120 words unless the question asks for more. Make them specific to this company and role using the posting, but only claim what the CV supports.",
  "cover_note: 120-180 words, for this role, grounded in the CV. No placeholders.",
  UNTRUSTED_RULE,
].join("\n");

function describe(m: Mapped): string {
  const f = m.field;
  return JSON.stringify({ id: f.id, question: f.label, type: f.kind, required: f.required, options: f.options.length ? f.options : undefined });
}

export async function writeAnswers(
  llm: LLM,
  p: Profile,
  job: Pick<Job, "title" | "company" | "description">,
  fields: Mapped[],
  feedback = "",
): Promise<{ answers: AiAnswer[]; coverNote: string }> {
  const res = await llm.json<{ answers: AiAnswer[]; cover_note: string }>({
    schemaName: "application_answers",
    schema: SCHEMA,
    maxTokens: 12000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Candidate profile (trusted):\n${JSON.stringify({ name: p.preferredName || p.legalName, headline: p.headline, summary: p.summary, years: p.yearsExperience, skills: p.skills, experience: p.experience, education: p.education, links: p.links })}`,
          `The candidate's own documents (trusted):\n${knowledge(p)}`,
          p.savedAnswers.length ? `Answers the candidate gave before (trusted):\n${p.savedAnswers.map((s) => `- ${s.question}: ${s.answer}`).join("\n")}` : "",
          `Role: ${job.title} at ${job.company}`,
          untrusted("job_posting", job.description, 8000),
          `Questions to answer:\n${fields.map(describe).join("\n")}`,
          feedback,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });
  return { answers: res.answers ?? [], coverNote: res.cover_note ?? "" };
}

export interface CheckedAnswers {
  answers: Map<string, { value: string; basis: string }>;
  needUser: Map<string, string>; // id → question for the user
  coverNote: string;
  warnings: string[];
}

/** Write, check, rewrite once if needed. Anything still failing goes to the user. */
export async function answerWithChecks(llm: LLM, p: Profile, job: Job, fields: Mapped[], pageUntrusted = ""): Promise<CheckedAnswers> {
  const truth = `${groundTruth(p)}\n${job.description}\n${job.title}\n${job.company}`;
  const planted = detectInjection(`${job.description}\n${pageUntrusted}`).flatMap((f) => f.plantedWords);
  const out: CheckedAnswers = { answers: new Map(), needUser: new Map(), coverNote: "", warnings: [] };
  let pending = fields;
  let feedback = "";
  for (let round = 0; round < 2 && pending.length; round++) {
    const { answers, coverNote } = await writeAnswers(llm, p, job, pending, feedback);
    const byId = new Map(answers.map((a) => [a.id, a]));
    const problems: string[] = [];
    const retry: Mapped[] = [];
    const coverIssues = [...inventedNumbers(coverNote, truth).map((n) => `number "${n}"`), ...containsPlantedWord(coverNote, planted).map((w) => `word "${w}"`)];
    if (!out.coverNote || coverIssues.length === 0) out.coverNote = coverIssues.length ? "" : coverNote;
    if (coverIssues.length) problems.push(`cover_note contains ${coverIssues.join(", ")} not supported by the CV; remove them.`);
    for (const m of pending) {
      const a = byId.get(m.field.id);
      if (!a || !a.can_answer || !a.answer.trim()) {
        out.needUser.set(m.field.id, a?.question_for_user || m.field.label);
        continue;
      }
      if (m.field.options.length) {
        const parts = a.answer.split(" | ").map((s) => s.trim());
        if (!parts.every((x) => m.field.options.some((o) => o.trim().toLowerCase() === x.toLowerCase()))) {
          problems.push(`Answer for ${m.field.id} must be exactly one of: ${m.field.options.join(" / ")}.`);
          retry.push(m);
          continue;
        }
      }
      const bad = [...inventedNumbers(a.answer, truth).map((n) => `number "${n}"`), ...containsPlantedWord(a.answer, planted).map((w) => `word "${w}"`)];
      if (bad.length) {
        problems.push(`Answer for ${m.field.id} contains ${bad.join(", ")} that the CV doesn't support. Rewrite without it.`);
        retry.push(m);
        continue;
      }
      out.answers.set(m.field.id, { value: a.answer.trim(), basis: a.basis });
      out.needUser.delete(m.field.id);
    }
    if (!problems.length) break;
    out.warnings.push(...problems);
    feedback = `Fix these problems from your previous attempt:\n${problems.join("\n")}`;
    pending = round === 0 ? retry : [];
    if (round === 1) for (const m of retry) out.needUser.set(m.field.id, m.field.label);
  }
  if (!out.coverNote) out.warnings.push("Cover note failed the checks; none will be used.");
  return out;
}

/**
 * Draft answers for open questions the candidate has to approve (e.g. employers that ban AI-written answers).
 * Drafts are grounded in the candidate's documents and checked like any other answer; they are only sent
 * after the candidate approves them.
 */
export async function draftPending(llm: LLM, p: Profile, job: Job, pending: { fieldId: string; label: string; options?: string[]; draft?: string }[]): Promise<void> {
  const open = pending.filter((q) => !q.options?.length);
  if (!open.length) return;
  const fields: Mapped[] = open.map((q) => ({ field: { id: q.fieldId, frame: 0, kind: "textarea", label: q.label, name: "", required: true, options: [], value: "" }, value: null, source: "ai", need: "ai" }));
  try {
    const res = await answerWithChecks(llm, p, job, fields);
    for (const q of open) {
      const a = res.answers.get(q.fieldId);
      if (a) q.draft = a.value;
    }
  } catch {
    /* drafts are a convenience; the questions still stand */
  }
}
