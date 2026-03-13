const fs = require("fs");
const path = require("path");

const GRAPH_ROOT = path.join(process.cwd(), "data", "searchbank");

const GRAPH_MAP = {
  media: "media/media.graph.json",
  commerce: "commerce/commerce.graph.json",
  knowledge: "knowledge/knowledge.graph.json",
  region: "region/region.graph.json",
  insight: "global-insight/global-insight.graph.json"
};

function loadGraph(type) {

  const file = path.join(GRAPH_ROOT, GRAPH_MAP[type]);

  const emptyGraph = {
    meta: {
      graphType: type,
      version: 1,
      updatedAt: new Date().toISOString()
    },
    items: [],
    nodes: [],
    edges: []
  };

  if (!fs.existsSync(file)) {
    return emptyGraph;
  }

  try {

    const raw = fs.readFileSync(file, "utf8");

    if (!raw || raw.trim() === "") {
      return emptyGraph;
    }

    const data = JSON.parse(raw);

    if (!data.meta) {
      data.meta = {
        graphType: type,
        version: 1,
        updatedAt: new Date().toISOString()
      };
    }

    if (!Array.isArray(data.items)) data.items = [];
    if (!Array.isArray(data.nodes)) data.nodes = [];
    if (!Array.isArray(data.edges)) data.edges = [];

    return data;

  } catch (e) {

    console.error("SearchBank graph load error:", file);

    return emptyGraph;

  }

}

function saveGraph(type, graph) {

  const file = path.join(GRAPH_ROOT, GRAPH_MAP[type]);
  const dir = path.dirname(file);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!graph.meta) {
    graph.meta = {
      graphType: type,
      version: 1
    };
  }

  graph.meta.graphType = type;
  graph.meta.version = graph.meta.version || 1;
  graph.meta.updatedAt = new Date().toISOString();

  fs.writeFileSync(file, JSON.stringify(graph, null, 2));
}

function hashEntity(entity) {
  return Buffer.from(
    JSON.stringify(entity)
  ).toString("base64").slice(0, 24);
}

function ensureNode(graph, node) {

  const exists = graph.nodes.find(n => n.id === node.id);
  if (exists) return;

  graph.nodes.push(node);
}

function dedup(graph, entity) {

  const id = entity.id || hashEntity(entity);
  const exists = graph.items.find(i => i.id === id);

  if (exists) return false;

  entity.id = id;
  graph.items.push(entity);

  ensureNode(graph, {
    id,
    type: entity.type || "entity",
    label: entity.title || entity.name || id
  });

  return id;
}

function addEdge(graph, from, to, type){

  const exists = graph.edges.find(e =>
    e.from === from &&
    e.to === to &&
    e.type === type
  );

  if(!exists){
    graph.edges.push({
      from,
      to,
      type
    });
  }

}

function buildRelations(graph, entityId, entity) {

  if (entity.region) {
    addEdge(graph, entity.region, entityId, "region-contains");
  }

  if (entity.topic) {
    addEdge(graph, entity.topic, entityId, "topic-link");
  }

}

async function triggerSnapshot() {
  try {
    const snapshot = require("./snapshot-engine");
    if (snapshot && snapshot.run) {
      await snapshot.run();
    }
  } catch (e) {}
}

const TYPE_ALIAS = {
  media:"media",
  commerce:"commerce",
  knowledge:"knowledge",
  region:"region",
  insight:"insight",
  "global-insight":"insight",
  globalInsight:"insight",
  sns:"media",
  social:"media",
  tour:"knowledge"
};

exports.handler = async function (event) {

  let payload = {};

try{
  payload = JSON.parse(event.body || "{}");
}catch(e){
  return {
    statusCode:400,
    body:JSON.stringify({error:"invalid json"})
  };
}

if(JSON.stringify(payload).length > 100000){
  return {
    statusCode:413,
    body:JSON.stringify({error:"payload too large"})
  };
}

  const rawType = payload.type || "knowledge";
  const type = TYPE_ALIAS[rawType] || rawType;

  if (!GRAPH_MAP[type]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Unknown graph type" })
    };
  }

  const graph = loadGraph(type);

  const entityId = dedup(graph, payload);

  if (entityId) {
    buildRelations(graph, entityId, payload);
    saveGraph(type, graph);
    await triggerSnapshot();
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: "synced",
      graph: type,
      id: entityId
    })
  };

};