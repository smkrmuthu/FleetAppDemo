import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb } from '../db';
import { drivers, vehicles } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const driverRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
driverRoutes.use('*', requireAuth);

driverRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const includeInactive = c.req.query('include_inactive') === 'true';
  const conditions = [eq(drivers.orgId, orgId)];
  if (!includeInactive) conditions.push(eq(drivers.active, true));
  // Insertion order (rowid) — without an ORDER BY, editing a row can move it.
  const rows = await db.select().from(drivers).where(and(...conditions)).orderBy(sql`rowid`);

  const in60Days = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  return c.json({
    drivers: rows.map((d) => ({ ...d, expiring: !!d.licenceExpiry && d.licenceExpiry <= in60Days }))
  });
});

const createSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional(),
  licenceNo: z.string().optional(),
  licenceExpiry: z.string().optional(),
  credential: z.string().optional(),
  defaultVehicle: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional()
});

driverRoutes.post('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const db = getDb(c.env);
  // The driver's full name is the id — every screen already treats a
  // driver's name as their identity (Trip.driverId, filters, People rows),
  // same simplification already made for vehicles/reg_no. Names colliding
  // across a large roster is the real risk this trades away; a surrogate
  // id plus a display name is the fix if that ever bites.
  const id = parsed.data.fullName.trim();
  const [existing] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
  if (existing && (existing.orgId !== auth.orgId || existing.active)) {
    return c.json({ error: { code: 'conflict', message: `A driver named ${id} already exists` } }, 409);
  }
  if (existing) {
    // Deleting a driver only deactivates them, so adding the same name again
    // brings the old record back rather than colliding with it.
    await db.update(drivers).set({
      active: true,
      phone: parsed.data.phone ?? existing.phone,
      licenceNo: parsed.data.licenceNo ?? existing.licenceNo,
      licenceExpiry: parsed.data.licenceExpiry ?? existing.licenceExpiry,
      credential: parsed.data.credential ?? existing.credential,
      defaultVehicle: parsed.data.defaultVehicle ?? existing.defaultVehicle
    }).where(eq(drivers.id, id));
    await writeAudit(db, auth.orgId, 'drivers', id, 'reactivate', parsed.data, auth.userId);
  } else {
    await db.insert(drivers).values({ ...parsed.data, id, fullName: id, orgId: auth.orgId, active: true });
    await writeAudit(db, auth.orgId, 'drivers', id, 'insert', parsed.data, auth.userId);
  }

  const [row] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
  return c.json(row, 201);
});

// A driver's name is their identity (trips, filters, reports all key on it),
// so it can't be edited — only the details around it.
const patchSchema = z.object({
  phone: z.string().nullable().optional(),
  licenceNo: z.string().nullable().optional(),
  licenceExpiry: z.string().nullable().optional(),
  credential: z.string().nullable().optional(),
  defaultVehicle: z.string().nullable().optional()
});

driverRoutes.patch('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  // A cleared field arrives as '' — store it as null, not an empty string.
  const changes: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) changes[k] = v && v.trim() ? v.trim() : null;
  if (Object.keys(changes).length === 0) return c.json({ error: { code: 'validation_error', message: 'Nothing to update' } }, 422);

  const db = getDb(c.env);
  if (changes.defaultVehicle) {
    const [veh] = await db.select().from(vehicles).where(and(eq(vehicles.id, changes.defaultVehicle), eq(vehicles.orgId, auth.orgId))).limit(1);
    if (!veh) return c.json({ error: { code: 'validation_error', message: `Truck ${changes.defaultVehicle} doesn't exist`, field: 'defaultVehicle' } }, 422);
  }
  const result = await db.update(drivers).set(changes).where(and(eq(drivers.id, id), eq(drivers.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Driver not found' } }, 404);
  await writeAudit(db, auth.orgId, 'drivers', id, 'update', changes, auth.userId);

  const [row] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
  return c.json(row);
});

// Soft delete — matches vehicles: deactivate, never remove, so past trips
// keep resolving driver_id.
driverRoutes.delete('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const result = await db.update(drivers).set({ active: false }).where(and(eq(drivers.id, id), eq(drivers.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Driver not found' } }, 404);
  // A removed driver can't stay a truck's default — Add Movement would
  // pre-fill someone who's no longer in the Driver list.
  await db.update(vehicles).set({ defaultDriver: null }).where(and(eq(vehicles.defaultDriver, id), eq(vehicles.orgId, auth.orgId)));
  await writeAudit(db, auth.orgId, 'drivers', id, 'deactivate', {}, auth.userId);
  return c.json({ ok: true });
});
