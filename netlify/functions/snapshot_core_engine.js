
/**
 * snapshot-engine.js (Snapshot Core Engine - Final)
 * -------------------------------------------------
 * Bank -> PSOM -> Multi-Channel Snapshot Generator
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Paths
const BANK_PATH = path.join(__dirname, "../data/search-bank.snapshot.json");
const PSOM_PATH = path.join(__dirname, "../data/psom.json");
const OUTPUT_DIR = path.join(__dirname, "../data/snapshots");

// Utils
function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Score calculation
function calcScore(item) {
  const q = item.quality || {};
  const rank = q.rank || 0;
  const trust = q.trust || 0;
  const fresh = q.freshness || 0;

  return rank * 0.4 + trust * 0.35 + fresh * 0.25;
}

// Deduplicate
function dedupe(items) {
  const map = new Map();

  for (const it of items) {
    const key = it.url || it.id;
    if (!map.has(key)) {
      map.set(key, it);
    }
  }

  return [...map.values()];
}

// Top N
function topN(items, n = 100) {
  return items
    .map(i => ({ ...i, __score: calcScore(i) }))
    .sort((a, b) => b.__score - a.__score)
    .slice(0, n);
}

// Section split
function splitSections(items, sections) {
  const buckets = {};
  sections.forEach(s => (buckets[s] = []));

  let idx = 0;

  for (const item of items) {
    const sec = sections[idx % sections.length];
    buckets[sec].push(item);
    idx++;
  }

  return buckets;
}

// Main build
function buildSnapshots() {
  console.log("[SnapshotCore] Loading Bank...");
  const bank = loadJSON(BANK_PATH);

  console.log("[SnapshotCore] Loading PSOM...");
  const psom = loadJSON(PSOM_PATH);

  ensureDir(OUTPUT_DIR);

  const items = dedupe(bank.items || []);
  const channels = psom.channels || {};

  const resultIndex = {};

  for (const [channel, cfg] of Object.entries(channels)) {
    if (!cfg.enabled) continue;

    console.log("[SnapshotCore] Building:", channel);

    const channelItems = items.filter(i => i.channel === channel);

    const top = topN(channelItems, 100);

    let sections = [];

    if (cfg.sections && cfg.sections.length) {
      sections = cfg.sections;
    } else {
      sections = ["main"];
    }

    const distributed = splitSections(top, sections);

    const snapshot = {
      meta: {
        channel,
        generated_at: new Date().toISOString(),
        engine: "snapshot-core-engine",
        version: "1.0.0"
      },
      sections: distributed,
      total: top.length
    };

    const outFile = path.join(OUTPUT_DIR, `${channel}.snapshot.json`);

    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf8");

    resultIndex[channel] = outFile;
  }

  // Global index
  const indexFile = path.join(OUTPUT_DIR, "snapshot.index.json");

  fs.writeFileSync(
    indexFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        outputs: resultIndex
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("[SnapshotCore] Done.");
  return resultIndex;
}

// Netlify handler
exports.handler = async function () {
  try {
    const outputs = buildSnapshots();

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "ok",
        outputs
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        status: "fail",
        message: e.message
      })
    };
  }
};

// CLI
if (require.main === module) {
  buildSnapshots();
}
