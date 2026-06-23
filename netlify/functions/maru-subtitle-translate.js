"use strict";

const https = require("https");
const OPENAI_HOST = "api.openai.com";
const OPENAI_PATH = "/v1/chat/completions";
const MODEL = process.env.OPENAI_SUBTITLE_MODEL || "gpt-4o-mini";
const LANG_NAMES = {
  ko: "Korean", en: "English", zh: "Simplified Chinese", zht: "Traditional Chinese", ja: "Japanese",
  es: "Spanish", fr: "French", de: "German", ru: "Russian", pt: "Portuguese", it: "Italian",
  ar: "Arabic", vi: "Vietnamese", th: "Thai", id: "Indonesian", hi: "Hindi", tr: "Turkish",
  ta: "Tamil", sw: "Swahili", ur: "Urdu", bn: "Bengali", fa: "Persian", hu: "Hungarian",
  ms: "Malay", nl: "Dutch", pl: "Polish", sv: "Swedish", tl: "Filipino", uk: "Ukrainian", uz: "Uzbek"
};
function targetLanguageName(code, fallback) {
  const key = String(code || "").trim().toLowerCase();
  return String(fallback || LANG_NAMES[key] || key || "English");
}

function headers(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...extra
  };
}

function json(statusCode, body) {
  return { statusCode, headers: headers(), body: JSON.stringify(body) };
}

function postOpenAI(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(payload);
    const req = https.request({
      hostname: OPENAI_HOST,
      path: OPENAI_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(raw)
      },
      timeout: 120000
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`openai_${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("openai_invalid_json")); }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("openai_timeout"));
    });
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
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

async function translateChunk(apiKey, chunk, targetLang, targetName, fileName, index, total) {
  const system = [
    "You are a subtitle translation engine.",
    "Translate only subtitle dialogue text to the requested target language.",
    "The target language below is authoritative. Do not default to Korean unless Korean is explicitly selected.",
    "Preserve subtitle format exactly: numbering, timestamps, WEBVTT header, tags, line breaks, and blank lines.",
    "Do not add commentary, markdown, explanations, or code fences.",
    "If a line is only a number, timestamp, cue setting, tag, or empty, keep it unchanged.",
    "Before translating, use surrounding cues to decide whether a word is a person name, place, organization, work title, brand, code name, rank, or ordinary dialogue.",
    "When text functions as a person name or other proper noun, never translate its literal dictionary meaning. Preserve the original spelling/script unless the target language has a clearly established official or common rendering.",
    "Keep the same person name, nickname, title, rank, and organization spelling consistent across all cues in this request. When uncertain whether a word is a name, preserve the original form rather than inventing a literal translation.",
    "Do not confuse a person name with a common noun just because the spelling is also a normal word. Infer identity from who is addressed, introductions, titles, pronouns, scene continuity, and nearby cues."
  ].join(" ");

  const user = [
    `Target language: ${targetName} (${targetLang})`,
    `File name: ${fileName || "subtitle"}`,
    `Chunk: ${index + 1}/${total}`,
    "Subtitle text:",
    chunk
  ].join("\n");

  const data = await postOpenAI(apiKey, {
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  return data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || "")
    : "";
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headers(), body: "" };
  }

  if (event.httpMethod === "GET") {
    return json(200, {
      ok: true,
      service: "maru-subtitle-translate",
      version: "r6-proper-noun-context",
      configured: !!process.env.OPENAI_API_KEY,
      method: "POST_REQUIRED"
    });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(500, { ok: false, error: "OPENAI_API_KEY_missing" });

    const body = JSON.parse(event.body || "{}");
    const subtitle = String(body.subtitle || "");
    const targetLang = String(body.targetLang || "en").slice(0, 16);
    const targetName = targetLanguageName(targetLang, body.targetName).slice(0, 80);
    const fileName = String(body.fileName || "subtitle.srt").slice(0, 200);

    if (!subtitle.trim()) return json(400, { ok: false, error: "empty_subtitle" });
    const chunks = splitSubtitle(subtitle, 9000);
    const translated = [];
    for (let i = 0; i < chunks.length; i++) {
      translated.push(await translateChunk(apiKey, chunks[i], targetLang, targetName, fileName, i, chunks.length));
    }

    return json(200, {
      ok: true,
      targetLang,
      targetName,
      translatedSubtitle: translated.join("\n")
    });
  } catch (err) {
    const message = String(err && err.message || err).slice(0, 500);
    return json(500, { ok: false, error: "translate_failed", message });
  }
};
