/* IGDC administrator checkbox accessibility v1.0 */
(function(){
  'use strict';
  if(window.__IGDC_ADMIN_CHECKBOX_ACCESSIBILITY_V1__)return;
  window.__IGDC_ADMIN_CHECKBOX_ACCESSIBILITY_V1__=true;

  function enhance(root){
    var scope=root&&root.querySelectorAll?root:document;
    var boxes=scope.querySelectorAll('input[type="checkbox"]');
    Array.prototype.forEach.call(boxes,function(box){
      if(box.dataset.igdcCheckboxA11y==='1')return;
      box.dataset.igdcCheckboxA11y='1';
      box.classList.add('igdc-admin-checkbox');
      var label=box.closest&&box.closest('label');
      if(label)label.classList.add('igdc-checkbox-label');
      var cell=box.closest&&box.closest('td,th');
      if(cell)cell.classList.add('igdc-checkbox-hit');
    });
  }

  function toggleFromCell(event){
    var target=event.target;
    if(!target||!target.closest)return;
    var cell=target.closest('.igdc-checkbox-hit');
    if(!cell)return;
    if(target.closest('input,button,a,select,textarea,label'))return;
    var box=cell.querySelector('input[type="checkbox"]');
    if(!box||box.disabled)return;
    box.checked=!box.checked;
    box.dispatchEvent(new Event('change',{bubbles:true}));
    box.focus({preventScroll:true});
  }

  function boot(){
    enhance(document);
    document.addEventListener('click',toggleFromCell,false);
    if(window.MutationObserver){
      var observer=new MutationObserver(function(records){
        records.forEach(function(record){
          Array.prototype.forEach.call(record.addedNodes||[],function(node){
            if(node&&node.nodeType===1){
              if(node.matches&&node.matches('input[type="checkbox"]'))enhance(node.parentNode||document);
              else enhance(node);
            }
          });
        });
      });
      observer.observe(document.documentElement||document.body,{childList:true,subtree:true});
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
