// A CV tailored to each job: same facts, reordered and re-emphasised for the role, rendered to an
// ATS-friendly PDF (single column, real text, standard headings). Idea from career-ops (MIT).
//
// Fact check, in code: every employer and job title must already appear in your documents, and every
// number (metrics, years, team sizes) must too. If the tailored version fails, your original CV is used.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { groundTruth, knowledge } from "./apply/answers.js";
import { UNTRUSTED_RULE, inventedNumbers, untrusted } from "./guardrails.js";
import type { LLM } from "./providers/types.js";
import { DATA_DIR, load } from "./store.js";
import type { Job, Profile } from "./types.js";

interface TailoredCv {
  headline: string;
  summary: string;
  skills: string[];
  experience: { company: string; title: string; dates: string; location: string; bullets: string[] }[];
  education: { school: string; degree: string; year: string }[];
  extras: string[]; // certifications, awards, languages — only if in the documents
}

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string", description: "3-4 sentences, first person implied, tuned to this role" },
    skills: { type: "array", items: { type: "string" }, description: "Most relevant first, max 14" },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: { company: { type: "string" }, title: { type: "string" }, dates: { type: "string" }, location: { type: "string" }, bullets: { type: "array", items: { type: "string" } } },
        required: ["company", "title", "dates", "location", "bullets"],
      },
    },
    education: { type: "array", items: { type: "object", properties: { school: { type: "string" }, degree: { type: "string" }, year: { type: "string" } }, required: ["school", "degree", "year"] } },
    extras: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "summary", "skills", "experience", "education", "extras"],
};

const SYSTEM = [
  "You tailor a candidate's CV to one job. Rewrite for relevance, never for invention.",
  "Use ONLY facts in the candidate's documents. Keep every employer, job title and date exactly as written. Do not add employers, titles, tools, degrees, certifications or numbers that aren't there.",
  "You may: reorder sections and bullets, lead with the most relevant work, merge or tighten bullets, mirror the job's wording where it truthfully describes what they did, drop irrelevant old detail.",
  "Bullets: start with a strong verb, one line each when possible, 3-6 per recent role, fewer for older roles. Keep every number exactly as it appears in the documents.",
  UNTRUSTED_RULE,
].join("\n");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Problems that make a tailored CV unusable. Empty = it passes. */
export function checkTailored(cv: TailoredCv, p: Profile): string[] {
  const truth = groundTruth(p);
  const t = norm(truth);
  const problems: string[] = [];
  for (const e of cv.experience) {
    if (e.company && !t.includes(norm(e.company))) problems.push(`employer "${e.company}" isn't in your documents`);
    if (e.title && !t.includes(norm(e.title))) problems.push(`title "${e.title}" isn't in your documents`);
  }
  for (const ed of cv.education) if (ed.school && !t.includes(norm(ed.school))) problems.push(`school "${ed.school}" isn't in your documents`);
  const all = [cv.headline, cv.summary, ...cv.skills, ...cv.extras, ...cv.experience.flatMap((e) => e.bullets)].join("\n");
  for (const n of inventedNumbers(all, truth)) problems.push(`number "${n}" isn't in your documents`);
  return problems;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderCvHtml(cv: TailoredCv, p: Profile): string {
  const contact = [p.email, p.phone, [p.city, p.country].filter(Boolean).join(", "), p.links.portfolio, p.links.linkedin, p.links.github].filter(Boolean).map(esc).join(" · ");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.legalName)} CV</title><style>
  @page { size: A4; margin: 16mm 16mm 16mm 16mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 10.3pt; line-height: 1.38; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: -0.2px; }
  .headline { font-size: 11pt; color: #333; margin-bottom: 4px; }
  .contact { font-size: 9pt; color: #444; margin-bottom: 12px; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 1px solid #bbb; padding-bottom: 2px; margin: 14px 0 6px; }
  .role { margin-bottom: 8px; page-break-inside: avoid; }
  .role .top { display: flex; justify-content: space-between; gap: 12px; }
  .role b { font-size: 10.5pt; }
  .muted { color: #555; }
  ul { margin: 3px 0 0; padding-left: 16px; }
  li { margin: 1px 0; }
  .skills { margin: 0; }
  </style></head><body>
  <h1>${esc(p.legalName)}</h1>
  <div class="headline">${esc(cv.headline)}</div>
  <div class="contact">${contact}</div>
  <h2>Summary</h2><p style="margin:0">${esc(cv.summary)}</p>
  <h2>Experience</h2>
  ${cv.experience
    .map(
      (e) => `<div class="role"><div class="top"><span><b>${esc(e.title)}</b>, ${esc(e.company)}${e.location ? ` <span class="muted">· ${esc(e.location)}</span>` : ""}</span><span class="muted">${esc(e.dates)}</span></div>
    <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`,
    )
    .join("")}
  <h2>Skills</h2><p class="skills">${cv.skills.map(esc).join(" · ")}</p>
  ${cv.education.length ? `<h2>Education</h2>${cv.education.map((e) => `<div>${esc(e.degree)}, ${esc(e.school)}${e.year ? ` <span class="muted">· ${esc(e.year)}</span>` : ""}</div>`).join("")}` : ""}
  ${cv.extras.length ? `<h2>Also</h2><ul>${cv.extras.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  </body></html>`;
}

export function tailoredPath(job: Pick<Job, "id">, p: Profile): string {
  const dir = path.join(DATA_DIR, "cv", "tailored", job.id.replace(/[^\w-]/g, "_"));
  const name = `${(p.legalName || "CV").replace(/[^\w]+/g, "_")}_CV.pdf`;
  return path.join(dir, name);
}

/** Tailor and render. Returns the PDF path, or null to fall back to the original CV. */
export async function tailorCv(llm: LLM, p: Profile, job: Job, log: (m: string) => void): Promise<string | null> {
  if (!p.cvText) return null;
  let feedback = "";
  for (let round = 0; round < 2; round++) {
    const cv = await llm.json<TailoredCv>({
      schemaName: "tailored_cv",
      schema: SCHEMA,
      maxTokens: 8000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Candidate: ${p.legalName}. Headline: ${p.headline}`,
            `The candidate's documents (trusted, the only source of facts):\n${knowledge(p, 40000)}`,
            p.stories?.length ? `Their story bank (trusted):\n${p.stories.map((s) => `- ${s.title}: ${s.action} → ${s.result}`).join("\n")}` : "",
            `Target job: ${job.title} at ${job.company}`,
            untrusted("job_posting", job.description, 7000),
            feedback,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    const problems = checkTailored(cv, p);
    if (problems.length) {
      log(`Tailored CV failed the fact check (${problems.slice(0, 3).join("; ")})${round === 0 ? ", rewriting" : ", using your original CV"}`);
      feedback = `Your previous version had problems. Fix them by using only what's in the documents: ${problems.join("; ")}.`;
      continue;
    }
    const out = tailoredPath(job, p);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const browser = await chromium.launch({ channel: load().settings.browserChannel === "chromium" ? undefined : load().settings.browserChannel, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(renderCvHtml(cv, p), { waitUntil: "load" });
      await page.pdf({ path: out, format: "A4", printBackground: true });
    } finally {
      await browser.close();
    }
    fs.writeFileSync(out.replace(/\.pdf$/, ".json"), JSON.stringify(cv, null, 2));
    return out;
  }
  return null;
}
