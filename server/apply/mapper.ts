// Map application-form fields to the user's profile with plain rules. Facts that matter
// (identity, location, work authorisation, salary, EEO) are ONLY ever answered here, from
// what the user confirmed, never by the AI. Anything we can't answer from the profile is
// handed to the AI (free text grounded in the CV) or to the user ("needs your answer").

import { normCountry } from "../eligibility.js";
import type { Job, Profile } from "../types.js";

export type FieldKind =
  | "text" | "email" | "tel" | "url" | "number" | "date" | "textarea"
  | "select" | "combobox" | "radio" | "checkbox" | "checkbox-single" | "file" | "buttons";

export interface FormField {
  id: string; // data-jp-id in the page
  frame: number; // index into page.frames()
  kind: FieldKind;
  label: string;
  name: string;
  required: boolean;
  options: string[];
  optionIds?: string[]; // for radio/checkbox groups and button groups
  value: string;
  accept?: string;
  autocomplete?: string;
}

export interface Mapped {
  field: FormField;
  value: string | string[] | null; // null = leave empty
  source: "profile" | "saved" | "rule" | "cv-file" | "cover-file" | "ai" | "user";
  need?: "ai" | "user"; // still needs an answer
  note?: string;
}

const L = (f: FormField) => `${f.label} ${f.name}`.toLowerCase().replace(/\s+/g, " ");

