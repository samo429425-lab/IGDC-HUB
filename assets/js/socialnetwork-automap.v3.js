
/* IGDC Social Network Automap v3.2 STABLE */

(function(){

  function normalize(raw){
    if(!Array.isArray(raw)) return [];
    return raw.map(function(it){
      return {
        title: it.title || it.name || '',
        url: it.url || it.link || '#',
        icon: it.icon || it.image || '',
        platform: (it.source || it.platform || '').toString().toLowerCase(),
        raw: it
      };
    });
  }

  function isBlocked(){
    return false; // FULLY DISABLED FOR STABILITY
  }

  function render(list){
    var containers = document.querySelectorAll('[data-psom-key]');
    if(!containers.length) return;

    containers.forEach(function(box){
      box.innerHTML = '';
      list.forEach(function(item){
        var card = document.createElement('div');
        card.className = 'thumb-card';
        card.innerHTML =
          '<div class="thumb-image">' + (item.icon ? '<img src="'+item.icon+'" />' : '') + '</div>' +
          '<div class="thumb-title">' + item.title + '</div>' +
          '<div class="thumb-btn"><a href="' + item.url + '" target="_blank">Open</a></div>';
        box.appendChild(card);
      });
    });
  }

  function init(){
    var feed = window.socialFeed || window.__SOCIAL_FEED__ || [];
    var items = normalize(feed).filter(function(it){
      return !isBlocked(it);
    });
    render(items);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }

})();
