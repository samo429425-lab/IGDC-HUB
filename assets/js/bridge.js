
window.runMaruSearch = async function(q){
  const res = await fetch(`/.netlify/functions/maru-search?q=${encodeURIComponent(q)}`);
  const data = await res.json();

  window.dispatchEvent(new CustomEvent('MARU_SEARCH_RESULT', {
    detail: data
  }));
};
