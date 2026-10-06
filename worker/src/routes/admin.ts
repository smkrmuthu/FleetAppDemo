import { Hono } from 'hono';
import type { Env, Vars } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';
import { backupStatus, runBackup } from '../lib/backup';
import { checkRateLimit } from '../lib/rateLimit';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
adminRoutes.use('*', requireAuth);
adminRoutes.use('*', requireRole('manager'));

// When the last nightly backup ran, what it held, and whether the latest run failed.
adminRoutes.get('/backups', async (c) => c.json(await backupStatus(c.env)));

// "Back up now". Returns only counts, never data.
adminRoutes.post('/backups/run', async (c) => {
  const limit = await checkRateLimit(c.env.DB, c.get('auth').orgId, { windowSeconds: 60, maxRequests: 2, keyPrefix: 'backup_run' });
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.resetInSeconds));
    return c.json({ error: { code: 'rate_limited', message: 'A backup was just run — wait a minute and try again.' } }, 429);
  }
  const manifest = await runBackup(c.env);
  return c.json(manifest);
});
