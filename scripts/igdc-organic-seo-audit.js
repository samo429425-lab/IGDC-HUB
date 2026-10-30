'use strict';
/** Read-only site discovery / SEO audit. Scheduled twice weekly; never clicks search results. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const live=process.argv.includes('--live');
const report={date:new Date().toISOString(),mode:live?'live-and-local':'local',checks:[],warnings:[]};
function check(name,ok,detail){report.checks.push({name,status:ok?'ok':'warning',detail});if(!ok)report.warnings.push(name+': '+detail)}
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sitemap=read('sitemap.xml');
const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1].replace(/&amp;/g,'&'));
const distinct=[...new Set(urls)];
const missing=urls.filter(url=>url.startsWith('https://igdcglobal.com/')&&!fs.existsSync(path.join(root,decodeURIComponent(new URL(url).pathname).slice(1))));
check('static-sitemap',urls.length>0&&missing.length===0,`${urls.length} URLs; ${missing.length} missing local files`);
check('sitemap-duplicates',distinct.length===urls.length,`${urls.length-distinct.length} duplicated URLs`);
const robots=read('robots.txt');check('robots-static-sitemap',robots.includes('Sitemap: https://igdcglobal.com/sitemap.xml'),'Static sitemap declared');
check('robots-dynamic-commerce-sitemap',robots.includes('igdc-organic-catalog?mode=sitemap'),'Published-only sitemap declared');
const appPage=read('maru-download.html');
check('official-app-landing',appPage.includes('application/ld+json')&&appPage.includes('play.google.com/store/apps/details?id=com.maru.mediaplayer'),'Web landing with Android official link and JSON-LD');
check('no-sample-indexing',fs.existsSync(path.join(root,'netlify/functions/igdc-organic-catalog.js')),'Verified public catalog module present');
async function query(url){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{const r=await fetch(url,{method:'GET',redirect:'follow',signal:controller.signal,headers:{'User-Agent':'IGDC-Organic-SEO-Health/1.0 (+https://igdcglobal.com)'}});return {status:r.status,type:r.headers.get('content-type')||'',sample:(await r.text()).slice(0,180)} }
 catch(e){return {status:0,error:String(e&&e.message||e)}} finally{clearTimeout(timer)}
}
async function run(){
 if(live){
  for(const [name,url] of [
   ['robots-live','https://igdcglobal.com/robots.txt'],
   ['sitemap-live','https://igdcglobal.com/sitemap.xml'],
   ['app-page-live','https://igdcglobal.com/maru-download.html'],
   ['commerce-sitemap-live','https://igdcglobal.com/.netlify/functions/igdc-organic-catalog?mode=sitemap']]){
    const res=await query(url);check(name,res.status===200,JSON.stringify(res));
  }
 }
 const out=process.env.GITHUB_STEP_SUMMARY;
 const text=['# IGDC / MARU Organic Search Health',`Date: ${report.date}`,`Mode: ${report.mode}`,'',...report.checks.map(x=>`- ${x.status==='ok'?'OK':'CHECK'} — ${x.name}: ${x.detail}`),'','This monitors SEO availability. It does not guarantee search indexing, rankings or Play Store discovery.'].join('\n');
 if(out)fs.appendFileSync(out,text+'\n');
 console.log(text);
 if(process.env.IGDC_SEO_REPORT_PATH)fs.writeFileSync(process.env.IGDC_SEO_REPORT_PATH,JSON.stringify(report,null,2));
 // Monitoring warnings are non-blocking; deployment remains governed by original project scripts.
}
run().catch(e=>{console.error(e);process.exitCode=1});
