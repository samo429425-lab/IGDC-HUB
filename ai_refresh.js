const fs = require('fs');
const path = require('path');

const sourcesPath = path.join(__dirname, '..', 'data', 'sources.json');

function refreshThumbnails() {
  const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
  sources.lastRefresh = new Date().toISOString();
  fs.writeFileSync(sourcesPath, JSON.stringify(sources, null, 2));
  console.log("Sources refreshed:", sources.lastRefresh);
}

refreshThumbnails();
