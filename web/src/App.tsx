import { Briefcase, CircleCheck, Command, Inbox, Radar, Search, Settings as Cog, SkipForward, Hand, User, Check, Sparkles } from "lucide-react";
import { AssistantView } from "./AssistantView";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { JobsView } from "./JobsView";
import { Palette } from "./Palette";
import { ProfileView } from "./ProfileView";
import { SearchView } from "./SearchView";
import { SettingsView } from "./SettingsView";
import type { AppState, Job, JobStatus } from "./types";
import { ToastProvider } from "./ui";

export type View = "assistant" | "inbox" | "todo" | "all" | "applied" | "diy" | "skipped" | "find" | "profile" | "settings";

export const JOB_VIEWS: Record<string, { title: string; statuses: JobStatus[] | null; icon: typeof Inbox; empty: string }> = {
  inbox: { title: "Inbox", statuses: ["needs_answer", "filled", "error"], icon: Inbox, empty: "Nothing needs you right now. Questions only you can answer and forms waiting to be submitted show up here." },
  todo: { title: "To apply", statuses: ["found"], icon: Briefcase, empty: "No eligible jobs waiting. Run Find jobs to look for more." },
  all: { title: "All jobs", statuses: null, icon: Radar, empty: "No jobs yet. Run Find jobs to pull postings from public job boards." },
  applied: { title: "Applied", statuses: ["applied"], icon: CircleCheck, empty: "Applications you submit appear here, with the answers you sent." },
  diy: { title: "Do it yourself", statuses: ["do_it_yourself"], icon: Hand, empty: "Jobs that need a login or CAPTCHA, or that reject AI-assisted applications, land here with a link." },
  skipped: { title: "Skipped", statuses: ["skipped"], icon: SkipForward, empty: "Jobs you can't be hired for, weak fits, and ones you skipped." },
};

export interface Ctx {
  state: AppState;
  jobs: Job[];
  refresh: () => Promise<void>;
  go: (v: View) => void;
  openJob: (id: string | null) => void;
  selected: string | null;
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [state, setState] = useState<AppState | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [view, setView] = useState<View>(() => (localStorage.getItem("jp.view") as View) || "assistant");
  const [selected, setSelected] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([api<AppState>("/api/state"), api<Job[]>("/api/jobs")]);
      setState(s);
      setJobs(j);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void api<Job[]>("/api/jobs").then(setJobs).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const go = useCallback((v: View) => {
    setView(v);
    setSelected(null);
    try {
      localStorage.setItem("jp.view", v);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);

  if (!state) return <div className="boot">{err || "Loading…"}</div>;

  const steps = setupSteps(state, jobs);
  const doneCount = steps.filter((s) => s.done).length;
  const ctx: Ctx = { state, jobs, refresh, go, openJob: setSelected, selected };
  const inboxCount = (counts.needs_answer ?? 0) + (counts.filled ?? 0) + (counts.error ?? 0);

  const nav = (v: View, label: string, Icon: typeof Inbox, right?: React.ReactNode) => (
    <button className={`navitem ${view === v ? "on" : ""}`} onClick={() => go(v)} title={label}>
      <Icon size={15} strokeWidth={1.8} />
      {label}
      {right}
    </button>
  );
  const cnt = (n?: number) => (n ? <span className="count">{n}</span> : null);
  const providerLabel = state.providers.find((p) => p.id === state.settings.provider)?.label ?? state.settings.provider;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="workspace">
          <span className="mark">
            <Check size={13} strokeWidth={3} />
          </span>
          JobPilot
        </div>
        <button className="searchbtn" onClick={() => setPalette(true)}>
          <Search size={14} />
          <span className="grow">Search or jump to…</span>
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </button>

        {nav("assistant", "Assistant", Sparkles)}
        {nav("inbox", "Inbox", Inbox, inboxCount ? <span className="badge">{inboxCount}</span> : null)}
        {nav("find", "Find jobs", Radar)}

        <div className="navlabel">Jobs</div>
        {nav("todo", "To apply", Briefcase, cnt(counts.found))}
        {nav("applied", "Applied", CircleCheck, cnt(counts.applied))}
        {nav("diy", "Do it yourself", Hand, cnt(counts.do_it_yourself))}
        {nav("skipped", "Skipped", SkipForward, cnt(counts.skipped))}
        {nav("all", "All jobs", Command, cnt(jobs.length))}

        <div className="bottom">
          {doneCount < steps.length && (
            <div className="setupcard">
              <div className="head">
                Get set up <span className="muted">{doneCount}/{steps.length}</span>
              </div>
              <div className="progress">
                <div style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              {steps.map((s) => (
                <button key={s.label} className={`setupstep ${s.done ? "done" : ""}`} onClick={() => go(s.view)}>
                  {s.done ? <CircleCheck size={13} color="var(--green)" /> : <span style={{ width: 13, height: 13, borderRadius: 7, border: "1px solid var(--line-2)", display: "inline-block" }} />}
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {nav("profile", "Profile", User, !state.profile.confirmed ? <span className="count" style={{ color: "var(--amber)" }}>confirm</span> : null)}
          {nav("settings", "Settings", Cog)}
          <div className="modelchip" title={state.settings.autoSubmit ? "Auto-submit is on" : "Pauses for your review before submitting"}>
            <span className={`dotlive ${state.settings.hasKey || state.settings.provider === "compatible" ? "" : "off"}`} />
            {providerLabel} · {state.settings.model || "no model"}
          </div>
        </div>
      </aside>

      <main className="main">
        {view in JOB_VIEWS && <JobsView key={view} view={view} ctx={ctx} steps={steps} />}
        {view === "assistant" && <AssistantView ctx={ctx} />}
        {view === "find" && <SearchView ctx={ctx} />}
        {view === "profile" && <ProfileView ctx={ctx} />}
        {view === "settings" && <SettingsView ctx={ctx} />}
      </main>

      {palette && (
        <Palette
          ctx={ctx}
          onClose={() => setPalette(false)}
          onPickJob={(id) => {
            if (!(view in JOB_VIEWS) || (JOB_VIEWS[view].statuses && !JOB_VIEWS[view].statuses!.includes(jobs.find((j) => j.id === id)!.status))) setView("all");
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

export interface Step {
  label: string;
  detail: string;
  done: boolean;
  view: View;
  cta: string;
}

export function setupSteps(state: AppState, jobs: Job[]): Step[] {
  return [
    { label: "Connect your AI", detail: "Pick Claude, Gemini, Grok, OpenAI or your own endpoint and paste a key.", done: state.settings.hasKey || state.settings.provider === "compatible", view: "settings", cta: "Open settings" },
    { label: "Upload your CV", detail: "Your AI reads it once to learn your experience.", done: !!state.profile.cvFileName, view: "profile", cta: "Upload CV" },
    { label: "Confirm your facts", detail: "Where you live, where you can legally work, salary rules. Never guessed.", done: state.profile.confirmed, view: "profile", cta: "Review profile" },
    { label: "Find jobs", detail: "Pull postings from public boards and keep the ones you can be hired for.", done: jobs.length > 0, view: "find", cta: "Find jobs" },
  ];
}
