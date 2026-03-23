// feed-distribution.js (FINAL - DISTRIBUTION FEED ENGINE)

import fs from "fs/promises";
import path from "path";

// -------------------- CONFIG --------------------

const SEARCHBANK_SNAPSHOT_CANDIDATES = [
  "/var/task/data/searchbank.snapshot.json",
  "./data/searchbank.snapshot.json",
  "data/searchbank.snapshot.json"
];

const PSOM_CANDIDATES = [
  "/var/task/data/psom.json",
  "./data/psom.json",
  "data/psom.json"
];

// -------------------- CORS --------------------

function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function ok(body) {
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

function err(code, message, extra = {}) {
  return {
    statusCode: code,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message, ...extra })
  };
}

// -------------------- FS SAFE READ --------------------

async function safeReadJSONFromCandidates(paths) {
  for (const p of paths) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      return JSON.parse(raw);
    } catch {}
  }
  return null;
}

// -------------------- LOAD SEARCHBANK --------------------

async function loadSearchBankSnapshot() {
  // 1. FS
  const local = await safeReadJSONFromCandidates(SEARCHBANK_SNAPSHOT_CANDIDATES);
  if (local) return local;

  // 2. HTTP fallback
  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "";

  const urls = [];
  if (base) {
    urls.push(`${base.replace(/\/$/, "")}/data/searchbank.snapshot.json`);
  }
  urls.push(`/data/searchbank.snapshot.json`);

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch {}
  }

  return null;
}

// -------------------- LOAD PSOM --------------------

async function loadPSOM() {
  return await safeReadJSONFromCandidates(PSOM_CANDIDATES);
}

// -------------------- SEARCHBANK FLATTEN --------------------

function flattenSearchbank(searchbank) {
  // 다양한 구조 대응 (items / pages / sections)
  if (!searchbank) return [];

  if (Array.isArray(searchbank.items)) return searchbank.items;

  if (searchbank.pages) {
    const out = [];
    for (const p of Object.values(searchbank.pages)) {
      if (p.sections) {
        for (const sec of Object.values(p.sections)) {
          if (Array.isArray(sec)) out.push(...sec);
        }
      }
    }
    return out;
  }

  return [];
}

// -------------------- BUILD SECTIONS --------------------

function buildSectionsFromPSOM({ page, searchbank, psom }) {

  if (!Array.isArray(psom)) return {};

  const pageDef = psom.find(p => p.page === page);
  if (!pageDef || !Array.isArray(pageDef.sections)) return {};

  const allItems = flattenSearchbank(searchbank);

  const result = {};

  for (const sec of pageDef.sections) {

    const key = sec.key;
    const filter = sec.filter || {};

    const items = allItems.filter(item => {

      if (filter.type && item.type !== filter.type) return false;
      if (filter.category && item.category !== filter.category) return false;

      if (filter.tag) {
        const tags = item.tags || [];
        if (!tags.includes(filter.tag)) return false;
      }

      return true;
    });

    result[key] = items.slice(0, sec.limit || 20);
  }

  return result;
}

// -------------------- SNAPSHOT WRITE --------------------

async function writeDistributionSnapshot(sections) {
  const outputPath = "/tmp/distribution.snapshot.json";

  const snapshot = {
    updatedAt: new Date().toISOString(),
    pages: {
      distribution: {
        sections
      }
    }
  };

  try {
    await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2));
  } catch {}

  return snapshot;
}

// -------------------- HANDLER --------------------

export async function handler(event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  try {

    const qs = event.queryStringParameters || {};
    const key = (qs.key || qs.section || "").trim();

    // 1. load sources
    const searchbank = await loadSearchBankSnapshot();
    const psom = await loadPSOM();

    if (!searchbank) {
      return err(500, "SEARCHBANK_NOT_FOUND");
    }

    if (!psom) {
      return err(500, "PSOM_NOT_FOUND");
    }

    // 2. build sections
    const sections = buildSectionsFromPSOM({
      page: "distribution",
      searchbank,
      psom
    });

    if (!sections || Object.keys(sections).length === 0) {
      return err(500, "EMPTY_SECTIONS");
    }

    // 3. snapshot 생성
    const snapshot = await writeDistributionSnapshot(sections);

    // 4. single section
    if (key) {
      const items = sections[key] || [];
      return ok({ items });
    }

    // 5. full
    return ok({
      status: "ok",
      page: "distribution",
      sections: snapshot.pages.distribution.sections
    });

  } catch (e) {
    return err(500, "FEED_FAIL", {
      message: String(e?.message || e)
    });
  }
}