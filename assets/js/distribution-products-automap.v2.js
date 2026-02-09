/**
 * distribution-products-automap.final.js
 * --------------------------------------------------
 * 정본 오토맵 파일
 * - 구조: home-products-automap.v2.js 와 100% 동일
 * - 차이점:
 *   1) 메인 섹션: 6개 (distribution_1 ~ distribution_6)
 *   2) 우측 패널: 1개 (distribution_right)
 *   3) 각 섹션별 개별 타이틀 지원
 * - 슬롯:
 *   메인 100 / 우측 80
 * --------------------------------------------------
 */

const FEED_URL = "/.netlify/functions/feed?page=distribution";

const MAIN_SECTIONS = [
  { key: "distribution_1", title: "Distribution Section 1", limit: 100 },
  { key: "distribution_2", title: "Distribution Section 2", limit: 100 },
  { key: "distribution_3", title: "Distribution Section 3", limit: 100 },
  { key: "distribution_4", title: "Distribution Section 4", limit: 100 },
  { key: "distribution_5", title: "Distribution Section 5", limit: 100 },
  { key: "distribution_6", title: "Distribution Section 6", limit: 100 }
];

const RIGHT_SECTION = {
  key: "distribution_right",
  title: "Popular Brands",
  limit: 80
};

function qs(sel, root = document) {
  return root.querySelector(sel);
}

function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function createDummyCard() {
  const div = document.createElement("div");
  div.className = "thumb-card dummy";
  div.innerHTML = `<div class="thumb-img"></div><div class="thumb-title"></div>`;
  return div;
}

function fillDummies(container, limit) {
  const cards = qsa(".thumb-card", container);
  for (let i = cards.length; i < limit; i++) {
    container.appendChild(createDummyCard());
  }
}

async function fetchSection(key) {
  const res = await fetch(`${FEED_URL}&key=${key}`);
  const json = await res.json();
  return json.items || [];
}

function replaceCards(container, items) {
  const cards = qsa(".thumb-card", container);
  items.forEach((item, idx) => {
    if (!cards[idx]) return;
    cards[idx].classList.remove("dummy");
    cards[idx].innerHTML = `
      <img src="${item.image || ""}" loading="lazy"/>
      <div class="thumb-title">${item.title || ""}</div>
    `;
  });
}

async function runSection(section) {
  const block = qs(`[data-psom-key="${section.key}"]`);
  if (!block) return;

  fillDummies(block, section.limit);

  try {
    const items = await fetchSection(section.key);
    if (items.length) {
      replaceCards(block, items.slice(0, section.limit));
    }
  } catch (e) {
    console.warn("Automap error:", section.key, e);
  }
}

async function init() {
  for (const sec of MAIN_SECTIONS) {
    await runSection(sec);
  }
  await runSection(RIGHT_SECTION);
}

document.addEventListener("DOMContentLoaded", init);
