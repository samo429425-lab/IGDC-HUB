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
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const value = raw.toLowerCase();
  if (!value) return false;
  const inner = raw.replace(/^\s*[\[(（]\s*|\s*[\])）]\s*$/gu, '').replace(/[.。！？!?…:：\-–—\s]+/gu, '').toLowerCase();
  if (/^(?:speech|speaking|spokendialogue|dialogue|voice|voiceover|narration|spokenwords|말|대화|음성|음성대화|말소리|대사|나레이션)$/iu.test(inner)) return true;
  if (/(?:system\s*(?:prompt|message|policy)|developer\s*message|internal\s*(?:policy|instruction)|return\s+(?:json|only)|target\s+language\s*[:=]|source\s+(?:file|language)|translate\s+only\s+subtitle|preserve\s+every\s+cue)/i.test(value)) return true;
  const internalMarker = /(?:시스템\s*(?:프롬프트|메시지|정책|지시)|개발자\s*(?:메시지|지시)|내부\s*(?:정책|규칙|지침|명령)|프롬프트|json|대상\s*언어|원문\s*언어|타임스탬프|큐\s*(?:번호|id)|자막\s*(?:규칙|엔진|형식))/iu.test(raw);
  const directive = /(?:반환|출력|번역|보존|무시|따르|지켜|반드시|하지\s*마|규정대로|return|output|translate|preserve|ignore|follow|must|do\s*not|never)/iu.test(raw);
  return internalMarker && directive;
}
function isRecoverable(error) { const status = Number(error?.statusCode || 0); const msg = String(error?.message || '').toLowerCase(); return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || /timeout|overload|rate.limit|temporar/.test(msg); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function translateOnce(apiKey, subtitle, targetLang, targetName, fileName) {
  const system = [
    'You are a subtitle translation engine.',
    'Translate only the lexical spoken dialogue and actual sung lyric words already present in the subtitle into the authoritative requested target language.',
    'Preserve every cue number, timestamp, tag, blank line, line break and cue order exactly.',
    'Do not add commentary, markdown, explanations or code fences.',
    'Leave numbers, timestamp lines, cue settings, tags and empty lines unchanged.',
    'Use natural, concise, faithful subtitle phrasing and preserve relationship-appropriate honorifics, titles, professional register, dialectal or historical wording when the local context supports it.',
    'For actual sung lyric words, translate the lyric words in the same cue without replacing them with [music], [song], [speech], [speaking], [singing], [lyrics], or another generic label. Preserve a supplied leading ♪ marker.',
    'Never introduce generic classifier labels such as [speech], [speaking], [spoken dialogue], [dialogue], [voice], [narration], 말, 대화, 음성, 대사, or 나레이션. They are not subtitle text.',
    'Use standard established target-language names for people, places, buildings, countries, organizations, institutions, parties, products, and species. If no standard form exists, use faithful transliteration or the official name form.',
    'Never translate the literal components of a proper name into a newly invented descriptive phrase. Do not turn Seoraksan, Cheonggyecheon, or Cheongwadae into literal semantic translations; use their established target-language names.',
    'For historical, ancient, revived, regional, dialectal, code-switched, slang, colloquial, or newly coined expressions, use the surrounding subtitle context, genre, era, place, speaker relationship, and domain. Use a standard equivalent only when the intended meaning is clear. Never invent a dictionary definition, an etymology, a live-reference lookup, or an unsupported expansion; when uncertain, preserve the recognized form, official form, or a conservative transliteration.',
    'Preserve relationship-appropriate register and forms of address. For Korean, retain honorific speech and titles in unfamiliar, professional, service, official, senior-junior, medical, educational, military, public-safety, and respectful family contexts; use informal speech only when clearly supported. Apply equivalent formality in other target languages.',
    'For specialist material, use an established target-language term only when the field and meaning are clear from the subtitle context. Do not replace a precise but uncertain term with a vague paraphrase or a guessed everyday word.',
    'For medical, scientific, legal, historical, academic, technical, archaic, regional, slang, and newly coined terms, infer the domain from nearby subtitle context. When certainty is low, preserve the recognized official form or conservative transliteration instead of inventing a meaning.',
    'For Korean output, use established Korean names or accurate Hangul transliteration for foreign proper names; preserve official titles and technical terminology.',
    'Never output instructions, policies, prompts, JSON directions, source metadata, or commentary as subtitle dialogue.'
  ].join(' ');
  const user = [`Target language (authoritative): ${targetName} (${targetLang})`, `File: ${fileName || 'subtitle.srt'}`, 'Subtitle text:', subtitle].join('\n');
  const result = await postOpenAI(apiKey, { model: MODEL, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  return String(result?.choices?.[0]?.message?.content || '').trim();
}
function resumeDisposition(error) {
  const status = Number(error?.statusCode || 0);
  const msg = String(error?.message || error || '').toLowerCase();
  const transient = status === 429 || [500, 502, 503, 504].includes(status)
    || /timeout|timed out|overload|rate.?limit|temporar|socket|econnreset|econnrefused|enotfound|network|connection reset|connection closed/.test(msg);
  if (transient) return { retryable: true, resumable: true, resumeScope: 'same-unfinished-subtitle-group', checkpointPolicy: 'preserve-completed-retry-current-from-last-safe-overlap', doNotSkip: true, mediaQualityReviewRequired: false };
  return { retryable: false, resumable: true, resumeScope: 'manual-operator-review', checkpointPolicy: 'preserve-completed-do-not-auto-skip-unfinished', doNotSkip: true, mediaQualityReviewRequired: false };
}
function classifyError(error) {
  const status = Number(error?.statusCode || 500); const msg = String(error?.message || error || 'translate_failed'); const disposition = resumeDisposition(error);
  if (status === 429) return { statusCode: 429, code: 'openai_rate_limit', error: 'Translation service rate limit reached. Preserve completed groups and retry this unfinished group from the last safe overlap.', ...disposition };
  if (status === 504 || /timeout/i.test(msg)) return { statusCode: 504, code: 'openai_timeout', error: 'The current subtitle translation group timed out. Preserve completed groups and retry this unfinished group from the last safe overlap.', ...disposition };
  if (/api.?key|unauthor/i.test(msg)) return { statusCode: status === 500 ? 401 : status, code: 'openai_api_key', error: 'OpenAI API key is missing or invalid.', ...disposition };
  if (/quota|billing|payment/i.test(msg)) return { statusCode: status === 500 ? 402 : status, code: 'openai_billing_or_quota', error: 'OpenAI API quota or billing limit reached.', ...disposition };
  return { statusCode: status || 500, code: 'translate_failed', error: msg.slice(0, 700), ...disposition };
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
    return json(200, { ok: true, targetLang, targetLanguage: targetLang, targetLanguageVerified: targetLang, targetName: LANG_NAMES[targetLang], translatedSubtitle: translated, resumePolicy: 'desktop-preserve-completed-retry-unfinished-from-last-safe-overlap', transientFailurePolicy: 'never-skip-transient-network-or-server-failures' });
  } catch (error) {
    const out = classifyError(error);
    return json(out.statusCode, {
      ok: false,
      code: out.code,
      error: out.error,
      retryable: out.retryable,
      resumable: out.resumable,
      resumeScope: out.resumeScope,
      checkpointPolicy: out.checkpointPolicy,
      doNotSkip: out.doNotSkip,
      mediaQualityReviewRequired: out.mediaQualityReviewRequired
    });
  }
};
