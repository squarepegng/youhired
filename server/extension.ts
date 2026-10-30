// Link to the YouHired Chrome extension, so applications can run in a tab of your everyday Chrome
// (your profile, your sign-ins) instead of YouHired's automation-controlled browser.
//
// The extension long-polls this server for commands and posts results back. Every request carries a
// pairing code that only you copy from YouHired's Settings into the extension; anything without it is refused.
// The server only listens on localhost.

import crypto from "node:crypto";
import fs from "node:fs";
import type { Blocker } from "./apply/browser.js";
import { CHALLENGE_FRAME, type Driver, type El, type Snapshot, classifyPage, looksSubmittedText } from "./apply/driver.js";
import { load, update } from "./store.js";

type Command = { id: string; op: string; args: Record<string, unknown> };
const waiting: Command[] = [];
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const pollers: ((c: Command | null) => void)[] = [];
let lastSeen = 0;
let extVersion = "";

export function pairingCode(): string {
  let code = load().settings.extensionCode;
  if (!code) {
    code = crypto.randomBytes(12).toString("base64url");
    update((s) => void (s.settings.extensionCode = code));
  }
  return code;
}

export function authorised(code: string | undefined): boolean {
  const want = pairingCode();
  return !!code && code.length === want.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(want));
}

export function extensionStatus(): { connected: boolean; lastSeen: number; version: string } {
  // Connected = the extension is waiting for work right now, or checked in recently.
  return { connected: pollers.length > 0 || Date.now() - lastSeen < 45_000, lastSeen, version: extVersion };
}

export function extensionConnected(): boolean {
  return extensionStatus().connected;
}

/** The extension asks for work. Resolves with a command, or null after ~20s so it can ask again. */
export function poll(version: string): Promise<Command | null> {
  lastSeen = Date.now();
  extVersion = version;
  const next = waiting.shift();
  if (next) return Promise.resolve(next);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      const i = pollers.indexOf(fn);
      if (i >= 0) pollers.splice(i, 1);
      lastSeen = Date.now();
      resolve(null);
    }, 20_000);
    const fn = (c: Command | null) => {
      clearTimeout(t);
      resolve(c);
    };
    pollers.push(fn);
  });
}

export function deliver(id: string, ok: boolean, value: unknown, error?: string): void {
  lastSeen = Date.now();
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (ok) p.resolve(value);
  else p.reject(new Error(error || "The extension couldn't do that"));
}

export function send<T = unknown>(op: string, args: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<T> {
  if (!extensionConnected()) return Promise.reject(new Error("The YouHired Chrome extension isn't connected. Open Chrome, and check the extension is installed and paired (Settings → Your Chrome)."));
  const cmd: Command = { id: crypto.randomUUID(), op, args };
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(cmd.id);
      reject(new Error(`Chrome didn't answer in time (${op})`));
    }, timeoutMs);
    pending.set(cmd.id, { resolve: resolve as (v: unknown) => void, reject, timer });
    const poller = pollers.shift();
    if (poller) poller(cmd);
    else waiting.push(cmd);
  });
}

// ── A tab in your Chrome, as an agent driver ──

interface FrameInfo {
  frameId: number;
  url: string;
}
interface Probe {
  url: string;
  text: string;
  passwordVisible: boolean;
  challengeVisible: boolean;
}

export class ExtensionDriver implements Driver {
  readonly kind = "extension" as const;
  private currentUrl = "";
  private frames: FrameInfo[] = [];

  private constructor(readonly tabId: number) {}

  /** Open the application in a new tab of your Chrome. */
  static async open(url: string): Promise<ExtensionDriver> {
    const r = await send<{ tabId: number }>("openTab", { url }, 60_000);
    const d = new ExtensionDriver(r.tabId);
    d.currentUrl = url;
    return d;
  }

  static attach(tabId: number): ExtensionDriver {
    return new ExtensionDriver(tabId);
  }

