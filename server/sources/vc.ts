// Startup sources: venture-capital portfolio job boards (Getro and Consider platforms), the a16z speedrun
// talent network, and a few remote/startup boards. Endpoints and response shapes were learned from the
// open-source career-ops project (MIT, github.com/career-ops-hq/career-ops); the code here is our own.
// All public, no-login endpoints, fetched through politeGet (robots.txt, spacing, cache) where possible.

import { XMLParser } from "fast-xml-parser";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../store.js";
import { USER_AGENT, checkRobots, htmlToText, politeGet } from "./http.js";
import { type RawJob, mkJob } from "./index.js";
import { matchesTitle } from "./more.js";

const HOUR = 3600_000;

/**
 * Venture firms' portfolio job boards. Each lists jobs across dozens to hundreds of funded startups.
 * (Getro-hosted boards such as Atomico or Insight Partners are left out: api.getro.com's robots.txt
 * disallows its search API, so getroBoard would be refused anyway.)
 */
export const VC_BOARDS: { name: string; url: string; platform: "getro" | "consider" }[] = [
  { name: "Sequoia", url: "https://jobs.sequoiacap.com/jobs", platform: "consider" },
  { name: "Lightspeed", url: "https://jobs.lsvp.com/jobs", platform: "consider" },
  { name: "Kleiner Perkins", url: "https://jobs.kleinerperkins.com/jobs", platform: "consider" },
  { name: "GV (Google Ventures)", url: "https://jobs.gv.com/jobs", platform: "consider" },
  { name: "Bessemer", url: "https://jobs.bvp.com/jobs", platform: "consider" },
  { name: "First Round", url: "https://jobs.firstround.com/jobs", platform: "consider" },
  { name: "Founderful", url: "https://jobs.founderful.com/jobs", platform: "consider" },
];

