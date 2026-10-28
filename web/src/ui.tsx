import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Job, JobStatus } from "./types";

// ── Status ─────────────────────────────────────────────
export const STATUS: Record<JobStatus, { label: string; color: string; hint: string }> = {
  needs_answer: { label: "Needs your answer", color: "var(--amber)", hint: "Questions only you can answer" },
  filled: { label: "Ready to submit", color: "var(--violet)", hint: "Filled in the browser, check and submit" },
  found: { label: "To apply", color: "var(--blue)", hint: "Eligible matches waiting for you" },
  do_it_yourself: { label: "Do it yourself", color: "var(--orange)", hint: "Login, CAPTCHA or no AI allowed" },
  error: { label: "Problem", color: "var(--red)", hint: "Something went wrong" },
  applied: { label: "Applied", color: "var(--green)", hint: "Confirmation seen" },
  skipped: { label: "Skipped", color: "var(--faint)", hint: "Not eligible, weak fit, or skipped by you" },
};
export const STATUS_ORDER: JobStatus[] = ["needs_answer", "filled", "found", "do_it_yourself", "error", "applied", "skipped"];

/** Linear-style status glyphs drawn in SVG so they stay crisp at 14px. */
export function StatusIcon({ status, size = 14 }: { status: JobStatus; size?: number }) {
  const c = STATUS[status].color;
  const s = size;
  const r = s / 2 - 1.25;
  const common = { width: s, height: s, viewBox: `0 0 ${s} ${s}`, "aria-label": STATUS[status].label, role: "img" as const };
  switch (status) {
    case "found":
      return (
        <svg {...common}>
          <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={c} strokeWidth="1.5" />
        </svg>
      );
    case "needs_answer":
      return (
        <svg {...common}>
          <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={c} strokeWidth="1.5" />
          <path d={`M${s / 2} ${s / 2 - 3}v3.2`} stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx={s / 2} cy={s / 2 + 2.6} r="0.9" fill={c} />
        </svg>
      );
    case "filled": {
      // Three-quarters filled: nearly there.
      const cx = s / 2;
      const rr = r - 2;
      return (
        <svg {...common}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke={c} strokeWidth="1.5" />
          <path d={`M${cx} ${cx} L${cx} ${cx - rr} A${rr} ${rr} 0 1 1 ${cx - rr} ${cx} Z`} fill={c} />
        </svg>
      );
    }
    case "applied":
      return (
        <svg {...common}>
          <circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} fill={c} />
          <path d={`M${s * 0.3} ${s * 0.52} l${s * 0.14} ${s * 0.14} l${s * 0.27} -${s * 0.3}`} stroke="#0f1011" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "do_it_yourself":
      return (
        <svg {...common}>
          <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2.2 2" />
          <circle cx={s / 2} cy={s / 2} r="2" fill={c} />
        </svg>
      );
    case "skipped":
      return (
        <svg {...common}>
          <circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} fill={c} />
          <path d={`M${s * 0.33} ${s * 0.33} L${s * 0.67} ${s * 0.67} M${s * 0.67} ${s * 0.33} L${s * 0.33} ${s * 0.67}`} stroke="#0f1011" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "error":
      return (
        <svg {...common}>
          <circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} fill={c} />
          <path d={`M${s / 2} ${s * 0.28}v${s * 0.26}`} stroke="#0f1011" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx={s / 2} cy={s * 0.7} r="0.95" fill="#0f1011" />
        </svg>
      );
  }
}

export function EligChip({ job, withEvidence = true }: { job: Pick<Job, "eligibility" | "location">; withEvidence?: boolean }) {
  const e = job.eligibility;
  const v = e?.verdict ?? "unclear";
  const label = { eligible: "Eligible", ineligible: "Not eligible", unclear: "Check location" }[v];
  return (
    <span className="chip" title={`${label}: ${e?.reason ?? ""}\n“${e?.evidence || job.location || "No location given"}”`}>
      <span className={`d ${v}`} />
      {withEvidence ? <span className="ev">{e?.evidence || job.location || label}</span> : label}
    </span>
  );
}

export function Fit({ fit }: { fit?: number }) {
  if (fit == null) return <span className="faint" title="Not scored yet">—</span>;
  const bars = fit >= 70 ? 3 : fit >= 50 ? 2 : 1;
  return (
    <span className="fit" title={`Fit ${fit}/100`}>
      <span className="fitbars">
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= bars ? "on" : ""} />
        ))}
      </span>
      {fit}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft("");
  };
  return (
    <div className="taginput" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
      {value.map((t) => (
        <span key={t} className="tagin">
          {t}
          <button aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}

export function relTime(iso?: string): string {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Toasts ─────────────────────────────────────────────
type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
