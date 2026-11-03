self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || "Kiteezi notification", {
    body: data.body || "You have a new Kiteezi notification.",
    tag: data.tag || "kiteezi-notification",
    data: { url: data.url || "https://kiteezirecreationalcenter.com/admin/index.html" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || "https://kiteezirecreationalcenter.com/admin/index.html";
  event.waitUntil((async () => {
    const target = new URL(rawUrl, self.location.origin);
    if (target.origin !== self.location.origin) return self.clients.openWindow("https://kiteezirecreationalcenter.com/admin/index.html");
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch (_) { return false; }
    });
    if (existing) {
      try { await existing.navigate(target.href); } catch (_) {}
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
