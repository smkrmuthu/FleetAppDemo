import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb } from '../db';
import { expenseCategories } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const expenseCategoryRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
expenseCategoryRoutes.use('*', requireAuth);

// Any authed role may read; only Office/Manager add or remove one (matches
// who can reach Monthly Expenses and Master at all).
expenseCategoryRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  // Insertion order (rowid), same convention as vehicles/drivers.
  const rows = await db.select().from(expenseCategories).where(and(eq(expenseCategories.orgId, orgId), eq(expenseCategories.active, true))).orderBy(sql`rowid`);
  return c.json({ expenseCategories: rows.map((r) => r.id) });
});

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

expenseCategoryRoutes.post('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const db = getDb(c.env);
  // The name itself is the id — same "no separate surrogate key" choice
  // made for trucks (registration no.) and drivers (full name).
  const id = parsed.data.name;
  const [existing] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, id)).limit(1);
  if (existing && (existing.orgId !== auth.orgId || existing.active)) {
    return c.json({ error: { code: 'conflict', message: `"${id}" already exists` } }, 409);
  }
  if (existing) {
    await db.update(expenseCategories).set({ active: true }).where(eq(expenseCategories.id, id));
    await writeAudit(db, auth.orgId, 'expense_categories', id, 'reactivate', {}, auth.userId);
  } else {
    await db.insert(expenseCategories).values({ id, orgId: auth.orgId, active: true });
    await writeAudit(db, auth.orgId, 'expense_categories', id, 'insert', {}, auth.userId);
  }
  return c.json({ id }, 201);
});

// Soft delete — a description already used on past expense entries keeps
// showing there; it just stops being offered for new ones.
expenseCategoryRoutes.delete('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const result = await db.update(expenseCategories).set({ active: false }).where(and(eq(expenseCategories.id, id), eq(expenseCategories.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Description not found' } }, 404);
  await writeAudit(db, auth.orgId, 'expense_categories', id, 'deactivate', {}, auth.userId);
  return c.json({ ok: true });
});
