/* === SAFE ATTACH : Site Diagnostic Modal Trigger ===
 * This block is ADD-ONLY. Do not remove existing code.
 */
(function(){
  try{
    const card = document.querySelector('[data-site-diagnostic], .site-ai-diagnostic');
    if(card){
      card.addEventListener('click', function(e){
        e.stopPropagation();
        window.SiteDiagnosticModal && SiteDiagnosticModal.open();
      });
    }
  }catch(e){}
})();
