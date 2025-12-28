
(function(){
  const KEYS = ["home_right_top","home_right_middle","home_right_bottom"];

  fetch('/.netlify/functions/feed')
    .then(r=>r.json())
    .then(data=>{
      const map = {};
      (data.sections||[]).forEach(s=>map[s.id]=s.items||[]);
      KEYS.forEach(k=>{
        const host=document.querySelector('[data-psom-key="'+k+'"]');
        if(!host) return;
        const list = map[k]||[];
        if(!list.length){
          host.textContent="콘텐츠 준비 중입니다.";
          return;
        }
        host.innerHTML="";
        list.forEach(it=>{
          const a=document.createElement("a");
          a.className="ad-box";
          a.href=it.url||"#";
          const d=document.createElement("div");
          d.className="thumb";
          if(it.image) d.style.backgroundImage=`url(${it.image})`;
          a.appendChild(d);
          host.appendChild(a);
        });
      });
    });
})();
