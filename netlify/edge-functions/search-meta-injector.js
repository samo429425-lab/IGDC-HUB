import { BRAND_ALIASES, LANGS, PAGE_DESCRIPTIONS, PAGE_LABELS, languageFromPath, localizedRoute, pageTypeFromPath } from "./search-meta-config.js";

const ORIGIN = "https://igdcglobal.com";
const BOT_SKIP = ["/admin", "/assets/", "/netlify/", "/.netlify/", "/api/", "/data/", "/images/", "/fonts/", "/css/", "/js/"];

export const config = { path: "/*" };

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cleanHead(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+[^>]*name=["']description["'][^>]*>/ig, "")
    .replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>/ig, "")
    .replace(/<link\s+[^>]*rel=["']alternate["'][^>]*hreflang=["'][^"']+["'][^>]*>/ig, "")
    .replace(/<meta\s+[^>]*property=["']og:(?:title|description|url|type)["'][^>]*>/ig, "")
    .replace(/<meta\s+[^>]*name=["']twitter:(?:card|title|description)["'][^>]*>/ig, "")
    .replace(/<script\s+[^>]*id=["']igdc-search-schema["'][^>]*>[\s\S]*?<\/script>/ig, "");
}
function metadataBlock(url, page, lang) {
  const label = PAGE_LABELS[page];
  const title = page === "home" ? `${label} | MARU Platform` : `${label} | IGDC Global Platform | MARU Platform`;
  const description = PAGE_DESCRIPTIONS[page] || PAGE_DESCRIPTIONS.home;
  const canonical = ORIGIN + localizedRoute(page, lang);
  const alternates = LANGS.map(code => `<link rel="alternate" hreflang="${esc(code)}" href="${esc(ORIGIN + localizedRoute(page, code))}">`).join("\n");
  const schema = {
    "@context": "https://schema.org",
    "@type": page === "home" ? "WebSite" : "WebPage",
    name: label,
    alternateName: BRAND_ALIASES,
    url: canonical,
    inLanguage: lang,
    isPartOf: { "@type": "WebSite", name: "IGDC Global Platform", alternateName: BRAND_ALIASES, url: ORIGIN + "/home" }
  };
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    alternates,
    `<link rel="alternate" hreflang="x-default" href="${esc(ORIGIN + localizedRoute(page, "en"))}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<script type="application/ld+json" id="igdc-search-schema">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`
  ].join("\n");
}

export default async function handler(request, context) {
  if (request.method !== "GET" && request.method !== "HEAD") return context.next();
  const url = new URL(request.url);
  if (BOT_SKIP.some(p => url.pathname.startsWith(p))) return context.next();
  const page = pageTypeFromPath(url.pathname);
  if (!page) return context.next();

  const response = await context.next();
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html")) return response;
  const html = await response.text();
  if (!/<head[\s>]/i.test(html)) return new Response(html, response);

  const lang = languageFromPath(url.pathname, url.searchParams);
  const injected = cleanHead(html).replace(/<head([^>]*)>/i, `<head$1>\n${metadataBlock(url, page, lang)}\n`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-igdc-search-meta", `central-v1:${page}:${lang}`);
  return new Response(injected, { status: response.status, statusText: response.statusText, headers });
}
