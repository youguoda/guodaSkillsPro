const express = require('express');
const path = require('path');
const config = require('./config');
const apiRouter = require('./api');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API routes
app.use('/api', apiRouter);

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start listening
const server = app.listen(config.PORT, () => {
  console.log('\n================================================================');
  console.log('       SkillsHub: AI Agent Skills Manager Web Console           ');
  console.log('================================================================');
  console.log(`\n  Web Console ready at: \x1b[36mhttp://localhost:${config.PORT}\x1b[0m`);
  console.log(`  Windows Root:         ${config.WIN_USER_HOME}`);
  console.log(`  WSL Distribution:     ${config.WSL_DISTRO} (User: ${config.WSL_USER})`);
  console.log(`  WSL UNC Root:         ${config.WSL_HOME_UNC}`);
  console.log('\n  Press Ctrl+C to stop.\n');
});

module.exports = { app, server };
