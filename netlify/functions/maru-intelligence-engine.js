"use strict";

/*
MARU Intelligence Engine v80
------------------------------------------------------------
Upgrade Path
v25-1 -> v40 -> v50 -> v60 -> v70 -> v80

Role
- Cross-engine synthesis
- Meta intelligence integration
- Engine conflict reduction
- Strategic output harmonization

Compatibility Goals
- Collector compatibility 유지
- process(results) 인터페이스 유지
- Knowledge Graph / Cognitive / Civilization / Consciousness / Evolution과
  역할 충돌 없이 최종 통합 레이어로만 동작
*/

const VERSION = "maru-intelligence-v80-meta-secure";

/* =========================================================
   v25-1 BASE SECURITY
========================================================= */

function validateResults(results){

  if(!Array.isArray(results)) return [];

  return results.filter(r => {
    if(!r) return false;

    const text = JSON.stringify(r).toLowerCase();

    if(text.includes("<script")) return false;
    if(text.includes("eval(")) return false;
    if(text.includes("process.env")) return false;
    if(text.includes("drop table")) return false;

    return true;
  });

}

function sanitizeText(text){
  return String(text || "")
    .replace(/[<>;$`]/g, "")
    .replace(/script/gi, "")
    .slice(0, 2000);
}

function safeClone(obj){
  try{
    return JSON.parse(JSON.stringify(obj));
  }catch(e){
    return null;
  }
}

/* =========================================================
   ENGINE MEMORY
========================================================= */

class IntelligenceMemory{

  constructor(){
    this.history = [];
    this.max = 10000;
  }

  remember(entry){

    this.history.push(entry);

    if(this.history.length > this.max){
      this.history.shift();
    }

  }

  recallRecent(limit = 20){
    return this.history.slice(-limit);
  }

  count(){
    return this.history.length;
  }

}

/* =========================================================
   v40 LAYER
   Cross-Engine Normalization
========================================================= */

class ResultNormalizer{

  normalize(results){

    const out = [];

    for(const item of results || []){

      const safe = safeClone(item);

      if(!safe) continue;

      out.push({
        title: sanitizeText(safe.title || safe.name || ""),
        summary: sanitizeText(safe.summary || safe.description || ""),
        url: sanitizeText(safe.url || ""),
        source: sanitizeText(safe.source || safe.engine || "unknown"),
        engine: sanitizeText(safe.engine || safe.source || "unknown"),
        score: typeof safe.score === "number" ? safe.score : 0.5,
        trust: typeof safe.trust === "number" ? safe.trust : null,
        qualityScore: typeof safe.qualityScore === "number" ? safe.qualityScore : null,
        type: sanitizeText(safe.type || ""),
        intent: sanitizeText(safe.intent || ""),
        timestamp: safe.timestamp || Date.now(),
        payload: safe
      });

    }

    return out;

  }

}

/* =========================================================
   v50 LAYER
   Engine Signal Classification
========================================================= */

class EngineSignalClassifier{

  classify(results){

    const signals = {
      search:0,
      graph:0,
      cognitive:0,
      civilization:0,
      consciousness:0,
      evolution:0,
      unknown:0
    };

    for(const r of results){

      const e = String(r.engine || r.source || "").toLowerCase();

      if(e.includes("search")) signals.search++;
      else if(e.includes("graph")) signals.graph++;
      else if(e.includes("cognitive")) signals.cognitive++;
      else if(e.includes("civilization")) signals.civilization++;
      else if(e.includes("consciousness")) signals.consciousness++;
      else if(e.includes("evolution")) signals.evolution++;
      else signals.unknown++;

    }

    return signals;

  }

}

/* =========================================================
   v60 LAYER
   Conflict Detection
========================================================= */

class EngineConflictResolver{

  detectConflicts(results){

    const conflicts = [];

    for(let i=0; i<results.length; i++){

      for(let j=i+1; j<results.length; j++){

        const a = results[i];
        const b = results[j];

        if(!a.title || !b.title) continue;

        const sameTitle = a.title && b.title && a.title === b.title;
        const oppositeIntent =
          a.intent && b.intent &&
          a.intent !== b.intent;

        const largeScoreGap =
          typeof a.score === "number" &&
          typeof b.score === "number" &&
          Math.abs(a.score - b.score) > 0.6;

        if(sameTitle && (oppositeIntent || largeScoreGap)){
          conflicts.push({
            type:"result_conflict",
            left:a.title,
            right:b.title,
            engines:[a.engine,b.engine]
          });
        }

      }

    }

    return conflicts;

  }

  reduceConflicts(results){

    const dedupMap = new Map();

    for(const r of results){

      const key = (r.url || r.title || JSON.stringify(r)).toLowerCase();

      if(!dedupMap.has(key)){
        dedupMap.set(key, r);
        continue;
      }

      const existing = dedupMap.get(key);

      const existingScore = this.preferenceScore(existing);
      const currentScore = this.preferenceScore(r);

      if(currentScore > existingScore){
        dedupMap.set(key, r);
      }

    }

    return Array.from(dedupMap.values());

  }

  preferenceScore(r){

    let score = 0;

    if(typeof r.qualityScore === "number") score += r.qualityScore;
    else if(typeof r.score === "number") score += r.score;

    if(typeof r.trust === "number") score += r.trust;

    if(r.engine && r.engine.includes("civilization")) score += 0.10;
    if(r.engine && r.engine.includes("cognitive")) score += 0.10;
    if(r.engine && r.engine.includes("search")) score += 0.05;

    return score;

  }

}

/* =========================================================
   v70 LAYER
   Meta Insight Synthesis
========================================================= */

class MetaInsightSynthesizer{

  synthesize(results, signals, conflicts){

    const meta = {
      dominantAxis:this.detectDominantAxis(signals),
      engineBalance:this.detectEngineBalance(signals),
      coherence:this.detectCoherence(results, conflicts),
      strategicWeight:this.detectStrategicWeight(results),
      narrative:this.detectNarrative(results)
    };

    return meta;

  }

  detectDominantAxis(signals){

    const pairs = Object.entries(signals || {});
    pairs.sort((a,b) => b[1] - a[1]);

    return pairs.length ? pairs[0][0] : "unknown";

  }

  detectEngineBalance(signals){

    const values = Object.values(signals || {});
    const total = values.reduce((a,b) => a+b, 0);

    if(total === 0) return "empty";
    if(values.filter(v => v > 0).length >= 4) return "multi-engine-balanced";
    if(values.filter(v => v > 0).length >= 2) return "moderately-balanced";

    return "single-engine-dominant";

  }

  detectCoherence(results, conflicts){

    if(!results.length) return "low";
    if(conflicts.length === 0) return "high";
    if(conflicts.length < 3) return "medium";

    return "low";

  }

  detectStrategicWeight(results){

    let score = 0;

    for(const r of results){

      const text = `${r.title} ${r.summary} ${r.type} ${r.intent}`.toLowerCase();

      if(text.includes("risk")) score += 2;
      if(text.includes("future")) score += 2;
      if(text.includes("civilization")) score += 2;
      if(text.includes("conflict")) score += 3;
      if(text.includes("recovery")) score += 2;
      if(text.includes("strategy")) score += 3;

    }

    if(score >= 20) return "high";
    if(score >= 8) return "medium";

    return "low";

  }

  detectNarrative(results){

    let growth = 0;
    let risk = 0;
    let recovery = 0;

    for(const r of results){

      const text = `${r.title} ${r.summary}`.toLowerCase();

      if(text.includes("innovation") || text.includes("growth")) growth++;
      if(text.includes("risk") || text.includes("conflict")) risk++;
      if(text.includes("recovery") || text.includes("restore")) recovery++;

    }

    if(risk > growth && risk > recovery) return "risk-dominant";
    if(recovery > risk && recovery > growth) return "recovery-dominant";
    if(growth > risk && growth > recovery) return "growth-dominant";

    return "mixed-narrative";

  }

}

/* =========================================================
   v80 LAYER
   Strategic Consensus + Organic Integration
========================================================= */

class StrategicConsensusLayer{

  buildConsensus(results, meta){

    const consensus = {
      priority:this.detectPriority(meta, results),
      direction:this.detectDirection(meta, results),
      confidence:this.detectConfidence(meta, results),
      recommendedMode:this.detectMode(meta, results)
    };

    return consensus;

  }

  detectPriority(meta, results){

    if(meta.strategicWeight === "high") return "strategic";
    if(meta.dominantAxis === "civilization") return "civilization";
    if(meta.dominantAxis === "cognitive") return "reasoning";
    if(meta.dominantAxis === "search") return "discovery";

    return results.length ? "integration" : "idle";

  }

  detectDirection(meta, results){

    if(meta.narrative === "risk-dominant") return "stabilize";
    if(meta.narrative === "recovery-dominant") return "restore";
    if(meta.narrative === "growth-dominant") return "expand";
    if(meta.engineBalance === "multi-engine-balanced") return "harmonize";

    return results.length ? "observe" : "wait";

  }

  detectConfidence(meta, results){

    let score = 0.5;

    if(meta.coherence === "high") score += 0.25;
    if(meta.engineBalance === "multi-engine-balanced") score += 0.15;
    if(results.length >= 10) score += 0.10;

    if(score > 1) score = 1;

    return score;

  }

  detectMode(meta){

    if(meta.coherence === "low") return "cautious";
    if(meta.strategicWeight === "high") return "strategic";
    if(meta.engineBalance === "multi-engine-balanced") return "integrated";

    return "standard";

  }

}

/* =========================================================
   PLANETARY COGNITIVE LAYER (확장)
========================================================= */

class PlanetaryCognitiveLayer{

  constructor(){
    this.normalizer = new ResultNormalizer();
    this.classifier = new EngineSignalClassifier();
    this.conflictResolver = new EngineConflictResolver();
    this.synthesizer = new MetaInsightSynthesizer();
    this.consensusLayer = new StrategicConsensusLayer();
  }

  integrate(results){

    const safe = validateResults(results);
    const normalized = this.normalizer.normalize(safe);
    const reduced = this.conflictResolver.reduceConflicts(normalized);
    const signals = this.classifier.classify(reduced);
    const conflicts = this.conflictResolver.detectConflicts(reduced);
    const meta = this.synthesizer.synthesize(reduced, signals, conflicts);
    const consensus = this.consensusLayer.buildConsensus(reduced, meta);

    return {
      cognitiveSummary:"Integrated meta reasoning across MARU engines",
      unifiedInsight:reduced,
      signalProfile:signals,
      conflicts,
      meta,
      consensus,
      timestamp:Date.now()
    };

  }

}

/* =========================================================
   MARU INTELLIGENCE ENGINE CORE
========================================================= */

class MARUIntelligenceEngine{

  constructor(){
    this.layer = new PlanetaryCognitiveLayer();
    this.memory = new IntelligenceMemory();
  }

  process(results){

    const cognition = this.layer.integrate(results);

    this.memory.remember({
      timestamp:Date.now(),
      count:Array.isArray(results) ? results.length : 0,
      consensus:cognition.consensus,
      dominantAxis:cognition.meta ? cognition.meta.dominantAxis : "unknown"
    });

    return {
      status:"ok",
      engine:"maru-intelligence-engine",
      version:VERSION,
      cognition,
      memory:{
        totalSessions:this.memory.count(),
        recent:this.memory.recallRecent(5)
      }
    };

  }

}

module.exports = MARUIntelligenceEngine;