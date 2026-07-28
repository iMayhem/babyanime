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
        'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Determine target URL: /stream-proxy?url=... or /https://... or /http://...
  let targetUrl = null;
  if (path.startsWith(STREAM_PROXY_PATH)) {
    const targetParam = url.searchParams.get('url');
    if (!targetParam) {
      return new Response('Missing url parameter', { status: 400 });
    }
    targetUrl = decodeURIComponent(targetParam);
  } else if (path.startsWith('/https://') || path.startsWith('/http://')) {
    targetUrl = path.slice(1);
  }
  if (targetUrl) {

    const headers = { ...DEFAULT_HEADERS };
    for (const [key, val] of url.searchParams) {
      if (key === 'url' || key === 'h') continue;
      const headerName = key === 'r' ? 'Referer'
        : key === 'o' ? 'Origin'
        : key === 'ua' ? 'User-Agent'
        : key;
      if (val) headers[headerName] = val;
    }
    const range = request.headers.get('Range');
    if (range) headers['Range'] = range;

    try {
      const resp = await fetch(targetUrl, { headers });
      const isM3U8 = targetUrl.includes('.m3u8') || resp.headers.get('Content-Type')?.includes('m3u8');

      if (isM3U8) {
        const contentType = resp.headers.get('Content-Type') || 'application/vnd.apple.mpegurl';
        const text = await resp.text();

        const extraParams = [];
        if (url.searchParams.has('r')) extraParams.push(`r=${encodeURIComponent(url.searchParams.get('r'))}`);
        if (url.searchParams.has('o')) extraParams.push(`o=${encodeURIComponent(url.searchParams.get('o'))}`);
        if (url.searchParams.has('ua')) extraParams.push(`ua=${encodeURIComponent(url.searchParams.get('ua'))}`);
        const extraStr = extraParams.length ? '&' + extraParams.join('&') : '';

        const proxyBase = `${url.origin}${STREAM_PROXY_PATH}?url=`;
        const lines = text.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const resolved = trimmed.startsWith('http://') || trimmed.startsWith('https://')
            ? trimmed
            : new URL(trimmed, targetUrl).href;
          return `${proxyBase}${encodeURIComponent(resolved)}${extraStr}`;
        });

        return new Response(lines.join('\n'), {
          status: resp.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      // Stream segments and video files through Worker with proper Referer/Origin headers
      // The CDN requires these headers, so we must proxy instead of redirect.
      const responseHeaders = new Headers(resp.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
      responseHeaders.delete('Access-Control-Allow-Credentials');

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: responseHeaders,
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
