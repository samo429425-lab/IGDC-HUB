'use strict';
window.DCenterAuthReady=window.DCenterLocal?Promise.resolve():new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/assets/js/igdc-member-auth.js';s.onload=resolve;s.onerror=()=>reject(Error('IGDC 회원 인증 파일 연결 실패'));document.head.append(s);});
