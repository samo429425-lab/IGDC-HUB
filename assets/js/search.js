// MARU SEARCH – matched (with SOURCE + ICONS)
// search.html 전용 / 기존 maru-search 파이프라인 유지

document.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.endsWith('/search.html')) return;

  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const results = document.getElementById('searchResults');
  if (!input || !btn || !status || !results) return;

  injectStyleOnce();

  const params = new URLSearchParams(location.search);
  const q0 = params.get('q');
  if (q0) { input.value = q0; runSearch(q0); }

  btn.onclick = () => {
    const q = input.value.trim();
    if (!q) return;
    const url = new URL(location.href);
    url.searchParams.set('q', q);
    history.replaceState(null, '', url.toString());
    runSearch(q);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

  function injectStyleOnce(){
    const id='maru-search-style-icons';
    if(document.getElementById(id))return;
    const s=document.createElement('style');
    s.id=id;
    s.textContent=`
      .result-card{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;
        box-shadow:0 4px 10px rgba(0,0,0,.06);cursor:pointer;display:flex;gap:14px}
      .result-thumb{width:120px;height:90px;border-radius:10px;object-fit:cover;flex-shrink:0}
      .result-title{font-size:17px;font-weight:700;color:#1f2937;margin-bottom:6px}
      .result-desc{font-size:14px;color:#4b5563;line-height:1.4}
      .result-meta{margin-top:8px;display:flex;align-items:center;gap:8px;font-size:12px;color:#6b7280}
      .src-badge{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;
        border-radius:999px;background:#f1f5f9}
      .src-icon{width:14px;height:14px}
    `;
    document.head.appendChild(s);
  }

  async function runSearch(q){
    status.textContent='검색 중...';
    results.innerHTML='';
    try{
      const res=await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
      const json=await res.json();
      const data=json.data||json.baseResult||json;
      const items=data.items||data.results||[];
      if(!items.length){status.textContent='검색 결과가 없습니다.';return;}
      status.textContent=`${items.length}개 결과`;
      items.forEach(renderItem);
    }catch(e){console.error(e);status.textContent='검색 오류';}
  }

  function detectSource(it){
    const s=(it.source||it.engine||it.provider||it.site||'').toLowerCase();
    if(s.includes('naver')) return {name:'NAVER', icon:'🟢'};
    if(s.includes('google')) return {name:'Google', icon:'🔵'};
    if(s.includes('youtube')||s.includes('yt')) return {name:'YouTube', icon:'▶️'};
    if(s.includes('bing')||s.includes('ms')) return {name:'Bing', icon:'🟦'};
    if(s.includes('wiki')) return {name:'Wikipedia', icon:'📘'};
    if(s.includes('news')) return {name:'News', icon:'📰'};
    return {name:(it.source||'Web'), icon:'🌐'};
  }

  function renderItem(it){
    const card=document.createElement('div');
    card.className='result-card';
    card.onclick=()=>{ if(it.url) location.href=`/search-view.html?u=${encodeURIComponent(it.url)}`; };

    if(it.thumbnail||it.image){
      const img=document.createElement('img');
      img.className='result-thumb';
      img.src=it.thumbnail||it.image;
      img.onerror=()=>img.remove();
      card.appendChild(img);
    }

    const body=document.createElement('div');
    const title=document.createElement('div');
    title.className='result-title';
    title.textContent=it.title||it.name||'제목 없음';

    const desc=document.createElement('div');
    desc.className='result-desc';
    desc.textContent=it.summary||it.description||it.snippet||'';

    const meta=document.createElement('div');
    meta.className='result-meta';
    const src=detectSource(it);
    const badge=document.createElement('span');
    badge.className='src-badge';
    badge.innerHTML=`<span class="src-icon">${src.icon}</span><span>${src.name}</span>`;
    meta.appendChild(badge);

    body.appendChild(title);
    if(desc.textContent) body.appendChild(desc);
    body.appendChild(meta);

    card.appendChild(body);
    results.appendChild(card);
  }
});
