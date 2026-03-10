
window.CommentEngine = {

async load(contentId){
  console.log("load comments",contentId);
},

async post(contentId,text){
  console.log("post comment",contentId,text);
}

};
