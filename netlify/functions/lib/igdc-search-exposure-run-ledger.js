"use strict";
/* IGDC search-only, SQL-free execution receipt. No URL lists, query text,
   user data, provider response bodies, or credentials are persisted. */
const STORE_PREFIX="igdc-search-execution-";
const KEY="latest";
function location(){
  // Preview/branch deploys must not overwrite production execution evidence.
  const context=String(process.env.CONTEXT||"unknown").toLowerCase();
  return STORE_PREFIX+(context==="production"?"production":context.replace(/[^a-z0-9-]/g,"-").slice(0,35));
}
function safeNum(n){const x=Number(n);return Number.isFinite(x)?Math.max(0,Math.trunc(x)):0;}
function summary(report){
  const a=report&&report.submissionSummary||{};
  return{
    run_at:String(report&&report.generatedAt||new Date().toISOString()),
    result_status:String(report&&report.status||"unknown").slice(0,50),
    registry_hash:String(report&&report.registry&&report.registry.hash||"").slice(0,80),
    changed_count:safeNum(report&&report.changedUrls),
    submitted_count:safeNum(a.submitted),
    pending_count:safeNum(a.pending),
    failed_count:safeNum(a.failed),
    partial_count:safeNum(a.partial),
    // A handler invocation can be scheduled or manually triggered. Neither is assumed.
    trigger:"not-independently-verified",
    indexnow_providers:(report&&report.results||[]).filter(x=>x&&x.adapter==="indexnow")
     .flatMap(x=>Array.isArray(x.providers)?x.providers:[]).slice(0,3).map(x=>({
      engine:String(x.engine||"").slice(0,40),status:String(x.status||"").slice(0,40),
      http_status:Number.isInteger(Number(x.http&&x.http.statusCode))?Number(x.http.statusCode):null
     })),
    discovery:{
     unacknowledged_count:safeNum(report&&report.discovery&&report.discovery.unacknowledgedCandidates),
     batch_limit:safeNum(report&&report.discovery&&report.discovery.batchLimit),
     used_unacknowledged:safeNum(report&&report.discovery&&report.discovery.usedUnacknowledged),
     remaining_after_checkpoint:report?.discovery?.remainingAfterCheckpoint==null?null:safeNum(report.discovery.remainingAfterCheckpoint)
    },
    checkpoint:{
     state:String(report&&report.deduplication&&report.deduplication.checkpointState||"unknown").slice(0,36),
     write:String(report&&report.deduplication&&report.deduplication.checkpointWrite||"unknown").slice(0,36),
     acknowledged_revisions:safeNum(report&&report.deduplication&&report.deduplication.acknowledgedRevisions),
     duplicates_skipped:safeNum(report&&report.deduplication&&report.deduplication.duplicatesSkipped)
    },
    details:(report&&report.results||[]).filter(x=>x&&x.adapter).slice(0,16).map(x=>({
      engine:String(x.adapter).slice(0,40),
      state:String(x.status||"unknown").slice(0,48),
      count:Number.isFinite(Number(x.count))?safeNum(x.count):null
    }))
  };
}
function openStore(event){
  const blobs=require("@netlify/blobs");
  if(!blobs||typeof blobs.getStore!=="function"){
    const err=new Error("Blobs SDK export unavailable");err.code="BLOBS_SDK_UNAVAILABLE";throw err;
  }
  // A legacy Lambda event may carry a Netlify Blobs envelope. Some scheduled
  // invocations and runtimes omit it and use the SDK's injected environment.
  // connectLambda() decodes event.blobs unconditionally, so never call it when
  // that field is absent. Do not read, persist, or log envelope contents.
  const headers=event&&event.headers;
  const hasEnvelope=typeof(event&&event.blobs)==="string"&&event.blobs.length>0;
  const hasSiteHeader=!!(headers&&typeof headers["x-nf-site-id"]==="string"&&headers["x-nf-site-id"]);
  if(hasEnvelope&&hasSiteHeader&&typeof blobs.connectLambda==="function"){
    blobs.connectLambda(event);
  }
  // A single latest-run receipt does not require strong reads. The Lambda
  // envelope lacks uncachedEdgeURL, so use Netlify Blobs default eventual reads.
  return blobs.getStore({name:location()});
}
function reasonOf(e){
  const code=String(e&&e.code||"").toUpperCase();
  const message=String(e&&e.message||"").toLowerCase();
  const name=String(e&&e.name||"").toLowerCase();
  if(name==="blobsconsistencyerror")return "storage-consistency-unsupported";
  if(name==="missingblobsenvironmenterror")return "runtime-context-missing";
  if(name==="invalidblobstorenameerror"||name==="invalidblobsregionerror")return "storage-configuration-invalid";
  if(["MODULE_NOT_FOUND","ERR_MODULE_NOT_FOUND","BLOBS_SDK_UNAVAILABLE","ERR_REQUIRE_ESM"].includes(code))return "sdk-unavailable";
  if(/missingblobsenvironmenterror|environment has not been configured to use netlify blobs/.test(message))return "runtime-context-missing";
  if(code==="AUDIT_TIMEOUT"||/timed out|timeout|abort/.test(message))return "storage-timeout";
  if(/(site.?id|token|credentials|blobs.?context).*(missing|undefined|not configured)|missing.*(site.?id|token|credentials)/.test(message))return "runtime-context-missing";
  if(/401|403|unauthori[sz]ed|forbidden|permission/.test(message))return "storage-access-denied";
  if(["ECONNRESET","ENOTFOUND","ETIMEDOUT"].includes(code)||/fetch failed|econnreset|enotfound|network|dns/.test(message))return "storage-network-error";
  return "storage-error-other";
}

