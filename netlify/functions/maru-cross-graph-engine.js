const fs = require("fs");
const path = require("path");

const GRAPH_ROOT = path.join(process.cwd(),"data","searchbank");
const INDEX_FILE = path.join(GRAPH_ROOT,"graph.index.json");

const QUERY_LIMIT = 200;
const graphCache = {};

/* preload graphs */

function safeReadJson(file){
  try{
    if(!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file,"utf8");
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    return null;
  }
}

function preloadGraphs(){
  try{

    if(!fs.existsSync(GRAPH_ROOT)) return;

    const dirs = fs.readdirSync(GRAPH_ROOT,{withFileTypes:true})
      .filter(d=>d.isDirectory())
      .map(d=>d.name);

    dirs.forEach(type=>{
      const file = path.join(GRAPH_ROOT,type,`${type}.graph.json`);
      const graph = safeReadJson(file);
      if(graph){
        graphCache[type]=graph;
      }
    });

  }catch(e){}
}

preloadGraphs();

/* index */

function readIndex(){
  return safeReadJson(INDEX_FILE);
}

/* graph edge index acceleration */

function buildEdgeIndex(index){

  const map = {};

  const edges = index.edges || {};

  for(const key in edges){

    const edge = edges[key];
    if(!edge) continue;

    if(edge.from){
      if(!map[edge.from]) map[edge.from] = [];
      map[edge.from].push(edge);
    }

    if(edge.to){
      if(!map[edge.to]) map[edge.to] = [];
      map[edge.to].push(edge);
    }

  }

  return map;

}

/* utils */

function normalizeArray(v){
  return Array.isArray(v)?v:[];
}

/* multi-hop graph search */

function findConnectedNodesDepth(nodeId,index,edgeIndex,edgeType,depth){

  const visited = new Set();
  const queue = [{id:nodeId,level:0}];
  const results = new Set();

  while(queue.length){

    if(results.size > 500){
      break;
    }

    const current = queue.shift();

    if(current.level >= depth) continue;

    const edges = edgeIndex[current.id] || [];

    for(const edge of edges){

  if(!edge) continue;
      if(edgeType && edge.type && edge.type !== edgeType){
        continue;
      }

      let next = null;

      if(edge.from === current.id){
        next = edge.to;
      }
      else if(edge.to === current.id){
        next = edge.from;
      }

      if(!next) continue;

      if(!visited.has(next)){
        visited.add(next);
        results.add(next);

        queue.push({
          id:next,
          level:current.level+1
        });
      }

      if(results.size > 500){
        break;
      }

    }

  }

  return Array.from(results);

}

/* graph data */

function collectGraphData(id,index){

  const graphType=index.nodes[id]?.graph || index.items[id]?.graph;
  if(!graphType) return null;

  const graph = graphCache[graphType] || safeReadJson(
    path.join(GRAPH_ROOT,graphType,`${graphType}.graph.json`)
  );

  if(!graph) return null;

  const nodeList = normalizeArray(graph.nodes);
  const itemList = normalizeArray(graph.items);

  let node=null;
  let item=null;

  for(const n of nodeList){
    if(n.id===id){
      node=n;
      break;
    }
  }

  for(const i of itemList){
    if(i.id===id){
      item=i;
      break;
    }
  }

  return {node,item,graphType};

}

/* main */

function crossGraphQuery(nodeId,edgeType,depth){

  const index = readIndex();
  const edgeIndex = buildEdgeIndex(index);
  
  if(!index){
    return {
      source:nodeId,
      connectedNodes:[],
      connectedItems:[],
      meta:{nodeCount:0,itemCount:0,limit:QUERY_LIMIT,depth}
    };
  }

   const connected = findConnectedNodesDepth(
     nodeId,
     index,
     edgeIndex,
     edgeType,
     depth
   ).slice(0,QUERY_LIMIT);

  const nodes=[];
  const items=[];

  connected.forEach(id=>{

    const data = collectGraphData(id,index);
    if(!data) return;

    if(data.node) nodes.push(data.node);
    if(data.item) items.push(data.item);

  });

function graphRank(list,source){

  return list.map(n=>{

    let score = 1;

    if(n.type) score += 1;
    if(n.weight) score += n.weight;
    if(n.rank) score += n.rank;

    if(n.id === source){
      score += 5;
    }

    return {node:n,score};

  })
  .sort((a,b)=>b.score-a.score)
  .map(v=>v.node);

}

  const rankedNodes = graphRank(nodes,nodeId);
  const rankedItems = graphRank(items,nodeId);

  return {
    source:nodeId,
    connectedNodes:rankedNodes,
    connectedItems:rankedItems,
    meta:{
      nodeCount:nodes.length,
      itemCount:items.length,
      limit:QUERY_LIMIT,
      depth
    }
  };

}

/* handler */

exports.handler = async function(event){

  try{

    const params = event.queryStringParameters || {};
    const nodeId = params.node;
    const edgeType = params.type || null;
    let depth = parseInt(params.depth || "1",10);
	if(!nodeId || typeof nodeId !== "string" || nodeId.length > 120){
    return {
    statusCode:400,
    body:JSON.stringify({error:"invalid node"})
  };
}

if(depth > 10){
  depth = 10;
}


    const result = crossGraphQuery(nodeId,edgeType,depth);

    return {
      statusCode:200,
      body:JSON.stringify(result)
    };

  }catch(e){

    return {
      statusCode:500,
      body:JSON.stringify({
        error:"cross-graph-engine-failed"
      })
    };

  }

};