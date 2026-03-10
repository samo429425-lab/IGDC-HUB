"use strict";

/*
MARU Consciousness Engine v70
------------------------------------------------------
Civilization Guidance + Strategic Signal Engine

Upgrade
v50-1 → v60 → v70

Added
- Collective Signal Analysis
- Narrative Conflict Detection
- Strategic Guidance Layer
- Coherence Engine
*/

const VERSION = "maru-consciousness-engine-v70";

class ConsciousnessEngine {

    constructor(config = {}) {

        this.psom = config.psom || {};
        this.memory = [];
        this.nodes = [];
        this.signals = [];

        this.security = {
            anomalyThreshold: 0.7,
            minTrust: 0.2
        };

        this.governance = {
            founderDirective: null,
            architectDirectives: []
        };

        this.logos = {
            lifeProtectionWeight: 1.0,
            truthWeight: 1.0,
            compassionWeight: 1.0
        };

        /* v60 */

        this.collectiveState = {
            stability:1,
            tension:0,
            manipulationRisk:0
        };

    }

    /* ================= Signal Nodes ================= */

    registerRadarNode(node){
        this.nodes.push(node);
    }

    collectSignals(){

        const collected = [];

        for(const node of this.nodes){

            try{

                const data = node();

                if(data && data.length)
                    collected.push(...data);

            }catch(e){}

        }

        this.signals = collected;

        return collected;

    }

    /* ================= Security ================= */

    securityFilter(signal){

        let weight = 1;

        if(signal.sourceTrust !== undefined)
            weight *= signal.sourceTrust;

        if(signal.deepfakeRisk !== undefined)
            weight *= (1 - signal.deepfakeRisk);

        if(signal.botLikelihood !== undefined)
            weight *= (1 - signal.botLikelihood);

        if(signal.manipulationNetworkRisk !== undefined)
            weight *= (1 - signal.manipulationNetworkRisk);

        if(signal.anomalyScore !== undefined &&
           signal.anomalyScore > this.security.anomalyThreshold)
            weight *= 0.2;

        return weight;

    }

    /* ================= Truth ================= */

    truthConfidence(signal){

        let confidence = 1;

        if(signal.sourceTrust !== undefined)
            confidence *= signal.sourceTrust;

        if(signal.confidence !== undefined)
            confidence *= signal.confidence;

        if(signal.deepfakeRisk !== undefined)
            confidence *= (1 - signal.deepfakeRisk);

        return confidence;

    }

    /* ================= Logos ================= */

    logosAlignment(signal){

        let alignment = 1;

        if(signal.lifeImpact !== undefined && signal.lifeImpact < 0)
            alignment *= 0.5 * this.logos.lifeProtectionWeight;

        if(signal.intent === "harm")
            alignment *= 0.3 * this.logos.compassionWeight;

        return alignment;

    }

    /* ================= History ================= */

    analyzeHistory(signal){

        let risk = 0;

        for(const m of this.memory){

            if(m.type && signal.type && m.type === signal.type)
                risk += 0.003;

        }

        return risk;

    }

    recordEvent(event){

        this.memory.push(event);

        if(this.memory.length > 50000)
            this.memory.shift();

    }

    /* ================= v60 Collective Analysis ================= */

    collectiveSignalAnalysis(signal){

        if(signal.type === "conflict")
            this.collectiveState.tension += 0.05;

        if(signal.manipulationNetworkRisk)
            this.collectiveState.manipulationRisk += 0.05;

        if(signal.type === "recovery")
            this.collectiveState.stability += 0.05;

    }

    collectiveVector(){

        return {
            stability:this.collectiveState.stability,
            tension:this.collectiveState.tension,
            manipulation:this.collectiveState.manipulationRisk
        };

    }

    /* ================= Narrative Conflict Detection ================= */

    narrativeConflict(signal){

        if(signal.type === "conflict" && signal.intent === "harm")
            return "destructive_narrative";

        if(signal.type === "recovery")
            return "restoration_narrative";

        if(signal.type === "innovation")
            return "progress_narrative";

        return "neutral_narrative";

    }

    /* ================= Signal Coherence ================= */

    coherenceScore(signal){

        let score = 1;

        if(signal.truthConfidence !== undefined)
            score *= signal.truthConfidence;

        if(signal.sourceTrust !== undefined)
            score *= signal.sourceTrust;

        if(signal.manipulationNetworkRisk !== undefined)
            score *= (1 - signal.manipulationNetworkRisk);

        return score;

    }

    /* ================= Evaluation ================= */

    evaluateSignals(){

        const collected = this.collectSignals();

        const guidance = [];

        for(const signal of collected){

            this.collectiveSignalAnalysis(signal);

            const security = this.securityFilter(signal);
            const truth = this.truthConfidence(signal);
            const logos = this.logosAlignment(signal);
            const history = this.analyzeHistory(signal);

            const coherence = this.coherenceScore(signal);

            const weight =
                security *
                truth *
                logos *
                coherence *
                (1 - history);

            if(weight < this.security.minTrust)
                continue;

            guidance.push({
                signal,
                weight,
                narrative:this.narrativeConflict(signal),
                truthConfidence:truth,
                securityScore:security
            });

        }

        return guidance;

    }

    /* ================= Strategic Guidance ================= */

    strategicGuidance(guidance){

        const decisions=[];

        for(const g of guidance){

            let direction="observe";

            if(g.signal.type==="conflict")
                direction="deescalate";

            if(g.signal.type==="innovation")
                direction="encourage";

            if(g.signal.type==="risk")
                direction="contain";

            if(g.signal.type==="recovery")
                direction="support";

            decisions.push({
                direction,
                weight:g.weight,
                signal:g.signal
            });

        }

        return decisions;

    }

    /* ================= Governance ================= */

    setFounderDirective(directive){
        this.governance.founderDirective = directive;
    }

    addArchitectDirective(directive){
        this.governance.architectDirectives.push(directive);
    }

    governanceVector(){

        return {
            founder:this.governance.founderDirective,
            architects:this.governance.architectDirectives
        };

    }

    /* ================= Execution ================= */

    run(){

        const guidance = this.evaluateSignals();

        const strategy = this.strategicGuidance(guidance);

        const governance = this.governanceVector();

        return {
            version:VERSION,
            guidance,
            strategy,
            collective:this.collectiveVector(),
            governance
        };

    }

}

module.exports = {
    ConsciousnessEngine
};