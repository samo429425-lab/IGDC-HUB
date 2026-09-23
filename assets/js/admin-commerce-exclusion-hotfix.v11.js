/* IGDC Distribution exclusion/hold UI isolation v12
 * UI-only: selection counters + one-open-at-a-time accordions.
 * All write actions remain owned by admin-commerce-country-control.js so
 * supplier/product ledgers use the canonical handlers and legacy/candidate
 * routing. No front publication or database mutation occurs in this file.
 */
(function(){
  'use strict';
  function syncSupplier(kind){
    var boxes=Array.prototype.slice.call(document.querySelectorAll('[data-supplier-select="'+kind+'"]')).filter(function(x){return !x.disabled;}),selected=boxes.filter(function(x){return x.checked;}),all=document.getElementById(kind==='hold'?'supplierHoldSelectAll':kind==='blocked'?'supplierBlockedSelectAll':'supplierActiveSelectAll');
    if(all){all.disabled=boxes.length===0;all.checked=boxes.length>0&&selected.length===boxes.length;all.indeterminate=selected.length>0&&selected.length<boxes.length;}
    var count=document.getElementById(kind==='hold'?'supplierHoldSelectedCount':kind==='blocked'?'supplierBlockedSelectedCount':'supplierActiveSelectedCount');if(count)count.textContent='선택 '+selected.length+'건';
  }
  function syncProduct(kind){
    var boxes=Array.prototype.slice.call(document.querySelectorAll('[data-product-exclusion-select="'+kind+'"]')).filter(function(x){return !x.disabled;}),selected=boxes.filter(function(x){return x.checked;}),all=document.getElementById(kind==='hold'?'productHoldSelectAll':'productRejectSelectAll');
    if(all){all.disabled=boxes.length===0;all.checked=boxes.length>0&&selected.length===boxes.length;all.indeterminate=selected.length>0&&selected.length<boxes.length;}
    var count=document.getElementById(kind==='hold'?'productHoldSelectedCount':'productRejectSelectedCount');if(count)count.textContent='선택 '+selected.length+'건';
  }
  function exclusive(details){if(!details.open)return;['supplierControlQueue','productHoldQueue','productRejectQueue'].forEach(function(id){var other=document.getElementById(id);if(other&&other!==details&&other.open)other.open=false;});}
  function observeList(id,sync){var root=document.getElementById(id);if(!root||root.dataset.v12Observer==='1')return;root.dataset.v12Observer='1';var queued=false,observer=new MutationObserver(function(){if(queued)return;queued=true;(window.requestAnimationFrame||function(fn){return setTimeout(fn,0);})(function(){queued=false;sync();});});observer.observe(root,{subtree:true,childList:true});}
  function wire(){
    ['supplierControlQueue','productHoldQueue','productRejectQueue'].forEach(function(id){var d=document.getElementById(id);if(d&&!d.dataset.v12Exclusive){d.dataset.v12Exclusive='1';d.addEventListener('toggle',function(){exclusive(d);});}});
    observeList('supplierHoldRows',function(){syncSupplier('hold');});observeList('supplierBlockedRows',function(){syncSupplier('blocked');});observeList('productHoldRows',function(){syncProduct('hold');});observeList('productRejectRows',function(){syncProduct('reject');});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();
