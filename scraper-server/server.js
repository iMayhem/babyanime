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

// M3U8 cache: pre-fetched shortly after scraper returns URLs (before tokens expire)
const m3u8Cache = new Map();
const CACHE_TTL = 120_000; // 2 minutes
const WORKER_BASE = 'https://babyanime-stream-proxy.sujeetunbeatable.workers.dev/stream-proxy?url=';

function rewriteM3u8Urls(m3u8Text, baseUrl, referer, origin, ua) {
  const params = [];
  if (referer) params.push(`r=${encodeURIComponent(referer)}`);
  if (origin) params.push(`o=${encodeURIComponent(origin)}`);
  if (ua) params.push(`ua=${encodeURIComponent(ua)}`);
  const extraStr = params.length ? '&' + params.join('&') : '';
  return m3u8Text.split('\n').map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      return t.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${WORKER_BASE}${encodeURIComponent(u)}${extraStr}"`) : line;
    }
    const abs = t.startsWith('http') ? t : new URL(t, baseUrl).href;
    return `${WORKER_BASE}${encodeURIComponent(abs)}${extraStr}`;
  }).join('\n');
}

function workerProxyUrl(url, referer, origin, ua) {
  let proxyUrl = `${WORKER_BASE}${encodeURIComponent(url)}`;
  if (referer) proxyUrl += `&r=${encodeURIComponent(referer)}`;
  if (origin) proxyUrl += `&o=${encodeURIComponent(origin)}`;
  if (ua) proxyUrl += `&ua=${encodeURIComponent(ua)}`;
  return proxyUrl;
}

async function prefetchM3u8(url, headers) {
  const key = Buffer.from(url).toString('base64').slice(0, 32);
  // Already cached
  if (m3u8Cache.has(key)) return key;
  try {
    const resp = await fetch(url, { headers, redirect: 'follow' });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text.trim().startsWith('#EXTM3U')) return null;

    const workerBase = 'https://babyanime-stream-proxy.sujeetunbeatable.workers.dev/stream-proxy?url=';
    const extraParams = [];
    if (headers['Referer']) extraParams.push('r=' + encodeURIComponent(headers['Referer']));
    if (headers['Origin']) extraParams.push('o=' + encodeURIComponent(headers['Origin']));
    if (headers['User-Agent']) extraParams.push('ua=' + encodeURIComponent(headers['User-Agent']));
    const extraStr = extraParams.length ? '&' + extraParams.join('&') : '';

    const proxyUrl = (raw) => {
      if (!raw) return raw;
      const abs = raw.startsWith('http') ? raw : new URL(raw, url).href;
      return `${workerBase}${encodeURIComponent(abs)}${extraStr}`;
    };

    const rewritten = text.split('\n').map(line => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxyUrl(u)}"`);
      return proxyUrl(t);
    }).join('\n');

    m3u8Cache.set(key, { content: rewritten, contentType: resp.headers.get('Content-Type') || 'application/vnd.apple.mpegurl', ts: Date.now() });
    setTimeout(() => m3u8Cache.delete(key), CACHE_TTL);
    return key;
  } catch {
    return null;
  }
}

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

    // Fetch M3U8 content inline: use scraper-pre-fetched or fetch now
    await Promise.allSettled(sources.map(async (s) => {
      if (s.format === 'hls' && s.url && !s.url.startsWith('/api/') && !s.m3u8Content) {
        const m3u8Resp = await fetch(s.url, { headers: s.headers || {}, redirect: 'follow' });
        if (m3u8Resp.ok) {
          let m3u8Text = await m3u8Resp.text();
          if (m3u8Text.trim().startsWith('#EXTM3U')) {
            const wh = s.headers || {};
            s.m3u8Content = rewriteM3u8Urls(m3u8Text, s.url, wh['Referer'] || wh['referer'] || '', wh['Origin'] || wh['origin'] || '', wh['User-Agent'] || wh['user-agent'] || '');
          }
        }
      }
      if (s.m3u8Content) s.url = '';
    }));

    // Rewrite subtitle URLs through the Worker proxy
    for (const s of sources) {
      if (s.subtitles && Array.isArray(s.subtitles)) {
        for (const sub of s.subtitles) {
          if (sub.url && !sub.url.startsWith('http://localhost') && !sub.url.includes('/stream-proxy')) {
            const wh = s.headers || {};
            sub.url = workerProxyUrl(sub.url, wh['Referer'] || wh['referer'] || '', wh['Origin'] || wh['origin'] || '', wh['User-Agent'] || wh['user-agent'] || '');
          }
        }
      }
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
    // For direct video files: follow redirect chain and send browser to the final signed URL
    // This avoids streaming any video data through the VPS (causes 504 / bw issues)
    // Works with or without Range header — 302 preserves the original request method+headers
    if (isVideoFile) {
      let currentUrl = targetUrl;
      let hops = 0;
      while (hops++ < 10) {
        const resp = await fetch(currentUrl, { headers: fetchHeaders, redirect: "manual" });
        const location = resp.headers.get("location");
        if ((resp.status === 301 || resp.status === 302 || resp.status === 307 || resp.status === 308) && location) {
          currentUrl = location.startsWith("//") ? "https:" + location : location;
          fetchHeaders["Referer"] = new URL(currentUrl).origin + "/";
        } else {
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
        // Rewrite segment URLs to go through Cloudflare Worker (no VPS bandwidth)
        const workerBase = "https://babyanime-stream-proxy.sujeetunbeatable.workers.dev/stream-proxy?url=";

        const extraParams = [];
        if (req.query.r) extraParams.push(`r=${encodeURIComponent(req.query.r)}`);
        if (req.query.o) extraParams.push(`o=${encodeURIComponent(req.query.o)}`);
        if (req.query.ua) extraParams.push(`ua=${encodeURIComponent(req.query.ua)}`);
        const extraStr = extraParams.length ? "&" + extraParams.join("&") : "";

        const proxyUrl = (rawUrl) => {
          if (!rawUrl) return rawUrl;
          const resolved = rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
            ? rawUrl
            : new URL(rawUrl, targetUrl).href;
          return `${workerBase}${encodeURIComponent(resolved)}${extraStr}`;
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
        res.setHeader("Access-Control-Allow-Origin", "*");
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

app.post("/api/anilist", async (req, res) => {
  try {
    const { query, variables } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });
    const resp = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jikan/:malId", async (req, res) => {
  try {
    const resp = await fetch(`https://api.jikan.moe/v4/anime/${req.params.malId}`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

  // Rewrite all URLs through the Cloudflare Worker
  const proxyBase = `https://babyanime-stream-proxy.sujeetunbeatable.workers.dev/stream-proxy?url=`;
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


app.get("/api/m3u8-cache/:key", (req, res) => {
  const entry = m3u8Cache.get(req.params.key);
  if (!entry) return res.status(404).json({ error: "Cache entry expired or not found" });
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  res.send(entry.content);
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
