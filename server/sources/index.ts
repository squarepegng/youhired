// Public job sources. Each returns raw postings; search.ts filters, scores and stores them.
// Only official public APIs/feeds are used. robots.txt and rate limits are honoured in http.ts.

import { XMLParser } from "fast-xml-parser";
import { detectAts, hostNeedsLogin } from "../guardrails.js";
import type { Job, SearchPrefs, SourceId } from "../types.js";
import { htmlToText, politeGet } from "./http.js";

export type RawJob = Omit<Job, "status" | "statusDate" | "foundAt" | "flags"> & { hiddenText: string[] };

const HOUR = 3600_000;

function mk(
  source: SourceId,
  externalId: string | number,
  f: { company: string; title: string; url: string; applyUrl?: string; location: string; html?: string; text?: string; postedAt?: string; salaryText?: string; salaryMin?: number | null },
): RawJob {
  const { text, hidden } = f.html !== undefined ? htmlToText(f.html) : { text: f.text ?? "", hidden: [] };
  const applyUrl = f.applyUrl || f.url;
  return {
    id: `${source}:${externalId}`,
    source,
    company: f.company.trim(),
    title: f.title.trim(),
    url: f.url,
    applyUrl,
    location: (f.location || "").trim(),
    description: text,
    hiddenText: hidden,
    postedAt: f.postedAt,
    salaryText: f.salaryText,
    salaryMin: f.salaryMin ?? null,
    ats: detectAts(applyUrl),
    needsLogin: hostNeedsLogin(applyUrl),
  };
}

export async function greenhouse(board: string): Promise<RawJob[]> {
  const body = await politeGet(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`, 6 * HOUR);
  const data = JSON.parse(body) as { jobs: { id: number; title: string; absolute_url: string; location?: { name: string }; updated_at?: string; first_published?: string; company_name?: string; content?: string }[] };
  return (data.jobs ?? []).map((j) =>
    mk("greenhouse", `${board}-${j.id}`, {
      company: j.company_name || board,
      title: j.title,
      url: j.absolute_url,
      // The hosted Greenhouse form (no login), even when the posting lives on the company's own site.
      applyUrl: `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${j.id}`,
      location: j.location?.name ?? "",
      html: j.content ?? "",
      postedAt: j.first_published || j.updated_at,
    }),
  );
}

export async function lever(company: string): Promise<RawJob[]> {
  const body = await politeGet(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`, 6 * HOUR);
  const data = JSON.parse(body) as {
    id: string; text: string; hostedUrl: string; applyUrl: string; createdAt?: number; workplaceType?: string; country?: string;
    categories?: { location?: string; allLocations?: string[]; commitment?: string };
    descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string;
    salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  }[];
  if (!Array.isArray(data)) return [];
  return data.map((j) => {
    const locs = j.categories?.allLocations?.length ? j.categories.allLocations.join(" / ") : j.categories?.location ?? "";
    const lists = (j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content).text}`).join("\n\n");
    const sr = j.salaryRange;
    return mk("lever", `${company}-${j.id}`, {
      company,
      title: j.text,
      url: j.hostedUrl,
      applyUrl: j.applyUrl,
      location: [j.workplaceType === "remote" ? "Remote" : "", locs].filter(Boolean).join(" — "),
      text: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n"),
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      salaryText: sr?.min ? `${sr.currency ?? ""} ${sr.min}–${sr.max ?? ""} ${sr.interval ?? ""}`.trim() : undefined,
      salaryMin: sr?.min ?? null,
    });
  });
}

export async function ashby(org: string): Promise<RawJob[]> {
  const body = await politeGet(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`, 6 * HOUR);
  const data = JSON.parse(body) as {
    jobs: {
      id: string; title: string; location?: string; secondaryLocations?: { location: string }[]; isRemote?: boolean; workplaceType?: string;
      jobUrl: string; applyUrl: string; descriptionPlain?: string; descriptionHtml?: string; publishedAt?: string; isListed?: boolean;
      employmentType?: string; compensation?: { compensationTierSummary?: string; summaryComponents?: { minValue?: number; compensationType?: string }[] };
    }[];
  };
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const locs = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join(" / ");
      const salMin = j.compensation?.summaryComponents?.find((c) => c.compensationType === "Salary")?.minValue ?? null;
      return mk("ashby", `${org}-${j.id}`, {
        company: org,
        title: j.title,
        url: j.jobUrl,
        applyUrl: j.applyUrl || `${j.jobUrl}/application`,
        location: [j.isRemote || j.workplaceType === "Remote" ? "Remote" : "", locs].filter(Boolean).join(" — "),
        ...(j.descriptionHtml ? { html: j.descriptionHtml } : { text: j.descriptionPlain ?? "" }),
        postedAt: j.publishedAt,
        salaryText: j.compensation?.compensationTierSummary,
        salaryMin: salMin,
      });
    });
}

