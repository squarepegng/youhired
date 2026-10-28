import { Check, Copy, Download, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";
import { useToast } from "./ui";

interface KitData {
  applyUrl: string;
  answers: { label: string; value: string }[];
  coverNote: string;
  cv: string | null;
}

/** Finish an application in your own browser: open it there, copy each answer, download the files. */
export function Kit({ jobId, title, onClose, onApplied }: { jobId: string; title: string; onClose: () => void; onApplied: () => void }) {
  const toast = useToast();
  const [kit, setKit] = useState<KitData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    void api<KitData>(`/api/jobs/${encodeURIComponent(jobId)}/kit`).then(setKit);
  }, [jobId]);
  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => toast("Couldn't copy. Select the text instead.", "error"));
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette kit" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Finish in your browser">
        <div className="kithead">
          <div>
            <b>Finish in your browser</b>
            <span className="muted">{title}</span>
          </div>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {!kit ? (
          <p className="muted pad">Loading…</p>
        ) : (
          <div className="kitbody">
            <ol className="kitsteps">
              <li>
                <a className="btn primary" href={kit.applyUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Open the application
                </a>{" "}
                <span className="muted">in your normal browser, where the human check behaves.</span>
              </li>
              <li>
                Attach your files:{" "}
                {kit.cv && (
                  <a className="btn sm" href={kit.cv} download>
                    <Download size={12} /> CV
                  </a>
                )}{" "}
                {kit.coverNote && (
                  <a className="btn sm" href={`data:text/plain;charset=utf-8,${encodeURIComponent(kit.coverNote)}`} download="Cover_letter.txt">
                    <Download size={12} /> Cover letter
                  </a>
                )}
              </li>
              <li>Copy each answer into the form, tick the check, and submit.</li>
            </ol>
            <div className="qa">
              {kit.coverNote && (
                <div>
                  <div className="q" style={{ display: "flex" }}>
                    Cover letter
                    <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => copy("cover", kit.coverNote)}>
                      {copied === "cover" ? <Check size={12} /> : <Copy size={12} />} Copy
                    </button>
                  </div>
                  <div className="a" style={{ maxHeight: 90, overflow: "auto" }}>{kit.coverNote}</div>
                </div>
              )}
              {kit.answers.map((a, i) => (
                <div key={i}>
                  <div className="q" style={{ display: "flex", gap: 8 }}>
                    <span style={{ flex: 1 }}>{a.label}</span>
                    <button className="btn ghost sm" onClick={() => copy(String(i), a.value)}>
                      {copied === String(i) ? <Check size={12} /> : <Copy size={12} />} Copy
                    </button>
                  </div>
                  <div className="a">{a.value}</div>
                </div>
              ))}
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn success" onClick={onApplied}>
                <Check size={13} /> I submitted it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
