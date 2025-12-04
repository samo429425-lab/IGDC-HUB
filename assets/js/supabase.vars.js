// assets/js/supabase.vars.js
// SAFE VERSION: No hardcoded secrets. Loads public Supabase values from Netlify Function.
// Usage: include this before any code that initializes Supabase.
//   <script src="/assets/js/supabase.vars.js"></script>
(function () {
  const TIMEOUT_MS = 5000;

  function setSupabase(url, anon) {
    // Expose only what the client needs
    window.SUPABASE = Object.freeze({ url: url || "", anonKey: anon || "" });
    document.dispatchEvent(new CustomEvent("supabase:ready", { detail: window.SUPABASE }));
    console.log("supabase.vars.js: ready", window.SUPABASE.url ? "(url ok)" : "(url missing)");
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  // Fetch only PUBLIC values from your Netlify Function
  withTimeout(fetch("/.netlify/functions/secureEnvBridge?public=supabase", { cache: "no-store" }), TIMEOUT_MS)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status))))
    .then(j => {
      const url  = j && j.env && j.env.SUPABASE_URL;
      const anon = j && j.env && j.env.SUPABASE_ANON_KEY;
      if (url && anon) return setSupabase(url, anon);
      throw new Error("missing env");
    })
    .catch(err => {
      console.warn("supabase.vars.js: failed to load public env via bridge:", err && err.message);
      // Fallback to empty (prevents runtime errors; you can gate UI with 'supabase:ready')
      setSupabase("", "");
    });
})();
