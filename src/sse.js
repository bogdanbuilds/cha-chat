function createSseHub({ db, heartbeatMs = 25_000 }) {
  const subscribersByRoom = new Map();

  function sendMessage(subscriber, message) {
    if (message.seq <= subscriber.lastSeq) return;
    subscriber.lastSeq = message.seq;
    subscriber.res.write(`id: ${message.seq}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
  }

  function publish(roomId, message) {
    const subscribers = subscribersByRoom.get(roomId);
    if (!subscribers) return;
    for (const subscriber of subscribers) {
      if (subscriber.replaying) subscriber.pending.push(message);
      else sendMessage(subscriber, message);
    }
  }

  function subscribe(roomId, res, requestedCursor) {
    let subscribers = subscribersByRoom.get(roomId);
    if (!subscribers) {
      subscribers = new Set();
      subscribersByRoom.set(roomId, subscribers);
    }

    const subscriber = { res, lastSeq: requestedCursor, replaying: true, pending: [] };
    subscribers.add(subscriber);

    // Clamp a stale or cross-room cursor so it cannot suppress future events.
    const latest = Number(db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE room_id = ?').get(roomId).seq);
    subscriber.lastSeq = Math.min(requestedCursor, latest);
    const replay = db.prepare(`
      SELECT m.id, m.room_id AS roomId, m.seq, m.user_id AS userId, u.username, m.body, m.created_at AS createdAt
      FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? AND m.seq > ? ORDER BY m.seq ASC
    `).all(roomId, subscriber.lastSeq);

    for (const row of replay) {
      sendMessage(subscriber, {
        ...row,
        id: Number(row.id),
        roomId: Number(row.roomId),
        seq: Number(row.seq),
        userId: Number(row.userId),
      });
    }

    subscriber.replaying = false;
    subscriber.pending.sort((left, right) => left.seq - right.seq);
    for (const message of subscriber.pending) sendMessage(subscriber, message);
    subscriber.pending = [];

    const heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
    }, heartbeatMs);
    heartbeat.unref?.();

    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      subscribers.delete(subscriber);
      if (subscribers.size === 0) subscribersByRoom.delete(roomId);
    };
  }

  return { publish, subscribe };
}

module.exports = { createSseHub };
