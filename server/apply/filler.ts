// Types into real form fields the way a person would. Lessons from doing this by hand:
// - React/Ashby inputs often ignore programmatic value setting, so we type real keystrokes.
// - Location/country comboboxes need type-then-select from the dropdown.
// - Re-read the form afterwards; anything required and still empty gets one more try.

import type { Page } from "playwright";
import { locate } from "./browser.js";
import { type FormField, normQ, pickOption } from "./mapper.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function typeInto(page: Page, f: FormField, value: string): Promise<void> {
  const loc = locate(page, f);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 5000 });
  await loc.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await loc.press("Backspace");
  if (value.length > 300) {
    // Long answers: insert most of it at once (fires real input events), type the tail as keystrokes.
    await page.keyboard.insertText(value.slice(0, -20));
    await loc.pressSequentially(value.slice(-20), { delay: 10 });
  } else {
    await loc.pressSequentially(value, { delay: 12 });
  }
  await loc.press("Tab").catch(() => {});
}

/** Open a combobox and list its options without choosing any (used to give the mapper real options). */
export async function peekComboOptions(page: Page, f: FormField): Promise<string[]> {
  const loc = locate(page, f);
  try {
    await loc.scrollIntoViewIfNeeded();
    await loc.click({ timeout: 3000 });
    await sleep(350);
    const frame = page.frames()[f.frame] ?? page.mainFrame();
    const opts = await frame.locator("[role='option']:visible").allInnerTexts();
    await loc.press("Escape").catch(() => {});
    await page.mouse.click(5, 5).catch(() => {});
    return opts.map((o) => o.trim()).filter((o) => o && !/^no options|loading/i.test(o)).slice(0, 80);
  } catch {
    return [];
  }
}

async function chooseCombo(page: Page, f: FormField, value: string): Promise<boolean> {
  const frame = page.frames()[f.frame] ?? page.mainFrame();
  const loc = locate(page, f);
  const tries = [value, value.split(",")[0].trim(), value.split(/\s+/)[0]].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const typed of tries) {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 5000 });
    await loc.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await loc.press("Backspace").catch(() => {});
    await loc.pressSequentially(typed, { delay: 40 });
    // Options can load asynchronously (location search).
    let opts: string[] = [];
    for (let i = 0; i < 12 && !opts.length; i++) {
      await sleep(250);
      opts = (await frame.locator("[role='option']:visible").allInnerTexts()).map((s) => s.trim()).filter((s) => s && !/^no options|no results|loading/i.test(s));
    }
    if (!opts.length) continue;
    const best = pickOption(opts, [value, typed]) ?? (normQ(opts[0]).includes(normQ(typed)) ? opts[0] : null);
    if (!best) continue;
    await frame.locator("[role='option']:visible", { hasText: best }).first().click({ timeout: 3000 });
    await sleep(200);
    return true;
  }
  await loc.press("Escape").catch(() => {});
  return false;
}

export async function fillField(page: Page, f: FormField, value: string | string[], files: { cv: string; cover?: string }): Promise<{ ok: boolean; note?: string }> {
  try {
    switch (f.kind) {
      case "file": {
        const p = value === "cover" ? files.cover : files.cv;
        if (!p) return { ok: false, note: "No file" };
        await locate(page, f).setInputFiles(p);
        await sleep(600);
        return { ok: true };
      }
      case "select": {
        const want = Array.isArray(value) ? value[0] : value;
        const opt = pickOption(f.options, [want]);
        if (!opt) return { ok: false, note: `No option like "${want}"` };
        await locate(page, f).selectOption({ label: opt });
        return { ok: true };
      }
      case "combobox": {
        const ok = await chooseCombo(page, f, Array.isArray(value) ? value[0] : value);
        return ok ? { ok } : { ok, note: "Couldn't pick from the dropdown" };
      }
      case "radio":
      case "buttons":
      case "checkbox": {
        const wants = Array.isArray(value) ? value : value.split(" | ");
        let any = false;
        for (const w of wants) {
          const opt = pickOption(f.options, [w]);
          if (!opt) continue;
          const id = f.optionIds?.[f.options.indexOf(opt)];
          if (!id) continue;
          const loc = locate(page, f, id);
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          if (f.kind === "buttons") await loc.click();
          else await loc.check({ force: true }).catch(async () => loc.click({ force: true }));
          any = true;
        }
        return any ? { ok: true } : { ok: false, note: `No option like "${wants.join(", ")}"` };
      }
      case "checkbox-single": {
        if (value === "true" || value === "Yes") await locate(page, f).check({ force: true });
        return { ok: true };
      }
      default: {
        const v = Array.isArray(value) ? value.join(", ") : value;
        await typeInto(page, f, v);
        return { ok: true };
      }
    }
  } catch (e) {
    return { ok: false, note: (e as Error).message.split("\n")[0] };
  }
}

export async function findSubmit(page: Page) {
  for (const frame of page.frames()) {
    const cands = [
      frame.locator("button[type=submit]:visible, input[type=submit]:visible"),
      frame.getByRole("button", { name: /submit( application| your application)?|send application|apply now|^apply$/i }),
    ];
    for (const c of cands) {
      const n = await c.count().catch(() => 0);
      if (n) return c.last();
    }
  }
  return null;
}

const SUCCESS = /thank(?:s| you)(?: so much)? for (?:applying|your (?:application|interest))|application (?:has been |was )?(?:submitted|received)|we(?:'ve| have) received your application|successfully (?:submitted|applied)|your application is on its way/i;

export async function looksSubmitted(page: Page): Promise<boolean> {
  if (/confirmation|thank|success|submitted/i.test(page.url())) return true;
  for (const f of page.frames()) {
    const t = await f.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    if (SUCCESS.test(t)) return true;
  }
  return false;
}

export async function visibleErrors(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const f of page.frames()) {
    const errs = await f
      .evaluate(() => {
        const sel = "[aria-invalid='true'], [class*='error' i]:not(:empty), [role='alert']:not(:empty)";
        return Array.from(document.querySelectorAll(sel))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ((el as HTMLElement).innerText || (el as HTMLInputElement).name || "").trim())
          .filter((t) => t && t.length < 200);
      })
      .catch(() => [] as string[]);
    out.push(...errs);
  }
  return [...new Set(out)].slice(0, 10);
}
