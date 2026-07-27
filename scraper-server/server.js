const express = require("express");
const cors = require("cors");
const path = require("path");
const mapping = require("./mapping");
const providers = require("./providers");
const admin = require("./admin");

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

providers.loadProviders();

// Admin SSE clients
const sseClients = new Set();

function broadcastScraperUsage(data) {
  const msg = JSON.stringify(data);
  for (const client of sseClients) {
    try { client.write(`data: ${msg}\n\n`); } catch {}
  }
}

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
      sources = await providers.runAll(resolved, audio || "sub", broadcastScraperUsage);
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

// ── Admin Panel API ──

app.get("/api/admin/scrapers", (req, res) => {
  res.json({ scrapers: admin.getScrapers() });
});

app.post("/api/admin/scrapers/toggle", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing name" });
  const result = admin.toggleScraper(name);
  if (!result) return res.status(404).json({ error: "Scraper not found" });
  providers.loadProviders();
  broadcastScraperUsage({ type: "config", scrapers: admin.getScrapers() });
  res.json({ success: true, scraper: result });
});

app.post("/api/admin/scrapers/reorder", (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names)) return res.status(400).json({ error: "Missing names array" });
  const result = admin.reorderScrapers(names);
  providers.loadProviders();
  broadcastScraperUsage({ type: "config", scrapers: result });
  res.json({ success: true, scrapers: result });
});

// SSE endpoint for realtime events
app.get("/api/admin/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "config", scrapers: admin.getScrapers() })}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// Admin panel static files
app.use("/admin", express.static(path.join(__dirname, "admin")));
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "index.html"));
});

// Track scraper usage for realtime display
app.use("/api/stream", (req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = function (body) {
    if (body && body.sources && body.sources.length > 0) {
      const providerCounts = {};
      for (const s of body.sources) {
        providerCounts[s.provider] = (providerCounts[s.provider] || 0) + 1;
      }
      broadcastScraperUsage({
        type: "stream",
        anime: body.anime || {},
        providerCounts,
        totalSources: body.sources.length,
        timestamp: Date.now(),
      });
    }
    return origJson(body);
  };
  next();
});

// Stream proxy for CDN URLs (VPS fetches with scraper headers)
app.get("/api/stream-proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: "Missing url" });

  const fetchHeaders = {};
  if (req.query.r) fetchHeaders["Referer"] = req.query.r;
  if (req.query.o) fetchHeaders["Origin"] = req.query.o;
  if (req.query.ua) fetchHeaders["User-Agent"] = req.query.ua;
  if (!fetchHeaders["User-Agent"]) {
    fetchHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }

  try {
    const resp = await fetch(targetUrl, { headers: fetchHeaders, redirect: "follow" });
    const contentType = resp.headers.get("Content-Type") || "application/octet-stream";

    const isM3U8 = targetUrl.includes(".m3u8") || contentType.includes("m3u8");
    let body = resp.body;

    if (isM3U8 && resp.ok) {
      const text = await resp.text();
      const streamProxyBase = `${req.protocol}://${req.get("host")}/api/stream-proxy?url=`;
      const extraParams = [];
      if (req.query.r) extraParams.push(`r=${encodeURIComponent(req.query.r)}`);
      if (req.query.o) extraParams.push(`o=${encodeURIComponent(req.query.o)}`);
      if (req.query.ua) extraParams.push(`ua=${encodeURIComponent(req.query.ua)}`);
      const extraStr = extraParams.length ? "&" + extraParams.join("&") : "";

      const lines = text.split("\n").map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        const resolved = trimmed.startsWith("http://") || trimmed.startsWith("https://")
          ? trimmed
          : new URL(trimmed, targetUrl).href;
        return `${streamProxyBase}${encodeURIComponent(resolved)}${extraStr}`;
      });
      body = lines.join("\n");
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(resp.status);
    if (typeof body === "string") {
      res.send(body);
    } else {
      const { Readable } = require("stream");
      Readable.fromWeb(body).pipe(res);
    }
  } catch (err) {
    res.status(502).json({ error: err.message });
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
