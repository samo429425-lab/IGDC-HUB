'use strict';
(function(root){
 const channels=['쿠팡','G마켓','옥션','당근','기타'];
 const clean=(v,n)=>{if(typeof v!=='string'||v.length>n||/[\x00-\x1f\x7f]/.test(v)||!v.trim())throw Error('카테고리 입력 형식 확인');return v.trim();};
 function entry(channel,x){if(!channels.includes(channel)||!x||typeof x!=='object'||Array.isArray(x))throw Error('마켓 분류 오류');const code=clean(x.code,80);if(!/^[A-Za-z0-9_.:-]+$/.test(code)||(channel==='쿠팡'&&!/^\d+$/.test(code)))throw Error('카테고리 코드 형식 확인');if(!Array.isArray(x.path)||x.path.length<1||x.path.length>8)throw Error('카테고리 경로 확인');return {code,path:x.path.map(v=>clean(v,120)),source:clean(x.source,500)};}
 function normalize(x={}){if(!x||typeof x!=='object'||Array.isArray(x))throw Error('마켓 분류 형식 오류');const out={};for(const [k,v] of Object.entries(x)){out[k]=entry(k,v);}return out;}
 function catalog(channel,rows,source){if(!Array.isArray(rows)||rows.length>50000)throw Error('분류 목록 최대 50,000개');const seen=new Set();return rows.map(r=>{if(!r||r.leaf!==true)throw Error('최하위 카테고리만 가져오세요');const e=entry(channel,{...r,source});if(seen.has(e.code))throw Error('중복 카테고리 코드');seen.add(e.code);return e;});}
 function change(details,channel,value){if(!channels.includes(channel))throw Error('마켓 분류 오류');const categories=normalize(details?.categories??{});if(value===null)delete categories[channel];else categories[channel]=entry(channel,value);return {...details,categories};}
 function route(p,channel){if(channel==='IGDC')return {code:p.section,path:[p.section],source:'IGDC 내부 섹션'};return normalize(p.details?.categories??{})[channel]||null;}
 const api={channels,entry,normalize,catalog,change,route};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DCenterCategory=api;
})(typeof window==='undefined'?globalThis:window);
