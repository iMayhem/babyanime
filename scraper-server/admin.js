const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'scraper-config.json');

const DEFAULT_PROVIDERS = [
  'Naruto',
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
  const scrapers = getScrapers();
  const target = scrapers.find(s => s.name === name);
  if (!target) return scrapers;

  target.enabled = !target.enabled;
  config.scrapers = scrapers;
  saveConfig(config);
  return scrapers;
}

function reorderScrapers(newOrderNames) {
  const config = loadConfig();
  const current = getScrapers();

  const reordered = newOrderNames.map((name, i) => {
    const item = current.find(s => s.name === name);
    return {
      name,
      enabled: item ? item.enabled : true,
      order: i,
    };
  });

  config.scrapers = reordered;
  saveConfig(config);
  return reordered;
}

function getEnabledProviders() {
  return getScrapers().filter(s => s.enabled).map(s => s.name);
}

module.exports = {
  getScrapers,
  toggleScraper,
  reorderScrapers,
  getEnabledProviders,
};
