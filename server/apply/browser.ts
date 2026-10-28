import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, type Frame, type Page, chromium } from "playwright";
import { DATA_DIR } from "../store.js";
import { JOB_BOARD_HOSTS } from "../guardrails.js";
import { checkRobots } from "../sources/http.js";
import type { FormField } from "./mapper.js";

/** URLs the browser refused to open because the site's robots.txt disallows them. */
export const robotsBlocked = new Set<string>();

let ctx: BrowserContext | null = null;
let ctxHeadless = false;

/**
 * A visible browser with its own profile folder (data/browser-profile), separate from your
 * everyday browser. Uses your installed Chrome by default (Playwright's bundled Chromium
 * doesn't run on macOS 13), falling back to Edge or bundled Chromium.
 */
export async function getContext(channel: "chrome" | "msedge" | "chromium" = "chrome", headless = false): Promise<BrowserContext> {
  if (ctx && ctxHeadless !== headless) {
    // Switched between visible and background: reopen the browser in the new mode.
    await ctx.close().catch(() => {});
    ctx = null;
  }
  if (ctx) return ctx;
  ctxHeadless = headless;
  const dir = path.join(DATA_DIR, "browser-profile");
  fs.mkdirSync(dir, { recursive: true });
  const order = [channel, ...(["chrome", "msedge", "chromium"] as const).filter((c) => c !== channel)];
  let lastErr: unknown;
  for (const ch of order) {
    try {
      ctx = await chromium.launchPersistentContext(dir, {
        headless,
        ...(ch === "chromium" ? {} : { channel: ch }),
        viewport: { width: 1280, height: 900 },
        acceptDownloads: false,
      });
      ctx.on("close", () => (ctx = null));
      // Job boards: obey robots.txt for every page the browser opens there (e.g. Himalayas disallows /apply).
      await ctx.route(
        (url) => JOB_BOARD_HOSTS.test(url.hostname),
        async (route) => {
          if (route.request().resourceType() !== "document") return route.continue();
          try {
            await checkRobots(new URL(route.request().url()));
            return route.continue();
          } catch {
            robotsBlocked.add(route.request().url());
            return route.abort("blockedbyclient");
          }
        },
      );
      return ctx;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Couldn't open a browser. Install Google Chrome, or run "npx playwright install chromium". (${(lastErr as Error)?.message?.split("\n")[0]})`);
}

export function isHeadless(): boolean {
  return !!ctx && ctxHeadless;
}

export async function closeBrowser(): Promise<void> {
  await ctx?.close().catch(() => {});
  ctx = null;
}

const READER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "dom-reader.js"), "utf8");

export async function readForm(page: Page): Promise<FormField[]> {
  const frames = page.frames();
  const all: FormField[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (/recaptcha|hcaptcha|challenges\.cloudflare|google\.com\/maps|youtube/.test(f.url())) continue;
    try {
      const fields = (await f.evaluate(READER)) as Omit<FormField, "frame">[];
      for (const x of fields) all.push({ ...x, frame: i });
    } catch {
      /* cross-origin frame we can't read, or navigated away */
    }
  }
  return all;
}

export function locate(page: Page, f: Pick<FormField, "frame" | "id">, id = f.id) {
  const frame: Frame = page.frames()[f.frame] ?? page.mainFrame();
  return frame.locator(`[data-jp-id="${id}"]`).first();
}

export async function pageText(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const f of page.frames()) {
    try {
      parts.push(await f.evaluate(() => document.body?.innerText ?? ""));
    } catch {
      /* ignore */
    }
  }
  return parts.join("\n");
}

/** Hidden text in the page (where instructions to AI tend to be planted). */
export async function hiddenText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("body *").forEach((el) => {
        const cs = getComputedStyle(el);
        const t = (el as HTMLElement).innerText ?? el.textContent ?? "";
        if (!t.trim() || el.children.length > 3) return;
        const tiny = parseFloat(cs.fontSize) < 2;
        const invisible = cs.opacity === "0" || cs.color === cs.backgroundColor || cs.clip === "rect(0px, 0px, 0px, 0px)";
        if ((tiny || invisible) && t.length > 20) out.push(t.trim());
      });
      return out.slice(0, 20).join("\n");
    });
  } catch {
    return "";
  }
}

export interface Blocker {
  kind: "captcha" | "login" | "none";
  detail: string;
}

export async function detectBlocker(page: Page): Promise<Blocker> {
  const frames = page.frames().map((f) => f.url());
  if (frames.some((u) => /recaptcha\/api2\/bframe|hcaptcha\.com\/captcha|challenges\.cloudflare\.com/.test(u))) {
    // Invisible reCAPTCHA badges are fine; a visible challenge frame isn't.
    const visibleChallenge = await page
      .locator("iframe[src*='bframe'], iframe[src*='hcaptcha.com/captcha'], iframe[src*='challenges.cloudflare.com']")
      .first()
      .isVisible()
      .catch(() => false);
    if (visibleChallenge) return { kind: "captcha", detail: "A CAPTCHA appeared." };
  }
  const text = (await pageText(page)).slice(0, 20000);
  if (/verify (?:you are|you're) (?:a )?human|are you a robot|complete the security check|press and hold/i.test(text)) return { kind: "captcha", detail: "The site wants a human check." };
  const pw = await page.locator("input[type=password]").first().isVisible().catch(() => false);
  if (pw) return { kind: "login", detail: "The site asks you to sign in or create an account." };
  if (/(?:sign in|log in|create an account|register) to apply/i.test(text)) return { kind: "login", detail: "The site asks you to sign in to apply." };
  return { kind: "none", detail: "" };
}
