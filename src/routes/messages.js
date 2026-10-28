const express = require('express');
const { requireAuth } = require('../auth');

function parsePositiveInteger(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function createMessagesRouter({ db, tokenSecret, sseHub }) {
  const router = express.Router();
  router.use(requireAuth({ db, tokenSecret }));

  router.use('/:roomId/messages', (req, res, next) => {
    const roomId = parsePositiveInteger(req.params.roomId);
    if (!roomId) return res.status(404).json({ error: 'Room not found' });
    const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const membership = db.prepare('SELECT 1 AS member FROM memberships WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Room membership required' });
    req.roomId = roomId;
    next();
  });

  router.post('/:roomId/messages', (req, res) => {
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > 4000) return res.status(400).json({ error: 'Message body must be 1–4000 characters' });

    db.exec('BEGIN IMMEDIATE');
    try {
      const allocation = db.prepare('UPDATE rooms SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq').get(req.roomId);
      if (!allocation) {
        db.exec('ROLLBACK');
        return res.status(404).json({ error: 'Room not found' });
      }
      const result = db.prepare('INSERT INTO messages (room_id, seq, user_id, body) VALUES (?, ?, ?, ?)')
        .run(req.roomId, allocation.seq, req.user.id, body);
      db.exec('COMMIT');

      const message = db.prepare(`
        SELECT m.id, m.room_id AS roomId, m.seq, m.user_id AS userId, u.username, m.body, m.created_at AS createdAt
        FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
      `).get(Number(result.lastInsertRowid));
      const persistedMessage = {
        ...message,
        id: Number(message.id),
        roomId: Number(message.roomId),
        seq: Number(message.seq),
        userId: Number(message.userId),
      };
      sseHub.publish(req.roomId, persistedMessage);
      return res.status(201).json({ message: persistedMessage });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });

  router.get('/:roomId/messages', (req, res) => {
    const before = req.query.before === undefined ? null : parsePositiveInteger(req.query.before);
    if (req.query.before !== undefined && before === null) return res.status(400).json({ error: 'before must be a positive integer' });
    const requestedLimit = req.query.limit === undefined ? 50 : parsePositiveInteger(req.query.limit);
    if (requestedLimit === null) return res.status(400).json({ error: 'limit must be a positive integer' });
    const limit = Math.min(requestedLimit, 100);

    const rows = before === null
      ? db.prepare(`
          SELECT m.id, m.room_id AS roomId, m.seq, m.user_id AS userId, u.username, m.body, m.created_at AS createdAt
          FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.room_id = ? ORDER BY m.seq DESC LIMIT ?
        `).all(req.roomId, limit)
      : db.prepare(`
          SELECT m.id, m.room_id AS roomId, m.seq, m.user_id AS userId, u.username, m.body, m.created_at AS createdAt
          FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.room_id = ? AND m.seq < ? ORDER BY m.seq DESC LIMIT ?
        `).all(req.roomId, before, limit);

    const messages = rows.reverse().map((message) => ({
      ...message,
      id: Number(message.id),
      roomId: Number(message.roomId),
      seq: Number(message.seq),
      userId: Number(message.userId),
    }));
    return res.json({ messages, nextBefore: messages.length ? messages[0].seq : null });
  });

  return router;
}

module.exports = { createMessagesRouter };
