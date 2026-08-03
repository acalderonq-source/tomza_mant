const CACHE_NAME = "tomza-taller-v3";
const STATIC_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/img/app-icon.svg",
  "/css/style.css",
  "/css/compras.css",
  "/css/mantenimientos.css",
  "/js/pwa.js",
  "/js/placa-search.js?v=20260803-2"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});

self.addEventListener("push", event => {
  let payload = {
    title: "Tomza Taller",
    body: "Tiene una notificación pendiente.",
    icon: "/img/app-icon.svg",
    badge: "/img/app-icon.svg",
    url: "/dashboard",
    tag: "tomza-notificacion"
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (error) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || "/img/app-icon.svg",
    badge: payload.badge || "/img/app-icon.svg",
    data: payload.data || { url: payload.url || "/dashboard" },
    tag: payload.tag,
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client && client.url.includes(targetUrl)) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return null;
    })
  );
});
