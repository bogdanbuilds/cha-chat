const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/server');

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`);
const app = createApp({ db, tokenSecret: 'test-token-secret' });
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
});

test('registers a user, logs in, and rejects a wrong password', async () => {
  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'chat_user', password: 'correct-horse-123' }),
  });
  assert.equal(registerResponse.status, 201);
  const registration = await registerResponse.json();
  assert.equal(registration.user.username, 'chat_user');
  assert.ok(registration.token);

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'chat_user', password: 'correct-horse-123' }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.user.id, registration.user.id);
  assert.ok(login.token);

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal(meResponse.status, 200);

  const badLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'chat_user', password: 'wrong-password' }),
  });
  assert.equal(badLoginResponse.status, 401);
});

test('protected route rejects missing and invalid bearer tokens with 401', async () => {
  const missing = await fetch(`${baseUrl}/api/auth/me`);
  const invalid = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: 'Bearer invalid.token' } });
  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
});
