/* IGDC Social Hub Influencer Registry + Latest Content Control v2.5.0 */
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
    PIPELINE_REPORT = "/data/social-pipeline.report.json",
    SEARCHBANK_SOCIAL_RELEASE = "/data/social-searchbank.release.snapshot.json",
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
    openFinalSection = null,
    openWaitingSection = null,
    stopRequested = false,
    liveReports = [],
    placementById = {},
    placementStats = { selected: 0, replacement: 0 },
    countryCatalog = [],
    regionCatalog = [],
    detectedCountry = null,
    previewWindow = null,
    selectedInfluencers = new Set(),
    selectedContents = new Set();
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
  function countryScopedActive() {
    var countryCode = selectedCountry();
    return active().filter(function (r) {
      var scopes = r.countryScopes || (r.raw && r.raw.countryScopes) || [];
      return (
        !countryCode ||
        !scopes.length ||
        scopes
          .map(function (value) {
            return text(value).toUpperCase();
          })
          .includes(countryCode)
      );
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
        "승인 후보 중 상위 100/섹션",
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
        p.targetPerSection || 300,
        "공개 슬롯 " + (p.publicSlotsPerSection || 100) + "개",
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
  function selectedCountry() {
    return text($("collectorCountry").value).toUpperCase();
  }
  function scopeMode() {
    return selectedCountry() ? "country" : "global";
  }
  function currentScope() {
    var code = selectedCountry();
    var country = countryCatalog.filter(function (row) {
      return text(row.code).toUpperCase() === code;
    })[0];
    return {
      countryCode: code,
      regionId: text($("collectorRegion").value),
      country: country || null,
    };
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
    el.innerHTML = '<option value="">전 세계 공통</option>' + list;
    if (
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
      countryName =
        (scope.country &&
          (scope.country.nameKo ||
            scope.country.nameEn ||
            scope.country.code)) ||
        "전 세계 공통";
    $("countryScopeState").textContent =
      "현재 관리·수집·실제 적용 범위: " +
      countryName +
      (scope.countryCode ? " (" + scope.countryCode + ")" : "") +
      " · 접속 국가 자동 확인: " +
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
      checked = (
        registry ? selectedInfluencers : selectedContents
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
      (registry ? "finalCheck" : "waitingCheck") +
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
        : selectedContents;
    return Array.from(source).filter(function (id) {
      return rows.some(function (row) {
        return text(row.id) === id && row.sectionKey === section;
      });
    });
  }
  function queueRows(queue, section) {
    return visible().filter(function (row) {
      return (
        assetClass(row) ===
          (queue === "registry" ? "influencer_registry" : "latest_content") &&
        (!section || row.sectionKey === section)
      );
    });
  }
  function selectQueue(queue, section, checked) {
    var target =
      queue === "registry" ? selectedInfluencers : selectedContents;
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
  function pruneSelections() {
    var ids = new Set(
      rows.map(function (row) {
        return text(row.id);
      }),
    );
    [selectedInfluencers, selectedContents].forEach(function (selection) {
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
      '<div class="section-actionbar"><span class="section-note small">각 인플루언서의 최신 콘텐츠 1건만 유지하며 공개 100개와 교체 후보를 함께 관리합니다.</span>' +
      '<button class="secondary" type="button" data-waiting-select-all="' +
      esc(key) +
      '">섹션 전체 선택</button>' +
      '<button class="secondary" type="button" data-waiting-clear-all="' +
      esc(key) +
      '">선택 해제</button>' +
      '<button type="button" data-waiting-promote="' +
      esc(key) +
      '">선택 최종 후보로</button>' +
      '<button class="publish" type="button" data-waiting-publish="' +
      esc(key) +
      '">이 섹션 실제 적용</button>' +
      '<button class="danger" type="button" data-waiting-unpublish-all="' +
      esc(key) +
      '">이 섹션 전체 적용 해제</button>' +
      '<button class="danger" type="button" data-waiting-unpublish="' +
      esc(key) +
      '">선택 콘텐츠만 적용 취소</button>' +
      '<button class="danger" type="button" data-waiting-delete="' +
      esc(key) +
      '">선택 교체후보 삭제</button>' +
      '<button class="danger" type="button" data-waiting-block="' +
      esc(key) +
      '">선택 영구 차단</button></div>'
    );
  }
  function accordionHtml(list, queue, openKey) {
    return order
      .map(function (key) {
        var part = list.filter(function (r) {
            return r.sectionKey === key;
          }),
          isOpen = openKey === key,
          toggleAttribute =
            queue === "registry" ? "data-final-toggle" : "data-waiting-toggle";
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
              (queue === "registry" ? finalActions(key) : waitingActions(key)) +
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
  function renderSections() {
    var list = visible(),
      finalList = list.filter(function (row) {
        return assetClass(row) === "influencer_registry";
      }),
      waitingList = list.filter(function (row) {
        return assetClass(row) === "latest_content";
      });
    $("filterState").textContent =
      "표시 " +
      list.length +
      "개 / 활성 후보 " +
      active().length +
      "개 / 제외·차단 " +
      rows.filter(excluded).length +
      "개";
    if (openFinalSection === null) {
      openFinalSection =
        order.filter(function (k) {
          return finalList.some(function (r) {
            return r.sectionKey === k;
          });
        })[0] || order[0];
    }
    if (openWaitingSection === null) {
      openWaitingSection =
        order.filter(function (k) {
          return waitingList.some(function (r) {
            return r.sectionKey === k;
          });
        })[0] || order[0];
    }
    $("candidateCapacityState").textContent =
      "인플루언서 " + finalList.length + "명 · 채널 링크 등록부";
    $("waitingCapacityState").textContent =
      "최신 콘텐츠 " +
      waitingList.length +
      "개 · 공개 " +
      placementStats.selected +
      "개 · 교체 " +
      placementStats.replacement +
      "개";
    $("sectionAccordion").innerHTML = accordionHtml(
      finalList,
      "registry",
      openFinalSection,
    );
    $("waitingAccordion").innerHTML = accordionHtml(
      waitingList,
      "waiting",
      openWaitingSection,
    );
    $("tablePanel").classList.remove("hidden");
    $("waitingPanel").classList.remove("hidden");
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
    $("diagnosticPanel").classList.remove("hidden");
    $("downloadJsonBtn").disabled = false;
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
        scope: currentScope(),
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
          countryCode: text($("collectorCountry").value),
          scopeMode: scopeMode(),
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
  async function refresh() {
    hide();
    $("refreshBtn").disabled = true;
    try {
      var d = await get(REVIEW + "?action=candidates");
      rows = (d.queue && d.queue.rows) || d.candidates || [];
      pruneSelections();
      await loadPlacement();
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
      scopeMode: j.scopeMode || (j.countryCode ? "country" : "global"),
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
      target: 100,
      batchSize: batchSize,
      countryCode: text($("collectorCountry").value).toUpperCase(),
      scopeMode: scopeMode(),
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
      if (!dry) await refresh();
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
  async function collectAll() {
    if (
      !confirm(
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
      j.target = 100;
    }
    var failed = false;
    try {
      for (; j.index < order.length && !stopRequested; j.index++) {
        var continuing = resume && j.section === order[j.index];
        j.section = order[j.index];
        if (!continuing) {
          j.target = 100;
          j.batchSize = Math.max(
            8,
            Math.min(12, Number($("collectorBatchSize").value) || 10),
          );
          j.countryCode = text($("collectorCountry").value).toUpperCase();
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
        countryCode: text($("collectorCountry").value).toUpperCase(),
        scopeMode: scopeMode(),
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
        move_to_replacement: "교체 후보 대기열로 이동",
        promote_candidate: "최종 후보로 올리기",
        delete_waiting: "교체 후보 기록 완전 삭제",
      },
      name = names[action] || action;
    if (
      (action === "approve" || action === "promote_candidate") &&
      !$("socialConfirm").checked
    ) {
      show(
        "최종 후보로 올리기 전 공개성·안전성 확인 체크가 필요합니다.",
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
          "개 교체 후보 기록을 완전히 삭제할까요? 나중에 다시 검색되면 후보로 들어올 수 있습니다.",
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
    var note =
      action === "delete" ||
      action === "approve" ||
      action === "hold" ||
      action === "reject"
        ? prompt(name + " 처리 메모를 입력하세요. 비워도 됩니다.", "") || ""
        : name;
    try {
      var body = Object.assign(
        {
          action: action,
          ids: ids,
          note: note,
          countryCode: selectedCountry(),
          scopeMode: scopeMode(),
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
      });
      $("socialConfirm").checked = false;
      await refresh();
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
      show("최종 공개 100개와 교체 후보 대기열을 다시 계산했습니다.", "ok");
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
      var snapshot = await staticJson(STATIC_SOCIAL_SNAPSHOT);
      download("igdc-social-actual-applied.snapshot.json", snapshot);
      show("현재 배포된 최종 소셜 스냅샷 JSON을 다운로드했습니다.", "ok");
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
      var documents = await Promise.all([
          staticJson(PIPELINE_REPORT),
          staticJson(SEARCHBANK_SOCIAL_RELEASE),
          staticJson(STATIC_SOCIAL_SNAPSHOT),
        ]),
        report = documents[0],
        searchBankRelease = documents[1],
        finalSnapshot = documents[2],
        idsBySection = releasedCandidateIds(finalSnapshot),
        finalCount = Object.keys(idsBySection).reduce(function (sum, key) {
          return sum + idsBySection[key].length;
        }, 0),
        expected = Number(
          report &&
            report.searchBankRelease &&
            report.searchBankRelease.itemCount,
        ),
        verification = {
          ok:
            report &&
            report.status === "published" &&
            finalCount === expected &&
            !(
              report.finalSocialSnapshot &&
              report.finalSocialSnapshot.missingIds &&
              report.finalSocialSnapshot.missingIds.length
            ),
          reportType: "igdc-social-canonical-pipeline-verification",
          generatedAt: new Date().toISOString(),
          canonicalPipeline: [
            "stored_social_release",
            "social_searchbank_release_adapter",
            "existing_snapshot_engine",
            "data/social.snapshot.json",
            "existing_social_automap",
          ],
          comparison: {
            expectedSearchBankItems: expected,
            finalCandidateItems: finalCount,
            idsBySection: idsBySection,
          },
          pipelineReport: report,
          socialSearchBankRelease: searchBankRelease,
          finalSocialSnapshot: finalSnapshot,
        };
      download("igdc-social-canonical-pipeline-verification.json", verification);
      diagnostic(verification);
      show(
        verification.ok
          ? "정식 파이프라인 단계별 검증 JSON을 다운로드했습니다."
          : "파이프라인 불일치가 포함된 점검 JSON을 다운로드했습니다.",
        verification.ok ? "ok" : "warn",
      );
    } catch (error) {
      show(
        (error.message || "파이프라인 JSON을 읽지 못했습니다.") +
          " 배포 빌드가 완료된 뒤 다시 확인해 주세요.",
        "warn",
      );
    }
  }
  async function autoCurate(sectionKey) {
    var target = sectionKey ? label(sectionKey) : "전체 9개 섹션",
      scope = currentScope(),
      scopeName =
        (scope.country &&
          (scope.country.nameKo ||
            scope.country.nameEn ||
            scope.country.code)) ||
        "전 세계 공통";
    if (
      !confirm(
        scopeName +
          " 범위의 " +
          target +
          " 후보를 공개성·안전성·품질 점수 기준으로 자동 정리할까요? 실제 화면 적용은 별도 버튼입니다.",
      )
    )
      return;
    try {
      var d = await post(AUTO, {
        confirmAutoCurate: true,
        sectionKey: sectionKey || "",
        countryCode: scope.countryCode,
        scopeMode: scopeMode(),
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
    } catch (e) {
      show(e.message || "자동 정리를 완료하지 못했습니다.", "warn");
    }
  }
  async function actualApply(sectionKey) {
    var target = sectionKey ? label(sectionKey) : "전체 9개 섹션",
      scope = currentScope(),
      scopeName =
        (scope.country &&
          (scope.country.nameKo ||
            scope.country.nameEn ||
            scope.country.code)) ||
        "전 세계 공통";
    if (
      !confirm(
        scopeName +
          " 방문자에게 보일 " +
          target +
          " 인플루언서들의 최종 최신 콘텐츠를 실제 프론트 슬롯에 적용할까요?",
      )
    )
      return;
    try {
      var previewQuery = new URLSearchParams({
          includeSnapshot: "0",
          sectionKey: sectionKey || "",
          countryCode: scope.countryCode,
          scopeMode: scopeMode(),
        }),
        preview = await get(PUBLISH + "?" + previewQuery.toString());
      if (Number(preview.eligibleRows || 0) < 1) {
        throw new Error(
          "검증을 통과한 실제 후보가 0개이므로 빈 적용본은 배포하지 않습니다.",
        );
      }
      var d = await post(PUBLISH, {
        storeRelease: true,
        confirmPublish: true,
        includeSnapshot: 0,
        sectionKey: sectionKey || "",
        countryCode: scope.countryCode,
        scopeMode: scopeMode(),
      });
      diagnostic(d);
      if (d.buildTrigger && d.buildTrigger.ok) {
        show(
          scopeName +
            " 범위의 " +
            target +
            " 승인본을 저장했고 정식 배포 빌드를 접수했습니다. 배포가 끝나면 SearchBank 어댑터→기존 Snapshot Engine→정적 소셜 스냅샷 순서로 반영됩니다.",
          "ok",
        );
      } else {
        show(
          scopeName +
            " 범위의 승인본은 안전하게 저장됐지만 정식 배포는 아직 시작되지 않았습니다. Netlify 환경변수 SOCIAL_NETLIFY_BUILD_HOOK_URL을 설정한 뒤 다시 실제 적용을 실행해 주세요.",
          "warn",
        );
      }
    } catch (e) {
      show(e.message || "실제 화면 적용을 완료하지 못했습니다.", "warn");
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
          "개 콘텐츠를 프론트에서 내리고 교체 후보 대기열로 되돌릴까요?",
      )
    )
      return;
    try {
      await moveToReplacementInBatches(ids, scope);
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
            "개를 대기열로 복귀시켰고, 실제 적용 취소 정식 빌드를 접수했습니다. 배포 완료 후 프론트에서 내려갑니다.",
          "ok",
        );
      } else {
        show(
          "선택 콘텐츠는 대기열로 복귀했고 적용 취소본도 저장됐지만, SOCIAL_NETLIFY_BUILD_HOOK_URL 미설정으로 정식 배포가 시작되지 않았습니다.",
          "warn",
        );
      }
    } catch (e) {
      show(
        movedToWaiting
          ? "선택 콘텐츠는 대기열로 복귀했지만 프론트 적용 취소 저장을 완료하지 못했습니다. 같은 항목을 다시 선택해 적용 취소를 실행해 주세요. · " +
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
    container.addEventListener("click", function (event) {
      var toggle = event.target.closest(
        queue === "final" ? "[data-final-toggle]" : "[data-waiting-toggle]",
      );
      if (toggle) {
        if (queue === "final")
          openFinalSection =
            openFinalSection === toggle.dataset.finalToggle
              ? ""
              : toggle.dataset.finalToggle;
        else
          openWaitingSection =
            openWaitingSection === toggle.dataset.waitingToggle
              ? ""
              : toggle.dataset.waitingToggle;
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
      else if ((key = event.target.dataset.sectionApprove))
        run("approve", sectionIds(container, key, "finalCheck"));
      else if ((key = event.target.dataset.sectionAi)) autoCurate(key);
      else if ((key = event.target.dataset.sectionBlock))
        run("permanent_block", sectionIds(container, key, "finalCheck"));
      else if ((key = event.target.dataset.waitingPromote))
        run("promote_candidate", sectionIds(container, key, "waitingCheck"));
      else if ((key = event.target.dataset.waitingPublish)) actualApply(key);
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
          : selectedContents;
        if (event.target.checked)
          target.add(text(event.target.dataset.candidateId));
        else target.delete(text(event.target.dataset.candidateId));
        event.target
          .closest(".candidate-card")
          .classList.toggle("selected", event.target.checked);
      }
    });
  }
  function bind() {
    options();
    $("refreshBtn").onclick = refresh;
    $("diagnosticBtn").onclick = async function () {
      try {
        var d = await get(REVIEW + "?action=diagnostic");
        diagnostic(d);
        if (d.queue && d.queue.rows) {
          rows = d.queue.rows;
          renderSummary(d.summary);
          filters(d.summary);
          renderSections();
          renderExclusions();
        }
        show("소셜 후보 점검 JSON을 읽었습니다.", "ok");
      } catch (e) {
        show(e.message, "warn");
      }
    };
    $("downloadJsonBtn").onclick = function () {
      if (diagnosticCache)
        download(
          "igdc-social-candidate-diagnostic-" +
            new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") +
            ".json",
          diagnosticCache,
        );
    };
    $("downloadCandidateListBtn").onclick = function () {
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
    $("rotationBtn").onclick = rotate;
    $("publishPreviewBtn").onclick = publish;
    $("snapshotDownloadBtn").onclick = snapshot;
    $("applicationValidationJsonBtn").onclick = downloadApplicationValidation;
    $("actualAppliedJsonBtn").onclick = downloadActualApplied;
    $("pipelineVerificationJsonBtn").onclick = downloadPipelineVerification;
    $("returnBtn").onclick = function () {
      var p = new URLSearchParams(location.search),
        to = p.get("returnPath") || "/admin.html";
      location.href = /^\//.test(to) ? to : "/admin.html";
    };
    $("approveBtn").onclick = function () {
      run("approve", selected(".finalCheck"));
    };
    $("selectAllFinalBtn").onclick = function () {
      selectQueue("registry", "", true);
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
    $("publishAllBtn").onclick = function () {
      actualApply("");
    };
    $("unpublishAllScopeBtn").onclick = function () {
      actualUnapplyAll("");
    };
    $("unpublishAllBtn").onclick = function () {
      actualUnapply("");
    };
    $("waitingPromoteBtn").onclick = function () {
      run("promote_candidate", selected(".waitingCheck"));
    };
    $("selectAllWaitingBtn").onclick = function () {
      selectQueue("content", "", true);
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
