/**
 * Anime Embed Reverse Proxy Worker
 *
 * Acts as a full reverse proxy for embed sites.
 * Client loads embed from worker URL (same origin),
 * worker proxies everything with proper headers,
 * video streams go through proxy.peestream.in.
 *
 * Routes:
 *   /aniplay/*   -> https://animeplay.cfd/*
 *   /moviesrc/*  -> https://movie-src.xyz/*
 *   /vidsrccc/*  -> https://vidsrc.cc/*
 *   /vidsrcto/*  -> https://vidsrc.to/*
 *   /megaplay/*  -> https://megaplay.buzz/*
 */

const PROXY_BASE = 'https://proxy.peestream.in/proxy';

const ROUTES = [
  { prefix: '/aniplay/', target: 'https://animeplay.cfd/', ref: 'https://animeplay.cfd/' },
  { prefix: '/moviesrc/', target: 'https://movie-src.xyz/', ref: 'https://movie-src.xyz/' },
  { prefix: '/vidsrccc/', target: 'https://vidsrc.cc/', ref: 'https://vidsrc.cc/' },
  { prefix: '/vidsrcto/', target: 'https://vidsrc.to/', ref: 'https://vidsrc.to/' },
  { prefix: '/megaplay/', target: 'https://megaplay.buzz/', ref: 'https://megaplay.buzz/' },
];

function findRoute(path) {
  for (const r of ROUTES) {
    if (path.startsWith(r.prefix)) {
      const rest = path.slice(r.prefix.length);
      return { ...r, rest, upstreamUrl: r.target + rest };
    }
  }
  return null;
}

// Rewrite HTML: make all absolute URLs go through this worker
function rewriteHtml(html, route, workerOrigin) {
  const prefix = route.prefix;
  const target = route.target;

  // Rewrite absolute URLs that point to the target domain
  html = html.replace(
    new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    workerOrigin + prefix
  );

  // Rewrite protocol-relative URLs
  html = html.replace(
    new RegExp('//' + target.replace(/https?:\/\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    workerOrigin + prefix
  );

  // Rewrite complete absolute URLs to other known embed domains
  for (const r of ROUTES) {
    if (r.target !== target) {
      html = html.replace(
        new RegExp(r.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        workerOrigin + r.prefix
      );
    }
  }

  return html;
}

function shouldProxyThroughPeestream(contentType, url) {
  if (!contentType) return false;
  // Video streams and segments
  if (contentType.includes('video/')) return true;
  if (contentType.includes('application/vnd.apple.mpegurl')) return true;
  if (url.includes('.m3u8') || url.includes('.ts') || url.includes('.mp4')) return true;
  if (url.includes('.m4s') || url.includes('.key')) return true;
  return false;
}

async function proxyRequest(request, route) {
  const upstreamUrl = route.upstreamUrl;
  const targetOrigin = new URL(route.target).origin;
  const workerUrl = new URL(request.url);
  const workerOrigin = workerUrl.origin;

  // Prepare upstream request headers
  const upstreamHeaders = new Headers();
  // Forward safe headers
  const safeHeaders = ['user-agent', 'accept', 'accept-language', 'accept-encoding', 'range', 'cookie', 'dnt', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
  for (const h of safeHeaders) {
    const val = request.headers.get(h);
    if (val) upstreamHeaders.set(h, val);
  }
  upstreamHeaders.set('Referer', route.ref);
  upstreamHeaders.set('Origin', targetOrigin);

  const upstreamResp = await fetch(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual'
  });

  // Handle redirects
  if (upstreamResp.status >= 300 && upstreamResp.status < 400) {
    const loc = upstreamResp.headers.get('location');
    if (loc) {
      // If redirect goes to another embed domain, rewrite it
      let newLoc = loc;
      for (const r of ROUTES) {
        if (loc.startsWith(r.target)) {
          newLoc = workerOrigin + r.prefix + loc.slice(r.target.length);
          break;
        }
      }
      return new Response(null, {
        status: 302,
        headers: { location: newLoc, 'access-control-allow-origin': '*' }
      });
    }
  }

  const contentType = upstreamResp.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html');
  const isVideo = shouldProxyThroughPeestream(contentType, upstreamUrl);

  // For video content, proxy through proxy.peestream.in
  if (isVideo) {
    const proxyUrl = new URL(PROXY_BASE);
    proxyUrl.searchParams.set('url', upstreamUrl);
    proxyUrl.searchParams.set('referer', route.ref);

    const proxyResp = await fetch(proxyUrl, {
      headers: {
        'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
        Referer: route.ref,
        Origin: targetOrigin,
        Range: request.headers.get('range') || ''
      }
    });

    const respHeaders = new Headers(proxyResp.headers);
    respHeaders.set('access-control-allow-origin', '*');
    respHeaders.set('access-control-expose-headers', 'content-range, accept-ranges');
    return new Response(proxyResp.body, {
      status: proxyResp.status,
      headers: respHeaders
    });
  }

  // For HTML, rewrite URLs in the response
  if (isHtml) {
    const text = await upstreamResp.text();
    const rewritten = rewriteHtml(text, route, workerOrigin);
    const respHeaders = new Headers(upstreamResp.headers);
    respHeaders.set('access-control-allow-origin', '*');
    // Remove security headers that prevent embedding
    respHeaders.delete('x-frame-options');
    respHeaders.delete('content-security-policy');
    respHeaders.delete('frame-ancestors');
    return new Response(rewritten, {
      status: upstreamResp.status,
      headers: respHeaders
    });
  }

  // For everything else (JS, CSS, images), pass through
  const respHeaders = new Headers(upstreamResp.headers);
  respHeaders.set('access-control-allow-origin', '*');
  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers: respHeaders
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': '*',
          'access-control-max-age': '86400'
        }
      });
    }

    // Reverse proxy routes
    const route = findRoute(path);
    if (route) {
      try {
        return await proxyRequest(request, route);
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
        });
      }
    }

    // Root
    return new Response(JSON.stringify({
      name: 'Anime Embed Proxy Worker',
      routes: ROUTES.map(r => r.prefix)
    }), {
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    });
  }
};
