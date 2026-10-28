// Quick live check of every source (used during development): npx tsx scripts/check-sources.ts
import { ashby, greenhouse, himalayas, lever, remoteok, remotive, wwr } from "../server/sources/index.js";
const run = async (n: string, f: () => Promise<{ title: string; location: string }[]>) => {
  try { const j = await f(); console.log(n, j.length, j[0] ? `| ${j[0].title} | ${j[0].location}` : ""); } catch (e) { console.log(n, "ERR", (e as Error).message); }
};
const gh = process.argv.slice(2);
for (const b of gh.length ? gh : ["gitlab", "automatticcareers", "canonical", "doist", "hotjar"]) await run(`gh/${b}`, () => greenhouse(b));
for (const c of ["toptal", "loom"]) await run(`lever/${c}`, () => lever(c));
for (const o of ["zapier", "deel", "remote", "posthog"]) await run(`ashby/${o}`, () => ashby(o));
await run("remotive", () => remotive("product designer"));
await run("remoteok", () => remoteok());
await run("himalayas", () => himalayas("product designer"));
await run("wwr", () => wwr(["product designer"]));
