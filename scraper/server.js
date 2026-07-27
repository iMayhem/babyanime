const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeAll, scrapeArceus } = require('./scraper');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 4000;
const PROXY_BASE = 'https://proxy.peestream.in/proxy';

const REFERER_MAP = {
  aniplay_ani: 'https://animeplay.cfd/',
  aniplay_mal: 'https://animeplay.cfd/',
  moviesrc_mal: 'https://movie-src.xyz/',
  vidsrc_cc: 'https://vidsrc.cc/',
  vidsrc_to: 'https://vidsrc.to/',
  arceus: ''
};

app.get('/', (req, res) => {
  res.json({
    name: 'Anime Embed Scraper',
    endpoints: {
      '/scrape?anilist_id=&mal_id=&ep=1&audio=sub': 'Scrape all providers for a video URL',
      '/redirect?source=...&url=...': 'Get a redirect URL through proxy.peestream.in'
    }
  });
});

app.get('/scrape', async (req, res) => {
  const { anilist_id, mal_id, ep = '1', audio = 'sub' } = req.query;
  if (!anilist_id && !mal_id) {
    return res.status(400).json({ error: 'Provide anilist_id or mal_id' });
  }

  const start = Date.now();
  const results = await scrapeAll(anilist_id, mal_id, parseInt(ep), audio);

  const response = { query: { anilist_id, mal_id, ep, audio }, results, time_ms: Date.now() - start };

  // Add proxy URLs
  for (const [src, url] of Object.entries(results)) {
    if (url) {
      const ref = REFERER_MAP[src] || '';
      response[src + '_proxy'] = `${PROXY_BASE}?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(ref)}`;
    }
  }

  res.json(response);
});

app.get('/arceus', async (req, res) => {
  const { anilist_id, ep, audio } = req.query;
  if (!anilist_id) return res.status(400).json({ error: 'anilist_id required' });
  const start = Date.now();
  try {
    const url = await scrapeArceus(anilist_id, parseInt(ep || '1'), audio || 'sub');
    res.json({ query: { anilist_id, ep, audio }, stream_url: url, time_ms: Date.now() - start });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/redirect', (req, res) => {
  const { source, url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  const ref = REFERER_MAP[source] || '';
  const proxyUrl = `${PROXY_BASE}?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(ref)}`;
  res.redirect(proxyUrl);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Anime scraper on :${PORT}`);
});
