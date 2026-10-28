import { ChevronDown, Download, Radar, Search, ArrowRight, CircleCheck, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Ctx, JOB_VIEWS, type Step, type View } from "./App";
import { JobDetail } from "./JobDetail";
import type { Job, JobStatus } from "./types";
import { EligChip, Fit, STATUS, STATUS_ORDER, StatusIcon, relTime } from "./ui";

type EligFilter = "any" | "eligible" | "unclear";

export function JobsView({ view, ctx, steps }: { view: View; ctx: Ctx; steps: Step[] }) {
  const cfg = JOB_VIEWS[view];
  const [q, setQ] = useState("");
  const [elig, setElig] = useState<EligFilter>("any");
  const [closed, setClosed] = useState<Record<string, boolean>>({ skipped: view === "all" });
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ctx.jobs
      .filter((j) => !cfg.statuses || cfg.statuses.includes(j.status))
      .filter((j) => !t || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(t))
      .filter((j) => elig === "any" || j.eligibility?.verdict === elig)
      .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || b.statusDate.localeCompare(a.statusDate));
  }, [ctx.jobs, cfg, q, elig]);

  const groups = useMemo(() => {
    const by = new Map<JobStatus, Job[]>();
    for (const j of shown) by.set(j.status, [...(by.get(j.status) ?? []), j]);
    return STATUS_ORDER.filter((s) => by.has(s)).map((s) => ({ status: s, jobs: by.get(s)! }));
  }, [shown]);

  const flat = groups.flatMap((g) => (closed[g.status] ? [] : g.jobs));
  const selected = ctx.jobs.find((j) => j.id === ctx.selected) ?? null;

  // j/k or ↑/↓ to move, Enter to open, Esc to close, / to filter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey) return;
      const idx = flat.findIndex((j) => j.id === ctx.selected);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const n = flat[Math.min(flat.length - 1, idx + 1)];
        if (n) ctx.openJob(n.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = flat[Math.max(0, idx - 1)];
        if (n) ctx.openJob(n.id);
      } else if (e.key === "Escape") ctx.openJob(null);
      else if (e.key === "/") {
        e.preventDefault();
        (document.getElementById("jobfilter") as HTMLInputElement)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, ctx]);

  useEffect(() => {
    listRef.current?.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
  }, [ctx.selected]);

  const Icon = cfg.icon;
  const total = ctx.jobs.filter((j) => !cfg.statuses || cfg.statuses.includes(j.status)).length;
  const setupLeft = steps.some((s) => !s.done);

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Icon size={15} />
          {cfg.title}
          <span className="faint">{total || ""}</span>
        </div>
        <div className="spacer" />
        <div className="filterinput">
          <Search size={13} />
          <input id="jobfilter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, company…" onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLInputElement).blur()} />
          {!q && <kbd>/</kbd>}
        </div>
        <a className="iconbtn" href="/api/export.csv" title="Export tracker as CSV" aria-label="Export CSV">
          <Download size={15} />
        </a>
        <button className="btn primary" onClick={() => ctx.go("find")}>
          <Radar size={14} /> Find jobs
        </button>
      </div>
      {total > 0 && (
        <div className="subbar">
          <div className="tabs">
            {(["any", "eligible", "unclear"] as EligFilter[]).map((f) => (
              <button key={f} className={`tab ${elig === f ? "on" : ""}`} onClick={() => setElig(f)}>
                {f !== "any" && <span className={`d ${f}`} style={{ width: 6, height: 6, borderRadius: 3, display: "inline-block" }} />}
                {{ any: "All locations", eligible: "Eligible", unclear: "Check location" }[f]}
              </button>
            ))}
          </div>
          <div className="spacer" style={{ flex: 1 }} />
          <span className="faint" style={{ fontSize: 12 }}>
            <kbd>J</kbd> <kbd>K</kbd> to move · <kbd>esc</kbd> to close
          </span>
        </div>
      )}

      <div className="content">
        {total === 0 ? (
          view === "inbox" && setupLeft ? (
            <Onboarding steps={steps} go={ctx.go} />
          ) : (
            <div className="empty">
              <div className="icon">
                <Icon size={20} />
              </div>
              <h2>{view === "inbox" ? "You're all caught up" : `Nothing in ${cfg.title}`}</h2>
              <p>{cfg.empty}</p>
              {view !== "applied" && (
                <button className="btn primary lg" onClick={() => ctx.go(view === "inbox" && (ctx.jobs.some((j) => j.status === "found")) ? "todo" : "find")}>
                  {view === "inbox" && ctx.jobs.some((j) => j.status === "found") ? `Review ${ctx.jobs.filter((j) => j.status === "found").length} jobs to apply` : "Find jobs"}
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          )
        ) : (
          <div className="split">
            <div className="listpane" ref={listRef}>
              {groups.map((g) => (
                <div key={g.status}>
                  <div className={`group ${closed[g.status] ? "closed" : ""}`} onClick={() => setClosed({ ...closed, [g.status]: !closed[g.status] })}>
                    <ChevronDown size={13} className="chev" />
                    <StatusIcon status={g.status} />
                    {STATUS[g.status].label}
                    <span className="n">{g.jobs.length}</span>
                    <span className="hint">{STATUS[g.status].hint}</span>
                  </div>
                  {!closed[g.status] &&
                    g.jobs.map((j) => (
                      <div key={j.id} className={`row ${ctx.selected === j.id ? "sel" : ""}`} onClick={() => ctx.openJob(j.id)}>
                        {j.working ? <LoaderCircle size={14} className="spin" color="var(--accent)" aria-label="Filling" /> : <StatusIcon status={j.status} />}
                        <div className="main-col">
                          <span className="t">{j.title}</span>
                          <span className="c">{j.company}</span>
                        </div>
                        <div className="meta">
                          {j.flags.includes("hidden-instructions") && <span className="chip danger" title="This posting hides instructions aimed at AI. JobPilot ignored them.">AI trap</span>}
                          {j.needsLogin && <span className="chip warn">Login</span>}
                          {!selected && <EligChip job={j} />}
                          <Fit fit={j.fit} />
                          <span className="date">{relTime(j.statusDate)}</span>
                        </div>
                      </div>
                    ))}
                </div>
              ))}
              {groups.length === 0 && <div className="empty"><p>No jobs match this filter.</p></div>}
            </div>
            {selected && <JobDetail key={selected.id} job={selected} ctx={ctx} />}
          </div>
        )}
      </div>
    </>
  );
}

function Onboarding({ steps, go }: { steps: Step[]; go: (v: View) => void }) {
  const nextIdx = steps.findIndex((s) => !s.done);
  return (
    <div className="onboard">
      <h1>Welcome to JobPilot</h1>
      <p>Four steps and JobPilot can start finding remote jobs you're eligible for and filling in the applications. Nothing is submitted without your OK.</p>
      {steps.map((s, i) => (
        <div key={s.label} className={`ostep ${s.done ? "done" : ""} ${i === nextIdx ? "next" : ""}`}>
          <span className="num">{s.done ? <CircleCheck size={14} /> : i + 1}</span>
          <div className="txt">
            <b>{s.label}</b>
            <span>{s.detail}</span>
          </div>
          {!s.done && (
            <button className={`btn ${i === nextIdx ? "primary" : ""}`} onClick={() => go(s.view)}>
              {s.cta}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
