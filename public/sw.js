const CACHE = "pigeon-ui-v1";
const ASSETS = [
  "/",
  "/login.html",
  "/worker.html",
  "/manager.html",
  "/manifest.json",
  "/pigeon.jpeg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(()=>{})
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).catch(()=>cached))
  );
});