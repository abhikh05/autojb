/**
 * Single-user auth + secret-key encryption.
 *
 * Login: POST /api/login { password } → sets sid cookie (signed)
 * Every other /api/* endpoint requires sid or returns 401
 * (public: /api/health, /api/login, /api/logout, /api/auth/status)
 *
 * Secret storage:
 *   Master key comes from ENCRYPTION_KEY env (or is derived from AUTH_PASS).
 *   secrets.encrypt(plain) → { enc, iv, tag } stored in state
 *   secrets.mask(plain)    → 'sk-…9abc' for UI display (never returned raw)
 */
const crypto = require('crypto');

const AUTH_USER = (process.env.AUTH_USER || 'admin').trim();
const AUTH_PASS = (process.env.AUTH_PASS || '').trim();
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`${AUTH_USER}|${AUTH_PASS || 'unset'}|autojb-v2`).digest('hex');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SID_COOKIE = 'sid';

const isDisabled = () => !AUTH_PASS; // no password set → auth disabled (local dev / fresh deploy)

// ── Signed session token ─────────────────────────────────────
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || '').split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

// ── Route handlers ───────────────────────────────────────────
function authStatus(req, res) {
  if (isDisabled()) return res.json({ enabled: false, authenticated: true });
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[SID_COOKIE]);
  res.json({ enabled: true, authenticated: !!session, user: session?.u || null });
}

function login(req, res) {
  if (isDisabled()) return res.json({ ok: true, disabled: true });
  const { username = AUTH_USER, password } = req.body || {};
  const okUser = username === AUTH_USER;
  const okPass = password && crypto.timingSafeEqual(
    Buffer.from(password.padEnd(64, ' ')),
    Buffer.from(AUTH_PASS.padEnd(64, ' '))
  );
  if (!okUser || !okPass) {
    // constant-time-ish response
    setTimeout(() => res.status(401).json({ ok: false, error: 'Invalid credentials' }), 250);
    return;
  }
  const token = signSession({ u: AUTH_USER, exp: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', buildCookie(SID_COOKIE, token, SESSION_TTL_MS));
  res.json({ ok: true, user: AUTH_USER });
}

function logout(req, res) {
  res.setHeader('Set-Cookie', buildCookie(SID_COOKIE, '', 0));
  res.json({ ok: true });
}

function buildCookie(name, value, ttlMs) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (ttlMs <= 0) attrs.push('Max-Age=0');
  else attrs.push(`Max-Age=${Math.floor(ttlMs / 1000)}`);
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

// Express middleware — put on ALL /api/* except public endpoints
const PUBLIC_PATHS = new Set(['/api/health', '/api/login', '/api/logout', '/api/auth/status']);
function requireAuth(req, res, next) {
  if (isDisabled()) return next();
  if (PUBLIC_PATHS.has(req.path) || req.path === '/health') return next();
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[SID_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  req.auth = session;
  next();
}

// ── Secret encryption ─────────────────────────────────────────
const MASTER = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || SESSION_SECRET).digest();

const secrets = {
  encrypt(plain) {
    if (!plain) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { enc: enc.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), v: 1 };
  },
  decrypt(box) {
    if (!box || !box.enc) return '';
    try {
      const iv = Buffer.from(box.iv, 'base64');
      const tag = Buffer.from(box.tag, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(Buffer.from(box.enc, 'base64')), decipher.final()]);
      return dec.toString('utf8');
    } catch (e) {
      return '';
    }
  },
  mask(plain) {
    if (!plain) return '';
    const s = String(plain);
    if (s.length <= 6) return '••••';
    return s.slice(0, 3) + '••••••••' + s.slice(-4);
  }
};

module.exports = {
  requireAuth,
  login,
  logout,
  authStatus,
  secrets,
  isDisabled,
  PUBLIC_PATHS
};
