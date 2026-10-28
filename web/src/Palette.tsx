import { Sparkles, Briefcase, CircleCheck, Download, Hand, Inbox, Radar, Search, Settings, SkipForward, User, Command } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Ctx, View } from "./App";
import { StatusIcon } from "./ui";

interface Item {
  id: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  group: string;
  run: () => void;
}

export function Palette({ ctx, onClose, onPickJob }: { ctx: Ctx; onClose: () => void; onPickJob: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const go = (v: View) => () => ctx.go(v);
    const nav: Item[] = [
      { id: "assistant", label: "Ask the Assistant", sub: "Tell it what you want", icon: <Sparkles size={15} />, group: "Navigate", run: go("assistant") },
      { id: "inbox", label: "Go to Inbox", icon: <Inbox size={15} />, group: "Navigate", run: go("inbox") },
      { id: "find", label: "Find jobs", sub: "Search public job boards", icon: <Radar size={15} />, group: "Navigate", run: go("find") },
      { id: "todo", label: "Go to To apply", icon: <Briefcase size={15} />, group: "Navigate", run: go("todo") },
      { id: "applied", label: "Go to Applied", icon: <CircleCheck size={15} />, group: "Navigate", run: go("applied") },
      { id: "diy", label: "Go to Do it yourself", icon: <Hand size={15} />, group: "Navigate", run: go("diy") },
      { id: "skipped", label: "Go to Skipped", icon: <SkipForward size={15} />, group: "Navigate", run: go("skipped") },
      { id: "all", label: "Go to All jobs", icon: <Command size={15} />, group: "Navigate", run: go("all") },
      { id: "profile", label: "Edit profile", icon: <User size={15} />, group: "Navigate", run: go("profile") },
      { id: "settings", label: "Settings", sub: "AI provider, model, key", icon: <Settings size={15} />, group: "Navigate", run: go("settings") },
      { id: "export", label: "Export tracker as CSV", icon: <Download size={15} />, group: "Actions", run: () => (window.location.href = "/api/export.csv") },
    ];
    const jobs: Item[] = ctx.jobs
      .slice()
      .sort((a, b) => b.statusDate.localeCompare(a.statusDate))
      .map((j) => ({ id: j.id, label: j.title, sub: j.company, icon: <StatusIcon status={j.status} />, group: "Jobs", run: () => onPickJob(j.id) }));
    const all = [...nav, ...jobs];
    if (!q.trim()) return [...nav, ...jobs.slice(0, 6)];
    const t = q.toLowerCase();
    return all.filter((x) => `${x.label} ${x.sub ?? ""}`.toLowerCase().includes(t)).slice(0, 40);
  }, [q, ctx, onPickJob]);

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".item.on")?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const pick = (it?: Item) => {
    if (!it) return;
    it.run();
    onClose();
  };

  let lastGroup = "";
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command menu">
        <div className="in">
          <Search size={16} color="var(--muted)" />
          <input
            autoFocus
            value={q}
            placeholder="Type a command or search jobs…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI((x) => Math.min(items.length - 1, x + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              } else if (e.key === "Enter") pick(items[i]);
              else if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="list" ref={listRef}>
          {items.length === 0 && <div className="gl">No results</div>}
          {items.map((it, idx) => {
            const head = it.group !== lastGroup ? <div className="gl">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.group + it.id}>
                {head}
                <div className={`item ${idx === i ? "on" : ""}`} onMouseEnter={() => setI(idx)} onClick={() => pick(it)}>
                  {it.icon}
                  {it.label}
                  {it.sub && <span className="sub">{it.sub}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
