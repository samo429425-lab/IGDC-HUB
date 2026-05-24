'use strict';

const dns = require('dns').promises;
const net = require('net');

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

function html(statusCode, body){
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
      'Access-Control-Allow-Origin': '*',
      // This proxy is rendered inside the IGDC search result area. Keep scripts
      // disabled by default so upstream frame-busters/CSP/meta redirects cannot
      // take over or blank the embedded viewer.
      'Content-Security-Policy': "default-src * data: blob:; script-src 'none'; img-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:; media-src * data: blob:; frame-src * data: blob:; connect-src * data: blob:; form-action *; base-uri *;"
    },
    body: body || ''
  };
}

function isPrivateIp(ip){
  const version = net.isIP(ip);
  if(!version) return true;
  if(version === 4){
    const p = ip.split('.').map(x => parseInt(x, 10));
    if(p[0] === 10) return true;
    if(p[0] === 127) return true;
    if(p[0] === 0) return true;
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
  try{
    const records = await dns.lookup(host, { all:true });
    if(!records || !records.length) throw new Error('dns-empty');
    if(records.some(r => isPrivateIp(r.address))) throw new Error('blocked-private-dns');
  }catch(e){
    if(String(e && e.message || e).startsWith('blocked-')) throw e;
    throw new Error('dns-lookup-failed');
  }
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

function proxyLink(v, baseUrl){
  const abs = absoluteUrl(v, baseUrl);
  if(!/^https?:\/\//i.test(abs)) return abs;
  return '/.netlify/functions/search-page-proxy?safe=1&embed=1&url=' + encodeURIComponent(abs);
}

function stripInlineHandlers(markup){
  return String(markup || '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/ig, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/ig, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/ig, '');
}

function rewriteNavigationalLinks(markup, baseUrl){
  let out = String(markup || '');
  out = out.replace(/<(a|area)\b([^>]*?)\shref\s*=\s*(["'])(.*?)\3/ig, function(m, tag, before, quote, href){
    const next = proxyLink(href, baseUrl);
    return '<' + tag + before.replace(/\s+target\s*=\s*(["']).*?\1/ig, '') + ' href=' + quote + escapeHtml(next) + quote;
  });
  out = out.replace(/<form\b([^>]*?)\saction\s*=\s*(["'])(.*?)\2/ig, function(m, before, quote, action){
    const next = proxyLink(action, baseUrl);
    return '<form' + before.replace(/\s+target\s*=\s*(["']).*?\1/ig, '') + ' action=' + quote + escapeHtml(next) + quote;
  });
  out = out.replace(/\starget\s*=\s*(["'])_(top|parent|blank)\1/ig, ' target="_self"');
  return out;
}

function sanitizeExternalHtml(htmlText, finalUrl){
  let out = String(htmlText || '');

  // Remove upstream rules that commonly blank embedded viewers.
  out = out
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/ig, '')
    .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/ig, '')
    .replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/ig, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/ig, '')
    .replace(/<script\b[^>]*\/?\s*>/ig, '');

  out = stripInlineHandlers(out);
  out = rewriteNavigationalLinks(out, finalUrl);

  const base = '<base href="' + escapeHtml(finalUrl) + '">';
  const meta = '<meta charset="utf-8"><meta name="referrer" content="no-referrer-when-downgrade">';
  const style = `<style>
    html,body{min-height:100%;margin:0;background:#fff!important;color:#111827;}
    body{overflow:auto!important;}
    img,video,svg,canvas{max-width:100%;height:auto;}
    table{max-width:100%;}
    a{cursor:pointer;}
    .igdc-proxy-static-bar{position:sticky;top:0;z-index:2147483647;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid #e5e7eb;background:rgba(248,250,252,.96);color:#334155;font:12px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;backdrop-filter:blur(6px)}
    .igdc-proxy-static-bar b{color:#0f172a}.igdc-proxy-static-bar span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.igdc-proxy-static-bar a{flex:0 0 auto;color:#4f46e5;text-decoration:none;font-weight:800}
  </style>`;
  const bar = '<div class="igdc-proxy-static-bar"><span><b>IGDC 내부 원문</b> · ' + escapeHtml(finalUrl) + '</span><a href="' + escapeHtml(finalUrl) + '" target="_blank" rel="noopener noreferrer">원문 보기</a></div>';

  if(/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, '<head$1>' + meta + base + style);
  else out = '<head>' + meta + base + style + '</head>' + out;

  if(/<body[^>]*>/i.test(out)) out = out.replace(/<body([^>]*)>/i, '<body$1>' + bar);
  else out = '<body>' + bar + out + '</body>';

  if(!/<!doctype/i.test(out)) out = '<!doctype html>' + out;
  return out;
}

function errorHtml(title, message, target){
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:28px;color:#334155;background:#f8fafc}.box{max-width:720px;margin:40px auto;padding:22px;border:1px solid #e2e8f0;border-radius:16px;background:#fff}.url{word-break:break-all;color:#64748b;font-size:13px;background:#f1f5f9;border-radius:10px;padding:10px}</style></head><body><div class="box"><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(message) + '</p><p class="url">' + escapeHtml(target || '') + '</p></div></body></html>';
}

exports.handler = async function(event){
  if(event.httpMethod === 'OPTIONS') return json(200, { ok:true });
  const raw = event.queryStringParameters && event.queryStringParameters.url;
  if(!raw) return html(400, errorHtml('Missing url', '표시할 원문 주소가 없습니다.', ''));

  let target;
  try{
    target = new URL(raw);
    if(!/^https?:$/.test(target.protocol)) throw new Error('unsupported-protocol');
    await assertPublicTarget(target);
  }catch(e){
    return html(400, errorHtml('이 주소는 IGDC 내부 표시 대상으로 사용할 수 없습니다.', String(e && e.message || e), raw));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try{
    const upstream = await fetch(target.href, {
      method:'GET',
      redirect:'follow',
      signal: ctrl.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 IGDC-Search-Viewer/1.1',
        'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language':'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
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
    return html(upstream.status || 200, sanitizeExternalHtml(text, finalUrl));
  }catch(e){
    return html(502, errorHtml('원문을 내부 표시로 가져오지 못했습니다.', '사이트가 서버 접근을 차단했거나 응답 시간이 초과되었습니다.', target && target.href));
  }finally{
    clearTimeout(timer);
  }
};
