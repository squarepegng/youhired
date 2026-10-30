// Demo mode: the full YouHired interface running on sample data, entirely in the browser.
// Used for the public website so anyone can try the app without installing it. Nothing here
// touches a real job site, API key or person: the candidate and companies are fictional.

import type { AppState, Job, Profile } from "./types";

const now = Date.now();
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();

const profile: Profile = {
  legalName: "Ada Okafor",
  preferredName: "Ada",
  email: "ada@example.com",
  phone: "+234 800 000 0000",
  country: "Nigeria",
  city: "Lagos",
  timezone: "UTC+1",
  workAuth: { Nigeria: "citizen", "United States": "not_authorized", "United Kingdom": "not_authorized" },
  needsSponsorship: true,
  openToContractor: true,
  salary: { leaveBlankIfOptional: true, usePostedMinimum: true, defaultAmount: 60000, currency: "USD", period: "year", textAnswer: "Open to discussing, flexible within the range for this role." },
  noticePeriod: "4 weeks",
  links: { portfolio: "https://example.com/ada", linkedin: "https://linkedin.com/in/example", github: "", website: "" },
  eeo: { gender: "Decline to self-identify", race: "Decline to self-identify", veteran: "I don't wish to answer", disability: "I don't wish to answer" },
  neverApply: [],
  pronouns: "",
  headline: "Senior product designer, 7 years in fintech and B2B SaaS",
  summary: "Product designer who ships end-to-end: research, design systems, and prototypes in code. Led onboarding and payments work used by millions.",
  yearsExperience: 7,
  skills: ["Figma", "Design systems", "User research", "Prototyping in code", "AI product design", "Accessibility"],
  experience: [
    { company: "Kora Pay", title: "Senior Product Designer", start: "2022", end: "present", highlights: ["Redesigned onboarding, cutting drop-off by 20%.", "Built and led the Kora design system."] },
    { company: "Brightpath Studio", title: "Product Designer", start: "2018", end: "2022", highlights: ["Designed dashboards for B2B clients across 4 countries."] },
  ],
  education: [{ school: "University of Lagos", degree: "BSc Computer Science", year: "2017" }],
  savedAnswers: [{ question: "Are you at least 18 years old?", answer: "Yes" }],
  cvFileName: "Ada_Okafor_CV.pdf",
  cvText: "(sample CV)",
  linkedinText: "(sample LinkedIn export)",
  portfolioText: "(sample portfolio)",
  currentCompensation: "",
  stories: [
    { title: "Rebuilt onboarding at Kora Pay", situation: "New merchants dropped off during KYC.", action: "Ran interviews, cut steps from 9 to 5, and prototyped in code.", result: "Drop-off fell by 20%.", tags: ["impact", "research"] },
    { title: "Created the Kora design system", situation: "Four squads shipped inconsistent UI.", action: "Audited components and built a shared library with engineering.", result: "Adopted by every squad within a quarter.", tags: ["design systems", "leadership"] },
  ],
  confirmed: true,
};

const job = (j: Partial<Job> & Pick<Job, "id" | "company" | "title" | "status">): Job => ({
  source: "greenhouse",
  url: "https://example.com/job",
  applyUrl: "https://example.com/job/apply",
  location: "Remote — Worldwide",
  description:
    "We're a remote-first team building tools for small businesses across Africa and Europe. You'll own product design end to end: discovery, flows, high-fidelity design and working with engineers to ship.\n\nWhat you'll do\n• Lead design for a core product area\n• Grow our design system\n• Run research with customers\n\nWhat you bring\n• 5+ years of product design\n• Strong systems thinking\n• Comfortable prototyping\n\n(This is a sample posting for the YouHired demo.)",
  ats: "greenhouse",
  needsLogin: false,
  flags: [],
  statusDate: ago(30),
  foundAt: ago(300),
  eligibility: { verdict: "eligible", reason: "Open worldwide.", evidence: "Remote — Worldwide" },
  ...j,
});

