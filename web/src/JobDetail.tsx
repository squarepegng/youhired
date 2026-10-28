import { useEffect, useState } from "react";
import { api } from "./api";
import { FitBar, STATUS } from "./App";
import type { AppState, Job } from "./types";

export function JobDetail({ job, state, onClose, refresh }: { job: Job; state: AppState; onClose: () => void; refresh: () => Promise<void> }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [shotKey, setShotKey] = useState(0);

  useEffect(() => {
    setAnswers({});
    setErr("");
  }, [job.id]);

  // Poll the log while an application is running.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await api<{ log: string[]; applying: boolean }>(`/api/jobs/${encodeURIComponent(job.id)}/log`).catch(() => null);
      if (stop || !r) return;
      setLog(r.log);
      setBusy(r.applying);
      if (r.applying) setTimeout(tick, 1200);
      else if (busy) {
        await refresh();
        setShotKey((k) => k + 1);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [job.id, busy, refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const id = encodeURIComponent(job.id);
  const apply = () =>
    act(async () => {
      await api(`/api/jobs/${id}/apply`, {});
      setBusy(true);
    });
  const submit = () => act(() => api(`/api/jobs/${id}/submit`, {}));
  const status = (s: Job["status"], reason?: string) => act(() => api(`/api/jobs/${id}/status`, { status: s, reason }));
  const sendAnswers = () => act(() => api(`/api/jobs/${id}/answers`, { answers: (job.pending ?? []).map((p) => ({ label: p.label, answer: answers[p.label] ?? "" })) }));

  const canApply = !["applied"].includes(job.status) && !job.needsLogin;

  return (
    <div className="drawer" role="dialog" aria-label={`${job.title} at ${job.company}`}>
      <div className="drawerhead">
        <div>
          <div className="muted small">{job.company}</div>
          <h2>{job.title}</h2>
          <span className={`pill ${STATUS[job.status].tone}`}>{STATUS[job.status].label}</span> {job.statusReason && <span className="small muted">{job.statusReason}</span>}
        </div>
        <button className="icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="drawerbody">
        <div className="row wrap">
          {canApply && (
            <button className="btn" onClick={apply} disabled={busy}>
              {busy ? "Working…" : job.status === "filled" ? "Fill again" : "Apply"}
            </button>
          )}
          {job.status === "filled" && job.hasSession && (
            <button className="btn green" onClick={submit} disabled={busy}>
              Submit now
            </button>
          )}
          {job.status !== "applied" && (
            <button className="btn ghost" onClick={() => status("applied", "Marked applied by you")}>
              I applied myself
            </button>
          )}
          {job.status !== "skipped" && (
            <button className="btn ghost" onClick={() => status("skipped", "Skipped by you")}>
              Skip
            </button>
          )}
          <a className="btn ghost" href={job.url} target="_blank" rel="noreferrer">
            Open posting ↗
          </a>
        </div>
        {err && <div className="alert red">{err}</div>}
        {job.status === "filled" && (
          <div className="alert violet">
            The form is filled in the JobPilot browser window. Check it there. Edit anything you like, then press <b>Submit now</b> here (or submit in the browser and press <b>I applied myself</b>).
          </div>
        )}
        {job.status === "do_it_yourself" && (
          <div className="alert orange">
            JobPilot won't do this one: {job.statusReason} <a href={job.applyUrl} target="_blank" rel="noreferrer">Open the application ↗</a>
          </div>
        )}

        {job.status === "needs_answer" && (job.pending?.length ?? 0) > 0 && (
          <section className="card">
            <h3>Only you can answer these</h3>
            <p className="muted small">JobPilot never guesses. Your answers are saved to your profile and reused on future forms with the same question.</p>
            {job.pending!.map((p) => (
              <label key={p.fieldId} className="field">
                <span>{p.label}</span>
                {p.hint && <span className="muted small">{p.hint}</span>}
                {p.options?.length ? (
                  <select value={answers[p.label] ?? ""} onChange={(e) => setAnswers({ ...answers, [p.label]: e.target.value })}>
                    <option value="">Choose…</option>
                    {p.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <textarea rows={2} value={answers[p.label] ?? ""} onChange={(e) => setAnswers({ ...answers, [p.label]: e.target.value })} />
                )}
              </label>
            ))}
            <div className="row">
              <button className="btn" onClick={sendAnswers}>
                Save answers
              </button>
              <button className="btn ghost" onClick={() => status("skipped", "Skipped: questions I can't answer")}>
                Skip this job
              </button>
            </div>
          </section>
        )}

        <section className="card">
          <h3>Can you be hired from where you live?</h3>
          <p>
            <span className={`elig ${job.eligibility?.verdict ?? "unclear"}`}>{job.eligibility?.verdict ?? "unknown"}</span> {job.eligibility?.reason}
          </p>
          <blockquote>“{job.eligibility?.evidence || job.location || "No location given"}”</blockquote>
          {job.fit != null && (
            <>
              <h3>Fit</h3>
              <FitBar fit={job.fit} />
              <p className="small">{job.whyFit}</p>
            </>
          )}
          {job.salaryText && <p className="small muted">Posted pay: {job.salaryText}</p>}
          {job.flags.includes("hidden-instructions") && <p className="small alert red">This posting contains text aimed at AI tools (e.g. asking for a code word). JobPilot ignored it and checked its answers don't contain it.</p>}
        </section>

        {(job.answers?.length ?? 0) > 0 && (
          <section className="card">
            <h3>Answers {job.status === "applied" ? "submitted" : "filled in"}</h3>
            <dl className="answers">
              {job.answers!.map((a, i) => (
                <div key={i}>
                  <dt>{a.label}</dt>
                  <dd>
                    {a.value}
                    <span className="src">{a.source}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {["filled", "applied"].includes(job.status) && (
          <section className="card">
            <h3>Screenshot</h3>
            <img className="shot" src={`/api/jobs/${id}/screenshot?k=${shotKey}`} alt="The filled form" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          </section>
        )}

        {log.length > 0 && (
          <section className="card">
            <h3>Activity</h3>
            <pre className="log">{log.join("\n")}</pre>
          </section>
        )}

        <section className="card">
          <h3>Posting</h3>
          <p className="muted small">
            via {state.sources[job.source] ?? job.source} ·{" "}
            <a href={job.url} target="_blank" rel="noreferrer">
              original posting
            </a>
            {job.postedAt && ` · posted ${new Date(job.postedAt).toLocaleDateString()}`}
          </p>
          <div className="desc">{job.description || "No description."}</div>
        </section>
      </div>
    </div>
  );
}
