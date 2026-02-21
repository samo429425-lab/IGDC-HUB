/**
 * netlify/functions/feed-network.js (v4)
 * ------------------------------------------------------------
 * 목적:
 *  - Search-Bank snapshot -> Network Hub right panel에 필요한 items 제공
 *  - Search-Bank에 네트워크 데이터가 없으면, networkhub-snapshot.json의 items로 폴백
 *
 * IMPORTANT:
 *  - 이 함수는 "항상" items를 돌려줘서(최소 폴백) UI/오토맵이 빈 상태가 되지 않게 함.
 *
 * Query:
 *  - ?limit=100 (1..200)
 */

import fs from "fs/promises";
import path from "path";

const BANK_NAME = "search-bank.snapshot.json";
const NH_NAME   = "networkhub-snapshot.json";

function clampInt(v, d, min, max){
  const n = Number.parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return d;
  return Math.max(min, Math.min(max, n));
}

function corsHeaders(){
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}

function ok(obj){
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(obj) };
}

async function readJsonIfExists(p){
  try{
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw);
  }catch{
    return null;
  }
}

function guessSiteBaseUrl(){
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    ""
  );
}

async function fetchJsonOverHttp(filename){
  const base = guessSiteBaseUrl();
  const urls = [];
  if (base) urls.push(`${base.replace(/\/$/, "")}/data/${filename}`);
  urls.push(`/data/${filename}`);

  for (const u of urls){
    try{
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) continue;
      return await r.json();
    }catch{
      // ignore
    }
  }
  return null;
}

function fsCandidatePaths(filename){
  const cwd = process.cwd();
  const dir = typeof __dirname === "string" ? __dirname : cwd;
  return [
    path.join(cwd, "data", filename),
    path.join(cwd, "netlify", "functions", "data", filename),
    path.join(dir, "data", filename),
    path.join(dir, "..", "data", filename),
    path.join(dir, "..", "..", "data", filename),
    path.join(dir, "functions", "data", filename)
  ];
}

async function loadDataFile(filename){
  for (const p of fsCandidatePaths(filename)){
    const j = await readJsonIfExists(p);
    if (j) return j;
  }
  return await fetchJsonOverHttp(filename);
}

function pick(obj, keys){
  for (const k of keys){
    const v = obj && obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalizeItem(it){
  if (!it || typeof it !== "object") return null;
  const url = pick(it, ["url","link","href","path"]);
  const title = pick(it, ["title","name","label","caption"]) || "";
  const thumb = pick(it, ["thumb","thumbnail","image","icon","img","photo"]) || "";

  // URL은 없을 수 있음 -> UI 안정성 위해 "#"로라도 채움
  return {
    id: it.id || it.trackId || null,
    title,
    url: url || "#",
    thumb,
    section: it.section || null,
    channel: it.channel || null,
    tags: Array.isArray(it.tags) ? it.tags : []
  };
}

function extractNetworkItemsFromBank(bank){
  if (!bank) return [];

  // 1) by_page.network (가장 명시적)
  const bp = bank.by_page && bank.by_page.network;
  if (Array.isArray(bp) && bp.length) return bp;

  // 2) pages.network.sections.*
  const sections = bank?.pages?.network?.sections;
  if (sections && typeof sections === "object"){
    const out = [];
    for (const arr of Object.values(sections)){
      if (Array.isArray(arr)) out.push(...arr);
    }
    if (out.length) return out;
  }

  // 3) flat items scan: section/tag로 networkhub 추정
  const flat = Array.isArray(bank.items) ? bank.items : [];
  const out2 = [];
  for (const it of flat){
    const section = String(it && it.section || "").toLowerCase();
    const tags = Array.isArray(it && it.tags) ? it.tags.map(x=>String(x).toLowerCase()) : [];
    if (section.includes("network")) { out2.push(it); continue; }
    if (tags.includes("networkhub") || tags.includes("right-panel")) { out2.push(it); continue; }
  }
  return out2;
}

export async function handler(event){
  if (event.httpMethod === "OPTIONS"){
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const q = event.queryStringParameters || {};
  const limit = clampInt(q.limit, 100, 1, 200);

  // 1) try Search-Bank
  const bank = await loadDataFile(BANK_NAME);
  const bankItemsRaw = extractNetworkItemsFromBank(bank);
  const bankItems = bankItemsRaw.map(normalizeItem).filter(Boolean).slice(0, limit);

  // 2) fallback: networkhub snapshot
  let fallbackItems = [];
  if (bankItems.length === 0){
    const nh = await loadDataFile(NH_NAME);
    const raw = (nh && Array.isArray(nh.items)) ? nh.items : [];
    fallbackItems = raw.map(normalizeItem).filter(Boolean).slice(0, limit);
  }

  const items = bankItems.length ? bankItems : fallbackItems;

  return ok({
    status: "ok",
    page: "networkhub",
    source: bankItems.length ? "search-bank.snapshot.json" : "networkhub-snapshot.json",
    generated: new Date().toISOString(),
    count: items.length,
    items
  });
}
