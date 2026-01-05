/* =========================================================
 * MARU GLOBAL COUNTRY MODAL (v2.0 – ELITE)
 * 2차 팝업: 권역 → 국가 심층 분석
 * - Voice Insight Engine 연동
 * - 글로벌 무역·경제 심층 브리핑
 * ========================================================= */

(function () {
  'use strict';

  const API_ENDPOINT = '/api/ai-diagnose';

  const REGION_COUNTRIES = {
    asia:['대한민국','일본','중국','인도','태국','베트남','인도네시아','기타'],
    europe:['독일','프랑스','영국','이탈리아','스페인','기타'],
    north_america:['미국','캐나다','멕시코','기타'],
    south_america:['브라질','아르헨티나','칠레','기타'],
    middle_east:['사우디아라비아','UAE','이스라엘','기타'],
    africa:['남아공','나이지리아','이집트','기타']
  };

  let backdrop=null, modal=null;

  function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h)e.innerHTML=h;return e;}
  function close(){if(modal)modal.remove();if(backdrop)backdrop.remove();modal=backdrop=null;}

  async function fetchCountry(region){
    try{
      const r=await fetch(API_ENDPOINT,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        cache:'no-store',
        body:JSON.stringify({
          level:'country',
          quality:'elite',
          region,
          countries:REGION_COUNTRIES[region]||[]
        })
      });
      return await r.json();
    }catch{return{};}
  }

  function injectStyle(){
    if(document.getElementById('maru-country-style'))return;
    const s=el('style');
    s.id='maru-country-style';
    s.textContent=`
      .maru-country-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000}
      .maru-country-modal{position:fixed;inset:8%;background:#fff;border-radius:14px;
        z-index:100001;display:flex;flex-direction:column}
      .maru-country-header{padding:14px 20px;border-bottom:1px solid #eee;
        display:flex;justify-content:space-between}
      .maru-country-body{padding:20px;overflow:auto;
        display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
      .maru-country-card{border:1px solid #ddd;border-radius:12px;padding:14px}
    `;
    document.head.appendChild(s);
  }

  function card(name,d={}){
    return `
      <div class="maru-country-card">
        <h4>${name}</h4>
        <p><strong>경제·무역</strong>: ${d.flow||'분석 중'}</p>
        <p><strong>산업 영향</strong>: ${d.industry||'관찰 중'}</p>
        <p><strong>리스크</strong>: ${d.risk||'없음'}</p>
        <p><em>${d.comment||''}</em></p>
      </div>`;
  }

  async function open(region){
    if(modal)return;
    injectStyle();

    backdrop=el('div','maru-country-backdrop');
    backdrop.onclick=close;

    modal=el('div','maru-country-modal');

    const header=el('div','maru-country-header',`
      <strong>🌐 MARU GLOBAL INSIGHT — 국가 심층</strong>
      <div>
        <button id="maruCountryBrief">🔊 요약</button>
        <button id="maruCountryDeep">🧠 심화</button>
        <button id="maruCountryClose">닫기</button>
      </div>
    `);

    const body=el('div','maru-country-body','<p>국가별 글로벌 경제 분석 중…</p>');

    modal.appendChild(header);
    modal.appendChild(body);
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    document.getElementById('maruCountryClose').onclick=close;
    document.getElementById('maruCountryBrief').onclick=()=>{
      MaruVoice.play({level:'country',region,depth:1});
    };
    document.getElementById('maruCountryDeep').onclick=()=>{
      MaruVoice.play({level:'country',region,depth:2});
    };

    const data=await fetchCountry(region);
    const cd=data?.countries||{};
    body.innerHTML=(REGION_COUNTRIES[region]||[]).map(c=>card(c,cd[c])).join('');
  }

  window.openMaruGlobalCountryModal=open;
})();