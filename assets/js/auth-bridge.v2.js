(function(){console.warn('auth-bridge.v2.js placeholder');})();

(function(){
  function mirrorV2toV1(){
    try{
      const v2 = JSON.parse(localStorage.getItem('osauth.tokens.v2') || '{}');
      if (v2 && Object.keys(v2).length){
        localStorage.setItem('osauth.tokens.v1', JSON.stringify(v2));
      }
    }catch(e){}
  }
  document.addEventListener('DOMContentLoaded', mirrorV2toV1);
  window.addEventListener('osauth:ready', mirrorV2toV1);
})();

(function(){
  function blockDonationForRestrictedRoles(){
    try {
      const v2 = JSON.parse(localStorage.getItem('osauth.tokens.v2') || '{}');
      if (v2 && v2.id_token) {
        const payload = JSON.parse(atob(v2.id_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        const roles = payload["https://example.com/roles"] || [];
        if (roles.includes("DonationBlock")) {
          // 도네이션 메뉴 숨기기
          document.querySelectorAll('a[href*="donation"]').forEach(e => e.remove());
        }
      }
    } catch(e){}
  }
  window.addEventListener('osauth:ready', blockDonationForRestrictedRoles);
})();