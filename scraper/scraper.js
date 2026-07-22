const { parse: parseHtml } = require('node-html-parser');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetch_(url, opts = {}) {
  const resp = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, Accept: '*/*', ...opts.headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeout || 15000)
  });
  return resp;
}

function extractVideoUrl(text) {
  if (!text) return null;
  const patterns = [
    /https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)[^"'\s<>]*/gi,
    /["'`](https?:\/\/[^"'`]+\.(?:m3u8|mp4)[^"'`]*)["'`]/gi,
    /"file"\s*:\s*"([^"]+(?:m3u8|mp4)[^"]*)"/i,
    /"src"\s*:\s*"([^"]+(?:m3u8|mp4)[^"]*)"/i,
    /"url"\s*:\s*"([^"]+(?:m3u8|mp4)[^"]*)"/i,
    /source\s+src=["']([^"']+(?:m3u8|mp4)[^"']*)["']/i,
    /video[^>]+src=["']([^"']+(?:m3u8|mp4)[^"']*)["']/i,
    /data-src=["']([^"']+(?:m3u8|mp4)[^"']*)["']/i,
    /src["']?\s*:\s*["']([^"']+(?:m3u8|mp4)[^"']*)["']/i,
    /url["']?\s*:\s*["']([^"']+(?:m3u8|mp4)[^"']*)["']/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return (m[1] || m[0]).replace(/['"`]/g, '');
  }
  try {
    const d = JSON.parse(text);
    for (const key of ['url', 'stream_url', 'file', 'playlist', 'source', 'src']) {
      if (d[key] && (d[key].includes('m3u8') || d[key].includes('mp4'))) return d[key];
    }
    const arr = d.sources || d.result || d.data || [];
    if (arr.length) {
      for (const item of (Array.isArray(arr) ? arr : [])) {
        for (const key of ['file', 'url', 'src']) {
          if (item[key] && (item[key].includes('m3u8') || item[key].includes('mp4'))) return item[key];
        }
      }
    }
  } catch {}
  return null;
}

// ---------- MegaPlay / AnimePlay ----------
async function scrapeMegaplay(megaUrl, referer) {
  const resp = await fetch_(megaUrl, { headers: { Referer: referer } });
  const html = await resp.text();
  const root = parseHtml(html);

  // Extract settings and data attributes
  const pd = root.querySelector('#megaplay-player');
  const sid = pd?.getAttribute('data-id') || '';
  const realid = pd?.getAttribute('data-realid') || '';
  const mediaid = pd?.getAttribute('data-mediaid') || '';
  let type = 'sub', cid = '', cidu = '';

  for (const s of root.querySelectorAll('script')) {
    const t = s.textContent || '';
    const sm = t.match(/settings\s*=\s*({[^;]+})/);
    if (sm) {
      try { const o = eval('(' + sm[1] + ')'); type = o.type || type; cid = o.cid || cid; cidu = o.cidu || cidu; } catch {}
    }
  }

  // 1. Try the domain list approach (animesugetv.io etc.)
  try {
    const dr = await fetch_(`https://megaplay.buzz/domains?h=${Date.now()}`, { headers: { Referer: megaUrl } });
    const dt = await dr.text();
    const domains = JSON.parse(Buffer.from(dt, 'base64').toString());
    for (const d of domains.slice(0, 5)) {
      try {
        const r = await fetch_(`https://${d}/stream/${sid}`, {
          headers: { Referer: megaUrl, 'User-Agent': UA },
          redirect: 'manual'
        });
        const t = await r.text();
        const jm = t.match(/location\.replace\(['"]([^'"]+)['"]\)/);
        if (jm) {
          const r2 = await fetch_(jm[1], { headers: { Referer: megaUrl } });
          const h2 = await r2.text();
          const vu = extractVideoUrl(h2);
          if (vu) return vu;
          // Also search within script tags
          const s2 = h2.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
          for (const sc of s2) {
            const vu2 = extractVideoUrl(sc);
            if (vu2) return vu2;
          }
        }
      } catch {}
    }
  } catch {}

  // 2. Try API endpoints
  const apis = [
    `/api/e1?id=${sid}&realid=${realid}&mediaid=${mediaid}&type=${type}&cid=${cid}&cidu=${cidu}`,
    `/api/source?id=${sid}`,
    `/api/${sid}`
  ];
  for (const path of apis) {
    try {
      const ar = await fetch_(`https://megaplay.buzz${path}`, {
        headers: { Referer: megaUrl, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json,text/plain' }
      });
      const at = await ar.text();
      if (at && !at.includes('<!DOCTYPE') && at.length < 5000) {
        const vu = extractVideoUrl(at);
        if (vu) return vu;
      }
    } catch {}
  }

  return extractVideoUrl(html);
}

async function scrapeAnimeplay(id, ep, audio, isMal) {
  const mode = isMal ? 'mal' : 'ani';
  const embedUrl = `https://animeplay.cfd/stream/${mode}/${id}/${ep}/${audio}`;
  const resp = await fetch_(embedUrl, { headers: { Referer: 'https://animeplay.cfd/' } });
  const html = await resp.text();
  const root = parseHtml(html);
  const iframe = root.querySelector('iframe');
  if (iframe) {
    return scrapeMegaplay(iframe.getAttribute('src'), embedUrl);
  }
  return extractVideoUrl(html);
}

// ---------- MovieSrc ----------
async function scrapeMoviesrc(malId, ep, audio) {
  const embedUrl = `https://movie-src.xyz/v1/embed/anime/${malId}/${ep}/${audio}`;
  const html = await (await fetch_(embedUrl, { headers: { Referer: 'https://movie-src.xyz/' } })).text();

  // Try API with various param combinations
  for (const url of [
    `https://movie-src.xyz/api/stream/anime/${malId}?episode=${ep}&audio=${audio}`,
    `https://movie-src.xyz/api/stream/anime/${malId}?episode=${ep}`,
    `https://movie-src.xyz/api/source?tmdb=${malId}&ep=${ep}&type=anime`
  ]) {
    try {
      const ar = await fetch_(url, {
        headers: { Referer: embedUrl, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
      });
      const at = await ar.text();
      const vu = extractVideoUrl(at);
      if (vu) return vu;
    } catch {}
  }
  return extractVideoUrl(html);
}

// ---------- VidSrc.cc ----------
async function scrapeVidsrcCc(malId, ep, audio) {
  const embedUrl = `https://vidsrc.cc/v2/embed/anime/${malId}/${ep}/${audio}`;
  const html = await (await fetch_(embedUrl, { headers: { Referer: 'https://vidsrc.cc/' } })).text();
  for (const url of [
    `https://vidsrc.cc/v2/api/anime/${malId}/${ep}/${audio}`,
    `https://vidsrc.cc/v2/api/source/${malId}?ep=${ep}&audio=${audio}`
  ]) {
    try {
      const ar = await fetch_(url, { headers: { Referer: embedUrl, 'X-Requested-With': 'XMLHttpRequest' } });
      const at = await ar.text();
      const vu = extractVideoUrl(at);
      if (vu) return vu;
    } catch {}
  }
  return extractVideoUrl(html);
}

// ---------- VidSrc.to ----------
async function scrapeVidsrcTo(malId, ep) {
  const embedUrl = `https://vidsrc.to/embed/anime/${malId}/${ep}`;
  let html;
  try { html = await (await fetch_(embedUrl, { headers: { Referer: 'https://vidsrc.to/' }, timeout: 10000 })).text(); }
  catch { return null; }
  for (const url of [
    `https://vidsrc.to/ajax/embed/episode/${malId}/${ep}/anime`,
    `https://vidsrc.to/ajax/embed/source/${malId}?ep=${ep}`
  ]) {
    try {
      const ar = await fetch_(url, { headers: { Referer: embedUrl, 'X-Requested-With': 'XMLHttpRequest' } });
      const at = await ar.text();
      const vu = extractVideoUrl(at);
      if (vu) return vu;
    } catch {}
  }
  return extractVideoUrl(html);
}

// ---------- Main ----------
async function scrapeAll(anilistId, malId, ep, audio) {
  const results = {};
  const id = malId || anilistId || 0;

  const tasks = [];
  if (anilistId) tasks.push({ k: 'aniplay_ani', fn: () => scrapeAnimeplay(anilistId, ep, audio, false) });
  tasks.push({ k: 'aniplay_mal', fn: () => scrapeAnimeplay(id, ep, audio, true) });
  tasks.push({ k: 'moviesrc_mal', fn: () => scrapeMoviesrc(id, ep, audio) });
  tasks.push({ k: 'vidsrc_cc', fn: () => scrapeVidsrcCc(id, ep, audio) });
  tasks.push({ k: 'vidsrc_to', fn: () => scrapeVidsrcTo(id, ep) });

  for (const { k, fn } of tasks) {
    try {
      const url = await fn();
      if (url) results[k] = url;
    } catch (e) { /* skip */ }
  }

  return results;
}

module.exports = { scrapeAll };
