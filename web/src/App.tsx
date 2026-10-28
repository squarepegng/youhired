import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AppState, Job, JobStatus } from "./types";
import { ProfileView } from "./ProfileView";
import { SearchView } from "./SearchView";
import { SettingsView } from "./SettingsView";
import { JobDetail } from "./JobDetail";

type Tab = "jobs" | "search" | "profile" | "settings";

export const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  found: { label: "Found", tone: "blue" },
  filled: { label: "Ready to review", tone: "violet" },
  applied: { label: "Applied", tone: "green" },
  needs_answer: { label: "Needs your answer", tone: "amber" },
  do_it_yourself: { label: "Do it yourself", tone: "orange" },
  skipped: { label: "Skipped", tone: "grey" },
  error: { label: "Error", tone: "red" },
};

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      setState(await api<AppState>("/api/state"));
      setJobs(await api<Job[]>("/api/jobs"));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!state) return <div className="boot">{err || "Loading…"}</div>;

  const steps = [
    { done: state.settings.hasKey || state.settings.provider === "compatible", label: "Add your AI key", tab: "settings" as Tab },
    { done: !!state.profile.cvFileName, label: "Upload your CV", tab: "profile" as Tab },
    { done: state.profile.confirmed, label: "Confirm your facts", tab: "profile" as Tab },
    { done: jobs.length > 0, label: "Run a search", tab: "search" as Tab },
  ];
  const setupLeft = steps.filter((s) => !s.done);

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand">
          <span className="logo" aria-hidden>
            ✓
          </span>
          JobPilot
        </div>
        {(["jobs", "search", "profile", "settings"] as Tab[]).map((t) => (
          <button key={t} className={`navitem ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {{ jobs: "Jobs & tracker", search: "Search", profile: "Profile", settings: "Settings" }[t]}
            {t === "jobs" && jobs.filter((j) => j.status === "needs_answer").length > 0 && <span className="dot">{jobs.filter((j) => j.status === "needs_answer").length}</span>}
          </button>
        ))}
        {setupLeft.length > 0 && (
          <div className="setup">
            <div className="muted small">Getting started</div>
            {steps.map((s) => (
              <button key={s.label} className={`step ${s.done ? "done" : ""}`} onClick={() => setTab(s.tab)}>
                <span className="tick">{s.done ? "✓" : ""}</span>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="navfoot muted small">
          Using {state.settings.provider} · {state.settings.model || "no model"}
          <br />
          {state.settings.autoSubmit ? "Auto-submit is on" : "Pauses for your review"}
        </div>
      </aside>
      <main className="main">
        {tab === "jobs" && <JobsView jobs={jobs} state={state} refresh={refresh} goSearch={() => setTab("search")} />}
        {tab === "search" && <SearchView state={state} refresh={refresh} onDone={() => setTab("jobs")} />}
        {tab === "profile" && <ProfileView state={state} refresh={refresh} />}
        {tab === "settings" && <SettingsView state={state} refresh={refresh} />}
      </main>
    </div>
  );
}

type Filter = "active" | JobStatus | "all";

function JobsView({ jobs, state, refresh, goSearch }: { jobs: Job[]; state: AppState; refresh: () => Promise<void>; goSearch: () => void }) {
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [minFit, setMinFit] = useState(0);
  const [elig, setElig] = useState<"any" | "eligible" | "unclear">("any");
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);

  const shown = jobs
    .filter((j) => (filter === "all" ? true : filter === "active" ? !["skipped", "applied"].includes(j.status) : j.status === filter))
    .filter((j) => !q || `${j.company} ${j.title} ${j.location}`.toLowerCase().includes(q.toLowerCase()))
    .filter((j) => (j.fit ?? 0) >= minFit || j.fit == null)
    .filter((j) => elig === "any" || j.eligibility?.verdict === elig)
    .sort((a, b) => order(a) - order(b) || (b.fit ?? -1) - (a.fit ?? -1));

  const current = jobs.find((j) => j.id === open) ?? null;

  return (
    <div className="jobs">
      <header className="pagehead">
        <div>
          <h1>Jobs & tracker</h1>
          <p className="muted">Everything JobPilot found, filled or skipped, and why.</p>
        </div>
        <div className="row">
          <a className="btn ghost" href="/api/export.csv">
            Export CSV
          </a>
          <button className="btn" onClick={goSearch}>
            New search
          </button>
        </div>
      </header>

      <div className="chips">
        {(["active", "found", "filled", "needs_answer", "do_it_yourself", "applied", "skipped", "all"] as Filter[]).map((f) => (
          <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
            {f === "active" ? "To do" : f === "all" ? "All" : STATUS[f as JobStatus].label}
            <span className="count">{f === "all" ? jobs.length : f === "active" ? jobs.filter((j) => !["skipped", "applied"].includes(j.status)).length : counts[f] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <input placeholder="Search company, title, location" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>
          Fit ≥ {minFit}
          <input type="range" min={0} max={90} step={10} value={minFit} onChange={(e) => setMinFit(+e.target.value)} />
        </label>
        <select value={elig} onChange={(e) => setElig(e.target.value as typeof elig)}>
          <option value="any">Any eligibility</option>
          <option value="eligible">Eligible</option>
          <option value="unclear">Unclear</option>
        </select>
      </div>

      {jobs.length === 0 ? (
        <div className="empty">
          <h3>No jobs yet</h3>
          <p className="muted">Set up your profile, then run a search. JobPilot pulls postings from public job boards and checks each one against where you can legally work.</p>
          <button className="btn" onClick={goSearch}>
            Go to search
          </button>
        </div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Where (exact wording)</th>
                <th>Fit</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} className={open === j.id ? "sel" : ""} onClick={() => setOpen(j.id)}>
                  <td>
                    <div className="strong">{j.title}</div>
                    <div className="muted small">
                      {j.company} · via {state.sources[j.source] ?? j.source}
                      {j.needsLogin && <span className="tag orange">needs login</span>}
                      {j.flags.includes("hidden-instructions") && <span className="tag red" title="This posting contains instructions aimed at AI. They were ignored.">hidden AI instructions</span>}
                      {j.flags.includes("ai-screening") && <span className="tag orange">rejects AI-filled</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`elig ${j.eligibility?.verdict ?? "unclear"}`}>{j.eligibility?.verdict ?? "—"}</span>
                    <div className="small muted clamp">“{j.eligibility?.evidence || j.location || "not stated"}”</div>
                  </td>
                  <td>{j.fit != null ? <FitBar fit={j.fit} /> : <span className="muted small">not scored</span>}</td>
                  <td>
                    <span className={`pill ${STATUS[j.status].tone}`}>{STATUS[j.status].label}</span>
                    {j.statusReason && <div className="small muted clamp">{j.statusReason}</div>}
                  </td>
                  <td className="small muted">{new Date(j.statusDate).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="muted pad">Nothing matches these filters.</p>}
        </div>
      )}
      {current && <JobDetail job={current} state={state} onClose={() => setOpen(null)} refresh={refresh} />}
    </div>
  );
}

function order(j: Job) {
  return { needs_answer: 0, filled: 1, found: 2, do_it_yourself: 3, error: 4, applied: 5, skipped: 6 }[j.status];
}

export function FitBar({ fit }: { fit: number }) {
  return (
    <div className="fit" title={`${fit}/100`}>
      <div className="bar">
        <div style={{ width: `${fit}%` }} className={fit >= 70 ? "hi" : fit >= 50 ? "mid" : "lo"} />
      </div>
      <span className="small">{fit}</span>
    </div>
  );
}