// Safe, read-only troubleshooting information. Never export exception messages,
// URLs, headers, event.blobs, tokens, stack traces or site identifiers.
function runtimeFlags(event){
  const h=event&&event.headers||{};
  const hasEnvelope=typeof(event&&event.blobs)==="string"&&event.blobs.length>0;
  return{
    lambdaEnvelopePresent:hasEnvelope,
    lambdaSiteHeaderPresent:typeof h["x-nf-site-id"]==="string"&&h["x-nf-site-id"].length>0,
    sdkContextPresent:!!(process.env.NETLIFY_BLOBS_CONTEXT||globalThis.netlifyBlobsContext),
    siteIdEnvPresent:!!(process.env.NETLIFY_SITE_ID||process.env.SITE_ID),
    runtimeKind:hasEnvelope?"lambda-envelope":"sdk-environment",
    deployContext:String(process.env.CONTEXT||"").toLowerCase()==="production"?"production":"non-production-or-unknown"
  };
}
function safeErrorField(value,limit){
  // Error names and codes are machine-readable identifiers only.
  const s=typeof value==="string"?value:"";
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(s)&&s.length<=limit?s:null;
}
function statusOf(e){
  const raw=e&&(e.statusCode??e.status??e.response?.status);
  const n=Number(raw);
  return Number.isInteger(n)&&n>=100&&n<=599?n:null;
}
function messagePattern(e){
  const m=String(e&&e.message||"").toLowerCase();
  if(/uncachededgeurl|strong consistency/.test(m))return "strong-consistency-unavailable";
  if(/environment has not been configured|missingblobsenvironmenterror|supply the following properties/.test(m))return "blobs-context-required";
  if(/invalid.+(store name|region)|invalidblobs/.test(m))return "invalid-store-configuration";
  if(/cannot read properties of undefined|cannot read property/.test(m))return "undefined-access";
  if(/invalid character|invalid base64|invalid encoding/.test(m))return "invalid-envelope-encoding";
  if(/unexpected token|json|not valid json/.test(m))return "json-decoding-failure";
  if(/url.+invalid|invalid url|failed to parse url/.test(m))return "invalid-endpoint-url";
  if(/forbidden|unauthori[sz]ed|permission denied/.test(m))return "access-rejected";
  if(/fetch failed|econnreset|enotfound|network/.test(m))return "network-failure";
  if(/timed out|timeout|abort/.test(m))return "timeout";
  return "unclassified";
}
function errorDetails(e,event,phase){
  const cause=e&&e.cause&&typeof e.cause==="object"?e.cause:null;
  return{
    phase,
    name:safeErrorField(e&&e.name,64),
    code:safeErrorField(e&&e.code,64),
    status:statusOf(e),
    causeName:safeErrorField(cause&&cause.name,64),
    causeCode:safeErrorField(cause&&cause.code,64),
    causeStatus:statusOf(cause),
    messagePattern:messagePattern(e),
    causePattern:cause?messagePattern(cause):null,
    runtime:runtimeFlags(event),
    rawErrorExposed:false
  };
}

