import { Target, FileCheck2, ArrowUpRight, Bot, Building2, ChevronRight, CircleAlert, Clock, Globe, Hand, LoaderCircle, MapPin, Play, Send, ShieldCheck, Undo2, User, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Ctx } from "./App";
import { Kit } from "./Kit";
import type { Job } from "./types";
import { EligChip, Fit, STATUS, StatusIcon, relTime, useToast } from "./ui";

export function JobDetail({ job, ctx }: { job: Job; ctx: Ctx }) {
  const toast = useToast();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Pre-fill with the AI's drafts (from your CV, LinkedIn and portfolio): you approve or edit.
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((job.pending ?? []).filter((q) => q.draft).map((q) => [q.label, q.draft!])));
  const [showPosting, setShowPosting] = useState(false);
  const [shotKey, setShotKey] = useState(0);
  const [kitOpen, setKitOpen] = useState(false);
  const id = encodeURIComponent(job.id);

  const poll = useCallback(async () => {
    const r = await api<{ log: string[]; applying: boolean }>(`/api/jobs/${id}/log`).catch(() => null);
    if (!r) return false;
    setLog(r.log);
    setBusy(r.applying);
    return r.applying;
  }, [id]);

  useEffect(() => {
    let stop = false;
    let wasBusy = false;
    const loop = async () => {
      const running = await poll();
      if (stop) return;
      if (running) {
        wasBusy = true;
        setTimeout(loop, 1000);
      } else if (wasBusy) {
        wasBusy = false;
        await ctx.refresh();
        setShotKey((k) => k + 1);
      }
    };
    void loop();
    return () => {
      stop = true;
    };
    // re-run when an apply starts
  }, [poll, busy, ctx.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await ctx.refresh();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const apply = () =>
    run(async () => {
      await api(`/api/jobs/${id}/apply`, {});
      setBusy(true);
    }, "Opening the application in the browser…");
  const submit = () =>
    run(async () => {
      await api(`/api/jobs/${id}/submit`, {});
      setBusy(true);
    }, "Submitting… YouHired fixes anything the form asks for and confirms when it's sent.");
  const applyAnyway = () =>
    run(async () => {
      await api(`/api/jobs/${id}/apply-anyway`, {});
      setBusy(true);
    }, "Applying anyway, with truthful answers about where you can work.");
  const finish = () =>
    run(async () => {
      const r = await api<{ mode: string }>(`/api/jobs/${id}/finish`, {});
      setBusy(r.mode === "reopen");
    }, "A YouHired window is opening with your filled form. Tick the check there; YouHired submits the rest.");
  const setStatus = (status: Job["status"], reason: string, ok: string) => run(() => api(`/api/jobs/${id}/status`, { status, reason }), ok);
  const saveAnswers = () =>
    run(async () => {
      await api(`/api/jobs/${id}/answers`, { answers: (job.pending ?? []).map((p) => ({ label: p.label, answer: answers[p.label] ?? "" })) });
      await api(`/api/jobs/${id}/apply`, {});
      setBusy(true);
    }, "Answers saved. Continuing the application…");

  // Every question answered, and no [placeholders] left from a draft.
  const pendingDone = (job.pending ?? []).every((p) => (answers[p.label] ?? "").trim() && !/\[[^\]]{2,}\]/.test(answers[p.label] ?? ""));

  return (
    <aside className="detail" aria-label={`${job.title} at ${job.company}`}>
      <div className="detailhead">
        <div className="crumb">
          <StatusIcon status={job.status} />
          {STATUS[job.status].label}
          <ChevronRight size={12} />
          <span style={{ color: "var(--text-2)" }}>{job.company}</span>
        </div>
        <a className="iconbtn" href={job.url} target="_blank" rel="noreferrer" title="Open the original posting">
          <ArrowUpRight size={15} />
        </a>
        <button className="iconbtn" onClick={() => ctx.openJob(null)} aria-label="Close" title="Close (esc)">
          <X size={15} />
        </button>
      </div>

      <div className="detailbody">
        <h1>{job.title}</h1>
        <div className="company">
          <Building2 size={13} /> {job.company}
          <span className="faint">· via {ctx.state.sources[job.source] ?? job.source}</span>
        </div>

        <NextStep openKit={() => setKitOpen(true)} applyAnyway={applyAnyway} autoSubmit={!!ctx.state.settings.autoSubmit} background={!!ctx.state.settings.background} job={job} busy={busy} apply={apply} submit={submit} finish={finish} setStatus={setStatus} answers={answers} setAnswers={setAnswers} saveAnswers={saveAnswers} pendingDone={pendingDone} />

        <dl className="props">
          <dt>
            <MapPin size={13} /> Location
          </dt>
          <dd>
            <EligChip job={job} withEvidence={false} />
            <span className="muted">{job.eligibility?.reason}</span>
          </dd>
          <dt>
            <Target size={13} /> Fit
          </dt>
          <dd>
            <Fit fit={job.fit} />
            {job.fit == null && <span className="faint">Scored when your AI is connected</span>}
          </dd>
          {job.salaryText && (
            <>
              <dt>
                <Globe size={13} /> Pay
              </dt>
              <dd>{job.salaryText}</dd>
            </>
          )}
          <dt>
            <Clock size={13} /> Updated
          </dt>
          <dd>
            {new Date(job.statusDate).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {job.postedAt && <span className="faint">· posted {relTime(job.postedAt)} ago</span>}
          </dd>
        </dl>

        <div className="section">
          <div className="sh">Where they hire</div>
          <blockquote className="evidence">“{job.eligibility?.evidence || job.location || "No location given"}”</blockquote>
          {job.whyFit && (
            <p className="muted" style={{ marginTop: 10 }}>
              {job.whyFit}
            </p>
          )}
          {job.flags.includes("hidden-instructions") && (
            <div className="callout red">
              <ShieldCheck size={14} />
              <span>This posting hides instructions aimed at AI tools (like asking for a code word). YouHired ignored them and checks that none of its answers contain them.</span>
            </div>
          )}
        </div>

        {job.tailoredCv && (
          <div className="callout green">
            <FileCheck2 size={14} />
            <span>
              YouHired sent a CV tailored to this role: same facts, re-ordered and re-emphasised for it.{" "}
              <a href={`/api/jobs/${id}/cv`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                View the tailored CV ↗
              </a>
            </span>
          </div>
        )}

        {(job.answers?.length ?? 0) > 0 && (
          <div className="section">
            <div className="sh">
              {job.status === "applied" ? "Answers submitted" : "Answers filled in"} <span className="n">{job.answers!.length}</span>
            </div>
            <div className="qa">
              {job.answers!.map((a, i) => (
                <div key={i}>
                  <div className="q">{a.label}</div>
                  <div className="a">{a.value}</div>
                  <div className="s">
                    {a.source.startsWith("ai") ? <Bot size={11} /> : <User size={11} />}
                    {sourceLabel(a.source)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {["filled", "applied"].includes(job.status) && (
          <div className="section">
            <div className="sh">Screenshot</div>
            <img className="shot" src={`/api/jobs/${id}/screenshot?k=${shotKey}`} alt="The filled application form" onError={(e) => ((e.target as HTMLImageElement).parentElement!.style.display = "none")} />
          </div>
        )}

        {log.length > 0 && (
          <div className="section">
            <div className="sh">
              Activity {busy && <LoaderCircle size={13} className="spin" />}
            </div>
            <ul className="timeline">
              {log.map((l, i) => {
                const m = l.match(/^(\d{1,2}:\d{2}(?::\d{2})?\s?[AP]M)\s+(.*)$/);
                return (
                  <li key={i}>
                    {m ? (
                      <>
                        <span className="tm">{m[1]}</span>
                        {m[2]}
                      </>
                    ) : (
                      l
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="section">
          <div className="sh">
            Posting
            <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setShowPosting(!showPosting)}>
              {showPosting ? "Collapse" : "Show all"}
            </button>
          </div>
          <div className="posting" style={showPosting ? undefined : { maxHeight: 180, overflow: "hidden", maskImage: "linear-gradient(#000 60%, transparent)" }}>
            {job.description || "No description."}
          </div>
        </div>
      </div>
      {kitOpen && (
        <Kit
          jobId={job.id}
          title={`${job.title} at ${job.company}`}
          onClose={() => setKitOpen(false)}
          onApplied={() => {
            setKitOpen(false);
            void setStatus("applied", "Submitted by you in your browser", "Marked as applied");
          }}
        />
      )}
    </aside>
  );
}

function sourceLabel(s: string): string {
  const [kind, ...rest] = s.split(" · ");
  const k = { profile: "From your profile", saved: "Your earlier answer", rule: "Your rules", "cv-file": "Your CV file", "cover-file": "Cover letter file", ai: "Written by your AI from your CV", user: "You" }[kind] ?? kind;
  return rest.length ? `${k} · ${rest.join(" · ")}` : k;
}

function NextStep(p: {
  autoSubmit: boolean;
  background: boolean;
  job: Job;
  busy: boolean;
  apply: () => void;
  submit: () => void;
  finish: () => void;
  applyAnyway: () => void;
  openKit: () => void;
  setStatus: (s: Job["status"], reason: string, ok: string) => void;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  saveAnswers: () => void;
  pendingDone: boolean;
}) {
  const { job, busy } = p;
  const skip = (
    <button className="btn ghost" onClick={() => p.setStatus("skipped", "Skipped by you", "Moved to Skipped")}>
      Skip
    </button>
  );
  const mine = (
    <button className="btn ghost" onClick={() => p.setStatus("applied", "Marked applied by you", "Marked as applied")}>
      I applied myself
    </button>
  );

  if (job.handoff === "captcha" && job.status === "filled")
    return (
      <div className="next accent">
        <div className="h">
          <ShieldCheck size={15} /> One quick check left
        </div>
        <p>
          Everything is filled in. The site wants a human to tick a check (a CAPTCHA), which YouHired never fakes. Press <b>Finish</b>: a YouHired window shows the filled form, you tick the check, and YouHired submits. If the check keeps coming back there (some sites keep challenging automated windows), use <b>Finish in my browser</b>: your answers and files are ready to copy.
        </p>
        <div className="actions">
          <button className="btn primary" onClick={p.finish}>
            Finish
          </button>
          <button className="btn" onClick={p.openKit}>
            Finish in my browser
          </button>
          {mine}
          {skip}
        </div>
      </div>
    );

  if (busy)
    return (
      <div className="next accent">
        <div className="h">
          <LoaderCircle size={15} className="spin" /> {job.status === "filled" ? "Submitting…" : "Working on the application…"}
        </div>
        <p>{p.background ? "Filling the form in the background." : "Filling the form in the YouHired browser window."} Watch the activity below. It stops before submitting unless auto-submit is on.</p>
      </div>
    );

  switch (job.status) {
    case "found":
      return (
        <div className="next accent">
          <div className="h">
            <Play size={14} /> Ready when you are
          </div>
          <p>YouHired opens the form in its own browser window, fills it from your profile and CV, and stops so you can check it before anything is sent.</p>
          <div className="actions">
            <button className="btn primary" onClick={p.apply}>
              Fill application
            </button>
            {skip}
            {mine}
          </div>
        </div>
      );
    case "needs_answer":
      return (
        <div className="next warn">
          <div className="h">
            <CircleAlert size={15} color="var(--amber)" /> {job.pending?.length ?? 0} question{(job.pending?.length ?? 0) === 1 ? "" : "s"} only you can answer
          </div>
          <p>
            {(job.pending ?? []).some((q) => q.draft)
              ? job.handoff === "own_words"
                ? "Your details are filled. Your AI drafted these from your CV, LinkedIn and portfolio. This employer says it disqualifies AI-written answers, so read them and make them yours before approving."
                : "Your details are filled. Your AI drafted these from your CV, LinkedIn and portfolio. Check them and approve."
              : "YouHired never guesses facts only you know. Answer once: it's saved to your profile and reused on every future form."}
          </p>
          {(job.pending ?? []).map((q) => (
            <div className="question" key={q.fieldId}>
              <label htmlFor={q.fieldId}>
                {q.label}
                {q.draft && p.answers[q.label] === q.draft && <span className="draftchip">AI draft</span>}
              </label>
              {q.hint && <div className="hint">{q.hint}</div>}
              {/\[[^\]]{2,}\]/.test(p.answers[q.label] ?? "") && <div className="hint" style={{ color: "var(--amber)" }}>Replace the [bracketed] parts with your own details before approving.</div>}
              {q.options?.length ? (
                <select id={q.fieldId} value={p.answers[q.label] ?? ""} onChange={(e) => p.setAnswers({ ...p.answers, [q.label]: e.target.value })}>
                  <option value="">Choose…</option>
                  {q.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <textarea id={q.fieldId} rows={q.draft ? 4 : 2} value={p.answers[q.label] ?? ""} onChange={(e) => p.setAnswers({ ...p.answers, [q.label]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="actions">
            <button className="btn primary" disabled={!p.pendingDone} onClick={p.saveAnswers}>
              {p.autoSubmit ? "Approve & submit" : "Approve & fill"}
            </button>
            {skip}
          </div>
        </div>
      );
    case "filled":
      return (
        <div className="next accent">
          <div className="h">
            <Send size={14} /> Check the form, then submit
          </div>
          <p>
            {job.hasSession
              ? p.background
                ? "Filled in the background. Check the answers and screenshot below, then submit."
                : "The filled form is open in the YouHired browser window. Change anything you like there, then submit."
              : "The browser window for this form was closed. Fill it again to review and submit."}
            {(job.pending?.length ?? 0) > 0 && ` Still empty: ${job.pending!.map((x) => x.label).join("; ")}.`}
          </p>
          <div className="actions">
            {job.hasSession && (
              <button className="btn success" onClick={p.submit}>
                Submit application
              </button>
            )}
            <button className={`btn ${job.hasSession ? "" : "primary"}`} onClick={p.apply}>
              Fill again
            </button>
            {mine}
          </div>
        </div>
      );
    case "do_it_yourself":
      return (
        <div className="next warn">
          <div className="h">
            <Hand size={15} color="var(--orange)" /> This one's yours to do
          </div>
          <p>{job.statusReason}</p>
          <div className="actions">
            <button className="btn primary" onClick={p.apply}>
              Try again
            </button>
            {(job.answers?.length ?? 0) > 0 ? (
              <button className="btn" onClick={p.openKit}>
                Finish in my browser
              </button>
            ) : (
              <a className="btn" href={job.applyUrl} target="_blank" rel="noreferrer">
                Open application <ArrowUpRight size={13} />
              </a>
            )}
            {mine}
            {skip}
          </div>
        </div>
      );
    case "applied":
      return (
        <div className="next">
          <div className="h">
            <StatusIcon status="applied" /> Applied {relTime(job.statusDate)} ago
          </div>
          <p>{job.statusReason}</p>
        </div>
      );
    case "skipped":
      return (
        <div className="next">
          <div className="h">
            <StatusIcon status="skipped" /> Skipped
          </div>
          <p>{job.statusReason}</p>
          {job.eligibility?.verdict === "ineligible" && <p className="small">Apply anyway if you think they might make an exception (some hire contractors outside their listed countries). YouHired still answers location and work-authorisation questions truthfully.</p>}
          <div className="actions">
            {job.eligibility?.verdict === "ineligible" && (
              <button className="btn primary" onClick={p.applyAnyway} title="YouHired applies with truthful answers about where you can work; the employer decides">
                Apply anyway
              </button>
            )}
            <button className="btn" onClick={() => p.setStatus("found", "Moved back by you", "Moved to To apply")}>
              <Undo2 size={13} /> Move to To apply
            </button>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="next warn">
          <div className="h">
            <StatusIcon status="error" /> Something went wrong
          </div>
          <p>{job.statusReason}</p>
          <div className="actions">
            <button className="btn primary" onClick={p.apply}>
              Try again
            </button>
            {skip}
          </div>
        </div>
      );
  }
}
