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
      'Content-Security-Policy': "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; media-src * data: blob:; frame-src * data: blob:; connect-src * data: blob:;"
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
    // DNS failures should fail closed for proxying.
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

function injectShell(htmlText, targetUrl){
  const target = new URL(targetUrl);
  const baseHref = target.href;
  const base = '<base href="' + escapeHtml(baseHref) + '">';
  const meta = '<meta name="referrer" content="no-referrer-when-downgrade">';
  const style = `<style>
    html,body{min-height:100%;background:#fff!important;}
    img,video{max-width:100%;}
    a{cursor:pointer;}
    .igdc-proxy-notice{position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 9px;border-radius:9px;background:rgba(15,23,42,.78);color:#fff;font:12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18)}
  </style>`;
  const script = `<script>(function(){
    var PROXY='/.netlify/functions/search-page-proxy?url=';
    function abs(v){try{return new URL(v, location.href).href;}catch(e){return '';}}
    function prox(v){var u=abs(v); return u ? PROXY + encodeURIComponent(u) : v;}
    function patchLinks(){
      document.querySelectorAll('a[href]').forEach(function(a){
        var h=a.getAttribute('href')||'';
        if(!h || h.charAt(0)==='#' || /^javascript:/i.test(h) || /^mailto:|^tel:/i.test(h)) return;
        a.setAttribute('href', prox(h));
        a.removeAttribute('target');
      });
      document.querySelectorAll('form[action]').forEach(function(f){
        var h=f.getAttribute('action')||location.href;
        f.setAttribute('action', prox(h));
        f.setAttribute('method', (f.getAttribute('method')||'GET'));
      });
    }
    patchLinks();
    document.addEventListener('click', function(e){
      var a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if(!a) return;
      var h=a.getAttribute('href')||'';
      if(!h || h.charAt(0)==='#' || /^javascript:/i.test(h) || /^mailto:|^tel:/i.test(h)) return;
      if(!h.startsWith(PROXY)) a.setAttribute('href', prox(h));
    }, true);
    try{new MutationObserver(patchLinks).observe(document.documentElement,{subtree:true,childList:true});}catch(e){}
  })();</script>`;

  let out = String(htmlText || '');
  if(/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, '<head$1>' + base + meta + style);
  else out = base + meta + style + out;
  if(/<body[^>]*>/i.test(out)) out = out.replace(/<body([^>]*)>/i, '<body$1>' + script);
  else out += script;
  return out;
}

exports.handler = async function(event){
  if(event.httpMethod === 'OPTIONS') return json(200, { ok:true });
  const raw = event.queryStringParameters && event.queryStringParameters.url;
  if(!raw) return html(400, '<!doctype html><meta charset="utf-8"><p>Missing url</p>');

  let target;
  try{
    target = new URL(raw);
    if(!/^https?:$/.test(target.protocol)) throw new Error('unsupported-protocol');
    await assertPublicTarget(target);
  }catch(e){
    return html(400, '<!doctype html><meta charset="utf-8"><p>이 주소는 IGDC 내부 표시 대상으로 사용할 수 없습니다.</p><p>' + escapeHtml(String(e && e.message || e)) + '</p>');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try{
    const upstream = await fetch(target.href, {
      method:'GET',
      redirect:'follow',
      signal: ctrl.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 (compatible; IGDC-Search-Viewer/1.0; +https://igdc-test.netlify.app/)',
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
    return html(upstream.status || 200, injectShell(text, finalUrl));
  }catch(e){
    return html(502, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:28px;color:#334155;background:#f8fafc}.box{max-width:720px;margin:40px auto;padding:22px;border:1px solid #e2e8f0;border-radius:16px;background:#fff}.url{word-break:break-all;color:#64748b;font-size:13px}</style></head><body><div class="box"><h3>원문을 내부 표시로 가져오지 못했습니다.</h3><p>사이트가 서버 접근을 차단했거나 응답 시간이 초과되었습니다.</p><p class="url">' + escapeHtml(target && target.href) + '</p></div></body></html>');
  }finally{
    clearTimeout(timer);
  }
};
