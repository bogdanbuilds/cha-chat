const express = require('express');
const { requireAuth } = require('../auth');

function parseRoomId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function createRoomsRouter({ db, tokenSecret }) {
  const router = express.Router();
  router.use(requireAuth({ db, tokenSecret }));

  router.post('/', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) return res.status(400).json({ error: 'Room name must be 1–80 characters' });

    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('INSERT INTO rooms (name, created_by) VALUES (?, ?)').run(name, req.user.id);
      const roomId = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO memberships (room_id, user_id) VALUES (?, ?)').run(roomId, req.user.id);
      db.exec('COMMIT');
      const room = db.prepare('SELECT id, name, created_by AS createdBy, created_at AS createdAt FROM rooms WHERE id = ?').get(roomId);
      return res.status(201).json({ room: { ...room, id: Number(room.id), createdBy: Number(room.createdBy) } });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });

  router.get('/', (req, res) => {
    const rooms = db.prepare(`
      SELECT r.id, r.name, r.created_by AS createdBy, r.created_at AS createdAt
      FROM rooms r JOIN memberships m ON m.room_id = r.id
      WHERE m.user_id = ? ORDER BY r.id
    `).all(req.user.id).map((room) => ({ ...room, id: Number(room.id), createdBy: Number(room.createdBy) }));
    return res.json({ rooms });
  });

  function requireRoomMembership(req, res, next) {
    const roomId = parseRoomId(req.params.roomId);
    if (!roomId) return res.status(404).json({ error: 'Room not found' });
    const room = db.prepare('SELECT id, name, created_by AS createdBy, created_at AS createdAt FROM rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const membership = db.prepare('SELECT 1 AS member FROM memberships WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Room membership required' });
    req.room = { ...room, id: Number(room.id), createdBy: Number(room.createdBy) };
    next();
  }

  router.get('/:roomId', requireRoomMembership, (req, res) => res.json({ room: req.room }));

  router.get('/:roomId/members', requireRoomMembership, (req, res) => {
    const members = db.prepare(`
      SELECT u.id AS userId, u.username, m.joined_at AS joinedAt
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? ORDER BY u.username COLLATE NOCASE
    `).all(req.room.id).map((member) => ({ ...member, userId: Number(member.userId) }));
    return res.json({ members });
  });

  router.post('/:roomId/members', requireRoomMembership, (req, res) => {
    if (req.room.createdBy !== req.user.id) return res.status(403).json({ error: 'Only the room creator can add members' });
    const userId = req.body.userId;
    if (!Number.isSafeInteger(userId) || userId < 1) return res.status(400).json({ error: 'userId must be a positive integer' });

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    db.prepare('INSERT OR IGNORE INTO memberships (room_id, user_id) VALUES (?, ?)').run(req.room.id, userId);
    const member = db.prepare('SELECT joined_at AS joinedAt FROM memberships WHERE room_id = ? AND user_id = ?').get(req.room.id, userId);
    return res.status(200).json({ member: { userId: Number(user.id), username: user.username, joinedAt: member.joinedAt } });
  });

  return router;
}

module.exports = { createRoomsRouter };
