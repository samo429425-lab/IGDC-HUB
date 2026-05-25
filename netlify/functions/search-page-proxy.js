'use strict';

const dns = require('dns').promises;
const net = require('net');

function response(statusCode, body, headers, isBase64Encoded){
  return {
    statusCode,
    headers: Object.assign({
      'Cache-Control':'no-store, max-age=0',
      'X-Robots-Tag':'noindex, nofollow',
      'Access-Control-Allow-Origin':'*'
    }, headers || {}),
    body: body || '',
    isBase64Encoded: !!isBase64Encoded
  };
}

function html(statusCode, body){
  return response(statusCode, body || '', {
    'Content-Type':'text/html; charset=utf-8',
    // The page is already sandboxed by search.js. Keep the function response permissive
    // so remote CSS/fonts/images can render, but strip the upstream CSP/XFO below.
    'Content-Security-Policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; media-src * data: blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval'; font-src * data:; frame-src * data: blob:; connect-src * data: blob:; form-action *; base-uri *;"
  });
}

function json(statusCode, body){
  return response(statusCode, JSON.stringify(body || {}), { 'Content-Type':'application/json; charset=utf-8' });
}

function isPrivateIp(ip){
  const version = net.isIP(ip);
  if(!version) return true;
  if(version === 4){
    const p = ip.split('.').map(x => parseInt(x, 10));
    if(p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if(p[0] === 169 && p[1] === 254) return true;
    if(p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if(p[0] === 192 && p[1] === 168) return true;
    return false;
  }
  const low = String(ip).toLowerCase();
  if(low === '::1' || low === '::') return true;
  if(low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80')) return true;
  return false;
}

async function assertPublicTarget(u){
  const host = u.hostname;
  if(!host || /(^|\.)localhost$/i.test(host)) throw new Error('blocked-local-host');
  if(net.isIP(host) && isPrivateIp(host)) throw new Error('blocked-private-ip');
  const records = await dns.lookup(host, { all:true });
  if(!records || !records.length) throw new Error('dns-empty');
  if(records.some(r => isPrivateIp(r.address))) throw new Error('blocked-private-dns');
}

function escapeHtml(v){
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(v, baseUrl){
  const raw = String(v || '').trim();
  if(!raw || raw.charAt(0) === '#' || /^javascript:/i.test(raw) || /^mailto:|^tel:|^data:|^blob:/i.test(raw)) return raw;
  try{ return new URL(raw, baseUrl).href; }catch(e){ return raw; }
}

function proxyUrl(v, baseUrl, opts){
  const abs = absoluteUrl(v, baseUrl);
  if(!/^https?:\/\//i.test(abs)) return abs;
  const sp = new URLSearchParams();
  sp.set('safe', '1');
  sp.set('embed', '1');
  sp.set('mode', (opts && opts.mode) || 'static');
  if(opts && opts.proxyId) sp.set('proxyId', opts.proxyId);
  sp.set('url', abs);
  return '/.netlify/functions/search-page-proxy?' + sp.toString();
}

function removeFrameAndRedirectTraps(markup){
  return String(markup || '')
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/ig, '')
    .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/ig, '')
    .replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/ig, '')
    .replace(/\s+integrity\s*=\s*(["']).*?\1/ig, '')
    .replace(/\s+nonce\s*=\s*(["']).*?\1/ig, '')
    .replace(/target\s*=\s*(["'])_(top|parent|blank)\1/ig, 'target="_self"')
    .replace(/window\s*\.\s*top\s*\.\s*location/ig, 'window.location')
    .replace(/top\s*\.\s*location/ig, 'location')
    .replace(/parent\s*\.\s*location/ig, 'location');
}

function stripActiveScripts(markup){
  return String(markup || '')
    .replace(/<script\b[\s\S]*?<\/script>/ig, '')
    .replace(/\s+on[a-z]+\s*=\s*(["']).*?\1/ig, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/ig, '');
}

function rewriteSrcset(value, baseUrl){
  return String(value || '').split(',').map(part => {
    const trimmed = part.trim();
    if(!trimmed) return trimmed;
    const bits = trimmed.split(/\s+/);
    bits[0] = absoluteUrl(bits[0], baseUrl);
    return bits.join(' ');
  }).join(', ');
}

function rewriteCssUrls(value, baseUrl){
  return String(value || '').replace(/url\((['"]?)([^'"\)]+)\1\)/ig, function(m, q, url){
    const raw = String(url || '').trim();
    if(!raw || /^data:|^blob:|^javascript:/i.test(raw)) return m;
    return 'url("' + absoluteUrl(raw, baseUrl).replace(/"/g, '%22') + '")';
  });
}

function rewriteAttributes(markup, baseUrl, opts){
  opts = opts || {};
  let out = String(markup || '');

  out = out.replace(/<(a|area)\b([^>]*?)\shref\s*=\s*(["'])(.*?)\3/ig, function(m, tag, before, quote, href){
    const cleanBefore = before.replace(/\s+target\s*=\s*(["']).*?\1/ig, '');
    return '<' + tag + cleanBefore + ' href=' + quote + escapeHtml(proxyUrl(href, baseUrl, opts)) + quote;
  });

  out = out.replace(/<form\b([^>]*?)\saction\s*=\s*(["'])(.*?)\2/ig, function(m, before, quote, action){
    const cleanBefore = before.replace(/\s+target\s*=\s*(["']).*?\1/ig, '');
    return '<form' + cleanBefore + ' action=' + quote + escapeHtml(proxyUrl(action, baseUrl, opts)) + quote + ' target="_self"';
  });

  out = out.replace(/<(iframe|frame|object|embed)\b([^>]*?)\s(src|data)\s*=\s*(["'])(.*?)\4/ig, function(m, tag, before, attr, quote, src){
    return '<' + tag + before + ' ' + attr + '=' + quote + escapeHtml(proxyUrl(src, baseUrl, opts)) + quote;
  });

  out = out.replace(/<(img|source|video|audio|track|input)\b([^>]*?)\ssrc\s*=\s*(["'])(.*?)\3/ig, function(m, tag, before, quote, src){
    return '<' + tag + before + ' src=' + quote + escapeHtml(absoluteUrl(src, baseUrl)) + quote;
  });

  out = out.replace(/<script\b([^>]*?)\ssrc\s*=\s*(["'])(.*?)\2/ig, function(m, before, quote, src){
    return '<script' + before + ' src=' + quote + escapeHtml(absoluteUrl(src, baseUrl)) + quote;
  });

  out = out.replace(/<link\b([^>]*?)\shref\s*=\s*(["'])(.*?)\2/ig, function(m, before, quote, href){
    return '<link' + before + ' href=' + quote + escapeHtml(absoluteUrl(href, baseUrl)) + quote;
  });

  out = out.replace(/\ssrcset\s*=\s*(["'])(.*?)\1/ig, function(m, quote, srcset){
    return ' srcset=' + quote + escapeHtml(rewriteSrcset(srcset, baseUrl)) + quote;
  });

  out = out.replace(/\sstyle\s*=\s*(["'])(.*?)\1/ig, function(m, quote, style){
    return ' style=' + quote + escapeHtml(rewriteCssUrls(style, baseUrl)) + quote;
  });

  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/ig, function(m, attr, css){
    return '<style' + attr + '>' + rewriteCssUrls(css, baseUrl) + '</style>';
  });

  return out;
}

function fallbackDocument(title, message, target){
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;color:#334155;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.page{padding:28px 30px}.title{font-size:18px;font-weight:800;color:#111827;margin-bottom:8px}.msg{font-size:14px;line-height:1.65;color:#64748b;max-width:760px}.url{margin-top:14px;font-size:12px;color:#64748b;word-break:break-all;background:#f1f5f9;border-radius:9px;padding:8px 10px}</style></head><body><div class="page"><div class="title">' + escapeHtml(title) + '</div><div class="msg">' + escapeHtml(message) + '</div><div class="url">' + escapeHtml(target || '') + '</div></div></body></html>';
}


function stripTagsToText(markup){
  return String(markup || '')
    .replace(/<script\b[\s\S]*?<\/script>/ig, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/ig, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(v){
  return String(v || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function attrValue(tag, attr){
  const text = String(tag || '');
  const re1 = new RegExp("\\s" + attr + "\\s*=\\s*\\\"([\\s\\S]*?)\\\"", "i");
  const re2 = new RegExp("\\s" + attr + "\\s*=\\s*'([\\s\\S]*?)'", "i");
  const m = text.match(re1) || text.match(re2);
  return m && m[1] ? decodeEntities(m[1]) : '';
}

function firstMetaContent(markup, names){
  const metas = String(markup || '').match(/<meta\b[^>]*>/ig) || [];
  const wanted = new Set((names || []).map(x => String(x).toLowerCase()));
  for(const tag of metas){
    const key = String(attrValue(tag, 'name') || attrValue(tag, 'property')).toLowerCase();
    if(wanted.has(key)){
      const c = attrValue(tag, 'content');
      if(c) return c;
    }
  }
  return '';
}

function firstTitle(markup, finalUrl){
  const og = firstMetaContent(markup, ['og:title', 'twitter:title']);
  if(og) return og;
  const m = String(markup || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if(m && m[1]) return stripTagsToText(m[1]).slice(0, 160);
  try{ return new URL(finalUrl).hostname; }catch(e){ return finalUrl || 'Original page'; }
}

function collectSnapshotImages(markup, finalUrl){
  const out = [];
  const seen = new Set();
  function push(v){
    const abs = absoluteUrl(v, finalUrl);
    if(!/^https?:\/\//i.test(abs)) return;
    const key = abs.toLowerCase();
    if(seen.has(key)) return;
    if(/favicon|sprite|\.ico(\?|#|$)|placeholder|blank|pixel/i.test(key)) return;
    seen.add(key); out.push(abs);
  }
  push(firstMetaContent(markup, ['og:image', 'twitter:image', 'twitter:image:src']));
  const imgs = String(markup || '').match(/<img\b[^>]*>/ig) || [];
  imgs.forEach(tag => push(attrValue(tag, 'src')));
  const srcsets = String(markup || '').match(/\ssrcset\s*=\s*(["'])([\s\S]*?)\1/ig) || [];
  srcsets.forEach(s => {
    const m = s.match(/=["']([\s\S]*?)["']$/);
    String((m && m[1]) || '').split(',').forEach(part => push((part.trim().split(/\s+/)[0] || '')));
  });
  return out.slice(0, 12);
}

function snapshotDocument(htmlText, finalUrl){
  const title = firstTitle(htmlText, finalUrl);
  const desc = firstMetaContent(htmlText, ['description','og:description','twitter:description']);
  const images = collectSnapshotImages(htmlText, finalUrl);
  const bodyText = stripTagsToText(htmlText).replace(String(title || ''), '').trim();
  const excerpt = (desc || bodyText || '').slice(0, 900);
  const imageHtml = images.length ? '<div class="shots">' + images.map(src => '<img src="' + escapeHtml(src) + '" loading="lazy" alt="">').join('') + '</div>' : '';
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="' + escapeHtml(finalUrl) + '"><meta name="referrer" content="no-referrer-when-downgrade"><style>html,body{margin:0;background:#fff;color:#111827;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1120px;margin:0 auto;padding:34px 28px 56px}.url{font-size:13px;color:#64748b;word-break:break-all;margin-bottom:12px}.title{font-size:30px;line-height:1.25;font-weight:850;letter-spacing:-.03em;margin-bottom:18px}.desc{font-size:15px;line-height:1.75;color:#334155;max-width:900px;margin-bottom:22px}.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:18px}.shots img{width:100%;height:180px;object-fit:cover;border-radius:14px;border:1px solid #e5e7eb;background:#f8fafc}.note{margin-top:24px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;color:#64748b;font-size:13px}</style>' + lightweightBridge(finalUrl, { proxyId: '' }) + '</head><body><main class="wrap"><div class="url">' + escapeHtml(finalUrl || '') + '</div><h1 class="title">' + escapeHtml(title || finalUrl || '') + '</h1>' + (excerpt ? '<div class="desc">' + escapeHtml(excerpt) + '</div>' : '') + imageHtml + '<div class="note">이 페이지는 IGDC 검색 화면 안에서 안정적으로 보기 위해 공개 HTML을 스냅샷으로 정리한 화면입니다.</div></main></body></html>';
}

function lightweightBridge(finalUrl, opts){
  const proxyId = String((opts && opts.proxyId) || '');
  const baseUrl = String(finalUrl || '');
  return `<script>(function(){
    var PROXY_ID=${JSON.stringify(proxyId)};
    var BASE_URL=${JSON.stringify(baseUrl)};
    function abs(v){try{var raw=String(v||'');var u=new URL(raw, BASE_URL || location.href);var urlParam=u.searchParams&&u.searchParams.get('url');if((raw.indexOf('/.netlify/functions/search-page-proxy')===0||/\/\.netlify\/functions\/search-page-proxy/i.test(u.pathname))&&urlParam){return urlParam;}return u.href;}catch(e){return '';}}
    function report(){try{var b=document.body||{};var d=document.documentElement||{};var txt=(b.innerText||'').trim();var media=document.querySelectorAll?document.querySelectorAll('img,svg,canvas,video,iframe,table,picture').length:0;parent.postMessage({__igdcProxyStatus:1,proxyId:PROXY_ID,title:document.title||'',textLen:txt.length,height:Math.max(b.scrollHeight||0,d.scrollHeight||0),mediaCount:media},'*')}catch(e){}}
    function sendNav(u){try{if(u) parent.postMessage({__igdcProxyNavigate:1,proxyId:PROXY_ID,url:u},'*')}catch(e){}}
    document.addEventListener('click',function(e){
      var a=e.target&&e.target.closest?e.target.closest('a[href],area[href]'):null;
      if(!a) return;
      var h=a.getAttribute('href')||'';
      if(!h||h.charAt(0)==='#'||/^javascript:/i.test(h)||/^mailto:|^tel:/i.test(h)) return;
      var u=abs(h); if(!u) return;
      e.preventDefault(); e.stopPropagation(); sendNav(u);
    },true);
    document.addEventListener('submit',function(e){
      var f=e.target; if(!f||!f.action) return;
      var method=(f.method||'GET').toUpperCase();
      if(method!=='GET') return;
      try{var u=new URL(f.getAttribute('action')||BASE_URL, BASE_URL); var fd=new FormData(f); fd.forEach(function(v,k){u.searchParams.set(k,v)}); e.preventDefault(); sendNav(u.href);}catch(x){}
    },true);
    setTimeout(report,450);setTimeout(report,1500);setTimeout(report,3200);window.addEventListener('load',function(){setTimeout(report,100);setTimeout(report,1000)});
  })();</script>`;
}

function injectShell(htmlText, finalUrl, opts){
  opts = opts || {};
  const mode = String(opts.mode || 'static').toLowerCase();
  if(mode === 'snapshot') return snapshotDocument(htmlText, finalUrl);
  let out = String(htmlText || '');
  out = removeFrameAndRedirectTraps(out);
  // Static is the stable IGDC viewer path. It prevents source-page scripts from
  // freezing the search shell while still showing server-rendered HTML/CSS/images.
  if(mode !== 'live') out = stripActiveScripts(out);
  out = rewriteAttributes(out, finalUrl, { mode: mode === 'live' ? 'live' : 'static', proxyId: opts.proxyId || '' });

  const headInject = [
    '<meta charset="utf-8">',
    '<base href="' + escapeHtml(finalUrl) + '">',
    '<meta name="referrer" content="no-referrer-when-downgrade">',
    '<style>html,body{min-height:100%;margin:0;background:#fff!important;visibility:visible!important;opacity:1!important;}body{overflow:auto!important;}body.loading,body.preload,body.preloading{visibility:visible!important;opacity:1!important;}img,video,svg,canvas{max-width:100%;height:auto;}table{max-width:100%;}a{cursor:pointer;}</style>',
    lightweightBridge(finalUrl, opts)
  ].join('');

  if(/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, '<head$1>' + headInject);
  else out = '<head>' + headInject + '</head>' + out;
  if(!/<body[^>]*>/i.test(out)) out = '<body>' + out + '</body>';
  if(!/<!doctype/i.test(out)) out = '<!doctype html>' + out;
  return out;
}



function normalizeHeaderValue(v){ return String(v || '').trim(); }

function requesterOrigin(event){
  const h = event.headers || {};
  const raw = h.origin || h.Origin || h.referer || h.Referer || '';
  try{ return raw ? new URL(raw).origin.toLowerCase() : ''; }catch(e){ return ''; }
}

function cspAllowsAncestor(csp, origin){
  const text = String(csp || '');
  const m = text.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/i);
  if(!m) return true;
  const list = m[1].trim().split(/\s+/).map(x => x.replace(/^['"]|['"]$/g, '').toLowerCase());
  if(!list.length) return false;
  if(list.includes('*')) return true;
  if(list.includes('none')) return false;
  if(list.includes('self')) return false;
  if(origin && list.includes(origin)) return true;
  if(origin){
    for(const token of list){
      if(token.endsWith(':')) continue;
      if(token.includes('*')){
        const re = new RegExp('^' + token.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$');
        if(re.test(origin)) return true;
      }
    }
  }
  return false;
}

function directFrameAllowedFromHeaders(headers, origin){
  const xfo = normalizeHeaderValue(headers.get('x-frame-options')).toLowerCase();
  if(xfo){
    if(xfo.includes('deny')) return { directAllowed:false, reason:'x-frame-options-deny', xFrameOptions:xfo };
    if(xfo.includes('sameorigin')) return { directAllowed:false, reason:'x-frame-options-sameorigin', xFrameOptions:xfo };
  }
  const csp = normalizeHeaderValue(headers.get('content-security-policy')).toLowerCase();
  if(csp && !cspAllowsAncestor(csp, origin)) return { directAllowed:false, reason:'csp-frame-ancestors', contentSecurityPolicy:csp.slice(0, 500) };
  return { directAllowed:true, reason:'allowed-by-headers', xFrameOptions:xfo || '', contentSecurityPolicy:csp.slice(0, 500) };
}

async function frameCheck(event, target){
  const origin = requesterOrigin(event);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try{
    let upstream = await fetch(target.href, {
      method:'HEAD',
      redirect:'follow',
      signal:ctrl.signal,
      headers: copyRequestHeaders(event, target)
    });
    if(upstream.status === 405 || upstream.status === 403){
      upstream = await fetch(target.href, {
        method:'GET',
        redirect:'follow',
        signal:ctrl.signal,
        headers: copyRequestHeaders(event, target)
      });
    }
    const policy = directFrameAllowedFromHeaders(upstream.headers, origin);
    return json(200, Object.assign({ ok:true, status:upstream.status || 0, finalUrl: upstream.url || target.href }, policy));
  }catch(e){
    // Fail closed: when the checker cannot confirm direct framing, use the
    // owned proxy path so the IGDC search shell is not replaced or frozen.
    return json(200, { ok:false, directAllowed:false, reason:String(e && e.message || e || 'frame-check-failed'), finalUrl: target.href });
  }finally{
    clearTimeout(timer);
  }
}

function copyRequestHeaders(event, target){
  const inHeaders = event.headers || {};
  const headers = {
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': inHeaders.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': inHeaders['accept-language'] || inHeaders['Accept-Language'] || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': target.origin + '/'
  };
  const ct = inHeaders['content-type'] || inHeaders['Content-Type'];
  if(ct) headers['Content-Type'] = ct;
  return headers;
}

exports.handler = async function(event){
  if(event.httpMethod === 'OPTIONS') return json(200, { ok:true });
  const qp = event.queryStringParameters || {};
  const raw = qp.url;
  const mode = qp.mode || (qp.snapshot === '1' ? 'snapshot' : (qp.static === '1' ? 'static' : 'static'));
  const proxyId = qp.proxyId || '';
  if(!raw) return html(400, fallbackDocument('Missing url', '표시할 원문 주소가 없습니다.', ''));

  let target;
  try{
    target = new URL(raw);
    if(!/^https?:$/.test(target.protocol)) throw new Error('unsupported-protocol');
    await assertPublicTarget(target);
  }catch(e){
    return html(400, fallbackDocument('원문 주소를 표시할 수 없습니다.', String(e && e.message || e), raw));
  }

  if(String(qp.action || '').toLowerCase() === 'frame-check') {
    return frameCheck(event, target);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 16000);
  try{
    const method = String(event.httpMethod || 'GET').toUpperCase();
    const fetchOpts = {
      method,
      redirect:'follow',
      signal: ctrl.signal,
      headers: copyRequestHeaders(event, target)
    };
    if(!/^(GET|HEAD)$/i.test(method) && event.body){
      fetchOpts.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    }

    const upstream = await fetch(target.href, fetchOpts);
    const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    const finalUrl = upstream.url || target.href;

    if(!/text\/html|application\/xhtml\+xml/i.test(contentType)){
      const buf = Buffer.from(await upstream.arrayBuffer());
      return response(upstream.status || 200, buf.toString('base64'), { 'Content-Type': contentType }, true);
    }

    const text = await upstream.text();
    return html(upstream.status || 200, injectShell(text, finalUrl, { mode, proxyId }));
  }catch(e){
    return html(502, fallbackDocument('원문 응답을 불러오지 못했습니다.', '사이트 응답 시간이 길거나 서버 접근을 제한했습니다.', target && target.href));
  }finally{
    clearTimeout(timer);
  }
};
