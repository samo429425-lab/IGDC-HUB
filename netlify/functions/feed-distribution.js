// feed-distribution.js (DISTRIBUTION SNAPSHOT ONLY - FIXED)
// --------------------------------------------------
// Source: /data/distribution.snapshot.json ONLY
// No search-bank, No mixed data
// --------------------------------------------------

import fs from "fs/promises";
import path from "path";

const DATA_ROOT = path.join(process.cwd(), "data");
const SNAPSHOT_FILE = path.join(DATA_ROOT, "distribution.snapshot.json");

async function readSnapshot() {
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function extractSections(snapshot) {
  if (
    !snapshot ||
    !snapshot.pages ||
    !snapshot.pages.distribution ||
    !snapshot.pages.distribution.sections
  ) {
    return null;
  }

  return snapshot.pages.distribution.sections;
}

export async function handler(event) {
  const qs = event.queryStringParameters || {};
  const key = qs.key || qs.section;

  const snapshot = await readSnapshot();

  if (!snapshot) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "SNAPSHOT_NOT_FOUND" })
    };
  }

  const sections = extractSections(snapshot);

  if (!sections) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "INVALID_SNAPSHOT_STRUCTURE" })
    };
  }

  // Section specific request
  if (key) {
    const items = sections[key];

    if (!Array.isArray(items) || !items.length) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "SECTION_EMPTY" })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items })
    };
  }

  // All sections
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections })
  };
}
