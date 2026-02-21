/**
 * feed-network.v5.js (NETLIFY FUNCTION)
 *
 * 역할(정이사장님 정의대로):
 * - Search-Bank Snapshot → NetworkHub snapshot 역할로 'items'를 구성해서 전달
 * - Search-Bank에서 못 찾으면 NetworkHub Snapshot의 items를 그대로 fallback 전달
 * - 오토맵이 바로 꽂을 수 있도록: items[]에 url + thumb 필드가 반드시 채워지도록 정규화
 *
 * Endpoint:
 * - /.netlify/functions/feed-network?limit=100&channel=web
 * Response:
 * - { status:"ok", items:[...] }
 */

"use strict";

// === NetworkHub feed target (PSOM bind) ===
const TARGET_PAGE = "network";
const TARGET_PSOM_KEY = "right-network-100";


const fs = require("fs");
const path = require("path");

// Netlify functions runs in /functions. Data is usually in /data at site root.
// We attempt both relative and absolute-ish paths by traversing up.
function tryReadJSON(rel){
  const tries = [
    path.join(__dirname, rel),
    path.join(__dirname, "..", rel),
    path.join(__dirname, "..", "..", rel),
    path.join(__dirname, "..", "..", "..", rel),
  ];
  for (const p of tries){
    try{
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
    }catch(e){}
  }
  return null;
}

function pick(obj, keys){
  for (const k of keys){
    const v = obj && obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalize(it){
  if (!it || typeof it !== "object") return null;

  // url candidates (top-level + common nested)
  const url =
    pick(it, ["url","link","href","path"]) ||
    pick(it?.detail, ["url","link","href","path"]) ||
    pick(it?.media, ["url","link","href","path"]) ||
    pick(it?.extension, ["url","link","href","path"]);

  // thumb candidates (top-level + common nested)
  const thumb =
    pick(it, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.media, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.media?.preview, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl","url"]) ||
    pick(it?.preview, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl","url"]);

  if (!url || !thumb) return null;

  return {
    id: it.id || it._id || it.trackId || null,
    title: pick(it, ["title","name","label","caption"]) || "",
    url,
    thumb
  };
}

function extractFromSearchBank(bank, channel){
  // 우선순위:
  // 0) index.by_page_section["network.right-network-100"]가 존재하고 비어있지 않으면 그 ID들만 사용
  // 1) 그렇지 않으면 bank.items / bank.network.items / bank.data.items / pages.network.sections["right-network-100"] 풀에서 스캔
  // 2) channel 필터는 "있을 때만" 적용 (없으면 통과)
  // 3) TARGET_PAGE/TARGET_PSOM_KEY로 bind가 붙어있으면 그것만 우선 통과

  const out = [];

  // --- 0) index route ---
  const routeKey = `${TARGET_PAGE}.${TARGET_PSOM_KEY}`;
  const idList = bank?.index?.by_page_section?.[routeKey];
  if (Array.isArray(idList) && idList.length){
    const map = new Map();
    if (Array.isArray(bank?.items)){
      for (const it of bank.items) if (it && it.id) map.set(it.id, it);
    }
    for (const id of idList){
      const it = map.get(id);
      if (!it) continue;

      if (channel){
        const ch = (it && (it.channel || it.platform || it.source?.platform || it.source)) || "";
        if (ch && String(ch).toLowerCase() !== String(channel).toLowerCase()) continue;
      }

      const n = normalize(it);
      if (n) out.push(n);
    }
    return out;
  }

  // --- 1) pools scan ---
  const pools = [];
  if (Array.isArray(bank?.items)) pools.push(bank.items);
  if (Array.isArray(bank?.network?.items)) pools.push(bank.network.items);
  if (Array.isArray(bank?.data?.items)) pools.push(bank.data.items);

  const sec = bank?.pages?.network?.sections?.[TARGET_PSOM_KEY];
  if (Array.isArray(sec)) pools.push(sec);

  for (const arr of pools){
    for (const it of arr){
      if (!it || typeof it !== "object") continue;

      // bind 기반 page/psom_key 필터 (있을 때는 강제)
      const b = it.bind || it.route || it.psom || null;
      const bindPage = it?.bind?.page || it?.bind?.page_id || "";
      const bindKey  = it?.bind?.psom_key || it?.bind?.psomKey || it?.bind?.section || "";
      if (bindPage && String(bindPage) !== TARGET_PAGE) continue;
      if (bindKey  && String(bindKey)  !== TARGET_PSOM_KEY) continue;

      if (channel){
        const ch = (it.channel || it.platform || it.source?.platform || it.source) || "";
        if (ch && String(ch).toLowerCase() !== String(channel).toLowerCase()) continue;
      }

      const n = normalize(it);
      if (n) out.push(n);
    }
  }
  return out;
}

exports.handler = async function(event){
  try{
    const q = event.queryStringParameters || {};
    const limit = Math.max(1, Math.min(1000, parseInt(q.limit || "100", 10) || 100));
    const channel = (q.channel || "").trim(); // optional

    const searchBank = tryReadJSON("data/search-bank.snapshot.json") || {};
    let items = extractFromSearchBank(searchBank, channel).slice(0, limit);

    // fallback: networkhub snapshot items
    if (!items.length){
      const nh = tryReadJSON("data/networkhub-snapshot.json") || tryReadJSON("networkhub-snapshot.json") || {};
      const raw = Array.isArray(nh.items) ? nh.items : [];
      items = raw.map(normalize).filter(Boolean).slice(0, limit);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        status: "ok",
        generated: new Date().toISOString(),
        items
      })
    };
  } catch (e){
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ status:"error", error: String(e && e.message || e) })
    };
  }
};
