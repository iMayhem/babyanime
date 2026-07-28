const crypto = require('crypto');

const PROVIDER_NAME = 'VidSrc';
const BASE = 'https://vidsrc.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function rc4Decrypt(key, data) {
  const decipher = crypto.createDecipheriv('rc4', Buffer.from(key), null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function b64FromUrlSafe(s) {
  return s.replace(/_/g, '/').replace(/-/g, '+');
}

async function fetchJson(url, headers) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': BASE + '/', ...headers } });
  if (!resp.ok) return null;
  return resp.json();
}

async function getVidsrcKey() {
  try {
    const resp = await fetch('https://keys4.fun', { headers: { 'User-Agent': UA } });
    const text = await resp.text();
    const cleaned = text.replace(/[\s\n\r]/g, '');
    const match = cleaned.match(/vidsrc_to"+\{*"keys"\s*:\s*\["([^"]*)","([^"]*)"\]/);
    if (match) return match[2];
    const altMatch = text.match(/vidsrc[^}]*keys[^}]*"([^"]+)"[^}]*"([^"]+)"/);
    return altMatch ? altMatch[2] : null;
  } catch { return null; }
}

async function getStreams(id, mediaType, season, episode, resolved) {
  try {
    const isMovie = mediaType === 'movie';
    const embedUrl = isMovie
      ? `${BASE}/embed/movie/${id}`
      : `${BASE}/embed/tv/${id}/${season}/${episode}`;

    const embedResp = await fetch(embedUrl, { headers: { 'User-Agent': UA, 'Referer': BASE + '/' } });
    if (!embedResp.ok) return [];
    const html = await embedResp.text();

    const dataIdMatch = html.match(/data-id="([^"]+)"/);
    if (!dataIdMatch) return [];
    const dataId = dataIdMatch[1];

    const sourcesData = await fetchJson(`${BASE}/ajax/embed/episode/${dataId}/sources`);
    if (!sourcesData || !sourcesData.result) return [];

    const source = sourcesData.result.find(s => s.title === 'Vidplay') || sourcesData.result[0];
    if (!source) return [];
    const sourceId = source.id;

    const vidsrcKey = await getVidsrcKey();
    if (!vidsrcKey) return [];

    const sourceData = await fetchJson(`${BASE}/ajax/embed/source/${sourceId}`);
    if (!sourceData || !sourceData.result || !sourceData.result.url) return [];
    const encrypted = b64FromUrlSafe(sourceData.result.url);
    let decrypted;
    try {
      decrypted = rc4Decrypt(vidsrcKey, Buffer.from(encrypted, 'base64')).toString('utf-8');
    } catch {
      return [];
    }

    const vidplayUrl = decrypted;
    const futokenResp = await fetch('https://vidplay.online/futoken', { headers: { 'User-Agent': UA, 'Referer': 'https://vidplay.online/' } });
    const futokenText = await futokenResp.text();
    const vrfMatch = futokenText.match(/k='([^']+)'/);
    if (!vrfMatch) return [];
    const vrfKey = vrfMatch[1];

    const eMatch = vidplayUrl.match(/\/e\/([^?]+)/);
    if (!eMatch) return [];
    const eHash = eMatch[1];

    const token = b64FromUrlSafe(eHash);
    const tokenBuf = Buffer.from(token, 'base64');
    const vrfBuf = Buffer.from(vrfKey, 'utf-8');
    const tokenArr = Array.from(tokenBuf);
    const vrfArr = Array.from(vrfBuf);
    for (let i = 0; i < tokenArr.length; i++) {
      tokenArr[i] = (tokenArr[i] + vrfArr[i % vrfArr.length]) % 256;
    }
    const paddedToken = Buffer.from(tokenArr).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const finalUrl = vidplayUrl.replace(/\/e\/([^?]+)/, '/master/' + paddedToken + '?r=0&s=0');
    const finalResp = await fetch(finalUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://vidplay.online/', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!finalResp.ok) return [];
    const finalData = await finalResp.json();
    const m3u8Url = finalData.result?.sources?.[0]?.file || finalData.file;
    if (!m3u8Url) return [];

    const labels = {
      name: `${source.title || 'Vidplay'} · ${isMovie ? 'Movie' : 'S' + season + 'E' + episode}`,
      title: m3u8Url.includes('master.m3u8') || m3u8Url.includes('index.m3u8') ? 'Master' : 'Stream'
    };

    return [{
      name: PROVIDER_NAME + ' | ' + labels.name,
      title: labels.title,
      url: m3u8Url,
      quality: 'Auto',
      format: 'hls',
      headers: {
        'Referer': 'https://vidplay.online/',
        'Origin': 'https://vidplay.online',
        'User-Agent': UA
      }
    }];
  } catch (e) {
    console.error('[' + PROVIDER_NAME + '] Error: ' + e.message);
    return [];
  }
}

module.exports = { getStreams };
