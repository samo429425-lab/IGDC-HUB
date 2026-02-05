/**
 * mediahub-automap.v1.js (FINAL)
 * 목적: mediahub.html의 .thumb-line[data-psom-key] 섹션에 media.snapshot.json을 1:1로 주입
 * 원칙:
 *  - "새 카드 append" 대신, 기존 더미(placeholder) 카드를 '실카드'로 치환(안정/스위퍼 충돌 최소화)
 *  - 실데이터가 없으면 더미 유지
 *  - 콘솔 점검용: window.runMediaAutoMap()
 */
(function () {
  'use strict';
  if (window.__MEDIAHUB_AUTOMAP_V1_FINAL__) return;
  window.__MEDIAHUB_AUTOMAP_V1_FINAL__ = true;

  var SNAPSHOT_URLS = [
    '/data/media.snapshot.json',
    '/assets/data/media.snapshot.json',
    'data/media.snapshot.json'
  ];

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function isNonEmpty(v) {
    return typeof v === 'string' ? v.trim().length > 0 : !!v;
  }

  function isRealItem(it) {
    if (!it || typeof it !== 'object') return false;
    return isNonEmpty(it.thumbnail) || isNonEmpty(it.poster) || isNonEmpty(it.preview) || isNonEmpty(it.title) || isNonEmpty(it.video);
  }

  async function fetchJson(url) {
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
  }

  async function loadSnapshot() {
    var lastErr = null;
    for (var i = 0; i < SNAPSHOT_URLS.length; i++) {
      try {
        var data = await fetchJson(SNAPSHOT_URLS[i]);
        // 간단 마킹 (네트워크/파이프라인 "한 방" 확인용)
        window.__MEDIAHUB_SNAPSHOT_URL__ = SNAPSHOT_URLS[i];
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('snapshot load failed');
  }

  function getLine(sectionKey) {
    return q('.thumb-line[data-psom-key="' + sectionKey + '"]');
  }

  // placeholder anchor 1개를 "실카드"로 치환
  function applyIntoCardAnchor(a, item) {
    // marker
    a.dataset.maruReal = '1';
    if (a.hasAttribute('data-placeholder')) a.removeAttribute('data-placeholder');

    // link
    var href = (item && item.video) ? String(item.video) : 'javascript:void(0)';
    a.setAttribute('href', href);
    if (item && item.video) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    } else {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }

    // thumb
    var thumb = q('.thumb', a);
    if (!thumb) {
      thumb = document.createElement('div');
      thumb.className = 'thumb';
      a.insertBefore(thumb, a.firstChild);
    }

    // reset thumb content
    thumb.innerHTML = '';

    var imgUrl = (item && (item.thumbnail || item.poster || item.preview)) ? (item.thumbnail || item.poster || item.preview) : '';
    if (isNonEmpty(imgUrl)) {
      var img = document.createElement('img');
      img.src = imgUrl;
      img.alt = (item && item.title) ? String(item.title) : '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      var ph = document.createElement('div');
      ph.className = 'thumb ph';
      thumb.appendChild(ph);
    }

    // meta
    var meta = q('.meta', a);
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'meta';
      a.appendChild(meta);
    }
    meta.textContent = (item && item.title) ? String(item.title) : '';
  }

  function resetPlaceholders(line) {
    // 이전 실행에서 실카드로 치환된 것 원복(다음 갱신/테스트 대비)
    qa('a.card.media-card', line).forEach(function(a){
      if (a.dataset && a.dataset.maruReal === '1') {
        // 실카드였던 것을 제거하고, 원래 더미가 남아있도록 하는 방식은 HTML 구조마다 다름.
        // 여기서는 "치환된 카드"는 그냥 숨김 해제/내용 비우기만 수행 (더미 복구는 media-empty-handler가 담당)
        a.removeAttribute('data-maru-real');
      }
    });

    // 더미 표시 기본값: 보이게
    qa('a.card.media-card', line).forEach(function(a){
      a.style.display = '';
    });
  }

  function hideUnusedPlaceholders(line, usedCount) {
    // usedCount 이후 남는 더미는 숨김 (실데이터가 있을 때만)
    var cards = qa('a.card.media-card', line);
    for (var i = usedCount; i < cards.length; i++) {
      // 아직 placeholder(더미)인 것만 숨김
      if (cards[i].getAttribute('data-placeholder') === 'true') {
        cards[i].style.display = 'none';
      }
    }
  }

  function showAllPlaceholders(line) {
    qa('a.card.media-card', line).forEach(function(a){
      if (a.getAttribute('data-placeholder') === 'true') a.style.display = '';
    });
  }

  function renderSection(sectionKey, items) {
    var line = getLine(sectionKey);
    if (!line) return;

    // 섹션 로딩 마킹
    line.dataset.maruAutomap = '1';

    var list = Array.isArray(items) ? items : [];
    var realItems = [];
    for (var i = 0; i < list.length; i++) {
      if (isRealItem(list[i])) realItems.push(list[i]);
    }

    var placeholders = qa('a.card.media-card[data-placeholder="true"]', line);

    // 실데이터 없음 -> 더미 유지
    if (realItems.length === 0) {
      showAllPlaceholders(line);
      return;
    }

    // 실데이터 있음 -> 더미를 실카드로 치환
    var n = Math.min(realItems.length, placeholders.length);
    for (var j = 0; j < n; j++) {
      applyIntoCardAnchor(placeholders[j], realItems[j]);
    }

    hideUnusedPlaceholders(line, n);
  }

  async function run() {
    var snapshot = await loadSnapshot();
    var sections = (snapshot && Array.isArray(snapshot.sections)) ? snapshot.sections : [];

    // key -> items 맵
    var map = Object.create(null);
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (!s || !s.key) continue;
      map[s.key] = s.items || [];
    }

    // HTML에 존재하는 psom-key 기준으로만 렌더 (1:1)
    var htmlKeys = qa('.thumb-line[data-psom-key]').map(function(el){ return el.getAttribute('data-psom-key'); });

    for (var k = 0; k < htmlKeys.length; k++) {
      var key = htmlKeys[k];
      if (!key) continue;
      if (key === 'media-hero') continue; // hero는 media-hero-engine 담당
      renderSection(key, map[key] || []);
    }

    // 한 방 점검용 플래그
    window.__MEDIAHUB_AUTOMAP_RAN__ = true;
  }

  // 콘솔 점검용
  window.runMediaAutoMap = function () {
    return run().catch(function (e) { console.error('[mediahub-automap] run failed:', e); throw e; });
  };

  // 자동 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      run().catch(function (e) { console.error('[mediahub-automap] init failed:', e); });
    });
  } else {
    run().catch(function (e) { console.error('[mediahub-automap] init failed:', e); });
  }
})();
