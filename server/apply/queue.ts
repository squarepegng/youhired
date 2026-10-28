// Applications run one at a time. The Assistant can queue several; the UI shows progress per job.

import fs from "node:fs";
import path from "node:path";
import type { LLM } from "../providers/types.js";
import { DATA_DIR, load, setStatus } from "../store.js";
import { logs, prepare } from "./runner.js";

const queue: string[] = [];
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

export function enqueue(ids: string[]): { added: string[]; skipped: string[] } {
  const jobs = load().jobs;
  const added: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const j = jobs[id];
    if (!j || j.status === "applied" || j.status === "skipped" || queue.includes(id) || current === id) {
      skipped.push(id);
      continue;
    }
    queue.push(id);
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
      await prepare(id, getLLM(), { autoSubmit: settings.autoSubmit, channel: settings.browserChannel });
    } catch (e) {
      logs.get(id)?.push(`Stopped: ${(e as Error).message}`);
      setStatus(id, "error", (e as Error).message);
    }
    current = null;
  }
}
