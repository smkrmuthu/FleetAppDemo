import { Hono } from 'hono';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb } from '../db';
import { drivers, vehicles } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const vehicleRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
vehicleRoutes.use('*', requireAuth);

vehicleRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const includeInactive = c.req.query('include_inactive') === 'true';
  const conditions = [eq(vehicles.orgId, orgId)];
  if (!includeInactive) conditions.push(eq(vehicles.active, true));
  // Insertion order (rowid) — without an ORDER BY, editing a row can move it.
  const rows = await db.select().from(vehicles).where(and(...conditions)).orderBy(sql`rowid`);

  const in60Days = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  return c.json({
    vehicles: rows.map((v) => ({ ...v, renewalDue: !!v.fcRenewalDue && v.fcRenewalDue <= in60Days }))
  });
});

// '' means "no date" (a cleared field); anything else must be a real ISO date.
const isoDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a valid date');

const createSchema = z.object({
  regNo: z.string().min(1),
  model: z.string().optional(),
  fcDate: z.string().optional(),
  fcRenewalDue: z.string().optional(),
  regDate: isoDate.optional(),
  batchNo: z.string().trim().max(60).optional(),
  taxDate: isoDate.optional(),
  inspectionDate: isoDate.optional(),
  npDate: isoDate.optional(),
  pollutionDate: isoDate.optional(),
  owner: z.string().trim().max(120).optional(),
  customFields: z.record(z.string(), z.unknown()).optional()
});

vehicleRoutes.post('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const db = getDb(c.env);
  // The registration number *is* the id — every screen already treats a
  // vehicle's plate number as its identity, so a separate surrogate id
  // would just be a join everyone has to remember to do.
  const id = parsed.data.regNo.trim();
  const [existing] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  if (existing && (existing.orgId !== auth.orgId || existing.active)) {
    return c.json({ error: { code: 'conflict', message: `A truck with registration ${id} already exists` } }, 409);
  }
  if (existing) {
    // Deleting a truck only deactivates it, so adding the same registration
    // again brings the old record back rather than colliding with it.
    await db.update(vehicles).set({
      active: true,
      model: parsed.data.model ?? existing.model,
      fcDate: parsed.data.fcDate ?? existing.fcDate,
      fcRenewalDue: parsed.data.fcRenewalDue ?? existing.fcRenewalDue,
      regDate: parsed.data.regDate || existing.regDate,
      batchNo: parsed.data.batchNo || existing.batchNo,
      taxDate: parsed.data.taxDate || existing.taxDate,
      inspectionDate: parsed.data.inspectionDate || existing.inspectionDate,
      npDate: parsed.data.npDate || existing.npDate,
      pollutionDate: parsed.data.pollutionDate || existing.pollutionDate,
      owner: parsed.data.owner || existing.owner
    }).where(eq(vehicles.id, id));
    await writeAudit(db, auth.orgId, 'vehicles', id, 'reactivate', parsed.data, auth.userId);
  } else {
    // An empty string means "left blank" — store nothing rather than ''.
    const blankToNull = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));
    await db.insert(vehicles).values({ ...blankToNull(parsed.data), id, regNo: id, orgId: auth.orgId, active: true });
    await writeAudit(db, auth.orgId, 'vehicles', id, 'insert', parsed.data, auth.userId);
  }

  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  return c.json(row, 201);
});

// The registration number is the truck's identity everywhere (trips, filters,
// reports), so it can't be edited — only the details around it.
const patchSchema = z.object({
  model: z.string().nullable().optional(),
  fcDate: z.string().nullable().optional(),
  fcRenewalDue: z.string().nullable().optional(),
  regDate: isoDate.nullable().optional(),
  batchNo: z.string().trim().max(60).nullable().optional(),
  taxDate: isoDate.nullable().optional(),
  inspectionDate: isoDate.nullable().optional(),
  npDate: isoDate.nullable().optional(),
  pollutionDate: isoDate.nullable().optional(),
  owner: z.string().trim().max(120).nullable().optional(),
  defaultDriver: z.string().nullable().optional()
});

vehicleRoutes.patch('/:id', requireRole('office', 'manager'), async (c) => {
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
  if (changes.defaultDriver) {
    const [drv] = await db.select().from(drivers).where(and(eq(drivers.id, changes.defaultDriver), eq(drivers.orgId, auth.orgId), eq(drivers.active, true))).limit(1);
    if (!drv) return c.json({ error: { code: 'validation_error', message: `${changes.defaultDriver} isn't an active driver`, field: 'defaultDriver' } }, 422);
    const [taken] = await db.select({ id: vehicles.id }).from(vehicles)
      .where(and(eq(vehicles.orgId, auth.orgId), eq(vehicles.active, true), eq(vehicles.defaultDriver, changes.defaultDriver), ne(vehicles.id, id))).limit(1);
    if (taken) return c.json({ error: { code: 'validation_error', message: `${changes.defaultDriver} is already the default driver of ${taken.id}`, field: 'defaultDriver' } }, 422);
  }
  const result = await db.update(vehicles).set(changes).where(and(eq(vehicles.id, id), eq(vehicles.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Vehicle not found' } }, 404);
  await writeAudit(db, auth.orgId, 'vehicles', id, 'update', changes, auth.userId);

  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  return c.json(row);
});

// Soft delete — a vehicle with existing trips is deactivated, never removed,
// so historical trips still resolve their vehicle reference.
vehicleRoutes.delete('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const result = await db.update(vehicles).set({ active: false }).where(and(eq(vehicles.id, id), eq(vehicles.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Vehicle not found' } }, 404);
  await writeAudit(db, auth.orgId, 'vehicles', id, 'deactivate', {}, auth.userId);
  return c.json({ ok: true });
});
