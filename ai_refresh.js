const fs = require('fs');
const axios = require('axios');

(async () => {
  try {
    const response = await axios.get('https://example.com/api/data');
    fs.writeFileSync('data/thumbnails.json', JSON.stringify(response.data, null, 2));
    console.log('Thumbnails refreshed successfully.');
  } catch (error) {
    console.error('Error refreshing thumbnails:', error);
    process.exit(1);
  }
})();