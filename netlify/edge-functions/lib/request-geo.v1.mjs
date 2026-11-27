/* IGDC country detection contract v1. Keep the Edge and Node copies byte-identical
 * except their export statement. Detection is NOT permission or service policy.
 * Never use query parameters, language, or a different country's subdivision as IP evidence.
 */
const VERSION = 'igdc-request-geo.v1';
// ISO registry plus KP for independent policy evaluation (not permission).
const KNOWN_COUNTRIES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' '));
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const text = v => typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
function countryCode(value) {
  const o = object(value);
  const code = text(o.code || o.alpha2 || o.iso_code || o.countryCode || o.country_code || value).toUpperCase();
  return KNOWN_COUNTRIES.has(code) ? code : '';
}
function regionCode(value, country) {
  const o = object(value);
  let code = text(o.code || o.iso_code || o.id || o.subdivisionCode || o.regionCode || o.stateCode || o.provinceCode || value).toUpperCase().replace(/[._/\s]+/g, '-').replace(/^-+|-+$/g, '');
  if (!country || ['NATIONAL','NATIONWIDE','GLOBAL','UNKNOWN'].includes(code)) return '';
  if (code.startsWith(country + '-')) code = code.slice(3);
  else if (/^[A-Z]{2}-/.test(code)) return ''; // do not borrow a foreign ISO subdivision
  return /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(code) ? code : '';
}
function firstValid(values, normalize) {
  for (const value of values) { const result = normalize(value); if (result) return result; }
  return '';
}
function fromObject(value, source) {
  const geo = object(value);
  const country = firstValid([geo.country, geo.countryCode, geo.country_code], countryCode);
  const region = country ? firstValid([geo.subdivision, geo.subdivisionCode, geo.regionCode, geo.stateCode, geo.provinceCode, geo.region, geo.state], v => regionCode(v, country)) : '';
  return { country, region, city: country ? text(geo.city).slice(0,80) : '', source: country ? source : 'unresolved', version: VERSION };
}
function readHeader(value) {
  const raw = text(value); if (!raw || raw.length > 16384) return {};
  try { return object(JSON.parse(raw)); } catch (_) {}
  try { return object(JSON.parse(decodeURIComponent(raw))); } catch (_) { return {}; }
}
function fromContext(context) { return fromObject(context && context.geo, 'netlify-edge-context-geo'); }
function fromEvent(event) {
  const headers = {};
  for (const [key,value] of Object.entries(object(event && event.headers))) headers[key.toLowerCase()] = value;
  // Keep each source atomic: never merge a country's code with another source's region.
  const direct = fromObject(event && event.geo, 'event-geo');
  if (direct.country) return direct;
  const netlify = fromObject(readHeader(headers['x-nf-geo']), 'netlify-geo-header');
  if (netlify.country) return netlify;
  // Legacy compatibility only; headers are not proof of identity or authorization.
  const country = firstValid([headers['x-nf-country'],headers['cf-ipcountry'],headers['x-country'],headers['x-vercel-ip-country']], countryCode);
  const supplied = [headers['x-nf-country'],headers['cf-ipcountry'],headers['x-country'],headers['x-vercel-ip-country']].map(countryCode).filter(Boolean);
  if (new Set(supplied).size > 1) return fromObject(null, 'unresolved');
  const region = country ? firstValid([headers['x-nf-subdivision'],headers['x-nf-region'],headers['x-region'],headers['x-vercel-ip-country-region']], v => regionCode(v,country)) : '';
  return { country, region, city: country ? text(headers['x-nf-city'] || headers['x-city'] || headers['x-vercel-ip-city']).slice(0,80) : '', source: country ? 'legacy-geo-header' : 'unresolved', version: VERSION };
}
export { VERSION, countryCode, regionCode, fromContext, fromEvent };
