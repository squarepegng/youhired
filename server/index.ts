import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { closeSession, hasSession, logs, prepare, shotPath, submit } from "./apply/runner.js";
import { cvToText, extractProfile, mergeExtract } from "./cv.js";
import { detectAts, hostNeedsLogin } from "./guardrails.js";
import { PROVIDERS, makeLLM, testConnection } from "./providers/index.js";
import { progress, runSearch } from "./search.js";
import { SOURCE_LABELS } from "./sources/index.js";
import { DATA_DIR, load, maskKey, setStatus, update } from "./store.js";
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
  const jobs = Object.values(load().jobs).map((j) => ({ ...j, description: j.description.slice(0, 4000), hasSession: hasSession(j.id) }));
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

let applying: string | null = null;
app.post("/api/jobs/:id/apply", (req, res) => {
  const id = req.params.id;
  if (applying) return res.status(409).json({ error: "Already working on another application. Wait for it to finish." });
  const { settings, profile, jobs } = load();
  if (!jobs[id]) return res.status(404).json({ error: "Job not found" });
  if (!profile.cvFileName || !fs.existsSync(path.join(DATA_DIR, "cv", profile.cvFileName))) return res.status(400).json({ error: "Upload your CV in Profile first." });
  if (!profile.confirmed) return res.status(400).json({ error: "Confirm your profile facts first (Profile → Confirm facts)." });
  applying = id;
  logs.set(id, ["Starting…"]);
  prepare(id, llmOrNull(), { autoSubmit: settings.autoSubmit, channel: settings.browserChannel })
    .catch((e) => {
      logs.get(id)?.push(`Stopped: ${(e as Error).message}`);
      setStatus(id, "error", (e as Error).message);
    })
    .finally(() => (applying = null));
  res.json({ started: true });
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

app.get("/api/jobs/:id/log", (req, res) => res.json({ log: logs.get(String(req.params.id)) ?? [], applying: applying === req.params.id }));

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
