const $ = (id) => document.getElementById(id);
async function refresh() {
  const { server, code, lastOk, lastError } = await chrome.storage.local.get(["server", "code", "lastOk", "lastError"]);
  if (server) $("server").value = server;
  if (code) $("code").value = code;
  const on = lastOk && Date.now() - lastOk < 40000;
  $("dot").className = "dot" + (on ? " on" : "");
  $("msg").textContent = on ? "Connected to YouHired" : lastError || (code ? "Connecting…" : "Not connected");
}
$("save").onclick = async () => {
  await chrome.storage.local.set({ server: $("server").value.trim().replace(/\/$/, ""), code: $("code").value.trim(), lastError: "" });
  chrome.runtime.sendMessage({ type: "reconnect" });
  setTimeout(refresh, 1500);
};
refresh();
setInterval(refresh, 2000);
