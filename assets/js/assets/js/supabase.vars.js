// assets/js/supabase.vars.js
// SAFE VERSION: loads public Supabase values via Netlify Function (no hardcoded secrets).
(function () {
  const TIMEOUT_MS = 5000;
  function setSupabase(url, anon) {
    window.SUPABASE = Object.freeze({ url: url || "", anonKey: anon || "" });
    document.dispatchEvent(new CustomEvent("supabase:ready", { detail: window.SUPABASE }));
  }
  function withTimeout(p, ms){return new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error("timeout")),ms);p.then(v=>{clearTimeout(t);res(v)},e=>{clearTimeout(t);rej(e)})});}
  withTimeout(fetch("/.netlify/functions/secureEnvBridge?public=supabase", { cache: "no-store" }), TIMEOUT_MS)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status))))
    .then(j => {
      const url  = j && j.env && j.env.SUPABASE_URL;
      const anon = j && j.env && j.env.SUPABASE_ANON_KEY;
      if (url && anon) return setSupabase(url, anon);
      throw new Error("missing env");
    })
    .catch(() => setSupabase("", ""));
})();