
// /.netlify/functions/ig-oembed (compat)
// Delegate to /oembed for unified handling.
exports.handler = async (event, ctx) => {
  const { handler } = require('./oembed.js');
  return handler(event, ctx);
};
