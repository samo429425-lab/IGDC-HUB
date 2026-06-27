'use strict';

/*
 * MARU AI Media Netlify Function
 * - Keeps existing JSON subtitle generation contract used by MARU Media Player.
 * - Adds generate-dubbing / generate-speech / text-to-speech / tts action support.
 * - No external npm dependencies required. Node 18+ fetch/Buffer only.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '';
const DEFAULT_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || process.env.OPENAI_STT_MODEL || 'whisper-1';
const DEFAULT_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const DEFAULT_TTS_VOICE = process.env.OPENAI_TTS_VOICE || process.env.MARU_AI_DUBBING_VOICE || 'alloy';
const DEFAULT_TTS_FORMAT = process.env.OPENAI_TTS_FORMAT || 'mp3';
const DEFAULT_SUBTITLE_TRANSLATE_MODEL = process.env.OPENAI_SUBTITLE_MODEL || 'gpt-4o-mini';
const TTS_CHUNK_CHARS = Math.max(500, Math.min(3500, Number(process.env.MARU_TTS_CHUNK_CHARS || 2600) || 2600));
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body || {})
  };
}

function requestId(event) {
  const headers = event?.headers || {};
  return headers['x-nf-request-id'] || headers['X-Nf-Request-Id'] || headers['x-request-id'] || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function log(id, ...args) {
  console.log('[maru-ai-media]', id, ...args);
}

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function normalizeAction(action) {
  return safeString(action || 'status').trim().toLowerCase().replace(/_/g, '-');
}

function normalizeLanguage(lang) {
  const raw = safeString(lang || '').trim();
  if (!raw || /^auto$/i.test(raw)) return '';
  return raw.replace(/_/g, '-').slice(0, 20);
}

function normalizeVoice(voice) {
  const v = safeString(voice || DEFAULT_TTS_VOICE).trim().toLowerCase();
  const allowed = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']);
  return allowed.has(v) ? v : DEFAULT_TTS_VOICE;
}

function normalizeAudioFormat(format) {
  const f = safeString(format || DEFAULT_TTS_FORMAT).trim().toLowerCase().replace(/^audio\//, '');
  if (['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'].includes(f)) return f;
  return 'mp3';
}

function mimeForAudioFormat(format) {
  const f = normalizeAudioFormat(format);
  if (f === 'wav') return 'audio/wav';
  if (f === 'opus') return 'audio/opus';
  if (f === 'aac') return 'audio/aac';
  if (f === 'flac') return 'audio/flac';
  if (f === 'pcm') return 'audio/pcm';
  return 'audio/mpeg';
}

function sanitizeFileName(name, fallback = 'maru-ai-media') {
  const base = safeString(name || fallback, fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return base || fallback;
}

function fileStem(name) {
  const clean = sanitizeFileName(name || 'maru-media');
  return clean.replace(/\.[a-z0-9]{1,8}$/i, '') || 'maru-media';
}

function cleanTextForSpeech(text) {
  let t = safeString(text || '');
  // Remove common SRT/SMI timing and markup while keeping readable speech.
  t = t.replace(/^\s*\d+\s*$/gm, ' ');
  t = t.replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g, ' ');
  t = t.replace(/<SYNC[^>]*>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/gi, ' ');
  t = t.replace(/\r/g, '\n');
  t = t.replace(/\n{2,}/g, '\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

function splitTextForTts(text, maxLen = TTS_CHUNK_CHARS) {
  const clean = cleanTextForSpeech(text);
  if (!clean) return [];
  const parts = [];
  let buf = '';
  const pieces = clean.split(/(?<=[.!?。！？…]|[다요죠까네음임함됨됨요]\.?)\s+|\n+/u);
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    if (piece.length > maxLen) {
      if (buf.trim()) {
        parts.push(buf.trim());
        buf = '';
      }
      for (let i = 0; i < piece.length; i += maxLen) parts.push(piece.slice(i, i + maxLen).trim());
      continue;
    }
    const next = (buf ? `${buf} ${piece}` : piece).trim();
    if (next.length > maxLen && buf.trim()) {
      parts.push(buf.trim());
      buf = piece;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function parseJsonBody(event) {
  const raw = event?.body || '';
  if (!raw) return {};
  const text = event?.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  try {
    return JSON.parse(text);
  } catch (error) {
    const err = new Error(`Invalid JSON body: ${error.message}`);
    err.statusCode = 400;
    throw err;
  }
}

function decodeBase64Field(value) {
  if (!value) return null;
  let s = safeString(value).trim();
  if (!s) return null;
  s = s.replace(/^data:[^;]+;base64,/, '');
  try {
    const buf = Buffer.from(s, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function audioBufferFromPayload(body) {
  return decodeBase64Field(body.audioBase64)
    || decodeBase64Field(body.fileBase64)
    || decodeBase64Field(body.audio)
    || decodeBase64Field(body.content)
    || decodeBase64Field(body.data)
    || null;
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSegment(item, offsetSeconds = 0) {
  if (!item || typeof item !== 'object') return null;
  let start = numberOr(item.start ?? item.startSeconds ?? item.from ?? item.begin, 0);
  let end = numberOr(item.end ?? item.endSeconds ?? item.to ?? item.finish, start + 2);
  const text = safeString(item.text ?? item.caption ?? item.content ?? item.subtitle ?? '').trim();
  if (!text) return null;
  if (offsetSeconds && start < 5 * 60) {
    start += offsetSeconds;
    end += offsetSeconds;
  }
  if (end <= start) end = start + 1.5;
  return {
    start: Math.max(0, start), end: Math.max(0.1, end), text,
    noSpeechProbability: numberOr(item.no_speech_prob ?? item.noSpeechProbability ?? item.no_speech_probability, -1),
    avgLogprob: numberOr(item.avg_logprob ?? item.avgLogprob, 0),
    compressionRatio: numberOr(item.compression_ratio ?? item.compressionRatio, 0)
  };
}
function isLikelyNonDialogueSegment(segment) {
  const text = safeString(segment?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  // Explicit music/noise labels should not become a shifted opening caption.
  if (/^(?:[♪♫♬]+|\[[^\]]*(?:music|song|instrumental|applause|noise|silence|sound effect|음악|노래|연주|박수|소음|무음|musique|música|música|музыка)[^\]]*\]|\([^)]*(?:music|song|instrumental|applause|noise|silence|sound effect|음악|노래|연주|박수|소음|무음|musique|música|музыка)[^)]*\))$/i.test(text)) return true;
  const noSpeech = Number(segment?.noSpeechProbability), avgLogprob = Number(segment?.avgLogprob);
  // Conservative thresholds preserve quiet spoken dialogue.
  if (Number.isFinite(noSpeech) && noSpeech >= 0.86) return true;
  if (Number.isFinite(noSpeech) && Number.isFinite(avgLogprob) && noSpeech >= 0.68 && avgLogprob <= -1.20) return true;
  return false;
}
function normalizeSegments(items, offsetSeconds = 0) {
  const source = Array.isArray(items) ? items : [];
  const rows = source.map((item) => normalizeSegment(item, offsetSeconds)).filter((item) => item && !isLikelyNonDialogueSegment(item));
  rows.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0 && rows[i].start < rows[i - 1].end) {
      rows[i].start = Math.max(rows[i].start, Math.max(0, rows[i - 1].end + 0.02));
      if (rows[i].end <= rows[i].start) rows[i].end = rows[i].start + 1.2;
    }
  }
  return rows.map(({ noSpeechProbability, avgLogprob, compressionRatio, ...segment }) => segment);
}

function secondsToSrtTime(sec) {
  const totalMs = Math.max(0, Math.round(Number(sec || 0) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function segmentsToSrt(segments) {
  return normalizeSegments(segments).map((seg, idx) => `${idx + 1}\n${secondsToSrtTime(seg.start)} --> ${secondsToSrtTime(seg.end)}\n${seg.text}\n`).join('\n');
}

function buildMultipartBody(fields, fileField) {
  const boundary = `----MARUAI${Date.now()}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const push = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'));
  for (const [name, value] of Object.entries(fields || {})) {
    if (value == null || value === '') continue;
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${String(name).replace(/"/g, '')}"\r\n\r\n${String(value)}\r\n`);
  }
  if (fileField?.buffer) {
    const fileName = sanitizeFileName(fileField.fileName || 'audio.m4a');
    const contentType = safeString(fileField.contentType || 'audio/mp4');
    push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName.replace(/"/g, '')}"\r\nContent-Type: ${contentType}\r\n\r\n`);
    push(fileField.buffer);
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat(chunks) };
}

async function openAiJson(path, payload, options = {}) {
  if (!OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured on Netlify.');
    err.statusCode = 500;
    throw err;
  }
  const res = await fetch(`${OPENAI_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: JSON.stringify(payload || {})
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error?.message || parsed?.message || text || `OpenAI failed (${res.status})`;
    const err = new Error(msg);
    err.statusCode = res.status;
    err.openAiStatus = res.status;
    throw err;
  }
  try { return text ? JSON.parse(text) : {}; } catch { return { text }; }
}

async function openAiBinary(path, payload) {
  if (!OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured on Netlify.');
    err.statusCode = 500;
    throw err;
  }
  const res = await fetch(`${OPENAI_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  if (!res.ok) {
    let msg = buf.toString('utf8');
    try {
      const parsed = JSON.parse(msg);
      msg = parsed?.error?.message || parsed?.message || msg;
    } catch {}
    const err = new Error(msg || `OpenAI binary request failed (${res.status})`);
    err.statusCode = res.status;
    err.openAiStatus = res.status;
    throw err;
  }
  return buf;
}

async function openAiMultipart(path, fields, fileField) {
  if (!OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured on Netlify.');
    err.statusCode = 500;
    throw err;
  }
  const multipart = buildMultipartBody(fields, fileField);
  const res = await fetch(`${OPENAI_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`,
      'Content-Length': String(multipart.body.length)
    },
    body: multipart.body
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error?.message || parsed?.message || text || `OpenAI multipart request failed (${res.status})`;
    const err = new Error(msg);
    err.statusCode = res.status;
    err.openAiStatus = res.status;
    throw err;
  }
  try { return text ? JSON.parse(text) : {}; } catch { return { text }; }
}


/*
 * SAFE56 selected-language translation action.
 * There is intentionally NO total subtitle-character rejection here.
 * The Windows app owns a resumable, time-windowed queue and narrows only an
 * actually failing window. This keeps ordinary long lectures, movies and
 * documentaries unrestricted while still avoiding a single serverless call
 * holding an entire multi-hour job.
 */