async function bounded(operation){
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error("audit-timeout");e.code="AUDIT_TIMEOUT";reject(e);},5000);})
    ]);
  }finally{clearTimeout(timer);}
}
async function store(report,event){
  try{
    const record=summary(report);
    await bounded(()=>openStore(event).setJSON(KEY,record));
    return{state:"stored"};
   }catch(e){const reason=reasonOf(e);const diagnostic=errorDetails(e,event,"write");console.warn("[IGDC_SEARCH_RECEIPT_WRITE]",reason,diagnostic.name,diagnostic.code,diagnostic.status);return{state:"storage-unavailable",reason,diagnostic};}
}
async function readLatest(event){
  try{
    const data=await bounded(()=>openStore(event).get(KEY,{type:"json"}));
    if(!data||typeof data!=="object"||!data.run_at)return{state:"empty",record:null};
    return{state:"available",record:data};
   }catch(e){const reason=reasonOf(e);const diagnostic=errorDetails(e,event,"read");console.warn("[IGDC_SEARCH_RECEIPT_READ]",reason,diagnostic.name,diagnostic.code,diagnostic.status);return{state:"storage-unavailable",reason,record:null,diagnostic};}
}

const CHECKPOINT_KEY="submitted-checkpoints-v1";
const ADAPTERS=["indexnow","china-search","regional-search","baidu"];
async function readCheckpoints(event){
 try{
  const doc=await bounded(()=>openStore(event).get(CHECKPOINT_KEY,{type:"json"}));
  if(!doc)return{state:"empty",entries:{}};
  if(doc.version!==1||!doc.entries||typeof doc.entries!=="object"||Array.isArray(doc.entries))return{state:"invalid",entries:{}};
  const entries={};
  for(const name of ADAPTERS){const obj=doc.entries[name];entries[name]=obj&&typeof obj==="object"&&!Array.isArray(obj)?obj:{};}
  return{state:"available",entries};
 }catch(err){const reason=reasonOf(err);console.warn("[IGDC_SEARCH_CHECKPOINT_READ]",reason);return{state:"storage-unavailable",reason,entries:{}};}
}
// Read-only aggregate health for administrator diagnostic JSON. Never expose URL hashes or revisions.
async function checkpointHealth(event){
 const doc=await readCheckpoints(event);
 const adapters={};
 for(const name of ADAPTERS){
  const records=Object.values(doc.entries&&doc.entries[name]||{});
  const timestamps=records.map(r=>Number(r&&r.at)).filter(Number.isFinite);
  const max=timestamps.length?Math.max(...timestamps):0;
  adapters[name]={acknowledgedUrlCount:records.length,lastAcknowledgementAt:max?new Date(max).toISOString():null};
 }
 return {state:doc.state,reason:doc.reason||null,adapters,containsNoUrls:true};
}
async function storeCheckpoints(entries,event){
 try{
  const sanitized={};
  for(const name of ADAPTERS){
   const rows=Object.entries(entries&&entries[name]||{}).filter(([key,v])=>/^[a-f0-9]{64}$/.test(key)&&v&&/^[a-f0-9]{64}$/.test(String(v.revision||""))&&Number.isFinite(Number(v.at)));
   rows.sort((a,b)=>Number(b[1].at)-Number(a[1].at));
   sanitized[name]=Object.fromEntries(rows.slice(0,2500));
  }
  await bounded(()=>openStore(event).setJSON(CHECKPOINT_KEY,{version:1,entries:sanitized}));
  return{state:"stored"};
 }catch(err){const reason=reasonOf(err);console.warn("[IGDC_SEARCH_CHECKPOINT_WRITE]",reason);return{state:"storage-unavailable",reason};}
}
module.exports={store,readLatest,readCheckpoints,checkpointHealth,storeCheckpoints,_test:{location,summary,safeNum,reasonOf,errorDetails,runtimeFlags,messagePattern}};
