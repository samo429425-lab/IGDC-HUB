(function(global){
  'use strict';
  function ready(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    try{
      var grids = document.querySelectorAll('[data-media-grid], .media-grid, .content-grid');
      grids.forEach(function(grid){
        if(grid.children && grid.children.length) return;
        grid.setAttribute('data-maru-empty','1');
      });
    }catch(e){}
  });
  global.MaruMediaEmptyHandler = global.MaruMediaEmptyHandler || { ready:true };
})(window);
