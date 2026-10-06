import { Hono } from 'hono';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb } from '../db';
import { users } from '../../drizzle/schema';
import { verifyPassword } from '../lib/password';
import { signAccessToken } from '../lib/jwt';
import { requireAuth } from '../middleware/auth';
import { checkRateLimit, getClientIp } from '../lib/rateLimit';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

// `identifier` is either the phone number or the optional Manager-set User ID
// (see users.userId) — either works with the account's password. `phone` is
// accepted too, purely so an already-deployed frontend build doesn't break
// during the rollout window before it picks up the `identifier` rename.
const loginSchema = z
  .object({ identifier: z.string().min(1).optional(), phone: z.string().min(1).optional(), password: z.string().min(1) })
  .refine((v) => v.identifier || v.phone, { message: 'identifier required' });

// OTP sign-in (POST /auth/otp:request, /auth/otp:verify) is not implemented
// yet — it needs an SMS provider (Twilio or similar) this deployment isn't
// wired to. Password is the only working sign-in path for now; see
// design/handoff/API.md.
authRoutes.post('/password', async (c) => {
  const clientIp = getClientIp(c.req.raw);
  const ipLimit = await checkRateLimit(c.env.DB, clientIp, { windowSeconds: 60, maxRequests: 10, keyPrefix: 'auth_ip' });
  if (!ipLimit.allowed) {
    c.header('Retry-After', String(ipLimit.resetInSeconds));
    return c.json(
      { error: { code: 'rate_limited', message: `Too many sign-in attempts from this network. Please wait ${ipLimit.resetInSeconds} seconds.` } },
      429
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Phone/User ID and password required' } }, 422);

  const identifier = (parsed.data.identifier ?? parsed.data.phone)!;
  const identifierKey = identifier.toLowerCase().trim();
  const identifierLimit = await checkRateLimit(c.env.DB, identifierKey, { windowSeconds: 60, maxRequests: 5, keyPrefix: 'auth_account' });
  if (!identifierLimit.allowed) {
    c.header('Retry-After', String(identifierLimit.resetInSeconds));
    return c.json(
      { error: { code: 'rate_limited', message: `Too many sign-in attempts for this account. Please wait ${identifierLimit.resetInSeconds} seconds.` } },
      429
    );
  }

  const db = getDb(c.env);
  const [user] = await db.select().from(users)
    .where(or(eq(users.phone, identifier), eq(users.userId, identifier)))
    .limit(1);
  if (!user || !user.passwordHash || !user.passwordSalt || user.disabledAt) {
    return c.json({ error: { code: 'invalid_credentials', message: 'Phone/User ID or password is incorrect' } }, 401);
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash, user.passwordSalt);
  if (!ok) return c.json({ error: { code: 'invalid_credentials', message: 'Phone/User ID or password is incorrect' } }, 401);

  const access = await signAccessToken(
    { orgId: user.orgId, userId: user.id, role: user.role, driverId: user.driverId },
    c.env.JWT_SECRET
  );

  return c.json({
    access,
    user: { id: user.id, name: user.fullName, role: user.role, phone: user.phone, orgId: user.orgId }
  });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const auth = c.get('auth');
  const db = getDb(c.env);
  const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user) return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);
  return c.json({ id: user.id, name: user.fullName, role: user.role, phone: user.phone, orgId: user.orgId });
});
