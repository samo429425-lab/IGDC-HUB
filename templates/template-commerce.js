
window.renderCommerceTemplate = function(data,root){

root.innerHTML = `
<h1>${data.title || ""}</h1>
<img src="${data.image || ""}" style="max-width:400px"/>
<p>${data.description || ""}</p>
<button onclick="ActivityEngine.like('${data.id}')">Like</button>
`;

};
