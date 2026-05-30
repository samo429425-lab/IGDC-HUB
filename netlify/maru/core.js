'use strict';

// Thin compatibility bridge for Netlify Functions.
// Existing functions call require("./core") from netlify/functions.
// The real shared MARU core lives at netlify/maru/core.js.
module.exports = require('../maru/core');
