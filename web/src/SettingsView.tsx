import { CircleCheck, CircleAlert, ExternalLink, KeyRound, LoaderCircle, RefreshCw, Settings as Cog, ShieldCheck } from "lucide-react";
import { useState } from "react";
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
          <p className="lede">JobPilot runs on your own AI account. Your key stays on this Mac in a file only you can read. It's never logged or sent anywhere except to the provider you pick.</p>

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

          <div className="group-title">Applying</div>
          <div className="box">
            <div className="srow">
              <div className="l">
                <b>Autopilot: submit applications for me</b>
                <span>On: JobPilot fills each form and submits it, then marks it Applied once the confirmation page shows (the employer usually emails you too). Off: it fills each form and waits for you to press Submit. Either way, questions it can't answer truthfully come to your Inbox.</span>
              </div>
              <Switch label="Autopilot" checked={s.autoSubmit} onChange={(v) => save({ autoSubmit: v })} />
            </div>
            <div className="srow">
              <div className="l">
                <b>Work in the background</b>
                <span>On: no browser window pops up. JobPilot fills forms out of sight and you review them from the screenshot here, then press Submit. Off: you watch it fill each form in a Chrome window.</span>
              </div>
              <Switch label="Work in the background" checked={!!s.background} onChange={(v) => save({ background: v })} />
            </div>
            <div className="srow">
              <div className="l">
                <b>Browser</b>
                <span>JobPilot opens its own window with a separate profile. It never sees your everyday browser, passwords or cookies.</span>
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

          <div className="group-title">Always on</div>
          <div className="box">
            {[
              "Never states a false location, work authorisation or experience.",
              "Questions it can't answer from your profile go to your Inbox. It never guesses.",
              "Never creates accounts, types passwords or solves CAPTCHAs. Those jobs go to Do it yourself.",
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
