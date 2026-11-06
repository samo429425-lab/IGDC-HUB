const LANGS = ["ko","ar","bn","de","en","es","fa","fr","hi","hu","id","it","ja","ms","nl","pl","pt","ru","sv","sw","ta","th","tl","tr","uk","ur","uz","vi","zh","zht"];

const PAGE_LABELS = {
  home: "IGDC Global Platform",
  networkhub: "IGDC Global Network Hub",
  distributionhub: "IGDC Global Distribution Hub",
  socialnetwork: "IGDC Global Social Network",
  mediahub: "IGDC Global Media Hub",
  tour: "IGDC Global Travel & Tour",
  donation: "IGDC Global Donation"
};

const PAGE_DESCRIPTIONS = {
  home: "IGDC Global Platform connects global distribution, content, social networks, media and regional services in one multilingual platform.",
  networkhub: "IGDC Global Network Hub connects global market, network and commerce discovery services.",
  distributionhub: "IGDC Global Distribution Hub connects products, suppliers, regions and global distribution opportunities.",
  socialnetwork: "IGDC Global Social Network connects selected creators, social content and global audiences.",
  mediahub: "IGDC Global Media Hub connects video, audio and media content discovery across regions and languages.",
  tour: "IGDC Global Travel & Tour connects travel, tourism, accommodation and regional discovery.",
  donation: "IGDC Global Donation provides global donation and support information within the IGDC platform."
};

const BRAND_ALIASES = [
  "IGDC Global",
  "IGDC Platform",
  "IGDC Global Platform",
  "MARU Platform",
  "마루 플랫폼",
  "MARU",
  "마루"
];

function pageTypeFromPath(pathname) {
  const p = String(pathname || "").toLowerCase();
  for (const key of Object.keys(PAGE_LABELS)) {
    if (new RegExp(`(?:^|/)${key}(?:_[a-z]+)?(?:\\.html)?$`).test(p)) return key;
  }
  if (p === "/" || /(?:^|\/)index(?:\.html)?$/.test(p)) return "home";
  return "";
}

function languageFromPath(pathname, searchParams) {
  const explicit = String(searchParams?.get?.("lang") || "").toLowerCase();
  if (LANGS.includes(explicit)) return explicit;
  const seg = String(pathname || "").split("/").filter(Boolean)[0]?.toLowerCase() || "";
  if (LANGS.includes(seg)) return seg;
  return "ko";
}

function localizedRoute(page, lang) {
  if (!page || !PAGE_LABELS[page]) return "/home";
  if (!lang || lang === "ko") return `/${page}`;
  return `/${lang}/${page}_${lang}`;
}


const ORIGIN = "https://igdcglobal.com";
const BOT_SKIP = ["/admin", "/assets/", "/netlify/", "/.netlify/", "/api/", "/data/", "/images/", "/fonts/", "/css/", "/js/"];


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

/*
 * First paint fast-path: ordinary visitors must not wait for the entire HTML
 * response (including >400 KB Home <head>) to be buffered and reserialized.
 * Crawlers and social preview agents keep the existing server-side SEO rewrite.
 * This changes no Snapshot/IP routing, country policy, Front Match or page code.
 */
function isInteractiveBrowserNavigation(request) {
  const h = request && request.headers;
  if (!h || typeof h.get !== "function") return false;
  const ua = String(h.get("user-agent") || "");
  // Exclude all recognized search/social agents even if they impersonate Chrome
  // and send ordinary browser navigation headers.
  if (/(?:bot|crawl|spider|slurp|preview|facebookexternalhit|linkedin|telegram|whatsapp|discord|applebot|yandex|semrush|ahrefs|pinterest|google-inspectiontool)/i.test(ua)) return false;
  const mode = String(h.get("sec-fetch-mode") || "").toLowerCase();
  const dest = String(h.get("sec-fetch-dest") || "").toLowerCase();
  if (mode === "navigate" && (dest === "document" || dest === "iframe")) return true;
  // Older Safari/embedded desktop/mobile browsers may omit Fetch Metadata.
  // Only recognize actual browser-shaped user agents, not generic clients.
  return /Mozilla\/5\.0/i.test(ua) &&
    /(?:Chrome\/|CriOS\/|Firefox\/|FxiOS\/|Safari\/|Edg\/|OPR\/)/i.test(ua);
}

export default async function handler(request, context) {
  if (request.method !== "GET" && request.method !== "HEAD") return context.next();
  const url = new URL(request.url);
  if (BOT_SKIP.some(p => url.pathname.startsWith(p))) return context.next();
  if (/\/search(?:\.html)?\/?$/i.test(url.pathname)) {
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set("x-robots-tag", "noindex, follow");
    headers.set("x-igdc-search-meta", "central-v2:search:noindex");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const page = pageTypeFromPath(url.pathname);
  if (!page) return context.next();
  // Browser navigation and iframe navigation remain streaming; never call
  // response.text(), so first paint is not blocked by SEO metadata rewriting.
  if (isInteractiveBrowserNavigation(request)) return context.next();

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
