// IGDC Global Search – FINAL (best practice UI, safe scope)
// search.html 전용 실행

document.addEventListener('DOMContentLoaded',()=>{
  if(!location.pathname.endsWith('/search.html')) return;

  const input=document.getElementById('searchInput');
  const btn=document.getElementById('searchBtn');
  const status=document.getElementById('searchStatus');
  const results=document.getElementById('searchResults');
  if(!input||!btn||!status||!results) return;

  const params=new URLSearchParams(location.search);
  const q0=params.get('q');
  if(q0){input.value=q0;runSearch(q0);}

  btn.onclick=()=>{
    const q=input.value.trim();
    if(!q) return;
    const url=new URL(location.href);
    url.searchParams.set('q',q);
    history.replaceState(null,'',url.toString());
    runSearch(q);
  };
  input.addEventListener('keydown',e=>{if(e.key==='Enter')btn.click();});

  async function runSearch(q){
    status.textContent='Searching…';
    results.innerHTML='';
    try{
      const res=await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
      const json=await res.json();
      const data=json.data||json.baseResult||json;
      const items=data.items||data.results||[];
      if(!items.length){status.textContent='No results.';return;}
      status.textContent=`${items.length} results`;
      items.forEach(render);
    }catch(e){
      console.error(e);
      status.textContent='Search error';
    }
  }

  function detectSource(url){
    const u=(url||'').toLowerCase();
    if(u.includes('wikipedia.org')) return {n:'Wikipedia',i:'📘'};
    if(u.includes('youtube.com')||u.includes('youtu.be')) return {n:'YouTube',i:'▶️'};
    if(u.includes('google.')) return {n:'Google',i:'🔵'};
    if(u.includes('naver.')) return {n:'NAVER',i:'🟢'};
    if(u.includes('bing.')) return {n:'Bing',i:'🟦'};
    return {n:'Web',i:'🌐'};
  }

  function render(it){
    const card=document.createElement('div');
    card.className='card';
    card.onclick=()=>{
      if(it.url){
        location.href=`/search-view.html?u=${encodeURIComponent(it.url)}`;
      }
    };

    if(it.thumbnail||it.image){
      const img=document.createElement('img');
      img.className='thumb';
      img.src=it.thumbnail||it.image;
      img.onerror=()=>img.remove();
      card.appendChild(img);
    }

    const body=document.createElement('div');
    const t=document.createElement('div');
    t.className='title';
    t.textContent=it.title||it.name||'Untitled';

    const d=document.createElement('div');
    d.className='desc';
    d.textContent=it.summary||it.description||it.snippet||'';

    const m=document.createElement('div');
    m.className='meta';
    const src=detectSource(it.url||'');
    const b=document.createElement('span');
    b.className='badge';
    b.textContent=`${src.i} ${src.n}`;
    m.appendChild(b);

    body.appendChild(t);
    if(d.textContent) body.appendChild(d);
    body.appendChild(m);

    card.appendChild(body);
    results.appendChild(card);
  }
});
