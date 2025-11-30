
/*! IGDC Sections Ingest Helper (lightweight) */
(function(root){
  const IGDC = root.IGDC = root.IGDC || {};
  const cfg = IGDC.ingestConfig || {};

  function anyMatch(str, patterns){
    if(!str) return false;
    const s = String(str).toLowerCase();
    return patterns.some(p => new RegExp(p, 'i').test(s));
  }

  function classify(page, items, rules){
    const out = {};
    (rules || []).forEach(r => {
      if(r.if.page !== page) return;
      const to = r.to || {};
      items.forEach(it => {
        const hayTags = (Array.isArray(it.tags) ? it.tags.join(' ') : '') + ' ' + (it.desc || '') + ' ' + (it.title || '');
        const hayUrl  = (it.url || it.href || '');
        const tagsOk = r.if.tags ? anyMatch(hayTags, r.if.tags) : true;
        const urlOk  = r.if.url ? anyMatch(hayUrl, r.if.url) : true;
        if(tagsOk && urlOk){
          const key = (to.panel === 'right') ? `right::${to.section}` : `grid::${to.section}`;
          (out[key] = out[key] || []).push(it);
        }
      });
    });
    return out;
  }

  IGDC.ingest = IGDC.ingest || {};
  IGDC.ingest.classify = function(page, items, rules){
    return classify(page, items, rules);
  };
})(window);
