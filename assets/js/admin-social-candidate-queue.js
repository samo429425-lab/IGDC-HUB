/* IGDC Social Hub Content Operations v3.2.0 - exact candidate-to-front handoff */
(function () {
  "use strict";
  var REVIEW = "/.netlify/functions/social-candidate-review",
    LIVE = "/.netlify/functions/sanmaru-social-live-collector",
    PIPELINE = "/.netlify/functions/sanmaru-social-pipeline-trigger",
    ACTION = "/.netlify/functions/social-candidate-action",
    AUTO = "/.netlify/functions/social-candidate-auto-curator",
    ROTATION = "/.netlify/functions/social-rotation-selector",
    PUBLISH = "/.netlify/functions/social-snapshot-publish",
    STATIC_SOCIAL_SNAPSHOT = "/data/social.snapshot.json",
    COUNTRY = "/.netlify/functions/social-country-route";
  var SECTIONS = [
    ["social-youtube", "YouTube", "youtube"],
    ["social-instagram", "Instagram", "instagram"],
    ["social-tiktok", "TikTok", "tiktok"],
    ["social-facebook", "Facebook", "facebook"],
    ["social-wechat", "WeChat", "wechat"],
    ["social-weibo", "Weibo", "weibo"],
    ["social-pinterest", "Pinterest", "pinterest"],
    ["social-reddit", "Reddit", "reddit"],
    ["social-twitter", "X · Twitter", "twitter"],
  ];
  var order = SECTIONS.map(function (x) {
      return x[0];
    }),
    rows = [],
    diagnosticCache = null,
    systemAuditCache = null,
    openDetailQueue = "",
    openDetailSection = "",
    stopRequested = false,
    liveReports = [],
    placementById = {},
    placementStats = { selected: 0, replacement: 0 },
    countryCatalog = [],
    regionCatalog = [],
    detectedCountry = null,
    previewWindow = null,
    selectedInfluencers = new Set(),
    selectedContents = new Set(),
    selectedHoldContents = new Set(),
    publishedContentIds = new Set(),
    waitingViewMode = "all";
  var $ = function (id) {
      return document.getElementById(id);
    },
    text = function (v) {
      return String(v == null ? "" : v).trim();
    },
    lower = function (v) {
      return text(v).toLowerCase();
    };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  };
  function label(key) {
    var item = SECTIONS.filter(function (x) {
      return x[0] === key;
    })[0];
    return item ? item[1] : key;
  }
  function idx(key) {
    var n = order.indexOf(text(key));
    return n < 0 ? 999 : n;
  }
  function excluded(r) {
    return /^(search_excluded|permanent_blocked|blocked)$/i.test(
      text(r.reviewStatus),
    );
  }
  function blocked(r) {
    return /^(permanent_blocked|blocked)$/i.test(text(r.reviewStatus));
  }
  function contentHold(r) {
    return assetClass(r) === "latest_content" && /^(hold|content_hold|held)$/i.test(text(r.reviewStatus));
  }
  function active() {
    return rows.filter(function (r) {
      return !excluded(r);
    });
  }
  function assetClass(r) {
    var raw = (r && r.raw) || {};
    return text(
      (r && r.assetClass) ||
        raw.assetClass ||
        (raw.latestContentAsset === true
          ? "latest_content"
          : "influencer_registry"),
    );
  }
  function channelIdentity(r) {
    var raw = (r && r.raw) || {};
    return lower(
      (r && r.channelUrl) ||
        raw.channelUrl ||
        (assetClass(r) === "influencer_registry" && r && r.sourceUrl),
    );
  }
  function candidateCountryScopes(r) {
    var raw = (r && r.raw) || {},
      scopes = (r && r.countryScopes) || raw.countryScopes || [];
    return (Array.isArray(scopes) ? scopes : [])
      .map(function (value) { return text(value).toUpperCase(); })
      .filter(Boolean);
  }
  function regionOfCountry(code) {
    var row = countryCatalog.filter(function (item) {
      return text(item.code).toUpperCase() === text(code).toUpperCase();
    })[0];
    return row ? text(row.regionGroup) : "";
  }
  function scopeAffinityScore(r) {
    var scope = currentScope(),
      scopes = candidateCountryScopes(r),
      routeRegion = scope.regionId || regionOfCountry(scope.countryCode),
      regions = scopes.map(regionOfCountry).filter(Boolean);
    if (scope.scopeMode === "global") return scopes.length ? 18 : 34;
    if (scope.countryCode && scopes.indexOf(scope.countryCode) >= 0) return 120;
    if (routeRegion && regions.indexOf(routeRegion) >= 0) return 58;
    if (!scopes.length) return 34;
    return 6;
  }
  function countryScopedActive() {
    return active().slice().sort(function (a, b) {
      return scopeAffinityScore(b) - scopeAffinityScore(a);
    });
  }
  var ADMIN_BEARER_KEY = "igdc.socialCandidateQueue.adminBearer";
  var AUTH_RECORD_KEYS = [
    "osauth.tokens.v2",
    "osauth.tokens.v1",
    "igdc.tokens",
    "igdc_auth_tokens",
    "auth0_tokens",
    "auth0spa",
  ];
  function authStores() {
    var stores = [];
    try {
      stores.push(window.localStorage);
    } catch (_e) {}
    try {
      stores.push(window.sessionStorage);
    } catch (_e) {}
    return stores;
  }
  function parseJson(value) {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return null;
    }
  }
  function jwtPayload(token) {
    try {
      var parts = text(token).split(".");
      if (parts.length !== 3) return null;
      var value = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (value.length % 4) value += "=";
      return JSON.parse(window.atob(value));
    } catch (_e) {
      return null;
    }
  }
  function usableIdToken(token) {
    var payload = jwtPayload(token);
    return !!(
      payload &&
      payload.sub &&
      payload.exp &&
      Number(payload.exp) * 1000 > Date.now() + 15000
    );
  }
  function expectedIssuer() {
    var issuer = "";
    try {
      issuer = text(window.IGDC_AUTH_SESSION && window.IGDC_AUTH_SESSION.issuer);
    } catch (_e) {}
    return (issuer || "https://login.igdcglobal.com/").replace(/\/?$/, "/");
  }
  function pushToken(list, token, source) {
    if (!usableIdToken(token)) return;
    if (
      list.some(function (item) {
        return item.token === token;
      })
    )
      return;
    list.push({ token: token, source: source });
  }
  function adminBearer(excludeDedicated) {
    var candidates = [],
      stores = authStores();
    try {
      if (
        window.IGDCMemberAuth &&
        typeof window.IGDCMemberAuth.getIdToken === "function"
      )
        pushToken(
          candidates,
          window.IGDCMemberAuth.getIdToken(),
          "member-auth",
        );
    } catch (_e) {}
    try {
      if (window.osAuth && typeof window.osAuth.getIdToken === "function")
        pushToken(candidates, window.osAuth.getIdToken(), "os-auth");
    } catch (_e) {}
    stores.forEach(function (store) {
      AUTH_RECORD_KEYS.forEach(function (key) {
        try {
          var record = parseJson(store.getItem(key));
          if (!record || typeof record !== "object") return;
          pushToken(candidates, record.id_token, key);
          pushToken(candidates, record.idToken, key);
          pushToken(candidates, record.__raw, key);
          pushToken(candidates, record.raw, key);
        } catch (_e) {}
      });
      ["igdc_id_token", "id_token", "auth0_id_token"].forEach(function (key) {
        try {
          pushToken(candidates, store.getItem(key), key);
        } catch (_e) {}
      });
    });
    if (!excludeDedicated) {
      stores.forEach(function (store) {
        try {
          pushToken(candidates, store.getItem(ADMIN_BEARER_KEY), "dedicated");
        } catch (_e) {}
      });
    }
    var issuer = expectedIssuer();
    var chosen =
      candidates.filter(function (item) {
        var payload = jwtPayload(item.token);
        return payload && text(payload.iss).replace(/\/?$/, "/") === issuer;
      })[0] || candidates[0];
    if (!chosen) return "";
    if (chosen.source !== "dedicated") {
      stores.forEach(function (store) {
        try {
          store.setItem(ADMIN_BEARER_KEY, chosen.token);
        } catch (_e) {}
      });
    }
    return chosen.token;
  }
  function clearDedicatedBearer() {
    authStores().forEach(function (store) {
      try {
        store.removeItem(ADMIN_BEARER_KEY);
      } catch (_e) {}
    });
  }
  function headers(json, token) {
    var h = { Accept: "application/json" };
    if (json) h["Content-Type"] = "application/json";
    var bearer = token === undefined ? adminBearer(false) : token;
    if (bearer) h.Authorization = "Bearer " + bearer;
    return h;
  }
  async function request(url, options, json) {
    var firstToken = adminBearer(false),
      config = Object.assign({}, options || {}, {
        headers: headers(json, firstToken),
        credentials: "same-origin",
        cache: "no-store",
      }),
      r = await fetch(url, config),
      d;
    if (r.status === 401) {
      clearDedicatedBearer();
      var replacementToken = adminBearer(true);
      if (replacementToken && replacementToken !== firstToken) {
        config.headers = headers(json, replacementToken);
        r = await fetch(url, config);
      }
    }
    try {
      d = await r.json();
    } catch (_e) {}
    if (!r.ok || !d || d.ok !== true) {
      var e = new Error(
        (d && d.message) || (d && d.error) || "요청 실패: HTTP " + r.status,
      );
      e.status = r.status;
      throw e;
    }
    return d;
  }
  async function get(url) {
    return request(url, {}, false);
  }
  async function post(url, body) {
    return request(
      url,
      { method: "POST", body: JSON.stringify(body || {}) },
      true,
    );
  }
  // Report endpoints can return HTTP 200 with ok:false when a diagnostic finds a mismatch.
  // Treat that as a valid report result instead of a transport failure.
  async function getReport(url) {
    var firstToken = adminBearer(false),
      config = {
        headers: headers(false, firstToken),
        credentials: "same-origin",
        cache: "no-store",
      },
      r = await fetch(url, config),
      d;
    if (r.status === 401) {
      clearDedicatedBearer();
      var replacementToken = adminBearer(true);
      if (replacementToken && replacementToken !== firstToken) {
        config.headers = headers(false, replacementToken);
        r = await fetch(url, config);
      }
    }
    try { d = await r.json(); } catch (_e) {}
    if (!r.ok || !d) {
      var e = new Error((d && (d.message || d.error)) || "점검 요청 실패: HTTP " + r.status);
      e.status = r.status;
      throw e;
    }
    return d;
  }
  async function staticJson(url) {
    var separator = url.indexOf("?") >= 0 ? "&" : "?",
      response = await fetch(url + separator + "_=" + Date.now(), {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
      document;
    try {
      document = await response.json();
    } catch (_error) {}
    if (!response.ok || !document) {
      throw new Error("정적 검증 JSON을 읽지 못했습니다: HTTP " + response.status);
    }
    return document;
  }
  function collectionErrorState(error) {
    var message = text(error && error.message);
    return Number(error && error.status) === 401 ||
      /(로그인|인증|세션|token|issuer|audience)/i.test(message)
      ? "관리자 인증 실패"
      : "수집 실패";
  }
  function show(msg, kind) {
    var n = $("notice");
    n.className = "notice" + (kind === "warn" ? " warn" : "");
    n.textContent = msg;
    n.classList.remove("hidden");
  }
  function hide() {
    var n = $("notice");
    n.classList.add("hidden");
    n.textContent = "";
  }
  function score(r) {
    return (
      Number(r.rotationScore || 0) * 2 +
      Number(r.revenueScore || 0) * 1.6 +
      Number(r.qualityScore || 0) * 1.4 +
      Number(r.engagementScore || 0) * 1.1 +
      Number(r.trustScore || 0) +
      Number(r.safetyScore || 0) +
      Number(r.localeScore || 0) * 0.7
    );
  }
  function card(title, value, sub, kind) {
    return (
      '<article class="card"><h2>' +
      esc(title) +
      '</h2><div class="num ' +
      esc(kind || "") +
      '">' +
      esc(value) +
      '</div><div class="small">' +
      esc(sub || "") +
      "</div></article>"
    );
  }
  function renderSummary(s) {
    s = s || {};
    var p = s.rotationPolicy || {},
      excludedCount = rows.filter(function (r) {
        return excluded(r) && !blocked(r);
      }).length,
      blockCount = rows.filter(blocked).length;
    $("summaryGrid").innerHTML = [
      card(
        "인플루언서 등록부",
        active().filter(function (row) {
          return assetClass(row) === "influencer_registry";
        }).length,
        "채널 링크 관리 대상",
      ),
      card(
        "최신 콘텐츠 후보",
        active().filter(function (row) {
          return assetClass(row) === "latest_content";
        }).length,
        "인플루언서별 최신 1건",
      ),
      card(
        "최종 공개 배치",
        placementStats.selected || 0,
        "상위 100 공개/섹션",
        "safe",
      ),
      card(
        "교체 후보 대기",
        placementStats.replacement || 0,
        "정상 후보 보존·교체 준비",
        "hold",
      ),
      card(
        "프런트 승격 가능",
        s.promotableCount || 0,
        "승인+검증+공개 접근 후보",
        "safe",
      ),
      card(
        "검증 대기",
        s.verificationRequired || 0,
        "웹·공개성·위험도 확인 필요",
        "hold",
      ),
      card(
        "검색 제외",
        s.searchExcludedCount == null ? excludedCount : s.searchExcludedCount,
        "접힌 제외 목록 보관",
        "hold",
      ),
      card(
        "영구 차단",
        s.permanentBlockedCount == null ? blockCount : s.permanentBlockedCount,
        "재검색 반입 차단",
        "block",
      ),
      card(
        "섹션별 후보 풀",
        p.targetPerSection || 120,
        "공개 " + (p.publicSlotsPerSection || 100) + "개 + 예비 " + (p.replacementReservePerSection || 20) + "개",
      ),
    ].join("");
    $("summaryGrid").classList.remove("hidden");
  }
  function options() {
    var list = SECTIONS.map(function (x) {
      return (
        '<option value="' + x[0] + '">' + x[1] + " · " + x[0] + "</option>"
      );
    }).join("");
    $("collectorSection").innerHTML = list;
    $("sectionFilter").innerHTML = '<option value="">전체 섹션</option>' + list;
    $("platformFilter").innerHTML =
      '<option value="">전체 플랫폼</option>' +
      SECTIONS.map(function (x) {
        return '<option value="' + x[2] + '">' + x[1] + "</option>";
      }).join("");
  }
  function rawCountrySelection() {
    return text($("collectorCountry").value);
  }
  function explicitGlobalSelected() {
    return rawCountrySelection() === "__GLOBAL__";
  }
  function selectedCountry() {
    var raw = rawCountrySelection();
    return raw === "__GLOBAL__" ? "" : raw.toUpperCase();
  }
  function scopeMode() {
    if (explicitGlobalSelected()) return "global";
    if (selectedCountry()) return "country";
    if (text($("collectorRegion").value)) return "region";
    return "auto";
  }
  function currentScope() {
    var code = selectedCountry();
    var country = countryCatalog.filter(function (row) {
      return text(row.code).toUpperCase() === code;
    })[0];
    return {
      scopeMode: scopeMode(),
      countryCode: code,
      regionId: text($("collectorRegion").value),
      country: country || null,
      explicitGlobal: explicitGlobalSelected(),
    };
  }
  function appendScope(target) {
    var scope = currentScope();
    target.countryCode = scope.countryCode;
    target.regionId = scope.regionId;
    target.scopeMode = scope.scopeMode;
    return target;
  }
  function renderCountryOptions() {
    var region = text($("collectorRegion").value),
      el = $("collectorCountry"),
      old = el.value,
      filtered = countryCatalog.filter(function (row) {
        return !region || row.regionGroup === region;
      }),
      list = filtered
        .map(function (row) {
          return (
            '<option value="' +
            esc(row.code) +
            '">' +
            esc(row.nameKo || row.nameEn || row.code) +
            " · " +
            esc(row.code) +
            "</option>"
          );
        })
        .join("");
    el.innerHTML =
      '<option value="">IP 자동 우선</option>' +
      '<option value="__GLOBAL__">전 세계 공통</option>' +
      list;
    if (old === "__GLOBAL__") el.value = old;
    else if (
      old &&
      filtered.some(function (row) {
        return row.code === old;
      })
    )
      el.value = old;
    renderScopeState();
  }
  function renderScopeState() {
    var scope = currentScope(),
      detected = detectedCountry && detectedCountry.countryCode,
      region = regionCatalog.filter(function (row) { return text(row.id) === scope.regionId; })[0],
      scopeName = scope.scopeMode === "global"
        ? "전 세계 공통"
        : scope.country
          ? (scope.country.nameKo || scope.country.nameEn || scope.country.code) + " (" + scope.countryCode + ")"
          : scope.scopeMode === "region" && region
            ? (region.nameKo || region.nameEn || region.id)
            : "IP 자동 우선";
    $("countryScopeState").textContent =
      "현재 관리·수집·실제 적용 기준: " +
      scopeName +
      " · 후보는 해당 국가 소비성향 → 같은 권역 → 글로벌 순으로 가중치 적용" +
      " · 접속 국가: " +
      (detected || "확인되지 않음");
    $("collectorLanguages").value = "";
  }
  async function detectIpCountry(useDetected) {
    try {
      var d = await get(COUNTRY);
      detectedCountry = d;
      if (useDetected && d.countryCode) {
        var row = countryCatalog.filter(function (item) {
          return item.code === d.countryCode;
        })[0];
        if (row) {
          $("collectorRegion").value = row.regionGroup || "";
          renderCountryOptions();
          $("collectorCountry").value = row.code;
        }
      }
      renderScopeState();
      show(
        d.countryCode
          ? "접속 국가(IP 기준)는 " +
              (d.countryNameKo || d.countryNameEn || d.countryCode) +
              "로 확인됐습니다."
          : "접속 국가를 확인하지 못했습니다. 전 세계 공통 범위로 계속 관리할 수 있습니다.",
        d.countryCode ? "ok" : "warn",
      );
    } catch (e) {
      show(e.message || "접속 국가를 확인하지 못했습니다.", "warn");
    }
  }
  async function countryOptions() {
    try {
      var d = await get(COUNTRY + "?catalog=1");
      countryCatalog = d.countries || [];
      regionCatalog = d.regions || [];
      $("collectorRegion").innerHTML =
        '<option value="">전체 권역</option>' +
        regionCatalog
          .map(function (row) {
            return (
              '<option value="' +
              esc(row.id) +
              '">' +
              esc(row.nameKo || row.nameEn || row.id) +
              "</option>"
            );
          })
          .join("");
      renderCountryOptions();
      await detectIpCountry(false);
    } catch (_e) {
      /* collection remains available without the catalog */
    }
  }
  function fill(id, values, placeholder) {
    var el = $(id),
      old = el.value;
    el.innerHTML =
      '<option value="">' +
      placeholder +
      "</option>" +
      values
        .map(function (x) {
          return '<option value="' + esc(x) + '">' + esc(x) + "</option>";
        })
        .join("");
    if (values.indexOf(old) >= 0) el.value = old;
  }
  function filters(s) {
    s = s || {};
    fill("riskFilter", Object.keys(s.byRisk || {}).sort(), "전체 위험도");
    fill(
      "reviewFilter",
      Object.keys(s.byReview || {})
        .filter(function (x) {
          return !/^(search_excluded|permanent_blocked|blocked)$/i.test(x);
        })
        .sort(),
      "전체 검토상태",
    );
    $("filterPanel").classList.remove("hidden");
  }
  function visible() {
    var q = lower($("searchInput").value),
      section = text($("sectionFilter").value),
      platform = text($("platformFilter").value),
      risk = text($("riskFilter").value),
      review = text($("reviewFilter").value);
    return countryScopedActive()
      .filter(function (r) {
        if (section && r.sectionKey !== section) return false;
        if (platform && r.platform !== platform) return false;
        if (risk && r.riskLevel !== risk) return false;
        if (review && r.reviewStatus !== review) return false;
        if (!q) return true;
        return (
          [
            r.title,
            r.creatorName,
            r.creatorHandle,
            r.platform,
            r.sectionKey,
            r.sourceUrl,
            r.channelUrl,
            r.assetClass,
            r.entityKind,
            r.category,
            r.language,
            r.region,
            (r.countryScopes || []).join(" "),
            (r.languageScopes || []).join(" "),
            r.reviewStatus,
            r.verificationStatus,
          ]
            .map(text)
            .join(" ")
            .toLowerCase()
            .indexOf(q) >= 0
        );
      })
      .sort(function (a, b) {
        return (
          idx(a.sectionKey) - idx(b.sectionKey) ||
          scopeAffinityScore(b) - scopeAffinityScore(a) ||
          score(b) - score(a) ||
          text(a.title).localeCompare(text(b.title))
        );
      });
  }
  function pill(v, k) {
    return (
      '<span class="pill ' + esc(k || "") + '">' + esc(v || "-") + "</span>"
    );
  }
  function status(r) {
    if (r.promotable || r.reviewStatus === "approved") return "safe";
    if (blocked(r)) return "block";
    if (/hold|replacement|search_excluded/i.test(r.reviewStatus)) return "hold";
    return "risk";
  }
  function thumb(r, mode) {
    var raw = r.raw || {},
      url = text(
        mode === "registry"
          ? r.channelThumbnailUrl ||
              raw.channelThumbnailUrl ||
              r.thumbnailUrl
          : r.thumbnailUrl,
      );
    return /^https:\/\//i.test(url)
      ? '<img loading="lazy" referrerpolicy="no-referrer" src="' +
          esc(url) +
          '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'">' +
          '<span class="candidate-thumb-fallback" style="display:none">' +
          esc(r.platform || "SNS") +
          "<br>" +
          esc(r.creatorName || r.title || "공개 미리보기") +
          "</span>"
      : '<span class="candidate-thumb-fallback">' +
          esc(r.platform || "SNS") +
          "<br>" +
          esc(r.creatorName || r.title || "공개 미리보기") +
          "</span>";
  }
  function latestForInfluencer(r) {
    var identity = channelIdentity(r);
    if (!identity) return null;
    return (
      countryScopedActive()
        .filter(function (row) {
          return (
            assetClass(row) === "latest_content" &&
            channelIdentity(row) === identity
          );
        })
        .sort(function (a, b) {
          return (
            (Date.parse(text(b.contentPublishedAt)) || 0) -
              (Date.parse(text(a.contentPublishedAt)) || 0) ||
            score(b) - score(a)
          );
        })[0] || null
    );
  }
  function item(r, queue) {
    var id = esc(r.id),
      raw = r.raw || {},
      registry = queue === "registry",
      latest = registry ? latestForInfluencer(r) : null,
      entity = text(r.entityKind || raw.entityKind || "latest_post"),
      placement = text(placementById[r.id]),
      countries = (r.countryScopes || raw.countryScopes || []).join(","),
      languages = (r.languageScopes || raw.languageScopes || []).join(","),
      primaryUrl = registry
        ? text(r.channelUrl || raw.channelUrl || r.sourceUrl)
        : text(r.latestContentUrl || r.sourceUrl),
      holdQueue = queue === "hold",
      checked = (
        registry ? selectedInfluencers : holdQueue ? selectedHoldContents : selectedContents
      ).has(text(r.id)),
      policy = [
        "공개 " + (r.publicAccess ? "확인" : "확인 필요"),
        r.loginRequired ? "로그인 장벽" : "",
        r.riskLevel ? "위험 " + r.riskLevel : "",
      ]
        .filter(Boolean)
        .join(" · ");
    return (
      '<article class="candidate-card' +
      (checked ? " selected" : "") +
      '"><input class="candidate-card-check rowcheck ' +
      (registry ? "finalCheck" : holdQueue ? "holdCheck" : "waitingCheck") +
      '" type="checkbox" data-candidate-id="' +
      id +
      '"' +
      (checked ? " checked" : "") +
      '" aria-label="' +
      esc(r.title || id) +
      ' 선택"><a class="candidate-thumb-button previewLink" href="' +
      esc(primaryUrl || "#") +
      '">' +
      thumb(r, registry ? "registry" : "content") +
      '</a><div class="candidate-card-body"><div class="candidate-card-title">' +
      esc(
        registry
          ? r.creatorName || r.title || "(인플루언서 이름 없음)"
          : r.title || "(콘텐츠 제목 없음)",
      ) +
      '</div><div class="candidate-card-meta">' +
      pill(label(r.sectionKey), "section") +
      pill(r.platform, "platform") +
      pill(registry ? "인플루언서" : entity, "") +
      (placement
        ? pill(
            placement === "public_selected" ? "최종 100" : "교체 대기",
            placement === "public_selected" ? "safe" : "hold",
          )
        : "") +
      pill(r.reviewStatus || "pending", status(r)) +
      '</div><div class="candidate-card-detail">' +
      esc(
        registry
          ? latest
            ? "최신 콘텐츠 후보 1개 · " + text(latest.title)
            : "최신 콘텐츠 후보 0개"
          : r.creatorName || r.creatorHandle || "채널 운영자 정보 없음",
      ) +
      "<br>" +
      esc(
        [
          countries && "국가 " + countries,
          languages && "언어 " + languages,
          r.category && "주제 " + r.category,
          !registry &&
            r.contentPublishedAt &&
            "게시 " + r.contentPublishedAt.slice(0, 10),
        ]
          .filter(Boolean)
          .join(" · ") || "국가·언어 공통",
      ) +
      "<br>" +
      esc(policy) +
      "<br>점수 " +
      Math.round(score(r)) +
      " · " +
      esc(r.verificationStatus || "검증 대기") +
      '</div><div class="candidate-card-footer"><a class="secondary previewLink" href="' +
      esc(primaryUrl || "#") +
      '">' +
      (registry ? "인플루언서 채널 열기" : "최신 콘텐츠 열기") +
      "</a>" +
      (registry && latest
        ? '<a class="secondary previewLink" href="' +
          esc(latest.sourceUrl || "#") +
          '">최신 콘텐츠 확인</a>'
        : "") +
      '<button class="secondary sourceBtn" type="button" data-candidate-id="' +
      id +
      '">주소 확인</button></div></div></article>'
    );
  }
  function sectionIds(container, section, checkboxClass) {
    var source =
      checkboxClass === "finalCheck"
        ? selectedInfluencers
        : checkboxClass === "holdCheck"
          ? selectedHoldContents
          : selectedContents;
    return Array.from(source).filter(function (id) {
      return rows.some(function (row) {
        return text(row.id) === id && row.sectionKey === section;
      });
    });
  }
  function queueRows(queue, section) {
    return visible().filter(function (row) {
      var kindOk = assetClass(row) === (queue === "registry" ? "influencer_registry" : "latest_content");
      if (!kindOk) return false;
      if (queue === "hold" && !contentHold(row)) return false;
      if (queue === "waiting" && contentHold(row)) return false;
      return !section || row.sectionKey === section;
    });
  }
  function selectQueue(queue, section, checked) {
    var target =
      queue === "registry" ? selectedInfluencers : queue === "hold" ? selectedHoldContents : selectedContents;
    queueRows(queue, section).forEach(function (row) {
      if (checked) target.add(text(row.id));
      else target.delete(text(row.id));
    });
    renderSections();
    show(
      (section ? label(section) + " " : "현재 조회 범위 ") +
        (queue === "registry" ? "인플루언서" : "최신 콘텐츠") +
        (checked ? " 전체를 선택했습니다." : " 선택을 해제했습니다."),
      "ok",
    );
  }
  function updateMasterSelectionState() {
    [["registry", selectedInfluencers, "selectAllFinalMaster"], ["content", selectedContents, "selectAllWaitingMaster"]].forEach(function (entry) {
      var list = queueRows(entry[0], ""), el = $(entry[2]);
      if (!el) return;
      var count = list.filter(function (row) { return entry[1].has(text(row.id)); }).length;
      el.checked = list.length > 0 && count === list.length;
      el.indeterminate = count > 0 && count < list.length;
      el.disabled = list.length === 0;
    });
  }
  function toggleWholeQueue(queue, checked) {
    selectQueue(queue, "", checked);
    updateMasterSelectionState();
  }
  function pruneSelections() {
    var ids = new Set(
      rows.map(function (row) {
        return text(row.id);
      }),
    );
    [selectedInfluencers, selectedContents, selectedHoldContents].forEach(function (selection) {
      Array.from(selection).forEach(function (id) {
        if (!ids.has(id)) selection.delete(id);
      })
    });
  }
  function finalActions(key) {
    return (
      '<div class="section-actionbar"><span class="section-note small">인플루언서 등록과 최신 콘텐츠 배치는 별도로 관리됩니다.</span>' +
      '<button class="secondary" type="button" data-section-select-all="' +
      esc(key) +
      '">섹션 전체 선택</button>' +
      '<button class="secondary" type="button" data-section-clear-all="' +
      esc(key) +
      '">선택 해제</button>' +
      '<button type="button" data-section-approve="' +
      esc(key) +
      '">선택 인플루언서 승인</button>' +
      '<button class="publish" type="button" data-section-ai="' +
      esc(key) +
      '">AI 자동 정리</button>' +
      '<button class="danger" type="button" data-section-block="' +
      esc(key) +
      '">선택 영구 차단</button></div>'
    );
  }
  function waitingActions(key) {
    return (
      '<div class="section-actionbar"><span class="section-note small">후보 등록/해제와 프론트 등록/해제를 분리해서 관리합니다.</span>' +
      '<button class="secondary" type="button" data-waiting-select-all="' + esc(key) + '">섹션 전체 선택</button>' +
      '<button class="secondary" type="button" data-waiting-clear-all="' + esc(key) + '">선택 해제</button>' +
      '<button type="button" data-waiting-promote="' + esc(key) + '">선택 후보 등록</button>' +
      '<button class="secondary" type="button" data-waiting-demote="' + esc(key) + '">선택 후보 등록 해제</button>' +
      '<button class="publish" type="button" data-waiting-publish="' + esc(key) + '">이 SNS 프론트 등록</button>' +
      '<button class="danger" type="button" data-waiting-unpublish-all="' + esc(key) + '">이 SNS 프론트 등록 해제</button>' +
      '<button class="danger" type="button" data-waiting-unpublish="' + esc(key) + '">선택 콘텐츠 프론트 해제</button>' +
      '<button class="publish" type="button" data-waiting-ai="' + esc(key) + '">이 SNS AI 자동 수집·교체</button>' +
      '<button class="danger" type="button" data-waiting-delete="' + esc(key) + '">선택 리스트 삭제</button>' +
      '<button class="danger" type="button" data-waiting-block="' + esc(key) + '">선택 영구 차단</button></div>'
    );
  }
  function holdActions(key) {
    return (
      '<div class="section-actions">' +
      '<button type="button" data-hold-restore="' + esc(key) + '">선택 리스트 복구</button>' +
      '<button class="secondary" type="button" data-hold-delete="' + esc(key) + '">선택 리스트 삭제</button>' +
      '<button class="danger" type="button" data-hold-block="' + esc(key) + '">선택 완전 차단</button></div>'
    );
  }
  function accordionHtml(list, queue, openKey) {
    return order
      .map(function (key) {
        var part = list.filter(function (r) {
            return r.sectionKey === key;
          });
        if (queue === "waiting" && part.length > 120) part = part.slice(0, 120);
        var isOpen = openKey === key,
          toggleAttribute =
            queue === "registry" ? "data-final-toggle" : queue === "hold" ? "data-hold-toggle" : "data-waiting-toggle";
        return (
          '<section class="candidate-section ' +
          (isOpen ? "open" : "") +
          '" data-section="' +
          esc(key) +
          '"><button class="section-toggle" type="button" ' +
          toggleAttribute +
          '="' +
          esc(key) +
          '"><span class="section-toggle-main"><span class="section-toggle-title">' +
          esc(label(key)) +
          '</span><span class="section-count">' +
          part.length +
          (queue === "registry" ? "명" : "개") +
          '</span></span><span class="section-chevron">⌄</span></button>' +
          (isOpen
            ? '<div class="section-body">' +
              (queue === "registry" ? finalActions(key) : queue === "hold" ? holdActions(key) : waitingActions(key)) +
              (part.length
                ? '<div class="candidate-card-grid">' +
                  part
                    .map(function (row) {
                      return item(row, queue);
                    })
                    .join("") +
                  "</div>"
                : '<div class="empty-section">현재 이 범위에 해당하는 항목이 없습니다.</div>') +
              "</div>"
            : "") +
          "</section>"
        );
      })
      .join("");
  }
  function waitingPlacement(row) {
    return text(placementById[text(row && row.id)]);
  }
  function waitingViewAccept(row) {
    var placement = waitingPlacement(row), id = text(row && row.id);
    if (waitingViewMode === "public") return placement === "public_selected";
    if (waitingViewMode === "replacement") return placement === "replacement_waiting";
    if (waitingViewMode === "new") return !placement;
    if (waitingViewMode === "front") return publishedContentIds.has(id);
    return true;
  }
  function updateReplacementControl(waitingAll, waitingVisible) {
    var el = $("replacementControlState");
    if (!el) return;
    var fresh = waitingAll.filter(function (r) { return !waitingPlacement(r); }).length,
      current = waitingAll.filter(function (r) { return waitingPlacement(r) === "public_selected"; }).length,
      replacement = waitingAll.filter(function (r) { return waitingPlacement(r) === "replacement_waiting"; }).length,
      front = waitingAll.filter(function (r) { return publishedContentIds.has(text(r && r.id)); }).length,
      hold = rows.filter(contentHold).length;
    el.textContent = "전체 후보 " + waitingAll.length + "개 · 새 수집 " + fresh + "개 · 적용 예정 " + current + "개 · 예비 " + replacement + "개 · 현재 프론트 " + front + "개";
    if ($("contentCountAll")) $("contentCountAll").textContent = waitingAll.length + "개";
    if ($("contentCountNew")) $("contentCountNew").textContent = fresh + "개";
    if ($("contentCountPublic")) $("contentCountPublic").textContent = current + "개";
    if ($("contentCountReserve")) $("contentCountReserve").textContent = replacement + "개";
    if ($("contentCountFront")) $("contentCountFront").textContent = front + "개";
    if ($("contentCountHold")) $("contentCountHold").textContent = hold + "개";
    ["replacementViewAllBtn","replacementViewNewBtn","replacementViewPublicBtn","replacementViewWaitingBtn","replacementViewFrontBtn"].forEach(function (id) {
      var b=$(id); if (b) b.classList.remove("publish");
    });
    var activeId = waitingViewMode === "new" ? "replacementViewNewBtn" : waitingViewMode === "public" ? "replacementViewPublicBtn" : waitingViewMode === "replacement" ? "replacementViewWaitingBtn" : waitingViewMode === "front" ? "replacementViewFrontBtn" : "replacementViewAllBtn";
    if ($(activeId)) $(activeId).classList.add("publish");
  }
  function renderSections() {
    var list = visible(),
      finalList = list.filter(function (row) {
        return assetClass(row) === "influencer_registry";
      }),
      waitingAll = list.filter(function (row) {
        return assetClass(row) === "latest_content" && !contentHold(row);
      }),
      holdList = list.filter(contentHold),
      waitingList = waitingAll.filter(waitingViewAccept);
    $("filterState").textContent =
      "표시 " +
      list.length +
      "개 / 활성 후보 " +
      active().length +
      "개 / 제외·차단 " +
      rows.filter(excluded).length +
      "개";
    // 인플루언서/콘텐츠 전체에서 상세 썸네일 목록은 항상 하나만 렌더링한다.
    // 초기 상태는 모두 접힘으로 두어 이미지/DOM 과부하를 막는다.
    if (openDetailSection && order.indexOf(openDetailSection) < 0) {
      openDetailQueue = "";
      openDetailSection = "";
    }
    $("candidateCapacityState").textContent =
      "인플루언서 " + finalList.length + "명 · 채널 링크 등록부";
    $("waitingCapacityState").textContent =
      "최신 콘텐츠 " +
      waitingAll.length +
      "개 · 공개 " +
      placementStats.selected +
      "개 · 교체 " +
      placementStats.replacement +
      "개";
    if ($("holdCapacityState")) $("holdCapacityState").textContent = "보류 " + holdList.length + "개 · 삭제·차단 전 임시 보관";
    updateReplacementControl(waitingAll, waitingList);
    $("sectionAccordion").innerHTML = accordionHtml(
      finalList,
      "registry",
      openDetailQueue === "registry" ? openDetailSection : "",
    );
    $("waitingAccordion").innerHTML = accordionHtml(
      waitingList,
      "waiting",
      openDetailQueue === "content" ? openDetailSection : "",
    );
    if ($("holdAccordion")) $("holdAccordion").innerHTML = accordionHtml(
      holdList,
      "hold",
      openDetailQueue === "hold" ? openDetailSection : "",
    );
    $("tablePanel").classList.remove("hidden");
    $("waitingPanel").classList.remove("hidden");
    if ($("holdPanel")) $("holdPanel").classList.remove("hidden");
    updateMasterSelectionState();
  }
  function excludedRow(r, n) {
    var restore =
      (r.raw &&
        r.raw.exclusionRestore &&
        r.raw.exclusionRestore.reviewStatus) ||
      "보류";
    return (
      "<tr><td>" +
      n +
      '</td><td><input class="excludedCheck" type="checkbox" data-candidate-id="' +
      esc(r.id) +
      '"></td><td>' +
      pill(label(r.sectionKey), "section") +
      "</td><td>" +
      pill(
        blocked(r) ? "영구 차단" : "검색 제외",
        blocked(r) ? "block" : "hold",
      ) +
      '</td><td><span class="candidate-title">' +
      esc(r.title || "(제목 없음)") +
      '</span><div class="mono small">' +
      esc(r.id) +
      "</div></td><td>" +
      esc(restore) +
      "</td><td>" +
      esc(r.blockedReason || r.reviewNote || "-") +
      "</td><td>" +
      esc(r.platform || "-") +
      '</td><td class="nowrap">' +
      esc(r.reviewedAt || r.updatedAt || r.createdAt || "-") +
      "</td></tr>"
    );
  }
  function renderExclusions() {
    var list = rows.filter(excluded).sort(function (a, b) {
        return (
          idx(a.sectionKey) - idx(b.sectionKey) ||
          text(a.title).localeCompare(text(b.title))
        );
      }),
      n = 0,
      html = "";
    order.forEach(function (k) {
      var part = list.filter(function (r) {
        return r.sectionKey === k;
      });
      if (part.length) {
        html +=
          '<tr class="group-row"><td colspan="9">' +
          esc(label(k)) +
          " · " +
          part.length +
          "개</td></tr>" +
          part
            .map(function (r) {
              n++;
              return excludedRow(r, n);
            })
            .join("");
      }
    });
    $("excludedRows").innerHTML =
      html ||
      '<tr><td colspan="9" class="small">검색 제외 또는 영구 차단 항목이 없습니다.</td></tr>';
    $("exclusionSummary").textContent =
      "검색 제외 " +
      list.filter(function (r) {
        return !blocked(r);
      }).length +
      "건 · 영구 차단 " +
      list.filter(blocked).length +
      "건 · 전체 " +
      list.length +
      "건";
    $("exclusionPanel").classList.remove("hidden");
  }
  function diagnostic(data) {
    diagnosticCache = data;
    $("diagnosticJson").textContent = JSON.stringify(data, null, 2);
    if ($("downloadJsonBtn")) $("downloadJsonBtn").disabled = false;
  }
  function toggleDiagnosticPanel(forceOpen) {
    var body = $("diagnosticBody"), button = $("toggleDiagnosticPanelBtn");
    if (!body || !button) return;
    var open = forceOpen === true || (forceOpen !== false && body.classList.contains("hidden"));
    body.classList.toggle("hidden", !open);
    button.textContent = open ? "점검창 접기" : "점검창 펼치기";
  }
  function download(name, value) {
    var b = new Blob(
        [
          typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2) + "\n",
        ],
        { type: "application/json;charset=utf-8" },
      ),
      a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 300);
  }
  function collectorSectionSummary() {
    var summary = {};
    SECTIONS.forEach(function (section) {
      var key = section[0],
        list = rows.filter(function (row) {
          return row.sectionKey === key;
        });
      summary[key] = {
        label: section[1],
        platform: section[2],
        total: list.length,
        influencers: list.filter(function (row) {
          return assetClass(row) === "influencer_registry";
        }).length,
        latestContents: list.filter(function (row) {
          return assetClass(row) === "latest_content";
        }).length,
        active: list.filter(function (row) {
          return !excluded(row);
        }).length,
        searchExcluded: list.filter(function (row) {
          return excluded(row) && !blocked(row);
        }).length,
        permanentlyBlocked: list.filter(blocked).length,
      };
    });
    return summary;
  }
  function downloadCollectorProgress() {
    var now = new Date(),
      report = {
        ok: true,
        reportType: "igdc-social-latest-content-collection-progress",
        generatedAt: now.toISOString(),
        scope: Object.assign({}, currentScope(), {
          selectedCountryCode: selectedCountry() || null,
          detectedCountryCode: text(detectedCountry && detectedCountry.countryCode).toUpperCase() || null,
          detectionAvailable: !!text(detectedCountry && detectedCountry.countryCode)
        }),
        selectedSection: text($("collectorSection").value),
        selectedBatchSize: Number($("collectorBatchSize").value) || 10,
        collectorState: text($("collectorState").textContent),
        savedJob: loadJob(),
        sectionSummary: collectorSectionSummary(),
        collectionBatches: liveReports.map(function (row) {
          return row && row.liveCollection ? row.liveCollection : row;
        }),
        candidateData: {
          count: rows.length,
          rows: rows,
        },
      };
    download(
      "igdc-social-latest-content-collection-progress-" +
        now.toISOString().slice(0, 19).replace(/[:T]/g, "-") +
        ".json",
      report,
    );
    show(
      "현재 수집 진행 상황과 후보 데이터 JSON을 다운로드했습니다.",
      "ok",
    );
  }
  function applyPlacement(d) {
    placementById = {};
    placementStats = { selected: 0, replacement: 0 };
    var rotation = (d && d.rotation) || {};
    Object.keys(rotation.selected || {}).forEach(function (section) {
      (rotation.selected[section] || []).forEach(function (row) {
        if (row && row.id) {
          placementById[row.id] = "public_selected";
          placementStats.selected += 1;
        }
      });
    });
    Object.keys(rotation.replacement || {}).forEach(function (section) {
      (rotation.replacement[section] || []).forEach(function (row) {
        if (row && row.id) {
          placementById[row.id] = "replacement_waiting";
          placementStats.replacement += 1;
        }
      });
    });
  }
  async function loadPlacement() {
    try {
      var q = new URLSearchParams({
          includeRows: "1",
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
          languages: text($("collectorLanguages").value),
        }),
        d = await get(ROTATION + "?" + q.toString());
      applyPlacement(d);
      return d;
    } catch (_e) {
      placementById = {};
      placementStats = { selected: 0, replacement: 0 };
      return null;
    }
  }
  async function loadPublishedState() {
    publishedContentIds = new Set();
    try {
      var d = await staticJson(STATIC_SOCIAL_SNAPSHOT),
        sections = (d && d.pages && d.pages.social && d.pages.social.sections) || {};
      order.forEach(function (key) {
        (Array.isArray(sections[key]) ? sections[key] : []).forEach(function (slot) {
          var audit = (slot && slot.audit) || {}, id = publishedCandidateId(slot);
          if (id && text(slot && slot.type) === "external_social" && text(audit.origin) === "social_candidates") publishedContentIds.add(id);
        });
      });
    } catch (_e) {
      publishedContentIds = new Set();
    }
    return publishedContentIds;
  }

  async function refresh() {
    hide();
    $("refreshBtn").disabled = true;
    try {
      var d = await get(REVIEW + "?action=candidates");
      rows = (d.queue && d.queue.rows) || d.candidates || [];
      pruneSelections();
      await loadPlacement();
      await loadPublishedState();
      renderSummary(d.summary);
      filters(d.summary);
      renderSections();
      renderExclusions();
      $("state").textContent =
        "연결 정상 · " +
        ((d.source && d.source.candidateSourceMode) || "read_only");
      show(
        "인플루언서 등록부와 최신 콘텐츠 후보·교체 대기열을 분리해 읽었습니다.",
        "ok",
      );
    } catch (e) {
      show(e.message || "대기열을 읽지 못했습니다.", "warn");
    } finally {
      $("refreshBtn").disabled = false;
    }
  }
  function jobKey() {
    return "igdc.socialCollector.job.v2";
  }
  function loadJob() {
    try {
      return JSON.parse(localStorage.getItem(jobKey()) || "null");
    } catch (_e) {
      return null;
    }
  }
  function saveJob(j) {
    try {
      localStorage.setItem(jobKey(), JSON.stringify(j));
    } catch (_e) {}
  }
  function clearJob() {
    try {
      localStorage.removeItem(jobKey());
    } catch (_e) {}
  }
  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  function configured(v) {
    return v && v.ready ? "설정됨" : "미설정";
  }
  function providerName(value) {
    return (
      {
        "wikidata-public-social-directory": "키 없는 공개 디렉터리",
        "youtube-data-api-channel": "YouTube API",
        "google-cse-channel": "Google CSE",
        "naver-web-channel": "Naver 검색",
        "sanmaru-public-search": "산마루·SearchBank",
      }[text(value)] || text(value)
    );
  }
  function providerState(value) {
    return (
      {
        ok: "정상",
        not_configured: "미설정",
        route_skipped: "국가 경로 제외",
        quota_or_api_disabled: "할당량·API 확인 필요",
        credential_or_quota_error: "키·할당량 확인 필요",
        rate_limited: "호출 제한",
        timeout: "응답 지연",
        error: "오류",
        unsupported_platform: "미지원",
      }[text(value)] || text(value)
    );
  }
  function renderProviderStatus(d) {
    var p = (d && d.providerReadiness) || {},
      b = p.apiKeyBundle || {},
      g = p.googleCustomSearch || {},
      y = p.youtubeDataApi || {},
      n = p.naverSearch || {},
      w = p.publicSocialDirectory || {},
      c = p.countryLanguageRouting || {},
      u = p.directPublicUrlIntake || {},
      m = p.channelPromotion || {},
      req = Array.isArray(p.requirements) ? p.requirements : [];
    var bundleState = b.configured
      ? b.validJson
        ? "형식 정상"
        : b.recoveredKeyNames
          ? "문법 오류지만 키 항목 임시 복구"
          : "형식 오류"
      : "미사용/개별 환경변수 방식";
    var lines = [
      "<strong>검색 제공자 상태</strong>",
      "키 없는 공개 SNS 디렉터리: " + configured(w) + " · " + esc(w.role || ""),
      "Google Custom Search: " + configured(g) + " · " + esc(g.role || ""),
      "YouTube Data API: " + configured(y) + " · " + esc(y.role || ""),
      "Naver Search: " + configured(n) + " · " + esc(n.role || ""),
      "국가·언어 배치: " + configured(c) + " · " + esc(c.role || ""),
      "채널 식별·최신 콘텐츠 유지: " +
        configured(m) +
        " · " +
        esc(m.role || ""),
      "공개 URL 직접 반입: " + configured(u) + " · " + esc(u.role || ""),
      "키 묶음 JSON: " + bundleState,
      "SearchBank 실후보 반입: " +
        configured(p.searchBankImport) +
        " · " +
        esc((p.searchBankImport && p.searchBankImport.role) || ""),
    ].map(function (x) {
      return '<div class="small">' + x + "</div>";
    });
    if (req.length)
      lines.push(
        '<div class="small" style="margin-top:8px"><strong>추가 필요사항</strong><br>' +
          req
            .map(function (x) {
              return esc(x.key) + " — " + esc(x.neededFor);
            })
            .join("<br>") +
          "</div>",
      );
    $("providerStatus").innerHTML = lines.join("");
    $("providerStatus").classList.remove("hidden");
  }
  async function providerStatus() {
    try {
      var d = await get(LIVE);
      renderProviderStatus(d);
      show(
        d.providerReadiness && d.providerReadiness.collectionCanRun
          ? "키 없이 작동하는 공개 디렉터리·YouTube 최신 영상 RSS를 포함해 최신 콘텐츠 검색 경로가 준비되어 있습니다."
          : "자동 검색 경로를 사용할 수 없습니다. 제공자 상태를 확인해 주세요.",
        d.providerReadiness && d.providerReadiness.collectionCanRun
          ? "ok"
          : "warn",
      );
    } catch (e) {
      show(e.message, "warn");
    }
  }
  function sectionCount(section) {
    return countryScopedActive().filter(function (r) {
      return (
        r.sectionKey === section && assetClass(r) === "latest_content"
      );
    }).length;
  }
  function newIds(data, known) {
    var list = (data && data.itemsPreview) || [],
      added = 0;
    list.forEach(function (row) {
      var id = text(row && row.id),
        kind = text(row && row.assetClass);
      if (kind && kind !== "latest_content") return;
      if (id && !known.has(id)) {
        known.add(id);
        added += 1;
      }
    });
    return added;
  }
  function progress(j) {
    var pct = Math.min(
      100,
      Math.round(
        (Number(j.sectionCount || 0) / Math.max(1, Number(j.target || 1))) *
          100,
      ),
    );
    $("collectorProgress").classList.remove("hidden");
    $("collectorProgressText").textContent =
      j.index +
      1 +
      "/" +
      j.total +
      " · " +
      label(j.section) +
      " · 현재 " +
      j.sectionCount +
      "/" +
      j.target +
      "개 · " +
      j.batch +
      "묶음 · 검색 " +
      j.searched +
      "건 · 최신 콘텐츠 후보 " +
      j.direct +
      "건 · 신규 " +
      j.newlyFound +
      "건" +
      (j.qualitySweepActive
        ? " · 인기·품질 보강 " +
          j.qualitySweepBatches +
          "/" +
          Number(j.qualitySweepTarget || 3)
        : "") +
      (j.providerGroupName
        ? " · 조사 경로 " + j.providerGroupName
        : "");
    $("collectorRejectText").textContent =
      "저장 응답 " +
      j.saved +
      "건 · 제외·보존 " +
      j.skipped +
      "건 · 연속 신규없음 " +
      j.emptyBatches +
      "회" +
      (j.lastReason ? " · 최근 사유: " + j.lastReason : "");
    $("collectorProgressBar").style.width = pct + "%";
    $("collectorState").textContent = j.paused
      ? "일시정지됨"
      : label(j.section) +
        " " +
        (j.qualitySweepActive
          ? "인기·품질 보강 검색 중"
          : j.batchSize + "개 단위 조사 중");
  }
  async function collectOne(section, dryRun, j) {
    var d = await post(LIVE, {
      action: "collect_live",
      dryRun: !!dryRun,
      qualitySweep: !!j.qualitySweepActive,
      sectionKey: section,
      limit: j.batchSize,
      batchSize: j.batchSize,
      queryPasses: 1,
      queryCursor: j.queryCursor || 0,
      countryCode: j.countryCode || "",
      regionId: j.regionId || "",
      scopeMode: j.scopeMode || (j.countryCode ? "country" : (j.regionId ? "region" : "auto")),
      languages: j.languages || "",
    });
    liveReports.push(d);
    var live = d.liveCollection || {};
    j.searched += Number(live.searchedRows || 0);
    j.direct += Number(live.directCandidates || 0);
    j.accepted += Number(d.accepted || 0);
    j.saved += Number(d.saved || 0);
    j.skipped += Number(d.excludedSkipped || 0);
    var traces = (live.providerTrace || []).reduce(function (all, row) {
      return all.concat((row && row.providers) || []);
    }, []);
    var traceSummary = traces
      .map(function (row) {
        return (
          providerName(row.provider) +
          ":" +
          providerState(row.status) +
          "(" +
          Number(row.count || 0) +
          ")"
        );
      })
      .filter(Boolean)
      .join(", ");
    j.lastReason = text(
      traceSummary ||
        (live.rejectedByReason && Object.keys(live.rejectedByReason)[0]) ||
        "",
    );
    j.queryCursor = Number(
      live.nextQueryCursor == null
        ? (j.queryCursor || 0) + 1
        : live.nextQueryCursor,
    );
    j.catalogSize = Number(live.queryCatalogSize || j.catalogSize || 5);
    j.providerGroup = Number(live.providerGroup || 0);
    j.providerGroupName =
      {
        public_directory: "공개 디렉터리",
        configured_search_apis: "YouTube·Google·Naver",
        sanmaru_searchbank: "산마루·SearchBank",
      }[text(live.providerGroupName)] || text(live.providerGroupName);
    return d;
  }
  async function collectSection(section, dryRun, j) {
    var known = new Set(
      rows
        .map(function (r) {
          return text(r.id);
        })
        .filter(Boolean),
    );
    j.section = section;
    j.sectionCount = sectionCount(section);
    j.qualitySweepBatches = Number(j.qualitySweepBatches || 0);
    var maxEmpty = Math.max(6, Number(j.catalogSize || 15));
    while (
      !stopRequested &&
      j.sectionCount < j.target &&
      j.emptyBatches < maxEmpty
    ) {
      j.qualitySweepActive = false;
      j.batch += 1;
      progress(j);
      var d = await collectOne(section, dryRun, j);
      maxEmpty = Math.max(maxEmpty, Number(j.catalogSize || 15));
      var newly = newIds(d, known);
      j.newlyFound += newly;
      j.sectionCount += newly;
      if (newly) j.emptyBatches = 0;
      else j.emptyBatches += 1;
      progress(j);
      saveJob(j);
      if (dryRun) break;
      if (!stopRequested && j.sectionCount < j.target) await wait(650);
    }
    if (
      !dryRun &&
      !stopRequested &&
      j.sectionCount >= j.target &&
      !j.qualitySweepDone
    ) {
      j.qualitySweepActive = true;
      j.qualitySweepTarget = Math.max(
        3,
        Number(j.qualitySweepTarget || 3),
      );
      for (
        var sweep = 0;
        sweep < j.qualitySweepTarget &&
        !stopRequested &&
        j.emptyBatches < maxEmpty;
        sweep++
      ) {
        j.batch += 1;
        j.qualitySweepBatches += 1;
        progress(j);
        var q = await collectOne(section, false, j),
          qualityNew = newIds(q, known);
        maxEmpty = Math.max(maxEmpty, Number(j.catalogSize || 15));
        j.newlyFound += qualityNew;
        j.sectionCount += qualityNew;
        if (qualityNew) j.emptyBatches = 0;
        else j.emptyBatches += 1;
        progress(j);
        saveJob(j);
        if (sweep < j.qualitySweepTarget - 1 && !stopRequested)
          await wait(650);
      }
      j.qualitySweepDone = true;
      j.qualitySweepActive = false;
      saveJob(j);
    }
    return j.sectionCount;
  }
  function lockCollection(locked) {
    $("collectAllBtn").disabled = locked;
    $("collectSectionBtn").disabled = locked;
    $("collectDryRunBtn").disabled = locked;
    $("collectorStopBtn").disabled = !locked;
  }
  function newJob(section, index, total) {
    var batchSize = Math.max(
      8,
      Math.min(12, Number($("collectorBatchSize").value) || 10),
    );
    return {
      index: index || 0,
      total: total || 1,
      section: section,
      target: 120,
      batchSize: batchSize,
      countryCode: selectedCountry(),
      scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
      languages: text($("collectorLanguages").value),
      batch: 0,
      queryCursor: 0,
      catalogSize: 15,
      sectionCount: sectionCount(section),
      searched: 0,
      direct: 0,
      accepted: 0,
      saved: 0,
      skipped: 0,
      newlyFound: 0,
      emptyBatches: 0,
      qualitySweepBatches: 0,
      qualitySweepTarget: 3,
      qualitySweepDone: false,
      qualitySweepActive: false,
      lastReason: "",
      paused: false,
    };
  }
  async function collectSelected(dry) {
    hide();
    stopRequested = false;
    lockCollection(true);
    var key = $("collectorSection").value,
      j = newJob(key, 0, 1);
    var failed = false;
    try {
      await collectSection(key, dry, j);
      j.done = 1;
      j.paused = stopRequested;
      saveJob(j);
      diagnostic({
        reportType: "igdc-social-section-batch-collection-report",
        generatedAt: new Date().toISOString(),
        section: key,
        dryRun: !!dry,
        summary: j,
        batches: liveReports.map(function (x) {
          return x.liveCollection || x;
        }),
      });
      if (!dry) {
        waitingViewMode = "new";
        openDetailQueue = "content";
        openDetailSection = key;
        await refresh();
      }
      show(
        label(key) +
          " " +
          (dry ? "1묶음 점검" : "섹션 수집") +
          " 완료: 현재 " +
          j.sectionCount +
          "/" +
          j.target +
          "개, " +
          j.batch +
          "묶음, 신규 " +
          j.newlyFound +
          "개." +
          (j.emptyBatches
            ? " 탐색 한도에서 신규 후보가 더 이상 확인되지 않았습니다."
            : ""),
        j.newlyFound ? "ok" : "warn",
      );
    } catch (e) {
      failed = true;
      j.paused = true;
      saveJob(j);
      $("collectorState").textContent = collectionErrorState(e);
      show(
        (e.message || "수집 오류") + " · 현재 지점은 저장되었습니다.",
        "warn",
      );
    } finally {
      lockCollection(false);
      stopRequested = false;
      if (!failed)
        $("collectorState").textContent = j.paused
          ? "일시정지됨"
          : "수집 대기";
    }
  }
  async function collectAll(skipConfirm) {
    if (
      !skipConfirm && !confirm(
        "각 SNS 섹션을 " +
          $("collectorBatchSize").value +
          "개 단위로 100개까지 수집한 뒤 인기·품질 보강 검색과 상위 100개 정리를 거쳐 다음 섹션으로 진행할까요?",
      )
    )
      return;
    hide();
    stopRequested = false;
    lockCollection(true);
    var j = loadJob(),
      resume = !!(j && j.paused);
    if (!j || !j.paused) {
      j = newJob(order[0], 0, order.length);
    } else {
      j.paused = false;
      j.total = order.length;
      j.target = 120;
    }
    var failed = false;
    try {
      for (; j.index < order.length && !stopRequested; j.index++) {
        var continuing = resume && j.section === order[j.index];
        j.section = order[j.index];
        if (!continuing) {
          j.target = 120;
          j.batchSize = Math.max(
            8,
            Math.min(12, Number($("collectorBatchSize").value) || 10),
          );
          j.countryCode = selectedCountry();
          j.regionId = text($("collectorRegion").value);
          j.scopeMode = scopeMode();
          j.languages = text($("collectorLanguages").value);
          j.sectionCount = sectionCount(j.section);
          j.batch = 0;
          j.queryCursor = 0;
          j.emptyBatches = 0;
          j.newlyFound = 0;
          j.qualitySweepBatches = 0;
          j.qualitySweepTarget = 3;
          j.qualitySweepDone = false;
          j.qualitySweepActive = false;
        }
        await collectSection(j.section, false, j);
        j.done = j.index + 1;
        resume = false;
        saveJob(j);
      }
      j.paused = stopRequested || j.index < order.length;
      saveJob(j);
      if (j.paused) {
        show(
          "수집을 일시정지했습니다. 전체 9개 섹션 버튼을 다시 누르면 현재 섹션부터 이어집니다.",
          "ok",
        );
      } else {
        clearJob();
        waitingViewMode = "new";
        openDetailQueue = "content";
        openDetailSection = order[0] || "";
        await refresh();
        diagnostic({
          reportType: "igdc-social-batch-collection-report",
          generatedAt: new Date().toISOString(),
          summary: j,
          sections: liveReports.map(function (x) {
            return x.liveCollection || x;
          }),
        });
        show(
          "전체 9개 섹션 수집·품질 보강 완료: 검색 " +
            j.searched +
            "건, 최신 콘텐츠 후보 " +
            j.direct +
            "건, 신규 " +
            j.newlyFound +
            "건, 저장 응답 " +
            j.saved +
            "건.",
          "ok",
        );
      }
    } catch (e) {
      failed = true;
      j.paused = true;
      saveJob(j);
      $("collectorState").textContent = collectionErrorState(e);
      show(
        (e.message || "수집 오류") + " · 현재 지점은 저장되었습니다.",
        "warn",
      );
    } finally {
      lockCollection(false);
      stopRequested = false;
      if (!failed)
        $("collectorState").textContent = j.paused
          ? "일시정지됨"
          : "수집 대기";
    }
    return !failed && !j.paused;
  }
  async function importSearchBank() {
    try {
      var d = await post(PIPELINE, {
        action: "import_searchbank",
        limit: 5000,
      });
      diagnostic(d);
      await refresh();
      show(
        "SearchBank 실후보 반입 완료: 후보 " +
          Number(d.accepted || 0) +
          "개, 저장 " +
          Number(d.saved || 0) +
          "개. seed·placeholder는 안전하게 제외됩니다.",
        Number(d.accepted || 0) ? "ok" : "warn",
      );
    } catch (e) {
      show(e.message, "warn");
    }
  }
  async function intakeChannels(dryRun) {
    var raw = text($("channelIntakeText").value),
      state = $("channelIntakeState");
    if (!raw) {
      show(
        "반입할 공개 최신 영상 또는 게시물 URL을 한 줄 이상 입력해 주세요.",
        "warn",
      );
      return;
    }
    var section = text($("collectorSection").value);
    state.textContent = dryRun
      ? "최신 콘텐츠 주소 점검 중"
      : "최신 콘텐츠 후보 반입 중";
    $("channelIntakeBtn").disabled = true;
    $("channelIntakeDryRunBtn").disabled = true;
    try {
      var d = await post(LIVE, {
        action: "intake_channels",
        dryRun: !!dryRun,
        sectionKey: section,
        countryCode: selectedCountry(),
        scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        languages: text($("collectorLanguages").value),
        rawText: raw,
      });
      var report = d.channelIntake || {};
      diagnostic(d);
      if (!dryRun) await refresh();
      state.textContent =
        "변환 " +
        Number(report.resolvedLatestContents || report.resolvedChannels || 0) +
        "개 · 제외 " +
        Number(report.rejectedRows || 0) +
        "개";
      show(
        label(section) +
          " 공개 주소 " +
          (dryRun ? "변환 점검" : "후보 반입") +
          " 완료: 입력 " +
          Number(report.inputLines || 0) +
          "줄, 인플루언서 " +
          Number(report.resolvedInfluencers || 0) +
          "명 · 최신 콘텐츠 " +
          Number(report.resolvedLatestContents || report.resolvedChannels || 0) +
          "개, 제외 " +
          Number(report.rejectedRows || 0) +
          "개.",
        Number(report.resolvedLatestContents || report.resolvedChannels || 0)
          ? "ok"
          : "warn",
      );
    } catch (e) {
      state.textContent = "반입 실패";
      show(e.message || "공개 URL 반입 실패", "warn");
    } finally {
      $("channelIntakeBtn").disabled = false;
      $("channelIntakeDryRunBtn").disabled = false;
    }
  }
  function selected(sel) {
    if (sel === ".finalCheck") return Array.from(selectedInfluencers);
    if (sel === ".waitingCheck") return Array.from(selectedContents);
    if (sel === ".holdCheck") return Array.from(selectedHoldContents);
    return Array.from(document.querySelectorAll(sel + ":checked"))
      .map(function (e) {
        return text(e.dataset.candidateId);
      })
      .filter(Boolean);
  }
  function visibleIds() {
    return visible().map(function (r) {
      return r.id;
    });
  }
  async function run(action, ids, extra) {
    if (!ids.length) {
      show("처리할 후보를 먼저 선택해 주세요.", "warn");
      return;
    }
    var names = {
        approve: "승인",
        hold: "보류",
        reset: "재검토",
        reject: "반려",
        permanent_block: "영구 차단",
        delete: "검색 제외",
        restore: "복원",
        forget: "기록 완전 삭제",
        move_to_replacement: "후보 등록 해제",
        promote_candidate: "후보 등록",
        delete_waiting: "리스트 기록 삭제",
      },
      name = names[action] || action;
    if (
      action === "approve" &&
      !(extra && extra.skipSafeCheck) &&
      !$("socialConfirm").checked
    ) {
      show(
        "인플루언서 승인 전 공개성·안전성 확인 체크가 필요합니다.",
        "warn",
      );
      return;
    }
    if (
      action === "delete" &&
      !confirm(ids.length + "개 후보를 검색 제외 목록으로 이동할까요?")
    )
      return;
    if (
      action === "delete_waiting" &&
      !confirm(
        ids.length +
          "개 후보 기록을 현재 리스트에서 삭제할까요? 나중에 다시 검색되면 후보로 들어올 수 있습니다.",
      )
    )
      return;
    if (!extra || !extra.skipConfirm) {
      if (
        action !== "delete" &&
        action !== "delete_waiting" &&
        !confirm(ids.length + "개 후보를 " + name + " 처리할까요?")
      )
        return;
    }
    var note = (extra && extra.body && extra.body.note) ||
      (action === "delete" ||
      action === "approve" ||
      action === "hold" ||
      action === "reject"
        ? prompt(name + " 처리 메모를 입력하세요. 비워도 됩니다.", "") || ""
        : name);
    try {
      var body = Object.assign(
        {
          action: action,
          ids: ids,
          note: note,
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        },
        (extra && extra.body) || {},
      );
      if (action === "approve") body.confirmSocialSafe = true;
      if (action === "promote_candidate") body.confirmSocialSafe = true;
      if (action === "delete") body.confirmQueueDelete = true;
      if (action === "forget" || action === "delete_waiting")
        body.confirmPermanentDelete = true;
      var d = await post(ACTION, body);
      ids.forEach(function (id) {
        selectedInfluencers.delete(text(id));
        selectedContents.delete(text(id));
        selectedHoldContents.delete(text(id));
      });
      $("socialConfirm").checked = false;
      if (!(extra && extra.skipRefresh)) await refresh();
      show(
        name + " 처리 " + Number(d.updated || d.deleted || 0) + "건 완료",
        "ok",
      );
    } catch (e) {
      show(e.message, "warn");
    }
  }
  async function rotate() {
    try {
      $("rotationBtn").disabled = true;
      var d = await loadPlacement();
      if (!d) throw new Error("배치·교체 후보를 읽지 못했습니다.");
      diagnostic(d);
      renderSections();
      show("공개 100개 + 예비 20개 후보 풀을 다시 계산했습니다.", "ok");
    } catch (e) {
      show(e.message, "warn");
    } finally {
      $("rotationBtn").disabled = false;
    }
  }
  async function publish() {
    try {
      $("publishPreviewBtn").disabled = true;
      var q = new URLSearchParams({
          includeSnapshot: "0",
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        }),
        d = await get(PUBLISH + "?" + q.toString());
      diagnostic(d);
      show(
        "실제 적용 전 미리보기를 만들었습니다. 아직 프론트 화면에는 반영하지 않았습니다.",
        "ok",
      );
    } catch (e) {
      show(e.message, "warn");
    } finally {
      $("publishPreviewBtn").disabled = false;
    }
  }
  async function snapshot() {
    try {
      var q = new URLSearchParams({
          download: "1",
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        }),
        r = await fetch(PUBLISH + "?" + q.toString(), {
          headers: headers(false),
          credentials: "same-origin",
          cache: "no-store",
        }),
        t = await r.text();
      if (!r.ok) throw new Error(t || "다운로드 실패");
      download("social.snapshot.generated.json", t);
      show("현재 범위의 적용 내용 JSON을 다운로드했습니다.", "ok");
    } catch (e) {
      show(e.message, "warn");
    }
  }
  async function downloadApplicationValidation() {
    try {
      var q = new URLSearchParams({
          includeSnapshot: "1",
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        }),
        result = await get(PUBLISH + "?" + q.toString());
      download("igdc-social-application-validation.json", {
        reportType: "igdc-social-application-validation",
        generatedAt: new Date().toISOString(),
        scope: currentScope(),
        validation: result,
      });
      diagnostic(result);
      show("실제 적용 전 후보 검증 JSON을 다운로드했습니다.", "ok");
    } catch (error) {
      show(error.message || "후보 검증 JSON을 만들지 못했습니다.", "warn");
    }
  }
  async function downloadActualApplied() {
    try {
      var separator = STATIC_SOCIAL_SNAPSHOT.indexOf("?") >= 0 ? "&" : "?",
        response = await fetch(STATIC_SOCIAL_SNAPSHOT + separator + "_=" + Date.now(), {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        raw = await response.text();
      if (!response.ok || !/^\s*[\[{]/.test(raw))
        throw new Error("최종 적용 JSON을 읽지 못했습니다: HTTP " + response.status);
      download("igdc-social-actual-applied.snapshot.json", raw);
      show("현재 배포된 최종 소셜 스냅샷 JSON을 원문 그대로 다운로드했습니다.", "ok");
    } catch (error) {
      show(error.message || "최종 적용 JSON을 읽지 못했습니다.", "warn");
    }
  }
  function releasedCandidateIds(snapshot) {
    var sections =
        (snapshot &&
          snapshot.pages &&
          snapshot.pages.social &&
          snapshot.pages.social.sections) ||
        {},
      result = {};
    order.forEach(function (sectionKey) {
      result[sectionKey] = (Array.isArray(sections[sectionKey])
        ? sections[sectionKey]
        : []
      )
        .filter(function (slot) {
          var audit = (slot && slot.audit) || {};
          return (
            text(slot && slot.type) === "external_social" &&
            text(audit.origin) === "social_candidates"
          );
        })
        .map(publishedCandidateId)
        .filter(Boolean);
    });
    return result;
  }
  async function downloadPipelineVerification() {
    try {
      var q = new URLSearchParams({
          action: "pipeline_diagnostic",
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        }),
        verification = await getReport(PUBLISH + "?" + q.toString());
      download("igdc-social-searchbank-handoff-verification.json", verification);
      diagnostic(verification);
      show(
        verification.ok
          ? "승인 콘텐츠가 SearchBank Snapshot까지 정상 인계된 것을 확인했습니다."
          : "승인 콘텐츠와 SearchBank Snapshot 사이의 인계 불일치가 포함된 점검 JSON을 다운로드했습니다.",
        verification.ok ? "ok" : "warn",
      );
    } catch (error) {
      show(error.message || "파이프라인 검증을 실행하지 못했습니다.", "warn");
    }
  }
  async function autoCurate(sectionKey, skipConfirm) {
    var target = sectionKey ? label(sectionKey) : "전체 9개 섹션",
      scope = currentScope(),
      scopeName =
        (scope.country &&
          (scope.country.nameKo ||
            scope.country.nameEn ||
            scope.country.code)) ||
        "전 세계 공통";
    if (!skipConfirm && !confirm(
      scopeName + " 범위의 " + target +
      " 후보를 공개성·안전성·품질 점수 기준으로 자동 정리할까요? 실제 화면 적용은 별도 버튼입니다."
    )) return false;
    try {
      var d = await post(AUTO, {
        confirmAutoCurate: true,
        sectionKey: sectionKey || "",
        countryCode: scope.countryCode,
        scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
      });
      diagnostic(d);
      await refresh();
      show(
        target +
          " 자동 정리 완료: 최종 후보 등록 " +
          Number(d.autoRegistered || 0) +
          "개. 아직 실제 화면에는 적용하지 않았습니다.",
        "ok",
      );
      return true;
    } catch (e) {
      show(e.message || "자동 정리를 완료하지 못했습니다.", "warn");
      return false;
    }
  }
  function candidateRegistered(row) {
    return (
      assetClass(row) === "latest_content" &&
      !contentHold(row) &&
      text(row && row.reviewStatus).toLowerCase() === "approved" &&
      row.candidateOnly === false
    );
  }
  function registeredContentIds(sectionKey) {
    return rows
      .filter(function (row) {
        if (!candidateRegistered(row)) return false;
        if (sectionKey && row.sectionKey !== sectionKey) return false;
        return true;
      })
      .map(function (row) { return text(row && row.id); })
      .filter(Boolean);
  }
  function selectedRegisteredContentIds(sectionKey) {
    return Array.from(selectedContents).filter(function (id) {
      return rows.some(function (row) {
        return (
          text(row && row.id) === id &&
          candidateRegistered(row) &&
          (!sectionKey || row.sectionKey === sectionKey)
        );
      });
    });
  }
  function selectedContentSectionKeys() {
    var ids = selectedContents;
    return order.filter(function (key) {
      return rows.some(function (row) {
        return row.sectionKey === key && ids.has(text(row.id));
      });
    });
  }
  async function actualApplySelectedSections() {
    var selectedIds = Array.from(selectedContents);
    if (!selectedIds.length)
      return show("프론트 등록할 콘텐츠를 먼저 선택해 주세요.", "warn");

    var registeredIds = selectedRegisteredContentIds("");
    var unregisteredCount = selectedIds.length - registeredIds.length;
    if (unregisteredCount > 0) {
      return show(
        "선택한 콘텐츠 중 " +
          unregisteredCount +
          "개가 아직 후보 등록 상태가 아닙니다. 먼저 '선택 후보 등록'을 실행한 뒤 프론트 등록을 해 주세요.",
        "warn",
      );
    }

    var keys = selectedContentSectionKeys();
    if (
      !confirm(
        keys.map(label).join(", ") +
          "에서 선택한 후보 " +
          registeredIds.length +
          "개를 프론트 등록 대상으로 보낼까요?",
      )
    )
      return false;

    return actualApply("", true, registeredIds);
  }

  async function actualApplySection(sectionKey, skipConfirm) {
    var selectedInSectionAll = Array.from(selectedContents).filter(function (id) {
      return rows.some(function (row) {
        return text(row && row.id) === id && row.sectionKey === sectionKey;
      });
    });
    var selectedInSection = selectedRegisteredContentIds(sectionKey);
    if (selectedInSectionAll.length) {
      if (selectedInSection.length !== selectedInSectionAll.length) {
        show(
          label(sectionKey) +
            "에서 선택한 콘텐츠 중 " +
            (selectedInSectionAll.length - selectedInSection.length) +
            "개가 아직 후보 등록 상태가 아닙니다. 먼저 '선택 후보 등록'을 실행해 주세요.",
          "warn",
        );
        return false;
      }
      return actualApply(sectionKey, skipConfirm, selectedInSection);
    }
    var allRegistered = registeredContentIds(sectionKey);
    if (!allRegistered.length) {
      show(
        label(sectionKey) +
          "에 후보 등록이 완료된 콘텐츠가 없습니다. 먼저 콘텐츠를 선택해 '선택 후보 등록'을 실행해 주세요.",
        "warn",
      );
      return false;
    }
    return actualApply(sectionKey, skipConfirm, null);
  }

  async function actualApply(sectionKey, skipConfirm, exactIds) {
    var target = sectionKey ? label(sectionKey) : "전체 9개 섹션",
      scope = currentScope(),
      scopeName =
        (scope.country &&
          (scope.country.nameKo ||
            scope.country.nameEn ||
            scope.country.code)) ||
        "전 세계 공통",
      requestedIds = Array.isArray(exactIds)
        ? Array.from(new Set(exactIds.map(text).filter(Boolean)))
        : [];

    if (requestedIds.length) {
      var unresolved = requestedIds.filter(function (id) {
        return !rows.some(function (row) {
          return (
            text(row && row.id) === id &&
            candidateRegistered(row) &&
            (!sectionKey || row.sectionKey === sectionKey)
          );
        });
      });
      if (unresolved.length) {
        show(
          "선택 콘텐츠 중 " +
            unresolved.length +
            "개가 후보 등록 상태가 아니어서 프론트 등록을 중단했습니다.",
          "warn",
        );
        return false;
      }
    } else if (sectionKey && registeredContentIds(sectionKey).length < 1) {
      show(
        label(sectionKey) +
          "에 후보 등록이 완료된 콘텐츠가 없어 프론트 등록할 수 없습니다.",
        "warn",
      );
      return false;
    } else if (!sectionKey && registeredContentIds("").length < 1) {
      show(
        "후보 등록이 완료된 최신 콘텐츠가 없습니다. 먼저 후보 등록을 해 주세요.",
        "warn",
      );
      return false;
    }

    var applyLabel = requestedIds.length
      ? target + " 선택 후보 " + requestedIds.length + "개"
      : target + " 후보 등록 완료 콘텐츠";

    if (
      !skipConfirm &&
      !confirm(
        scopeName +
          " 방문자에게 보일 " +
          applyLabel +
          "를 SearchBank 인계 대상으로 등록할까요?",
      )
    )
      return false;

    try {
      show(scopeName + " · " + applyLabel + " 실제 적용 요청을 전송하고 있습니다.", "warn");
      if ($("frontApplyState"))
        $("frontApplyState").textContent = "SearchBank 인계 요청 중";

      var body = {
        operation: "actual_front_apply",
        storeRelease: true,
        confirmPublish: true,
        includeSnapshot: 0,
        sectionKey: sectionKey || "",
        countryCode: scope.countryCode,
        scopeMode: scopeMode(),
        regionId: text($("collectorRegion").value),
      };
      if (requestedIds.length) body.candidateIds = requestedIds;

      var d = await post(PUBLISH, body);

      if (!d.actualApplyRequested || !d.storeReleaseRequested) {
        throw new Error(
          "프론트 등록 POST가 서버에서 actual_front_apply 저장 요청으로 인식되지 않았습니다.",
        );
      }
      if (requestedIds.length && d.exactCandidateSelectionApplied !== true) {
        throw new Error(
          "선택 콘텐츠 ID가 서버의 실제 적용 대상에 반영되지 않았습니다.",
        );
      }
      if (
        requestedIds.length &&
        Number(d.resolvedCandidateRows || 0) !== requestedIds.length
      ) {
        throw new Error(
          "선택 후보 " +
            requestedIds.length +
            "개 중 서버가 " +
            Number(d.resolvedCandidateRows || 0) +
            "개만 실제 적용 대상으로 확인했습니다.",
        );
      }
      if (!d.releaseStored)
        throw new Error(
          "실제 적용 요청은 처리됐지만 stored social release가 생성되지 않았습니다. SearchBank 인계 전 단계에서 중단되었습니다.",
        );

      download("igdc-social-actual-apply-result.json", d);
      diagnostic(d);

      var verifyQ = new URLSearchParams({
        action: "pipeline_diagnostic",
        countryCode: scope.countryCode,
        scopeMode: scopeMode(),
        regionId: text($("collectorRegion").value),
      });
      var verify = await getReport(PUBLISH + "?" + verifyQ.toString());
      diagnostic({ actualApply: d, searchBankHandoff: verify });

      if ($("frontApplyState"))
        $("frontApplyState").textContent =
          d.buildTrigger && d.buildTrigger.ok
            ? "승인본 저장 · SearchBank 빌드 접수"
            : "승인본 저장 · 빌드 대기";

      if (d.buildTrigger && d.buildTrigger.ok) {
        show(
          scopeName +
            " 범위의 " +
            applyLabel +
            " 승인본을 저장했고 SearchBank 반영 빌드를 접수했습니다. 소셜 작업은 SearchBank Snapshot JSON 도달까지만 담당하며 그 아래 렌더링 체인은 기존 시스템이 처리합니다.",
          "ok",
        );
      } else {
        show(
          scopeName +
            " 범위의 승인본은 저장됐지만 SearchBank 반영 빌드가 시작되지 않았습니다. Build Hook 설정을 확인해 주세요.",
          "warn",
        );
      }
      return true;
    } catch (e) {
      if ($("frontApplyState"))
        $("frontApplyState").textContent = "SearchBank 인계 실패";
      show(e.message || "프론트 등록을 완료하지 못했습니다.", "warn");
      return false;
    }
  }
  function publishedCandidateId(slot) {
    var value = slot || {},
      audit = value.audit || {};
    return text(
      value.contentId || value.candidateId || audit.candidate_id || value.id,
    );
  }
  async function currentPublishedIds(sectionKey) {
    var d = await staticJson(STATIC_SOCIAL_SNAPSHOT),
      sections =
        (d &&
          d.pages &&
          d.pages.social &&
          d.pages.social.sections) ||
        {},
      keys = sectionKey ? [sectionKey] : order,
      ids = [];
    keys.forEach(function (key) {
      (Array.isArray(sections[key]) ? sections[key] : []).forEach(function (
        slot,
      ) {
        var audit = (slot && slot.audit) || {},
          id = publishedCandidateId(slot);
        if (
          id &&
          text(slot && slot.type) === "external_social" &&
          text(audit.origin) === "social_candidates"
        )
          ids.push(id);
      });
    });
    return Array.from(new Set(ids));
  }
  async function moveToReplacementInBatches(ids, scope) {
    var batchSize = 10,
      completed = 0;
    for (var index = 0; index < ids.length; index += batchSize) {
      var batch = ids.slice(index, index + batchSize);
      await post(ACTION, {
        action: "move_to_replacement",
        ids: batch,
        note: "selected_front_unpublish",
        countryCode: scope.countryCode,
        scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
      });
      completed += batch.length;
      $("waitingCapacityState").textContent =
        "실제 적용 해제 준비 " + completed + "/" + ids.length + "개";
    }
  }
  async function actualUnapplyIds(ids, sectionKey, target) {
    var scope = currentScope(),
      scopeName =
        (scope.country &&
          (scope.country.nameKo ||
            scope.country.nameEn ||
            scope.country.code)) ||
        "전 세계 공통",
      movedToWaiting = false;
    if (!ids.length) {
      show("실제 적용을 취소할 최신 콘텐츠를 먼저 선택해 주세요.", "warn");
      return;
    }
    if (
      !confirm(
        scopeName +
          " 범위의 " +
          target +
          "에서 실제 적용을 취소할 " +
          ids.length +
          "개 콘텐츠를 프론트에서 내리고 콘텐츠 보류 대기창으로 이동할까요?",
      )
    )
      return;
    try {
      await run("hold", ids, { skipConfirm: true, skipRefresh: true, body: { note: "actual_unpublish_to_content_hold" } });
      movedToWaiting = true;
      var d = await post(PUBLISH, {
        operation: "unpublish_selected",
        candidateIds: ids,
        storeRelease: true,
        confirmUnpublish: true,
        includeSnapshot: 0,
        sectionKey: sectionKey || "",
        countryCode: scope.countryCode,
        scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
      });
      diagnostic(d);
      ids.forEach(function (id) {
        selectedContents.delete(text(id));
      });
      await refresh();
      if (d.buildTrigger && d.buildTrigger.ok) {
        show(
          scopeName +
            " 범위의 선택 콘텐츠 " +
            ids.length +
            "개를 콘텐츠 보류 대기창으로 이동했고, 실제 적용 취소 정식 빌드를 접수했습니다. 배포 완료 후 프론트에서 내려갑니다.",
          "ok",
        );
      } else {
        show(
          "선택 콘텐츠는 보류 대기창으로 이동했고 적용 취소본도 저장됐지만, SOCIAL_NETLIFY_BUILD_HOOK_URL 미설정으로 정식 배포가 시작되지 않았습니다.",
          "warn",
        );
      }
    } catch (e) {
      show(
        movedToWaiting
          ? "선택 콘텐츠는 보류 대기창으로 이동했지만 프론트 적용 취소 저장을 완료하지 못했습니다. 같은 항목을 다시 선택해 적용 취소를 실행해 주세요. · " +
              (e.message || "저장 실패")
          : e.message || "선택 콘텐츠 적용 취소를 완료하지 못했습니다.",
        "warn",
      );
    }
  }
  async function actualUnapply(sectionKey) {
    var ids = sectionKey
      ? sectionIds($("waitingAccordion"), sectionKey, "waitingCheck")
      : selected(".waitingCheck");
    return actualUnapplyIds(
      ids,
      sectionKey,
      sectionKey ? label(sectionKey) + " 선택 콘텐츠" : "현재 선택 범위",
    );
  }
  async function actualUnapplyAll(sectionKey) {
    var target = sectionKey
      ? label(sectionKey) + " 섹션 전체"
      : "전체 9개 섹션";
    try {
      var ids = await currentPublishedIds(sectionKey);
      if (!ids.length) {
        show(target + "에 현재 실제 적용된 콘텐츠가 없습니다.", "warn");
        return;
      }
      return actualUnapplyIds(ids, sectionKey, target);
    } catch (e) {
      show(
        e.message || target + "의 현재 실제 적용 목록을 읽지 못했습니다.",
        "warn",
      );
    }
  }
  function setWaitingView(mode) {
    waitingViewMode = mode || "all";
    openDetailQueue = "content";
    var candidates = visible().filter(function (row) {
      return assetClass(row) === "latest_content" && !contentHold(row) && waitingViewAccept(row);
    });
    var firstSection = order.find(function (key) {
      return candidates.some(function (row) { return row.sectionKey === key; });
    }) || "";
    openDetailSection = firstSection;
    renderSections();
    var result = $("replacementViewResult");
    if (result) {
      if (!candidates.length) {
        result.textContent = "현재 선택한 보기 조건에 해당하는 콘텐츠 후보가 없습니다.";
        result.classList.remove("hidden");
      } else {
        var counts = order.map(function (key) {
          var n = candidates.filter(function (row) { return row.sectionKey === key; }).length;
          return n ? label(key) + " " + n + "개" : "";
        }).filter(Boolean);
        var modeName = waitingViewMode === "new" ? "새로 수집된 최신 콘텐츠" : waitingViewMode === "public" ? "프론트 적용 예정" : waitingViewMode === "replacement" ? "예비 교체 후보" : waitingViewMode === "front" ? "현재 프론트 공개 콘텐츠" : "전체 최신 콘텐츠 후보";
        result.textContent = modeName + " " + candidates.length + "개 · " + counts.join(" · ");
        result.classList.remove("hidden");
      }
    }
  }
  function openHoldContentView() {
    var holdRows = visible().filter(contentHold),
      firstSection = order.find(function (key) {
        return holdRows.some(function (row) { return row.sectionKey === key; });
      }) || "";
    openDetailQueue = "hold";
    openDetailSection = firstSection;
    renderSections();
    var result = $("replacementViewResult");
    if (result) {
      result.textContent = holdRows.length
        ? "보류 대기 " + holdRows.length + "개 · " + (firstSection ? label(firstSection) + " 목록을 열었습니다." : "")
        : "현재 보류 대기 콘텐츠가 없습니다.";
    }
  }

  async function moveSelectedToReplacement() {
    var ids = selected(".waitingCheck");
    if (!ids.length) return show("교체 대기로 이동할 최신 콘텐츠를 선택해 주세요.", "warn");
    await run("move_to_replacement", ids);
    waitingViewMode = "replacement";
  }
  async function restoreHeld(ids) {
    if (!ids.length) return show("복구할 보류 콘텐츠를 선택해 주세요.", "warn");
    await run("approve", ids, { skipSafeCheck: true, body: { confirmSocialSafe: true, note: "restore_from_content_hold" } });
  }
  async function deleteHeld(ids) {
    if (!ids.length) return show("리스트에서 삭제할 보류 콘텐츠를 선택해 주세요.", "warn");
    await run("delete_waiting", ids);
  }
  async function blockHeld(ids) {
    if (!ids.length) return show("완전 차단할 보류 콘텐츠를 선택해 주세요.", "warn");
    await run("permanent_block", ids);
  }
  function renderAiSectionSelector() {
    var host = $("aiSectionSelector");
    if (!host) return;
    host.innerHTML =
      '<span class="small" style="font-weight:700">AI 자동화 대상 SNS</span>' +
      order.map(function (key) {
        return '<label class="small" style="display:inline-flex;align-items:center;gap:5px"><input class="aiSectionCheck" type="checkbox" value="' +
          esc(key) + '" /> ' + esc(label(key)) + '</label>';
      }).join("") +
      '<button id="aiSelectAllSectionsBtn" class="secondary" type="button">9개 전체 선택</button>' +
      '<button id="aiClearSectionsBtn" class="secondary" type="button">선택 해제</button>';
    $("aiSelectAllSectionsBtn").onclick = function () {
      host.querySelectorAll(".aiSectionCheck").forEach(function (el) { el.checked = true; });
    };
    $("aiClearSectionsBtn").onclick = function () {
      host.querySelectorAll(".aiSectionCheck").forEach(function (el) { el.checked = false; });
    };
  }
  function selectedAiSections() {
    var host = $("aiSectionSelector");
    return host ? Array.from(host.querySelectorAll(".aiSectionCheck:checked")).map(function (el) { return text(el.value); }).filter(Boolean) : [];
  }
  async function aiCycleSections(keys, skipConfirm) {
    keys = Array.from(new Set((keys || []).filter(function (key) { return order.indexOf(key) >= 0; })));
    if (!keys.length) return show("AI 자동화할 SNS 섹션을 선택해 주세요.", "warn");
    if (!skipConfirm && !confirm(keys.map(label).join(", ") + " 섹션의 최신 콘텐츠 수집 → AI 평가 → 공개/예비 후보 재정리를 실행할까요?")) return false;
    var statusEl = $("aiAutomationState"), oldCollector = $("collectorSection").value;
    try {
      stopRequested = false;
      lockCollection(true);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i], j = newJob(key, i, keys.length);
        if (statusEl) statusEl.textContent = "수집 " + (i + 1) + "/" + keys.length + " · " + label(key);
        await collectSection(key, false, j);
        j.done = i + 1;
        saveJob(j);
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = "수집 중단 · " + (e.message || "오류");
      show(e.message || "AI 자동 수집을 완료하지 못했습니다.", "warn");
      return false;
    } finally {
      lockCollection(false);
      stopRequested = false;
      $("collectorSection").value = oldCollector;
    }
    try {
      for (var n = 0; n < keys.length; n++) {
        if (statusEl) statusEl.textContent = "AI 정리 " + (n + 1) + "/" + keys.length + " · " + label(keys[n]);
        var curated = await autoCurate(keys[n], true);
        if (!curated) throw new Error(label(keys[n]) + " AI 후보 정리를 완료하지 못했습니다.");
      }
      waitingViewMode = "all";
      openDetailQueue = "content";
      openDetailSection = keys[0];
      await refresh();
      if ($("aiAutomationApply") && $("aiAutomationApply").checked) {
        if (statusEl) statusEl.textContent = "프론트 실제 적용 중";
        for (var a = 0; a < keys.length; a++) {
          var applied = await actualApply(keys[a], true);
          if (!applied) throw new Error(label(keys[a]) + " 프론트 실제 적용을 완료하지 못했습니다.");
        }
      }
      if (statusEl) statusEl.textContent = "완료 · " + keys.length + "개 SNS";
      show(keys.map(label).join(", ") + " AI 자동 운영을 완료했습니다.", "ok");
      return true;
    } catch (e) {
      if (statusEl) statusEl.textContent = "자동 운영 중단 · " + (e.message || "오류");
      show(e.message || "AI 자동 운영을 완료하지 못했습니다.", "warn");
      return false;
    }
  }
  async function aiFullCycle() {
    return aiCycleSections(order.slice(), false);
  }
  function openPreview(url) {
    var safeUrl = text(url);
    if (!/^https:\/\//i.test(safeUrl)) return;
    try {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.replace(safeUrl);
        previewWindow.focus();
      } else {
        previewWindow = window.open(safeUrl, "igdcSocialChannelPreview");
      }
    } catch (_e) {
      previewWindow = window.open(safeUrl, "igdcSocialChannelPreview");
    }
  }
  function sourceAlert(candidateId) {
    var row = rows.filter(function (r) {
        return text(r.id) === text(candidateId);
      })[0],
      raw = (row && row.raw) || {};
    if (!row) return;
    var latest =
      assetClass(row) === "influencer_registry"
        ? latestForInfluencer(row)
        : row;
    alert(
      [
        "구분: " +
          (assetClass(row) === "influencer_registry"
            ? "인플루언서 등록부"
            : "최신 콘텐츠 후보"),
        "최신 콘텐츠 주소: " +
          text(latest && (latest.latestContentUrl || latest.sourceUrl)),
        "운영 채널 주소: " + text(row.channelUrl || raw.channelUrl),
        "수집 근거 주소: " +
          text(
            row.channelEvidenceUrl ||
              raw.channelEvidenceUrl ||
              raw.sourceContentUrl,
          ),
        "콘텐츠 유형: " + text(row.entityKind || raw.entityKind),
        "게시 시각: " +
          text(
            latest &&
              (latest.contentPublishedAt ||
                (latest.raw && latest.raw.contentPublishedAt)),
          ),
        "국가: " + (row.countryScopes || raw.countryScopes || []).join(","),
      ].join("\n"),
    );
  }
  function bindAccordion(container, queue) {
    if (!container) return;
    container.addEventListener("click", function (event) {
      var toggleSelector = queue === "final"
        ? "[data-final-toggle]"
        : queue === "hold"
          ? "[data-hold-toggle]"
          : "[data-waiting-toggle]";
      var toggle = event.target.closest(toggleSelector);
      if (toggle) {
        var requestedQueue = queue === "final" ? "registry" : queue === "hold" ? "hold" : "content";
        var requestedSection = queue === "final"
          ? toggle.dataset.finalToggle
          : queue === "hold"
            ? toggle.dataset.holdToggle
            : toggle.dataset.waitingToggle;
        if (openDetailQueue === requestedQueue && openDetailSection === requestedSection) {
          openDetailQueue = "";
          openDetailSection = "";
        } else {
          openDetailQueue = requestedQueue;
          openDetailSection = requestedSection;
        }
        renderSections();
        return;
      }
      var preview = event.target.closest(".previewLink");
      if (preview) {
        event.preventDefault();
        openPreview(preview.href);
        return;
      }
      var source = event.target.closest(".sourceBtn");
      if (source) {
        sourceAlert(source.dataset.candidateId);
        return;
      }
      var key;
      if ((key = event.target.dataset.sectionSelectAll))
        selectQueue("registry", key, true);
      else if ((key = event.target.dataset.sectionClearAll))
        selectQueue("registry", key, false);
      else if ((key = event.target.dataset.waitingSelectAll))
        selectQueue("content", key, true);
      else if ((key = event.target.dataset.waitingClearAll))
        selectQueue("content", key, false);
      else if ((key = event.target.dataset.holdRestore))
        restoreHeld(sectionIds(container, key, "holdCheck"));
      else if ((key = event.target.dataset.holdDelete))
        deleteHeld(sectionIds(container, key, "holdCheck"));
      else if ((key = event.target.dataset.holdBlock))
        blockHeld(sectionIds(container, key, "holdCheck"));
      else if ((key = event.target.dataset.sectionApprove))
        run("approve", sectionIds(container, key, "finalCheck"));
      else if ((key = event.target.dataset.sectionAi)) autoCurate(key);
      else if ((key = event.target.dataset.sectionBlock))
        run("permanent_block", sectionIds(container, key, "finalCheck"));
      else if ((key = event.target.dataset.waitingPromote))
        run("promote_candidate", sectionIds(container, key, "waitingCheck"));
      else if ((key = event.target.dataset.waitingDemote))
        run("move_to_replacement", sectionIds(container, key, "waitingCheck"));
      else if ((key = event.target.dataset.waitingAi)) aiCycleSections([key], false);
      else if ((key = event.target.dataset.waitingPublish)) actualApplySection(key, false);
      else if ((key = event.target.dataset.waitingUnpublishAll))
        actualUnapplyAll(key);
      else if ((key = event.target.dataset.waitingUnpublish))
        actualUnapply(key);
      else if ((key = event.target.dataset.waitingDelete))
        run("delete_waiting", sectionIds(container, key, "waitingCheck"));
      else if ((key = event.target.dataset.waitingBlock))
        run("permanent_block", sectionIds(container, key, "waitingCheck"));
    });
    container.addEventListener("change", function (event) {
      if (event.target.matches(".rowcheck")) {
        var target = event.target.matches(".finalCheck")
          ? selectedInfluencers
          : event.target.matches(".holdCheck")
            ? selectedHoldContents
            : selectedContents;
        if (event.target.checked)
          target.add(text(event.target.dataset.candidateId));
        else target.delete(text(event.target.dataset.candidateId));
        event.target
          .closest(".candidate-card")
          .classList.toggle("selected", event.target.checked);
        updateMasterSelectionState();
      }
    });
  }
  function summarizeCanonicalSnapshot(snapshot) {
    var sections = snapshot && snapshot.pages && snapshot.pages.social && snapshot.pages.social.sections || {};
    var main = {}, mainTotal = 0;
    order.forEach(function (key) {
      var list = Array.isArray(sections[key]) ? sections[key] : [];
      var real = list.filter(function (slot) {
        var audit = slot && slot.audit || {};
        return text(slot && slot.type) === "external_social" && text(audit.origin) === "social_candidates";
      }).length;
      main[key] = { total: list.length, real: real };
      mainTotal += real;
    });
    var right = Array.isArray(sections.rightPanel) ? sections.rightPanel : [];
    var rightWithThumb = right.filter(function (item) {
      return !!text(item && (item.thumb || item.thumbnail || item.image || item.img || item.imageUrl || item.thumbnailUrl));
    }).length;
    return {
      mainSocial: { realTotal: mainTotal, bySection: main },
      rightPanel: { total: right.length, withThumbnail: rightWithThumb },
      socialMaruPresent: Array.isArray(sections["social-maru"]),
    };
  }
  async function runFullSystemDiagnostic() {
    try {
      if ($("systemAuditBtn")) $("systemAuditBtn").disabled = true;
      show("소셜 네트워크 전체 시스템을 점검하고 있습니다.", "warn");
      await refresh();
      var params = new URLSearchParams({
        countryCode: selectedCountry(),
        scopeMode: scopeMode(),
        regionId: text($("collectorRegion").value),
      });
      var candidateReport = null, latestReport = null, pipelineReport = null, snapshot = null;
      try { candidateReport = await getReport(REVIEW + "?action=diagnostic&" + params.toString()); } catch (e) { candidateReport = { ok:false, error:e.message || String(e) }; }
      try { latestReport = await getReport(REVIEW + "?action=latest_content_diagnostic&" + params.toString()); } catch (e) { latestReport = { ok:false, error:e.message || String(e) }; }
      try { pipelineReport = await getReport(PUBLISH + "?action=pipeline_diagnostic&" + params.toString()); } catch (e) { pipelineReport = { ok:false, error:e.message || String(e) }; }
      try { snapshot = await staticJson(STATIC_SOCIAL_SNAPSHOT + "?_=" + Date.now()); } catch (e) { snapshot = null; }
      var contentRows = rows.filter(function (r) { return assetClass(r) === "latest_content" && !excluded(r); });
      var approvedRows = contentRows.filter(function (r) { return lower(r.reviewStatus) === "approved" && r.candidateOnly === false; });
      var bySection = {};
      order.forEach(function (key) {
        var sectionRows = contentRows.filter(function (r) { return r.sectionKey === key; });
        bySection[key] = {
          candidates: sectionRows.length,
          approvedCandidates: sectionRows.filter(function (r) { return lower(r.reviewStatus) === "approved" && r.candidateOnly === false; }).length,
          held: sectionRows.filter(contentHold).length,
          blocked: sectionRows.filter(blocked).length,
        };
      });
      var canonical = summarizeCanonicalSnapshot(snapshot);
      var result = {
        ok: !!(candidateReport && candidateReport.ok !== false && pipelineReport && pipelineReport.ok === true),
        reportType: "igdc-social-full-system-diagnostic",
        generatedAt: new Date().toISOString(),
        scope: currentScope(),
        checks: {
          candidateResearchAndRegistry: candidateReport,
          latestContentQueue: latestReport,
          candidateState: { total: contentRows.length, approved: approvedRows.length, bySection: bySection },
          searchBankHandoff: pipelineReport,
          canonicalFrontSnapshotReadOnly: canonical,
          separation: {
            managedMainSections: order.slice(),
            rightPanelRole: "commerce_product_only",
            socialMaruRole: "reserved_not_managed",
          },
        },
      };
      result.summary = {
        candidateTotal: contentRows.length,
        approvedCandidateTotal: approvedRows.length,
        searchBankHandoff: pipelineReport && pipelineReport.pipeline ? pipelineReport.pipeline.searchBankSnapshotHandoff : "unknown",
        canonicalMainRealTotal: canonical.mainSocial.realTotal,
        rightPanelTotal: canonical.rightPanel.total,
        rightPanelWithThumbnail: canonical.rightPanel.withThumbnail,
      };
      systemAuditCache = result;
      diagnostic(result);
      if ($("systemAuditDownloadBtn")) $("systemAuditDownloadBtn").disabled = false;
      toggleDiagnosticPanel(true);
      show(result.ok ? "전체 시스템 점검을 완료했습니다." : "전체 시스템 점검에서 확인할 항목이 발견됐습니다. JSON을 확인해 주세요.", result.ok ? "ok" : "warn");
      return result;
    } catch (e) {
      show(e.message || "전체 시스템 점검을 완료하지 못했습니다.", "warn");
      return null;
    } finally {
      if ($("systemAuditBtn")) $("systemAuditBtn").disabled = false;
    }
  }

  async function runQueueDiagnostic(action, successMessage, downloadName) {
    try {
      var q = new URLSearchParams({
          action: action,
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        }),
        d = await getReport(REVIEW + "?" + q.toString());
      diagnostic(d);
      if (downloadName) download(downloadName, d);
      show(successMessage + (downloadName ? " · 다운로드 완료" : ""), d.ok === false ? "warn" : "ok");
    } catch (e) {
      show(e.message || "점검 JSON을 읽지 못했습니다.", "warn");
    }
  }

  function toggleHoldPanel(forceOpen) {
    var body = $("holdPanelBody"), btn = $("toggleHoldPanelBtn");
    if (!body || !btn) return;
    var shouldOpen = forceOpen === true || (forceOpen !== false && body.classList.contains("hidden"));
    body.classList.toggle("hidden", !shouldOpen);
    btn.textContent = shouldOpen ? "목록 닫기" : "목록 열기";
    if (!shouldOpen) {
      if (openDetailQueue === "hold") { openDetailQueue = ""; openDetailSection = ""; }
      body.querySelectorAll(".section-body").forEach(function (el) { el.classList.add("hidden"); });
    }
  }
  function bind() {
    options();
    renderAiSectionSelector();

    // Critical publication control is bound first.  The final front apply must
    // remain usable even if a non-critical admin control later fails to bind.
    if ($("publishAllBtn")) {
      $("publishAllBtn").onclick = function () { return actualApply(""); };
    }
    if ($("publishSelectedSectionsBtn")) {
      $("publishSelectedSectionsBtn").onclick = actualApplySelectedSections;
    }

    $("refreshBtn").onclick = refresh;
    if ($("systemAuditBtn")) $("systemAuditBtn").onclick = runFullSystemDiagnostic;
    if ($("systemAuditDownloadBtn")) $("systemAuditDownloadBtn").onclick = function () {
      if (!systemAuditCache) return show("먼저 전체 시스템 점검을 실행해 주세요.", "warn");
      download("igdc-social-full-system-diagnostic-" + new Date().toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", systemAuditCache);
    };
    if ($("registryDiagnosticBtn"))
      $("registryDiagnosticBtn").onclick = function () {
        runQueueDiagnostic("registry_diagnostic", "인플루언서 등록부 점검 JSON을 읽었습니다.", "igdc-social-influencer-registry-diagnostic.json");
      };
    if ($("latestContentDiagnosticBtn"))
      $("latestContentDiagnosticBtn").onclick = function () {
        runQueueDiagnostic("latest_content_diagnostic", "최신 콘텐츠 후보·교체 대기열 점검 JSON을 읽었습니다.", "igdc-social-latest-content-diagnostic.json");
      };
    if ($("downloadJsonBtn")) $("downloadJsonBtn").onclick = function () {
      if (diagnosticCache)
        download(
          "igdc-social-candidate-diagnostic-" +
            new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") +
            ".json",
          diagnosticCache,
        );
    };
    if ($("toggleDiagnosticPanelBtn")) $("toggleDiagnosticPanelBtn").onclick = function () { toggleDiagnosticPanel(); };
    if ($("downloadCandidateListBtn")) $("downloadCandidateListBtn").onclick = function () {
      download("igdc-social-candidate-visible-list.json", {
        ok: true,
        generatedAt: new Date().toISOString(),
        count: visible().length,
        rows: visible(),
      });
    };
    $("collectDryRunBtn").onclick = function () {
      collectSelected(true);
    };
    $("collectSectionBtn").onclick = function () {
      collectSelected(false);
    };
    $("collectAllBtn").onclick = collectAll;
    $("collectorProgressJsonBtn").onclick = downloadCollectorProgress;
    $("channelIntakeDryRunBtn").onclick = function () {
      intakeChannels(true);
    };
    $("channelIntakeBtn").onclick = function () {
      intakeChannels(false);
    };
    $("channelIntakeClearBtn").onclick = function () {
      $("channelIntakeText").value = "";
      $("channelIntakeState").textContent = "입력 대기";
    };
    $("collectorStopBtn").onclick = function () {
      stopRequested = true;
      this.disabled = true;
      $("collectorState").textContent = "현재 섹션 완료 후 일시정지";
    };
    if ($("rotationBtn")) $("rotationBtn").onclick = rotate;
    if ($("publishPreviewBtn")) $("publishPreviewBtn").onclick = publish;
    if ($("snapshotDownloadBtn")) $("snapshotDownloadBtn").onclick = snapshot;
    if ($("applicationValidationJsonBtn")) $("applicationValidationJsonBtn").onclick = downloadApplicationValidation;
    if ($("actualAppliedJsonBtn")) $("actualAppliedJsonBtn").onclick = downloadActualApplied;
    if ($("pipelineVerificationJsonBtn")) $("pipelineVerificationJsonBtn").onclick = downloadPipelineVerification;
    $("returnBtn").onclick = function () {
      var p = new URLSearchParams(location.search),
        to = p.get("returnPath") || "/admin.html";
      location.href = /^\//.test(to) ? to : "/admin.html";
    };
    $("approveBtn").onclick = function () {
      run("approve", selected(".finalCheck"));
    };
    $("selectAllFinalBtn").onclick = function () {
      toggleWholeQueue("registry", true);
    };
    if ($("selectAllFinalMaster")) $("selectAllFinalMaster").onchange = function () {
      toggleWholeQueue("registry", this.checked);
    };
    $("clearFinalSelectionBtn").onclick = function () {
      selectQueue("registry", "", false);
    };
    $("moveWaitingBtn").onclick = function () {
      run("delete", selected(".finalCheck"));
    };
    $("holdBtn").onclick = function () {
      run("hold", selected(".finalCheck"));
    };
    $("resetBtn").onclick = function () {
      run("reset", selected(".finalCheck"));
    };
    $("rejectBtn").onclick = function () {
      run("reject", selected(".finalCheck"));
    };
    $("blockBtn").onclick = function () {
      run("permanent_block", selected(".finalCheck"));
    };
    $("aiAutoBtn").onclick = function () {
      autoCurate("");
    };
    if ($("replacementViewAllBtn")) $("replacementViewAllBtn").onclick = function () { setWaitingView("all"); };
    if ($("replacementViewNewBtn")) $("replacementViewNewBtn").onclick = function () { setWaitingView("new"); };
    if ($("replacementViewPublicBtn")) $("replacementViewPublicBtn").onclick = function () { setWaitingView("public"); };
    if ($("replacementViewWaitingBtn")) $("replacementViewWaitingBtn").onclick = function () { setWaitingView("replacement"); };
    if ($("replacementViewFrontBtn")) $("replacementViewFrontBtn").onclick = function () { setWaitingView("front"); };
    if ($("contentViewHoldBtn")) $("contentViewHoldBtn").onclick = function () { toggleHoldPanel(true); openHoldContentView(); };
    if ($("aiSelectedSectionsBtn")) $("aiSelectedSectionsBtn").onclick = function () { aiCycleSections(selectedAiSections(), false); };
    if ($("aiFullCycleBtn")) $("aiFullCycleBtn").onclick = aiFullCycle;
    if ($("aiFullStopBtn")) $("aiFullStopBtn").onclick = function () {
      stopRequested = true;
      if ($("aiAutomationState")) $("aiAutomationState").textContent = "중단 요청됨";
      show("AI 자동 운영 중단을 요청했습니다. 현재 처리 중인 작업이 끝나면 멈춥니다.", "warn");
    };
    if ($("toggleHoldPanelBtn")) $("toggleHoldPanelBtn").onclick = function () { toggleHoldPanel(); };
    $("unpublishAllScopeBtn").onclick = function () {
      actualUnapplyAll("");
    };
    $("unpublishAllBtn").onclick = function () {
      actualUnapply("");
    };
    $("waitingPromoteBtn").onclick = function () {
      run("promote_candidate", selected(".waitingCheck"));
    };
    if ($("waitingDemoteBtn")) $("waitingDemoteBtn").onclick = function () {
      run("move_to_replacement", selected(".waitingCheck"));
    };
    $("selectAllWaitingBtn").onclick = function () {
      toggleWholeQueue("content", true);
    };
    if ($("selectAllWaitingMaster")) $("selectAllWaitingMaster").onchange = function () {
      toggleWholeQueue("content", this.checked);
    };
    $("clearWaitingSelectionBtn").onclick = function () {
      selectQueue("content", "", false);
    };
    $("waitingDeleteBtn").onclick = function () {
      run("delete_waiting", selected(".waitingCheck"));
    };
    $("waitingBlockBtn").onclick = function () {
      run("permanent_block", selected(".waitingCheck"));
    };
    if ($("restoreHeldBtn")) $("restoreHeldBtn").onclick = function () { restoreHeld(selected(".holdCheck")); };
    if ($("deleteHeldBtn")) $("deleteHeldBtn").onclick = function () { deleteHeld(selected(".holdCheck")); };
    if ($("blockHeldBtn")) $("blockHeldBtn").onclick = function () { blockHeld(selected(".holdCheck")); };
    if ($("clearHeldSelectionBtn")) $("clearHeldSelectionBtn").onclick = function () { selectQueue("hold", "", false); };
    $("toggleExclusionBtn").onclick = function () {
      var b = $("exclusionBody"),
        open = b.classList.contains("hidden");
      b.classList.toggle("hidden", !open);
      this.textContent = open ? "목록 접기" : "목록 펼치기";
    };
    $("restoreHoldExcludedBtn").onclick = function () {
      run("restore", selected(".excludedCheck"), {
        body: { restoreMode: "hold" },
      });
    };
    $("restoreExcludedBtn").onclick = function () {
      run("restore", selected(".excludedCheck"), {
        body: { restoreMode: "original" },
      });
    };
    $("permanentBlockExcludedBtn").onclick = function () {
      run("permanent_block", selected(".excludedCheck"));
    };
    $("forgetExcludedBtn").onclick = function () {
      run("forget", selected(".excludedCheck"));
    };
    [
      "searchInput",
      "sectionFilter",
      "platformFilter",
      "riskFilter",
      "reviewFilter",
    ].forEach(function (id) {
      $(id).addEventListener("input", renderSections);
      $(id).addEventListener("change", renderSections);
    });
    $("collectorRegion").addEventListener("change", function () {
      renderCountryOptions();
      refresh();
    });
    $("collectorCountry").addEventListener("change", function () {
      renderScopeState();
      refresh();
    });
    $("detectCountryBtn").onclick = function () {
      detectIpCountry(false);
    };
    $("useDetectedCountryBtn").onclick = function () {
      detectIpCountry(true).then(refresh);
    };
    bindAccordion($("sectionAccordion"), "final");
    bindAccordion($("waitingAccordion"), "waiting");
    bindAccordion($("holdAccordion"), "hold");
    $("selectAllExcluded").onchange = function () {
      document.querySelectorAll(".excludedCheck").forEach(function (e) {
        e.checked = this.checked;
      }, this);
    };
  }
  function bindBatchExtras() {
    $("providerStatusBtn").onclick = providerStatus;
    $("searchBankImportBtn").onclick = importSearchBank;
    providerStatus();
  }
  async function start() {
    bind();
    bindBatchExtras();
    await countryOptions();
    refresh();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