/** Small JSON cache for POST endpoints (politeGet only caches GETs). */
async function cachedPost(url: string, body: unknown, headers: Record<string, string>, ttlMs: number): Promise<string> {
  const file = path.join(DATA_DIR, "cache", crypto.createHash("sha1").update(url + JSON.stringify(body)).digest("hex") + ".post.txt");
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < ttlMs) return fs.readFileSync(file, "utf8");
  } catch {
    /* not cached */
  }
  await checkRobots(new URL(url));
  const res = await fetch(url, { method: "POST", headers: { "user-agent": USER_AGENT, "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

const locText = (locs: unknown): string =>
  Array.isArray(locs) ? locs.map((l) => (typeof l === "string" ? l : (l as { name?: string; label?: string })?.name ?? (l as { label?: string })?.label ?? "")).filter(Boolean).join(" / ") : "";

/** Getro boards: find the collection id in the page, then search it for each target title. */
export async function getroBoard(name: string, boardUrl: string, titles: string[]): Promise<RawJob[]> {
  const html = await politeGet(boardUrl, 7 * 24 * HOUR, "text/html");
  const id = html.match(/"network":\{"id":"?(\d+)/)?.[1];
  if (!id) throw new Error(`${name}: couldn't find the Getro board id`);
  const out = new Map<string, RawJob>();
  for (const q of titles.slice(0, 6)) {
    for (let page = 0; page < 5; page++) {
      const body = await cachedPost(`https://api.getro.com/api/v2/collections/${id}/search/jobs`, { hitsPerPage: 20, page, filters: { page }, query: q }, { referer: boardUrl, origin: new URL(boardUrl).origin }, 6 * HOUR);
      const data = JSON.parse(body) as { results?: { jobs?: { title: string; url: string; organization?: { name?: string }; locations?: unknown; created_at?: number | string; work_mode?: string }[]; count?: number } };
      const jobs = data.results?.jobs ?? [];
      for (const j of jobs) {
        if (!matchesTitle(j.title, titles)) continue;
        const ts = typeof j.created_at === "number" ? (j.created_at < 1e12 ? j.created_at * 1000 : j.created_at) : Date.parse(String(j.created_at ?? ""));
        out.set(j.url, mkJob("vc", `getro-${id}-${j.url}`, { company: j.organization?.name ?? name, title: j.title, url: j.url, location: [/remote/i.test(j.work_mode ?? "") ? "Remote" : /on.?site|office/i.test(j.work_mode ?? "") ? "On-site" : "", locText(j.locations)].filter(Boolean).join(" — "), text: "", postedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : undefined }));
      }
      if (jobs.length < 20) break;
    }
  }
  return [...out.values()].map((j) => ({ ...j, description: `Posted on ${name}'s portfolio job board.` }));
}

/** Consider boards: read the page's server state (board id + CSRF token, as the page itself does), then search. */
export async function considerBoard(name: string, boardUrl: string, titles: string[]): Promise<RawJob[]> {
  const origin = new URL(boardUrl).origin;
  const cacheKey = { board: boardUrl, titles };
  const file = path.join(DATA_DIR, "cache", crypto.createHash("sha1").update(JSON.stringify(cacheKey)).digest("hex") + ".consider.json");
  let jobs: { title: string; url: string; applyUrl?: string; companyName?: string; locations?: unknown; timeStamp?: string; remote?: boolean }[] | null = null;
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < 6 * HOUR) jobs = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* not cached */
  }
  if (!jobs) {
    await checkRobots(new URL(boardUrl));
    const page = await fetch(boardUrl, { headers: { "user-agent": USER_AGENT, accept: "text/html" } });
    const html = await page.text();
    const m = html.match(/window\.serverInitialData\s*=\s*(\{.*?\})\s*;?\s*(?:<\/script>|$)/m);
    const state = m ? (JSON.parse(m[1]) as { csrfToken?: string; board?: { id: string; isParent?: boolean } }) : null;
    if (!state?.board?.id) throw new Error(`${name}: couldn't read the board`);
    const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const res = await fetch(`${origin}/api-boards/search-jobs`, {
      method: "POST",
      headers: { "user-agent": USER_AGENT, "content-type": "application/json", accept: "application/json", referer: boardUrl, origin, ...(cookie ? { cookie } : {}), ...(state.csrfToken ? { "x-csrf-token": state.csrfToken } : {}) },
      body: JSON.stringify({ meta: { size: 500 }, board: { id: state.board.id, isParent: state.board.isParent ?? true }, query: { promoteFeatured: true } }),
    });
    if (!res.ok) throw new Error(`${name} returned ${res.status}`);
    jobs = ((await res.json()) as { jobs?: typeof jobs }).jobs ?? [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(jobs));
  }
  return jobs
    .filter((j) => matchesTitle(j.title, titles))
    .map((j) =>
      mkJob("vc", `consider-${j.url}`, {
        company: j.companyName ?? name,
        title: j.title,
        url: j.url,
        applyUrl: j.applyUrl || j.url,
        location: [j.remote ? "Remote" : j.remote === false ? "On-site" : "", locText(j.locations)].filter(Boolean).join(" — "),
        text: `Posted on ${name}'s portfolio job board.`,
        postedAt: j.timeStamp,
      }),
    );
}

/** a16z speedrun talent network: a16z portfolio startups (public API, supports search). */
export async function speedrun(titles: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const q of titles.slice(0, 4)) {
    const body = await politeGet(`https://speedrun-talent-network.com/api/v1/jobs?q=${encodeURIComponent(q)}&page=0&source=jobpilot`, 6 * HOUR);
    const data = JSON.parse(body) as { jobs?: { id: string | number; title: string; company?: string | { name?: string }; url: string; location?: string; remote?: boolean; published_at?: string; description?: string }[] };
    for (const j of data.jobs ?? [])
      out.push(mkJob("vc", `speedrun-${j.id}`, { company: typeof j.company === "string" ? j.company : j.company?.name ?? "a16z startup", title: j.title, url: j.url, location: [j.remote ? "Remote" : j.remote === false ? "On-site" : "", j.location ?? ""].filter(Boolean).join(" — "), html: j.description ?? "", postedAt: j.published_at }));
  }
  return out;
}

/** 4 Day Week: companies offering 4-day weeks (public API). */
export async function fourDayWeek(): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = JSON.parse(await politeGet(`https://4dayweek.io/api/jobs?page=${page}`, 6 * HOUR)) as { jobs?: { id: string | number; title: string; slug: string; company_name?: string; company?: { name?: string }; work_arrangement?: string; locations?: { city?: string; country?: string }[]; posted?: number; is_expired?: boolean; description?: string }[]; has_more?: boolean };
    for (const j of data.jobs ?? []) {
      if (j.is_expired || !/^[\w-]+$/.test(j.slug)) continue;
      const loc = (j.locations ?? []).map((l) => [l.city, l.country].filter(Boolean).join(", ")).join(" / ");
      out.push(mkJob("fourdayweek", j.id, { company: j.company_name ?? j.company?.name ?? "", title: j.title, url: `https://4dayweek.io/job/${j.slug}`, location: [/remote/i.test(j.work_arrangement ?? "") ? "Remote" : "", loc].filter(Boolean).join(" — "), html: j.description ?? "", postedAt: j.posted ? new Date(j.posted * 1000).toISOString() : undefined }));
    }
    if (!data.has_more) break;
  }
  return out;
}

