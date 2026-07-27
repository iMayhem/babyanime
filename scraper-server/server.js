const express = require("express");
const cors = require("cors");
const path = require("path");
const mapping = require("./mapping");
const providers = require("./providers");

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

providers.loadProviders();

const TMDB_API_KEY = process.env.TMDB_API_KEY || "1865f43a0549ca50d341dd9ab8b29f49";

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    providers: providers.listProviders(),
    uptime: process.uptime(),
  });
});

app.get("/api/providers", (req, res) => {
  res.json({ providers: providers.listProviders() });
});

app.get("/api/map", async (req, res) => {
  try {
    const result = await mapping.resolve(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get("/api/stream", async (req, res) => {
  try {
    const { provider, audio } = req.query;
    const resolved = await mapping.resolve(req.query);

    if (!resolved.tmdbId) {
      return res.status(400).json({
        success: false,
        error: "Could not resolve TMDB ID from the provided AniList/MAL ID",
        resolved,
      });
    }

    let sources;
    if (provider && provider !== "all") {
      sources = await providers.runProvider(provider, resolved, audio || "sub");
    } else {
      sources = await providers.runAll(resolved, audio || "sub");
    }

    res.json({
      success: true,
      anime: {
        title: resolved.title,
        anilistId: resolved.anilistId,
        malId: resolved.malId,
        tmdbId: resolved.tmdbId,
        type: resolved.type,
        format: resolved.format,
        episode: resolved.episode,
      },
      sources,
      sourceCount: sources.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/tmdb-proxy", async (req, res) => {
  try {
    const { path: tmdbPath } = req.query;
    if (!tmdbPath) return res.status(400).json({ error: "Missing path" });
    const url = `https://api.themoviedb.org/3${tmdbPath}?api_key=${TMDB_API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(` BabyAnime Scraper Server`);
  console.log(` Listening on http://0.0.0.0:${PORT}`);
  console.log(` ${providers.listProviders().length} providers loaded`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(` Endpoints:`);
  console.log(`   GET /api/health`);
  console.log(`   GET /api/providers`);
  console.log(`   GET /api/map?anilist_id=X|mal_id=X`);
  console.log(`   GET /api/stream?anilist_id=X&ep=1&audio=sub`);
  console.log(`   GET /api/tmdb-proxy?path=/tv/12345`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
