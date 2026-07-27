const STREAM_PROXY_PATH = '/stream-proxy';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://babyanime.top',
  'Referer': 'https://babyanime.top/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
};

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (path.startsWith(STREAM_PROXY_PATH)) {
    const targetParam = url.searchParams.get('url');
    if (!targetParam) {
      return new Response('Missing url parameter', { status: 400 });
    }
    const targetUrl = decodeURIComponent(targetParam);

    const headers = { ...DEFAULT_HEADERS };
    const range = request.headers.get('Range');
    if (range) headers['Range'] = range;

    try {
      const resp = await fetch(targetUrl, { headers });

      const isM3U8 = targetUrl.includes('.m3u8') || resp.headers.get('Content-Type')?.includes('m3u8');
      let body = resp.body;
      let contentType = resp.headers.get('Content-Type') || 'application/octet-stream';

      if (isM3U8 && resp.ok) {
        const text = await resp.text();
        const proxyBase = `${url.origin}${STREAM_PROXY_PATH}?url=`;
        const lines = text.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const resolved = trimmed.startsWith('http://') || trimmed.startsWith('https://')
            ? trimmed
            : new URL(trimmed, targetUrl).href;
          return `${proxyBase}${encodeURIComponent(resolved)}`;
        });
        body = lines.join('\n');
      }

      return new Response(body, {
        status: resp.status,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
          ...(range ? { 'Content-Range': resp.headers.get('Content-Range') || '' } : {}),
        },
      });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502 });
    }
  }

  return new Response('Not Found', { status: 404 });
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
