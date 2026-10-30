// Connected sites: job platforms that need an account. You sign in yourself, once, in YouHired's own
// browser window. The session is kept in data/browser-profile, so the agent can apply there later
// without ever seeing or typing your password. YouHired never creates accounts.

import { closeBrowser, getContext } from "./apply/browser.js";
import { currentApply } from "./apply/queue.js";
import { load, update } from "./store.js";

export interface SiteInfo {
  id: string;
  name: string;
  host: string;
  loginUrl: string;
  note: string;
}

export const SITES: SiteInfo[] = [
  { id: "wellfound", name: "Wellfound (AngelList Talent)", host: "wellfound.com", loginUrl: "https://wellfound.com/login", note: "Startup jobs, one-click apply after sign-in." },
  { id: "waas", name: "Work at a Startup (Y Combinator)", host: "workatastartup.com", loginUrl: "https://www.workatastartup.com/companies", note: "Every YC company hiring. Sign in with your YC account." },
  { id: "wwr", name: "We Work Remotely", host: "weworkremotely.com", loginUrl: "https://weworkremotely.com/job-seekers/account/login", note: "Its Apply button now needs a jobseeker account." },
  { id: "wttj", name: "Welcome to the Jungle (Otta)", host: "welcometothejungle.com", loginUrl: "https://app.welcometothejungle.com/", note: "Curated startup jobs with in-app applications." },
];

export function connectedHosts(): string[] {
  return (load().settings.connectedSites ?? []).map((s) => s.host);
}

/** Open a visible window at the site's sign-in page. The user signs in themselves. */
export async function openSignIn(id: string, customUrl?: string): Promise<void> {
  if (currentApply()) throw new Error("YouHired is applying right now. Try again when it's done.");
  const site = SITES.find((s) => s.id === id);
  const url = site?.loginUrl ?? customUrl;
  if (!url || !/^https:\/\//.test(url)) throw new Error("Pick a site, or give a full https:// link to its sign-in page.");
  // Sign-in always happens in a visible window, never in the background.
  await closeBrowser();
  const ctx = await getContext(load().settings.browserChannel, false);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.bringToFront().catch(() => {});
}

export function markConnected(id: string, customUrl?: string): void {
  const site = SITES.find((s) => s.id === id);
  const host = site?.host ?? new URL(customUrl ?? "").hostname.replace(/^www\./, "");
  update((s) => {
    s.settings.connectedSites = [...(s.settings.connectedSites ?? []).filter((x) => x.host !== host), { id: site?.id ?? host, name: site?.name ?? host, host, connectedAt: new Date().toISOString() }];
  });
}

export function disconnect(host: string): void {
  update((s) => void (s.settings.connectedSites = (s.settings.connectedSites ?? []).filter((x) => x.host !== host)));
}