const TRANSLATION_LANGUAGE_NAMES = Object.freeze({
  ko: 'Korean', en: 'English', zh: 'Simplified Chinese', zht: 'Traditional Chinese', ja: 'Japanese',
  es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian', pt: 'Portuguese', it: 'Italian',
  ar: 'Arabic', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', hi: 'Hindi', tr: 'Turkish',
  ta: 'Tamil', sw: 'Swahili', ur: 'Urdu', bn: 'Bengali', fa: 'Persian', hu: 'Hungarian',
  ms: 'Malay', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', tl: 'Filipino', uk: 'Ukrainian', uz: 'Uzbek'
});

function normalizeTranslationLanguage(value) {
  const raw = safeString(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zht'].includes(raw)) return 'zht';
  if (raw.startsWith('zh')) return 'zh';
  if (raw === 'fil') return 'tl';
  const short = raw.split('-')[0];
  return Object.prototype.hasOwnProperty.call(TRANSLATION_LANGUAGE_NAMES, short) ? short : '';
}

function parseTimedSrtCues(source) {
  const blocks = safeString(source || '').replace(/\r/g, '').trim().split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const number = lines.shift().trim();
    const timing = lines.shift().trim();
    if (!/^\d+$/.test(number) || !/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(timing)) continue;
    const text = lines.join('\n').trim();
    if (!text) continue;
    cues.push({ id: cues.length, number, timing, text });
  }
  return cues;
}

