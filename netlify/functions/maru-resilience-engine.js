"use strict";

/*
MARU Resilience Engine v20
--------------------------------------------------
Upgrade from v15

New Features
1. Smart Retry System
2. Circuit Breaker Protection
3. Engine Health Monitor
4. Self-Healing Recovery
5. Failure Telemetry
*/

const VERSION = "maru-resilience-v20-self-healing";

/* ====================================
EXPLOIT DETECTION
=====================================*/

function detectExploit(response){

if(!response) return false;

const text = JSON.stringify(response).toLowerCase();

const exploits=[
"eval(",
"process.env",
"rm -rf",
"drop table",
"<script>",
"</script>",
"bash",
"cmd.exe",
"<iframe>",
"<object>"
];

return exploits.some(e=>text.includes(e));

}

/* ====================================
CIRCUIT BREAKER
=====================================*/

const CIRCUIT={};

function circuitCheck(engine){

const c=CIRCUIT[engine];

if(!c) return true;

if(c.failures<5) return true;

if(Date.now()-c.lastFail>30000){

c.failures=0;
return true;

}

return false;

}

function circuitFail(engine){

if(!CIRCUIT[engine])
CIRCUIT[engine]={failures:0,lastFail:0};

CIRCUIT[engine].failures++;
CIRCUIT[engine].lastFail=Date.now();

}

/* ====================================
HEALTH MONITOR
=====================================*/

const ENGINE_HEALTH={};

function recordHealth(engine,status){

ENGINE_HEALTH[engine]={
status,
time:Date.now()
};

}

function getHealth(engine){

return ENGINE_HEALTH[engine]||{status:"unknown"};

}

/* ====================================
SMART RETRY
=====================================*/

class ResilienceEngine{

constructor(){

this.maxRetryAttempts=7;

}

async attempt(engineName,fn,retry=0){

if(!circuitCheck(engineName))
throw new Error("Circuit breaker active for "+engineName);

try{

const res=await fn();

if(detectExploit(res))
throw new Error("Exploit detected");

recordHealth(engineName,"ok");

return res;

}catch(err){

circuitFail(engineName);

recordHealth(engineName,"fail");

if(retry<this.maxRetryAttempts){

const delay=this.computeDelay(retry);

await this.sleep(delay);

return this.attempt(engineName,fn,retry+1);

}

throw new Error("Maximum retry attempts reached");

}

}

computeDelay(retry){

return Math.min(2000*(retry+1),10000);

}

sleep(ms){

return new Promise(r=>setTimeout(r,ms));

}

}

/* ====================================
SELF HEALING
=====================================*/

function selfHeal(engine){

const health=getHealth(engine);

if(health.status==="fail"){

if(Date.now()-health.time>20000){

CIRCUIT[engine]={failures:0,lastFail:0};

recordHealth(engine,"recovered");

return true;

}

}

return false;

}

/* ====================================
TELEMETRY
=====================================*/

const TELEMETRY=[];

function logFailure(engine,error){

TELEMETRY.push({

engine,
error:String(error),
time:Date.now()

});

if(TELEMETRY.length>2000)
TELEMETRY.shift();

}

/* ====================================
EXPORT
=====================================*/

module.exports={

VERSION,

ResilienceEngine,

detectExploit,

selfHeal,

logFailure,

getHealth

};