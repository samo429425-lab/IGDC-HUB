(function(){
  'use strict';
  var API='/.netlify/functions/global-slot-console-api';
  var selectedId='';
  var session=null;
  var state={hubs:[],countries:[],regions:[]};
  var wired=false;
  function $(id){return document.getElementById(id)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function note(message,type){var el=$('notice');el.textContent=message;el.className='notice '+(type||'info');setTimeout(function(){if(el.textContent===message)el.className='notice hidden'},7000)}
  function tokenPayload(t){try{var s=String(t||'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return JSON.parse(atob(s))}catch(_){return null}}
  function usable(t){var p=tokenPayload(t);return !!(p&&(!p.exp||p.exp*1000>Date.now()+15000))}
  function scanStore(store){try{for(var i=0;i<store.length;i++){var k=store.key(i),v=store.getItem(k);if(usable(v))return v;try{var j=JSON.parse(v);var c=[j.id_token,j.idToken,j.access_token,j.accessToken,j.__raw,j.raw];for(var x=0;x<c.length;x++)if(usable(c[x]))return c[x]}catch(_){}}}catch(_){}return ''}
  function authToken(){var candidates=[];try{candidates.push(window.IGDC_AUTH_TOKEN,window.IGDC_ID_TOKEN,localStorage.getItem('igdc_id_token'),localStorage.getItem('id_token'),localStorage.getItem('auth0_id_token'),localStorage.getItem('igdc_access_token'),localStorage.getItem('access_token'),sessionStorage.getItem('igdc_id_token'),sessionStorage.getItem('id_token'))}catch(_){}for(var i=0;i<candidates.length;i++)if(usable(candidates[i]))return candidates[i];return scanStore(localStorage)||scanStore(sessionStorage)}
  async function api(action,body,method){var headers={'Accept':'application/json'};var tok=authToken();if(tok)headers.Authorization='Bearer '+tok;var opt={method:method||'GET',headers:headers,cache:'no-store'};var url=API+'?action='+encodeURIComponent(action);if(opt.method!=='GET'){headers['Content-Type']='application/json';opt.body=JSON.stringify(Object.assign({action:action},body||{}));}var r=await fetch(url,opt);var data=await r.json().catch(function(){return {ok:false,error:'JSON 응답이 아닙니다.'}});if(!r.ok||!data.ok)throw new Error(data.error||('HTTP '+r.status));return data}
  function pill(v){var cls=/revenue_ready|approved|pinned|cleared|ready|succeeded/.test(String(v))?'good':/hold|suppressed|retired|blocked|failed|expired|rejected/.test(String(v))?'bad':'warn';return '<span class="pill '+cls+'">'+esc(v||'unknown')+'</span>'}
  function optionRows(rows,value,label){return (rows||[]).map(function(r){return '<option value="'+esc(r[value])+'">'+esc(r[label]||r[value])+'</option>'}).join('')}
  function renderSimpleList(id,rows,mapper,heads){var el=$(id);if(!el)return;el.innerHTML='<div class="tablewrap"><table><thead><tr>'+heads.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>'+(rows&&rows.length?rows.map(mapper).join(''):'<tr><td colspan="'+heads.length+'" class="muted">등록된 항목이 없습니다.</td></tr>')+'</tbody></table></div>'}
  function run(task){if(task&&typeof task.catch==='function')task.catch(showErr)}
  function activate(view){document.querySelectorAll('.nav button').forEach(function(b){b.classList.toggle('active',b.dataset.view===view)});document.querySelectorAll('.view').forEach(function(v){v.classList.toggle('active',v.id==='view-'+view)});var task=null;if(view==='candidates')task=loadCandidates();else if(view==='countries')task=loadCountries();else if(view==='sources')task=loadSources();else if(view==='policies')task=loadPolicies();else if(view==='affiliates')task=loadAffiliates();else if(view==='audit')task=loadAudit();else if(view==='overview')task=loadOverview();else if(view==='media')task=loadMediaList();run(task)}
  async function boot(){wire();try{session=await api('session');$('userLabel').textContent=(session.user.name||session.user.email)+' · '+session.user.role}catch(e){$('userLabel').textContent='관리자 권한 확인 실패';note('관리자 로그인 확인 실패: '+(e&&e.message||String(e)),'error');return}try{await Promise.all([loadHubs(),loadCountries(true),loadRegions()]);await loadOverview()}catch(e){note('관리 DB 연결 오류: '+(e&&e.message||String(e))+' · 기존 owner/admin 로그인은 이미 확인되었습니다. Netlify의 GSLOT_SUPABASE_SECRET_KEY가 새 관리 DB의 secret/service_role 키인지 확인하세요.','error')}}
  async function loadHubs(){var d=await api('hubs');state.hubs=d.rows||[];$('assignmentHub').innerHTML=optionRows(state.hubs,'hub_key','label');$('policyHub').innerHTML='<option value="">전체</option>'+optionRows(state.hubs,'hub_key','label')}
  async function loadRegions(){var d=await api('regions');state.regions=d.rows||[]}
  async function loadCountries(silent){var d=await api('countries');state.countries=d.rows||[];var opts='<option value="GLOBAL">GLOBAL (전역)</option>'+optionRows(state.countries,'code','name');$('assignmentCountry').innerHTML=opts;$('mediaRightsCountry').innerHTML=opts;if(!silent)renderSimpleList('countryList',d.rows,function(r){return '<tr><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.region_code||'')+'</td><td>'+esc(r.legal_source_id||'')+'</td><td>'+esc(r.enabled?'활성':'비활성')+'</td></tr>'},['코드','국가','권역','근거 데이터원','상태'])}
  async function loadOverview(){var results=await Promise.all([api('candidates'),api('countries'),api('sources'),api('affiliates'),api('media.list')]);var c=results[0].rows||[],countries=results[1].rows||[],sources=results[2].rows||[],aff=results[3].rows||[],media=results[4].rows||[];var ready=c.filter(function(x){return x.status==='revenue_ready'}).length,hold=c.filter(function(x){return x.status==='hold'||x.status==='suppressed'}).length,mediaReady=media.filter(function(x){return x.workflow_status==='approved_for_delivery'&&x.rights_status==='cleared'}).length;$('overviewCards').innerHTML=[['후보 원장',c.length],['수익 준비',ready],['보류·제외',hold],['활성 국가',countries.filter(function(x){return x.enabled}).length],['합법 데이터원',sources.filter(function(x){return x.enabled}).length],['제휴 CRM',aff.length],['영상 원장',media.length],['전달 승인 영상',mediaReady]].map(function(x){return '<div class="card"><strong>'+x[1]+'</strong><span>'+x[0]+'</span></div>'}).join('')}
  async function loadCandidates(){var q=$('candidateSearch').value.trim(),s=$('candidateStatus').value;var params=[];if(q)params.push('search='+encodeURIComponent(q));if(s)params.push('status='+encodeURIComponent(s));var tok=authToken(),r=await fetch(API+'?action=candidates'+(params.length?'&'+params.join('&'):''),{headers:tok?{Authorization:'Bearer '+tok}:{},cache:'no-store'}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'후보 조회 실패');var rows=d.rows||[];$('candidateRows').innerHTML=rows.length?rows.map(function(x){return '<tr class="candidate-row" data-id="'+esc(x.id)+'"><td>'+pill(x.status)+'</td><td>'+esc(x.kind)+'</td><td><strong>'+esc(x.title)+'</strong></td><td><a href="'+esc(x.official_url)+'" target="_blank" rel="noopener">공식 링크</a></td><td>'+esc((x.updated_at||'').slice(0,19).replace('T',' '))+'</td></tr>'}).join(''):'<tr><td colspan="5" class="muted">후보가 없습니다.</td></tr>';document.querySelectorAll('.candidate-row').forEach(function(tr){tr.addEventListener('click',function(){openCandidate(tr.dataset.id)})})}
  async function openCandidate(id){var d2=await api('candidate.detail',{id:id},'POST');var c=d2.candidate;if(!c)return;selectedId=c.id;$('candidateId').value=c.id;$('candidateKind').value=c.kind||'content';$('candidateTitle').value=c.title||'';$('candidateUrl').value=c.official_url||'';$('candidateThumbnail').value=c.thumbnail_url||'';$('candidateState').value=c.status||'discovered';$('candidateSourceRef').value=c.source_ref||'';$('candidateDescription').value=c.description||'';$('candidateNote').value=c.owner_note||'';$('assignmentList').innerHTML=(d2.assignments||[]).map(function(a){return '<div>'+pill(a.state)+' '+esc(a.hub_key)+' / '+esc(a.country_code)+' / '+esc(a.slot_key)+' · '+esc(a.priority)+'</div>'}).join('')||'<span class="muted">배치 이력이 없습니다.</span>';$('candidateDetail').classList.remove('hidden');$('candidateDetail').innerHTML='<h2>저장된 검토 정보</h2><p><strong>증빙:</strong> '+(d2.evidence||[]).length+'건 · <strong>국가 가능 여부:</strong> '+(d2.availability||[]).length+'건 · <strong>수익 경로:</strong> '+(d2.revenue||[]).length+'건</p><button id="openMediaForCandidateBtn" type="button" class="ghost">이 후보의 영상 자산 · 권리 관리</button>';$('openMediaForCandidateBtn').addEventListener('click',function(){activate('media');loadMediaDetail(selectedId).catch(showErr)});activate('candidate')}
  function clearCandidate(){selectedId='';$('candidateForm').reset();$('candidateId').value='';$('assignmentList').innerHTML='';$('candidateDetail').classList.add('hidden')}
  async function saveCandidate(e){e.preventDefault();var payload={id:selectedId||$('candidateId').value,kind:$('candidateKind').value,title:$('candidateTitle').value,officialUrl:$('candidateUrl').value,thumbnailUrl:$('candidateThumbnail').value,status:$('candidateState').value,sourceRef:$('candidateSourceRef').value,description:$('candidateDescription').value,ownerNote:$('candidateNote').value};var d=await api('candidate.save',payload,'POST');selectedId=d.row.id;$('candidateId').value=selectedId;note('후보 원장이 저장되었습니다.','success');loadCandidates()}
  function requireCandidate(){if(!selectedId){note('먼저 후보 원장을 저장하거나 후보를 선택하세요.','error');return false}return true}
  async function saveEvidence(){if(!requireCandidate())return;await api('evidence.add',{candidateId:selectedId,type:$('evidenceType').value,evidenceUrl:$('evidenceUrl').value,note:$('evidenceNote').value,verified:$('evidenceVerified').checked},'POST');note('증빙이 추가되었습니다.','success');$('evidenceUrl').value='';$('evidenceNote').value=''}
  async function uploadEvidence(){if(!requireCandidate())return;var file=$('evidenceFile').files[0];if(!file){note('업로드할 파일을 선택하세요.','error');return}if(file.size>100*1024*1024){note('증빙·썸네일·소형 초안은 100MB 이하만 허용합니다.','error');return}var d=await api('storage.sign',{bucket:$('evidenceBucket').value,fileName:file.name},'POST');var put=await fetch(d.result.uploadUrl,{method:'PUT',headers:{'content-type':file.type||'application/octet-stream','x-upsert':'false'},body:file});if(!put.ok)throw new Error('파일 업로드 실패: HTTP '+put.status);note('비공개 저장소에 업로드했습니다.','success')}
  async function saveAvailability(){if(!requireCandidate())return;await api('availability.save',{candidateId:selectedId,countryCode:$('availabilityCountry').value,regionCode:$('availabilityRegion').value,state:$('availabilityState').value,legalBasis:$('availabilityLegal').value,deliveryOrAccess:$('availabilityAccess').value},'POST');note('국가별 가능 여부를 저장했습니다.','success')}
  async function saveRevenue(){if(!requireCandidate())return;await api('revenue.save',{candidateId:selectedId,type:$('revenueType').value,status:$('revenueState').value,affiliateUrl:$('revenueAffiliateUrl').value,providerName:$('revenueProvider').value,currency:$('revenueCurrency').value,note:$('revenueNote').value},'POST');note('수익·제휴 경로를 저장했습니다.','success')}
  async function saveAssignment(){if(!requireCandidate())return;var stateV=$('assignmentState').value,ready=(stateV==='approved'||stateV==='pinned')?'ready':'not_ready';var result=await api('assignment.save',{candidateId:selectedId,hubKey:$('assignmentHub').value,countryCode:$('assignmentCountry').value,regionCode:$('assignmentRegion').value,slotKey:$('assignmentSlot').value,priority:$('assignmentPriority').value,state:stateV,publicationStatus:ready,manualPinned:$('assignmentPinned').checked,note:$('assignmentNote').value},'POST');var dispatch=result&&result.releaseDispatch;if(dispatch&&dispatch.queued===true)note('슬롯 승인을 저장했고, 검증된 실상품의 자동 프론트 발행 배포를 요청했습니다.','success');else if(dispatch&&dispatch.reason==='build_hook_not_configured')note('슬롯 승인은 저장됐습니다. 자동 발행용 COMMERCE_RELEASE_BUILD_HOOK_URL이 아직 설정되지 않았습니다.','warn');else if(dispatch&&dispatch.reason==='release_gate_not_armed')note('슬롯 승인은 저장됐습니다. 실상품 공개 Release Gate가 아직 잠겨 있어 자동 발행은 요청하지 않았습니다.','warn');else note('슬롯 배치를 저장했습니다. 승인/고정 상태면 발행 준비로 표시됩니다.','success');openCandidate(selectedId)}
  async function loadSources(){var d=await api('sources');renderSimpleList('sourceList',d.rows,function(x){return '<tr><td>'+esc(x.name)+'</td><td><a href="'+esc(x.official_url)+'" target="_blank">공식 URL</a></td><td>'+esc(x.access_mode)+'</td><td>'+esc(x.enabled?'활성':'중지')+'</td></tr>'},['이름','공식 URL','방식','상태'])}
  async function loadPolicies(){var d=await api('policies');renderSimpleList('policyList',d.rows,function(x){return '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.scope_hub||'전체')+'</td><td>'+esc(x.scope_country||'전체')+'</td><td><code>'+esc(JSON.stringify(x.rule||{}))+'</code></td></tr>'},['이름','허브','국가','규칙'])}
  async function loadAffiliates(){var d=await api('affiliates');renderSimpleList('affiliateList',d.rows,function(x){return '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.renewal_at||'')+'</td><td>'+esc(x.note||'')+'</td></tr>'},['이름','상태','갱신','메모'])}
  async function loadAudit(){var d=await api('audit');renderSimpleList('auditList',d.rows,function(x){return '<tr><td>'+esc((x.created_at||'').slice(0,19).replace('T',' '))+'</td><td>'+esc(x.actor_role||'')+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.entity_type)+' / '+esc(x.entity_id||'')+'</td><td><code>'+esc(JSON.stringify(x.detail||{}))+'</code></td></tr>'},['시간','역할','작업','대상','기록'])}
  async function saveRegion(e){e.preventDefault();await api('region.save',{code:$('regionCode').value,name:$('regionName').value},'POST');note('권역을 저장했습니다.','success');$('regionForm').reset();loadRegions()}
  async function saveCountry(e){e.preventDefault();await api('country.save',{code:$('countryCode').value,name:$('countryName').value,regionCode:$('countryRegion').value,legalSourceId:$('countryLegalSource').value},'POST');note('국가를 저장했습니다.','success');$('countryForm').reset();loadCountries()}
  async function saveSource(e){e.preventDefault();await api('source.save',{name:$('sourceName').value,officialUrl:$('sourceUrl').value,legalBasis:$('sourceLegal').value,accessMode:$('sourceMode').value,rateLimitNote:$('sourceLimit').value},'POST');note('합법 데이터원을 저장했습니다.','success');$('sourceForm').reset();loadSources()}
  async function savePolicy(e){e.preventDefault();var rule={};try{rule=JSON.parse($('policyRule').value||'{}')}catch(_){note('정책 규칙 JSON 형식이 올바르지 않습니다.','error');return}await api('policy.save',{name:$('policyName').value,scopeHub:$('policyHub').value,scopeCountry:$('policyCountry').value,scopeRegion:$('policyRegion').value,rule:rule},'POST');note('정책을 저장했습니다.','success');$('policyForm').reset();loadPolicies()}
  async function saveAffiliate(e){e.preventDefault();await api('affiliate.save',{name:$('affiliateName').value,officialUrl:$('affiliateUrl').value,contactUrl:$('affiliateContact').value,status:$('affiliateState').value,renewalAt:$('affiliateRenewal').value,note:$('affiliateNote').value},'POST');note('제휴 CRM 항목을 저장했습니다.','success');$('affiliateForm').reset();loadAffiliates()}

  function syncMediaForm(profile){profile=profile||{};$('mediaKind').value=profile.media_kind||'other';$('mediaWorkflowStatus').value=profile.workflow_status||'draft';$('mediaRightsStatus').value=profile.rights_status||'unknown';$('mediaRightsBasis').value=profile.rights_basis||'other';$('mediaRightsExpiry').value=profile.rights_expiry||'';$('mediaLicenseReference').value=profile.license_reference||'';$('mediaReleaseYear').value=profile.release_year||'';$('mediaRuntimeSeconds').value=profile.runtime_seconds||'';$('mediaOriginalLanguage').value=profile.original_language||'';$('mediaAudioLanguages').value=(profile.audio_languages||[]).join(',');$('mediaCaptionLanguages').value=(profile.caption_languages||[]).join(',');$('mediaContentRating').value=profile.content_rating||'';$('mediaDeliveryMode').value=profile.delivery_mode||'not_set';$('mediaPublicSummary').value=profile.public_summary||'';$('mediaInternalNote').value=profile.internal_note||''}
  function renderReadiness(readiness){var el=$('mediaReadiness');if(!readiness){el.innerHTML='';return}var state=readiness.canEnablePlayback?'전달 요건 검토 완료':readiness.canPublishMetadata?'메타데이터 검토 준비':'보강 필요';var html='<strong>'+esc(state)+'</strong><div style="margin-top:6px">'+(readiness.checks||[]).map(function(x){return '<div>'+pill(x.ok?'OK':'보강')+' '+esc(x.message)+'</div>'}).join('')+'</div>';el.innerHTML=html}
  function renderMediaAssets(rows){renderSimpleList('mediaAssetList',rows||[],function(x){return '<tr><td>'+pill(x.asset_role)+'</td><td>'+pill(x.ingest_status)+'</td><td>'+esc(x.storage_mode)+'</td><td>'+esc(x.file_name||x.object_path||'')+'</td><td>'+esc(x.mime_type||'')+'</td><td>'+esc(x.byte_size||0)+'</td><td>'+esc(x.language_tag||'')+'</td></tr>'},['역할','상태','저장 방식','파일/경로','형식','바이트','언어'])}
  function renderMediaRightsAndJobs(rights,jobs){renderSimpleList('mediaRightsList',rights||[],function(x){return '<tr><td>'+esc(x.country_code)+'</td><td>'+pill(x.rights_state)+'</td><td>'+esc(x.access_type||'')+'</td><td>'+esc(x.end_at||'')+'</td><td>'+esc(x.license_reference||'')+'</td></tr>'},['국가','권리','접근','종료','계약 참조']);renderSimpleList('mediaJobList',jobs||[],function(x){return '<tr><td>'+esc(x.job_type)+'</td><td>'+pill(x.status)+'</td><td>'+esc((x.created_at||'').slice(0,19).replace('T',' '))+'</td></tr>'},['작업','상태','등록'])}
  async function loadMediaList(){var d=await api('media.list');var rows=d.rows||[];renderSimpleList('mediaRows',rows,function(x){var c=x.candidate||{};return '<tr class="media-row" data-id="'+esc(x.candidate_id)+'"><td>'+pill(x.workflow_status)+'</td><td>'+pill(x.rights_status)+'</td><td><strong>'+esc(c.title||x.candidate_id)+'</strong></td><td>'+esc(x.media_kind)+'</td><td>'+esc(x.delivery_mode)+'</td><td>'+esc((x.updated_at||'').slice(0,19).replace('T',' '))+'</td></tr>'},['단계','권리','제목','유형','전송','갱신']);document.querySelectorAll('.media-row').forEach(function(tr){tr.addEventListener('click',function(){loadMediaDetail(tr.dataset.id).catch(showErr)})});if(selectedId){try{await loadMediaDetail(selectedId)}catch(_){}}}
  async function loadMediaDetail(candidateId){var d=await api('media.detail',{candidateId:candidateId},'POST');selectedId=d.candidate.id;$('mediaWorkspace').classList.remove('hidden');$('mediaCandidateLabel').textContent=d.candidate.title+' · '+d.candidate.id;syncMediaForm(d.profile);renderReadiness(d.readiness);renderMediaAssets(d.assets);renderMediaRightsAndJobs(d.rights,d.jobs)}
  async function saveMediaProfile(e){e.preventDefault();if(!requireCandidate())return;await api('media.profile.save',{candidateId:selectedId,mediaKind:$('mediaKind').value,workflowStatus:$('mediaWorkflowStatus').value,rightsStatus:$('mediaRightsStatus').value,rightsBasis:$('mediaRightsBasis').value,rightsExpiry:$('mediaRightsExpiry').value,licenseReference:$('mediaLicenseReference').value,releaseYear:$('mediaReleaseYear').value,runtimeSeconds:$('mediaRuntimeSeconds').value,originalLanguage:$('mediaOriginalLanguage').value,audioLanguages:$('mediaAudioLanguages').value,captionLanguages:$('mediaCaptionLanguages').value,contentRating:$('mediaContentRating').value,deliveryMode:$('mediaDeliveryMode').value,publicSummary:$('mediaPublicSummary').value,internalNote:$('mediaInternalNote').value},'POST');note('영상 제목·권리 프로필을 저장했습니다.','success');loadMediaDetail(selectedId)}
  async function uploadMediaAsset(){if(!requireCandidate())return;var f=$('mediaAssetFile').files[0];if(!f){note('업로드할 시험용 파일을 선택하세요.','error');return}var d=await api('media.asset.sign',{candidateId:selectedId,assetRole:$('mediaAssetRole').value,bucket:$('mediaAssetBucket').value,fileName:f.name,mimeType:f.type||'application/octet-stream',byteSize:f.size,languageTag:$('mediaAssetLanguage').value,note:$('mediaAssetNote').value},'POST');var put=await fetch(d.upload.uploadUrl,{method:'PUT',headers:{'content-type':f.type||'application/octet-stream','x-upsert':'false'},body:f});if(!put.ok){await api('media.asset.confirm',{assetId:d.asset.id,ingestStatus:'failed',note:'Browser upload HTTP '+put.status},'POST');throw new Error('시험용 파일 업로드 실패: HTTP '+put.status)}await api('media.asset.confirm',{assetId:d.asset.id,ingestStatus:'uploaded',languageTag:$('mediaAssetLanguage').value,note:$('mediaAssetNote').value},'POST');note('비공개 시험용 미디어 자산을 등록했습니다. 처리 작업을 추가해 메타데이터 검증을 기록하세요.','success');$('mediaAssetFile').value='';loadMediaDetail(selectedId)}
  async function saveExternalMediaAsset(){if(!requireCandidate())return;await api('media.asset.external.save',{candidateId:selectedId,assetRole:$('mediaAssetRole').value,storageMode:$('mediaExternalMode').value,externalUrl:$('mediaExternalUrl').value,languageTag:$('mediaAssetLanguage').value,deliveryAllowed:$('mediaDeliveryAllowed').checked,note:$('mediaAssetNote').value},'POST');note('외부 공식/전달 제공자 경로를 등록했습니다.','success');$('mediaExternalUrl').value='';loadMediaDetail(selectedId)}
  async function saveMediaRights(e){e.preventDefault();if(!requireCandidate())return;await api('media.rights.save',{candidateId:selectedId,countryCode:$('mediaRightsCountry').value,rightsState:$('mediaCountryRightsState').value,accessType:$('mediaRightsAccessType').value,startAt:$('mediaRightsStart').value,endAt:$('mediaRightsEnd').value,licenseEvidenceUrl:$('mediaRightsEvidenceUrl').value,licenseReference:$('mediaRightsReference').value,note:$('mediaRightsNote').value},'POST');note('국가별 영상 권리 상태를 저장했습니다.','success');loadMediaDetail(selectedId)}
  async function queueMediaJob(){if(!requireCandidate())return;var d=await api('media.job.queue',{candidateId:selectedId,jobType:$('mediaJobType').value},'POST');note(d.note||'영상 처리 작업을 등록했습니다.','success');loadMediaDetail(selectedId)}
  async function refreshMediaReadiness(){if(!requireCandidate())return;var d=await api('media.readiness',{candidateId:selectedId},'POST');renderReadiness(d.readiness);note(d.readiness.canEnablePlayback?'권리·자산·전송 경로 기준을 모두 통과했습니다.':'아직 공개 전 보강 항목이 있습니다.','info')}
  function installDiagnosticMenu(){
    if(document.getElementById('gslotDiagnosticMenu'))return;
    var nav=document.querySelector('.nav');
    if(!nav)return;
    var style=document.createElement('style');
    style.id='gslotDiagnosticStyle';
    style.textContent=''
      +'.gslot-diag-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px}'
      +'.gslot-diag-modal{width:min(980px,100%);max-height:90vh;overflow:hidden;background:#fff;border-radius:14px;box-shadow:0 22px 70px rgba(15,23,42,.35);display:flex;flex-direction:column;color:#172033}'
      +'.gslot-diag-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px 20px;border-bottom:1px solid #d9e1ee;background:#f8fbff}'
      +'.gslot-diag-head h2{margin:0;font-size:18px}.gslot-diag-head p{margin:5px 0 0;color:#64748b;font-size:12px}'
      +'.gslot-diag-close{border:1px solid #bcc9db;border-radius:7px;background:#fff;color:#334155;padding:6px 10px;cursor:pointer;font:inherit}'
      +'.gslot-diag-body{padding:18px 20px;overflow:auto}.gslot-diag-note{border:1px solid #d9e1ee;border-radius:10px;background:#f8fafc;padding:12px 14px;white-space:pre-wrap;word-break:break-word}'
      +'.gslot-diag-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.gslot-diag-actions button{border:1px solid #0c5ea8;border-radius:8px;background:#0c5ea8;color:#fff;padding:8px 12px;font:inherit;font-weight:700;cursor:pointer}.gslot-diag-actions button.secondary{background:#fff;color:#0c5ea8}.gslot-diag-actions button:disabled{opacity:.55;cursor:default}'
      +'.gslot-diag-json{margin:0;max-height:420px;overflow:auto;border-radius:10px;background:#0f172a;color:#e2e8f0;padding:14px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word}'
      +'.gslot-diag-meta{font-size:12px;color:#64748b;margin:8px 0 0}'
      +'.gslot-diag-menu{margin-top:8px!important;border-top:1px solid #d9e1ee!important;padding-top:13px!important;color:#0c5ea8!important;font-weight:800!important}';
    document.head.appendChild(style);
    var menu=document.createElement('button');
    menu.type='button';
    menu.id='gslotDiagnosticMenu';
    menu.className='gslot-diag-menu';
    menu.textContent='🔎 시스템 진단 · JSON';
    menu.addEventListener('click',function(){openDiagnosticPopup(true)});
    nav.appendChild(menu);
  }
  function diagnosticToken(){return authToken();}
  function diagnosticArtifact(payload,requestError){
    return {
      reportType:'igdc-global-slot-console-diagnostic',
      version:'v1.0.0-owner-readonly',
      generatedAt:new Date().toISOString(),
      source:{href:location.href,origin:location.origin,pathname:location.pathname},
      scope:{mode:'owner-only-readonly',writes:false,secretsExcluded:true},
      result:payload||null,
      requestError:requestError||null
    };
  }
  function diagnosticSummary(report){
    var result=report&&report.result||{};
    var diagnosis=result.diagnosis||{};
    var probe=result.probe||{};
    if(report&&report.requestError)return '진단 함수 호출 실패: '+report.requestError;
    if(probe.ok)return '정상 · '+(diagnosis.summary||'관리 DB 연결과 기본 테이블 읽기 권한이 확인되었습니다.');
    return '확인 필요 · '+(diagnosis.summary||probe.message||'관리 DB 진단 결과를 확인하세요.');
  }
  function downloadDiagnosticJson(report){
    var text=JSON.stringify(report,null,2);
    var blob=new Blob([text],{type:'application/json;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;
    a.download='IGDC_Global_Slot_Diagnostic_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url)},1000);
  }
  function openDiagnosticPopup(autoRun){
    var existing=document.getElementById('gslotDiagnosticBackdrop');
    if(existing){existing.style.display='flex';if(autoRun){var rerun=document.getElementById('gslotDiagRun');if(rerun)rerun.click()}return;}
    var backdrop=document.createElement('div');
    backdrop.id='gslotDiagnosticBackdrop';backdrop.className='gslot-diag-backdrop';
    backdrop.innerHTML=''
      +'<section class="gslot-diag-modal" role="dialog" aria-modal="true" aria-labelledby="gslotDiagTitle">'
      +'<header class="gslot-diag-head"><div><h2 id="gslotDiagTitle">글로벌 슬롯 시스템 진단</h2><p>현재 owner 세션을 재사용합니다. 관리 DB의 연결·권한 상태만 읽기 전용으로 점검하며 키·토큰·테이블 원문은 저장하거나 표시하지 않습니다.</p></div><button id="gslotDiagClose" class="gslot-diag-close" type="button">닫기</button></header>'
      +'<div class="gslot-diag-body"><div id="gslotDiagNotice" class="gslot-diag-note">진단을 준비 중입니다.</div><div class="gslot-diag-actions"><button id="gslotDiagRun" type="button">지금 진단</button><button id="gslotDiagCopy" class="secondary" type="button" disabled>JSON 복사</button><button id="gslotDiagDownload" class="secondary" type="button" disabled>JSON 다운로드</button></div><div id="gslotDiagMeta" class="gslot-diag-meta"></div><pre id="gslotDiagJson" class="gslot-diag-json">아직 결과가 없습니다.</pre></div>'
      +'</section>';
    document.body.appendChild(backdrop);
    var report=null;
    function close(){backdrop.style.display='none'}
    function setNotice(text){$('gslotDiagNotice').textContent=text}
    async function runDiagnostic(){
      var runButton=$('gslotDiagRun');
      runButton.disabled=true;setNotice('owner 세션으로 관리 DB를 읽기 전용 점검 중입니다.');
      try{
        var token=diagnosticToken();
        if(!token)throw new Error('현재 브라우저에서 기존 owner 로그인 토큰을 찾지 못했습니다. 어드민 로그인 상태를 확인해 주세요.');
        var response=await fetch('/.netlify/functions/global-slot-console-diagnostic',{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+token},cache:'no-store'});
        var data=await response.json().catch(function(){return {ok:false,error:'JSON 응답이 아닙니다.'}});
        if(!response.ok||!data.ok)throw new Error(data.error||('HTTP '+response.status));
        report=diagnosticArtifact(data,null);
      }catch(error){report=diagnosticArtifact(null,error&&error.message||String(error));}
      $('gslotDiagJson').textContent=JSON.stringify(report,null,2);
      $('gslotDiagMeta').textContent='생성 시각: '+report.generatedAt+' · 읽기 전용 · 비밀키/토큰/테이블 원문 제외';
      setNotice(diagnosticSummary(report));
      $('gslotDiagCopy').disabled=false;$('gslotDiagDownload').disabled=false;runButton.disabled=false;
    }
    $('gslotDiagClose').addEventListener('click',close);
    backdrop.addEventListener('click',function(e){if(e.target===backdrop)close()});
    $('gslotDiagRun').addEventListener('click',runDiagnostic);
    $('gslotDiagCopy').addEventListener('click',function(){
      if(!report)return;
      var text=JSON.stringify(report,null,2);
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){setNotice('진단 JSON을 복사했습니다.')}).catch(function(){setNotice('자동 복사에 실패했습니다. 아래 JSON을 직접 복사해 주세요.')});}
      else setNotice('아래 JSON을 직접 복사해 주세요.');
    });
    $('gslotDiagDownload').addEventListener('click',function(){if(report)downloadDiagnosticJson(report)});
    if(autoRun)runDiagnostic();
  }
  function wire(){if(wired)return;wired=true;installDiagnosticMenu();document.querySelectorAll('.nav button').forEach(function(b){if(b.id==='gslotDiagnosticMenu')return;b.addEventListener('click',function(){activate(b.dataset.view)})});$('returnBtn').addEventListener('click',function(){
    var raw='';
    try{raw=new URLSearchParams(location.search).get('returnPath')||'';}catch(_){}
    var target=(raw&&raw.charAt(0)==='/'&&raw.indexOf('//')!==0)?raw:'/admin.html';
    location.assign(target);
  });$('newCandidateBtn').addEventListener('click',function(){clearCandidate();activate('candidate')});$('clearCandidateBtn').addEventListener('click',clearCandidate);$('candidateForm').addEventListener('submit',function(e){saveCandidate(e).catch(showErr)});$('candidateRefresh').addEventListener('click',function(){loadCandidates().catch(showErr)});$('saveEvidenceBtn').addEventListener('click',function(){saveEvidence().catch(showErr)});$('uploadEvidenceBtn').addEventListener('click',function(){uploadEvidence().catch(showErr)});$('saveAvailabilityBtn').addEventListener('click',function(){saveAvailability().catch(showErr)});$('saveRevenueBtn').addEventListener('click',function(){saveRevenue().catch(showErr)});$('saveAssignmentBtn').addEventListener('click',function(){saveAssignment().catch(showErr)});$('regionForm').addEventListener('submit',function(e){saveRegion(e).catch(showErr)});$('countryForm').addEventListener('submit',function(e){saveCountry(e).catch(showErr)});$('sourceForm').addEventListener('submit',function(e){saveSource(e).catch(showErr)});$('policyForm').addEventListener('submit',function(e){savePolicy(e).catch(showErr)});$('affiliateForm').addEventListener('submit',function(e){saveAffiliate(e).catch(showErr)});$('auditRefresh').addEventListener('click',function(){loadAudit().catch(showErr)});/* Front publication is intentionally not wired in this isolated console. */$('mediaRefreshBtn').addEventListener('click',function(){loadMediaList().catch(showErr)});$('mediaProfileForm').addEventListener('submit',function(e){saveMediaProfile(e).catch(showErr)});$('mediaUploadBtn').addEventListener('click',function(){uploadMediaAsset().catch(showErr)});$('mediaExternalSaveBtn').addEventListener('click',function(){saveExternalMediaAsset().catch(showErr)});$('mediaRightsForm').addEventListener('submit',function(e){saveMediaRights(e).catch(showErr)});$('mediaQueueBtn').addEventListener('click',function(){queueMediaJob().catch(showErr)});$('mediaReadinessBtn').addEventListener('click',function(){refreshMediaReadiness().catch(showErr)})}
  function showErr(e){note(e&&e.message||String(e),'error')}
  boot();
})();
