// Never apply to the same role twice: the same job can turn up on several sources (a job board and the
// employer's own board), or come back in a later search.

import { normalizeCompany } from "./guardrails.js";
import type { Job } from "./types.js";

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !["remote", "the", "and", "for", "of", "temp", "to", "perm", "contract", "full", "time"].includes(w)),
  );

function sameTitle(a: string, b: string): boolean {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size) >= 0.8;
}

const cleanUrl = (u: string) => u.replace(/[?#].*$/, "").replace(/\/(apply|application|c\/new)\/?$/, "").replace(/\/$/, "").toLowerCase();

/** An application you've already made for this role (by YouHired or marked "I applied myself"). */
export function alreadyApplied(job: Pick<Job, "id" | "company" | "title" | "applyUrl" | "url">, all: Job[]): Job | undefined {
  const c = normalizeCompany(job.company);
  const urls = new Set([cleanUrl(job.applyUrl), cleanUrl(job.url)]);
  return all.find(
    (o) =>
      o.id !== job.id &&
      o.status === "applied" &&
      ((c && normalizeCompany(o.company) === c && sameTitle(o.title, job.title)) || urls.has(cleanUrl(o.applyUrl)) || urls.has(cleanUrl(o.url))),
  );
}

export function appliedReason(o: Job): string {
  return `Already applied to this role on ${new Date(o.statusDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })} (${o.title} at ${o.company}). YouHired never applies twice.`;
}
