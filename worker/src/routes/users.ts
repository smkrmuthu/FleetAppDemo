import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb, newId } from '../db';
import { users } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { hashPassword } from '../lib/password';
import { writeAudit } from '../lib/audit';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
userRoutes.use('*', requireAuth);

userRoutes.get('/', requireRole('office', 'manager'), async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const rows = await db.select().from(users).where(eq(users.orgId, orgId)).orderBy(sql`rowid`);
  return c.json({ users: rows.map(({ passwordHash, passwordSalt, ...safe }) => safe) });
});

const inviteSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(6),
  role: z.enum(['driver', 'office', 'manager', 'viewer']),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  branchId: z.string().optional(),
  driverId: z.string().optional(),
  userId: z.string().optional()
});

// A real invite flow (SMS/email link, user sets their own password) is
// future work — Manager sets an initial password directly for now.
userRoutes.post('/invite', requireRole('manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const db = getDb(c.env);
  if (parsed.data.userId) {
    const [clash] = await db.select().from(users).where(and(eq(users.orgId, auth.orgId), eq(users.userId, parsed.data.userId))).limit(1);
    if (clash) return c.json({ error: { code: 'conflict', message: `User ID "${parsed.data.userId}" is already used by ${clash.fullName}` } }, 409);
  }

  const { password, ...rest } = parsed.data;
  const { hash, salt } = await hashPassword(password);
  const id = newId();
  await db.insert(users).values({ id, orgId: auth.orgId, passwordHash: hash, passwordSalt: salt, ...rest });
  await writeAudit(db, auth.orgId, 'users', id, 'insert', { fullName: rest.fullName, role: rest.role }, auth.userId);

  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return c.json({ error: { code: 'not_found', message: 'User not found after insert' } }, 500);
  const { passwordHash: _h, passwordSalt: _s, ...safe } = row;
  return c.json(safe, 201);
});

const patchSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(6).optional(),
  role: z.enum(['driver', 'office', 'manager', 'viewer']).optional(),
  branchId: z.string().nullable().optional(),
  userId: z.string().nullable().optional()
});

userRoutes.patch('/:id', requireRole('manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Enter a name and a valid mobile number' } }, 422);

  const db = getDb(c.env);
  const [existing] = await db.select().from(users).where(and(eq(users.id, id), eq(users.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);

  // Nobody can demote themselves — with only managers able to edit accounts,
  // that's how an org ends up with no one able to fix anything.
  if (parsed.data.role && parsed.data.role !== existing.role && existing.id === auth.userId) {
    return c.json({ error: { code: 'forbidden', message: "You can't change your own role" } }, 409);
  }
  if (parsed.data.phone && parsed.data.phone !== existing.phone) {
    const [clash] = await db.select().from(users).where(and(eq(users.orgId, auth.orgId), eq(users.phone, parsed.data.phone))).limit(1);
    if (clash) return c.json({ error: { code: 'conflict', message: `${parsed.data.phone} is already used by ${clash.fullName}` } }, 409);
  }
  const nextUserId = parsed.data.userId && parsed.data.userId.trim() ? parsed.data.userId.trim() : null;
  if (nextUserId && nextUserId !== existing.userId) {
    const [clash] = await db.select().from(users).where(and(eq(users.orgId, auth.orgId), eq(users.userId, nextUserId))).limit(1);
    if (clash) return c.json({ error: { code: 'conflict', message: `User ID "${nextUserId}" is already used by ${clash.fullName}` } }, 409);
  }

  const changes: Record<string, string | null> = {};
  if (parsed.data.fullName !== undefined) changes.fullName = parsed.data.fullName;
  if (parsed.data.phone !== undefined) changes.phone = parsed.data.phone;
  if (parsed.data.role !== undefined) changes.role = parsed.data.role;
  if (parsed.data.branchId !== undefined) changes.branchId = parsed.data.branchId && parsed.data.branchId.trim() ? parsed.data.branchId : null;
  if (parsed.data.userId !== undefined) changes.userId = nextUserId;
  if (Object.keys(changes).length === 0) return c.json({ error: { code: 'validation_error', message: 'Nothing to update' } }, 422);

  await db.update(users).set(changes as any).where(and(eq(users.id, id), eq(users.orgId, auth.orgId)));
  await writeAudit(db, auth.orgId, 'users', id, 'update', changes, auth.userId);

  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);
  const { passwordHash: _h, passwordSalt: _s, ...safe } = row;
  return c.json(safe);
});

const passwordSchema = z.object({ password: z.string().min(8, 'Password must be at least 8 characters') });

// Manager sets a user's password directly — there's no "forgot password"
// self-service flow yet (see the /invite comment above), so this is also
// how a locked-out user gets back in. The new password is never logged;
// the audit entry only records that a reset happened and by whom.
userRoutes.post('/:id/password', requireRole('manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Enter a password' } }, 422);

  const db = getDb(c.env);
  const [existing] = await db.select().from(users).where(and(eq(users.id, id), eq(users.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);

  const { hash, salt } = await hashPassword(parsed.data.password);
  await db.update(users).set({ passwordHash: hash, passwordSalt: salt }).where(and(eq(users.id, id), eq(users.orgId, auth.orgId)));
  await writeAudit(db, auth.orgId, 'users', id, 'password_reset', {}, auth.userId);
  return c.json({ ok: true });
});

// Manager only — Office can manage vehicles/drivers but never deletes a
// user account.
userRoutes.delete('/:id', requireRole('manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const result = await db.delete(users).where(and(eq(users.id, id), eq(users.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);
  await writeAudit(db, auth.orgId, 'users', id, 'delete', {}, auth.userId);
  return c.json({ ok: true });
});
