// Netlify Function: /netlify/functions/secureEnvBridge.js
exports.handler = async function(event, context) {
  function mask(val){
    if(!val) return "✖ missing";
    return "✔ loaded (" + (val.length>=8 ? val.slice(0,4)+"••••"+val.slice(-4) : "len:"+val.length) + ")";
  }
  const envs = {
    OPENAI_API_KEY: mask(process.env.OPENAI_API_KEY),
    SUPABASE_URL: mask(process.env.SUPABASE_URL),
    SUPABASE_ANON_KEY: mask(process.env.SUPABASE_ANON_KEY)
  };
  return {
    statusCode: 200,
    headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
    body: JSON.stringify({ status:"secureEnvBridge active", env: envs })
  };
};