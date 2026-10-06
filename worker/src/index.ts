import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Vars } from './types';
import { authRoutes } from './routes/auth';
import { tripRoutes } from './routes/trips';
import { vehicleRoutes } from './routes/vehicles';
import { driverRoutes } from './routes/drivers';
import { monthlyExpenseRoutes } from './routes/monthlyExpenses';
import { userRoutes } from './routes/users';
import { notificationRoutes } from './routes/notifications';
import { receiptRoutes } from './routes/receipts';
import { settingsRoutes } from './routes/settings';
import { driverLeaveRoutes } from './routes/driverLeaves';
import { expenseCategoryRoutes } from './routes/expenseCategories';
import { vehicleUnavailabilityRoutes } from './routes/vehicleUnavailability';
import { transporterRoutes } from './routes/transporters';
import { adminRoutes } from './routes/admin';
import { fuelEntryRoutes } from './routes/fuelEntries';
import { runBackup } from './lib/backup';
import { purgeExpiredRateLimits } from './lib/rateLimit';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());
  return cors({ origin: allowed, allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] })(c, next);
});

app.get('/', (c) => c.json({ name: 'fleet-ledger-demo-api', ok: true }));

app.route('/v1/auth', authRoutes);
app.route('/v1/trips', tripRoutes);
app.route('/v1/vehicles', vehicleRoutes);
app.route('/v1/drivers', driverRoutes);
app.route('/v1/monthly-expenses', monthlyExpenseRoutes);
app.route('/v1/users', userRoutes);
app.route('/v1/notifications', notificationRoutes);
app.route('/v1/receipts', receiptRoutes);
app.route('/v1/settings', settingsRoutes);
app.route('/v1/driver-leaves', driverLeaveRoutes);
app.route('/v1/expense-categories', expenseCategoryRoutes);
app.route('/v1/vehicle-unavailability', vehicleUnavailabilityRoutes);
app.route('/v1/transporters', transporterRoutes);
app.route('/v1/admin', adminRoutes);
app.route('/v1/fuel-entries', fuelEntryRoutes);

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such route' } }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: { code: 'internal_error', message: 'Something went wrong' } }, 500);
});

export default {
  fetch: app.fetch,
  // Runs on the cron schedule in wrangler.toml: the nightly backup, then a
  // tidy-up of expired rate-limit counters. A failure is recorded by the
  // backup itself (and shown in Master), so it is only logged here.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        await runBackup(env);
      } catch (err) {
        console.error('nightly backup failed', err);
      }
      await purgeExpiredRateLimits(env.DB).catch((err) => console.error('rate limit cleanup failed', err));
    })());
  }
};
