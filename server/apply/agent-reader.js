// Runs inside the page. Lists visible interactive elements for the browser agent, numbering each
// with data-jp-a. Returns compact descriptions (no hidden elements, no password fields' values).
(() => {
  let n = 0;
  document.querySelectorAll("[data-jp-a]").forEach((el) => el.removeAttribute("data-jp-a"));
  const txt = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05 && r.width > 1 && r.height > 1;
  };
  const labelOf = (el) => {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => txt(document.getElementById(id))).join(" ").trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && txt(l)) return txt(l);
    }
    const wrap = el.closest("label");
    if (wrap && txt(wrap)) return txt(wrap);
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const l = p.querySelector("label, legend, [class*='label' i], [class*='question' i]");
      if (l && !l.contains(el) && txt(l) && txt(l).length < 300) return txt(l);
    }
    return el.getAttribute("placeholder") || el.getAttribute("name") || "";
  };
  const sel = "a[href], button, [role='button'], [role='link'], [role='tab'], [role='option'], [role='checkbox'], [role='radio'], [role='combobox'], input, select, textarea, label:has(input[type='file'])";
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "hidden") continue;
    const isFile = type === "file";
    if (!isFile && !visible(el)) continue;
    if (el.closest("[aria-hidden='true']") && !isFile) continue;
    const tag = el.tagName.toLowerCase();
    let kind = tag;
    if (tag === "input") kind = type || "text";
    if (el.getAttribute("role")) kind = el.getAttribute("role");
    const id = ++n;
    el.setAttribute("data-jp-a", String(id));
    const d = { id, kind };
    const label = tag === "a" || tag === "button" || el.getAttribute("role") === "button" || el.getAttribute("role") === "option" ? txt(el) || el.getAttribute("aria-label") || "" : labelOf(el);
    d.label = label.slice(0, 160);
    if (tag === "a") d.href = (el.getAttribute("href") || "").slice(0, 120);
    if (tag === "input" || tag === "textarea") {
      if (type === "password") d.password = true;
      else if (type === "checkbox" || type === "radio") d.checked = el.checked;
      else if (!isFile) d.value = (el.value || "").slice(0, 80);
      if (isFile) d.file = el.files && el.files.length ? el.files[0].name : "";
    }
    if (tag === "select") {
      d.options = Array.from(el.options).map((o) => o.text.trim()).filter(Boolean).slice(0, 40);
      const s = el.options[el.selectedIndex];
      d.value = s ? s.text.trim() : "";
    }
    if (el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(d.label)) d.required = true;
    if (el.disabled) d.disabled = true;
    const r = el.getBoundingClientRect();
    d.inView = r.top < innerHeight && r.bottom > 0;
    out.push(d);
    if (out.length >= 220) break;
  }
  const main = document.querySelector("main, [role='main'], form") || document.body;
  return { url: location.href, title: document.title, elements: out, text: txt(main).slice(0, 3500), scrollable: document.documentElement.scrollHeight > innerHeight + scrollY + 20 };
})();
