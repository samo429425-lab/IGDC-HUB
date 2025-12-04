// netlify/functions/ai-diagnose.js


exports.handler = async function () {
try {
const openaiKey = process.env.OPENAI_API_KEY || process.env.IGDC_OPENAI_KEY;


if (!openaiKey) {
return {
statusCode: 500,
headers: { "content-type": "application/json; charset=utf-8" },
body: JSON.stringify({
error: "OPENAI_API_KEY (또는 IGDC_OPENAI_KEY) 환경변수가 설정되어 있지 않습니다.",
}),
};
}


// 간단한 자기 진단용 데이터 (selfcheck 제거 버전)
const selfcheckJson = {
ok: true,
note: "Selfcheck 기능은 비활성화되어 있습니다.",
ts: new Date().toISOString(),
};


// AI 환경 진단 요약
const summary = {
endpoint: "/api/ai-diagnose",
status: "정상 작동 중",
env: {
OPENAI_API_KEY: !!openaiKey,
NODE_VERSION: process.version,
},
selfcheck: selfcheckJson,
};


return {
statusCode: 200,
headers: { "content-type": "application/json; charset=utf-8" },
body: JSON.stringify(summary, null, 2),
};
} catch (error) {
return {
statusCode: 500,
headers: { "content-type": "application/json; charset=utf-8" },
body: JSON.stringify({ error: String(error) }),
};
}
};