const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { signToken } = require('../src/auth');
const { createApp } = require('../src/server');

const db = createDatabase(':memory:');
const ownerResult = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('stream_owner', 'test-hash');
const ownerId = Number(ownerResult.lastInsertRowid);
const memberResult = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('stream_member', 'test-hash');
const memberId = Number(memberResult.lastInsertRowid);
const tokenSecret = 'stream-test-secret';
const headersFor = (userId) => ({ authorization: `Bearer ${signToken(userId, tokenSecret)}`, 'content-type': 'application/json' });
const ownerHeaders = headersFor(ownerId);
const memberHeaders = headersFor(memberId);
const app = createApp({ db, tokenSecret });
let server;
let baseUrl;
let roomId;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Live updates' }),
  });
  assert.equal(roomResponse.status, 201);
  roomId = (await roomResponse.json()).room.id;
  const memberResponse = await fetch(`${baseUrl}/api/rooms/${roomId}/members`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ userId: memberId }),
  });
  assert.equal(memberResponse.status, 200);
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
});

async function readNextMessage(stream) {
  while (true) {
    const { value, done } = await stream.reader.read();
    if (done) throw new Error('SSE stream closed before a message arrived');
    stream.buffer += new TextDecoder().decode(value, { stream: true });
    const eventEnd = stream.buffer.indexOf('\n\n');
    if (eventEnd < 0) continue;
    const block = stream.buffer.slice(0, eventEnd);
    stream.buffer = stream.buffer.slice(eventEnd + 2);
    const id = block.match(/^id: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (data) return { id: Number(id), data: JSON.parse(data) };
  }
}

async function openStream(headers, lastEventId) {
  const requestHeaders = { ...headers };
  if (lastEventId !== undefined) requestHeaders['last-event-id'] = String(lastEventId);
  const response = await fetch(`${baseUrl}/api/rooms/${roomId}/stream`, { headers: requestHeaders });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  return { reader: response.body.getReader(), buffer: '' };
}

test('broadcasts a posted message to two subscribers and replays it after reconnect', async () => {
  const firstSubscriber = await openStream(ownerHeaders);
  const secondSubscriber = await openStream(memberHeaders);
  try {
    const postResponse = await fetch(`${baseUrl}/api/rooms/${roomId}/messages`, {
      method: 'POST', headers: ownerHeaders, body: JSON.stringify({ body: 'Hello everyone' }),
    });
    assert.equal(postResponse.status, 201);
    const posted = (await postResponse.json()).message;

    const delivered = await Promise.all([readNextMessage(firstSubscriber), readNextMessage(secondSubscriber)]);
    for (const event of delivered) {
      assert.equal(event.id, posted.seq);
      assert.equal(event.data.body, 'Hello everyone');
    }
  } finally {
    await Promise.all([firstSubscriber.reader.cancel(), secondSubscriber.reader.cancel()]);
  }

  const reconnect = await openStream(memberHeaders, 0);
  try {
    const replayed = await readNextMessage(reconnect);
    assert.equal(replayed.id, 1);
    assert.equal(replayed.data.body, 'Hello everyone');
  } finally {
    await reconnect.reader.cancel();
  }
});
