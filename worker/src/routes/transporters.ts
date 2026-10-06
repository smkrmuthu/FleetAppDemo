import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb } from '../db';
import { transporters } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const transporterRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
transporterRoutes.use('*', requireAuth);

// Any authed role may read — Add Movement offers these in a dropdown, and a
// driver login can enter movements too. Only Office/Manager add or remove one.
transporterRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const rows = await db.select().from(transporters).where(and(eq(transporters.orgId, orgId), eq(transporters.active, true))).orderBy(sql`rowid`);
  return c.json({ transporters: rows.map((r) => r.id) });
});

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });

transporterRoutes.post('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const db = getDb(c.env);
  // The name itself is the id, same as expense descriptions, trucks and drivers.
  const id = parsed.data.name;
  const [existing] = await db.select().from(transporters).where(eq(transporters.id, id)).limit(1);
  if (existing && (existing.orgId !== auth.orgId || existing.active)) {
    return c.json({ error: { code: 'conflict', message: `"${id}" already exists` } }, 409);
  }
  if (existing) {
    await db.update(transporters).set({ active: true }).where(eq(transporters.id, id));
    await writeAudit(db, auth.orgId, 'transporters', id, 'reactivate', {}, auth.userId);
  } else {
    await db.insert(transporters).values({ id, orgId: auth.orgId, active: true });
    await writeAudit(db, auth.orgId, 'transporters', id, 'insert', {}, auth.userId);
  }
  return c.json({ id }, 201);
});

// Soft delete — movements already logged under a transporter keep its name;
// it just stops being offered for new ones.
transporterRoutes.delete('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const result = await db.update(transporters).set({ active: false }).where(and(eq(transporters.id, id), eq(transporters.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Transporter not found' } }, 404);
  await writeAudit(db, auth.orgId, 'transporters', id, 'deactivate', {}, auth.userId);
  return c.json({ ok: true });
});
