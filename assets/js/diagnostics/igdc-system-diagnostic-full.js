/**
 * igdc-system-diagnostic-full.js (FINAL)
 * - 전체 헬스체크 엔진
 * - 전역 객체 IGDC_DIAG 보장
 * - 결과는 표준 포맷으로 반환
 */
(function () {
  'use strict';

  function ok(scope, target, message, meta) {
    return { level: 'ok', scope, target, message, meta: meta || {} };
  }
  function warn(scope, target, message, meta) {
    return { level: 'warn', scope, target, message, meta: meta || {} };
  }
  function err(scope, target, message, meta) {
    return { level: 'error', scope, target, message, meta: meta || {} };
  }

  async function head(url) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return res.ok ? ok('file', url, 'reachable') : err('file', url, 'HTTP ' + res.status);
    } catch (e) {
      return err('file', url, 'fetch failed', { error: e.message });
    }
  }

  async function checkPages() {
    const pages = [
      '/', '/index.html',
      '/market_hub.html',
      '/distributionhub.html',
      '/socialnetwork.html',
      '/mediahub.html',
      '/tour.html',
      '/donation.html'
    ];
    const results = [];
    for (const p of pages) results.push(await head(p));
    return results;
  }

  async function checkFunctions() {
    const fns = [
      '/.netlify/functions/selfcheck'
    ];
    const results = [];
    for (const f of fns) {
      try {
        const res = await fetch(f, { cache: 'no-store' });
        results.push(res.ok ? ok('function', f, 'ok') : err('function', f, 'HTTP ' + res.status));
      } catch (e) {
        results.push(err('function', f, 'fetch failed', { error: e.message }));
      }
    }
    return results;
  }

  async function runAll() {
    const results = [];
    results.push(...await checkPages());
    results.push(...await checkFunctions());

    // 결과를 콘솔과 이벤트로 노출
    try {
      document.dispatchEvent(new CustomEvent('IGDC_DIAG_RESULT', { detail: results }));
    } catch (_) {}

    console.group('[IGDC] FULL DIAGNOSTIC');
    results.forEach(r => console.log(r.level.toUpperCase(), r.scope, r.target, r.message, r.meta||{}));
    console.groupEnd();

    return results;
  }

  window.IGDC_DIAG = {
    runAll
  };
})();
