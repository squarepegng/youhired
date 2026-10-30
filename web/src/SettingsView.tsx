import { Link2, Unlink, CircleCheck, CircleAlert, ExternalLink, KeyRound, LoaderCircle, RefreshCw, Settings as Cog, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Ctx } from "./App";
import type { Settings } from "./types";
import { Switch, useToast } from "./ui";

const BLURB: Record<string, string> = {
  anthropic: "Opus, Sonnet, Haiku",
  openai: "GPT-6 family",
  gemini: "Gemini 4 and 3.8",
  xai: "Grok 4.7",
  compatible: "OpenRouter, Ollama…",
};

export function SettingsView({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const st = ctx.state;
  const [s, setS] = useState<Settings>(st.settings);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const info = st.providers.find((p) => p.id === s.provider)!;
  const keySaved = st.settings.provider === s.provider && st.settings.hasKey;

  const save = async (extra: Partial<Settings> = {}) => {
    const next = { ...s, ...extra };
    setS(next);
    await api("/api/settings", { ...next, apiKey: key || undefined });
    setKey("");
    await ctx.refresh();
  };
  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      await save();
      const r = await api<{ reply: string }>("/api/settings/test", {});
      setStatus({ ok: true, text: `Connected to ${info.label} · ${s.model}. Reply: ${r.reply}` });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };
  const loadModels = async () => {
    setLoadingModels(true);
    try {
      await save();
      setModels((await api<{ models: string[] }>("/api/models")).models);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoadingModels(false);
    }
  };

  const suggested = info.models.filter((m) => m.id);
  const extra = models.filter((m) => !suggested.some((x) => x.id === m));

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Cog size={15} /> Settings
        </div>
      </div>
      <div className="content">
        <div className="page">
          <h1>Settings</h1>
          <p className="lede">YouHired runs on your own AI account. Your key stays on this Mac in a file only you can read. It's never logged or sent anywhere except to the provider you pick.</p>

          <div className="group-title">AI provider</div>
          <div className="providers">
            {st.providers.map((p) => (
              <button
                key={p.id}
                className={`provider ${s.provider === p.id ? "on" : ""}`}
                onClick={() => {
                  setS({ ...s, provider: p.id, model: p.models[0]?.id ?? "", baseUrl: p.id === "compatible" ? s.baseUrl || p.baseUrl : "" });
                  setModels([]);
                  setStatus(null);
                }}
              >
                <b>{p.label.replace(" (OpenAI-compatible)", "").replace("Anthropic ", "")}</b>
                <span>{BLURB[p.id]}</span>
              </button>
            ))}
          </div>

          <div className="group-title">API key</div>
          <div className="box">
            {s.provider === "compatible" && (
              <div className="srow stack">
                <div className="l">
                  <b>Base URL</b>
                  <span>
                    OpenRouter: <code>https://openrouter.ai/api/v1</code> · Ollama on this Mac: <code>http://localhost:11434/v1</code> (no key needed)
                  </span>
                </div>
                <input value={s.baseUrl ?? ""} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1" />
              </div>
            )}
            <div className="srow stack">
              <div style={{ display: "flex", gap: 8 }}>
                <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keySaved ? `Saved · ${st.settings.apiKey} · paste a new key to replace` : `Paste your ${info.label} API key`} />
                <button className="btn primary" onClick={test} disabled={testing} style={{ height: 32 }}>
                  {testing ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}
                  {testing ? "Testing…" : "Save & test"}
                </button>
              </div>
              <span className="faint" style={{ fontSize: 12 }}>
                Get a key at{" "}
                <a href={info.keyUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  {info.keyUrl.replace(/^https:\/\//, "")} <ExternalLink size={10} />
                </a>
              </span>
              {status && (
                <div className={`callout ${status.ok ? "green" : "red"}`} style={{ margin: 0 }}>
                  {status.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                  {status.text}
                </div>
              )}
            </div>
          </div>

          <div className="group-title" style={{ display: "flex", alignItems: "center" }}>
            Model
            <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={loadModels} disabled={loadingModels}>
              {loadingModels ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Load from my account
            </button>
          </div>
          <div className="box models">
            {suggested.map((m) => (
              <div key={m.id} className={`model ${s.model === m.id ? "on" : ""}`} onClick={() => save({ model: m.id })}>
                <span className="radio" />
                <span className="id">{m.id}</span>
                <span className="note">{m.note}</span>
              </div>
            ))}
            <div className="srow">
              <div className="l">
                <b>Other model</b>
                <span>{s.provider === "compatible" ? "e.g. anthropic/claude-sonnet-5-5 on OpenRouter, llama3.3 on Ollama" : "Any model ID your account can use"}</span>
              </div>
              <div className="r">
                <input list="allmodels" value={suggested.some((m) => m.id === s.model) ? "" : s.model} placeholder="model-id" onChange={(e) => setS({ ...s, model: e.target.value })} onBlur={() => save()} />
                <datalist id="allmodels">
                  {extra.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>
          {extra.length > 0 && <p className="group-desc" style={{ marginTop: 6 }}>{extra.length} more models available. Type in "Other model" to pick one.</p>}

          <YourChrome autoOn={!!s.useMyChrome} onToggle={(v) => save({ useMyChrome: v })} />

          <div className="group-title">Applying</div>
          <div className="box">
            <div className="srow">
              <div className="l">
                <b>Autopilot: submit applications for me</b>
                <span>On: YouHired fills each form and submits it, then marks it Applied once the confirmation page shows (the employer usually emails you too). Off: it fills each form and waits for you to press Submit. Either way, questions it can't answer truthfully come to your Inbox.</span>
              </div>
              <Switch label="Autopilot" checked={s.autoSubmit} onChange={(v) => save({ autoSubmit: v })} />
            </div>
            <div className="srow">
              <div className="l">
                <b>Tailor my CV for each job</b>
                <span>YouHired rewrites your CV around each role's needs, using only facts from your documents, and checks every employer, title and number before using it. If anything fails the check, your original CV is sent instead.</span>
              </div>
              <Switch label="Tailor CV" checked={s.tailorCv !== false} onChange={(v) => save({ tailorCv: v })} />
            </div>
            <div className="srow">
              <div className="l">
                <b>Work in the background</b>
                <span>On: no browser window pops up. YouHired fills forms out of sight and you review them from the screenshot here, then press Submit. Off: you watch it fill each form in a Chrome window.</span>
              </div>
              <Switch label="Work in the background" checked={!!s.background} onChange={(v) => save({ background: v })} />
            </div>
            <div className="srow">
              <div className="l">
                <b>Browser</b>
                <span>YouHired opens its own window with a separate profile. It never sees your everyday browser, passwords or cookies.</span>
              </div>
              <div className="r">
                <select value={s.browserChannel} onChange={(e) => save({ browserChannel: e.target.value as Settings["browserChannel"] })}>
                  <option value="chrome">Google Chrome</option>
                  <option value="msedge">Microsoft Edge</option>
                  <option value="chromium">Playwright Chromium</option>
                </select>
              </div>
            </div>
          </div>

          <ConnectedSites />

          <div className="group-title">Always on</div>
          <div className="box">
            {[
              "Never states a false location, work authorisation or experience.",
              "Questions it can't answer from your profile go to your Inbox. It never guesses.",
              "Never creates accounts, types passwords or solves CAPTCHAs. You sign in to sites yourself (Connected sites); YouHired only reuses that session.",
              "Job pages are untrusted. Hidden instructions to AI are ignored; pages that reject AI-assisted applications are left to you.",
              "Companies on your never-apply list are always skipped.",
            ].map((r) => (
              <div className="srow" key={r} style={{ minHeight: 40 }}>
                <ShieldCheck size={14} color="var(--green)" style={{ flex: "none" }} />
                <div className="l">
                  <span style={{ color: "var(--text-2)", fontSize: 13 }}>{r}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

interface Site {
  id: string;
  name: string;
  host: string;
  note: string;
}

function ConnectedSites() {
  const toast = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [connected, setConnected] = useState<{ host: string; name: string; connectedAt: string }[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const load = () => api<{ sites: Site[]; connected: typeof connected }>("/api/sites").then((r) => (setSites(r.sites), setConnected(r.connected)));
  useEffect(() => void load(), []);
  const open = async (id: string, url?: string) => {
    try {
      await api(`/api/sites/${id}/open`, { url });
      setOpened(id);
      toast("A browser window opened. Sign in there yourself, then come back and press Done.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const done = async (id: string, url?: string) => {
    await api(`/api/sites/${id}/done`, { url });
    setOpened(null);
    setCustom("");
    await load();
    toast("Connected. YouHired can now apply there using your session.");
  };
  const isOn = (host: string) => connected.find((c) => c.host === host);
  return (
    <>
      <div className="group-title">Connected sites</div>
      <p className="group-desc">
        Some job platforms need an account to apply. Sign in once yourself in YouHired's browser window; YouHired keeps that session on this Mac and applies there for you. It never sees your password and never creates accounts. Automated applying may go against a site's terms, so connect only sites you're comfortable with.
      </p>
      <div className="box">
        {sites.map((s) => {
          const on = isOn(s.host);
          return (
            <div className="srow" key={s.id}>
              <div className="l">
                <b>{s.name}</b>
                <span>{on ? `Connected ${new Date(on.connectedAt).toLocaleDateString()}` : s.note}</span>
              </div>
              <div className="r">
                {opened === s.id ? (
                  <button className="btn primary" onClick={() => done(s.id)}>
                    <CircleCheck size={13} /> Done, I'm signed in
                  </button>
                ) : on ? (
                  <>
                    <button className="btn ghost" onClick={() => open(s.id)}>
                      Sign in again
                    </button>
                    <button className="iconbtn" aria-label={`Disconnect ${s.name}`} onClick={() => api("/api/sites/disconnect", { host: s.host }).then(load)}>
                      <Unlink size={14} />
                    </button>
                  </>
                ) : (
                  <button className="btn" onClick={() => open(s.id)}>
                    <Link2 size={13} /> Sign in
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {connected
          .filter((c) => !sites.some((s) => s.host === c.host))
          .map((c) => (
            <div className="srow" key={c.host}>
              <div className="l">
                <b>{c.name}</b>
                <span>Connected {new Date(c.connectedAt).toLocaleDateString()}</span>
              </div>
              <div className="r">
                <button className="iconbtn" aria-label={`Disconnect ${c.name}`} onClick={() => api("/api/sites/disconnect", { host: c.host }).then(load)}>
                  <Unlink size={14} />
                </button>
              </div>
            </div>
          ))}
        <div className="srow">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Another site's sign-in link, e.g. https://jobs.example.com/login" />
          {opened === "custom" ? (
            <button className="btn primary" onClick={() => done("custom", custom)}>
              Done
            </button>
          ) : (
            <button className="btn" disabled={!/^https:\/\//.test(custom)} onClick={() => open("custom", custom)}>
              <Link2 size={13} /> Sign in
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function YourChrome({ autoOn, onToggle }: { autoOn: boolean; onToggle: (v: boolean) => void }) {
  const toast = useToast();
  const [st, setSt] = useState<{ connected: boolean; code: string; server: string; version: string; folder: string } | null>(null);
  useEffect(() => {
    const load = () => api<typeof st>("/api/extension").then(setSt).catch(() => {});
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Copied"));
  return (
    <>
      <div className="group-title">Your Chrome</div>
      <p className="group-desc">
        Apply in your everyday Chrome instead of YouHired's own browser. Sites see your normal browser, so invisible human checks usually just pass, and if a puzzle does show, you solve it once in your own tab. Needs the small YouHired extension (one-time setup).
      </p>
      <div className="box">
        <div className="srow">
          <div className="l">
            <b>Apply in my Chrome</b>
            <span>
              {st?.connected ? (
                <>
                  <span className="dotlive" style={{ display: "inline-block", marginRight: 6 }} />
                  Extension connected{st.version ? ` (v${st.version})` : ""}
                </>
              ) : (
                "Extension not connected yet. Follow the steps below."
              )}
            </span>
          </div>
          <Switch label="Apply in my Chrome" checked={autoOn} onChange={onToggle} />
        </div>
        <div className="srow stack">
          <div className="l">
            <b>Set up (once)</b>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", lineHeight: 1.8 }}>
            <li>
              In Chrome, open <code>chrome://extensions</code> and turn on <b>Developer mode</b> (top right).
            </li>
            <li>
              Click <b>Load unpacked</b> and choose the <code>extension</code> folder inside YouHired:{" "}
              <button className="link" onClick={() => st && copy(st.folder)}>
                copy the folder path
              </button>
              .
            </li>
            <li>Click the YouHired icon in Chrome's toolbar (pin it from the puzzle-piece menu), paste this code, and press Connect.</li>
          </ol>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={st?.code ?? "…"} style={{ fontFamily: "ui-monospace, Menlo, monospace" }} />
            <button className="btn" onClick={() => st && copy(st.code)}>
              Copy code
            </button>
          </div>
          <span className="faint" style={{ fontSize: 12 }}>
            The extension only talks to YouHired on this Mac ({st?.server ?? "localhost"}), only acts in tabs YouHired opens, and never reads your other tabs.
          </span>
        </div>
      </div>
    </>
  );
}
