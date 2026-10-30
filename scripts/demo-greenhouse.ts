// Demo: fill a REAL public Greenhouse application form with a FICTIONAL sample profile, and stop before submit.
//
//   npm run demo                      # opens a visible browser, fills the form, leaves it open for you to look at
//   npm run demo -- --headless        # same, no window (saves a screenshot)
//   npm run demo -- --board canonical    # pick the Greenhouse board to take a posting from
//
// If an API key is set in the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or XAI_API_KEY),
// free-text questions are answered by that model. Without one, only profile-mapped fields are filled.
// Nothing is ever submitted: the demo runs with dryRun.

import fs from "node:fs";
import path from "node:path";

process.env.YOUHIRED_DATA_DIR = path.resolve("data/demo");
const args = process.argv.slice(2);
const headless = args.includes("--headless");
const board = args[args.indexOf("--board") + 1] && args.includes("--board") ? args[args.indexOf("--board") + 1] : "canonical";

const { defaultProfile } = await import("../server/store.js");
const { greenhouse } = await import("../server/sources/index.js");
const { prepare, logs, shotPath } = await import("../server/apply/runner.js");
const { closeBrowser } = await import("../server/apply/browser.js");
const { makeLLM } = await import("../server/providers/index.js");
const { checkLocation } = await import("../server/eligibility.js");

/** A tiny valid one-page PDF, so the demo has a CV to upload. */
function samplePdf(lines: string[]): Buffer {
  const content = `BT /F1 11 Tf 50 780 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) '`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const cvLines = [
  "Ada Example - Product Designer",
  "Lagos, Nigeria - ada.example@example.com",
  "",
  "Experience",
  "Senior Product Designer, Sample Fintech Ltd (2021 - present)",
  "- Led design of the mobile onboarding flow and the design system.",
  "Product Designer, Demo Studio (2018 - 2021)",
  "- Designed web dashboards for B2B clients; ran usability tests.",
  "",
  "Skills: Figma, prototyping, user research, design systems, accessibility",
  "Education: BSc Computer Science, University of Lagos (2017)",
];

const profile = {
  ...defaultProfile(),
  legalName: "Ada Example",
  preferredName: "Ada",
  email: "ada.example@example.com",
  phone: "+234 800 000 0000",
  country: "Nigeria",
  city: "Lagos",
  timezone: "UTC+1",
  workAuth: { Nigeria: "citizen" as const, "United States": "not_authorized" as const, "United Kingdom": "not_authorized" as const },
  needsSponsorship: true,
  noticePeriod: "4 weeks",
  links: { portfolio: "https://example.com/portfolio", linkedin: "https://www.linkedin.com/in/example", github: "", website: "" },
  headline: "Product designer, 7 years in fintech and B2B SaaS",
  summary: "Product designer focused on onboarding, design systems and research-led iteration.",
  yearsExperience: 7,
  skills: ["Figma", "Prototyping", "User research", "Design systems", "Accessibility"],
  experience: [
    { company: "Sample Fintech Ltd", title: "Senior Product Designer", start: "2021", end: "present", highlights: ["Led design of the mobile onboarding flow and the design system."] },
    { company: "Demo Studio", title: "Product Designer", start: "2018", end: "2021", highlights: ["Designed web dashboards for B2B clients; ran usability tests."] },
  ],
  education: [{ school: "University of Lagos", degree: "BSc Computer Science", year: "2017" }],
  cvText: cvLines.join("\n"),
  cvFileName: "ada-example-cv.pdf",
  confirmed: true,
};

const cvFile = path.resolve("data/demo/cv/ada-example-cv.pdf");
fs.mkdirSync(path.dirname(cvFile), { recursive: true });
fs.writeFileSync(cvFile, samplePdf(cvLines));

function envLLM() {
  const pick: [string | undefined, Parameters<typeof makeLLM>[0]["provider"], string][] = [
    [process.env.ANTHROPIC_API_KEY, "anthropic", "claude-sonnet-5-5"],
    [process.env.OPENAI_API_KEY, "openai", "gpt-6.1-sol"],
    [process.env.GEMINI_API_KEY, "gemini", "gemini-3.8-flash"],
    [process.env.XAI_API_KEY, "xai", "grok-4.7"],
  ];
  const hit = pick.find(([k]) => k);
  return hit ? makeLLM({ provider: hit[1], apiKey: hit[0]!, model: process.env.YOUHIRED_MODEL || hit[2] }) : null;
}

const llm = envLLM();
console.log(llm ? `Answering free-text questions with ${llm.provider}/${llm.model}` : "No API key in env: filling profile fields only.");

// Try eligible postings (remote, open to Nigeria) until one has a form YouHired may fill.
// Postings whose page says it rejects AI-assisted applications are skipped, as the real app does.
const boards = args.includes("--board") ? [board] : [board, "automatticcareers", "grafanalabs", "wikimedia", "elastic", "gitlab"];
type Prepared = Awaited<ReturnType<typeof prepare>>;
let result: Prepared | null = null;
let job: Prepared | null = null;
outer: for (const b of boards) {
  console.log(`Fetching postings from the public "${b}" Greenhouse board…`);
  const jobs = await greenhouse(b).catch(() => []);
  // Clearly eligible first, then "Remote" postings that don't say where (fine for a no-submit demo).
  const verdict = (j: (typeof jobs)[number]) => checkLocation(j.location, profile).verdict;
  const eligible = [...jobs.filter((j) => verdict(j) === "eligible").slice(0, 2), ...jobs.filter((j) => verdict(j) === "unclear").slice(0, 1)];
  for (const pick of eligible) {
    const { hiddenText: _h, ...rest } = pick;
    const now = new Date().toISOString();
    job = { ...rest, flags: [], status: "found" as const, statusDate: now, foundAt: now };
    console.log(`\nTrying: ${pick.title} (${pick.location})\n${pick.applyUrl}`);
    result = await prepare(job, llm, { autoSubmit: false, dryRun: true, fillEvenIfPending: true, channel: "chrome", headless, profileOverride: profile, cvOverride: cvFile });
    if (result.status !== "do_it_yourself") break outer;
    console.log(`→ Do it yourself: ${result.statusReason}`);
  }
}
if (!result || !job) throw new Error("No eligible posting found on the demo boards.");

console.log("\n— Log —");
for (const l of logs.get(job.id) ?? []) console.log(l);
console.log(`\nStatus: ${result.status} — ${result.statusReason ?? ""}`);
console.log("\n— Filled —");
for (const a of result.answers ?? []) console.log(`• ${a.label}: ${a.value.slice(0, 90)}${a.value.length > 90 ? "…" : ""}   [${a.source}]`);
if (result.pending?.length) {
  console.log("\n— Left for you —");
  for (const q of result.pending) console.log(`• ${q.label}${q.hint ? ` (${q.hint})` : ""}`);
}
console.log(`\nScreenshot: ${shotPath(job.id)}`);
console.log("NOT submitted (demo).");
if (headless) await closeBrowser();
else console.log("The browser stays open so you can look. Close it (or press Ctrl+C) when done.");
