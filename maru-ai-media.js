'use strict';

/**
 * MARU AI Media Netlify Function
 * Path: netlify/functions/maru-ai-media.js
 *
 * Client: MARU Media Player v88/v89 server relay UI
 * Required environment variable: OPENAI_API_KEY
 * Optional environment variables:
 * - MARU_OPENAI_API_KEY
 * - OPENAI_TRANSCRIBE_MODEL (default: whisper-1)
 * - OPENAI_TRANSLATE_MODEL  (default: gpt-4o-mini)
 * - OPENAI_TTS_MODEL        (default: gpt-4o-mini-tts, fallback: tts-1)
 */

const VERSION = 'maru-ai-media-netlify-v89.2';
const OPENAI_BASE = 'https://api.openai.com/v1';

function envKey() {
  return String(process.env.OPENAI_API_KEY || process.env.MARU_OPENAI_API_KEY || '').trim();
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(data || {})
  };
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeLanguage(value) {
  const raw = clean(value).toLowerCase().replace('_', '-');
  if (!raw || raw === 'auto') return 'auto';
  if (['zht', 'zh-tw', 'zh-hant', 'zh-hk'].includes(raw)) return 'zh-TW';
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('ko') || raw === 'kr' || raw === 'kor' || raw === 'korean') return 'ko';
  if (raw.startsWith('en') || raw === 'eng' || raw === 'english') return 'en';
  if (raw.startsWith('ja') || raw === 'jp' || raw === 'jpn' || raw === 'japanese') return 'ja';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('fr')) return 'fr';
  if (raw.startsWith('de')) return 'de';
  if (raw.startsWith('vi')) return 'vi';
  if (raw.startsWith('th')) return 'th';
  return raw.split('-')[0] || 'auto';
}

function languageName(code) {
  const map = {
    auto: 'the original language', ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese', 'zh-TW': 'Traditional Chinese',
    es: 'Spanish', fr: 'French', de: 'German', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', ru: 'Russian',
    ar: 'Arabic', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', tr: 'Turkish'
  };
  return map[code] || code || 'the selected language';
}

function bufferFromEvent(event) {
  if (!event || !event.body) return Buffer.alloc(0);
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
}

function splitBuffer(buf, sep) {
  const out = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(sep, start)) !== -1) {
    out.push(buf.slice(start, idx));
    start = idx + sep.length;
  }
  out.push(buf.slice(start));
  return out;
}

function parseContentDisposition(value) {
  const result = {};
  String(value || '').split(';').forEach((part) => {
    const m = part.trim().match(/^([^=]+)=(?:"([^"]*)"|([^;]*))$/);
    if (m) result[m[1].trim().toLowerCase()] = m[2] || m[3] || '';
  });
  return result;
}

function parseMultipart(event) {
  const headers = event.headers || {};
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  const match = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('multipart boundary is missing');
  const boundary = Buffer.from('--' + (match[1] || match[2]));
  const body = bufferFromEvent(event);
  const fields = {};
  const files = {};
  for (let part of splitBuffer(body, boundary)) {
    if (!part.length) continue;
    if (part.slice(0, 2).toString() === '--') continue;
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    let content = part.slice(headerEnd + 4);
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
    const headerLines = headerText.split(/\r\n/);
    const headerMap = {};
    for (const line of headerLines) {
      const p = line.indexOf(':');
      if (p > -1) headerMap[line.slice(0, p).trim().toLowerCase()] = line.slice(p + 1).trim();
    }
    const disp = parseContentDisposition(headerMap['content-disposition']);
    const name = disp.name;
    if (!name) continue;
    if (disp.filename) {
      files[name] = {
        name,
        filename: disp.filename,
        contentType: headerMap['content-type'] || 'application/octet-stream',
        buffer: content
      };
    } else {
      fields[name] = content.toString('utf8');
    }
  }
  return { fields, files };
}

