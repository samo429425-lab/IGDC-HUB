'use strict';
const assert=require('node:assert/strict');
const { _test: core,handler }=require('../netlify/functions/igdc-organic-catalog.js');
function good(id='safe-1'){
 return {id,title:'실제 화장품 상품 50ml',description:'공개된 상품 상세 정보',url:'https://shop.example-store.co.kr/item/50ml',image:'https://shop.example-store.co.kr/images/50ml.jpg',currency:'KRW',price:19000,canonicalPublication:{status:'published',publishedAt:'2026-10-28T00:00:00Z'}};
}
(async()=>{
 const base=good(); assert(core.product(base),'real published product');
 assert.equal(core.product({...base,canonicalPublication:{status:'pending'}}),null,'pending rejected');
 assert.equal(core.product({...base,image:'/assets/img/placeholder.png'}),null,'placeholder rejected');
 assert.equal(core.product({...base,title:'Recommend Item 1'}),null,'sample rejected');
 assert.equal(core.product({...base,url:'https://example.com/shop/1'}),null,'example domain rejected');
 assert.equal(core.product({...base,url:'https://shop.example-store.co.kr/category/'}),null,'category rejected');
 assert.equal(core.product({...base,public:false}),null,'private rejected');
 const doc={pages:{distribution:{sections:{a:[base,base,{...base,id:'abc-2',canonicalPublication:{status:'pending'}}]}}}};
 const found=core.allProducts([doc]);assert.equal(found.length,1,'deduplicate IDs and reject unpublished');
 const xml=core.sitemap(found);assert(xml.includes('mode=product&amp;id=safe-1'));assert(!xml.includes('<script')); 
 const rendered=core.renderProduct(core.product({...base,title:'실제 상품 <b>공식</b>'}));assert(!rendered.includes('<b>공식</b>'),'escape/strip HTML');
 const response=await handler({httpMethod:'GET',queryStringParameters:{mode:'health'}});assert.equal(response.statusCode,200);
 const prod=await handler({httpMethod:'GET',queryStringParameters:{mode:'product',id:'unpublished-id'}});assert.equal(prod.statusCode,404);assert.match(prod.headers['x-robots-tag'],/noindex/);
 console.log('Organic catalog safety tests: PASS; actual public snapshot items: '+core.allProducts().length);
})().catch(e=>{console.error(e);process.exitCode=1});
