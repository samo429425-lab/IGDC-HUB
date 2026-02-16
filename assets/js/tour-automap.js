// tour-automap.js
// Tour Hub Right Panel Automap (PSOM Based)

document.addEventListener("DOMContentLoaded", function () {

  async function loadSnapshot(key) {
    const res = await fetch(`/data/${key}.json`);
    if (!res.ok) throw new Error("Snapshot load failed: " + key);
    return await res.json();
  }

  function clearPanel(panel) {
    panel.innerHTML = "";
  }

  function renderItem(item) {
    const div = document.createElement("div");
    div.className = "thumb-card";

    div.innerHTML = `
      <a href="${item.link || item.url || "#"}"
         class="thumb-link"
         data-track-id="${item.id}">
        <img src="${item.thumb || item.image}"
             loading="lazy"
             alt="${item.title || ""}">
      </a>
    `;

    return div;
  }

  async function mount(panel) {

    const key = panel.dataset.psomKey;
    if (!key) return;

    try {

      const data = await loadSnapshot(key);

      if (!data.items || !data.items.length) return;

      clearPanel(panel);

      data.items.forEach(item => {
        panel.appendChild(renderItem(item));
      });

      console.log("[TOUR AUTOMAP] OK:", key);

    } catch (e) {
      console.error("[TOUR AUTOMAP ERROR]", e);
    }
  }

  document
    .querySelectorAll('[data-psom-key^="tour"], [data-psom-key^="right-tour"]')
    .forEach(mount);

});
