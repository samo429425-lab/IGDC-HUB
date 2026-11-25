'use strict';
const auth=require('./distribution-center-auth');
const c=require('./distribution-center-core');
async function ownerScope(event,member,requested){
  await auth.requireOwner(event,member);
  const country=requested===undefined||requested===null||requested===''?'KR':requested;
  if(typeof country!=='string'||!c.countries.has(country))throw c.error(403,'지원하지 않는 관리 국가입니다.');
  return {member_id:member.memberId,role:'director',owner:true,country,countries:[...c.countries]};
}
async function scope(event,member,grant,requested){
  if(member.roles.includes('owner'))return ownerScope(event,member,requested);
  return {...c.scope(member,grant,requested),owner:false};
}
function requireSellerRecord(scope,grant){
  if(scope.owner&&!c.sellerActive(grant,scope.country))throw c.error(409,'오너의 전역 관리 권한과 판매자 등록은 별개입니다. 이 작업은 승인된 판매자 계정이 필요합니다.');
}
module.exports={scope,ownerScope,requireSellerRecord};
