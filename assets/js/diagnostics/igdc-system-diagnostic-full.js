/*
 * IGDC System Diagnostic – FULL VERSION
 * 목적:
 *  - 7개 프론트 페이지(home, networkhub, distributionhub, socialnetwork, mediahub, tour, donation)
 *  - snapshot / feed / DOM / 파일존재 여부를 종합 점검
 *  - 관리자(Admin)에서 버튼 클릭 시 팝업으로 전체 진단 결과 표시
 *
 * 설치 위치:
 *   /assets/js/diagnostics/igdc-system-diagnostic-full.js
 *
 * 특징:
 *  - 기존 코드 수정 없음 (읽기 전용)
 *  - 자동 클릭 감지 ("수익/썸네일/상품/맵핑" 포함 버튼)
 *  - 파일 경로/키 불일치 자동 분석
 *  - 7개 사이트 전체 동시 점검
 */

(function (global) {
  "use strict";

  /* ===============================
   * 고정 페이지 정의 (정본)
   * =============================== */
  const PAGE_MAP = {
    home: "home.html",
    network: "networkhub.html",
    distribution: "distributionhub.html",
    social: "socialnetwork.html",
    media: "mediahub.html",
    tour: "tour.html",
    donation: "donation.html"
  };

  const RESULTS = [];

  function now() {
    return new Date().toISOString();
  }

  function push(level, scope, target, message, meta = {}) {
    RESULTS.push({ level, scope, target, message, meta, ts: now() });
  }

  /* ===============================
   * 파일 존재 체크
   * =============================== */
  async function checkFileExists(path, pageKey) {
    try {
      const res = await fetch("/" + path, { method: "HEAD", cache: "no-store" });
      if (!res.ok) {
        push("error", "file", path, `파일 접근 실패 (HTTP ${res.status})`, { pageKey });
      } else {
        push("ok", "file", path, "파일 존재 확인", { pageKey });
      }
    } catch (e) {
      push("error", "file", path, "파일 요청 중 오류", { pageKey });
    }
  }

  /* ===============================
   * DOM 점검 (현재 문서 기준)
   * =============================== */
  function checkDOM(pageKey) {
    try {
      const keys = Array.from(document.querySelectorAll('[data-psom-key]'))
        .map(el => el.getAttribute('data-psom-key'))
        .filter(Boolean);

      if (!keys.length) {
        push("warn", "dom", pageKey, "data-psom-key 없음", { pageKey });
        return;
      }

      push("ok", "dom", pageKey, `psom-key ${keys.length}개 발견`, { pageKey });

      keys.forEach(k => {
        const el = document.querySelector(`[data-psom-key="${k}"]`);
        if (!el) {
          push("error", "dom", k, "DOM 요소 없음", { pageKey });
          return;
        }

        const section = el.closest(".ad-section");
        if (!section) {
          push("warn", "dom", k, ".ad-section 없음", { pageKey });
        }

        const list = section ? section.querySelector(".ad-list") : null;
        if (!list) {
          push("warn", "dom", k, ".ad-list 없음", { pageKey });
        } else if (!list.children.length) {
          push("warn", "dom", k, "아이템 0개", { pageKey });
        } else {
          push("ok", "dom", k, `아이템 ${list.children.length}개`, { pageKey });
        }
      });
    } catch (e) {
      push("error", "dom", pageKey, e.message, { pageKey });
    }
  }

  /* ===============================
   * SNAPSHOT 점검
   * =============================== */
  async function checkSnapshot(pageKey) {
    try {
      const res = await fetch("/.netlify/functions/snapshot", { cache: "no-store" });
      if (!res.ok) {
        push("error", "snapshot", pageKey, `HTTP ${res.status}`, { pageKey });
        return;
      }

      const json = await res.json();
      const keys = Object.keys(json || {});

      if (!keys.length) {
        push("warn", "snapshot", pageKey, "snapshot 비어 있음", { pageKey });
        return;
      }

      push("ok", "snapshot", pageKey, `keys ${keys.length}개`, { pageKey });

      keys.forEach(k => {
        const node = json[k];
        const items = Array.isArray(node?.items)
          ? node.items
          : Array.isArray(node)
          ? node
          : null;

        if (!items || !items.length) {
          push("warn", "snapshot", k, "아이템 없음", { pageKey });
        } else {
          push("ok", "snapshot", k, `items=${items.length}`, { pageKey });
        }
      });
    } catch (e) {
      push("error", "snapshot", pageKey, e.message, { pageKey });
    }
  }

  /* ===============================
   * FEED 점검
   * =============================== */
  async function checkFeed(pageKey) {
    try {
      const res = await fetch(`/.netlify/functions/feed?page=${encodeURIComponent(pageKey)}`, { cache: "no-store" });
      if (!res.ok) {
        push("error", "feed", pageKey, `HTTP ${res.status}`, { pageKey });
        return;
      }

      const json = await res.json();
      const sections = Array.isArray(json.sections) ? json.sections : [];

      if (!sections.length) {
        push("warn", "feed", pageKey, "sections 없음", { pageKey });
        return;
      }

      push("ok", "feed", pageKey, `sections ${sections.length}개`, { pageKey });

      sections.forEach(sec => {
        const id = sec?.id || "(no-id)";
        const count = Array.isArray(sec.items) ? sec.items.length : 0;

        if (!count) {
          push("warn", "feed", id, "아이템 0", { pageKey });
        } else {
          push("ok", "feed", id, `items=${count}`, { pageKey });
        }
      });
    } catch (e) {
      push("error", "feed", pageKey, e.message, { pageKey });
    }
  }

  /* ===============================
   * 전체 실행
   * =============================== */
  async function runAll() {
    RESULTS.length = 0;

    for (const key of Object.keys(PAGE_MAP)) {
      await checkFileExists(PAGE_MAP[key], key);
      await checkFeed(key);
      await checkSnapshot(key);
      checkDOM(key);
    }

    return RESULTS;
  }

  /* ===============================
   * 모달 UI 생성
   * =============================== */
  function ensureModal() {
    let bg = document.getElementById("igdcDiagBackdrop");
    let modal = document.getElementById("igdcDiagModal");

    if (!bg) {
      bg = document.createElement("div");
      bg.id = "igdcDiagBackdrop";
      bg.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99998;display:none";
      bg.onclick = closeModal;
      document.body.appendChild(bg);
    }

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "igdcDiagModal";
      modal.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1100px,94vw);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;z-index:99999;box-shadow:0 20px 60px rgba(0,0,0,.35);display:none;";

      modal.innerHTML = `
        <div style="padding:14px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:900">수익 · 썸네일 · 상품 맵핑 진단</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button id="igdcDiagRefresh" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:10px;background:#fff;cursor:pointer;">재점검</button>
            <button id="igdcDiagClose" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:10px;background:#fff;cursor:pointer;">닫기</button>
          </div>
        </div>
        <div id="igdcDiagBody" style="padding:14px"></div>
      `;

      document.body.appendChild(modal);

      modal.querySelector("#igdcDiagClose").onclick = closeModal;
      modal.querySelector("#igdcDiagRefresh").onclick = runAndRender;
    }

    return { bg, modal };
  }

  function openModal() {
    const { bg, modal } = ensureModal();
    bg.style.display = "block";
    modal.style.display = "block";
  }

  function closeModal() {
    const bg = document.getElementById("igdcDiagBackdrop");
    const modal = document.getElementById("igdcDiagModal");
    if (bg) bg.style.display = "none";
    if (modal) modal.style.display = "none";
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"
    }[c]));
  }

  function render(results) {
    const body = document.getElementById("igdcDiagBody");
    if (!body) return;

    const grouped = {};
    results.forEach(r => {
      const key = r.meta?.pageKey || "unknown";
      (grouped[key] ||= []).push(r);
    });

    let html = "";

    for (const page of Object.keys(PAGE_MAP)) {
      const rows = grouped[page] || [];
      const count = { ok: 0, warn: 0, error: 0 };
      rows.forEach(r => { if (count[r.level] != null) count[r.level]++; });

      html += `<div style="border:1px solid #e5e7eb;border-radius:12px;margin-bottom:14px;padding:12px">`;
      html += `<div style="font-weight:900;margin-bottom:6px">${esc(page)} &nbsp; (ok:${count.ok} / warn:${count.warn} / error:${count.error})</div>`;

      if (!rows.length) {
        html += `<div style="color:#6b7280">진단 결과 없음</div>`;
      } else {
        rows.forEach(r => {
          const color = r.level === "error" ? "#dc2626" : r.level === "warn" ? "#f59e0b" : "#16a34a";
          html += `<div style="margin:6px 0;padding:6px 8px;border-left:4px solid ${color};background:#f9fafb;border-radius:8px">`;
          html += `<b>${esc(r.level.toUpperCase())}</b> · <code>${esc(r.scope)}</code> · <b>${esc(r.target)}</b><br>`;
          html += `<span>${esc(r.message)}</span>`;
          html += `</div>`;
        });
      }

      html += `</div>`;
    }

    body.innerHTML = html;
  }

  async function runAndRender() {
    openModal();
    const body = document.getElementById("igdcDiagBody");
    if (body) body.innerHTML = "<div style='padding:10px'>진단 중...</div>";

    try {
      const results = await runAll();
      render(results);
    } catch (e) {
      if (body) body.innerHTML = "<div style='padding:10px;color:#991b1b;font-weight:800;'>진단 실패: " + esc(e && e.message ? e.message : String(e)) + "</div>";
    }
  }

  /* ===============================
   * 버튼 자동 연결 (텍스트 기반)
   * =============================== */
  document.addEventListener("click", function (e) {
    const path = e.composedPath ? e.composedPath() : [e.target];

    for (const el of path) {
      if (!el || el.nodeType !== 1) continue;
      const t = (el.innerText || el.textContent || "").trim();
      if (!t) continue;

      const hasRevenue = t.includes("수익");
      const hasThumb = (t.includes("썸") || t.toLowerCase().includes("thumb"));
      const hasProduct = (t.includes("상품") || t.toLowerCase().includes("product"));
      const hasMap = (t.includes("맵") || t.includes("매핑") || t.includes("맵핑") || t.toLowerCase().includes("mapping"));

      if (hasRevenue && hasThumb && hasProduct && hasMap) {
        e.preventDefault();
        e.stopPropagation();
        runAndRender();
        break;
      }
    }
  }, true);

  // expose for manual call
  window.IGDC_RUN_DIAGNOSTIC = runAndRender;

})(window);
