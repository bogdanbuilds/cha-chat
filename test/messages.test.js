const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { signToken } = require('../src/auth');
const { createApp } = require('../src/server');

const db = createDatabase(':memory:');
const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('message_user', 'test-hash');
const userId = Number(result.lastInsertRowid);
const outsiderResult = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('message_outsider', 'test-hash');
const outsiderId = Number(outsiderResult.lastInsertRowid);
const tokenSecret = 'messages-test-secret';
const token = signToken(userId, tokenSecret);
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const outsiderHeaders = {
  authorization: `Bearer ${signToken(outsiderId, tokenSecret)}`,
  'content-type': 'application/json',
};
const app = createApp({ db, tokenSecret });
let server;
let baseUrl;
let roomId;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Messages' }),
  });
  assert.equal(response.status, 201);
  roomId = (await response.json()).room.id;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
});

test('assigns consecutive room sequences and paginates messages in ascending order', async () => {
  const post = (body) => fetch(`${baseUrl}/api/rooms/${roomId}/messages`, {
    method: 'POST', headers, body: JSON.stringify({ body }),
  });
  const firstResponse = await post('First message');
  const secondResponse = await post('Second message');
  assert.equal(firstResponse.status, 201);
  assert.equal(secondResponse.status, 201);
  const first = (await firstResponse.json()).message;
  const second = (await secondResponse.json()).message;
  assert.equal(second.seq, first.seq + 1);

  const pageResponse = await fetch(`${baseUrl}/api/rooms/${roomId}/messages?before=${second.seq + 1}&limit=10`, { headers });
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.json();
  assert.deepEqual(page.messages.map((message) => message.seq), [first.seq, second.seq]);
  assert.deepEqual(page.messages.map((message) => message.body), ['First message', 'Second message']);

  const earlierPageResponse = await fetch(`${baseUrl}/api/rooms/${roomId}/messages?before=${second.seq}&limit=1`, { headers });
  assert.equal(earlierPageResponse.status, 200);
  const earlierPage = await earlierPageResponse.json();
  assert.deepEqual(earlierPage.messages.map((message) => message.seq), [first.seq]);
});

test('non-members receive 403 when posting or reading room messages', async () => {
  const history = await fetch(`${baseUrl}/api/rooms/${roomId}/messages`, { headers: outsiderHeaders });
  const post = await fetch(`${baseUrl}/api/rooms/${roomId}/messages`, {
    method: 'POST', headers: outsiderHeaders, body: JSON.stringify({ body: 'Should be forbidden' }),
  });
  assert.equal(history.status, 403);
  assert.equal(post.status, 403);
});