function parseJsonBody(event) {
  if (!event || !event.body) return {};
  const text = bufferFromEvent(event).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function guessMime(filename, contentType) {
  const lower = String(filename || '').toLowerCase();
  if (contentType && contentType !== 'application/octet-stream') return contentType;
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/mp4';
}

async function openaiFetch(path, options) {
  const key = envKey();
  if (!key) {
    const err = new Error('Netlify environment variable OPENAI_API_KEY is not configured.');
    err.statusCode = 500;
    throw err;
  }
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(options && options.headers ? options.headers : {})
    }
  });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.arrayBuffer();
  if (!res.ok) {
    const msg = isJson ? (body && (body.error && (body.error.message || body.error.code) || body.message)) : Buffer.from(body || '').toString('utf8').slice(0, 500);
    const err = new Error(msg || `OpenAI request failed with ${res.status}`);
    err.statusCode = res.status;
    err.openAiBody = body;
    throw err;
  }
  return body;
}

function normalizeSegmentsFromOpenAi(data) {
  const source = Array.isArray(data && data.segments) ? data.segments : [];
  if (source.length) {
    return source.map((seg, index) => ({
      index: index + 1,
      start: Number(seg.start || 0),
      end: Number(seg.end || seg.start || 0),
      text: clean(seg.text)
    })).filter((seg) => seg.text);
  }
  const text = clean(data && (data.text || data.transcript));
  return text ? [{ index: 1, start: 0, end: 5, text }] : [];
}

async function transcribeAudio(file, fields) {
  const form = new FormData();
  const model = clean(process.env.OPENAI_TRANSCRIBE_MODEL) || 'whisper-1';
  const sourceLanguage = normalizeLanguage(fields.sourceLanguage || fields.language || 'auto');
  form.append('model', model);
  form.append('file', new Blob([file.buffer], { type: guessMime(file.filename, file.contentType) }), file.filename || 'maru-audio.m4a');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (sourceLanguage !== 'auto') form.append('language', sourceLanguage);
  const data = await openaiFetch('/audio/transcriptions', { method: 'POST', body: form });
  return normalizeSegmentsFromOpenAi(data);
}

async function translateSegmentsIfNeeded(segments, fields) {
  const targetLanguage = normalizeLanguage(fields.targetLanguage || fields.language || 'auto');
  if (!targetLanguage || targetLanguage === 'auto') return segments;
  const joined = JSON.stringify(segments.map((s) => ({ index: s.index, text: s.text })));
  const model = clean(process.env.OPENAI_TRANSLATE_MODEL) || 'gpt-4o-mini';
  const payload = {
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: `Translate subtitle text into ${languageName(targetLanguage)}. Preserve names, numbers, tone, and one output item per input item. Return JSON only: [{"index":1,"text":"..."}]` },
      { role: 'user', content: joined }
    ]
  };
  const data = await openaiFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const content = clean(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
  let parsed = null;
  try { parsed = JSON.parse(content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()); } catch {}
  if (!Array.isArray(parsed)) return segments;
  const map = new Map(parsed.map((x) => [Number(x.index), clean(x.text)]));
  return segments.map((seg) => ({ ...seg, text: map.get(Number(seg.index)) || seg.text }));
}

function offsetSegments(segments, fields) {
  const offset = Number(fields.chunkOffset || fields.offset || 0) || 0;
  if (!offset) return segments;
  return segments.map((seg) => ({ ...seg, start: Number(seg.start || 0) + offset, end: Number(seg.end || 0) + offset }));
}

async function handleGenerateSubtitle(fields, files) {
  const file = files.file || files.audio || files.media;
  if (!file || !file.buffer || !file.buffer.length) throw new Error('Audio file is missing.');
  let segments = await transcribeAudio(file, fields || {});
  segments = offsetSegments(segments, fields || {});
  segments = await translateSegmentsIfNeeded(segments, fields || {});
  return {
    ok: true,
    action: 'generate-subtitle',
    provider: 'openai-server-relay',
    model: clean(process.env.OPENAI_TRANSCRIBE_MODEL) || 'whisper-1',
    targetLanguage: normalizeLanguage(fields.targetLanguage || fields.language || 'auto'),
    segments,
    items: segments,
    count: segments.length
  };
}

