'use strict';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const OWNER_DEFAULTS = ['owner', 'admin', 'samo429425@gmail.com'];
const MAX_AUDIO_BYTES = Number(process.env.MARU_AI_MAX_AUDIO_BYTES || 5 * 1024 * 1024);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
function sanitizeError(value) {
  return String(value || '').replace(/sk-[A-Za-z0-9_\-]+/g, 'sk-***').slice(0, 2400);
}
function requestId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return `maru-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase().replace('_', '-');
  if (!raw || raw === 'auto') return 'auto';
  if (['zht', 'zh-hant', 'zh-tw', 'zh-hk'].includes(raw)) return 'zh-Hant';
  if (raw.startsWith('zh')) return 'zh';
  return raw.split('-')[0] || 'auto';
}
function parseJsonBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (error) { throw new Error(`Invalid JSON body: ${error.message}`); }
}
function parseContentDisposition(value) {
  const out = {};
  String(value || '').split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key || !rest.length) return;
    out[key.toLowerCase()] = rest.join('=').trim().replace(/^"|"$/g, '');
  });
  return out;
}
function parseMultipart(event) {
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
  const match = /boundary=([^;]+)/i.exec(contentType);
  if (!match) throw new Error('multipart boundary is missing');
  const boundary = Buffer.from(`--${match[1]}`);
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(String(event.body || ''), 'binary');
  const fields = {};
  let file = null;
  let cursor = raw.indexOf(boundary);
  while (cursor >= 0) {
    cursor += boundary.length;
    if (raw.slice(cursor, cursor + 2).toString() === '--') break;
    if (raw.slice(cursor, cursor + 2).toString() === '\r\n') cursor += 2;
    const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) break;
    const headerText = raw.slice(cursor, headerEnd).toString('utf8');
    const headers = {};
    headerText.split(/\r\n/).forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    const next = raw.indexOf(boundary, headerEnd + 4);
    if (next < 0) break;
    let data = raw.slice(headerEnd + 4, next);
    if (data.length >= 2 && data.slice(data.length - 2).toString() === '\r\n') data = data.slice(0, data.length - 2);
    const disp = parseContentDisposition(headers['content-disposition']);
    const name = disp.name || '';
    if (name) {
      if (disp.filename) file = { fieldName: name, filename: disp.filename, contentType: headers['content-type'] || 'audio/mp4', buffer: data };
      else fields[name] = data.toString('utf8');
    }
    cursor = next;
  }
  return { fields, file };
}
function fileFromJson(body) {
  const raw = body.audioBase64 || body.audio || body.fileBase64 || body.audio_file_base64 || '';
  if (!raw) return null;
  const clean = String(raw).replace(/^data:audio\/[^;]+;base64,/, '');
  const buffer = Buffer.from(clean, 'base64');
  return { fieldName: 'file', filename: body.fileName || body.filename || 'audio.m4a', contentType: body.contentType || body.mime || 'audio/mp4', buffer };
}
function statusPayload() {
  return { ok: true, service: 'maru-ai-media', status: 'ready', openAiReady: !!process.env.OPENAI_API_KEY, hasOpenAiKey: !!process.env.OPENAI_API_KEY, maxAudioBytes: MAX_AUDIO_BYTES, accepted: ['multipart/form-data file', 'application/json audioBase64'], features: ['status', 'generate-subtitle'] };
}
async function openAiJson(path, payload, apiKey) {
  const res = await fetch(`${OPENAI_BASE_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(data?.error?.message || text || `OpenAI HTTP ${res.status}`);
  return data;
}
async function transcribeAudio(file, fields, apiKey) {
  const model = process.env.MARU_OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
  const form = new FormData();
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  const sourceLanguage = normalizeLang(fields.sourceLanguage || fields.source_language || 'auto');
  if (sourceLanguage !== 'auto' && sourceLanguage !== 'original') form.append('language', sourceLanguage === 'zh-Hant' ? 'zh' : sourceLanguage);
  const blob = new Blob([file.buffer], { type: file.contentType || 'audio/mp4' });
  form.append('file', blob, file.filename || 'audio.m4a');
  const res = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(data?.error?.message || text || `OpenAI transcription HTTP ${res.status}`);
  return data || {};
}
function normalizeSegments(data, offsetSeconds) {
  const offset = Number(offsetSeconds || 0) || 0;
  const src = Array.isArray(data?.segments) ? data.segments : [];
  let segments = src.map((item) => ({ start: Math.max(0, Number(item.start || 0) + offset), end: Math.max(0, Number(item.end || 0) + offset), text: String(item.text || '').trim() })).filter((item) => item.text);
  if (!segments.length && data?.text) segments = [{ start: offset, end: offset + 4, text: String(data.text || '').trim() }];
  return segments;
}
async function translateSegmentsIfNeeded(segments, targetLanguage, apiKey) {
  const target = normalizeLang(targetLanguage || 'auto');
  if (!target || target === 'auto' || target === 'original' || !segments.length) return segments;
  const model = process.env.MARU_OPENAI_TRANSLATE_MODEL || 'gpt-4o-mini';
  const out = [];
  for (let i = 0; i < segments.length; i += 40) {
    const batch = segments.slice(i, i + 40).map((item, j) => ({ id: i + j, text: item.text }));
    const data = await openAiJson('/chat/completions', { model, temperature: 0.1, messages: [ { role: 'system', content: 'Translate subtitle text. Preserve meaning, names, numbers, and short subtitle style. Return only JSON: {"items":[{"id":0,"text":"..."}]}.' }, { role: 'user', content: JSON.stringify({ targetLanguage: target, items: batch }) } ], response_format: { type: 'json_object' } }, apiKey);
    let parsed = {}; try { parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}'); } catch {}
    const rows = Array.isArray(parsed.items) ? parsed.items : [];
    const map = new Map(rows.map((row) => [Number(row.id), String(row.text || '').trim()]));
    for (let j = 0; j < batch.length; j += 1) out.push({ ...segments[i + j], text: map.get(i + j) || segments[i + j].text });
  }
  return out;
}

