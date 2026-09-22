/**
 * Service worker — jen na dvě věci: zobrazit notifikaci, když přijde push,
 * a po kliknutí otevřít appku. Žádné cachování stránek ani dat: tohle je
 * živý provozní nástroj, ne dokument ke čtení offline, a zastaralá
 * uložená verze by mohla ukázat neaktuální stav úkolů.
 */

self.addEventListener("push", (event) => {
  let data = { title: "Studio Deník", body: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192",
      badge: "/icon-192",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
