"use strict";
const fs=require("fs"),path=require("path"),os=require("os");
const repo=path.resolve(__dirname,"..");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"igdc-frontmatch-route-"));
const data=path.join(tmp,"data");fs.mkdirSync(data,{recursive:true});
function write(name,doc){fs.writeFileSync(path.join(data,name),JSON.stringify(doc,null,2)+"\n","utf8")}
function sample(id,title){return{id,title,url:"#",thumb:"/assets/img/placeholder.png",placeholder:true}}
const homeSections={};
for(const k of ["home_1","home_2","home_3","home_4","home_5","home_6","home_right_top","home_right_middle","home_right_bottom"])homeSections[k]=[sample("seed-"+k,k+" item 1")];
write("front.snapshot.json",{pages:{home:{sections:homeSections}}});
const distSections={};
for(const k of ["distribution-recommend","distribution-sponsor","distribution-trending","distribution-new","distribution-special","distribution-others","distribution-extra","distribution-right"])distSections[k]=[sample("seed-"+k,k+" item 1")];
write("distribution.snapshot.json",{pages:{distribution:{sections:distSections}}});
write("networkhub-snapshot.json",{items:[sample("seed-network","network item 1")]});
write("tour-snapshot.json",{items:[sample("seed-tour","tour item 1")]});
write("social.snapshot.json",{pages:{social:{sections:{rightPanel:[]}}}});

process.chdir(tmp);
const snapshots=require(path.join(repo,"netlify/functions/snapshot-engine.js"));
const direct=(id,page,section)=>({
 id,title:"REAL "+id,
 productUrl:"https://seller.example.kr/product/"+id,
 externalProductUrl:"https://seller.example.kr/product/"+id,
 affiliateOutboundUrl:"https://stale.example.net/redirect/"+id,
 imageUrl:"https://cdn.example.kr/"+id+".jpg",
 placement:{page,section,country:"KR",region:"NATIONWIDE",slot:1},
 administratorFrontMatchAuthority:{verified:true,publicationStatus:"publish_requested",assignmentId:"as-"+id,page,section,country:"KR",region:"NATIONWIDE"}
});
const rows=[
 direct("home3","home","home_3"),
 direct("homeright","home","home_right_top"),
 direct("extra","distribution","distribution-extra"),
 direct("new","distribution","distribution-new"),
 direct("network","network","network-right")
];
for(const page of ["home","distribution","network"]){
 const bank={items:rows.filter(x=>x.placement.page===page)};
 const report=snapshots.run({targetPage:page,bank,canonicalReleaseId:"test"});
 if(!report||report.ok!==true)throw new Error("snapshot run failed "+page);
}
const front=JSON.parse(fs.readFileSync(path.join(data,"front.snapshot.json"),"utf8"));
const distribution=JSON.parse(fs.readFileSync(path.join(data,"distribution.snapshot.json"),"utf8"));
const network=JSON.parse(fs.readFileSync(path.join(data,"networkhub-snapshot.json"),"utf8"));
function list(doc,page,section){
 if(page==="network")return doc.items||[];
 const v=doc.pages&&doc.pages[page]&&doc.pages[page].sections&&doc.pages[page].sections[section];
 return Array.isArray(v)?v:(v&&Array.isArray(v.slots)?v.slots:[]);
}
function assertCard(doc,page,section,id){
 const card=list(doc,page,section).find(x=>x&&x.id===id);
 if(!card)throw new Error("missing "+page+"|"+section+"|"+id);
 const expected="https://seller.example.kr/product/"+id;
 if(card.url!==expected)throw new Error("wrong url "+id+" "+card.url+" != "+expected);
 if(card.url.includes("stale.example.net"))throw new Error("stale affiliate won "+id);
}
assertCard(front,"home","home_3","home3");
assertCard(front,"home","home_right_top","homeright");
assertCard(distribution,"distribution","distribution-extra","extra");
assertCard(distribution,"distribution","distribution-new","new");
assertCard(network,"network","network-right","network");

const snapshotSource=fs.readFileSync(path.join(repo,"netlify/functions/snapshot-engine.js"),"utf8");
if(!snapshotSource.includes("function canonicalSectionOf(item)"))throw new Error("canonicalSectionOf missing");
if(!snapshotSource.includes("item?.placement?.section"))throw new Error("placement.section route missing");
const repairSource=fs.readFileSync(path.join(repo,"scripts/repair-frontmap-chain.js"),"utf8");
if(!repairSource.includes('patch.label === "canonical URL aliases"'))throw new Error("repair script compatibility missing");
const ipSource=fs.readFileSync(path.join(repo,"netlify/functions/lib/ip-slot-snapshot-publisher.v1.js"),"utf8");
if(!ipSource.includes("administratorFrontMatchAuthority: clone(item.administratorFrontMatchAuthority || null)"))throw new Error("ip authority preservation missing");

console.log("IGDC Front Match routing/direct-url regression OK · home_3 · home_right_top · distribution-extra · distribution-new · network-right");
