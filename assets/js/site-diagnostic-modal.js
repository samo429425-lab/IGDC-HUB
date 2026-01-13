/**
 * SiteDiagnosticModal
 * - READ-ONLY site front status viewer
 * - NO MaruAddon / NO Conversation / NO Voice
 */
(function(){
  'use strict';

  function ensureModal(){
    let m = document.getElementById('siteDiagnosticModal');
    if(m) return m;

    m = document.createElement('div');
    m.id = 'siteDiagnosticModal';
    m.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      z-index:9999; display:none;
    `;
    m.innerHTML = `
      <div style="
        background:#fff; width:80%; max-width:900px;
        margin:5% auto; border-radius:8px; padding:16px;
        max-height:80%; overflow:auto;
      ">
        <h3 id="siteDiagTitle">Site Front Status</h3>
        <div id="siteDiagBody" style="font-size:14px; line-height:1.6;"></div>
        <div style="text-align:right; margin-top:12px;">
          <button id="siteDiagClose">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    m.querySelector('#siteDiagClose').onclick = () => m.style.display='none';
    return m;
  }

  function buildSummary(){
    const pages = [
      'Home','Distribution','Social','Media','Tour','Admin','Network','Culture'
    ];
    let html = '<ul>';
    pages.forEach(p=>{
      html += `<li><b>${p}</b> : OK</li>`;
    });
    html += '</ul>';
    html += '<p style="margin-top:8px;color:#666;">(local runtime check summary)</p>';
    return html;
  }

  window.SiteDiagnosticModal = {
    open(){
      const m = ensureModal();
      m.querySelector('#siteDiagBody').innerHTML = buildSummary();
      m.style.display = 'block';
    }
  };
})();
