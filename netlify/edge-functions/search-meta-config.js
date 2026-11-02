export const LANGS = ["ko","ar","bn","de","en","es","fa","fr","hi","hu","id","it","ja","ms","nl","pl","pt","ru","sv","sw","ta","th","tl","tr","uk","ur","uz","vi","zh","zht"];

export const PAGE_LABELS = {
  home: "IGDC Global Platform",
  networkhub: "IGDC Global Network Hub",
  distributionhub: "IGDC Global Distribution Hub",
  socialnetwork: "IGDC Global Social Network",
  mediahub: "IGDC Global Media Hub",
  tour: "IGDC Global Travel & Tour",
  donation: "IGDC Global Donation"
};

export const PAGE_DESCRIPTIONS = {
  home: "IGDC Global Platform connects global distribution, content, social networks, media and regional services in one multilingual platform.",
  networkhub: "IGDC Global Network Hub connects global market, network and commerce discovery services.",
  distributionhub: "IGDC Global Distribution Hub connects products, suppliers, regions and global distribution opportunities.",
  socialnetwork: "IGDC Global Social Network connects selected creators, social content and global audiences.",
  mediahub: "IGDC Global Media Hub connects video, audio and media content discovery across regions and languages.",
  tour: "IGDC Global Travel & Tour connects travel, tourism, accommodation and regional discovery.",
  donation: "IGDC Global Donation provides global donation and support information within the IGDC platform."
};

export const BRAND_ALIASES = [
  "IGDC Global",
  "IGDC Platform",
  "IGDC Global Platform",
  "MARU Platform",
  "마루 플랫폼",
  "MARU",
  "마루"
];

export function pageTypeFromPath(pathname) {
  const p = String(pathname || "").toLowerCase();
  for (const key of Object.keys(PAGE_LABELS)) {
    if (new RegExp(`(?:^|/)${key}(?:_[a-z]+)?(?:\\.html)?$`).test(p)) return key;
  }
  if (p === "/" || /(?:^|\/)index(?:\.html)?$/.test(p)) return "home";
  return "";
}

export function languageFromPath(pathname, searchParams) {
  const explicit = String(searchParams?.get?.("lang") || "").toLowerCase();
  if (LANGS.includes(explicit)) return explicit;
  const seg = String(pathname || "").split("/").filter(Boolean)[0]?.toLowerCase() || "";
  if (LANGS.includes(seg)) return seg;
  return "ko";
}

export function localizedRoute(page, lang) {
  if (!page || !PAGE_LABELS[page]) return "/home";
  if (!lang || lang === "ko") return `/${page}`;
  return `/${lang}/${page}_${lang}`;
}
