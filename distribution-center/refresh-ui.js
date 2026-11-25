'use strict';
(()=>{const $=id=>document.getElementById(id);let selected=null,prepared=null;
const rows=()=>{const ids=new Set([...document.querySelectorAll('#products input[data-product]:checked')].map(x=>x.dataset.product));return (window.DCenterRows||[]).filter(x=>ids.has(x.id));};
const output=t=>$('source-refresh-result').textContent=t;
function invalidate(){prepared=null;$('source-refresh-apply').disabled=true;}
$('source-refresh').onclick=()=>{const list=rows();if(list.length!==1){msg('상품 하나를 선택하세요.');return;}selected=list[0];invalidate();$('source-refresh-json').value=JSON.stringify({source_ref:selected.source_ref,cost:selected.cost,stock:selected.stock},null,2);output('변경할 공급 자료를 입력한 후 비교하세요.');$('source-refresh-dialog').showModal();};
$('source-refresh-json').oninput=invalidate;
$('source-refresh-preview').onclick=()=>{invalidate();try{const incoming=JSON.parse($('source-refresh-json').value);const result=window.DCenterRefresh.plan(selected,incoming,window.DCenterLocal);prepared={incoming,result};output(JSON.stringify({변경:result.patch,보호또는제외:result.skipped},null,2));$('source-refresh-apply').disabled=!Object.keys(result.patch).length;}catch(e){output(e.message);}};
$('source-refresh-close').onclick=()=>$('source-refresh-dialog').close();
$('source-refresh-apply').onclick=()=>run(async()=>{if(!prepared)return;const {incoming}=prepared;invalidate();await api({action:'refresh',id:selected.id,revision:selected.revision,incoming});await load();$('source-refresh-dialog').close();msg('공급 자료 갱신 완료');});
$('market-server-check').onclick=()=>window.DCenterVerifyMarket();
})();
