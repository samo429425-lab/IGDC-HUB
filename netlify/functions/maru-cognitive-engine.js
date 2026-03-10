"use strict";

/*
MARU Cognitive Engine v70
------------------------------------------------------------
Meta Cognitive Reasoning Engine

Compatible with
- Knowledge Graph v60+
- Civilization Engine
- Consciousness Engine
- Evolution Engine
- Collector
*/

const VERSION = "maru-cognitive-v70";

/* --------------------------------------------------
UTIL
-------------------------------------------------- */

function sanitize(v){

return String(v||"")
.replace(/[<>;$`]/g,"")
.slice(0,5000);

}

function detectInjection(text){

const t=text.toLowerCase();

const patterns=[
"<script",
"drop table",
"rm -rf",
"process.env",
"eval("
];

return patterns.some(p=>t.includes(p));

}

/* --------------------------------------------------
CONTEXT MEMORY
-------------------------------------------------- */

const CONTEXT_MEMORY=[];

function remember(entry){

CONTEXT_MEMORY.push(entry);

if(CONTEXT_MEMORY.length>20000)
CONTEXT_MEMORY.shift();

}

function recall(query){

const results=[];

for(const m of CONTEXT_MEMORY){

if(m.query && query.includes(m.query))
results.push(m);

}

return results;

}

/* --------------------------------------------------
GRAPH REASONING
-------------------------------------------------- */

function graphReasoning(graph){

const insights=[];

for(const node of graph||[]){

if(node.depth>2){

insights.push({
type:"indirect_relation",
entity:node.entity,
depth:node.depth
});

}

if(node.depth>4){

insights.push({
type:"deep_graph_relation",
entity:node.entity,
depth:node.depth
});

}

}

return insights;

}

/* --------------------------------------------------
SEMANTIC INFERENCE
-------------------------------------------------- */

function semanticInference(text){

const signals=[];

const q=text.toLowerCase();

if(q.includes("why"))
signals.push("causal_reasoning");

if(q.includes("future"))
signals.push("predictive_reasoning");

if(q.includes("risk"))
signals.push("risk_analysis");

if(q.includes("civilization"))
signals.push("civilization_context");

if(q.includes("system"))
signals.push("system_analysis");

return signals;

}

/* --------------------------------------------------
META REASONING (v70)
-------------------------------------------------- */

function metaReasoning(signals){

const meta=[];

for(const s of signals){

if(s==="predictive_reasoning")
meta.push("future_projection");

if(s==="risk_analysis")
meta.push("risk_forecasting");

if(s==="civilization_context")
meta.push("macro_system_reasoning");

}

return meta;

}

/* --------------------------------------------------
DYNAMIC KNOWLEDGE WEIGHTING (v70)
-------------------------------------------------- */

function dynamicKnowledgeWeight(signals){

let weight=1;

if(signals.includes("causal_reasoning"))
weight*=1.1;

if(signals.includes("predictive_reasoning"))
weight*=1.2;

if(signals.includes("risk_analysis"))
weight*=1.15;

return weight;

}

/* --------------------------------------------------
MULTI STEP REASONING
-------------------------------------------------- */

function multiStepReasoning(query,graph){

const steps=[];

steps.push({
stage:"query_analysis",
query
});

if(graph && graph.length){

steps.push({
stage:"graph_context",
nodes:graph.length
});

}

const semantics=semanticInference(query);

steps.push({
stage:"semantic_analysis",
signals:semantics
});

steps.push({
stage:"meta_reasoning",
meta:metaReasoning(semantics)
});

return steps;

}

/* --------------------------------------------------
KNOWLEDGE PATH DISCOVERY
-------------------------------------------------- */

function discoverKnowledgePaths(graph){

const paths=[];

for(const g of graph||[]){

if(g.depth>=2){

paths.push({
entity:g.entity,
pathDepth:g.depth
});

}

}

return paths;

}

/* --------------------------------------------------
CIVILIZATION REASONING
-------------------------------------------------- */

function civilizationReasoning(query){

const q=query.toLowerCase();

const insights=[];

if(q.includes("history"))
insights.push("historical_pattern");

if(q.includes("culture"))
insights.push("cultural_dynamics");

if(q.includes("power"))
insights.push("power_structure");

if(q.includes("collapse"))
insights.push("civilization_risk");

return insights;

}

/* --------------------------------------------------
CROSS ENGINE COGNITION (v70)
-------------------------------------------------- */

function crossEngineSignals(params){

const signals=[];

if(params.civilizationSignal)
signals.push("civilization_input");

if(params.evolutionSignal)
signals.push("evolution_feedback");

if(params.consciousnessSignal)
signals.push("consciousness_alignment");

return signals;

}

/* --------------------------------------------------
MAIN ENGINE
-------------------------------------------------- */

async function runEngine(event,params={}){

const q=sanitize(params.query||params.q||"");

if(!q){

return{
status:"ok",
engine:"maru-cognitive-engine",
version:VERSION
};

}

if(detectInjection(q)){

return{
status:"blocked",
reason:"injection_detected"
};

}

/* recall */

const memory=recall(q);

/* graph */

const graph=params.graph||[];

/* semantic */

const semanticSignals=semanticInference(q);

/* meta */

const metaSignals=metaReasoning(semanticSignals);

/* weighting */

const reasoningWeight=dynamicKnowledgeWeight(semanticSignals);

/* reasoning */

const graphInsights=graphReasoning(graph);

const steps=multiStepReasoning(q,graph);

const knowledgePaths=discoverKnowledgePaths(graph);

const civilization=civilizationReasoning(q);

const crossSignals=crossEngineSignals(params);

/* remember */

remember({
query:q,
timestamp:Date.now()
});

/* response */

return{

status:"ok",

engine:"maru-cognitive-engine",

version:VERSION,

query:q,

reasoningWeight,

reasoning:{

steps,

semanticSignals,

metaSignals,

graphInsights,

knowledgePaths,

civilizationInsights:civilization,

crossEngineSignals:crossSignals

},

memoryMatches:memory.length

};

}

/* --------------------------------------------------
EXPORT
-------------------------------------------------- */

exports.runEngine=runEngine;

module.exports={
runEngine
};