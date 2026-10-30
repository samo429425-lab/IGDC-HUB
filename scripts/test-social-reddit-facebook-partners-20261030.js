'use strict';
/* Offline, non-mutating Social 5-provider pipeline and Partner safety tests. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const Store=require('../netlify/functions/lib/social-candidate-store.v1');
const Partner=require('../netlify/functions/lib/social-promotion-partners.v1');
const Adapter=require('../netlify/functions/lib/social-searchbank-release-adapter.v1');
const active=['social-youtube','social-instagram','social-tiktok','social-facebook','social-reddit'];
const retired=['social-snapchat','social-bilibili','social-douyin'];
const read=rel=>JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
const orig=path.resolve(root,'../../../social_audit/IGDC-HUB-main');
// PSOM mirrors and Social snapshot mirrors must agree on exact active contract.
for(const rel of ['data/psom.json','netlify/functions/data/psom.json']){
 const s=read(rel).pages.social;
 assert.deepEqual(s.sections.filter(x=>x.startsWith('social-') && x!=='social-maru'),active);
 assert.equal(s.mapping.reddit,'social-reddit');
 for(const key of ['snapchat','bilibili','douyin'])assert.equal(s.mapping[key],undefined);
}
const mirrors=['data/social.snapshot.json','netlify/functions/data/social.snapshot.json'];
assert.deepEqual(read(mirrors[0]),read(mirrors[1]));
for(const rel of mirrors){
 const d=read(rel),sections=d.pages.social.sections;
 for(const k of active)assert.equal(sections[k].length,100,k);
 for(const k of retired)assert.equal(sections[k],undefined,k);
 assert.equal(sections.rightPanel.length,100);
 assert.equal(sections['social-maru'].length,100);
 const originalFile=path.join(orig,rel);
 if(fs.existsSync(originalFile)){
   const old=JSON.parse(fs.readFileSync(originalFile,'utf8'));
   assert.deepEqual(sections.rightPanel,old.pages.social.sections.rightPanel,'right panel strictly unchanged');
   assert.deepEqual(sections['social-maru'],old.pages.social.sections['social-maru'],'reserved MARU section unchanged');
 }
}
// canonical SearchBank has no synthetic Reddit content; only obsolete social seed entries removed.
const banks=['data/search-bank.snapshot.json','netlify/functions/data/search-bank.snapshot.json','netlify/functions/search-bank.snapshot.json'];
assert.deepEqual(read(banks[0]),read(banks[1]));assert.deepEqual(read(banks[1]),read(banks[2]));
for(const k of retired)assert.ok(!read(banks[0]).items.some(x=>(x.psom_key||x.section||x.bind&&x.bind.section)===k),'retired '+k);
const policy=Store.Policy;
assert.deepEqual(policy.SECTION_KEYS,active);
const urls=['https://www.reddit.com/r/travel/comments/abc123/beautiful_city/','https://www.reddit.com/r/technology/comments/xyz456/a_discussion/'];
assert.ok(Store.platformContentUrl('reddit',urls[0]));
assert.equal(Store.platformContentUrl('reddit','https://www.reddit.com/r/travel/'),'');
assert.equal(Store.platformContentUrl('reddit','https://www.reddit.com/user/example/'),'');
const row={id:'c0000000-0000-4000-8000-000000000001',section_key:'social-reddit',platform:'reddit',
 source_url:urls[0],review_status:'approved',verification_status:'verified',risk_level:'low',
 public_access:true,access_status:'public',title:'Verified public travel post',
 raw:{latestContentUrl:urls[0],latestContentAsset:true,assetClass:'latest_content',channelUrl:'https://www.reddit.com/user/samplecreator/'},
 thumbnail_url:'https://preview.redd.it/real-post.jpg',rotation_score:10};
assert.equal(Store.isPublishEligibleContentRow(row),true);
const safePartner={section_key:'social-reddit',channel_url:'https://www.reddit.com/user/samplecreator/',cooperation_status:'active',
 priority_enabled:true,verified_at:'2026-10-29T12:00:00Z',verified_by:'director-1',contract_proof_reference:'AGREEMENT-001',signed_from:'2026-10-29',signed_until:null};
const pending={...safePartner,verified_at:null};
const expired={...safePartner,signed_until:'2026-10-29'};
assert.equal(Partner.active(safePartner,new Date('2026-10-30T09:00:00Z')),true);
assert.equal(Partner.active(pending),false);assert.equal(Partner.active(expired),false);
const {rows:decorated,matched}=Partner.decorate([row],[safePartner]);
assert.equal(matched,1);assert.ok(decorated[0].rotation_score>row.rotation_score);
assert.equal(Partner.decorate([row],[pending]).matched,0);
assert.equal(Partner.decorate([row],[expired]).matched,0);
assert.equal(Partner.decorate([{...row,review_status:'hold'}],[safePartner]).matched,0);
// Snapshot and ranking tests: only five Social main sections may change.
const base=read('data/social.snapshot.json');
const beforeRight=JSON.stringify(base.pages.social.sections.rightPanel);
const beforeMaru=JSON.stringify(base.pages.social.sections['social-maru']);
const snapshot=Store.buildSnapshot(base,[row],{route:{scopeMode:'global'},requestedSections:['social-reddit'],
 seedSnapshot:base,reconcileTargetSections:true,selectiveReplacement:true,rotationSalt:'2026-10-30'});
assert.ok(snapshot.pages.social.sections['social-reddit'].some(x=>x.type==='external_social'));
const ranking=Partner.prioritizeSnapshotSlots(snapshot,decorated);
assert.equal(ranking.prioritized,1);assert.equal(snapshot.pages.social.sections['social-reddit'][0].type,'external_social');
assert.equal(JSON.stringify(snapshot.pages.social.sections.rightPanel),beforeRight);
assert.equal(JSON.stringify(snapshot.pages.social.sections['social-maru']),beforeMaru);
const adapted=Adapter.releaseToBank({release_id:'offline-test',snapshot_hash:'offline-hash',snapshot});
assert.ok(adapted && adapted.bank && adapted.bank.items.some(x=>x.psom_key==='social-reddit'));
const gate=Adapter.policyGate(root,adapted.bank);
assert.equal(gate.ok,true,JSON.stringify(gate.rejected||[]).slice(0,500));
assert.ok(gate.accepted.some(x=>x.psom_key==='social-reddit'));
// Main UI provider-vendor controls remain inside official embeds.
const main=fs.readFileSync(path.join(root,'assets/js/socialnetwork-automap-v3.js'),'utf8');
const viewer=fs.readFileSync(path.join(root,'assets/js/igdc-social-sns-viewer-bridge.js'),'utf8');
assert.match(main,/Native interactions only/);assert.match(main,/social-facebook.*pic\{aspect-ratio:4 \/ 5/);
assert.match(viewer,/reddit-official-post/);assert.match(viewer,/facebook-post/);
assert.match(viewer,/recordSocialMainEvent\('viewer_open'/);
for(const language of ['',...policy.LANGUAGES_30.filter(x=>x!=='ko')]){
 const rel=language?language+'/socialnetwork_'+language+'.html':'socialnetwork.html';
 assert.ok(fs.existsSync(path.join(root,rel)),rel);
 const html=fs.readFileSync(path.join(root,rel),'utf8');
 assert.match(html,/socialnetwork-automap-v3\.js\?v=20261030-provider-native-reddit-v2/);
}
const admin=fs.readFileSync(path.join(root,'social-candidate-queue.html'),'utf8');
for(const marker of ['socialPartnerPanel','socialPartnerDiagnosticBtn','socialPartnerVerifyBtn','socialPartnerRows','social-reddit'])assert.ok(admin.includes(marker),marker);
assert.ok(fs.existsSync(path.join(root,'supabase/social_promotion_partners.sql')));
assert.ok(fs.existsSync(path.join(root,'assets/js/admin-social-partners.js')));
console.log('PASS: 5 active SNS, 30 front locale HTMLs, mirrored PSOM/Social/SearchBank, unchanged rightPanel/MARU, Reddit strict URL + policy gate + Snapshot release, partner approval priority and safety, Facebook native embed and tracked outbound');