const rss = new XMLParser({ ignoreAttributes: true });
function rssItems(xml: string): { title?: string; link?: string; guid?: string; description?: string; pubDate?: string; [k: string]: unknown }[] {
  const d = rss.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const raw = d.rss?.channel?.item;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []) as ReturnType<typeof rssItems>;
}

/** NoDesk remote jobs (RSS). */
export async function nodesk(): Promise<RawJob[]> {
  return rssItems(await politeGet("https://nodesk.co/remote-jobs/index.xml", 6 * HOUR, "application/rss+xml")).map((it) => {
    const [title, company] = String(it.title ?? "").split(/\s+at\s+/i);
    return mkJob("nodesk", it.link ?? it.guid ?? "", { company: company ?? "", title: title ?? String(it.title), url: String(it.link), location: "Remote", html: String(it.description ?? ""), postedAt: it.pubDate ? new Date(String(it.pubDate)).toISOString() : undefined });
  });
}

/** Jobspresso remote jobs (WordPress job feed). */
export async function jobspresso(): Promise<RawJob[]> {
  return rssItems(await politeGet("https://jobspresso.co/?feed=job_feed", 6 * HOUR, "application/rss+xml")).map((it) =>
    mkJob("jobspresso", it.link ?? it.guid ?? "", {
      company: String(it["job_listing:company"] ?? ""),
      title: String(it.title ?? ""),
      url: String(it.link),
      location: String(it["job_listing:location"] ?? "Remote"),
      html: String(it.description ?? ""),
      postedAt: it.pubDate ? new Date(String(it.pubDate)).toISOString() : undefined,
    }),
  );
}

/** startup.jobs: newest remote postings per role (public RSS). */
export async function startupJobs(titles: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const t of titles.slice(0, 4)) {
    const role = t.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const xml = await politeGet(`https://startup.jobs/feeds/jobs?role=${encodeURIComponent(role)}&workplace=remote`, 6 * HOUR, "application/rss+xml").catch(() => "");
    for (const it of xml ? rssItems(xml) : []) {
      const [title, company] = String(it.title ?? "").split(/\s+(?:at|@)\s+/i);
      // The feed puts the location after the summary, separated by two spaces: "…release.  Remote, Kansas, U.S."
      const desc = String(it.description ?? "");
      const loc = desc.split(/\s{2,}/).at(-1) ?? "";
      out.push(mkJob("startupjobs", it.guid ?? it.link ?? "", { company: company ?? "", title: title ?? String(it.title), url: String(it.guid ?? it.link), location: loc.length < 120 ? loc : "", text: desc, postedAt: it.pubDate ? new Date(String(it.pubDate)).toISOString() : undefined }));
    }
  }
  return out;
}

// ── More application systems (per company) ───────────────────────────────────

export async function breezy(slug: string): Promise<RawJob[]> {
  const data = JSON.parse(await politeGet(`https://${encodeURIComponent(slug)}.breezy.hr/json`, 6 * HOUR)) as { id: string; name: string; url: string; location?: { name?: string; is_remote?: boolean; country?: { name?: string } }; published_date?: string; company?: { name?: string } }[];
  if (!Array.isArray(data)) return [];
  return data.map((j) => mkJob("greenhouse", `breezy-${slug}-${j.id}`, { company: j.company?.name ?? slug, title: j.name, url: j.url, applyUrl: `${j.url.replace(/\/$/, "")}/apply`, location: [j.location?.is_remote ? "Remote" : "", j.location?.name ?? "", j.location?.country?.name ?? ""].filter(Boolean).join(" — "), text: "", postedAt: j.published_date }));
}

