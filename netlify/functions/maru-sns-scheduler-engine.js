/*
MARU SNS Scheduler Engine v3
High-stability distributed-ready scheduler
*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* CONFIG */

const DATA_DIR = path.join(process.cwd(), "data");

const QUEUE_FILE = path.join(DATA_DIR,"sns-scheduler-queue.json");
const HISTORY_FILE = path.join(DATA_DIR,"sns-scheduler-history.json");
const FAILED_FILE = path.join(DATA_DIR,"sns-scheduler-failed.json");
const METRICS_FILE = path.join(DATA_DIR,"sns-scheduler-metrics.json");
const LOCK_FILE = path.join(DATA_DIR,"sns-scheduler.lock");

const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 10000;

const RETRY_BACKOFF = [
 5*60*1000,
 15*60*1000,
 60*60*1000
];

/* UTILS */

function ensureDataDir(){
 if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
}

function readJSON(file,fallback){
 try{
  if(!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file));
 }catch{
  return fallback;
 }
}

function writeJSON(file,data){
 fs.writeFileSync(file,JSON.stringify(data,null,2));
}

function now(){
 return Date.now();
}

function uuid(){
 return "sns_"+Date.now()+"_"+Math.floor(Math.random()*100000);
}

function hashMedia(media){
 return crypto.createHash("sha1")
 .update(JSON.stringify(media))
 .digest("hex");
}

/* LOCK */

function acquireLock(){

 try{

  if(fs.existsSync(LOCK_FILE)){

   const ts = parseInt(fs.readFileSync(LOCK_FILE));

   if(now()-ts < 30000) return false;

  }

  fs.writeFileSync(LOCK_FILE,String(now()));

  return true;

 }catch{

  return false;

 }

}