let jobs: Job[] = [
  job({
    id: "demo:1",
    company: "Northwind Labs",
    title: "Senior Product Designer",
    status: "needs_answer",
    fit: 94,
    whyFit: "Senior product design across onboarding and design systems: a direct match for your Kora Pay work.",
    statusReason: "1 question only you can answer",
    eligibility: { verdict: "eligible", reason: "Open to EMEA, which includes Nigeria.", evidence: "Remote (EMEA)" },
    location: "Remote (EMEA)",
    pending: [
      { fieldId: "q1", label: "Tell us about a product you shipped that you're proud of.", required: true, draft: "At Kora Pay I rebuilt merchant onboarding: I interviewed new merchants, cut the KYC flow from 9 steps to 5 and prototyped it in code before engineering started. Drop-off fell by 20%. [add a link to the case study]" },
      { fieldId: "q2", label: "Have you designed for a crypto wallet?", required: true, options: ["Yes", "No"] },
    ],
  }),
  job({
    id: "demo:2",
    company: "Fernhill AI",
    title: "Product Designer, AI Assistant",
    status: "filled",
    fit: 88,
    whyFit: "AI product design and prototyping in code, both strengths on your CV.",
    statusReason: "Filled in a tab of your Chrome. Check it, then press Submit.",
    tailoredCv: true,
    hasSession: true,
    answers: [
      { label: "Full name", value: "Ada Okafor", source: "profile" },
      { label: "Email", value: "ada@example.com", source: "profile" },
      { label: "Location", value: "Lagos, Nigeria", source: "profile" },
      { label: "Are you legally authorized to work in the country where you reside?", value: "Yes", source: "rule · You're authorised there" },
      { label: "Resume", value: "(your CV)", source: "cv-file" },
      { label: "Why Fernhill?", value: "I design AI products the way users meet them: through flows that show what the assistant is doing and let people stay in control. At Kora Pay I prototyped in code to test complex states early, which is how I'd approach your assistant.", source: "ai · From your CV and portfolio" },
      { label: "Gender", value: "Decline to self-identify", source: "rule · EEO default" },
    ],
  }),
  job({ id: "demo:3", company: "Lumen Health", title: "Lead Product Designer", status: "found", fit: 86, whyFit: "Leadership plus design systems; asks for 8 years (you have 7).", location: "Remote — Africa, Europe", eligibility: { verdict: "eligible", reason: "Open to Africa.", evidence: "Remote — Africa, Europe" } }),
  job({ id: "demo:4", company: "Atlas Robotics", title: "Product Designer", status: "found", fit: 78, whyFit: "Strong UI and research match; robotics domain is new for you.", location: "Remote", eligibility: { verdict: "unclear", reason: "Says remote but not where.", evidence: "Remote" } }),
  job({ id: "demo:5", company: "Juniper Studio", title: "UX Designer (Contract)", status: "found", fit: 72, whyFit: "Contract role open to contractors anywhere.", location: "Contractors anywhere", eligibility: { verdict: "eligible", reason: "Contractors accepted worldwide.", evidence: "Contractors anywhere" } }),
  job({ id: "demo:6", company: "Brightwave", title: "Senior UX Designer", status: "applied", fit: 90, whyFit: "Senior UX, fintech: close match.", statusReason: "Confirmation page shown", statusDate: ago(1440), answers: [{ label: "Full name", value: "Ada Okafor", source: "profile" }, { label: "Resume", value: "(your CV)", source: "cv-file" }] }),
  job({ id: "demo:7", company: "Polar Commerce", title: "Product Designer", status: "do_it_yourself", fit: 80, statusReason: "The page says: \"Applications generated by AI will be disqualified.\" Your answers are drafted for you to make your own." }),
  job({ id: "demo:8", company: "Cobalt Systems", title: "Senior Product Designer", status: "skipped", fit: 85, statusReason: "Limited to United States; you are in Nigeria without work authorisation there.", location: "Remote, United States", eligibility: { verdict: "ineligible", reason: "Limited to United States; you are in Nigeria without work authorisation there.", evidence: "Remote, United States" } }),
  job({ id: "demo:9", company: "Harbor Labs", title: "Product Designer", status: "skipped", fit: 77, statusReason: "On-site or hybrid role, not remote.", location: "On-site — London", eligibility: { verdict: "ineligible", reason: "On-site or hybrid role, not remote.", evidence: "On-site — London" } }),
];

