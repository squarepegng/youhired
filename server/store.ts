import fs from "node:fs";
import path from "node:path";
import type { Profile, SearchPrefs, Settings, Store, Job } from "./types.js";

export const DATA_DIR = process.env.YOUHIRED_DATA_DIR || process.env.JOBPILOT_DATA_DIR || path.resolve("data");
const FILE = () => path.join(DATA_DIR, "store.json");

export function defaultProfile(): Profile {
  return {
    legalName: "",
    preferredName: "",
    email: "",
    phone: "",
    country: "",
    city: "",
    timezone: "",
    workAuth: {},
    needsSponsorship: true,
    openToContractor: true,
    salary: {
      leaveBlankIfOptional: true,
      usePostedMinimum: true,
      defaultAmount: null,
      currency: "USD",
      period: "year",
      textAnswer: "Open to discussing, flexible within the range for this role.",
    },
    noticePeriod: "",
    links: { portfolio: "", linkedin: "", github: "", website: "" },
    eeo: {
      gender: "Decline to self-identify",
      race: "Decline to self-identify",
      veteran: "I don't wish to answer",
      disability: "I don't wish to answer",
    },
    neverApply: [],
    pronouns: "",
    headline: "",
    summary: "",
    yearsExperience: null,
    skills: [],
    experience: [],
    education: [],
    savedAnswers: [],
    cvFileName: "",
    cvText: "",
    linkedinText: "",
    portfolioText: "",
    currentCompensation: "",
    stories: [],
    confirmed: false,
  };
}

export function defaultSearch(): SearchPrefs {
  return {
    brief: "",
    titles: ["product designer"],
    excludeKeywords: ["intern"],
    jobTypes: ["full_time", "contract"],
    sources: { greenhouse: true, lever: true, ashby: true, remotive: false, remoteok: true, himalayas: true, wwr: true, jobicy: true, workingnomads: true, arbeitnow: true, hn: true, yc: true, vc: true, funded: true, fourdayweek: false, nodesk: true, jobspresso: false, startupjobs: true },
    // Public job boards of companies known to hire remotely. Add your own in Search settings.
    greenhouseBoards: ["gitlab", "automatticcareers", "canonical", "elastic", "grafanalabs", "wikimedia", "vercel"],
    leverCompanies: ["toptal"],
    ashbyOrgs: ["zapier", "posthog", "linear", "supabase", "sentry"],
    recruiteeCompanies: [],
    workableAccounts: [],
    ycChecked: [],
    ycPerSearch: 80,
    otherBoards: [],
    fundedChecked: [],
    maxAgeDays: 30,
    maxToScore: 40,
  };
}

export function defaultSettings(): Settings {
  return { provider: "anthropic", model: "claude-opus-5-5", apiKey: "", baseUrl: "", autoSubmit: false, browserChannel: "chrome", background: false, connectedSites: [], tailorCv: true, useMyChrome: false, extensionCode: "" };
}

let cache: Store | null = null;

export function load(): Store {
  if (cache) return cache;
  let raw: Partial<Store> = {};
  try {
    raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
  } catch {
    /* first run */
  }
  cache = {
    settings: { ...defaultSettings(), ...raw.settings },
    profile: { ...defaultProfile(), ...raw.profile },
    search: { ...defaultSearch(), ...raw.search, sources: { ...defaultSearch().sources, ...raw.search?.sources } },
    jobs: raw.jobs ?? {},
    chat: raw.chat ?? [],
  };
  return cache;
}

export function save(): void {
  if (!cache) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + ".tmp";
  // 0600: the file holds your API key; only your macOS user can read it.
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}

export function update(fn: (s: Store) => void): Store {
  const s = load();
  fn(s);
  save();
  return s;
}

export function upsertJob(job: Job): void {
  update((s) => {
    s.jobs[job.id] = job;
  });
}

export function setStatus(id: string, status: Job["status"], reason?: string): Job | undefined {
  let out: Job | undefined;
  update((s) => {
    const j = s.jobs[id];
    if (!j) return;
    j.status = status;
    j.statusReason = reason;
    j.statusDate = new Date().toISOString();
    out = j;
  });
  return out;
}

export function cvPath(): string {
  const p = load().profile;
  return path.join(DATA_DIR, "cv", p.cvFileName || "cv.pdf");
}

/** For tests: reset the in-memory cache. */
export function _reset(): void {
  cache = null;
}

/** Never send the full key to the browser UI. */
export function maskKey(key: string): string {
  if (!key) return "";
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
