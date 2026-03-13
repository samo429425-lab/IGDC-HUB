const fs = require("fs");
const path = require("path");

const GRAPH_ROOT = path.join(process.cwd(), "data", "searchbank");
const INDEX_FILE = path.join(GRAPH_ROOT, "graph.index.json");
const TMP_INDEX_FILE = path.join(GRAPH_ROOT, "graph.index.tmp.json");
  let lastBuildTime = 0;

function nowIso() {
  return new Date().toISOString();
}

function createEmptyIndex() {
  return {
    meta: {
      engine: "maru-graph-index-engine",
      version: 3,
      builtAt: nowIso(),
      graphRoot: GRAPH_ROOT
    },
    stats: {
      graphs: 0,
      items: 0,
      nodes: 0,
      edges: 0
    },
    graphs: {},
    items: {},
    nodes: {},
    edges: {}
  };
}

function safeReadJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getGraphDirectories() {
  if (!fs.existsSync(GRAPH_ROOT)) return [];

  return fs
    .readdirSync(GRAPH_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function getGraphFilePath(type) {
  return path.join(GRAPH_ROOT, type, `${type}.graph.json`);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableEdgeKey(edge) {
  const from = edge.from || "unknown-from";
  const relType = edge.type || "rel";
  const to = edge.to || "unknown-to";
  return `${from}::${relType}::${to}`;
}

function buildGraphSummary(type, graph) {
  const items = normalizeArray(graph.items);
  const nodes = normalizeArray(graph.nodes);
  const edges = normalizeArray(graph.edges);

  return {
    graphType: type,
    version: graph.meta && graph.meta.version ? graph.meta.version : 1,
    updatedAt: graph.meta && graph.meta.updatedAt ? graph.meta.updatedAt : null,
    itemsCount: items.length,
    nodesCount: nodes.length,
    edgesCount: edges.length
  };
}

function indexGraph(index, type, graph) {
  const items = normalizeArray(graph.items);
  const nodes = normalizeArray(graph.nodes);
  const edges = normalizeArray(graph.edges);

  index.graphs[type] = buildGraphSummary(type, graph);

  items.forEach((item, idx) => {
    if (!item || !item.id) return;

    index.items[item.id] = {
      graph: type,
      position: idx,
      itemType: item.type || null,
      label: item.title || item.name || item.id
    };
  });

  nodes.forEach((node, idx) => {
    if (!node || !node.id) return;

    index.nodes[node.id] = {
      graph: type,
      position: idx,
      nodeType: node.type || null,
      label: node.label || node.name || node.id
    };
  });

  edges.forEach((edge, idx) => {
    if (!edge || !edge.from || !edge.to) return;

    const key = stableEdgeKey(edge);

    index.edges[key] = {
      graph: type,
      position: idx,
      from: edge.from,
      to: edge.to,
      type: edge.type || "rel"
    };
  });

  index.stats.items += items.length;
  index.stats.nodes += nodes.length;
  index.stats.edges += edges.length;
}

function buildIndex() {
  const index = createEmptyIndex();
  const graphTypes = getGraphDirectories();

  graphTypes.forEach((type) => {
    const graphFile = getGraphFilePath(type);
    const graph = safeReadJson(graphFile);

    if (!graph) return;

    indexGraph(index, type, graph);
  });

  index.stats.graphs = Object.keys(index.graphs).length;
  index.meta.builtAt = nowIso();

  return index;
}

function ensureGraphRoot() {
  if (!fs.existsSync(GRAPH_ROOT)) {
    fs.mkdirSync(GRAPH_ROOT, { recursive: true });
  }
}

function saveIndexAtomic(index) {
  ensureGraphRoot();

  fs.writeFileSync(TMP_INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  fs.renameSync(TMP_INDEX_FILE, INDEX_FILE);
}

exports.handler = async function (event) {
	const now = Date.now();

if(now - lastBuildTime < 10000){
  return {
    statusCode:429,
    body:JSON.stringify({error:"index rebuild throttled"})
  };
}

lastBuildTime = now;

if(event.httpMethod !== "POST"){
  return {
    statusCode:405,
    body:JSON.stringify({error:"method not allowed"})
  };
}

  try {
    const index = buildIndex();

    saveIndexAtomic(index);

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "index-built",
        version: index.meta.version,
        builtAt: index.meta.builtAt,
        graphs: Object.keys(index.graphs),
        stats: index.stats
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        status: "index-build-failed",
        error: error && error.message ? error.message : "unknown-error"
      })
    };
  }
};