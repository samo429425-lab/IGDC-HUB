'use strict';
/** Bounded no-key OpenStreetMap Overpass discovery, PRIVATE leads only.
 * Not a search-engine scraper, not evidence of a merchant's commercial
 * eligibility, and never an automatic approval or front-page publication.
 * Caller supplies a validated ISO country code; external URLs are never
 * fetched here. The shared public-source lease rate-limits all countries.
 */
const Guard=require('./commerce-supplier-source-guard.v1');
const VERSION='igdc-country-osm-supplier-search.v1';
const ENDPOINT='https://overpass-api.de/api/interpreter';
// Bounded geographical seed positions (capital city coordinates); results
// are UNVERIFIED leads. Target country and actual merchant location must still
// pass the downstream country/seller evidence gates.
const CAPITAL_CENTERS=Object.freeze({"AF":[34.52601,69.17768],"AL":[41.32687,19.81879],"DZ":[36.77536,3.06019],"AS":[-14.27548,-170.70483],"AO":[-8.82727,13.24395],"AI":[18.2148,-63.0578],"AG":[17.1175,-61.8456],"AR":[-34.60757,-58.43709],"AM":[40.17761,44.51259],"AW":[12.52687,-70.03568],"AU":[-35.29759,149.10127],"AT":[48.20835,16.3725],"AZ":[40.37544,49.83268],"BS":[25.07835,-77.33833],"BH":[26.2235,50.58224],"BD":[23.75936,90.37881],"BB":[13.09778,-59.61842],"BY":[53.90233,27.56188],"BE":[50.84656,4.3517],"BZ":[17.2502,-88.77002],"BJ":[6.49907,2.62534],"BM":[32.2949,-64.783],"BT":[27.47276,89.62955],"BO":[-19.04772,-65.25943],"BA":[43.85198,18.38669],"BW":[-24.65814,25.90885],"BR":[-15.78,-47.93],"IO":[-7.33836,72.47182],"BN":[4.88955,114.94176],"BG":[42.6977,23.3219],"BF":[12.36819,-1.52709],"BI":[-3.36381,29.3675],"KH":[11.56827,104.92244],"CM":[3.86899,11.52133],"CA":[45.42111,-75.69031],"CV":[14.91602,-23.50961],"KY":[19.2869,-81.3674],"CF":[4.39072,18.55091],"TD":[12.11915,15.05028],"CL":[-33.4489,-70.6693],"CN":[39.90622,116.39128],"CX":[-10.42666,105.66867],"CC":[-12.18985,96.83045],"CO":[4.59808,-74.07604],"KM":[-11.69313,43.2543],"CG":[-4.26944,15.27123],"CD":[-4.32171,15.3126],"CK":[-21.20747,-159.77081],"CR":[9.93254,-84.07958],"CI":[6.80911,-5.27326],"HR":[45.81318,15.97705],"CU":[23.1353,-82.35896],"CY":[35.17393,33.36473],"CZ":[50.08747,14.42125],"DK":[55.68672,12.57007],"DJ":[11.8146,42.84531],"DM":[15.3017,-61.3881],"DO":[18.4802,-69.94211],"EC":[-0.22016,-78.51233],"EG":[30.04882,31.24367],"SV":[13.69899,-89.19142],"GQ":[3.75283,8.78006],"ER":[15.33897,38.93268],"EE":[59.43722,24.74537],"ET":[9.01079,38.76125],"FK":[-51.69506,-57.84917],"FO":[62.012,-6.768],"FJ":[-18.14159,178.44217],"FI":[60.16741,24.94258],"FR":[48.8567,2.35146],"GF":[4.93711,-52.32583],"PF":[-17.53738,-149.566],"TF":[-49.35368,70.24357],"GA":[0.39,9.454],"GM":[13.44135,-16.56247],"GE":[41.69346,44.80145],"DE":[52.51704,13.38886],"GH":[5.56001,-0.20574],"GI":[36.14081,-5.35413],"GR":[37.98394,23.7283],"GL":[64.17503,-51.73554],"GD":[12.0564,-61.7485],"GP":[16.00008,-61.73334],"GU":[13.47274,144.75202],"GT":[14.62223,-90.51852],"GG":[49.45681,-2.539],"GN":[9.51706,-13.69984],"GW":[11.86132,-15.58305],"GY":[6.80258,-58.16286],"HT":[18.54733,-72.33959],"HN":[14.10569,-87.20468],"HK":[22.3193,114.1694],"HU":[47.49838,19.04047],"IS":[64.14598,-21.94224],"IN":[28.61418,77.20227],"ID":[-6.17539,106.82718],"IR":[35.70062,51.40138],"IQ":[33.30243,44.3788],"IE":[53.34976,-6.26027],"IL":[31.77835,35.22508],"IT":[41.89332,12.48293],"JM":[17.97122,-76.79281],"JP":[35.68284,139.75946],"JE":[49.1868,-2.1066],"JO":[31.95157,35.92396],"KZ":[51.12822,71.43067],"KE":[-1.28325,36.81724],"KI":[1.34908,173.03865],"KP":[39.01947,125.75339],"KR":[37.56668,126.97829],"KW":[29.37971,47.97356],"KG":[42.87656,74.60701],"LA":[17.9641,102.61337],"LV":[56.9494,24.10518],"LB":[33.89592,35.47843],"LS":[-29.31005,27.47822],"LR":[6.32803,-10.79779],"LY":[32.89667,13.17779],"LI":[47.13929,9.5228],"LT":[54.68705,25.28291],"LU":[49.81587,6.12967],"MK":[41.99609,21.43165],"MG":[-18.91001,47.52558],"MW":[-13.98751,33.76814],"MY":[3.1517,101.69424],"MV":[4.1755,73.5093],"ML":[12.60503,-7.98651],"MT":[35.89898,14.51368],"IM":[54.15,-4.4818],"MH":[7.09099,171.38163],"MQ":[14.6028,-61.06767],"MR":[18.07924,-15.97801],"MU":[-20.16373,57.50453],"YT":[-12.78059,45.22799],"MX":[19.43263,-99.13318],"FM":[6.92074,158.16271],"MD":[47.02447,28.83225],"MC":[43.73235,7.42768],"MN":[47.91847,106.9177],"MS":[16.7425,-62.1874],"MA":[34.0224,-6.83454],"MZ":[-25.96621,32.56745],"NA":[-22.57439,17.07907],"NR":[-0.5471,166.9164],"NP":[27.70832,85.32058],"NL":[52.37276,4.8936],"NC":[-22.27453,166.44242],"NZ":[-41.2888,174.77721],"NI":[12.14599,-86.27467],"NE":[13.52483,2.10982],"NG":[9.06433,7.4893],"NU":[-19.05342,-169.9192],"NF":[-29.0544,167.9547],"MP":[15.19098,145.74685],"NO":[59.91333,10.73897],"OM":[23.59979,58.54513],"PK":[33.69381,73.06515],"PW":[7.50062,134.6243],"PA":[8.97145,-79.53418],"PG":[-9.47433,147.15995],"PY":[-25.28005,-57.63438],"PE":[-12.06211,-77.03653],"PH":[14.59062,120.97997],"PN":[-25.06667,-130.1002],"PL":[52.23372,21.07141],"PT":[38.70775,-9.13659],"PR":[18.4653,-66.11667],"QA":[25.28563,51.52642],"RE":[-20.8789,55.4481],"RO":[44.43614,26.10272],"RU":[55.75045,37.61749],"RW":[-1.88596,30.12967],"SH":[-15.9244,-5.7181],"KN":[17.29609,-62.7223],"LC":[13.95259,-60.98782],"PM":[46.7791,-56.1773],"VC":[13.15619,-61.22796],"WS":[-13.83437,-171.76928],"SM":[43.9364,12.4467],"ST":[0.33892,6.7313],"SA":[24.63197,46.71507],"SN":[14.69342,-17.44794],"RS":[44.81781,20.4569],"SC":[-4.6191,55.4513],"SL":[8.479,-13.26795],"SG":[1.35711,103.8195],"SK":[48.1517,17.10931],"SI":[46.04998,14.50686],"SB":[-9.43108,159.95525],"SO":[2.04278,45.33856],"ZA":[-25.74594,28.18794],"GS":[-54.28354,-36.49464],"SS":[4.8472,31.59517],"ES":[40.41671,-3.70358],"LK":[6.935,79.85385],"SD":[15.59333,32.53565],"SR":[5.82161,-55.17704],"SJ":[78.22316,15.64637],"SZ":[-26.44628,31.20838],"SE":[59.32512,18.07109],"CH":[46.94827,7.45145],"SY":[33.51307,36.30958],"TW":[25.03752,121.56368],"TJ":[38.54258,68.81521],"TZ":[-6.33728,35.73718],"TH":[13.75425,100.49309],"TL":[-8.5569,125.5603],"TG":[6.13042,1.21583],"TK":[-9.3743,-171.26454],"TO":[-21.13434,-175.20181],"TT":[10.65727,-61.51802],"TN":[33.84394,9.40014],"TR":[39.92078,32.85407],"TM":[37.93967,58.38743],"TV":[-8.535,179.11865],"UG":[0.31771,32.58135],"UA":[50.45003,30.52414],"AE":[24.4748,54.37058],"GB":[51.50732,-0.12765],"US":[38.89499,-77.03657],"UY":[-34.9059,-56.19136],"UZ":[41.31234,69.27871],"VU":[-17.7415,168.31502],"VE":[10.5061,-66.9146],"VN":[21.02945,105.85444],"WF":[-13.28204,-176.17402],"EH":[27.15451,-13.19539],"YE":[15.35386,44.20588],"ZM":[-15.41645,28.28215],"ZW":[-17.83177,31.04569],"MO":[22.19875,113.54387],"AD":[42.50779,1.52109],"AX":[60.09726,19.93481],"BL":[17.8979,-62.8506],"BQ":[12.15,-68.2667],"CW":[12.108,-68.935],"ME":[42.4397,19.2661],"MF":[18.0706,-63.0847],"MM":[19.75,96.1],"PS":[31.89964,35.20422],"SX":[18.0256,-63.0492],"TC":[21.4664,-71.136],"VA":[41.9033,12.4534],"VG":[18.4167,-64.6167],"VI":[18.3419,-64.9307],"XK":[42.6633,21.1622]});
const US_CITY_CENTERS=Object.freeze({
  "AL":[32.3777298,-86.3005639],
  "AK":[58.3020694,-134.4104388],
  "AZ":[33.4482497,-112.097065],
  "AR":[34.746745,-92.2892284],
  "CA":[38.5765854,-121.4935591],
  "CO":[39.7392198,-104.9849779],
  "CT":[41.7642752,-72.6823164],
  "DE":[39.1572815,-75.5195811],
  "FL":[30.4381047,-84.2821265],
  "GA":[33.7490287,-84.3879614],
  "HI":[21.3073439,-157.8573111],
  "ID":[43.6177948,-116.1998483],
  "IL":[39.7983912,-89.6547203],
  "IN":[39.7683841,-86.1627697],
  "IA":[41.5911079,-93.6038358],
  "KS":[39.0482389,-95.6780057],
  "KY":[38.1866989,-84.8753598],
  "LA":[30.457024,-91.1873935],
  "ME":[44.307213,-69.7816228],
  "MD":[38.9788927,-76.491037],
  "MA":[42.3587532,-71.0640129],
  "MI":[42.7336193,-84.5555605],
  "MN":[44.9551063,-93.1021034],
  "MS":[32.303763,-90.1820382],
  "MO":[38.5791852,-92.1728432],
  "MT":[46.5857742,-112.0183427],
  "NE":[40.8080641,-96.6997467],
  "NV":[39.1640815,-119.7663053],
  "NH":[43.2069054,-71.5382718],
  "NJ":[40.2203572,-74.7699552],
  "NM":[35.6823747,-105.9396043],
  "NY":[42.6525086,-73.7575015],
  "NC":[35.7803724,-78.6391225],
  "ND":[46.8207637,-100.7827194],
  "OH":[39.961461,-82.9987984],
  "OK":[35.4922882,-97.5033801],
  "OR":[44.938743,-123.0301147],
  "PA":[40.2644747,-76.8837835],
  "RI":[41.8308218,-71.414855],
  "SC":[34.0004393,-81.0331509],
  "SD":[44.3671094,-100.3462286],
  "TN":[36.1658985,-86.7841708],
  "TX":[30.2746658,-97.7403271],
  "UT":[40.7773586,-111.888132],
  "VT":[44.2624522,-72.5804725],
  "VA":[37.5387651,-77.4335963],
  "WA":[47.0357595,-122.9049162],
  "WV":[38.3364019,-81.6120072],
  "WI":[43.0746533,-89.3841797],
  "WY":[41.140301,-104.8203092],
  "DC":[38.905985,-77.033418],
  "PR":[18.4653,-66.11667],
  "GU":[13.47274,144.75202],
  "VI":[18.3419,-64.9307],
  "AS":[-14.27548,-170.70483],
  "MP":[15.19098,145.74685]
});
// National discovery rotates across 50 states and DC rather than repeatedly scanning Washington.
const US_NATIONAL_CENTERS=Object.freeze(Object.keys(US_CITY_CENTERS).filter(code=>!(["PR","GU","VI","AS","MP"].includes(code))));
const text=v=>v==null?'':String(v).trim();
function locationForCountry(country,offsetInput,regionInput,dayInput){
  const code=text(country).toUpperCase();
  const region=text(regionInput||'NATIONWIDE').toUpperCase();
  if(!/^[A-Z]{2}$/.test(code))return null;
  const page=Math.max(0,Math.floor(Number(offsetInput)||0));
  if(code==='US'){
    // State selection is an existing explicit user scope. A US-NATIONWIDE
    // search rotates across actual state capitals; it is never called a
    // complete nationwide or state-wide business directory scan.
    let key=region;
    if(region==='NATIONWIDE'){
      const utcDay=Number.isFinite(Number(dayInput))?Math.floor(Number(dayInput)):Math.floor(Date.now()/86400000);
      key=US_NATIONAL_CENTERS[(Math.floor(page/24)+utcDay*7)%US_NATIONAL_CENTERS.length];
    }else if(/^US-[A-Z]{2}$/.test(region))key=region.slice(3);
    const center=US_CITY_CENTERS[key];
    return center?{center,scope:region,citySeed:key}:null;
  }
  // Unsupported foreign subdivisions cannot silently search a national capital.
  if(region!=='NATIONWIDE')return null;
  const center=CAPITAL_CENTERS[code];
  if(!center)return null;
  const lane=Math.floor(page/24)%5;
  const shift=[[0,0],[0.06,0],[-0.06,0],[0,0.085],[0,-0.085]][lane];
  return{center:[center[0]+shift[0],center[1]+shift[1]],scope:region,citySeed:null};
}
function queryForCountry(country,offsetInput,regionInput){
  const location=locationForCountry(country,offsetInput,regionInput);
  if(!location)return '';
  const lat=Number(location.center[0].toFixed(5));
  const lon=Number(location.center[1].toFixed(5));
  // Large 15 km/3-tag scans routinely exceed 7 s client timeout for US
  // metropolitan areas. Make bounded smaller discovery scans; all evidence
  // is still independently inspected and no seller is auto-approved.
  const radius=text(country).toUpperCase()==='US'?7500:15000;
  const nearby='(around:'+radius+','+lat+','+lon+')';
  return '[out:json][timeout:7];('+ 
    'nwr'+nearby+'["shop"]["website"]["name"];'+
    'nwr'+nearby+'["craft"]["website"]["name"];'+
    'nwr'+nearby+'["shop"]["contact:website"]["name"];);'+
    'out tags center 25;';
}
function safeUrl(raw){
  try{
    const u=new URL(text(raw)),host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!host||Guard.reason(u.toString()))return '';
    if(host==='localhost'||host==='metadata.google.internal'||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.localhost')||host.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(host))return '';
    if(/(?:^|\/)(?:login|log-in|signin|sign-in|signup|sign-up|register|registration|auth|oauth|account|accounts|cart|checkout|basket|search|results)(?:\/|$)/i.test(u.pathname))return '';
    if(u.searchParams.has('q')&&/(?:^|\/)(?:search|results)(?:\/|$)/i.test(u.pathname))return '';
    u.hash='';return u.toString();
  }catch(_e){return '';}
}
function parseResults(payload,country){
  const rows=Array.isArray(payload&&payload.elements)?payload.elements:[],found=[],seen=new Set(),rejected={noWebsite:0,noName:0,blocked:0,duplicate:0};
  for(const el of rows){
    const tags=el&&el.tags||{},website=text(tags.website||tags['contact:website']);
    const name=text(tags.name||tags['name:en']).replace(/<[^>]*>/g,' ').slice(0,180);
    if(!website){rejected.noWebsite++;continue;}
    if(!name){rejected.noName++;continue;}
    const url=safeUrl(website);
    if(!url){rejected.blocked++;continue;}
    const host=new URL(url).hostname.toLowerCase();
    if(seen.has(host)){rejected.duplicate++;continue;}
    seen.add(host);
    const type=text(tags.shop||tags.craft).slice(0,80);
    found.push({title:name,name,url,link:url,provider:'osm',source:'osm_mapped_business_official_website',type:'web',
      summary:'OpenStreetMap-listed business website; commercial eligibility and seller country NOT independently verified',
      payload:{source:'osm',country,osmType:type,osmId:String(el.type||'')+'/'+String(el.id||''),queryOrigin:'public-business-website-lead'}});
    if(found.length>=16)break;
  }
  return{items:found,rawElements:rows.length,rejected};
}
async function search(_task,scope,opts){
  const country=text(scope&& (scope.country||scope.countryCode)).toUpperCase();
  const region=text(scope&&(scope.region||scope.subdivisionCode)||'NATIONWIDE');
  const query=queryForCountry(country,opts&&opts.offset,region);
  if(!query)return{provider:'osm',status:country==='US'?'unavailable_us_subdivision_center':(!CAPITAL_CENTERS[country]?'unavailable_country_center':'regional_scope_requires_verified_location'),items:[],count:0};
  const timeoutMs=Math.max(3500,Math.min(10500,Number(opts&&opts.timeoutMs)||9000));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),started=Date.now();
  try{
    const response=await fetch(ENDPOINT,{method:'POST',signal:controller.signal,
      headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent':'IGDC-SupplierResearch/1.1 (https://igdcglobal.com; public-info-only; rate-limited)'},
      body:new URLSearchParams({data:query}).toString()});
    if(!response.ok){
      const raw=text(response.headers&&response.headers.get&&response.headers.get('retry-after'));
      return{provider:'osm',status:'http_'+response.status,count:0,items:[],elapsedMs:Date.now()-started,
        httpStatus:response.status,retryAfterMs:/^\d{1,8}$/.test(raw)?Math.min(6*3600000,Number(raw)*1000):0};
    }
    const parsed=parseResults(await response.json(),country);
    return{provider:'osm',status:parsed.items.length?'ok':'empty',count:parsed.items.length,...parsed,
      elapsedMs:Date.now()-started,httpStatus:200};
  }catch(e){return{provider:'osm',status:/abort|timeout/i.test(text(e&&e.message))?'timeout':'network_error',count:0,items:[],elapsedMs:Date.now()-started};}
  finally{clearTimeout(timer);}
}
module.exports={VERSION,queryForCountry,locationForCountry,safeUrl,parseResults,search,centerCount:Object.keys(CAPITAL_CENTERS).length,usRegionalCenterCount:Object.keys(US_CITY_CENTERS).length};
