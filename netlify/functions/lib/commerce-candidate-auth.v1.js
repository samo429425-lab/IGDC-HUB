"use strict";

/*
 * Candidate-queue administrator authentication.
 *
 * The site already has one common administrator session contract. Candidate
 * collectors must inherit that signed ID token, issuer, audience and role set
 * instead of creating a second login path or interpreting a management API
 * domain as the browser token issuer.
 */
const CommonAdminAuth = require("./global-slot-console-auth");

const VERSION =
  "commerce-candidate-auth-v1.1.0-common-admin-session-inheritance";

async function authenticateCommerceAdmin(event) {
  const actor = await CommonAdminAuth.resolveUser(event);
  return {
    sub: actor.sub || actor.memberId,
    memberId: actor.memberId || actor.sub,
    email: actor.email || "",
    name: actor.name || "",
    roles: Array.isArray(actor.roles) ? actor.roles.slice() : [],
    role: actor.role || "guest",
    tokenAudience: actor.tokenAudience || null,
    issuer: actor.issuer || null,
  };
}

function config() {
  return CommonAdminAuth.config();
}

module.exports = { VERSION, authenticateCommerceAdmin, config };
