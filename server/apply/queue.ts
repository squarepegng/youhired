// Applications run one at a time. The Assistant can queue several; the UI shows progress per job.

import fs from "node:fs";
import path from "node:path";
import type { LLM } from "../providers/types.js";
import { alreadyApplied } from "../dedupe.js";
import { DATA_DIR, load, setStatus } from "../store.js";
import { logs, prepare } from "./runner.js";

const queue: string[] = [];
const overrides = new Map<string, { headless?: boolean; waitForHuman?: boolean; autoSubmit?: boolean }>();
let current: string | null = null;
let getLLM: () => LLM | null = () => null;

export function configureQueue(fn: () => LLM | null): void {
  getLLM = fn;
}

export function currentApply(): string | null {
  return current;
}

export function queued(): string[] {
  return [...queue];
}

/** Checks that must pass before JobPilot opens any application. Returns a reason, or null if OK. */
export function applyBlocker(): string | null {
  const { profile } = load();
  if (!profile.cvFileName || !fs.existsSync(path.join(DATA_DIR, "cv", profile.cvFileName))) return "Upload your CV in Profile first.";
  if (!profile.confirmed) return "Confirm your profile facts first (Profile → Confirm facts).";
  return null;
}

export function enqueue(ids: string[], override?: { headless?: boolean; waitForHuman?: boolean; autoSubmit?: boolean }): { added: string[]; skipped: string[] } {
  const jobs = load().jobs;
  const added: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const j = jobs[id];
    if (!j || j.status === "applied" || (j.status === "skipped" && !j.flags.includes("apply-anyway")) || queue.includes(id) || current === id || alreadyApplied(j, Object.values(jobs))) {
      skipped.push(id);
      continue;
    }
    queue.push(id);
    if (override) overrides.set(id, override);
    logs.set(id, ["Waiting in the queue…"]);
    added.push(id);
  }
  void work();
  return { added, skipped };
}

async function work(): Promise<void> {
  if (current) return;
  while (queue.length) {
    const id = queue.shift()!;
    current = id;
    const { settings } = load();
    logs.set(id, ["Starting…"]);
    try {
      const o = overrides.get(id) ?? {};
      overrides.delete(id);
      await prepare(id, getLLM(), { autoSubmit: o.autoSubmit ?? settings.autoSubmit, channel: settings.browserChannel, headless: o.headless ?? settings.background, waitForHuman: o.waitForHuman });
    } catch (e) {
      logs.get(id)?.push(`Stopped: ${(e as Error).message}`);
      setStatus(id, "error", (e as Error).message);
    }
    current = null;
  }
}
