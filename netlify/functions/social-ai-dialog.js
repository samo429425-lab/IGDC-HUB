"use strict";

/**
 * Social admin policy conversation endpoint.
 * Conversation/policy only. It never publishes, writes SearchBank, Snapshot,
 * Distribution, rightPanel, or any public front data.
 */
const SharedAdminAuth = require("./lib/global-slot-console-auth");
const SocialStore = require("./lib/social-candidate-store.v1");
const RuntimePolicy = require("./lib/social-ai-policy-runtime.v1");

const VERSION = "social-ai-dialog-v1.0.0-policy-only";
function text(v) { return v == null ? "" : String(v).trim(); }
async function actorFor(event) {
  const actor = await SharedAdminAuth.resolveUser(event);
  const member = {
    memberId: text(actor && (actor.memberId || actor.sub)),
    email: text(actor && actor.email),
    roles: Array.isArray(actor && actor.roles) ? actor.roles : [],
  };
  SocialStore.requireRole(member, "write");
  return member;
}
function localDraft(message, scopeType, sectionKey) {
  const m = text(message);
  const include = [], exclude = [];
  const pairs = [
    [/여행|관광|travel|tour/i, "travel"], [/음악|공연|music|performance/i, "music"],
    [/교육|학습|education|learning/i, "education"], [/예술|미술|art|design/i, "art"],
    [/기술|테크|technology|tech/i, "technology"], [/라이프스타일|lifestyle/i, "lifestyle"],
  ];
  pairs.forEach(([rx, term]) => { if (rx.test(m)) include.push(term); });
  const excludes = [
    [/정치|politic/i, "politics"], [/성인|음란|explicit|adult/i, "explicit"],
    [/도박|gambl/i, "gambling"], [/과도한 광고|스팸|spam/i, "spam"],
  ];
  excludes.forEach(([rx, term]) => { if (rx.test(m)) exclude.push(term); });
  return RuntimePolicy.normalize({
    scopeType, sectionKey, instructions: m, includeTopics: include, excludeTopics: exclude,
    requireThumbnail: true, replaceDeadUrls: true,
  });
}
function extractOutputText(data) {
  if (text(data && data.output_text)) return text(data.output_text);
  const out = Array.isArray(data && data.output) ? data.output : [];
  const chunks = [];
  out.forEach((item) => (Array.isArray(item && item.content) ? item.content : []).forEach((c) => {
    if (text(c && c.text)) chunks.push(text(c.text));
  }));
  return chunks.join("\n").trim();
}
function parseJsonReply(raw) {
  const t = text(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(t); } catch (_e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_e) {} }
  return null;
}
async function askConfiguredAI(body) {
  const key = text(process.env.SOCIAL_AI_API_KEY || process.env.OPENAI_API_KEY);
  const endpoint = text(process.env.SOCIAL_AI_API_URL) || "https://api.openai.com/v1/responses";
  const model = text(process.env.SOCIAL_AI_MODEL || process.env.OPENAI_MODEL) || "gpt-4.1-mini";
  if (!key) return null;
  const history = (Array.isArray(body.history) ? body.history : []).slice(-12).map((x) => ({
    role: text(x && x.role) === "assistant" ? "assistant" : "user",
    text: text(x && x.text).slice(0, 4000),
  }));
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const system = [
    "You are the IGDC Social operations policy assistant.",
    "Return JSON only with keys reply and policy.",
    "policy keys: scopeType, sectionKey, instructions, includeTopics, excludeTopics, preferredCreatorTraits, blockedCreatorTraits, freshnessDays, requireThumbnail, replaceDeadUrls, minSafetyScore, minTrustScore, notes.",
    "Never propose direct writes to SearchBank, Snapshot, Distribution, rightPanel, or front pages. The policy only guides Social candidate collection and curation before the existing SearchBank pipeline.",
    "Keep safety/quality requirements conservative and preserve administrator approval boundaries.",
  ].join(" ");
  const prompt = system + "\nSCOPE=" + text(body.scopeType || "global") + " SECTION=" + text(body.sectionKey) +
    "\nCURRENT_CONTEXT=" + JSON.stringify(context).slice(0, 12000) +
    "\nHISTORY=" + JSON.stringify(history).slice(0, 12000) +
    "\nUSER=" + text(body.message).slice(0, 6000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model, input: prompt }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(text(data && data.error && data.error.message) || "AI provider HTTP " + res.status);
      e.statusCode = 502; e.code = "social_ai_provider_failed"; throw e;
    }
    const raw = extractOutputText(data);
    const parsed = parseJsonReply(raw);
    if (!parsed) return { reply: raw || "정책 초안을 만들었습니다.", policy: null, provider: "configured_ai" };
    return {
      reply: text(parsed.reply) || "정책 초안을 만들었습니다.",
      policy: RuntimePolicy.normalize(Object.assign({}, parsed.policy || {}, {
        scopeType: body.scopeType || (parsed.policy && parsed.policy.scopeType),
        sectionKey: body.sectionKey || (parsed.policy && parsed.policy.sectionKey),
      })),
      provider: "configured_ai",
      model,
    };
  } finally { clearTimeout(timer); }
}

exports.handler = async function(event) {
  if (event && event.httpMethod === "OPTIONS") return SocialStore.response(204, {});
  try {
    if (!event || event.httpMethod !== "POST") return SocialStore.response(405, { ok:false, version:VERSION, error:"method_not_allowed" });
    const actor = await actorFor(event);
    const body = SocialStore.parseBody(event);
    const message = text(body.message);
    if (!message) return SocialStore.response(400, { ok:false, version:VERSION, error:"message_required" });
    const sectionKey = RuntimePolicy.SECTION_KEYS.has(text(body.sectionKey)) ? text(body.sectionKey) : "";
    const scopeType = /^(global|section|collector|content|influencer)$/.test(text(body.scopeType).toLowerCase()) ? text(body.scopeType).toLowerCase() : "global";
    let ai = null;
    try { ai = await askConfiguredAI(Object.assign({}, body, { sectionKey, scopeType })); }
    catch (e) {
      return SocialStore.response(e.statusCode || 502, { ok:false, version:VERSION, error:e.code || "social_ai_failed", message:e.message || String(e) });
    }
    if (!ai) {
      const policy = localDraft(message, scopeType, sectionKey);
      return SocialStore.response(200, {
        ok:true, version:VERSION, provider:"local_policy_parser", model:null,
        reply:"현재 AI API 키가 연결되지 않아 요청 문장을 안전한 로컬 정책 초안으로 정리했습니다. API 연결 후에는 같은 창에서 대화형 분석을 사용할 수 있습니다.",
        policyDraft:policy,
        actor:{ email:actor.email || null, memberId:actor.memberId || null },
      });
    }
    return SocialStore.response(200, {
      ok:true, version:VERSION, provider:ai.provider, model:ai.model || null,
      reply:ai.reply, policyDraft:ai.policy || localDraft(message, scopeType, sectionKey),
      actor:{ email:actor.email || null, memberId:actor.memberId || null },
    });
  } catch (error) {
    return SocialStore.response(error.statusCode || 500, { ok:false, version:VERSION, error:error.code || "social_ai_dialog_failed", message:error.message || String(error) });
  }
};
