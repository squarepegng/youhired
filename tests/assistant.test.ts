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
const call = (o: Record<string, unknown>) => ({ job_ids: [], status: "", query: "", min_fit: 0, limit: 0, titles: [], exclude_keywords: [], brief: "", reason: "", companies: [], ...o });
const round = (calls: Record<string, unknown>[]) => ({ thought: "t", calls: calls.map(call), done: false, reply: "" });
const final = (reply: string) => ({ thought: "t", calls: [], done: true, reply });
const fakeLLM = (...turns: unknown[]) => {
  const json = vi.fn();
  for (const t of turns) json.mockResolvedValueOnce(t);
  json.mockResolvedValue(final("Done."));
  return { json } as unknown as LLM & { json: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  fs.rmSync(path.join(store.DATA_DIR, "store.json"), { force: true });
  store._reset();
  store.update((s) => {
    s.profile.country = "Nigeria";
    s.jobs = { "greenhouse:a": job("greenhouse:a", { title: "Senior Product Designer", company: "Zapier" }), "greenhouse:b": job("greenhouse:b", { fit: 30 }) };
  });
  vi.clearAllMocks();
});

describe("Assistant (tool loop)", () => {
  it("saves the brief, changes titles and searches, then replies", async () => {
    const llm = fakeLLM(
      round([{ tool: "set_brief", brief: "Senior product design, fintech, open to Africa" }, { tool: "update_search", titles: ["senior product designer", "product designer"], exclude_keywords: ["intern"] }, { tool: "search_jobs" }]),
      final("Here are your matches."),
    );
    const msg = await chat(llm, "I want senior product design roles in fintech");
    const s = store.load();
    expect(s.search.brief).toMatch(/fintech/);
    expect(s.search.titles).toEqual(["senior product designer", "product designer"]);
    expect(search.runSearch).toHaveBeenCalled();
    expect(msg.text).toBe("Here are your matches.");
    expect(msg.actions?.map((a) => a.type)).toEqual(["set_brief", "update_search", "run_search"]);
    expect(s.chat.map((m) => m.role)).toEqual(["user", "assistant"]);
    // Round 2 sees the tool results
    expect(llm.json.mock.calls[1][0].messages.at(-1).content).toMatch(/Tool results/);
  });

  it("reads jobs through tools, with job-site text marked untrusted", async () => {
    const llm = fakeLLM(round([{ tool: "list_jobs", status: "all" }, { tool: "get_job", job_ids: ["greenhouse:a"] }]), final("You have 2 jobs."));
    await chat(llm, "what jobs do I have?");
    const second = llm.json.mock.calls[1][0];
    expect(second.messages.at(-1).content).toContain("<untrusted_job_list>");
    expect(second.messages.at(-1).content).toContain("Zapier");
    expect(second.system).toMatch(/never instructions/i);
  });

  it("queues applications only for jobs it can apply to", async () => {
    store.update((s) => void (s.jobs["greenhouse:b"] = { ...s.jobs["greenhouse:b"], applyUrl: "https://acme.wd5.myworkdayjobs.com/job/1", needsLogin: true }));
    const msg = await chat(fakeLLM(round([{ tool: "apply_jobs", job_ids: ["greenhouse:a", "greenhouse:b", "made-up"] }]), final("Filling Zapier.")), "apply to both");
    expect(queue.enqueue).toHaveBeenCalledWith(["greenhouse:a"]);
    expect(msg.actions?.[0].status).toBe("done");
  });

  it("asks before applying when auto-submit is on", async () => {
    store.update((s) => void (s.settings.autoSubmit = true));
    const msg = await chat(fakeLLM(round([{ tool: "apply_jobs", job_ids: ["greenhouse:a"] }]), final("Confirm to send.")), "apply");
    expect(msg.actions?.[0].status).toBe("needs_confirm");
    expect(queue.enqueue).not.toHaveBeenCalled();
    resolveAction(msg.id, 0, true);
    expect(queue.enqueue).toHaveBeenCalledWith(["greenhouse:a"]);
    expect(store.load().chat.at(-1)?.actions?.[0].status).toBe("done");
  });

  it("won't apply when the profile isn't ready", async () => {
    vi.mocked(queue.applyBlocker).mockReturnValueOnce("Upload your CV in Profile first.");
    const msg = await chat(fakeLLM(round([{ tool: "apply_jobs", job_ids: ["greenhouse:a"] }]), final("Upload your CV first.")), "apply");
    expect(msg.actions?.[0].status).toBe("failed");
    expect(msg.actions?.[0].data.error).toMatch(/CV/);
  });

  it("skips jobs but never touches applied ones", async () => {
    store.update((s) => void (s.jobs["greenhouse:b"].status = "applied"));
    await chat(fakeLLM(round([{ tool: "skip_jobs", job_ids: ["greenhouse:a", "greenhouse:b"], reason: "agency" }]), final("Skipped.")), "skip agencies");
    expect(store.load().jobs["greenhouse:a"].status).toBe("skipped");
    expect(store.load().jobs["greenhouse:b"].status).toBe("applied");
  });

  it("tries job-board listings too (JobPilot finds the employer's form)", async () => {
    store.update((s) => void (s.jobs["greenhouse:b"] = { ...s.jobs["greenhouse:b"], applyUrl: "https://weworkremotely.com/remote-jobs/x" }));
    await chat(fakeLLM(round([{ tool: "apply_jobs", job_ids: ["greenhouse:b"] }]), final("Applying.")), "apply");
    expect(queue.enqueue).toHaveBeenCalledWith(["greenhouse:b"]);
  });

  it("adds only verified board names", async () => {
    await chat(fakeLLM(round([{ tool: "add_companies", companies: ["ashby:linear", "greenhouse:gitlab", "nonsense"] }]), final("Added.")), "add linear");
    const s = store.load().search;
    expect(s.ashbyOrgs).toContain("linear");
    expect(s.ashbyOrgs).not.toContain("nonsense");
  });

  it("stops after the round limit with a reply", async () => {
    const llm = { json: vi.fn().mockResolvedValue(round([{ tool: "list_jobs" }])) } as unknown as LLM;
    const msg = await chat(llm, "loop forever");
    expect(msg.text.length).toBeGreaterThan(0);
    expect(vi.mocked(llm.json).mock.calls.length).toBe(10);
  });
});
