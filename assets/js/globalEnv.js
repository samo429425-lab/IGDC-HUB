// /assets/js/globalEnv.js
// Loads a client-side bridge for env values (without hardcoding secrets).
// 1) If /js/secureEnvBridge.js exists, load it.
// 2) Otherwise, expose a minimal placeholder to avoid errors.

(function(){
  function defineFallback(){
    if (!window.secureEnv) {
      window.secureEnv = Object.freeze({
        OPENAI_API_KEY: null,        // intentionally null on client
        SUPABASE_URL: null,
        SUPABASE_ANON_KEY: null
      });
      console.log("globalEnv: fallback secureEnv defined (no client secrets).");
    }
  }

  function loadBridge(){
    var s = document.createElement("script");
    s.src = "/js/secureEnvBridge.js";
    s.async = false;
    s.onload = function(){ console.log("globalEnv: secureEnvBridge loaded."); };
    s.onerror = function(){ console.warn("globalEnv: secureEnvBridge not found, using fallback."); defineFallback(); };
    document.head.appendChild(s);
  }

  // Avoid double-defining
  if (window.secureEnv) {
    console.log("globalEnv: secureEnv already present.");
  } else {
    loadBridge();
  }
})();
