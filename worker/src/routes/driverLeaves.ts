import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb, newId, nowIso } from '../db';
import { driverLeaves, drivers } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const driverLeaveRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
driverLeaveRoutes.use('*', requireAuth);

// "2026-09-25T09:00" — an <input type="datetime-local"> value, kept as the
// naive local string it comes in as (no timezone conversion), matching how
// trip dates are handled elsewhere in this app.
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const datetimeField = z.string().regex(DATETIME, 'Enter a valid date and time');

// Any authed role may read (Add Movement could eventually warn if the
// driver picked is on leave); only Office/Manager record or remove one.
driverLeaveRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const rows = await db.select().from(driverLeaves).where(eq(driverLeaves.orgId, orgId)).orderBy(asc(driverLeaves.startsAt));
  return c.json({ driverLeaves: rows });
});

const createSchema = z
  .object({
    driverId: z.string().min(1),
    startsAt: datetimeField,
    endsAt: datetimeField,
    remarks: z.string().trim().max(300).optional()
  })
  .refine((d) => d.endsAt > d.startsAt, { message: 'End must be after start', path: ['endsAt'] });

driverLeaveRoutes.post('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? parsed.error.message, field: parsed.error.issues[0]?.path[0] } }, 422);
  }

  const db = getDb(c.env);
  const [driver] = await db.select({ id: drivers.id }).from(drivers)
    .where(and(eq(drivers.id, parsed.data.driverId), eq(drivers.orgId, auth.orgId), eq(drivers.active, true))).limit(1);
  if (!driver) return c.json({ error: { code: 'validation_error', message: 'Select an active driver', field: 'driverId' } }, 422);

  const id = newId();
  const now = nowIso();
  await db.insert(driverLeaves).values({
    id, orgId: auth.orgId, driverId: parsed.data.driverId, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt,
    remarks: parsed.data.remarks || null, createdBy: auth.userId, createdAt: now
  });
  await writeAudit(db, auth.orgId, 'driver_leaves', id, 'insert', parsed.data, auth.userId);

  const [row] = await db.select().from(driverLeaves).where(eq(driverLeaves.id, id)).limit(1);
  return c.json(row, 201);
});

driverLeaveRoutes.delete('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const [existing] = await db.select().from(driverLeaves).where(and(eq(driverLeaves.id, id), eq(driverLeaves.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Leave record not found' } }, 404);

  await db.delete(driverLeaves).where(eq(driverLeaves.id, id));
  await writeAudit(db, auth.orgId, 'driver_leaves', id, 'delete', { driverId: existing.driverId, startsAt: existing.startsAt, endsAt: existing.endsAt }, auth.userId);
  return c.json({ ok: true });
});
