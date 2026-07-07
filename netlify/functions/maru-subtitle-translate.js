'use strict';

/*
 * MARU subtitle translation — SAFE52
 * One bounded SRT group per request. The desktop application owns the long-job
 * queue and checkpoint; this function never loops over a whole movie subtitle.
 */
const https = require('https');
const OPENAI_HOST = 'api.openai.com';
const OPENAI_PATH = '/v1/chat/completions';
const MODEL = process.env.OPENAI_SUBTITLE_MODEL || 'gpt-4o-mini';
const OPENAI_TIMEOUT_MS = Math.max(15000, Math.min(75000, Number(process.env.MARU_TRANSLATE_TIMEOUT_MS || 60000) || 60000));
const MAX_SUBTITLE_CHARS = Math.max(1000, Math.min(9000, Number(process.env.MARU_TRANSLATE_MAX_CHARS || 5200) || 5200));
const LANG_NAMES = Object.freeze({
  ko: 'Korean', en: 'English', zh: 'Simplified Chinese', zht: 'Traditional Chinese', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian', pt: 'Portuguese', it: 'Italian', ar: 'Arabic', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', hi: 'Hindi', tr: 'Turkish', ta: 'Tamil', sw: 'Swahili', ur: 'Urdu', bn: 'Bengali', fa: 'Persian', hu: 'Hungarian', ms: 'Malay', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', tl: 'Filipino', uk: 'Ukrainian', uz: 'Uzbek'
});
function headers(extra = {}) { return { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store', ...extra }; }
function json(statusCode, body) { return { statusCode, headers: headers(), body: JSON.stringify(body || {}) }; }
function normalizeLanguage(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zht'].includes(raw)) return 'zht';
  if (raw.startsWith('zh')) return 'zh';
  if (raw === 'fil') return 'tl';
  const short = raw.split('-')[0]; return Object.prototype.hasOwnProperty.call(LANG_NAMES, short) ? short : '';
}
function parseBody(event) { try { const raw = event?.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event?.body || ''); return raw.trim() ? JSON.parse(raw) : {}; } catch (error) { const e = new Error('invalid_json'); e.statusCode = 400; throw e; } }
function openAiError(status, body) { const e = new Error(`openai_${status}: ${String(body || '').slice(0, 600)}`); e.statusCode = status; return e; }
function postOpenAI(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(payload); let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    const req = https.request({ hostname: OPENAI_HOST, path: OPENAI_PATH, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(raw) }, timeout: OPENAI_TIMEOUT_MS }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) return finish(reject, openAiError(res.statusCode, body)); try { finish(resolve, JSON.parse(body)); } catch { const e = new Error('openai_invalid_json'); e.statusCode = 502; finish(reject, e); } });
    });
    req.on('timeout', () => { const e = new Error('openai_timeout'); e.statusCode = 504; try { req.destroy(e); } catch {} });
    req.on('error', (error) => finish(reject, error)); req.write(raw); req.end();
  });
}
function normalizeCueTimes(text) { return (String(text || '').match(/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}.*$/gm) || []).map((x) => x.replace(/\./g, ',').replace(/\s+/g, ' ').trim()); }
function cueCount(text) { return normalizeCueTimes(text).length; }
function isInstructionLeak(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return /(?:system\s*(?:prompt|message|policy)|developer\s*message|internal\s*(?:policy|instruction)|return\s+(?:json|only)|target\s+language\s*[:=]|source\s+(?:file|language)|translate\s+only\s+subtitle|preserve\s+every\s+cue)/i.test(value);
}
function isRecoverable(error) { const status = Number(error?.statusCode || 0); const msg = String(error?.message || '').toLowerCase(); return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || /timeout|overload|rate.limit|temporar/.test(msg); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function translateOnce(apiKey, subtitle, targetLang, targetName, fileName) {
  const system = [
    'You are a subtitle translation engine.',
    'Translate only subtitle dialogue into the authoritative requested target language.',
    'Preserve every cue number, timestamp, tag, blank line, line break and cue order exactly.',
    'Do not add commentary, markdown, explanations or code fences.',
    'Leave numbers, timestamp lines, cue settings, tags and empty lines unchanged.',
    'Use natural, concise, faithful subtitle phrasing.',
    'Use standard established target-language names for people, places, buildings, countries, organizations, institutions, parties, products, and species. If no standard form exists, use faithful transliteration or the official name form.',
    'Never translate the literal components of a proper name into a newly invented descriptive phrase. Do not turn Seoraksan, Cheonggyecheon, or Cheongwadae into literal semantic translations; use their established target-language names.',
    'For Korean output, use established Korean names or accurate Hangul transliteration for foreign proper names; preserve official titles and technical terminology.',
    'Never output instructions, policies, prompts, JSON directions, source metadata, or commentary as subtitle dialogue.'
  ].join(' ');
  const user = [`Target language (authoritative): ${targetName} (${targetLang})`, `File: ${fileName || 'subtitle.srt'}`, 'Subtitle text:', subtitle].join('\n');
  const result = await postOpenAI(apiKey, { model: MODEL, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  return String(result?.choices?.[0]?.message?.content || '').trim();
}
function classifyError(error) {
  const status = Number(error?.statusCode || 500); const msg = String(error?.message || error || 'translate_failed');
  if (status === 429) return { statusCode: 429, code: 'openai_rate_limit', error: 'Translation service rate limit reached. Retry this subtitle group after a short delay.' };
  if (status === 504 || /timeout/i.test(msg)) return { statusCode: 504, code: 'openai_timeout', error: 'The current subtitle translation group timed out. Retry this group.' };
  if (/api.?key|unauthor/i.test(msg)) return { statusCode: status === 500 ? 401 : status, code: 'openai_api_key', error: 'OpenAI API key is missing or invalid.' };
  if (/quota|billing|payment/i.test(msg)) return { statusCode: status === 500 ? 402 : status, code: 'openai_billing_or_quota', error: 'OpenAI API quota or billing limit reached.' };
  return { statusCode: status || 500, code: 'translate_failed', error: msg.slice(0, 700) };
}
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: headers(), body: '' };
  if (event.httpMethod === 'GET') return json(200, { ok: true, service: 'maru-subtitle-translate', version: 'safe52-single-group', configured: !!process.env.OPENAI_API_KEY, maxSubtitleChars: MAX_SUBTITLE_CHARS, method: 'POST_REQUIRED' });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, code: 'method_not_allowed', error: 'method_not_allowed' });
  try {
    const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) return json(500, { ok: false, code: 'openai_key_missing', error: 'OPENAI_API_KEY_missing' });
    const body = parseBody(event); const subtitle = String(body.subtitle || ''); const targetLang = normalizeLanguage(body.targetLang || body.targetLanguage || ''); const fileName = String(body.fileName || 'subtitle.srt').slice(0, 200);
    if (!subtitle.trim()) return json(400, { ok: false, code: 'empty_subtitle', error: 'empty_subtitle' });
    if (!targetLang) return json(400, { ok: false, code: 'unsupported_target_language', error: 'Unsupported target language.' });
    if (subtitle.length > MAX_SUBTITLE_CHARS) return json(413, { ok: false, code: 'translation_group_too_large', error: `Subtitle group exceeds ${MAX_SUBTITLE_CHARS} characters.` });
    const sourceTimes = normalizeCueTimes(subtitle); if (!sourceTimes.length) return json(422, { ok: false, code: 'timed_subtitle_required', error: 'Timed SRT subtitle cues are required.' });
    let translated = ''; let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { translated = await translateOnce(apiKey, subtitle, targetLang, LANG_NAMES[targetLang], fileName); break; }
      catch (error) { lastError = error; if (!isRecoverable(error) || attempt === 1) throw error; await delay(900); }
    }
    if (!translated) throw lastError || new Error('empty_translation');
    if (isInstructionLeak(translated)) return json(422, { ok: false, code: 'translation_instruction_leak', error: 'Translation contained non-dialogue instruction text and was rejected.' });
    const translatedTimes = normalizeCueTimes(translated);
    if (translatedTimes.length !== sourceTimes.length || translatedTimes.some((x, i) => x !== sourceTimes[i]) || cueCount(translated) !== cueCount(subtitle)) {
      return json(422, { ok: false, code: 'translation_structure_invalid', error: 'Translation did not preserve the original SRT cue structure. Retry this group.' });
    }
    return json(200, { ok: true, targetLang, targetLanguage: targetLang, targetLanguageVerified: targetLang, targetName: LANG_NAMES[targetLang], translatedSubtitle: translated });
  } catch (error) { const out = classifyError(error); return json(out.statusCode, { ok: false, code: out.code, error: out.error }); }
};
