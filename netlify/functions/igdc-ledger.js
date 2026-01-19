/**
 * IGDC Ledger – Minimal Working Netlify Function
 * Purpose:
 *  - Acts as backend endpoint for admin refresh()
 *  - Loads unified wallet registry
 *  - Returns structured JSON (ready for future blockchain ingestion)
 *
 * Path:
 *   /netlify/functions/igdc-ledger.js
 */

const path = require('path');

exports.handler = async function (event, context) {
  try {
    // Load unified wallet registry (single source of truth)
    const registry = require('./data/igdc-wallet-registry.js');

    const wallets = registry.all();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        wallets: wallets
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        error: e.message || 'ledger init failed'
      })
    };
  }
};
