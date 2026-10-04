import { createHash, randomBytes } from 'node:crypto';
import type { PublicUser } from '@subterfuge/engine';
import type { Sql } from '../db.ts';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sessions are random 256-bit tokens kept in an httpOnly cookie. Only the
 * SHA-256 of the token is stored, so a leaked database can't be used to
 * log in as anyone.
 */
function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function createSession(sql: Sql, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${expiresAt})`;
  return { token, expiresAt };
}

export async function findSessionUser(sql: Sql, token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  const [user] = await sql<PublicUser[]>`
    SELECT u.id, u.username
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()`;
  return user ?? null;
}

export async function deleteSession(sql: Sql, token: string | undefined): Promise<void> {
  if (!token) return;
  await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
}

export async function deleteExpiredSessions(sql: Sql): Promise<number> {
  const result = await sql`DELETE FROM sessions WHERE expires_at <= now()`;
  return result.count;
}
