import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb, nowIso } from '../db';
import { settings } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { writeAudit } from '../lib/audit';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
settingsRoutes.use('*', requireAuth);

const KEY = { dieselRate: 'diesel_rate', adblueRate: 'adblue_rate', loadingPoint: 'default_loading_point' } as const;

function payload(rows: { key: string; value: string }[]) {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string) => (byKey.has(k) ? Number(byKey.get(k)) : null);
  return { dieselRate: num(KEY.dieselRate), adblueRate: num(KEY.adblueRate), loadingPoint: byKey.get(KEY.loadingPoint) ?? null };
}

// Every role reads these — a driver logging fuel in Add Movement needs the
// current price — but only Office/Manager change them.
settingsRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const rows = await db.select().from(settings).where(eq(settings.orgId, orgId));
  return c.json(payload(rows));
});

const rate = z
  .number()
  .positive()
  .max(1000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: 'Use at most 2 decimal places' })
  .nullable()
  .optional();

// The place new movements start from; blank clears it.
const loadingPoint = z.string().trim().max(200).nullable().optional();

const patchSchema = z.object({ dieselRate: rate, adblueRate: rate, loadingPoint });

settingsRoutes.patch('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'validation_error', message: 'Rates must be above 0 with at most 2 decimal places, and the loading point at most 200 characters' } }, 422);
  }

  const db = getDb(c.env);
  const now = nowIso();
  const changes: Record<string, number | string | null> = {};
  for (const [field, key] of Object.entries(KEY) as [keyof typeof KEY, string][]) {
    const raw = parsed.data[field];
    if (raw === undefined) continue;
    const v = raw === '' ? null : raw;
    changes[field] = v;
    if (v === null) {
      await db.delete(settings).where(and(eq(settings.orgId, auth.orgId), eq(settings.key, key)));
    } else {
      await db
        .insert(settings)
        .values({ orgId: auth.orgId, key, value: String(v), updatedAt: now, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [settings.orgId, settings.key], set: { value: String(v), updatedAt: now, updatedBy: auth.userId } });
    }
  }
  if (Object.keys(changes).length === 0) return c.json({ error: { code: 'validation_error', message: 'Nothing to update' } }, 422);
  await writeAudit(db, auth.orgId, 'settings', 'master', 'update', changes, auth.userId);

  const rows = await db.select().from(settings).where(eq(settings.orgId, auth.orgId));
  return c.json(payload(rows));
});
