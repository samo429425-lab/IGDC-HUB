
window.renderShowcaseTemplate = function(data,root){

root.innerHTML = `
<h1>${data.title || ""}</h1>
<img src="${data.image || ""}" style="max-width:600px"/>
<p>${data.description || ""}</p>
`;

};
