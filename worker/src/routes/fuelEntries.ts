import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb, newId } from '../db';
import { fuelEntries, tripExpenses, trips, vehicles } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

// Diesel fills saved without a trip. Office and Manager only (drivers never
// enter fuel). See the fuel_entries table for the lifecycle.
export const fuelEntryRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
fuelEntryRoutes.use('*', requireAuth);
fuelEntryRoutes.use('*', requireRole('office', 'manager'));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const fields = {
  spentOn: isoDate,
  litres: z.number().positive(),
  ratePaise: z.number().int().positive(),
  amountPaise: z.number().int().nonnegative(),
  details: z.string().trim().max(300).nullable().optional()
};

fuelEntryRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const rows = await db.select().from(fuelEntries).where(eq(fuelEntries.orgId, orgId)).orderBy(sql`rowid`);
  return c.json({ fuelEntries: rows });
});

const createSchema = z.object({ vehicleId: z.string().min(1), ...fields });

fuelEntryRoutes.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  const d = parsed.data;

  const db = getDb(c.env);
  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, d.vehicleId), eq(vehicles.orgId, auth.orgId))).limit(1);
  if (!vehicle) return c.json({ error: { code: 'validation_error', message: `Truck "${d.vehicleId}" not found`, field: 'vehicleId' } }, 422);

  const row = {
    id: newId(), orgId: auth.orgId, vehicleId: d.vehicleId, spentOn: d.spentOn, litres: d.litres, ratePaise: d.ratePaise,
    amountPaise: d.amountPaise, details: d.details?.trim() ? d.details.trim() : null, createdBy: auth.userId
  };
  await db.insert(fuelEntries).values(row);
  await writeAudit(db, auth.orgId, 'fuel_entries', row.id, 'insert', { vehicleId: row.vehicleId, litres: row.litres, amountPaise: row.amountPaise }, auth.userId);
  const [saved] = await db.select().from(fuelEntries).where(eq(fuelEntries.id, row.id)).limit(1);
  return c.json(saved, 201);
});

// Edit an unassigned entry. Passing `tripId` puts it on that trip: the fill
// becomes a diesel line of the trip and leaves this list (one batch, so it
// can't end up in both places or in neither). The trip must belong to the
// same truck; Office can only use a trip that isn't approved.
const patchSchema = z.object({ ...fields, tripId: z.string().min(1).optional() });

fuelEntryRoutes.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  const { tripId, ...d } = parsed.data;

  const db = getDb(c.env);
  const [entry] = await db.select().from(fuelEntries).where(and(eq(fuelEntries.id, id), eq(fuelEntries.orgId, auth.orgId))).limit(1);
  if (!entry) return c.json({ error: { code: 'not_found', message: 'Fuel entry not found' } }, 404);

  const changes = { spentOn: d.spentOn, litres: d.litres, ratePaise: d.ratePaise, amountPaise: d.amountPaise, details: d.details?.trim() ? d.details.trim() : null };

  if (!tripId) {
    await db.update(fuelEntries).set(changes).where(eq(fuelEntries.id, id));
    await writeAudit(db, auth.orgId, 'fuel_entries', id, 'update', changes, auth.userId);
    const [saved] = await db.select().from(fuelEntries).where(eq(fuelEntries.id, id)).limit(1);
    return c.json(saved);
  }

  const [trip] = await db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (trip.vehicleId !== entry.vehicleId) {
    return c.json({ error: { code: 'validation_error', message: `That trip is for ${trip.vehicleId}, not ${entry.vehicleId}`, field: 'tripId' } }, 422);
  }
  if (auth.role === 'office' && trip.status === 'approved') {
    return c.json({ error: { code: 'forbidden', message: 'Only a manager can add fuel to a completed movement' } }, 403);
  }

  const line = { id, orgId: auth.orgId, tripId, spentOn: changes.spentOn, kind: 'diesel' as const, litres: changes.litres, ratePaise: changes.ratePaise, amountPaise: changes.amountPaise, details: changes.details, createdBy: entry.createdBy ?? auth.userId, createdAt: entry.createdAt };
  await db.batch([db.insert(tripExpenses).values(line), db.delete(fuelEntries).where(eq(fuelEntries.id, id))]);
  await writeAudit(db, auth.orgId, 'fuel_entries', id, 'assign', { tripId }, auth.userId);
  await writeAudit(db, auth.orgId, 'trip_expenses', id, 'insert', { tripId, kind: 'diesel', from: 'fuel_entries' }, auth.userId);
  return c.json({ assignedTo: tripId, line });
});

fuelEntryRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const result = await db.delete(fuelEntries).where(and(eq(fuelEntries.id, id), eq(fuelEntries.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Fuel entry not found' } }, 404);
  await writeAudit(db, auth.orgId, 'fuel_entries', id, 'delete', {}, auth.userId);
  return c.json({ ok: true });
});
