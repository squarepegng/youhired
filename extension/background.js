// JobPilot extension: asks your local JobPilot app for work and carries it out in tabs of this Chrome.
// It only ever talks to the JobPilot address you paired, with the pairing code you pasted.

const VERSION = chrome.runtime.getManifest().version;
let running = false;

async function config() {
  const { server, code } = await chrome.storage.local.get(["server", "code"]);
  return { server: server || "http://localhost:5173", code: code || "" };
}

async function loop() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const { server, code } = await config();
      if (!code) return;
      let res;
      try {
        res = await fetch(`${server}/api/ext/poll`, { headers: { "x-jobpilot-code": code, "x-jobpilot-version": VERSION } });
      } catch {
        await chrome.storage.local.set({ lastError: "Can't reach JobPilot. Is it running?" });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (res.status === 401) {
        await chrome.storage.local.set({ lastError: "Wrong pairing code" });
        return;
      }
      await chrome.storage.local.set({ lastOk: Date.now(), lastError: "" });
      if (res.status === 204) continue;
      const cmd = await res.json();
      let reply;
      try {
        reply = { id: cmd.id, ok: true, value: await handle(cmd) };
      } catch (e) {
        reply = { id: cmd.id, ok: false, error: String((e && e.message) || e) };
      }
      await fetch(`${server}/api/ext/result`, { method: "POST", headers: { "content-type": "application/json", "x-jobpilot-code": code }, body: JSON.stringify(reply) }).catch(() => {});
    }
  } finally {
    running = false;
  }
}

function waitForComplete(tabId, ms) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(t);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    const t = setTimeout(done, ms);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done()).catch(done);
  });
}

async function inject(tabId, frameId) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content.js"] });
}

async function handle(cmd) {
  const a = cmd.args || {};
  switch (cmd.op) {
    case "openTab": {
      const tab = await chrome.tabs.create({ url: a.url, active: true });
      await waitForComplete(tab.id, 30000);
      return { tabId: tab.id };
    }
    case "settle": {
      await waitForComplete(a.tabId, 15000);
      await new Promise((r) => setTimeout(r, 700));
      const tab = await chrome.tabs.get(a.tabId);
      const frames = ((await chrome.webNavigation.getAllFrames({ tabId: a.tabId })) || []).map((f) => ({ frameId: f.frameId, url: f.url }));
      return { url: tab.url, frames };
    }
    case "exec": {
      const target = { tabId: a.tabId, frameIds: [a.frameId || 0] };
      await inject(a.tabId, a.frameId || 0);
      const [r] = await chrome.scripting.executeScript({
        target,
        func: (op, args) => window.__jobpilot[op](...args),
        args: [a.op, a.args || []],
      });
      if (r && r.result && r.result.__error) throw new Error(r.result.__error);
      return r ? r.result : null;
    }
    case "capture": {
      const tab = await chrome.tabs.get(a.tabId);
      const win = await chrome.windows.get(tab.windowId);
      if (!tab.active || !win.focused) return { dataUrl: null };
      return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 55 }) };
    }
    case "focus": {
      const tab = await chrome.tabs.update(a.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return true;
    }
    case "closeTab":
      await chrome.tabs.remove(a.tabId).catch(() => {});
      return true;
    default:
      throw new Error(`Unknown command ${cmd.op}`);
  }
}

chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === "reconnect") loop();
});
chrome.runtime.onStartup.addListener(loop);
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("jobpilot-keepalive", { periodInMinutes: 0.5 });
  loop();
});
chrome.alarms.onAlarm.addListener(() => loop());
loop();
