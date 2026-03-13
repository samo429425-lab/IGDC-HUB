const fs = require("fs");
const path = require("path");

const GRAPH_ROOT = path.join(process.cwd(), "data", "searchbank");

class GraphPathSearch {
  constructor(graphType) {
    this.graphType = graphType;
    this.graph = this.loadGraph(graphType);
  }

  // 그래프 파일 로딩 (동기)
  loadGraph(graphType) {
    try {
      const graph = safeReadJson(path.join(GRAPH_ROOT, graphType, `${graphType}.graph.json`));
      if (!graph) {
        throw new Error("Graph file is empty or missing required data");
      }
      return graph;
    } catch (e) {
      console.error(`Error loading graph: ${e.message}`);
      throw new Error(`Failed to load graph for type: ${graphType}. ${e.message}`);
    }
  }

  // Dijkstra 알고리즘 (최단 경로 탐색)
  dijkstra(startNode, endNode, graph) {
    if (!graph.nodes.find(node => node.id === startNode)) {
      throw new Error(`Start node ${startNode} not found`);
    }
    if (!graph.nodes.find(node => node.id === endNode)) {
      throw new Error(`End node ${endNode} not found`);
    }

    const distances = {};
    const previousNodes = {};
    const nodes = new Set();

    // 초기화
    graph.nodes.forEach(node => {
      distances[node.id] = Infinity;
      previousNodes[node.id] = null;
      nodes.add(node.id);
    });
    distances[startNode] = 0;

    // 경로 탐색
    while (nodes.size > 0) {
      let closestNode = null;
      nodes.forEach(node => {
        if (!closestNode || distances[node] < distances[closestNode]) {
          closestNode = node;
        }
      });

      if (distances[closestNode] === Infinity) {
        break;
      }

      nodes.delete(closestNode);
      const edges = graph.edges.filter(edge => edge.from === closestNode || edge.to === closestNode);

      edges.forEach(edge => {
        const neighbor = edge.from === closestNode ? edge.to : edge.from;
        const alternative = distances[closestNode] + edge.weight;

        if (alternative < distances[neighbor]) {
          distances[neighbor] = alternative;
          previousNodes[neighbor] = closestNode;
        }
      });
    }

    // 경로 추적
    const path = [];
    let currentNode = endNode;
    while (previousNodes[currentNode]) {
      path.unshift(currentNode);
      currentNode = previousNodes[currentNode];
    }

    if (path.length > 0) {
      path.unshift(startNode);
    }

    // 경로가 없으면 에러 발생
    if (path.length === 0) {
      throw new Error(`No path found between ${startNode} and ${endNode}`);
    }

    return path;
  }

  // 배치 경로 찾기
  async findBatchPaths(nodePairs, chunkSize = 50) {
    const chunks = [];
    
    // 동적으로 배치 크기 결정
    for (let i = 0; i < nodePairs.length; i += chunkSize) {
      chunks.push(nodePairs.slice(i, i + chunkSize));
    }

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        return Promise.all(
          chunk.map(async (pair) => {
            const { startNode, endNode } = pair;
            const path = await this.findPathAsync(startNode, endNode);
            return { startNode, endNode, path };
          })
        );
      })
    );

    return results.flat();
  }

  // 비동기 경로 탐색
  async findPathAsync(startNode, endNode) {
    return new Promise((resolve) => {
      const path = this.dijkstra(startNode, endNode);
      resolve(path);
    });
  }
}

// 그래프 파일 읽기 (비동기)
async function safeReadJsonAsync(file) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, "utf8", (err, data) => {
      if (err || !data) {
        reject(new Error(`Graph file ${file} is missing or empty`));
      } else {
        resolve(JSON.parse(data));
      }
    });
  });
}

// 그래프 파일 읽기 (동기)
function safeReadJson(file) {
  try {
    if (!fs.existsSync(file)) {
      throw new Error(`Graph file ${file} not found`);
    }
    const raw = fs.readFileSync(file, "utf8");
    if (!raw || !raw.trim()) {
      throw new Error(`Graph file ${file} is empty or invalid`);
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Error reading graph file: ${e.message}`);
    throw new Error(`Failed to read graph file: ${e.message}`);
  }
}

// 허용된 IP 목록 (유연하게 설정)
const allowedIps = ["127.0.0.1", "::1", "192.168.0.0/24"];  // 예시: 로컬 및 내부 IP만 허용

// 요청 속도 제한 (유연하게 설정)
const rateLimit = {
  requests: 0,
  lastReset: Date.now(),
  limit: 1000, // 1분에 최대 1000번
};

// IP 제한
function checkIp(event) {
  const requestIp = event.headers["X-Forwarded-For"] || event.requestContext.identity.sourceIp;
  if (!allowedIps.some(ip => ip === requestIp || ip.includes(requestIp))) {
    throw new Error("Unauthorized IP address");
  }
}

// 속도 제한
function checkRateLimit() {
  const now = Date.now();
  if (now - rateLimit.lastReset > 60000) {
    rateLimit.requests = 0;
    rateLimit.lastReset = now;
  }

  if (rateLimit.requests >= rateLimit.limit) {
    throw new Error("Rate limit exceeded");
  }

  rateLimit.requests++;
}

// 핸들러
exports.handler = async function (event) {
  // 1. GET/POST 요청 처리 유연화
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    // 2. 보안 처리
    checkIp(event);
    checkRateLimit();

    const { graphType, nodePairs } = JSON.parse(event.body);
    const graphSearch = new GraphPathSearch(graphType);

    console.time("batchPathSearch");
    console.log(`Starting batch path search for graph type: ${graphType}`);

    const result = await graphSearch.findBatchPaths(nodePairs);

    console.log(`Batch path search completed for graph type: ${graphType}, found ${result.length} results`);

    console.timeEnd("batchPathSearch");

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error(`Error during batch path search: ${e.message}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
    };
  }
};