import { useEffect, useState } from "react";
import { api } from "./api";
import type { AppState, SearchPrefs, SourceId } from "./types";

interface Progress {
  running: boolean;
  log: string[];
  found: number;
  skipped: number;
  scored: number;
  errors: string[];
}

const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

const SOURCE_NOTES: Partial<Record<SourceId, string>> = {
  remotive: "Remotive's robots.txt currently asks tools not to use its API, so JobPilot won't fetch it.",
  remoteok: "Postings link back to Remote OK, as its terms ask.",
  himalayas: "Postings link back to Himalayas, as its terms ask.",
};

export function SearchView({ state, refresh, onDone }: { state: AppState; refresh: () => Promise<void>; onDone: () => void }) {
  const [p, setP] = useState<SearchPrefs>(state.search);
  const [prog, setProg] = useState<Progress | null>(null);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await api<Progress>("/api/search/progress").catch(() => null);
      if (stop || !r) return;
      setProg(r);
      if (r.running) setTimeout(tick, 1000);
      else void refresh();
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [refresh]);

  const save = (next: Partial<SearchPrefs>) => {
    const merged = { ...p, ...next };
    setP(merged);
    void api("/api/search/prefs", merged);
  };

  const run = async () => {
    setErr("");
    try {
      await api("/api/search/prefs", p);
      await api("/api/search/run", {});
      setProg({ running: true, log: ["Starting…"], found: 0, skipped: 0, scored: 0, errors: [] });
      const poll = async () => {
        const r = await api<Progress>("/api/search/progress");
        setProg(r);
        if (r.running) setTimeout(poll, 1000);
        else await refresh();
      };
      setTimeout(poll, 800);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const addUrl = async () => {
    try {
      await api("/api/jobs/add", { url });
      setUrl("");
      await refresh();
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const where = [state.profile.city, state.profile.country].filter(Boolean).join(", ");

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1>Search</h1>
          <p className="muted">
            Pulls postings from public job boards, keeps the ones you can be hired for from {where || "your country (set it in Profile)"}, and has your AI score the fit.
          </p>
        </div>
        <button className="btn" onClick={run} disabled={prog?.running}>
          {prog?.running ? "Searching…" : "Run search"}
        </button>
      </header>
      {err && <div className="alert red">{err}</div>}

      {prog && prog.log.length > 0 && (
        <section className="card">
          <h3>{prog.running ? "Searching" : "Last search"}</h3>
          <p className="small">
            {prog.found} kept · {prog.skipped} skipped · {prog.scored} scored by AI
          </p>
          <pre className="log">{prog.log.slice(-14).join("\n")}</pre>
          {!prog.running && (
            <button className="btn ghost" onClick={onDone}>
              See results
            </button>
          )}
        </section>
      )}

      <section className="card">
        <h3>What you're looking for</h3>
        <label className="field">
          <span>Job titles (comma-separated)</span>
          <input defaultValue={p.titles.join(", ")} onBlur={(e) => save({ titles: list(e.target.value) })} placeholder="product designer, ux designer" />
          <span className="muted small">A posting matches when its title contains every word of one of these.</span>
        </label>
        <label className="field">
          <span>Leave out titles containing</span>
          <input defaultValue={p.excludeKeywords.join(", ")} onBlur={(e) => save({ excludeKeywords: list(e.target.value) })} placeholder="intern, principal" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Posted within (days)</span>
            <input type="number" value={p.maxAgeDays} onChange={(e) => save({ maxAgeDays: +e.target.value })} />
          </label>
          <label className="field">
            <span>Score at most (jobs per search)</span>
            <input type="number" value={p.maxToScore} onChange={(e) => save({ maxToScore: +e.target.value })} />
            <span className="muted small">Each scored job is one AI call on your key.</span>
          </label>
        </div>
        <p className="muted small">
          Location rules come from your Profile: country of residence, where you're authorised to work, and whether you take contractor roles. Roles open worldwide, to your region (e.g. EMEA), or to
          contractors anywhere are kept; roles limited to countries where you lack authorisation are skipped, with the exact wording saved as evidence.
        </p>
      </section>

      <section className="card">
        <h3>Sources</h3>
        {(Object.keys(state.sources) as SourceId[]).map((id) => (
          <label key={id} className="toggle">
            <input type="checkbox" checked={!!p.sources[id]} onChange={(e) => save({ sources: { ...p.sources, [id]: e.target.checked } })} />
            <span>
              {state.sources[id]}
              {SOURCE_NOTES[id] && (
                <>
                  <br />
                  <span className="muted small">{SOURCE_NOTES[id]}</span>
                </>
              )}
            </span>
          </label>
        ))}
        <div className="grid3">
          <label className="field">
            <span>Greenhouse boards</span>
            <textarea rows={4} defaultValue={p.greenhouseBoards.join("\n")} onBlur={(e) => save({ greenhouseBoards: list(e.target.value) })} />
          </label>
          <label className="field">
            <span>Lever companies</span>
            <textarea rows={4} defaultValue={p.leverCompanies.join("\n")} onBlur={(e) => save({ leverCompanies: list(e.target.value) })} />
          </label>
          <label className="field">
            <span>Ashby boards</span>
            <textarea rows={4} defaultValue={p.ashbyOrgs.join("\n")} onBlur={(e) => save({ ashbyOrgs: list(e.target.value) })} />
          </label>
        </div>
        <p className="muted small">
          A board name is the bit of the company's careers URL after the ATS domain, e.g. <code>boards.greenhouse.io/<b>gitlab</b></code>, <code>jobs.lever.co/<b>toptal</b></code>,{" "}
          <code>jobs.ashbyhq.com/<b>zapier</b></code>. One per line.
        </p>
      </section>

      <section className="card">
        <h3>Add one job by link</h3>
        <div className="row">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://job-boards.greenhouse.io/…" />
          <button className="btn ghost" onClick={addUrl} disabled={!url}>
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
