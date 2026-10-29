"use strict";
const enabled = document.getElementById("enabled");
const interval = document.getElementById("interval");
const status = document.getElementById("status");
const check = document.getElementById("check");
const refresh = document.getElementById("refresh");
const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
function toggleSettings(open) {
  settingsPanel.hidden = !open;
  document.getElementById("messagesPanel").hidden = open;
  settingsToggle.setAttribute("aria-expanded", String(open));
  if (open) enabled.focus();
  else settingsToggle.focus();
}
settingsToggle.addEventListener("click", () => toggleSettings(settingsPanel.hidden));
document.getElementById("settingsClose").addEventListener("click", () => toggleSettings(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !settingsPanel.hidden) {
    event.preventDefault();
    toggleSettings(false);
  }
});
let busy = false;
let filter = "all";
function renderPreviews(state) {
  document.getElementById("all").setAttribute("aria-pressed", String(filter === "all"));
  document.getElementById("unread").setAttribute("aria-pressed", String(filter === "unread"));
  const note = document.getElementById("cacheNote");
  note.textContent = state.error && state.previews ? "Cached previews — the latest check failed." : "";
  const list = document.getElementById("previews");
  const rows = state.previews?.[filter] || [];
  const nodes = rows.map(item => {
    const row = document.createElement("li");
    const link = document.createElement("a");
    const url = new URL("https://www.startupschool.org/cofounder-matching/inbox");
    url.searchParams.set("conversation", item.slug);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "preview";
    const title = document.createElement("strong");
    title.textContent = item.name;
    link.append(title);
    if (item.unread) {
      const badge = document.createElement("span");
      badge.className = "unread-marker";
      badge.textContent = "Unread";
      link.append(badge);
    }
    const time = document.createElement("time");
    time.dateTime = item.createdAt;
    time.textContent = new Date(item.createdAt).toLocaleString();
    const snippet = document.createElement("span");
    snippet.className = "snippet";
    snippet.textContent = `${item.outgoing ? "You: " : ""}${item.snippet || "No message preview"}`;
    link.append(time, snippet);
    row.append(link);
    return row;
  });
  if (!nodes.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = !state.previews ? "Click Refresh to load message previews."
      : filter === "unread" ? "No unread conversations." : "No conversations yet.";
    nodes.push(empty);
  }
  list.replaceChildren(...nodes);
}
for (const value of ["all", "unread"]) {
  document.getElementById(value).addEventListener("click", () => { filter = value; render(); });
}
async function render() {
  const state = await chrome.storage.local.get(["enabled", "interval", "unread", "lastChecked", "error", "previews"]);
  renderPreviews(state);
  enabled.checked = state.enabled !== false;
  interval.value = String(state.interval || 3);
  status.textContent = state.error || (state.lastChecked ? `${state.unread || 0} unread conversation${state.unread === 1 ? "" : "s"}` : "Ready to check. Sign in to Startup School first.");
  status.classList.toggle("error", Boolean(state.error));
  document.getElementById("lastChecked").textContent = state.lastChecked ? `Last checked: ${new Date(state.lastChecked).toLocaleString()}` : "";
}
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "Unable to complete the request.");
}
async function save() {
  enabled.disabled = interval.disabled = true;
  try { await send({ type: "settings", enabled: enabled.checked, interval: Number(interval.value) }); await render(); }
  catch (error) { status.textContent = error.message; }
  finally { enabled.disabled = interval.disabled = false; }
}
enabled.addEventListener("change", save);
interval.addEventListener("change", save);
async function refreshMessages() {
  if (busy) return;
  busy = true; check.disabled = refresh.disabled = true; status.textContent = "Checking…";
  try { await send({ type: "check" }); }
  catch (error) { status.textContent = error.message; }
  finally { busy = false; check.disabled = refresh.disabled = false; await render(); }
}
check.addEventListener("click", refreshMessages);
refresh.addEventListener("click", refreshMessages);
document.getElementById("test").addEventListener("click", async () => {
  try { await send({ type: "test" }); status.textContent = "Test notification sent."; }
  catch (error) { status.textContent = error.message; }
});
chrome.storage.onChanged.addListener(() => { if (!busy) render(); });
render();
