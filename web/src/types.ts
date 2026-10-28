// Mirrors server/types.ts (kept separate so the browser bundle doesn't import server code).
export type ProviderId = "anthropic" | "openai" | "gemini" | "xai" | "compatible";
export type WorkAuthStatus = "citizen" | "authorized" | "needs_sponsorship" | "not_authorized";
export type JobStatus = "found" | "skipped" | "filled" | "applied" | "needs_answer" | "do_it_yourself" | "error";

export interface Settings {
  provider: ProviderId;
  model: string;
  apiKey: string;
  hasKey: boolean;
  baseUrl?: string;
  autoSubmit: boolean;
  browserChannel: "chrome" | "msedge" | "chromium";
  background: boolean;
}

export interface Profile {
  legalName: string;
  preferredName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  timezone: string;
  workAuth: Record<string, WorkAuthStatus>;
  needsSponsorship: boolean;
  openToContractor: boolean;
  salary: { leaveBlankIfOptional: boolean; usePostedMinimum: boolean; defaultAmount: number | null; currency: string; period: "year" | "month" | "hour"; textAnswer: string };
  noticePeriod: string;
  links: { portfolio: string; linkedin: string; github: string; website: string };
  eeo: { gender: string; race: string; veteran: string; disability: string };
  neverApply: string[];
  pronouns: string;
  headline: string;
  summary: string;
  yearsExperience: number | null;
  skills: string[];
  experience: { company: string; title: string; start?: string; end?: string; highlights: string[] }[];
  education: { school: string; degree: string; year?: string }[];
  savedAnswers: { question: string; answer: string }[];
  cvFileName: string;
  cvText: string;
  confirmed: boolean;
}

export type SourceId = "greenhouse" | "lever" | "ashby" | "remotive" | "remoteok" | "himalayas" | "wwr";

export interface SearchPrefs {
  brief?: string;
  titles: string[];
  excludeKeywords: string[];
  jobTypes: string[];
  sources: Record<SourceId, boolean>;
  greenhouseBoards: string[];
  leverCompanies: string[];
  ashbyOrgs: string[];
  maxAgeDays: number;
  maxToScore: number;
}

export interface Job {
  id: string;
  source: SourceId;
  company: string;
  title: string;
  url: string;
  applyUrl: string;
  location: string;
  description: string;
  postedAt?: string;
  salaryText?: string;
  ats: string;
  needsLogin: boolean;
  fit?: number;
  whyFit?: string;
  eligibility?: { verdict: "eligible" | "ineligible" | "unclear"; reason: string; evidence: string };
  flags: string[];
  status: JobStatus;
  statusReason?: string;
  statusDate: string;
  foundAt: string;
  answers?: { label: string; value: string; source: string }[];
  pending?: { fieldId: string; label: string; required: boolean; options?: string[]; hint?: string }[];
  coverNote?: string;
  hasSession?: boolean;
  working?: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  models: { id: string; note: string }[];
  keyUrl: string;
  baseUrl?: string;
}

export interface AppState {
  settings: Settings;
  profile: Profile;
  search: SearchPrefs;
  providers: ProviderInfo[];
  sources: Record<SourceId, string>;
}
