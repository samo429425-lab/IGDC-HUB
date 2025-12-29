/*
 * IGDC System Checker
 * Location: /assets/js/diagnostics/igdc-system-checker.js
 * Purpose: Read-only diagnostics for IGDC frontend / backend wiring
 * Safe: does NOT modify DOM, data, or state
 */

(function (global) {
  "use strict";

  const IGDC_DIAG = {};

  const PAGE_MAP = {
    home: "home.html",
    network: "networkhub.html",
    distribution: "distributionhub.html",
    social: "socialnetwork.html",
    media: "mediahub.html",
    tour: "tour.html",
    donation: "donation.html"
  };

  const RESULT = [];

  function now() {
    return new Date().toISOString();
  }

  function push(result) {
    RESULT.push(Object.assign({ ts: now() }, result));
  }

  function ok(scope, target, message) {
    push({ level: "ok", scope, target, message });
  }

  function warn(scope, target, message) {
    push({ level: "warn", scope, target, message });
  }

  function err(scope, target, message) {
    push({ level: "error", scope, target, message });
  }

  // DOM CHECK
  function checkDOM(pageKey) {
    try {
      const keys = Array.from(document.querySelectorAll('[data-psom-key]'))
        .map(el => el.getAttribute('data-psom-key'));

      if (!keys.length) {
        warn("dom", pageKey, "no data-psom-key found");
      } else {
        ok("dom", pageKey, `found ${keys.length} psom keys`);
      }

      keys.forEach(k => {
        const el = document.querySelector(`[data-psom-key="${k}"]`);
        if (!el) {
          err("dom", k, "psom key missing");
          return;
        }
        const section = el.closest(".ad-section");
        if (!section) warn("dom", k, "no .ad-section wrapper");

        const list = section ? section.querySelector(".ad-list") : null;
        if (!list) warn("dom", k, "no .ad-list found");
        else if (!list.children.length) warn("dom", k, "ad-list empty");
        else ok("dom", k, `rendered ${list.children.length}`);
      });
    } catch (e) {
      err("dom", pageKey, e.message);
    }
  }

  // SNAPSHOT CHECK
  async function checkSnapshot() {
    try {
      const res = await fetch("/.netlify/functions/snapshot", { cache: "no-store" });
      if (!res.ok) {
        err("snapshot", "fetch", "snapshot endpoint not reachable");
        return;
      }

      const json = await res.json();
      const keys = Object.keys(json || {});

      if (!keys.length) {
        warn("snapshot", "root", "snapshot empty");
        return;
      }

      ok("snapshot", "root", `keys=${keys.length}`);

      keys.forEach(k => {
        const items = json[k]?.items || json[k];
        if (!items || !items.length) warn("snapshot", k, "no items");
        else ok("snapshot", k, `items=${items.length}`);
      });
    } catch (e) {
      err("snapshot", "exception", e.message);
    }
  }

  // FEED CHECK
  async function checkFeed(pageKey) {
    try {
      const url = `/.netlify/functions/feed?page=${pageKey}`;
      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        err("feed", pageKey, `HTTP ${res.status}`);
        return;
      }

      const json = await res.json();
      const sections = json.sections || [];

      if (!sections.length) {
        warn("feed", pageKey, "no sections returned");
        return;
      }

      ok("feed", pageKey, `sections=${sections.length}`);

      sections.forEach(sec => {
        const id = sec.id || "(no-id)";
        const count = Array.isArray(sec.items) ? sec.items.length : 0;
        if (!count) warn("feed", id, "empty items");
        else ok("feed", id, `items=${count}`);
      });
    } catch (e) {
      err("feed", pageKey, e.message);
    }
  }

  // PUBLIC API
  IGDC_DIAG.run = async function (pageKey) {
    RESULT.length = 0;

    if (!PAGE_MAP[pageKey]) {
      err("system", pageKey, "unknown page key");
      return RESULT;
    }

    checkDOM(pageKey);
    await checkFeed(pageKey);
    await checkSnapshot();

    return RESULT;
  };

  IGDC_DIAG.runAll = async function () {
    RESULT.length = 0;
    for (const key of Object.keys(PAGE_MAP)) {
      await IGDC_DIAG.run(key);
    }
    return RESULT;
  };

  IGDC_DIAG.getResults = function () {
    return RESULT.slice();
  };

  global.IGDC_DIAG = IGDC_DIAG;

})(window);
