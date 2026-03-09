
/*
 MARU Resilience Engine
 Handles failover and safe responses
*/

function guard(data){
  return data;
}

function fallback(error){
  return {
    message: "fallback activated",
    error: String(error)
  };
}

module.exports = {
  guard,
  fallback
};
