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
  return { start: Math.max(0, start), end: Math.max(0.1, end), text };
}

function normalizeSegments(items, offsetSeconds = 0) {
  const source = Array.isArray(items) ? items : [];
  // Preserve recognizer timestamps exactly.  Forcing later starts past earlier ends
  // shifted visible subtitles away from actual speech at dense dialogue and chunk edges.
  return source.map((item) => normalizeSegment(item, offsetSeconds)).filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
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

async function handleStatus(id) {
  return json(200, {
    ok: true,
    status: 'MARU AI media server ready',
    service: 'maru-ai-media',
    openAiReady: Boolean(OPENAI_API_KEY),
    subtitleActions: ['generate-subtitle', 'review-subtitle'],
    dubbingActions: ['generate-dubbing', 'generate-speech', 'text-to-speech', 'tts', 'dubbing', 'ai-dubbing'],
    requestId: id
  });
}

function buildSubtitlePrompt(body) {
  const targetLanguage = normalizeLanguage(body.targetLanguage || body.language || '');
  const sourceLanguage = normalizeLanguage(body.sourceLanguage || '');
  const base = [
    'Create accurate timed subtitle segments for the supplied audio.',
    'Keep timestamps close to the actual speech.',
    'Preserve proper nouns, scientific terms, numbers, units, species names, and technical terms accurately.',
    'For Korean documentary/lecture subtitles, prefer consistent polite explanatory style unless the scene clearly requires casual speech.',
    'For Korean dialogue subtitles, infer social relationship, age, role, rank, intimacy, and scene tone; keep honorific/casual style consistent across adjacent lines.',
    'For animal offspring terms, do not translate whale/dolphin/animal young as cattle calf in Korean; use 새끼 고래, 혹등고래 새끼, 새끼, 어린 개체 as context requires.'
  ];
  if (sourceLanguage) base.push(`Source language hint: ${sourceLanguage}.`);
  if (targetLanguage) base.push(`Target subtitle language: ${targetLanguage}.`);
  return base.join(' ');
}

async function handleGenerateSubtitle(id, body) {
  const audioBuffer = audioBufferFromPayload(body);
  if (!audioBuffer) return json(400, { ok: false, error: 'No audioBase64/fileBase64 was supplied for subtitle generation.', action: 'generate-subtitle', requestId: id });

  const offset = numberOr(body.chunkOffset ?? body.chunkStartSeconds, 0);
  const fileName = sanitizeFileName(body.audioFileName || body.fileName || 'audio.m4a', 'audio.m4a');
  const contentType = safeString(body.mimeType || body.contentType || 'audio/mp4');
  const fields = {
    model: DEFAULT_TRANSCRIBE_MODEL,
    response_format: 'verbose_json',
    prompt: buildSubtitlePrompt(body)
  };
  const lang = normalizeLanguage(body.sourceLanguage);
  if (lang) fields.language = lang.split('-')[0];

  const result = await openAiMultipart('/audio/transcriptions', fields, { buffer: audioBuffer, fileName, contentType });
  const rawSegments = result.segments || result.items || [];
  let segments = normalizeSegments(rawSegments, offset);

  if (!segments.length && result.text) {
    segments = normalizeSegments([{ start: offset, end: offset + Math.max(2, Math.min(8, String(result.text).length / 8)), text: result.text }], 0);
  }

  return json(200, {
    ok: true,
    action: 'generate-subtitle',
    // The server applied the exact chunkOffset, so desktop code must not add it again.
    timeline: 'absolute',
    fileName,
    model: DEFAULT_TRANSCRIBE_MODEL,
    segments,
    subtitleText: segmentsToSrt(segments),
    text: result.text || segments.map((s) => s.text).join('\n'),
    requestId: id
  });
}



function normalizeReviewInputSegments(value) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of source) {
    const id = Number(item?.id);
    const text = safeString(item?.text ?? item?.caption ?? item?.content ?? '').trim();
    if (!Number.isInteger(id) || id < 0 || !text) continue;
    out.push({ id, text });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function safeReviewContext(value) {
  return (Array.isArray(value) ? value : []).map((item) => safeString(item || '').trim()).filter(Boolean);
}

function parseReviewResult(value) {
  const raw = safeString(value || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
}

async function handleReviewSubtitle(id, body) {
  const segments = normalizeReviewInputSegments(body.segments);
  if (!segments.length) return json(400, { ok: false, action: 'review-subtitle', error: 'Timed subtitle text is required for final context review.', requestId: id });
  const language = normalizeLanguage(body.language || body.targetLanguage || body.sourceLanguage || 'auto') || 'auto';
  const contextBefore = safeReviewContext(body.contextBefore);
  const contextAfter = safeReviewContext(body.contextAfter);
  const system = [
    'You are the final conservative quality-review stage for timed subtitles.',
    'Do not translate. Keep every cue in the same selected language and script it was supplied in.',
    'Return JSON only as {"segments":[{"id":0,"text":"..."}]}. Return exactly one item for every supplied id, each once.',
    'Correct only clear speech-recognition errors, punctuation, spacing, obvious sentence-boundary defects, and consistency errors that are strongly supported by the supplied context.',
    'Do not rewrite valid dialogue for style, do not add omitted speech, and do not guess facts that are not in the supplied text.',
    'Treat person names, place names, institutions, works, brands, ranks, code names, technical terms, numbers, units, and species names as protected proper nouns. Keep their original spelling/script unless the supplied context clearly establishes a different repeated form.',
    'When a word can be either a person name or an ordinary word, preserve it rather than translating or replacing it when uncertain.',
    'Do not output timestamps, numbering, explanations, markdown, or any field other than id and text.'
  ].join(' ');
  const user = JSON.stringify({
    selectedLanguage: language,
    previousContext: contextBefore,
    reviewSegments: segments,
    followingContext: contextAfter
  });
  const model = safeString(body.model || body.reviewModel || process.env.OPENAI_SUBTITLE_REVIEW_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  const result = await openAiJson('/chat/completions', {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  });
  const parsed = parseReviewResult(result?.choices?.[0]?.message?.content || '');
  const reviewed = normalizeReviewInputSegments(parsed?.segments);
  const expectedIds = new Set(segments.map((item) => item.id));
  if (reviewed.length !== segments.length || reviewed.some((item) => !expectedIds.has(item.id)) || new Set(reviewed.map((item) => item.id)).size !== segments.length) {
    const err = new Error('Final context review returned an invalid cue structure.');
    err.statusCode = 422;
    throw err;
  }
  return json(200, {
    ok: true,
    action: 'review-subtitle',
    language,
    targetLanguage: language,
    segments: reviewed,
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
    if (action === 'review-subtitle' || action === 'subtitle-review' || action === 'final-context-review') return await handleReviewSubtitle(id, body);
    if (isDubbingAction(action)) return await handleGenerateDubbing(id, action, body);

    return json(400, {
      ok: false,
      error: `Unsupported action: ${action}`,
      supportedActions: ['status', 'generate-subtitle', 'review-subtitle', 'generate-dubbing', 'generate-speech', 'text-to-speech', 'tts'],
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
