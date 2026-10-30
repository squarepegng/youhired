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

  /*__SNAPSHOT__*/

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
