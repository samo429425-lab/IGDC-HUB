"use strict";

const assert = require("assert");
const Preview = require("../netlify/functions/social-preview-metadata");

const T = Preview.__test;

assert.strictEqual(
  T.usableThumbnail("instagram", "https://static.cdninstagram.com/rsrc.php/yn/r/R5c1GwJk_n2.webp"),
  "",
  "Instagram static UI assets must never be accepted as post thumbnails",
);
assert.strictEqual(
  T.usableThumbnail("instagram", "https://static.cdninstagram.com/rsrc.php/v4/y5/r/SdKHQSWKnWY.js"),
  "",
  "JavaScript resources must never be accepted as thumbnails",
);
assert.strictEqual(
  T.usableThumbnail("instagram", "https://scontent.cdninstagram.com/v/t51.29350-15/example.jpg?x=1"),
  "https://scontent.cdninstagram.com/v/t51.29350-15/example.jpg?x=1",
  "Instagram post media CDN images must remain eligible",
);
assert.strictEqual(
  T.instagramMediaFallback("https://www.instagram.com/reel/DNHk7fHJ5Ab/"),
  "https://www.instagram.com/p/DNHk7fHJ5Ab/media/?size=l",
  "Instagram reels need a provider-owned media fallback",
);

const html = [
  '<html><head>',
  '<meta property="og:image" content="https://static.cdninstagram.com/rsrc.php/yn/r/R5c1GwJk_n2.webp">',
  '</head><body>',
  '<img src="https://scontent.cdninstagram.com/v/t51.29350-15/real-post.jpg?x=1">',
  '</body></html>'
].join("");
assert.strictEqual(
  T.htmlImage(html, "instagram"),
  "https://scontent.cdninstagram.com/v/t51.29350-15/real-post.jpg?x=1",
  "Resolver must skip provider chrome and continue searching for real media",
);

console.log("social-preview-metadata safety tests passed");
