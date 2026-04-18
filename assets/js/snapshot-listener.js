
window.addEventListener('MARU_SEARCH_RESULT', function(e){
  const data = e.detail || {};
  if(!window.injectToSlots) return;

  window.injectToSlots(data);
});
