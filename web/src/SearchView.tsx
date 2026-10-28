import { CircleAlert, LoaderCircle, Plus, Radar, ArrowRight } from "lucide-react";
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

const SOURCE_INFO: Record<SourceId, string> = {
  vc: "Job boards that Sequoia, Lightspeed, Kleiner Perkins, GV, Bessemer, First Round, Insight Partners, Atomico and other investors run for their whole portfolio, plus a16z's speedrun network. Funded startups only.",
  funded: "Reads funding news (TechCrunch, PR Newswire), finds the job boards of companies that just raised, and adds the ones with roles like yours.",
  fourdayweek: "Off: 4 Day Week's robots.txt asks tools not to use its API, so JobPilot won't fetch it.",
  nodesk: "Remote-only job board feed.",
  jobspresso: "Off: Jobspresso's robots.txt asks tools not to read its feed, so JobPilot won't fetch it.",
  startupjobs: "Newest remote startup jobs for your titles.",
  yc: "Finds Y Combinator startups that are hiring and remote-friendly (newest batches first), checks their job boards, and adds the ones with roles like yours.",
  hn: "The monthly Hacker News \"Who is hiring?\" thread: hundreds of startups, many linking straight to their application form.",
  jobicy: "Remote-only job board API.",
  workingnomads: "Remote-only job board feed.",
  arbeitnow: "Job board API, strong on Europe and remote.",
  greenhouse: "Company boards on Greenhouse. No login needed to apply.",
  lever: "Company boards on Lever.",
  ashby: "Company boards on Ashby.",
  himalayas: "Remote-only job board. Each job links back to Himalayas, as its terms ask.",
  remoteok: "Remote-only job board. Each job links back to Remote OK, as its terms ask.",
  wwr: "We Work Remotely RSS feed for your field.",
  remotive: "Off: Remotive's robots.txt asks tools not to use its API, so JobPilot won't fetch it.",
};

