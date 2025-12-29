/*
 * IGDC Diagnostics Admin Bridge
 * Location: /assets/js/diagnostics/igdc-diag-admin-bridge.js
 * Purpose: Connect existing admin UI ("수익 썸네일 상품 맵핑") to IGDC_DIAG.runAll()
 * Safe: Read-only; only renders a modal for viewing results.
 */

(function () {
  "use strict";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function ensureModal() {
    let backdrop = $("#igdcDiagBackdrop");
    let modal = $("#igdcDiagModal");

    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "igdcDiagBackdrop";
      backdrop.style.cssText = [
        "display:none",
        "position:fixed",
        "inset:0",
        "background:rgba(0,0,0,.55)",
        "z-index:99998"
      ].join(";");
      backdrop.addEventListener("click", closeModal);
      document.body.appendChild(backdrop);
    }

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "igdcDiagModal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.style.cssText = [
        "display:none",
        "position:fixed",
        "top:50%",
        "left:50%",
        "transform:translate(-50%,-50%)",
        "width:min(980px,92vw)",
        "max-height:86vh",
        "overflow:auto",
        "background:#fff",
        "border-radius:14px",
        "box-shadow:0 20px 60px rgba(0,0,0,.35)",
        "z-index:99999"
      ].join(";");

      modal.innerHTML = [
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #e5e7eb;">',
        '  <div>',
        '    <div style="font-weight:900;font-size:1.05rem;">수익 · 썸네일 · 상품 맵핑 진단</div>',
        '    <div id="igdcDiagMeta" style="font-size:.85rem;color:#6b7280;margin-top:2px;"></div>',
        '  </div>',
        '  <div style="display:flex;gap:8px;">',
        '    <button id="igdcDiagRefresh" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:10px;background:#fff;cursor:pointer;">재점검</button>',
        '    <button id="igdcDiagClose" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:10px;background:#fff;cursor:pointer;">닫기</button>',
        '  </div>',
        '</div>',
        '<div id="igdcDiagBody" style="padding:14px 14px;"></div>'
      ].join("");
      document.body.appendChild(modal);

      $("#igdcDiagClose").addEventListener("click", closeModal);
      $("#igdcDiagRefresh").addEventListener("click", runAllAndRender);
    }

    return { backdrop, modal };
  }

  function openModal() {
    const { backdrop, modal } = ensureModal();
    backdrop.style.display = "block";
    modal.style.display = "block";
  }

  function closeModal() {
    const backdrop = $("#igdcDiagBackdrop");
    const modal = $("#igdcDiagModal");
    if (backdrop) backdrop.style.display = "none";
    if (modal) modal.style.display = "none";
  }

  function groupByPage(results) {
    const groups = {};
    for (const r of results || []) {
      const pageKey = (r.meta && r.meta.pageKey) ? r.meta.pageKey : "unknown";
      groups[pageKey] = groups[pageKey] || [];
      groups[pageKey].push(r);
    }
    return groups;
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c] || c));
  }

  function badge(level) {
    if (level === "error") return '<span style="color:#991b1b;font-weight:800;">ERROR</span>';
    if (level === "warn") return '<span style="color:#92400e;font-weight:800;">WARN</span>';
    return '<span style="color:#166534;font-weight:800;">OK</span>';
  }

  function render(results) {
    openModal();

    const meta = $("#igdcDiagMeta");
    const body = $("#igdcDiagBody");

    const byPage = groupByPage(results);
    const pageOrder = Object.keys((window.IGDC_DIAG && window.IGDC_DIAG.PAGE_MAP) || byPage);

    meta.textContent = `총 ${results.length}건 (ok/warn/error) — ${new Date().toLocaleString()}`;

    const parts = [];

    pageOrder.forEach(pk => {
      const rows = byPage[pk] || [];
      const counts = rows.reduce((a, r) => (a[r.level] = (a[r.level] || 0) + 1, a), {});
      parts.push(`<div style="padding:10px 10px;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;">`);
      parts.push(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">`);
      parts.push(`<div style="font-weight:900;">${esc(pk)}</div>`);
      parts.push(`<div style="font-size:.9rem;color:#374151;">ok:${counts.ok||0} / warn:${counts.warn||0} / error:${counts.error||0}</div>`);
      parts.push(`</div>`);

      if (!rows.length) {
        parts.push(`<div style="margin-top:8px;color:#6b7280;">진단 결과 없음</div>`);
      } else {
        parts.push(`<div style="margin-top:10px;border-top:1px dashed #e5e7eb;padding-top:10px;">`);
        rows.slice(0, 220).forEach(r => {
          parts.push(`<div style="padding:8px 8px;margin:6px 0;border-left:4px solid ${r.level==='error'?'#dc2626':(r.level==='warn'?'#f59e0b':'#22c55e')};background:#f9fafb;border-radius:8px;">`);
          parts.push(`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">${badge(r.level)} <code style="font-weight:800;">${esc(r.scope)}</code> <span style="font-weight:800;">${esc(r.target)}</span></div>`);
          parts.push(`<div style="margin-top:4px;font-size:.9rem;color:#111827;">${esc(r.message)}</div>`);
          parts.push(`</div>`);
        });
        if (rows.length > 220) {
          parts.push(`<div style="color:#6b7280;margin-top:6px;">표시 제한: 220/${rows.length}</div>`);
        }
        parts.push(`</div>`);
      }

      parts.push(`</div>`);
    });

    body.innerHTML = parts.join("");
  }

  async function runAllAndRender() {
    if (!window.IGDC_DIAG || typeof window.IGDC_DIAG.runAll !== "function") {
      alert("진단 모듈(IGDC_DIAG)이 로드되지 않았습니다. 스크립트 경로를 확인하세요.");
      return;
    }
    const { modal } = ensureModal();
    const body = $("#igdcDiagBody");
    openModal();
    body.innerHTML = '<div style="padding:12px;color:#374151;">진단 실행 중입니다...</div>';

    try {
      const results = await window.IGDC_DIAG.runAll();
      render(results);
    } catch (e) {
      body.innerHTML = '<div style="padding:12px;color:#991b1b;font-weight:800;">진단 실패: ' + esc(e && e.message ? e.message : String(e)) + "</div>";
    }
  }

  // Event delegation: try to catch the existing button inside the admin panel/modal without needing its exact ID.
  function isRevenueThumbMappingTrigger(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag !== "button" && tag !== "a" && tag !== "div" && tag !== "span") return false;

    const txt = (el.innerText || el.textContent || "").trim();
    // Broad matching to tolerate slight label changes
    const hasRevenue = txt.includes("수익");
    const hasMap = (txt.includes("맵") || txt.includes("매핑") || txt.includes("맵핑") || txt.toLowerCase().includes("mapping"));
    const hasProduct = (txt.includes("상품") || txt.toLowerCase().includes("product"));
    const hasThumb = (txt.includes("썸") || txt.toLowerCase().includes("thumb"));
    return hasRevenue && hasMap && hasProduct && hasThumb;
  }

  document.addEventListener("click", function (e) {
    const path = e.composedPath ? e.composedPath() : null;
    const candidates = path && path.length ? path : [e.target];

    let hit = null;
    for (const n of candidates) {
      if (n && n.nodeType === 1 && isRevenueThumbMappingTrigger(n)) {
        hit = n;
        break;
      }
    }
    if (!hit) return;

    // Intercept and show our diagnostics modal
    e.preventDefault();
    e.stopPropagation();
    runAllAndRender();
  }, true);

  // Optional: expose manual opener for testing
  window.IGDC_DIAG_OPEN = runAllAndRender;

})();
