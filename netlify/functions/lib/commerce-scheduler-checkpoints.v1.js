'use strict';
// Scheduler-only checkpoint projection. Fetch only active scope IDs; bounded
// batches avoid oversized URLs and do not truncate expanded country regions.
const CHUNK=50;
async function readActiveCheckpoints(store,hub,fields,ids){
  const unique=[...new Set(ids)];
  if(unique.some(id=>typeof id!=='string'||!(/^[a-z0-9_-]+$/).test(id)))throw new Error('invalid_automation_checkpoint_id');
  const all=[];
  for(let i=0;i<unique.length;i+=CHUNK){
    const batch=unique.slice(i,i+CHUNK);
    const rows=await store.select('gslot_policies',fields+'&scope_hub=eq.'+encodeURIComponent(hub)+'&id=in.('+batch.map(encodeURIComponent).join(',')+')&limit='+batch.length);
    if(!Array.isArray(rows))throw new Error('automation_checkpoint_read_invalid');
    all.push(...rows);
  }
  return all;
}
module.exports={readActiveCheckpoints};
