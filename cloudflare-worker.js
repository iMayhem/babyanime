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

    // Merge per-request headers from query params (scraper-provided)
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
        // M3U8: rewrite segment URLs to direct CDN URLs (not through Worker)
        // The M3U8 itself is fetched via Worker with proper Referer/Origin,
        // but segments load directly from the CDN — zero Worker bandwidth for video data.
        const contentType = resp.headers.get('Content-Type') || 'application/vnd.apple.mpegurl';
        const text = await resp.text();

        const lines = text.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          // Resolve relative URLs, but keep them pointing directly at the CDN
          return trimmed.startsWith('http://') || trimmed.startsWith('https://')
            ? trimmed
            : new URL(trimmed, targetUrl).href;
        });

        return new Response(lines.join('\n'), {
          status: resp.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      // Non-M3U8 (segments, video files): 302 redirect straight to the CDN.
      // The CDN already returns Access-Control-Allow-Origin: *, so direct fetches work.
      // We follow any redirect chains and return the final URL with CORS headers.
      let currentUrl = targetUrl;
      let fetchHeaders = { ...headers };
      let hops = 0;
      while (hops++ < 10) {
        const check = await fetch(currentUrl, { headers: fetchHeaders, redirect: "manual" });
        const location = check.headers.get("location");
        if ((check.status === 301 || check.status === 302 || check.status === 307 || check.status === 308) && location) {
          currentUrl = location.startsWith("//") ? "https:" + location : location;
          fetchHeaders["Referer"] = new URL(currentUrl).origin + "/";
        } else {
          return new Response(null, {
            status: 302,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, OPTIONS',
              'Access-Control-Allow-Headers': '*',
              'Location': currentUrl,
            },
          });
        }
      }
      return new Response("Too many redirects", { status: 502 });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, { status: 502 });
    }
  }

  return new Response('Not Found', { status: 404 });
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
