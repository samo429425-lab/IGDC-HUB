"use strict";
const assert=require("assert");
const Registry=require("../netlify/functions/lib/revenue-provider-registry.v1");
const Sync=require("../netlify/functions/lib/revenue-provider-sync.v1");
const Confirmed=require("../netlify/functions/lib/confirmed-revenue-event.v1");
const Reconcile=require("../netlify/functions/lib/revenue-reconciliation.v1");

function makeStore(){
  const rows=[];
  return {
    rows,
    resolveConfig(){return{configured:true,valid:true};},
    async request(_config,route,init){
      const method=(init.method||"GET").toUpperCase();
      if(method==="GET"){
        const eq=route.match(/note=eq\.([^&]+)/); const like=route.match(/note=like\.([^&]+)/);
        let found=rows;
        if(eq){const note=decodeURIComponent(eq[1]);found=rows.filter(r=>r.note===note);}
        else if(like){const raw=decodeURIComponent(like[1]);const prefix=raw.endsWith("*")?raw.slice(0,-1):raw;found=rows.filter(r=>String(r.note||"").startsWith(prefix));}
        return {ok:true,status:200,data:found,unavailable:false};
      }
      if(method==="POST"){
        const body=JSON.parse(init.body||"[]");rows.push(...body);return{ok:true,status:201,data:body,unavailable:false};
      }
      return{ok:false,status:400,errorCode:"mock_method"};
    }
  };
}
function response(body,status=200){return{ok:status>=200&&status<300,status,async text(){return JSON.stringify(body);}};}

(async()=>{
  const env={
    TEST_PROVIDER_URL:"https://provider.example.test/settlements",
    IGDC_REVENUE_PROVIDERS_JSON:JSON.stringify([{id:"adnet",active:true,endpointEnv:"TEST_PROVIDER_URL",authType:"none",amountBasis:"gross",defaultKind:"ad_settlement",fields:{arrayPath:"results",eventId:"id",amount:"gross",currency:"ccy",status:"state",originalEventId:"originalId",timestamp:"ts"},financialFields:{taxAmount:"tax",providerFeeAmount:"fee"},confirmedValues:["settled"],reversedValues:["refunded"]}])
  };
  const providers=Registry.activeValid(env);
  assert.strictEqual(providers.length,1);
  const badEnv={TEST_PROVIDER_URL:"https://provider.example.test/settlements",IGDC_REVENUE_PROVIDERS_JSON:JSON.stringify([{id:"bad",active:true,endpointEnv:"TEST_PROVIDER_URL",authType:"none",amountBasis:"gross",fields:{eventId:"id",amount:"amount",status:"status"}}])};
  assert.ok(Registry.list(badEnv)[0].errors.includes("gross_amount_requires_deduction_field_mapping"));

  const providerBody={results:[{id:"s1",gross:"100.00",tax:"10.00",fee:"5.25",ccy:"USD",state:"settled",ts:"2026-09-11T00:00:00Z"},{id:"s2",gross:"-20.00",ccy:"USD",state:"refunded",originalId:"s1",ts:"2026-09-11T00:30:00Z"}]};
  const fetch=async()=>response(providerBody);
  const store=makeStore();
  const deps={env,fetch,confirmedDeps:{store,config:{configured:true,valid:true}},now:()=>Date.parse("2026-09-11T01:00:00Z")};
  let out=await Sync.run(deps);
  assert.strictEqual(out.ok,true);
  assert.strictEqual(out.providers[0].recorded,2);
  assert.strictEqual(out.providers[0].costRows,2);
  assert.deepStrictEqual(store.rows.map(r=>r.amount),["100","-10","-5.25","-20"]);
  const net=store.rows.reduce((a,r)=>a+Number(r.amount),0);
  assert.strictEqual(net,64.75);

  // Replay is idempotent.
  out=await Sync.run(deps);
  assert.strictEqual(out.providers[0].duplicates,2);
  assert.strictEqual(store.rows.length,4);

  // Cost rows are factual accounting entries, not capped as refund reversals.
  let cost=await Confirmed.persist({source:"adnet",eventId:"extra-cost",state:"cost",kind:"ad_settlement_other_cost",amount:"120",currency:"USD",channel:"provider_sync_cost",note:"provider:adnet:s1:cost:manual"},{store,config:{configured:true,valid:true}});
  assert.strictEqual(cost.ok,true);
  assert.strictEqual(cost.row.amount,"-120");

  // Reconcile original provider report against ledger rows.
  const rec=await Reconcile.run({env,fetch,ledgerDeps:{store,config:{configured:true,valid:true}}});
  assert.strictEqual(rec.ok,true);
  assert.strictEqual(rec.providers[0].mismatchCount,0);

  // Tamper a confirmed amount and reconciliation must detect it.
  store.rows.find(r=>r.note==="provider:adnet:s1").amount="99";
  const bad=await Reconcile.run({env,fetch,ledgerDeps:{store,config:{configured:true,valid:true}}});
  assert.strictEqual(bad.ok,false);
  assert.ok(bad.providers[0].mismatches.some(x=>x.type==="amount_mismatch"));

  console.log(JSON.stringify({ok:true,registryVersion:Registry.VERSION,syncVersion:Sync.VERSION,eventVersion:Confirmed.VERSION,reconcileVersion:Reconcile.VERSION,netBeforeManualCost:64.75,replayRows:4,reconciliationTamperDetected:true},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
