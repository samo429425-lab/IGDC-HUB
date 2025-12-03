// /.netlify/functions/ai-diagnose
// IGDC Admin 우측 패널에서 사용하는 OpenAI 기반 자동 진단 엔드포인트
// - /api/selfcheck 결과를 가져와서
// - OpenAI Chat Completions API로 요약/분석 요청 후
// - 관리자 패널에 붙여 넣기 좋은 한국어 요약을 반환합니다.

exports.handler = async function(event, context){
  try{
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
    const origin = base.replace(/\/+$/, "");

    // 1) selfcheck 결과 가져오기
    const selfcheckRes = await fetch(origin + "/api/selfcheck");
    let selfcheckJson = null;
    try{
      selfcheckJson = await selfcheckRes.json();
    }catch(e){
      selfcheckJson = { parseError: String(e) };
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.IGDC_OPENAI_KEY;
    if(!apiKey){
      return {
        statusCode: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: "OPENAI_API_KEY (또는 IGDC_OPENAI_KEY) 환경변수가 설정되어 있지 않습니다.",
        }),
      };
    }

    const systemPrompt = [
      "당신은 Netlify + 정적 HTML + JS로 구성된 IGDC 사이트의 관리자용 진단 도우미입니다.",
      "입력으로 /api/selfcheck JSON 결과를 받습니다.",
      "다음 형식으로 한국어로 짧고 구조화된 리포트를 작성하세요:",
      "",
      "1) 전체 요약 (1~2줄)",
      "2) API / Functions 상태 (OK / 경고 / 오류, 각각 한 줄씩)",
      "3) 권장 조치 (번호 매겨서 3~5개)",
      "",
      "코드는 길게 출력하지 말고, 무엇을 확인해야 하는지 위주로 알려주세요."
    ].join("\n");

    const userPrompt = [
      "[SELF CHECK JSON]",
      JSON.stringify(selfcheckJson, null, 2)
    ].join("\n\n");

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": "Bearer " + apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 800
      })
    });

    if(!openaiRes.ok){
      const text = await openaiRes.text();
      return {
        statusCode: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          error: "OpenAI API 호출 실패",
          status: openaiRes.status,
          body: text
        }),
      };
    }

    const openaiJson = await openaiRes.json();
    const summary = openaiJson &&
                    openaiJson.choices &&
                    openaiJson.choices[0] &&
                    openaiJson.choices[0].message &&
                    openaiJson.choices[0].message.content
                      ? openaiJson.choices[0].message.content
                      : "AI 응답을 찾을 수 없습니다.";

    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        endpoint: "/api/ai-diagnose",
        summary,
        raw: selfcheckJson
      }),
    };
  }catch(e){
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "ai-diagnose 함수 내부 오류",
        message: e && e.message ? e.message : String(e)
      }),
    };
  }
};
