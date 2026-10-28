const express = require('express');
const { requireAuth } = require('../auth');

function parseCursor(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

function createStreamRouter({ db, tokenSecret, sseHub }) {
  const router = express.Router();
  router.use(requireAuth({ db, tokenSecret }));

  router.get('/:roomId/stream', (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.roomId) || !Number.isSafeInteger(Number(req.params.roomId))) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const roomId = Number(req.params.roomId);
    const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const membership = db.prepare('SELECT 1 AS member FROM memberships WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Room membership required' });

    const headerCursor = req.get('last-event-id');
    const queryCursor = req.query.after;
    const cursorText = headerCursor !== undefined ? headerCursor : queryCursor;
    const cursor = cursorText === undefined ? 0 : parseCursor(cursorText);
    if (cursor === null) return res.status(400).json({ error: 'Last-Event-ID or after must be a non-negative integer' });

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const cleanup = sseHub.subscribe(roomId, res, cursor);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });

  return router;
}

module.exports = { createStreamRouter };
