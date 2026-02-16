// tour-feed.js
// Tour Hub Feed Logger (Impression / Click Tracking)

(function () {

  const API = "/functions/tour-feed";

  function send(payload) {
    try {
      navigator.sendBeacon(API, JSON.stringify(payload));
    } catch (e) {
      fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
  }

  function logImpression(id) {
    if (!id) return;

    send({
      type: "impression",
      hub: "tour",
      id: id,
      page: location.pathname,
      ts: Date.now()
    });
  }

  function logClick(id) {
    if (!id) return;

    send({
      type: "click",
      hub: "tour",
      id: id,
      page: location.pathname,
      ts: Date.now()
    });
  }

  function observeImpression() {

    const observer = new IntersectionObserver(entries => {

      entries.forEach(entry => {

        if (entry.isIntersecting) {

          const id = entry.target.dataset.trackId;
          logImpression(id);

          observer.unobserve(entry.target);

        }

      });

    }, { threshold: 0.6 });

    document.querySelectorAll(".thumb-link").forEach(el => {
      observer.observe(el);
    });
  }

  function bindClick() {

    document.body.addEventListener("click", e => {

      const link = e.target.closest(".thumb-link");

      if (!link) return;

      logClick(link.dataset.trackId);

    });

  }

  function init() {

    bindClick();

    setTimeout(observeImpression, 1500);

    console.log("[TOUR FEED] Ready");

  }

  document.addEventListener("DOMContentLoaded", init);

})();
