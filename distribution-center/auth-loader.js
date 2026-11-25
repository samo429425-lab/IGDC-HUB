'use strict';
window.DCenterAuthReady=window.DCenterLocal?Promise.resolve():new Promise((resolve,reject)=>{
 try{if(window.parent!==window&&window.parent.location.origin===location.origin&&window.parent.document.getElementById('mainFrame')?.contentWindow===window){
   const parentAuth=()=>window.parent.IGDCMemberAuth;
   window.IGDCMemberAuth={getIdToken:()=>parentAuth()?.getIdToken?.()||null};
   const events=['osauth:ready','osauth:done','igdc:member-auth-ready','igdc:auth-storage-ready','igdc:session-refresh-complete'];
   const relay=()=>document.dispatchEvent(new Event('dcenter:parent-auth'));
   for(const event of events)window.parent.document.addEventListener(event,relay);
   window.addEventListener('pagehide',()=>{for(const event of events)window.parent.document.removeEventListener(event,relay);},{once:true});
   resolve();return;
 }}catch{}
 const s=document.createElement('script');s.src='/assets/js/igdc-member-auth.js';s.onload=resolve;s.onerror=()=>reject(Error('IGDC 회원 인증 파일 연결 실패'));document.head.append(s);
});
