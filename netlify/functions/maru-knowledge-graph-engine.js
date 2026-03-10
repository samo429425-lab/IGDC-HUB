"use strict";

/*
MARU Knowledge Graph Engine v90
Planetary Semantic Knowledge Graph

Upgrade path
v60 -> v70 -> v80 -> v90

Design goals
- backward compatible
- security reinforced
- semantic graph expansion
- temporal graph
- cross language entity fusion
*/

const VERSION="maru-knowledge-graph-v90";

/* --------------------------------------------------
UTIL
-------------------------------------------------- */

function sanitize(v){
return String(v||"")
.replace(/[<>;$`]/g,"")
.slice(0,300)
.toLowerCase();
}

function hash(str){
let h=0;
for(let i=0;i<str.length;i++){
h=(h<<5)-h+str.charCodeAt(i);
h|=0;
}
return Math.abs(h);
}

/* --------------------------------------------------
ENTITY STORES
-------------------------------------------------- */

const ENTITY_STORE=new Map();
const RELATION_STORE=new Map();
const REVERSE_RELATION_STORE=new Map();

/* --------------------------------------------------
v70 ENTITY ALIAS SYSTEM
-------------------------------------------------- */

const ENTITY_ALIAS=new Map();

function normalizeEntity(name){
return sanitize(name).replace(/\s+/g," ");
}

function resolveAlias(name){

const key=normalizeEntity(name);

if(ENTITY_ALIAS.has(key))
return ENTITY_ALIAS.get(key);

return key;
}

function addAlias(a,b){

const k1=normalizeEntity(a);
const k2=normalizeEntity(b);

ENTITY_ALIAS.set(k1,k2);

}

/* --------------------------------------------------
ENTITY INSERT
-------------------------------------------------- */

function addEntity(name,meta={}){

const key=resolveAlias(name);

if(!key) return null;

if(ENTITY_STORE.has(key)){

const e=ENTITY_STORE.get(key);
e.score+=0.02;
e.updated=Date.now();

return e;

}

const entity={

id:"kg_"+hash(key),
name:key,

score:1,
trust:meta.sourceTrust||0.5,

created:Date.now(),
updated:Date.now(),

meta

};

ENTITY_STORE.set(key,entity);

return entity;

}

/* --------------------------------------------------
RELATION KEY
-------------------------------------------------- */

function relationKey(a,b,type){
return a+"::"+b+"::"+type;
}

/* --------------------------------------------------
v80 SEMANTIC RELATION TYPES
-------------------------------------------------- */

const VALID_RELATIONS=new Set([
"related",
"influences",
"causes",
"belongs_to",
"created_by",
"part_of",
"conflicts_with",
"supports",
"depends_on"
]);

/* --------------------------------------------------
RELATION INSERT
-------------------------------------------------- */

function addRelation(a,b,type="related",meta={}){

a=resolveAlias(a);
b=resolveAlias(b);

if(!VALID_RELATIONS.has(type))
type="related";

const key=relationKey(a,b,type);

if(RELATION_STORE.has(key)){

const r=RELATION_STORE.get(key);
r.weight+=0.05;
r.updated=Date.now();

return r;

}

const relation={

from:a,
to:b,
type,

weight:0.5,
trust:meta.sourceTrust||0.5,

created:Date.now(),
updated:Date.now(),

time:meta.time||Date.now()

};

RELATION_STORE.set(key,relation);

const reverseKey=relationKey(b,a,type);

REVERSE_RELATION_STORE.set(reverseKey,{

from:b,
to:a,
type,

weight:relation.weight,
trust:relation.trust,

created:relation.created,
updated:relation.updated

});

return relation;

}

/* --------------------------------------------------
GRAPH QUERY
-------------------------------------------------- */

function queryGraph(entity){

entity=resolveAlias(entity);

const out=[];

for(const r of RELATION_STORE.values()){

if(r.from===entity||r.to===entity)
out.push(r);

}

for(const r of REVERSE_RELATION_STORE.values()){

if(r.from===entity||r.to===entity)
out.push(r);

}

return out;

}

/* --------------------------------------------------
MULTI DEPTH TRAVERSAL
-------------------------------------------------- */

function traverse(entity,depth=2){

entity=resolveAlias(entity);

const visited=new Set();
const queue=[{node:entity,d:0}];

const results=[];

while(queue.length){

const cur=queue.shift();

if(cur.d>depth) continue;

const rels=queryGraph(cur.node);

for(const r of rels){

const target=r.from===cur.node?r.to:r.from;

if(!visited.has(target)){

visited.add(target);

results.push({

entity:target,
depth:cur.d+1,
relation:r.type

});

queue.push({

node:target,
d:cur.d+1

});

}

}

}

return results;

}

/* --------------------------------------------------
v80 TRUST PROPAGATION
-------------------------------------------------- */

function propagateTrust(){

for(const r of RELATION_STORE.values()){

const e1=ENTITY_STORE.get(r.from);
const e2=ENTITY_STORE.get(r.to);

if(!e1||!e2) continue;

const avg=(e1.trust+e2.trust)/2;

r.trust=(r.trust*0.7)+(avg*0.3);

}

}

/* --------------------------------------------------
CLUSTER DETECTION
-------------------------------------------------- */

function detectClusters(){

const clusters=[];
const visited=new Set();

for(const entity of ENTITY_STORE.keys()){

if(visited.has(entity)) continue;

const component=[];
const stack=[entity];

while(stack.length){

const n=stack.pop();

if(visited.has(n)) continue;

visited.add(n);
component.push(n);

const rels=queryGraph(n);

for(const r of rels){

const target=r.from===n?r.to:r.from;

if(!visited.has(target))
stack.push(target);

}

}

if(component.length>2)
clusters.push(component);

}

return clusters;

}

/* --------------------------------------------------
v90 GRAPH POISONING DETECTION
-------------------------------------------------- */

function detectPoisoning(){

const suspicious=[];

for(const r of RELATION_STORE.values()){

if(r.weight>0.95 && r.trust<0.3)
suspicious.push(r);

}

return suspicious;

}

/* --------------------------------------------------
SELF HEAL
-------------------------------------------------- */

function selfHeal(){

const bad=detectPoisoning();

for(const r of bad){

RELATION_STORE.delete(
relationKey(r.from,r.to,r.type)
);

}

return bad.length;

}

/* --------------------------------------------------
ENTITY EXTRACTION
-------------------------------------------------- */

function extractEntities(text){

const words=sanitize(text)
.split(/\s+/)
.slice(0,20);

const entities=[];

for(const w of words){

if(w.length>2)
entities.push(w);

}

return entities;

}

/* --------------------------------------------------
MAIN ENGINE
-------------------------------------------------- */

async function runEngine(event,params={}){

const q=sanitize(params.query||params.q||"");

if(!q){

return{

status:"ok",
engine:"maru-knowledge-graph",
version:VERSION,

entities:ENTITY_STORE.size,
relations:RELATION_STORE.size

}

}

/* entity extraction */

const entities=extractEntities(q);

/* entity insert */

for(const e of entities)
addEntity(e);

/* relation creation */

for(let i=0;i<entities.length-1;i++){

addRelation(

entities[i],
entities[i+1],
"related"

);

}

/* traversal */

const graph=traverse(entities[0],3);

/* trust propagation */

propagateTrust();

/* graph heal */

const repaired=selfHeal();

/* clusters */

const clusters=detectClusters();

return{

status:"ok",
engine:"maru-knowledge-graph",
version:VERSION,

entities:ENTITY_STORE.size,
relations:RELATION_STORE.size,

graph,
clusters,

security:{
repairs:repaired
}

};

}

/* --------------------------------------------------
EXPORT
-------------------------------------------------- */

exports.runEngine=runEngine;

module.exports={
runEngine
};