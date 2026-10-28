// "Is this posting still open?" Checked right before applying, so no time is spent on expired roles.
// Uses the ATS's public API when we know it (exact), otherwise one GET of the posting page.

import { USER_AGENT, checkRobots, htmlToText } from "./sources/http.js";
import type { Job } from "./types.js";

export interface Liveness {
  open: boolean | null; // null = couldn't tell (we don't block on that)
  reason: string;
}

const CLOSED_TEXT =
  /(?:job|position|posting|role|vacancy|opening)\s+(?:is\s+)?(?:no longer (?:available|open|active|accepting)|has been (?:filled|closed|removed)|(?:is\s+)?closed|expired)|no longer accepting applications|this job (?:has )?expired|page (?:you(?:'re| are) looking for )?(?:was )?not found|couldn['’]t find (?:that|this) job|job not found/i;

async function get(url: string): Promise<{ status: number; finalUrl: string; text: string }> {
  await checkRobots(new URL(url));
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/json" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  const text = res.ok ? (await res.text()).slice(0, 400_000) : "";
  return { status: res.status, finalUrl: res.url, text };
}

export async function checkLiveness(job: Pick<Job, "url" | "applyUrl" | "ats">): Promise<Liveness> {
  try {
    // Exact answers from public ATS APIs.
    const gh = job.applyUrl.match(/greenhouse\.io\/embed\/job_app\?for=([\w-]+)&token=(\d+)/) ?? job.url.match(/greenhouse\.io\/([\w-]+)\/jobs\/(\d+)/);
    if (gh) {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`);
      return r.status === 404 ? { open: false, reason: "Greenhouse says this job no longer exists" } : r.status < 400 ? { open: true, reason: "Listed on Greenhouse" } : { open: null, reason: `Greenhouse answered ${r.status}` };
    }
    const lv = job.applyUrl.match(/jobs\.lever\.co\/([\w.-]+)\/([0-9a-f-]{36})/);
    if (lv) {
      const r = await get(`https://api.lever.co/v0/postings/${lv[1]}/${lv[2]}`);
      return r.status === 404 ? { open: false, reason: "Lever says this posting is gone" } : r.status < 400 ? { open: true, reason: "Listed on Lever" } : { open: null, reason: `Lever answered ${r.status}` };
    }
    const ab = job.applyUrl.match(/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/);
    if (ab) {
      const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${ab[1]}`);
      if (r.status === 200) return r.text.includes(ab[2]) ? { open: true, reason: "Listed on Ashby" } : { open: false, reason: "No longer on the company's Ashby board" };
      return { open: null, reason: `Ashby answered ${r.status}` };
    }
    // Anything else: the posting page itself.
    const r = await get(job.url || job.applyUrl);
    if (r.status === 404 || r.status === 410) return { open: false, reason: `The posting page is gone (${r.status})` };
    if (r.status >= 400) return { open: null, reason: `The page answered ${r.status}` };
    const { text } = htmlToText(r.text);
    if (CLOSED_TEXT.test(text.slice(0, 20000))) return { open: false, reason: `The page says: "${text.match(CLOSED_TEXT)![0]}"` };
    return { open: true, reason: "The posting page is up" };
  } catch (e) {
    return { open: null, reason: (e as Error).message.slice(0, 120) };
  }
}
