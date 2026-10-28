const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken } = require('../auth');

const BCRYPT_ROUNDS = 12;

function createAuthRouter({ db, tokenSecret }) {
  const router = express.Router();

  router.post('/register', async (req, res, next) => {
    try {
      const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
      const password = req.body.password;
      if (!/^[A-Za-z0-9_]{3,32}$/.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 72) {
        return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, or underscores; password must be 8–72 characters' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      let result;
      try {
        result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Username is already taken' });
        throw error;
      }
      const user = { id: Number(result.lastInsertRowid), username };
      return res.status(201).json({ user, token: signToken(user.id, tokenSecret) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
      const password = req.body.password;
      const userRecord = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE').get(username);
      const passwordMatches = userRecord && typeof password === 'string' && await bcrypt.compare(password, userRecord.password_hash);
      if (!passwordMatches) return res.status(401).json({ error: 'Invalid username or password' });

      const user = { id: Number(userRecord.id), username: userRecord.username };
      return res.json({ user, token: signToken(user.id, tokenSecret) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAuthRouter };
