const { createHmac, timingSafeEqual } = require('node:crypto');

const TOKEN_TTL_SECONDS = 60 * 60 * 24;

function signToken(userId, secret, now = Math.floor(Date.now() / 1000)) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: now + TOKEN_TTL_SECONDS })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, suppliedSignature] = parts;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(claims.sub) || !Number.isSafeInteger(claims.exp) || claims.exp <= now) return null;
    return { userId: claims.sub };
  } catch {
    return null;
  }
}

function requireAuth({ db, tokenSecret }) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const claims = match && verifyToken(match[1], tokenSecret);
    if (!claims) return res.status(401).json({ error: 'Unauthorized' });

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(claims.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  };
}

module.exports = { requireAuth, signToken, verifyToken };