function splitText(text, maxLen) {
  const raw = clean(text);
  if (!raw) return [];
  const parts = [];
  let buf = '';
  for (const sentence of raw.split(/(?<=[.!?。！？])\s+|\n+/)) {
    const next = sentence.trim();
    if (!next) continue;
    if ((buf + ' ' + next).trim().length > maxLen && buf.trim()) {
      parts.push(buf.trim());
      buf = next;
    } else {
      buf = (buf + ' ' + next).trim();
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length ? parts : [raw.slice(0, maxLen)];
}

async function translateScriptIfNeeded(text, fields) {
  const targetLanguage = normalizeLanguage(fields.targetLanguage || fields.language || 'auto');
  if (!targetLanguage || targetLanguage === 'auto') return text;
  const model = clean(process.env.OPENAI_TRANSLATE_MODEL) || 'gpt-4o-mini';
  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: `Translate this dubbing script into ${languageName(targetLanguage)}. Keep it natural for spoken audio. Return only the translated script.` },
      { role: 'user', content: text }
    ]
  };
  const data = await openaiFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return clean(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || text;
}

async function speechBuffer(input, voice, model) {
  const payload = {
    model,
    voice: clean(voice) || 'alloy',
    input,
    response_format: 'mp3'
  };
  const arrayBuffer = await openaiFetch('/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return Buffer.from(arrayBuffer);
}

async function handleGenerateDubbing(fields) {
  let scriptText = clean(fields.scriptText || fields.text || fields.subtitleText || fields.content);
  if (!scriptText) throw new Error('Dubbing script text is missing.');
  scriptText = await translateScriptIfNeeded(scriptText, fields || {});
  const voice = clean(fields.voice) || 'alloy';
  const primaryModel = clean(process.env.OPENAI_TTS_MODEL) || 'gpt-4o-mini-tts';
  const chunks = splitText(scriptText, 3800).slice(0, 12);
  const buffers = [];
  for (const chunk of chunks) {
    try {
      buffers.push(await speechBuffer(chunk, voice, primaryModel));
    } catch (err) {
      if (primaryModel !== 'tts-1' && /model|not found|does not exist|unsupported/i.test(err.message || '')) {
        buffers.push(await speechBuffer(chunk, voice, 'tts-1'));
      } else {
        throw err;
      }
    }
  }
  const audio = Buffer.concat(buffers);
  return {
    ok: true,
    action: 'generate-dubbing',
    provider: 'openai-server-relay',
    responseFormat: 'mp3',
    mimeType: 'audio/mpeg',
    audioBase64: audio.toString('base64'),
    size: audio.length,
    chunks: buffers.length
  };
}

async function handleJsonAction(payload) {
  const action = clean(payload.action || payload.mode || 'status').toLowerCase();
  if (action === 'status' || action === 'health' || action === 'ping') {
    return {
      ok: true,
      status: 'MARU AI media server is ready.',
      version: VERSION,
      openAiReady: !!envKey(),
      hasOpenAiKey: !!envKey(),
      actions: ['status', 'generate-subtitle', 'generate-dubbing']
    };
  }
  if (action === 'generate-dubbing' || action === 'dubbing' || action === 'tts') {
    return handleGenerateDubbing(payload || {});
  }
  throw new Error(`Unsupported JSON action: ${action}`);
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
    if (event.httpMethod === 'GET') return json(200, await handleJsonAction({ action: 'status' }));
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

    const headers = event.headers || {};
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    if (/multipart\/form-data/i.test(contentType)) {
      const { fields, files } = parseMultipart(event);
      const action = clean(fields.action || 'generate-subtitle').toLowerCase();
      if (action === 'generate-subtitle' || action === 'subtitle' || action === 'transcribe') {
        return json(200, await handleGenerateSubtitle(fields, files));
      }
      return json(400, { ok: false, error: `Unsupported multipart action: ${action}` });
    }

    const payload = parseJsonBody(event);
    return json(200, await handleJsonAction(payload));
  } catch (error) {
    const statusCode = Number(error.statusCode || error.status || 500);
    const safeStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    const message = error && error.message ? error.message : String(error);
    return json(safeStatus, {
      ok: false,
      error: message,
      code: error && error.openAiBody && error.openAiBody.error && error.openAiBody.error.code || undefined,
      type: error && error.openAiBody && error.openAiBody.error && error.openAiBody.error.type || undefined,
      version: VERSION
    });
  }
};
