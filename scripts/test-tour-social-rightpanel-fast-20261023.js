'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
function filesFor(kind){const out=[kind+'.html'];for(const dir of fs.readdirSync(ROOT,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name)){const p=dir+'/'+kind+'_'+dir+'.html';if(fs.existsSync(path.join(ROOT,p)))out.push(p);}assert.equal(out.length,30);return out;}
for(const p of filesFor('socialnetwork')){const html=fs.readFileSync(path.join(ROOT,p),'utf8');assert(html.includes('function getCount(){ return 6; }'),p);const pos=html.indexOf('function getCount(){ return 6; }'),r=html.slice(pos,pos+2000);assert(r.includes('Resizing never deletes live items'),p);assert(!r.includes("window.dispatchEvent(new Event('igdc:rightpanel:refresh'))"),p);assert(html.includes('socialnetwork-automap-v3.js?v=20261023-social-right-contained-v1'),p);}
for(const p of filesFor('tour')){const html=fs.readFileSync(path.join(ROOT,p),'utf8');assert(html.includes('const DUMMY_CNT  = 6;'),p);assert(html.includes('/assets/js/tour-automap.js?v=20261023-rightpanel-fast-v1'),p);}
const code=fs.readFileSync(path.join(ROOT,'assets/js/tour-automap.js'),'utf8').split('/* ------------------------------------------------------------------')[0];assert(!code.includes('deferFramePreflight(items);'));
function el(tag){return {tagName:tag.toUpperCase(),children:[],dataset:{},style:{},attrs:{},classList:{add(){},remove(){}},appendChild(child){if(child.tagName==='FRAGMENT')this.children.push(...child.children);else this.children.push(child);return child;},addEventListener(name,fn){(this.listeners??={})[name]=fn;},setAttribute(name,val){this.attrs[name]=val;},removeAttribute(name){delete this.attrs[name]},get lastElementChild(){return this.children.at(-1)},set innerHTML(v){this.children=[];},get innerHTML(){return ''}};}
async function scenario(desktop){const rail=el('div'),docEvents={},winEvents={},calls=[],opened=[];
 const document={readyState:'loading',getElementById:id=>id==='rightAutoPanel'?rail:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:el,createDocumentFragment:()=>el('fragment'),addEventListener:(name,fn)=>{docEvents[name]=fn},head:el('head'),documentElement:el('html')};
 const window={location:{origin:'https://igdcglobal.com'},matchMedia:q=>({matches:desktop?q.includes('min-width:1025px'):q.includes('max-width:1024px')}),addEventListener:(name,fn)=>{winEvents[name]=fn},IGDCContainedViewer:{version:10,open(url){opened.push(url);return Promise.resolve(true)}}};
 const items=Array.from({length:25},(_,i)=>({id:'tour-'+i,title:'Offer '+i,thumb:'https://img.igdc.test/'+i+'.jpg',productUrl:'https://www.waug.com/ko/products/activity-'+(104520+i)}));
 const fetch=async url=>{calls.push(url);return {ok:true,json:async()=>({items,slots:[]})}};
 vm.runInNewContext(code,{window,document,fetch,URL,console,Promise,setTimeout:fn=>fn(),navigator:{},sessionStorage:{getItem:()=>null,setItem:()=>{}},Map,Set,WeakMap});
 docEvents.DOMContentLoaded();winEvents.load();for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,['/data/tour-snapshot.json']);assert.equal(rail.children.length,12);const link=rail.children[0].children[0];assert.equal(link.href,'https://www.waug.com/ko/products/activity-104520');
 const thumbs=rail.children.map(x=>x.children[0].children[0]);assert.equal(thumbs[0].loading,desktop?'eager':'lazy');assert.equal(thumbs[5].loading,'lazy');
 let stopped=false;link.listeners.click({preventDefault(){stopped=true}});await new Promise(r=>setImmediate(r));assert(stopped);assert.deepEqual(opened,['https://www.waug.com/ko/products/activity-104520']);
}
function socialResizeScenario(){
 const html=fs.readFileSync(path.join(ROOT,'socialnetwork.html'),'utf8');
 const start=html.lastIndexOf('<script>',html.indexOf('function getCount(){ return 6; }'))+8;
 const end=html.indexOf('</script>',start);
 const code=html.slice(start,end);
 const panel=el('div'),mobile=el('div'),events={},dispatched=[];
 panel.querySelector=selector=>selector.includes('data-dummy')?panel.children.find(x=>x.dataset.dummy==='1')||null:null;
 mobile.querySelector=selector=>selector.includes('data-dummy')?mobile.children.find(x=>x.dataset.dummy==='1')||null:null;
 const document={getElementById:id=>id==='rightAutoPanel'?panel:id==='rpMobileGrid'?mobile:null,createElement:el};
 const window={matchMedia:()=>({matches:false}),addEventListener:(type,fn)=>{events[type]=fn},dispatchEvent:e=>dispatched.push(e.type)};
 vm.runInNewContext(code,{window,document,setTimeout:fn=>fn(),clearTimeout:()=>{},Event:function(type){this.type=type}});
 assert.equal(panel.children.length,6,'social initial dummy reduced from 100 to 6');
 window.__IGDC_RIGHTPANEL_RENDER([{id:'product-1',title:'Item one',url:'https://seller.test/products/one'}]);
 assert.equal(panel.children.length,1);
 const before=panel.children[0];
 events.resize();
 assert.strictEqual(panel.children[0],before,'social resize must keep the same DOM product');
 assert.deepEqual(dispatched,[],'social resize must not refresh snapshot');
}
socialResizeScenario();
(async()=>{await scenario(true);await scenario(false);console.log('PASS: localized HTML 60, Tour snapshot dedup, render batch, eager/lazy, original product URL and contained viewer');})().catch(error=>{console.error(error);process.exitCode=1});
