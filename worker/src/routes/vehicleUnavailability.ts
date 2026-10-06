import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb, newId, nowIso } from '../db';
import { vehicleUnavailability, vehicles } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const vehicleUnavailabilityRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
vehicleUnavailabilityRoutes.use('*', requireAuth);

// "2026-09-25T09:00" — an <input type="datetime-local"> value, kept as the
// naive local string it comes in as (no timezone conversion), matching how
// trip dates and driver leave are handled elsewhere in this app.
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const datetimeField = z.string().regex(DATETIME, 'Enter a valid date and time');

// Any authed role may read — Add Movement blocks picking an unavailable
// truck for the trip's dates; only Office/Manager record or remove one.
vehicleUnavailabilityRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const rows = await db.select().from(vehicleUnavailability).where(eq(vehicleUnavailability.orgId, orgId)).orderBy(asc(vehicleUnavailability.startsAt));
  return c.json({ vehicleUnavailability: rows });
});

const createSchema = z
  .object({
    vehicleId: z.string().min(1),
    startsAt: datetimeField,
    endsAt: datetimeField,
    remarks: z.string().trim().max(300).optional()
  })
  .refine((d) => d.endsAt > d.startsAt, { message: 'End must be after start', path: ['endsAt'] });

vehicleUnavailabilityRoutes.post('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? parsed.error.message, field: parsed.error.issues[0]?.path[0] } }, 422);
  }

  const db = getDb(c.env);
  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles)
    .where(and(eq(vehicles.id, parsed.data.vehicleId), eq(vehicles.orgId, auth.orgId), eq(vehicles.active, true))).limit(1);
  if (!vehicle) return c.json({ error: { code: 'validation_error', message: 'Select an active truck', field: 'vehicleId' } }, 422);

  const id = newId();
  const now = nowIso();
  await db.insert(vehicleUnavailability).values({
    id, orgId: auth.orgId, vehicleId: parsed.data.vehicleId, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt,
    remarks: parsed.data.remarks || null, createdBy: auth.userId, createdAt: now
  });
  await writeAudit(db, auth.orgId, 'vehicle_unavailability', id, 'insert', parsed.data, auth.userId);

  const [row] = await db.select().from(vehicleUnavailability).where(eq(vehicleUnavailability.id, id)).limit(1);
  return c.json(row, 201);
});

const patchSchema = z
  .object({
    vehicleId: z.string().min(1),
    startsAt: datetimeField,
    endsAt: datetimeField,
    remarks: z.string().trim().max(300).optional()
  })
  .refine((d) => d.endsAt > d.startsAt, { message: 'End must be after start', path: ['endsAt'] });

// Replaces the whole record — the edit form always sends every field.
vehicleUnavailabilityRoutes.patch('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? parsed.error.message, field: parsed.error.issues[0]?.path[0] } }, 422);
  }

  const db = getDb(c.env);
  const [existing] = await db.select().from(vehicleUnavailability).where(and(eq(vehicleUnavailability.id, id), eq(vehicleUnavailability.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Unavailability record not found' } }, 404);

  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles)
    .where(and(eq(vehicles.id, parsed.data.vehicleId), eq(vehicles.orgId, auth.orgId), eq(vehicles.active, true))).limit(1);
  if (!vehicle) return c.json({ error: { code: 'validation_error', message: 'Select an active truck', field: 'vehicleId' } }, 422);

  await db.update(vehicleUnavailability).set({
    vehicleId: parsed.data.vehicleId, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt, remarks: parsed.data.remarks || null
  }).where(eq(vehicleUnavailability.id, id));
  await writeAudit(db, auth.orgId, 'vehicle_unavailability', id, 'update', parsed.data, auth.userId);

  const [row] = await db.select().from(vehicleUnavailability).where(eq(vehicleUnavailability.id, id)).limit(1);
  return c.json(row);
});

vehicleUnavailabilityRoutes.delete('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const [existing] = await db.select().from(vehicleUnavailability).where(and(eq(vehicleUnavailability.id, id), eq(vehicleUnavailability.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Unavailability record not found' } }, 404);

  await db.delete(vehicleUnavailability).where(eq(vehicleUnavailability.id, id));
  await writeAudit(db, auth.orgId, 'vehicle_unavailability', id, 'delete', { vehicleId: existing.vehicleId, startsAt: existing.startsAt, endsAt: existing.endsAt }, auth.userId);
  return c.json({ ok: true });
});
