const express = require('express');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { createDatabase } = require('./db');
const { requireAuth } = require('./auth');
const { createAuthRouter } = require('./routes/auth');
const { createRoomsRouter } = require('./routes/rooms');
const { createMessagesRouter } = require('./routes/messages');
const { createStreamRouter } = require('./routes/stream');
const { createSseHub } = require('./sse');

function createApp({ db = createDatabase(), tokenSecret = process.env.AUTH_TOKEN_SECRET || randomBytes(32).toString('hex') } = {}) {
  const app = express();
  const sseHub = createSseHub({ db });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRouter({ db, tokenSecret }));
  app.get('/api/auth/me', requireAuth({ db, tokenSecret }), (req, res) => res.json({ user: req.user }));
  app.use('/api/rooms', createRoomsRouter({ db, tokenSecret }));
  app.use('/api/rooms', createMessagesRouter({ db, tokenSecret, sseHub }));
  app.use('/api/rooms', createStreamRouter({ db, tokenSecret, sseHub }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Group chat API listening on port ${port}`));
}

module.exports = { createApp };
