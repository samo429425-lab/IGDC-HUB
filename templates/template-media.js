
window.renderMediaTemplate = function(data,root){

root.innerHTML = `
<h1>${data.title || ""}</h1>
<video controls width="600">
<source src="${data.video || ""}" type="video/mp4">
</video>
<p>${data.description || ""}</p>
`;

};
