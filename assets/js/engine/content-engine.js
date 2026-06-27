// content-engine.js
// MARU IGDC Content Engine — snapshot-aware product/content one-page resolver
// - Keeps /data/{id}.json direct item loading
// - Falls back to front/network/tour/distribution/social/media snapshots
// - Preserves item commerce/revenue/payment fields and exposes external purchase/visit URL only inside the one-page.

(function(){
  'use strict';

  const DIRECT_DATA_PREFIX = '/data/';
  const SNAPSHOT_SOURCES = [
    { name:'front',        url:'/data/front.snapshot.json',          defaultType:'commerce' },
    { name:'networkhub',   url:'/data/networkhub-snapshot.json',     defaultType:'commerce' },
    { name:'tour',         url:'/data/tour-snapshot.json',           defaultType:'commerce' },
    { name:'distribution', url:'/data/distribution.snapshot.json',   defaultType:'commerce' },
    { name:'social',       url:'/data/social.snapshot.json',         defaultType:'commerce' },
    { name:'media',        url:'/data/media.snapshot.json',          defaultType:'media' }
  ];

  function getParam(name){
    try { return new URL(window.location.href).searchParams.get(name); }
    catch(e){ return null; }
  }

  function rootEl(){ return document.getElementById('content-root') || document.body; }

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function pick(obj, keys){
    for (const k of keys){
      const v = obj && obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return '';
  }

  function pad3(n){
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '001';
    return String(Math.floor(x)).padStart(3, '0');
  }

  function isBadUrl(url){
    const u = String(url || '').trim();
    if (!u) return true;
    if (u === '#') return true;
    if (/^javascript:/i.test(u)) return true;
    if (/^about:blank$/i.test(u)) return true;
    return false;
  }

  function isExampleUrl(url){
    const u = String(url || '').trim();
    if (!u) return false;
    try {
      const parsed = new URL(u, window.location.origin);
      return /(^|\.)example\.(com|org|net)$/i.test(parsed.hostname);
    } catch(e) {
      return /example\.(com|org|net)/i.test(u);
    }
  }

  function usableUrl(url){
    const u = String(url || '').trim();
    if (isBadUrl(u) || isExampleUrl(u)) return '';
    return u;
  }

  function lastNumberFromUrl(url){
    try {
      const parsed = new URL(url, window.location.origin);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      const m = last.match(/(\d+)/);
      return m ? Number(m[1]) : null;
    } catch(e){
      const m = String(url || '').match(/(\d+)(?!.*\d)/);
      return m ? Number(m[1]) : null;
    }
  }

  function stableIdForItem(item, ctx, index){
    const explicit = pick(item, ['id','contentId','productId','itemId','sku','code','pid']);
    if (explicit) return explicit;

    const section = (ctx && ctx.section) || pick(item, ['section','key','slot']) || '';
    const page = (ctx && ctx.page) || pick(item, ['page','hub']) || '';
    const base = section || page || 'content';
    const n = Number(item && (item.priority || item.order || item.rank)) || lastNumberFromUrl(item && (item.url || item.link || item.href)) || (Number(index) + 1) || 1;
    return base + '-' + pad3(n);
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' @ ' + url);
    return await res.json();
  }

  async function tryDirect(id){
    try {
      const data = await fetchJson(DIRECT_DATA_PREFIX + encodeURIComponent(id) + '.json');
      return normalizeContent(data, { source:'direct', page:data && data.page, section:data && data.section, matchedId:id }, 0);
    } catch(e){
      return null;
    }
  }

  function addCandidate(out, item, ctx, index){
    if (!item || typeof item !== 'object') return;
    const ids = new Set();
    const explicit = pick(item, ['id','contentId','productId','itemId','sku','code','pid']);
    if (explicit) ids.add(explicit);
    ids.add(stableIdForItem(item, ctx, index));

    for (const id of ids){
      if (!id) continue;
      out.push({ id:String(id), item, ctx, index });
    }
  }

  function collectCandidates(data, sourceName){
    const out = [];

    function walk(value, ctx){
      if (!value) return;

      if (Array.isArray(value)){
        value.forEach((item, idx) => {
          if (item && typeof item === 'object') addCandidate(out, item, ctx || {}, idx);
        });
        return;
      }

      if (typeof value !== 'object') return;

      if (value.pages && typeof value.pages === 'object'){
        for (const [pageName, pageObj] of Object.entries(value.pages)){
          const sections = pageObj && pageObj.sections;
          if (sections && typeof sections === 'object'){
            for (const [sectionName, list] of Object.entries(sections)){
              walk(list, { source:sourceName, page:pageName, section:sectionName });
            }
          }
        }
      }

      if (Array.isArray(value.items)) walk(value.items, { source:sourceName, page:value.page || sourceName, section:value.key || 'items' });
      if (Array.isArray(value.slots)) walk(value.slots, { source:sourceName, page:value.page || sourceName, section:'slots' });

      if (value.sections && typeof value.sections === 'object'){
        for (const [sectionName, list] of Object.entries(value.sections)){
          walk(list, { source:sourceName, page:value.page || sourceName, section:sectionName });
        }
      }

      if (value.layers && typeof value.layers === 'object'){
        for (const [layerName, layerVal] of Object.entries(value.layers)){
          if (layerVal && typeof layerVal === 'object'){
            if (Array.isArray(layerVal.items)) walk(layerVal.items, { source:sourceName, page:value.page || sourceName, section:layerName });
            if (Array.isArray(layerVal.slots)) walk(layerVal.slots, { source:sourceName, page:value.page || sourceName, section:layerName });
          }
        }
      }
    }

    walk(data, { source:sourceName, page:sourceName, section:'' });
    return out;
  }

  function inferType(item, ctx, fallback){
    const raw = String((item && item.type) || '').toLowerCase();
    if (raw === 'media' || raw === 'video') return 'media';
    if (raw === 'commerce' || raw === 'product' || raw === 'shop') return 'commerce';
    const page = String((ctx && ctx.page) || '').toLowerCase();
    if (page.indexOf('media') >= 0) return 'media';
    return fallback || 'commerce';
  }

  function normalizeContent(item, ctx, index, fallbackType){
    const id = (ctx && ctx.matchedId) || stableIdForItem(item || {}, ctx || {}, index || 0);
    const title = pick(item, ['title','name','label','caption']) || id;
    const image = pick(item, ['image','thumb','thumbnail','img','photo','cover','coverUrl','thumbnailUrl']);
    const video = pick(item, ['video','videoUrl','mediaUrl','src']);
    const description = pick(item, ['description','summary','desc','body','content']) || '상품 상세 정보가 준비 중입니다.';
    const price = pick(item, ['price','salePrice','amount']);
    const currency = pick(item, ['currency']) || '';
    const cta = pick(item, ['cta','buttonText']) || '자세히 보기';
    // A provider-approved affiliate route wins only when snapshot generation
    // has already verified the explicit non-PG contract. Ordinary seller URLs
    // keep their original visit behavior and are never converted by default.
    const affiliateOutboundUrl = usableUrl(pick(item, ['affiliateOutboundUrl','affiliate_outbound_url']));
    const externalUrl = affiliateOutboundUrl || usableUrl(
      pick(item, ['checkoutUrl','paymentUrl','productUrl','purchaseUrl','orderUrl','detailUrl','contentUrl','pageUrl','url','href','link']) ||
      (item && item.detail && pick(item.detail, ['detailUrl','url'])) ||
      ''
    );

    return {
      id,
      type: inferType(item, ctx, fallbackType),
      title,
      image,
      video,
      description,
      price,
      currency,
      cta,
      externalUrl,
      affiliateOutbound: !!affiliateOutboundUrl,
      affiliateProviderId: item && item.affiliate && item.affiliate.providerId ? String(item.affiliate.providerId) : '',
      page: (ctx && ctx.page) || pick(item, ['page','hub']) || '',
      section: (ctx && ctx.section) || pick(item, ['section','key']) || '',
      raw: item || {}
    };
  }

  async function findInSnapshots(id){
    const target = String(id || '').trim();
    if (!target) return null;

    for (const source of SNAPSHOT_SOURCES){
      try {
        const data = await fetchJson(source.url);
        const candidates = collectCandidates(data, source.name);
        for (const c of candidates){
          if (String(c.id) === target){
            c.ctx = c.ctx || {};
            c.ctx.matchedId = target;
            return normalizeContent(c.item, c.ctx, c.index, source.defaultType);
          }
        }
      } catch(e){
        // Continue to next snapshot. Missing optional snapshots must not break content page.
      }
    }
    return null;
  }

  function installBaseStyle(){
    if (document.getElementById('igdc-content-engine-style')) return;
    const style = document.createElement('style');
    style.id = 'igdc-content-engine-style';
    style.textContent = `
      body{ margin:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f7fb; color:#172033; }
      .igdc-content-page{ max-width:1120px; margin:0 auto; padding:28px 18px 42px; }
      .igdc-content-card{ background:#fff; border:1px solid #e5e8ef; border-radius:18px; box-shadow:0 8px 24px rgba(12,24,48,.08); overflow:hidden; }
      .igdc-content-hero{ display:grid; grid-template-columns:minmax(260px,420px) 1fr; gap:28px; padding:28px; }
      .igdc-content-media{ min-height:280px; border-radius:14px; background:#eef1f6; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      .igdc-content-media img,.igdc-content-media video{ width:100%; height:100%; max-height:480px; object-fit:cover; display:block; }
      .igdc-content-placeholder{ color:#7a8498; font-weight:700; text-align:center; padding:24px; }
      .igdc-content-title{ margin:0 0 12px; font-size:clamp(24px,3vw,38px); line-height:1.2; color:#10182d; }
      .igdc-content-meta{ display:flex; flex-wrap:wrap; gap:8px; margin:0 0 18px; }
      .igdc-pill{ display:inline-flex; align-items:center; border:1px solid #d8deea; background:#f8faff; color:#526078; border-radius:999px; padding:5px 10px; font-size:13px; font-weight:700; }
      .igdc-content-desc{ color:#364155; font-size:16px; line-height:1.75; white-space:pre-wrap; }
      .igdc-price{ font-size:22px; font-weight:900; color:#0c4da2; margin:18px 0 0; }
      .igdc-actions{ display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; }
      .igdc-btn{ display:inline-flex; align-items:center; justify-content:center; min-height:42px; padding:0 18px; border-radius:10px; font-weight:800; text-decoration:none; border:1px solid #0c4da2; background:#0c4da2; color:#fff; }
      .igdc-btn.secondary{ background:#fff; color:#0c4da2; }
      .igdc-content-note{ border-top:1px solid #edf0f5; padding:18px 28px; color:#6b7588; font-size:14px; line-height:1.6; }
      .igdc-content-error{ max-width:720px; margin:40px auto; padding:24px; border-radius:14px; background:#fff; border:1px solid #e5e8ef; color:#26324a; }
      @media(max-width:760px){ .igdc-content-hero{ grid-template-columns:1fr; padding:18px; } .igdc-content-media{ min-height:220px; } .igdc-content-note{ padding:16px 18px; } }
    `;
    document.head.appendChild(style);
  }

  function renderContent(data){
    installBaseStyle();
    const root = rootEl();
    const img = data.image ? `<img src="${esc(data.image)}" alt="${esc(data.title)}" loading="lazy" decoding="async">` : '';
    const video = data.video ? `<video controls playsinline><source src="${esc(data.video)}"></video>` : '';
    const media = video || img || `<div class="igdc-content-placeholder">이미지 준비 중</div>`;
    const price = data.price ? `<div class="igdc-price">${esc(data.price)} ${esc(data.currency)}</div>` : '';
    const visit = data.externalUrl
      ? `<a class="igdc-btn" href="${esc(data.externalUrl)}" target="_top" rel="noopener" data-igdc-external="top" data-maru-revenue="1" data-item-id="${esc(data.id)}" data-revenue-line="${data.affiliateOutbound ? 'product_affiliate' : 'content_visit'}"${data.affiliateOutbound ? ' data-affiliate-outbound="1"' : ''}${data.affiliateProviderId ? ' data-affiliate-provider="' + esc(data.affiliateProviderId) + '"' : ''}>${esc(data.cta || '자세히 보기')}</a>`
      : `<span class="igdc-btn secondary" aria-disabled="true">연결 준비 중</span>`;

    root.innerHTML = `
      <main class="igdc-content-page" data-content-id="${esc(data.id)}" data-content-page="${esc(data.page)}" data-content-section="${esc(data.section)}">
        <article class="igdc-content-card">
          <section class="igdc-content-hero">
            <div class="igdc-content-media">${media}</div>
            <div>
              <h1 class="igdc-content-title">${esc(data.title)}</h1>
              <div class="igdc-content-meta">
                <span class="igdc-pill">${esc(data.page || 'IGDC')}</span>
                ${data.section ? `<span class="igdc-pill">${esc(data.section)}</span>` : ''}
                <span class="igdc-pill">ID: ${esc(data.id)}</span>
              </div>
              <div class="igdc-content-desc">${esc(data.description)}</div>
              ${price}
              <div class="igdc-actions">${visit}</div>
            </div>
          </section>
          <div class="igdc-content-note">
            이 화면은 IGDC 내부 상품 원페이지입니다. 실제 판매처·결제·제휴 링크가 연결되면 이 원페이지 안에서 구매/방문 버튼으로 이어집니다.
          </div>
        </article>
      </main>
    `;
  }

  function renderMissing(id){
    installBaseStyle();
    rootEl().innerHTML = `
      <div class="igdc-content-error">
        <h1>콘텐츠를 찾지 못했습니다.</h1>
        <p>요청 ID: <strong>${esc(id || '')}</strong></p>
        <p>개별 데이터 파일과 현재 snapshot들을 확인했지만 매칭되는 상품/콘텐츠가 없습니다.</p>
      </div>
    `;
  }

  async function init(){
    const id = getParam('id');
    if (!id){
      renderMissing('');
      return;
    }

    let data = await tryDirect(id);
    if (!data) data = await findInSnapshots(id);

    if (!data){
      renderMissing(id);
      return;
    }

    renderContent(data);

    try {
      if (window.ActivityEngine && typeof window.ActivityEngine.recordView === 'function') {
        window.ActivityEngine.recordView(id);
      }
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();
