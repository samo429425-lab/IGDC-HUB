"use strict";

/**
 * Revenue provider registry (server only).
 *
 * Providers are declared in IGDC_REVENUE_PROVIDERS_JSON. Credentials and
 * endpoint URLs are referenced by environment-variable name and are never
 * returned to clients. This adapter is intentionally generic so IGDC can add
 * an approved ad/affiliate/settlement provider without changing ledger code.
 */

const VERSION = "revenue-provider-registry-v1.0.0";
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const SAFE_FIELD = /^[A-Za-z0-9_.-]{1,120}$/;
const ALLOWED_AUTH = new Set(["bearer", "header", "none"]);
const ALLOWED_BASIS = new Set(["net", "gross"]);

function text(v){ return v == null ? "" : String(v).trim(); }
function cleanId(v){ const s=text(v); return SAFE_ID.test(s) ? s : ""; }
function envName(v){ const s=text(v); return /^[A-Z][A-Z0-9_]{2,120}$/.test(s) ? s : ""; }
function pathName(v){ const s=text(v); return SAFE_FIELD.test(s) ? s : ""; }
function httpsUrl(v){ try{ const u=new URL(text(v)); return u.protocol === "https:" && !u.username && !u.password ? u.toString() : ""; }catch(_e){ return ""; } }
function getPath(obj, dotted){
  const parts=text(dotted).split(".").filter(Boolean);
  let cur=obj;
  for(const p of parts){ if(cur == null || typeof cur !== "object") return undefined; cur=cur[p]; }
  return cur;
}
function parseRaw(env){
  try{
    const value=JSON.parse((env||process.env).IGDC_REVENUE_PROVIDERS_JSON || "[]");
    return Array.isArray(value) ? value : (Array.isArray(value.providers) ? value.providers : []);
  }catch(_e){ return []; }
}
function normalizeOne(raw, env){
  const e=env||process.env;
  const id=cleanId(raw&& (raw.id || raw.providerId));
  const endpointEnv=envName(raw&&raw.endpointEnv);
  const authEnv=envName(raw&&raw.authEnv);
  const authType=text(raw&&raw.authType || "bearer").toLowerCase();
  const amountBasis=text(raw&&raw.amountBasis || "net").toLowerCase();
  const fields=raw&&raw.fields&&typeof raw.fields==="object" ? raw.fields : {};
  const endpoint=httpsUrl(endpointEnv ? e[endpointEnv] : "");
  const active=raw&&raw.active===true;
  const errors=[];
  if(!id) errors.push("provider_id_invalid");
  if(active && !endpointEnv) errors.push("endpoint_env_missing");
  if(active && endpointEnv && !endpoint) errors.push("endpoint_not_https_or_missing");
  if(!ALLOWED_AUTH.has(authType)) errors.push("auth_type_invalid");
  if(active && authType!=="none" && !authEnv) errors.push("auth_env_missing");
  if(active && authType!=="none" && authEnv && !text(e[authEnv])) errors.push("auth_secret_missing");
  if(!ALLOWED_BASIS.has(amountBasis)) errors.push("amount_basis_invalid");
  if(amountBasis === "gross"){
    const financial=raw&&raw.financialFields&&typeof raw.financialFields==="object" ? raw.financialFields : {};
    const hasAny=[financial.taxAmount,financial.withholdingAmount,financial.providerFeeAmount,financial.fxFeeAmount,financial.otherCostAmount].some(Boolean);
    if(!hasAny) errors.push("gross_amount_requires_deduction_field_mapping");
  }
  ["arrayPath","eventId","amount","currency","status","kind","originalEventId","timestamp"].forEach(k=>{
    if(fields[k] && !pathName(fields[k])) errors.push("field_path_invalid:"+k);
  });
  return {
    id,
    active,
    valid:errors.length===0,
    errors,
    mode:"pull",
    endpoint,
    endpointEnv:endpointEnv||null,
    authEnv:authEnv||null,
    authType,
    authHeader:text(raw&&raw.authHeader || "Authorization"),
    authPrefix:raw&&raw.authPrefix != null ? String(raw.authPrefix) : (authType==="bearer" ? "Bearer " : ""),
    amountBasis,
    fields,
    financialFields:raw&&raw.financialFields&&typeof raw.financialFields==="object" ? raw.financialFields : {},
    confirmedValues:Array.isArray(raw&&raw.confirmedValues)?raw.confirmedValues.map(x=>text(x).toLowerCase()):["confirmed","approved","paid","completed","settled"],
    reversedValues:Array.isArray(raw&&raw.reversedValues)?raw.reversedValues.map(x=>text(x).toLowerCase()):["reversed","refunded","chargeback","cancelled","canceled"],
    defaultCurrency:text(raw&&raw.defaultCurrency || "USD").toUpperCase(),
    defaultKind:cleanId(raw&&raw.defaultKind) || "ad_settlement",
    maxAmountScale:Math.max(0,Math.min(8,Number.parseInt(raw&&raw.maxAmountScale,10)||8)),
    lookbackHours:Math.max(1,Math.min(24*31,Number.parseInt(raw&&raw.lookbackHours,10)||48)),
    sinceParam:text(raw&&raw.sinceParam),
    timeoutMs:Math.max(2000,Math.min(30000,Number.parseInt(raw&&raw.timeoutMs,10)||12000)),
    sourcePrefix:cleanId(raw&&raw.sourcePrefix) || id || null
  };
}
function list(env){ return parseRaw(env).map(x=>normalizeOne(x,env)); }
function activeValid(env){ return list(env).filter(x=>x.active&&x.valid); }
function publicStatus(env){
  return list(env).map(p=>({id:p.id,active:p.active,valid:p.valid,errors:p.errors,amountBasis:p.amountBasis,endpointConfigured:!!p.endpoint,authConfigured:p.authType==="none"?true:!!(p.authEnv&&text((env||process.env)[p.authEnv]))}));
}

module.exports={VERSION,list,activeValid,publicStatus,getPath,cleanId,httpsUrl};
