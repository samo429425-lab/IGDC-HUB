'use strict';

const dns = require('dns').promises;
const net = require('net');

function html(statusCode, body){
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; media-src * data: blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval'; font-src * data:; frame-src * data: blob:; connect-src * data: blob:; form-action *; base-uri *;"
    },
    body: body || ''
  };
}

function json(statusCode, body){
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body || {})
  };
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
  const low = ip.toLowerCase();
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

function proxyUrl(v, baseUrl){
  const abs = absoluteUrl(v, baseUrl);
  if(!/^https?:\/\//i.test(abs)) return abs;
  const sp = new URLSearchParams();
  sp.set('safe', '1');
  sp.set('embed', '1');
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
    .replace(/window\s*\.\s*top\s*\.\s*location/ig, 'window.location')
    .replace(/top\s*\.\s*location/ig, 'location')
    .replace(/parent\s*\.\s*location/ig, 'location')
    .replace(/target\s*=\s*(["'])_(top|parent|blank)\1/ig, 'target="_self"');
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

function rewriteAttributes(markup, baseUrl){
  let out = String(markup || '');

  out = out.replace(/<(a|area)\b([^>]*?)\shref\s*=\s*(["'])(.*?)\3/ig, function(m, tag, before, quote, href){
    const cleanBefore = before.replace(/\s+target\s*=\s*(["']).*?\1/ig, '');
    return '<' + tag + cleanBefore + ' href=' + quote + escapeHtml(proxyUrl(href, baseUrl)) + quote;
  });

  out = out.replace(/<form\b([^>]*?)\saction\s*=\s*(["'])(.*?)\2/ig, function(m, before, quote, action){
    const cleanBefore = before.replace(/\s+target\s*=\s*(["']).*?\1/ig, '');
    return '<form' + cleanBefore + ' action=' + quote + escapeHtml(proxyUrl(action, baseUrl)) + quote;
  });

  out = out.replace(/<(iframe|frame|object|embed)\b([^>]*?)\s(src|data)\s*=\s*(["'])(.*?)\4/ig, function(m, tag, before, attr, quote, src){
    return '<' + tag + before + ' ' + attr + '=' + quote + escapeHtml(proxyUrl(src, baseUrl)) + quote;
  });

  out = out.replace(/<(img|source|video|audio|track|script|input)\b([^>]*?)\ssrc\s*=\s*(["'])(.*?)\3/ig, function(m, tag, before, quote, src){
    return '<' + tag + before + ' src=' + quote + escapeHtml(absoluteUrl(src, baseUrl)) + quote;
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
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;color:#334155;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.page{padding:30px 28px}.title{font-size:18px;font-weight:800;color:#111827;margin-bottom:8px}.msg{font-size:14px;line-height:1.7;color:#64748b;max-width:760px}.url{margin-top:14px;font-size:12px;color:#64748b;word-break:break-all}</style></head><body><div class="page"><div class="title">' + escapeHtml(title) + '</div><div class="msg">' + escapeHtml(message) + '</div><div class="url">' + escapeHtml(target || '') + '</div></div></body></html>';
}

function injectShell(htmlText, finalUrl, opts){
  opts = opts || {};
  const staticMode = !!opts.staticMode;
  const proxyId = String(opts.proxyId || '');
  let out = String(htmlText || '');
  out = removeFrameAndRedirectTraps(out);
  if(staticMode) out = stripActiveScripts(out);
  out = rewriteAttributes(out, finalUrl);

  const headInject = [
    '<meta charset="utf-8">',
    '<base href="' + escapeHtml(finalUrl) + '">',
    '<meta name="referrer" content="no-referrer-when-downgrade">',
    '<style>html,body{min-height:100%;margin:0;background:#fff!important;visibility:visible!important;opacity:1!important;} body{overflow:auto!important;} body.loading,body.preload,body.preloading{visibility:visible!important;opacity:1!important;} img,video,svg,canvas{max-width:100%;height:auto;} table{max-width:100%;} a{cursor:pointer;} .igdc-proxy-static-note{display:none!important;}</style>',
    '<script>(function(){var PROXY="/.netlify/functions/search-page-proxy?";var PROXY_ID=' + JSON.stringify(proxyId) + ';function abs(v){try{return new URL(v,location.href).href}catch(e){return ""}}function prox(v){var u=abs(v);if(!u)return v;var sp=new URLSearchParams();sp.set("safe","1");sp.set("embed","1");sp.set("url",u);return PROXY+sp.toString()}function sk(h){return !h||h[0]==="#"||/^javascript:/i.test(h)||/^mailto:|^tel:|^data:|^blob:/i.test(h)}function patch(){document.querySelectorAll("a[href]").forEach(function(a){var h=a.getAttribute("href")||"";if(sk(h))return;if(h.indexOf(PROXY)!==0)a.setAttribute("href",prox(h));a.removeAttribute("target")});document.querySelectorAll("form[action]").forEach(function(f){var h=f.getAttribute("action")||location.href;f.setAttribute("action",prox(h));f.setAttribute("target","_self")});document.querySelectorAll("iframe[src],frame[src],embed[src],object[data]").forEach(function(el){var attr=el.hasAttribute("data")?"data":"src";var h=el.getAttribute(attr)||"";if(sk(h))return;if(h.indexOf(PROXY)!==0)el.setAttribute(attr,prox(h));});}function report(){try{var b=document.body||{};var d=document.documentElement||{};var txt=(b.innerText||"").trim();var media=document.querySelectorAll?document.querySelectorAll("img,svg,canvas,video,iframe,table").length:0;parent.postMessage({__igdcProxyStatus:1,proxyId:PROXY_ID,title:document.title||"",textLen:txt.length,height:Math.max(b.scrollHeight||0,d.scrollHeight||0),mediaCount:media},"*");}catch(e){}}document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(sk(h))return;if(h.indexOf(PROXY)!==0)a.setAttribute("href",prox(h));},true);try{new MutationObserver(patch).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["href","src","data","action","target"]})}catch(e){}setTimeout(patch,0);setTimeout(patch,800);setTimeout(report,900);setTimeout(report,2200);window.addEventListener("load",function(){setTimeout(report,80);setTimeout(report,1200);});})();</script>'
  ].join('');

  if(/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, '<head$1>' + headInject);
  else out = '<head>' + headInject + '</head>' + out;
  if(!/<body[^>]*>/i.test(out)) out = '<body>' + out + '</body>';
  if(!/<!doctype/i.test(out)) out = '<!doctype html>' + out;
  return out;
}

exports.handler = async function(event){
  if(event.httpMethod === 'OPTIONS') return json(200, { ok:true });
  const qp = event.queryStringParameters || {};
  const raw = qp.url;
  const staticMode = qp.static === '1' || qp.mode === 'static';
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try{
    const upstream = await fetch(target.href, {
      method:'GET',
      redirect:'follow',
      signal: ctrl.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language':'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': target.origin + '/'
      }
    });

    const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    const finalUrl = upstream.url || target.href;

    if(!/text\/html|application\/xhtml\+xml/i.test(contentType)){
      const buf = Buffer.from(await upstream.arrayBuffer());
      return {
        statusCode: upstream.status || 200,
        headers:{
          'Content-Type': contentType,
          'Cache-Control':'no-store, max-age=0',
          'X-Robots-Tag':'noindex, nofollow',
          'Access-Control-Allow-Origin':'*'
        },
        body: buf.toString('base64'),
        isBase64Encoded: true
      };
    }

    const text = await upstream.text();
    return html(upstream.status || 200, injectShell(text, finalUrl, { staticMode, proxyId }));
  }catch(e){
    return html(502, fallbackDocument('원문 응답을 불러오지 못했습니다.', '사이트 응답 시간이 길거나 서버 접근을 제한했습니다.', target && target.href));
  }finally{
    clearTimeout(timer);
  }
};
