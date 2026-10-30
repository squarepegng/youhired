import { ArrowRight, Briefcase, Building2, ChevronDown, Globe, Link2, LoaderCircle, Plus, Radar, Rocket, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Ctx } from "./App";
import type { SearchPrefs, SourceId } from "./types";
import { Switch, TagInput, useToast } from "./ui";

interface Progress {
  running: boolean;
  log: string[];
  found: number;
  skipped: number;
  scored: number;
  errors: string[];
}

type Tab = "want" | "sources" | "link";

/** Short, scannable source descriptions. */
const SOURCE_INFO: Record<SourceId, string> = {
  yc: "Hiring, remote-friendly YC startups",
  vc: "Sequoia, Lightspeed, GV, Bessemer, First Round, a16z",
  funded: "Companies that just raised money",
  hn: "Hacker News “Who is hiring?” thread",
  himalayas: "Remote-only job board",
  remoteok: "Remote-only job board",
  wwr: "We Work Remotely, your field",
  jobicy: "Remote-only job board",
  workingnomads: "Remote-only job board",
  arbeitnow: "Strong on Europe and remote",
  nodesk: "Remote-only job board",
  startupjobs: "Newest remote startup roles",
  greenhouse: "Company boards you choose",
  lever: "Company boards you choose",
  ashby: "Company boards you choose",
  remotive: "Its robots.txt asks tools not to use the API",
  fourdayweek: "Its robots.txt asks tools not to use the API",
  jobspresso: "Its robots.txt asks tools not to read the feed",
};

const GROUPS: { title: string; icon: typeof Rocket; ids: SourceId[]; desc: string }[] = [
  { title: "Startups & investors", icon: Rocket, ids: ["yc", "vc", "funded", "hn"], desc: "Freshly funded companies, the ones most likely to be hiring." },
  { title: "Remote job boards", icon: Globe, ids: ["himalayas", "remoteok", "wwr", "startupjobs", "jobicy", "workingnomads", "arbeitnow", "nodesk"], desc: "Listings are matched to the employer's own form when possible." },
  { title: "Company boards", icon: Building2, ids: ["greenhouse", "lever", "ashby"], desc: "Specific companies you want to watch." },
];
const BLOCKED: SourceId[] = ["remotive", "fourdayweek", "jobspresso"];

