import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { applyBlocker, configureQueue, currentApply, enqueue, queued } from "./apply/queue.js";
import { closeSession, finishHandoff, hasSession, logs, shotPath, submit } from "./apply/runner.js";
import { activity, chat, configureAssistant, resolveAction } from "./assistant.js";
import { cvToText, extractProfile, mergeExtract } from "./cv.js";
import { detectAts, hostNeedsLogin } from "./guardrails.js";
import { PROVIDERS, makeLLM, testConnection } from "./providers/index.js";
import { progress, runSearch } from "./search.js";
import { SOURCE_LABELS } from "./sources/index.js";
import { DATA_DIR, load, maskKey, setStatus, update } from "./store.js";
import { readPortfolio } from "./portfolio.js";
import { buildStories } from "./stories.js";
import { tailoredPath } from "./tailor.js";
import { SITES, disconnect, markConnected, openSignIn } from "./sites.js";
import { toCsv } from "./tracker.js";
import type { Job, Profile, SearchPrefs, Settings } from "./types.js";

const PORT = Number(process.env.PORT || 5173);
const app = express();
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const llmOrNull = () => {
  try {
    return makeLLM(load().settings);
  } catch {
    return null;
  }
};
configureQueue(llmOrNull);
configureAssistant(llmOrNull);
const publicSettings = (s: Settings) => ({ ...s, apiKey: maskKey(s.apiKey), hasKey: !!s.apiKey });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

app.get("/api/state", (_req, res) => {
  const s = load();
  res.json({ settings: publicSettings(s.settings), profile: s.profile, search: s.search, providers: PROVIDERS, sources: SOURCE_LABELS });
});

app.post("/api/settings", (req, res) => {
  const b = req.body as Partial<Settings>;
  const s = update((st) => {
    const prev = st.settings;
    st.settings = {
      ...prev,
      ...b,
      // Empty or masked key in the form = keep the stored one.
      apiKey: b.apiKey && !b.apiKey.includes("••••") ? b.apiKey.trim() : b.provider && b.provider !== prev.provider ? "" : prev.apiKey,
    };
  });
  res.json(publicSettings(s.settings));
});

app.post("/api/settings/test", wrap(async (_req, res) => {
  const llm = makeLLM(load().settings);
  res.json(await testConnection(llm));
}));

app.get("/api/models", wrap(async (_req, res) => {
  res.json({ models: await makeLLM(load().settings).listModels() });
}));

app.post("/api/profile", (req, res) => {
  const b = req.body as Partial<Profile>;
  const s = update((st) => {
    st.profile = { ...st.profile, ...b, confirmed: b.confirmed ?? false };
  });
  res.json(s.profile);
});

app.post("/api/cv", upload.single("cv"), wrap(async (req, res) => {
  const file = req.file;
  if (!file) throw new Error("No file uploaded");
  const name = file.originalname.replace(/[^\w.-]/g, "_");
  if (!/\.(pdf|docx)$/i.test(name)) throw new Error("Upload a PDF or DOCX file.");
  const dir = path.join(DATA_DIR, "cv");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), file.buffer, { mode: 0o600 });
  const text = await cvToText(file.buffer, name);
  update((st) => {
    st.profile.cvFileName = name;
    st.profile.cvText = text;
    st.profile.confirmed = false;
  });
  const llm = makeLLM(load().settings);
  const x = await extractProfile(llm, text);
  const s = update((st) => {
    st.profile = mergeExtract(st.profile, x);
  });
  res.json({ profile: s.profile, locationOnCv: x.location_on_cv });
}));

// LinkedIn's own "Save to PDF" export: more about you for the AI to draw on.
app.post("/api/linkedin", upload.single("file"), wrap(async (req, res) => {
  const file = req.file;
  if (!file || !/\.pdf$/i.test(file.originalname)) throw new Error("Upload the PDF from LinkedIn → your profile → More → Save to PDF.");
  const text = await cvToText(file.buffer, "linkedin.pdf");
  const s = update((st) => void (st.profile.linkedinText = text));
  res.json({ chars: text.length, profile: s.profile });
}));

