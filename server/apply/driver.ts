// What the AI agent needs from a browser, so the same agent can drive either JobPilot's own browser
// (Playwright) or a tab in your everyday Chrome (through the JobPilot extension).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { type Blocker, detectBlocker, robotsBlocked } from "./browser.js";
import { looksSubmitted } from "./filler.js";

export interface El {
  id: number;
  kind: string;
  label: string;
  href?: string;
  value?: string;
  options?: string[];
  checked?: boolean;
  required?: boolean;
  password?: boolean;
  file?: string;
  disabled?: boolean;
  inView?: boolean;
  frame?: number;
}

export interface Snapshot {
  url: string;
  title: string;
  elements: El[];
  text: string;
  scrollable: boolean;
}

export interface Driver {
  readonly kind: "playwright" | "extension";
  url(): string;
  settle(): Promise<void>;
  wait(ms: number): Promise<void>;
  snapshot(): Promise<Snapshot>;
  click(el: El): Promise<void>;
  check(el: El): Promise<void>;
  type(el: El, value: string): Promise<void>;
  select(el: El, label: string): Promise<void>;
  upload(el: El, file: string): Promise<void>;
  scroll(dy: number): Promise<void>;
  back(): Promise<void>;
  pressEnter(): Promise<void>;
  screenshot(): Promise<Buffer | null>;
  blocker(): Promise<Blocker>;
  submitted(): Promise<boolean>;
  /** A page the site's robots.txt asked us not to open (job boards). */
  takeRobotsBlock(): string | null;
  /** Bring the window/tab to the front (for a human step). */
  focus(): Promise<void>;
}

// ── Shared page checks (same wording rules for both drivers) ──

export const SUCCESS_TEXT =
  /thank(?:s| you)(?: so much)? for (?:applying|your (?:application|interest))|application (?:has been |was )?(?:submitted|received)|we(?:'ve| have) received your application|successfully (?:submitted|applied)|your application is on its way/i;
export const HUMAN_CHECK_TEXT = /verify (?:you are|you're) (?:a )?human|are you a robot|complete the security check|press and hold/i;
export const CHALLENGE_FRAME = /recaptcha\/(?:api2|enterprise)\/bframe|hcaptcha\.com\/captcha|challenges\.cloudflare\.com/;

export function classifyPage(p: { url: string; text: string; challengeVisible: boolean; passwordVisible: boolean }): Blocker {
  if (p.challengeVisible) return { kind: "captcha", detail: "A CAPTCHA appeared." };
  if (HUMAN_CHECK_TEXT.test(p.text.slice(0, 20000))) return { kind: "captcha", detail: "The site wants a human check." };
  if (p.passwordVisible) return { kind: "login", detail: "The site asks you to sign in or create an account." };
  if (/(?:sign in|log in|create an account|register) to apply/i.test(p.text)) return { kind: "login", detail: "The site asks you to sign in to apply." };
  return { kind: "none", detail: "" };
}

export function looksSubmittedText(url: string, text: string): boolean {
  return /confirmation|thank|success|submitted/i.test(url) || SUCCESS_TEXT.test(text);
}

// ── Playwright ──

const READER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-reader.js"), "utf8");

export class PlaywrightDriver implements Driver {
  readonly kind = "playwright" as const;
  page: Page;
  private onPage = (np: Page) => {
    this.page = np;
    this.onNewTab?.(np.url());
  };

  constructor(
    page: Page,
    private onNewTab?: (url: string) => void,
  ) {
    this.page = page;
    page.setDefaultTimeout(10_000);
    // New tabs ("Apply" links with target=_blank) become the page we work on.
    page.context().on("page", this.onPage);
    robotsBlocked.clear();
  }

  dispose(): void {
    this.page.context().off("page", this.onPage);
  }

  url(): string {
    return this.page.url();
  }
  async settle(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForTimeout(700);
  }
  wait(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms);
  }

  /** Read the main page and every embedded frame (many career sites put the form in an iframe). */
  async snapshot(): Promise<Snapshot> {
    const frames = this.page.frames();
    let main: Snapshot | null = null;
    const elements: El[] = [];
    const texts: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (i > 0 && /recaptcha|hcaptcha|challenges\.cloudflare|google\.com\/maps|youtube|doubleclick|googletagmanager|facebook|stripe/.test(f.url())) continue;
      try {
        const snap = (await f.evaluate(READER.replace("let n = 0;", `let n = ${elements.length};`))) as Snapshot;
        for (const e of snap.elements) elements.push({ ...e, frame: i });
        if (i === 0) main = snap;
        else if (snap.elements.length) texts.push(snap.text);
      } catch {
        /* frame not ready */
      }
    }
    if (!main) throw new Error("Page not readable");
    return { ...main, elements, text: [main.text, ...texts].join("\n").slice(0, 5000) };
  }

  private loc(el: El) {
    return (this.page.frames()[el.frame ?? 0] ?? this.page.mainFrame()).locator(`[data-jp-a="${el.id}"]`).first();
  }
  async click(el: El): Promise<void> {
    const t = this.loc(el);
    await t.click({ timeout: 6000 }).catch(async () => t.click({ force: true, timeout: 3000 }));
    await this.page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  }
  async check(el: El): Promise<void> {
    const t = this.loc(el);
    await t.check({ force: true }).catch(() => t.click({ force: true }));
  }
  async type(el: El, value: string): Promise<void> {
    const t = this.loc(el);
    await t.click({ timeout: 5000 }).catch(() => {});
    await t.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await t.press("Backspace").catch(() => {});
    if (value.length > 300) {
      await this.page.keyboard.insertText(value.slice(0, -15));
      await t.pressSequentially(value.slice(-15), { delay: 10 });
    } else await t.pressSequentially(value, { delay: 15 });
  }
  async select(el: El, label: string): Promise<void> {
    await this.loc(el).selectOption({ label });
  }
  async upload(el: El, file: string): Promise<void> {
    const t = this.loc(el);
    if (el.kind === "file") return t.setInputFiles(file);
    const [chooser] = await Promise.all([this.page.waitForEvent("filechooser", { timeout: 5000 }), t.click()]);
    await chooser.setFiles(file);
  }
  scroll(dy: number): Promise<void> {
    return this.page.mouse.wheel(0, dy);
  }
  async back(): Promise<void> {
    await this.page.goBack().catch(() => {});
  }
  pressEnter(): Promise<void> {
    return this.page.keyboard.press("Enter");
  }
  async screenshot(): Promise<Buffer | null> {
    return this.page.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
  }
  blocker(): Promise<Blocker> {
    return detectBlocker(this.page);
  }
  submitted(): Promise<boolean> {
    return looksSubmitted(this.page);
  }
  takeRobotsBlock(): string | null {
    const b = [...robotsBlocked][0] ?? null;
    robotsBlocked.clear();
    return b;
  }
  async focus(): Promise<void> {
    await this.page.bringToFront().catch(() => {});
  }
}
