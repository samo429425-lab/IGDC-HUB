'use strict';
/**
 * Distribution-only automatic staging guard. Never edits manual placements.
 * A product listing/site introduction is not an individual purchasable item.
 * Ambiguous pages stay in private research for reinspection, never published.
 */
const Ranking=require('./commerce-product-ranking.v1');
const text=v=>v==null?'':String(v).trim();
const low=v=>text(v).toLowerCase();
function evaluate(row){
  const x=row&&typeof row==='object'?row:{},url=text(x.verifiedDetailPageUrl||x.productUrl||x.url),title=text(x.productName||x.title);
  const reasons=[];
  if(!Ranking.isSpecificProductUrl(url)||Ranking.isTemplateOrPlaceholderUrl(url))reasons.push('individual_product_url_not_verified');
  if(x.productPageLive===false&&!x.inspectionDeferred)reasons.push('product_page_unavailable');
  if(x.inspectionComplete!==true)reasons.push('product_inspection_not_complete');
  if(!text(x.imageUrl||x.imageOriginalUrl||x.image))reasons.push('authentic_product_image_missing');
  if(Ranking.isGenericProductName(title))reasons.push('specific_product_name_missing');
  // Strong generic site-introduction signals only. Product names containing
  // ordinary 'official' or 'store' words are *not* rejected on that basis.
  const genericIntro=/^(?:회사\s*소개|기업\s*소개|사이트\s*소개|쇼핑몰\s*소개|브랜드\s*소개|서비스\s*소개|공식\s*홈페이지|사업\s*안내|방문을\s*환영합니다|about\s*us|company\s*profile|company\s*introduction|about\s*our\s*(?:brand|company)|brand\s*story|welcome\s*to\s*(?:our\s*)?(?:website|store|shop)|official\s*website|shop\s*home(?:\s*page)?|home\s*page)(?:\s*[-|:·].*)?$/i;
  if(genericIntro.test(title))reasons.push('site_introduction_not_product');
  // OG brand-banner imagery on a product-looking URL is insufficient without
  // any independently verified item/offer evidence. This is a reinspection
  // outcome, not an automatic hard-delete of research history.
  const imageSource=low(x.imageSource);
  const weakPreview= (x.productDetailProof===false||x.productEvidenceReviewRequired===true) &&
    (imageSource==='open_graph_detail'||imageSource==='unverified_detail'||imageSource==='website_og') &&
    x.offerPresent!==true&&!text(x.price)&&x.travelInventoryVerified!==true;
  if(weakPreview)reasons.push('site_preview_without_product_offer_proof');
  return {accepted:reasons.length===0,reasons};
}
module.exports={VERSION:'distribution-product-detail-quality-v1.0',evaluate};
