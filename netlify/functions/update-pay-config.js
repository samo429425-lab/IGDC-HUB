// netlify/functions/update-pay-config.js
// Admin-only config updater (toggle controller)

const fs = require("fs");
const path = require("path");

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON" })
      };
    }

    // Allow only expected fields
    const incoming = {
      enabled: !!body.enabled,
      features: {
        commerce: !!body.features?.commerce,
        donation: !!body.features?.donation,
        affiliate: !!body.features?.affiliate
      }
    };

    const configPath = path.join(__dirname, "data", "pay-config.js");

    let current = {};
    try {
      delete require.cache[require.resolve("./data/pay-config.js")];
      current = require("./data/pay-config.js");
    } catch (e) {
      current = {};
    }

    const updated = {
      ...current,
      ...incoming,
      features: {
        ...(current.features || {}),
        ...(incoming.features || {})
      }
    };

    const fileContent = `module.exports = ${JSON.stringify(updated, null, 2)};
`;

    fs.writeFileSync(configPath, fileContent, "utf8");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, updated })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "update-failed",
        message: err.message
      })
    };
  }
};
