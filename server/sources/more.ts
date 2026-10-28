// More sources: remote-job APIs, the monthly Hacker News "Who is hiring?" thread, and
// Y Combinator startups (discovered through the public yc-oss dataset, then their own job boards).
// All public APIs/feeds; robots.txt and spacing are handled by politeGet.

import { findAtsLink } from "../guardrails.js";
import type { SourceId } from "../types.js";
import { htmlToText, politeGet } from "./http.js";
import { type RawJob, ashby, greenhouse, lever, mkJob, recruitee, workable } from "./index.js";
import { bamboohr, breezy, smartrecruiters, teamtailor } from "./vc.js";

const HOUR = 3600_000;

/** Title matches a target when every word of the target appears in the title (same rule as search). */
export function matchesTitle(title: string, targets: string[]): boolean {
  const t = title.toLowerCase();
  return targets.some((x) => x.toLowerCase().split(/[\s/,-]+/).filter((w) => w.length > 1).every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)));
}

/** Jobicy remote jobs API. Attribution: every job links back to its Jobicy page. */
export async function jobicy(titles: string[]): Promise<RawJob[]> {
  const tags = [...new Set(titles.map((t) => t.split(/\s+/).at(-1)!.toLowerCase()))].slice(0, 3);
  const out: RawJob[] = [];
  for (const tag of tags.length ? tags : ["designer"]) {
    const body = await politeGet(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`, 6 * HOUR);
    const data = JSON.parse(body) as { jobs?: { id: number; url: string; jobTitle: string; companyName: string; jobGeo?: string; jobDescription?: string; pubDate?: string; annualSalaryMin?: number; salaryCurrency?: string }[] };
    for (const j of data.jobs ?? [])
      out.push(mkJob("jobicy", j.id, { company: j.companyName, title: j.jobTitle, url: j.url, location: j.jobGeo ?? "", html: j.jobDescription ?? "", postedAt: j.pubDate, salaryMin: j.annualSalaryMin ?? null }));
  }
  return out;
}

/** Working Nomads exposed jobs feed. */
export async function workingNomads(): Promise<RawJob[]> {
  const body = await politeGet("https://www.workingnomads.com/api/exposed_jobs/", 6 * HOUR);
  const data = JSON.parse(body) as { url: string; title: string; description?: string; company_name?: string; location?: string; pub_date?: string }[];
  return data.map((j) => mkJob("workingnomads", j.url.replace(/\D+/g, "") || j.url, { company: j.company_name ?? "", title: j.title, url: j.url, location: j.location ?? "", html: j.description ?? "", postedAt: j.pub_date }));
}

/** Arbeitnow job board API (Europe-heavy, includes remote). */
export async function arbeitnow(): Promise<RawJob[]> {
  const body = await politeGet("https://www.arbeitnow.com/api/job-board-api", 6 * HOUR);
  const data = JSON.parse(body) as { data?: { slug: string; company_name: string; title: string; description?: string; remote?: boolean; url: string; location?: string; created_at?: number }[] };
  return (data.data ?? []).map((j) =>
    mkJob("arbeitnow", j.slug, {
      company: j.company_name,
      title: j.title,
      url: j.url,
      location: [j.remote ? "Remote" : "", j.location ?? ""].filter(Boolean).join(" — "),
      html: j.description ?? "",
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
    }),
  );
}

/** Hacker News "Ask HN: Who is hiring?" (latest month), via the official Algolia HN API. */
export async function hnHiring(titles: string[]): Promise<RawJob[]> {
  const list = JSON.parse(await politeGet("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6", 12 * HOUR)) as { hits: { objectID: string; title: string }[] };
  const story = list.hits.find((h) => /who is hiring/i.test(h.title));
  if (!story) return [];
  const item = JSON.parse(await politeGet(`https://hn.algolia.com/api/v1/items/${story.objectID}`, 6 * HOUR)) as { children?: { id: number; text?: string; created_at?: string }[] };
  const out: RawJob[] = [];
  for (const c of item.children ?? []) {
    if (!c.text) continue;
    // HN separates paragraphs with <p>; the first paragraph is "Company | Role | Location | …".
    const first = htmlToText(c.text.split(/<p>/i)[0]).text.replace(/\s+/g, " ").trim();
    const { text } = htmlToText(c.text.replace(/<p>/gi, "\n\n"));
    const roleLine = first.split("|").map((s) => s.trim()).find((p) => matchesTitle(p, titles));
    // Role must be in the header line, or named as a role in the body ("hiring a Product Designer").
    const bodyRole = roleLine ? null : text.split(/[\n.;]/).find((l) => /hiring|looking for|roles?:|positions?:/i.test(l) && matchesTitle(l, titles));
    if (!roleLine && !bodyRole) continue;
    const hit = titles.find((t) => matchesTitle(roleLine ?? bodyRole ?? "", [t]))!.split(/\s+/);
    const parts = first.split("|").map((s) => s.trim()).filter(Boolean);
    const company = (parts[0] ?? "").replace(/\(.*?\)/g, "").trim().slice(0, 60) || "HN startup";
    const roleSeg = roleLine;
    const locSeg = parts.filter((p) => /remote|onsite|on-site|hybrid|anywhere|worldwide|emea|europe|us\b|usa|uk\b|global|timezone|utc|gmt/i.test(p)).join(" | ");
    const href = c.text.match(/href="(https?:\/\/(?!news\.ycombinator)[^"]+)"/i)?.[1]?.replace(/&#x2F;/g, "/").replace(/&amp;/g, "&");
    const ats = findAtsLink(c.text.replace(/&#x2F;/g, "/"));
    out.push(
      mkJob("hn", c.id, {
        company,
        title: roleSeg ?? hit.map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        applyUrl: ats ?? href ?? `https://news.ycombinator.com/item?id=${c.id}`,
        location: locSeg || first.slice(0, 160),
        text,
        postedAt: c.created_at,
      }),
    );
  }
  return out;
}

// ── Y Combinator startup discovery ───────────────────────────────────────────

interface YcCompany {
  name: string;
  slug: string;
  website?: string;
  batch?: string;
  regions?: string[];
  isHiring?: boolean;
  team_size?: number;
  one_liner?: string;
  industry?: string;
}

const batchRank = (b = "") => {
  const m = b.match(/(Winter|Spring|Summer|Fall)\s+(\d{4})/);
  return m ? +m[2] * 4 + ["Winter", "Spring", "Summer", "Fall"].indexOf(m[1]) : 0;
};

export type BoardHit = { company: string; ats: "ashby" | "greenhouse" | "lever" | "recruitee" | "workable" | "breezy" | "teamtailor" | "bamboohr" | "smartrecruiters"; slug: string; openRoles: number; matching: string[] };

/** Find which ATS a company uses, by trying its likely handles on each public board API. */
export async function findBoard(name: string, extraSlugs: string[], titles: string[]): Promise<BoardHit | null> {
  const base = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const slugs = [...new Set([...extraSlugs, base.replace(/\s+/g, ""), base.replace(/\s+/g, "-")])].filter((s) => s.length >= 2);
  const tries: [BoardHit["ats"], (s: string) => Promise<RawJob[]>][] = [["ashby", ashby], ["lever", lever], ["greenhouse", greenhouse], ["workable", workable], ["recruitee", recruitee], ["teamtailor", teamtailor], ["breezy", breezy], ["bamboohr", bamboohr], ["smartrecruiters", smartrecruiters]];
  for (const s of slugs)
    for (const [ats, fn] of tries) {
      try {
        const jobs = await fn(s);
        if (!jobs.length && ats !== "ashby" && ats !== "lever" && ats !== "greenhouse") continue; // these can answer 200 for unknown names
        const matching = jobs.filter((j) => matchesTitle(j.title, titles)).map((j) => `${j.title} [${j.location.slice(0, 40)}]`);
        return { company: name, ats, slug: s, openRoles: jobs.length, matching };
      } catch {
        /* not this one */
      }
    }
  return null;
}

/**
 * Walk hiring YC companies (remote-friendly first, newest batches first), find their job boards, and
 * return the ones with roles matching the user's titles. Cached, so later runs are fast.
 */
export async function discoverYcStartups(opts: { titles: string[]; limit: number; log: (m: string) => void; skip: Set<string> }): Promise<{ hits: BoardHit[]; checked: string[] }> {
  const all = JSON.parse(await politeGet("https://yc-oss.github.io/api/companies/hiring.json", 24 * HOUR)) as YcCompany[];
  const remoteish = (c: YcCompany) => (c.regions ?? []).some((r) => /remote|anywhere|africa|europe|emea/i.test(r));
  const pool = all
    .filter((c) => c.isHiring !== false && remoteish(c) && !opts.skip.has(c.slug))
    .sort((a, b) => Number((b.regions ?? []).includes("Fully Remote")) - Number((a.regions ?? []).includes("Fully Remote")) || batchRank(b.batch) - batchRank(a.batch))
    .slice(0, opts.limit);
  opts.log(`Checking ${pool.length} remote-friendly YC startups (newest batches first)…`);
  const hits: BoardHit[] = [];
  const checked: string[] = [];
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < pool.length) {
        const c = pool[i++];
        checked.push(c.slug);
        const site = c.website?.replace(/^https?:\/\/(www\.)?/, "").split(/[./]/)[0];
        const hit = await findBoard(c.name, [c.slug, ...(site ? [site] : [])], opts.titles).catch(() => null);
        done++;
        if (hit) {
          hits.push(hit);
          if (hit.matching.length) opts.log(`${c.name} (${c.batch}): ${hit.matching.length} matching role${hit.matching.length === 1 ? "" : "s"} on ${hit.ats}`);
        }
        if (done % 25 === 0) opts.log(`…checked ${done}/${pool.length} startups, ${hits.length} job boards found`);
      }
    }),
  );
  return { hits, checked };
}

export const MORE_SOURCE_LABELS: Partial<Record<SourceId, string>> = {
  jobicy: "Jobicy",
  workingnomads: "Working Nomads",
  arbeitnow: "Arbeitnow",
  hn: "Hacker News: Who is hiring",
};
