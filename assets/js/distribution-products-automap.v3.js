
/**
 * distribution-products-automap.v3.5.js
 * Verified dual-structure automap (legacy + upgraded)
 */

const MAIN_LIMIT = 100;
const RIGHT_LIMIT = 80;

const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

const RIGHT_KEYS = [
  "distribution-right",
  "distribution-right-middle",
  "distribution-right-bottom"
];

function makeDummy(prefix, i) {
  return {
    title: `${prefix} Product ${i}`,
    thumb: PLACEHOLDER,
    link: "#",
    dummy: true
  };
}

function normalize(item) {
  if (!item) return null;

  return {
    title: item.title || item.name || "Product",
    thumb: item.thumb || item.image || PLACEHOLDER,
    link: item.link || item.url || "#",
    raw: item
  };
}

function fillDummy(list, limit, prefix) {
  let i = list.length + 1;
  while (list.length < limit) {
    list.push(makeDummy(prefix, i++));
  }
}

function render(container, list) {
  if (!container) return;

  container.innerHTML = "";

  list.forEach((it) => {
    const card = document.createElement("div");
    card.className = "product-card";

    const img = document.createElement("img");
    img.src = it.thumb || PLACEHOLDER;

    const title = document.createElement("div");
    title.className = "product-title";
    title.textContent = it.title;

    card.appendChild(img);
    card.appendChild(title);

    if (it.link && it.link !== "#") {
      card.onclick = () => (location.href = it.link);
    }

    container.appendChild(card);
  });
}

function collectRightItems(sections) {
  let result = [];

  RIGHT_KEYS.forEach((k) => {
    if (Array.isArray(sections[k])) {
      result = result.concat(sections[k]);
    }
  });

  return result;
}

function buildList(raw, limit, prefix) {
  let list = [];

  if (Array.isArray(raw)) {
    raw.forEach((x) => {
      const n = normalize(x);
      if (n) list.push(n);
    });
  }

  list = list.slice(0, limit);
  fillDummy(list, limit, prefix);

  return list;
}

/* ================= TARGET RESOLVERS ================= */

function findMainTarget(key) {
  return (
    document.querySelector(`[data-section="${key}"]`) ||
    document.querySelector(`#${key} .thumb-scroller`) ||
    document.querySelector(`.${key} .thumb-scroller`) ||
    document.querySelector(`#${key} .thumb-list`) ||
    document.querySelector(`.${key} .thumb-list`)
  );
}

function findRightTarget() {
  return (
    document.querySelector("[data-section='distribution-right']") ||
    document.querySelector(".brand-rail .rail-track") ||
    document.querySelector(".right-panel") ||
    document.querySelector(".side-list")
  );
}

/* ================= SNAPSHOT ================= */

async function loadDistributionSnapshot() {
  const res = await fetch("/data/distribution.snapshot.json");
  if (!res.ok) throw new Error("Snapshot load failed");

  return await res.json();
}

/* ================= MAIN ================= */

async function initDistributionAutoMap() {
  try {
    const snapshot = await loadDistributionSnapshot();

    if (!snapshot || !snapshot.pages || !snapshot.pages.distribution) {
      console.warn("Invalid distribution snapshot");
      return;
    }

    const sections = snapshot.pages.distribution.sections || {};

    /* MAIN */

    Object.keys(sections).forEach((key) => {
      if (key.indexOf("distribution-") !== 0) return;
      if (RIGHT_KEYS.includes(key)) return;

      const container = findMainTarget(key);
      if (!container) return;

      const raw = sections[key];
      const list = buildList(raw, MAIN_LIMIT, key);

      render(container, list);
    });

    /* RIGHT */

    const rightContainer = findRightTarget();

    if (rightContainer) {
      const rawRight = collectRightItems(sections);
      const rightList = buildList(rawRight, RIGHT_LIMIT, "right");

      render(rightContainer, rightList);
    }

  } catch (e) {
    console.error("Distribution AutoMap Error:", e);
  }
}

document.addEventListener("DOMContentLoaded", initDistributionAutoMap);
