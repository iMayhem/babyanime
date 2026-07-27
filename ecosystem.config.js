module.exports = {
  apps: [
    {
      name: 'babyanime',
      script: 'server.js',
      cwd: __dirname,
      env: { PORT: 3000 }
    },
    {
      name: 'anime-scraper',
      script: 'server.js',
      cwd: __dirname + '/scraper',
      env: { PORT: 4000 }
    },
    {
      name: 'babyanime-scraper-server',
      script: 'server.js',
      cwd: __dirname + '/scraper-server',
      env: { PORT: 4001 }
    },
    {
      name: 'arceus',
      script: 'scraper/arceus/start.sh',
      interpreter: 'bash',
      cwd: __dirname,
      env: { PORT: 5000 }
    }
  ]
};
