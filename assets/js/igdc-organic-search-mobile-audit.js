/* IGDC / MARU 30-stage evidence audit. Local file inspection only; no network or storage. */
(function (global, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (global && global.document) api.install(global, global.document);
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  var MAX_BYTES = 5 * 1024 * 1024, MAX_ROWS = 50000, EXPECTED_PACKAGE = "com.maru.mediaplayer";
  function header(s) { return String(s == null ? "" : s).replace(/^\uFEFF/, "").normalize("NFKC").toLowerCase().replace(/[\s_\-./()%\[\]]/g, ""); }
  function column(names, aliases) { for (var a = 0; a < aliases.length; a++) { var normalized = header(aliases[a]); var i = names.indexOf(normalized); if (i >= 0) return i; } return -1; }
  function value(row, n) { return n < 0 ? "" : String(row[n] == null ? "" : row[n]).trim(); }
  function number(v) {
    var s = String(v == null ? "" : v).trim().replace(/[,\s]/g, "");
    if (!s || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
    var n = Number(s); return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function numericRow(row, col, name) {
    if (col < 0) return null;
    var raw = value(row, col), n = number(raw);
    if (raw !== "" && n === null) throw new Error("유효하지 않은 " + name + " 수치를 확인했습니다.");
    return n;
  }
  function asDate(v) {
    var s = String(v || "").trim(), m = /^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/.exec(s);
    if (!m) return null;
    var date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return date.toISOString().slice(0, 10) === (m[1] + "-" + m[2] + "-" + m[3]) ? date.toISOString().slice(0, 10) : null;
  }
  function csv(text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    if (!text) throw new Error("빈 CSV 파일입니다.");
    if (text.length > MAX_BYTES) throw new Error("CSV는 5MB 이하만 분석할 수 있습니다.");
    // Find the first non-quoted line, to support quoted CSV fields and line breaks.
    var first = "", quoted = false;
    for (var k = 0; k < Math.min(text.length, 10000); k++) {
      if (text[k] === '"') quoted = !quoted;
      if (text[k] === "\n" && !quoted) break;
      first += text[k];
    }
    var delim = [",", "\t", ";"].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cell = "", quote = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quote) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quote = false;
        else cell += c;
      } else if (c === '"') quote = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n") {
        row.push(cell.replace(/\r$/, ""));
        if (row.some(function (x) { return x.trim() !== ""; })) rows.push(row);
        if (rows.length > MAX_ROWS + 1) throw new Error("CSV가 50,000행을 초과하여 집계를 중단했습니다. 기간을 나누어 내보내세요.");
        row = []; cell = "";
      } else cell += c;
    }
    if (quote) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
    row.push(cell.replace(/\r$/, ""));
    if (row.some(function (x) { return x.trim() !== ""; })) rows.push(row);
    if (rows.length > MAX_ROWS + 1) throw new Error("CSV가 50,000행을 초과합니다.");
    if (rows.length < 2 || rows[0].length < 2) throw new Error("CSV 제목 행과 데이터 행을 확인할 수 없습니다.");
    return {headers:rows[0].map(header), rows:rows.slice(1), rowCount:rows.length - 1};
  }
  function periods(dateBuckets, type) {
    var dates = Object.keys(dateBuckets).sort();
    if (!dates.length) return {sevenDay:{status:"unavailable-no-date"},twentyEightDay:{status:"unavailable-no-date"}};
    var end = dates[dates.length - 1];
    function compare(days) {
      var latest = new Date(end + "T00:00:00Z"), a = [], b = [];
      for (var d = 0; d < days * 2; d++) {
        var t = new Date(latest.getTime() - d * 86400000).toISOString().slice(0, 10);
        (d < days ? a : b).push(t);
      }
      // Missing dates could mean missing export rows. Never treat missing rows as zero traffic.
      if (!a.every(function (d) { return dateBuckets[d]; }) || !b.every(function (d) { return dateBuckets[d]; }))
        return {status:"insufficient-daily-coverage",endDate:end,requiredDays:days * 2};
      function sum(list) { return list.reduce(function (n, day) { return n + dateBuckets[day][type]; }, 0); }
      var current = sum(a), previous = sum(b);
      return {status:"computed-from-csv",endDate:end,days:days,current:current,previous:previous,
        changePercent:previous === 0 ? null : Math.round((current - previous) / previous * 1000) / 10,
        note:"Only within the selected CSV export; no claim of complete platform coverage"};
    }
    return {sevenDay:compare(7),twentyEightDay:compare(28)};
  }
  function classifyPlaySource(s) {
    var v = String(s || "").toLowerCase();
    if (/play\s*(store\s*)?search|google\s*play\s*검색|플레이\s*스토어\s*(자연\s*)?검색/.test(v)) return "search";
    if (/explore|browse|탐색|둘러보기/.test(v)) return "explore";
    if (/third.party|external|외부|referral|추천/.test(v)) return "external";
    return "other-or-unspecified";
  }
  function playCsv(text) {
    var data = csv(text), h = data.headers;
    var cols = {
      package:column(h,["Package name","패키지 이름","package_name"]),
      source:column(h,["Traffic source","트래픽 소스","유입 경로","유입경로"]),
      country:column(h,["Country/region","Country / Region","Country","국가/지역","국가 또는 지역","국가"]),
      date:column(h,["Date","날짜","일자"]),
      visits:column(h,["Store listing visitors","스토어 등록정보 방문자","스토어 방문자","store_listing_visitors"]),
      acquisitions:column(h,["Store listing acquisitions","스토어 등록정보 획득","store_listing_acquisitions"]),
      clicks:column(h,["Store listing clicks","Install clicks","순 사용자 설치 클릭","스토어 등록정보 클릭","설치 클릭"]),
      impressions:column(h,["Store listing impressions","기기 노출수","기기 노출 수"])
    };
    if (cols.visits < 0 && cols.acquisitions < 0 && cols.clicks < 0) throw new Error("Play Console의 스토어 방문·획득·설치 클릭 열이 없습니다.");
    if (cols.package < 0 && cols.source < 0) throw new Error("Google Play 스토어 실적 CSV 형식을 확인할 수 없습니다.");
    var totals = {rows:0,storeVisits:null,acquisitions:null,installClicks:null,storeImpressions:null},
      breakdown = {}, countries = {}, daily = {}, skipped = 0, validDates = 0;
    ["storeVisits","acquisitions","installClicks","storeImpressions"].forEach(function (key, i) {
      if ([cols.visits,cols.acquisitions,cols.clicks,cols.impressions][i] >= 0) totals[key] = 0;
    });
    data.rows.forEach(function (row) {
      if (cols.package >= 0 && value(row,cols.package) && value(row,cols.package) !== EXPECTED_PACKAGE) {
        throw new Error("다른 앱 패키지의 Play CSV입니다. MARU 자료만 불러오세요.");
      }
      if (row.length < h.length) { skipped++; return; }
      var metrics = {
        storeVisits:numericRow(row,cols.visits,"스토어 방문"),
        acquisitions:numericRow(row,cols.acquisitions,"획득"),
        installClicks:numericRow(row,cols.clicks,"설치 클릭"),
        storeImpressions:numericRow(row,cols.impressions,"노출")
      };
      var category = cols.source >= 0 ? classifyPlaySource(value(row,cols.source)) : "source-not-in-export";
      if (!breakdown[category]) breakdown[category] = {rows:0,storeVisits:null,acquisitions:null,installClicks:null};
      var group = breakdown[category]; group.rows++;
      ["storeVisits","acquisitions","installClicks","storeImpressions"].forEach(function (key) {
        var n=metrics[key];if(n===null)return;
        totals[key]=(totals[key]||0)+n;
        if (key !== "storeImpressions") group[key]=(group[key]||0)+n;
      });
      var country = value(row,cols.country).slice(0,48);
      if (country) {
        if (!countries[country]) countries[country] = {storeVisits:0,acquisitions:0};
        if (metrics.storeVisits!==null) countries[country].storeVisits += metrics.storeVisits;
        if (metrics.acquisitions!==null) countries[country].acquisitions += metrics.acquisitions;
      }
      var day = asDate(value(row,cols.date));
      if (day) {
        validDates++;
        if (!daily[day]) daily[day] = {storeVisits:0,acquisitions:0};
        if(metrics.storeVisits!==null) daily[day].storeVisits+=metrics.storeVisits;
        if(metrics.acquisitions!==null) daily[day].acquisitions+=metrics.acquisitions;
      }
      totals.rows++;
    });
    if (!totals.rows) throw new Error("집계할 Play Console 행이 없습니다.");
    var sortedCountries = Object.keys(countries).sort(function(a,b){return countries[b].storeVisits-countries[a].storeVisits;}).slice(0,12)
      .map(function (name) { return {country:name,storeVisits:countries[name].storeVisits,acquisitions:countries[name].acquisitions}; });
    var search = breakdown.search || null;
    return {schema:"igdc-local-play-performance-v1",source:"administrator-imported-Play-Console-CSV",dataOriginVerified:false,
      package:EXPECTED_PACKAGE,rowsRead:totals.rows,rowsSkipped:skipped,importedAt:new Date().toISOString(),
      totals:totals,trafficSourceBreakdown:breakdown,searchTraffic:search,topCountries:sortedCountries,
      storeAcquisitionRate:totals.storeVisits ? Math.round((totals.acquisitions||0)/totals.storeVisits*10000)/100 : null,
      sevenDayVisits:cols.visits>=0&&validDates===totals.rows?periods(daily,"storeVisits").sevenDay:{status:"unavailable"},
      twentyEightDayVisits:cols.visits>=0&&validDates===totals.rows?periods(daily,"storeVisits").twentyEightDay:{status:"unavailable"},
      knownLimits:["Acquisitions are a Play Console metric; do not relabel as confirmed first opens or installs", "Click and acquisition fields are not interchangeable", "Traffic source absent or unrecognized means search-only attribution is not verified", "CSV export scope, country and selected date range cannot be independently authenticated", "Aggregated rows may overlap across multiple dimensions; import one report at a time"],
      containsRawQueries:false};
  }
  function webCsv(text, source) {
    if (source !== "bing" && source !== "naver") throw new Error("검색엔진 출처를 선택하세요.");
    var d=csv(text), h=d.headers;
    if (h.some(function(k){return /광고그룹|광고비|cpc|costperclick|adgroup|광고캠페인/.test(k);}))
      throw new Error("유료 광고 실적 CSV로 보입니다. 자연검색 보고서만 사용하세요.");
    var c={clicks:column(h,["Clicks","클릭수","클릭"]),impressions:column(h,["Impressions","노출수","노출"]),
      position:column(h,["Average position","Avg. position","Avg Position","평균순위","평균 게재순위","게재순위"]),date:column(h,["Date","날짜","일자"])};
    if(c.clicks<0||c.impressions<0)throw new Error("자연검색 클릭수·노출수 열을 찾지 못했습니다.");
    var total={rows:0,clicks:0,impressions:0,weightedPosition:null}, weighted=0, weight=0, daily={};
    d.rows.forEach(function(row){
      if(row.length<h.length)return;
      var clicks=numericRow(row,c.clicks,"클릭수"),impressions=numericRow(row,c.impressions,"노출수");
      if(clicks===null||impressions===null)return;
      total.rows++;total.clicks+=clicks;total.impressions+=impressions;
      if(c.position>=0){var pos=numericRow(row,c.position,"검색 순위");if(pos!==null){weighted+=pos*impressions;weight+=impressions;}}
      var day=asDate(value(row,c.date));if(day){if(!daily[day])daily[day]={impressions:0};daily[day].impressions+=impressions;}
    });
    if(!total.rows)throw new Error("집계할 검색 실적 행이 없습니다.");
    total.weightedPosition=weight?Math.round(weighted/weight*100)/100:null;
    return{schema:"igdc-local-web-search-csv-v1",source:source,sourceSelfReported:true,reportFormatVerified:false,
      importedAt:new Date().toISOString(),total:total,
      sevenDayImpressions:c.date>=0?periods(daily,"impressions").sevenDay:{status:"unavailable-no-date"},
      twentyEightDayImpressions:c.date>=0?periods(daily,"impressions").twentyEightDay:{status:"unavailable-no-date"},
      note:"Browser import only. The CSV is not independently authenticated as a Bing/Naver organic report; compare only like-for-like exports.",
      containsRawQueries:false};
  }
  function compareDiagnostics(previous, now) {
    if (!previous || !String(previous.schema||"").startsWith("igdc-maru-organic-search-admin-diagnostic-")) throw new Error("이전 IGDC 검색 진단 JSON이 아닙니다.");
    if (!now || !now.overview) return {status:"waiting-for-current-diagnostic"};
    var prevAt=Date.parse(previous.generatedAt||""), nowAt=Date.parse(now.generatedAt||"");
    if (!Number.isFinite(prevAt)||!Number.isFinite(nowAt)||nowAt<=prevAt) return {status:"invalid-or-reversed-time-range"};
    function difference(a,b){return Number.isFinite(a)&&Number.isFinite(b)?b-a:null;}
    var pa=previous.overview||{},ca=now.overview||{},pr=previous.registry||{},cr=now.registry||{};
    var lastAck=function(doc){var x=doc&&doc.transmissionEvidence&&doc.transmissionEvidence.checkpoint&&doc.transmissionEvidence.checkpoint.adapters;
      return x&&x.indexnow&&Number.isFinite(x.indexnow.acknowledgedUrlCount)?x.indexnow.acknowledgedUrlCount:null;};
    var previousSeo=previous.liveSeoInspection&&previous.liveSeoInspection.findings||[], currentSeo=(now.liveSeoInspection&&now.liveSeoInspection.findings)||(now.seo&&now.seo.findings)||[];
    return {status:"compared",previousAt:previous.generatedAt,currentAt:now.generatedAt,
      deltas:{reachable:difference(pa.reachable,ca.reachable),needsReview:difference(pa.needsReview,ca.needsReview),
        publicTargets:difference(pr.total,cr.total),indexNowReceiptRecords:difference(lastAck(previous),lastAck(now)),
        seoFindings:difference(previousSeo.length,currentSeo.length)},
      notes:["Current timestamp may be browser observation time when comparing the summary preview", "Receipt count changes are not search impressions or indexing growth", "Comparisons are between two diagnostic snapshots, not a complete uptime or scheduled-run history"]};
  }
  function install(win, doc) {
    var root=doc.getElementById("igdc-organic-search-diagnostic");
    if(!root||root.getAttribute("data-os-advanced-audit"))return;
    root.setAttribute("data-os-advanced-audit","ready");
    var extra=doc.createElement("details");
    extra.id="igdc-os-evidence-import";
    extra.innerHTML='<summary style="cursor:pointer;font-weight:700;color:#234c76">정밀 검색·설치 실적 분석 (선택 · 로컬 파일)</summary>'+
      '<p class="os-muted">Play Console / Bing / 네이버 자연검색 CSV와 이전 점검 JSON을 이 브라우저에서만 분석합니다. 파일 원본·개별 검색어는 서버로 보내지 않습니다. 기존 Google Search Console CSV 입력도 계속 사용할 수 있습니다.</p>'+
      '<div class="os-inputs"><label>Play Console CSV <input id="igdc-os-play-csv" type="file" accept=".csv,text/csv" style="width:auto"></label>'+
      '<label>검색엔진 <select id="igdc-os-extra-source"><option value="bing">Bing</option><option value="naver">네이버</option></select></label>'+
      '<label>검색 실적 CSV (선택) <input id="igdc-os-extra-csv" type="file" accept=".csv,text/csv" style="width:auto"></label>'+
      '<label>이전 점검 JSON <input id="igdc-os-prev-json" type="file" accept=".json,application/json" style="width:auto"></label></div>'+
      '<p class="os-muted" id="igdc-os-evidence-status" aria-live="polite">파일 미선택 · 실제 실적은 미측정</p>'+
      '<pre id="igdc-os-evidence-preview" style="white-space:pre-wrap;max-height:260px;overflow:auto">확인 가능한 자료만 JSON에 포함합니다.</pre>';
    var existing=doc.getElementById("igdc-os-preview");
    var previousDetails=existing&&existing.closest("details");
    if(previousDetails&&previousDetails.parentNode===root)root.insertBefore(extra,previousDetails);
    else root.appendChild(extra);
    var play=null,web=null,previous=null,advancedGsc=null;
    function id(s){return doc.getElementById(s);}
    function status(s){id("igdc-os-evidence-status").textContent=s;}
    function currentPreview(){try{var d=JSON.parse(id("igdc-os-preview").textContent||"null");if(d&&d.overview&&!d.generatedAt){d.generatedAt=new Date().toISOString();d.previewGeneratedAtIsBrowserTime=true;}return d;}catch(_){return null;}}
    function update(){
      var comparison=previous?compareDiagnostics(previous,currentPreview()):null;
      var hasAny=!!(play||web||previous||advancedGsc);
      win.IGDC_OS_MOBILE_AUDIT_DATA=hasAny?{
        schema:"igdc-organic-search-local-evidence-v1",generatedAt:new Date().toISOString(),
        playConsole:play,otherWebSearch:web,searchConsoleEnhanced:advancedGsc,previousDiagnosticComparison:comparison,
        evidenceType:"administrator-local-import-not-independently-verified",rawCsvUploaded:false,
        privacy:"No CSV or raw search queries sent to server; report includes aggregate statistics only"
      }:null;
      id("igdc-os-evidence-preview").textContent=JSON.stringify({playConsole:play&&{totals:play.totals,searchTraffic:play.searchTraffic,sevenDayVisits:play.sevenDayVisits,twentyEightDayVisits:play.twentyEightDayVisits},
        otherWebSearch:web&&web.total,previousDiagnosticComparison:comparison,
        serverGscImport:advancedGsc?"CSV detected; the original Search Console panel keeps its summary":null},null,2);
      status("로컬 자료: Play "+(play?"분석됨":"미입력")+" · 기타 검색 "+(web?"분석됨":"미입력")+" · 과거 진단 "+(previous?"분석됨":"미입력")+" · 실측 순위는 공식 콘솔 자료에 한정");
    }
    async function read(file){if(!file)return null;if(file.size>MAX_BYTES)throw new Error("5MB 이하의 파일만 가능합니다.");return await file.text();}
    id("igdc-os-play-csv").addEventListener("change",async function(){play=null;try{if(this.files&&this.files[0])play=playCsv(await read(this.files[0]));update();}catch(e){update();status("Play CSV 분석 실패: "+e.message);}});
    id("igdc-os-extra-csv").addEventListener("change",async function(){web=null;try{if(this.files&&this.files[0])web=webCsv(await read(this.files[0]),id("igdc-os-extra-source").value);update();}catch(e){update();status("검색 CSV 분석 실패: "+e.message);}});
    id("igdc-os-extra-source").addEventListener("change",function(){if(web){web=null;update();status("검색엔진을 바꿨으므로 CSV를 다시 선택해 주십시오.");}});
    id("igdc-os-prev-json").addEventListener("change",async function(){previous=null;try{if(this.files&&this.files[0]){
      var data=JSON.parse(await read(this.files[0]));if(!String(data.schema||"").startsWith("igdc-maru-organic-search-admin-diagnostic-"))throw new Error("IGDC 검색 진단 JSON만 사용할 수 있습니다.");previous=data;
    }update();}catch(e){update();status("이전 JSON 분석 실패: "+e.message);}});
    var gsc=id("igdc-os-gsc-csv");
    if(gsc)gsc.addEventListener("change",function(){advancedGsc=this.files&&this.files[0]?{fileProvided:true,source:"Google Search Console CSV handled by existing administrator diagnostic",rawQueriesStored:false}:null;update();});
    var preview=id("igdc-os-preview");
    if(preview&&win.MutationObserver)new win.MutationObserver(update).observe(preview,{characterData:true,childList:true,subtree:false});
    update();
  }
  return {csv:csv,playCsv:playCsv,webCsv:webCsv,compareDiagnostics:compareDiagnostics,periods:periods,install:install};
});
