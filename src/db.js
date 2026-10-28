const { DatabaseSync } = require('node:sqlite');

function createDatabase(filename = process.env.DATABASE_PATH || 'chat.sqlite3') {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS memberships (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (room_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS memberships_by_user ON memberships(user_id, room_id);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK (seq > 0),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (room_id, seq)
    );
    CREATE INDEX IF NOT EXISTS messages_by_room_seq ON messages(room_id, seq);
  `);

  // Existing databases created before message sequencing need the room counter.
  const roomColumns = db.prepare('PRAGMA table_info(rooms)').all();
  if (!roomColumns.some((column) => column.name === 'next_seq')) {
    db.exec('ALTER TABLE rooms ADD COLUMN next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0)');
  }
  return db;
}

module.exports = { createDatabase };
