// selfcheck-ui.js (browser-side widget)
// Renders a mini self-check panel and a modal chart by pinging Netlify Functions.
// Requirements in admin.html (near the bottom):
//   <div id="selfcheck-root"></div>
//   <script src="/assets/js/selfcheck-ui.js"></script>
(function(){
  const ROOT_ID = 'selfcheck-root';
  const ENDPOINTS = [
    '/.netlify/functions/selfcheck?health=1',           // primary health
    '/.netlify/functions/wallets?health=1',             // wallet func
    '/.netlify/functions/donation-summary?health=1'     // donation func
  ];
  const INTERVAL_MS = 15000; // 15s

  function h(tag, attrs={}, children=[]) {
    const el = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.assign(el.style, attrs[k]);
      } else if (k.startsWith('on') && typeof attrs[k] === 'function') {
        el.addEventListener(k.slice(2), attrs[k]);
      } else {
        el.setAttribute(k, attrs[k]);
      }
    }
    (Array.isArray(children) ? children : [children]).forEach(c=>{
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else if (c) el.appendChild(c);
    });
    return el;
  }

  function Bar(height, ok) {
    return h('div', { style: {
      height: Math.max(4, height)+'px',
      background: ok ? '#10b981' : '#ef4444',
      borderRadius: '4px 4px 0 0'
    }});
  }

  async function ping(url) {
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache:'no-store' });
      const ms = Math.round(performance.now() - t0);
      const txt = await r.text().catch(()=>'');
      return { url, ok: r.ok, ms, txt: txt.slice(0,300) };
    } catch(e) {
      return { url, ok:false, ms:0, txt: String(e).slice(0,200) };
    }
  }

  function buildUI(root) {
    const led = h('span', { id:'sc-led', style:{
      width:'10px', height:'10px', display:'inline-block',
      borderRadius:'9999px', background:'#9ca3af', marginRight:'8px'
    }});
    const title = h('h3', { style:{ margin:'0', fontSize:'15px' }}, '실시간 셀프체크');
    const updated = h('small', { id:'sc-updated', style:{ marginLeft:'auto', color:'#6b7280' }}, '-');

    const head = h('div', { style:{
      display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px'
    }}, [led, title, updated]);

    const bars = h('div', { id:'sc-mini', style:{
      display:'grid', gridTemplateColumns:'repeat(24,1fr)', gap:'4px',
      alignItems:'end', height:'56px', marginBottom:'8px'
    }});

    const statusWrap = h('div', { style:{ display:'flex', gap:'12px', flexWrap:'wrap' }}, [
      h('div', { style:{ minWidth:'160px' }}, [
        h('div', { style:{ fontSize:'12px', color:'#6b7280' }}, 'Selfcheck'),
        h('div', { id:'sc-s1', style:{ fontWeight:'600' }}, '-')
      ]),
      h('div', { style:{ minWidth:'160px' }}, [
        h('div', { style:{ fontSize:'12px', color:'#6b7280' }}, 'Wallets'),
        h('div', { id:'sc-s2', style:{ fontWeight:'600' }}, '-')
      ]),
      h('div', { style:{ minWidth:'160px' }}, [
        h('div', { style:{ fontSize:'12px', color:'#6b7280' }}, 'Donation'),
        h('div', { id:'sc-s3', style:{ fontWeight:'600' }}, '-')
      ]),
      h('div', { style:{ minWidth:'160px' }}, [
        h('div', { style:{ fontSize:'12px', color:'#6b7280' }}, 'Latency (ms)'),
        h('div', { id:'sc-lat', style:{ fontWeight:'600' }}, '-')
      ]),
      h('button', { id:'sc-open', style:{
        marginLeft:'auto', border:'1px solid #e5e7eb', background:'#f9fafb',
        borderRadius:'8px', padding:'6px 10px', cursor:'pointer'
      }}, '상세 보기')
    ]);

    const card = h('section', { id:'sc-card', style:{
      border:'1px solid #e5e7eb', borderRadius:'12px', background:'#fff', padding:'16px'
    }}, [head, bars, statusWrap]);

    // modal
    const modal = h('div', { id:'sc-modal', style:{
      position:'fixed', inset:'0', display:'none', alignItems:'center',
      justifyContent:'center', background:'rgba(0,0,0,.45)', zIndex:'9999'
    }}, [
      h('div', { style:{
        background:'#fff', borderRadius:'12px', width:'92%', maxWidth:'920px',
        padding:'16px', boxShadow:'0 10px 30px rgba(0,0,0,.15)'
      }}, [
        h('div', { style:{ display:'flex', alignItems:'center' }}, [
          h('h3', { style:{ margin:'0' }}, '실시간 셀프체크 — 상세'),
          h('button', { id:'sc-close', style:{
            marginLeft:'auto', border:'none', background:'transparent',
            fontSize:'22px', cursor:'pointer'
          }}, '×')
        ]),
        h('div', { id:'sc-big', style:{
          height:'260px', marginTop:'12px', border:'1px solid #e5e7eb',
          borderRadius:'8px', padding:'10px', display:'grid',
          gridTemplateColumns:'repeat(60,1fr)', gap:'3px', alignItems:'end'
        }}),
        h('pre', { id:'sc-log', style:{
          marginTop:'12px', background:'#0b1021', color:'#e5e7eb',
          padding:'10px', borderRadius:'8px', maxHeight:'220px', overflow:'auto'
        }}, '')
      ])
    ]);

    root.replaceChildren(card, modal);
    return { led, updated, bars, modal, big: modal.querySelector('#sc-big'),
             log: modal.querySelector('#sc-log'),
             openBtn: card.querySelector('#sc-open'),
             closeBtn: modal.querySelector('#sc-close'),
             s1: card.querySelector('#sc-s1'),
             s2: card.querySelector('#sc-s2'),
             s3: card.querySelector('#sc-s3'),
             lat: card.querySelector('#sc-lat') };
  }

  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const ui = buildUI(root);
  const history = [];

  async function once() {
    const results = await Promise.all(ENDPOINTS.map(ping));
    const okAll = results.every(r => r.ok);
    ui.led.style.background = okAll ? '#10b981' : '#ef4444';
    ui.updated.textContent = new Date().toLocaleString();

    ui.s1.textContent = results[0].ok ? 'OK' : 'ERR';
    ui.s2.textContent = results[1].ok ? 'OK' : 'ERR';
    ui.s3.textContent = results[2].ok ? 'OK' : 'ERR';
    ui.lat.textContent = results.map(r=>r.ms||0).join(' / ');

    // mini 24 bars
    history.push(okAll ? Math.max(4, 48 - Math.min(...results.map(r=>r.ms||999))/10) : 6);
    if (history.length > 24) history.shift();
    ui.bars.replaceChildren(...history.map(h => Bar(h, true)));

    // big 60 bars + log
    const bigH = okAll ? Math.max(6, 120 - Math.min(...results.map(r=>r.ms||999))) : 8;
    ui.big.appendChild(Bar(bigH, okAll));
    if (ui.big.childElementCount > 60) ui.big.removeChild(ui.big.firstChild);

    const line = `[${new Date().toISOString()}] ` + results.map(r => {
      return `${r.url.split('?')[0]}:${r.ok?'OK':'ERR'}(${r.ms}ms)`;
    }).join('  ');
    ui.log.textContent = (ui.log.textContent + '\n' + line).split('\n').slice(-200).join('\n');
  }

  ui.openBtn.addEventListener('click', () => ui.modal.style.display = 'flex');
  ui.closeBtn.addEventListener('click', () => ui.modal.style.display = 'none');

  once();
  setInterval(once, INTERVAL_MS);
})();
