'use strict';
(()=>{
 const $=id=>document.getElementById(id),form=$('form'),field=form.elements.image_url,original=$('adv-original_image'),file=$('image-file'),note=$('dc50-image-workflow-status');
 let staged=null,epoch=0;
 const url=v=>{try{if(window.DCenterLocal&&typeof v==='string'&&v.length<=2800000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))return v;const u=new URL(v);return !u.username&&!u.password&&u.href.length<=2048&&u.protocol==='https:'?u.href:'';}catch{return '';}};
 const tell=t=>note.textContent=t;
 function update(){const im=$('adv-original-preview'),u=url(original.value);im.hidden=!u;if(u&&im.getAttribute('src')!==u)im.src=u;else if(!u)im.removeAttribute('src');$('dc50-use-original').disabled=!u;$('dc50-image-state').textContent=staged?'편집본 업로드 대기':u?(url(field.value)===u?'원본 사용 중':field.value?'별도 대표 사진 사용 중':'원본 보존 · 대표 사진 미선택'):'원본 사진 미확보';}
 function keep(v){if(!url(original.value)&&url(v))original.value=url(v);update();return url(original.value);}
 function clear(){epoch++;staged=null;tell('');queueMicrotask(update);}
 function stage(edited,sourceFile,sourceUrl){if(window.DCenterMediaBusy?.())throw Error('사진 업로드 중에는 편집본을 변경할 수 없습니다.');if(staged?.originalFile&&sourceFile===staged.edited)sourceFile=staged.originalFile;if(!edited||!['image/jpeg','image/png','image/webp'].includes(edited.type)||edited.size<12||edited.size>2000000)throw Error('편집 사진 형식 또는 크기 확인');const existing=keep(sourceUrl||field.value);if(!existing&&(!sourceFile||!['image/jpeg','image/png','image/webp'].includes(sourceFile.type)||sourceFile.size<12||sourceFile.size>2000000))throw Error('원본 사진 파일 또는 주소가 필요합니다.');staged={edited,originalFile:existing?null:sourceFile,epoch};const dt=new DataTransfer();dt.items.add(edited);file.files=dt.files;update();tell(existing?'원본 보존 · 편집본 업로드 후 저장하세요.':'원본 파일과 편집본을 함께 보존합니다. 이미지 업로드 후 저장하세요.');}
 function pending(){return !!staged;}
 function selected(f){return staged&&staged.epoch===epoch&&staged.edited===f?staged:null;}
 function complete(f){if(selected(f)){staged=null;file.value='';update();tell('편집본 적용 완료 · 원본은 별도 보존됩니다.');}}
 function validate(){if(staged)throw Error('편집본 업로드를 완료하거나 원본 사용을 선택하세요.');if(file.files.length)throw Error('선택한 사진 파일을 업로드하거나 파일 선택을 취소하세요.');if(field.value&&!url(field.value))throw Error('대표 사진 주소 확인');keep(field.value);}
 form.addEventListener('reset',clear);window.addEventListener('dcenter-editor-change',clear);document.addEventListener('dcenter:revoked',clear);window.addEventListener('dcenter-editor-loaded',()=>{queueMicrotask(()=>{keep(field.value);update();});});
 field.addEventListener('change',()=>{keep(field.value);update();});file.addEventListener('change',()=>{staged=null;epoch++;update();tell(file.files.length?'선택한 원본 파일은 이미지 업로드를 눌러 저장하세요.':'파일 선택 취소');});
 $('dc50-use-original').onclick=()=>{const u=url(original.value);if(!u||window.DCenterMediaBusy?.())return;staged=null;file.value='';epoch++;field.value=u;field.dispatchEvent(new Event('change'));field.dispatchEvent(new Event('input',{bubbles:true}));update();tell('원본 사진 사용 · AI 편집 없이 저장할 수 있습니다.');};
 $('dc50-cancel-image-file').onclick=()=>{if(window.DCenterMediaBusy?.())return;staged=null;file.value='';epoch++;file.dispatchEvent(new Event('change'));update();};
 window.DCenterImageWorkflow={keep,stage,pending,selected,complete,validate,epoch:()=>epoch,status:()=>({original:!!url(original.value),representative:!!url(field.value),pending:!!staged,preview:!field.value?'none':$('preview').complete?$('preview').naturalWidth>0?'loaded':'failed':'pending',mode:staged?'pending':url(original.value)&&url(original.value)===url(field.value)?'original':field.value?'separate':'none'})};update();
})();
