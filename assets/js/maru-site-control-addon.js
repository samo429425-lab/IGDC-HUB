
/**
 * maru-site-control-addon.js
 * Operational Version v8 (Stabilized)
 * - Card-first injection
 * - Extension fallback only
 * - Voice hard-stop
 * - Mobile overlay modal optimized
 * - Conversational formatting for TTS
 */

(function () {
  "use strict";

  const STATE = {
    voiceEnabled: false,
    speaking: false
  };

  /* ==========================
     VOICE CONTROL
  ========================== */

  function stopAllVoice() {
    try {
      if (window.maruVoiceStop) window.maruVoiceStop();
      if (window.stopMaruTTS) window.stopMaruTTS();
      if (window.speechSynthesis) speechSynthesis.cancel();
    } catch (e) {}
    STATE.speaking = false;
  }

  function setVoiceEnabled(flag) {
    STATE.voiceEnabled = flag;
    if (!flag) stopAllVoice();
  }

  /* ==========================
     RESPONSE ROUTING
  ========================== */

  function routeResponse(response) {
    const ctx = response && response.context ? response.context : {};
    let injected = false;

    if (ctx.level === "region" && window.injectMaruGlobalRegionData) {
      injected = window.injectMaruGlobalRegionData(response) === true;
    }

    if (ctx.level === "country" && window.injectMaruGlobalCountryData) {
      injected = window.injectMaruGlobalCountryData(response) === true;
    }

    if (!injected) {
      openExtension(response);
    }
  }

  /* ==========================
     EXTENSION (Fallback)
  ========================== */

  function openExtension(response) {
    const modal = document.getElementById("maruExtensionModal");
    if (!modal) return;

    modal.style.display = "block";
    formatExtensionContent(response);
  }

  function closeExtension() {
    const modal = document.getElementById("maruExtensionModal");
    if (!modal) return;
    modal.style.display = "none";
    stopAllVoice();
  }

  function formatExtensionContent(response) {
    const container = document.getElementById("maruExtensionContent");
    if (!container) return;

    const summary = response && response.summary ? response.summary : "";
    const items = response && response.items ? response.items : [];

    let html = "<div class='insight-summary'>" + summary + "</div>";

    if (items.length) {
      html += "<div class='insight-points'>";
      for (let i = 0; i < Math.min(items.length, 5); i++) {
        const it = items[i];
        html += "<p>" + (i + 1) + ". " + (it.title || it.name || "") + "</p>";
      }
      html += "</div>";
    }

    container.innerHTML = html;
  }

  /* ==========================
     MOBILE OVERLAY FIX
  ========================== */

  function optimizeMobileModal() {
    const modal = document.getElementById("maruExtensionModal");
    if (!modal) return;

    const isMobile = window.innerWidth <= 1024;

    if (isMobile) {
      modal.style.position = "fixed";
      modal.style.top = "2vh";
      modal.style.left = "2vw";
      modal.style.width = "96vw";
      modal.style.height = "96vh";
      modal.style.borderRadius = "18px";
      modal.style.background = "#eef6ff";
      modal.style.overflow = "auto";
      modal.style.zIndex = "9999";
    }
  }

  window.addEventListener("resize", optimizeMobileModal);
  document.addEventListener("DOMContentLoaded", optimizeMobileModal);

  /* ==========================
     AI GLOBAL INSIGHT BUTTON
  ========================== */

  window.runMaruGlobalInsight = async function (payload) {
    try {
      const res = await fetch("/.netlify/functions/maru-global-insight-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      routeResponse(data);
    } catch (e) {
      console.error("Insight error", e);
    }
  };

  /* ==========================
     PUBLIC API
  ========================== */

  window.MaruAddon = {
    setVoiceEnabled: setVoiceEnabled,
    closeExtension: closeExtension,
    stopAllVoice: stopAllVoice
  };

})();