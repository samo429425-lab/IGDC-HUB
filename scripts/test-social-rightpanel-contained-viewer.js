#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../assets/js/socialnetwork-automap-v3.js'), 'utf8');

function element(tag, id) {
  const attributes = {};
  const el = {
    tagName: tag.toUpperCase(), id: id || '', dataset: {}, style: {}, children: [], listeners: {},
    innerHTML: '', className: '', textContent: '', clientWidth: 100, scrollWidth: 100,
    clientHeight: 100, scrollHeight: 100, scrollTop: 0, scrollLeft: 0,
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    appendChild(child) { if (child.tagName === '#FRAGMENT') this.children.push(...child.children); else this.children.push(child); return child; },
    getAttribute(k) { return attributes[k] || null; },
    setAttribute(k, v) { attributes[k] = String(v); },
    removeAttribute(k) { delete attributes[k]; },
    querySelector(sel) { if (sel === 'a') return this.children.find(x => x.tagName === 'A') || null; return null; },
    get hrefAttr() { return this.href; },
  };
  return el;
}

async function flush() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }

async function run() {
  const calls = [], fetchCalls = [], scriptUrls = [], pageLinks = {}, callbacks = {};
  const panelDesktop = element('div', 'rightAutoPanel');
  const panelMobile = element('div', 'rpMobileGrid');
  // Mobile scroll parent is required for the actual mobile render path.
  const scroller = element('div', 'rpMobileScroller');
  panelMobile.closest = (s) => s === '#rpMobileScroller' ? scroller : null;
  let viewerMode = 'success';
  const win = {
    __MARU_REVENUE_AUTOMAP_LOADER_DONE__: true,
    IGDCContainedViewer: null,
    addEventListener(evt, fn) { (callbacks[evt] ||= []).push(fn); },
    location: { origin: 'https://igdcglobal.com', pathname: '/socialnetwork', href: 'https://igdcglobal.com/socialnetwork?lang=ko' },
  };
  const docs = new Map();
  const doc = {
    readyState: 'loading',
    head: element('head'), documentElement: element('html'), body: element('body'),
    addEventListener(evt, fn) { (callbacks[evt] ||= []).push(fn); },
    querySelectorAll(sel) {
      if (sel === '[data-psom-key="rightPanel"]') return [panelDesktop, panelMobile];
      return [];
    },
    querySelector() { return null; },
    createElement(tag) { return element(tag); },
    createDocumentFragment() { return element('#fragment'); },
    getElementById(id) { return docs.get(id) || null; },
  };
  const nativeAppend = doc.head.appendChild.bind(doc.head);
  doc.head.appendChild = function (el) {
    nativeAppend(el);
    if (el.id) docs.set(el.id, el);
    if (el.tagName === 'SCRIPT') {
      scriptUrls.push(el.src);
      setImmediate(() => {
        if (viewerMode === 'success') {
          win.IGDCContainedViewer = { version: 11, open(url, opts) { calls.push({ url, opts }); return true; } };
          (el.listeners.load || []).forEach(fn => fn());
        } else {
          (el.listeners.error || []).forEach(fn => fn());
        }
      });
    }
    return el;
  };
  const snap = { pages: { social: { sections: { rightPanel: [
    { id:'waug-104520', title:'인천공항 공항철도 AREX 직통열차 티켓', image:'https://cdn.example.net/train.webp', url:'https://www.waug.com/ko/activities/104520' },
    { id:'internal-only', title:'내부 상품', image:'https://cdn.example.net/other.webp' }
  ] } } } };
  const context = vm.createContext({
    window: win, document: doc, navigator: { language: 'ko' },
    console: { log(){}, warn(){}, error(){} },
    fetch: async (url) => { fetchCalls.push(url); return url === '/data/social.snapshot.json' ? { ok:true, json:async()=>snap } : { ok:false }; },
    sessionStorage: { getItem:()=>null, setItem(){} },
    setTimeout: (fn)=>{ setImmediate(fn); return 1; }, clearTimeout(){},
    setInterval(){}, URL, Promise, Date, Map, Set, WeakMap, Array, Number,
  });
  vm.runInContext(code, context, { filename: 'socialnetwork-automap-v3.js' });
  for (const fn of callbacks.DOMContentLoaded || []) fn();
  await flush();
  assert.equal(fetchCalls[0], '/data/social.snapshot.json', 'rightPanel keeps Canonical/IP snapshot source');
  assert.equal(panelDesktop.children.length, 2, 'desktop right rail renders both verified items');
  assert.equal(panelMobile.children.length, 2, 'mobile right rail renders both verified items');
  for (const panel of [panelDesktop, panelMobile]) {
    const first = panel.children[0].children[0];
    assert.equal(first.tagName, 'A');
    assert.equal(first.target, '_self', 'external URL must never get _top target');
    assert.equal(first.getAttribute('data-igdc-external'), null, 'must not trigger shared top navigation');
    assert.equal(first.getAttribute('data-igdc-contained-product'), '1');
    assert.equal(first.href, 'https://www.waug.com/ko/activities/104520', 'original verified seller URL preserved');
    assert.equal(first.children[0].src, 'https://cdn.example.net/train.webp', 'original thumbnail preserved');
    assert.equal(first.children[1].textContent, '인천공항 공항철도 AREX 직통열차 티켓');
    const second = panel.children[1].children[0];
    assert.equal(second.href, '/content.html?id=internal-only');
    assert.equal(second.target, '_self');
    assert.equal(second.getAttribute('data-igdc-contained-product'), null);
  }
  const first = panelDesktop.children[0].children[0];
  const ordinaryClick = { defaultPrevented:false, button:0, ctrlKey:false, shiftKey:false, metaKey:false, altKey:false, preventDefault(){this.defaultPrevented=true;}, stopPropagation(){this.stopped=true;} };
  for (const fn of first.listeners.click || []) fn(ordinaryClick);
  assert.equal(ordinaryClick.defaultPrevented, true, 'normal click must be intercepted synchronously');
  assert.equal(ordinaryClick.stopped, true);
  await flush();
  assert.equal(calls.length, 1, 'one viewer open for one click');
  assert.equal(calls[0].url, 'https://www.waug.com/ko/activities/104520');
  assert.equal(calls[0].opts.kind, 'commerce-product');
  assert.equal(calls[0].opts.pushHistory, true);
  assert.equal(scriptUrls.length, 1, 'existing commerce viewer lazily loaded only once');
  assert.ok(scriptUrls[0].includes('igdc-contained-external-viewer.js'));
  // The mobile click uses the very same viewer but never creates a second script.
  const mobile = panelMobile.children[0].children[0];
  const mobileClick = { ...ordinaryClick, defaultPrevented:false, preventDefault(){this.defaultPrevented=true;}, stopPropagation(){this.stopped=true;} };
  for (const fn of mobile.listeners.click || []) fn(mobileClick);
  await flush();
  assert.equal(calls.length, 2, 'mobile right product launches same contained viewer');
  assert.equal(scriptUrls.length, 1);
  const modifiedClick = { ...ordinaryClick, defaultPrevented:false, ctrlKey:true, preventDefault(){this.defaultPrevented=true;} };
  for (const fn of first.listeners.click || []) fn(modifiedClick);
  await flush();
  assert.equal(modifiedClick.defaultPrevented, false, 'explicit Ctrl-click keeps browser-native behavior');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.label, '인천공항 공항철도 AREX 직통열차 티켓');
  assert.equal(win.location.href, 'https://igdcglobal.com/socialnetwork?lang=ko', 'IGDC page location unchanged');
  console.log('PASS: canonical IP snapshot, desktop/mobile card, thumb/title/URL preserved, _top blocked, viewer opens, Ctrl-click, same-page navigation');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