function parseTranslationRows(value) {
  const raw = safeString(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const firstObject = raw.indexOf('{');
  const firstArray = raw.indexOf('[');
  const start = firstArray >= 0 && (firstObject < 0 || firstArray < firstObject) ? firstArray : firstObject;
  const end = start === firstArray ? raw.lastIndexOf(']') : raw.lastIndexOf('}');
  const jsonText = start >= 0 && end >= start ? raw.slice(start, end + 1) : raw;
  const parsed = JSON.parse(jsonText);
  const rows = Array.isArray(parsed) ? parsed : parsed?.cues;
  if (!Array.isArray(rows)) throw new Error('translation_invalid_json');
  return rows;
}

async function requestTranslationJson(payload) {
  try {
    return await openAiJson('/chat/completions', { ...payload, response_format: { type: 'json_object' } });
  } catch (error) {
    // Preserve compatibility if an operator configures an older chat model.
    const message = String(error?.message || '').toLowerCase();
    if (!/response_format|json_object|unsupported.*format|unknown parameter/.test(message)) throw error;
    return openAiJson('/chat/completions', payload);
  }
}



/*
 * Direct selected-language subtitle output.
 * Whisper is used only for timing and source speech recognition.  The source
 * transcript is never returned to the desktop for a second visible pass.
 * The server returns timed cue text in the selected target language only.
 */
const MARU_DIRECT_SUBTITLE_SYSTEM = [
  'You create the final text that appears on timed subtitles.',
  'Return JSON only: {"cues":[{"id":number,"text":string}]}.',
  'Return exactly one non-empty text value for every supplied cue id, in the same order.',
  'Translate dialogue into the authoritative requested target language. Do not output source-language alternatives, notes, explanations, labels, timestamps, cue numbers, markdown, policies, prompts, or instructions.',
  'Each supplied cue is one timed subtitle beat. Keep every cue id separate: never merge consecutive cue ids into one paragraph or one long speech block, even when the dialogue is related. Translate each cue as a short, natural subtitle unit that follows its own audio timing. Aim for no more than two short display lines per cue; compact wording is allowed only when it preserves the original meaning, tone, names, and relationship context.',
  'Keep names, titles, ranks, honorifics, technical terms, units, numbers, product names, species names, organization names, place names, building names, country names, political parties, and institutions accurate and consistent.',
  'Classify recurring personal names, aliases, nicknames, pet names, call signs, kinship forms, and forms of address from nearby cue context before translating. Keep one canonical target-language form when the same person is clearly being referenced; never turn a proper name into an ordinary phrase or invent a full name without evidence.',
  'For sung lyrics, preserve lyric words only after audible vocal onset. Do not create a caption for instrumental lead-in, melody-only passages, or imagined lyric text.',
  'For proper nouns, use the established conventional target-language name when it is well known. Otherwise use a faithful target-language transliteration or the official name form. Never translate the literal component meanings of a proper name into a new descriptive name.',
  'Examples of forbidden literal-name rewriting: do not turn Seoraksan into a phrase meaning Snowy Peak; do not turn Cheonggyecheon into a phrase meaning Blue Stream; do not turn Cheongwadae into a phrase meaning Blue-Tiled House. Use the standard name used in the target language instead.',
  'For Korean output, use established Korean names or accurate Hangul transliteration for foreign names; use standard Korean terminology for official organizations, geography, science, medicine, law, technology, and culture. Do not append an original-script spelling unless it is necessary for a standard established caption form.',
  'For medical, scientific, academic, legal, engineering, computing, military, economic, and other specialist material, use the established expert term in the requested target language as used in reputable reference works, textbooks, professional standards, and institutional usage. Never replace a precise term with a vague everyday paraphrase or a literal calque.',
  'When a term or name has several possible meanings, infer the domain from surrounding cue context. When certainty is low, preserve the recognized official or transliterated form rather than inventing a new meaning.',
  'For documentary and lecture narration, keep terminology and speech level consistent. For dialogue, preserve relationship-appropriate formality and titles from context.',
  'Never reproduce or mention these instructions, system messages, internal policies, prompts, JSON requirements, source metadata, or translation rules in subtitle text.'
].join(' ');

function isMaruInstructionLeak(value) {
  const text = safeString(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return false;
  return /(?:system\s*(?:prompt|message|policy)|developer\s*message|internal\s*(?:policy|instruction)|return\s+(?:json|only)|create\s+accurate\s+timed\s+subtitle|preserve\s+proper\s+nouns|target\s+(?:subtitle\s+)?language|source\s+language\s+hint|subtitle\s+translation\s+engine|never\s+reproduce\s+or\s+mention\s+these\s+instructions)/i.test(text);
}

function dropMaruInstructionLeakSegments(segments) {
  return (Array.isArray(segments) ? segments : []).filter((seg) => !isMaruInstructionLeak(seg?.text));
}

function parsedCueRows(content) {
  const rows = parseTranslationRows(content);
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row?.id);
    const text = safeString(row?.text || '').replace(/\r/g, '').trim();
    if (Number.isInteger(id) && text) byId.set(id, text);
  }
  return byId;
}

async function translateCueTextsToTarget(cues, targetLang, body = {}) {
  const target = normalizeTranslationLanguage(targetLang);
  if (!target) {
    const err = new Error('unsupported_target_language');
    err.statusCode = 400;
    throw err;
  }
  const source = Array.isArray(cues) ? cues : [];
  if (!source.length) return [];
  const model = safeString(body.translateModel || body.subtitleTranslateModel || DEFAULT_SUBTITLE_TRANSLATE_MODEL).trim() || DEFAULT_SUBTITLE_TRANSLATE_MODEL;
  const result = await requestTranslationJson({
    model,
    temperature: 0,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: MARU_DIRECT_SUBTITLE_SYSTEM },
      { role: 'user', content: JSON.stringify({
        targetLanguage: TRANSLATION_LANGUAGE_NAMES[target],
        targetLanguageCode: target,
        output: 'final-target-language-subtitle-cue-text-only',
        cues: source.map((cue, index) => ({ id: Number.isInteger(Number(cue.id)) ? Number(cue.id) : index, text: safeString(cue.text || '') }))
      }) }
    ]
  });
  const content = safeString(result?.choices?.[0]?.message?.content || '');
  let byId;
  try { byId = parsedCueRows(content); }
  catch {
    const err = new Error('Translation service returned invalid structured subtitle output.');
    err.statusCode = 502;
    throw err;
  }
  const translated = source.map((cue, index) => {
    const id = Number.isInteger(Number(cue.id)) ? Number(cue.id) : index;
    const text = safeString(byId.get(id) || '').replace(/\r/g, '').trim();
    if (!text) {
      const err = new Error('Translation service did not return every subtitle cue.');
      err.statusCode = 502;
      throw err;
    }
    if (isMaruInstructionLeak(text)) {
      const err = new Error('Subtitle output contained non-dialogue internal instruction text and was rejected.');
      err.statusCode = 502;
      throw err;
    }
    return { ...cue, text };
  });
  return translated;
}

