== Supabase Auto Injector (no secrets in code) ==

Files:
 - /assets/js/autoBootstrap.js    <-- add ONE line in index.html to include this
 - /assets/js/supabase.vars.js    <-- safe loader: fetches public values from secureEnvBridge
 - /sw-inject.js                  <-- service worker that injects loader into ALL HTML pages

Steps (1 minute):
 1) Put these files in your site (same paths).
 2) Add ONE line in a single page (e.g., index.html, inside <head>):

    <script src="/assets/js/autoBootstrap.js" defer></script>

 3) Deploy. Open the site once to let the SW install. From then on, every page will
    automatically include /assets/js/supabase.vars.js (no need to edit 100+ files).

Check:
 - Console: window.SUPABASE  --> { url, anonKey }
 - Function: /.netlify/functions/secureEnvBridge?public=supabase  --> returns URL + anon key

Notes:
 - If you need to uninstall the SW: call navigator.serviceWorker.getRegistrations().then(r=>r.forEach(x=>x.unregister()));
 - Ensure your Netlify Function returns only PUBLIC values for ?public=supabase:
   { env: { SUPABASE_URL: "...", SUPABASE_ANON_KEY: "..." } }
