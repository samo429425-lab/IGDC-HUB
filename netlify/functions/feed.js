/**
 * feed.js — v4 PRO (final unified loader)
 * IGDC / MARU Platform
 */

(function () {
  if (window.__FEED_V4_LOADED__) return;
  window.__FEED_V4_LOADED__ = true;

  const ENDPOINT = "/.netlify/functions/feed";
  const DEFAULT_TTL = 60 * 1000;

  const cache = new Map();
  const inflight = new Map();

  function now() {
    return Date.now();
  }

  function normalizeLang() {
    const raw =
      document.documentElement?.lang ||
      navigator.language ||
      "en";

    const l = raw.toLowerCase();

    if (l.startsWith("ko")) return "ko";
    if (l.startsWith("en")) return "en";
    if (l.startsWith("ja")) return "ja";
    if (l.startsWith("zh")) return "zh";
    if (l.startsWith("vi")) return "vi";
    if (l.startsWith("th")) return "th";
    if (l.startsWith("ru")) return "ru";
    if (l.startsWith("de")) return "de";
    if (l.startsWith("fr")) return "fr";
    if (l.startsWith("es")) return "es";
    if (l.startsWith("pt")) return "pt";
    if (l.startsWith("id")) return "id";
    if (l.startsWith("tr")) return "tr";

    return l.slice(0, 2);
  }

  function normalizePayload(key, raw) {
    const safe = raw || {};
    return {
      meta: safe.meta || { category: key },
      items: Array.isArray(safe.items) ? safe.items : []
    };
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadFromFeed(key) {
    const url = new URL(ENDPOINT, location.origin);
    url.searchParams.set("category", key);
    url.searchParams.set("lang", normalizeLang());
    return fetchJSON(url.toString());
  }

  async function getFeed(key, options = {}) {
    if (!key) throw new Error("feed key required");

    const ttl = typeof options.ttlMs === "number" ? options.ttlMs : DEFAULT_TTL;
    const noCache = !!options.noCache;

    const cached = cache.get(key);
    if (!noCache && cached && now() - cached.ts < ttl) {
      return cached.data;
    }

    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      try {
        const raw = await loadFromFeed(key);
        const normalized = normalizePayload(key, raw);
        cache.set(key, { ts: now(), data: normalized });
        return normalized;
      } catch (err) {
        return {
          meta: { category: key, error: true },
          items: []
        };
      }
    })();

    inflight.set(key, task);

    try {
      return await task;
    } finally {
      inflight.delete(key);
    }
  }

  // Public API
  window.FeedAPI = window.FeedAPI || {};
  window.FeedAPI.get = getFeed;

  window.PSOM = window.PSOM || {};
  window.PSOM.fetchJSON = getFeed;
  window.PSOM.lang = normalizeLang;
  window.PSOM._cache = cache;
})();
