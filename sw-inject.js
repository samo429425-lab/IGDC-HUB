// sw-inject.js
// Intercepts HTML pages and injects <script src="/assets/js/supabase.vars.js"> into <head>.
// This lets you avoid editing 100+ HTML files.

self.addEventListener("install", event => { self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });

function shouldHandle(req) {
  return req.method === "GET" &&
         (req.destination === "document" || (req.headers.get("accept")||"").includes("text/html"));
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (!shouldHandle(req)) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-store", credentials: "same-origin" });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) return res;

      const text = await res.text();
      const hook = "</head>";
      const injectTag = '<script src="/assets/js/supabase.vars.js"></script>';
      if (text.includes(injectTag)) {
        return new Response(text, { status: res.status, headers: res.headers });
      }
      const injected = text.includes(hook)
        ? text.replace(hook, injectTag + "\n" + hook)
        : (injectTag + "\n" + text);

      const headers = new Headers(res.headers);
      headers.set("content-length", String(new Blob([injected]).size));
      return new Response(injected, { status: res.status, headers });
    } catch (e) {
      return fetch(req);
    }
  })());
});