  private exec<T>(op: string, args: unknown[] = [], frameId = 0, timeout = 30_000): Promise<T> {
    return send<T>("exec", { tabId: this.tabId, frameId, op, args }, timeout);
  }

  url(): string {
    return this.currentUrl;
  }

  async settle(): Promise<void> {
    const r = await send<{ url: string; frames: FrameInfo[] }>("settle", { tabId: this.tabId }, 40_000);
    this.currentUrl = r.url;
    this.frames = r.frames.filter((f) => f.frameId === 0 || !/recaptcha|hcaptcha|challenges\.cloudflare|google\.com\/maps|youtube|doubleclick|googletagmanager|facebook|stripe/.test(f.url));
  }

  wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async snapshot(): Promise<Snapshot> {
    if (!this.frames.length) await this.settle();
    let main: Snapshot | null = null;
    const elements: El[] = [];
    const texts: string[] = [];
    for (const f of this.frames) {
      try {
        const snap = await this.exec<Snapshot>("snapshot", [elements.length], f.frameId);
        for (const e of snap.elements) elements.push({ ...e, frame: f.frameId });
        if (f.frameId === 0) main = snap;
        else if (snap.elements.length) texts.push(snap.text);
      } catch {
        /* frame went away */
      }
    }
    if (!main) throw new Error("Page not readable");
    this.currentUrl = main.url;
    return { ...main, elements, text: [main.text, ...texts].join("\n").slice(0, 5000) };
  }

  async click(el: El): Promise<void> {
    await this.exec("click", [el.id], el.frame ?? 0);
  }
  async check(el: El): Promise<void> {
    await this.exec("check", [el.id], el.frame ?? 0);
  }
  async type(el: El, value: string): Promise<void> {
    await this.exec("type", [el.id, value], el.frame ?? 0);
  }
  async select(el: El, label: string): Promise<void> {
    await this.exec("select", [el.id, label], el.frame ?? 0);
  }
  async upload(el: El, file: string): Promise<void> {
    const data = fs.readFileSync(file).toString("base64");
    const name = file.split("/").pop() ?? "file";
    const type = /\.pdf$/i.test(name) ? "application/pdf" : /\.docx$/i.test(name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain";
    await this.exec("upload", [el.id, { name, type, data }], el.frame ?? 0, 60_000);
  }
  async scroll(dy: number): Promise<void> {
    await this.exec("scroll", [dy]);
  }
  async back(): Promise<void> {
    await this.exec("back").catch(() => {});
  }
  async pressEnter(): Promise<void> {
    await this.exec("enter");
  }
  async screenshot(): Promise<Buffer | null> {
    // Only possible when the tab is visible; the agent works fine without it.
    const r = await send<{ dataUrl: string | null }>("capture", { tabId: this.tabId }, 15_000).catch(() => null);
    return r?.dataUrl ? Buffer.from(r.dataUrl.split(",")[1], "base64") : null;
  }
  private async probe(): Promise<Probe> {
    const r = await this.exec<Probe>("probe");
    this.currentUrl = r.url;
    return { ...r, challengeVisible: r.challengeVisible || false };
  }
  async blocker(): Promise<Blocker> {
    const p = await this.probe();
    // A visible challenge frame (reCAPTCHA image grid, hCaptcha, Cloudflare)?
    const challengeFrame = this.frames.some((f) => CHALLENGE_FRAME.test(f.url));
    return classifyPage({ ...p, challengeVisible: p.challengeVisible && challengeFrame ? true : p.challengeVisible });
  }
  async submitted(): Promise<boolean> {
    const p = await this.probe();
    return looksSubmittedText(p.url, p.text);
  }
  takeRobotsBlock(): string | null {
    return null; // your own browser: navigation is yours, like any tab you open
  }
  async focus(): Promise<void> {
    await send("focus", { tabId: this.tabId }).catch(() => {});
  }
}
