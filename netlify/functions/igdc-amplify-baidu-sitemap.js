"use strict";
/** Baidu-ready flat XML sitemap. Read-only, separately namespaced; no site-wide routing changes. */
const {ORIGIN, buildCatalog} = require("./lib/igdc-amplify/catalog");
const PAGE_SIZE = 5000; // Keep well under Baidu's 10 MB / 50,000 URL per file limits.
const MAX_XML_BYTES = 9 * 1024 * 1024;
const LANDINGS = [
  `${ORIGIN}/igdc-amplify-platform-zh.html`,
  `${ORIGIN}/igdc-amplify-platform-zht.html`,
  `${ORIGIN}/igdc-amplify-maru-zh.html`,
  `${ORIGIN}/igdc-amplify-maru-zht.html`,
  `${ORIGIN}/igdc-amplify-search.html`
];
function xmlEsc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function entry(url, modified="") {
  return `<url><loc>${xmlEsc(url)}</loc>${modified?`<lastmod>${xmlEsc(modified)}</lastmod>`:""}</url>\n`;
}
function build(c, part) {
  let body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  const start = (part - 1) * PAGE_SIZE;
  const batch = c.items.slice(start, start + PAGE_SIZE);
  if (part === 1) for (const url of LANDINGS) body += entry(url);
  for (const item of batch) body += entry(item.url, item.updatedAt && /^\d{4}-\d{2}-\d{2}/.test(item.updatedAt) ? item.updatedAt.slice(0,10) : "");
  body += '</urlset>\n';
  return body;
}
exports.handler = async (event={}) => {
  const p = String(event.queryStringParameters?.part || "1");
  const c = buildCatalog();
  const parts = Math.max(1, Math.ceil(c.items.length / PAGE_SIZE));
  if (!/^[1-9]\d{0,2}$/.test(p) || Number(p)>parts) return {
    statusCode:404,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex"},body:"Sitemap part not found"
  };
  const body=build(c,Number(p));
  if(Buffer.byteLength(body,"utf8")>MAX_XML_BYTES) return {
    statusCode:503,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"},body:"Sitemap size exceeds safety limit"
  };
  return {statusCode:200,headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public,max-age=0,s-maxage=30,must-revalidate","x-content-type-options":"nosniff","x-igdc-amplify-catalog":c.hash,"x-igdc-amplify-baidu-parts":String(parts)},body};
};
exports._test={build,LANDINGS,PAGE_SIZE,MAX_XML_BYTES};
