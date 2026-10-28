import type { Job } from "./types.js";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const STATUS_LABEL: Record<Job["status"], string> = {
  found: "Found",
  skipped: "Skipped",
  filled: "Filled, awaiting review",
  applied: "Applied",
  needs_answer: "Needs your answer",
  do_it_yourself: "Do it yourself",
  error: "Error",
};

export function toCsv(jobs: Job[]): string {
  const head = ["Company", "Title", "Status", "Reason", "Status date", "Fit", "Eligibility", "Location wording", "Posting", "Apply link", "Source", "Answers submitted"];
  const rows = jobs
    .sort((a, b) => b.statusDate.localeCompare(a.statusDate))
    .map((j) => [
      j.company,
      j.title,
      STATUS_LABEL[j.status],
      j.statusReason ?? "",
      j.statusDate.slice(0, 10),
      j.fit ?? "",
      j.eligibility?.verdict ?? "",
      j.eligibility?.evidence ?? j.location,
      j.url,
      j.applyUrl,
      j.source,
      (j.answers ?? []).map((a) => `${a.label}: ${a.value}`).join(" | "),
    ]);
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