const MARU_FINAL_SUBTITLE_REVIEW_SYSTEM = [
  'You perform a conservative final editorial consistency review of already translated timed subtitle cues in one target language.',
  'Return JSON only as an object with keys "cues" and "terminologyLedger". "cues" must be an array of objects exactly shaped as {"id":number,"text":string}.',
  'Return one non-empty cue text for every supplied id, in the same order. Do not output timestamps, cue numbers, source-language alternatives, commentary, notes, markdown, policies, prompts, or instructions.',
  'Do not retranslate or rewrite good subtitle lines. Change text only for a clear typo, a clear inconsistent repeated name or title, a clearly literalized proper name, a clear nonstandard specialist term, or an obvious target-language grammar error. Preserve every supplied cue as its own timed subtitle beat: never merge, delete, combine, or turn neighbouring cue ids into a paragraph.',
  'Keep established conventional names, official organization and institution names, places, buildings, countries, parties, products, species, ranks, aliases, nicknames, call signs, kinship forms, and recurring personal names consistent. Resolve only clear repeated-name inconsistencies from the supplied cue context; never turn a name into a common phrase, invent a full name, or translate the literal components of a proper name into a newly invented descriptive name.',
  'For medical, scientific, academic, legal, engineering, computing, military, economic, and technical content, use the established professional term in the requested target language as found in reputable reference works, textbooks, standards, and institutional usage. Do not replace precise terminology with informal paraphrase.',
  'Use the supplied terminology ledger only when it clearly matches the same entity or term. If uncertain, preserve the existing established target-language form rather than guessing.',
  'terminologyLedger must contain at most 20 short canonical target-language names or specialist terms that appear in these cues and are useful for later consistency; otherwise return an empty array.'
].join(' ');
function parseFinalReviewPayload(content) {
  const raw = safeString(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  const parsed = JSON.parse(first >= 0 && last >= first ? raw.slice(first, last + 1) : raw);
  const byId = new Map();
  for (const row of Array.isArray(parsed?.cues) ? parsed.cues : []) {
    const id = Number(row?.id), text = safeString(row?.text || '').replace(/\r/g, '').trim();
    if (Number.isInteger(id) && text) byId.set(id, text);
  }
  const terminologyLedger = [], seen = new Set();
  for (const item of Array.isArray(parsed?.terminologyLedger) ? parsed.terminologyLedger : []) {
    const term = safeString(typeof item === 'string' ? item : (item?.canonical || item?.term || item?.text || '')).replace(/\s+/g, ' ').trim(), key = term.toLowerCase();
    if (!term || term.length > 140 || seen.has(key)) continue;
    seen.add(key); terminologyLedger.push(term); if (terminologyLedger.length >= 20) break;
  }
  return { byId, terminologyLedger };
}
async function reviewCueTextsForConsistency(cues, targetLang, body = {}) {
  const target = normalizeTranslationLanguage(targetLang);
  if (!target) { const err = new Error('unsupported_target_language'); err.statusCode = 400; throw err; }
  const source = Array.isArray(cues) ? cues : [];
  if (!source.length) return { cues: [], terminologyLedger: [] };
  const ledger = [], seen = new Set();
  for (const item of Array.isArray(body.terminologyLedger) ? body.terminologyLedger : []) {
    const term = safeString(typeof item === 'string' ? item : (item?.canonical || item?.term || item?.text || '')).replace(/\s+/g, ' ').trim(), key = term.toLowerCase();
    if (!term || term.length > 140 || seen.has(key)) continue;
    seen.add(key); ledger.push(term); if (ledger.length >= 120) break;
  }
  const model = safeString(body.reviewModel || body.subtitleReviewModel || DEFAULT_SUBTITLE_TRANSLATE_MODEL).trim() || DEFAULT_SUBTITLE_TRANSLATE_MODEL;
  const result = await requestTranslationJson({ model, temperature: 0, max_tokens: 8192, messages: [
    { role: 'system', content: MARU_FINAL_SUBTITLE_REVIEW_SYSTEM },
    { role: 'user', content: JSON.stringify({ targetLanguage: TRANSLATION_LANGUAGE_NAMES[target], targetLanguageCode: target, mode: 'conservative-final-consistency-review-no-retranslation', terminologyLedger: ledger, cues: source.map((cue, index) => ({ id: Number.isInteger(Number(cue.id)) ? Number(cue.id) : index, text: safeString(cue.text || '') })) }) }
  ] });
  let parsed;
  try { parsed = parseFinalReviewPayload(safeString(result?.choices?.[0]?.message?.content || '')); }
  catch { const err = new Error('Final subtitle review returned invalid structured output.'); err.statusCode = 502; throw err; }
  const reviewed = source.map((cue, index) => {
    const id = Number.isInteger(Number(cue.id)) ? Number(cue.id) : index, text = safeString(parsed.byId.get(id) || '').replace(/\r/g, '').trim();
    if (!text) { const err = new Error('Final subtitle review did not return every cue.'); err.statusCode = 502; throw err; }
    if (isMaruInstructionLeak(text)) { const err = new Error('Final subtitle review contained internal instruction text and was rejected.'); err.statusCode = 502; throw err; }
    return { ...cue, text };
  });
  return { cues: reviewed, terminologyLedger: parsed.terminologyLedger };
}
async function handleReviewSubtitle(id, body) {
  const subtitle = safeString(body.subtitle || body.subtitleText || body.content || ''), targetLang = normalizeTranslationLanguage(body.targetLang || body.targetLanguage || body.language || '');
  if (!subtitle.trim()) return json(400, { ok: false, action: 'review-subtitle', code: 'empty_subtitle', error: 'No timed target-language subtitle text was supplied.', requestId: id });
  if (!targetLang) return json(400, { ok: false, action: 'review-subtitle', code: 'unsupported_target_language', error: 'Unsupported target language.', requestId: id });
  const cues = parseTimedSrtCues(subtitle);
  if (!cues.length) return json(422, { ok: false, action: 'review-subtitle', code: 'timed_subtitle_required', error: 'Timed SRT subtitle cues are required.', requestId: id });
  log(id, 'review-subtitle', 'cues=', cues.length, 'target=', targetLang);
  const reviewed = await reviewCueTextsForConsistency(cues, targetLang, body);
  return json(200, { ok: true, action: 'review-subtitle', targetLang, targetLanguage: targetLang, targetLanguageVerified: targetLang, targetName: TRANSLATION_LANGUAGE_NAMES[targetLang], reviewedSubtitle: reviewed.cues.map((cue) => `${cue.number}\n${cue.timing}\n${cue.text}\n`).join('\n'), cueTotal: reviewed.cues.length, terminologyLedger: reviewed.terminologyLedger, outputPolicy: 'target-language-cues-only-no-retranslation', requestId: id });
}

function isSameLanguage(sourceLanguage, targetLanguage) {
  const source = normalizeTranslationLanguage(sourceLanguage || '');
  const target = normalizeTranslationLanguage(targetLanguage || '');
  return !!source && !!target && source === target;
}

async function handleTranslateSubtitle(id, body) {
  const subtitle = safeString(body.subtitle || body.subtitleText || body.content || '');
  const targetLang = normalizeTranslationLanguage(body.targetLang || body.targetLanguage || body.language || '');
  if (!subtitle.trim()) return json(400, { ok: false, action: 'translate-subtitle', code: 'empty_subtitle', error: 'No timed subtitle text was supplied.', requestId: id });
  if (!targetLang) return json(400, { ok: false, action: 'translate-subtitle', code: 'unsupported_target_language', error: 'Unsupported target language.', requestId: id });
  const cues = parseTimedSrtCues(subtitle);
  if (!cues.length) return json(422, { ok: false, action: 'translate-subtitle', code: 'timed_subtitle_required', error: 'Timed SRT subtitle cues are required.', requestId: id });
  log(id, 'translate-subtitle', 'cues=', cues.length, 'chars=', subtitle.length, 'target=', targetLang);
  const translated = await translateCueTextsToTarget(cues, targetLang, body);
  const translatedSubtitle = translated.map((cue) => `${cue.number}\n${cue.timing}\n${cue.text}\n`).join('\n');
  return json(200, {
    ok: true,
    action: 'translate-subtitle',
    targetLang,
    targetLanguage: targetLang,
    targetLanguageVerified: targetLang,
    targetName: TRANSLATION_LANGUAGE_NAMES[targetLang],
    translatedSubtitle,
    cueTotal: translated.length,
    outputPolicy: 'target-language-subtitle-cues-only',
    requestId: id
  });
}

async function handleStatus(id) {
  return json(200, {
    ok: true,
    status: 'MARU AI media server ready',
    service: 'maru-ai-media',
    openAiReady: Boolean(OPENAI_API_KEY),
    subtitleActions: ['generate-subtitle', 'translate-subtitle', 'review-subtitle'],
    subtitleGenerationMode: 'direct-selected-target-language',
    translationActions: ['translate-subtitle'],
    reviewActions: ['review-subtitle'],
    dubbingActions: ['generate-dubbing', 'generate-speech', 'text-to-speech', 'tts', 'dubbing', 'ai-dubbing'],
    requestId: id
  });
}

function buildTranscriptionFields(body, options = {}) {
  const fields = {
    model: DEFAULT_TRANSCRIBE_MODEL,
    response_format: 'verbose_json',
    temperature: '0'
  };
  // Word timestamps are used only to trim a cue to the first and last actual
  // spoken/sung word. They do not change the selected-language translation
  // contract or introduce a second subtitle pass. Older endpoint variants are
  // retried below without this optional field.
  if (options.wordTiming !== false) fields['timestamp_granularities[]'] = 'word';
  const sourceLanguage = normalizeLanguage(body.sourceLanguage || '');
  if (sourceLanguage) fields.language = sourceLanguage.split('-')[0];
  // Do not send policy prose through Whisper's prompt field. Prompt text can
  // be mistaken for speech by a transcription model and must never enter a caption.
  return fields;
}

function isWordTimingCompatibilityError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const status = Number(error?.statusCode || error?.openAiStatus || 0);
  return status === 400 && /timestamp[_ -]?granularit|word[_ -]?timestamp|unknown parameter|unsupported parameter|invalid parameter/.test(message);
}