const state = (): AppState => ({
  settings: { provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-a••••demo", hasKey: true, baseUrl: "", autoSubmit: false, browserChannel: "chrome", background: false, tailorCv: true, useMyChrome: true },
  profile,
  search: {
    brief: "Senior product design roles at fintech or B2B SaaS companies that hire in Africa or EMEA.",
    titles: ["product designer", "ux designer"],
    excludeKeywords: ["intern"],
    jobTypes: ["full_time", "contract"],
    sources: { greenhouse: true, lever: true, ashby: true, remotive: false, remoteok: true, himalayas: true, wwr: true, jobicy: true, workingnomads: true, arbeitnow: true, hn: true, yc: true, vc: true, funded: true, fourdayweek: false, nodesk: true, jobspresso: false, startupjobs: true },
    greenhouseBoards: ["example"],
    leverCompanies: [],
    ashbyOrgs: [],
    maxAgeDays: 30,
    maxToScore: 40,
  },
  providers: [
    { id: "anthropic", label: "Anthropic Claude", keyUrl: "https://console.anthropic.com/settings/keys", models: [{ id: "claude-opus-5-5", note: "Most capable, best for writing answers" }, { id: "claude-sonnet-5-5", note: "Fast and capable, cheaper" }, { id: "claude-haiku-5-5", note: "Cheapest, fine for scoring lots of jobs" }] },
    { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", models: [{ id: "gpt-6-astra", note: "Flagship" }, { id: "gpt-6-luna", note: "Cheapest" }] },
    { id: "gemini", label: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey", models: [{ id: "gemini-4-argon", note: "Flagship" }, { id: "gemini-3.8-flash", note: "Fast" }] },
    { id: "xai", label: "xAI Grok", keyUrl: "https://console.x.ai", models: [{ id: "grok-4.7", note: "Most capable" }] },
    { id: "compatible", label: "Other (OpenAI-compatible)", keyUrl: "https://openrouter.ai/keys", models: [{ id: "", note: "OpenRouter, Ollama…" }] },
  ],
  sources: {
    yc: "Y Combinator startups",
    hn: "Hacker News: Who is hiring",
    vc: "Investor portfolio boards (Sequoia, Lightspeed, GV…)",
    funded: "Newly funded startups",
    greenhouse: "Greenhouse boards",
    lever: "Lever boards",
    ashby: "Ashby boards",
    himalayas: "Himalayas",
    remoteok: "Remote OK",
    wwr: "We Work Remotely",
    jobicy: "Jobicy",
    workingnomads: "Working Nomads",
    arbeitnow: "Arbeitnow",
    nodesk: "NoDesk",
    startupjobs: "startup.jobs",
    remotive: "Remotive",
    fourdayweek: "4 Day Week",
    jobspresso: "Jobspresso",
  } as AppState["sources"],
});

const logs = new Map<string, string[]>();
const working = new Set<string>();
const t = () => new Date().toLocaleTimeString();
const DEMO_NOTE = "This is the demo with sample data. Download YouHired to do this for real with your own CV and AI key.";

let chat: { id: string; role: "user" | "assistant"; text: string; at: string; steps?: string[]; actions?: unknown[] }[] = [];
let chatActivity: string[] = [];
let thinking = false;
let search = { running: false, log: [] as string[], found: 0, skipped: 0, scored: 0, errors: [] as string[] };

function setStatus(id: string, status: Job["status"], reason?: string) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, status, statusReason: reason, statusDate: new Date().toISOString(), working: false } : j));
}

