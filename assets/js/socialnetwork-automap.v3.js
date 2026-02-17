
/* IGDC Social Network Automap v3.3 FINAL */

(function(){

  function normalize(raw){
    if(!Array.isArray(raw)) return [];
    return raw.map(function(it){
      return {
        title: it.title || it.name || '',
        url: it.url || it.link || '#',
        icon: it.icon || it.image || '',
        platform: (it.source || it.platform || '').toString().toLowerCase()
      };
    });
  }

  function getFeed(){
    return window.socialFeed || window.__SOCIAL_FEED__ || [];
  }

  function render(list){

    document.querySelectorAll('[data-psom-key]').forEach(function(box){

      // 기존 슬롯만 사용
      var slots = box.querySelectorAll('.thumb-card');

      if(!slots.length) return;

      list.forEach(function(item,i){

        if(!slots[i]) return;

        slots[i].innerHTML =
          '<div class="thumb-image">' +
            (item.icon ? '<img src="'+item.icon+'">' : '') +
          '</div>' +
          '<div class="thumb-title">'+item.title+'</div>' +
          '<div class="thumb-btn">' +
            '<a href="'+item.url+'" target="_blank">Open</a>' +
          '</div>';

      });

    });

  }

  function init(){

    var feed = getFeed();

    var items = normalize(feed);

    if(!items.length){
      console.warn('[SOCIAL] Empty feed');
      return;
    }

    render(items);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }

})();
