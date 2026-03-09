
/*
MARU Planetary Data Connector v2.0
----------------------------------
Purpose
- Allow global data to flow into MARU without storing all data locally
- Provide discovery capability for new sources
- Maintain compatibility with existing Collector architecture

Layers
1. Source Adapter Layer
2. Discovery Engine
3. Failover / Resilience Slot
4. Intelligence Feedback Hook

This file is designed as an expansion layer and does not break existing behavior.
*/

"use strict";


/* ======================================================
SOURCE ADAPTER REGISTRY
====================================================== */

const SOURCE_ADAPTERS = {};

function registerSourceAdapter(name, adapter){
    SOURCE_ADAPTERS[name] = adapter;
}


/* ======================================================
SOURCE REGISTRY
====================================================== */

const SOURCE_REGISTRY = {};

function registerSource(name, config){
    SOURCE_REGISTRY[name] = config;
}


/* ======================================================
DISCOVERY ENGINE
====================================================== */

const DISCOVERY_INDEX = new Map();

function discoverSource(sourceName, meta){

    if(!DISCOVERY_INDEX.has(sourceName)){
        DISCOVERY_INDEX.set(sourceName, {
            name: sourceName,
            meta,
            discoveredAt: Date.now()
        });
    }

}

function listDiscoveredSources(){

    return Array.from(DISCOVERY_INDEX.values());

}


/* ======================================================
FAILOVER HANDLERS (Resilience slot)
====================================================== */

const FAILOVER_HANDLERS = {};

function registerFailover(name, handler){
    FAILOVER_HANDLERS[name] = handler;
}


/* ======================================================
INTELLIGENCE FEEDBACK SLOT
====================================================== */

let INTELLIGENCE_FEEDBACK = null;

function setIntelligenceFeedback(fn){
    INTELLIGENCE_FEEDBACK = fn;
}


/* ======================================================
DEFAULT GLOBAL SOURCES
====================================================== */

function getDefaultSources(){

    return [
        "search",
        "news",
        "open-data",
        "research",
        "media",
        "sns"
    ];

}


/* ======================================================
CONNECTOR CORE
====================================================== */

async function connect(event){

    const query = event.queryStringParameters || {};
    const sources = getDefaultSources();

    const results = [];

    for(const source of sources){

        try{

            const adapter = SOURCE_ADAPTERS[source];

            if(adapter){

                const data = await adapter(query);

                results.push({
                    source,
                    data
                });

                discoverSource(source, {active:true});

            }else{

                discoverSource(source, {adapter:false});

            }

        }catch(err){

            const fail = FAILOVER_HANDLERS[source];

            if(fail){

                const data = await fail(query);

                results.push({
                    source,
                    data,
                    failover:true
                });

            }

        }

    }

    if(INTELLIGENCE_FEEDBACK){
        INTELLIGENCE_FEEDBACK(results);
    }

    return {
        query,
        sources,
        discovered: listDiscoveredSources(),
        results
    };

}


/* ======================================================
EXPORTS
====================================================== */

module.exports = {
    connect,
    registerSourceAdapter,
    registerSource,
    registerFailover,
    setIntelligenceFeedback,
    discoverSource,
    listDiscoveredSources
};