function simulateApply(id: string, submit = false) {
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  working.add(id);
  const steps = submit
    ? ["Submitting…", "Clicking submit", "Confirmation shown. Applied."]
    : [
        "Still open: Listed on Greenhouse",
        "Tailored your CV for this role (same facts, re-emphasised).",
        "Opening the application in a tab of your Chrome…",
        "Fill the candidate's name.  →  type \"Full name\" = \"Ada Okafor\"",
        "Upload the CV.  →  upload_cv \"Resume\"",
        "Pick the location.  →  click \"Lagos, Nigeria\"",
        "Write why this company, from the CV.  →  type \"Why us?\"",
        "All required fields are filled.  →  ready_to_submit",
        "Filled in your Chrome tab. Waiting for your review.",
      ];
  logs.set(id, []);
  steps.forEach((s, i) =>
    setTimeout(() => {
      logs.get(id)!.push(`${t()}  ${s}`);
      if (i === steps.length - 1) {
        working.delete(id);
        if (submit) setStatus(id, "applied", "Confirmation page shown");
        else {
          jobs = jobs.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: "filled",
                  statusReason: "Filled in a tab of your Chrome. Check it, then press Submit.",
                  statusDate: new Date().toISOString(),
                  hasSession: true,
                  tailoredCv: true,
                  answers: [
                    { label: "Full name", value: "Ada Okafor", source: "profile" },
                    { label: "Email", value: "ada@example.com", source: "profile" },
                    { label: "Location", value: "Lagos, Nigeria", source: "profile" },
                    { label: "Resume", value: "(your CV)", source: "cv-file" },
                    { label: `Why ${x.company}?`, value: `Your work lines up with what I do best: owning a product area end to end and turning research into shipped flows. At Kora Pay I rebuilt onboarding and led our design system, which is the kind of work this role describes.`, source: "ai · From your CV" },
                  ],
                }
              : x,
          );
        }
      }
    }, (i + 1) * 900),
  );
}

function demoReply(text: string): { text: string; steps: string[]; actions: unknown[] } {
  const lower = text.toLowerCase();
  if (/apply/.test(lower))
    return {
      steps: ["Looked through 9 jobs in your tracker", "Queued 2 applications"],
      text: "Done. I've started filling applications for **Lumen Health** (Lead Product Designer, fit 86) and **Juniper Studio** (UX Designer, contract, fit 72). Each one opens in a tab of your Chrome and waits for your review before it's sent.\n\n" + DEMO_NOTE,
      actions: [{ type: "apply_jobs", summary: "Filling 2 applications", status: "done", data: { job_ids: ["demo:3", "demo:5"] } }],
    };
  if (/find|search|job|available|more/.test(lower))
    return {
      steps: ["Updated your search titles", "Checking 80 remote-friendly YC startups…", "Searching job boards…", "Search finished: 3 new jobs kept, 41 skipped"],
      text: "I searched 20+ sources, including new YC startups, investor portfolio boards and Hacker News. **3 roles** are open to you from Nigeria:\n\n- **Lumen Health**: Lead Product Designer (Remote: Africa, Europe), fit 86\n- **Atlas Robotics**: Product Designer (Remote), fit 78\n- **Juniper Studio**: UX Designer, contract (contractors anywhere), fit 72\n\n41 others were limited to the US, UK or on-site, so I skipped them with the posting's own wording as evidence.\n\n" + DEMO_NOTE,
      actions: [{ type: "run_search", summary: "Searched job boards for product designer, ux designer", status: "done", data: {} }],
    };
  return {
    steps: ["Looked through 9 jobs in your tracker"],
    text: "Here's where things stand: **1 job needs your answer** (Northwind Labs asks about crypto wallets, and your CV doesn't say), **1 is filled and ready to submit** (Fernhill AI), and **3 are ready to apply**. Ask me to apply to the good ones, or to find more.\n\n" + DEMO_NOTE,
    actions: [],
  };
}

