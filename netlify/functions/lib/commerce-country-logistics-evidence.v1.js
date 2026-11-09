"use strict";
/* Logistics evidence is not IP geolocation. Potential cross-border hubs are
 * merely SEARCH LEADS, never delivery claims or automatic market permission.
 * Only an explicit target-country shipping statement on seller-controlled
 * policy pages can provide preliminary support; independent delivery/returns
 * confirmation remains mandatory prior to public placement. */
const VERSION="igdc-country-logistics-evidence.v1";
const ANCHORS=Object.freeze({
 AD:["ES","FR"],MC:["FR","IT"],SM:["IT"],VA:["IT"],LI:["CH","AT"],LU:["BE","DE","FR"],
 GI:["ES","GB"],IM:["GB"],JE:["GB","FR"],GG:["GB","FR"],MT:["IT"],CY:["GR","TR"],
 BH:["SA","AE"],QA:["AE","SA"],KW:["SA","AE"],OM:["AE"],
 BN:["MY","SG"],SG:["MY"],KH:["TH","VN"],LA:["TH","VN"],NP:["IN"],BT:["IN"],
 LS:["ZA"],SZ:["ZA"],RW:["UG","KE","TZ"],MU:["ZA"],
 CR:["PA"],PA:["CR"],BZ:["MX","GT"],PY:["BR","AR"],UY:["AR","BR"],
 BS:["US"],BB:["TT"],AG:["BB"],KN:["AG"],LC:["BB"],VC:["BB"],DM:["LC"],
 PF:["FR"],NC:["FR","AU"],FJ:["AU","NZ"],WS:["NZ"],TO:["NZ"],
 PH:["SG","MY"],GB:["IE"],IE:["GB"],US:["CA","MX"]
});
const NAMES=Object.freeze({
 AD:["andorra"],MC:["monaco"],SM:["san marino"],VA:["vatican"],LI:["liechtenstein"],LU:["luxembourg"],
 GI:["gibraltar"],IM:["isle of man"],JE:["jersey"],GG:["guernsey"],MT:["malta"],CY:["cyprus"],
 BH:["bahrain"],QA:["qatar"],KW:["kuwait"],OM:["oman"],BN:["brunei"],SG:["singapore"],
 KH:["cambodia"],LA:["laos","lao pdr"],NP:["nepal"],BT:["bhutan"],LS:["lesotho"],SZ:["eswatini","swaziland"],
 RW:["rwanda"],MU:["mauritius"],CR:["costa rica"],PA:["panama"],BZ:["belize"],PY:["paraguay"],UY:["uruguay"],
 BS:["bahamas"],BB:["barbados"],AG:["antigua"],KN:["saint kitts","st. kitts"],LC:["saint lucia"],
 VC:["saint vincent"],DM:["dominica"],PF:["french polynesia"],NC:["new caledonia"],
 FJ:["fiji"],WS:["samoa"],TO:["tonga"],PH:["philippines","pilipinas","필리핀"],
 GB:["united kingdom","great britain","uk"],IE:["ireland"],US:["united states","usa"]
});
function normalized(code){return String(code||"").toUpperCase().trim();}
function potentialHubs(country){return (ANCHORS[normalized(country)]||[]).slice();}
// Only seller-owned shipping policies, not country proximity or IP region, can
// become destination evidence. Support all country registry codes and locale labels.
const LOCALES=["en","ko","ja","zh","fr","de","es","pt","it","nl","ru","ar","hi","bn","vi","th","id","ms","tr","sw","uk","tl","fa","ur","ta","te","pl","cs"];
const COUNTRY_LABEL_CACHE=new Map();
function countryLabels(code){
 const target=normalized(code);if(COUNTRY_LABEL_CACHE.has(target))return COUNTRY_LABEL_CACHE.get(target);
 const labels=(NAMES[target]||[]).slice();
 if(/^[A-Z]{2}$/.test(target)&&typeof Intl.DisplayNames==="function")for(const locale of LOCALES){
  try{const name=new Intl.DisplayNames([locale],{type:"region"}).of(target);
    if(name&&name!==target&&name.length>2&&!labels.some(x=>x.toLowerCase()===name.toLowerCase()))labels.push(name);
  }catch(_e){}
 }
 COUNTRY_LABEL_CACHE.set(target,labels);return labels;
}
const SHIPPING_POLICY_URL=/(?:shipping|delivery|dispatch|logistics|배송|배달|운송|livraison|exp[eé]dition|versand|lieferung|env[ií]o|entrega|pengiriman|giao[-_ ]?h[aà]ng|จัดส่ง|発送|配送|شحن|توصيل|доставка|spedizione|bezorging)/i;
const SHIPPING_STATEMENT=String.raw`(?:ship(?:ping|ped)?|deliver(?:y|ies|ed)?|dispatch|send|env[ií](?:o|ar|amos)|entrega|livraison|livr(?:ons|er|e|ent)|exp[eé]dition|versand|liefer(?:ung|n|t)|spediz(?:ione|ioni)|spedi(?:amo|re|sce)|bezorging|verzend(?:en|ing)|pengiriman|mengirim|giao\s*h[aà]ng|v[aậ]n\s*chuy[eể]n|配送|発送|送貨|送货|发货|배송|배달|จัดส่ง|شحن|توصيل|достав(?:ка|ку|ки|ляем|им)|نشحن|إرسال|वितरण|ส่งสินค้า)\s*(?:to|across|in|for|a|al|para|en|vers|nach|por|지역|가능|대상|đến|tới|ไปยัง|إلى)?\s*`;
function targetShippingClaim(input,country){
 const value=String(input||"");
 for(const name of countryLabels(country)){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const boundary=/^[a-z0-9 .'-]+$/i.test(name)?String.raw`\b`:"";
  const pattern=new RegExp(SHIPPING_STATEMENT+String.raw`[^.!?;\n]{0,65}?`+boundary+escaped+boundary,"giu");let m;
  while((m=pattern.exec(value))){
   const prefix=value.slice(Math.max(0,m.index-42),m.index);
   if(/(?:do\s+not|does\s+not|ne\s+|não\s+|nicht\s+|non\s+|no\s+|لا\s+|не\s+|don['’]?t|cannot|can['’]?t|never|not|no|except|exclude|unavailable)\s*$/iu.test(prefix))continue;
   if(/(?:\bnot\b|\bpas\b|\bnicht\b|\bnon\b|\bno\b|não|ไม่|できません|하지\s*않|\bexcept\b|\bexclude(?:s|d|ing)?\b|\bno\b|\bnever\b|cannot|can['’]?t|don['’]?t|doesn['’]?t|non\s+disponible|không|ไม่|не\s+достав|لا\s+ن)/iu.test(m[0]))continue;
   return true;
  }
 }
 return false;
}
function assess(country,policyPages,officialUrl){
 const target=normalized(country),pages=Array.isArray(policyPages)?policyPages:[];
 const deliveryPages=pages.filter(p=>p&&SHIPPING_POLICY_URL.test(String(p.url||"")));
 const text=deliveryPages.map(p=>String(p.content||"")).join(" ").toLowerCase().replace(/\s+/g," ").slice(0,150000);
 const countryNames=countryLabels(target);
 const carriers=["DHL","FedEx","UPS","DPD","GLS","USPS","Royal Mail","Australia Post","Korea Post","SF Express","Aramex"];
 const carrierMentions=carriers.filter(name=>new RegExp(String.raw`\b`+name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+String.raw`\b`,"i").test(text)).slice(0,10);
 // Public text may advertise volume or a carrier. Never treat those seller
 // claims as an independently audited shipment ledger or delivery performance.
 const volumeClaim=text.match(/(?:ship(?:ped|ping|ments)?|deliver(?:ed|ies|y)?|orders?)\s*(?:over|more than|around|about|per month|monthly)?\s*([0-9][0-9,. ]{1,12})\s*(?:orders?|packages?|parcels?|shipments?)\s*(?:per month|monthly|a month|annually|per year)?/i);

 // A mention of the target in general site text is NOT a shipping promise.
 const explicit=targetShippingClaim(text,target);
 return {schema:VERSION,targetCountry:target,potentialLogisticsHubs:potentialHubs(target),
   hubRoutesVerified:false,originCountryVerified:false,carrierVerified:false,volumeVerified:false,
   sellerPolicyPagesChecked:deliveryPages.length,targetCountryShippingClaim:explicit,
   carrierMentionsInSellerPolicy:carrierMentions,carrierOperationalProof:false,
   statedShipmentVolumeUnverified:volumeClaim?volumeClaim[0].slice(0,80):null,independentlyAuditedShipmentVolume:null,
   sellerAddressCountryClaim:null,fulfillmentWarehouseAddressVerified:false,
   targetCountryDeliveryStatus:explicit?"seller_policy_claim_requires_confirmation":"unverified",
   evidenceUrls:deliveryPages.slice(0,8).map(p=>String(p.url||"")),
   sellerSite:String(officialUrl||""),automaticCrossBorderApproval:false,
   beforePublicPlacement:["seller_identity","destination_shipping","customs_tax","returns_refunds","carrier_and_fulfillment","stock_availability"]};
}
module.exports={VERSION,potentialHubs,countryLabels,targetShippingClaim,assess};
