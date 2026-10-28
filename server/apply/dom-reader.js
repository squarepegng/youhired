// Runs inside the job page (plain JS, no imports). Finds form fields, tags each with
// data-jp-id, and returns a description: label, kind, required, options, current value.
(() => {
  let n = window.__jpN || 0;
  const tag = (el) => {
    if (!el.dataset.jpId) el.dataset.jpId = "jp" + ++n;
    return el.dataset.jpId;
  };
  const txt = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0;
  };
  const clean = (s) => (s || "").replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim();
  const starred = (s) => /\*/.test(s || "");

  function questionLabel(el) {
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
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
      const l = p.querySelector("label, legend, [class*='label' i], [class*='question' i], [class*='title' i]");
      if (l && !l.contains(el) && txt(l) && txt(l).length < 400) return txt(l);
    }
    return el.getAttribute("placeholder") || el.name || "";
  }

  function groupLabel(inputs) {
    const first = inputs[0];
    const fs = first.closest("fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg && txt(lg)) return txt(lg);
    }
    const rg = first.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const lb = rg.getAttribute("aria-labelledby");
      if (lb) {
        const t = lb.split(/\s+/).map((id) => txt(document.getElementById(id))).join(" ").trim();
        if (t) return t;
      }
      if (rg.getAttribute("aria-label")) return rg.getAttribute("aria-label");
    }
    // Climb until the container holds more than just these inputs' labels.
    let p = first.parentElement;
    for (let i = 0; i < 7 && p; i++, p = p.parentElement) {
      if (!inputs.every((x) => p.contains(x))) continue;
      const l = p.querySelector("label:not(:has(input)), legend, [class*='label' i]:not(:has(input)), [class*='question' i]");
      if (l && txt(l)) return txt(l);
    }
    return first.name || "";
  }

  function optionLabel(input) {
    if (input.id) {
      const l = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (l && txt(l)) return txt(l);
    }
    const wrap = input.closest("label");
    if (wrap && txt(wrap)) return txt(wrap);
    if (input.getAttribute("aria-label")) return input.getAttribute("aria-label");
    const sib = input.nextElementSibling;
    if (sib && txt(sib)) return txt(sib);
    return input.value;
  }

  const out = [];
  const groups = new Map();
  const els = Array.from(document.querySelectorAll("input, select, textarea"));
  for (const el of els) {
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;
    if (el.closest("[data-jp-skip], header, nav, footer")) continue;
    if (type !== "file" && type !== "radio" && type !== "checkbox" && !visible(el)) continue;
    if (el.disabled || el.readOnly) continue;
    // Hidden "required" mirrors used by custom dropdowns (react-select etc.) duplicate the real field.
    if (type !== "file" && type !== "radio" && type !== "checkbox" && (el.getAttribute("aria-hidden") === "true" || (el.tabIndex === -1 && parseFloat(getComputedStyle(el).opacity) === 0))) continue;

    if (type === "radio" || type === "checkbox") {
      const key = type + ":" + (el.name || tag(el));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
      continue;
    }

    const label = questionLabel(el);
    const role = el.getAttribute("role");
    const isCombo = role === "combobox" || el.getAttribute("aria-autocomplete") === "list" || el.getAttribute("aria-haspopup") === "listbox";
    let kind;
    if (el.tagName === "SELECT") kind = "select";
    else if (el.tagName === "TEXTAREA") kind = "textarea";
    else if (isCombo) kind = "combobox";
    else if (["email", "tel", "url", "number", "date", "file"].includes(type)) kind = type;
    else kind = "text";

    let options = [];
    let value = el.value || "";
    if (kind === "select") {
      options = Array.from(el.options).map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|please select|--)/i.test(t));
      const sel = el.options[el.selectedIndex];
      value = sel && !/^(select|choose|please select|--)/i.test(sel.text) && sel.value ? sel.text.trim() : "";
    }
    if (kind === "combobox" && !value) {
      let box = el.parentElement;
      for (let i = 0; i < 5 && box && !value; i++, box = box.parentElement) {
        const sv = box.querySelector("[class*='singleValue' i], [class*='single-value' i], [class*='multi-value' i], [class*='multiValue' i]");
        if (sv) value = txt(sv);
      }
    }
    if (kind === "file") value = el.files && el.files.length ? el.files[0].name : "";
    const required = el.required || el.getAttribute("aria-required") === "true" || starred(label);
    out.push({
      id: tag(el),
      kind,
      label: clean(label),
      name: el.name || el.id || "",
      required,
      options,
      value,
      accept: el.getAttribute("accept") || undefined,
      autocomplete: el.getAttribute("autocomplete") || undefined,
    });
  }

  for (const [key, inputs] of groups) {
    const vis = inputs.filter((x) => visible(x) || (x.parentElement && visible(x.parentElement)) || (x.closest("label") && visible(x.closest("label"))));
    if (!vis.length) continue;
    const isRadio = key.startsWith("radio:");
    const label = groupLabel(vis);
    const options = vis.map(optionLabel);
    const required = vis.some((x) => x.required || x.getAttribute("aria-required") === "true") || starred(label);
    const checked = vis.filter((x) => x.checked).map(optionLabel);
    const single = !isRadio && vis.length === 1;
    out.push({
      id: tag(vis[0]),
      kind: isRadio ? "radio" : single ? "checkbox-single" : "checkbox",
      label: clean(single ? label || options[0] : label),
      name: vis[0].name || "",
      required,
      options: single ? [] : options,
      optionIds: vis.map(tag),
      value: single ? (vis[0].checked ? "true" : "") : checked.join(" | "),
    });
  }

  // Button groups used as yes/no questions (Ashby and others).
  const btns = Array.from(document.querySelectorAll("button[type='button'], [role='button']")).filter((b) => /^(yes|no)$/i.test(txt(b)) && visible(b));
  const seen = new Set();
  for (const b of btns) {
    const parent = b.parentElement;
    if (!parent || seen.has(parent)) continue;
    const kids = Array.from(parent.querySelectorAll("button, [role='button']")).filter((x) => /^(yes|no)$/i.test(txt(x)));
    if (kids.length < 2) continue;
    seen.add(parent);
    let label = "";
    let p = parent.parentElement;
    for (let i = 0; i < 5 && p && !label; i++, p = p.parentElement) {
      const l = p.querySelector("label, legend, [class*='label' i], [class*='question' i]");
      if (l && !parent.contains(l) && txt(l)) label = txt(l);
    }
    const sel = kids.find((k) => k.getAttribute("aria-pressed") === "true" || /active|selected/i.test(k.className));
    out.push({
      id: tag(parent),
      kind: "buttons",
      label: clean(label),
      name: "",
      required: starred(label),
      options: kids.map(txt),
      optionIds: kids.map(tag),
      value: sel ? txt(sel) : "",
    });
  }

  // Drop duplicates (same label and kind), keeping the first.
  const seenKey = new Set();
  const uniq = out.filter((f) => {
    const k = f.kind + "|" + f.label + "|" + f.name;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });
  window.__jpN = n;
  return uniq;
})();