export function SearchView({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [p, setP] = useState<SearchPrefs>(ctx.state.search);
  const [prog, setProg] = useState<Progress | null>(null);
  const [url, setUrl] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [boards, setBoards] = useState(false);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem("jp.findTab") as Tab) || "want";
    } catch {
      return "want";
    }
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const pickTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem("jp.findTab", t);
    } catch {
      /* private mode */
    }
  };

  const poll = async () => {
    const r = await api<Progress>("/api/search/progress").catch(() => null);
    if (!r) return;
    setProg(r);
    if (r.running) timer.current = setTimeout(poll, 1000);
    else await ctx.refresh();
  };
  useEffect(() => {
    void poll();
    return () => clearTimeout(timer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: Partial<SearchPrefs>) => {
    const merged = { ...p, ...next };
    setP(merged);
    void api("/api/search/prefs", merged).then(() => ctx.refresh());
  };

  const run = async () => {
    try {
      await api("/api/search/prefs", p);
      await api("/api/search/run", {});
      setProg({ running: true, log: ["Starting…"], found: 0, skipped: 0, scored: 0, errors: [] });
      clearTimeout(timer.current);
      timer.current = setTimeout(poll, 700);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const addUrl = async () => {
    try {
      const job = await api<{ id: string }>("/api/jobs/add", { url });
      setUrl("");
      await ctx.refresh();
      ctx.go("todo");
      ctx.openJob(job.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const where = [ctx.state.profile.city, ctx.state.profile.country].filter(Boolean).join(", ");
  const usable = (Object.keys(SOURCE_INFO) as SourceId[]).filter((s) => !BLOCKED.includes(s));
  const onCount = usable.filter((s) => p.sources[s]).length;
  const boardCount = p.greenhouseBoards.length + p.leverCompanies.length + p.ashbyOrgs.length;

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Radar size={15} /> Find jobs
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={run} disabled={prog?.running}>
          {prog?.running ? <LoaderCircle size={14} className="spin" /> : <Radar size={14} />}
          {prog?.running ? "Searching…" : "Run search"}
        </button>
      </div>
      <div className="content">
        <div className="page find">
          <h1>Find jobs</h1>
          <p className="lede">
            Searches {onCount} sources for roles you can be hired for from <b>{where || "your country"}</b>, then scores how well each one fits.
          </p>

          {prog && prog.log.length > 0 && (
            <div className={`runsum ${prog.running ? "live" : ""}`}>
              <div className="runsum-main">
                <span className="runsum-icon">{prog.running ? <LoaderCircle size={16} className="spin" /> : <Radar size={16} />}</span>
                <div className="runsum-text">
                  <b>{prog.running ? "Searching…" : "Last search"}</b>
                  <span>{prog.running ? prog.log.at(-1) : `${prog.found} kept · ${prog.skipped} skipped · ${prog.scored} scored by your AI`}</span>
                </div>
                {!prog.running && prog.found > 0 && (
                  <button className="btn sm" onClick={() => ctx.go("todo")}>
                    Review {prog.found} <ArrowRight size={12} />
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
                  Details <ChevronDown size={12} style={{ transform: showLog ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
                </button>
              </div>
              {showLog && <div className="runlog">{prog.log.slice(-40).join("\n")}</div>}
            </div>
          )}

          <div className="seg" role="tablist" aria-label="Find jobs settings">
            {(
              [
                ["want", "What you want", SlidersHorizontal],
                ["sources", `Sources · ${onCount}`, Briefcase],
                ["link", "Add a job", Link2],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => pickTab(id)}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {tab === "want" && (
            <div className="panel">
              <div className="f">
                <label htmlFor="brief">Your brief</label>
                <textarea id="brief" rows={3} defaultValue={p.brief ?? ""} onBlur={(e) => e.target.value !== (p.brief ?? "") && save({ brief: e.target.value })} placeholder="e.g. Senior product designer roles at fintech or B2B SaaS companies, remote, open to contractors in Africa." />
                <div className="note">Guides how your AI scores fit. You can also just tell Lavender.</div>
              </div>
              <div className="f">
                <label>Job titles</label>
                <TagInput value={p.titles} onChange={(v) => save({ titles: v })} placeholder="product designer, ux designer…" />
                <div className="note">A posting matches when its title contains every word of one of these.</div>
              </div>
              <div className="f">
                <label>Leave out titles with</label>
                <TagInput value={p.excludeKeywords} onChange={(v) => save({ excludeKeywords: v })} placeholder="intern, principal…" />
              </div>
              <div className="inline-fields">
                <label>
                  Posted within
                  <select value={p.maxAgeDays} onChange={(e) => save({ maxAgeDays: +e.target.value })}>
                    {[7, 14, 30, 60, 90].map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Score up to
                  <select value={p.maxToScore} onChange={(e) => save({ maxToScore: +e.target.value })}>
                    {[10, 20, 40, 80, 150].map((d) => (
                      <option key={d} value={d}>
                        {d} jobs
                      </option>
                    ))}
                  </select>
                </label>
                {p.sources.yc && (
                  <label>
                    New YC startups
                    <select value={p.ycPerSearch ?? 80} onChange={(e) => save({ ycPerSearch: +e.target.value })}>
                      {[0, 40, 80, 150, 300].map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? "None" : `${n} per search`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className="hintline">
                Where you can be hired comes from your{" "}
                <button className="linkbtn" onClick={() => ctx.go("profile")}>
                  Profile
                </button>
                : roles open worldwide, to your region or to contractors are kept; others are skipped with the posting's own words as evidence.
              </p>
            </div>
          )}

          {tab === "sources" && (
            <div className="srcgroups">
              {GROUPS.map((g) => (
                <section key={g.title} className="srcgroup">
                  <div className="srcgroup-head">
                    <g.icon size={14} />
                    <b>{g.title}</b>
                    <span className="faint">
                      {g.ids.filter((s) => p.sources[s]).length}/{g.ids.length} on
                    </span>
                  </div>
                  <p className="group-desc">{g.desc}</p>
                  <div className="tiles">
                    {g.ids.map((id) => (
                      <label key={id} className={`tile ${p.sources[id] ? "on" : ""}`}>
                        <div>
                          <b>{ctx.state.sources[id]?.replace(/\s*\(.*\)$/, "")}</b>
                          <span>{SOURCE_INFO[id]}</span>
                        </div>
                        <Switch label={ctx.state.sources[id] ?? id} checked={!!p.sources[id]} onChange={(v) => save({ sources: { ...p.sources, [id]: v } })} />
                      </label>
                    ))}
                  </div>
                  {g.title === "Company boards" && (
                    <>
                      <button className="disclose" onClick={() => setBoards(!boards)} aria-expanded={boards}>
                        <ChevronDown size={13} style={{ transform: boards ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
                        Manage {boardCount} company boards
                      </button>
                      {boards && (
                        <div className="boards">
                          {(
                            [
                              ["greenhouseBoards", "Greenhouse", "gitlab"],
                              ["leverCompanies", "Lever", "toptal"],
                              ["ashbyOrgs", "Ashby", "zapier"],
                            ] as const
                          ).map(([key, name, ex]) => (
                            <div className="f" key={key}>
                              <label>{name}</label>
                              <TagInput value={p[key]} onChange={(v) => save({ [key]: v } as Partial<SearchPrefs>)} placeholder={`e.g. ${ex}`} />
                            </div>
                          ))}
                          <p className="note">
                            The board name is the part of a careers link after the domain, e.g. jobs.ashbyhq.com/<b>zapier</b>.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </section>
              ))}
              <p className="hintline">Not used: {BLOCKED.map((s) => ctx.state.sources[s]).join(", ")}. Their robots.txt asks tools to stay out, and YouHired respects that.</p>
            </div>
          )}

          {tab === "link" && (
            <div className="panel">
              <div className="f">
                <label htmlFor="joburl">Job link</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input id="joburl" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://job-boards.greenhouse.io/…" onKeyDown={(e) => e.key === "Enter" && url && addUrl()} />
                  <button className="btn" onClick={addUrl} disabled={!url}>
                    <Plus size={13} /> Add
                  </button>
                </div>
                <div className="note">Found a job somewhere else? Paste it here and YouHired treats it like any other: checks it, fills it, tracks it.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
