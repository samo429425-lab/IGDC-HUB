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
 if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".test")||host.endsWith(".example")||/^\d+\.\d+\.\d+\.\d+$/.test(host))return "non_public_supplier_host";
 if(PORTAL_DOMAINS.some(d=>onDomain(host,d)))return "discovery_or_social_platform_not_supplier";
 if(DOCUMENT_SUITES.some(d=>onDomain(host,d)))return "documentation_or_service_platform_not_supplier";
 if(/^(?:search|news|blog|maps|wiki|docs|support|calendar)\./.test(host))return "information_host_not_supplier";
 if(BAD_PATH.test(u.pathname)&&!/(?:\/products?\/|\/store\/|\/shop\/)/i.test(u.pathname))return "informational_page_not_supplier";
 return "";
}
module.exports={VERSION,reason,isUsableSupplierUrl:(u)=>!reason(u)};