export function normQ(s: string): string {
  return s.toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function similarity(a: string, b: string): number {
  const A = new Set(normQ(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(normQ(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Pick the option that best matches any of the wanted phrases. Returns null if nothing is close. */
export function pickOption(options: string[], wanted: string[]): string | null {
  const opts = options.filter((o) => o && !/^(select|choose|please select|--)/i.test(o.trim()));
  for (const w of wanted) {
    const exact = opts.find((o) => normQ(o) === normQ(w));
    if (exact) return exact;
  }
  for (const w of wanted) {
    const nw = normQ(w);
    if (!nw) continue;
    const starts = opts.find((o) => normQ(o).startsWith(nw) || nw.startsWith(normQ(o)));
    if (starts) return starts;
    const contains = opts.find((o) => normQ(o).includes(nw));
    if (contains) return contains;
  }
  let best: { o: string; s: number } | null = null;
  for (const o of opts) for (const w of wanted) {
    const s = similarity(o, w);
    if (!best || s > best.s) best = { o, s };
  }
  return best && best.s >= 0.5 ? best.o : null;
}

const DECLINE = ["Decline to self-identify", "Decline to self identify", "I don't wish to answer", "I do not wish to answer", "Prefer not to say", "Prefer not to answer", "Decline", "I prefer not to"];
const YES = ["Yes"];
const NO = ["No"];

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first: full.trim(), last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Which country a work-authorisation / sponsorship question is about, if it says. */
export function questionCountry(label: string, job: Pick<Job, "location">): string | null {
  const l = label.toLowerCase();
  const m: [RegExp, string][] = [
    [/\b(?:u\.?s\.?a?|united states|america|h-?1b|green card|e-?verify)\b/, "united states"],
    [/\b(?:u\.?k\.?|united kingdom|britain)\b/, "united kingdom"],
    [/\bcanada\b/, "canada"],
    [/\b(?:eu|european union|europe|eea)\b/, "eu"],
    [/\bgermany\b/, "germany"],
    [/\bnetherlands\b/, "netherlands"],
    [/\bireland\b/, "ireland"],
    [/\baustralia\b/, "australia"],
    [/\bindia\b/, "india"],
    [/\bnigeria\b/, "nigeria"],
  ];
  for (const [re, c] of m) if (re.test(l)) return c;
  if (/country (?:in which|where|with which|that|you) ?(?:you )?(?:currently )?(?:reside|live)|your country of residence|where you (?:currently )?(?:live|reside)|remain in your current (?:location|country)|in your current (?:location|country)/.test(l)) return "__residence__";
  if (/(?:country|location) (?:where|in which) (?:this|the) (?:job|role|position)/.test(l)) {
    const jc = job.location.toLowerCase();
    for (const [re, c] of m) if (re.test(jc)) return c;
    return null; // remote/anywhere: ambiguous → ask the user once
  }
  return null;
}

function authorisedIn(p: Profile, country: string): boolean | null {
  if (country === "__residence__") return true;
  const home = normCountry(p.country);
  if (country === home) return true;
  for (const [c, st] of Object.entries(p.workAuth)) {
    const nc = normCountry(c);
    if (nc === country || (country === "eu" && /^(eu|european union)$/.test(nc))) {
      if (st === "citizen" || st === "authorized") return true;
      if (st === "not_authorized" || st === "needs_sponsorship") return false;
    }
  }
  // Not listed: unknown. We don't assume either way.
  return null;
}

function yesNo(f: FormField, yes: boolean): string {
  if (f.options.length) return pickOption(f.options, yes ? YES : NO) ?? (yes ? "Yes" : "No");
  return yes ? "Yes" : "No";
}

function savedAnswer(p: Profile, f: FormField): string | null {
  const q = normQ(f.label);
  if (!q) return null;
  let best: { a: string; s: number } | null = null;
  for (const sa of p.savedAnswers) {
    const s = normQ(sa.question) === q ? 1 : similarity(sa.question, f.label);
    if (!best || s > best.s) best = { a: sa.answer, s };
  }
  if (!best || best.s < 0.85) return null;
  if (f.options.length) return pickOption(f.options, [best.a]);
  return best.a;
}

function currentCompany(p: Profile): string {
  const cur = p.experience.find((e) => !e.end || /present|current|now/i.test(e.end));
  return cur?.company ?? "";
}

function salaryValue(f: FormField, p: Profile, job: Pick<Job, "salaryMin">): Mapped {
  const s = p.salary;
  if (!f.required && s.leaveBlankIfOptional) return { field: f, value: null, source: "rule", note: "Optional salary question left blank (your rule)" };
  const numeric = f.kind === "number" || /number|amount|annual|usd|\$/.test(L(f)) && f.kind !== "textarea";
  const num = s.usePostedMinimum && job.salaryMin ? job.salaryMin : s.defaultAmount;
  if (f.options.length) {
    // Range dropdowns: we can't safely pick; ask the user once.
    return { field: f, value: null, source: "user", need: "user", note: "Salary range options" };
  }
  if (numeric) {
    if (num == null) return { field: f, value: null, source: "user", need: "user", note: "No default salary set" };
    return { field: f, value: String(num), source: "rule", note: s.usePostedMinimum && job.salaryMin ? "Posted range minimum" : "Your default salary" };
  }
  if (s.textAnswer) {
    const withNum = s.usePostedMinimum && job.salaryMin ? `${s.textAnswer} (${s.currency} ${job.salaryMin.toLocaleString("en-US")} per ${s.period}, the posted minimum, works for me.)` : s.textAnswer;
    return { field: f, value: withNum, source: "rule", note: "Your salary text" };
  }
  if (num != null) return { field: f, value: `${s.currency} ${num.toLocaleString("en-US")} per ${s.period}`, source: "rule" };
  return { field: f, value: null, source: "user", need: "user" };
}

/**
 * Profile facts and rules win; an answer you gave before fills only what they can't
 * (so an old answer to a vaguer question never overrides a clear fact).
 */
export function mapField(f: FormField, p: Profile, job: Pick<Job, "location" | "salaryMin" | "source" | "company">): Mapped {
  const r = mapByRules(f, p, job);
  const decided = r.value != null && r.value !== "" && (r.source === "profile" || r.source === "rule" || r.source === "cv-file" || r.source === "cover-file");
  if (decided || /password|passcode/.test(L(f))) return r;
  const saved = f.kind === "file" ? null : savedAnswer(p, f);
  if (saved) return { field: f, value: saved, source: "saved" };
  return r;
}

function mapByRules(f: FormField, p: Profile, job: Pick<Job, "location" | "salaryMin" | "source" | "company">): Mapped {
  const l = L(f);
  const ret = (value: string | null, source: Mapped["source"] = "profile", note?: string): Mapped =>
    value ? { field: f, value, source, note } : f.required ? { field: f, value: null, source: "user", need: "user", note: note ?? "Missing from your profile" } : { field: f, value: null, source: "rule", note: "Optional, left blank" };
  const name = splitName(p.legalName);

  // Files
  if (f.kind === "file") {
    // Cover letter slot: always attach one (forms often mark it required only in the label or on submit).
    if (/cover/.test(l)) return { field: f, value: "cover", source: "cover-file", note: f.required ? undefined : "optional" };
    if (/resume|résumé|cv\b|curriculum/.test(l) || f.required) return { field: f, value: "cv", source: "cv-file" };
    return { field: f, value: null, source: "rule", note: "Optional upload skipped" };
  }

  // Passwords are never filled, whatever the field is called ("Portfolio password" included).
  if (/password|passcode|\bpin\b/.test(l)) return f.required ? { field: f, value: null, source: "user", need: "user", note: "JobPilot never enters passwords" } : { field: f, value: null, source: "rule", note: "Password field left empty" };

  // Answers the user already gave to this exact question before

  // Identity & contact
  if (/\bfirst[_ ]?name|given name|\bfname\b/.test(l)) return ret(p.preferredName && /prefer/.test(l) ? p.preferredName : name.first);
  if (/\blast[_ ]?name|surname|family name|\blname\b/.test(l)) return ret(name.last);
  if (/preferred (?:first )?name|nickname|name (?:you(?:'d| would)|do you) prefer/.test(l)) return ret(p.preferredName || p.legalName.split(/\s+/)[0] || null);
  if (/pronounc|phonetic/.test(l)) return f.required ? { field: f, value: null, source: "user", need: "user" } : { field: f, value: null, source: "rule", note: "Optional, left blank" };
  if (/preferred last name/.test(l)) return ret(name.last);
  if (/\b(?:full |legal )?name\b/.test(l) && !/company|employer|school|reference|manager|referr/.test(l)) return ret(p.legalName);
  if (f.kind === "email" || /e-?mail/.test(l)) return ret(p.email);
  if (f.kind === "tel" || /phone|mobile|whatsapp/.test(l)) {
    if (/country/.test(l) && (f.kind === "combobox" || f.kind === "select")) return ret(p.country);
    return ret(p.phone);
  }
  if (/linkedin/.test(l)) return ret(p.links.linkedin || null);
  if (/github/.test(l)) return ret(p.links.github || null);
  if (/portfolio|dribbble|behance/.test(l)) return ret(p.links.portfolio || p.links.website || null);
  if (/website|personal (?:site|url)|other (?:link|url)|\burl\b/.test(l)) return ret(p.links.website || p.links.portfolio || null);
  if (/twitter|x\.com/.test(l)) return ret(null);
  if (/pronoun/.test(l)) return ret(p.pronouns || null);
  if (/^(?:current |most recent )?(?:company|employer)(?: name)?$|^org$/.test(normQ(f.label)) || f.name === "org") return ret(currentCompany(p) || null);
  // "Have you worked at <this company> before?" is answerable from the CV's employer list.
  const prevAt = new RegExp(`(?:previously|ever|before).{0,30}(?:worked|employed|consulted).{0,30}${job.company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase()}`);
  if (job.company && prevAt.test(l)) {
    const was = p.experience.some((e) => normQ(e.company).includes(normQ(job.company)) || normQ(job.company).includes(normQ(e.company)));
    return ret(yesNo(f, was), "rule", "From the employers on your CV");
  }

  // Postal codes: only you know yours; a "US zipcode" question doesn't apply outside the US.
  if (/zip ?code|postal ?code|post ?code/.test(l)) {
    if (/u\.?s\.?\b|united states/.test(l) && normCountry(p.country) !== "united states") return { field: f, value: null, source: "rule", note: "Only for US applicants, left blank" };
    return f.required ? { field: f, value: null, source: "user", need: "user" } : { field: f, value: null, source: "rule", note: "Optional, left blank" };
  }
  // Location (never stated falsely)
  // "Where are you located in the United States?" assumes you live there: never answer it with a guess.
  const whereIn = f.label.match(/^where (?:are|do) you (?:currently )?(?:live|living|reside|located|based) (?:in|within) (?:the )?(.{2,40}?)\s*(?:\(.*\))?\s*\??$/i);
  if (whereIn) {
    const place = whereIn[1].toLowerCase();
    const home = [p.city, p.country, normCountry(p.country)].filter(Boolean).map((x) => x.toLowerCase());
    if (!home.some((h) => place.includes(h) || h.includes(place)))
      return { field: f, value: null, source: "user", need: "user", note: `This form assumes you live in ${whereIn[1]}. You don't, so this role may not be open to you.` };
  }
  const livesIn = f.label.match(/^(?:do|are) you (?:currently )?(?:live|living|reside|residing|based|located) (?:in|within|near) (?:the )?(.{2,60}?)\??$/i);
  if (livesIn && !/willing|able|open/.test(l)) {
    const place = livesIn[1].toLowerCase();
    const home = [p.city, p.country, normCountry(p.country)].filter(Boolean).map((x) => x.toLowerCase());
    if (home.length) return ret(yesNo(f, home.some((h) => place.includes(h))), "rule", `You live in ${[p.city, p.country].filter(Boolean).join(", ")}`);
  }
  if (/\bcity\b/.test(l) && /\bcountry\b/.test(l) && !/authori[sz]|sponsor/.test(l) && !f.options.length) return ret([p.city, p.country].filter(Boolean).join(", ") || null);
  if (/\bcountry\b/.test(l) && !/authori[sz]|sponsor|visa|eligible|legally/.test(l)) {
    if (f.options.length) return ret(pickOption(f.options, [p.country]));
    return ret(p.country);
  }
  if (/\bcity\b/.test(l) && !/authori[sz]|sponsor/.test(l)) return ret(p.city);
  if (/time ?zone/.test(l)) return ret(p.timezone || null);
  if (/(?:current |your )?location|where are you (?:based|located)|where do you (?:live|reside)|based in|address/.test(l) && !/relocat|willing|authori[sz]|sponsor|office/.test(l)) {
    const v = [p.city, p.country].filter(Boolean).join(", ");
    if (f.options.length) return ret(pickOption(f.options, [v, p.country]));
    return ret(v || null);
  }

  // Work authorisation & sponsorship
  if (/nationality|citizenship|citizen of/.test(l) && !/authori[sz]|sponsor/.test(l)) {
    const nats = Object.entries(p.workAuth).filter(([, st]) => st === "citizen").map(([c]) => c);
    if (!nats.length) return { field: f, value: null, source: "user", need: "user", note: "Add your citizenship under work authorisation" };
    return ret(f.options.length ? pickOption(f.options, nats) : nats.join(", "));
  }
  if (/sponsor|(?:require|need)\w*.{0,25}\bvisa|\bvisa.{0,20}(?:status|support|sponsor)/.test(l)) {
    const c = questionCountry(f.label, job);
    if (c) {
      const ok = authorisedIn(p, c);
      if (ok === true) return ret(yesNo(f, false), "rule", "Authorised there, no sponsorship needed");
      if (ok === false) return ret(yesNo(f, p.needsSponsorship), "rule", "Not authorised there");
    }
    return { field: f, value: null, source: "user", need: "user", note: "Sponsorship question without a clear country. Answer once and JobPilot will reuse it." };
  }
  if (/authori[sz]ed to work|legally (?:allowed|able|eligible|permitted) to work|right to work|eligible to work|work permit|work authori[sz]ation/.test(l)) {
    const c = questionCountry(f.label, job);
    if (c) {
      const ok = authorisedIn(p, c);
      if (ok !== null) return ret(yesNo(f, ok), "rule", ok ? "You're authorised there" : "You're not authorised there");
    }
    return { field: f, value: null, source: "user", need: "user", note: "Work-authorisation question without a clear country. Answer once and JobPilot will reuse it." };
  }
  if (/relocat/.test(l)) return { field: f, value: null, source: "user", need: "user" };

  // Salary, notice
  // Current / most recent pay ("CTC") is a fact only you know: from your profile, never guessed.
  if (/\bctc\b|current (?:salary|compensation|pay|package|ctc)|most recent (?:salary|compensation|pay|ctc)|present (?:salary|ctc)|last drawn/.test(l)) {
    if (p.currentCompensation) return ret(f.options.length ? pickOption(f.options, [p.currentCompensation]) : p.currentCompensation, "profile");
    return { field: f, value: null, source: "user", need: "user", note: "Add your current pay under Profile → Salary once, and JobPilot fills it everywhere" };
  }
  if (!/review|read|aware|understand|acknowledge/.test(l) && /salary|compensation|pay expectation|expected (?:pay|rate)|desired (?:pay|rate)|rate expectation|hourly rate/.test(l)) return salaryValue(f, p, job);
  if (/notice period|when can you start|start date|earliest (?:start|availability)|available to start/.test(l)) return ret(p.noticePeriod || null);

  // EEO / demographics: decline unless the user set something else
  const eeo = (pref: string) => {
    const wanted = pref && !/decline|wish|prefer not/i.test(pref) ? [pref, ...DECLINE] : DECLINE;
    if (f.options.length) return ret(pickOption(f.options, wanted), "rule", "EEO default");
    if (f.kind === "combobox") return ret(wanted[0], "rule", "EEO default");
    return f.required ? ret(pref || "Decline to self-identify", "rule") : ret(null);
  };
  if (/\bgender\b|\bsex\b/.test(l)) return eeo(p.eeo.gender);
  if (/\brace\b|ethnic|hispanic|latin[oa]/.test(l)) return eeo(p.eeo.race);
  if (/veteran|military/.test(l)) return eeo(p.eeo.veteran);
  if (/disabilit/.test(l)) return eeo(p.eeo.disability);
  if (/sexual orientation|transgender|lgbt/.test(l)) return eeo("");

  // Consent / acknowledgement checkboxes. Ticked only when required; listed for your review.
  if ((f.kind === "checkbox-single" || f.kind === "checkbox") && /privacy|consent|agree|acknowledge|terms|gdpr|data (?:processing|protection)|certify|true and (?:complete|accurate)/.test(l)) {
    if (!f.required) return { field: f, value: null, source: "rule", note: "Optional consent left unticked" };
    return { field: f, value: f.kind === "checkbox" && f.options.length ? [f.options[0]] : "true", source: "rule", note: "Required consent box ticked: please review" };
  }
  if (/how (?:did )?you (?:hear|heard|find|found|learn|learned|came across)|where did you (?:hear|find|see)|^source\b|referral source/.test(l)) {
    const via = ({ greenhouse: "Company website", lever: "Company website", ashby: "Company website", remotive: "Remotive", remoteok: "Remote OK", himalayas: "Himalayas", wwr: "We Work Remotely", jobicy: "Jobicy", workingnomads: "Working Nomads", arbeitnow: "Arbeitnow", hn: "Hacker News", yc: "Y Combinator", vc: "Investor job board", fourdayweek: "4 Day Week", nodesk: "NoDesk", jobspresso: "Jobspresso", startupjobs: "startup.jobs" } as Record<string, string>)[job.source] ?? "Job board";
    if (f.options.length) return ret(pickOption(f.options, [via, "Job board", "Online job board", "Other", "Website"]), "rule");
    return ret(via, "rule");
  }
  if (/\b(?:18|eighteen)\b.*(?:age|old)|(?:age|old).*\b18\b|over the age/.test(l)) return { field: f, value: null, source: "user", need: "user" };

  // Everything else: free text goes to the AI (grounded in the CV); choices go to the AI, which
  // must say "can't answer" unless the CV clearly supports an option.
  if (!f.required && (f.kind === "select" || f.kind === "radio" || f.kind === "checkbox" || f.kind === "combobox" || f.kind === "buttons") && !f.options.length)
    return { field: f, value: null, source: "rule", note: "Optional, left blank" };
  return { field: f, value: null, source: "ai", need: "ai" };
}

export function mapAll(fields: FormField[], p: Profile, job: Pick<Job, "location" | "salaryMin" | "source" | "company">): Mapped[] {
  return fields.map((f) => mapField(f, p, job));
}
