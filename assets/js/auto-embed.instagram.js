
/*! IGDC Auto-Embed (multi-provider) — keep filename as requested */
(function(){
  const ready = (fn)=> (document.readyState === 'loading') ? document.addEventListener('DOMContentLoaded', fn, {once:true}) : fn();

  const re = {
    insta: /instagram\.com|instagr\.am/i,
    yt: /youtube\.com|youtu\.be/i,
    vimeo: /vimeo\.com/i,
    tiktok: /tiktok\.com/i,
    tw: /twitter\.com|x\.com/i,
    fb: /facebook\.com|fb\.watch/i,
    sc: /soundcloud\.com/i,
    sp: /open\.spotify\.com/i,
    video: /\.(mp4|webm|ogg)(\?.*)?$/i,
    product: /(store\.google\.com|play\.google\.com|smartstore\.naver\.com|shopping\.naver\.com|amazon\.(com|co\.jp)|coupang\.com|gmarket\.co\.kr|11st\.co\.kr|wemakeprice\.com)/i
  };

  async function fetchOEmbed(url){
    const qs = new URLSearchParams({ url });
    const res = await fetch(`/api/oembed?${qs.toString()}`);
    if(!res.ok) return null;
    const data = await res.json();
    return data && data.html ? data.html : null;
  }

  function allCandidates(scope){
    const set = new Set();
    scope.querySelectorAll('a[href], [data-url], .thumb-item a, .card a').forEach(a=>{
      const href = a.getAttribute('href') || a.getAttribute('data-url');
      if(!href) return;
      set.add(a);
    });
    return Array.from(set);
  }

  function markExternal(a){
    a.setAttribute('target','_blank');
    a.setAttribute('rel','noopener noreferrer');
  }

  function ensureHolder(a){
    return a.closest('[data-card], .thumb-item, .card') || a.parentElement;
  }

  function embedVideo(holder, src){
    const box = document.createElement('div');
    box.className = 'embed embed-video';
    box.innerHTML = `<video src="${src}" controls playsinline style="width:100%;height:auto;display:block;background:#000"></video>`;
    holder.insertBefore(box, holder.firstChild);
  }

  ready(async ()=>{
    const list = allCandidates(document.body);
    for(const a of list){
      	      // Page/Section restriction: only Social & Donation(Global)
      if(
        !a.closest(".social-section") &&
        !a.closest('[data-psom-key="donation-global"]')
      ) continue;
	
      const href = a.getAttribute('href') || a.getAttribute('data-url');
      const holder = ensureHolder(a);
      if(!holder || holder.dataset.autoEmbedded === "1") continue;

      if(re.product.test(href)){
        // Product links: force new tab & security
        markExternal(a);
        continue;
      }

      if(re.video.test(href)){
        // Direct video file: embed <video>
        embedVideo(holder, href);
        holder.dataset.autoEmbedded = "1";
        continue;
      }

      if(re.insta.test(href) || re.yt.test(href) || re.vimeo.test(href) || re.tiktok.test(href) || re.tw.test(href) || re.fb.test(href) || re.sp.test(href) || re.sc.test(href)){
        const html = await fetchOEmbed(href);
        if(html){
          const wrap = document.createElement('div');
          wrap.className = 'embed embed-oembed';
          wrap.innerHTML = html;
          holder.insertBefore(wrap, holder.firstChild);
          holder.dataset.autoEmbedded = "1";
        }else{
          // Fallback: open externally
          markExternal(a);
        }
      }
    }
  });
})();
