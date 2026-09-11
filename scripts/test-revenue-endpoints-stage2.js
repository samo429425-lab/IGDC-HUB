"use strict";

const assert=require("assert");
const crypto=require("crypto");

(async()=>{
  const root=require("path").resolve(__dirname,"..");
  process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET="click-secret-1234567890";
  process.env.PROVIDER_SECRET_TEST="provider-secret-1234567890";
  process.env.IGDC_AFFILIATE_PARTNERS_JSON=JSON.stringify([{
    id:"provider-a",active:true,secretEnv:"PROVIDER_SECRET_TEST",signatureHeader:"x-provider-signature",signaturePrefix:"sha256=",maxAmountScale:8,
    fields:{transactionId:"transactionId",status:"status",clickId:"clickId",commissionAmount:"commissionAmount",currency:"currency"}
  }]);
  process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN="settlement-token-1234567890";

  const Contract=require(root+"/netlify/functions/lib/nonpg-revenue-contract.core.v1.js");
  const Confirmed=require(root+"/netlify/functions/lib/confirmed-revenue-event.v1.js");
  const originalPersist=Confirmed.persist;
  const calls=[];
  Confirmed.persist=async function(input){ calls.push(input); return {ok:true,status:200,duplicate:false,row:{amount:input.state==="reversed"?"-"+String(input.amount).replace(/^-/,''):String(input.amount)},ledgerTable:"inflow_ledger"}; };

  delete require.cache[require.resolve(root+"/netlify/functions/affiliate-conversion-webhook.js")];
  const Affiliate=require(root+"/netlify/functions/affiliate-conversion-webhook.js");
  const click=Contract.signClick({v:1,id:"item-1",providerId:"provider-a",programId:"program-a",source:"affiliate-outbound",ts:Date.now(),exp:Date.now()+60000},process.env.IGDC_AFFILIATE_CLICK_SIGNING_SECRET);
  const payload={providerId:"provider-a",transactionId:"tx-1",status:"confirmed",clickId:click,commissionAmount:"0.07",currency:"USD"};
  const raw=JSON.stringify(payload);
  const sig="sha256="+crypto.createHmac("sha256",process.env.PROVIDER_SECRET_TEST).update(raw).digest("hex");
  let res=await Affiliate.handler({httpMethod:"POST",headers:{"x-provider-signature":sig},body:raw});
  let body=JSON.parse(res.body);
  assert.strictEqual(res.statusCode,200);
  assert.strictEqual(body.status,"confirmed_commission_recorded");
  assert.strictEqual(calls.length,1);
  assert.strictEqual(calls[0].amount,"0.07");
  assert.strictEqual(calls[0].state,"confirmed");
  assert.strictEqual(calls[0].note,"affiliate:provider-a:tx-1:confirmed");

  // Invalid signature must never reach the ledger core.
  res=await Affiliate.handler({httpMethod:"POST",headers:{"x-provider-signature":"sha256=bad"},body:raw});
  assert.strictEqual(res.statusCode,401);
  assert.strictEqual(calls.length,1);

  // Pending provider events remain non-ledger events.
  const pending=Object.assign({},payload,{transactionId:"tx-p",status:"pending"});
  const pendingRaw=JSON.stringify(pending);
  const pendingSig="sha256="+crypto.createHmac("sha256",process.env.PROVIDER_SECRET_TEST).update(pendingRaw).digest("hex");
  res=await Affiliate.handler({httpMethod:"POST",headers:{"x-provider-signature":pendingSig},body:pendingRaw});
  assert.strictEqual(res.statusCode,202);
  assert.strictEqual(calls.length,1);

  // Reversal must carry the original confirmed note into the append-only core.
  const reversed=Object.assign({},payload,{status:"refunded",commissionAmount:"0.07"});
  const reversedRaw=JSON.stringify(reversed);
  const reversedSig="sha256="+crypto.createHmac("sha256",process.env.PROVIDER_SECRET_TEST).update(reversedRaw).digest("hex");
  res=await Affiliate.handler({httpMethod:"POST",headers:{"x-provider-signature":reversedSig},body:reversedRaw});
  assert.strictEqual(res.statusCode,200);
  assert.strictEqual(calls.length,2);
  assert.strictEqual(calls[1].state,"reversed");
  assert.strictEqual(calls[1].originalNote,"affiliate:provider-a:tx-1:confirmed");

  delete require.cache[require.resolve(root+"/netlify/functions/nonpg-settlement-ingest.js")];
  const Ingest=require(root+"/netlify/functions/nonpg-settlement-ingest.js");
  res=await Ingest.handler({httpMethod:"POST",headers:{authorization:"Bearer "+process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN},body:JSON.stringify({source:"ad-network-a",receiptId:"ad-1",kind:"ad_settlement",currency:"USD",amount:"0.0035",channel:"ads"})});
  body=JSON.parse(res.body);
  assert.strictEqual(res.statusCode,200);
  assert.strictEqual(body.status,"confirmed_settlement_recorded");
  assert.strictEqual(calls.length,3);
  assert.strictEqual(calls[2].amount,"0.0035");

  // Explicit reversal wiring uses the original receipt and cumulative prefix.
  res=await Ingest.handler({httpMethod:"POST",headers:{authorization:"Bearer "+process.env.IGDC_NONPG_SETTLEMENT_INGEST_TOKEN},body:JSON.stringify({source:"ad-network-a",receiptId:"ad-r1",originalReceiptId:"ad-1",kind:"ad_reversal",currency:"USD",amount:"-0.001",channel:"ads"})});
  assert.strictEqual(res.statusCode,200);
  assert.strictEqual(calls.length,4);
  assert.strictEqual(calls[3].state,"reversed");
  assert.strictEqual(calls[3].originalNote,"settlement:ad-network-a:ad-1");
  assert.strictEqual(calls[3].reversalPrefix,"settlement:ad-network-a:ad-1:reversal:");

  // Unauthorized settlement import is rejected before persistence.
  res=await Ingest.handler({httpMethod:"POST",headers:{authorization:"Bearer wrong"},body:"{}"});
  assert.strictEqual(res.statusCode,401);
  assert.strictEqual(calls.length,4);

  Confirmed.persist=originalPersist;
  console.log(JSON.stringify({ok:true,affiliateCalls:2,settlementCalls:2,invalidSignatureRejected:true,pendingIgnored:true,unauthorizedSettlementRejected:true},null,2));
})().catch(error=>{ console.error(error); process.exit(1); });
