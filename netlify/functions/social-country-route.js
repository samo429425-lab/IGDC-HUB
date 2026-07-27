"use strict";

/**
 * Public country/region catalog and edge-country resolver for Social Hub.
 * It returns only a country code resolved by the hosting edge. Raw IP
 * addresses are never read, stored, logged, or returned.
 */
const Routing = require("./lib/social-country-routing.v1");

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "access-control-allow-methods": "GET,OPTIONS",
    },
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  if (event && event.httpMethod === "OPTIONS") return response(204, {});
  if (!event || event.httpMethod !== "GET")
    return response(405, { ok: false, error: "method_not_allowed" });
  const query = event.queryStringParameters || {};
  if (String(query.catalog || "") === "1") {
    return response(200, {
      ok: true,
      version: Routing.VERSION,
      countryOnly: true,
      ipStorage: "none",
      regions: Routing.regionCatalog(),
      countries: Routing.catalog(),
    });
  }
  return response(
    200,
    Object.assign(
      {
        ok: true,
        ipStorage: "none",
        stateProvinceUsed: false,
      },
      Routing.resolve(event, query),
    ),
  );
};
