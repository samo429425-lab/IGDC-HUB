// netlify/functions/update-pay-config.js
// PG approval-preparation safety gate.
//
// Netlify function files are deployed read-only. This endpoint intentionally does not
// claim to persist runtime payment settings. PG state is controlled only by protected
// environment variables and the approved provider bridge.

"use strict";

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return response(405, { ok: false, error: "method_not_allowed" });
  }

  return response(409, {
    ok: false,
    error: "runtime_payment_config_immutable",
    pgStatus: "pending_configuration",
    message: "결제 설정은 배포 환경변수와 승인된 PG 연결 경로에서만 변경됩니다."
  });
};
