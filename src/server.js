const express = require('express');
const { randomBytes } = require('node:crypto');
const { createDatabase } = require('./db');
const { requireAuth } = require('./auth');
const { createAuthRouter } = require('./routes/auth');
const { createRoomsRouter } = require('./routes/rooms');
const { createMessagesRouter } = require('./routes/messages');

function createApp({ db = createDatabase(), tokenSecret = process.env.AUTH_TOKEN_SECRET || randomBytes(32).toString('hex') } = {}) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRouter({ db, tokenSecret }));
  app.get('/api/auth/me', requireAuth({ db, tokenSecret }), (req, res) => res.json({ user: req.user }));
  app.use('/api/rooms', createRoomsRouter({ db, tokenSecret }));
  app.use('/api/rooms', createMessagesRouter({ db, tokenSecret }));
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
