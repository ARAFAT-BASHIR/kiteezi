self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || "Kiteezi notification", {
    body: data.body || "You have a new Kiteezi notification.",
    tag: data.tag || "kiteezi-notification",
    data: { url: data.url || "https://arafat-bashir.github.io/kiteezi/admin/index.html" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.includes("/kiteezi/"));
    if (existing) {
      try { await existing.navigate(url); } catch (_) {}
      return existing.focus();
    }
    return self.clients.openWindow(url);
  })());
});