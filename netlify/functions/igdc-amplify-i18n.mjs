// IGDC independent localized discovery pages — static URLs, dynamic server-rendered HTML.
// Does not modify Netlify configuration, existing UI pages, product ranking, or front data.
import { PAGES, LANGUAGES, LANGUAGE_NAMES } from "./lib/igdc-amplify/i18n-pages.mjs";

const ORIGIN = "https://igdcglobal.com";
const RTL = new Set(["ar", "fa", "ur"]);
const PLAY_LABELS = {"ko":"Google Play에서 Android 앱 설치","ar":"تثبيت تطبيق Android عبر Google Play","bn":"Google Play থেকে Android অ্যাপ ইনস্টল করুন","de":"Android-App bei Google Play installieren","en":"Install Android app on Google Play","es":"Instalar la aplicación Android en Google Play","fa":"نصب برنامه اندروید از Google Play","fr":"Installer l'application Android sur Google Play","hi":"Google Play से Android ऐप इंस्टॉल करें","hu":"Android-alkalmazás telepítése a Google Playről","id":"Instal aplikasi Android di Google Play","it":"Installa l'app Android da Google Play","ja":"Google Play で Android アプリをインストール","ms":"Pasang aplikasi Android di Google Play","nl":"Installeer de Android-app via Google Play","pl":"Zainstaluj aplikację Android z Google Play","pt":"Instale o app Android no Google Play","ru":"Установить приложение Android из Google Play","sv":"Installera Android-appen via Google Play","sw":"Sakinisha programu ya Android kupitia Google Play","ta":"Google Play மூலம் Android செயலியை நிறுவவும்","th":"ติดตั้งแอป Android จาก Google Play","tl":"I-install ang Android app mula sa Google Play","tr":"Android uygulamasını Google Play'den yükleyin","uk":"Встановити застосунок Android із Google Play","ur":"Google Play سے Android ایپ انسٹال کریں","uz":"Android ilovasini Google Play orqali o‘rnating","vi":"Cài ứng dụng Android trên Google Play","zh":"在 Google Play 安装 Android 应用","zht":"在 Google Play 安裝 Android 應用程式"};
const CSS = `:root{color-scheme:light}body{margin:0;background:#f7f8fa;color:#15283c;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}main{margin:0 auto;max-width:940px;padding:25px}.card{background:white;border:1px solid #dce4ee;border-radius:13px;padding:26px;margin:18px 0}h1{font-size:clamp(1.4rem,3vw,2.1rem)}a{color:#185386}a:focus-visible{outline:2px solid #1161aa}nav a{margin-inline-end:13px}.note{background:#eef3f8;border-inline-start:4px solid #597fa2;padding:12px}.langgrid{display:flex;gap:9px 13px;flex-wrap:wrap;padding:10px 0}.langgrid a{font-size:.9rem}.languages{margin:25px 0;padding:15px;border-top:1px solid #cdd6e0}.small{font-size:.9rem;color:#46586e}footer{color:#536478;font-size:.85rem;margin:24px 0}@media(max-width:650px){main{padding:12px}.card{padding:18px}}`;
function esc(s) {return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function fname(kind,lang) {return `igdc-amplify-${kind}${lang==="ko"?"":"-"+lang}.html`;}
function publicUrl(kind,lang) {return `${ORIGIN}/${fname(kind,lang)}`;}
function pageLang(lang) {return lang === "zht" ? "zh-Hant" : lang === "zh" ? "zh-Hans" : lang;}
function alternates(kind) {
  return LANGUAGES.map(lang=>`<link rel="alternate" hreflang="${esc(pageLang(lang))}" href="${esc(publicUrl(kind,lang))}">`).join("\n")+
  `\n<link rel="alternate" hreflang="x-default" href="${esc(publicUrl(kind,"en"))}">`;
}
function languageNav(kind) {
  return `<details class="languages"><summary>Languages / 언어 / Langues / 言語 (30)</summary><nav aria-label="Language versions" class="langgrid">`+
    LANGUAGES.map(lang=>`<a hreflang="${esc(pageLang(lang))}" href="/${esc(fname(kind,lang))}">${esc(LANGUAGE_NAMES[lang])}</a>`).join("")+
    `</nav></details>`;
}
const validPaths = new Map();
for (const kind of ["platform","maru"]) for (const lang of LANGUAGES) validPaths.set("/"+fname(kind,lang),{kind,lang});
function renderPage(kind,lang) {
 const d=PAGES[kind]?.[lang]; if(!d) return null;
 const url=publicUrl(kind,lang), title=esc(d.title), desc=esc(d.description);
 const playLink=kind==="maru"?`<p class="note"><a href="https://play.google.com/store/apps/details?id=com.maru.mediaplayer" target="_blank" rel="noopener noreferrer">${esc(PLAY_LABELS[lang]||PLAY_LABELS.en)}</a></p>`:"";
 // Only curated text/data from the previous 30-language release is used.
 const ld=JSON.stringify(d.schema).replace(/</g,"\\u003c");
 return `<!doctype html>\n<html lang="${esc(pageLang(lang))}"${RTL.has(lang)?' dir="rtl"':''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`+
 `<title>${title}</title><meta name="description" content="${desc}"><meta name="robots" content="index,follow,max-image-preview:large">`+
 `<link rel="canonical" href="${url}">\n${alternates(kind)}\n`+
 `<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}">`+
 `<script type="application/ld+json">${ld}</script><style>${CSS}</style></head>`+
 `<body><main><nav aria-label="IGDC official navigation">${d.navigation}</nav><article class="card">${d.article}${playLink}${languageNav(kind)}</article><footer>${d.footer}</footer></main></body></html>`;
}
export default async function handler(request) {
  const pathname=new URL(request.url).pathname;
  const target=validPaths.get(pathname);
  if(!target) return new Response("Not Found",{status:404,headers:{"Content-Type":"text/plain; charset=utf-8","X-Robots-Tag":"noindex"}});
  const body=renderPage(target.kind,target.lang);
  if(!body) return new Response("Not Found",{status:404,headers:{"X-Robots-Tag":"noindex"}});
  return new Response(request.method==="HEAD"?null:body,{
    status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=3600, stale-while-revalidate=86400","X-Content-Type-Options":"nosniff","X-IGDC-Amplify":"i18n-compact-v4.0"}
  });
}
export const config={method:["GET","HEAD"],path:[
    "/igdc-amplify-platform.html",
    "/igdc-amplify-platform-ar.html",
    "/igdc-amplify-platform-bn.html",
    "/igdc-amplify-platform-de.html",
    "/igdc-amplify-platform-en.html",
    "/igdc-amplify-platform-es.html",
    "/igdc-amplify-platform-fa.html",
    "/igdc-amplify-platform-fr.html",
    "/igdc-amplify-platform-hi.html",
    "/igdc-amplify-platform-hu.html",
    "/igdc-amplify-platform-id.html",
    "/igdc-amplify-platform-it.html",
    "/igdc-amplify-platform-ja.html",
    "/igdc-amplify-platform-ms.html",
    "/igdc-amplify-platform-nl.html",
    "/igdc-amplify-platform-pl.html",
    "/igdc-amplify-platform-pt.html",
    "/igdc-amplify-platform-ru.html",
    "/igdc-amplify-platform-sv.html",
    "/igdc-amplify-platform-sw.html",
    "/igdc-amplify-platform-ta.html",
    "/igdc-amplify-platform-th.html",
    "/igdc-amplify-platform-tl.html",
    "/igdc-amplify-platform-tr.html",
    "/igdc-amplify-platform-uk.html",
    "/igdc-amplify-platform-ur.html",
    "/igdc-amplify-platform-uz.html",
    "/igdc-amplify-platform-vi.html",
    "/igdc-amplify-platform-zh.html",
    "/igdc-amplify-platform-zht.html",
    "/igdc-amplify-maru.html",
    "/igdc-amplify-maru-ar.html",
    "/igdc-amplify-maru-bn.html",
    "/igdc-amplify-maru-de.html",
    "/igdc-amplify-maru-en.html",
    "/igdc-amplify-maru-es.html",
    "/igdc-amplify-maru-fa.html",
    "/igdc-amplify-maru-fr.html",
    "/igdc-amplify-maru-hi.html",
    "/igdc-amplify-maru-hu.html",
    "/igdc-amplify-maru-id.html",
    "/igdc-amplify-maru-it.html",
    "/igdc-amplify-maru-ja.html",
    "/igdc-amplify-maru-ms.html",
    "/igdc-amplify-maru-nl.html",
    "/igdc-amplify-maru-pl.html",
    "/igdc-amplify-maru-pt.html",
    "/igdc-amplify-maru-ru.html",
    "/igdc-amplify-maru-sv.html",
    "/igdc-amplify-maru-sw.html",
    "/igdc-amplify-maru-ta.html",
    "/igdc-amplify-maru-th.html",
    "/igdc-amplify-maru-tl.html",
    "/igdc-amplify-maru-tr.html",
    "/igdc-amplify-maru-uk.html",
    "/igdc-amplify-maru-ur.html",
    "/igdc-amplify-maru-uz.html",
    "/igdc-amplify-maru-vi.html",
    "/igdc-amplify-maru-zh.html",
    "/igdc-amplify-maru-zht.html"
  ]};
