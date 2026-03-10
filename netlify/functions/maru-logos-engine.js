"use strict";

/*
MARU Logos Engine v70
---------------------------------------------------
Upgrade Path
v50 → v60 → v70

New Features
1. Civilization Ethics Analyzer
2. Multi-Signal Ethical Weighing
3. Narrative Alignment Detection
4. Civilization Pattern Memory
5. Strategic Moral Guidance Layer

Compatibility
- Consciousness Engine
- Civilization Engine
- Evolution Engine
- Intelligence Engine
*/

const VERSION = "maru-logos-engine-v70";

/* =========================================
   PRINCIPLES
========================================= */

class LogosEngine {

    constructor(config = {}) {

        this.principles = {

            truth: 1.0,
            compassion: 1.0,
            mercy: 1.0,
            humility: 1.0,
            peacemaking: 1.0,
            forgiveness: 1.0,
            justice: 1.0,
            lifeProtection: 1.0,
            restoration: 1.0,
            stewardshipOfCreation: 1.0

        };

        /* civilization memory */

        this.civilizationMemory = [];

        /* v60 */

        this.patternMemory = [];

        /* v70 */

        this.narrativeState = {
            conflict:0,
            recovery:0,
            manipulation:0
        };

    }

    /* =========================================
       CORE SIGNAL EVALUATION
    ========================================= */

    evaluateSignal(signal){

        let weight = 1;

        if(signal.intent === "harm")
            weight *= 0.25 * this.principles.compassion;

        if(signal.type === "violence")
            weight *= 0.2 * this.principles.peacemaking;

        if(signal.intent === "revenge")
            weight *= 0.4 * this.principles.forgiveness;

        if(signal.lifeImpact !== undefined && signal.lifeImpact < 0)
            weight *= 0.35 * this.principles.lifeProtection;

        if(signal.environmentImpact !== undefined && signal.environmentImpact < 0)
            weight *= 0.5 * this.principles.stewardshipOfCreation;

        if(signal.truthConfidence !== undefined && signal.truthConfidence < 0.5)
            weight *= 0.5 * this.principles.truth;

        return weight;

    }

    /* =========================================
       HEALING VECTOR
    ========================================= */

    compassionHealingVector(signal){

        let healing = 1;

        if(signal.humanSuffering)
            healing *= 1.3 * this.principles.mercy;

        if(signal.recoveryOpportunity)
            healing *= 1.2 * this.principles.restoration;

        return healing;

    }

    /* =========================================
       CIVILIZATION MEMORY
    ========================================= */

    recordCivilizationEvent(event){

        this.civilizationMemory.push(event);

        if(this.civilizationMemory.length > 30000)
            this.civilizationMemory.shift();

    }

    historicalWisdomAdjustment(signal){

        let modifier = 1;

        for(const event of this.civilizationMemory){

            if(event.type && signal.type && event.type === signal.type)
                modifier *= 0.995;

        }

        return modifier;

    }

    /* =========================================
       v60 PATTERN MEMORY
    ========================================= */

    recordPattern(pattern){

        this.patternMemory.push(pattern);

        if(this.patternMemory.length > 20000)
            this.patternMemory.shift();

    }

    detectPattern(signal){

        if(signal.type === "conflict")
            return "civilization_conflict_pattern";

        if(signal.type === "recovery")
            return "civilization_recovery_pattern";

        if(signal.type === "innovation")
            return "civilization_growth_pattern";

        return "neutral_pattern";

    }

    /* =========================================
       v70 NARRATIVE DETECTION
    ========================================= */

    detectNarrative(signal){

        if(signal.type === "conflict"){
            this.narrativeState.conflict++;
            return "destructive_narrative";
        }

        if(signal.type === "recovery"){
            this.narrativeState.recovery++;
            return "restoration_narrative";
        }

        if(signal.manipulationRisk){
            this.narrativeState.manipulation++;
            return "manipulation_narrative";
        }

        return "neutral_narrative";

    }

    narrativeVector(){

        return {

            conflict:this.narrativeState.conflict,
            recovery:this.narrativeState.recovery,
            manipulation:this.narrativeState.manipulation

        };

    }

    /* =========================================
       MULTI SIGNAL ETHICAL WEIGHING
    ========================================= */

    combineSignals(signals){

        let total = 0;

        for(const s of signals){

            const base = this.evaluateSignal(s);
            const heal = this.compassionHealingVector(s);
            const hist = this.historicalWisdomAdjustment(s);

            total += base * heal * hist;

        }

        return total / (signals.length || 1);

    }

    /* =========================================
       GUIDANCE GENERATION
    ========================================= */

    generateGuidance(signals){

        const guidance = [];

        for(const signal of signals){

            const baseWeight = this.evaluateSignal(signal);
            const healing = this.compassionHealingVector(signal);
            const history = this.historicalWisdomAdjustment(signal);

            const pattern = this.detectPattern(signal);
            const narrative = this.detectNarrative(signal);

            this.recordPattern(pattern);

            const logosWeight =
                baseWeight *
                healing *
                history;

            guidance.push({

                signal,
                logosWeight,
                pattern,
                narrative

            });

        }

        return guidance;

    }

    /* =========================================
       STRATEGIC GUIDANCE
    ========================================= */

    strategicGuidance(signals){

        const ethicalScore = this.combineSignals(signals);

        let direction = "neutral";

        if(ethicalScore < 0.4)
            direction = "risk_containment";

        if(ethicalScore > 1.2)
            direction = "restoration_support";

        return {

            ethicalScore,
            direction,
            narrativeVector:this.narrativeVector()

        };

    }

    /* =========================================
       ENGINE EXECUTION
    ========================================= */

    run(signals=[]){

        const guidance = this.generateGuidance(signals);

        const strategy = this.strategicGuidance(signals);

        return {

            version: VERSION,
            guidance,
            strategy

        };

    }

}

module.exports = {
    LogosEngine
};