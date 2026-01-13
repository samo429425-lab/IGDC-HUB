const { nowIso, requestId } = require("../../src/core");

exports.handler = async (event) => {
  const rid = requestId();
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify({
      ok: true,
      meta: { version: "v1", ts: nowIso(), request_id: rid },
      status: "ready",
    }),
  };
};
