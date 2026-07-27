const path = require("path");

const PROVIDERS = [
  { name: "AllAnime", file: "allanime.js" },
  { name: "AniDB", file: "anidb.js" },
  { name: "AnikoTV", file: "anikototv.js" },
  { name: "AnimeSama", file: "anime-sama.js" },
  { name: "AnimeKai", file: "animekai.js" },
  { name: "AnimePahe", file: "animepahe.js" },
  { name: "AnimeSalt", file: "animesalt.js" },
  { name: "Animetsu", file: "animetsu.js" },
  { name: "AnimeWorld", file: "animeworld.js" },
  { name: "KissKH", file: "kisskh.js" },
];

let loadedProviders = [];

function loadProviders() {
  loadedProviders = PROVIDERS.map((p) => {
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
  console.log(`[Providers] ${loadedProviders.length}/${PROVIDERS.length} providers loaded`);
}

async function runAll(resolved, audio = "sub") {
  const { tmdbId, anilistId, type, season, episode } = resolved;
  const results = [];

  const tasks = loadedProviders.map(async (provider) => {
    try {
      let id = tmdbId;
      if (provider.name === "AnimeKai" && anilistId) {
        id = `anilist:${anilistId}`;
      }
      if (!id) return;

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 30000)
      );

      const streams = await Promise.race([
        provider.getStreams(id, type, season, episode),
        timeout,
      ]);

      if (!Array.isArray(streams) || streams.length === 0) return;

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
      }
    } catch (err) {
      if (err.message !== "timeout") {
        console.warn(`[${provider.name}] Error: ${err.message}`);
      }
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
  if (provider.name === "AnimeKai" && anilistId) {
    id = `anilist:${anilistId}`;
  }
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
