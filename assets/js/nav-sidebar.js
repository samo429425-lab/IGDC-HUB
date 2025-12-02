(function () {
  // === Supported languages ===
  const SUPPORTED_LANGS = [
    "ko", "en", "de", "fr", "es",
    "ja", "pt", "ru", "th", "tr",
    "vi", "zh", "id"
    // 앞으로 추가할 언어는 여기 배열에 코드만 더 넣으면 됩니다.
  ];

  // 언어별 기본 경로 / 파일 접미어 설정
  function getLangConfig(lang) {
    switch (lang) {
      case "en": return { base: "/en/", suffix: "_en" };
      case "de": return { base: "/de/", suffix: "_de" };
      case "fr": return { base: "/fr/", suffix: "_fr" };
      case "es": return { base: "/es/", suffix: "_es" };
      case "ja": return { base: "/ja/", suffix: "_ja" };
      case "pt": return { base: "/pt/", suffix: "_pt" };
      case "ru": return { base: "/ru/", suffix: "_ru" };
      case "th": return { base: "/th/", suffix: "_th" };
      case "tr": return { base: "/tr/", suffix: "_tr" };
      case "vi": return { base: "/vi/", suffix: "_vi" };
      case "zh": return { base: "/zh/", suffix: "_zh" };
      case "id": return { base: "/id/", suffix: "_id" };
      // 한국어(루트)는 기본값
      default:   return { base: "/",    suffix: ""    };
    }
  }

  // 현재 URL에서 언어 코드 감지
  function detectLangFromPath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const first = segments[0] || "";
    if (SUPPORTED_LANGS.includes(first)) return first;
    return "ko"; // 기본은 한국어(루트)
  }

  // 사이드바에서 인식할 페이지 이름 매핑
  const PAGE_KEY_MAP = {
    "home": "home",
    "home.html": "home",

    "networkhub": "networkhub",
    "networkhub.html": "networkhub",

    "distributionhub": "distributionhub",
    "distributionhub.html": "distributionhub",

    "socialnetwork": "socialnetwork",
    "socialnetwork.html": "socialnetwork",

    "mediahub": "mediahub",
    "mediahub.html": "mediahub",

    "tour": "tour",
    "tour.html": "tour",

    "donation": "donation",
    "donation.html": "donation",

    "literature_academic": "literature_academic",
    "literature_academic.html": "literature_academic"
  };

  function rewriteSidebarLinks() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    const lang = detectLangFromPath();

    // 한국어(루트)는 기존 링크대로 두고, 나머지 언어만 JS로 재작성
    if (lang === "ko") return;

    const cfg = getLangConfig(lang);
    const links = sidebar.querySelectorAll("a[href]");

    links.forEach((a) => {
      const rawHref = a.getAttribute("href");
      if (!rawHref) return;

      // 해시, 외부 링크는 건드리지 않음
      if (rawHref.startsWith("#")) return;
      if (/^https?:\/\//i.test(rawHref)) return;

      // 상대경로 기준으로 파일명만 추출
      const url = new URL(rawHref, window.location.origin);
      const filename = (url.pathname.split("/").pop() || "").trim();
      const noExt = filename.replace(/\.html$/i, "");

      const pageKey =
        PAGE_KEY_MAP[filename] ||
        PAGE_KEY_MAP[noExt];

      if (!pageKey) return;

      const newHref = cfg.base + pageKey + cfg.suffix + ".html";
      a.setAttribute("href", newHref);
    });
  }

  document.addEventListener("DOMContentLoaded", rewriteSidebarLinks);
})();