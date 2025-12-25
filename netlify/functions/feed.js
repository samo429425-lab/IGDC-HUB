
// feed.js (FIXED)
// YES: Data provider only
// NO: DOM access, rendering, or side effects

(function () {
  const DEFAULT_ENDPOINT = '/.netlify/functions/feed';

  async function fetchFeed(params = {}) {
    const url = new URL(DEFAULT_ENDPOINT, window.location.origin);

    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.set(key, params[key]);
      }
    });

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Feed fetch failed');
    return res.json();
  }

  // expose data-only API
  window.FeedAPI = {
    get: fetchFeed
  };
})();
