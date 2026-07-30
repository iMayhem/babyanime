const express = require('express');
const path = require('path');
const http = require('http');

const app = express();

const PORT = process.env.PORT || 3000;
const SCRAPER_PORT = process.env.SCRAPER_PORT || 4001;

const ONE_DAY = 86400;
const ONE_WEEK = 604800;
const ONE_YEAR = 31536000;

const mimeMaxAge = {
  'text/html':                   0,
  'text/css':                    ONE_DAY,
  'application/javascript':      ONE_DAY,
  'application/x-javascript':    ONE_DAY,
  'image/svg+xml':               ONE_WEEK,
  'image/png':                   ONE_WEEK,
  'image/jpeg':                  ONE_WEEK,
  'image/gif':                   ONE_WEEK,
  'image/webp':                  ONE_WEEK,
  'image/x-icon':                ONE_WEEK,
  'font/woff':                   ONE_YEAR,
  'font/woff2':                  ONE_YEAR,
  'font/ttf':                    ONE_YEAR,
  'application/font-woff':       ONE_YEAR,
  'application/font-woff2':      ONE_YEAR,
  'application/json':            300,
  'default':                     3600,
};

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let cacheValue = 'public, max-age=3600';
    if (ext === '.html') {
      cacheValue = 'public, max-age=0, must-revalidate';
    } else if (ext === '.css' || ext === '.js') {
      cacheValue = `public, max-age=${ONE_DAY}`;
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(ext)) {
      cacheValue = `public, max-age=${ONE_WEEK}`;
    } else if (['.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
      cacheValue = `public, max-age=${ONE_YEAR}, immutable`;
    } else if (ext === '.json') {
      cacheValue = 'public, max-age=300';
    }
    res.setHeader('Cache-Control', cacheValue);
  },
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), {
    headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
});

app.get('/watch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'), {
    headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
});

const proxyCache = new Map();
const PROXY_CACHE_TTL = 30000;

app.use('/scraper', (req, res) => {
  if (req.method !== 'GET') {
    return proxyRequest(req, res);
  }

  const cacheKey = req.originalUrl;
  const cached = proxyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PROXY_CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Content-Type', cached.contentType);
    return res.status(cached.status).send(cached.body);
  }

  proxyRequest(req, res, (status, contentType, body) => {
    if (status >= 200 && status < 500) {
      proxyCache.set(cacheKey, { ts: Date.now(), status, contentType, body });
    }
  });
});

function proxyRequest(req, res, onDone) {
  const targetPath = req.originalUrl.replace(/^\/scraper/, '');
  const options = {
    hostname: '127.0.0.1',
    port: SCRAPER_PORT,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${SCRAPER_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);
      if (onDone) {
        const ctype = proxyRes.headers['content-type'] || 'application/octet-stream';
        onDone(proxyRes.statusCode, ctype, body);
      }
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        'Cache-Control': 'public, max-age=30',
      });
      res.end(body);
    });
  });

  proxyReq.on('error', () => {
    res.status(502).json({ error: 'Scraper server unavailable' });
  });

  if (req.body) proxyReq.write(req.body);
  proxyReq.end();
}

app.get('*', (req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` babyanime server successfully initialized!       `);
  console.log(` Running locally at: http://localhost:${PORT}      `);
  console.log(` Scraper proxy: /scraper → :${SCRAPER_PORT}       `);
  console.log(`==================================================`);
});
