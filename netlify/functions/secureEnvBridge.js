import fs from "fs";
import path from "path";

export async function handler() {
  try {
    // JSON 파일 경로를 netlify/functions 내부에서 안전하게 탐색
    const filePath = path.join(process.cwd(), "netlify", "functions", "API 키.json");

    // JSON 파일 읽기
    let apiKeys = {};
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      apiKeys = JSON.parse(raw);
    }

    // 환경 변수와 JSON 병합
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || apiKeys.OPENAI_API_KEY || null;
    const SUPABASE_URL = process.env.SUPABASE_URL || apiKeys.SUPABASE_URL || null;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || apiKeys.SUPABASE_ANON_KEY || null;

    // 응답 JSON 구성
    const response = {
      status: "secureEnvBridge active",
      env: {
        OPENAI_API_KEY: OPENAI_API_KEY ? "✔ loaded (hidden)" : "✖ missing",
        SUPABASE_URL: SUPABASE_URL ? "✔ loaded (hidden)" : "✖ missing",
        SUPABASE_ANON_KEY: SUPABASE_ANON_KEY ? "✔ loaded (hidden)" : "✖ missing",
      },
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "secureEnvBridge failed",
        message: err.message,
      }),
    };
  }
}