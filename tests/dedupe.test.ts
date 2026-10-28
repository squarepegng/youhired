import { describe, expect, it } from "vitest";
import { alreadyApplied } from "../server/dedupe.js";
import type { Job } from "../server/types.js";

const job = (o: Partial<Job>): Job => ({ id: "x", source: "greenhouse", company: "Acme", title: "Senior Product Designer", url: "https://a/1", applyUrl: "https://a/1/apply", location: "", description: "", ats: "greenhouse", needsLogin: false, flags: [], status: "found", statusDate: "2026-10-28T10:00:00Z", foundAt: "", ...o });

describe("never apply twice", () => {
  const applied = job({ id: "himalayas:1", status: "applied", company: "Acme Inc.", title: "Senior Product Designer (Remote)", url: "https://himalayas.app/x", applyUrl: "https://jobs.ashbyhq.com/acme/123/application" });
  it("matches the same role from another source", () => {
    expect(alreadyApplied(job({ id: "ashby:acme-123", company: "Acme", title: "Senior Product Designer", url: "https://jobs.ashbyhq.com/acme/123", applyUrl: "https://jobs.ashbyhq.com/acme/123/application" }), [applied])).toBe(applied);
  });
  it("matches by company + title even with different links", () => {
    expect(alreadyApplied(job({ id: "y", company: "ACME", title: "Senior Product Designer", url: "u2", applyUrl: "u3" }), [applied])).toBe(applied);
  });
  it("doesn't confuse different roles at the same company", () => {
    expect(alreadyApplied(job({ id: "z", company: "Acme", title: "Staff Brand Designer", url: "u4", applyUrl: "u5" }), [applied])).toBeUndefined();
  });
  it("only counts applications actually made", () => {
    expect(alreadyApplied(job({ id: "y" }), [{ ...applied, status: "filled" }])).toBeUndefined();
  });
});
