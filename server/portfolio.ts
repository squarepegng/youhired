// Reads your public portfolio/website so the AI knows your projects in your own words.
// Only same-site pages, a handful at most, through the polite fetcher (robots.txt, spacing, cache).

import { htmlToText, politeGet } from "./sources/http.js";

export async function readPortfolio(url: string, maxPages = 6): Promise<{ text: string; pages: string[] }> {
  const start = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  const seen = new Set<string>();
  const queue = [start.href];
  const parts: string[] = [];
  while (queue.length && seen.size < maxPages) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    let html = "";
    try {
      html = await politeGet(u, 24 * 3600_000, "text/html");
    } catch {
      continue;
    }
    const { text } = htmlToText(html.replace(/<(nav|footer|script|style|noscript)[\s\S]*?<\/\1>/gi, " "));
    if (text.trim().length > 80) parts.push(`# ${u}\n${text.trim().slice(0, 6000)}`);
    // Follow links on the same site (projects, about, case studies).
    for (const m of html.matchAll(/href="([^"#?]+)"/gi)) {
      try {
        const next = new URL(m[1], u);
        if (next.host === start.host && !/\.(png|jpe?g|gif|svg|webp|pdf|css|js|ico|xml)$/i.test(next.pathname) && !seen.has(next.href) && !queue.includes(next.href)) queue.push(next.href);
      } catch {
        /* bad link */
      }
    }
  }
  return { text: parts.join("\n\n").slice(0, 25000), pages: [...seen] };
}
