'use strict';

// Compatibility bridge: Netlify Functions can require('./core'),
// while the shared MARU core lives under netlify/maru/core.js.
module.exports = require('../maru/core');
