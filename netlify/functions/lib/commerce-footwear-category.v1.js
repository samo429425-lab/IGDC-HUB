"use strict";
// Use individual product identity, not a supplier's general catalogue or URL.
function isFootwearOutdoor(product) {
 const title=[product?.productName,product?.title,product?.sourceTitle].filter(Boolean).join(" ");
 return /(?:신발|운동화|스니커즈|등산화|등산복|트레킹화|러닝화|샌들|슬리퍼|구두|부츠|아웃도어\s*(?:의류|재킷|자켓|패션|용품)|캠핑\s*(?:장비|용품)|텐트|침낭|\b(?:shoes?|footwear|sneakers?|boots?|sandals?|slippers?|hiking (?:wear|jacket|gear)|outdoor (?:wear|jacket|clothing|gear)|camping (?:gear|tent)|sleeping bag|trail running shoes)\b|登山鞋|运动鞋|運動鞋|登山服|戶外服|户外服|登山靴|スニーカー|靴|登山ウェア|chaussures|calzado|zapatos|Schuhe|обувь|أحذية|کفش)/iu.test(title) && !/(?:신발장|신발\s*정리|신발\s*세척|신발\s*탈취|신발\s*건조|shoe\s*(?:rack|cabinet|cleaner|dryer|deodorizer)|(?:book|ebook|도서|전자책)\s*[:：])/iu.test(title);
}
module.exports={isFootwearOutdoor};
