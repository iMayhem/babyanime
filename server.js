const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Serve static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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
  console.log(`==================================================`);
});
