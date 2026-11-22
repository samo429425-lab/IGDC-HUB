"use strict";
/* Distribution-only supplier URL identity guard. Search providers, social
 * hosts, news portals, documentation suites and directories are sources of
 * DISCOVERY evidence, never seller identities. Do not alter shared SearchBank.
 * Existing ledger rows stay intact; this gate only stops promotion/re-use. */
const VERSION="igdc-supplier-source-guard.v1";
const PORTAL_DOMAINS=[
  "google.com","google.co.kr","google.co.uk","google.com.ph","google.com.au","google.ca",
  "bing.com","duckduckgo.com","yahoo.com","yahoo.co.jp","yahoo.co.uk","naver.com",
  "daum.net","kakao.com","youtube.com","youtu.be","reddit.com","facebook.com",
  "instagram.com","tiktok.com","linkedin.com","pinterest.com","wikipedia.org",
  "wikidata.org","baidu.com","yandex.ru","yandex.com","archive.org",
  "medium.com","blogspot.com","tistory.com","wordpress.com","news.google.com"
];
// Comparison portals produce reference links, not official seller identities.
// Older administrator/partner ledger rows are NOT deleted or reclassified.
const COMPARISON_DOMAINS=['hotelscombined.co.kr','hotelscombined.com','kayak.com','kayak.co.kr','trivago.com','trivago.co.kr','skyscanner.com','skyscanner.net','tripadvisor.com'];
const DOCUMENT_SUITES=["calendar.google.com","docs.google.com","drive.google.com","sites.google.com","workspace.google.com","cloud.google.com","support.google.com","microsoft.com","office.com","office365.com","notion.so","github.com","gitlab.com"];
const BAD_PATH=/(?:^|\/)(?:search|results|news|articles|blog|press-release|press-releases|wiki|wiki\/|research|report|reports|documentation|docs|maps|watch)(?:\/|$)/i;
function asUrl(input){try{const u=new URL(String(input||""));return /^(https?:)$/.test(u.protocol)&&!u.username&&!u.password?u:null;}catch(_e){return null;}}
function onDomain(host,domain){return host===domain||host.endsWith("."+domain);}
function reason(value){
 const u=asUrl(value);if(!u)return "invalid_supplier_url";
 const host=u.hostname.toLowerCase().replace(/^www\./,"");
 // Distinguish a genuine merchant-owned storefront from its parent search/
 // software service. The store subdomains/paths still require product checks.
 if(host==="store.google.com" || host==="store.microsoft.com" || (host==="microsoft.com"&&/^\/(?:[a-z]{2}-[a-z]{2}\/)?store(?:\/|$)/i.test(u.pathname)))return "";
 // These Naver hosts contain individual merchant-owned storefront paths.
 // Accept only a concrete shop ID, never the parent portal, search, or
 // category root. Product pages still require merchant-path matching.
 if(["smartstore.naver.com","brand.naver.com","storefarm.naver.com"].includes(host)){
   let shop="";try{shop=decodeURIComponent(u.pathname.split("/").filter(Boolean)[0]||"");}
   catch(_){return "naver_storefront_identity_missing";}
   if(/^[a-z0-9_-]{2,80}$/i.test(shop)&&
      !/^(?:products?|goods|search|category|categories|login|cart|mypage|home|main|about|help|support)$/i.test(shop))return "";
   return "naver_storefront_identity_missing";
 }
 if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".test")||host.endsWith(".example")||/^\d+\.\d+\.\d+\.\d+$/.test(host))return "non_public_supplier_host";
 if(COMPARISON_DOMAINS.some(d=>onDomain(host,d)))return "comparison_portal_not_direct_supplier";
 if(PORTAL_DOMAINS.some(d=>onDomain(host,d)))return "discovery_or_social_platform_not_supplier";
 if(DOCUMENT_SUITES.some(d=>onDomain(host,d)))return "documentation_or_service_platform_not_supplier";
 if(/^(?:search|news|blog|maps|wiki|docs|support|calendar)\./.test(host))return "information_host_not_supplier";
 if(BAD_PATH.test(u.pathname)&&!/(?:\/products?\/|\/store\/|\/shop\/)/i.test(u.pathname))return "informational_page_not_supplier";
 return "";
}
// Distinct merchant identity, not URL path.  Different product pages at one
// ordinary retailer must NOT count as different suppliers; separate Naver
// merchant storefront paths must remain distinct. Use only valid supplier URLs.
function identityKey(value){
 if(reason(value))return "";
 const u=asUrl(value),host=u.hostname.toLowerCase().replace(/^www\./,"");
 const naver=["smartstore.naver.com","brand.naver.com","storefarm.naver.com"].includes(host);
 if(naver){const shop=u.pathname.split("/").filter(Boolean)[0]||"";return host+"/"+shop.toLowerCase();}
 return host;
}
module.exports={VERSION,reason,identityKey,isUsableSupplierUrl:(u)=>!reason(u)};
