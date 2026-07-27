const VPS_ORIGIN = 'http://217.60.78.103';
const STREAM_PROXY_PATH = '/stream-proxy';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://babyanime.top',
  'Referer': 'https://babyanime.top/',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
};

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // API proxy to VPS scraper
  if (path.startsWith('/api/')) {
    const targetUrl = `${VPS_ORIGIN}${path}${url.search}`;
    const resp = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'Host': 'proxy.babyanime.top',
        'X-Real-IP': request.headers.get('CF-Connecting-IP') || '',
      },
    });
    const newResp = new Response(resp.body, resp);
    newResp.headers.set('Access-Control-Allow-Origin', '*');
    return newResp;
  }

  // Stream proxy: proxy HLS/MP4 streams with proper headers
  if (path.startsWith(STREAM_PROXY_PATH)) {
    const targetParam = url.searchParams.get('url');
    if (!targetParam) {
      return new Response('Missing url parameter', { status: 400 });
    }
    const targetUrl = decodeURIComponent(targetParam);

    const headers = { ...DEFAULT_HEADERS };
    const requestHeaders = request.headers.get('Range');
    if (requestHeaders) {
      headers['Range'] = requestHeaders;
    }

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
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('#')) {
            return line;
          }
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return `${proxyBase}${encodeURIComponent(trimmed)}`;
          }
          const resolved = new URL(trimmed, targetUrl).href;
          return `${proxyBase}${encodeURIComponent(resolved)}`;
        });
        body = lines.join('\n');
      }

      const responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      };
      if (requestHeaders) {
        responseHeaders['Content-Range'] = resp.headers.get('Content-Range') || '';
      }

      return new Response(body, {
        status: resp.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502 });
    }
  }

  return new Response('Not Found', { status: 404 });
}

export default {
  fetch: handleRequest,
};
