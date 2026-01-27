/**
 * Snapshot Engine - FIXED VERSION
 * - Reads data JSONs in /data
 * - Maps by page_id + section_id
 * - Outputs front.snapshot.json
 */
import fs from "fs";
import path from "path";

export async function handler() {
  const dataPath = path.join(process.cwd(), "netlify", "functions", "data");
  const files = fs.readdirSync(dataPath).filter(f => f.endsWith(".json") && f !== "front.snapshot.json");

  const snapshot = {
    meta: {
      snapshot_id: "front.core.v1." + new Date().toISOString(),
      generated_at: new Date().toISOString()
    },
    views: {}
  };

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataPath, file), "utf-8"));
    if (!raw.page_id || !raw.section_id || !raw.items) continue;

    if (!snapshot.views[raw.page_id]) snapshot.views[raw.page_id] = {};
    snapshot.views[raw.page_id][raw.section_id] = raw.items;
  }

  fs.writeFileSync(path.join(dataPath, "front.snapshot.json"), JSON.stringify(snapshot, null, 2));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ok", views: Object.keys(snapshot.views) })
  };
}