export async function teamtailor(slug: string): Promise<RawJob[]> {
  const items = rssItems(await politeGet(`https://${encodeURIComponent(slug)}.teamtailor.com/jobs.rss`, 6 * HOUR, "application/rss+xml"));
  return items.map((it) => mkJob("greenhouse", `teamtailor-${slug}-${it.guid ?? it.link}`, { company: slug, title: String(it.title ?? ""), url: String(it.link), location: String(it["tt:location"] ?? it.location ?? ""), html: String(it.description ?? ""), postedAt: it.pubDate ? new Date(String(it.pubDate)).toISOString() : undefined }));
}

export async function bamboohr(slug: string): Promise<RawJob[]> {
  const data = JSON.parse(await politeGet(`https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`, 6 * HOUR)) as { result?: { id: string; jobOpeningName: string; location?: { city?: string; state?: string; country?: string }; isRemote?: boolean | null; locationType?: string }[] };
  return (data.result ?? []).map((j) =>
    mkJob("greenhouse", `bamboohr-${slug}-${j.id}`, {
      company: slug,
      title: j.jobOpeningName,
      url: `https://${slug}.bamboohr.com/careers/${j.id}`,
      location: [j.isRemote || j.locationType === "1" ? "Remote" : "", [j.location?.city, j.location?.state, j.location?.country].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
      text: "",
    }),
  );
}

export async function smartrecruiters(slug: string): Promise<RawJob[]> {
  const data = JSON.parse(await politeGet(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`, 6 * HOUR)) as { content?: { id: string; name: string; company?: { name?: string }; location?: { city?: string; country?: string; remote?: boolean; fullLocation?: string }; releasedDate?: string }[] };
  return (data.content ?? []).map((j) =>
    mkJob("greenhouse", `smartrecruiters-${slug}-${j.id}`, {
      company: j.company?.name ?? slug,
      title: j.name,
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
      location: [j.location?.remote ? "Remote" : "", j.location?.fullLocation ?? [j.location?.city, j.location?.country].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
      text: "",
      postedAt: j.releasedDate,
    }),
  );
}

// ── Newly funded companies ───────────────────────────────────────────────────

const FUNDING_FEEDS = ["https://techcrunch.com/tag/funding/feed/", "https://techcrunch.com/category/startups/feed/", "https://www.prnewswire.com/rss/venture-capital-list.rss"];

/** Company names from recent funding headlines ("Acme raises $20M Series A…"). */
export async function recentlyFunded(): Promise<{ company: string; headline: string; link: string }[]> {
  const out = new Map<string, { company: string; headline: string; link: string }>();
  for (const f of FUNDING_FEEDS) {
    let items: ReturnType<typeof rssItems> = [];
    try {
      items = rssItems(await politeGet(f, 6 * HOUR, "application/rss+xml"));
    } catch {
      continue;
    }
    for (const it of items) {
      const title = htmlToText(String(it.title ?? "")).text;
      const m = title.replace(/^(?:[\w.&'’ ]+-backed|YC-backed|Y Combinator-backed)\s+/i, "").match(/^(?:[A-Z][\w-]*\s+(?:startup|fintech|company|platform)\s+)?([A-Z][\w.&'’-]*(?:\s+[A-Z][\w.&'’-]*){0,3})\s*(?:,[^,]{0,60},)?\s+(?:raises|lands|secures|nabs|bags|closes|snags|grabs|picks up|gets|announces)\b[^$€£₦]{0,30}[$€£₦]\s?\d/);
      if (!m) continue;
      const company = m[1].replace(/['’]s$/, "").replace(/^[\w\s.&'’-]*?-backed\s+/i, "").trim();
      if (company.length < 2 || /^(The|This|How|Why|What|AI|A)$/i.test(company)) continue;
      out.set(company.toLowerCase(), { company, headline: title, link: String(it.link ?? "") });
    }
  }
  return [...out.values()];
}
