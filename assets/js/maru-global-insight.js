/* =========================================================
 * MARU Global Insight — Bank-Connected Final Edition
 * ========================================================= */

(function () {
  'use strict';

  if (window.MaruGlobalInsight) return;

  const CONFIG = {
    version: '1.0.0-bank',
    endpoints: {
      maruSearch: '/.netlify/functions/maru-search',
      snapshotEngine: '/.netlify/functions/snapshot-engine',
      insightEngine: '/.netlify/functions/maru-global-insight',
      bank: '/data/search-bank.snapshot.json'
    }
  };

  async function fetchJSON(url, options = {}) {
    try {
      const res = await fetch(url, { cache: 'no-store', ...options });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function nowISO() {
    return new Date().toISOString();
  }

  async function collectSearch(q) {
    if (!q) return null;
    const url = CONFIG.endpoints.maruSearch +
      '?q=' + encodeURIComponent(q) +
      '&limit=100';
    return await fetchJSON(url);
  }

  async function collectSnapshot() {
    return await fetchJSON(CONFIG.endpoints.snapshotEngine);
  }

  async function collectInsight(container) {
    return await fetchJSON(CONFIG.endpoints.insightEngine, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(container)
    });
  }

  async function loadBank() {
    return await fetchJSON(CONFIG.endpoints.bank);
  }

  function mergeIntoBank(bank, items = []) {
    if (!bank || !Array.isArray(bank.items)) return bank;
    const map = new Map(bank.items.map(it => [it.id, it]));
    items.forEach(it => {
      if (!it || !it.id) return;
      map.set(it.id, { ...it, ingested_at: nowISO() });
    });
    bank.items = Array.from(map.values());
    bank.meta.snapshot_version = 'auto.' + nowISO();
    bank.meta.generated_at = nowISO();
    return bank;
  }

  async function dispatch(options = {}) {
    const query = (options.query || options.q || '').trim();
    const searchResult = await collectSearch(query);
    const snapshot = await collectSnapshot();

    const container = {
      meta: {
        engine: 'maru-global-insight',
        version: CONFIG.version,
        generated_at: nowISO()
      },
      query,
      search: searchResult,
      snapshot
    };

    const insight = await collectInsight(container);
    const bank = await loadBank();

    if (insight && insight.items && bank) {
      mergeIntoBank(bank, insight.items);
    }

    return { status: 'ok', bank, insight };
  }

  window.MaruGlobalInsight = {
    version: CONFIG.version,
    dispatch,
    syncToBank: dispatch
  };

})();
