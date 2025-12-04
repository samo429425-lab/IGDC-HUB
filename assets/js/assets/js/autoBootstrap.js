// assets/js/autoBootstrap.js
// One-line include on a single page (e.g., index.html) is enough.
// It registers a service worker that injects /assets/js/supabase.vars.js into *all* HTML responses.
// It also injects the loader immediately on the current page.

(function(){
  // Immediately ensure current page has the loader
  function ensureLoader(){
    if (![...document.scripts].some(s => (s.src||"").includes("/assets/js/supabase.vars.js"))) {
      var s = document.createElement("script");
      s.src = "/assets/js/supabase.vars.js";
      s.defer = true;
      document.head.appendChild(s);
    }
  }

  // Register SW to inject on all future navigations
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("/sw-inject.js", { scope: "/" })
        .then(function(reg){ console.log("SW registered:", reg.scope); })
        .catch(function(err){ console.warn("SW register failed:", err); });
    });
  }

  ensureLoader();
})();