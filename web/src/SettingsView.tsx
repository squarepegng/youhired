import { useState } from "react";
import { api } from "./api";
import type { AppState, Settings } from "./types";

export function SettingsView({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const [s, setS] = useState<Settings>(state.settings);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const info = state.providers.find((p) => p.id === s.provider)!;

  const save = async (extra: Partial<Settings> = {}) => {
    const body = { ...s, ...extra, apiKey: key || undefined };
    await api("/api/settings", body);
    setKey("");
    await refresh();
  };
  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await save();
      const r = await api<{ reply: string }>("/api/settings/test", {});
      setMsg({ tone: "green", text: `Connected. The model replied: ${r.reply}` });
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const loadModels = async () => {
    try {
      await save();
      const r = await api<{ models: string[] }>("/api/models");
      setModels(r.models);
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    }
  };

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1>Settings</h1>
          <p className="muted">JobPilot runs on your own AI account. Your key stays on this Mac, in a file only you can read.</p>
        </div>
      </header>

      <section className="card">
        <h3>AI provider</h3>
        <div className="providers">
          {state.providers.map((p) => (
            <button
              key={p.id}
              className={`provider ${s.provider === p.id ? "on" : ""}`}
              onClick={() => {
                setS({ ...s, provider: p.id, model: p.models[0]?.id ?? "", baseUrl: p.id === "compatible" ? s.baseUrl || p.baseUrl : "" });
                setModels([]);
                setMsg(null);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Model</span>
          <input list="models" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} placeholder="model name" />
          <datalist id="models">
            {[...info.models.map((m) => m.id), ...models].filter(Boolean).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <span className="muted small">
            {info.models.find((m) => m.id === s.model)?.note ?? info.models[0]?.note}
            {" · "}
            <button className="link" onClick={loadModels}>
              Load models from my account
            </button>
          </span>
        </label>
        {models.length > 0 && <p className="small muted">{models.length} models available. Start typing to pick one.</p>}

        {s.provider === "compatible" && (
          <label className="field">
            <span>Base URL</span>
            <input value={s.baseUrl ?? ""} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1" />
            <span className="muted small">
              OpenRouter: https://openrouter.ai/api/v1 · Ollama on this Mac: http://localhost:11434/v1 (key can be blank). The model must support JSON output.
            </span>
          </label>
        )}

        <label className="field">
          <span>API key</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={state.settings.provider === s.provider && state.settings.hasKey ? `Saved (${state.settings.apiKey}). Paste a new one to replace it.` : "Paste your key"} />
          <span className="muted small">
            Get one at{" "}
            <a href={info.keyUrl} target="_blank" rel="noreferrer">
              {info.keyUrl.replace(/^https:\/\//, "")}
            </a>
            . Saved in <code>data/store.json</code> (never committed, never logged).
          </span>
        </label>

        <div className="row">
          <button className="btn" onClick={test} disabled={busy}>
            {busy ? "Testing…" : "Save & test connection"}
          </button>
          <button className="btn ghost" onClick={() => save().then(() => setMsg({ tone: "green", text: "Saved." }))}>
            Save
          </button>
        </div>
        {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
      </section>

      <section className="card">
        <h3>Applying</h3>
        <label className="toggle">
          <input type="checkbox" checked={!s.autoSubmit} onChange={(e) => save({ autoSubmit: !e.target.checked }).then(() => setS({ ...s, autoSubmit: !e.target.checked }))} />
          <span>
            <b>Pause for my review before submitting</b> (recommended)
            <br />
            <span className="muted small">JobPilot fills the form and stops. You check it in the browser window and press Submit. Turn this off to let JobPilot submit on its own when every answer came from your profile and nothing looks odd.</span>
          </span>
        </label>
        <label className="field">
          <span>Browser</span>
          <select value={s.browserChannel} onChange={(e) => save({ browserChannel: e.target.value as Settings["browserChannel"] }).then(() => setS({ ...s, browserChannel: e.target.value as Settings["browserChannel"] }))}>
            <option value="chrome">Google Chrome (installed)</option>
            <option value="msedge">Microsoft Edge (installed)</option>
            <option value="chromium">Playwright Chromium</option>
          </select>
          <span className="muted small">JobPilot opens its own window with a separate profile. It never sees your everyday browser, passwords or cookies.</span>
        </label>
      </section>

      <section className="card">
        <h3>Always on</h3>
        <ul className="rules">
          <li>Never states a false location, work authorisation or experience.</li>
          <li>Questions it can't answer from your profile go to “Needs your answer”. It never guesses.</li>
          <li>Never creates accounts, types passwords or solves CAPTCHAs. Those jobs go to “Do it yourself”.</li>
          <li>Job pages are treated as untrusted. Hidden instructions to AI are ignored, and pages that reject AI-assisted applications are left to you.</li>
          <li>Companies on your never-apply list are always skipped.</li>
        </ul>
      </section>
    </div>
  );
}
