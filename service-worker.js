const CACHE_NAME = "cotizago-v1.2"; // cambia versión cuando actualices archivos
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./json/precios.json",
  "./json/creditos.json",

  // icons
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE);

      // Notifica a clientes (para mostrar botón "Actualizar", si lo usas)
      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
      });
      clients.forEach((c) => c.postMessage({ type: "UPDATE_AVAILABLE" }));

      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // limpia caches viejos
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET + http/https + mismo origen (evita chrome-extension:// y terceros)
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!(url.protocol === "http:" || url.protocol === "https:")) return;
  if (url.origin !== self.location.origin) return;

  const isJson = url.pathname.endsWith(".json");

  // JSON: network-first (para que se actualicen precios/tasas)
  if (isJson) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return (
            cached ||
            new Response("{}", {
              headers: { "Content-Type": "application/json" },
            })
          );
        }
      })()
    );
    return;
  }

  // Resto: cache-first
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    })()
  );
});
