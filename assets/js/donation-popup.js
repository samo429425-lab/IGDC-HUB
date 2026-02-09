/* Donation Popup v1 */

(function(){

  function ensureViewer(){

    if(document.getElementById("donation-viewer")) return;

    const wrap = document.createElement("div");
    wrap.id = "donation-viewer";

    wrap.innerHTML = `
      <div class="dv-backdrop"></div>
      <div class="dv-panel">
        <button class="dv-close">✕</button>
        <div class="dv-media"></div>
        <h3 class="dv-title"></h3>
        <a class="dv-link" target="_blank">원문 보기</a>
      </div>
    `;

    document.body.appendChild(wrap);

    wrap.querySelector(".dv-close").onclick = close;
    wrap.querySelector(".dv-backdrop").onclick = close;
  }

  function open(item){

    ensureViewer();

    const v = document.getElementById("donation-viewer");

    v.querySelector(".dv-title").textContent =
      item.title || "";

    v.querySelector(".dv-link").href =
      item?.link?.url || "#";

    const media = v.querySelector(".dv-media");

    if(item?.media?.kind === "video" && item.media.src){

      media.innerHTML =
        `<iframe src="${item.media.src}"
          frameborder="0"
          allowfullscreen></iframe>`;

    }else{

      media.innerHTML =
        `<img src="${item?.media?.thumb || item.image}">`;
    }

    v.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function close(){

    const v = document.getElementById("donation-viewer");

    if(!v) return;

    v.classList.remove("open");
    document.body.style.overflow = "";
  }

  /* 카드 클릭 후킹 */
  document.addEventListener("click", function(e){

    const card = e.target.closest(".donation-card");
    if(!card) return;

    const data = card.__donationData;
    if(!data) return;

    e.preventDefault();

    open(data);

  });

  /* 오토맵 연동용 */
  window.__bindDonationCard = function(el, data){
    el.__donationData = data;
  };

})();
