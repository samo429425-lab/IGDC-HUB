"use strict";
/** Product image provenance checks. Do not assume a reachable URL is a product photograph. */
const VERSION="commerce-product-image-integrity-v1.0";
function text(value){ return value == null ? "" : String(value).trim(); }
function isObject(value){ return !!value && typeof value === "object" && !Array.isArray(value); }
function classification(value){
  const raw=text(value);
  try {
    const u=new URL(raw);
    if(u.protocol!=="https:" || u.username || u.password || !u.hostname) return "invalid_url";
    const path=decodeURIComponent(u.pathname).toLowerCase();
    // These routes are product detail-page illustration strips, not hero images.
    if(/\/productions\/descriptions\/|\/products?\/descriptions?\/|\/goods?\/descriptions?\/|\/detail[_-]?images?\//.test(path)) return "description_image";
    if(/(?:^|[\/_\-.])(?:favicon|logo|logotype|icon|sprite|avatar|profile|banner|placeholder|no[-_]?image|spinner|captcha)(?:[\/_\-.]|$)/.test(path)) return "site_asset";
    if(/\.(?:svg|ico|pdf|css|js|json)$/i.test(path)) return "non_product_asset";
    return "candidate_photo";
  }catch(_e){return "invalid_url";}
}
function imageCandidates(item){
  const row=isObject(item)?item:{};
  const pc=isObject(row.productCard)?row.productCard:{};
  const readiness=isObject(row.researchReadiness)&&isObject(row.researchReadiness.productCard)?row.researchReadiness.productCard:{};
  const record=isObject(row.administratorFrontMatchRecord)?row.administratorFrontMatchRecord:{};
  const media=isObject(row.media)?row.media:{};
  return [record.imageUrl, row.displayImage, pc.image,pc.imageUrl,pc.thumbnailUrl,
    readiness.image,readiness.imageUrl,row.image,row.imageUrl,row.imageOriginalUrl,
    row.thumb,row.thumbnail,row.thumbnailUrl,row.thumbnail_url,row.ogImageUrl,media.thumb,media.image].map(text).filter(Boolean);
}
function resolve(item){
  const all=Array.from(new Set(imageCandidates(item)));
  const good=all.find(url=>classification(url)==="candidate_photo")||"";
  const current=all[0]||"";
  return {image:good, current, suspicious:!!current && classification(current)!=="candidate_photo",
    reason:current?classification(current):"missing_image", alternates:all.length};
}
module.exports={VERSION,classification,imageCandidates,resolve};
