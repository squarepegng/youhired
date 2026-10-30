// Dry run of the AI browser agent on any job link, with the FICTIONAL demo candidate. Never submits.
//   npx tsx scripts/demo-agent.ts <job url> [--headless]
// Uses the AI provider/key saved in the app (data/store.json) unless ANTHROPIC_API_KEY etc. are set.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a));
if (!url) throw new Error("Pass a job URL");
const headless = args.includes("--headless");
const appSettings = JSON.parse(fs.readFileSync("data/store.json", "utf8")).settings;
process.env.YOUHIRED_DATA_DIR = path.resolve("data/demo");

const { defaultProfile } = await import("../server/store.js");
const { prepare, logs, shotPath } = await import("../server/apply/runner.js");
const { closeBrowser } = await import("../server/apply/browser.js");
const { makeLLM } = await import("../server/providers/index.js");
const { detectAts, hostNeedsLogin } = await import("../server/guardrails.js");

const cv = path.resolve("data/demo/cv/ada-example-cv.pdf");
if (!fs.existsSync(cv)) throw new Error("Run `npm run demo -- --headless` once first to create the sample CV.");
const profile = {
  ...defaultProfile(),
  legalName: "Ada Example", preferredName: "Ada", email: "ada.example@example.com", phone: "+234 800 000 0000",
  country: "Nigeria", city: "Lagos", timezone: "UTC+1",
  workAuth: { Nigeria: "citizen" as const, "United States": "not_authorized" as const },
  noticePeriod: "4 weeks", links: { portfolio: "https://example.com/portfolio", linkedin: "https://www.linkedin.com/in/example", github: "", website: "" },
  headline: "Product designer, 7 years in fintech and B2B SaaS", yearsExperience: 7,
  skills: ["Figma", "Prototyping", "User research", "Design systems"],
  experience: [{ company: "Sample Fintech Ltd", title: "Senior Product Designer", start: "2021", end: "present", highlights: ["Led design of the mobile onboarding flow and the design system."] }],
  cvText: "Ada Example - Product Designer. Senior Product Designer, Sample Fintech Ltd (2021 - present): led onboarding and design system. Product Designer, Demo Studio (2018-2021). Skills: Figma, prototyping, research.",
  cvFileName: "ada-example-cv.pdf", confirmed: true,
};
const now = new Date().toISOString();
const job = { id: "demo:agent", source: "wwr" as const, company: "Demo", title: "Product Designer", url, applyUrl: url, location: "", description: "", ats: detectAts(url), needsLogin: hostNeedsLogin(url), flags: [], status: "found" as const, statusDate: now, foundAt: now };
const llm = makeLLM(appSettings);
console.log(`Agent dry run with ${llm.provider}/${llm.model} on ${url}`);
const r = await prepare(job, llm, { autoSubmit: false, dryRun: true, channel: "chrome", headless, profileOverride: profile, cvOverride: cv });
for (const l of logs.get(job.id) ?? []) console.log(l);
console.log(`\nStatus: ${r.status} — ${r.statusReason ?? ""}`);
for (const a of r.answers ?? []) console.log(`• ${a.label.slice(0, 70)}: ${a.value.slice(0, 80)} [${a.source}]`);
for (const q of r.pending ?? []) console.log(`? ${q.label}`);
console.log(`Screenshot: ${shotPath(job.id)}\nNOT submitted.`);
await closeBrowser();
