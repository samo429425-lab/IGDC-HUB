/* IGDC Social Hub Content Operations v4.8.1 - complete content lanes + verified storage bridge */
(function () {
  "use strict";
  var REVIEW = "/.netlify/functions/social-candidate-review",
    LIVE = "/.netlify/functions/sanmaru-social-live-collector",
    PIPELINE = "/.netlify/functions/sanmaru-social-pipeline-trigger",
    ACTION = "/.netlify/functions/social-candidate-action",
    AUTO = "/.netlify/functions/social-candidate-auto-curator",
    ROTATION = "/.netlify/functions/social-rotation-selector",
    PUBLISH = "/.netlify/functions/social-snapshot-publish",
    CURRENT_SOCIAL = "/.netlify/functions/social-snapshot-current",
    STATIC_SOCIAL_SNAPSHOT = "/data/social.snapshot.json",
    COUNTRY = "/.netlify/functions/social-country-route";
  var SECTIONS = [
    ["social-youtube", "YouTube", "youtube"],
    ["social-instagram", "Instagram", "instagram"],
    ["social-tiktok", "TikTok", "tiktok"],
    ["social-facebook", "Facebook", "facebook"],
    ["social-reddit", "Reddit", "reddit"],
  ];
  var COLLECTOR_JOB_VERSION = 13,
    FULL_RESEARCH_ROUNDS = 12,
    SECTION_BATCHES_PER_ROUND = 1,
    STANDARD_EMPTY_BATCH_LIMIT = 8,
    LOW_YIELD_EMPTY_BATCH_LIMIT = 8,
    COLLECTOR_CURSOR_KEY = "igdc.socialCollector.discoveryCursors.v2";
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
    selectedFrontSections = new Set(),
    publishedContentIds = new Set(),
    waitingViewMode = "all",
    latestContentIndex = new Map(),
    lastVisibleRows = [],
    searchBankImportBusy = false,
    previewHydrationBusy = false,
    previewHydratedIds = new Set(),
    firstContentListOpened = false,
    sectionListenersBound = false,
    candidateReadStatus = { status: "pending", lastSuccessAt: null, error: "" },
    emptySectionCollectionBusy = false,
    activeParallelCollectionJob = null;
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
      e.payload = d || null;
      e.code = text(d && d.error) || "";
      e.stage = text(d && d.stage) || "";
      throw e;
    }
    return d;
  }
  async function get(url) {
    return request(url, {}, false);
  }
  async function post(url, body) {
    var payload = Object.assign({}, body || {});
    if ((url === LIVE || url === AUTO) && window.IGDCSocialAI && typeof window.IGDCSocialAI.policyEnvelope === "function") {
      var sectionKey = text(payload.sectionKey || payload.section || payload.targetSection);
      var aiPolicy = null;
      if (typeof window.IGDCSocialAI.policyBundle === "function") {
        // A policy agreed in any Social conversation scope must guide both
        // discovery and curation. In particular, influencer-dialog decisions
        // previously never reached the LIVE collector because it read only the
        // collector scope.
        aiPolicy = window.IGDCSocialAI.policyBundle(sectionKey, ["collector","content","influencer"]);
      } else {
        aiPolicy = window.IGDCSocialAI.policyEnvelope(sectionKey, url === LIVE ? "collector" : "content");
      }
      if (aiPolicy) payload.aiPolicy = aiPolicy;
    }
    return request(
      url,
      { method: "POST", body: JSON.stringify(payload) },
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
    var status = Number(error && error.status) || 0;
    var reason = text(error && (error.code || (error.payload && error.payload.error)));
    var stage = text(error && (error.stage || (error.payload && error.payload.stage)));
    var kind = status === 401 || status === 403 ||
      /(로그인|인증|세션|token|issuer|audience)/i.test(message)
      ? "관리자 인증 실패" : "수집 실패";
    return kind + (status ? " HTTP " + status : "") +
      (reason ? " · " + reason : "") + (stage ? " · " + stage : "");
  }
  function collectorFailureRecord(error, sectionKey, action) {
    var payload = error && error.payload && typeof error.payload === "object" ? error.payload : {};
    return {
      at: new Date().toISOString(),
      sectionKey: text(sectionKey),
      action: text(action),
      status: Number(error && (error.status || error.statusCode) || 0) || null,
      code: text(error && error.code || payload.error).slice(0, 120),
      stage: text(error && error.stage || payload.stage).slice(0, 100),
      message: text(error && error.message).slice(0, 400),
      requestId: text(payload.requestId).slice(0, 100)
    };
  }
  function showCollectorFailure(error, sectionKey, action) {
    var failure = collectorFailureRecord(error, sectionKey, action);
    diagnostic({
      ok:false, reportType:"igdc-social-collection-failure", generatedAt: failure.at,
      failure:failure, savedJob:loadJob(), discoveryCursors:discoveryCursors(),
      recentBatches:liveReports.slice(-4).map(function (r) {return r.liveCollection || r;})
    });
    if ($("collectorState")) $("collectorState").textContent = collectionErrorState(error);
    show(label(sectionKey) + " · " + collectionErrorState(error) +
      " · " + (failure.message || "서버 요청 실패") +
      " · [진단 JSON]에서 실패 단계 확인 가능. 검색 커서는 유지합니다.", "warn");
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
  function visible(sourceRows) {
    var q = lower($("searchInput").value),
      section = text($("sectionFilter").value),
      platform = text($("platformFilter").value),
      risk = text($("riskFilter").value),
      review = text($("reviewFilter").value);
    return (Array.isArray(sourceRows) ? sourceRows : countryScopedActive())
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
  function youtubeThumbFromRow(r) {
    var raw = (r && r.raw) || {},
      value = text(
        (r && (r.latestContentUrl || r.sourceUrl || r.channelEvidenceUrl)) ||
          raw.latestContentUrl || raw.latest_content_url ||
          raw.sourceContentUrl || raw.source_content_url || raw.url || "",
      ),
      match = value.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/))([A-Za-z0-9_-]{6,})/i);
    return match ? "https://i.ytimg.com/vi/" + match[1] + "/hqdefault.jpg" : "";
  }
  function thumbnailOf(r, mode) {
    var raw = (r && r.raw) || {},
      social = (r && r.social) || raw.social || {},
      source = (r && r.source) || raw.source || {},
      values = mode === "registry"
        ? [
            r && r.channelThumbnailUrl, raw.channelThumbnailUrl, raw.channel_thumbnail_url,
            r && r.thumbnailUrl, r && r.thumbnail_url, raw.thumbnailUrl, raw.thumbnail_url,
            raw.thumbnail, raw.thumb, raw.image, raw.imageUrl, raw.image_url, raw.poster, raw.cover,
            social.thumbnailUrl, social.thumbnail, social.image, source.thumbnailUrl, source.thumbnail, source.image
          ]
        : [
            r && r.thumbnailUrl, r && r.thumbnail_url, raw.thumbnailUrl, raw.thumbnail_url,
            raw.thumbnail, raw.thumb, raw.image, raw.imageUrl, raw.image_url, raw.poster, raw.cover,
            social.thumbnailUrl, social.thumbnail, social.image, source.thumbnailUrl, source.thumbnail, source.image,
            r && r.channelThumbnailUrl, raw.channelThumbnailUrl, raw.channel_thumbnail_url
          ];
    for (var i = 0; i < values.length; i += 1) {
      var value = text(values[i]);
      if (/^https:\/\//i.test(value)) return value;
    }
    if (lower(r && r.platform).replace(/^social-/, "") === "youtube" || text(r && r.sectionKey) === "social-youtube") {
      return youtubeThumbFromRow(r);
    }
    return "";
  }
  function tiktokVideoPlayerUrlForAdmin(link) {
    try {
      var u = new URL(link);
      if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) return "";
      var m = u.pathname.match(/\/video\/(\d{12,24})(?:\/|$)/);
      return m ? "https://www.tiktok.com/player/v1/" + m[1] + "?autoplay=0&controls=0&description=0&music_info=0" : "";
    } catch (_error) { return ""; }
  }
  // The same real video plays in a browser even when the signed thumbnail CDN
  // is expired. Load its first-party preview ONLY if image recovery failed.
  window.igdcSocialThumbError = function (img) {
    if (!img) return;
    if (img.dataset.directThumb && img.dataset.triedDirect !== "1") {
      img.dataset.triedDirect = "1";
      img.src = img.dataset.directThumb;
      return;
    }
    img.style.display = "none";
    var fallback = img.nextElementSibling;
    if (!fallback) return;
    fallback.style.display = "grid";
    var frame = fallback.querySelector("iframe[data-preview-src]");
    if (frame && !frame.src) frame.src = frame.dataset.previewSrc;
    if (frame) frame.style.display = "block";
  };
  function thumb(r, mode) {
    var url = thumbnailOf(r, mode);
    var platform = lower(r.platform || r.sectionKey).replace(/^social-/, "");
    var raw = r.raw || {};
    var postUrl = text(r.latestContentUrl || raw.latestContentUrl || raw.latest_content_url || r.sourceUrl || raw.sourceUrl);
    // A valid post link can be displayed even when its short-lived CDN cover
    // has expired. Ask the same-origin social-only relay before blanking cards.
    var relay = mode !== "registry" &&
      ["instagram", "tiktok", "facebook", "snapchat", "bilibili", "douyin"].indexOf(platform) >= 0 &&
      /^https:\/\//i.test(postUrl)
        ? "/.netlify/functions/social-thumbnail-proxy?platform=" + encodeURIComponent(platform) +
          "&url=" + encodeURIComponent(postUrl) +
          "&thumb=" + encodeURIComponent(genericProviderPreviewThumb(platform, url) ? "" : url)
        : "";
    var initial = relay || url;
    var backup = relay && /^https:\/\//i.test(url) && !genericProviderPreviewThumb(platform, url) ? url : "";
    var playerUrl = platform === "tiktok" && mode !== "registry" ? tiktokVideoPlayerUrlForAdmin(postUrl) : "";
    var player = playerUrl
      ? '<iframe title="TikTok real video preview" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allow="encrypted-media; fullscreen" style="display:none;width:100%;height:100%;border:0;pointer-events:none" data-preview-src="' + esc(playerUrl) + '"></iframe>'
      : "";
    var fallback = '<span class="candidate-thumb-fallback" style="' +
      (initial ? "display:none;" : "display:grid;") +
      (player ? "padding:0;" : "") + '">' + player +
      (player ? "" : (esc(r.platform || "SNS") + "<br>" + esc(r.creatorName || r.title || "공개 미리보기"))) + '</span>';
    if (!initial || !/^(?:https:\/\/|\/\.netlify\/functions\/)/i.test(initial)) {
      return player ? fallback.replace('data-preview-src="' + esc(playerUrl) + '"', 'src="' + esc(playerUrl) + '"').replace('display:none;width:100%', 'display:block;width:100%') : fallback;
    }
    return '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(initial) +
      '" data-direct-thumb="' + esc(backup) +
      '" alt="" onerror="window.igdcSocialThumbError(this)">' + fallback;
  }
  function rebuildLatestContentIndex(sourceRows) {
    latestContentIndex = new Map();
    (Array.isArray(sourceRows) ? sourceRows : countryScopedActive()).forEach(function (row) {
      if (assetClass(row) !== "latest_content") return;
      var identity = channelIdentity(row);
      if (!identity) return;
      var previous = latestContentIndex.get(identity);
      if (!previous) {
        latestContentIndex.set(identity, row);
        return;
      }
      var rowDate = Date.parse(text(row.contentPublishedAt)) || 0;
      var previousDate = Date.parse(text(previous.contentPublishedAt)) || 0;
      if (rowDate > previousDate || (rowDate === previousDate && score(row) > score(previous))) {
        latestContentIndex.set(identity, row);
      }
    });
  }
  function latestForInfluencer(r) {
    var identity = channelIdentity(r);
    return identity ? latestContentIndex.get(identity) || null : null;
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
      ' aria-label="' +
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
    var source = lastVisibleRows.length ? lastVisibleRows : visible();
    return source.filter(function (row) {
      var kindOk = assetClass(row) === (queue === "registry" ? "influencer_registry" : "latest_content");
      if (!kindOk) return false;
      if (queue === "hold" && !contentHold(row)) return false;
      if (queue === "waiting" && contentHold(row)) return false;
      return !section || row.sectionKey === section;
    });
  }
  function selectionSet(queue) {
    return queue === "registry" ? selectedInfluencers : queue === "hold" ? selectedHoldContents : selectedContents;
  }
  function queueCheckboxSelector(queue) {
    return queue === "registry" ? ".finalCheck" : queue === "hold" ? ".holdCheck" : ".waitingCheck";
  }
  function updateSectionSelectionState() {
    document.querySelectorAll(".registrySectionCheck").forEach(function (el) {
      var key = text(el.dataset.registrySection);
      var part = queueRows("registry", key);
      var selectedCount = part.filter(function (row) { return selectedInfluencers.has(text(row.id)); }).length;
      el.checked = part.length > 0 && selectedCount === part.length;
      el.indeterminate = selectedCount > 0 && selectedCount < part.length;
      el.disabled = part.length === 0;
    });
  }
  function syncQueueSelectionDom(queue, section) {
    var target = selectionSet(queue), selector = queueCheckboxSelector(queue);
    document.querySelectorAll(selector).forEach(function (el) {
      var id = text(el.dataset.candidateId);
      var row = rows.find(function (value) { return text(value.id) === id; });
      if (section && (!row || row.sectionKey !== section)) return;
      var checked = target.has(id);
      el.checked = checked;
      var card = el.closest && el.closest(".candidate-card");
      if (card) card.classList.toggle("selected", checked);
    });
    updateMasterSelectionState();
    updateSectionSelectionState();
  }
  function selectQueue(queue, section, checked) {
    var target = selectionSet(queue);
    queueRows(queue, section).forEach(function (row) {
      if (checked) target.add(text(row.id));
      else target.delete(text(row.id));
    });
    // Selection must be immediate even with hundreds of influencer rows. Do not
    // rebuild every accordion/card just to toggle checkboxes.
    syncQueueSelectionDom(queue, section);
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
    updateSectionSelectionState();
  }
  function toggleWholeQueue(queue, checked) {
    selectQueue(queue, "", checked);
  }
  function selectedFrontSectionKeys() {
    return order.filter(function (key) { return selectedFrontSections.has(key); });
  }
  function updateFrontSectionSelectionState() {
    var keys = selectedFrontSectionKeys(), state = $("frontSectionSelectionState");
    if (state) state.textContent = "프론트 섹션 선택 " + keys.length + "/" + order.length;
    if ($("publishSelectedFrontSectionsBtn")) $("publishSelectedFrontSectionsBtn").disabled = keys.length === 0;
    if ($("unpublishSelectedFrontSectionsBtn")) $("unpublishSelectedFrontSectionsBtn").disabled = keys.length === 0;
  }
  function setFrontSectionSelection(keys, checked) {
    (keys || []).forEach(function (key) {
      if (order.indexOf(key) < 0) return;
      if (checked) selectedFrontSections.add(key);
      else selectedFrontSections.delete(key);
    });
    renderSections();
    updateFrontSectionSelectionState();
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
  async function importRedditUrls() {
    var input = window.prompt('공개 Reddit 게시물 URL을 입력하세요. (여러 건은 줄바꿈, | 제목 선택 입력)\n예: https://www.reddit.com/r/Art/comments/abc123/example/ | 작품 설명');
    if (!text(input)) return;
    try {
      var result = await post(LIVE, { action:'intake_urls', sectionKey:'social-reddit', rawText:input, dryRun:false });
      show('Reddit URL 등록 요청: ' + Number(result.saved || result.inserted || 0) + '건 저장 응답. 등록 후 후보 목록에서 검증하세요.', 'ok');
      await refresh();
    } catch (error) {
      show(text(error && error.message) || 'Reddit 공개 URL 등록 실패', 'warn');
    }
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
      (key === "social-reddit" ? '<button class="secondary" type="button" data-reddit-intake="1">Reddit 공개 게시물 URL 등록</button>' : "") +
      '<button class="secondary" type="button" data-section-import-content="' +
      esc(key) +
      '">이 SNS 실후보 반입</button>' +
      '<button class="secondary" type="button" data-section-open-content="' +
      esc(key) +
      '">이 SNS 콘텐츠 후보 열기</button>' +
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
      '<button class="publish" type="button" data-section-collect="' + esc(key) + '">이 SNS 공개 콘텐츠 검색·수집</button>' +
      '<button class="secondary" type="button" data-section-import-content="' + esc(key) + '">이 SNS SearchBank 실후보 반입</button>' +
      (key === "social-reddit" ? '<button class="secondary" type="button" data-reddit-intake="1">Reddit 게시물 URL 직접 등록</button>' : '') +
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
          }),
          sourceCount = part.length,
          frontCount = rows.filter(function (row) {
            return row && row.sectionKey === key && publishedContentIds.has(text(row.id));
          }).length;
        if (queue === "waiting" && part.length > 120) part = part.slice(0, 120);
        var isOpen = openKey === key,
          toggleAttribute =
            queue === "registry" ? "data-final-toggle" : queue === "hold" ? "data-hold-toggle" : "data-waiting-toggle";
        return (
          '<section class="candidate-section ' +
          (isOpen ? "open" : "") +
          '" data-section="' +
          esc(key) +
          '"><div class="section-toggle-row">' +
          (queue === "waiting"
            ? '<label class="section-front-select"><input class="frontSectionCheck" type="checkbox" data-front-section="' +
              esc(key) +
              '"' +
              (selectedFrontSections.has(key) ? " checked" : "") +
              '> 프론트 선택</label>'
            : queue === "registry"
              ? '<label class="section-front-select"><input class="registrySectionCheck" type="checkbox" data-registry-section="' +
                esc(key) +
                '"> 섹션 선택</label>'
              : "") +
          '<button class="section-toggle" type="button" ' +
          toggleAttribute +
          '="' +
          esc(key) +
          '"><span class="section-toggle-main"><span class="section-toggle-title">' +
          esc(label(key)) +
          '</span><span class="section-count">' +
          (queue === "waiting"
            ? "후보 " + sourceCount + " · 프론트 " + frontCount
            : sourceCount + (queue === "registry" ? "명" : "개")) +
          '</span></span><span class="section-chevron">⌄</span></button>' +
          (queue === "waiting" ? '<button class="secondary" type="button" data-section-diagnostic="' + esc(key) + '" style="margin:6px">점검 JSON</button>' : '') +
          '</div>' +
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
                : queue === "waiting"
                  ? '<div class="empty-section">후보 원장에 이 SNS의 최신 게시물이 없습니다. 검색 결과 수는 실제 저장 건수가 아닙니다. 수집 후에도 0건이라면 수집 진행 JSON의 gateway.readback 및 rejectedByReason을 확인해 주세요.' +
                    '<div class="section-actionbar"><button class="secondary" type="button" data-empty-collect="' + esc(key) + '">이 SNS 실제 콘텐츠 다시 수집</button></div></div>'
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
    var scopedRows = countryScopedActive();
    rebuildLatestContentIndex(scopedRows);
    var list = visible(scopedRows),
      finalList = list.filter(function (row) {
        return assetClass(row) === "influencer_registry";
      }),
      waitingAll = list.filter(function (row) {
        return assetClass(row) === "latest_content" && !contentHold(row);
      }),
      holdList = list.filter(contentHold),
      waitingList = waitingAll.filter(waitingViewAccept);
    lastVisibleRows = list.slice();
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
    updateSectionSelectionState();
    updateFrontSectionSelectionState();
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
  function toggleRegistryPanel(forceOpen) {
    var body = $("registryPanelBody"), button = $("toggleRegistryPanelBtn");
    if (!body || !button) return;
    var open = typeof forceOpen === "boolean"
      ? forceOpen
      : body.classList.contains("hidden");
    if (!open && openDetailQueue === "registry") {
      // Closing the registry closes every SNS subsection too.
      openDetailQueue = "";
      openDetailSection = "";
    }
    body.classList.toggle("hidden", !open);
    button.textContent = open ? "등록부 접기" : "등록부 펼치기";
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      // Always reopen cleanly with all six section bodies folded.
      openDetailQueue = "";
      openDetailSection = "";
      renderSections();
    }
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
  function contentDiagnosticRow(row) {
    var raw = (row && row.raw) || {}, id = text(row && row.id);
    return {
      id: id,
      sectionKey: text(row && row.sectionKey),
      platform: text(row && row.platform),
      assetClass: assetClass(row),
      reviewStatus: text(row && row.reviewStatus),
      candidateOnly: row && row.candidateOnly == null ? null : !!row.candidateOnly,
      title: text(row && (row.title || row.name)),
      creatorName: text(row && (row.creatorName || row.channelName || raw.creatorName || raw.channelName)),
      sourceUrl: text(row && (row.sourceUrl || row.latestContentUrl || raw.sourceContentUrl || raw.latestContentUrl)),
      channelUrl: text(row && (row.channelUrl || raw.channelUrl)),
      thumbnailUrl: text(row && row.thumbnailUrl),
      placement: waitingPlacement(row) || null,
      frontPublished: publishedContentIds.has(id),
      contentHold: contentHold(row),
      searchExcluded: excluded(row) && !blocked(row),
      permanentlyBlocked: blocked(row),
      updatedAt: text(row && (row.updatedAt || row.updated_at)),
    };
  }
  function groupDiagnosticRows(list) {
    var grouped = {};
    order.forEach(function (key) { grouped[key] = []; });
    (list || []).forEach(function (row) {
      var key = text(row && row.sectionKey);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(contentDiagnosticRow(row));
    });
    return grouped;
  }
  async function downloadContentStateDiagnostic() {
    try {
      await loadPlacement();
      await loadPublishedState();
    } catch (_e) {}
    var activeLatest = rows.filter(function (row) {
        return assetClass(row) === "latest_content" && !excluded(row);
      }),
      candidateRows = activeLatest.filter(function (row) { return !contentHold(row); }),
      freshRows = candidateRows.filter(function (row) { return !waitingPlacement(row); }),
      publicRows = candidateRows.filter(function (row) { return waitingPlacement(row) === "public_selected"; }),
      reserveRows = candidateRows.filter(function (row) { return waitingPlacement(row) === "replacement_waiting"; }),
      frontRows = candidateRows.filter(function (row) { return publishedContentIds.has(text(row && row.id)); }),
      holdRows = activeLatest.filter(contentHold),
      now = new Date(),
      report = {
        ok: true,
        reportType: "igdc-social-six-content-state-diagnostic",
        generatedAt: now.toISOString(),
        readOnly: true,
        scope: currentScope(),
        definitions: {
          allCandidates: "활성 latest_content 중 보류·검색제외·차단을 제외한 후보",
          newCollected: "placement가 아직 없는 최신 콘텐츠 후보",
          frontPlanned: "rotation placement=public_selected",
          reserveReplacement: "rotation placement=replacement_waiting",
          currentFront: "현재 저장된 Social front release에 candidate id가 존재",
          hold: "reviewStatus=hold/content_hold/held"
        },
        counts: {
          allCandidates: candidateRows.length,
          newCollected: freshRows.length,
          frontPlanned: publicRows.length,
          reserveReplacement: reserveRows.length,
          currentFront: frontRows.length,
          hold: holdRows.length,
          searchExcluded: rows.filter(function (row) { return assetClass(row) === "latest_content" && excluded(row) && !blocked(row); }).length,
          permanentlyBlocked: rows.filter(function (row) { return assetClass(row) === "latest_content" && blocked(row); }).length,
        },
        states: {
          allCandidates: groupDiagnosticRows(candidateRows),
          newCollected: groupDiagnosticRows(freshRows),
          frontPlanned: groupDiagnosticRows(publicRows),
          reserveReplacement: groupDiagnosticRows(reserveRows),
          currentFront: groupDiagnosticRows(frontRows),
          hold: groupDiagnosticRows(holdRows),
        },
        note: "이 JSON은 현재 후보/배치/프론트 상태를 읽기만 하며 프론트 등록·해제 또는 Snapshot 변경을 수행하지 않습니다."
      };
    diagnostic(report);
    toggleDiagnosticPanel(true);
    download(
      "igdc-social-six-content-state-diagnostic-" +
        now.toISOString().slice(0, 19).replace(/[:T]/g, "-") +
        ".json",
      report,
    );
    show("6개 콘텐츠 상태의 현재 JSON을 읽기 전용으로 다운로드했습니다.", "ok");
    return report;
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
        discoveryCursors: discoveryCursors(),
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
  async function durablePublishedState() {
    var scope = currentScope(),
      q = new URLSearchParams({
        operation: "current_front_state",
        scopeMode: scope.scopeMode || "auto",
        countryCode: scope.countryCode || "",
        regionId: scope.regionId || "",
        languages: text($("collectorLanguages").value),
      });
    return get(PUBLISH + "?" + q.toString());
  }
  function idsFromStaticSnapshot(d) {
    var sections = (d && d.pages && d.pages.social && d.pages.social.sections) || {},
      ids = [];
    order.forEach(function (key) {
      (Array.isArray(sections[key]) ? sections[key] : []).forEach(function (slot) {
        var audit = (slot && slot.audit) || {}, id = publishedCandidateId(slot);
        if (id && text(slot && slot.type) === "external_social" && text(audit.origin) === "social_candidates") ids.push(id);
      });
    });
    return Array.from(new Set(ids));
  }
  async function loadPublishedState() {
    var previous = new Set(publishedContentIds);
    try {
      var durable = await durablePublishedState(),
        ids = Array.isArray(durable && durable.publishedContentIds)
          ? durable.publishedContentIds
          : [];
      publishedContentIds = new Set(ids.map(text).filter(Boolean));
      return publishedContentIds;
    } catch (_durableError) {
      try {
        var d = await staticJson(STATIC_SOCIAL_SNAPSHOT);
        publishedContentIds = new Set(idsFromStaticSnapshot(d));
      } catch (_staticError) {
        // A transient read failure must not make an already-published front
        // appear empty in the administrator UI. Keep the last known state.
        publishedContentIds = previous;
      }
    }
    return publishedContentIds;
  }


  function signedPreviewExpired(platform, value) {
    try {
      var u = new URL(text(value), location.href),
        host = text(u.hostname).toLowerCase(),
        token = "",
        ms = 0;
      if (platform === "facebook" && /(^|\.)fbcdn\.net$/i.test(host)) {
        token = text(u.searchParams.get("oe"));
        if (/^[0-9a-f]+$/i.test(token)) ms = parseInt(token, 16) * 1000;
      } else if (platform === "tiktok") {
        token = text(u.searchParams.get("x-expires") || u.searchParams.get("x_expires"));
        if (/^\d+$/.test(token)) ms = Number(token) * 1000;
      }
      return isFinite(ms) && ms > 0 && ms <= Date.now() + 24 * 60 * 60 * 1000;
    } catch (_e) { return false; }
  }
  function genericProviderPreviewThumb(platform, value) {
    var raw = text(value);
    if (!/^https:\/\//i.test(raw)) return false;
    try {
      var u = new URL(raw, location.href),
        host = text(u.hostname).toLowerCase().replace(/^www\./, ""),
        path = text(u.pathname + u.search).toLowerCase();
      if (/\.(?:js|mjs|css|map|json|html?|xml)(?:$|[?#])/i.test(raw)) return true;
      if (/(?:^|[\/_-])(?:logo|favicon|sprite|glyph|appicon|app-icon|brandmark|wordmark|icon|badge|spinner|loading|default[-_]?image|placeholder|blank)(?:[\/_\-.]|$)/i.test(path)) return true;
      if (platform === "instagram" && (host === "static.cdninstagram.com" || /(^|\.)static\.[^.]*fbcdn\.net$/i.test(host) || /\/rsrc\.php(?:$|[/?#])/i.test(u.pathname))) return true;
      if (platform === "facebook" && /(^|\.)facebook\.com$/i.test(host) && !/\.(?:avif|webp|jpe?g|png|gif)(?:$|[?#])/i.test(path)) return true;
      return signedPreviewExpired(platform, raw);
    } catch (_e) { return false; }
  }
  var PROFILE_FALLBACK_SECTIONS = new Set(["social-bilibili","social-douyin"]);
  function realPreviewMissing(row) {
    if (!row) return false;
    var cls=assetClass(row);
    if (cls !== "latest_content" && !(cls === "influencer_registry" && PROFILE_FALLBACK_SECTIONS.has(row.sectionKey))) return false;
    var platform = lower(row.platform).replace(/^social-/, ""),
      title = lower(row.title),
      raw = row.raw || {},
      sourceUrl = text(row.sourceUrl || row.source_url || raw.latestContentUrl || raw.latest_content_url || raw.sourceUrl || raw.source_url),
      thumbUrl = text(row.thumbnailUrl || row.thumbnail_url || raw.thumbnailUrl || raw.thumbnail_url);
    if (platform === "youtube") return false;
    var noThumb = !/^https:\/\//i.test(thumbUrl) ||
      /placeholder|\/assets\/sample\//i.test(thumbUrl) ||
      (sourceUrl && thumbUrl === sourceUrl) ||
      genericProviderPreviewThumb(platform, thumbUrl);
    if (platform === "facebook") return noThumb;
    var genericTitle = !title || ["instagram","tiktok","bilibili","douyin"].indexOf(title) >= 0;
    return noThumb || genericTitle;
  }
  function mergeHydratedRows(items) {
    (Array.isArray(items) ? items : []).forEach(function (updated) {
      var id = text(updated && updated.id);
      if (!id) return;
      var index = rows.findIndex(function (row) { return text(row && row.id) === id; });
      if (index >= 0) rows[index] = Object.assign({}, rows[index], updated);
      previewHydratedIds.add(id);
    });
  }
  async function hydrateMissingPreviewsAsync() {
    if (previewHydrationBusy) return;
    var ids = rows.filter(realPreviewMissing).map(function (row) { return text(row.id); })
      .filter(function (id) { return id && !previewHydratedIds.has(id); }).slice(0, 40);
    if (!ids.length) return;
    previewHydrationBusy = true;
    ids.forEach(function (id) { previewHydratedIds.add(id); });
    try {
      var d = await post(ACTION, { action: "hydrate_preview", ids: ids });
      mergeHydratedRows(d.items || []);
      rebuildLatestContentIndex(rows);
      renderSections();
    } catch (_error) {
      // Preview hydration is best-effort and must never block the administrator queue.
    } finally {
      previewHydrationBusy = false;
      var more = rows.some(function (row) { return realPreviewMissing(row) && !previewHydratedIds.has(text(row.id)); });
      if (more) setTimeout(hydrateMissingPreviewsAsync, 250);
    }
  }

  function setCandidateReadStatus(status, detail) {
    candidateReadStatus.status = status;
    candidateReadStatus.error = text(detail);
    if (status === "connected") candidateReadStatus.lastSuccessAt = new Date().toISOString();
    var el = $("socialSectionLoadState");
    if (!el) return;
    el.classList.toggle("warn", status !== "connected");
    el.textContent = status === "connected"
      ? "후보 원장 조회 정상 · " + rows.length + "개 기록 · " + candidateReadStatus.lastSuccessAt + " · 5개 SNS 관리 기능 사용 가능"
      : status === "loading" || status === "pending"
        ? "후보 원장 데이터 조회 중입니다. SNS별 관리·수집·점검 버튼은 항상 표시됩니다."
        : "후보 원장 읽기 실패 · " + text(detail) + " · 현재 표시된 0건은 실제 후보 0건을 뜻하지 않습니다. 검색/등록 결과는 점검 JSON으로 확인하세요.";
  }
  function downloadSectionDiagnostic(key) {
    if (order.indexOf(key) < 0) return;
    var part = rows.filter(function (row) { return row && row.sectionKey === key; });
    var content = part.filter(function (row) { return assetClass(row) === "latest_content"; });
    var registry = part.filter(function (row) { return assetClass(row) === "influencer_registry"; });
    var published = content.filter(function (row) { return publishedContentIds.has(text(row.id)); });
    var report = {
      reportType: "igdc-social-section-admin-diagnostic",
      generatedAt: new Date().toISOString(), sectionKey: key, platform: label(key),
      candidateRead: Object.assign({}, candidateReadStatus),
      scope: currentScope(),
      counts: {
        registry: registry.length, latestContent: content.length,
        visibleContent: content.filter(function (row) { return !excluded(row) && !contentHold(row); }).length,
        frontContent: published.length,
        heldContent: content.filter(contentHold).length,
        blocked: part.filter(blocked).length,
        excluded: part.filter(excluded).length,
        pendingPublicSelection: content.filter(function (row) { return placementById[text(row.id)] === "public_selected"; }).length
      },
      lastCollection: liveReports.filter(function (r) {
        return text(r && (r.sectionKey || r.section || (r.liveCollection && r.liveCollection.sectionKey))) === key;
      }).slice(-3),
      sample: content.slice(0,20).map(function (row) {
        return {id: text(row.id), url: text(row.contentUrl || row.sourceUrl || row.url || row.postUrl),
          reviewStatus: text(row.reviewStatus), published: publishedContentIds.has(text(row.id))};
      }),
      note: candidateReadStatus.status === "connected"
        ? "조회 결과 기준이며 실제 공개 여부는 Snapshot과 프론트 화면에서 추가 확인합니다."
        : "후보 API 읽기 오류 중이므로 목록 및 수치는 현재 실제 DB 상태를 보장하지 않습니다."
    };
    download("igdc-social-" + key.replace(/^social-/, "") + "-section-diagnostic.json", report);
    show(label(key) + " 섹션 점검 JSON을 다운로드했습니다.", "ok");
  }
  async function refresh() {
    hide();
    setCandidateReadStatus("loading", "");
    $("refreshBtn").disabled = true;
    try {
      var d = await get(REVIEW + "?action=candidates");
      rows = (d.queue && d.queue.rows) || d.candidates || [];
      setCandidateReadStatus("connected", "");
      pruneSelections();
      await Promise.all([loadPlacement(), loadPublishedState()]);
      renderSummary(d.summary);
      filters(d.summary);
      // Open exactly one actual content list on initial load. Previously every
      // section was collapsed, giving the impression that the queue was empty.
      // Preserve the administrator's chosen accordion on later refreshes.
      if (!firstContentListOpened) {
        firstContentListOpened = true;
        if (!openDetailSection) {
          var populatedKey = order.find(function (key) {
            return rows.some(function (row) {
              return row.sectionKey === key && assetClass(row) === "latest_content" &&
                !excluded(row) && !contentHold(row);
            });
          });
          if (populatedKey) {
            openDetailQueue = "content";
            openDetailSection = populatedKey;
            waitingViewMode = "all";
          }
        }
      }
      renderSections();
      renderExclusions();
      setTimeout(hydrateMissingPreviewsAsync, 0);
      $("state").textContent =
        "연결 정상 · " +
        ((d.source && d.source.candidateSourceMode) || "read_only");
      show(
        "관리 화면에서는 인플루언서 등록부와 최신 콘텐츠 후보·교체 대기열을 유형별로 분리합니다. 실제 수집은 PSOM·SearchBank 기준의 최신 콘텐츠 탐색을 먼저 수행하고, 인플루언서 등록부는 발견된 우수 제작자를 보조 데이터로 유지합니다.",
        "ok",
      );
      return true;
    } catch (e) {
      setCandidateReadStatus("error", e && e.message || "후보 DB/API 연결 실패");
      // Never hide a mission-critical management section when its API is down.
      try { renderSections(); } catch (renderError) {
        console.error("[IGDC Social Admin] fallback section rendering failed", renderError);
      }
      show(e.message || "대기열을 읽지 못했습니다.", "warn");
      return false;
    } finally {
      $("refreshBtn").disabled = false;
    }
  }
  function jobKey() {
    return "igdc.socialCollector.job.v8.parallel-seven-waves";
  }
  function loadJob() {
    try {
      var job = JSON.parse(localStorage.getItem(jobKey()) || "null");
      if (!job || Number(job.schemaVersion) !== COLLECTOR_JOB_VERSION) return null;
      if (order.indexOf(text(job.section)) < 0) return null;
      return job;
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
  function discoveryCursors() {
    try {
      var value = JSON.parse(localStorage.getItem(COLLECTOR_CURSOR_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (_e) {
      return {};
    }
  }
  function loadDiscoveryCursor(section) {
    var value = Number(discoveryCursors()[text(section)] || 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }
  function saveDiscoveryCursor(section, cursor) {
    try {
      var all = discoveryCursors(),
        key = text(section),
        value = Math.max(0, Math.floor(Number(cursor || 0)));
      // Keep enough history to advance across policy pages while eventually
      // wrapping instead of growing without bound across years of operation.
      all[key] = value % 384;
      localStorage.setItem(COLLECTOR_CURSOR_KEY, JSON.stringify(all));
    } catch (_e) {}
  }
  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  function sectionEmptyBatchLimit(section, j) {
    var lowYield = /^social-(?:tiktok|facebook|snapchat|bilibili|douyin)$/.test(section),
      cap = lowYield ? LOW_YIELD_EMPTY_BATCH_LIMIT : STANDARD_EMPTY_BATCH_LIMIT,
      reported = Number(j && (j.discoveryCatalogSize || j.catalogSize) || 0),
      allMode = !!(j && j.runMode === "all"),
      fairCap = allMode ? SECTION_BATCHES_PER_ROUND : cap;
    // A full seven-section run allocates a fair budget to every platform; repeated rounds
    // prevent TikTok/Facebook exhausting the budget before Bilibili/Douyin are reached. Runs
    // continue from a persisted per-section cursor, so a small fair budget here
    // increases breadth over time instead of repeating the first queries.
    if (reported > 0) fairCap = Math.min(fairCap, reported);
    return Math.max(allMode ? 3 : 4, fairCap);
  }
  function fatalCollectionError(error) {
    var status = Number(error && error.status), message = text(error && error.message);
    return status === 401 || status === 403 ||
      /(로그인|인증|세션|token|issuer|audience|forbidden|unauthor)/i.test(message);
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
        "google-cse-content": "Google CSE 실콘텐츠",
        "naver-web-channel": "Naver 검색",
        "sanmaru-public-search": "산마루·SearchBank",
        "tiktok-native-search": "TikTok 전용 검색",
        "tiktok-native-search-fallback": "TikTok 전용 검색 보조",
        "facebook-native-search": "Facebook 전용 검색",
        "facebook-native-watch-search": "Facebook Watch 검색",
        "facebook-native-video-search": "Facebook 영상 검색",
        "bilibili-native-api-search": "Bilibili 공개 API 검색",
        "bilibili-native-api-popular": "Bilibili 공개 인기 영상",
        "bilibili-native-search": "Bilibili 전용 검색",
        "bilibili-native-html": "Bilibili 직접 검색",
        "douyin-native-search": "Douyin 전용 검색",
        "douyin-native-search-fallback": "Douyin 전용 검색 보조",
        "yahoo-html-social": "Yahoo 공개 검색",
        "baidu-html-bilibili": "Baidu Bilibili 보조 검색",
        "sogou-html-bilibili": "Sogou Bilibili 보조 검색",
        "baidu-html-douyin": "Baidu Douyin 보조 검색",
        "sogou-html-douyin": "Sogou Douyin 보조 검색",
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
        degraded: "일부 경로 제한",
        credential_or_api_restricted: "API 공개 접근 제한",
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
  function sectionProbeSummary(sectionKey, response, error) {
    var live = response && response.liveCollection || {};
    return {
      sectionKey: sectionKey,
      platform: label(sectionKey),
      ok: !!(response && response.ok === true),
      transportError: error ? { message: text(error.message), status: Number(error.status || 0) || null } : null,
      accepted: Number(response && response.accepted || 0),
      saved: Number(response && response.saved || 0),
      dryRunExpectedSavedZero: true,
      searchedRows: Number(live.searchedRows || 0),
      directCandidates: Number(live.directCandidates || 0),
      submittedCandidates: Number(live.submittedCandidates || 0),
      submittedRecords: Number(live.submittedRecords || 0),
      rejectedRows: Number(live.rejectedRows || 0),
      rejectedByReason: live.rejectedByReason || {},
      providerGroup: live.providerGroupName || null,
      providerTrace: live.providerTrace || [],
      gateway: live.gateway || null,
      psomContract: live.psomContract || null,
      researchAuthority: live.researchAuthority || null,
      influencerRegistryRole: live.influencerRegistryRole || null,
      registryTargeted: !!live.registryTargeted,
      contentFirst: live.contentFirst !== false,
      queryCursor: live.queryCursor == null ? null : Number(live.queryCursor),
      nextQueryCursor: live.nextQueryCursor == null ? null : Number(live.nextQueryCursor),
      searchStart: live.searchStart == null ? null : Number(live.searchStart),
      itemsPreview: Array.isArray(response && response.itemsPreview) ? response.itemsPreview : [],
    };
  }
  async function downloadResearchPipelineDiagnostic() {
    var button = $("researchPipelineDiagnosticBtn");
    if (button) button.disabled = true;
    var now = new Date(), probes = [], readiness = null, review = null, handoff = null, runtimeFront = null, staticSnapshot = null;
    try {
      show("6개 SNS의 리서치 연결을 저장 없이 점검하고 있습니다.", "warn");
      try { readiness = await getReport(LIVE + "?_=" + Date.now()); } catch (e) { readiness = { ok:false, error:text(e.message), status:Number(e.status||0)||null }; }
      for (var i = 0; i < order.length; i++) {
        var key = order[i], response = null, failure = null;
        try {
          response = await post(LIVE, {
            action: "collect_live",
            dryRun: true,
            contentFirst: true,
            registryOnly: false,
            registrySweepDone: true,
            sectionKey: key,
            limit: 4,
            batchSize: 4,
            queryPasses: 1,
            queryCursor: 0,
            countryCode: selectedCountry(),
            scopeMode: scopeMode(),
            regionId: text($("collectorRegion").value),
            languages: text($("collectorLanguages").value),
          });
        } catch (e) { failure = e; }
        probes.push(sectionProbeSummary(key, response, failure));
      }
      var params = new URLSearchParams({ countryCode:selectedCountry(), scopeMode:scopeMode(), regionId:text($("collectorRegion").value) });
      try { review = await getReport(REVIEW + "?action=diagnostic&" + params.toString()); } catch (e) { review = { ok:false, error:text(e.message), status:Number(e.status||0)||null }; }
      try { handoff = await getReport(PUBLISH + "?action=pipeline_diagnostic&" + params.toString()); } catch (e) { handoff = { ok:false, error:text(e.message), status:Number(e.status||0)||null }; }
      try { runtimeFront = await getReport(CURRENT_SOCIAL + "?view=front&_=" + Date.now()); } catch (e) { runtimeFront = { ok:false, error:text(e.message), status:Number(e.status||0)||null }; }
      try { staticSnapshot = summarizeCanonicalSnapshot(await staticJson(STATIC_SOCIAL_SNAPSHOT)); } catch (e) { staticSnapshot = { ok:false, error:text(e.message) }; }
      var report = {
        ok: probes.some(function (p) { return p.ok && (p.directCandidates > 0 || p.searchedRows > 0); }),
        reportType: "igdc-social-six-section-research-pipeline-diagnostic",
        generatedAt: now.toISOString(),
        readOnly: true,
        scope: currentScope(),
        expectedSections: order.slice(),
        expectedFlow: [
          "PSOM Social section contract",
          "Social content-first research policy",
          "SearchBank/Sanmaru + platform/native/public search",
          "Social candidate gateway/store",
          "Social SearchBank release handoff",
          "Snapshot Engine social target",
          "social.snapshot",
          "Social AutoMap/front"
        ],
        readiness: readiness,
        sectionProbes: probes,
        candidateQueue: review,
        searchBankSnapshotHandoff: handoff,
        runtimeFront: runtimeFront,
        staticSocialSnapshot: staticSnapshot,
        diagnosis: {
          zeroDiscoverySections: probes.filter(function (p) { return !p.searchedRows && !p.directCandidates; }).map(function (p) { return p.sectionKey; }),
          searchButNoContentSections: probes.filter(function (p) { return p.searchedRows > 0 && p.directCandidates === 0; }).map(function (p) { return p.sectionKey; }),
          candidateResolvedSections: probes.filter(function (p) { return p.directCandidates > 0; }).map(function (p) { return p.sectionKey; }),
          remoteFailureSections: probes.filter(function (p) { return !!p.transportError; }).map(function (p) { return p.sectionKey; }),
        },
        note: "각 섹션은 dryRun으로 조사하므로 후보 DB를 변경하지 않습니다. searchedRows가 있는데 directCandidates가 0이면 검색 결과 URL/정책 변환 단계, searchedRows 자체가 0이면 검색 제공자/외부 접근 단계부터 확인하십시오.",
      };
      diagnostic(report);
      toggleDiagnosticPanel(true);
      download("igdc-social-six-section-research-pipeline-diagnostic-" + now.toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", report);
      show("6개 리서치 파이프라인 점검 JSON을 다운로드했습니다.", report.ok ? "ok" : "warn");
      return report;
    } catch (e) {
      var failureReport = {
        ok: false,
        reportType: "igdc-social-six-section-research-pipeline-diagnostic",
        generatedAt: now.toISOString(),
        readOnly: true,
        scope: currentScope(),
        sectionProbes: probes,
        fatalError: { message: text(e && e.message) || "pipeline_diagnostic_failed", status: Number(e && e.status || 0) || null },
        note: "점검 중 일부 UI/네트워크 단계가 실패해도 버튼이 무반응으로 끝나지 않도록 현재까지의 섹션 점검 결과와 오류를 JSON으로 반환합니다."
      };
      diagnostic(failureReport);
      toggleDiagnosticPanel(true);
      download("igdc-social-six-section-research-pipeline-diagnostic-error-" + now.toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", failureReport);
      show("리서치 파이프라인 점검 중 오류가 있어 오류 포함 JSON을 다운로드했습니다.", "warn");
      return failureReport;
    } finally {
      if (button) button.disabled = false;
    }
  }
  async function downloadDirectIntakeDiagnostic() {
    var now = new Date(), d = null;
    try {
      if (!text($("channelIntakeText").value)) {
        d = {
          ok: false,
          reportType: "igdc-social-direct-intake-diagnostic",
          generatedAt: now.toISOString(),
          sectionKey: text($("collectorSection").value),
          inputRequired: true,
          inputLineCount: 0,
          note: "직접 반입 점검은 실제 공개 영상/게시물 URL을 입력한 뒤 변환·제외 사유를 검사합니다. 입력이 없어도 버튼이 무반응으로 끝나지 않도록 이 진단 JSON을 반환합니다.",
        };
      } else {
        d = await intakeChannels(true);
        if (!d) d = { ok:false, reportType:"igdc-social-direct-intake-diagnostic", generatedAt:now.toISOString(), error:"direct_intake_probe_failed" };
      }
    } catch (e) {
      d = {
        ok: false,
        reportType: "igdc-social-direct-intake-diagnostic",
        generatedAt: now.toISOString(),
        sectionKey: text($("collectorSection").value),
        error: text(e && e.message) || "direct_intake_probe_failed",
        status: Number(e && e.status || 0) || null,
        note: "직접 반입 원격 점검이 실패해도 버튼이 무반응으로 끝나지 않도록 오류 자체를 JSON으로 반환합니다."
      };
    }
    diagnostic(d);
    toggleDiagnosticPanel(true);
    download("igdc-social-direct-intake-diagnostic-" + now.toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", d);
    show("직접 반입 점검 JSON을 다운로드했습니다.", d.ok === false ? "warn" : "ok");
    return d;
  }

  async function providerStatus() {
    try {
      var d = await get(LIVE);
      renderProviderStatus(d);
      show(
        d.providerReadiness && d.providerReadiness.collectionCanRun
          ? "검색 공급자 설정 확인 완료. 이것은 키/기본 경로 설정 점검이며, 실제 검색 성공·API 잔여 할당량·DB 신규 저장을 검증하는 버튼은 아닙니다. 실제 검색은 섹션 수집 버튼과 수집 진행 JSON으로 확인하세요."
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
        r.sectionKey === section && assetClass(r) === "latest_content" &&
        !/^(hold|held|content_hold|replacement_requested|replacement_waiting|rejected)$/i.test(text(r.reviewStatus)) &&
        /^https:\/\//i.test(text(r.sourceUrl || (r.raw && (r.raw.latestContentUrl || r.raw.sourceUrl)))) &&
        !!text(r.title)
      );
    }).length;
  }
  function newIds(data, known) {
    var gateway = data && data.liveCollection && data.liveCollection.gateway || {};
    // Count DB-verified new content, not creator rows or returned upserts.
    // A transport failure/readback failure must never be displayed as growth.
    if (gateway.verifiedInsertedLatestContent != null) {
      return Math.max(0, Number(gateway.verifiedInsertedLatestContent) || 0);
    }
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
  function renderParallelCollectionProgress() {
    var job = activeParallelCollectionJob;
    if (!job) return;
    var sectionJobs = job.sectionJobs || {},
      finished = Number(job.round || 0) * order.length + (job.completedInRound || []).length,
      total = order.length * FULL_RESEARCH_ROUNDS,
      overall = order.reduce(function (sum, key) {
        return sum + Math.min(120, Math.max(0, Number(sectionJobs[key] && sectionJobs[key].sectionCount || 0)));
      }, 0),
      fresh = order.reduce(function (sum, key) {
        return sum + Number(sectionJobs[key] && sectionJobs[key].verifiedInserted || 0);
      }, 0),
      updated = order.reduce(function (sum, key) {
        return sum + Number(sectionJobs[key] && sectionJobs[key].updated || 0);
      }, 0);
    var details = order.map(function (key) {
      var row = sectionJobs[key] || {}, flag = (job.completedInRound || []).includes(key) ? "완료" : "진행/대기";
      return label(key) + " " + Number(row.sectionCount || 0) + "/120 (신규 " +
        Number(row.verifiedInserted || 0) + ", " + flag + ")";
    });
    if ($("collectorProgress")) $("collectorProgress").classList.remove("hidden");
    if ($("collectorProgressText")) $("collectorProgressText").textContent =
      "병렬 " + (Math.min(FULL_RESEARCH_ROUNDS, Number(job.round || 0) + 1)) +
      "/" + FULL_RESEARCH_ROUNDS + "차 · 완료 " + finished + "/" + total +
      " · 후보 " + overall + "/" + (order.length * 120) + " · " + details.join(" | ");
    if ($("collectorRejectText")) $("collectorRejectText").textContent =
      "DB 검증 신규 " + fresh + "건 · 기존 갱신 " + updated + "건 · 실패 " +
      (job.sectionFailures || []).length + "건 · SNS별 검색 커서 독립 유지";
    if ($("collectorProgressBar")) $("collectorProgressBar").style.width =
      Math.min(100, Math.round(finished * 100 / Math.max(1, total))) + "%";
    if ($("collectorState")) $("collectorState").textContent =
      "5개 SNS 동시 수집 " + (Number(job.round || 0) + 1) + "차" +
      (stopRequested ? " · 현재 진행 중인 묶음 종료 후 일시정지" : " · 각 10개 내외 검색 중");
  }
  function progress(j) {
    if (j && j.parallelManaged) {
      renderParallelCollectionProgress();
      return;
    }
    var pct = Math.min(
      100,
      Math.round(
        (Number(j.sectionCount || 0) / Math.max(1, Number(j.target || 1))) *
          100,
      ),
    );
    $("collectorProgress").classList.remove("hidden");
    $("collectorProgressText").textContent =
      (j.runMode === "all" ? (Number(j.round || 0) * order.length + j.index + 1) : j.index + 1) +
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
      "건 · DB 신규 " + Number(j.verifiedInserted || 0) +
      "건 · 기존 갱신 " + Number(j.updated || 0) +
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
    // When a SNS has zero actual contents, validate the stable baseline query
    // on its first real-write pass. A rotating local cursor can otherwise
    // skip a proven Bilibili/Douyin content query for weeks. Subsequent rounds
    // continue the original rotating cursor (never seed fake candidates).
    var baselineRescue = !dryRun && Number(j.sectionCount || 0) === 0 &&
      Number(j.batch || 0) === 1 && Number(j.round || 0) === 0 &&
      /^(social-snapchat|social-bilibili|social-douyin)$/.test(section);
    var requestedCursor = baselineRescue ? 0 : (j.queryCursor || 0);
    var d;
    try {
      d = await post(LIVE, {
      action: "collect_live",
      dryRun: !!dryRun,
      qualitySweep: !!j.qualitySweepActive,
      // Content discovery is authoritative. The influencer registry is not a
      // prerequisite and must never consume or block the normal research budget.
      contentFirst: true,
      registryOnly: false,
      registrySweepDone: true,
      sectionKey: section,
      limit: j.batchSize,
      batchSize: j.batchSize,
      // One rotating query per invocation is deliberate: queryCursor already
      // advances every batch, so breadth is accumulated across bounded calls
      // instead of multiplying external-provider work inside one request.
      queryPasses: 1,
      queryCursor: requestedCursor,
      countryCode: j.countryCode || "",
      regionId: j.regionId || "",
      scopeMode: j.scopeMode || (j.countryCode ? "country" : (j.regionId ? "region" : "auto")),
      languages: j.languages || "",
      });
    } catch (error) {
      liveReports.push({
        ok:false, sectionKey:section, queryCursor:requestedCursor,
        error:collectorFailureRecord(error, section, "collect_live")
      });
      throw error;
    }
    liveReports.push(d);
    var live = d.liveCollection || {};
    j.searched += Number(live.searchedRows || 0);
    j.direct += Number(live.directCandidates || 0);
    j.accepted += Number(d.accepted || 0);
    j.saved += Number(d.saved || 0);
    j.inserted = Number(j.inserted || 0) + Number(d.insertedLatestContent || 0);
    j.updated = Number(j.updated || 0) + Number(d.updatedLatestContent || 0);
    j.verifiedInserted = Number(j.verifiedInserted || 0) + Number(d.verifiedInsertedLatestContent || 0);
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
    // The server may return 200 while a downstream gateway reports an error.
    // In that case preserve the old cursor: an unsuccessful DB write must
    // never make the next attempt silently skip the discovered post URLs.
    if (d.ok === false || (live.gateway && live.gateway.ok === false)) {
      var gatewayError = new Error(text(d.message || (live.gateway && live.gateway.message) || d.error || "candidate_gateway_failed"));
      gatewayError.status = Number(live.gateway && live.gateway.statusCode) || 500;
      gatewayError.code = text(live.gateway && live.gateway.error || d.error);
      gatewayError.stage = "candidate_storage";
      throw gatewayError;
    }
    // A successful HTTP 200 is not sufficient if the DB immediately reports
    // missing rows after an acknowledged write. Preserve exact retry cursor.
    var readback = live.gateway && live.gateway.readback;
    if (!dryRun && readback && readback.checked === true &&
        Array.isArray(readback.missingIds) && readback.missingIds.length > 0) {
      var missingError = new Error("후보 저장 후 DB 재조회 불일치: " + readback.missingIds.length + "건 미확인");
      missingError.status = 503;
      missingError.code = "social_candidate_readback_mismatch";
      missingError.stage = "candidate_storage_readback";
      throw missingError;
    }
    // Advance the discovery cursor only after downstream success.
    j.queryCursor = baselineRescue
      ? Math.max(Number(j.queryCursor || 0) + 1, Number(live.nextQueryCursor || 1))
      : Number(live.nextQueryCursor == null ? requestedCursor + 1 : live.nextQueryCursor);
    if (!dryRun) saveDiscoveryCursor(section, j.queryCursor);
    j.lastError = null;
    j.catalogSize = Number(live.queryCatalogSize || j.catalogSize || 5);
    j.discoveryCatalogSize = Number(
      live.discoveryCatalogSize || j.discoveryCatalogSize || j.catalogSize || 5,
    );
    j.providerGroup = Number(live.providerGroup || 0);
    j.providerGroupName =
      {
        psom_searchbank_content: "PSOM·SearchBank 콘텐츠",
        configured_search_apis: "플랫폼·Google·Naver",
        platform_direct_search_apis: "플랫폼·Google·Naver",
        sanmaru_platform_rescue: "산마루·플랫폼 보강",
        influencer_registry_supplemental: "인플루언서 보조 조사",
      }[text(live.providerGroupName)] || text(live.providerGroupName);
    return d;
  }
  async function collectSection(section, dryRun, j, roundBatchLimit, finalRound) {
    var known = new Set(
      rows
        .map(function (r) {
          return text(r.id);
        })
        .filter(Boolean),
    );
    j.section = section;
    j.sectionCount = j.parallelManaged
      ? Math.max(Number(j.sectionCount || 0), sectionCount(section))
      : sectionCount(section);
    j.qualitySweepBatches = Number(j.qualitySweepBatches || 0);
    j.registrySweepBatches = Number(j.registrySweepBatches || 0);
    j.registryCursor = Number(j.registryCursor || 0);
    // Normal collection starts with content discovery. Registered creators are
    // supplemental metadata only and never gate progression into the section.
    j.registrySweepDone = true;
    j.registrySweepActive = false;
    var maxEmpty = sectionEmptyBatchLimit(section, j);
    var roundsStartingBatch = Number(j.batch || 0);
    var boundedRound = Number(roundBatchLimit || 0) > 0;
    while (
      !stopRequested &&
      j.sectionCount < j.target &&
      j.emptyBatches < maxEmpty &&
      (!boundedRound || Number(j.batch || 0) - roundsStartingBatch < roundBatchLimit)
    ) {
      j.qualitySweepActive = false;
      j.batch += 1;
      progress(j);
      var d = await collectOne(section, dryRun, j);
      maxEmpty = sectionEmptyBatchLimit(section, j);
      var previewNew = newIds(d, known);
      // Prefer verified new rows, not accepted records or existing-row upserts.
      var newly = !dryRun && d.verifiedInsertedLatestContent != null
        ? Math.max(0, Number(d.verifiedInsertedLatestContent) || 0)
        : (!dryRun && d.insertedLatestContent != null
          ? Math.max(0, Number(d.insertedLatestContent) || 0)
          : previewNew);
      j.newlyFound += newly;
      j.sectionCount += newly;
      if (newly) j.emptyBatches = 0;
      else j.emptyBatches += 1;
      progress(j);
      if (!dryRun && !j.parallelManaged) saveJob(j);
      if (dryRun) break;
      if (!stopRequested && j.sectionCount < j.target) await wait(650);
    }
    // Empty batches must not suppress the final native-provider rescue. In the
    // former implementation a zero-result section could never enter this phase.
    var lowYieldRescue = /^social-(?:tiktok|facebook|snapchat|bilibili|douyin)$/.test(section) &&
      (!boundedRound || !!finalRound);
    if (
      !dryRun &&
      !stopRequested &&
      (j.sectionCount >= j.target || lowYieldRescue) &&
      !j.qualitySweepDone
    ) {
      j.qualitySweepActive = true;
      j.qualitySweepTarget = Math.max(
        3,
        Number(j.qualitySweepTarget || 3),
      );
      // Quality rescue owns its own empty counter. The generic phase normally
      // ends precisely because emptyBatches reached maxEmpty; reusing that same
      // counter made the rescue loop execute zero times for the platforms that
      // needed it most (TikTok/Facebook/Bilibili/Douyin).
      j.qualityEmptyBatches = Number(j.qualityEmptyBatches || 0);
      for (
        var sweep = 0;
        sweep < j.qualitySweepTarget &&
        !stopRequested &&
        j.qualityEmptyBatches < Math.max(3, Math.min(8, maxEmpty));
        sweep++
      ) {
        j.batch += 1;
        j.qualitySweepBatches += 1;
        progress(j);
        var q = await collectOne(section, false, j),
          qualityPreview = newIds(q, known),
          qualityNew = q.verifiedInsertedLatestContent != null
            ? Math.max(0, Number(q.verifiedInsertedLatestContent) || 0)
            : (q.insertedLatestContent != null
              ? Math.max(0, Number(q.insertedLatestContent) || 0)
              : qualityPreview);
        maxEmpty = sectionEmptyBatchLimit(section, j);
        j.newlyFound += qualityNew;
        j.sectionCount += qualityNew;
        if (qualityNew) j.qualityEmptyBatches = 0;
        else j.qualityEmptyBatches += 1;
        progress(j);
        if (!j.parallelManaged) saveJob(j);
        if (sweep < j.qualitySweepTarget - 1 && !stopRequested)
          await wait(650);
      }
      j.qualitySweepDone = true;
      j.qualitySweepActive = false;
      if (!j.parallelManaged) saveJob(j);
    }
    return j.sectionCount;
  }
  function lockCollection(locked) {
    $("collectAllBtn").disabled = locked;
    $("collectSectionBtn").disabled = locked;
    $("collectDryRunBtn").disabled = locked;
    $("collectorStopBtn").disabled = !locked;
  }
  function newJob(section, index, total, runMode) {
    var batchSize = Math.max(
      8,
      Math.min(12, Number($("collectorBatchSize").value) || 10),
    );
    return {
      schemaVersion: COLLECTOR_JOB_VERSION,
      round: 0,
      totalRounds: FULL_RESEARCH_ROUNDS,
      runMode: runMode || "section",
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
      queryCursor: loadDiscoveryCursor(section),
      catalogSize: 15,
      discoveryCatalogSize: 12,
      sectionCount: sectionCount(section),
      searched: 0,
      direct: 0,
      accepted: 0,
      saved: 0,
      inserted: 0,
      updated: 0,
      verifiedInserted: 0,
      skipped: 0,
      newlyFound: 0,
      emptyBatches: 0,
      registryCursor: 0,
      registrySeedCount: 0,
      registrySweepBatches: 0,
      registrySweepTotal: 0,
      registrySweepDone: true,
      registrySweepActive: false,
      qualitySweepBatches: 0,
      qualityEmptyBatches: 0,
      qualitySweepTarget: (runMode === "all" ? 2 : (/^social-(?:tiktok|facebook|snapchat|bilibili|douyin)$/.test(section) ? 4 : 3)),
      qualitySweepDone: false,
      qualitySweepActive: false,
      lastReason: "",
      sectionFailures: [],
      paused: false,
    };
  }
  async function collectSelected(dry) {
    hide();
    stopRequested = false;
    liveReports = [];
    lockCollection(true);
    var key = $("collectorSection").value,
      j = newJob(key, 0, 1, "section");
    var failed = false;
    try {
      await collectSection(key, dry, j);
      j.done = 1;
      j.paused = stopRequested;
      if (!dry) saveJob(j);
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
      // Persist a safe, inspectable reason alongside the exact retry cursor.
      // Existing job JSON is never erased and no tokens or credentials are stored.
      j.lastError = Object.assign(collectorFailureRecord(e, key, "section_collect"), {
        queryCursor: Number(j.queryCursor || 0)
      });
      if (!dry) saveJob(j);
      showCollectorFailure(e, key, "section_collect");
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
    if (!skipConfirm && !confirm(
      "Social 5개 SNS를 동시에 검색합니다. 매 차례 각 SNS에서 약 10개씩 독립적으로 " +
      "수집·저장하고 결과를 확인한 뒤 다음 차례를 시작합니다 (최대 " + FULL_RESEARCH_ROUNDS +
      "차, 섹션당 후보 120개 목표). 외부 API 제한이 발생할 수 있으며 " +
      "기존 후보·관리자 보류/차단 기록은 보존합니다. 계속할까요?"
    )) return false;
    hide();
    stopRequested = false;
    liveReports = [];
    lockCollection(true);
    var saved = loadJob();
    var resume = !!(saved && saved.paused && saved.runMode === "all" &&
      Number(saved.schemaVersion) === COLLECTOR_JOB_VERSION &&
      Array.isArray(saved.completedInRound) && saved.sectionJobs &&
      Number(saved.round) >= 0 && Number(saved.round) < FULL_RESEARCH_ROUNDS);
    var j = resume ? saved : {
      schemaVersion: COLLECTOR_JOB_VERSION,
      runMode: "all",
      section: order[0],
      index: 0,
      round: 0,
      done: 0,
      total: order.length * FULL_RESEARCH_ROUNDS,
      totalRounds: FULL_RESEARCH_ROUNDS,
      completedInRound: [],
      sectionJobs: {},
      sectionFailures: [],
      paused: false,
    };
    j.completedInRound = Array.isArray(j.completedInRound) ? j.completedInRound : [];
    j.sectionFailures = Array.isArray(j.sectionFailures) ? j.sectionFailures : [];
    j.sectionJobs = j.sectionJobs || {};
    order.forEach(function (key, i) {
      if (!j.sectionJobs[key]) {
        j.sectionJobs[key] = newJob(key, i, j.total, "all");
        j.sectionJobs[key].queryCursor = loadDiscoveryCursor(key);
      }
      j.sectionJobs[key].parallelManaged = true;
      j.sectionJobs[key].target = 120;
      j.sectionJobs[key].batchSize = Math.max(8, Math.min(12, Number($("collectorBatchSize").value) || 10));
      j.sectionJobs[key].countryCode = selectedCountry();
      j.sectionJobs[key].scopeMode = scopeMode();
      j.sectionJobs[key].regionId = text($("collectorRegion").value);
      j.sectionJobs[key].languages = text($("collectorLanguages").value);
    });
    activeParallelCollectionJob = j;
    var fatalError = null;
    try {
      saveJob(j);
      renderParallelCollectionProgress();
      // Concurrency is bounded to seven: exactly one request per SNS in each
      // wave. No two requests for the same SNS can race their DB upserts or
      // saved query cursor. All workers settle before the next wave starts.
      for (; j.round < FULL_RESEARCH_ROUNDS && !stopRequested; ) {
        var roundNumber = j.round;
        var pending = order.filter(function (key) {
          return !j.completedInRound.includes(key);
        });
        var results = await Promise.allSettled(pending.map(async function (sectionKey) {
          var sectionJob = j.sectionJobs[sectionKey];
          sectionJob.round = roundNumber;
          // Reset the per-wave empty guard. Otherwise eight empty waves can
          // silently stop researching a low-yield SNS in subsequent waves.
          sectionJob.emptyBatches = 0;
          sectionJob.qualitySweepActive = false;
          // Fresh DB totals are read at wave boundaries, never shared between
          // parallel requests. Each section owns its cursor and counters.
          sectionJob.sectionCount = Math.max(sectionCount(sectionKey), Number(sectionJob.sectionCount || 0));
          if (sectionJob.sectionCount >= sectionJob.target) return { sectionKey: sectionKey, alreadyFull: true };
          await collectSection(sectionKey, false, sectionJob, 1, false);
          return { sectionKey: sectionKey, alreadyFull: false };
        }));
        results.forEach(function (result, index) {
          var key = pending[index];
          if (result.status === "rejected") {
            var err = result.reason;
            var failure = {
              round: roundNumber + 1,
              sectionKey: key,
              platform: label(key),
              message: text(err && err.message) || "section_collection_failed",
              status: Number(err && err.status) || null,
              at: new Date().toISOString(),
            };
            j.sectionFailures.push(failure);
            // Every rejected collect promise means that the requested search
            // or its candidate store did NOT complete. Do not silently advance
            // the cursor or mark the wave successful (even on HTTP 500/503).
            fatalError = fatalError || err;
            j.sectionJobs[key].lastError = Object.assign(
              collectorFailureRecord(err, key, "all_sections_collect"),
              { queryCursor: Number(j.sectionJobs[key].queryCursor || 0) }
            );
            return; // Resume the same failed query after fixing the cause.
          }
          // A failed search must remain pending on the next resume.
          if (result.status !== "rejected" && !j.completedInRound.includes(key))
            j.completedInRound.push(key);
        });
        j.done = roundNumber * order.length + j.completedInRound.length;
        renderParallelCollectionProgress();
        saveJob(j);
        if (stopRequested || fatalError) {
          if (fatalError) showCollectorFailure(fatalError, text(j.sectionFailures[j.sectionFailures.length - 1] && j.sectionFailures[j.sectionFailures.length - 1].sectionKey) || order[0], "all_sections_collect");
          break;
        }
        // Refresh counts only after all seven writes settle. Never let a
        // concurrent refresh overwrite another section's progress.
        try { await refresh(); } catch (_refreshError) {}
        order.forEach(function (key) {
          var sj = j.sectionJobs[key];
          sj.sectionCount = Math.max(Number(sj.sectionCount || 0), sectionCount(key));
        });
        j.round += 1;
        j.index = 0;
        j.completedInRound = [];
        saveJob(j);
        renderParallelCollectionProgress();
        if (j.round < FULL_RESEARCH_ROUNDS && !stopRequested) await wait(900);
      }
      j.paused = !!(stopRequested || fatalError || j.round < FULL_RESEARCH_ROUNDS);
      if (j.paused) {
        saveJob(j);
        show(fatalError
          ? "수집 또는 저장 오류로 병렬 검색을 중지했습니다. 실패한 검색 커서를 보존했습니다. " + collectionErrorState(fatalError) + " · " + text(fatalError.message)
          : "5개 SNS 동시 검색을 일시정지했습니다. 다시 누르면 완료되지 않은 단계부터 재개합니다.",
          fatalError ? "warn" : "ok");
      } else {
        clearJob();
        waitingViewMode = "new";
        openDetailQueue = "content";
        openDetailSection = order[0] || "";
        try { await refresh(); } catch (_refreshError) {}
        var perSection = order.map(function (key) {
          var sj = j.sectionJobs[key];
          return {
            sectionKey: key,
            platform: label(key),
            candidateCount: sj.sectionCount,
            searched: sj.searched,
            accepted: sj.accepted,
            inserted: sj.inserted,
            verifiedInserted: sj.verifiedInserted,
            updated: sj.updated,
            queryCursor: sj.queryCursor,
            batches: sj.batch,
          };
        });
        diagnostic({
          ok: true,
          reportType: "igdc-social-seven-section-parallel-waves-report",
          generatedAt: new Date().toISOString(),
          totalRounds: FULL_RESEARCH_ROUNDS,
          parallelSections: 7,
          completedStages: j.done,
          requestCount: perSection.reduce(function (sum, item) { return sum + Number(item.batches || 0); }, 0),
          failures: j.sectionFailures,
          sectionSummary: perSection,
          collectionBatches: liveReports.map(function (x) { return x.liveCollection || x; }),
        });
        show("5개 SNS 동시 수집 " + FULL_RESEARCH_ROUNDS + "차 완료. 실제 신규 저장 " +
          perSection.reduce(function (sum, item) { return sum + Number(item.verifiedInserted || 0); }, 0) +
          "건, 기존 갱신 " +
          perSection.reduce(function (sum, item) { return sum + Number(item.updated || 0); }, 0) +
          "건. SNS별 상세 결과는 수집 진행 JSON에서 확인할 수 있습니다." +
          (j.sectionFailures.length ? " 오류 " + j.sectionFailures.length + "건은 별도 기록했습니다." : ""),
          j.sectionFailures.length ? "warn" : "ok");
      }
    } catch (error) {
      fatalError = error;
      j.paused = true;
      saveJob(j);
      show("병렬 수집 중단: " + (error.message || "오류") + " · 현재 완료 상태를 보존했습니다.", "warn");
    } finally {
      activeParallelCollectionJob = null;
      lockCollection(false);
      stopRequested = false;
      $("collectorState").textContent = j.paused ? "일시정지됨" : "수집 대기";
    }
    return !j.paused && !fatalError;
  }
  function legacyFrontUnpublishHoldIds(sectionKey) {
    return rows
      .filter(function (row) {
        return (
          assetClass(row) === "latest_content" &&
          contentHold(row) &&
          text(row.reviewNote) === "actual_unpublish_to_content_hold" &&
          (!sectionKey || row.sectionKey === sectionKey)
        );
      })
      .map(function (row) { return text(row.id); })
      .filter(Boolean);
  }
  async function repairLegacyFrontUnpublishHolds(sectionKey) {
    var ids = legacyFrontUnpublishHoldIds(sectionKey);
    if (!ids.length) return 0;
    var result = await post(ACTION, {
      action: "approve",
      ids: ids,
      note: "restore_from_legacy_front_unpublish",
      confirmSocialSafe: true,
      countryCode: selectedCountry(),
      scopeMode: scopeMode(),
      regionId: text($("collectorRegion").value),
    });
    return Number(result.updated || 0);
  }
  function openContentSection(sectionKey) {
    // An explicit "show candidates" action must not silently inherit an
    // unrelated search/section/review filter from a previous admin operation.
    ["searchInput", "sectionFilter", "platformFilter", "riskFilter", "reviewFilter"].forEach(function (id) {
      if ($(id)) $(id).value = "";
    });
    waitingViewMode = "all";
    openDetailQueue = "content";
    var key = sectionKey;
    if (!key) {
      key = order.find(function (candidateKey) {
        return lastVisibleRows.some(function (row) {
          return row.sectionKey === candidateKey && assetClass(row) === "latest_content" && !contentHold(row);
        });
      }) || "";
    }
    openDetailSection = key || "";
    renderSections();
    var panel = $("waitingPanel");
    if (panel && typeof panel.scrollIntoView === "function") {
      setTimeout(function () { panel.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
    }
  }
  async function collectEmptySection(sectionKey) {
    var key = text(sectionKey);
    if (order.indexOf(key) < 0 || emptySectionCollectionBusy) return;
    emptySectionCollectionBusy = true;
    var original = text($("collectorSection") && $("collectorSection").value);
    try {
      if ($("collectorSection")) $("collectorSection").value = key;
      show(label(key) + " · 실제 공개 게시물 URL 검색과 후보 DB 저장을 실행합니다.", "warn");
      // Explicit administrator click: a small bounded real-write collection,
      // not a dry-run and not an influencer-registry sweep.
      var job = newJob(key, 0, 1, "section");
      stopRequested = false;
      liveReports = [];
      lockCollection(true);
      await collectSection(key, false, job, 2, true);
      var last = liveReports[liveReports.length - 1] || {};
      var lastLive = last.liveCollection || {};
      if (!(await refresh())) throw new Error("후보 DB 재조회에 실패했습니다.");
      openContentSection(key);
      var count = rows.filter(function (row) {
        return row.sectionKey === key && assetClass(row) === "latest_content" && !excluded(row);
      }).length;
      show(label(key) + " · 현재 원장 " + count + "건, 이번 실행 저장 응답 " + job.saved +
        "건, 수용 " + job.accepted + "건. " +
        (!count ? "후보 0건입니다. 수집 진행 JSON에서 실제 URL 수·제외 사유·Gateway 저장 결과를 확인해 주세요." : "아래 후보 목록을 펼쳐 확인하세요.") +
        (lastLive.gateway && lastLive.gateway.error ? " 저장 오류: " + text(lastLive.gateway.error) : ""), count ? "ok" : "warn");
    } catch (error) {
      if (job) {
        job.lastError = Object.assign(collectorFailureRecord(error, key, "empty_section_collect"), {queryCursor:Number(job.queryCursor || 0)});
        saveJob(job);
      }
      showCollectorFailure(error, key, "empty_section_collect");
    } finally {
      emptySectionCollectionBusy = false;
      lockCollection(false);
      if ($("collectorSection") && order.indexOf(original) >= 0) $("collectorSection").value = original;
    }
  }
  async function importSearchBank(sectionKey) {
    // This function also powers a per-section import action. A raw click Event
    // is NEVER a Social section key (the former onclick binding passed it here).
    var requested = typeof sectionKey === "string" ? text(sectionKey) : "";
    var activeKey = requested || text($("collectorSection") && $("collectorSection").value);
    if (order.indexOf(activeKey) < 0) {
      show("반입할 SNS 섹션을 먼저 선택해 주세요.", "warn");
      return null;
    }
    if (searchBankImportBusy) {
      show("SearchBank 실후보 반입이 이미 진행 중입니다.", "warn");
      return null;
    }
    searchBankImportBusy = true;
    var button = $("searchBankImportBtn");
    if (button) button.disabled = true;
    var before = rows.filter(function (r) {
      return r.sectionKey === activeKey && assetClass(r) === "latest_content";
    }).length;
    try {
      show(label(activeKey) + " · SearchBank 실콘텐츠 주소를 확인하고 있습니다.", "warn");
      // The snapshot can contain thousands of generic search results and zero
      // real social video URLs. Never misreport those as newly imported rows.
      // Do not auto-approve old held content as a side effect of a read/import.
      var d;
      try {
        d = await post(PIPELINE, {
          action: "import_searchbank", limit: 5000, sectionKey: activeKey
        });
      } catch (snapshotError) {
        // Missing static snapshot must not disable independent live discovery.
        // Never bypass a permission failure, and never call a failed DB write a success.
        var errorText = text(snapshotError && snapshotError.message);
        if (!/search_bank_snapshot_not_found|snapshot_not_found|\b404\b/i.test(errorText)) throw snapshotError;
        d = { accepted: 0, saved: 0, sourceMode: "static_snapshot_missing", note: errorText };
      }
      var direct = null;
      var directError = null;
      if (Number(d.accepted || 0) === 0) {
        // A static snapshot with zero genuine Social URLs cannot fill the DB.
        // On an explicit import click perform ONE real, bounded live discovery
        // for the selected SNS only. Repeated clicks advance that SNS cursor.
        // The collector uses the regular authorized Candidate Gateway write.
        show(label(activeKey) + " · SearchBank 스냅샷의 실콘텐츠 0건. 공개 SNS 실제 영상 검색으로 보강 중입니다.", "warn");
        try {
          // SearchBank import is a user-requested real write, NOT a dry-run.
          // Try up to two distinct query/provider cursors when the static
          // snapshot has no usable post URLs. Keep attempts bounded.
          var attempts = [];
          var baselineSessionKey = "igdc.social.importBaseline." + activeKey;
          var baselineSeen = false;
          try { baselineSeen = window.sessionStorage.getItem(baselineSessionKey) === "1"; } catch (_storageError) {}
          var initialImportBaseline = before === 0 && !baselineSeen &&
            /^(social-snapchat|social-bilibili|social-douyin)$/.test(activeKey);
          for (var attempt = 0; attempt < 2; attempt += 1) {
            var storedCursor = loadDiscoveryCursor(activeKey);
            var cursor = initialImportBaseline && attempt === 0 ? 0 : storedCursor;
            var one = await post(LIVE, {
              action: "collect_live", dryRun: false, contentFirst: true,
              registryOnly: false, registrySweepDone: true,
              sectionKey: activeKey, limit: 10, batchSize: 10,
              queryPasses: 1, queryCursor: cursor,
              countryCode: selectedCountry(), scopeMode: scopeMode(),
              regionId: text($("collectorRegion") && $("collectorRegion").value),
              languages: text($("collectorLanguages") && $("collectorLanguages").value)
            });
            attempts.push(one);
            var nextCursor = one.liveCollection && one.liveCollection.nextQueryCursor;
            var advanced = Number.isFinite(Number(nextCursor)) ? Number(nextCursor) : cursor + 1;
            saveDiscoveryCursor(activeKey, initialImportBaseline && attempt === 0
              ? Math.max(storedCursor + 1, advanced)
              : advanced);
            if (initialImportBaseline && attempt === 0) {
              try { window.sessionStorage.setItem(baselineSessionKey, "1"); } catch (_storageError) {}
            }
            if (Number(one.saved || 0) || Number(one.accepted || 0)) break;
          }
          direct = {
            accepted: attempts.reduce(function (sum, x) { return sum + Number(x.accepted || 0); }, 0),
            saved: attempts.reduce(function (sum, x) { return sum + Number(x.saved || 0); }, 0),
            attempts: attempts.length,
            gatewayReadbacks: attempts.map(function (x) { return x.liveCollection && x.liveCollection.gateway && x.liveCollection.gateway.readback || null; })
          };
        } catch (error) {
          directError = text(error && error.message) || "live_discovery_failed";
        }
      }
      var refreshed = await refresh();
      if (!refreshed) {
        show("반입 요청을 처리했으나 후보 DB 재조회에 실패했습니다. 저장 확인 전에는 성공으로 표시하지 않습니다.", "warn");
        return { snapshot: d, discovery: direct, refreshOk: false };
      }
      openContentSection(activeKey);
      var after = rows.filter(function (r) {
        return r.sectionKey === activeKey && assetClass(r) === "latest_content";
      }).length;
      var added = Math.max(0, after - before);
      var importSaved = Number(d.saved || 0);
      var liveSaved = Number(direct && direct.saved || 0);
      var accepted = Number(d.accepted || 0) + Number(direct && direct.accepted || 0);
      var message = label(activeKey) + " · SearchBank 승인 후보 " + Number(d.accepted || 0) +
        "개, 정적 반입 저장 응답 " + importSaved + "건" +
        (direct ? ", 실시간 발견 수용 " + Number(direct.accepted || 0) +
          "건 · 저장 응답 " + liveSaved + "건" : "") +
        ". 후보 DB 재조회 결과 " + before + " → " + after + "개 (신규 증가 " + added + "개).";
      if (directError) message += " 실시간 검색 오류: " + directError;
      if (!added && (importSaved || liveSaved)) message += " 저장 응답은 기존 후보의 갱신일 수 있습니다.";
      if (!accepted) message += " 실제 영상 URL이 발견되지 않았습니다. 검색 제공자 진단 JSON을 확인해야 합니다.";
      show(message, added ? "ok" : "warn");
      return { snapshot: d, discovery: direct, discoveredError: directError, before, after, added, refreshOk: true };
    } catch (e) {
      show((e && e.message) || "SearchBank 실후보 반입 실패", "warn");
      return null;
    } finally {
      searchBankImportBusy = false;
      if (button) button.disabled = false;
    }
  }
  async function intakeChannels(dryRun) {
    var raw = text($("channelIntakeText").value),
      state = $("channelIntakeState");
    var section = text($("collectorSection").value);
    if (!raw) {
      if (state) state.textContent = "입력할 실제 영상·게시물 URL이 없습니다. 이 버튼은 자동 검색 버튼이 아니라 URL 직접 반입용입니다.";
      show(
        "실제 영상·게시물 URL을 한 줄 이상 입력해야 합니다. 자동 검색은 위쪽 '선택 섹션 120개 후보 수집' 또는 'SearchBank 실후보 반입'을 사용하세요.",
        "warn",
      );
      return null;
    }
    state.textContent = dryRun
      ? "최신 콘텐츠 주소 점검 중"
      : "최신 콘텐츠 후보 반입 중";
    $("channelIntakeBtn").disabled = true;
    $("channelIntakeDryRunBtn").disabled = true;
    if ($("channelIntakeDiagnosticJsonBtn")) $("channelIntakeDiagnosticJsonBtn").disabled = true;
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
      if (!dryRun) {
        await refresh();
        openContentSection(section);
      }
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
      return d;
    } catch (e) {
      state.textContent = "반입 실패";
      show(e.message || "공개 URL 반입 실패", "warn");
      return null;
    } finally {
      $("channelIntakeBtn").disabled = false;
      $("channelIntakeDryRunBtn").disabled = false;
      if ($("channelIntakeDiagnosticJsonBtn")) $("channelIntakeDiagnosticJsonBtn").disabled = false;
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
      show(name + " 처리 요청 중 · " + ids.length + "건", "warn");
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
        if (action !== "promote_candidate") selectedContents.delete(text(id));
        selectedHoldContents.delete(text(id));
      });
      $("socialConfirm").checked = false;
      if (!(extra && extra.skipRefresh)) await refresh();
      if (action === "promote_candidate") openContentSection("");
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
    var target = sectionKey ? label(sectionKey) : "전체 5개 섹션",
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
    // Use the same content-only publication rule as the Social server.
    // Creator registry rows are supplemental and never occupy a public slot.
    if (!row || contentHold(row) || assetClass(row) !== "latest_content") return false;
    var platform = lower(row.platform).replace(/^social-/, "");
    var previewOptional = ["instagram", "tiktok", "facebook", "snapchat", "bilibili", "douyin"].indexOf(platform) >= 0;
    var thumbUrl = text(row.thumbnailUrl || row.thumbnail_url || (row.raw && (row.raw.thumbnailUrl || row.raw.thumbnail_url)));
    var hasRealThumb = /^https:\/\//i.test(thumbUrl) &&
      !/placeholder|\/assets\/sample\//i.test(thumbUrl) &&
      !genericProviderPreviewThumb(platform, thumbUrl);
    // promotable comes from SocialStore.isApprovedForSnapshot on the server.
    // The publisher accepts validated latest-content posts without a preview
    // for these six platforms; do not block them in the browser first.
    if (typeof row.promotable === "boolean")
      return row.promotable === true && (hasRealThumb || previewOptional);
    var baseOk = text(row.reviewStatus || row.review_status).toLowerCase() === "approved" &&
      /^(approved_for_snapshot|verified|approved)$/i.test(text(row.verificationStatus || row.verification_status)) &&
      row.candidateOnly === false && row.seedContent !== true &&
      row.publicAccess === true && row.loginRequired !== true &&
      text(row.riskLevel || row.risk_level).toLowerCase() !== "blocked";
    return baseOk && /^https:\/\//i.test(text(row.latestContentUrl || row.sourceUrl)) &&
      (hasRealThumb || previewOptional);
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

  // Front publication must never be blocked by a malformed candidate.
  // Keep the selection count where possible by replacing an ineligible item
  // with the next eligible candidate from the same SNS section.
  function autoCompletePublishSelection(selectedIds, sectionKey) {
    var sourceIds = Array.from(new Set((selectedIds || []).map(text).filter(Boolean)));
    var selectedSet = new Set(sourceIds);
    var finalIds = [];
    var skipped = [];
    var replacements = [];
    var shortfall = 0;

    var selectedRows = sourceIds
      .map(function (id) {
        return rows.find(function (row) { return text(row && row.id) === id; }) || null;
      })
      .filter(Boolean)
      .filter(function (row) { return !sectionKey || row.sectionKey === sectionKey; });

    var sectionKeys = Array.from(new Set(selectedRows.map(function (row) { return row.sectionKey; }).filter(Boolean)));
    sectionKeys.forEach(function (key) {
      var sectionSelected = selectedRows.filter(function (row) { return row.sectionKey === key; });
      var valid = sectionSelected.filter(candidateRegistered);
      var invalid = sectionSelected.filter(function (row) { return !candidateRegistered(row); });
      valid.forEach(function (row) {
        var id = text(row && row.id);
        if (id && finalIds.indexOf(id) < 0) finalIds.push(id);
      });
      invalid.forEach(function (row) { skipped.push(text(row && row.id)); });

      if (!invalid.length) return;
      var fallback = rows
        .filter(function (row) {
          var id = text(row && row.id);
          return (
            row &&
            row.sectionKey === key &&
            candidateRegistered(row) &&
            id &&
            !selectedSet.has(id) &&
            finalIds.indexOf(id) < 0
          );
        })
        .sort(function (a, b) {
          var aPublished = publishedContentIds.has(text(a && a.id)) ? 1 : 0;
          var bPublished = publishedContentIds.has(text(b && b.id)) ? 1 : 0;
          if (aPublished !== bPublished) return aPublished - bPublished;
          var scoreDiff = score(b) - score(a);
          if (scoreDiff) return scoreDiff;
          return text(b.updatedAt || b.reviewedAt || b.createdAt).localeCompare(
            text(a.updatedAt || a.reviewedAt || a.createdAt),
          );
        });

      invalid.forEach(function (_row, index) {
        var replacement = fallback[index];
        if (!replacement) {
          shortfall += 1;
          return;
        }
        var replacementId = text(replacement.id);
        if (replacementId && finalIds.indexOf(replacementId) < 0) {
          finalIds.push(replacementId);
          replacements.push({ sectionKey: key, id: replacementId });
        }
      });
    });

    // Keep the UI selection synchronized with what is actually sent.
    skipped.forEach(function (id) { selectedContents.delete(id); });
    replacements.forEach(function (item) { selectedContents.add(item.id); });

    return {
      ids: finalIds,
      skipped: skipped,
      replacements: replacements,
      shortfall: shortfall,
    };
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
    var requestedKeys = order.filter(function (key) {
      return rows.some(function (row) {
        return row && row.sectionKey === key && selectedContents.has(text(row.id));
      });
    });
    if (!(await prepareFrontPublication(requestedKeys))) return false;
    selectedIds = Array.from(selectedContents);

    var completed = autoCompletePublishSelection(selectedIds, "");
    var registeredIds = completed.ids;
    if (!registeredIds.length) {
      return show(
        "선택한 콘텐츠 중 SearchBank 인계 가능한 후보가 없습니다. 실제 썸네일·공개 상태·승인 상태를 확인해 주세요.",
        "warn",
      );
    }
    if (completed.skipped.length > 0) {
      show(
        "조건 미충족 후보 " + completed.skipped.length + "개는 자동 제외했고, 같은 SNS의 정상 후보 " +
          completed.replacements.length + "개로 자동 보충했습니다" +
          (completed.shortfall ? " (보충할 후보가 없는 " + completed.shortfall + "개는 빈자리로 두고 계속 진행)" : "") +
          ".",
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

    return actualApply("", true, registeredIds, "selected_content_front_publish", keys);
  }

  async function hydrateFrontPublicationPreviews(sectionKeys) {
    var allowed = Array.isArray(sectionKeys) && sectionKeys.length ? new Set(sectionKeys) : null;
    var ids = rows.filter(function (row) {
      if(!row || (allowed && !allowed.has(row.sectionKey))) return false;
      var cls=assetClass(row);
      // Latest-content thumbnails are a hard publication requirement. Sparse
      // influencer/profile fallbacks have a labelled server-generated card when
      // provider metadata has no image, so do not block the whole publish while
      // hydrating dozens of profiles.
      return cls === "latest_content" && realPreviewMissing(row);
    }).map(function (row) { return text(row.id); }).filter(Boolean);
    ids = Array.from(new Set(ids));
    if (!ids.length) return 0;
    var updated = 0, chunkSize = 12;
    for (var offset = 0; offset < ids.length; offset += chunkSize) {
      var batch = ids.slice(offset, offset + chunkSize);
      try {
        var result = await post(ACTION, { action: "hydrate_preview", ids: batch });
        mergeHydratedRows(result.items || []);
        updated += Number(result.updated || 0);
      } catch (_error) {
        // A single provider batch may fail while the rest remain usable.
        // Continue so one SNS cannot block all other sections.
      }
    }
    return updated;
  }
  // Publication is not research. Explicitly run a fresh public-content search
  // before curation, even when a section already has 120 candidates. A full
  // candidate pool must never block discovery of newly uploaded TikTok videos.
  // The final publish button is not itself a collector. Perform bounded,
  // independent *live* discovery first. An unsuccessful search must never
  // delete already-published videos or silently claim they were refreshed.
  async function refreshLiveCandidatesForPublish(sectionKeys) {
    var target = Array.from(new Set((sectionKeys || []).filter(function (key) {
      return order.indexOf(key) >= 0;
    })));
    var report = { at: new Date().toISOString(), sections: {}, failed: [] };
    // No influencer registry seeds: real content discovery comes first.
    // Two independent TikTok policy searches help overcome a stale first page.
    // Other SNS get one bounded batch to avoid overwhelming Netlify functions.
    await Promise.all(target.map(async function (key) {
      var passes = key === "social-tiktok" ? [0, 1] : [0];
      var state = { ok: true, requests: 0, searched: 0, submitted: 0, saved: 0, failures: [] };
      for (var i = 0; i < passes.length; i++) {
        try {
          var response = await post(LIVE, {
            action: "collect_live", dryRun: false,
            sectionKey: key, contentFirst: true, registryOnly: false,
            registrySweepDone: true, qualitySweep: true,
            queryPasses: 1, queryCursor: passes[i],
            batchSize: 10, limit: 10,
            countryCode: selectedCountry(), scopeMode: scopeMode(),
            regionId: text($("collectorRegion") && $("collectorRegion").value),
            languages: text($("collectorLanguages") && $("collectorLanguages").value)
          });
          var live = response && response.liveCollection || {};
          var gateway = live.gateway || {};
          if (response.ok !== true || gateway.ok !== true) {
            var problem = new Error(text(response.message || response.error || gateway.message || gateway.error || "후보 DB 저장 응답 실패"));
            problem.status = Number(gateway.statusCode || 0) || null;
            problem.stage = "candidate_storage";
            throw problem;
          }
          state.requests++;
          state.searched += Number(live.searchedRows || 0);
          state.submitted += Number(live.submittedCandidates || 0);
          state.saved += Number(gateway.saved || 0);
        } catch (error) {
          state.ok = false;
          state.failures.push(collectorFailureRecord(error, key, "pre_publish_live_search"));
          break;
        }
      }
      report.sections[key] = state;
      if (!state.ok) report.failed.push(key);
    }));
    // Keep this report in the administrator diagnostics rather than adding
    // new files or overwriting the normal full research resume cursor.
    diagnostic({ ok: report.failed.length === 0, reportType: "social-pre-publish-live-refresh", report: report });
    var tiktok = report.sections["social-tiktok"];
    if (tiktok && !tiktok.ok) {
      show("TikTok 최신 리서치 또는 DB 저장 실패: 기존 프론트 영상을 유지하고 게시를 중단합니다. 수집 단계 오류를 관리자 진단에서 확인하세요.", "warn");
      return false;
    }
    var saved = target.reduce(function (sum, key) { return sum + Number((report.sections[key] || {}).saved || 0); }, 0);
    show("최신 영상 검색·저장 점검 완료: DB 저장 " + saved + "개" +
      (report.failed.length ? "; 실패 " + report.failed.map(label).join(", ") + "(기존 영상은 유지)" : "") +
      (saved === 0 ? ". 신규 후보가 없으므로 기존 정상 영상을 유지합니다." : ". 신규 후보를 재평가합니다."), "warn");
    return true;
  }
  async function prepareFrontPublication(sectionKeys) {
    var keys = Array.isArray(sectionKeys) && sectionKeys.length ? sectionKeys.slice() : order.slice();
    show(keys.map(label).join(", ") + " 최신 공개 콘텐츠를 먼저 재검색하고 있습니다.", "warn");
    if (!(await refreshLiveCandidatesForPublish(keys))) return false;
    show(keys.map(label).join(", ") + " 실제 콘텐츠 썸네일을 최종 점검하고 있습니다.", "warn");
    await hydrateFrontPublicationPreviews(keys);
    // Pull back server-side preview repairs before AI registration. This makes
    // front publication deterministic instead of racing the background preview
    // hydrator that runs after refresh().
    await refresh();
    var oneSection = keys.length === 1 ? keys[0] : "";
    var curated = await autoCurate(oneSection, true);
    if (!curated) return false;
    return true;
  }

  async function actualApplyAllRegistered(skipConfirm, publishMode) {
    var repaired = await repairLegacyFrontUnpublishHolds("");
    if (repaired) await refresh();
    if (!(await prepareFrontPublication(order.slice()))) return false;
    var ids = registeredContentIds("");
    if (!ids.length)
      return show("SearchBank 인계 가능한 최신 콘텐츠 후보가 없습니다.", "warn");
    // Full-section publication is server-authoritative. The browser list is only
    // an operator view and may be capped/stale, so never freeze publication to
    // the currently rendered IDs. The server re-reads the latest approved rows
    // plus approved sparse-section influencer/profile fallbacks.
    return actualApply(
      "",
      skipConfirm === true,
      null,
      publishMode || "all_sections_front_publish",
      order.slice(),
    );
  }

  async function actualApplySelectedFrontSections() {
    var keys = selectedFrontSectionKeys();
    if (!keys.length) return show("프론트 등록할 SNS 섹션을 먼저 선택해 주세요.", "warn");
    var repaired = 0;
    for (var repairIndex = 0; repairIndex < keys.length; repairIndex++) {
      repaired += await repairLegacyFrontUnpublishHolds(keys[repairIndex]);
    }
    if (repaired) await refresh();
    if (!(await prepareFrontPublication(keys))) return false;
    var ids = [];
    keys.forEach(function (key) { ids = ids.concat(registeredContentIds(key)); });
    ids = Array.from(new Set(ids));
    if (!ids.length) return show("선택한 SNS 섹션에 SearchBank 인계 가능한 후보가 없습니다.", "warn");
    if (!confirm(keys.map(label).join(", ") + " 섹션의 현재 정상 후보를 서버 최신 상태 기준으로 프론트 등록할까요?")) return false;
    return actualApply("", true, null, "selected_sections_front_publish", keys);
  }

  async function actualUnapplySelectedFrontSections() {
    var keys = selectedFrontSectionKeys();
    if (!keys.length) return show("프론트 등록 해제할 SNS 섹션을 먼저 선택해 주세요.", "warn");
    try {
      var durable = await durablePublishedState(),
        bySection = durable && durable.publishedIdsBySection || {},
        ids = [];
      keys.forEach(function (key) {
        ids = ids.concat(Array.isArray(bySection[key]) ? bySection[key] : []);
      });
      ids = Array.from(new Set(ids.map(text).filter(Boolean)));
      if (!ids.length) return show(keys.map(label).join(", ") + "에 현재 실제 적용된 콘텐츠가 없습니다.", "warn");
      return actualUnapplyIds(ids, "", keys.map(label).join(", ") + " 선택 섹션");
    } catch (e) {
      show(e.message || "선택 섹션의 현재 실제 적용 목록을 읽지 못했습니다.", "warn");
      return false;
    }
  }

  async function actualApplySection(sectionKey, skipConfirm) {
    var repaired = await repairLegacyFrontUnpublishHolds(sectionKey);
    if (repaired) await refresh();
    if (!(await prepareFrontPublication([sectionKey]))) return false;
    var selectedInSectionAll = Array.from(selectedContents).filter(function (id) {
      return rows.some(function (row) {
        return text(row && row.id) === id && row.sectionKey === sectionKey;
      });
    });
    if (selectedInSectionAll.length) {
      var completed = autoCompletePublishSelection(selectedInSectionAll, sectionKey);
      var selectedInSection = completed.ids;
      if (!selectedInSection.length) {
        show(
          label(sectionKey) +
            "에서 SearchBank 인계 가능한 정상 후보를 찾지 못했습니다.",
          "warn",
        );
        return false;
      }
      if (completed.skipped.length) {
        show(
          label(sectionKey) +
            "의 조건 미충족 후보 " + completed.skipped.length + "개는 자동 제외하고 정상 후보 " +
            completed.replacements.length + "개로 자동 보충했습니다" +
            (completed.shortfall ? " (" + completed.shortfall + "개는 대체 후보 부족)" : "") +
            ".",
          "warn",
        );
      }
      return actualApply(sectionKey, skipConfirm, selectedInSection, "single_section_front_publish", [sectionKey]);
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
    return actualApply(sectionKey, skipConfirm, null, "single_section_front_publish", [sectionKey]);
  }

  function publishResultFileName(mode) {
    var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    var names = {
      social_full_run: "igdc-social-full-run-result-",
      selected_sections_front_publish: "igdc-social-selected-sections-front-publish-result-",
      all_sections_front_publish: "igdc-social-all-sections-front-publish-result-",
      selected_content_front_publish: "igdc-social-selected-content-front-publish-result-",
      single_section_front_publish: "igdc-social-single-section-front-publish-result-",
    };
    return (names[mode] || "igdc-social-front-publish-result-") + stamp + ".json";
  }

  async function actualApply(sectionKey, skipConfirm, exactIds, publishMode, requestedSections) {
    var target = sectionKey ? label(sectionKey) : "전체 5개 섹션",
      scope = currentScope(),
      scopeName =
        (scope.country &&
          (scope.country.nameKo ||
            scope.country.nameEn ||
            scope.country.code)) ||
        "전 세계 공통",
      requestedIds = Array.isArray(exactIds)
        ? Array.from(new Set(exactIds.map(text).filter(Boolean)))
        : [],
      actionMode = text(publishMode) ||
        (sectionKey ? "single_section_front_publish" : "all_sections_front_publish"),
      actionSections = Array.from(new Set(
        (Array.isArray(requestedSections) && requestedSections.length
          ? requestedSections
          : sectionKey
            ? [sectionKey]
            : order.slice())
          .map(text)
          .filter(function (key) { return order.indexOf(key) >= 0; })
      ));

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
        publishMode: actionMode,
        requestedSections: actionSections,
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
      var runtimeDirect = d.runtimeFrontReady === true && d.releaseStoredVerified === true;
      var buildAccepted = !!(d.buildTrigger && d.buildTrigger.ok);
      if (!runtimeDirect && !buildAccepted)
        throw new Error(
          "실제 적용 후보는 확인됐지만 저장 Release 또는 배포 경로가 준비되지 않았습니다.",
        );

      download(publishResultFileName(actionMode), d);
      diagnostic(d);

      var verify = null;
      if (runtimeDirect && d.releaseId) {
        // Read back the exact publication scope. Without these parameters a
        // GLOBAL publish is verified against the visitor's country-specific
        // release (when it exists), resulting in a false mismatch.
        var verifyParams = new URLSearchParams({
          view: "front",
          scopeMode: scope.scopeMode || "auto",
          countryCode: scope.countryCode || "",
          regionId: scope.regionId || "",
          _: String(Date.now()),
        });
        for (var verifyTry = 0; verifyTry < 4; verifyTry++) {
          try {
            verify = await getReport(CURRENT_SOCIAL + "?" + verifyParams.toString());
            if (verify && verify.ok && text(verify.releaseId) === text(d.releaseId) && verify.hashVerified === true) break;
          } catch (_verifyError) {}
          await new Promise(function (resolve) { setTimeout(resolve, 450); });
        }
        diagnostic({ actualApply: d, runtimeFront: verify });
        if (!verify || !verify.ok || text(verify.releaseId) !== text(d.releaseId) || verify.hashVerified !== true) {
          throw new Error("승인 Release는 저장됐지만 지정한 게시 범위의 프론트 조회에서 동일한 Release·해시를 확인하지 못했습니다. 대상 국가와 게시 범위를 확인해 주세요.");
        }
      } else {
        var verifyQ = new URLSearchParams({
          action: "pipeline_diagnostic",
          countryCode: scope.countryCode,
          scopeMode: scopeMode(),
          regionId: text($("collectorRegion").value),
        });
        verify = await getReport(PUBLISH + "?" + verifyQ.toString());
        diagnostic({ actualApply: d, searchBankHandoff: verify });
      }

      if ($("frontApplyState"))
        $("frontApplyState").textContent = d.noChange === true
          ? "변경 없음"
          : runtimeDirect
            ? "승인본 저장 · 프론트 즉시 적용"
            : buildAccepted
              ? "승인본 저장 · 정적 빌드 접수"
              : "적용 대기";

      if (d.noChange === true) {
        show(scopeName + " 범위의 " + applyLabel + " 결과가 마지막 정상 게시본과 동일합니다.", "ok");
      } else if (runtimeDirect) {
        show(
          scopeName + " 범위의 " + applyLabel +
          " 승인본을 저장했고 프론트가 같은 Release를 직접 읽는 것까지 확인했습니다. 콘텐츠 변경만으로는 Netlify 재배포가 필요하지 않습니다.",
          "ok",
        );
      } else if (buildAccepted) {
        show(scopeName + " 범위의 " + applyLabel + " 정적 반영 빌드를 접수했습니다.", "ok");
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
    var durable = await durablePublishedState(),
      bySection = durable && durable.publishedIdsBySection || {},
      keys = sectionKey ? [sectionKey] : order,
      ids = [];
    keys.forEach(function (key) {
      ids = ids.concat(Array.isArray(bySection[key]) ? bySection[key] : []);
    });
    return Array.from(new Set(ids.map(text).filter(Boolean)));
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
        "전 세계 공통";
    if (!ids.length) {
      show("실제 적용을 취소할 최신 콘텐츠를 먼저 선택해 주세요.", "warn");
      return;
    }
    if (
      !confirm(
        scopeName +
          " 범위의 " +
          target +
          "에서 " +
          ids.length +
          "개 콘텐츠를 프론트에서만 내릴까요? 후보 등록·승인 상태는 그대로 유지되므로 나중에 다시 즉시 등록할 수 있습니다.",
      )
    )
      return;
    try {
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
            "개는 프론트 등록만 해제했고 후보 목록·승인 상태는 유지했습니다. 배포 완료 후 프론트에서만 내려갑니다.",
          "ok",
        );
      } else {
        show(
          "프론트 등록 해제본은 저장됐지만 정식 배포가 시작되지 않았습니다. 후보 목록·승인 상태는 변경하지 않았습니다.",
          "warn",
        );
      }
    } catch (e) {
      show(e.message || "선택 콘텐츠 프론트 등록 해제를 완료하지 못했습니다.", "warn");
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
      : "전체 5개 섹션";
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
      '<button id="aiSelectAllSectionsBtn" class="secondary" type="button">5개 전체 선택</button>' +
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
    if (!skipConfirm && !confirm(keys.map(label).join(", ") + " 섹션의 최신 콘텐츠 수집 → AI 평가 → 공개/예비 후보 재정리를 실행할까요? 한 SNS 검색 오류는 기록하고 다음 SNS를 계속 진행합니다.")) return false;
    var statusEl = $("aiAutomationState"), oldCollector = $("collectorSection").value,
      collectionFailures = [], collectedKeys = [], curatedKeys = [], curateFailures = [];
    liveReports = [];
    try {
      stopRequested = false;
      lockCollection(true);
      for (var i = 0; i < keys.length && !stopRequested; i++) {
        var key = keys[i], j = newJob(key, i, keys.length, "ai");
        if (statusEl) statusEl.textContent = "수집 " + (i + 1) + "/" + keys.length + " · " + label(key);
        try {
          await collectSection(key, false, j);
          collectedKeys.push(key);
        } catch (sectionError) {
          j.lastError = Object.assign(collectorFailureRecord(sectionError, key, "ai_collect"), {queryCursor:Number(j.queryCursor || 0)});
          saveJob(j);
          showCollectorFailure(sectionError, key, "ai_collect");
          if (fatalCollectionError(sectionError)) throw sectionError;
          collectionFailures.push({
            sectionKey: key,
            platform: label(key),
            message: text(sectionError && sectionError.message) || "section_collection_failed",
          });
          if (statusEl) statusEl.textContent = "검색 오류 기록 · 다음 SNS 진행 · " + label(key);
        }
        j.done = i + 1;
        j.sectionFailures = collectionFailures.slice();
        saveJob(j);
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = "수집 중단 · " + collectionErrorState(e);
      showCollectorFailure(e, keys[collectionFailures.length] || keys[0], "ai_collect");
      return false;
    } finally {
      lockCollection(false);
      stopRequested = false;
      $("collectorSection").value = oldCollector;
    }
    if (!collectedKeys.length) {
      if (statusEl) statusEl.textContent = "수집 실패 · 저장 성공 섹션 0개";
      show("모든 선택 SNS의 수집이 실패했습니다. AI 정리와 프론트 게시를 실행하지 않았습니다. 관리자 진단 JSON에서 HTTP 상태와 실패 단계를 확인하세요.", "warn");
      return false;
    }
    try {
      for (var n = 0; n < keys.length; n++) {
        var curateKey = keys[n];
        if (collectedKeys.indexOf(curateKey) < 0) continue; // Never curate/publish a failed collection.
        if (statusEl) statusEl.textContent = "AI 정리 " + (n + 1) + "/" + keys.length + " · " + label(curateKey);
        try {
          var curated = await autoCurate(curateKey, true);
          if (!curated) throw new Error(label(curateKey) + " AI 후보 정리를 완료하지 못했습니다.");
          curatedKeys.push(curateKey);
        } catch (curateError) {
          curateFailures.push({ sectionKey: curateKey, platform: label(curateKey), message: text(curateError && curateError.message) || "ai_curate_failed" });
          if (fatalCollectionError(curateError)) throw curateError;
        }
      }
      waitingViewMode = "all";
      openDetailQueue = "content";
      openDetailSection = (curatedKeys[0] || keys[0] || "");
      await refresh();
      if ($("aiAutomationApply") && $("aiAutomationApply").checked && curatedKeys.length) {
        if (statusEl) statusEl.textContent = "프론트 실제 적용 중 · 단일 배포";
        var applyIds = [];
        curatedKeys.forEach(function (key) { applyIds = applyIds.concat(registeredContentIds(key)); });
        applyIds = Array.from(new Set(applyIds.map(text).filter(Boolean)));
        if (applyIds.length) {
          var autoMode = curatedKeys.length === order.length
            ? "social_full_run"
            : curatedKeys.length === 1
              ? "single_section_front_publish"
              : "selected_sections_front_publish";
          var applied = await actualApply(curatedKeys.length === 1 ? curatedKeys[0] : "", true, null, autoMode, curatedKeys);
          if (!applied) throw new Error("AI 자동 운영 프론트 실제 적용을 완료하지 못했습니다.");
        }
      }
      clearJob();
      var issueCount = collectionFailures.length + curateFailures.length;
      if (statusEl) statusEl.textContent = issueCount
        ? "완료 · " + keys.length + "개 SNS · 오류 기록 " + issueCount + "건"
        : "완료 · " + keys.length + "개 SNS";
      show(
        keys.map(label).join(", ") + " AI 자동 운영을 끝까지 진행했습니다." +
          (issueCount ? " 개별 SNS 오류 " + issueCount + "건은 건너뛰고 다음 SNS를 계속 처리했습니다." : ""),
        issueCount ? "warn" : "ok",
      );
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
    // Preserve the native browser Back history when opening the real SNS post.
    // location.replace previously discarded the return route.
    window.location.assign(safeUrl);
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
      var sectionCollect = event.target.closest("[data-section-collect]");
      if (sectionCollect) { collectEmptySection(sectionCollect.dataset.sectionCollect); return; }
      var sectionDiagnosticButton = event.target.closest("[data-section-diagnostic]");
      if (sectionDiagnosticButton) { downloadSectionDiagnostic(sectionDiagnosticButton.dataset.sectionDiagnostic); return; }
      var emptyCollect = event.target.closest("[data-empty-collect]");
      if (emptyCollect) {
        collectEmptySection(emptyCollect.dataset.emptyCollect);
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
      if (event.target.closest("[data-reddit-intake]")) { importRedditUrls(); return; }
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
      else if ((key = event.target.dataset.sectionImportContent))
        importSearchBank(key);
      else if ((key = event.target.dataset.sectionOpenContent))
        openContentSection(key);
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
      if (event.target.matches(".registrySectionCheck")) {
        var registryKey = text(event.target.dataset.registrySection);
        if (order.indexOf(registryKey) >= 0) selectQueue("registry", registryKey, event.target.checked);
        return;
      }
      if (event.target.matches(".frontSectionCheck")) {
        var frontKey = text(event.target.dataset.frontSection);
        if (order.indexOf(frontKey) >= 0) {
          if (event.target.checked) selectedFrontSections.add(frontKey);
          else selectedFrontSections.delete(frontKey);
          updateFrontSectionSelectionState();
        }
        return;
      }
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
      var candidateReport = null, latestReport = null, pipelineReport = null, runtimeFront = null, snapshot = null, researchReadiness = null;
      try { researchReadiness = await getReport(LIVE + "?_=" + Date.now()); } catch (e) { researchReadiness = { ok:false, error:e.message || String(e) }; }
      try { candidateReport = await getReport(REVIEW + "?action=diagnostic&" + params.toString()); } catch (e) { candidateReport = { ok:false, error:e.message || String(e) }; }
      try { latestReport = await getReport(REVIEW + "?action=latest_content_diagnostic&" + params.toString()); } catch (e) { latestReport = { ok:false, error:e.message || String(e) }; }
      try { pipelineReport = await getReport(PUBLISH + "?action=pipeline_diagnostic&" + params.toString()); } catch (e) { pipelineReport = { ok:false, error:e.message || String(e) }; }
      try { runtimeFront = await getReport(CURRENT_SOCIAL + "?view=front&_=" + Date.now()); } catch (e) { runtimeFront = { ok:false, error:e.message || String(e) }; }
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
        ok: !!(candidateReport && candidateReport.ok !== false && runtimeFront && runtimeFront.ok === true && runtimeFront.hashVerified !== false),
        reportType: "igdc-social-full-system-diagnostic",
        generatedAt: new Date().toISOString(),
        scope: currentScope(),
        checks: {
          researchAuthorityAndProviders: researchReadiness,
          candidateResearchAndRegistry: candidateReport,
          latestContentQueue: latestReport,
          candidateState: { total: contentRows.length, approved: approvedRows.length, bySection: bySection },
          runtimeStoredReleaseFront: runtimeFront,
          staticSearchBankHandoffAdvisory: pipelineReport,
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
        runtimeFrontRelease: runtimeFront && runtimeFront.releaseId || null,
        runtimeFrontHashVerified: !!(runtimeFront && runtimeFront.hashVerified),
        staticSearchBankHandoffAdvisory: pipelineReport && pipelineReport.pipeline ? pipelineReport.pipeline.searchBankSnapshotHandoff : "unknown",
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

  function localDiagnosticRows(kind) {
    var list = rows.slice();
    if (kind === "registry_diagnostic") list = list.filter(function (row) { return assetClass(row) === "influencer_registry"; });
    else if (kind === "latest_content_diagnostic" || kind === "latest_content_rows_diagnostic") list = list.filter(function (row) { return assetClass(row) === "latest_content" && !excluded(row); });
    else if (kind === "hold_diagnostic") list = list.filter(contentHold);
    else if (kind === "exclusion_diagnostic") list = list.filter(excluded);
    return list.map(contentDiagnosticRow);
  }
  function fallbackDiagnostic(action, error) {
    var local = localDiagnosticRows(action);
    return {
      ok: false,
      reportType: "igdc-social-local-fallback-diagnostic",
      requestedAction: action,
      generatedAt: new Date().toISOString(),
      scope: currentScope(),
      remoteError: {
        message: text(error && error.message) || "remote_diagnostic_unavailable",
        status: Number(error && error.status || 0) || null,
      },
      localStateAvailable: true,
      localRowCount: local.length,
      localRows: local,
      note: "원격 점검 API가 실패해도 버튼이 무반응으로 끝나지 않도록 현재 브라우저가 보유한 Social 후보 상태를 함께 내보냅니다. 원격 오류는 remoteError에서 확인하십시오.",
    };
  }
  async function runQueueDiagnostic(action, successMessage, downloadName) {
    var d = null, remoteError = null;
    try {
      var q = new URLSearchParams({
        action: action,
        countryCode: selectedCountry(),
        scopeMode: scopeMode(),
        regionId: text($("collectorRegion").value),
      });
      d = await getReport(REVIEW + "?" + q.toString());
    } catch (e) {
      remoteError = e;
      d = fallbackDiagnostic(action, e);
    }
    diagnostic(d);
    toggleDiagnosticPanel(true);
    if (downloadName) download(downloadName, d);
    show(
      remoteError
        ? "원격 점검 API가 실패하여 현재 브라우저 상태와 오류를 JSON으로 다운로드했습니다."
        : successMessage + (downloadName ? " · 다운로드 완료" : ""),
      remoteError || d.ok === false ? "warn" : "ok",
    );
    return d;
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
      $("publishAllBtn").onclick = function () {
        return actualApplyAllRegistered(false, "all_sections_front_publish");
      };
    }
    if ($("publishSelectedSectionsBtn")) {
      $("publishSelectedSectionsBtn").onclick = actualApplySelectedSections;
    }
    if ($("socialFullRunBtn")) $("socialFullRunBtn").onclick = function () {
      return actualApplyAllRegistered(false, "social_full_run");
    };
    if ($("socialFullCancelBtn")) $("socialFullCancelBtn").onclick = function () { return actualUnapplyAll(""); };
    if ($("selectAllFrontSectionsBtn")) $("selectAllFrontSectionsBtn").onclick = function () { setFrontSectionSelection(order, true); };
    if ($("clearFrontSectionsBtn")) $("clearFrontSectionsBtn").onclick = function () { setFrontSectionSelection(order, false); };
    if ($("publishSelectedFrontSectionsBtn")) $("publishSelectedFrontSectionsBtn").onclick = actualApplySelectedFrontSections;
    if ($("unpublishSelectedFrontSectionsBtn")) $("unpublishSelectedFrontSectionsBtn").onclick = actualUnapplySelectedFrontSections;
    updateFrontSectionSelectionState();

    $("refreshBtn").onclick = refresh;
    if ($("systemAuditBtn")) $("systemAuditBtn").onclick = runFullSystemDiagnostic;
    if ($("systemAuditDownloadBtn")) $("systemAuditDownloadBtn").onclick = async function () {
      if (!systemAuditCache) {
        show("전체 시스템 점검을 먼저 실행한 뒤 JSON을 자동 다운로드합니다.", "warn");
        systemAuditCache = await runFullSystemDiagnostic();
      }
      if (!systemAuditCache) {
        var fallback = fallbackDiagnostic("full_system_diagnostic", new Error("full_system_diagnostic_failed"));
        diagnostic(fallback);
        toggleDiagnosticPanel(true);
        download("igdc-social-full-system-diagnostic-error-" + new Date().toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", fallback);
        return;
      }
      download("igdc-social-full-system-diagnostic-" + new Date().toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", systemAuditCache);
    };
    if ($("toggleRegistryPanelBtn")) $("toggleRegistryPanelBtn").onclick = function () { toggleRegistryPanel(); };
    if ($("registryDiagnosticBtn"))
      $("registryDiagnosticBtn").onclick = function () {
        runQueueDiagnostic("registry_diagnostic", "인플루언서 등록부 점검 JSON을 읽었습니다.", "igdc-social-influencer-registry-diagnostic.json");
      };
    if ($("latestContentDiagnosticBtn"))
      $("latestContentDiagnosticBtn").onclick = function () {
        runQueueDiagnostic("latest_content_diagnostic", "최신 콘텐츠 후보·교체 대기열 요약 점검 JSON을 읽었습니다.", "igdc-social-latest-content-diagnostic.json");
      };
    if ($("contentStateDiagnosticBtn"))
      $("contentStateDiagnosticBtn").onclick = downloadContentStateDiagnostic;
    if ($("holdDiagnosticBtn"))
      $("holdDiagnosticBtn").onclick = function () {
        runQueueDiagnostic("hold_diagnostic", "보류 대기 점검 JSON을 읽었습니다.", "igdc-social-content-hold-diagnostic.json");
      };
    if ($("exclusionDiagnosticBtn"))
      $("exclusionDiagnosticBtn").onclick = function () {
        runQueueDiagnostic("exclusion_diagnostic", "검색 제외·영구 차단 점검 JSON을 읽었습니다.", "igdc-social-search-exclusion-diagnostic.json");
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
    if ($("channelIntakeDiagnosticJsonBtn")) $("channelIntakeDiagnosticJsonBtn").onclick = downloadDirectIntakeDiagnostic;
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
      $("collectorState").textContent = "진행 중인 5개 SNS 검색 묶음 완료 후 일시정지";
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
    sectionListenersBound = true;
    $("selectAllExcluded").onchange = function () {
      document.querySelectorAll(".excludedCheck").forEach(function (e) {
        e.checked = this.checked;
      }, this);
    };
  }
  function bindDiagnosticControls() {
    // Bind diagnostics independently from the rest of the admin UI. If a later
    // non-diagnostic control throws during initialization, JSON diagnostics must
    // still remain usable so the broken pipeline can be inspected in production.
    if ($("systemAuditBtn")) $("systemAuditBtn").onclick = runFullSystemDiagnostic;
    if ($("systemAuditDownloadBtn")) $("systemAuditDownloadBtn").onclick = async function () {
      if (!systemAuditCache) systemAuditCache = await runFullSystemDiagnostic();
      if (systemAuditCache) {
        download("igdc-social-full-system-diagnostic-" + new Date().toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", systemAuditCache);
      } else {
        var fallback = fallbackDiagnostic("full_system_diagnostic", new Error("full_system_diagnostic_failed"));
        diagnostic(fallback);
        toggleDiagnosticPanel(true);
        download("igdc-social-full-system-diagnostic-error-" + new Date().toISOString().slice(0,19).replace(/[:T]/g,"-") + ".json", fallback);
      }
    };
    if ($("collectorProgressJsonBtn")) $("collectorProgressJsonBtn").onclick = downloadCollectorProgress;
    if ($("researchPipelineDiagnosticBtn")) $("researchPipelineDiagnosticBtn").onclick = downloadResearchPipelineDiagnostic;
    if ($("channelIntakeDiagnosticJsonBtn")) $("channelIntakeDiagnosticJsonBtn").onclick = downloadDirectIntakeDiagnostic;
    if ($("registryDiagnosticBtn")) $("registryDiagnosticBtn").onclick = function () {
      return runQueueDiagnostic("registry_diagnostic", "인플루언서 등록부 점검 JSON을 읽었습니다.", "igdc-social-influencer-registry-diagnostic.json");
    };
    if ($("latestContentDiagnosticBtn")) $("latestContentDiagnosticBtn").onclick = function () {
      return runQueueDiagnostic("latest_content_diagnostic", "최신 콘텐츠 후보·교체 대기열 요약 점검 JSON을 읽었습니다.", "igdc-social-latest-content-diagnostic.json");
    };
    if ($("contentStateDiagnosticBtn")) $("contentStateDiagnosticBtn").onclick = downloadContentStateDiagnostic;
    if ($("holdDiagnosticBtn")) $("holdDiagnosticBtn").onclick = function () {
      return runQueueDiagnostic("hold_diagnostic", "보류 대기 점검 JSON을 읽었습니다.", "igdc-social-content-hold-diagnostic.json");
    };
    if ($("exclusionDiagnosticBtn")) $("exclusionDiagnosticBtn").onclick = function () {
      return runQueueDiagnostic("exclusion_diagnostic", "검색 제외·영구 차단 점검 JSON을 읽었습니다.", "igdc-social-search-exclusion-diagnostic.json");
    };
    if ($("toggleDiagnosticPanelBtn")) $("toggleDiagnosticPanelBtn").onclick = function () { toggleDiagnosticPanel(); };
  }
  function bindBatchExtras() {
    if ($("providerStatusBtn")) $("providerStatusBtn").onclick = providerStatus;
    if ($("researchPipelineDiagnosticBtn")) $("researchPipelineDiagnosticBtn").onclick = downloadResearchPipelineDiagnostic;
    if ($("searchBankImportBtn")) $("searchBankImportBtn").onclick = function () {
      return importSearchBank(text($("collectorSection") && $("collectorSection").value));
    };
    providerStatus();
  }
  function bindEssentialSectionControls() {
    if (!sectionListenersBound) {
      bindAccordion($("sectionAccordion"), "final");
      bindAccordion($("waitingAccordion"), "waiting");
      bindAccordion($("holdAccordion"), "hold");
      sectionListenersBound = true;
    }
    if ($("redditAdminCollectBtn")) $("redditAdminCollectBtn").onclick = function () { collectEmptySection("social-reddit"); };
    if ($("redditAdminUrlsBtn")) $("redditAdminUrlsBtn").onclick = importRedditUrls;
    if ($("redditAdminOpenBtn")) $("redditAdminOpenBtn").onclick = function () { openContentSection("social-reddit"); };
    if ($("redditAdminDiagnosticBtn")) $("redditAdminDiagnosticBtn").onclick = function () { downloadSectionDiagnostic("social-reddit"); };
    // The admin management accordion exists before the first network request.
    // A network failure is reported, never confused with an empty candidate pool.
    options();
    filters({});
    renderSections();
    setCandidateReadStatus("pending", "");
  }
  async function start() {
    bindDiagnosticControls();
    try { bind(); } catch (e) {
      console.error("[IGDC Social Admin] non-diagnostic UI bind failed", e);
      show("일부 관리자 UI 연결에 오류가 있습니다. 점검 JSON 버튼은 계속 사용할 수 있습니다: " + text(e && e.message), "warn");
    }
    try { bindEssentialSectionControls(); } catch (e) {
      console.error("[IGDC Social Admin] essential section controls failed", e);
      setCandidateReadStatus("error", "관리 블록 초기화 오류: " + text(e && e.message));
    }
    try { bindBatchExtras(); } catch (e) {
      console.error("[IGDC Social Admin] provider controls bind failed", e);
    }
    try { await countryOptions(); } catch (e) {
      console.error("[IGDC Social Admin] country options failed", e);
    }
    try { await refresh(); } catch (e) {
      console.error("[IGDC Social Admin] initial refresh failed", e);
      show("초기 후보 데이터 읽기에 실패했습니다. 점검 JSON으로 연결 상태를 확인해 주세요: " + text(e && e.message), "warn");
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
