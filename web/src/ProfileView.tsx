import { CircleAlert, CircleCheck, FileText, LoaderCircle, Plus, Trash2, Upload, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Ctx } from "./App";
import type { Profile, WorkAuthStatus } from "./types";
import { Switch, TagInput, useToast } from "./ui";

type Tab = "basics" | "work" | "salary" | "links" | "cv" | "answers";

const AUTH: Record<WorkAuthStatus, string> = {
  citizen: "Citizen",
  authorized: "Authorised (visa / permit)",
  needs_sponsorship: "Would need sponsorship",
  not_authorized: "Not authorised",
};

export function ProfileView({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [p, setP] = useState<Profile>(ctx.state.profile);
  const [tab, setTab] = useState<Tab>(ctx.state.profile.cvFileName ? "basics" : "cv");
  const [uploading, setUploading] = useState(false);
  const [hint, setHint] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const saveT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  // Autosave. Any edit means the facts need confirming again.
  // Only the facts JobPilot states on forms need re-confirming when they change.
  const FACTS: (keyof Profile)[] = ["legalName", "email", "phone", "country", "city", "workAuth", "needsSponsorship", "openToContractor", "salary", "currentCompensation", "noticePeriod", "eeo", "neverApply"];
  const set = (patch: Partial<Profile>) => {
    const factChanged = Object.keys(patch).some((k) => FACTS.includes(k as keyof Profile));
    const next = { ...p, ...patch, confirmed: factChanged ? false : p.confirmed };
    setP(next);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => void api<Profile>("/api/profile", next).then(() => ctx.refresh()), 500);
  };
  useEffect(() => () => clearTimeout(saveT.current), []);

  const missing = [
    ["Legal name", p.legalName],
    ["Email", p.email],
    ["Phone", p.phone],
    ["Country you live in", p.country],
    ["City", p.city],
  ].filter(([, v]) => !String(v).trim()).map(([k]) => k);

  const confirm = async () => {
    if (missing.length) {
      setTab("basics");
      return toast(`Fill in: ${missing.join(", ")}`, "error");
    }
    clearTimeout(saveT.current);
    const saved = await api<Profile>("/api/profile", { ...p, confirmed: true });
    setP(saved);
    await ctx.refresh();
    toast("Facts confirmed. JobPilot will only use them as written.");
  };

  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const buildStoryBank = async () => {
    setBuilding(true);
    try {
      await api("/api/profile", p);
      const r = await api<{ profile: Profile }>("/api/stories/build", {});
      setP(r.profile);
      await ctx.refresh();
      toast(`Built ${r.profile.stories?.length ?? 0} stories from your documents.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBuilding(false);
    }
  };
  const uploadLinkedIn = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ profile: Profile }>("/api/linkedin", fd);
      setP(r.profile);
      await ctx.refresh();
      toast("LinkedIn profile read.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const readSite = async () => {
    setReading(true);
    try {
      await api("/api/profile", p);
      const r = await api<{ profile: Profile; pages: number }>("/api/portfolio/read", {});
      setP(r.profile);
      await ctx.refresh();
      toast(`Read ${r.pages} page${r.pages === 1 ? "" : "s"} from your site.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setReading(false);
    }
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      await api("/api/profile", p);
      const fd = new FormData();
      fd.append("cv", file);
      const r = await api<{ profile: Profile; locationOnCv: string }>("/api/cv", fd);
      setP(r.profile);
      setHint(r.locationOnCv);
      await ctx.refresh();
      toast("CV read. Check your experience, then confirm your facts.");
    } catch (e) {
      toast((e as Error).message, "error");
      await ctx.refresh();
    } finally {
      setUploading(false);
    }
  };

  const text = (label: string, key: keyof Profile, placeholder = "", note?: string) => (
    <div className="f">
      <label htmlFor={`p-${String(key)}`}>{label}</label>
      <input id={`p-${String(key)}`} value={String(p[key] ?? "")} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<Profile>)} />
      {note && <div className="note">{note}</div>}
    </div>
  );

  const tabs: { id: Tab; label: string; warn?: boolean }[] = [
    { id: "cv", label: "CV & experience", warn: !p.cvFileName },
    { id: "basics", label: "Basics", warn: missing.length > 0 },
    { id: "work", label: "Right to work" },
    { id: "salary", label: "Salary & notice" },
    { id: "links", label: "Links & EEO" },
    { id: "answers", label: `Saved answers${p.savedAnswers.length ? ` (${p.savedAnswers.length})` : ""}` },
  ];

  return (
    <>
      <div className="topbar">
        <div className="title">
          <User size={15} /> Profile
        </div>
        <div className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          Changes save automatically
        </span>
        <button className={`btn ${p.confirmed ? "" : "primary"}`} onClick={confirm}>
          {p.confirmed ? <CircleCheck size={14} color="var(--green)" /> : null}
          {p.confirmed ? "Confirmed" : "Confirm facts"}
        </button>
      </div>
      <div className="content">
        <div className="page">
          <h1>Your profile</h1>
          <p className="lede">Your CV tells JobPilot what you've done. The facts here (where you live, where you can work, salary) are only ever used exactly as you write them.</p>

          {p.confirmed ? (
            <div className="banner ok">
              <CircleCheck size={16} color="var(--green)" />
              <div className="grow">
                <b>Facts confirmed</b>
                <span>JobPilot can fill applications. Editing anything will ask you to confirm again.</span>
              </div>
            </div>
          ) : (
            <div className="banner">
              <CircleAlert size={16} color="var(--amber)" />
              <div className="grow">
                <b>Confirm your facts before applying</b>
                <span>{missing.length ? `Still needed: ${missing.join(", ")}.` : "Check each tab, then confirm. Nothing is guessed."}</span>
              </div>
              <button className="btn primary" onClick={confirm}>
                Confirm facts
              </button>
            </div>
          )}

          <div className="pagetabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label}
                {t.warn && <span className="warn" />}
              </button>
            ))}
          </div>

          {tab === "cv" && (
            <>
              <label className="drop">
                <input ref={fileRef} type="file" accept=".pdf,.docx" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <span className="ic">{uploading ? <LoaderCircle size={17} className="spin" /> : p.cvFileName ? <FileText size={17} /> : <Upload size={17} />}</span>
                <div>
                  <b>{uploading ? "Reading your CV…" : p.cvFileName || "Upload your CV"}</b>
                  <span>{p.cvFileName ? "Click to replace. This exact file is attached to applications." : "PDF or DOCX. Your AI reads it once to learn your experience."}</span>
                </div>
              </label>

              <div className="group-title">More about you</div>
              <p className="group-desc">The more JobPilot knows, the more questions it answers by itself. Everything stays on this Mac.</p>
              <div className="box">
                <div className="srow">
                  <div className="l">
                    <b>LinkedIn profile</b>
                    <span>{p.linkedinText ? `Read (${Math.round(p.linkedinText.length / 1000)}k characters). Upload again to refresh.` : "On LinkedIn, open your profile → More → Save to PDF, then upload that file here."}</span>
                  </div>
                  <div className="r">
                    <label className="btn">
                      <input type="file" accept=".pdf" hidden onChange={(e) => e.target.files?.[0] && uploadLinkedIn(e.target.files[0])} />
                      <Upload size={13} /> {p.linkedinText ? "Replace PDF" : "Upload PDF"}
                    </label>
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <b>Portfolio site</b>
                    <span>{p.portfolioText ? `Read (${Math.round(p.portfolioText.length / 1000)}k characters from ${p.links.portfolio || p.links.website}).` : p.links.portfolio || p.links.website ? `JobPilot reads ${p.links.portfolio || p.links.website} so it knows your projects.` : "Add your portfolio link under Links & EEO first."}</span>
                  </div>
                  <div className="r">
                    <button className="btn" disabled={!(p.links.portfolio || p.links.website) || reading} onClick={readSite}>
                      {reading ? <LoaderCircle size={13} className="spin" /> : <FileText size={13} />} {p.portfolioText ? "Read again" : "Read my site"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="group-title">Summary</div>
              <p className="group-desc">Pulled from your CV by your AI. Edit freely. Written answers can only use what's here and in the CV.</p>
              <div className="box">
                <div className="srow stack">
                  <div className="f">
                    <label>Headline</label>
                    <input value={p.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="Product designer, 7 years in fintech" />
                  </div>
                  <div className="f">
                    <label>Summary</label>
                    <textarea rows={3} value={p.summary} onChange={(e) => set({ summary: e.target.value })} />
                  </div>
                  <div className="grid2">
                    <div className="f">
                      <label>Years of experience</label>
                      <input type="number" value={p.yearsExperience ?? ""} onChange={(e) => set({ yearsExperience: e.target.value ? +e.target.value : null })} />
                    </div>
                  </div>
                  <div className="f">
                    <label>Skills</label>
                    <TagInput value={p.skills} onChange={(v) => set({ skills: v })} placeholder="Figma, research…" />
                  </div>
                </div>
              </div>
              <div className="group-title" style={{ display: "flex", alignItems: "center" }}>
                Your stories
                <button className="btn ghost sm" style={{ marginLeft: "auto" }} disabled={!p.cvText || building} onClick={buildStoryBank}>
                  {building ? <LoaderCircle size={12} className="spin" /> : <FileText size={12} />} {p.stories?.length ? "Rebuild from my documents" : "Build from my documents"}
                </button>
              </div>
              <p className="group-desc">Your strongest career stories. JobPilot uses them for "tell us about a time…" questions, so answers sound like you. Edit or remove any.</p>
              {(p.stories ?? []).length > 0 ? (
                <div className="box">
                  {p.stories!.map((st, i) => (
                    <div className="srow stack" key={i}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input value={st.title} onChange={(e) => set({ stories: p.stories!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} style={{ fontWeight: 500 }} />
                        <button className="iconbtn" aria-label="Remove story" onClick={() => set({ stories: p.stories!.filter((_, j) => j !== i) })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <textarea rows={3} value={`${st.situation}\n${st.action}\n${st.result}`} onChange={(e) => {
                        const [situation = "", action = "", ...rest] = e.target.value.split("\n");
                        set({ stories: p.stories!.map((x, j) => (j === i ? { ...x, situation, action, result: rest.join(" ") } : x)) });
                      }} />
                      <span className="faint" style={{ fontSize: 11.5 }}>{st.tags.join(" · ")}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="faint" style={{ fontSize: 12.5 }}>No stories yet.</p>
              )}

              {p.experience.length > 0 && (
                <>
                  <div className="group-title">Experience</div>
                  <div className="box">
                    {p.experience.map((e, i) => (
                      <div className="exp" key={i}>
                        <b>{e.title}</b> <span className="muted">· {e.company}</span> <span className="faint">{[e.start, e.end].filter(Boolean).join(" – ")}</span>
                        {e.highlights.length > 0 && (
                          <ul>
                            {e.highlights.map((h, j) => (
                              <li key={j}>{h}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {tab === "basics" && (
            <div className="box">
              <div className="srow stack">
                <div className="grid2">
                  {text("Legal name", "legalName", "As on your ID")}
                  {text("Preferred name", "preferredName", "Optional")}
                  {text("Email", "email", "you@example.com")}
                  {text("Phone", "phone", "+234 …", "Include the country code")}
                  {text("Country you live in", "country", "Nigeria", hint ? `Your CV says: ${hint}` : undefined)}
                  {text("City", "city", "Lagos")}
                  {text("Timezone", "timezone", "UTC+1")}
                  {text("Pronouns", "pronouns", "Optional")}
                </div>
              </div>
            </div>
          )}

          {tab === "work" && (
            <>
              <p className="group-desc">Your country of residence counts automatically. Add every other country where you're a citizen or hold a permit, and the ones where you aren't, so authorisation questions get honest answers.</p>
              <div className="box">
                {Object.entries(p.workAuth).map(([c, st]) => (
                  <div className="srow" key={c}>
                    <div className="l">
                      <b>{c}</b>
                    </div>
                    <div className="r">
                      <select value={st} onChange={(e) => set({ workAuth: { ...p.workAuth, [c]: e.target.value as WorkAuthStatus } })}>
                        {Object.entries(AUTH).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <button
                        className="iconbtn"
                        aria-label={`Remove ${c}`}
                        onClick={() => {
                          const w = { ...p.workAuth };
                          delete w[c];
                          set({ workAuth: w });
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="srow">
                  <input value={newCountry} onChange={(e) => setNewCountry(e.target.value)} placeholder="Add a country, e.g. United States" onKeyDown={(e) => e.key === "Enter" && newCountry.trim() && (set({ workAuth: { ...p.workAuth, [newCountry.trim()]: "not_authorized" } }), setNewCountry(""))} />
                  <button
                    className="btn"
                    disabled={!newCountry.trim()}
                    onClick={() => {
                      set({ workAuth: { ...p.workAuth, [newCountry.trim()]: "not_authorized" } });
                      setNewCountry("");
                    }}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
              </div>
              <div className="group-title">Arrangements</div>
              <div className="box">
                <div className="srow">
                  <div className="l">
                    <b>Need visa sponsorship elsewhere</b>
                    <span>For countries where you aren't authorised to work.</span>
                  </div>
                  <Switch label="Needs sponsorship" checked={p.needsSponsorship} onChange={(v) => set({ needsSponsorship: v })} />
                </div>
                <div className="srow">
                  <div className="l">
                    <b>Open to contractor roles</b>
                    <span>For example through Deel or Remote.com. Keeps "contractors anywhere" roles.</span>
                  </div>
                  <Switch label="Open to contractor roles" checked={p.openToContractor} onChange={(v) => set({ openToContractor: v })} />
                </div>
              </div>
              <div className="group-title">Never apply to</div>
              <TagInput value={p.neverApply} onChange={(v) => set({ neverApply: v })} placeholder="Company names, press Enter after each" />
            </>
          )}

          {tab === "salary" && (
            <>
              <div className="box">
                <div className="srow">
                  <div className="l">
                    <b>Leave optional salary questions blank</b>
                  </div>
                  <Switch label="Leave optional blank" checked={p.salary.leaveBlankIfOptional} onChange={(v) => set({ salary: { ...p.salary, leaveBlankIfOptional: v } })} />
                </div>
                <div className="srow">
                  <div className="l">
                    <b>Use the posted minimum</b>
                    <span>When the posting shows a pay range, answer with its lowest figure.</span>
                  </div>
                  <Switch label="Use posted minimum" checked={p.salary.usePostedMinimum} onChange={(v) => set({ salary: { ...p.salary, usePostedMinimum: v } })} />
                </div>
                <div className="srow">
                  <div className="l">
                    <b>Default amount</b>
                    <span>Used when a number is required and no range is posted. Leave blank to be asked.</span>
                  </div>
                  <div className="r">
                    <input type="number" style={{ width: 120 }} value={p.salary.defaultAmount ?? ""} onChange={(e) => set({ salary: { ...p.salary, defaultAmount: e.target.value ? +e.target.value : null } })} />
                    <input style={{ width: 70 }} value={p.salary.currency} onChange={(e) => set({ salary: { ...p.salary, currency: e.target.value } })} aria-label="Currency" />
                    <select style={{ width: 90 }} value={p.salary.period} onChange={(e) => set({ salary: { ...p.salary, period: e.target.value as Profile["salary"]["period"] } })} aria-label="Period">
                      <option value="year">/ year</option>
                      <option value="month">/ month</option>
                      <option value="hour">/ hour</option>
                    </select>
                  </div>
                </div>
                <div className="srow stack">
                  <div className="l">
                    <b>Written answer</b>
                    <span>For questions like "What are your salary expectations?"</span>
                  </div>
                  <input value={p.salary.textAnswer} onChange={(e) => set({ salary: { ...p.salary, textAnswer: e.target.value } })} />
                </div>
              </div>
              <div className="group-title">Current pay</div>
              <div className="box">
                <div className="srow">
                  <div className="l">
                    <b>Current or most recent compensation</b>
                    <span>For "current CTC" / "current salary" questions. Only you know this; enter it once and JobPilot fills it everywhere.</span>
                  </div>
                  <div className="r">
                    <input value={p.currentCompensation ?? ""} onChange={(e) => set({ currentCompensation: e.target.value })} placeholder="e.g. ₦18,000,000 per year" />
                  </div>
                </div>
              </div>

              <div className="group-title">Availability</div>
              <div className="box">
                <div className="srow">
                  <div className="l">
                    <b>Notice period</b>
                    <span>Used for "When can you start?"</span>
                  </div>
                  <div className="r">
                    <input value={p.noticePeriod} onChange={(e) => set({ noticePeriod: e.target.value })} placeholder="e.g. 4 weeks" />
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "links" && (
            <>
              <div className="box">
                {(["portfolio", "linkedin", "github", "website"] as const).map((k) => (
                  <div className="srow" key={k}>
                    <div className="l">
                      <b>{{ portfolio: "Portfolio", linkedin: "LinkedIn", github: "GitHub", website: "Website" }[k]}</b>
                    </div>
                    <div className="r" style={{ width: 360 }}>
                      <input value={p.links[k]} onChange={(e) => set({ links: { ...p.links, [k]: e.target.value } })} placeholder="https://" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="group-title">Equal-opportunity questions</div>
              <p className="group-desc">By default JobPilot declines to self-identify, using the form's own wording. Change any you'd rather answer.</p>
              <div className="box">
                {(["gender", "race", "veteran", "disability"] as const).map((k) => (
                  <div className="srow" key={k}>
                    <div className="l">
                      <b>{{ gender: "Gender", race: "Race / ethnicity", veteran: "Veteran status", disability: "Disability" }[k]}</b>
                    </div>
                    <div className="r" style={{ width: 360 }}>
                      <input value={p.eeo[k]} onChange={(e) => set({ eeo: { ...p.eeo, [k]: e.target.value } })} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "answers" &&
            (p.savedAnswers.length ? (
              <>
                <p className="group-desc">Answers you've given to questions JobPilot couldn't answer. Reused whenever a form asks the same thing.</p>
                <div className="box">
                  {p.savedAnswers.map((a, i) => (
                    <div className="srow stack" key={i}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <div className="l">
                          <b>{a.question}</b>
                        </div>
                        <button className="iconbtn" aria-label="Remove answer" onClick={() => set({ savedAnswers: p.savedAnswers.filter((_, j) => j !== i) })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <input value={a.answer} onChange={(e) => set({ savedAnswers: p.savedAnswers.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty" style={{ margin: "40px auto" }}>
                <p>No saved answers yet. When a form asks something only you can answer, your reply is kept here and reused.</p>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
