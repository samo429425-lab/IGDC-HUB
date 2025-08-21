const fs = require("fs");
const axios = require("axios");

// 예시: AI API 호출해서 썸네일 데이터 생성
async function refreshThumbnails() {
  const sources = JSON.parse(fs.readFileSync("data/sources.json", "utf-8"));
  const results = [];

  for (let src of sources) {
    try {
      // 여기서 AI API 호출 (예: 썸네일 생성 API)
      const thumbUrl = `https://dummyimage.com/600x400/000/fff&text=${encodeURIComponent(src.title)}`;
      results.push({ title: src.title, url: thumbUrl });
    } catch (err) {
      console.error("Error generating thumbnail:", err);
    }
  }

  fs.writeFileSync("data/thumbnails.json", JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} thumbnails to data/thumbnails.json`);
}

refreshThumbnails();
