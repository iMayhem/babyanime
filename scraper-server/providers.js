const path = require("path");
const admin = require("./admin");

const PROVIDERS = [
  { name: "Eren", file: "eren.js" },
  { name: "Luffy", file: "animesdigital.js" },
  { name: "Naruto", file: "allwish.js" },
  { name: "Goku", file: "animekai.js" },
];

let loadedProviders = [];

function loadProviders() {
  const enabled = admin.getEnabledProviders();
  const sorted = PROVIDERS.slice().sort((a, b) => {
    const orderA = enabled.indexOf(a.name);
    const orderB = enabled.indexOf(b.name);
    return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
  });

  loadedProviders = sorted.map((p) => {
    if (!enabled.includes(p.name)) {
      console.log(`[Providers] ${p.name} disabled by admin, skipping`);
      return null;
    }
    try {
      const mod = require(path.join(__dirname, "api", p.file));
      if (typeof mod.getStreams !== "function") {
        console.warn(`[Providers] ${p.name} has no getStreams, skipping`);
        return null;
      }
      console.log(`[Providers] Loaded ${p.name}`);
      return { name: p.name, getStreams: mod.getStreams };
    } catch (err) {
      console.warn(`[Providers] Failed to load ${p.name}: ${err.message}`);
      return null;
    }
  }).filter(Boolean);
  console.log(`[Providers] ${loadedProviders.length}/${enabled.length} providers loaded`);
}

async function runAll(resolved, audio = "sub", onEvent = null) {
  const { tmdbId, anilistId, type, season, episode } = resolved;
  const results = [];

  const tasks = loadedProviders.map(async (provider) => {
    try {
      let id = tmdbId;
      if (!id) {
        if (onEvent) onEvent({ type: "provider_skip", provider: provider.name, reason: "no id", timestamp: Date.now() });
        return;
      }

      if (onEvent) onEvent({ type: "provider_start", provider: provider.name, timestamp: Date.now() });

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 30000)
      );

      const streams = await Promise.race([
        provider.getStreams(id, type, season, episode),
        timeout,
      ]);

      if (!Array.isArray(streams) || streams.length === 0) {
        if (onEvent) onEvent({ type: "provider_done", provider: provider.name, sourceCount: 0, timestamp: Date.now() });
        return;
      }

      let count = 0;
      for (const s of streams) {
        if (!s || !s.url) continue;
        results.push({
          provider: provider.name,
          name: s.name || s.title || `${provider.name}`,
          url: s.url,
          quality: s.quality || "Auto",
          format: s.url.includes(".m3u8") ? "hls" : "mp4",
          headers: s.headers || {},
          subtitles: s.subtitles || [],
        });
        count++;
      }

      if (onEvent) onEvent({ type: "provider_done", provider: provider.name, sourceCount: count, timestamp: Date.now() });
    } catch (err) {
      const msg = err.message !== "timeout" ? err.message : "timeout";
      if (err.message !== "timeout") {
        console.warn(`[${provider.name}] Error: ${err.message}`);
      }
      if (onEvent) onEvent({ type: "provider_error", provider: provider.name, error: msg, timestamp: Date.now() });
    }
  });

  await Promise.allSettled(tasks);

  results.sort((a, b) => {
    const q = { "4K": 6, "2160p": 6, "1080p": 5, "720p": 4, "480p": 3, "360p": 2, Auto: 1 };
    return (q[b.quality] || 0) - (q[a.quality] || 0);
  });

  return results;
}

async function runProvider(providerName, resolved, audio = "sub") {
  const provider = loadedProviders.find(
    (p) => p.name.toLowerCase() === providerName.toLowerCase()
  );
  if (!provider) throw new Error(`Provider "${providerName}" not found`);

  const { tmdbId, anilistId, type, season, episode } = resolved;
  let id = tmdbId;
  if (!id) return [];

  const streams = await provider.getStreams(id, type, season, episode);
  if (!Array.isArray(streams)) return [];

  return streams.map((s) => ({
    provider: provider.name,
    name: s.name || s.title || `${provider.name}`,
    url: s.url,
    quality: s.quality || "Auto",
    format: s.url && s.url.includes(".m3u8") ? "hls" : "mp4",
    headers: s.headers || {},
    subtitles: s.subtitles || [],
  }));
}

function listProviders() {
  return loadedProviders.map((p) => p.name);
}

module.exports = { loadProviders, runAll, runProvider, listProviders };
