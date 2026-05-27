"use strict";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_SUBTITLE_MODEL || "gpt-4o-mini";

function headers(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...extra
  };
}

function json(statusCode, body) {
  return { statusCode, headers: headers(), body: JSON.stringify(body) };
}

function splitSubtitle(text, maxChars) {
  const lines = String(text || "").split(/\r?\n/);
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const line of lines) {
    const add = line.length + 1;
    if (cur.length && len + add > maxChars) {
      chunks.push(cur.join("\n"));
      cur = [];
      len = 0;
    }
    cur.push(line);
    len += add;
  }
  if (cur.length) chunks.push(cur.join("\n"));
  return chunks;
}

async function translateChunk(apiKey, chunk, targetLang, fileName, index, total) {
  const system = [
    "You are a subtitle translation engine.",
    "Translate only subtitle dialogue text to the requested target language.",
    "Preserve subtitle format exactly: numbering, timestamps, WEBVTT header, tags, line breaks, and blank lines.",
    "Do not add commentary, markdown, explanations, or code fences.",
    "If a line is only a number, timestamp, cue setting, tag, or empty, keep it unchanged."
  ].join(" ");

  const user = [
    `Target language code: ${targetLang}`,
    `File name: ${fileName || "subtitle"}`,
    `Chunk: ${index + 1}/${total}`,
    "Subtitle text:",
    chunk
  ].join("\n");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`openai ${res.status}: ${raw.slice(0, 300)}`);
  const data = JSON.parse(raw);
  return data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || "")
    : "";
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headers(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(500, { ok: false, error: "OPENAI_API_KEY_missing" });

    const body = JSON.parse(event.body || "{}");
    const subtitle = String(body.subtitle || "");
    const targetLang = String(body.targetLang || "ko").slice(0, 16);
    const fileName = String(body.fileName || "subtitle.srt").slice(0, 200);

    if (!subtitle.trim()) return json(400, { ok: false, error: "empty_subtitle" });
    if (subtitle.length > 180000) return json(413, { ok: false, error: "subtitle_too_large" });

    const chunks = splitSubtitle(subtitle, 9000);
    const translated = [];
    for (let i = 0; i < chunks.length; i++) {
      translated.push(await translateChunk(apiKey, chunks[i], targetLang, fileName, i, chunks.length));
    }

    return json(200, {
      ok: true,
      targetLang,
      translatedSubtitle: translated.join("\n")
    });
  } catch (err) {
    return json(500, { ok: false, error: "translate_failed", message: String(err && err.message || err) });
  }
};
