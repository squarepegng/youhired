// Shared data shapes. Everything is stored as JSON under ./data (git-ignored).

export type ProviderId = "anthropic" | "openai" | "gemini" | "xai" | "compatible";

export interface Settings {
  provider: ProviderId;
  model: string;
  apiKey: string; // stored locally only, never sent to the browser in full
  baseUrl?: string; // for "compatible" (OpenRouter, Ollama, ...)
  autoSubmit: boolean; // default false: pause for review before submitting
  browserChannel: "chrome" | "msedge" | "chromium";
}

export type WorkAuthStatus = "citizen" | "authorized" | "needs_sponsorship" | "not_authorized";

export interface SalaryRule {
  leaveBlankIfOptional: boolean;
  usePostedMinimum: boolean; // if the posting shows a range, answer with its minimum
  defaultAmount: number | null; // used when a number is required and no range is posted
  currency: string;
  period: "year" | "month" | "hour";
  textAnswer: string; // used for free-text salary questions, e.g. "Open to discussing; flexible within the posted range"
}

export interface Experience {
  company: string;
  title: string;
  start?: string;
  end?: string;
  location?: string;
  highlights: string[];
}

export interface Profile {
  // Facts the user must confirm. JobPilot never guesses these.
  legalName: string;
  preferredName: string;
  email: string;
  phone: string;
  country: string; // country of residence
  city: string;
  timezone: string; // e.g. "UTC+1"
  workAuth: Record<string, WorkAuthStatus>; // per country, e.g. { "Nigeria": "citizen", "United States": "not_authorized" }
  needsSponsorship: boolean; // needs visa sponsorship to work in countries where not authorised
  openToContractor: boolean;
  salary: SalaryRule;
  noticePeriod: string;
  links: { portfolio: string; linkedin: string; github: string; website: string };
  eeo: { gender: string; race: string; veteran: string; disability: string };
  neverApply: string[];
  pronouns: string;
  // Extracted from the CV (user can edit)
  headline: string;
  summary: string;
  yearsExperience: number | null;
  skills: string[];
  experience: Experience[];
  education: { school: string; degree: string; year?: string }[];
  // Answers the user gave to questions JobPilot couldn't answer. Reused next time.
  savedAnswers: { question: string; answer: string }[];
  cvFileName: string;
  cvText: string;
  confirmed: boolean;
}

export interface SearchPrefs {
  titles: string[]; // e.g. ["product designer", "ux designer"]
  excludeKeywords: string[]; // e.g. ["senior staff", "intern"]
  jobTypes: ("full_time" | "contract" | "part_time")[];
  sources: Record<SourceId, boolean>;
  greenhouseBoards: string[];
  leverCompanies: string[];
  ashbyOrgs: string[];
  maxAgeDays: number;
  maxToScore: number; // cap on AI calls per search
}

export type SourceId = "greenhouse" | "lever" | "ashby" | "remotive" | "remoteok" | "himalayas" | "wwr";

export type JobStatus =
  | "found"
  | "skipped"
  | "filled" // filled in the browser, waiting for your review
  | "applied"
  | "needs_answer"
  | "do_it_yourself"
  | "error";

export interface Eligibility {
  verdict: "eligible" | "ineligible" | "unclear";
  reason: string;
  evidence: string; // exact wording from the posting
}

export interface PendingQuestion {
  fieldId: string;
  label: string;
  required: boolean;
  options?: string[];
  answer?: string;
}

export interface Job {
  id: string; // source:externalId
  source: SourceId;
  company: string;
  title: string;
  url: string; // posting page
  applyUrl: string;
  location: string; // exact location wording from the source
  description: string; // plain text, untrusted
  postedAt?: string;
  salaryText?: string;
  salaryMin?: number | null;
  ats: string; // greenhouse | lever | ashby | workable | recruitee | other
  needsLogin: boolean;
  fit?: number; // 0-100
  whyFit?: string;
  eligibility?: Eligibility;
  flags: string[]; // e.g. "hidden-instructions", "ai-screening"
  status: JobStatus;
  statusReason?: string;
  statusDate: string;
  foundAt: string;
  answers?: { label: string; value: string; source: string }[];
  pending?: PendingQuestion[];
  coverNote?: string;
}

export interface Store {
  settings: Settings;
  profile: Profile;
  search: SearchPrefs;
  jobs: Record<string, Job>;
}
