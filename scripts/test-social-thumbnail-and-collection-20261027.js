"use strict";
// Offline regression suite. Never calls external providers or mutates real data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const Preview = require("../netlify/functions/social-preview-metadata.js");
const Proxy = require("../netlify/functions/social-thumbnail-proxy.js");
const Collector = require("../netlify/functions/sanmaru-social-live-collector.js");
const Store = require("../netlify/functions/lib/social-candidate-store.v1.js");
const BAD_TIKTOK = "https://sf-i18n-resources.tiktokcdn-us.com/obj/tiktok-webarch-solution-i18n-tx";
const BAD_FACEBOOK = "https://static.xx.fbcdn.net/rsrc.php/v4/yd/r/3mD7kKai_7W.gif";
const GOOD_TIKTOK = "https://p16-sign.tiktokcdn-us.com/obj/tos-useast5-sample/real-image.jpeg";
const CONTENT = "https://www.tiktok.com/@allrecipes/video/7696909550988872973";

async function main() {
  // The actual 2026-10-26 release had 67 identical UI thumbnails in 68 slots.
  assert.equal(Preview.previewImageUrl("tiktok", BAD_TIKTOK), "");
  assert.equal(Preview.previewImageUrl("tiktok", "https://commons.wikimedia.org/wiki/Special:FilePath/Peggy.jpg"), "");
  assert.equal(Preview.previewImageUrl("facebook", BAD_FACEBOOK), "");
  assert.equal(Preview.previewImageUrl("tiktok", GOOD_TIKTOK), GOOD_TIKTOK);
  assert.equal(Collector.__test.usableThumbnail(BAD_TIKTOK, CONTENT, "tiktok"), "");
  assert.equal(Collector.__test.usableThumbnail(GOOD_TIKTOK, CONTENT, "tiktok"), GOOD_TIKTOK);
  assert.equal(Store.providerBrandThumbnail("tiktok", BAD_TIKTOK), true);
  assert.equal(Store.providerBrandThumbnail("tiktok", GOOD_TIKTOK), false);
  assert.equal(Store.publishableThumbnail({
    section_key:"social-tiktok", platform:"tiktok", thumbnail_url:BAD_TIKTOK,
    source_url:CONTENT, raw:{latestContentUrl:CONTENT}
  }), "");
  const preview = Store.publishableThumbnail({
    section_key:"social-tiktok", platform:"tiktok", thumbnail_url:GOOD_TIKTOK,
    source_url:CONTENT, raw:{latestContentUrl:CONTENT}
  });
  assert.equal(preview, GOOD_TIKTOK);

  // The frontend must always invoke recovery for a real post even when its
  // stored thumbnail is missing/poisoned (lazy images retain front performance).
  const front = fs.readFileSync(path.join(root,"assets/js/socialnetwork-automap-v3.js"),"utf8");
  assert.match(front, /var proxied = thumbnailRenderUrl\(platform, contentUrl, safeThumb\)/);
  assert.match(front, /thumb: isProviderUiThumbnail\(platform, thumb\) \? ""/);
  assert.match(front, /img\.src = proxied/);
  for (const lang of ["en", "ar", "zh", "fr", "ja"]) {
    const html = fs.readFileSync(path.join(root,lang,"socialnetwork_"+lang+".html"),"utf8");
    assert.ok(html.includes("/assets/js/socialnetwork-automap-v3.js"),lang+" shares the front renderer");
  }

  // Fully mocked service call. Verifies old poisoned stored thumb -> real
  // provider oEmbed cover -> image byte relay with no false success.
  const savedFetch = global.fetch;
  const calls=[];
  try {
    global.fetch = async (url, init) => {
      calls.push({url:String(url),redirect:init&&init.redirect});
      if(String(url).startsWith("https://www.tiktok.com/oembed?")) {
        return new Response(JSON.stringify({thumbnail_url:GOOD_TIKTOK}),{
          status:200,headers:{"content-type":"application/json"}
        });
      }
      if(String(url)===GOOD_TIKTOK) {
        assert.equal(init.redirect,"manual");
        return new Response(Buffer.from([255,216,255,217]),{
          status:200,headers:{"content-type":"image/jpeg"}
        });
      }
      throw Error("Unexpected outbound: "+url);
    };
    const result=await Proxy.handler({
      httpMethod:"GET",queryStringParameters:{platform:"tiktok",url:CONTENT,thumb:BAD_TIKTOK}
    });
    assert.equal(result.statusCode,200,"recover from exact content URL after rejecting bad thumb");
    assert.equal(result.headers["content-type"],"image/jpeg");
    assert.equal(result.isBase64Encoded,true);
    assert.equal(Buffer.from(result.body,"base64").length,4);
    assert.equal(calls.length,2);

    // Redirect guard: do not request unvalidated hosts, even after initial URL.
    calls.length=0;
    global.fetch = async (url, init) => {
      calls.push(String(url));
      if(String(url)===GOOD_TIKTOK) {
        return new Response(null,{status:302,headers:{location:"https://untrusted.invalid/private"}});
      }
      throw Error("Unsafe redirect followed");
    };
    const blocked=await Proxy.handler({
      httpMethod:"GET",queryStringParameters:{platform:"tiktok",url:"",thumb:GOOD_TIKTOK}
    });
    assert.equal(blocked.statusCode,404);
    assert.deepEqual(calls,[GOOD_TIKTOK]);
  } finally { global.fetch=savedFetch; }
  console.log("PASS: 15 checks — invalid media blocked; valid cover retained; front recovery; all locales; mocked oEmbed relay; unsafe redirect blocked");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
