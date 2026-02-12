
/**
 * donation-automap.v7.enterprise.js
 * v7 snapshot compatible automapper
 * - slot_limit from snapshot
 * - bank-first replacement
 * - rank-aware sorting
 * - seed fallback
 */

(async function(){

  const SNAPSHOT_PATHS = [
    "/data/donation.snapshot.json",
    "/netlify/functions/data/donation.snapshot.json"
  ];

  async function loadSnapshot(){
    for(const p of SNAPSHOT_PATHS){
      try{
        const r = await fetch(p, {cache:"no-store"});
        if(r.ok){
          return await r.json();
        }
      }catch(e){}
    }
    throw new Error("Donation snapshot not found");
  }


  function buildSectionIndex(sections){
    const map = {};
    sections.forEach(s=>{
      map[s.psom_key] = s.slot_limit || 40;
    });
    return map;
  }


  function scoreItem(it){

    let score = 0;

    // Bank priority
    if(it.bank_ref && it.bank_ref.record_id){
      score += 1000000;
    }

    // Rank score
    if(it.rank && typeof it.rank.score === "number"){
      score += it.rank.score * 1000;
    }

    // Verification bonus
    if(it.verify && it.verify.status === "verified"){
      score += 500;
    }

    return score;
  }


  function normalizeItems(items){

    return items.map(it=>{
      it.__score = scoreItem(it);
      return it;
    });

  }


  function groupBySection(items){

    const map = {};

    items.forEach(it=>{

      const k = it.psom_key;

      if(!map[k]) map[k] = [];

      map[k].push(it);

    });

    return map;
  }



  function sortSection(items){

    return items.sort((a,b)=>{

      // score desc
      if(b.__score !== a.__score){
        return b.__score - a.__score;
      }

      // updated_at desc
      const ta = a?.meta?.updated_at || "";
      const tb = b?.meta?.updated_at || "";

      return tb.localeCompare(ta);

    });

  }



  function renderCard(it){

    const img = it?.media?.thumb || "/assets/img/placeholder.png";
    const title = it?.org?.name || it?.title || "";
    const url = it?.link?.url || it?.org?.homepage || "#";

    return `
      <a class="donation-card" href="${url}" target="_blank">
        <div class="thumb">
          <img src="${img}" loading="lazy">
        </div>
        <div class="info">
          <div class="title">${title}</div>
        </div>
      </a>
    `;

  }



  function mountSection(key, items, limit){

    const box = document.querySelector(
      `[data-psom-key="${key}"]`
    );

    if(!box) return;

    box.innerHTML = "";

    items.slice(0, limit).forEach(it=>{

      box.insertAdjacentHTML(
        "beforeend",
        renderCard(it)
      );

    });

  }



  async function main(){

    const snapshot = await loadSnapshot();

    if(!snapshot?.sections || !snapshot?.items){
      console.error("Invalid donation snapshot");
      return;
    }

    // slot limits
    const limits = buildSectionIndex(snapshot.sections);

    // prepare items
    const items = normalizeItems(snapshot.items);

    // group
    const groups = groupBySection(items);


    // render
    Object.keys(limits).forEach(key=>{

      const limit = limits[key];

      let list = groups[key] || [];

      list = sortSection(list);

      mountSection(key, list, limit);

    });

  }


  document.addEventListener("DOMContentLoaded", main);

})();
