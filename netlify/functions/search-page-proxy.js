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


function pickMeta(htmlText, names){
  const html = String(htmlText || '');
  for(const name of Array.isArray(names) ? names : [names]){
    const n = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re = new RegExp("<meta[^>]+(?:name|property)=[\"']" + n + "[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>", 'i');
    let m = html.match(re);
    if(m && m[1]) return m[1];
    re = new RegExp("<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:name|property)=[\"']" + n + "[\"'][^>]*>", 'i');
    m = html.match(re);
    if(m && m[1]) return m[1];
  }
  return '';
}

function stripForText(htmlText){
  return String(htmlText || '')
    .replace(/<script\b[\s\S]*?<\/script>/ig, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/ig, ' ')
    .replace(/<noscript\b[^>]*>/ig, ' ')
    .replace(/<\/noscript>/ig, ' ')
    .replace(/<br\s*\/?>/ig, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/ig, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMeaningfulImage(htmlText, baseUrl){
  const html = String(htmlText || '');
  const og = pickMeta(html, ['og:image','twitter:image','twitter:image:src']);
  if(og) return absoluteUrl(og, baseUrl);
  const re = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/ig;
  let m;
  while((m = re.exec(html))){
    const src = String(m[2] || '').trim();
    if(!src || /logo|favicon|sprite|blank|pixel|icon/i.test(src)) continue;
    return absoluteUrl(src, baseUrl);
  }
  return '';
}

function snapshotDocument(htmlText, finalUrl){
  const raw = String(htmlText || '');
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (pickMeta(raw, ['og:title','twitter:title']) || (titleMatch && titleMatch[1]) || (finalUrl ? new URL(finalUrl).hostname : '원문 페이지'))
    .replace(/\s+/g, ' ').trim();
  const desc = (pickMeta(raw, ['description','og:description','twitter:description']) || '').replace(/\s+/g, ' ').trim();
  const image = firstMeaningfulImage(raw, finalUrl);
  const bodyText = stripForText(raw).split('\n').map(x => x.trim()).filter(x => x && x.length > 20).slice(0, 12).join('\n\n');
  const text = desc || bodyText || '이 사이트는 자바스크립트 기반이거나 내부 표시를 제한하여 IGDC 검색 화면 안에서는 요약 스냅샷으로 표시됩니다.';
  const safeImage = image ? '<img class="hero" src="' + escapeHtml(image) + '" alt="">' : '';
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="' + escapeHtml(finalUrl || '') + '"><meta name="referrer" content="no-referrer-when-downgrade"><style>html,body{margin:0;background:#fff;color:#111827;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:980px;margin:0 auto;padding:34px 28px 60px}.url{font-size:13px;color:#64748b;word-break:break-all;margin-bottom:12px}.title{font-size:30px;line-height:1.25;font-weight:900;letter-spacing:-.03em;margin:0 0 20px}.hero{display:block;max-width:100%;max-height:360px;object-fit:contain;border:1px solid #eef2f7;border-radius:16px;margin:0 0 22px;background:#f8fafc}.text{font-size:16px;line-height:1.8;white-space:pre-wrap;color:#334155}.notice{margin-top:26px;padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e5e7eb;color:#64748b;font-size:12px}</style></head><body><main class="wrap"><div class="url">' + escapeHtml(finalUrl || '') + '</div><h1 class="title">' + escapeHtml(title || '원문 페이지') + '</h1>' + safeImage + '<div class="text">' + escapeHtml(text) + '</div><div class="notice">원본 사이트의 보안 정책 또는 자바스크립트 구조 때문에 전체 페이지 대신 안정 스냅샷으로 표시했습니다.</div></main>' + lightweightBridge(finalUrl, {}) + '</body></html>';
}

function lightweightBridge(finalUrl, opts){
  const proxyId = String((opts && opts.proxyId) || '');
  const baseUrl = String(finalUrl || '');
  return `<script>(function(){
    var PROXY_ID=${JSON.stringify(proxyId)};
    var BASE_URL=${JSON.stringify(baseUrl)};
    function abs(v){try{return new URL(v, BASE_URL || location.href).href;}catch(e){return '';}}
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
    return json(200, { ok:false, directAllowed:true, reason:String(e && e.message || e || 'frame-check-failed'), finalUrl: target.href });
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
