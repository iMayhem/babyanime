const express = require('express');
const path = require('path');
const http = require('http');
const app = express();

const PORT = process.env.PORT || 3000;
const SCRAPER_PORT = process.env.SCRAPER_PORT || 4001;

// Serve static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy requests to the scraper server
app.use('/scraper', (req, res) => {
  const targetPath = req.originalUrl.replace(/^\/scraper/, '');
  const options = {
    hostname: '127.0.0.1',
    port: SCRAPER_PORT,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${SCRAPER_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.status(502).json({ error: 'Scraper server unavailable' });
  });

  if (req.body) proxyReq.write(req.body);
  proxyReq.end();
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Watch route
app.get('/watch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// Catch-all route to redirect back to homepage
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