function releaseLock(){
 try{
  if(fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
 }catch{}
}

/* DATA */

function loadQueue(){
 ensureDataDir();
 return readJSON(QUEUE_FILE,{jobs:[]});
}

function saveQueue(queue){
 writeJSON(QUEUE_FILE,queue);
}

function loadHistory(){
 return readJSON(HISTORY_FILE,{jobs:[]});
}

function saveHistory(history){
 writeJSON(HISTORY_FILE,history);
}

function loadFailed(){
 return readJSON(FAILED_FILE,{jobs:[]});
}

function saveFailed(data){
 writeJSON(FAILED_FILE,data);
}

function loadMetrics(){
 return readJSON(METRICS_FILE,{
  processed:0,
  published:0,
  failed:0
 });
}

function saveMetrics(metrics){
 writeJSON(METRICS_FILE,metrics);
}

/* CRASH RECOVERY */

function recoverStuckJobs(){

 const queue = loadQueue();
 const nowTime = now();

 for(const job of queue.jobs){

  if(job.status==="processing"){

   if(nowTime-job.createdAt>600000){

    job.status="retrying";
    job.publishAt=nowTime+60000;

   }

  }

 }

 saveQueue(queue);

}

/* TIME */

function resolvePublishTime(schedule){

 if(schedule.publishAt) return schedule.publishAt;
 if(schedule.localPublishTime){

  const date = new Date(schedule.localPublishTime);
  return date.getTime();

 }

 return null;

}

/* NORMALIZE */

function normalizeJob(payload){

 const publishTime = resolvePublishTime(payload.schedule);
 return {

  jobId:uuid(),

  status:"scheduled",

  createdAt:now(),
  priority:payload.schedule.priority || 5,
  publishAt:publishTime,
  schedule:payload.schedule,
  media:payload.media,
  mediaHash:hashMedia(payload.media),

  retry:0,

  history:[]

 };

}

/* API */

async function schedulePublish(payload){

 const queue = loadQueue();

 if(queue.jobs.length>=MAX_QUEUE_SIZE){
  throw new Error("Scheduler queue overflow");

 }

 const job = normalizeJob(payload);
 assignClusterJob(job);
 
 const duplicate = queue.jobs.find(j=>j.mediaHash===job.mediaHash);

 if(duplicate){
  return {duplicate:true,jobId:duplicate.jobId};

 }

 queue.jobs.push(job);
 queue.jobs.sort((a,b)=>a.priority-b.priority);
 saveQueue(queue);

 return {success:true,jobId:job.jobId};

}

async function cancelSchedule(jobId){

 const queue = loadQueue();
 queue.jobs.forEach(j=>{

  if(j.jobId===jobId) j.status="cancelled";

 });

 saveQueue(queue);

 return {success:true};

}

async function getScheduleStatus(jobId){

 const queue = loadQueue();
 const job = queue.jobs.find(j=>j.jobId===jobId);

 if(job) return job;
 const history = loadHistory();
 return history.jobs.find(j=>j.jobId===jobId) || null;

}

/* PUBLISH */

async function dispatchToPublisher(job){

 const publisher = require("./maru-sns-publisher-engine");
 const targets = job.media.broadcastTargets || [];
 await Promise.all(
  targets.map(platform=>
   publisher.publish(platform,job.media)

  )
 );
}

/* EXECUTION */

function isDue(job){

 if(job.status!=="scheduled" && job.status!=="retrying") return false;
 if(!job.publishAt) return false;
 return now()>=job.publishAt;
}

async function executeJob(job){
 const metrics = loadMetrics();
 job.status="processing";

 try{

  await dispatchToPublisher(job);
  
  job.status="published";
  job.history.push({
   time:now(),
   event:"published"
   
  });

  await runDistribution(job);

  metrics.published++;
  metrics.processed++;

  saveMetrics(metrics);

  archiveCompleted(job);

  return "success";

 }catch{

  job.retry++;

  metrics.failed++;
  metrics.processed++;

  saveMetrics(metrics);

  if(job.retry>MAX_RETRIES){

   job.status="failed";

   archiveFailed(job);

   return "failed";

  }

  const delay = RETRY_BACKOFF[job.retry-1] || 3600000;

  job.publishAt=now()+delay;

  job.status="retrying";

  job.history.push({

   time:now(),
   event:"retry",
   attempt:job.retry

  });

  return "retry";

 }

}

/* ARCHIVE */

function archiveCompleted(job){

 const history = loadHistory();

 history.jobs.push(job);

 saveHistory(history);

}

function archiveFailed(job){

 const failed = loadFailed();

 failed.jobs.push(job);

 saveFailed(failed);

}

/* SCHEDULER */

async function runScheduler(){

 recoverStuckJobs();

 if(!acquireLock()){

  return {status:"locked"};

 }

 const queue = loadQueue();

 const remaining=[];

 for(const job of queue.jobs){

  if(job.status==="cancelled") continue;

  if(isDue(job)){

   const result=await executeJob(job);

   if(result==="retry") remaining.push(job);

  }

  else{

   remaining.push(job);

  }

 }

 queue.jobs=remaining;

 saveQueue(queue);

 releaseLock();

 return {status:"ok",queueSize:queue.jobs.length};

}

/* RETRY FAILED */

async function retryFailed(){

 const failed = loadFailed();
 const queue = loadQueue();

 const retryable=[];

 for(const job of failed.jobs){

  if(job.retry<MAX_RETRIES){

   job.status="retrying";
   job.publishAt=now()+RETRY_BACKOFF[0];

   retryable.push(job);

  }

 }

 queue.jobs=queue.jobs.concat(retryable);

 failed.jobs=failed.jobs.filter(j=>j.retry>=MAX_RETRIES);

 saveQueue(queue);
 saveFailed(failed);

}

/* NETLIFY */

exports.handler=async function(){

 try{

  const result=await runClusterScheduler();
  await retryFailed();
  return{

   statusCode:200,
   body:JSON.stringify(result)

  };

 }catch(err){

  return{

   statusCode:500,
   body:JSON.stringify({error:err.message})

  };

 }

};

/* EXPORT */

module.exports={
 schedulePublish,
 cancelSchedule,
 runScheduler,
 retryFailed,
 getScheduleStatus
};

/* =========================================================
MARU Scheduler Cluster Extension
Attach below Scheduler v3
========================================================= */

const CLUSTER_NODE_FILE=path.join(DATA_DIR,"scheduler-nodes.json");

/* ---------------- NODE REGISTRY ---------------- */

function loadClusterNodes(){
 return readJSON(CLUSTER_NODE_FILE,{nodes:[]})
}

function registerSchedulerNode(nodeId){

 const data = loadClusterNodes()

 if(!data.nodes){
  data.nodes=[]
 }

 if(!data.nodes.includes(nodeId)){
  data.nodes.push(nodeId)
 }

 writeJSON(CLUSTER_NODE_FILE,data)

 return data.nodes

}

/* ---------------- NODE SELECTION ---------------- */

function selectSchedulerNode(){
 const data=loadClusterNodes();
 if(data.nodes.length===0) return null;
 const index=Math.floor(Math.random()*data.nodes.length);
 return data.nodes[index];
}

/* ---------------- JOB ASSIGNMENT ---------------- */

function assignClusterJob(job){
 const node=selectSchedulerNode();
 if(node){
  job.assignedNode=node;
 }
 return job;
}

/* =========================================================
Worker Engine
========================================================= */

const WORKER_ID=process.env.MARU_SCHEDULER_NODE||"node_default";

async function runClusterWorker(){

 const queue = loadQueue()
 const remaining=[]

 for(const job of queue.jobs){

  if(job.assignedNode && job.assignedNode!==WORKER_ID){
   remaining.push(job)
   continue
  }

  if(isDue(job)){

   const result = await executeJob(job)

   if(result==="retry"){
    remaining.push(job)
   }

  }else{

   remaining.push(job)

  }

 }

 queue.jobs = remaining

 saveQueue(queue)

}

/* =========================================================
Broadcast Network Engine
========================================================= */

const NETWORK_MAP_FILE=path.join(DATA_DIR,"sns-network-map.json");

function loadNetworkMap(){
 return readJSON(NETWORK_MAP_FILE,{platforms:[]});
}

async function broadcastNetwork(job){
 const map=loadNetworkMap();
 const publisher=require("./maru-sns-publisher-engine");
 const tasks=[];
 for(const platform of map.platforms){
  tasks.push(publisher.publish(platform,job.media));
 }
 await Promise.all(tasks);
}

/* =========================================================
AI Viral Expansion Engine
========================================================= */

async function viralBoost(job){
 const map=loadNetworkMap();
 const publisher=require("./maru-sns-publisher-engine");
 const targets=map.platforms||[];
 const rounds=3;
 for(let i=0;i<rounds;i++){
  await Promise.all(targets.map(p=>publisher.publish(p,job.media)));
 }
}

/* =========================================================
Global Timezone Broadcast
========================================================= */

const TIMEZONE_MAP=[
 "Asia/Seoul",
 "Asia/Tokyo",
 "Europe/London",
 "America/New_York",
 "America/Los_Angeles"
];

function scheduleGlobalBroadcast(job){
 const jobs=[];
 for(const zone of TIMEZONE_MAP){
  const copy=JSON.parse(JSON.stringify(job));
  copy.schedule.timezone=zone;
  jobs.push(copy);
 }
 return jobs;
}

/* =========================================================
Cluster Scheduler Runner
========================================================= */

async function runClusterScheduler(){
 registerSchedulerNode(WORKER_ID);
 await runClusterWorker();
}

/* =========================================================
EXPORT EXTENSIONS
========================================================= */

module.exports.runClusterScheduler=runClusterScheduler;
module.exports.broadcastNetwork=broadcastNetwork;
module.exports.viralBoost=viralBoost;
module.exports.assignClusterJob=assignClusterJob;
module.exports.registerSchedulerNode=registerSchedulerNode;

/* =========================================================
MARU Global Distribution Engine
Attach below Scheduler Cluster Engine
========================================================= */

const DISTRIBUTION_MAP_FILE=path.join(DATA_DIR,"distribution-map.json");

function loadDistributionMap(){
 return readJSON(DISTRIBUTION_MAP_FILE,{targets:[]});
}

function saveDistributionMap(data){
 writeJSON(DISTRIBUTION_MAP_FILE,data);
}

function registerDistributionTarget(target){
 const data=loadDistributionMap();
 if(!data.targets.find(t=>t.name===target.name)){
  data.targets.push(target);
 }
 saveDistributionMap(data);
 return data.targets;
}

/* ---------------- DISTRIBUTION ROUTER ---------------- */

function resolveDistributionTargets(media){
 const map=loadDistributionMap();
 const results=[];
 for(const target of map.targets){
  if(!target.types || target.types.includes(media.mediaType)){
   results.push(target);
  }
 }
 return results;
}

/* ---------------- SEARCH DISTRIBUTION ---------------- */

async function distributeSearch(job){
 const targets=resolveDistributionTargets(job.media);
 const tasks=[];
 for(const target of targets){
  if(target.channel==="search"){
   tasks.push(pushSearchIndex(target,job.media));
  }
 }
 await Promise.all(tasks);
}

async function pushSearchIndex(target,media){
 if(!target.endpoint) return;
 const payload={
  title:media.title,
  summary:media.summary,
 url:media.url,
  mediaType:media.mediaType,
  region:media.region
 };
}

/* ---------------- PORTAL DISTRIBUTION ---------------- */

async function distributePortal(job){
 const targets=resolveDistributionTargets(job.media);
 const tasks=[];
 for(const target of targets){
  if(target.channel==="portal"){
   tasks.push(pushPortalFeed(target,job.media));
  }
 }
 await Promise.all(tasks);
}

async function pushPortalFeed(target,media){
 if(!target.endpoint) return;
 const payload={
  title:media.title,
  thumb:media.thumb,
  url:media.url,
  category:media.mediaType
 };
}

/* ---------------- MEDIA NETWORK DISTRIBUTION ---------------- */

async function distributeMediaNetwork(job){
 const targets=resolveDistributionTargets(job.media);
 const tasks=[];
 for(const target of targets){
  if(target.channel==="media"){
   tasks.push(pushMediaNetwork(target,job.media));
  }
 }
 await Promise.all(tasks);
}

async function pushMediaNetwork(target,media){
 if(!target.endpoint) return;
 const payload={
  title:media.title,
  video:media.url,
  thumbnail:media.thumb
 };
}

/* ---------------- REGIONAL DISTRIBUTION ---------------- */

async function distributeRegional(job){
 const targets=resolveDistributionTargets(job.media);
 const tasks=[];
 for(const target of targets){
  if(target.channel==="regional"){
   tasks.push(pushRegionalFeed(target,job.media));
  }
 }
 await Promise.all(tasks);
}

async function pushRegionalFeed(target,media){
 if(!target.endpoint) return;
 const payload={
  region:media.region,
  title:media.title,
  url:media.url
 };
}

/* ---------------- MASTER DISTRIBUTION ---------------- */

async function runDistribution(job){
 await Promise.all([
  distributeSearch(job),
  distributePortal(job),
  distributeMediaNetwork(job),
  distributeRegional(job)
 ]);
}

/* ---------------- AUTO DISTRIBUTION HOOK ---------------- */

async function distributePublishedJob(job){
 if(job.status!=="published") return;
 await runDistribution(job);
}

/* ---------------- DISTRIBUTION METRICS ---------------- */

const DISTRIBUTION_METRICS_FILE=path.join(DATA_DIR,"distribution-metrics.json");

function loadDistributionMetrics(){
 return readJSON(DISTRIBUTION_METRICS_FILE,{distributed:0});
}

function saveDistributionMetrics(data){
 writeJSON(DISTRIBUTION_METRICS_FILE,data);
}

function recordDistribution(){
 const data=loadDistributionMetrics();
 data.distributed++;
 saveDistributionMetrics(data);
}

/* ---------------- EXPORT ---------------- */

module.exports.runDistribution=runDistribution;
module.exports.distributePublishedJob=distributePublishedJob;
module.exports.registerDistributionTarget=registerDistributionTarget;