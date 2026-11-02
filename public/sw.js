// Nudgebook service worker: shows reminder pushes, handles Done / Snooze buttons.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const d = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(d.title || "Nudgebook", {
      body: d.body || "",
      icon: "/icon/192",
      badge: "/icon/192",
      tag: d.tag,
      renotify: !!d.tag,
      data: { url: d.url || "/", reminderId: d.reminderId },
      actions: d.reminderId
        ? [
            { action: "done", title: "Done" },
            { action: "snooze", title: "Tomorrow" },
          ]
        : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const { url, reminderId } = event.notification.data || {};
  event.notification.close();
  if (reminderId && (event.action === "done" || event.action === "snooze")) {
    event.waitUntil(
      fetch(`/api/reminders/${reminderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: event.action, hours: 24 }),
      }),
    );
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
      return w ? w.focus().then(() => w.navigate(url)) : self.clients.openWindow(url);
    }),
  );
});
