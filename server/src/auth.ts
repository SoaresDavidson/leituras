import { hash, verify } from '@node-rs/argon2';
import type { NextFunction, Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY = 'password_hash';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export async function setPassword(db: Db, password: string): Promise<void> {
  const passwordHash = await hash(password);
  db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(PASSWORD_KEY, passwordHash);
  // Changing the password logs out every session
  db.prepare('DELETE FROM session').run();
}

export async function checkPassword(db: Db, password: string): Promise<boolean> {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(PASSWORD_KEY) as { value: string } | undefined;
  if (!row) return false;
  return verify(row.value, password);
}

export function createSession(db: Db, res: Response): void {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM session WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO session (token_hash, expires_at) VALUES (?, ?)')
    .run(sha256(token).toString('hex'), Date.now() + SESSION_TTL_MS);
  // No `secure` flag: the server is reached over plain HTTP on the LAN
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', maxAge: SESSION_TTL_MS, path: '/' });
}

function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function destroySession(db: Db, req: Request, res: Response): void {
  const token = readSessionToken(req);
  if (token) db.prepare('DELETE FROM session WHERE token_hash = ?').run(sha256(token).toString('hex'));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireSession(db: Db) {
  const find = db.prepare('SELECT 1 FROM session WHERE token_hash = ? AND expires_at > ?');
  return (req: Request, res: Response, next: NextFunction) => {
    const token = readSessionToken(req);
    if (token && find.get(sha256(token).toString('hex'), Date.now())) return next();
    res.status(401).json({ error: 'Não autenticado' });
  };
}

export function requirePluginToken(expected: string) {
  const expectedHash = sha256(expected);
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Hashing both sides gives equal-length buffers for timingSafeEqual
    if (expected && provided && timingSafeEqual(sha256(provided), expectedHash)) return next();
    res.status(401).json({ error: 'Invalid token' });
  };
}

// Fixed-window limiter, in memory: a restart resets it, which is fine for one user
export function loginRateLimit(maxAttempts = 5, windowMs = 60_000) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxAttempts) {
      res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
      return;
    }
    entry.count++;
    next();
  };
}
