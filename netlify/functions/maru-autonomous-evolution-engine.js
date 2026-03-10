"use strict";

/*
MARU Autonomous Evolution Engine v70
------------------------------------
Upgrade Path
v50-1 → v60 → v70

Added Layers
- Evolution Intelligence Layer
- System Pressure Analyzer
- Self Adaptive Evolution Core
- Civilization Interaction Layer
*/

const VERSION = "maru-autonomous-evolution-engine-v70";

/* ================= CORE ENGINE ================= */

class AutonomousEvolutionEngine {

    constructor(config = {}){

        this.evolutionMemory = [];

        this.security = {
            mutationLimit: 0.8,
            exploitThreshold: 0.7
        };

        this.governance = {
            founderDirective: null,
            architectDirectives: []
        };

        this.logosPrinciples = {
            lifeProtection: 1.0,
            compassion: 1.0,
            peace: 1.0,
            truth: 1.0,
            restoration: 1.0
        };

        /* v60 */

        this.environment = {
            innovationPressure:0,
            collapsePressure:0,
            riskPressure:0,
            recoveryPressure:0
        };

        /* v70 */

        this.metaLearning = {
            adaptationScore:1.0,
            mutationControl:0.5
        };

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
            founder: this.governance.founderDirective,
            architects: this.governance.architectDirectives
        };

    }

    /* ================= Security ================= */

    validateDirective(directive){

        if(!directive) return false;

        if(directive.signatureInvalid)
            return false;

        if(directive.exploitRisk &&
           directive.exploitRisk > this.security.exploitThreshold)
            return false;

        return true;

    }

    evolutionBoundary(signal){

        if(signal.mutationRisk &&
           signal.mutationRisk > this.security.mutationLimit)
            return false;

        return true;

    }

    /* ================= Logos ================= */

    logosAdjustment(signal){

        let modifier = 1;

        if(signal.type === "violence")
            modifier *= 0.25 * this.logosPrinciples.peace;

        if(signal.lifeImpact !== undefined && signal.lifeImpact < 0)
            modifier *= 0.4 * this.logosPrinciples.lifeProtection;

        if(signal.intent === "harm")
            modifier *= 0.35 * this.logosPrinciples.compassion;

        if(signal.truthConfidence !== undefined && signal.truthConfidence < 0.5)
            modifier *= 0.5 * this.logosPrinciples.truth;

        if(signal.recoveryOpportunity)
            modifier *= 1.2 * this.logosPrinciples.restoration;

        return modifier;

    }

    /* ================= v60 Layer ================= */

    analyzeSystemPressure(signal){

        if(signal.type === "innovation")
            this.environment.innovationPressure += 1;

        if(signal.type === "risk")
            this.environment.riskPressure += 1;

        if(signal.type === "collapse")
            this.environment.collapsePressure += 1;

        if(signal.type === "recovery")
            this.environment.recoveryPressure += 1;

    }

    environmentVector(){

        return {
            innovation:this.environment.innovationPressure,
            risk:this.environment.riskPressure,
            collapse:this.environment.collapsePressure,
            recovery:this.environment.recoveryPressure
        };

    }

    /* ================= Evolution Vector ================= */

    generateEvolutionVector(signal, weight){

        let direction = "stabilize";

        if(signal.type === "innovation")
            direction = "expand";

        if(signal.type === "risk")
            direction = "contain";

        if(signal.type === "conflict")
            direction = "deescalate";

        if(signal.type === "recovery")
            direction = "restore";

        return {
            direction,
            intensity: weight,
            signal
        };

    }

    /* ================= Strategy ================= */

    determineStrategy(vectors){

        const strategies = [];

        for(const v of vectors){

            let strategy = "monitor";

            if(v.direction === "expand")
                strategy = "system_growth";

            if(v.direction === "contain")
                strategy = "risk_mitigation";

            if(v.direction === "deescalate")
                strategy = "peace_stabilization";

            if(v.direction === "restore")
                strategy = "recovery_protocol";

            strategies.push({
                strategy,
                intensity: v.intensity,
                signal: v.signal
            });

        }

        return strategies;

    }

    /* ================= v70 Layer ================= */

    adaptiveMutationControl(strategies){

        const optimized = [];

        for(const s of strategies){

            let modifier = this.metaLearning.adaptationScore;

            if(s.strategy === "system_growth")
                modifier *= 1.2;

            if(s.strategy === "risk_mitigation")
                modifier *= 0.8;

            optimized.push({
                strategy:s.strategy,
                intensity:s.intensity * modifier,
                signal:s.signal
            });

        }

        return optimized;

    }

    civilizationSignalIntegration(signals){

        const merged = [];

        for(const s of signals){

            if(s.source === "civilization")
                merged.push({weight:1.2,signal:s});

            else if(s.source === "cognitive")
                merged.push({weight:1.1,signal:s});

            else
                merged.push({weight:1,signal:s});

        }

        return merged;

    }

    /* ================= Memory ================= */

    recordEvolution(event){

        this.evolutionMemory.push(event);

        if(this.evolutionMemory.length > 50000)
            this.evolutionMemory.shift();

    }

    /* ================= Execution ================= */

    run(guidance){

        const vectors = [];

        const signals = this.civilizationSignalIntegration(guidance);

        for(const g of signals){

            const signal = g.signal;

            this.analyzeSystemPressure(signal);

            if(!this.evolutionBoundary(signal))
                continue;

            const weight = g.weight || 1;

            const vector = this.generateEvolutionVector(signal, weight);

            vectors.push(vector);

        }

        let strategies = this.determineStrategy(vectors);

        strategies = this.adaptiveMutationControl(strategies);

        const plan = [];

        for(const s of strategies){

            const modifier = this.logosAdjustment(s.signal);

            plan.push({
                strategy: s.strategy,
                intensity: s.intensity * modifier,
                signal: s.signal
            });

        }

        const governance = this.governanceVector();

        return {
            version: VERSION,
            governance,
            environment:this.environmentVector(),
            evolutionPlan: plan
        };

    }

}

module.exports = {
    AutonomousEvolutionEngine
};