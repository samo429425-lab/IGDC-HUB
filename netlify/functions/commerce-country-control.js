"use strict";

const AdminSession = require("./lib/global-slot-console-auth");
const Automation = require("./lib/commerce-country-automation.v1");

const READ_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director","commerce_manager"]);
const WRITE_ROLES = new Set(["owner","admin","super_admin","site_manager","site_manager_director","director"]);

function text(value){return value==null?"":String(value).trim();}
function lower(value){return text(value).toLowerCase().replace(/[\s.]+/g,"_");}
function json(statusCode,body){return{statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","access-control-allow-headers":"Content-Type, Authorization","access-control-allow-methods":"GET,POST,OPTIONS"},body:statusCode===204?"":JSON.stringify(body)};}
function parse(event){try{return event&&event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,"base64").toString("utf8"):event.body):{};}catch(_e){const error=new Error("요청 JSON 형식이 올바르지 않습니다.");error.statusCode=400;throw error;}}
function roleList(actor){return Array.from(new Set((actor&&actor.roles||[]).map(lower).filter(Boolean)));}
function requireRole(actor,write){const allowed=write?WRITE_ROLES:READ_ROLES;const roles=roleList(actor);if(!roles.some((role)=>allowed.has(role))){const error=new Error(write?"국가·지역 자동화 설정 권한이 없습니다.":"국가·지역 상품 관제는 관리자·운영진만 사용할 수 있습니다.");error.statusCode=403;throw error;}return roles;}
function plain(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function readGeoObject(value){const raw=text(value);if(!raw)return{};for(const candidate of [raw,(()=>{try{return decodeURIComponent(raw);}catch(_e){return"";}})()]){try{const parsed=JSON.parse(candidate);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed;}catch(_e){}}return{};}
function normalizeGeo(event){
  const headers={};for(const [key,value] of Object.entries(event&&event.headers||{}))headers[String(key).toLowerCase()]=value;
  const geo=Object.assign({},plain(event&&event.geo),readGeoObject(headers["x-nf-geo"])),countryObject=plain(geo.country),subdivision=plain(geo.subdivision);
  const rawCountry=text(countryObject.code||countryObject.alpha2||(typeof geo.country==="string"?geo.country:"")||geo.countryCode||geo.country_code||headers["cf-ipcountry"]||headers["x-country"]||headers["x-vercel-ip-country"]||headers["x-nf-country"]).toUpperCase();
  const excluded=rawCountry==="KP";
  const detected=excluded?null:Automation.countryRow(rawCountry);
  const country=detected?detected.code:"";
  const rawRegion=subdivision.code||subdivision.iso_code||(typeof geo.subdivision==="string"?geo.subdivision:"")||geo.subdivisionCode||geo.regionCode||geo.stateCode||geo.provinceCode||geo.region||geo.state||headers["x-region"]||headers["x-nf-subdivision"]||headers["x-nf-region"]||headers["x-vercel-ip-country-region"]||"";
  let region="";
  if(country){const MarketSaleScope=require("./lib/market-sale-scope.v1");region=MarketSaleScope.normalizeRegion(rawRegion,country);}
  return {ok:true,version:Automation.VERSION,country:country||null,region:region||null,worldRegion:detected&&detected.regionGroup||null,resolved:!!country,excluded:excluded,detectedCountry:rawCountry||null,policy:{exactRegionFirst:true,nationwideFallbackWithinSameCountry:true,crossCountryFallback:false,unresolvedGeo:"empty",manualPinnedPrecedence:true}};
}
function catalog(state){
  const reg=Automation.registry();
  return {ok:true,version:Automation.VERSION,registry:{schema:reg.schema,version:reg.version,regions:reg.regions,excludedCountryCodes:["KP"],countryCount:reg.countries.length},countries:reg.countries.map((country)=>({
    code:country.code,nameKo:country.nameKo,nameEn:country.nameEn,regionGroup:country.regionGroup,enabled:country.enabled!==false,requiresSubdivision:country.requiresSubdivision===true,subdivisionType:country.subdivisionType||null,subdivisions:country.subdivisions||[],effective:Automation.effectiveSetting(state,country.code,"")
  })),settings:state.settings,storage:{available:state.storageAvailable,error:state.storageError||null},master:state.master};
}

exports.handler=async function(event){
  try{
    const method=String(event&&event.httpMethod||"GET").toUpperCase();if(method==="OPTIONS")return json(204,{});
    const body=method==="GET"?{}:parse(event),query=event&&event.queryStringParameters||{},action=lower(query.action||body.action||"catalog");
    const actor=await AdminSession.resolveUser(event);const write=method!=="GET"||["run_now","setting_save","candidate_action"].includes(action);requireRole(actor,write);
    const actorId=text(actor&&actor.sub);
    if(action==="session")return json(200,{ok:true,version:Automation.VERSION,session:{authenticated:true,roles:roleList(actor),write:roleList(actor).some((role)=>WRITE_ROLES.has(role))}});
    if(action==="geo")return json(200,normalizeGeo(event));
    const state=await Automation.configState();
    if(action==="catalog")return json(200,catalog(state));
    if(action==="diagnostic")return json(200,Automation.diagnostic(state));
    if(action==="scope"){
      const countryCode=text(query.country||body.countryCode).toUpperCase(),region=text(query.region||body.subdivisionCode||body.regionCode||"NATIONWIDE").toUpperCase()||"NATIONWIDE";
      const country=Automation.countryRow(countryCode);
      if(!country){const error=new Error("지원되는 국가 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}
      if(region!=="NATIONWIDE"){
        const valid=Array.isArray(country.subdivisions)&&country.subdivisions.some((item)=>text(item&&item.code).toUpperCase()===region);
        if(!valid){const error=new Error("선택 국가의 공식 주·성·지역 범위를 찾을 수 없습니다.");error.statusCode=400;throw error;}
      }
      return json(200,{ok:true,version:Automation.VERSION,country,effective:Automation.effectiveSetting(state,countryCode,region==="NATIONWIDE"?"":region),candidates:await Automation.listAutomationCandidates(countryCode,region)});
    }
    if(method!=="POST")return json(405,{ok:false,error:"method_not_allowed"});
    if(action==="setting_save")return json(200,{ok:true,version:Automation.VERSION,setting:await Automation.saveSetting(actorId,body.setting||body)});
    if(action==="run_now")return json(200,await Automation.runScope({event,countryCode:body.countryCode,subdivisionCode:body.subdivisionCode||body.regionCode||"NATIONWIDE",actorId,trigger:"administrator-manual-run",force:body.force===true,dryRun:body.dryRun===true}));
    if(action==="candidate_action")return json(200,await Automation.candidateAction(actorId,body));
    return json(404,{ok:false,error:"지원하지 않는 국가·지역 관제 요청입니다."});
  }catch(error){return json(error&&error.statusCode||500,{ok:false,error:text(error&&error.message||error),code:text(error&&error.code)||null});}
};
