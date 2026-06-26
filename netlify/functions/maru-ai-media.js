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
function compactNonDialogueToken(value) {
  return safeString(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '');
}

/*
 * A dense run such as "하하하하하…" or "ㅋㅋㅋㅋ…" is usually a
 * transcription expansion of one human sound, not dialogue.  It must not be
 * shown as dozens of characters or removed entirely.  We keep its timing and
 * classify it so that the final subtitle can use a short target-language
 * caption such as [웃음], [울음], or [applause].
 */
function repeatedUnit(value, candidates, minRepeats = 3) {
  const compact = compactNonDialogueToken(value);
  if (!compact) return false;
  return candidates.some((unit) => {
    const normalized = compactNonDialogueToken(unit);
    return normalized && compact.length >= normalized.length * minRepeats && compact.length % normalized.length === 0 && compact === normalized.repeat(compact.length / normalized.length);
  });
}

function classifyNonVerbalVocalization(value) {
  const raw = safeString(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const compact = compactNonDialogueToken(raw);
  if (!compact) return '';
  const label = raw.replace(/^\s*[\[\]{}()（）【】<>]+\s*/u, '').replace(/\s*[\[\]{}()（）【】<>]+\s*$/u, '').trim();

  // Explicit standalone labels produced by recognizers or carried through an
  // SRT.  These are anchored intentionally: a spoken line such as "don't
  // laugh" must remain dialogue, not be converted into a sound label.
  if (/^(?:laughter|laughing|laughs|giggles?|chuckles?|웃음(?:소리)?|웃는다|폭소|笑声|笑聲|笑い|смех|risa(?:s)?|rires|risate|lachen|gelach|skratt|śmiech|nevetés|خنده|ہنسی|হাসি|சிரிப்பு|tawa|ketawa|kulgi)$/iu.test(label)) return 'laughter';
  if (/^(?:crying|cries|sob(?:bing)?|weeping|wail(?:ing)?|울음(?:소리)?|운다|흐느낌|哭声|哭聲|哭泣|泣き声|плач|llanto|pleurs|pianto|weinen|gehuil|gråt|płacz|sírás|گریه|رونا|কান্না|அழுகை|tangisan|yig.?i|kilio)$/iu.test(label)) return 'crying';
  if (/^(?:cheering|cheers|crowd cheer|shouting|whoops?|환호|함성|歓声|歡呼|欢呼|ликующие возгласы|восклицания|vítores|acclamations|ovazioni|jubel|gejuich|okrzyki|ujjongás|هتاف|نعرے|উল্লাস|ஆர்வாரம்|sorak sorai|sorakan|hiyawan|vigelegele|olqishlar?)$/iu.test(label)) return 'cheering';
  if (/^(?:applause|clapping|claps|박수|拍手|掌声|掌聲|аплодисменты|applaudissements|aplausos|applausi|applaus|oklaski|applåder|taps|tepuk tangan|tepukan|तालियाँ|تالیاں|তালি|கைத்தட்டல்|makofi|qarsaklar?)$/iu.test(label)) return 'applause';
  if (/^(?:sigh(?:ing)?|한숨|ため息|叹息|嘆息|вздох|soupir|suspiro|sospiro|seufzen|zucht|westchnienie|suck|sóhaj|آه|آہ|দীর্ঘশ্বাস|பெருமூச்சு|helaan napas|helaan nafas|kuugua|buntong-hininga|xo.?rsinish)$/iu.test(label)) return 'sigh';
  if (/^(?:cough(?:ing)?|기침|せき|咳嗽|кашель|toux|tosse|husten|hoest|kaszel|hosta|köhögés|سعال|کھانسی|কাশি|இருமல்|batuk|ubo|kikohozi|yo.?tal)$/iu.test(label)) return 'cough';
  if (/^(?:gasp(?:ing)?|놀람|息をのむ|倒吸气|倒吸氣|вскрик|halètement|keuchen|hijgen|sapnięcie|flämtning|شهقة|ہانپنا|হাঁপানি|திடுக்கிடல்|tercungap(?:-cungap)?|hingal|hansirash)$/iu.test(label)) return 'gasp';

  // Repetition variants, including Korean, English, Spanish, French, and
  // common romanized laughter/crying forms.  They remain conservative so a
  // normal short word or an actual dialogue cue is not reclassified.
  if (/^[ㅋㅎᄏᄒ하헤히호]+$/u.test(compact) && compact.length >= 5) return 'laughter';
  if (/^(?:ha|he|hi|ho|ja|je|ji|jo|rs){3,}$/iu.test(compact)) return 'laughter';
  if (repeatedUnit(compact, ['ha', 'he', 'hi', 'ho', 'ja', 'heh', 'lol'], 3)) return 'laughter';
  if (/^[흑엉으앙]+$/u.test(compact) && compact.length >= 4) return 'crying';
  if (/^(?:sob|boohoo|wah){3,}$/iu.test(compact) || repeatedUnit(compact, ['sob', 'boo', 'wah'], 3)) return 'crying';
  if (/^(?:woo|whoo|yay|yeah|와){3,}$/iu.test(compact) || repeatedUnit(compact, ['woo', 'yay', 'yeah', '와'], 3)) return 'cheering';
  return '';
}

function isPathologicalRepeatedVocalization(value) {
  return Boolean(classifyNonVerbalVocalization(value));
}

// This guard applies only to the early intro window.  It rejects a low-confidence
// Whisper hallucination from music/effects before any real dialogue appears, but
// keeps a normal spoken opening whose recognition confidence is sound.
function isLikelyPreSpeechIntroArtifact(segment, request = {}) {
  const chunkStart = numberOr(request?.chunkStartSeconds ?? request?.chunkOffset, 0);
  const guardUntil = Math.max(0, Math.min(120, numberOr(request?.speechStartGuardUntilSeconds, 90) || 90));
  if (chunkStart >= guardUntil) return false;
  const noSpeech = Number(segment?.noSpeechProbability);
  const avgLogprob = Number(segment?.avgLogprob);
  const compressionRatio = Number(segment?.compressionRatio);
  if (!Number.isFinite(noSpeech) || !Number.isFinite(avgLogprob)) return false;
  if (noSpeech >= 0.58 && avgLogprob <= -0.55) return true;
  if (noSpeech >= 0.40 && avgLogprob <= -1.05 && (!Number.isFinite(compressionRatio) || compressionRatio >= 1.45)) return true;
  return false;
}

function isLikelyNonDialogueSegment(segment, request = {}) {
  const text = safeString(segment?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  // Laughter, crying, applause, and similar human sounds are retained as short
  // captions later; music, silence, and generic noise are not dialogue cues.
  if (classifyNonVerbalVocalization(text)) return false;
  if (/^(?:[♪♫♬]+|\[[^\]]*(?:music|song|instrumental|noise|silence|sound effect|음악|노래|연주|소음|무음|musique|música|мyзыка|музыка)[^\]]*\]|\([^)]*(?:music|song|instrumental|noise|silence|sound effect|음악|노래|연주|소음|무음|musique|música|мyзыка|музыка)[^)]*\))$/i.test(text)) return true;
  const noSpeech = Number(segment?.noSpeechProbability), avgLogprob = Number(segment?.avgLogprob);
  // Conservative thresholds preserve quiet spoken dialogue.
  if (Number.isFinite(noSpeech) && noSpeech >= 0.86) return true;
  if (Number.isFinite(noSpeech) && Number.isFinite(avgLogprob) && noSpeech >= 0.68 && avgLogprob <= -1.20) return true;
  if (isLikelyPreSpeechIntroArtifact(segment, request)) return true;
  return false;
}
function normalizeSegments(items, offsetSeconds = 0, request = {}) {
  const source = Array.isArray(items) ? items : [];
  const rows = source.map((item) => normalizeSegment(item, offsetSeconds)).filter((item) => item && !isLikelyNonDialogueSegment(item, request)).map((item) => ({ ...item, nonVerbalKind: classifyNonVerbalVocalization(item.text) || '' }));
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


/*
 * Stable, short captions for non-verbal human sound events.  These are not
 * dialogue and are deliberately rendered as bracket labels rather than long
 * repeated syllables.  The selected subtitle language determines the label.
 */
const MARU_NONVERBAL_CAPTIONS = Object.freeze({
  ko: { laughter: '[웃음]', crying: '[울음]', cheering: '[환호]', applause: '[박수]', sigh: '[한숨]', cough: '[기침]', gasp: '[놀람]' },
  en: { laughter: '[laughter]', crying: '[crying]', cheering: '[cheering]', applause: '[applause]', sigh: '[sigh]', cough: '[cough]', gasp: '[gasp]' },
  zh: { laughter: '[笑声]', crying: '[哭声]', cheering: '[欢呼]', applause: '[掌声]', sigh: '[叹息]', cough: '[咳嗽]', gasp: '[倒吸气]' },
  zht: { laughter: '[笑聲]', crying: '[哭聲]', cheering: '[歡呼]', applause: '[掌聲]', sigh: '[嘆息]', cough: '[咳嗽]', gasp: '[倒吸氣]' },
  ja: { laughter: '[笑い]', crying: '[泣き声]', cheering: '[歓声]', applause: '[拍手]', sigh: '[ため息]', cough: '[せき]', gasp: '[息をのむ]' },
  es: { laughter: '[risas]', crying: '[llanto]', cheering: '[vítores]', applause: '[aplausos]', sigh: '[suspiro]', cough: '[tos]', gasp: '[jadeo]' },
  fr: { laughter: '[rires]', crying: '[pleurs]', cheering: '[acclamations]', applause: '[applaudissements]', sigh: '[soupir]', cough: '[toux]', gasp: '[halètement]' },
  de: { laughter: '[Lachen]', crying: '[Weinen]', cheering: '[Jubel]', applause: '[Applaus]', sigh: '[Seufzen]', cough: '[Husten]', gasp: '[Keuchen]' },
  ru: { laughter: '[смех]', crying: '[плач]', cheering: '[ликующие возгласы]', applause: '[аплодисменты]', sigh: '[вздох]', cough: '[кашель]', gasp: '[вскрик]' },
  pt: { laughter: '[risos]', crying: '[choro]', cheering: '[ovação]', applause: '[aplausos]', sigh: '[suspiro]', cough: '[tosse]', gasp: '[suspiro de surpresa]' },
  it: { laughter: '[risate]', crying: '[pianto]', cheering: '[ovazioni]', applause: '[applausi]', sigh: '[sospiro]', cough: '[tosse]', gasp: '[sussulto]' },
  ar: { laughter: '[ضحك]', crying: '[بكاء]', cheering: '[هتاف]', applause: '[تصفيق]', sigh: '[تنهد]', cough: '[سعال]', gasp: '[شهقة]' },
  vi: { laughter: '[tiếng cười]', crying: '[tiếng khóc]', cheering: '[tiếng reo hò]', applause: '[tiếng vỗ tay]', sigh: '[tiếng thở dài]', cough: '[tiếng ho]', gasp: '[tiếng hít vào]' },
  th: { laughter: '[เสียงหัวเราะ]', crying: '[เสียงร้องไห้]', cheering: '[เสียงเชียร์]', applause: '[เสียงปรบมือ]', sigh: '[เสียงถอนหายใจ]', cough: '[เสียงไอ]', gasp: '[เสียงอุทาน]' },
  id: { laughter: '[tawa]', crying: '[tangisan]', cheering: '[sorak sorai]', applause: '[tepuk tangan]', sigh: '[helaan napas]', cough: '[batuk]', gasp: '[terkesiap]' },
  hi: { laughter: '[हँसी]', crying: '[रोना]', cheering: '[जयकार]', applause: '[तालियाँ]', sigh: '[आह]', cough: '[खाँसी]', gasp: '[हांफना]' },
  tr: { laughter: '[gülüş]', crying: '[ağlama]', cheering: '[tezahürat]', applause: '[alkış]', sigh: '[iç çekme]', cough: '[öksürük]', gasp: '[soluk kesilmesi]' },
  ta: { laughter: '[சிரிப்பு]', crying: '[அழுகை]', cheering: '[ஆர்வாரம்]', applause: '[கைத்தட்டல்]', sigh: '[பெருமூச்சு]', cough: '[இருமல்]', gasp: '[திடுக்கிடல்]' },
  sw: { laughter: '[kicheko]', crying: '[kilio]', cheering: '[vigelegele]', applause: '[makofi]', sigh: '[kuugua]', cough: '[kikohozi]', gasp: '[mshtuko]' },
  ur: { laughter: '[ہنسی]', crying: '[رونا]', cheering: '[نعرے]', applause: '[تالیاں]', sigh: '[آہ]', cough: '[کھانسی]', gasp: '[ہانپنا]' },
  bn: { laughter: '[হাসি]', crying: '[কান্না]', cheering: '[উল্লাস]', applause: '[তালি]', sigh: '[দীর্ঘশ্বাস]', cough: '[কাশি]', gasp: '[হাঁপানি]' },
  fa: { laughter: '[خنده]', crying: '[گریه]', cheering: '[تشویق]', applause: '[دست زدن]', sigh: '[آه]', cough: '[سرفه]', gasp: '[نفس‌نفس]' },
  hu: { laughter: '[nevetés]', crying: '[sírás]', cheering: '[ujjongás]', applause: '[taps]', sigh: '[sóhaj]', cough: '[köhögés]', gasp: '[lihegés]' },
  ms: { laughter: '[ketawa]', crying: '[tangisan]', cheering: '[sorakan]', applause: '[tepukan]', sigh: '[helaan nafas]', cough: '[batuk]', gasp: '[tercungap-cungap]' },
  nl: { laughter: '[gelach]', crying: '[gehuil]', cheering: '[gejuich]', applause: '[applaus]', sigh: '[zucht]', cough: '[hoest]', gasp: '[hijgen]' },
  pl: { laughter: '[śmiech]', crying: '[płacz]', cheering: '[okrzyki]', applause: '[oklaski]', sigh: '[westchnienie]', cough: '[kaszel]', gasp: '[sapnięcie]' },
  sv: { laughter: '[skratt]', crying: '[gråt]', cheering: '[jubel]', applause: '[applåder]', sigh: '[suck]', cough: '[hosta]', gasp: '[flämtning]' },
  tl: { laughter: '[tawa]', crying: '[iyak]', cheering: '[hiyawan]', applause: '[palakpakan]', sigh: '[buntong-hininga]', cough: '[ubo]', gasp: '[hingal]' },
  uk: { laughter: '[сміх]', crying: '[плач]', cheering: '[вигуки]', applause: '[оплески]', sigh: '[зітхання]', cough: '[кашель]', gasp: '[задихання]' },
  uz: { laughter: '[kulgi]', crying: '[yig‘i]', cheering: '[olqishlar]', applause: '[qarsaklar]', sigh: '[xo‘rsinish]', cough: '[yo‘tal]', gasp: '[hansirash]' }
});

function nonVerbalCaption(kind, language) {
  const lang = normalizeTranslationLanguage(language) || 'en';
  const safeKind = safeString(kind || '').trim().toLowerCase();
  return MARU_NONVERBAL_CAPTIONS[lang]?.[safeKind] || MARU_NONVERBAL_CAPTIONS.en[safeKind] || '';
}

function captionNonVerbalKind(value) {
  const compact = compactNonDialogueToken(value);
  if (!compact) return '';
  for (const labels of Object.values(MARU_NONVERBAL_CAPTIONS)) {
    for (const [kind, label] of Object.entries(labels)) {
      if (compact === compactNonDialogueToken(label)) return kind;
    }
  }
  return classifyNonVerbalVocalization(value);
}

function materializeNonVerbalCaptions(segments, language) {
  return (Array.isArray(segments) ? segments : []).map((segment) => {
    const kind = safeString(segment?.nonVerbalKind || captionNonVerbalKind(segment?.text) || '').trim().toLowerCase();
    return kind ? { ...segment, nonVerbalKind: kind, text: nonVerbalCaption(kind, language) || safeString(segment?.text || '') } : segment;
  });
}

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
  'Keep each line concise, natural, faithful, and readable at subtitle speed. Preserve the cue meaning and do not invent facts, names, relationships, or context.',
  'Keep names, titles, ranks, honorifics, technical terms, units, numbers, product names, species names, organization names, place names, building names, country names, political parties, and institutions accurate and consistent.',
  'Recognize recurring personal names, nicknames, pet names, epithets, call signs, kinship forms, titles, and shortened forms across nearby cues. Preserve the scene-appropriate form of address; never silently turn a nickname into a different person or invent a full name that the dialogue does not support.',
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

  // Sound-event cues are already complete captions.  Do not send them through
  // a dialogue translation pass; inject the selected-language short label at
  // the same timestamp instead.
  const soundKinds = new Map();
  const verbal = [];
  for (let index = 0; index < source.length; index += 1) {
    const cue = source[index];
    const id = Number.isInteger(Number(cue?.id)) ? Number(cue.id) : index;
    const kind = safeString(cue?.nonVerbalKind || captionNonVerbalKind(cue?.text) || '').trim().toLowerCase();
    if (kind && nonVerbalCaption(kind, target)) soundKinds.set(id, kind);
    else verbal.push({ cue, index, id });
  }

  const translatedById = new Map();
  if (verbal.length) {
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
          cues: verbal.map(({ cue, id }) => ({ id, text: safeString(cue.text || '') }))
        }) }
      ]
    });
    const content = safeString(result?.choices?.[0]?.message?.content || '');
    try { for (const [id, text] of parsedCueRows(content)) translatedById.set(id, text); }
    catch {
      const err = new Error('Translation service returned invalid structured subtitle output.');
      err.statusCode = 502;
      throw err;
    }
  }

  return source.map((cue, index) => {
    const id = Number.isInteger(Number(cue.id)) ? Number(cue.id) : index;
    const soundKind = soundKinds.get(id);
    if (soundKind) return { ...cue, nonVerbalKind: soundKind, text: nonVerbalCaption(soundKind, target) };
    const text = safeString(translatedById.get(id) || '').replace(/\r/g, '').trim();
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
}

const MARU_FINAL_SUBTITLE_REVIEW_SYSTEM = [
  'You perform a conservative final editorial consistency review of already translated timed subtitle cues in one target language.',
  'Return JSON only as an object with keys "cues" and "terminologyLedger". "cues" must be an array of objects exactly shaped as {"id":number,"text":string}.',
  'Return one non-empty cue text for every supplied id, in the same order. Do not output timestamps, cue numbers, source-language alternatives, commentary, notes, markdown, policies, prompts, or instructions.',
  'Do not retranslate or rewrite good subtitle lines. Change text only for a clear typo, a clear inconsistent repeated name or title, a clearly literalized proper name, a clear nonstandard specialist term, or an obvious target-language grammar error.',
  'Keep established conventional names, official organization and institution names, places, buildings, countries, parties, products, species, ranks, aliases, and recurring personal names consistent. Never translate the literal components of a proper name into a newly invented descriptive name.',
  'Review recurring nicknames, pet names, epithets, call signs, kinship forms, honorifics, and shortened personal names against nearby context. Keep the intended person and the appropriate form of address consistent, but do not expand or replace a nickname when the context does not clearly establish that identity.',
  'For medical, scientific, academic, legal, engineering, computing, military, economic, and technical content, use the established professional term in the requested target language as found in reputable reference works, textbooks, standards, and institutional usage. Do not replace precise terminology with informal paraphrase.',
  'Use the supplied terminology ledger only when it clearly matches the same entity or term. If uncertain, preserve the existing established target-language form rather than guessing.',
  'Short bracketed non-dialogue sound labels are handled outside this review and must remain short labels at their original timestamps.',
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

  // Completed sound labels are immutable.  The final editorial review should
  // inspect dialogue terminology and names only, not turn [웃음] into a prose
  // sentence or delete a retained human sound event.
  const soundKinds = new Map();
  const verbal = [];
  for (let index = 0; index < source.length; index += 1) {
    const cue = source[index];
    const id = Number.isInteger(Number(cue?.id)) ? Number(cue.id) : index;
    const kind = captionNonVerbalKind(cue?.text);
    if (kind && nonVerbalCaption(kind, target)) soundKinds.set(id, kind);
    else verbal.push({ cue, index, id });
  }
  const ledger = [], seen = new Set();
  for (const item of Array.isArray(body.terminologyLedger) ? body.terminologyLedger : []) {
    const term = safeString(typeof item === 'string' ? item : (item?.canonical || item?.term || item?.text || '')).replace(/\s+/g, ' ').trim(), key = term.toLowerCase();
    if (!term || term.length > 140 || seen.has(key)) continue;
    seen.add(key); ledger.push(term); if (ledger.length >= 120) break;
  }
  let parsed = { byId: new Map(), terminologyLedger: [] };
  if (verbal.length) {
    const model = safeString(body.reviewModel || body.subtitleReviewModel || DEFAULT_SUBTITLE_TRANSLATE_MODEL).trim() || DEFAULT_SUBTITLE_TRANSLATE_MODEL;
    const result = await requestTranslationJson({ model, temperature: 0, max_tokens: 8192, messages: [
      { role: 'system', content: MARU_FINAL_SUBTITLE_REVIEW_SYSTEM },
      { role: 'user', content: JSON.stringify({ targetLanguage: TRANSLATION_LANGUAGE_NAMES[target], targetLanguageCode: target, mode: 'conservative-final-consistency-review-no-retranslation', terminologyLedger: ledger, cues: verbal.map(({ cue, id }) => ({ id, text: safeString(cue.text || '') })) }) }
    ] });
    try { parsed = parseFinalReviewPayload(safeString(result?.choices?.[0]?.message?.content || '')); }
    catch { const err = new Error('Final subtitle review returned invalid structured output.'); err.statusCode = 502; throw err; }
  }
  const reviewed = source.map((cue, index) => {
    const id = Number.isInteger(Number(cue.id)) ? Number(cue.id) : index;
    const soundKind = soundKinds.get(id);
    if (soundKind) return { ...cue, nonVerbalKind: soundKind, text: nonVerbalCaption(soundKind, target) };
    const text = safeString(parsed.byId.get(id) || '').replace(/\r/g, '').trim();
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

function buildTranscriptionFields(body) {
  const fields = {
    model: DEFAULT_TRANSCRIBE_MODEL,
    response_format: 'verbose_json',
    temperature: '0'
  };
  const sourceLanguage = normalizeLanguage(body.sourceLanguage || '');
  if (sourceLanguage) fields.language = sourceLanguage.split('-')[0];
  // Do not send policy prose through Whisper's prompt field.  Prompt text can
  // be mistaken for speech by a transcription model and must never enter a caption.
  return fields;
}

function constrainSegmentsToSourceWindow(segments, body) {
  const start = numberOr(body.chunkStartSeconds ?? body.chunkOffset, 0), duration = numberOr(body.chunkDurationSeconds, 0);
  if (!(duration > 0.05)) return normalizeSegments(segments, 0);
  const end = start + duration;
  return normalizeSegments(segments, 0).map((segment) => ({ ...segment, start: Math.max(start, Number(segment.start || 0)), end: Math.min(end, Number(segment.end || 0)) })).filter((segment) => segment.end - segment.start >= 0.18);
}

async function handleGenerateSubtitle(id, body) {
  const audioBuffer = audioBufferFromPayload(body);
  if (!audioBuffer) return json(400, { ok: false, error: 'No audioBase64/fileBase64 was supplied for subtitle generation.', action: 'generate-subtitle', requestId: id });

  const offset = numberOr(body.chunkOffset ?? body.chunkStartSeconds, 0);
  const fileName = sanitizeFileName(body.audioFileName || body.fileName || 'audio.m4a', 'audio.m4a');
  const contentType = safeString(body.mimeType || body.contentType || 'audio/mp4');
  const fields = buildTranscriptionFields(body);
  const result = await openAiMultipart('/audio/transcriptions', fields, { buffer: audioBuffer, fileName, contentType });
  const rawSegments = result.segments || result.items || [];
  let segments = normalizeSegments(rawSegments, offset, body);
  if (!segments.length && result.text) {
    segments = normalizeSegments([{ start: offset, end: offset + Math.max(2, Math.min(8, safeString(result.text).length / 8)), text: result.text }], 0);
  }
  // A defensive guard for pre-existing bad relay behavior: internal prompt text
  // is never allowed to become dialogue in a saved subtitle.
  segments = constrainSegmentsToSourceWindow(dropMaruInstructionLeakSegments(segments), body);

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
    targetSegments = materializeNonVerbalCaptions(targetSegments.map(({ id, ...segment }) => segment), targetLang);
  } else {
    targetSegments = materializeNonVerbalCaptions(targetSegments, sourceLanguageDetected || body.sourceLanguage || 'en');
  }

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
