/**
 * netlify/functions/maru-ai-media.js
 * MARU AI Media Server Relay v90
 *
 * Required Netlify environment variable:
 *   OPENAI_API_KEY
 *
 * Player endpoint:
 *   https://igdcglobal.com/.netlify/functions/maru-ai-media
 *
 * Supported actions:
 *   GET  ?action=status / health / test
 *   POST JSON       { action:"status" }
 *   POST multipart  action=generate-subtitle, file=<audio chunk>
 *   POST JSON       { action:"generate-dubbing", scriptText:"...", voice:"alloy" }
 *
 * This function never returns the raw OpenAI API key.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MARU-Client, X-MARU-Client-Version",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

const OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_TRANSCRIBE_MODEL = process.env.MARU_OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const DEFAULT_TRANSLATE_MODEL = process.env.MARU_OPENAI_TRANSLATE_MODEL || "gpt-4o-mini";
const DEFAULT_TTS_MODEL = process.env.MARU_OPENAI_TTS_MODEL || "tts-1";
const MAX_MULTIPART_BYTES = Number(process.env.MARU_AI_MAX_UPLOAD_BYTES || 26 * 1024 * 1024);
const MAX_TTS_SCRIPT_CHARS = Number(process.env.MARU_AI_MAX_TTS_SCRIPT_CHARS || 12000);

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body, null, 2) };
}

function binary(statusCode, buffer, contentType) {
  return {
    statusCode,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Access-Control-Allow-Origin": "*"
    },
    isBase64Encoded: true,
    body: Buffer.from(buffer || Buffer.alloc(0)).toString("base64")
  };
}

function s(v) { return String(v == null ? "" : v); }

function getOpenAiKey() {
  return s(process.env.OPENAI_API_KEY).trim();
}

function maskKey(key) {
  const raw = s(key).trim();
  if (!raw) return "";
  if (raw.length <= 14) return raw.slice(0, 3) + "..." + raw.slice(-2);
  return raw.slice(0, 7) + "..." + raw.slice(-6);
}

function keyShape(rawValue) {
  const original = s(rawValue);
  const trimmed = original.trim();
  return {
    present: !!trimmed,
    length: trimmed.length,
    startsWithSk: trimmed.startsWith("sk-"),
    startsWithProject: trimmed.startsWith("sk-proj-"),
    hasLeadingOrTrailingWhitespace: original !== trimmed,
    masked: maskKey(trimmed)
  };
}

function safeOpenAiError(status, payload, fallback) {
  const err = payload && payload.error ? payload.error : {};
  const code = s(err.code);
  const type = s(err.type);
  const message = s(err.message || fallback || "OpenAI request failed.").slice(0, 800);

  let diagnosis = "openai_request_failed";
  let userMessage = "OpenAI 요청 처리 중 오류가 발생했습니다.";
  let retryable = false;

  if (status === 401 || code === "invalid_api_key" || /incorrect api key|invalid api key/i.test(message)) {
    diagnosis = "invalid_openai_api_key";
    userMessage = "MARU AI 서버의 OpenAI 키가 유효하지 않습니다.";
  } else if (status === 429 || /quota|billing|rate limit|too many requests/i.test(message + " " + code)) {
    diagnosis = "quota_billing_or_rate_limit";
    userMessage = "OpenAI API 사용량, 결제 크레딧, 또는 속도 제한에 걸렸습니다.";
    retryable = true;
  } else if (status === 403) {
    diagnosis = "permission_or_project_block";
    userMessage = "OpenAI 프로젝트 권한 또는 모델 접근 권한이 막혀 있습니다.";
  } else if (status >= 500) {
    diagnosis = "openai_server_error";
    userMessage = "OpenAI 서버 응답 오류입니다. 잠시 후 다시 시도해 주세요.";
    retryable = true;
  } else if (status === 400) {
    diagnosis = "bad_openai_request";
    userMessage = "OpenAI 요청 형식이 맞지 않습니다.";
  }

  return {
    ok: false,
    diagnosis,
    message: userMessage,
    retryable,
    openaiStatus: status,
    openaiErrorType: type || null,
    openaiErrorCode: code || null,
    openaiErrorMessage: message || null
  };
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 1000) }; }
  if (!res.ok) {
    const safe = safeOpenAiError(res.status, data, text);
    const error = new Error(safe.message);
    error.safe = safe;
    error.statusCode = res.status;
    throw error;
  }
  return data;
}

async function fetchBinary(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 1000) }; }
    const safe = safeOpenAiError(res.status, data, text);
    const error = new Error(safe.message);
    error.safe = safe;
    error.statusCode = res.status;
    throw error;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function checkOpenAIKey() {
  const startedAt = Date.now();
  const raw = process.env.OPENAI_API_KEY || "";
  const key = getOpenAiKey();
  const shape = keyShape(raw);

  if (!shape.present) {
    return {
      ok: false,
      alive: false,
      diagnosis: "missing_netlify_env",
      message: "Netlify Function cannot read OPENAI_API_KEY.",
      key: shape,
      latencyMs: Date.now() - startedAt
    };
  }

  if (!shape.startsWithSk) {
    return {
      ok: false,
      alive: false,
      diagnosis: "bad_key_format",
      message: "OPENAI_API_KEY exists, but it does not look like an OpenAI API key.",
      key: shape,
      latencyMs: Date.now() - startedAt
    };
  }

  try {
    const res = await fetch(`${OPENAI_BASE}/models`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${key}` }
    });
    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = { raw: text.slice(0, 500) }; }

    if (res.ok) {
      return {
        ok: true,
        alive: true,
        diagnosis: "openai_key_alive",
        message: "Netlify can read OPENAI_API_KEY and OpenAI accepts it.",
        openaiStatus: res.status,
        checkedEndpoint: "GET /v1/models",
        key: shape,
        latencyMs: Date.now() - startedAt
      };
    }

    const safe = safeOpenAiError(res.status, payload, text);
    return {
      ...safe,
      alive: false,
      key: shape,
      checkedEndpoint: "GET /v1/models",
      latencyMs: Date.now() - startedAt
    };
  } catch (err) {
    if (err && err.safe) {
      return { ...err.safe, alive: false, key: shape, latencyMs: Date.now() - startedAt };
    }
    return {
      ok: false,
      alive: false,
      diagnosis: "netlify_to_openai_network_error",
      message: "Netlify Function could not reach OpenAI API.",
      error: s(err && err.message || err).slice(0, 500),
      key: shape,
      latencyMs: Date.now() - startedAt
    };
  }
}

function decodeBody(event) {
  if (!event || !event.body) return Buffer.alloc(0);
  return event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body, "utf8");
}

function parseContentTypeHeader(value) {
  const raw = s(value);
  const parts = raw.split(";").map(x => x.trim()).filter(Boolean);
  const type = (parts.shift() || "").toLowerCase();
  const params = {};
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim().toLowerCase();
    let v = p.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    params[k] = v;
  }
  return { type, params };
}

function parseMultipart(event) {
  const headers = event.headers || {};
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  const { type, params } = parseContentTypeHeader(contentType);
  const boundary = params.boundary || "";
  if (!type.includes("multipart/form-data") || !boundary) throw new Error("Invalid multipart request: boundary is missing.");

  const body = decodeBody(event);
  if (body.length > MAX_MULTIPART_BYTES) {
    const err = new Error(`Uploaded audio chunk is too large. Limit is ${Math.round(MAX_MULTIPART_BYTES / 1024 / 1024)}MB.`);
    err.statusCode = 413;
    err.code = "upload_too_large";
    throw err;
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};

  let pos = 0;
  while (pos < body.length) {
    let start = body.indexOf(delimiter, pos);
    if (start < 0) break;
    start += delimiter.length;
    if (body.slice(start, start + 2).toString() === "--") break;
    if (body.slice(start, start + 2).toString() === "\r\n") start += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd < 0) break;
    const headerText = body.slice(start, headerEnd).toString("utf8");
    let dataStart = headerEnd + 4;
    let next = body.indexOf(delimiter, dataStart);
    if (next < 0) next = body.length;
    let dataEnd = next;
    if (body.slice(dataEnd - 2, dataEnd).toString() === "\r\n") dataEnd -= 2;

    const headersPart = {};
    for (const line of headerText.split(/\r\n/)) {
      const idx = line.indexOf(":");
      if (idx > -1) headersPart[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }

    const disp = headersPart["content-disposition"] || "";
    const nameMatch = disp.match(/name="([^"]+)"/i);
    const filenameMatch = disp.match(/filename="([^"]*)"/i);
    const name = nameMatch ? nameMatch[1] : "";
    const valueBuffer = body.slice(dataStart, dataEnd);

    if (name) {
      if (filenameMatch) {
        files[name] = {
          fieldName: name,
          filename: filenameMatch[1] || "audio.m4a",
          contentType: headersPart["content-type"] || "application/octet-stream",
          buffer: valueBuffer
        };
      } else {
        fields[name] = valueBuffer.toString("utf8");
      }
    }

    pos = next;
  }

  return { fields, files };
}

async function readJsonBody(event) {
  const raw = decodeBody(event).toString("utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch (_) {
    const err = new Error("Invalid JSON request body.");
    err.statusCode = 400;
    err.code = "bad_json";
    throw err;
  }
}

function normalizeLang(value) {
  const raw = s(value || "auto").trim().toLowerCase().replace("_", "-");
  if (!raw || raw === "auto") return "auto";
  if (["zh-hant", "zh-tw", "zh-hk", "zht"].includes(raw)) return "zh";
  return raw.split("-")[0] || "auto";
}

function normalizeSubtitleSegments(segments) {
  const rows = [];
  for (const item of Array.isArray(segments) ? segments : []) {
    const start = Math.max(0, Number(item.start || item.startSeconds || 0));
    let end = Number(item.end || item.endSeconds || start + 3);
    if (!Number.isFinite(end) || end <= start) end = start + 3;
    const text = s(item.text || item.transcript || item.caption).replace(/\s+/g, " ").trim();
    if (text) rows.push({ start, end, text });
  }
  return rows;
}

function fallbackSegmentsFromText(text, offsetSeconds) {
  const clean = s(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const pieces = clean
    .split(/(?<=[.!?。！？])\s+|(?<=[가-힣])\.\s+|\n+/)
    .map(x => x.trim())
    .filter(Boolean);
  const rows = [];
  let cursor = Number(offsetSeconds || 0);
  for (const piece of (pieces.length ? pieces : [clean])) {
    const dur = Math.max(2.5, Math.min(7.5, piece.length / 10));
    rows.push({ start: cursor, end: cursor + dur, text: piece });
    cursor += dur;
  }
  return rows;
}

async function translateSegments(segments, targetLanguage) {
  const target = normalizeLang(targetLanguage);
  if (!target || target === "auto" || !segments.length) return segments;
  const key = getOpenAiKey();

  const chunkSize = 40;
  const out = [];
  for (let i = 0; i < segments.length; i += chunkSize) {
    const chunk = segments.slice(i, i + chunkSize).map((seg, j) => ({ id: i + j, text: seg.text }));
    const payload = {
      model: DEFAULT_TRANSLATE_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You translate subtitle captions. Preserve names, numbers, punctuation, and approximate line lengths. Return JSON only in the form {\"items\":[{\"id\":0,\"text\":\"...\"}]}."
        },
        {
          role: "user",
          content: JSON.stringify({ targetLanguage: target, items: chunk })
        }
      ]
    };

    const data = await fetchJson(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let items = [];
    try {
      const content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
      const parsed = JSON.parse(content || "{}");
      items = Array.isArray(parsed.items) ? parsed.items : [];
    } catch (_) {
      items = [];
    }

    const map = new Map(items.map(x => [Number(x.id), s(x.text).trim()]));
    for (let j = 0; j < chunk.length; j++) {
      const source = segments[i + j];
      out.push({ ...source, text: map.get(i + j) || source.text });
    }
  }

  return normalizeSubtitleSegments(out);
}

async function transcribeAudioBuffer(file, fields) {
  const key = getOpenAiKey();
  if (!key) return { error: { statusCode: 500, body: { ok:false, diagnosis:"missing_netlify_env", message:"OPENAI_API_KEY is missing on Netlify." } } };

  const sourceLanguage = normalizeLang(fields.sourceLanguage || fields.language || "auto");
  const targetLanguage = normalizeLang(fields.targetLanguage || "auto");
  const offset = Number(fields.chunkOffset || fields.offset || 0) || 0;
  const model = s(fields.model || DEFAULT_TRANSCRIBE_MODEL).trim() || "whisper-1";

  const form = new FormData();
  const blob = new Blob([file.buffer], { type: file.contentType || "audio/mp4" });
  form.append("file", blob, file.filename || "audio.m4a");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (sourceLanguage && sourceLanguage !== "auto") form.append("language", sourceLanguage);

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}` },
    body: form
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 1000) }; }

  if (!res.ok) {
    const safe = safeOpenAiError(res.status, data, text);
    return { error: { statusCode: res.status, body: safe } };
  }

  let segments = normalizeSubtitleSegments(data.segments || []);
  if (!segments.length && data.text) segments = fallbackSegmentsFromText(data.text, 0);

  if (offset && segments.length) {
    segments = segments.map(x => ({ ...x, start: x.start + offset, end: x.end + offset }));
  }

  if (targetLanguage && targetLanguage !== "auto") {
    segments = await translateSegments(segments, targetLanguage);
  }

  return {
    ok: true,
    action: "generate-subtitle",
    provider: "openai",
    model,
    targetLanguage,
    sourceLanguage,
    chunkOffset: offset,
    text: segments.map(x => x.text).join("\n"),
    segments,
    count: segments.length
  };
}

function splitTtsScript(scriptText, maxLen) {
  const clean = s(scriptText)
    .replace(/\r/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*\d+\s*$/gm, " ")
    .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/g, " ")
    .replace(/WEBVTT|SYNC Start=\d+|&nbsp;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!clean) return [];
  const chunks = [];
  let buf = "";
  const sentences = clean.split(/(?<=[.!?。！？])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  for (const sentence of sentences.length ? sentences : [clean]) {
    if ((buf + " " + sentence).trim().length > maxLen && buf.trim()) {
      chunks.push(buf.trim());
      buf = sentence;
    } else {
      buf = (buf + " " + sentence).trim();
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

async function generateDubbing(body) {
  const key = getOpenAiKey();
  if (!key) return { error: { statusCode: 500, body: { ok:false, diagnosis:"missing_netlify_env", message:"OPENAI_API_KEY is missing on Netlify." } } };

  const scriptText = s(body.scriptText || body.text || body.subtitleText).trim();
  if (!scriptText) {
    return { error: { statusCode: 400, body: { ok:false, diagnosis:"missing_script", message:"AI 더빙용 대본 또는 자막 텍스트가 없습니다." } } };
  }

  if (scriptText.length > MAX_TTS_SCRIPT_CHARS) {
    return {
      error: {
        statusCode: 413,
        body: {
          ok: false,
          diagnosis: "script_too_large",
          message: `더빙 대본이 너무 깁니다. 현재 제한은 ${MAX_TTS_SCRIPT_CHARS}자입니다.`,
          scriptLength: scriptText.length
        }
      }
    };
  }

  const voice = s(body.voice || "alloy").trim() || "alloy";
  const model = s(body.model || DEFAULT_TTS_MODEL).trim() || "tts-1";
  const responseFormat = s(body.responseFormat || "mp3").trim().toLowerCase() || "mp3";
  const chunks = splitTtsScript(scriptText, 3600);
  if (!chunks.length) {
    return { error: { statusCode: 400, body: { ok:false, diagnosis:"empty_script", message:"더빙용 텍스트가 비어 있습니다." } } };
  }

  const buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    const payload = {
      model,
      voice,
      input: chunks[i],
      response_format: responseFormat
    };

    const audio = await fetchBinary(`${OPENAI_BASE}/audio/speech`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    buffers.push(audio);
  }

  const audio = Buffer.concat(buffers);
  return {
    ok: true,
    action: "generate-dubbing",
    provider: "openai",
    model,
    voice,
    responseFormat,
    chunkCount: chunks.length,
    audioBase64: audio.toString("base64"),
    bytes: audio.length
  };
}

async function handleStatus() {
  const health = await checkOpenAIKey();
  return json(health.ok ? 200 : (health.openaiStatus || 500), {
    service: "maru-ai-media",
    version: "v90-full-media-relay",
    time: new Date().toISOString(),
    ...health,
    actions: ["status", "generate-subtitle", "generate-dubbing"]
  });
}

async function handlePost(event) {
  const headers = event.headers || {};
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  const query = event.queryStringParameters || {};
  const parsedType = parseContentTypeHeader(contentType).type;

  if (parsedType.includes("multipart/form-data")) {
    const { fields, files } = parseMultipart(event);
    const action = s(query.action || fields.action || "generate-subtitle").trim();
    if (action === "status" || action === "health" || action === "test") return await handleStatus();
    if (action !== "generate-subtitle") {
      return json(400, { ok:false, diagnosis:"unsupported_multipart_action", message:"지원하지 않는 multipart AI 작업입니다.", action });
    }
    const file = files.file || files.audio || files.media;
    if (!file || !file.buffer || !file.buffer.length) {
      return json(400, { ok:false, diagnosis:"missing_audio_file", message:"자막 생성을 위한 오디오 파일이 전달되지 않았습니다." });
    }
    const result = await transcribeAudioBuffer(file, fields);
    if (result.error) return json(result.error.statusCode || 500, result.error.body);
    return json(200, {
      service: "maru-ai-media",
      version: "v90-full-media-relay",
      time: new Date().toISOString(),
      ...result
    });
  }

  const body = await readJsonBody(event);
  const action = s(query.action || body.action || "status").trim();

  if (action === "status" || action === "health" || action === "test") return await handleStatus();

  if (action === "generate-dubbing") {
    const result = await generateDubbing(body);
    if (result.error) return json(result.error.statusCode || 500, result.error.body);
    return json(200, {
      service: "maru-ai-media",
      version: "v90-full-media-relay",
      time: new Date().toISOString(),
      ...result
    });
  }

  if (action === "generate-subtitle") {
    return json(400, {
      ok: false,
      diagnosis: "missing_multipart_file",
      message: "자막 생성은 multipart/form-data 방식으로 오디오 파일이 함께 전송되어야 합니다."
    });
  }

  return json(400, {
    ok: false,
    diagnosis: "unsupported_action",
    message: "지원하지 않는 MARU AI 작업입니다.",
    action
  });
}

exports.handler = async function handler(event) {
  try {
    if (event && event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };

    const method = s(event && event.httpMethod || "GET").toUpperCase();
    const query = event && event.queryStringParameters || {};
    const action = s(query.action || query.fn || query.mode || "").trim();

    if (method === "GET") return await handleStatus();
    if (method === "POST") return await handlePost(event);

    return json(405, { ok:false, diagnosis:"method_not_allowed", message:"지원하지 않는 HTTP 메서드입니다.", method });
  } catch (err) {
    const statusCode = Number(err && err.statusCode) || Number(err && err.safe && err.safe.openaiStatus) || 500;
    if (err && err.safe) {
      return json(statusCode, {
        service: "maru-ai-media",
        version: "v90-full-media-relay",
        time: new Date().toISOString(),
        ...err.safe
      });
    }
    return json(statusCode, {
      ok: false,
      diagnosis: err && err.code ? err.code : "maru_ai_media_internal_error",
      message: s(err && err.message || err || "MARU AI media function internal error.").slice(0, 1000),
      service: "maru-ai-media",
      version: "v90-full-media-relay",
      time: new Date().toISOString()
    });
  }
};
