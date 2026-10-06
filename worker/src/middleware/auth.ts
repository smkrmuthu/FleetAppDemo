import type { Context, Next } from 'hono';
import type { Env, Role, Vars } from '../types';
import { verifyAccessToken } from '../lib/jwt';
import { resolveAuth, viewerBlocked } from '../lib/authCheck';
import { getDb } from '../db';
import { users } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Verifies the bearer token and sets `auth` on the context from it. Every
 * downstream route reads org_id / role / driver_id from c.get('auth') —
 * never from the request body or query string. This is the entire tenant
 * isolation boundary; there is no database-level RLS backing it up on D1.
 */
export async function requireAuth(c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return c.json({ error: { code: 'unauthorized', message: 'Missing bearer token' } }, 401);

  let tokenAuth;
  try {
    tokenAuth = await verifyAccessToken(token, c.env.JWT_SECRET);
  } catch {
    return c.json({ error: { code: 'unauthorized', message: 'Invalid or expired token' } }, 401);
  }

  // Trust the database, not the token, for who this is and what they may do.
  const [account] = await getDb(c.env)
    .select({ orgId: users.orgId, role: users.role, driverId: users.driverId, disabledAt: users.disabledAt })
    .from(users).where(eq(users.id, tokenAuth.userId)).limit(1);
  const auth = resolveAuth(tokenAuth, account);
  if (!auth) return c.json({ error: { code: 'unauthorized', message: 'This account is no longer active' } }, 401);
  c.set('auth', auth);

  if (auth.role === 'viewer' && viewerBlocked(c.req.method, c.req.path)) {
    return c.json({ error: { code: 'forbidden', message: 'This account is read-only' } }, 403);
  }
  await next();
}

export function requireRole(...roles: Role[]) {
  return async (c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) => {
    const auth = c.get('auth');
    if (!roles.includes(auth.role)) {
      return c.json({ error: { code: 'forbidden', message: `Requires role: ${roles.join(' or ')}` } }, 403);
    }
    await next();
  };
}
