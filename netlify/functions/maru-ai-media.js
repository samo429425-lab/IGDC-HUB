'use strict';

/*
 * MARU AI Media relay — SAFE52
 * One short audio/TTS request per invocation. Long-job orchestration and
 * checkpoints live in the Windows player, not in a single Netlify execution.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const DEFAULT_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || process.env.OPENAI_STT_MODEL || 'whisper-1';
const DEFAULT_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const DEFAULT_TTS_VOICE = process.env.OPENAI_TTS_VOICE || process.env.MARU_AI_DUBBING_VOICE || 'alloy';
const DEFAULT_TTS_FORMAT = process.env.OPENAI_TTS_FORMAT || 'mp3';
const MAX_AUDIO_BYTES = Math.max(128 * 1024, Math.min(1536 * 1024, Number(process.env.MARU_AI_MAX_AUDIO_BYTES || 768 * 1024) || 768 * 1024));
const MAX_TTS_CHARS = Math.max(400, Math.min(3500, Number(process.env.MARU_TTS_CHUNK_CHARS || 2600) || 2600));
const OPENAI_TIMEOUT_MS = Math.max(15000, Math.min(75000, Number(process.env.MARU_OPENAI_TIMEOUT_MS || 60000) || 60000));

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body || {}) };
}
function safeString(value, fallback = '') { return value == null ? fallback : String(value); }
function requestId(event) {
  const h = event?.headers || {};
  return h['x-nf-request-id'] || h['X-Nf-Request-Id'] || h['x-request-id'] || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function log(id, ...args) { console.log('[maru-ai-media]', id, ...args); }
function normalizeAction(action) { return safeString(action || 'status').trim().toLowerCase().replace(/_/g, '-'); }
function normalizeLanguage(value) {
  const raw = safeString(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw || ['auto', 'original', 'source'].includes(raw)) return '';
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zht'].includes(raw)) return 'zht';
  if (raw.startsWith('zh')) return 'zh';
  if (raw === 'fil') return 'tl';
  return raw.split('-')[0].slice(0, 16);
}
function normalizeVoice(value) {
  const v = safeString(value || DEFAULT_TTS_VOICE).trim().toLowerCase();
  return new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']).has(v) ? v : DEFAULT_TTS_VOICE;
}
function normalizeAudioFormat(value) {
  const f = safeString(value || DEFAULT_TTS_FORMAT).trim().toLowerCase().replace(/^audio\//, '');
  return ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'].includes(f) ? f : 'mp3';
}
function mimeForAudioFormat(format) {
  const f = normalizeAudioFormat(format);
  return ({ wav: 'audio/wav', opus: 'audio/opus', aac: 'audio/aac', flac: 'audio/flac', pcm: 'audio/pcm' })[f] || 'audio/mpeg';
}
function sanitizeFileName(value, fallback = 'maru-ai-media') {
  const clean = safeString(value || fallback, fallback).replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160);
  return clean || fallback;
}
function fileStem(value) { return sanitizeFileName(value || 'maru-media').replace(/\.[a-z0-9]{1,8}$/i, '') || 'maru-media'; }
function parseJsonBody(event) {
  const raw = event?.body || '';
  if (!raw) return {};
  const text = event?.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  try { return JSON.parse(text); }
  catch (error) { const e = new Error(`Invalid JSON body: ${error.message}`); e.statusCode = 400; e.code = 'invalid_json'; throw e; }
}
function decodeBase64Field(value) {
  if (!value) return null;
  const raw = safeString(value).trim().replace(/^data:[^;]+;base64,/, '');
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length ? buf : null;
  } catch { return null; }
}
function audioBufferFromPayload(body) {
  return decodeBase64Field(body.audioBase64) || decodeBase64Field(body.fileBase64) || decodeBase64Field(body.audio) || decodeBase64Field(body.content) || decodeBase64Field(body.data) || null;
}
function numberOr(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function normalizeSegment(item) {
  if (!item || typeof item !== 'object') return null;
  const start = Math.max(0, numberOr(item.start ?? item.startSeconds ?? item.from ?? item.begin, 0));
  let end = numberOr(item.end ?? item.endSeconds ?? item.to ?? item.finish, start + 2);
  const text = safeString(item.text ?? item.caption ?? item.content ?? item.subtitle ?? '').trim();
  if (!text) return null;
  if (end <= start) end = start + 1.5;
  return { start, end: Math.max(0.1, end), text };
}
function normalizeSegments(items) {
  const rows = (Array.isArray(items) ? items : []).map(normalizeSegment).filter(Boolean).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].start < rows[i - 1].end) {
      rows[i].start = Math.max(rows[i].start, rows[i - 1].end + 0.02);
      if (rows[i].end <= rows[i].start) rows[i].end = rows[i].start + 1.2;
    }
  }
  return rows;
}
function secondsToSrtTime(sec) {
  const totalMs = Math.max(0, Math.round(Number(sec || 0) * 1000));
  const h = Math.floor(totalMs / 3600000), m = Math.floor((totalMs % 3600000) / 60000), s = Math.floor((totalMs % 60000) / 1000), ms = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
function segmentsToSrt(segments) { return normalizeSegments(segments).map((s, i) => `${i + 1}\n${secondsToSrtTime(s.start)} --> ${secondsToSrtTime(s.end)}\n${s.text}\n`).join('\n'); }
function buildMultipartBody(fields, fileField) {
  const boundary = `----MARUAI${Date.now()}${Math.random().toString(16).slice(2)}`;
  const parts = [];
  const push = (value) => parts.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'));
  for (const [name, value] of Object.entries(fields || {})) {
    if (value == null || value === '') continue;
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${String(name).replace(/"/g, '')}"\r\n\r\n${String(value)}\r\n`);
  }
  if (fileField?.buffer) {
    const fileName = sanitizeFileName(fileField.fileName || 'audio.m4a');
    const contentType = safeString(fileField.contentType || 'audio/mp4');
    push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName.replace(/"/g, '')}"\r\nContent-Type: ${contentType}\r\n\r\n`);
    push(fileField.buffer); push('\r\n');
  }
  push(`--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat(parts) };
}
function openAiError(status, text) {
  let parsed = null; try { parsed = JSON.parse(text || ''); } catch {}
  const err = new Error(parsed?.error?.message || parsed?.message || text || `OpenAI failed (${status})`);
  err.statusCode = status; err.openAiStatus = status; return err;
}
async function fetchWithTimeout(url, init, timeoutMs = OPENAI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) {
    if (error?.name === 'AbortError') { const e = new Error('openai_timeout'); e.statusCode = 504; e.code = 'openai_timeout'; throw e; }
    throw error;
  } finally { clearTimeout(timer); }
}
async function openAiMultipart(path, fields, fileField) {
  if (!OPENAI_API_KEY) { const e = new Error('OPENAI_API_KEY is not configured on Netlify.'); e.statusCode = 500; e.code = 'openai_key_missing'; throw e; }
  const multipart = buildMultipartBody(fields, fileField);
  const res = await fetchWithTimeout(`${OPENAI_BASE_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`, 'Content-Length': String(multipart.body.length) }, body: multipart.body });
  const text = await res.text();
  if (!res.ok) throw openAiError(res.status, text);
  try { return text ? JSON.parse(text) : {}; } catch { return { text }; }
}
async function openAiBinary(path, payload) {
  if (!OPENAI_API_KEY) { const e = new Error('OPENAI_API_KEY is not configured on Netlify.'); e.statusCode = 500; e.code = 'openai_key_missing'; throw e; }
  const res = await fetchWithTimeout(`${OPENAI_BASE_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw openAiError(res.status, buffer.toString('utf8'));
  return buffer;
}
function buildTranscriptionPrompt(body) {
  const hint = normalizeLanguage(body.sourceLanguage || body.language);
  const items = ['Create accurate timed subtitle segments for the supplied audio.', 'Keep timestamps close to actual speech.', 'Preserve names, numbers, units and technical terms.'];
  if (hint) items.push(`Spoken-language hint: ${hint}.`);
  return items.join(' ');
}
function cleanTextForSpeech(value) {
  return safeString(value || '').replace(/^\s*\d+\s*$/gm, ' ').replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g, ' ').replace(/<SYNC[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\r/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}
function splitTextForTts(text, maxLen = MAX_TTS_CHARS) {
  const clean = cleanTextForSpeech(text); if (!clean) return [];
  const parts = []; let buffer = '';
  for (const raw of clean.split(/(?<=[.!?。！？…])\s+|\n+/u)) {
    const piece = raw.trim(); if (!piece) continue;
    if (piece.length > maxLen) { if (buffer) { parts.push(buffer); buffer = ''; } for (let i = 0; i < piece.length; i += maxLen) parts.push(piece.slice(i, i + maxLen).trim()); continue; }
    const next = (buffer ? `${buffer} ${piece}` : piece).trim();
    if (next.length > maxLen && buffer) { parts.push(buffer); buffer = piece; } else buffer = next;
  }
  if (buffer) parts.push(buffer); return parts;
}
function buildDubbingInstructions(body) {
  const language = normalizeLanguage(body.targetLanguage || body.language); const style = safeString(body.voiceStyle || body.style || '').trim();
  const parts = ['Speak naturally and clearly for video dubbing.', 'Do not add explanations, timestamps, labels, or words not in the script.', 'Respect punctuation for natural pacing.'];
  if (language) parts.push(`Target spoken language: ${language}.`); if (style) parts.push(`Style: ${style}.`); return parts.join(' ');
}
async function ttsOnce(text, body, model) {
  const format = normalizeAudioFormat(body.responseFormat || body.outputFormat || body.format || DEFAULT_TTS_FORMAT);
  const payload = { model, voice: normalizeVoice(body.voice), input: text, response_format: format };
  const instructions = buildDubbingInstructions(body); if (!/^tts-1/i.test(model) && instructions) payload.instructions = instructions;
  return openAiBinary('/audio/speech', payload);
}
async function ttsWithFallback(text, body) {
  const requested = safeString(body.model || body.ttsModel || DEFAULT_TTS_MODEL).trim() || DEFAULT_TTS_MODEL;
  const models = Array.from(new Set([requested, DEFAULT_TTS_MODEL, 'tts-1'])).filter(Boolean); let last = null;
  for (const model of models) {
    try { return { buffer: await ttsOnce(text, body, model), model }; }
    catch (error) { last = error; if (!/model|unsupported|unknown|invalid|instructions|parameter|response_format/i.test(String(error?.message || ''))) break; }
  }
  throw last || new Error('OpenAI TTS failed.');
}
function isDubbingAction(action) { return ['generate-dubbing', 'dubbing', 'ai-dubbing', 'generate-speech', 'text-to-speech', 'tts'].includes(action); }
function classifyError(error) {
  const status = Number(error?.statusCode || error?.openAiStatus || 500); const raw = String(error?.message || error || 'Unknown server error');
  if (/insufficient_quota|quota|billing|payment/i.test(raw)) return { statusCode: status === 500 ? 402 : status, code: 'openai_billing_or_quota', message: 'OpenAI API quota or billing limit reached.' };
  if (/api key|invalid_api_key|incorrect api key|unauthorized/i.test(raw)) return { statusCode: status === 500 ? 401 : status, code: 'openai_api_key', message: 'OpenAI API key is missing or invalid.' };
  if (/timeout|timed out|abort/i.test(raw) || status === 504) return { statusCode: 504, code: 'openai_timeout', message: 'The current short media segment timed out. Retry this segment or split it into a smaller segment.' };
  if (status === 413) return { statusCode: 413, code: 'audio_segment_too_large', message: 'The audio segment is too large. Split it into a shorter segment and retry.' };
  if (status === 429) return { statusCode: 429, code: 'openai_rate_limit', message: 'OpenAI rate limit reached. Retry this segment after a short delay.' };
  return { statusCode: status || 500, code: error?.code || 'server_error', message: raw.slice(0, 1000) };
}
async function handleStatus(id) {
  return json(200, { ok: true, service: 'maru-ai-media', version: 'safe52-short-segment-relay', status: 'MARU AI media server ready', openAiReady: Boolean(OPENAI_API_KEY), maxAudioBytes: MAX_AUDIO_BYTES, subtitleActions: ['generate-subtitle'], dubbingActions: ['generate-dubbing', 'generate-speech', 'text-to-speech', 'tts'], requestId: id });
}
async function handleGenerateSubtitle(id, body) {
  const audio = audioBufferFromPayload(body);
  if (!audio) return json(400, { ok: false, action: 'generate-subtitle', code: 'audio_missing', error: 'No audioBase64/fileBase64 was supplied.', requestId: id });
  if (audio.length > MAX_AUDIO_BYTES) return json(413, { ok: false, action: 'generate-subtitle', code: 'audio_segment_too_large', error: `Audio segment exceeds the safe relay limit (${MAX_AUDIO_BYTES} bytes).`, requestId: id });
  const fileName = sanitizeFileName(body.audioFileName || body.fileName || 'audio.m4a', 'audio.m4a');
  const contentType = safeString(body.mimeType || body.contentType || 'audio/mp4');
  const sourceLanguage = normalizeLanguage(body.sourceLanguage);
  const fields = { model: DEFAULT_TRANSCRIBE_MODEL, response_format: 'verbose_json', prompt: buildTranscriptionPrompt(body) };
  if (sourceLanguage) fields.language = sourceLanguage === 'zht' ? 'zh' : sourceLanguage;
  const result = await openAiMultipart('/audio/transcriptions', fields, { buffer: audio, fileName, contentType });
  let segments = normalizeSegments(result.segments || result.items || []);
  if (!segments.length && result.text) segments = normalizeSegments([{ start: 0, end: Math.max(2, Math.min(8, String(result.text).length / 8)), text: result.text }]);
  return json(200, { ok: true, action: 'generate-subtitle', model: DEFAULT_TRANSCRIBE_MODEL, fileName, timeline: 'chunk', timestampBasis: 'chunk-relative', chunkStartSeconds: 0, sourceLanguageAccepted: sourceLanguage || 'auto', segments, subtitleText: segmentsToSrt(segments), text: result.text || segments.map((x) => x.text).join('\n'), requestId: id });
}
async function handleGenerateDubbing(id, action, body) {
  const script = cleanTextForSpeech(body.scriptText || body.subtitleText || body.text || body.input || body.prompt || '');
  if (!script) return json(400, { ok: false, action, code: 'script_missing', error: 'No readable script text was supplied.', requestId: id });
  const parts = splitTextForTts(script, MAX_TTS_CHARS); if (!parts.length) return json(400, { ok: false, action, code: 'script_missing', error: 'No readable script text remained.', requestId: id });
  const buffers = []; let model = '';
  for (let i = 0; i < parts.length; i += 1) { log(id, `dubbing ${i + 1}/${parts.length}`); const result = await ttsWithFallback(parts[i], body); buffers.push(result.buffer); model = result.model; }
  const format = normalizeAudioFormat(body.responseFormat || body.outputFormat || body.format || DEFAULT_TTS_FORMAT);
  const language = normalizeLanguage(body.targetLanguage || body.language || 'auto') || 'auto';
  const fileName = sanitizeFileName(body.audioFileName || `${fileStem(body.fileName || body.originalFileName || 'maru-ai-dubbing')}.ai-dub-${language}.${format}`);
  const audio = Buffer.concat(buffers);
  return json(200, { ok: true, action: 'generate-dubbing', sourceAction: action, model, voice: normalizeVoice(body.voice), format, mimeType: mimeForAudioFormat(format), audioFileName: fileName, audioBase64: audio.toString('base64'), size: audio.length, partTotal: parts.length, targetLanguageVerified: language, requestId: id });
}
exports.handler = async (event) => {
  const id = requestId(event); const started = Date.now();
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    if (event.httpMethod === 'GET') return await handleStatus(id);
    if (event.httpMethod !== 'POST') return json(405, { ok: false, code: 'method_not_allowed', error: 'Method not allowed', requestId: id });
    const contentType = safeString(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '');
    if (!/application\/json/i.test(contentType)) return json(415, { ok: false, code: 'json_required', error: 'MARU AI media server expects application/json.', requestId: id });
    const body = parseJsonBody(event); const action = normalizeAction(body.action);
    log(id, 'action=', action, 'bodyBytes=', Buffer.byteLength(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8'));
    if (['status', 'health', 'ping', 'connect', 'test', 'connection-test'].includes(action)) return await handleStatus(id);
    if (['generate-subtitle', 'subtitle', 'transcribe'].includes(action)) return await handleGenerateSubtitle(id, body);
    if (isDubbingAction(action)) return await handleGenerateDubbing(id, action, body);
    return json(400, { ok: false, code: 'unsupported_action', error: `Unsupported action: ${action}`, supportedActions: ['status', 'generate-subtitle', 'generate-dubbing', 'generate-speech', 'text-to-speech', 'tts'], requestId: id });
  } catch (error) {
    const out = classifyError(error); log(id, 'ERROR', out.code, out.message, 'elapsedMs=', Date.now() - started);
    return json(out.statusCode, { ok: false, code: out.code, error: out.message, requestId: id });
  } finally { log(id, 'elapsedMs=', Date.now() - started); }
};
