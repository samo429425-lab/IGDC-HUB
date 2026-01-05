
// /assets/js/selfcheck-ui.js
// DEPLOY-LOG LEVEL UI OUTPUT (FINAL)

(function () {
  const root = document.getElementById("selfcheck-root");
  if (!root) return;

  function formatFail(r) {
    return [
      `❌ ${r.layer.toUpperCase()} : ${r.hint}`,
      `  - endpoint : ${r.endpoint}`,
      `  - status   : ${r.status}`,
      r.error ? `  - error    : ${r.error}` : "",
    ].filter(Boolean).join("\n");
  }

  async function run() {
    try {
      const res = await fetch("/.netlify/functions/selfcheck", {
        cache: "no-store"
      });
      const data = await res.json();

      if (data.ok) {
        root.textContent = "Selfcheck: OK";
        root.style.color = "#16a34a";
        return;
      }

      const failures = data.results.filter(r => !r.ok);
      root.textContent = failures.map(formatFail).join("\n\n");
      root.style.color = "#dc2626";

    } catch (e) {
      root.textContent = "Selfcheck 실행 오류: " + e.message;
      root.style.color = "#dc2626";
    }
  }

  run();
  setInterval(run, 15000);
})();
