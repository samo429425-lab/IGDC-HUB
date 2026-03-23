"use strict";

/*
MARU DONATION FEED ENGINE v2.0 (FULL)
--------------------------------------------------
역할
- search-bank → donation snapshot 연결
- PSOM 기반 section 매핑
- 링크형 / 콘텐츠형 분기
- bank-first replace 지원
--------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const BANK_PATH = path.join(ROOT, "search-bank.snapshot.json");
const SNAPSHOT_PATH = path.join(ROOT, "donation.snapshot.json");
const PSOM_PATH = path.join(ROOT, "psom.json");

function readJson(p){
  try{
    if(!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p,"utf8"));
  }catch(e){
    return null;
  }
}

function writeJson(p,data){
  fs.writeFileSync(p, JSON.stringify(data,null,2));
}

/* --------------------------------------------------
PSOM
-------------------------------------------------- */

function loadPSOM(){
  const psom = readJson(PSOM_PATH) || {};
  return psom;
}

function resolveSection(item, psom){

  // 1순위: item 직접 지정
  if(item.psom_key) return item.psom_key;

  // 2순위: type 기반
  if(item.type === "donation-news") return "donation-news";

  // 3순위: 기본
  return "donation-global";
}

/* --------------------------------------------------
FILTER
-------------------------------------------------- */

function isDonation(item){
  if(!item) return false;

  if(item.type === "donation") return true;
  if(item.channel === "donation") return true;
  if(item.category && item.category.includes("donation")) return true;

  return false;
}

/* --------------------------------------------------
LINK vs CONTENT
-------------------------------------------------- */

function normalizeItem(item){

  const isNews = (
    item.type === "donation-news" ||
    (item.tags && item.tags.includes("news"))
  );

  // 👉 콘텐츠형
  if(isNews){
    return {
      id: item.id,
      title: item.title || "",
      summary: item.summary || "",
      content: item.content || "",
      url: item.url || "#",
      thumb: item.thumb || item.image || "/assets/img/placeholder.png",
      type: "content",
      priority: item.priority || 0
    };
  }

  // 👉 링크형 (기본)
  return {
    id: item.id,
    title: item.title || "",
    summary: item.summary || "",
    url: (
      item.url ||
      item.org?.homepage ||
      item.donation?.checkout_url ||
      "#"
    ),
    thumb: item.thumb || item.image || "/assets/img/placeholder.png",
    type: "link",
    target: "_blank",
    priority: item.priority || 0
  };
}

/* --------------------------------------------------
MERGE (REPLACE 방식)
-------------------------------------------------- */

function replaceSection(snapshot, sectionKey, items){

  if(!snapshot.sections) snapshot.sections = {};

  // 👉 기존 seed 완전 교체
  snapshot.sections[sectionKey] = [];

  const max = 100;

  let count = 0;

  for(const item of items){

    if(count >= max) break;

    snapshot.sections[sectionKey].push(item);
    count++;
  }

}

/* --------------------------------------------------
MAIN
-------------------------------------------------- */

function run(){

  const bank = readJson(BANK_PATH) || { items:[] };
  const snapshot = readJson(SNAPSHOT_PATH) || { sections:{} };
  const psom = loadPSOM();

  const donationItems = (bank.items || []).filter(isDonation);

  const sectionMap = {};

  for(const raw of donationItems){

    const section = resolveSection(raw, psom);

    if(!sectionMap[section]) sectionMap[section] = [];

    const item = normalizeItem(raw);

    sectionMap[section].push(item);
  }

  // 👉 section별 replace 적용
  for(const key of Object.keys(sectionMap)){
    replaceSection(snapshot, key, sectionMap[key]);
  }

  writeJson(SNAPSHOT_PATH, snapshot);

  return {
    status: "ok",
    count: donationItems.length,
    sections: Object.keys(sectionMap)
  };
}

/* --------------------------------------------------
EXPORT
-------------------------------------------------- */

module.exports = {
  run
};