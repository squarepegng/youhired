import { BotMessageSquare, ArrowUp, Building2, ChevronRight, Check, CircleAlert, LoaderCircle, Radar, SquarePen, X, FileText, SkipForward, Eye, SlidersHorizontal, Send } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Ctx } from "./App";
import type { Job } from "./types";
import { StatusIcon, useToast } from "./ui";

interface ChatAction {
  type: "set_brief" | "update_search" | "run_search" | "apply_jobs" | "skip_jobs" | "open_job" | "add_companies";
  summary: string;
  status: "done" | "needs_confirm" | "cancelled" | "failed";
  data: { job_ids?: string[]; error?: string; brief?: string; titles?: string[] };
}
interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  actions?: ChatAction[];
  steps?: string[];
}

const SUGGESTIONS = [
  { title: "Tell it what you want", text: "I'm a senior product designer. I want remote roles at fintech or B2B SaaS companies that hire in Africa. Find them and apply to the best ones." },
  { title: "Find more jobs", text: "What jobs can I get from Nigeria right now? Look wider than my current sources." },
  { title: "Apply in bulk", text: "Apply to every eligible job with a fit above 70." },
  { title: "What needs me?", text: "What's waiting on me, and why were jobs skipped?" },
];

export function AssistantView({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const connected = ctx.state.settings.hasKey || ctx.state.settings.provider === "compatible";

  useEffect(() => {
    void api<{ messages: Msg[] }>("/api/chat").then((r) => setMsgs(r.messages));
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, thinking, live]);
  useEffect(() => {
    if (!thinking) return setLive([]);
    const t = setInterval(() => void api<{ steps: string[] }>("/api/chat/activity").then((r) => setLive(r.steps)).catch(() => {}), 900);
    return () => clearInterval(t);
  }, [thinking]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(200, ta.scrollHeight)}px`;
  }, [text]);

  const send = async (t = text) => {
    const body = t.trim();
    if (!body || thinking) return;
    setText("");
    const temp: Msg = { id: `tmp-${Date.now()}`, role: "user", text: body, at: new Date().toISOString() };
    setMsgs((m) => [...m, temp]);
    setThinking(true);
    try {
      await api("/api/chat", { text: body });
      const r = await api<{ messages: Msg[] }>("/api/chat");
      setMsgs(r.messages);
      await ctx.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
      setMsgs((m) => m.filter((x) => x.id !== temp.id));
      setText(body);
    } finally {
      setThinking(false);
      taRef.current?.focus();
    }
  };

  const resolve = async (msgId: string, i: number, confirm: boolean) => {
    await api(`/api/chat/${msgId}/actions/${i}`, { confirm });
    const r = await api<{ messages: Msg[] }>("/api/chat");
    setMsgs(r.messages);
    await ctx.refresh();
  };

  const clear = async () => {
    await api("/api/chat", undefined, "DELETE");
    setMsgs([]);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <BotMessageSquare size={15} /> Assistant
        </div>
        <div className="spacer" />
        {msgs.length > 0 && (
          <button className="btn ghost" onClick={clear}>
            <SquarePen size={14} /> New chat
          </button>
        )}
      </div>
      <div className="chat">
        <div className="thread">
          {msgs.length === 0 && !thinking ? (
            <div className="chathero">
              <img className="mascot" src={`${import.meta.env.BASE_URL}mascot.png`} alt="" width={112} height={90} />
              <h1>What kind of job are you after?</h1>
              <p>Tell me in your own words. I'll set up the search, find roles you can be hired for, and fill in the applications. Every form waits for your OK before it's sent.</p>
              <div className="suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s.title} onClick={() => (connected ? send(s.text) : setText(s.text))}>
                    <b>{s.title}</b>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            msgs.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.role === "assistant" && (
                  <img className="av" src={`${import.meta.env.BASE_URL}mascot.png`} alt="YouHired" />
                )}
                <div className="body">
                  {m.role === "assistant" && (m.steps?.length ?? 0) > 0 && <Steps steps={m.steps!} />}
                  {m.role === "user" ? <div className="bubble">{m.text}</div> : <Markdown text={m.text} />}
                  {m.actions?.map((a, i) => (
                    <ActionCard key={i} a={a} ctx={ctx} onResolve={(c) => resolve(m.id, i, c)} />
                  ))}
                </div>
              </div>
            ))
          )}
          {thinking && (
            <div className="msg assistant">
              <img className="av" src={`${import.meta.env.BASE_URL}mascot.png`} alt="YouHired" />
              <div className="body">
                <div className="livesteps">
                  {live.slice(-6).map((st, i, arr) => (
                    <div key={i} className={i === arr.length - 1 ? "now" : ""}>
                      {i === arr.length - 1 ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />}
                      {st}
                    </div>
                  ))}
                  {!live.length && (
                    <div className="typing">
                      <i />
                      <i />
                      <i />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="composerwrap">
          {!connected && (
            <div className="callout amber" style={{ marginTop: 0 }}>
              <CircleAlert size={14} />
              <span>
                Connect your AI first.{" "}
                <button className="linkbtn" onClick={() => ctx.go("settings")}>
                  Open Settings
                </button>
              </span>
            </div>
          )}
          <div className="composer">
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              autoFocus
              placeholder="Describe the job you want, or ask what's going on…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="sendbtn" onClick={() => send()} disabled={!text.trim() || thinking || !connected} aria-label="Send">
              {thinking ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
          <div className="composerhint">
            <kbd>↵</kbd> send · <kbd>⇧</kbd>+<kbd>↵</kbd> new line · Uses {ctx.state.settings.model || "your model"} on your key
          </div>
        </div>
      </div>
    </>
  );
}

const ICON: Record<ChatAction["type"], ReactNode> = {
  set_brief: <FileText size={13} />,
  update_search: <SlidersHorizontal size={13} />,
  run_search: <Radar size={13} />,
  apply_jobs: <Send size={13} />,
  skip_jobs: <SkipForward size={13} />,
  open_job: <Eye size={13} />,
  add_companies: <Building2 size={13} />,
};

function Steps({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stepsum">
      <button onClick={() => setOpen(!open)}>
        <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
        {steps.length} step{steps.length === 1 ? "" : "s"}: {steps[steps.length - 1]}
      </button>
      {open && (
        <ul>
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionCard({ a, ctx, onResolve }: { a: ChatAction; ctx: Ctx; onResolve: (confirm: boolean) => void }) {
  const jobs = (a.data.job_ids ?? []).map((id) => ctx.jobs.find((j) => j.id === id)).filter(Boolean) as (Job & { working?: boolean })[];
  const open = (id: string) => {
    ctx.go("all");
    setTimeout(() => ctx.openJob(id), 0);
  };
  return (
    <div className={`action ${a.status}`}>
      <div className="ah">
        <span className="ai">{ICON[a.type]}</span>
        <span className="as">{a.summary}</span>
        <span className="ast">
          {a.status === "done" && <Check size={13} color="var(--green)" />}
          {a.status === "cancelled" && <span className="faint">Cancelled</span>}
          {a.status === "failed" && <span style={{ color: "var(--red)" }}>Didn't run</span>}
        </span>
      </div>
      {a.status === "failed" && a.data.error && <div className="aerr">{a.data.error}</div>}
      {a.type === "set_brief" && a.data.brief && <div className="abrief">“{a.data.brief}”</div>}
      {a.type === "run_search" && a.status === "done" && (
        <div className="arow">
          <button className="btn sm" onClick={() => ctx.go("find")}>
            Watch progress
          </button>
        </div>
      )}
      {jobs.length > 0 && (
        <div className="ajobs">
          {jobs.map((j) => (
            <button key={j.id} className="ajob" onClick={() => open(j.id)}>
              {j.working ? <LoaderCircle size={13} className="spin" color="var(--accent)" /> : <StatusIcon status={j.status} />}
              <span className="t">{j.title}</span>
              <span className="c">{j.company}</span>
              <span className="s">{j.working ? "Filling…" : statusWord(j.status)}</span>
            </button>
          ))}
        </div>
      )}
      {a.status === "needs_confirm" && (
        <div className="arow">
          <span className="muted" style={{ flex: 1 }}>
            {a.type === "apply_jobs" ? "Auto-submit is on, so these would be sent without your review." : `This changes ${jobs.length} jobs.`}
          </span>
          <button className="btn sm ghost" onClick={() => onResolve(false)}>
            <X size={12} /> Cancel
          </button>
          <button className="btn sm primary" onClick={() => onResolve(true)}>
            <Check size={12} /> Confirm
          </button>
        </div>
      )}
    </div>
  );
}

function statusWord(s: Job["status"]): string {
  return { found: "To apply", filled: "Ready to submit", applied: "Applied", needs_answer: "Needs your answer", do_it_yourself: "Do it yourself", skipped: "Skipped", error: "Problem" }[s];
}

/** Tiny, safe markdown: paragraphs, bullet/numbered lists, **bold**, `code`. No HTML injection. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    blocks.push(
      <L key={blocks.length}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </L>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*•]\s+(.*)$/);
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b || n) {
      const ordered = !!n;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((b ?? n)![1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>,
  );
}
