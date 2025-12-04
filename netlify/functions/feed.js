import fs from "fs";
import path from "path";

export async function handler() {
  let apiKeys = {};
  try {
    const filePath = path.resolve("netlify/functions/api-key.json");
    const rawData = fs.readFileSync(filePath, "utf-8");
    apiKeys = JSON.parse(rawData);
  } catch (err) {
    console.error("api-key.json read error:", err);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || apiKeys.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || apiKeys.SUPABASE_ANON_KEY;

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: "feed active",
      source: SUPABASE_URL ? "✔ Supabase connected" : "✖ missing Supabase URL",
      anon: SUPABASE_ANON_KEY ? "✔ key loaded" : "✖ missing anon key",
    }),
  };
}
