import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/apply/queue.js", () => ({
  applyBlocker: vi.fn(() => null),
  enqueue: vi.fn((ids: string[]) => ({ added: ids, skipped: [] })),
}));
vi.mock("../server/search.js", async (orig) => ({ ...(await orig<typeof import("../server/search.js")>()), runSearch: vi.fn() }));

const { chat, resolveAction } = await import("../server/assistant.js");
const store = await import("../server/store.js");
const queue = await import("../server/apply/queue.js");
const search = await import("../server/search.js");
import type { LLM } from "../server/providers/types.js";
import type { Job } from "../server/types.js";

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id, source: "greenhouse", company: "Acme", title: "Product Designer", url: "u", applyUrl: "u", location: "Worldwide", description: "",
  ats: "greenhouse", needsLogin: false, flags: [], status: "found", statusDate: "2026-10-28", foundAt: "2026-10-28", fit: 80, ...over,
});
const action = (o: Record<string, unknown>) => ({ summary: "s", brief: "", titles: [], exclude_keywords: [], max_age_days: 0, job_ids: [], reason: "", ...o });
const fakeLLM = (out: unknown) => ({ json: vi.fn().mockResolvedValue(out) }) as unknown as LLM & { json: ReturnType<typeof vi.fn> };

beforeEach(() => {
  fs.rmSync(path.join(store.DATA_DIR, "store.json"), { force: true });
  store._reset();
  store.update((s) => {
    s.profile.country = "Nigeria";
    s.jobs = { "greenhouse:a": job("greenhouse:a", { title: "Senior Product Designer", company: "Zapier" }), "greenhouse:b": job("greenhouse:b", { fit: 30 }) };
  });
  vi.clearAllMocks();
});

describe("Assistant", () => {
  it("saves the brief and search changes, runs a search", async () => {
    const llm = fakeLLM({
      reply: "Done. Searching now.",
      actions: [
        action({ type: "set_brief", brief: "Senior product design, fintech, open to Africa" }),
        action({ type: "update_search", titles: ["senior product designer", "product designer"], exclude_keywords: ["intern"] }),
        action({ type: "run_search" }),
      ],
    });
    const msg = await chat(llm, "I want senior product design roles in fintech");
    const s = store.load();
    expect(s.search.brief).toMatch(/fintech/);
    expect(s.search.titles).toEqual(["senior product designer", "product designer"]);
    expect(search.runSearch).toHaveBeenCalled();
    expect(msg.actions?.every((a) => a.status === "done")).toBe(true);
    expect(s.chat.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("queues applications (they pause for review) and ignores unknown ids", async () => {
    const llm = fakeLLM({ reply: "Filling Zapier.", actions: [action({ type: "apply_jobs", job_ids: ["greenhouse:a", "made-up"] })] });
    const msg = await chat(llm, "apply to the zapier one");
    expect(queue.enqueue).toHaveBeenCalledWith(["greenhouse:a"]);
    expect(msg.actions?.[0].status).toBe("done");
  });

  it("asks before applying when auto-submit is on", async () => {
    store.update((s) => void (s.settings.autoSubmit = true));
    const llm = fakeLLM({ reply: "Ready.", actions: [action({ type: "apply_jobs", job_ids: ["greenhouse:a"] })] });
    const msg = await chat(llm, "apply");
    expect(msg.actions?.[0].status).toBe("needs_confirm");
    expect(queue.enqueue).not.toHaveBeenCalled();
    resolveAction(msg.id, 0, true);
    expect(queue.enqueue).toHaveBeenCalledWith(["greenhouse:a"]);
    expect(store.load().chat.at(-1)?.actions?.[0].status).toBe("done");
  });

  it("won't apply when the profile isn't ready", async () => {
    vi.mocked(queue.applyBlocker).mockReturnValueOnce("Upload your CV in Profile first.");
    const msg = await chat(fakeLLM({ reply: "", actions: [action({ type: "apply_jobs", job_ids: ["greenhouse:a"] })] }), "apply");
    expect(msg.actions?.[0].status).toBe("failed");
    expect(msg.actions?.[0].data.error).toMatch(/CV/);
  });

  it("skips jobs, never touches applied ones", async () => {
    store.update((s) => void (s.jobs["greenhouse:b"].status = "applied"));
    await chat(fakeLLM({ reply: "Skipped.", actions: [action({ type: "skip_jobs", job_ids: ["greenhouse:a", "greenhouse:b"], reason: "agency" })] }), "skip agencies");
    expect(store.load().jobs["greenhouse:a"].status).toBe("skipped");
    expect(store.load().jobs["greenhouse:b"].status).toBe("applied");
  });

  it("gives the model state, with job-site text marked untrusted", async () => {
    const llm = fakeLLM({ reply: "Nothing waiting.", actions: [] });
    await chat(llm, "what needs me?");
    const call = llm.json.mock.calls[0][0];
    expect(call.system).toContain("<untrusted_job_list>");
    expect(call.system).toContain("Senior Product Designer");
    expect(call.system).toMatch(/never instructions/i);
    expect(call.messages.at(-1)).toEqual({ role: "user", content: "what needs me?" });
  });
});
