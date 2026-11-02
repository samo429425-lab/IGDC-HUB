/* IGDC program download analytics (requests only; revenue and app binaries untouched). */
(function(){
'use strict';
var API='/.netlify/functions/maru-windows-download-metrics';
var INITIAL=[{program:'maru_windows_player',name:'MARU Media Player (Windows)'},{program:'maru_capture_windows',name:'MARU Capture (Windows)'}];
var programs=INITIAL.slice(), lastDetail=null, busySummary=false, busyDetail=false;
var COLS=['day','week','month','year','total'];
function byId(id){return document.getElementById(id);}
function fmt(n){var x=Number(n);return isFinite(x)&&x>=0?Math.round(x).toLocaleString('ko-KR'):'—';}
function text(v){return String(v==null?'':v);}
function validId(v){return /^[a-z][a-z0-9_]{2,63}$/.test(v);}
function status(v,err){var e=byId('maru-win-download-status');if(e){e.textContent=v;e.style.color=err?'#a32323':'#476783';}}
function detailsStatus(v,err){var e=byId('maru-win-detail-status');if(e){e.textContent=v;e.style.color=err?'#a32323':'#476783';}}
function tokenFrom(value,depth){
  if(depth>4||value==null)return '';
  if(typeof value==='string'){
    var s=value.trim();if(s.split('.').length===3&&s.length>100)return s;
    try{return tokenFrom(JSON.parse(s),depth+1);}catch(_){return '';}
  }
  if(typeof value==='object'){
    var keys=['id_token','idToken','access_token','accessToken','token','jwt'];
    for(var i=0;i<keys.length;i++){if(value[keys[i]]){var t=tokenFrom(value[keys[i]],depth+1);if(t)return t;}}
  }
  return '';
}
function adminToken(){
  try{if(window.IGDCMemberAuth&&typeof window.IGDCMemberAuth.getIdToken==='function'){
    var direct=tokenFrom(window.IGDCMemberAuth.getIdToken(),0);if(direct)return direct;
  }}catch(_e){}
  try{if(window.osAuth&&typeof window.osAuth.getIdToken==='function'){
    var t=tokenFrom(window.osAuth.getIdToken(),0);if(t)return t;
  }}catch(_e){}
  var keys=['osauth.tokens.v2','osauth.tokens.v1','igdc.auth.tokens','igdc.tokens','igdc_auth_tokens','auth0_tokens','igdc_id_token','id_token','igdc_access_token','access_token','igdc.mediaCandidateQueue.adminBearer'];
  for(var s=0;s<2;s++){
    var storage;try{storage=s?window.localStorage:window.sessionStorage;}catch(_){continue;}
    for(var j=0;j<keys.length;j++){
      try{var t2=tokenFrom(storage.getItem(keys[j]),0);if(t2)return t2;}catch(_e){}
    }
  }
  return '';
}
function nameOf(id){var p=programs.find(function(row){return row.program===id;});return p?p.name:id;}
function clear(node){if(node)while(node.firstChild)node.removeChild(node.firstChild);}
function appendCell(row,tag,value){var c=document.createElement(tag);c.textContent=text(value);row.appendChild(c);return c;}
function emptyRow(target,columns,message){clear(target);var tr=document.createElement('tr');var td=appendCell(tr,'td',message);td.colSpan=columns;target.appendChild(tr);}
function updatePrograms(list){
  var registry=new Map();INITIAL.forEach(function(row){registry.set(row.program,row);});
  (Array.isArray(list)?list:[]).forEach(function(row){if(row&&validId(row.program)){registry.set(row.program,{program:row.program,name:text(row.name||row.program),enabled:row.enabled!==false});}});
  programs=Array.from(registry.values());
  var select=byId('maru-win-program-filter');if(!select)return;
  var old=select.value||'all';clear(select);
  var option=document.createElement('option');option.value='all';option.textContent='전체 프로그램';select.appendChild(option);
  programs.forEach(function(row){var op=document.createElement('option');op.value=row.program;op.textContent=row.name;select.appendChild(op);});
  select.value=programs.some(function(p){return p.program===old;})?old:'all';
}
function renderSummary(data){
  if(!data||data.ok!==true||!data.byProgram)throw new Error('invalid_summary');
  updatePrograms(data.programs);
  var tbody=byId('maru-win-download-rows');if(tbody){clear(tbody);
    programs.forEach(function(p){
      var tr=document.createElement('tr');tr.setAttribute('data-win-program',p.program);appendCell(tr,'th',p.name);
      COLS.forEach(function(col){var cell=appendCell(tr,'td',fmt((data.byProgram[p.program]||{})[col]||0));cell.setAttribute('data-col',col);});tbody.appendChild(tr);
    });
  }
  var countries=byId('maru-win-download-countries');if(countries){clear(countries);
    var arr=Array.isArray(data.countries30d)?data.countries30d:[];
    if(!arr.length){countries.textContent='최근 30일 국가별 요청 기록이 없습니다.';}
    arr.forEach(function(row){var e=document.createElement('span');e.className='maru-win-country-chip';e.textContent=nameOf(row.program)+' · '+text(row.country||'ZZ')+' '+fmt(row.count);countries.appendChild(e);});
  }
  status('실제 기록 조회 완료 · '+text(data.timezone||'Asia/Seoul')+' 기준',false);
}
function errorMessage(err,detail){
  var code=text(err&&err.message||'');
  if(code==='metrics_database_setup_required')return detail?'상세 통계 확장용 SQL을 Supabase에서 1회 실행해야 합니다.':'통계 저장소 SQL 설정이 필요합니다.';
  if(code==='metrics_storage_not_configured')return 'Netlify의 통계 DB 연결 설정을 확인해야 합니다.';
  if(/administrator_required|login|required|invalid|401|403/i.test(code))return '관리자 로그인·접근 권한을 확인해야 합니다.';
  return '집계 서버 연결에 실패했습니다. 수치를 임의로 표시하지 않습니다.';
}
async function api(view,params,body){
  var token=adminToken();if(!token)throw new Error('administrator_required');
  var url=API;
  var q=new URLSearchParams(params||{});if(view)q.set('view',view);if(q.toString())url+='?'+q.toString();
  var response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin'});
  var data=await response.json();if(!response.ok||!data||data.ok!==true)throw new Error(data&&data.error||'metrics_request_failed');
  return data;
}
async function refresh(){
  if(busySummary)return;busySummary=true;
  var btn=byId('maru-win-download-refresh');if(btn)btn.disabled=true;
  status('다운로드 요청 집계 조회 중…',false);
  try{renderSummary(await api('',{}));}
  catch(e){var body=byId('maru-win-download-rows');if(body){body.querySelectorAll('td').forEach(function(cell){cell.textContent='—';});}var countryBox=byId('maru-win-download-countries');if(countryBox)countryBox.textContent='조회 불가';status(errorMessage(e,false),true);}
  finally{busySummary=false;if(btn)btn.disabled=false;}
}
function axisDates(period,unit,series){
  if(period==='all')return series.map(function(x){return x.bucket;});
  var output=[],now=new Date(), localParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  var parts={};localParts.forEach(function(p){parts[p.type]=p.value;});
  var today=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day)));
  function iso(d){return d.toISOString().slice(0,10);}
  if(unit==='week'){
    var first=new Date(today);first.setUTCDate(first.getUTCDate()-364);
    var weekday=(first.getUTCDay()+6)%7;first.setUTCDate(first.getUTCDate()-weekday);
    for(var w=0;w<55;w++){var date=new Date(first);date.setUTCDate(date.getUTCDate()+w*7);if(date>today)break;output.push(iso(date));}
  }else{
    var days=period==='7d'?7:period==='30d'?30:90;
    for(var i=days-1;i>=0;i--){var d=new Date(today);d.setUTCDate(d.getUTCDate()-i);output.push(iso(d));}
  }
  return output;
}
function filledSeries(data){
  var dict=new Map();(data.series||[]).forEach(function(r){dict.set(r.bucket,Number(r.count)||0);});
  return axisDates(data.period,data.bucketUnit,data.series||[]).map(function(bucket){return{bucket:bucket,count:dict.get(bucket)||0};});
}
function svgEl(tag,attrs){var el=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.keys(attrs||{}).forEach(function(k){el.setAttribute(k,String(attrs[k]));});return el;}
function plot(data){
  var root=byId('maru-win-download-chart');if(!root)return;clear(root);
  var series=filledSeries(data),w=840,h=230,ml=44,mr=16,mt=16,mb=34,pw=w-ml-mr,ph=h-mt-mb;
  var max=Math.max(1,...series.map(function(x){return Number(x.count)||0;}));
  var svg=svgEl('svg',{viewBox:'0 0 '+w+' '+h,role:'img','aria-label':'다운로드 요청 추이 그래프. 최대 '+fmt(max)+'건',preserveAspectRatio:'xMidYMid meet'});
  [0,.25,.5,.75,1].forEach(function(frac){var y=mt+ph*(1-frac);
    svg.appendChild(svgEl('line',{x1:ml,y1:y,x2:w-mr,y2:y,stroke:'#e2eaf3','stroke-width':1}));
    var t=svgEl('text',{x:ml-7,y:y+4,'text-anchor':'end','font-size':12,fill:'#576b82'});t.textContent=fmt(Math.round(max*frac));svg.appendChild(t);
  });
  var pts=series.map(function(row,i){return{x:ml+(series.length>1?i/(series.length-1):.5)*pw,y:mt+ph*(1-(row.count/max)),row:row};});
  if(pts.length){
    var poly=svgEl('polyline',{points:pts.map(function(p){return p.x+','+p.y;}).join(' '),fill:'none',stroke:'#2769c2','stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round'});svg.appendChild(poly);
    pts.forEach(function(p,i){if(pts.length<=35||i%Math.ceil(pts.length/35)===0){var c=svgEl('circle',{cx:p.x,cy:p.y,r:3,fill:'#2769c2'});var title=svgEl('title');title.textContent=p.row.bucket+' : '+fmt(p.row.count)+'건';c.appendChild(title);svg.appendChild(c);}});
    var ticks=[0,Math.floor((pts.length-1)/2),pts.length-1];new Set(ticks).forEach(function(i){var p=pts[i];var t=svgEl('text',{x:p.x,y:h-8,'text-anchor':i===0?'start':i===pts.length-1?'end':'middle','font-size':12,fill:'#576b82'});t.textContent=p.row.bucket;svg.appendChild(t);});
  }
  root.appendChild(svg);
}
function statsTable(id,rows,labelKey,mapper){
  var target=byId(id);if(!target)return;clear(target);
  if(!rows||!rows.length){emptyRow(target,3,'해당 기간의 요청 기록이 없습니다.');return;}
  rows.forEach(function(row,i){
    var tr=document.createElement('tr');appendCell(tr,'td',String(i+1));appendCell(tr,'td',mapper?mapper(row[labelKey]):text(row[labelKey]||'미확인'));
    appendCell(tr,'td',fmt(row.count));target.appendChild(tr);
  });
}
function renderDetail(data){
  lastDetail=data;updatePrograms(data.programs);
  byId('maru-win-detail-total').textContent=fmt(data.total)+'건';
  byId('maru-win-detail-asof').textContent='기준: '+(data.timezone||'Asia/Seoul')+' · 다운로드 요청 수';
  plot(data);
  statsTable('maru-win-detail-country',data.countries,'code',function(v){if(!v||v==='ZZ')return '국가 미확인 (ZZ)';try{return new Intl.DisplayNames(['ko'],{type:'region'}).of(v)+' ('+v+')';}catch(_){return text(v);}});
  var os={windows:'Windows',mac:'macOS',android:'Android',ios:'iOS',linux:'Linux',unknown:'미확인'};
  statsTable('maru-win-detail-device',data.devices,'family',function(v){return os[v]||v;});
  statsTable('maru-win-detail-program',data.byProgram,'program',nameOf);
  var exportButton=byId('maru-win-export');if(exportButton)exportButton.disabled=false;
  detailsStatus('상세 통계 조회 완료 · '+(data.series||[]).length+'개 기간 구간',false);
}
async function refreshDetail(){
  if(busyDetail)return;
  var panel=byId('maru-win-detail-panel');if(!panel||!panel.open)return;
  busyDetail=true;var btn=byId('maru-win-detail-refresh');if(btn)btn.disabled=true;
  detailsStatus('기간별 통계를 조회 중…',false);
  try{
    var period=byId('maru-win-period').value,program=byId('maru-win-program-filter').value;
    renderDetail(await api('detail',{period:period,program:program}));
  }catch(e){lastDetail=null;var b=byId('maru-win-export');if(b)b.disabled=true;var total=byId('maru-win-detail-total');if(total)total.textContent='—';clear(byId('maru-win-download-chart'));['maru-win-detail-country','maru-win-detail-device','maru-win-detail-program'].forEach(function(id){var t=byId(id);if(t)emptyRow(t,3,'조회 불가');});detailsStatus(errorMessage(e,true),true);}
  finally{busyDetail=false;if(btn)btn.disabled=false;}
}
function csvEscape(v){var s=text(v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function exportCSV(){
  if(!lastDetail)return;
  var d=lastDetail,rows=[['분류','항목','다운로드 요청 수']];
  (d.series||[]).forEach(function(r){rows.push(['기간',r.bucket,r.count]);});
  (d.countries||[]).forEach(function(r){rows.push(['국가',r.code,r.count]);});
  (d.devices||[]).forEach(function(r){rows.push(['운영체제',r.family,r.count]);});
  (d.byProgram||[]).forEach(function(r){rows.push(['프로그램 '+r.program,nameOf(r.program),r.count]);});
  rows.push(['전체','합계',d.total]);
  var csv='\ufeff'+rows.map(function(r){return r.map(csvEscape).join(',');}).join('\r\n');
  var url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));var a=document.createElement('a');a.href=url;
  a.download='IGDC_download_requests_'+d.period+'_'+d.program+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},3000);
}
async function register(ev){
  ev.preventDefault();var form=byId('maru-win-program-add');if(!form)return;
  var button=byId('maru-win-register');if(button)button.disabled=true;
  var name=byId('maru-win-new-name').value.trim(),id=byId('maru-win-new-id').value.trim(),url=byId('maru-win-new-url').value.trim();
  if(!validId(id)){detailsStatus('프로그램 식별자는 영문 소문자·숫자·밑줄만 사용하세요 (3~64자).',true);if(button)button.disabled=false;return;}
  try{
    await api('',{}, {action:'register_program',program:id,name:name,url:url});
    form.reset();detailsStatus('프로그램이 등록됐습니다. 다운로드 페이지에 추가되며 앞으로 발생하는 요청부터 집계됩니다.',false);
    await refresh();await refreshDetail();
  }catch(e){detailsStatus(e.message==='program_already_registered'?'이미 등록된 프로그램입니다.':e.message==='invalid_program_registration'?'프로그램명 또는 다운로드 주소가 허용 기준과 다릅니다. 공식 GitHub Release 주소를 사용하세요.':errorMessage(e,true),true);}
  finally{if(button)button.disabled=false;}
}
function start(){
  var refreshBtn=byId('maru-win-download-refresh');if(!refreshBtn||refreshBtn.dataset.bound==='1')return;
  refreshBtn.dataset.bound='1';refreshBtn.addEventListener('click',refresh);
  var detail=byId('maru-win-detail-panel');if(detail){detail.addEventListener('toggle',function(){if(detail.open)refreshDetail();});}
  var dBtn=byId('maru-win-detail-refresh');if(dBtn)dBtn.addEventListener('click',refreshDetail);
  ['maru-win-period','maru-win-program-filter'].forEach(function(id){var el=byId(id);if(el)el.addEventListener('change',refreshDetail);});
  var csv=byId('maru-win-export');if(csv)csv.addEventListener('click',exportCSV);
  var form=byId('maru-win-program-add');if(form)form.addEventListener('submit',register);
  refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
window.MARUWindowsDownloadStats={refresh:refresh,refreshDetail:refreshDetail};
})();
