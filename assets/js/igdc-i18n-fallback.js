/*! igdc-i18n-fallback.cleaned.js */
/* 언어 코드 정리만 담당. 폴백은 index.html에서 처리 */

(function(){
  'use strict';
  // 지원 언어 (여기서는 코드만 정리)
  var ALIAS={
    'kr':'ko','ko-kr':'ko','ko_kr':'ko','KO':'ko','korean':'ko',
    'zh-cn':'zh','zh_cn':'zh','zh-hans':'zh','zh-tw':'zh','zh-hant':'zh',
    'en-us':'en','en-gb':'en','EN':'en'
  };

  function norm(x){
    if(!x) return 'en';
    var s=(''+x).trim().toLowerCase();
    if(ALIAS[s]) s=ALIAS[s];
    if(s.includes('-')||s.includes('_')) s=s.split(/[-_]/)[0];
    return s;
  }

  function getLang(){
    try{
      var s=document.documentElement.getAttribute('lang')
        || localStorage.getItem('igdc_lang')
        || (navigator.language||'en');
      return norm(s);
    }catch(_){ return 'en'; }
  }

  // 클릭 시에도 언어 코드만 정리해서 넘겨줌
  document.addEventListener('click',function(e){
    var a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    try{
      var url=new URL(a.href,location.href);
      if(url.origin!==location.origin) return;
      var lang=getLang();
      if(!url.searchParams.get('lang')){
        url.searchParams.set('lang',lang);
        a.href=url.toString();
      }
    }catch(_){}
  },{capture:true});
})();