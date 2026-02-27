import fs from "fs/promises";
import path from "path";

const SNAPSHOT = "networkhub-snapshot.json";

function cors() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  };
}

function ok(data) {
  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify(data)
  };
}

async function readJSON(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

function snapshotPaths() {
  const cwd = process.cwd();
  const dir = __dirname;

  return [
    path.join(cwd, "data", SNAPSHOT),
    path.join(dir, "data", SNAPSHOT),
    path.join(dir, "..", "data", SNAPSHOT),
    path.join(dir, "..", "..", "data", SNAPSHOT)
  ];
}

async function loadSnapshot() {
  for (const p of snapshotPaths()) {
    const j = await readJSON(p);
    if (j) return j;
  }
  return null;
}

function makeDummyItems(limit = 100) {
  const arr = [];
  for (let i = 1; i <= limit; i++) {
    arr.push({
      id: `dummy-${i}`,
      title: `Network Sample ${i}`,
      thumbnail: "/assets/img/placeholder.png",
      link: "#"
    });
  }
  return arr;
}

export async function handler() {
  const snap = await loadSnapshot();

  let items = [];

  if (snap?.sections?.rightpanel?.length) {
    items = snap.sections.rightpanel;
  }

  // 🔥 핵심: 데이터 없으면 샘플 생성
  if (!items.length) {
    items = makeDummyItems(100);
  }

  return ok({ items });
}