async function transcribeWithAudibleWordTiming(body, audioBuffer, fileName, contentType) {
  try {
    return await openAiMultipart('/audio/transcriptions', buildTranscriptionFields(body, { wordTiming: true }), { buffer: audioBuffer, fileName, contentType });
  } catch (error) {
    // Compatibility fallback: subtitle generation must remain available even
    // when an operator configures an older compatible transcription endpoint.
    if (!isWordTimingCompatibilityError(error)) throw error;
    return openAiMultipart('/audio/transcriptions', buildTranscriptionFields(body, { wordTiming: false }), { buffer: audioBuffer, fileName, contentType });
  }
}

function normalizeAudibleWordTimings(items, offsetSeconds = 0) {
  const offset = numberOr(offsetSeconds, 0);
  const rows = [];
  for (const item of Array.isArray(items) ? items : []) {
    const rawStart = numberOr(item?.start ?? item?.startSeconds ?? item?.from, NaN);
    const rawEnd = numberOr(item?.end ?? item?.endSeconds ?? item?.to, NaN);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    // OpenAI transcription word times are local to the uploaded source chunk.
    const start = Math.max(0, rawStart + (offset && rawStart < 5 * 60 ? offset : 0));
    const end = Math.max(start, rawEnd + (offset && rawStart < 5 * 60 ? offset : 0));
    rows.push({ start, end, text: safeString(item?.word ?? item?.text ?? '').trim() });
  }
  return rows.sort((a, b) => a.start - b.start || a.end - b.end);
}

function alignSegmentsToAudibleWordBoundaries(segments, words) {
  const wordRows = Array.isArray(words) ? words : [];
  if (!wordRows.length) return Array.isArray(segments) ? segments : [];
  return (Array.isArray(segments) ? segments : []).map((segment) => {
    const start = Number(segment?.start || 0), end = Number(segment?.end || 0);
    if (!(end > start)) return segment;
    const hits = wordRows.filter((word) => word.end >= start - 0.18 && word.start <= end + 0.18);
    if (!hits.length) return segment;
    const first = hits[0], last = hits[hits.length - 1];
    // Do not expose text during an instrumental lead-in. The visual cue begins
    // at the first detected vocal/lyric word, never before it; a short tail keeps
    // the final syllable readable without moving the cue into the next phrase.
    const nextStart = Math.max(start, Number(first.start || start));
    const nextEnd = Math.min(end, Number(last.end || end) + 0.10);
    if (!(nextEnd - nextStart >= 0.18)) return segment;
    return { ...segment, start: nextStart, end: nextEnd };
  });
}

function constrainSegmentsToSourceWindow(segments, body) {
  const start = numberOr(body.chunkStartSeconds ?? body.chunkOffset, 0), duration = numberOr(body.chunkDurationSeconds, 0);
  if (!(duration > 0.05)) return normalizeSegments(segments, 0);
  const end = start + duration;
  return normalizeSegments(segments, 0).map((segment) => ({ ...segment, start: Math.max(start, Number(segment.start || 0)), end: Math.min(end, Number(segment.end || 0)) })).filter((segment) => segment.end - segment.start >= 0.18);
}


/*
 * Subtitle cue shaping
 * --------------------
 * A transcription segment is not always a subtitle cue.  Some models group
 * consecutive speakers or several sentences into one segment.  We keep the
 * source timeline intact but split only inside an existing segment, using
 * word timing, audible pauses, sentence endings and a conservative duration
 * ceiling.  This never merges adjacent speakers and never changes the
 * selected-language / final-review request contracts.
 */
const MARU_SUBTITLE_CUE_RULES = Object.freeze({
  naturalPauseSeconds: 0.42,
  speakerTurnPauseSeconds: 0.68,
  preferredMaxSeconds: 4.8,
  hardMaxSeconds: 6.2,
  preferredMaxUnits: 52,
  hardMaxUnits: 72,
  preferredMaxWords: 12,
  minimumCueSeconds: 0.36,
  tailSeconds: 0.08
});

function subtitleTextUnits(value) {
  return Array.from(safeString(value || '').replace(/\s+/g, '')).length;
}