// Remotive asks for attribution, a link back, and at most ~4 fetches a day. Its robots.txt
// currently disallows /api/* for all bots, so politeGet will refuse and the UI shows why.
export async function remotive(query: string): Promise<RawJob[]> {
  const body = await politeGet(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=100`, 8 * HOUR);
  const data = JSON.parse(body) as { jobs: { id: number; url: string; title: string; company_name: string; publication_date?: string; candidate_required_location?: string; salary?: string; description?: string }[] };
  return (data.jobs ?? []).map((j) =>
    mk("remotive", j.id, { company: j.company_name, title: j.title, url: j.url, location: j.candidate_required_location ?? "", html: j.description ?? "", postedAt: j.publication_date, salaryText: j.salary || undefined }),
  );
}

// RemoteOK: link back to the posting and credit Remote OK (we show "via Remote OK" with the link).
export async function remoteok(): Promise<RawJob[]> {
  const body = await politeGet("https://remoteok.com/api", 6 * HOUR);
  const data = JSON.parse(body) as { id?: string; legal?: string; company?: string; position?: string; url?: string; apply_url?: string; location?: string; description?: string; date?: string; salary_min?: number; salary_max?: number }[];
  return data
    .filter((j) => j.id && j.position)
    .map((j) =>
      mk("remoteok", j.id!, {
        company: j.company ?? "",
        title: j.position!,
        url: j.url ?? `https://remoteok.com/remote-jobs/${j.id}`,
        applyUrl: j.apply_url || j.url,
        location: j.location ?? "",
        html: j.description ?? "",
        postedAt: j.date,
        salaryText: j.salary_min ? `USD ${j.salary_min}–${j.salary_max}` : undefined,
        salaryMin: j.salary_min || null,
      }),
    );
}

// Himalayas: attribution + link back to himalayas.app required.
export async function himalayas(query: string): Promise<RawJob[]> {
  const body = await politeGet(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(query)}&sort=recent`, 6 * HOUR);
  const data = JSON.parse(body) as {
    jobs: { guid: string; title: string; companyName: string; applicationLink: string; locationRestrictions?: string[]; timezoneRestrictions?: number[]; description?: string; pubDate?: number; minSalary?: number; maxSalary?: number; currency?: string }[];
  };
  return (data.jobs ?? []).map((j) => {
    const loc = j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "Worldwide";
    return mk("himalayas", j.guid, {
      company: j.companyName,
      title: j.title,
      url: j.guid?.startsWith("http") ? j.guid : j.applicationLink,
      applyUrl: j.applicationLink,
      location: loc,
      html: j.description ?? "",
      postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : undefined,
      salaryText: j.minSalary ? `${j.currency ?? ""} ${j.minSalary}–${j.maxSalary ?? ""}`.trim() : undefined,
      salaryMin: j.minSalary ?? null,
    });
  });
}

const WWR_FEEDS: Record<string, string> = {
  design: "https://weworkremotely.com/categories/remote-design-jobs.rss",
  programming: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  product: "https://weworkremotely.com/categories/remote-product-jobs.rss",
  all: "https://weworkremotely.com/remote-jobs.rss",
};

export function wwrFeedFor(titles: string[]): string {
  const t = titles.join(" ").toLowerCase();
  if (/design|ux|ui\b/.test(t)) return WWR_FEEDS.design;
  if (/engineer|developer|programmer/.test(t)) return WWR_FEEDS.programming;
  if (/product manager/.test(t)) return WWR_FEEDS.product;
  return WWR_FEEDS.all;
}

export async function wwr(titles: string[]): Promise<RawJob[]> {
  const xml = await politeGet(wwrFeedFor(titles), 2 * HOUR, "application/rss+xml");
  const parsed = new XMLParser({ ignoreAttributes: true }).parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const raw = parsed.rss?.channel?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { title: string; link: string; guid?: string; region?: string; country?: string; description?: string; pubDate?: string }[];
  return items.map((it) => {
    const [company, ...rest] = String(it.title).split(":");
    return mk("wwr", String(it.guid ?? it.link).split("/").pop() ?? it.link, {
      company: rest.length ? company : "",
      title: rest.length ? rest.join(":") : String(it.title),
      url: it.link,
      location: [it.region, it.country].filter(Boolean).join(" — "),
      html: String(it.description ?? ""),
      postedAt: it.pubDate ? new Date(it.pubDate).toISOString() : undefined,
    });
  });
}

export const SOURCE_LABELS: Record<SourceId, string> = {
  greenhouse: "Greenhouse boards",
  lever: "Lever boards",
  ashby: "Ashby boards",
  remotive: "Remotive",
  remoteok: "Remote OK",
  himalayas: "Himalayas",
  wwr: "We Work Remotely",
};

/** Run every enabled source. Errors are collected per source, never fatal. */
export async function fetchAll(prefs: SearchPrefs, log: (m: string) => void): Promise<{ jobs: RawJob[]; errors: string[] }> {
  const tasks: [string, () => Promise<RawJob[]>][] = [];
  if (prefs.sources.greenhouse) for (const b of prefs.greenhouseBoards) tasks.push([`Greenhouse/${b}`, () => greenhouse(b)]);
  if (prefs.sources.lever) for (const c of prefs.leverCompanies) tasks.push([`Lever/${c}`, () => lever(c)]);
  if (prefs.sources.ashby) for (const o of prefs.ashbyOrgs) tasks.push([`Ashby/${o}`, () => ashby(o)]);
  if (prefs.sources.remotive) for (const t of prefs.titles) tasks.push([`Remotive "${t}"`, () => remotive(t)]);
  if (prefs.sources.remoteok) tasks.push(["Remote OK", () => remoteok()]);
  if (prefs.sources.himalayas) for (const t of prefs.titles) tasks.push([`Himalayas "${t}"`, () => himalayas(t)]);
  if (prefs.sources.wwr) tasks.push(["We Work Remotely", () => wwr(prefs.titles)]);

  const jobs: RawJob[] = [];
  const errors: string[] = [];
  // A few at a time; http.ts spaces requests to the same host.
  const queue = [...tasks];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const [name, fn] = queue.shift()!;
        try {
          const got = await fn();
          log(`${name}: ${got.length} postings`);
          jobs.push(...got);
        } catch (e) {
          const msg = `${name}: ${(e as Error).message}`;
          errors.push(msg);
          log(msg);
        }
      }
    }),
  );
  return { jobs, errors };
}
