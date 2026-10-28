import { useState } from "react";
import { api } from "./api";
import type { AppState, Profile, WorkAuthStatus } from "./types";

const AUTH_LABEL: Record<WorkAuthStatus, string> = {
  citizen: "Citizen",
  authorized: "Authorised (visa / permit / residency)",
  needs_sponsorship: "Would need sponsorship",
  not_authorized: "Not authorised",
};

export function ProfileView({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const [p, setP] = useState<Profile>(state.profile);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [hint, setHint] = useState("");
  const [newCountry, setNewCountry] = useState("");

  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch, confirmed: false });

  const save = async (confirm = false) => {
    setMsg(null);
    if (confirm) {
      const missing = [
        ["legal name", p.legalName],
        ["email", p.email],
        ["phone", p.phone],
        ["country of residence", p.country],
        ["city", p.city],
      ].filter(([, v]) => !String(v).trim());
      if (missing.length) return setMsg({ tone: "red", text: `Fill in: ${missing.map(([k]) => k).join(", ")}.` });
    }
    const saved = await api<Profile>("/api/profile", { ...p, confirmed: confirm });
    setP(saved);
    await refresh();
    setMsg({ tone: "green", text: confirm ? "Confirmed. JobPilot will only ever use these facts as written." : "Saved." });
  };

  const upload = async (file: File) => {
    setUploading(true);
    setMsg(null);
    try {
      await api("/api/profile", p);
      const fd = new FormData();
      fd.append("cv", file);
      const r = await api<{ profile: Profile; locationOnCv: string }>("/api/cv", fd);
      setP(r.profile);
      setHint(r.locationOnCv);
      await refresh();
      setMsg({ tone: "green", text: "CV read. Check what was pulled out below, then confirm your facts." });
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
      await refresh();
    } finally {
      setUploading(false);
    }
  };

  const text = (label: string, key: keyof Profile, placeholder = "", note?: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={String(p[key] ?? "")} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<Profile>)} />
      {note && <span className="muted small">{note}</span>}
    </label>
  );

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1>Profile</h1>
          <p className="muted">Your CV gives JobPilot your experience. The facts below it are yours to confirm. JobPilot never guesses them.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => save(false)}>
            Save draft
          </button>
          <button className="btn" onClick={() => save(true)}>
            {p.confirmed ? "Confirmed ✓" : "Confirm facts"}
          </button>
        </div>
      </header>
      {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}

      <section className="card">
        <h3>CV</h3>
        <label className="drop">
          <input type="file" accept=".pdf,.docx" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {uploading ? "Reading your CV…" : p.cvFileName ? `${p.cvFileName} · click to replace` : "Upload your CV (PDF or DOCX)"}
        </label>
        <p className="muted small">This file is uploaded to application forms as-is. Your AI reads it once to fill in your experience below.</p>
      </section>

      <section className="card">
        <h3>Facts only you can confirm</h3>
        <div className="grid2">
          {text("Legal name", "legalName")}
          {text("Preferred name", "preferredName", "Optional")}
          {text("Email", "email")}
          {text("Phone (with country code)", "phone", "+234 …")}
          {text("Country you live in", "country", "Nigeria", hint ? `Your CV says: ${hint}` : undefined)}
          {text("City", "city", "Lagos")}
          {text("Timezone", "timezone", "UTC+1")}
          {text("Pronouns", "pronouns", "Optional")}
          {text("Notice period / when you can start", "noticePeriod", "e.g. 4 weeks")}
        </div>
      </section>

      <section className="card">
        <h3>Where you can legally work</h3>
        <p className="muted small">Your country of residence counts automatically. Add every other country where you're a citizen or hold a visa/permit, and where you're not, so questions get honest answers.</p>
        <table className="mini">
          <tbody>
            {Object.entries(p.workAuth).map(([c, st]) => (
              <tr key={c}>
                <td>{c}</td>
                <td>
                  <select value={st} onChange={(e) => set({ workAuth: { ...p.workAuth, [c]: e.target.value as WorkAuthStatus } })}>
                    {Object.entries(AUTH_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="link"
                    onClick={() => {
                      const w = { ...p.workAuth };
                      delete w[c];
                      set({ workAuth: w });
                    }}
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <input value={newCountry} onChange={(e) => setNewCountry(e.target.value)} placeholder="Country, e.g. United States" />
          <button
            className="btn ghost"
            disabled={!newCountry.trim()}
            onClick={() => {
              set({ workAuth: { ...p.workAuth, [newCountry.trim()]: "not_authorized" } });
              setNewCountry("");
            }}
          >
            Add country
          </button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={p.needsSponsorship} onChange={(e) => set({ needsSponsorship: e.target.checked })} />
          <span>I would need visa sponsorship to work in countries where I'm not authorised</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={p.openToContractor} onChange={(e) => set({ openToContractor: e.target.checked })} />
          <span>I'm open to contractor arrangements (e.g. via Deel or Remote.com)</span>
        </label>
      </section>

      <section className="card">
        <h3>Salary questions</h3>
        <label className="toggle">
          <input type="checkbox" checked={p.salary.leaveBlankIfOptional} onChange={(e) => set({ salary: { ...p.salary, leaveBlankIfOptional: e.target.checked } })} />
          <span>Leave salary blank when the question is optional</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={p.salary.usePostedMinimum} onChange={(e) => set({ salary: { ...p.salary, usePostedMinimum: e.target.checked } })} />
          <span>If the posting shows a pay range, answer with its minimum</span>
        </label>
        <div className="grid3">
          <label className="field">
            <span>Default amount (when a number is required)</span>
            <input type="number" value={p.salary.defaultAmount ?? ""} onChange={(e) => set({ salary: { ...p.salary, defaultAmount: e.target.value ? +e.target.value : null } })} placeholder="Leave blank to be asked" />
          </label>
          <label className="field">
            <span>Currency</span>
            <input value={p.salary.currency} onChange={(e) => set({ salary: { ...p.salary, currency: e.target.value } })} />
          </label>
          <label className="field">
            <span>Per</span>
            <select value={p.salary.period} onChange={(e) => set({ salary: { ...p.salary, period: e.target.value as Profile["salary"]["period"] } })}>
              <option value="year">year</option>
              <option value="month">month</option>
              <option value="hour">hour</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Text answer for written salary questions</span>
          <input value={p.salary.textAnswer} onChange={(e) => set({ salary: { ...p.salary, textAnswer: e.target.value } })} />
        </label>
      </section>

      <section className="card">
        <h3>Links</h3>
        <div className="grid2">
          {(["portfolio", "linkedin", "github", "website"] as const).map((k) => (
            <label className="field" key={k}>
              <span>{{ portfolio: "Portfolio", linkedin: "LinkedIn", github: "GitHub", website: "Website" }[k]}</span>
              <input value={p.links[k]} onChange={(e) => set({ links: { ...p.links, [k]: e.target.value } })} placeholder="https://" />
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Equal-opportunity questions</h3>
        <p className="muted small">Default is to decline to self-identify. Change any of these if you'd rather answer.</p>
        <div className="grid2">
          {(["gender", "race", "veteran", "disability"] as const).map((k) => (
            <label className="field" key={k}>
              <span>{{ gender: "Gender", race: "Race / ethnicity", veteran: "Veteran status", disability: "Disability" }[k]}</span>
              <input value={p.eeo[k]} onChange={(e) => set({ eeo: { ...p.eeo, [k]: e.target.value } })} />
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Never apply to</h3>
        <textarea rows={3} defaultValue={p.neverApply.join("\n")} onBlur={(e) => set({ neverApply: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} placeholder="One company per line" />
      </section>

      <section className="card">
        <h3>From your CV</h3>
        <p className="muted small">Pulled out by your AI. Edit freely. AI-written answers may only use what's here and in the CV itself.</p>
        <label className="field">
          <span>Headline</span>
          <input value={p.headline} onChange={(e) => set({ headline: e.target.value })} />
        </label>
        <label className="field">
          <span>Summary</span>
          <textarea rows={3} value={p.summary} onChange={(e) => set({ summary: e.target.value })} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Years of experience</span>
            <input type="number" value={p.yearsExperience ?? ""} onChange={(e) => set({ yearsExperience: e.target.value ? +e.target.value : null })} />
          </label>
          <label className="field">
            <span>Skills</span>
            <input defaultValue={p.skills.join(", ")} onBlur={(e) => set({ skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
          </label>
        </div>
        {p.experience.length > 0 && (
          <div className="exp">
            {p.experience.map((e, i) => (
              <div key={i}>
                <b>{e.title}</b> · {e.company} <span className="muted small">{[e.start, e.end].filter(Boolean).join(" – ")}</span>
                <ul>
                  {e.highlights.map((h, j) => (
                    <li key={j} className="small">
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {p.savedAnswers.length > 0 && (
        <section className="card">
          <h3>Answers you've given</h3>
          <p className="muted small">Reused whenever a form asks the same question.</p>
          {p.savedAnswers.map((a, i) => (
            <label className="field" key={i}>
              <span>
                {a.question}{" "}
                <button className="link" onClick={() => set({ savedAnswers: p.savedAnswers.filter((_, j) => j !== i) })}>
                  remove
                </button>
              </span>
              <input value={a.answer} onChange={(e) => set({ savedAnswers: p.savedAnswers.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })} />
            </label>
          ))}
        </section>
      )}

      <div className="row end">
        <button className="btn" onClick={() => save(true)}>
          {p.confirmed ? "Confirmed ✓" : "Confirm facts"}
        </button>
      </div>
    </div>
  );
}
