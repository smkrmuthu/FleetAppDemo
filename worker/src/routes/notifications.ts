import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import type { Env, Vars } from '../types';
import { getDb } from '../db';
import { notifications } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
// Office/Manager only — a driver isn't the audience for approval/alert
// notifications about their own or others' movements.
notificationRoutes.use('*', requireAuth, requireRole('office', 'manager'));

notificationRoutes.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  const rows = await db.select().from(notifications).where(eq(notifications.orgId, orgId)).orderBy(desc(notifications.createdAt));
  return c.json({ notifications: rows });
});

notificationRoutes.post('/:id/read', async (c) => {
  const { orgId } = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.id, id), eq(notifications.orgId, orgId)));
  return c.json({ ok: true });
});

notificationRoutes.post('/read-all', async (c) => {
  const { orgId } = c.get('auth');
  const db = getDb(c.env);
  await db.update(notifications).set({ read: true }).where(eq(notifications.orgId, orgId));
  return c.json({ ok: true });
});