app.post("/api/portfolio/read", wrap(async (_req, res) => {
  const p = load().profile;
  const url = p.links.portfolio || p.links.website;
  if (!url) throw new Error("Add your portfolio or website link first (Profile → Links & EEO).");
  const r = await readPortfolio(url);
  if (r.text.length < 100) throw new Error("Couldn't read much from that site. It may be built in a way that needs a browser to render.");
  const s = update((st) => void (st.profile.portfolioText = r.text));
  res.json({ pages: r.pages.length, chars: r.text.length, profile: s.profile });
}));

app.post("/api/stories/build", wrap(async (_req, res) => {
  const p = load().profile;
  if (!p.cvText) throw new Error("Upload your CV first.");
  const stories = await buildStories(makeLLM(load().settings), p);
  const s = update((st) => void (st.profile.stories = stories));
  res.json({ profile: s.profile });
}));

app.get("/api/jobs/:id/cv", (req, res) => {
  const job = load().jobs[String(req.params.id)];
  if (!job) return res.status(404).end();
  const f = tailoredPath(job, load().profile);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader("content-type", "application/pdf");
  res.sendFile(f);
});

app.post("/api/search/prefs", (req, res) => {
  const s = update((st) => {
    st.search = { ...st.search, ...(req.body as Partial<SearchPrefs>) };
  });
  res.json(s.search);
});

app.post("/api/search/run", (_req, res) => {
  if (!load().profile.country) return res.status(400).json({ error: "Add your country of residence in Profile first. Eligibility depends on it." });
  void runSearch(llmOrNull());
  res.json({ started: true });
});

app.get("/api/search/progress", (_req, res) => res.json(progress));

app.get("/api/jobs", (_req, res) => {
  const q = queued();
  const cur = currentApply();
  const prof = load().profile;
  const jobs = Object.values(load().jobs).map((j) => ({ ...j, description: j.description.slice(0, 4000), hasSession: hasSession(j.id), working: cur === j.id || q.includes(j.id), tailoredCv: fs.existsSync(tailoredPath(j, prof)) }));
  res.json(jobs);
});

