
(async function(){

function getParam(name){
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

async function loadSnapshot(id){
  const res = await fetch(`/data/${id}.json`);
  return await res.json();
}

function selectTemplate(type){
  if(type === "commerce") return window.renderCommerceTemplate;
  if(type === "media") return window.renderMediaTemplate;
  return window.renderShowcaseTemplate;
}

async function init(){

  const id = getParam("id");

  if(!id){
    document.getElementById("content-root").innerHTML="content id missing";
    return;
  }

  const snapshot = await loadSnapshot(id);

  const template = selectTemplate(snapshot.type);

  template(snapshot, document.getElementById("content-root"));

  if(window.ActivityEngine){
    ActivityEngine.recordView(id);
  }

}

init();

})();
