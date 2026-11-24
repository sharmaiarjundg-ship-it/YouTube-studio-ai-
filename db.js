const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

async function getSetting(key, fallback = null) {
  return fallback;
}

async function setSetting(key, value) {
  return;
}

module.exports = {
  db: {},
  getSetting,
  setSetting
};