app.post("/api/jobs/add", (req, res) => {
  const { url, company, title } = req.body as { url: string; company?: string; title?: string };
  if (!/^https?:\/\//.test(url ?? "")) return res.status(400).json({ error: "Paste a full link starting with https://" });
  const now = new Date().toISOString();
  const job: Job = {
    id: `manual:${Buffer.from(url).toString("base64url").slice(-24)}`,
    source: "greenhouse",
    company: company || new URL(url).hostname,
    title: title || "Added by you",
    url,
    applyUrl: url,
    location: "",
    description: "",
    ats: detectAts(url),
    needsLogin: hostNeedsLogin(url),
    flags: ["added-manually"],
    status: "found",
    statusDate: now,
    foundAt: now,
  };
  update((st) => void (st.jobs[job.id] = job));
  res.json(job);
});

app.post("/api/jobs/:id/apply", (req, res) => {
  const id = String(req.params.id);
  if (!load().jobs[id]) return res.status(404).json({ error: "Job not found" });
  const block = applyBlocker();
  if (block) return res.status(400).json({ error: block });
  const r = enqueue([id]);
  if (!r.added.length) return res.status(409).json({ error: "This job is already queued, applied or skipped." });
  res.json({ started: true, position: queued().length });
});

app.post("/api/apply-batch", (req, res) => {
  const ids = ((req.body as { ids?: string[] }).ids ?? []).filter((id) => load().jobs[id]);
  const block = applyBlocker();
  if (block) return res.status(400).json({ error: block });
  res.json(enqueue(ids));
});

/** You chose to apply even though the posting limits where they hire. Answers stay truthful. */
app.post("/api/jobs/:id/apply-anyway", (req, res) => {
  const id = String(req.params.id);
  const j = load().jobs[id];
  if (!j) return res.status(404).json({ error: "Job not found" });
  update((s) => {
    const job = s.jobs[id];
    job.flags = [...new Set([...job.flags, "apply-anyway"])];
    job.status = "found";
    job.statusReason = "You chose to apply anyway. JobPilot answers location and work-authorisation questions truthfully.";
    job.statusDate = new Date().toISOString();
  });
  const block = applyBlocker();
  if (block) return res.status(400).json({ error: block });
  res.json(enqueue([id]));
});

/** Finish a job that needs one human step (a CAPTCHA): show the window, or reopen it filled, and wait. */
app.post("/api/jobs/:id/finish", (req, res) => {
  const id = String(req.params.id);
  if (!load().jobs[id]) return res.status(404).json({ error: "Job not found" });
  if (finishHandoff(id) === "watching") return res.json({ ok: true, mode: "watching" });
  const block = applyBlocker();
  if (block) return res.status(400).json({ error: block });
  // Reopen in a visible window; you've asked to finish it, so it submits once the check is passed.
  enqueue([id], { headless: false, waitForHuman: true, autoSubmit: true });
  res.json({ ok: true, mode: "reopen" });
});

app.post("/api/jobs/:id/submit", wrap(async (req, res) => {
  res.json(await submit(String(req.params.id)));
}));

app.post("/api/jobs/:id/close", wrap(async (req, res) => {
  await closeSession(String(req.params.id));
  res.json({ ok: true });
}));

app.post("/api/jobs/:id/status", (req, res) => {
  const { status, reason } = req.body as { status: Job["status"]; reason?: string };
  res.json(setStatus(String(req.params.id), status, reason));
});

/** Answers to "needs your answer" questions. Saved to the profile so they're reused on every future form. */
app.post("/api/jobs/:id/answers", (req, res) => {
  const { answers } = req.body as { answers: { label: string; answer: string }[] };
  const id = String(req.params.id);
  update((st) => {
    for (const a of answers) {
      if (!a.answer?.trim()) continue;
      const i = st.profile.savedAnswers.findIndex((x) => x.question === a.label);
      if (i >= 0) st.profile.savedAnswers[i].answer = a.answer.trim();
      else st.profile.savedAnswers.push({ question: a.label, answer: a.answer.trim() });
    }
    const j = st.jobs[id];
    if (j) {
      j.pending = [];
      j.status = "found";
      j.statusReason = "Your answers saved. Click Apply to continue.";
      j.statusDate = new Date().toISOString();
    }
  });
  res.json(load().jobs[id]);
});

app.get("/api/jobs/:id/log", (req, res) => {
  const id = String(req.params.id);
  res.json({ log: logs.get(id) ?? [], applying: currentApply() === id || queued().includes(id) });
});

// ── Connected sites (you sign in yourself, once) ──
app.get("/api/sites", (_req, res) => res.json({ sites: SITES, connected: load().settings.connectedSites ?? [] }));
app.post("/api/sites/:id/open", wrap(async (req, res) => {
  await openSignIn(String(req.params.id), (req.body as { url?: string }).url);
  res.json({ ok: true });
}));
app.post("/api/sites/:id/done", (req, res) => {
  markConnected(String(req.params.id), (req.body as { url?: string }).url);
  res.json({ connected: load().settings.connectedSites });
});
app.post("/api/sites/disconnect", (req, res) => {
  disconnect(String((req.body as { host?: string }).host ?? ""));
  res.json({ connected: load().settings.connectedSites });
});

// ── Assistant ──
app.get("/api/chat", (_req, res) => res.json({ messages: load().chat, applying: currentApply(), queued: queued() }));
app.get("/api/chat/activity", (_req, res) => res.json(activity));
app.post("/api/chat", wrap(async (req, res) => {
  const text = String((req.body as { text?: string }).text ?? "").trim();
  if (!text) throw new Error("Type a message first.");
  const llm = makeLLM(load().settings);
  res.json(await chat(llm, text));
}));
app.post("/api/chat/:msg/actions/:i", (req, res) => {
  res.json(resolveAction(String(req.params.msg), Number(req.params.i), !!(req.body as { confirm?: boolean }).confirm));
});
app.delete("/api/chat", (_req, res) => {
  update((s) => void (s.chat = []));
  res.json({ ok: true });
});

app.get("/api/jobs/:id/screenshot", (req, res) => {
  const p = shotPath(String(req.params.id));
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

app.get("/api/export.csv", (_req, res) => {
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="jobpilot-tracker-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(Object.values(load().jobs)));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Errors never include the API key: provider errors are rewritten in providers/types.ts.
  res.status(400).json({ error: err.message });
});

async function start() {
  if (process.env.NODE_ENV === "production" && fs.existsSync("dist/index.html")) {
    app.use(express.static("dist"));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.resolve("dist/index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa", configFile: path.resolve("vite.config.ts") });
    app.use(vite.middlewares);
  }
  // Localhost only: nobody else on your network can reach it.
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  JobPilot is running → http://localhost:${PORT}\n`);
  });
}

void start();
