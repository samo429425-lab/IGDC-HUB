
/* ===============================
   TOUR AUTOMAP - PRODUCTION SAFE
   Strict Scope / No Global Loop
=============================== */

const TOUR_PSOM_KEY = "tour_rightpanel";

window.runTourAutomap = async function(){

  if (!window.fetchTourFeed) return;

  try{

    const snapshot = await window.fetchTourFeed();

    if (!snapshot || !snapshot[TOUR_PSOM_KEY]) return;

    const items = snapshot[TOUR_PSOM_KEY];

    // 🔒 STRICT DOM SCOPE (Right Panel Only)
    const slots = document.querySelectorAll('#rightAutoPanel .ad-box');

    if (!slots.length) return;

    slots.forEach((slot, i) => {

      if (!items[i]) return;

      const img = slot.querySelector('img');
      const title = slot.querySelector('.ad-title');
      const link = slot.querySelector('a');

      if (img && items[i].image) img.src = items[i].image;
      if (title && items[i].title) title.textContent = items[i].title;
      if (link && items[i].url) link.href = items[i].url;

    });

  }catch(err){
    console.error("Tour Automap Error:", err);
  }

};

document.addEventListener("DOMContentLoaded", function(){
  if (window.runTourAutomap){
    window.runTourAutomap();
  }
});
