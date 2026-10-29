"use strict";
importScripts("checker.js");
const INBOX = "https://www.startupschool.org/cofounder-matching/inbox";
const ALARM = "yc-inbox-check";
let running;

async function schedule() {
  const { enabled = true, interval = 3 } = await chrome.storage.local.get(["enabled", "interval"]);
  await chrome.alarms.clear(ALARM);
  if (enabled) await chrome.alarms.create(ALARM, { periodInMinutes: [1, 3, 5, 10].includes(interval) ? interval : 3 });
  return enabled;
}

async function check() {
  if (running) return running;
  running = performCheck().finally(() => { running = null; });
  return running;
}

async function performCheck() {
  try {
    await chrome.storage.local.set({ checking: true });
    const page = await fetch(INBOX, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!page.ok) throw new Error(`Inbox returned ${page.status}. Open the inbox and sign in again.`);
    const html = await page.text();
    if (!html.includes('component: "CFMInbox"')) throw new Error("Sign in to Startup School and open your co-founder inbox first.");
    const token = YCChecker.csrfToken(html);
    if (!token) throw new Error("Could not read the inbox security token. Try signing in again.");
    const response = await fetch("https://www.startupschool.org/graphql", {
      method: "POST", credentials: "include", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ query: YCChecker.query })
    });
    if (!response.ok) throw new Error(`Message check returned ${response.status}. Try opening the inbox and signing in again.`);
    const data = await response.json();
    const snapshot = YCChecker.snapshot(data);
    const stored = await chrome.storage.local.get(["account", "seen"]);
    if (stored.account && stored.account !== snapshot.account) {
      await chrome.storage.local.set({ previews: null, unread: 0, lastChecked: null });
    }
    const seen = stored.account === snapshot.account ? stored.seen || {} : {};
    const fresh = snapshot.unread.filter(item => seen[item.slug] !== item.createdAt);
    // Retain timestamps for read conversations too, so rereading cannot re-alert.
    const nextSeen = { ...seen };
    for (const item of snapshot.unread) nextSeen[item.slug] = item.createdAt;
    await chrome.action.setBadgeBackgroundColor({ color: "#f26522" });
    await chrome.action.setBadgeText({ text: snapshot.unread.length ? String(snapshot.unread.length) : "" });
    if (fresh.length) {
      await notify(`${fresh.length} conversation${fresh.length === 1 ? " has" : "s have"} new unread messages. Click to open your inbox.`);
    }
    await chrome.storage.local.set({ account: snapshot.account, seen: nextSeen, unread: snapshot.unread.length, previews: snapshot.previews,
      lastChecked: Date.now(), error: "", checking: false });
  } catch (error) {
    await chrome.storage.local.set({ error: error.message || "Message check failed.", checking: false, lastAttempt: Date.now() });
    await chrome.action.setBadgeText({ text: "!" });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function notify(message) {
  await chrome.notifications.create("yc-messages", { type: "basic", iconUrl: "icons/icon-128.png",
    title: "YC Message Checker", message, priority: 2 });
}

const start = () => { schedule().then(enabled => { if (enabled) return check(); }); };
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === ALARM && (await chrome.storage.local.get("enabled")).enabled !== false) check();
});
chrome.notifications.onClicked.addListener(id => { if (id === "yc-messages") chrome.tabs.create({ url: INBOX }); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const work = message.type === "check" ? check()
    : message.type === "settings" ? (async () => {
      if (![1, 3, 5, 10].includes(message.interval) || typeof message.enabled !== "boolean") throw new Error("Invalid settings");
      await chrome.storage.local.set({ interval: message.interval, enabled: message.enabled });
      await schedule();
      return { ok: true };
    })() : message.type === "test" ? notify("Notifications are working. New messages will appear here.").then(() => ({ ok: true })) : null;
  if (!work) return;
  work.then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