exports.handler = async (event) => {
  const rid = requestId();
  const started = Date.now();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  try {
    const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
    console.log('[maru-ai-media]', rid, event.httpMethod, contentType || 'no-content-type', 'bodyBytes=', event.body ? String(event.body).length : 0, 'base64=', !!event.isBase64Encoded);
    if (event.httpMethod === 'GET') return json(200, statusPayload());
    if (event.httpMethod !== 'POST') return json(405, { ok: false, requestId: rid, error: 'Only GET/POST are supported.' });
    let fields = {};
    let file = null;
    if (/multipart\/form-data/i.test(contentType)) {
      ({ fields, file } = parseMultipart(event));
    } else if (/application\/json/i.test(contentType) || !contentType) {
      const body = parseJsonBody(event);
      fields = body || {};
      file = fileFromJson(body);
      const action = String(body.action || '').trim();
      if (!action || action === 'status' || action === 'health') return json(200, statusPayload());
    } else {
      return json(415, { ok: false, requestId: rid, error: `Unsupported content type: ${contentType}` });
    }
    const action = String(fields.action || '').trim() || 'generate-subtitle';
    console.log('[maru-ai-media]', rid, 'action=', action, 'file=', file ? `${file.filename} ${file.buffer.length} bytes ${file.contentType}` : 'none');
    if (action !== 'generate-subtitle') return json(400, { ok: false, requestId: rid, error: `Unsupported action: ${action}` });
    if (!file || !file.buffer || !file.buffer.length) return json(400, { ok: false, requestId: rid, error: 'Audio file is missing. Send multipart/form-data with field name "file" or JSON audioBase64.' });
    if (file.buffer.length > MAX_AUDIO_BYTES) return json(413, { ok: false, requestId: rid, error: `Audio chunk too large: ${file.buffer.length} bytes. Max ${MAX_AUDIO_BYTES}. Split audio into smaller chunks.` });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(500, { ok: false, requestId: rid, error: 'OPENAI_API_KEY is not configured on Netlify.' });
    const raw = await transcribeAudio(file, fields, apiKey);
    let segments = normalizeSegments(raw, fields.chunkOffset || fields.offset || 0);
    segments = await translateSegmentsIfNeeded(segments, fields.targetLanguage || 'auto', apiKey);
    if (!segments.length) return json(502, { ok: false, requestId: rid, error: 'OpenAI returned no subtitle text.' });
    const elapsedMs = Date.now() - started;
    console.log('[maru-ai-media]', rid, 'ok segments=', segments.length, 'elapsedMs=', elapsedMs);
    return json(200, { ok: true, requestId: rid, action, targetLanguage: normalizeLang(fields.targetLanguage || 'auto'), sourceLanguage: normalizeLang(fields.sourceLanguage || 'auto'), format: String(fields.format || 'srt').toLowerCase(), segments, text: segments.map((x) => x.text).join('\n'), elapsedMs });
  } catch (error) {
    const safe = sanitizeError(error && (error.stack || error.message || error));
    console.error('[maru-ai-media]', rid, safe);
    return json(500, { ok: false, requestId: rid, error: sanitizeError(error?.message || error || 'Internal Error') });
  }
};
