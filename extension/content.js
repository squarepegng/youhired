// Runs in the job page (injected by the extension only into tabs YouHired opened). Reads the form and
// performs one action at a time. Built from server/apply/agent-reader.js by scripts/build-extension.mjs.
(() => {
  if (window.__youhired) return;
  const el = (id) => document.querySelector(`[data-jp-a="${id}"]`);
  const need = (id) => {
    const e = el(id);
    if (!e) throw new Error("That element is gone (the page changed). Look again.");
    return e;
  };
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 1 && r.height > 1;
  };
  const fire = (e, type, extra = {}) => {
    const r = e.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, ...extra };
    const Ctor = type.startsWith("pointer") ? PointerEvent : type.startsWith("key") ? KeyboardEvent : type.startsWith("mouse") || type === "click" ? MouseEvent : Event;
    e.dispatchEvent(new Ctor(type, opts));
  };
  const clickLike = (e) => {
    e.scrollIntoView({ block: "center", inline: "nearest" });
    // Links that open a new tab: follow them in this tab so YouHired keeps working here.
    const a = e.closest && e.closest("a[target=_blank]");
    if (a && a.href && /^https?:/.test(a.href)) {
      location.href = a.href;
      return;
    }
    for (const t of ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fire(e, t);
  };
  const setValue = (e, value) => {
    const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const wrap = (fn) => (...args) => {
    try {
      const r = fn(...args);
      return r instanceof Promise ? r.catch((e) => ({ __error: String(e.message || e) })) : r;
    } catch (e) {
      return { __error: String(e.message || e) };
    }
  };

  function __jpSnapshot(offset) {
  let n = offset;
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
  // Custom "buttons": plain elements that look clickable (cursor: pointer / onclick / tabindex) with short text.
  if (out.length < 220) {
    const seen = new Set(out.map((d) => d.id));
    for (const el of document.querySelectorAll("div, span, li, p, h2, h3, h4, label, [onclick], [tabindex]")) {
      if (el.hasAttribute("data-jp-a") || el.closest("[data-jp-a]") || el.querySelector("a, button, input, select, textarea, [data-jp-a]")) continue;
      const t = txt(el);
      if (!t || t.length > 60) continue;
      const cs = getComputedStyle(el);
      if (!(cs.cursor === "pointer" || el.hasAttribute("onclick") || (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1"))) continue;
      if (!visible(el)) continue;
      const id = ++n;
      el.setAttribute("data-jp-a", String(id));
      const r = el.getBoundingClientRect();
      out.push({ id, kind: "clickable", label: t.slice(0, 120), inView: r.top < innerHeight && r.bottom > 0 });
      if (out.length >= 260) break;
    }
  }
  const main = document.querySelector("main, [role='main'], form") || document.body;
  return { url: location.href, title: document.title, elements: out, text: txt(main).slice(0, 3500), scrollable: document.documentElement.scrollHeight > innerHeight + scrollY + 20 };
}

  window.__youhired = {
    snapshot: wrap((offset) => __jpSnapshot(offset || 0)),
    click: wrap((id) => {
      clickLike(need(id));
      return true;
    }),
    check: wrap((id) => {
      const e = need(id);
      if (!("checked" in e) || !e.checked) clickLike(e);
      return true;
    }),
    type: wrap((id, value) => {
      const e = need(id);
      e.scrollIntoView({ block: "center" });
      e.focus();
      fire(e, "mousedown");
      fire(e, "click");
      if (e.isContentEditable) {
        e.textContent = value;
        e.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      } else {
        setValue(e, "");
        setValue(e, value);
        fire(e, "keydown", { key: value.slice(-1) || "a" });
        fire(e, "keyup", { key: value.slice(-1) || "a" });
      }
      // Comboboxes keep focus so their option list stays open for the next click.
      const combo = e.getAttribute("role") === "combobox" || e.getAttribute("aria-autocomplete");
      if (!combo) e.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      return true;
    }),
    select: wrap((id, label) => {
      const e = need(id);
      const opt = [...e.options].find((o) => o.text.trim() === label) || [...e.options].find((o) => o.text.trim().toLowerCase().includes(String(label).toLowerCase()));
      if (!opt) throw new Error(`No option "${label}"`);
      setValue(e, opt.value);
      return true;
    }),
    upload: wrap((id, f) => {
      const e = need(id);
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      const file = new File([bytes], f.name, { type: f.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      let input = e.matches("input[type=file]") ? e : null;
      for (let p = e; !input && p; p = p.parentElement) input = p.querySelector && p.querySelector("input[type=file]");
      if (!input) throw new Error("No file input near that element");
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }),
    scroll: wrap((dy) => {
      window.scrollBy(0, dy);
      return true;
    }),
    back: wrap(() => {
      history.back();
      return true;
    }),
    enter: wrap(() => {
      const e = document.activeElement || document.body;
      for (const t of ["keydown", "keypress", "keyup"]) fire(e, t, { key: "Enter", code: "Enter", keyCode: 13, which: 13 });
      return true;
    }),
    probe: wrap(() => ({
      url: location.href,
      text: (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 20000),
      passwordVisible: [...document.querySelectorAll("input[type=password]")].some(visible),
      challengeVisible: [...document.querySelectorAll("iframe")].some((f) => /recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com\/captcha|challenges\.cloudflare\.com/.test(f.src || "") && visible(f)),
    })),
  };
})();
