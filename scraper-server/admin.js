const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'scraper-config.json');

const DEFAULT_PROVIDERS = [
  'AllAnime', 'AniDB', 'AnikoTV', 'AnimeSama', 'AnimeKai',
  'AnimePahe', 'AnimeSalt', 'Animetsu', 'AnimeWorld', 'KissKH',
];

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('[Admin] Config read error, using defaults:', e.message);
  }
  return { scrapers: [] };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getScrapers() {
  const config = loadConfig();
  const configured = config.scrapers;

  return DEFAULT_PROVIDERS.map((name, i) => {
    const existing = configured.find(s => s.name === name);
    return {
      name,
      enabled: existing ? existing.enabled : true,
      order: existing ? existing.order : i,
    };
  }).sort((a, b) => a.order - b.order);
}

function toggleScraper(name) {
  const config = loadConfig();
  const idx = config.scrapers.findIndex(s => s.name === name);
  if (idx >= 0) {
    config.scrapers[idx].enabled = !config.scrapers[idx].enabled;
  } else {
    const order = DEFAULT_PROVIDERS.indexOf(name);
    if (order === -1) return null;
    config.scrapers.push({ name, enabled: false, order });
  }
  saveConfig(config);
  return getScrapers().find(s => s.name === name);
}

function reorderScrapers(names) {
  const config = loadConfig();
  config.scrapers = names.map((name, i) => {
    const existing = config.scrapers.find(s => s.name === name);
    return {
      name,
      enabled: existing ? existing.enabled : true,
      order: i,
    };
  });
  saveConfig(config);
  return getScrapers();
}

function getEnabledProviders() {
  return getScrapers().filter(s => s.enabled).map(s => s.name);
}

module.exports = { getScrapers, toggleScraper, reorderScrapers, getEnabledProviders };
