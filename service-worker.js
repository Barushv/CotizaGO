const CACHE_NAME = "cotizador-tradicional-v1";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./json/precios.json",
  "./json/creditos.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event)=>{
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event)=>{
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null));
    self.clients.claim();
  })());
});

self.addEventListener("message", (event)=>{
  if (event.data?.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo cachear GET y esquemas http/https, y solo mismo origen (evita chrome-extension://, etc.)
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!(url.protocol === "http:" || url.protocol === "https:")) return;
  if (url.origin !== self.location.origin) return;

  // Network-first para JSON (precios/tasas), cache-first para el resto
  const isJson = url.pathname.endsWith(".json");

  if (isJson) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  })());
});

  // network-first for JSON so updates are detected
  const isJSON = url.pathname.endsWith("/json/precios.json") || url.pathname.endsWith("/json/creditos.json");
  if (isJSON){
    event.respondWith((async ()=>{
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      }catch{
        const cached = await caches.match(req);
        return cached || new Response("{}", { headers:{ "Content-Type":"application/json" } });
      }
    })());
    return;
  }

  // cache-first for the rest
  event.respondWith((async ()=>{
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});

// Simple update notifier: when a new SW is installed, notify clients
self.addEventListener("install", ()=>{
  self.clients.matchAll({ includeUncontrolled: true }).then((clients)=>{
    clients.forEach((client)=>client.postMessage({ type:"UPDATE_AVAILABLE" }));
  });
});
