
/* home-products-automap.v2.stable.js */
/* Existing logic preserved – mobile drag stability improved */

(function(){

const FEED_URL='/.netlify/functions/feed?page=homeproducts';

const MAIN_LIMIT = 100;
const MAIN_BATCH = 7;

const RIGHT_LIMIT = 80;
const RIGHT_BATCH = 5;

function qs(s,r){return (r||document).querySelector(s)}

function norm(it){
return{
title:it.title||it.name||'Item',
thumb:it.thumb||it.image||'',
url:it.url||'#',
priority:typeof it.priority==='number'?it.priority:null
}
}

function buildMain(it){

const a=document.createElement('a');
a.className='shop-card';
a.href=it.url;

if(it.thumb){
a.style.backgroundImage=`url("${it.thumb}")`;
a.style.backgroundSize='cover';
a.style.backgroundPosition='center';
}

const c=document.createElement('div');
c.className='shop-card-cap';
c.textContent=it.title;

a.appendChild(c);

return a;

}

function buildRight(it){

const a=document.createElement('a');
a.className='ad-box';
a.href=it.url;
a.target='_blank';

const img=document.createElement('img');
img.loading='lazy';
img.src=it.thumb;

a.appendChild(img);

return a;

}

function bindRender(t,items){

const isRight=t.isRight;

const limit=isRight?RIGHT_LIMIT:MAIN_LIMIT;
const batch=isRight?RIGHT_BATCH:MAIN_BATCH;

let offset=0;

function render(){

const end=Math.min(offset+batch,limit,items.length);

const frag=document.createDocumentFragment();

for(let i=offset;i<end;i++){

const it=items[i];

frag.appendChild(
isRight?buildRight(it):buildMain(it)
);

}

t.list.appendChild(frag);

offset=end;

}

t.list.innerHTML='';
render();

const sc=t.scroller;

if(!sc)return;

sc.addEventListener('scroll',function(){

if(offset>=items.length||offset>=limit)return;

const nearEnd=isRight
? (sc.scrollTop+sc.clientHeight>=sc.scrollHeight-120)
: (sc.scrollLeft+sc.clientWidth>=sc.scrollWidth-120);

if(nearEnd)render();

},{passive:true});

}

function resolve(psom,key){

const isRight=key.indexOf('home_right_')===0;

if(isRight){

const section=psom.closest('.ad-section');
const scroll=section.querySelector('.ad-scroll')||section;
const list=section.querySelector('.ad-list');

return{isRight:true,scroller:scroll,list:list};

}

const scroller=psom.closest('.shop-scroller');
const row=scroller.querySelector('.shop-row');

return{isRight:false,scroller:scroller,list:row};

}

function renderSlot(key,raw){

const psom=qs(`[data-psom-key="${key}"]`);

if(!psom)return;

const t=resolve(psom,key);

let items=(raw||[]).map(norm);

items.sort((a,b)=>{

const pa=a.priority==null?999999:a.priority;
const pb=b.priority==null?999999:b.priority;

return pa-pb;

});

bindRender(t,items);

}

async function load(){

const r=await fetch(FEED_URL,{cache:'no-store'});
const data=await r.json();

const map={};

(data.sections||[]).forEach(s=>{
map[s.id]=s.items||[]
});

['home_1','home_2','home_3','home_4','home_5']
.forEach(k=>renderSlot(k,map[k]));

['home_right_top','home_right_middle','home_right_bottom']
.forEach(k=>renderSlot(k,map[k]));

}

if(document.readyState==='loading')
document.addEventListener('DOMContentLoaded',load);
else
load();

})();
