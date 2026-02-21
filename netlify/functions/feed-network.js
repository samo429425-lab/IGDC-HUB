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

  // shallow + nested 후보까지 폭넓게 수용
  const url =
    pick(it, ["url","link","href","path"]) ||
    pick(it?.detail, ["url","href","link"]) ||
    pick(it?.extension, ["url","href","link"]);

  const thumb =
    pick(it, ["thumb","thumbnail","image","icon","photo","img","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.media, ["thumb","thumbnail","image","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.media?.preview, ["thumb","thumbnail","image","cover","coverUrl","thumbnailUrl"]) ||
    pick(it?.extension, ["thumb","thumbnail","image","cover","coverUrl","thumbnailUrl"]);

  // url/thumb 둘 다 없으면 오토맵이 쓸 수 없으니 제외
  if (!url || !thumb) return null;

  return {
    id: it.id || it._id || it.trackId || null,
    title: pick(it, ["title","name","label","caption"]) || "",
    url,
    thumb
  };
}

function extractFromSearchBank(bank, channel){
  // ✅ Search-Bank 표준 구조 대응:
  // - bank.index.by_page_section["network.right-network-100"] => [itemId...]
  // - bank.items[] => item objects (bind.page/psom_key로 스캔)
  const out = [];
  const itemsArr = Array.isArray(bank?.items) ? bank.items : [];
  const byId = new Map(itemsArr.map(x => [x?.id, x]));

  // 1) index 우선
  const idxIds = bank?.index?.by_page_section?.["network.right-network-100"];
  if (Array.isArray(idxIds) && idxIds.length){
    for (const id of idxIds){
      const it = byId.get(id);
      if (!it) continue;

      if (channel){
        const ch = (it && (it.channel || it.platform || it.source)) || "";
        if (ch && String(ch).toLowerCase() !== String(channel).toLowerCase()) continue;
      }
      const n = normalize(it);
      if (n) out.push(n);
    }
    return out;
  }

  // 2) index가 비어있으면 bind로 스캔
  for (const it of itemsArr){
    const b = it?.bind || {};
    const isNetworkPage = String(b.page || "").toLowerCase() === "network";
    const isRightKey =
      String(b.psom_key || "").toLowerCase() === "right-network-100" ||
      String(b.section || "").toLowerCase() === "right-network-100" ||
      String(b.route || "").toLowerCase() === "network.right-network-100";

    if (!isNetworkPage || !isRightKey) continue;

    if (channel){
      const ch = (it && (it.channel || it.platform || it.source)) || "";
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
