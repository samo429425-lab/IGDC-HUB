/* =========================================================
   MARU Civilization Intelligence Engine
   Version: v70 Ultimate Expansion
   Base: v40 Ultimate Security
   Upgrade Path: v40 -> v50 -> v60 -> v70
========================================================= */

(function(global){

"use strict";

/* =========================
   ENGINE INFO
========================= */

const ENGINE_INFO = {
  name: "Civilization Intelligence Engine",
  version: "v70",
  base: "v40 Ultimate Security",
  security: "Ultimate Expansion",
  status: "production"
};

/* =========================
   SECURITY LAYER (v40 유지)
========================= */

const SecurityLayer = {

  validateInput(data){

    if(data === undefined) return false;
    if(data === null) return false;

    if(typeof data === "string"){
      if(data.length > 10000) return false;
    }

    return true;

  },

  sanitizeString(str){

    if(typeof str !== "string") return "";

    return str
      .replace(/</g,"")
      .replace(/>/g,"")
      .replace(/script/gi,"")
      .replace(/eval\(/gi,"")
      .replace(/process\.env/gi,"");

  },

  sanitizeQuery(str){

    if(typeof str !== "string") return "";

    return str
      .replace(/[<>;$`]/g,"")
      .replace(/script/gi,"")
      .replace(/drop\s+table/gi,"")
      .replace(/rm\s+-rf/gi,"")
      .replace(/process\.env/gi,"")
      .slice(0,5000)
      .trim();

  },

  detectInjection(str){

    if(typeof str !== "string") return false;

    const t = str.toLowerCase();

    const patterns = [
      "<script",
      "drop table",
      "rm -rf",
      "process.env",
      "eval(",
      "javascript:"
    ];

    return patterns.some(p => t.includes(p));

  },

  secureObject(obj){

    try{
      return JSON.parse(JSON.stringify(obj));
    }catch(e){
      return {};
    }

  },

  freeze(obj){

    try{
      return Object.freeze(obj);
    }catch(e){
      return obj;
    }

  }

};

/* =========================
   KNOWLEDGE CACHE (v40 유지)
========================= */

const KnowledgeCache = {

  store:new Map(),
  maxSize:5000,

  set(key,value){

    if(!SecurityLayer.validateInput(key)) return;

    if(this.store.size >= this.maxSize){

      const firstKey = this.store.keys().next().value;

      if(firstKey !== undefined){
        this.store.delete(firstKey);
      }

    }

    this.store.set(key,value);

  },

  get(key){

    return this.store.get(key);

  },

  has(key){

    return this.store.has(key);

  },

  clear(){

    this.store.clear();

  },

  size(){

    return this.store.size;

  }

};

/* =========================
   RELATION GRAPH ENGINE (v40 확장)
========================= */

class RelationGraph{

  constructor(){

    this.nodes = new Map();
    this.edges = new Map();
    this.reverseEdges = new Map();

  }

  addNode(id,data){

    if(!SecurityLayer.validateInput(id)) return;

    data = SecurityLayer.secureObject(data);

    this.nodes.set(id,data);

  }

  addEdge(a,b,type){

    if(!this.nodes.has(a)) return;
    if(!this.nodes.has(b)) return;

    const safeType = SecurityLayer.sanitizeString(String(type || "related"));

    if(!this.edges.has(a)){
      this.edges.set(a,[]);
    }

    const exists = this.edges.get(a).some(edge =>
      edge.target === b && edge.type === safeType
    );

    if(!exists){
      this.edges.get(a).push({
        target:b,
        type:safeType
      });
    }

    if(!this.reverseEdges.has(b)){
      this.reverseEdges.set(b,[]);
    }

    const reverseExists = this.reverseEdges.get(b).some(edge =>
      edge.target === a && edge.type === safeType
    );

    if(!reverseExists){
      this.reverseEdges.get(b).push({
        target:a,
        type:safeType
      });
    }

  }

  getNode(id){

    return this.nodes.get(id);

  }

  getRelations(id){

    return this.edges.get(id) || [];

  }

  getReverseRelations(id){

    return this.reverseEdges.get(id) || [];

  }

  getLinkedEntities(id){

    const out = [];
    const forward = this.getRelations(id);
    const reverse = this.getReverseRelations(id);

    forward.forEach(item => out.push(item.target));
    reverse.forEach(item => out.push(item.target));

    return Array.from(new Set(out));

  }

  getAllNodes(){

    return Array.from(this.nodes.keys());

  }

  hasNode(id){

    return this.nodes.has(id);

  }

}

/* =========================
   CIVILIZATION ANALYZER (v40 유지)
========================= */

class CivilizationAnalyzer{

  analyze(entity){

    if(!SecurityLayer.validateInput(entity)) return null;

    return {

      stability:this.calculateStability(entity),
      influence:this.calculateInfluence(entity),
      complexity:this.calculateComplexity(entity),
      diversity:this.calculateDiversity(entity)

    };

  }

  calculateStability(entity){

    let score = 0;

    if(entity.history) score += 25;
    if(entity.culture) score += 25;
    if(entity.economy) score += 25;
    if(entity.technology) score += 25;

    return score;

  }

  calculateInfluence(entity){

    let score = 0;

    if(entity.population) score += 20;
    if(entity.trade) score += 20;
    if(entity.military) score += 20;
    if(entity.knowledge) score += 20;
    if(entity.network) score += 20;

    return score;

  }

  calculateComplexity(entity){

    let keys = Object.keys(entity || {});

    return keys.length * 10;

  }

  calculateDiversity(entity){

    let score = 0;

    if(entity.language) score += 20;
    if(entity.religion) score += 20;
    if(entity.ethnicity) score += 20;
    if(entity.culture) score += 20;
    if(entity.education) score += 20;

    return score;

  }

}

/* =========================
   REASONING ENGINE (v40 유지)
========================= */

class ReasoningEngine{

  infer(data){

    if(!SecurityLayer.validateInput(data)) return null;

    let result = {};

    result.pattern = this.detectPattern(data);
    result.trend = this.predictTrend(data);
    result.risk = this.calculateRisk(data);

    return result;

  }

  detectPattern(data){

    if(Array.isArray(data)){
      return "sequence-pattern";
    }

    if(typeof data === "object"){
      return "structural-pattern";
    }

    return "unknown";

  }

  predictTrend(data){

    if(!data) return "undefined";

    return "stable";

  }

  calculateRisk(data){

    if(!data) return "low";

    if(typeof data === "object"){

      let size = Object.keys(data).length;

      if(size > 200) return "high";
      if(size > 50) return "medium";

    }

    return "low";

  }

}

/* =========================
   ANOMALY DETECTOR (v40 유지)
========================= */

class AnomalyDetector{

  detect(entity){

    if(!entity) return false;

    let keys = Object.keys(entity);

    if(keys.length > 500){
      return true;
    }

    return false;

  }

  detectGraphAbuse(graph,id){

    if(!graph || !id) return false;

    const relations = graph.getRelations(id);
    const reverse = graph.getReverseRelations(id);

    if(relations.length > 300) return true;
    if(reverse.length > 300) return true;

    return false;

  }

}

/* =========================================================
   v50 MODULE
   Civilization Pattern Engine
========================================================= */

class CivilizationPatternEngine{

  detectPatterns(graph){

    const patterns = [];
    const nodes = graph.getAllNodes();

    for(const id of nodes){

      const forward = graph.getRelations(id);
      const reverse = graph.getReverseRelations(id);
      const total = forward.length + reverse.length;

      if(total >= 3){
        patterns.push({
          entity:id,
          type:"connected-civilization-pattern",
          connectionCount:total
        });
      }

      if(forward.length >= 5){
        patterns.push({
          entity:id,
          type:"outbound-influence-pattern",
          connectionCount:forward.length
        });
      }

      if(reverse.length >= 5){
        patterns.push({
          entity:id,
          type:"inbound-influence-pattern",
          connectionCount:reverse.length
        });
      }

    }

    return patterns;

  }

  detectMacroSignals(entity){

    if(!entity) return [];

    const signals = [];

    if(entity.economy) signals.push("economic-signal");
    if(entity.technology) signals.push("technology-signal");
    if(entity.culture) signals.push("cultural-signal");
    if(entity.history) signals.push("historical-signal");
    if(entity.military) signals.push("geostrategic-signal");

    return signals;

  }

}

/* =========================================================
   v60 MODULE
   Civilization Timeline Engine
========================================================= */

class CivilizationTimelineEngine{

  buildTimeline(entity){

    if(!entity) return [];

    const timeline = [];

    if(entity.history){
      timeline.push({
        stage:"historical-foundation",
        value:entity.history
      });
    }

    if(entity.culture){
      timeline.push({
        stage:"cultural-phase",
        value:entity.culture
      });
    }

    if(entity.economy){
      timeline.push({
        stage:"economic-phase",
        value:entity.economy
      });
    }

    if(entity.technology){
      timeline.push({
        stage:"technology-phase",
        value:entity.technology
      });
    }

    if(entity.network){
      timeline.push({
        stage:"network-phase",
        value:entity.network
      });
    }

    return timeline;

  }

  buildTrajectory(entity){

    if(!entity) return [];

    const trajectory = [];

    if(entity.history && entity.economy){
      trajectory.push({
        dimension:"historical-economic",
        trend:"compound-development"
      });
    }

    if(entity.technology && entity.network){
      trajectory.push({
        dimension:"technology-network",
        trend:"accelerating-integration"
      });
    }

    if(entity.culture && entity.education){
      trajectory.push({
        dimension:"culture-education",
        trend:"identity-propagation"
      });
    }

    if(trajectory.length === 0){
      trajectory.push({
        dimension:"general",
        trend:"stable-continuity"
      });
    }

    return trajectory;

  }

}

/* =========================================================
   v70 MODULE
   Civilization Strategic Engine
========================================================= */

class CivilizationStrategicEngine{

  analyzeStrategy(entity){

    if(!entity) return null;

    return {

      powerShift:this.detectPowerShift(entity),
      stabilityForecast:this.forecastStability(entity),
      strategicRisk:this.detectStrategicRisk(entity),
      transitionVector:this.detectTransitionVector(entity),
      strategicPriority:this.detectStrategicPriority(entity)

    };

  }

  detectPowerShift(entity){

    if(entity.economy && entity.military && entity.technology){
      return "emerging-power-center";
    }

    if(entity.economy && entity.network){
      return "network-economic-center";
    }

    return "stable-power-distribution";

  }

  forecastStability(entity){

    if(entity.history && entity.culture && entity.education){
      return "long-term-stability";
    }

    if(entity.conflict){
      return "volatile-stability";
    }

    return "uncertain-stability";

  }

  detectStrategicRisk(entity){

    if(entity.conflict && entity.military){
      return "high-geostrategic-risk";
    }

    if(entity.conflict){
      return "conflict-risk";
    }

    if(entity.economy && !entity.education){
      return "development-imbalance-risk";
    }

    return "low-risk";

  }

  detectTransitionVector(entity){

    if(entity.technology && entity.economy){
      return "tech-economic-transition";
    }

    if(entity.culture && entity.network){
      return "cultural-network-transition";
    }

    if(entity.history && entity.knowledge){
      return "knowledge-civilization-transition";
    }

    return "general-transition";

  }

  detectStrategicPriority(entity){

    if(entity.conflict) return "stabilization";
    if(entity.technology) return "innovation";
    if(entity.economy) return "economic-expansion";
    if(entity.culture) return "civilizational-cohesion";

    return "continuity";

  }

}

/* =========================================================
   QUERY CIVILIZATION ANALYZER
   Collector/Search/Cognitive와 충돌 없이 보조 분석
========================================================= */

class QueryCivilizationAnalyzer{

  analyzeQuery(query){

    const q = SecurityLayer.sanitizeQuery(query || "").toLowerCase();

    return {
      signals:this.detectQuerySignals(q),
      risks:this.detectQueryRisks(q),
      domain:this.detectDomain(q),
      intensity:this.detectIntensity(q)
    };

  }

  detectQuerySignals(q){

    const out = [];

    if(q.includes("war")) out.push("war-signal");
    if(q.includes("economy")) out.push("economy-signal");
    if(q.includes("trade")) out.push("trade-signal");
    if(q.includes("technology")) out.push("technology-signal");
    if(q.includes("culture")) out.push("culture-signal");
    if(q.includes("history")) out.push("history-signal");
    if(q.includes("civilization")) out.push("civilization-signal");
    if(q.includes("collapse")) out.push("collapse-signal");
    if(q.includes("migration")) out.push("migration-signal");
    if(q.includes("religion")) out.push("religion-signal");

    return out;

  }

  detectQueryRisks(q){

    const out = [];

    if(q.includes("war")) out.push("geopolitical-risk");
    if(q.includes("collapse")) out.push("collapse-risk");
    if(q.includes("conflict")) out.push("conflict-risk");
    if(q.includes("crisis")) out.push("systemic-crisis-risk");
    if(q.includes("instability")) out.push("instability-risk");

    return out;

  }

  detectDomain(q){

    if(q.includes("technology")) return "technology";
    if(q.includes("economy") || q.includes("trade")) return "economy";
    if(q.includes("culture") || q.includes("religion")) return "culture";
    if(q.includes("history")) return "history";
    if(q.includes("war") || q.includes("conflict")) return "geostrategy";

    return "general-civilization";

  }

  detectIntensity(q){

    let score = 0;

    if(q.includes("war")) score += 30;
    if(q.includes("collapse")) score += 30;
    if(q.includes("crisis")) score += 20;
    if(q.includes("conflict")) score += 20;
    if(q.includes("civilization")) score += 10;
    if(q.includes("history")) score += 10;
    if(q.includes("technology")) score += 10;

    if(score >= 60) return "high";
    if(score >= 25) return "medium";

    return "low";

  }

}

/* =========================
   CIVILIZATION ENGINE CORE
========================= */

class CivilizationIntelligenceEngine{

  constructor(){

    this.graph = new RelationGraph();
    this.analyzer = new CivilizationAnalyzer();
    this.reasoner = new ReasoningEngine();
    this.anomaly = new AnomalyDetector();

    this.patternEngine = new CivilizationPatternEngine();
    this.timelineEngine = new CivilizationTimelineEngine();
    this.strategyEngine = new CivilizationStrategicEngine();
    this.queryAnalyzer = new QueryCivilizationAnalyzer();

  }

  registerEntity(id,data){

    if(!SecurityLayer.validateInput(id)) return;

    const safeId = SecurityLayer.sanitizeString(String(id));
    data = SecurityLayer.secureObject(data);

    this.graph.addNode(safeId,data);

    KnowledgeCache.set(safeId,data);

  }

  relate(a,b,type){

    const safeA = SecurityLayer.sanitizeString(String(a || ""));
    const safeB = SecurityLayer.sanitizeString(String(b || ""));
    const safeType = SecurityLayer.sanitizeString(String(type || "related"));

    this.graph.addEdge(safeA,safeB,safeType);

  }

  analyze(id){

    let safeId = SecurityLayer.sanitizeString(String(id || ""));
    let entity = this.graph.getNode(safeId);

    if(!entity) return null;

    if(this.anomaly.detect(entity)){
      return {
        warning:"anomaly detected"
      };
    }

    if(this.anomaly.detectGraphAbuse(this.graph,safeId)){
      return {
        warning:"graph anomaly detected"
      };
    }

    let base = this.analyzer.analyze(entity);
    let strategy = this.strategyEngine.analyzeStrategy(entity);
    let timeline = this.timelineEngine.buildTimeline(entity);
    let trajectory = this.timelineEngine.buildTrajectory(entity);
    let macroSignals = this.patternEngine.detectMacroSignals(entity);

    return {
      engine:ENGINE_INFO.name,
      version:ENGINE_INFO.version,
      entity:safeId,
      base,
      strategy,
      timeline,
      trajectory,
      macroSignals
    };

  }

  analyzeQuery(query){

    const safeQuery = SecurityLayer.sanitizeQuery(query || "");

    if(SecurityLayer.detectInjection(safeQuery)){
      return {
        status:"blocked",
        reason:"injection_detected"
      };
    }

    return {
      status:"ok",
      engine:ENGINE_INFO.name,
      version:ENGINE_INFO.version,
      query:safeQuery,
      queryAnalysis:this.queryAnalyzer.analyzeQuery(safeQuery)
    };

  }

  detectPatterns(){

    return this.patternEngine.detectPatterns(this.graph);

  }

  infer(data){

    return this.reasoner.infer(data);

  }

  getRelations(id){

    let safeId = SecurityLayer.sanitizeString(String(id || ""));

    return this.graph.getRelations(safeId);

  }

  getReverseRelations(id){

    let safeId = SecurityLayer.sanitizeString(String(id || ""));

    return this.graph.getReverseRelations(safeId);

  }

  getLinkedEntities(id){

    let safeId = SecurityLayer.sanitizeString(String(id || ""));

    return this.graph.getLinkedEntities(safeId);

  }

  getEntity(id){

    let safeId = SecurityLayer.sanitizeString(String(id || ""));

    return this.graph.getNode(safeId);

  }

  getAllEntities(){

    return this.graph.getAllNodes();

  }

  clearCache(){

    KnowledgeCache.clear();

  }

  getEngineInfo(){

    return SecurityLayer.secureObject(ENGINE_INFO);

  }

  runEngine(event,params={}){

    const query = SecurityLayer.sanitizeQuery(params.query || params.q || "");

    if(query){

      return this.analyzeQuery(query);

    }

    const id = params.id || params.entityId || null;

    if(id){

      const result = this.analyze(id);

      return {
        status:"ok",
        engine:ENGINE_INFO.name,
        version:ENGINE_INFO.version,
        result
      };

    }

    return {
      status:"ok",
      engine:ENGINE_INFO.name,
      version:ENGINE_INFO.version,
      entities:this.getAllEntities().length,
      cacheSize:KnowledgeCache.size(),
      patterns:this.detectPatterns()
    };

  }

}

/* =========================
   ENGINE INSTANCE
========================= */

const EngineInstance = new CivilizationIntelligenceEngine();

/* =========================
   GLOBAL EXPORT
========================= */

global.MARU_Civilization_Intelligence = EngineInstance;

if(typeof module !== "undefined" && module.exports){
  module.exports = {
    ENGINE_INFO,
    SecurityLayer,
    KnowledgeCache,
    RelationGraph,
    CivilizationAnalyzer,
    ReasoningEngine,
    AnomalyDetector,
    CivilizationPatternEngine,
    CivilizationTimelineEngine,
    CivilizationStrategicEngine,
    QueryCivilizationAnalyzer,
    CivilizationIntelligenceEngine,
    EngineInstance
  };
}

})(typeof window !== "undefined" ? window : globalThis);