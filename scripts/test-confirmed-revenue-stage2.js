"use strict";

const assert=require("assert");
const Confirmed=require("../netlify/functions/lib/confirmed-revenue-event.v1");
const Intake=require("../netlify/functions/lib/commerce-candidate-intake.v1");

function makeStore(){
  const rows=[];
  return {
    rows,
    resolveConfig(){ return {configured:true,valid:true}; },
    async request(_config,route,init){
      if((init.method||"GET")==="GET"){
        const eq=route.match(/note=eq\.([^&]+)/);
        const like=route.match(/note=like\.([^&]+)/);
        let found=[];
        if(eq){
          const note=decodeURIComponent(eq[1]);
          found=rows.filter(row=>row.note===note);
        }else if(like){
          const raw=decodeURIComponent(like[1]);
          const prefix=raw.endsWith("*")?raw.slice(0,-1):raw;
          found=rows.filter(row=>String(row.note||"").startsWith(prefix));
        }
        return {ok:true,unavailable:false,status:200,data:found};
      }
      if((init.method||"")==="POST"){
        const body=JSON.parse(init.body||"[]");
        rows.push(...body);
        return {ok:true,unavailable:false,status:201,data:body};
      }
      return {ok:false,unavailable:false,status:400,errorCode:"unsupported_mock_method"};
    }
  };
}

(async()=>{
  // Exact-decimal parser: no floating point path.
  assert.strictEqual(Confirmed.parseDecimal("0.10",8).canonical,"0.1");
  assert.strictEqual(Confirmed.parseDecimal("123456789.12345678",8).ok,true);
  assert.strictEqual(Confirmed.parseDecimal("0.123456789",8).ok,false);
  assert.strictEqual(Confirmed.validateEvent({source:"network",eventId:"evt1",state:"confirmed",kind:"estimated_signal_usd",amount:"1.00",currency:"USD",note:"x"}).ok,false);

  const store=makeStore();
  const deps={store,config:{configured:true,valid:true}};
  let r=await Confirmed.persist({source:"adnet",eventId:"sale-1",state:"confirmed",kind:"ad_settlement",amount:"10.25",currency:"USD",channel:"ads",note:"settlement:adnet:sale-1"},deps);
  assert.strictEqual(r.ok,true);
  assert.strictEqual(r.row.amount,"10.25");
  assert.strictEqual(store.rows.length,1);

  // Replay must not duplicate ledger rows.
  r=await Confirmed.persist({source:"adnet",eventId:"sale-1",state:"confirmed",kind:"ad_settlement",amount:"10.25",currency:"USD",channel:"ads",note:"settlement:adnet:sale-1"},deps);
  assert.strictEqual(r.duplicate,true);
  assert.strictEqual(store.rows.length,1);

  // Partial reversals are append-only, but cannot exceed the confirmed amount cumulatively.
  r=await Confirmed.persist({source:"adnet",eventId:"rev-1",state:"reversed",kind:"ad_reversal",amount:"4.00",currency:"USD",channel:"ads",note:"settlement:adnet:sale-1:reversal:rev-1",originalNote:"settlement:adnet:sale-1",reversalPrefix:"settlement:adnet:sale-1:reversal:"},deps);
  assert.strictEqual(r.ok,true);
  assert.strictEqual(r.row.amount,"-4");
  r=await Confirmed.persist({source:"adnet",eventId:"rev-2",state:"reversed",kind:"ad_reversal",amount:"6.25",currency:"USD",channel:"ads",note:"settlement:adnet:sale-1:reversal:rev-2",originalNote:"settlement:adnet:sale-1",reversalPrefix:"settlement:adnet:sale-1:reversal:"},deps);
  assert.strictEqual(r.ok,true);
  r=await Confirmed.persist({source:"adnet",eventId:"rev-3",state:"reversed",kind:"ad_reversal",amount:"0.01",currency:"USD",channel:"ads",note:"settlement:adnet:sale-1:reversal:rev-3",originalNote:"settlement:adnet:sale-1",reversalPrefix:"settlement:adnet:sale-1:reversal:"},deps);
  assert.strictEqual(r.ok,false);
  assert.strictEqual(r.error,"cumulative_reversal_exceeds_confirmed_amount");

  // Orphan reversal must fail closed.
  r=await Confirmed.persist({source:"adnet",eventId:"orphan",state:"reversed",kind:"ad_reversal",amount:"1",currency:"USD",channel:"ads",note:"settlement:adnet:none:reversal:orphan",originalNote:"settlement:adnet:none",reversalPrefix:"settlement:adnet:none:reversal:"},deps);
  assert.strictEqual(r.ok,false);
  assert.strictEqual(r.error,"orphan_reversal_rejected");

  // Candidate-intake path must use the same profitability classification.
  process.env.COMMERCE_MIN_NET_PROFIT_MINOR="100";
  process.env.COMMERCE_MIN_MARGIN_BPS="500";
  const economics={verified:true,currency:"USD",legalRoleStatus:"resolved",taxStatus:"resolved",grossRevenueMinor:1000,taxLiabilityMinor:100,withholdingMinor:0,paymentFeeMinor:20,fxFeeMinor:0,networkFeeMinor:20,refundReserveMinor:20,chargebackReserveMinor:10,operatorCostMinor:30};
  const directItem={commerceCandidate:{sourceTier:"approved_commerce_member"},monetizationEconomics:economics};
  const directRevenue={payable:true,type:"brokerage",payoutBasisVerified:true,disclosureReady:true,contractId:"c1",counterparty:"seller",route:{kind:"direct"},publicRoute:{}};
  const direct=Intake.profitabilityAssessment(directItem,"approved_commerce_member",directRevenue);
  assert.strictEqual(direct.gatePassed,true);
  assert.strictEqual(direct.commercialClass,"DIRECT_COMMERCE_VERIFIED");

  const badTaxItem={commerceCandidate:{sourceTier:"approved_commerce_member"},monetizationEconomics:Object.assign({},economics,{taxStatus:"pending"})};
  const held=Intake.profitabilityAssessment(badTaxItem,"approved_commerce_member",directRevenue);
  assert.strictEqual(held.gatePassed,false);
  assert.strictEqual(held.commercialClass,"REVENUE_ROUTE_HOLD");
  assert.ok(held.blockers.includes("TAX_STATUS_UNRESOLVED"));

  const affiliateItem={commerceCandidate:{sourceTier:"external_brokerage"},monetizationEconomics:economics};
  const affiliateRevenue={payable:true,type:"manual_affiliate",payoutBasisVerified:true,disclosureReady:true,contractId:"p1",counterparty:"partner",route:{kind:"affiliate"},publicRoute:{}};
  const aff=Intake.profitabilityAssessment(affiliateItem,"external_brokerage",affiliateRevenue);
  assert.strictEqual(aff.gatePassed,true);
  assert.strictEqual(aff.commercialClass,"AFFILIATE_ACTIVE");

  console.log(JSON.stringify({ok:true,eventCoreVersion:Confirmed.VERSION,intakeVersion:Intake.VERSION,ledgerRows:store.rows.length,directClass:direct.commercialClass,affiliateClass:aff.commercialClass,heldBlockers:held.blockers},null,2));
})().catch(error=>{ console.error(error); process.exit(1); });