export function SearchView({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [p, setP] = useState<SearchPrefs>(ctx.state.search);
  const [prog, setProg] = useState<Progress | null>(null);
  const [url, setUrl] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
  const boardField = (key: "greenhouseBoards" | "leverCompanies" | "ashbyOrgs", src: SourceId, example: string) =>
    p.sources[src] && (
      <div style={{ padding: "0 16px 12px 16px" }}>
        <TagInput value={p[key]} onChange={(v) => save({ [key]: v } as Partial<SearchPrefs>)} placeholder={`Board names, e.g. ${example}`} />
      </div>
    );

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
        <div className="page">
          <h1>Find jobs</h1>
          <p className="lede">
            Pulls postings from public job boards, keeps the ones you can be hired for from <b style={{ color: "var(--text)" }}>{where || "your country (set it in Profile)"}</b>, and has your AI score how well each one fits.
          </p>

          {prog && prog.log.length > 0 && (
            <div className="runcard">
              <div className="runhead">
                {prog.running ? <LoaderCircle size={15} className="spin" /> : <Radar size={15} />}
                {prog.running ? "Searching…" : "Last search"}
                <span className="spacer" style={{ flex: 1 }} />
                {!prog.running && prog.found > 0 && (
                  <button className="btn sm primary" onClick={() => ctx.go("todo")}>
                    Review {prog.found} jobs <ArrowRight size={12} />
                  </button>
                )}
              </div>
              <div className="stats">
                <div>
                  <b>{prog.found}</b>
                  <span>kept</span>
                </div>
                <div>
                  <b>{prog.skipped}</b>
                  <span>skipped</span>
                </div>
                <div>
                  <b>{prog.scored}</b>
                  <span>scored by AI</span>
                </div>
              </div>
              <div className="runlog">{prog.log.slice(-40).join("\n")}</div>
            </div>
          )}

          <div className="group-title">What you're looking for</div>
          <p className="group-desc">Your brief guides the AI when it scores fit. Titles decide which postings are considered at all.</p>
          <div className="box">
            <div className="srow stack">
              <div className="l">
                <b>Your brief</b>
                <span>In your own words: seniority, industries, what you want more or less of. You can also tell the Assistant.</span>
              </div>
              <textarea rows={3} defaultValue={p.brief ?? ""} onBlur={(e) => e.target.value !== (p.brief ?? "") && save({ brief: e.target.value })} placeholder="e.g. Senior product designer roles at fintech or B2B SaaS companies, remote, open to contractors in Africa. No agencies." />
            </div>
            <div className="srow stack">
              <div className="l">
                <b>Job titles</b>
                <span>A posting matches when its title contains every word of one of these.</span>
              </div>
              <TagInput value={p.titles} onChange={(v) => save({ titles: v })} placeholder="product designer, ux designer…" />
            </div>
            <div className="srow stack">
              <div className="l">
                <b>Leave out titles containing</b>
              </div>
              <TagInput value={p.excludeKeywords} onChange={(v) => save({ excludeKeywords: v })} placeholder="intern, principal…" />
            </div>
            <div className="srow">
              <div className="l">
                <b>Posted within</b>
                <span>Older postings are ignored.</span>
              </div>
              <div className="r">
                <select value={p.maxAgeDays} onChange={(e) => save({ maxAgeDays: +e.target.value })} style={{ width: 160 }}>
                  {[7, 14, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="srow">
              <div className="l">
                <b>AI scoring limit</b>
                <span>Each scored job is one call on your AI key.</span>
              </div>
              <div className="r">
                <select value={p.maxToScore} onChange={(e) => save({ maxToScore: +e.target.value })} style={{ width: 160 }}>
                  {[10, 20, 40, 80, 150].map((d) => (
                    <option key={d} value={d}>
                      {d} jobs per search
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="group-title">Location rules</div>
          <div className="callout" style={{ marginTop: 6 }}>
            <CircleAlert size={14} color="var(--muted)" />
            <span>
              These come from your Profile: where you live, where you're authorised to work, and whether you take contractor roles. Roles open worldwide, to your region (for example EMEA), or to contractors anywhere are kept. Roles limited to places where you can't legally work are skipped, and the posting's exact words are saved as evidence.
            </span>
          </div>

          <div className="group-title">Sources</div>
          <p className="group-desc">Only public APIs and feeds. JobPilot follows each site's robots.txt and waits between requests.</p>
          <div className="box">
            {(Object.keys(ctx.state.sources) as SourceId[]).map((id) => (
              <div key={id}>
                <div className="srcrow">
                  <div className="l">
                    <b>{ctx.state.sources[id]}</b>
                    <span>{SOURCE_INFO[id]}</span>
                  </div>
                  <Switch label={ctx.state.sources[id]} checked={!!p.sources[id]} onChange={(v) => save({ sources: { ...p.sources, [id]: v } })} />
                </div>
                {id === "greenhouse" && boardField("greenhouseBoards", "greenhouse", "gitlab")}
                {id === "lever" && boardField("leverCompanies", "lever", "toptal")}
                {id === "ashby" && boardField("ashbyOrgs", "ashby", "zapier")}
                {id === "yc" && p.sources.yc && (
                  <div className="srow" style={{ borderTop: "1px solid var(--line)" }}>
                    <div className="l">
                      <span>
                        New startups to check per search. {p.ycChecked?.length ? `${p.ycChecked.length} checked so far; each search looks at ones it hasn't seen.` : ""}
                      </span>
                    </div>
                    <div className="r">
                      <select value={p.ycPerSearch ?? 80} onChange={(e) => save({ ycPerSearch: +e.target.value })} style={{ width: 160 }}>
                        {[0, 40, 80, 150, 300].map((n) => (
                          <option key={n} value={n}>
                            {n === 0 ? "Off" : `${n} startups`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="group-desc" style={{ marginTop: 8 }}>
            A board name is the part of a careers link after the ATS domain: <code>boards.greenhouse.io/gitlab</code>, <code>jobs.lever.co/toptal</code>, <code>jobs.ashbyhq.com/zapier</code>.
          </p>

          <div className="group-title">Add one job by link</div>
          <div className="box">
            <div className="srow">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://job-boards.greenhouse.io/…" onKeyDown={(e) => e.key === "Enter" && url && addUrl()} />
              <button className="btn" onClick={addUrl} disabled={!url}>
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
