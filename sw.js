// Service worker d'AlphaScope : l'appli s'ouvre sans réseau, et les notifications s'affichent.
// VERSION est réécrite par publier_appli.py à chaque publication : un nouveau numéro
// installe la nouvelle appli et efface l'ancienne copie.

const VERSION = "2026-11-05-245688ea53";
const CACHE = `alphascope-appli-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./js/api.js",
  "./js/config.js",
  "./js/erreurs.js",
  "./js/feuille.js",
  "./js/graphiques.js",
  "./js/notifications.js",
  "./js/outils.js",
  "./js/rendu.js",
  "./js/saisies.js",
  "./js/visionneuse.js",
  "./manifest.webmanifest",
  "./icones/apple-touch-icon.png",
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./icones/icone-maskable-512.png",
  "./icones/badge-96.png",
  "./icones/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("alphascope-appli-") && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// L'appli elle-même : d'abord la copie, mise à jour en arrière-plan. Les données
// (api.github.com) ne passent pas par ici : la page garde sa propre copie.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/demo/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const response = await network;
      if (response) return response;
      if (request.mode === "navigate") return (await cache.match("./index.html")) || Response.error();
      return Response.error();
    }),
  );
});

// Une notification arrive : iOS exige qu'elle soit toujours affichée.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  const title = message.title || "AlphaScope";
  const options = {
    body: message.body || "Du nouveau dans AlphaScope.",
    tag: message.tag || undefined,
    data: { url: message.url || self.registration.scope },
    icon: "./icones/icone-192.png",
    badge: "./icones/badge-96.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
