
/*!
 * hero.rotator.js (patched, drop-in)
 * Behavior:
 * - Reads data attributes from the script tag:
 *     data-hero-sel   (default: '#hero')
 *     data-hero-src   (JSON path, required)
 *     data-interval   (ms, default: 30000)
 * - Renders INTO an inner slot within the container (priority):
 *     [data-hero-slot] > .hero-title > .hero > container
 * - Works under file:// by rewriting absolute '/assets/...' to './assets/...'
 * - Prevents double-initialization per container
 * - Exposes window.HeroRotator.mount(selector, opts)
 */
(function () {
  'use strict';

  function resolveDataUrl(src) {
    if (!src) return src;
    try {
      if (location.protocol === 'file:' && src.charAt(0) === '/') {
        return '.' + src; // turn /assets/... into ./assets/...
      }
    } catch (e) {}
    return src;
  }

  function pickMount(root) {
    if (!root) return null;
    return (
      root.querySelector('[data-hero-slot]') ||
      root.querySelector('.hero-title') ||
      root.querySelector('.hero') ||
      root
    );
  }

  function ensureContainerFlag(el) {
    if (!el) return false;
    if (el.__hero_rotator_initialized__) return false;
    el.__hero_rotator_initialized__ = true;
    return true;
  }

  function createEl(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else el.setAttribute(k, attrs[k]);
      }
    }
    return el;
  }

  function renderItem(mount, item) {
    if (!mount || !item) return;
    // clear old
    mount.innerHTML = '';
    var linkWrap = null;

    // choose media: video > img/poster > img
    if (item.src) {
      var video = createEl('video', { controls: '', playsinline: '', preload: 'metadata' });
      video.style.width = '100%';
      video.style.height = 'auto';
      var source = createEl('source', { src: item.src, type: item.type || 'video/mp4' });
      video.appendChild(source);
      if (item.poster) video.setAttribute('poster', item.poster);
      linkWrap = video;
    } else {
      // image fallback
      var imgSrc = item.poster || item.img;
      if (imgSrc) {
        var img = createEl('img', { src: imgSrc, alt: item.title || '' });
        img.style.width = '100%';
        img.style.height = 'auto';
        linkWrap = img;
      } else {
        // final fallback
        linkWrap = createEl('div', { text: item.title || 'No media' });
        linkWrap.style.padding = '48px';
      }
    }

    if (item.href) {
      var a = createEl('a', { href: item.href });
      a.appendChild(linkWrap);
      mount.appendChild(a);
    } else {
      mount.appendChild(linkWrap);
    }

    // optional caption
    if (item.title) {
      var cap = createEl('div', { text: item.title });
      cap.style.marginTop = '8px';
      cap.style.opacity = '0.85';
      mount.appendChild(cap);
    }
  }

  function startRotate(mount, list, interval) {
    if (!mount || !list || !list.length) return;
    var i = 0;
    renderItem(mount, list[i]);
    if (interval <= 0) return;
    setInterval(function () {
      i = (i + 1) % list.length;
      renderItem(mount, list[i]);
    }, interval);
  }

  function filterByPage(items, page) {
    if (!page) return items;
    try {
      return items.filter(function (it) {
        if (!it.page && !it.tags) return true;
        if (it.page && it.page === page) return true;
        if (it.tags && typeof it.tags.indexOf === 'function') {
          return it.tags.indexOf(page) >= 0;
        }
        return false;
      });
    } catch (e) { return items; }
  }

  function fetchJSON(url, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        try {
          var data = JSON.parse(xhr.responseText || 'null');
          cb(null, data);
        } catch (err) {
          cb(err || new Error('JSON parse error'));
        }
      }
    };
    xhr.onerror = function (e) { cb(e || new Error('Network error')); };
    xhr.send();
  }

  function mount(selector, opts) {
    var root = document.querySelector(selector || '#hero');
    if (!root) return;
    var mountEl = pickMount(root);
    if (!ensureContainerFlag(mountEl)) return; // already initialised

    var source = (opts && opts.source) || (root.getAttribute('data-hero-src'));
    var interval = (opts && opts.interval) || parseInt(root.getAttribute('data-interval') || '30000', 10);
    var page = opts && opts.page;

    // data-src may live on the script tag; try currentScript if empty
    if (!source && document.currentScript) {
      var ds = document.currentScript.getAttribute('data-hero-src');
      if (ds) source = ds;
    }
    if (!selector && document.currentScript) {
      var sel = document.currentScript.getAttribute('data-hero-sel');
      if (sel) {
        root = document.querySelector(sel);
        mountEl = pickMount(root);
      }
    }

    source = resolveDataUrl(source);
    if (!source) return;

    fetchJSON(source, function (err, json) {
      if (err || !json) return;
      var items = json.items || json || [];
      items = filterByPage(items, page || json.page || null);
      if (!items.length) return;
      startRotate(mountEl, items, interval);
    });
  }

  // auto init from script tag
  function autoInitFromScript() {
    var s = document.currentScript;
    if (!s) return;
    var sel = s.getAttribute('data-hero-sel') || '#hero';
    var src = s.getAttribute('data-hero-src');
    var itv = parseInt(s.getAttribute('data-interval') || '30000', 10);
    if (!src) return;
    document.addEventListener('DOMContentLoaded', function () {
      mount(sel, { source: src, interval: itv });
    });
  }

  // export
  window.HeroRotator = window.HeroRotator || { mount: mount };

  // run auto init if this file included with data- attrs
  autoInitFromScript();
})();
