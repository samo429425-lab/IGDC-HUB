
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
    // dynamic feed (Netlify function)
    "/.netlify/functions/donation-feed",
    "/netlify/functions/donation-feed",
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
      map[s.psom_key] = s.slot_limit || 80;
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

    const img = safeUrl(it?.media?.thumb) || "/assets/img/placeholder.png";
    const title = escHtml(it?.org?.name || it?.title || "");
    const meta = escHtml(
      it?.org?.country ||
      it?.donation?.currency ||
      it?.category ||
      ""
    );
    const summary = escHtml(it?.summary || it?.org?.legal_name || "");
    const url = safeUrl(it?.donation?.checkout_url) || safeUrl(it?.link?.url) || safeUrl(it?.org?.homepage) || "";
    const uid = escAttr(it?.uid || it?.id || "");

    // IMPORTANT:
    // - keep `.card` structure to match donation.html dummy cards + CSS
    // - keep `.donation-card` class so dummy generator can detect real data
    return `
      <div class="card donation-card" data-uid="${uid}" data-url="${escAttr(url)}" role="link" tabindex="0" aria-label="${title}">
        <div class="thumb">${img ? `<img src="${img}" loading="lazy" alt="">` : ""}</div>
        <div class="card-body">
          <div class="card-title">${title || "-"}</div>
          <div class="card-meta">${meta || "-"}</div>
          <div class="card-preview">${summary || ""}</div>
        </div>
      </div>
    `;

  }



  function mountSection(key, items, limit){

    const box = document.querySelector(`[data-psom-key="${key}"]`);
    if(!box) return;

    // Prefer HTML declared count if present (keeps UI consistent with each row)
    const row = box.closest?.('.feed-row');
    const htmlCount = row ? Number(row.dataset.count || 0) : 0;
    const finalLimit = clampLimit(htmlCount || limit || 80);

    // Replace placeholders in one shot
    box.innerHTML = "";

    const slice = items.slice(0, finalLimit);
    for(const it of slice){
      box.insertAdjacentHTML("beforeend", renderCard(it));
    }

  }

  function clampLimit(n){
    const x = Number(n);
    if(!Number.isFinite(x) || x <= 0) return 80;
    // hard guard (prevents accidental huge DOM)
    return Math.max(1, Math.min(200, Math.floor(x)));
  }

  function escHtml(s){
    const str = String(s ?? "");
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escAttr(s){
    // attribute-safe (no quotes/newlines)
    return escHtml(String(s ?? "")).replace(/\s+/g, " ").trim();
  }

  function safeUrl(u){
    const s = String(u ?? "").trim();
    if(!s) return "";
    if(/^javascript:/i.test(s)) return "";
    return s;
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

  // Click delegation: whole card is clickable
  function bindClicks(){
    document.addEventListener('click', (e)=>{
      const card = e.target?.closest?.('.donation-card');
      if(!card) return;
      const url = card.getAttribute('data-url');
      if(url){
        window.open(url, '_blank', 'noopener');
      }
    });
    document.addEventListener('keydown', (e)=>{
      if(e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target?.closest?.('.donation-card');
      if(!card) return;
      e.preventDefault();
      const url = card.getAttribute('data-url');
      if(url){
        window.open(url, '_blank', 'noopener');
      }
    });
  }

  function boot(){
    bindClicks();
    main();

    // Safety: if other scripts recreate placeholders after first render, rerun once.
    let reran = false;
    const mo = new MutationObserver(()=>{
      if(reran) return;
      const anyTrack = document.querySelector('[data-psom-key].row-track');
      if(anyTrack && anyTrack.querySelector('.card') && !anyTrack.querySelector('.donation-card')){
        reran = true;
        main();
        try{ mo.disconnect(); }catch(_e){}
      }
    });
    try{ mo.observe(document.documentElement, {childList:true, subtree:true}); }catch(_e){}
  }

  document.addEventListener("DOMContentLoaded", boot);

})();
