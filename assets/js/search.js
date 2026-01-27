
(function () {
  const q = new URLSearchParams(location.search).get('q');
  const el = document.getElementById('results');
  if (!q) { el.textContent = 'Enter a search term.'; return; }

  el.textContent = 'Searching...';
  fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`)
    .then(r => r.json())
    .then(d => {
      if (!d || !Array.isArray(d.items) || d.items.length === 0) {
        el.textContent = 'No results.';
        return;
      }
      el.innerHTML = d.items.map(i =>
        `<div><strong>${i.title}</strong><br/>${i.summary}</div>`
      ).join('<hr/>');
    })
    .catch(() => el.textContent = 'Search error');
})();
