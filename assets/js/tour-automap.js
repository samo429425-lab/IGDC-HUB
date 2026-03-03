
const PSOM_KEY = "tour_rightpanel";

window.runTourAutomap = async function(){

  if(!window.fetchTourFeed) return;

  const snapshot = await window.fetchTourFeed();
  const items = snapshot[PSOM_KEY] || [];

  const slots = document.querySelectorAll('#rightAutoPanel .ad-box');

  slots.forEach((slot, i)=>{
    if(!items[i]) return;

    const img = slot.querySelector('img');
    const title = slot.querySelector('.ad-title');
    const link = slot.querySelector('a');

    if(img) img.src = items[i].image || '';
    if(title) title.textContent = items[i].title || '';
    if(link) link.href = items[i].url || '#';
  });

};

document.addEventListener("DOMContentLoaded", ()=>{
  if(window.runTourAutomap){
    window.runTourAutomap();
  }
});
