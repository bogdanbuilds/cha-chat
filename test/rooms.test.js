const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { signToken } = require('../src/auth');
const { createApp } = require('../src/server');

const db = createDatabase(':memory:');
const userIds = {};
for (const username of ['room_owner', 'room_member', 'room_outsider']) {
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, 'test-hash');
  userIds[username] = Number(result.lastInsertRowid);
}

const secret = 'rooms-test-secret';
const app = createApp({ db, tokenSecret: secret });
const tokenFor = (username) => signToken(userIds[username], secret);
const headersFor = (username) => ({ authorization: `Bearer ${tokenFor(username)}`, 'content-type': 'application/json' });
let server;
let baseUrl;
let roomId;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: headersFor('room_owner'),
    body: JSON.stringify({ name: 'Planning' }),
  });
  assert.equal(response.status, 201);
  roomId = (await response.json()).room.id;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
});

test('room creator can add a member and members can access the room', async () => {
  const addResponse = await fetch(`${baseUrl}/api/rooms/${roomId}/members`, {
    method: 'POST',
    headers: headersFor('room_owner'),
    body: JSON.stringify({ userId: userIds.room_member }),
  });
  assert.equal(addResponse.status, 200);

  const memberRoomResponse = await fetch(`${baseUrl}/api/rooms/${roomId}`, { headers: headersFor('room_member') });
  assert.equal(memberRoomResponse.status, 200);
  assert.equal((await memberRoomResponse.json()).room.name, 'Planning');

  const memberListResponse = await fetch(`${baseUrl}/api/rooms/${roomId}/members`, { headers: headersFor('room_member') });
  assert.equal(memberListResponse.status, 200);
  const { members } = await memberListResponse.json();
  assert.deepEqual(members.map((member) => member.userId).sort((a, b) => a - b), [userIds.room_owner, userIds.room_member].sort((a, b) => a - b));
});

test('non-members receive 403 from every room-specific endpoint', async () => {
  const detail = await fetch(`${baseUrl}/api/rooms/${roomId}`, { headers: headersFor('room_outsider') });
  const members = await fetch(`${baseUrl}/api/rooms/${roomId}/members`, { headers: headersFor('room_outsider') });
  const addMember = await fetch(`${baseUrl}/api/rooms/${roomId}/members`, {
    method: 'POST',
    headers: headersFor('room_outsider'),
    body: JSON.stringify({ userId: userIds.room_outsider }),
  });
  assert.equal(detail.status, 403);
  assert.equal(members.status, 403);
  assert.equal(addMember.status, 403);
});