function isSubtitleTerminal(value) {
  return /[.!?…。！？]+["'”’）\]\}]*$/u.test(safeString(value || '').trim());
}

function isSubtitleSoftBoundary(value) {
  return /[,;:，、；：]+["'”’）\]\}]*$/u.test(safeString(value || '').trim());
}

function hasJoinlessScript(value) {
  // CJK Han / Japanese usually do not need injected spaces.  Hangul is not
  // included here because Korean word timestamps need ordinary spaces.
  return /[\u3400-\u9fff\u3040-\u30ff]/u.test(safeString(value || ''));
}

function joinSubtitleTimedWords(words) {
  let text = '';
  for (const item of Array.isArray(words) ? words : []) {
    const word = safeString(item?.text || '').trim();
    if (!word) continue;
    if (!text) {
      text = word;
      continue;
    }
    const previous = text.slice(-1);
    const joinWithoutSpace = /^[,.;:!?…，。！？、；：\]\)\}”’]/u.test(word)
      || /[\[\(\{“‘]$/u.test(previous)
      || (hasJoinlessScript(previous) && hasJoinlessScript(word));
    text += joinWithoutSpace ? word : ` ${word}`;
  }
  return text.replace(/\s+([,.;:!?…，。！？、；：])/gu, '$1').replace(/\s+/g, ' ').trim();
}

function wordRowsForSegment(segment, wordRows) {
  const start = Number(segment?.start || 0), end = Number(segment?.end || 0);
  return (Array.isArray(wordRows) ? wordRows : []).filter((word) => {
    const wordStart = Number(word?.start), wordEnd = Number(word?.end);
    return Number.isFinite(wordStart) && Number.isFinite(wordEnd)
      && wordEnd >= start - 0.12 && wordStart <= end + 0.12 && safeString(word?.text || '').trim();
  });
}

function cueFromTimedWordRange(segment, words, fromIndex, toIndex) {
  const first = words[fromIndex], last = words[toIndex];
  if (!first || !last) return null;
  const next = words[toIndex + 1];
  const start = Math.max(Number(segment.start || 0), Number(first.start || segment.start || 0));
  let end = Math.min(Number(segment.end || 0), Number(last.end || segment.end || 0) + MARU_SUBTITLE_CUE_RULES.tailSeconds);
  if (next && Number(next.start) > start + 0.18) end = Math.min(end, Number(next.start) - 0.025);
  if (!(end - start >= 0.18)) end = Math.min(Number(segment.end || 0), start + Math.max(0.18, Number(last.end || start) - start));
  const text = joinSubtitleTimedWords(words.slice(fromIndex, toIndex + 1));
  return text && end > start ? { start, end, text } : null;
}

function splitTimedSegmentIntoSubtitleCues(segment, wordRows) {
  const words = wordRowsForSegment(segment, wordRows);
  if (words.length < 2) return [];

  const originalUnits = subtitleTextUnits(segment?.text);
  const timedText = joinSubtitleTimedWords(words);
  // Do not replace a reliable transcription segment with a very incomplete
  // word-timestamp reconstruction.  The untimed splitter below will still
  // keep it readable when timing data is insufficient.
  if (!timedText || (originalUnits > 12 && subtitleTextUnits(timedText) < originalUnits * 0.52)) return [];

  const cues = [];
  let from = 0;
  for (let index = 0; index < words.length; index += 1) {
    const first = words[from], current = words[index], next = words[index + 1];
    const duration = Math.max(0, Number(current.end || 0) - Number(first.start || 0));
    const text = joinSubtitleTimedWords(words.slice(from, index + 1));
    const units = subtitleTextUnits(text);
    const wordCount = index - from + 1;
    const gap = next ? Math.max(0, Number(next.start || 0) - Number(current.end || 0)) : 0;
    const enoughForNaturalBreak = duration >= 0.70 || units >= 16 || wordCount >= 4;
    const clearSpeakerTurn = gap >= MARU_SUBTITLE_CUE_RULES.speakerTurnPauseSeconds
      && duration >= MARU_SUBTITLE_CUE_RULES.minimumCueSeconds;
    const naturalBoundary = gap >= MARU_SUBTITLE_CUE_RULES.naturalPauseSeconds || isSubtitleTerminal(current.text) || isSubtitleSoftBoundary(current.text);
    const preferredLimit = duration >= MARU_SUBTITLE_CUE_RULES.preferredMaxSeconds
      || units >= MARU_SUBTITLE_CUE_RULES.preferredMaxUnits
      || wordCount >= MARU_SUBTITLE_CUE_RULES.preferredMaxWords;
    const hardLimit = duration >= MARU_SUBTITLE_CUE_RULES.hardMaxSeconds
      || units >= MARU_SUBTITLE_CUE_RULES.hardMaxUnits;

    const shouldBreak = Boolean(next) && (clearSpeakerTurn || (enoughForNaturalBreak && naturalBoundary) || preferredLimit || hardLimit);
    if (shouldBreak) {
      const cue = cueFromTimedWordRange(segment, words, from, index);
      if (cue) cues.push(cue);
      from = index + 1;
    }
  }
  const tail = cueFromTimedWordRange(segment, words, from, words.length - 1);
  if (tail) cues.push(tail);
  return cues.length > 1 ? cues : [];
}

function splitTextAtSafeSubtitleBoundaries(text, maxUnits) {
  const source = safeString(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];
  const pieces = [];
  let remaining = source;
  const cap = Math.max(18, Number(maxUnits || MARU_SUBTITLE_CUE_RULES.preferredMaxUnits));
  while (subtitleTextUnits(remaining) > cap) {
    let cutAt = -1, unitCount = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const char = remaining[index];
      if (!/\s/u.test(char)) unitCount += 1;
      if (unitCount > cap) break;
      if (/[.!?…。！？,;:，、；：\s]/u.test(char)) cutAt = index + 1;
    }
    if (cutAt < 1) {
      // No word break is available (for example an unspaced transcript). Use
      // a character boundary rather than leaving an unreadable mega-caption.
      let seen = 0;
      cutAt = remaining.length;
      for (let index = 0; index < remaining.length; index += 1) {
        if (!/\s/u.test(remaining[index])) seen += 1;
        if (seen >= cap) { cutAt = index + 1; break; }
      }
    }
    const part = remaining.slice(0, cutAt).trim();
    if (!part) break;
    pieces.push(part);
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

function splitUntimedSegmentIntoSubtitleCues(segment) {
  const duration = Math.max(0, Number(segment?.end || 0) - Number(segment?.start || 0));
  const text = safeString(segment?.text || '').replace(/\s+/g, ' ').trim();
  if (!text || duration <= 0.18) return [];
  const byDuration = Math.max(1, Math.ceil(duration / MARU_SUBTITLE_CUE_RULES.preferredMaxSeconds));
  const desiredMaxUnits = Math.max(24, Math.min(MARU_SUBTITLE_CUE_RULES.hardMaxUnits, Math.ceil(subtitleTextUnits(text) / byDuration)));
  const parts = splitTextAtSafeSubtitleBoundaries(text, desiredMaxUnits);
  if (parts.length <= 1) return [];
  const totalUnits = Math.max(1, parts.reduce((sum, part) => sum + subtitleTextUnits(part), 0));
  let cursor = Number(segment.start || 0);
  return parts.map((part, index) => {
    const remainingDuration = Math.max(0.18, Number(segment.end || 0) - cursor);
    const remainingUnits = Math.max(1, totalUnits - parts.slice(0, index).reduce((sum, prior) => sum + subtitleTextUnits(prior), 0));
    const isLast = index === parts.length - 1;
    const span = isLast ? remainingDuration : Math.max(0.18, Math.min(remainingDuration - 0.18 * (parts.length - index - 1), duration * (subtitleTextUnits(part) / totalUnits)));
    const cue = { start: cursor, end: Math.min(Number(segment.end || 0), cursor + span), text: part };
    cursor = cue.end;
    return cue;
  }).filter((cue) => cue.end - cue.start >= 0.18);
}

function splitSegmentsIntoSubtitleCues(segments, wordRows) {
  const shaped = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const timed = splitTimedSegmentIntoSubtitleCues(segment, wordRows);
    if (timed.length) {
      shaped.push(...timed);
      continue;
    }
    const fallback = splitUntimedSegmentIntoSubtitleCues(segment);
    if (fallback.length) shaped.push(...fallback);
    else shaped.push(segment);
  }
  return normalizeSegments(shaped, 0);
}

function splitOverlongRenderedSubtitleCues(segments) {
  const shaped = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const text = safeString(segment?.text || '').replace(/\s+/g, ' ').trim();
    if (!text || subtitleTextUnits(text) <= MARU_SUBTITLE_CUE_RULES.hardMaxUnits) {
      shaped.push(segment);
      continue;
    }
    const parts = splitTextAtSafeSubtitleBoundaries(text, MARU_SUBTITLE_CUE_RULES.preferredMaxUnits);
    if (parts.length <= 1) {
      shaped.push(segment);
      continue;
    }
    const start = Number(segment.start || 0), end = Number(segment.end || 0), duration = Math.max(0.18, end - start);
    const totalUnits = Math.max(1, parts.reduce((sum, part) => sum + subtitleTextUnits(part), 0));
    let cursor = start;
    for (let index = 0; index < parts.length; index += 1) {
      const isLast = index === parts.length - 1;
      const span = isLast ? Math.max(0.18, end - cursor) : Math.max(0.18, duration * (subtitleTextUnits(parts[index]) / totalUnits));
      const nextEnd = isLast ? end : Math.min(end - 0.18 * (parts.length - index - 1), cursor + span);
      shaped.push({ ...segment, start: cursor, end: Math.max(cursor + 0.18, nextEnd), text: parts[index] });
      cursor = Math.max(cursor + 0.18, nextEnd);
    }
  }
  return normalizeSegments(shaped, 0);
}

async function handleGenerateSubtitle(id, body) {
  const audioBuffer = audioBufferFromPayload(body);
  if (!audioBuffer) return json(400, { ok: false, error: 'No audioBase64/fileBase64 was supplied for subtitle generation.', action: 'generate-subtitle', requestId: id });

  const offset = numberOr(body.chunkOffset ?? body.chunkStartSeconds, 0);
  const fileName = sanitizeFileName(body.audioFileName || body.fileName || 'audio.m4a', 'audio.m4a');
  const contentType = safeString(body.mimeType || body.contentType || 'audio/mp4');
  const result = await transcribeWithAudibleWordTiming(body, audioBuffer, fileName, contentType);
  const rawSegments = result.segments || result.items || [];
  const audibleWords = normalizeAudibleWordTimings(result.words || result.word_timestamps || [], offset);
  let segments = normalizeSegments(rawSegments, offset);
  if (!segments.length && result.text) {
    segments = normalizeSegments([{ start: offset, end: offset + Math.max(2, Math.min(8, safeString(result.text).length / 8)), text: result.text }], 0);
  }
  // Word timing only narrows visual cue bounds to audible speech/lyrics; it
  // never fabricates text, shifts a completed cue forward, or changes order.
  segments = alignSegmentsToAudibleWordBoundaries(segments, audibleWords);
  // A defensive guard for pre-existing bad relay behavior: internal prompt text
  // is never allowed to become dialogue in a saved subtitle.
  segments = constrainSegmentsToSourceWindow(dropMaruInstructionLeakSegments(segments), body);
  // Whisper-style segments can contain several sentences or consecutive
  // speakers. Turn them into short, independently timed subtitle cues before
  // target-language translation so no dialogue is displayed as one paragraph.
  segments = splitSegmentsIntoSubtitleCues(segments, audibleWords);

  const targetLang = normalizeTranslationLanguage(body.requestedTargetLanguage || body.targetLanguage || body.targetLang || body.language || '');
  const directTarget = body.directTargetLanguage === true || safeString(body.generationMode || '').toLowerCase() === 'selected-target-language-subtitle';
  let targetSegments = segments;
  let sourceLanguageDetected = normalizeTranslationLanguage(result.language || body.sourceLanguage || '');
  if (directTarget) {
    if (!targetLang) return json(400, { ok: false, action: 'generate-subtitle', code: 'unsupported_target_language', error: 'A supported selected subtitle language is required.', requestId: id });
    // When the spoken language already equals the selected language, Whisper's
    // timed text is already the requested output.  Otherwise translate inside
    // this same server request so the desktop receives only final target text.
    if (!isSameLanguage(sourceLanguageDetected, targetLang) && targetSegments.length) {
      const cues = targetSegments.map((segment, index) => ({ id: index, ...segment }));
      targetSegments = await translateCueTextsToTarget(cues, targetLang, body);
    }
    targetSegments = targetSegments.map(({ id, ...segment }) => segment);
  }
  // The translation model must keep cue ids separate. This last display-only
  // guard still prevents an unusually long target-language line from becoming
  // a single paragraph in the player without changing its timeline order.
  targetSegments = splitOverlongRenderedSubtitleCues(targetSegments);

  return json(200, {
    ok: true,
    action: 'generate-subtitle',
    fileName,
    model: DEFAULT_TRANSCRIBE_MODEL,
    segments: targetSegments,
    subtitleText: segmentsToSrt(targetSegments),
    text: targetSegments.map((s) => s.text).join('\n'),
    timeline: 'absolute',
    timestampBasis: 'media',
    chunkStartSeconds: numberOr(body.chunkStartSeconds ?? body.chunkOffset, 0),
    chunkDurationSeconds: numberOr(body.chunkDurationSeconds, 0),
    targetLang: directTarget ? targetLang : '',
    targetLanguage: directTarget ? targetLang : '',
    targetLanguageVerified: directTarget ? targetLang : '',
    targetName: directTarget ? TRANSLATION_LANGUAGE_NAMES[targetLang] : '',
    sourceLanguageDetected,
    directTargetLanguage: !!directTarget,
    generationMode: directTarget ? 'selected-target-language-subtitle' : 'source-language-transcript',
    outputPolicy: directTarget ? 'target-language-subtitle-cues-only' : 'source-language-transcript',
    requestId: id
  });
}

function isDubbingAction(action) {
  return ['generate-dubbing', 'dubbing', 'ai-dubbing', 'generate-speech', 'text-to-speech', 'tts'].includes(action);
}

function buildDubbingInstructions(body) {
  const targetLanguage = normalizeLanguage(body.targetLanguage || body.language || '');
  const style = safeString(body.voiceStyle || body.style || '').trim();
  const parts = [
    'Speak naturally and clearly for video dubbing.',
    'Keep narration stable and documentary/lecture-like when the script is expository.',
    'Do not add explanations, timestamps, speaker labels, or extra words.',
    'Respect punctuation and paragraph breaks for natural pacing.'
  ];
  if (targetLanguage) parts.push(`Target spoken language: ${targetLanguage}.`);
  if (style) parts.push(`Style: ${style}.`);
  return parts.join(' ');
}

async function ttsOnce(text, body, model) {
  const format = normalizeAudioFormat(body.responseFormat || body.outputFormat || body.format || DEFAULT_TTS_FORMAT);
  const payload = {
    model,
    voice: normalizeVoice(body.voice),
    input: text,
    response_format: format
  };
  const instructions = buildDubbingInstructions(body);
  // Newer OpenAI TTS models accept instructions. Older tts-1 may ignore/reject it, so only add for newer model names.
  if (!/^tts-1/i.test(model) && instructions) payload.instructions = instructions;
  return openAiBinary('/audio/speech', payload);
}

async function ttsWithFallback(text, body) {
  const requested = safeString(body.model || body.ttsModel || DEFAULT_TTS_MODEL).trim() || DEFAULT_TTS_MODEL;
  const models = Array.from(new Set([requested, DEFAULT_TTS_MODEL, 'tts-1'])).filter(Boolean);
  let lastError = null;
  for (const model of models) {
    try {
      return { buffer: await ttsOnce(text, body, model), model };
    } catch (error) {
      lastError = error;
      // Try another model only for model/parameter compatibility errors.
      const msg = String(error.message || '');
      if (!/model|unsupported|unknown|invalid|instructions|parameter|response_format/i.test(msg)) break;
    }
  }
  throw lastError || new Error('OpenAI TTS failed.');
}

async function handleGenerateDubbing(id, action, body) {
  const scriptText = cleanTextForSpeech(body.scriptText || body.subtitleText || body.text || body.input || body.prompt || '');
  if (!scriptText) {
    return json(400, { ok: false, action, error: 'No scriptText/subtitleText/text was supplied for dubbing.', requestId: id });
  }

  const parts = splitTextForTts(scriptText, TTS_CHUNK_CHARS);
  if (!parts.length) return json(400, { ok: false, action, error: 'No readable text remained after cleaning subtitle text.', requestId: id });

  const buffers = [];
  let modelUsed = '';
  for (let i = 0; i < parts.length; i += 1) {
    log(id, `dubbing part ${i + 1}/${parts.length} chars=${parts[i].length}`);
    const result = await ttsWithFallback(parts[i], body);
    buffers.push(result.buffer);
    modelUsed = result.model;
  }

  const format = normalizeAudioFormat(body.responseFormat || body.outputFormat || body.format || DEFAULT_TTS_FORMAT);
  const mimeType = mimeForAudioFormat(format);
  const audio = Buffer.concat(buffers);
  const stem = fileStem(body.fileName || body.originalFileName || body.mediaFileName || 'maru-ai-dubbing');
  const lang = normalizeLanguage(body.targetLanguage || body.language || 'auto') || 'auto';
  const audioFileName = sanitizeFileName(body.audioFileName || `${stem}.ai-dub-${lang}.${format}`);

  return json(200, {
    ok: true,
    action: 'generate-dubbing',
    sourceAction: action,
    model: modelUsed,
    voice: normalizeVoice(body.voice),
    format,
    mimeType,
    audioFileName,
    audioBase64: audio.toString('base64'),
    size: audio.length,
    partTotal: parts.length,
    requestId: id
  });
}

function classifyOpenAiError(error) {
  const status = Number(error?.statusCode || error?.openAiStatus || 500);
  const msg = String(error?.message || error || 'Unknown server error');
  if (/insufficient_quota|quota|billing|payment/i.test(msg)) return { statusCode: status || 402, code: 'openai_billing_or_quota', message: 'OpenAI API quota/billing limit reached. Check OpenAI Platform billing and project limits.' };
  if (/api key|invalid_api_key|incorrect api key|unauthorized/i.test(msg)) return { statusCode: status || 401, code: 'openai_api_key', message: 'OpenAI API key is invalid or missing in Netlify environment variable OPENAI_API_KEY.' };
  if (/timeout|timed out/i.test(msg)) return { statusCode: 504, code: 'server_timeout', message: 'OpenAI/Netlify request timed out. Split the media/text into smaller chunks and retry.' };
  return { statusCode: status || 500, code: 'server_error', message: msg.slice(0, 1000) };
}

exports.handler = async (event) => {
  const id = requestId(event);
  const started = Date.now();
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    if (event.httpMethod === 'GET') return handleStatus(id);
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed', requestId: id });

    const contentType = safeString(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '');
    if (!/application\/json/i.test(contentType)) {
      return json(415, { ok: false, error: 'MARU AI media server expects application/json. The current Windows build sends JSON payloads.', requestId: id });
    }

    const body = parseJsonBody(event);
    const action = normalizeAction(body.action);
    const bytes = Buffer.byteLength(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
    log(id, 'POST', contentType || 'application/json', 'bodyBytes=', bytes, 'base64=', Boolean(event.isBase64Encoded));
    log(id, 'action=', action, 'file=', body.fileName || body.audioFileName || body.originalFileName || body.mediaFileName || 'none');

    if (['status', 'health', 'ping', 'connect', 'test', 'connection-test'].includes(action)) return handleStatus(id);
    if (action === 'generate-subtitle' || action === 'subtitle' || action === 'transcribe') return await handleGenerateSubtitle(id, body);
    if (action === 'review-subtitle' || action === 'subtitle-review' || action === 'final-review') return await handleReviewSubtitle(id, body);
    if (['translate-subtitle', 'subtitle-translate', 'translate'].includes(action)) return await handleTranslateSubtitle(id, body);
    if (isDubbingAction(action)) return await handleGenerateDubbing(id, action, body);

    return json(400, {
      ok: false,
      error: `Unsupported action: ${action}`,
      supportedActions: ['status', 'generate-subtitle', 'translate-subtitle', 'generate-dubbing', 'generate-speech', 'text-to-speech', 'tts'],
      requestId: id
    });
  } catch (error) {
    const classified = classifyOpenAiError(error);
    log(id, 'ERROR', classified.code, classified.message, 'elapsedMs=', Date.now() - started);
    return json(classified.statusCode, {
      ok: false,
      error: classified.message,
      code: classified.code,
      requestId: id
    });
  } finally {
    log(id, 'elapsedMs=', Date.now() - started);
  }
};
