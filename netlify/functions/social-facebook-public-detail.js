'use strict';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=1800'
    },
    body: JSON.stringify(body)
  };
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function decodeHtml(value) {
  return text(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function (_m, n) {
      var code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_m, n) {
      var code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    });
}

function metaValue(html, names) {
  var source = String(html || '').slice(0, 1500000);
  for (var i = 0; i < names.length; i++) {
    var name = names[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var patterns = [
      new RegExp('<meta[^>]+(?:property|name)=["\\\']' + name + '["\\\'][^>]+content=["\\\']([^"\\\']+)["\\\'][^>]*>', 'i'),
      new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+(?:property|name)=["\\\']' + name + '["\\\'][^>]*>', 'i')
    ];
    for (var j = 0; j < patterns.length; j++) {
      var match = source.match(patterns[j]);
      if (match && match[1]) return decodeHtml(match[1]);
    }
  }
  return '';
}

function facebookUrl(value) {
  try {
    var u = new URL(text(value));
    if (u.protocol !== 'https:') return '';
    var host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'facebook.com' && host !== 'm.facebook.com' && host !== 'web.facebook.com' && host !== 'fb.watch') return '';
    return u.toString();
  } catch (_e) {
    return '';
  }
}

async function fetchText(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 5000);
  try {
    var response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error('http_' + response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async function (event) {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  var sourceUrl = facebookUrl(event.queryStringParameters && event.queryStringParameters.url);
  if (!sourceUrl) return json(400, { ok: false, error: 'invalid_facebook_url' });

  var embedUrl = 'https://www.facebook.com/plugins/post.php?' + new URLSearchParams({
    href: sourceUrl,
    show_text: 'true',
    width: '750'
  }).toString();

  try {
    var html = await fetchText(embedUrl, 5000);
    var title = metaValue(html, ['og:title', 'twitter:title']);
    var description = metaValue(html, ['og:description', 'twitter:description', 'description']);

    /* Some Facebook shells expose generic boilerplate instead of post text. Do not
       overwrite a useful stored snapshot with that. */
    if (/^(facebook|log in|see posts|connect with friends)/i.test(description)) description = '';

    return json(200, {
      ok: true,
      title: text(title).slice(0, 500),
      description: text(description).slice(0, 5000),
      sourceUrl
    });
  } catch (error) {
    return json(200, { ok: false, error: text(error && error.message) || 'facebook_detail_unavailable' });
  }
};
