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

  // Forward Range header for video seeking
  const range = req.headers["range"];
  if (range) fetchHeaders["Range"] = range;

  // Detect if this is a direct video file (not an HLS playlist candidate)
  const isVideoFile = /\.(mp4|mkv|webm|avi|mov|flv)(\?|$)/i.test(targetUrl);

  try {
    // For direct video files: follow all redirects and send browser to the final URL
    // This avoids streaming large video files through the VPS (causes 504 timeouts)
    if (isVideoFile && !range) {
      let currentUrl = targetUrl;
      let hops = 0;
      while (hops++ < 10) {
        const resp = await fetch(currentUrl, { headers: fetchHeaders, redirect: "manual" });
        const location = resp.headers.get("location");
        if ((resp.status === 301 || resp.status === 302 || resp.status === 307 || resp.status === 308) && location) {
          currentUrl = location.startsWith("//") ? "https:" + location : location;
          // Update referer for next hop
          fetchHeaders["Referer"] = new URL(currentUrl).origin + "/";
        } else {
          // Final URL — redirect browser here so it fetches directly
          res.setHeader("Access-Control-Allow-Origin", "*");
          return res.redirect(302, currentUrl);
        }
      }
      return res.status(502).json({ error: "Too many redirects" });
    }

    const resp = await fetch(targetUrl, { headers: fetchHeaders, redirect: "follow" });

    let contentType = resp.headers.get("Content-Type") || "application/octet-stream";
    const isM3u8Candidate = targetUrl.includes(".m3u8") || contentType.includes("m3u8") || targetUrl.includes("/hls/") || targetUrl.includes("/cdn/hls/") || targetUrl.includes("/p/");

    if (resp.ok && isM3u8Candidate) {
      const text = await resp.text();
      if (text.trim().startsWith("#EXTM3U")) {
        const host = req.get("host") || "proxy.babyanime.top";
        const proto = req.get("x-forwarded-proto") || "https";
        const streamProxyBase = `${proto}://${host}/api/stream-proxy?url=`;

        const extraParams = [];
        if (req.query.r) extraParams.push(`r=${encodeURIComponent(req.query.r)}`);
        if (req.query.o) extraParams.push(`o=${encodeURIComponent(req.query.o)}`);
        if (req.query.ua) extraParams.push(`ua=${encodeURIComponent(req.query.ua)}`);
        const extraStr = extraParams.length ? "&" + extraParams.join("&") : "";

        const proxyUrl = (rawUrl) => {
          const resolved = rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
            ? rawUrl
            : new URL(rawUrl, targetUrl).href;
          return `${streamProxyBase}${encodeURIComponent(resolved)}${extraStr}`;
        };

        const lines = text.split("\n").map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith("#")) {
            return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxyUrl(uri)}"`);
          }
          return proxyUrl(trimmed);
        });

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.send(lines.join("\n"));
      } else {
        res.setHeader("Content-Type", contentType);
        res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.send(text);
      }
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const passHeaders = ["content-range", "content-length", "content-disposition"];
    for (const key of passHeaders) {
      const val = resp.headers.get(key);
      if (val) res.setHeader(key, val);
    }

    res.status(resp.status);
    const { Readable } = require("stream");
    Readable.fromWeb(resp.body).pipe(res);
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

// ── Fresh Stream Proxy: re-fetches CDN token on every request to avoid expiry ──
// Used by AnimeSalt and AnimeWorld whose CDN URLs expire after a few minutes.
const _freshStreamCache = new Map(); // episodeUrl -> {url, headers, ts}

app.get("/api/fresh-stream", async (req, res) => {
  const { ep_url, scraper, r, o } = req.query;
  if (!ep_url) return res.status(400).json({ error: "Missing ep_url" });

  try {
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

    // Check cache first (30-second window, CDN tokens last ~5min)
    const cached = _freshStreamCache.get(ep_url);
    if (cached && (Date.now() - cached.ts) < 30000) {
      return await _serveFreshM3U8(req, res, cached.url, cached.referer, UA);
    }

    // Re-fetch the episode page to get a fresh player hash
    const pageResp = await fetch(ep_url, {
      headers: { "User-Agent": UA, "Referer": r || "https://animesalt.link/" },
      redirect: "follow",
    });
    if (!pageResp.ok) return res.status(502).json({ error: "Episode page fetch failed: " + pageResp.status });
    const pageHtml = await pageResp.text();

    // Extract CDN player iframe
    const playerMatch = pageHtml.match(/(?:src|data-src)="(https:\/\/(?:as-cdn\d+\.top|play\.zephyrflick\.top)\/video\/([a-f0-9]+))"/);
    if (!playerMatch) return res.status(404).json({ error: "No player found on page" });

    const cdnBase = playerMatch[1].split("/video/")[0];
    const hash = playerMatch[2];
    const siteBase = new URL(ep_url).origin;

    // POST to get fresh signed URL
    const postResp = await fetch(`${cdnBase}/player/index.php?data=${hash}&do=getVideo`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": siteBase + "/",
        "Origin": cdnBase,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: `hash=${hash}&r=${encodeURIComponent(siteBase + "/")}`,
    });
    if (!postResp.ok) return res.status(502).json({ error: "CDN POST failed: " + postResp.status });
    const json = await postResp.json();

    let videoUrl = json.videoSource || json.securedLink;
    const referer = cdnBase + "/";

    _freshStreamCache.set(ep_url, { url: videoUrl, referer, ts: Date.now() });

    await _serveFreshM3U8(req, res, ep_url, videoUrl, referer, UA);
  } catch (err) {
    console.error("[fresh-stream] Error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

async function _serveFreshM3U8(req, res, ep_url, videoUrl, referer, UA) {
  const m3u8Resp = await fetch(videoUrl, {
    headers: { "Referer": referer, "Origin": referer.replace(/\/$/, ""), "User-Agent": UA },
  });
  if (!m3u8Resp.ok) {
    _freshStreamCache.delete(ep_url);
    res.status(m3u8Resp.status).json({ error: "CDN returned " + m3u8Resp.status });
    return;
  }

  const text = await m3u8Resp.text();
  const contentType = m3u8Resp.headers.get("Content-Type") || "application/vnd.apple.mpegurl";

  // Rewrite all URLs through our stream-proxy so HLS.js can fetch them cross-origin
  const proxyBase = `https://proxy.babyanime.top/api/stream-proxy?url=`;
  const extraParams = `&r=${encodeURIComponent(referer)}&o=${encodeURIComponent(referer.replace(/\/$/, ""))}&ua=${encodeURIComponent(UA)}`;

  const proxyUrl = (rawUrl) => {
    const abs = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, videoUrl).href;
    return `${proxyBase}${encodeURIComponent(abs)}${extraParams}`;
  };

  const rewritten = text.split("\n").map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    // Rewrite URI= attributes in HLS tags (#EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF, etc.)
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxyUrl(uri)}"`);
    }
    // Bare segment/playlist lines
    return proxyUrl(trimmed);
  }).join("\n");

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-cache");
  res.send(rewritten);
}


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
