// Polite HTTP for public job sources: identifies itself, honours robots.txt,
// spaces out requests per host and caches responses so we don't hammer anyone.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../store.js";

export const USER_AGENT = "YouHired/0.1 (personal job search tool; runs locally for one person)";
const MIN_GAP_MS = 1500;
const lastHit = new Map<string, number>();
const robotsCache = new Map<string, { rules: { allow: boolean; path: string }[] }>();

export class BlockedByRobots extends Error {}

function parseRobots(txt: string): { allow: boolean; path: string }[] {
  // Rules for "*" (we don't have a named entry anywhere).
  const rules: { allow: boolean; path: string }[] = [];
  let applies = false;
  let sawRuleInGroup = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (sawRuleInGroup) {
        applies = false;
        sawRuleInGroup = false;
      }
      if (val === "*" || /youhired/i.test(val)) applies = true;
    } else if (key === "allow" || key === "disallow") {
      sawRuleInGroup = true;
      if (applies && val) rules.push({ allow: key === "allow", path: val });
    }
  }
  return rules;
}

export function robotsAllows(rules: { allow: boolean; path: string }[], pathname: string): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(pathname) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)))
      best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

export async function checkRobots(u: URL): Promise<void> {
  let entry = robotsCache.get(u.host);
  if (!entry) {
    let txt = "";
    try {
      const r = await fetch(`${u.protocol}//${u.host}/robots.txt`, { headers: { "user-agent": USER_AGENT } });
      if (r.ok) txt = await r.text();
    } catch {
      /* unreachable robots.txt = no rules */
    }
    entry = { rules: parseRobots(txt) };
    robotsCache.set(u.host, entry);
  }
  if (!robotsAllows(entry.rules, u.pathname + u.search)) throw new BlockedByRobots(`${u.host} asks tools not to fetch ${u.pathname} (robots.txt).`);
}

async function spacing(host: string): Promise<void> {
  const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

/** GET with robots.txt check, per-host spacing and an on-disk cache (ttlMs). */
export async function politeGet(url: string, ttlMs: number, accept = "application/json"): Promise<string> {
  const u = new URL(url);
  const dir = path.join(DATA_DIR, "cache");
  const file = path.join(dir, crypto.createHash("sha1").update(url).digest("hex") + ".txt");
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < ttlMs) {
      const cached = fs.readFileSync(file, "utf8");
      if (cached === "__404__") throw new Error(`${u.host} returned 404`);
      return cached;
    }
  } catch (e) {
    if ((e as Error).message.endsWith("404")) throw e;
    /* not cached */
  }
  await checkRobots(u);
  await spacing(u.host);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept } });
  if (res.status === 429) throw new Error(`${u.host} says we're asking too often. Try again later.`);
  if (res.status === 404) {
    // Remember misses too (the employer-form finder probes board names that may not exist).
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, "__404__");
  }
  if (!res.ok) throw new Error(`${u.host} returned ${res.status}`);
  const body = await res.text();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body);
  return body;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * HTML → plain text. Hidden elements (display:none, visibility:hidden, aria-hidden, tiny/white text)
 * are kept but marked, because hidden text is where instructions to AI are usually planted.
 */
export function htmlToText(html: string): { text: string; hidden: string[] } {
  let h = decodeEntities(html || "");
  if (/&lt;\w/.test(html) && !/<\w/.test(html)) h = decodeEntities(h); // double-escaped (Greenhouse)
  const hidden: string[] = [];
  h = h.replace(
    /<(\w+)[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*[01]px|color\s*:\s*(?:#fff(?:fff)?|white)|aria-hidden="true"|\bhidden\b)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _t, inner: string) => {
      const t = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (t) hidden.push(t);
      return " ";
    },
  );
  const text = h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { text, hidden };
}