export async function demoApi<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const p = path.replace(/\?.*$/, "");
  const id = decodeURIComponent(p.match(/^\/api\/jobs\/([^/]+)/)?.[1] ?? "");
  const ok = (v: unknown) => v as T;
  const no = (msg = DEMO_NOTE): never => {
    throw new Error(msg);
  };

  if (p === "/api/state") return ok(state());
  if (p === "/api/jobs") return ok(jobs.map((j) => ({ ...j, working: working.has(j.id) })));
  if (p === "/api/search/progress") return ok(search);
  if (p === "/api/search/prefs") return ok(state().search);
  if (p === "/api/search/run") {
    search = { running: true, log: ["Fetching postings from public sources…"], found: 0, skipped: 0, scored: 0, errors: [] };
    const lines = ["YC startups: checked 80, found 45 job boards, 12 with roles like yours.", "Sequoia portfolio: 10 postings", "Hacker News: Who is hiring: 17 postings", "startup.jobs: 80 postings", "4,954 postings fetched. Filtering…", "Lumen Health — Lead Product Designer: fit 86, eligible", "Atlas Robotics — Product Designer: fit 78, unclear", "Done."];
    lines.forEach((l, i) =>
      setTimeout(() => {
        search.log.push(l);
        if (i === lines.length - 1) search = { ...search, running: false, found: 3, skipped: 41, scored: 9 };
      }, (i + 1) * 700),
    );
    return ok({ started: true });
  }
  if (p === "/api/chat" && method === "GET") return ok({ messages: chat, applying: null, queued: [] });
  if (p === "/api/chat" && method === "DELETE") {
    chat = [];
    return ok({ ok: true });
  }
  if (p === "/api/chat/activity") return ok({ running: thinking, steps: chatActivity });
  if (p === "/api/chat") {
    const text = String((body as { text?: string })?.text ?? "");
    chat.push({ id: crypto.randomUUID(), role: "user", text, at: new Date().toISOString() });
    const r = demoReply(text);
    thinking = true;
    chatActivity = [];
    for (const s of r.steps) {
      chatActivity.push(s);
      await new Promise((res) => setTimeout(res, 700));
    }
    thinking = false;
    if (r.actions.some((a) => (a as { type: string }).type === "apply_jobs")) ["demo:3", "demo:5"].forEach((x) => simulateApply(x));
    const msg = { id: crypto.randomUUID(), role: "assistant" as const, text: r.text, at: new Date().toISOString(), steps: r.steps, actions: r.actions };
    chat.push(msg);
    return ok(msg);
  }
  if (p === "/api/extension") return ok({ connected: true, lastSeen: now, version: "0.1.0", code: "demo-pairing-code", server: "http://localhost:5173", folder: "~/youhired/extension" });
  if (p === "/api/sites") return ok({ sites: [{ id: "wellfound", name: "Wellfound (AngelList Talent)", host: "wellfound.com", note: "Startup jobs, one-click apply after sign-in." }], connected: [] });
  if (p === "/api/apply-batch") {
    const ids = ((body as { ids?: string[] })?.ids ?? []).filter((x) => jobs.find((j) => j.id === x && j.status === "found"));
    ids.forEach((x) => simulateApply(x));
    return ok({ added: ids, skipped: [] });
  }
  if (id && p.endsWith("/log")) return ok({ log: logs.get(id) ?? [], applying: working.has(id) });
  if (id && p.endsWith("/apply")) {
    simulateApply(id);
    return ok({ started: true });
  }
  if (id && (p.endsWith("/submit") || p.endsWith("/finish"))) {
    simulateApply(id, true);
    return ok({ started: true });
  }
  if (id && p.endsWith("/apply-anyway")) {
    simulateApply(id);
    return ok({ added: [id] });
  }
  if (id && p.endsWith("/status")) {
    const b = body as { status: Job["status"]; reason?: string };
    setStatus(id, b.status, b.reason);
    return ok(jobs.find((j) => j.id === id));
  }
  if (id && p.endsWith("/answers")) {
    setStatus(id, "found", "Your answers are saved. Filling the application…");
    jobs = jobs.map((j) => (j.id === id ? { ...j, pending: [] } : j));
    simulateApply(id);
    return ok(jobs.find((j) => j.id === id));
  }
  if (id && p.endsWith("/kit")) {
    const j = jobs.find((x) => x.id === id);
    return ok({ applyUrl: j?.applyUrl ?? "#", answers: (j?.answers ?? []).filter((a) => !/^\(/.test(a.value)), coverNote: "Dear hiring team, … (sample cover letter)", cv: null });
  }
  if (p === "/api/settings/test") return ok({ ok: true, reply: "OK ready (demo)" });
  if (p === "/api/models") return ok({ models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] });
  if (p === "/api/settings" || p === "/api/profile") return ok(p === "/api/profile" ? profile : state().settings);
  return no();
}
