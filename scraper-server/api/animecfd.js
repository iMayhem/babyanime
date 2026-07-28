const cheerio = require('cheerio-without-node-native');

const PROVIDER_NAME = 'AnimeCFD';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchSafe(url, opts) {
  try {
    const resp = await fetch(url, { headers: { ...HEADERS, ...(opts?.headers || {}) }, ...opts });
    if (!resp.ok) return null;
    return resp;
  } catch { return null; }
}

async function fetchJson(url, opts) {
  try {
    const resp = await fetch(url, { headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest', ...(opts?.headers || {}) }, ...opts });
    if (!resp.ok) return null;
    return resp.json();
  } catch { return null; }
}

function buildLabels(serverType, quality, label, showInfo) {
  const q = quality || 'HD';
  const displayName = q + (label ? ' ' + label : '');
  let titleLine = q;
  if (showInfo) titleLine += ' · Episode ' + (showInfo.episode || '?');
  return { name: displayName, title: titleLine };
}

async function getStreams(id, mediaType, season, episode, resolved) {
  try {
    const anilistId = resolved?.anilistId;
    if (!anilistId) return [];

    const audio = 'sub';
    const embedUrl = `https://animeplay.cfd/stream/ani/${anilistId}/${episode}/${audio}`;

    const embedResp = await fetchSafe(embedUrl, {
      headers: { 'Referer': 'https://animeplay.cfd/', 'Origin': 'https://animeplay.cfd' }
    });
    if (!embedResp) return [];
    const html = await embedResp.text();
    const $ = cheerio.load(html);
    const dataId = $('#megaplay-player').attr('data-id');
    if (!dataId) return [];

    const src = await fetchJson('https://megaplay.buzz/stream/getSources?id=' + dataId + '&id=' + dataId, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://megaplay.buzz/' }
    });
    if (!src || !src.sources || !src.sources.file) return [];

    const labels = buildLabels('AnimeCFD', '1080p', '', { episode });
    return [{
      name: PROVIDER_NAME + ' | ' + labels.name,
      title: labels.title,
      url: src.sources.file,
      quality: '1080p',
      format: 'hls',
      headers: {
        'Referer': 'https://megaplay.buzz/',
        'Origin': 'https://megaplay.buzz',
        'User-Agent': UA
      },
      subtitles: (src.tracks || []).filter(t => t.kind === 'captions' || t.kind === 'subtitles').map(t => ({ label: t.label || 'Unknown', url: t.file })).filter(t => t.url)
    }];
  } catch (e) {
    console.error('[' + PROVIDER_NAME + '] Error: ' + e.message);
    return [];
  }
}

module.exports = { getStreams };
