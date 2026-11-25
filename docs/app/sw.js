// DailyQuest service worker: keeps a copy of the app on the device so the home-screen app
// opens instantly and works offline. Quests themselves live in localStorage (and Supabase
// when logged in); this file only caches the app's files.
//
// Bump CACHE when you want every device to drop its old copy (normally not needed: the page
// is fetched fresh whenever there's a connection).
const CACHE = "dailyquest-v2";
const APP_FILES = ["./", "./manifest.webmanifest", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon-64.png", "./img/tavern.jpg"];
// Other sites whose files are safe to keep offline: the pinned Supabase library and Google Fonts.
const CACHEABLE_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("dailyquest-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Reminders: show the notification the send-reminders function pushed, and open the app when it's tapped.
self.addEventListener("push", (event) => {
  let note = {};
  try { note = event.data ? event.data.json() : {}; } catch (e) { note = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(note.title || "DailyQuest", {
    body: note.body || "You have quests today",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: note.tag || "dailyquest",
    data: { url: note.url || "./" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const open = wins.find((w) => w.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // never touch saves, logins or analytics posts
  const url = new URL(req.url);
  const sameSite = url.origin === self.location.origin;
  if (!sameSite && !CACHEABLE_HOSTS.includes(url.hostname)) return;   // Supabase, PostHog, holidays API: always live
  if (sameSite && url.pathname.includes("/api/")) return;              // local server.js AI routes: always live

  // The page itself: try the network first so updates show right away; fall back to the saved copy offline.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./", copy)); return res; })
      .catch(() => caches.match("./")));
    return;
  }
  // Icons, fonts, the Supabase library: use the saved copy, refreshing it in the background.
  event.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  })));
});
