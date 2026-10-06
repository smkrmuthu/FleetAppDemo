import { Hono } from 'hono';
import { and, desc, eq, lt, or, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb, newId, nowIso } from '../db';
import { trips, tripExpenses, notifications, receipts, tripDocuments, tripStops, drivers, counters } from '../../drizzle/schema';
import { base64ToBytes, filenameFromKey, storageKeyFor } from '../lib/storage';
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BASE64_LENGTH, documentInputSchema, sanitizeFilenameForHeader } from '../lib/fileValidation';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildFilters, combine, parsePagination } from '../lib/filters';
import { fuelLineBlocked, FUEL_BLOCKED_MESSAGE } from '../lib/fuelAccess';
import { writeAudit } from '../lib/audit';

export const tripRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
tripRoutes.use('*', requireAuth);

const expenseLineSchema = z
  .object({
    id: z.string().optional(),
    spentOn: z.string().min(1),
    kind: z.enum(['diesel', 'adblue', 'toll', 'other']),
    litres: z.number().nonnegative().optional(),
    ratePaise: z.number().int().nonnegative().optional(),
    amountPaise: z.number().int().nonnegative(),
    details: z.string().optional()
  })
  .refine((l) => l.kind !== 'other' || !!l.details?.trim(), { message: "details is required when kind = 'other'", path: ['details'] });

type Problem = { message: string; field: string };
type StopReading = { odo?: number | null };

// Odometer readings must only ever go up along the route: start, then each
// stop that has a reading (in visiting order), then end.
function stopOdometerProblem(odoStart: number | null | undefined, odoEnd: number | null | undefined, stops: StopReading[]): Problem | null {
  let prev: number | null = odoStart || null;
  for (let i = 0; i < stops.length; i++) {
    const r = stops[i].odo;
    if (r == null) continue;
    if (prev != null && r < prev) {
      return { message: `Stop ${i + 1} odometer (${r}) can't be lower than the previous reading (${prev})`, field: 'stops' };
    }
    prev = r;
  }
  if (odoEnd && prev != null && odoEnd < prev) {
    return { message: `Odometer end can't be lower than the last stop's reading (${prev})`, field: 'odoEnd' };
  }
  return null;
}

// Stop dates must only advance along the route: loadDate <= stop 1 date <= stop 2 date <= ... <= unloadDate
function stopDateProblem(loadDate: string | null | undefined, unloadDate: string | null | undefined, stops: { date?: string | null }[]): Problem | null {
  if (!loadDate) return null;
  let prevDate = loadDate;
  let prevLabel = `loading date (${loadDate})`;
  for (let i = 0; i < stops.length; i++) {
    const d = stops[i].date;
    if (!d) continue;
    if (d < prevDate) {
      return { message: `Stop ${i + 1} date (${d}) cannot be earlier than ${prevLabel}`, field: 'stops' };
    }
    if (unloadDate && d > unloadDate) {
      return { message: `Stop ${i + 1} date (${d}) cannot be later than unloading date (${unloadDate})`, field: 'stops' };
    }
    prevDate = d;
    prevLabel = `Stop ${i + 1} date (${d})`;
  }
  if (unloadDate && unloadDate < prevDate) {
    return { message: `Unloading date (${unloadDate}) cannot be earlier than previous date (${prevDate})`, field: 'unloadDate' };
  }
  return null;
}

function isDriverAuthorizedForTrip(
  auth: { role: string; userId: string; driverId?: string | null },
  trip: { createdBy?: string | null; driverId?: string | null }
): boolean {
  if (auth.role !== 'driver') return true;
  if (trip.createdBy === auth.userId) return true;
  if (auth.driverId && trip.driverId === auth.driverId) return true;
  return false;
}

// A movement can only be complete once it has its loading weight, both
// odometer readings (end above start) and a reading at every stop.
// Returns the first thing missing.
// requireOdoEnd defaults to true (a movement isn't "complete" without it) —
// callers pass false only at initial creation, where the loading-point
// odometer is known but the trip is still in progress, so its end reading
// naturally isn't yet.
function completionProblem(
  t: { weightKg?: number | null; odoStart?: number | null; odoEnd?: number | null },
  stops: StopReading[] = [],
  opts: { requireOdoEnd?: boolean } = {}
): Problem | null {
  const requireOdoEnd = opts.requireOdoEnd ?? true;
  if (!t.weightKg) return { message: 'Loading weight is required to complete this movement', field: 'weightKg' };
  if (!t.odoStart) return { message: 'Odometer start is required to complete this movement', field: 'odoStart' };
  if (!requireOdoEnd) return stopOdometerProblem(t.odoStart, t.odoEnd, stops);
  if (!t.odoEnd) return { message: 'Odometer end is required to complete this movement', field: 'odoEnd' };
  if (t.odoEnd <= t.odoStart) return { message: 'Odometer end must be greater than odometer start', field: 'odoEnd' };
  const missing = stops.findIndex((st) => !st.odo);
  if (missing >= 0) return { message: `Odometer reading is required at stop ${missing + 1} to complete this movement`, field: 'stops' };
  return stopOdometerProblem(t.odoStart, t.odoEnd, stops);
}

// Every trip gets one of these, in order, org-wide — never per-truck, never
// user-editable. The upsert-with-RETURNING is a single statement, so two
// trips created at the same moment still can't be handed the same number.
async function nextTripNumber(db: ReturnType<typeof getDb>, orgId: string): Promise<string> {
  const [row] = await db.insert(counters)
    .values({ orgId, key: 'trip_no', value: 1 })
    .onConflictDoUpdate({ target: [counters.orgId, counters.key], set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `DEMO-${String(row.value).padStart(5, '0')}`;
}

const stopSchema = z.object({
  location: z.string().trim().min(1, 'Stop location is required').max(200),
  date: z.string().min(1, 'Stop date is required'),
  odo: z.number().int().positive().nullish(),
  note: z.string().trim().max(200).nullish()
});
const MAX_STOPS = 20;

const createTripSchema = z.object({
  id: z.string().min(1),
  vehicleId: z.string().min(1),
  driverId: z.string().optional(),
  waybillNo: z.string().optional(),
  itemNo: z.string().optional(),
  loadDate: z.string().min(1),
  unloadDate: z.string().optional(),
  fromLoc: z.string().optional(),
  fromNote: z.string().trim().max(200).optional(),
  toLoc: z.string().optional(),
  toNote: z.string().trim().max(200).optional(),
  weightKg: z.number().int().nonnegative().optional(),
  odoStart: z.number().int().nonnegative().optional(),
  odoEnd: z.number().int().nonnegative().optional(),
  revenuePaise: z.number().int().nonnegative().default(0),
  remarks: z.string().optional(),
  // Name of the transporter, picked from the org's Master list.
  transporter: z.string().trim().max(120).optional(),
  // Driver only: create as an open trip (no approval requested yet) rather
  // than submitting straight away — see POST /:id/complete.
  draft: z.boolean().optional(),
  expenses: z.array(expenseLineSchema).default([]),
  stops: z.array(stopSchema).max(MAX_STOPS).default([]),
  documents: z.array(documentInputSchema).default([])
});

const completeSchema = z.object({
  odoEnd: z.number().int().nonnegative(),
  unloadDate: z.string().optional(),
  remarks: z.string().optional()
});

// Uploads one file to R2 and links it to the trip via a receipts row +
// a trip_documents row. Returns the shape the frontend renders directly.
async function uploadDocument(
  env: Env,
  db: ReturnType<typeof getDb>,
  auth: { orgId: string; userId: string },
  tripId: string,
  doc: z.infer<typeof documentInputSchema>
) {
  const receiptId = newId();
  const storageKey = storageKeyFor(auth.orgId, tripId, receiptId, doc.filename);
  await env.DOCS.put(storageKey, base64ToBytes(doc.base64), { httpMetadata: { contentType: doc.mimeType } });

  const now = nowIso();
  await db.insert(receipts).values({ id: receiptId, orgId: auth.orgId, storageKey, mimeType: doc.mimeType, uploadedBy: auth.userId, createdAt: now });
  const docId = newId();
  await db.insert(tripDocuments).values({ id: docId, orgId: auth.orgId, tripId, receiptId, docType: 'other', createdBy: auth.userId, createdAt: now });

  return { id: docId, filename: doc.filename, mimeType: doc.mimeType };
}

async function fetchDocumentsByTrip(db: ReturnType<typeof getDb>, orgId: string, tripIds: string[]) {
  const byTrip = new Map<string, { id: string; filename: string; mimeType: string | null }[]>();
  if (!tripIds.length) return byTrip;

  const docRows = (await db.select().from(tripDocuments).where(eq(tripDocuments.orgId, orgId))).filter((d) => tripIds.includes(d.tripId));
  if (!docRows.length) return byTrip;

  const receiptRows = await db.select().from(receipts).where(eq(receipts.orgId, orgId));
  const receiptById = new Map(receiptRows.map((r) => [r.id, r]));

  for (const d of docRows) {
    const receipt = receiptById.get(d.receiptId);
    if (!byTrip.has(d.tripId)) byTrip.set(d.tripId, []);
    byTrip.get(d.tripId)!.push({ id: d.id, filename: receipt ? filenameFromKey(receipt.storageKey) : 'file', mimeType: receipt?.mimeType ?? null });
  }
  return byTrip;
}

// Idempotent on the client-generated id: a retry after a dropped signal
// returns the existing row rather than creating a duplicate trip.
tripRoutes.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createTripSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  const data = parsed.data;

  if (data.expenses.some((e) => fuelLineBlocked(auth.role, e.kind))) {
    return c.json({ error: { code: 'forbidden', message: FUEL_BLOCKED_MESSAGE } }, 403);
  }

  const db = getDb(c.env);
  const isDriver = auth.role === 'driver';
  const [existing] = await db.select().from(trips).where(and(eq(trips.id, data.id), eq(trips.orgId, auth.orgId))).limit(1);
  if (existing) {
    if (!isDriverAuthorizedForTrip(auth, existing)) {
      return c.json({ error: { code: 'forbidden', message: 'Not your trip' } }, 403);
    }
    const docs = (await fetchDocumentsByTrip(db, auth.orgId, [data.id])).get(data.id) ?? [];
    const stops = await db.select().from(tripStops).where(eq(tripStops.tripId, data.id)).orderBy(tripStops.seq);
    const existingSanitized = isDriver ? { ...existing, revenuePaise: 0 } : existing;
    return c.json({ ...existingSanitized, stops, documents: docs }, 200);
  }
  // A driver's own login is the account used to enter the trip, but the
  // driver named on it may be someone else — an office assistant keying
  // data for whoever's actually driving. Trust the submitted driver, only
  // falling back to the logged-in driver when none was picked.
  const driverId = isDriver ? data.driverId ?? auth.driverId : data.driverId ?? null;
  // A driver can only ever open a trip, never finalize it. Office/Manager
  // must give the loading weight and start odometer up front, but the end
  // odometer (and per-stop readings) may still be unknown — such a trip is
  // created 'pending' rather than 'approved', and is finalized later via
  // /:id/approve once completionProblem (the strict, default check) passes.
  const now = nowIso();

  const problem = isDriver
    ? stopOdometerProblem(data.odoStart, data.odoEnd, data.stops)
    : completionProblem(data, data.stops, { requireOdoEnd: false });
  if (problem) return c.json({ error: { code: 'validation_error', ...problem } }, 422);

  const status = isDriver ? 'draft' : completionProblem(data, data.stops) ? 'pending' : 'approved';

  const dateProb = stopDateProblem(data.loadDate, data.unloadDate, data.stops);
  if (dateProb) return c.json({ error: { code: 'validation_error', ...dateProb } }, 422);

  if (data.odoEnd != null && data.odoStart != null && data.odoEnd <= data.odoStart) {
    return c.json({ error: { code: 'validation_error', message: 'Odometer end must be greater than odometer start', field: 'odoEnd' } }, 422);
  }

  // Trip numbers are always assigned here, never taken from the client —
  // that's the only way they can stay unique and unchangeable.
  const waybillNo = await nextTripNumber(db, auth.orgId);

  const tripValues = {
    id: data.id,
    orgId: auth.orgId,
    vehicleId: data.vehicleId,
    driverId,
    waybillNo,
    itemNo: data.itemNo,
    loadDate: data.loadDate,
    unloadDate: data.unloadDate,
    fromLoc: data.fromLoc,
    fromNote: data.fromNote,
    toLoc: data.toLoc,
    toNote: data.toNote,
    weightKg: data.weightKg,
    odoStart: data.odoStart,
    odoEnd: data.odoEnd,
    revenuePaise: isDriver ? 0 : data.revenuePaise,
    status: status as 'draft' | 'pending' | 'approved',
    remarks: data.remarks,
    transporter: data.transporter || null,
    createdBy: auth.userId,
    createdAt: now,
    updatedAt: now
  };

  const expenseRows = data.expenses.map((e) => ({
    id: e.id ?? newId(),
    orgId: auth.orgId,
    tripId: data.id,
    spentOn: e.spentOn,
    kind: e.kind,
    litres: e.litres,
    ratePaise: e.ratePaise,
    amountPaise: e.amountPaise,
    details: e.details,
    createdBy: auth.userId,
    createdAt: now
  }));

  const stopRows = data.stops.map((st, i) => ({
    id: newId(), orgId: auth.orgId, tripId: data.id, seq: i + 1, location: st.location, date: st.date, odo: st.odo ?? null, note: st.note || null, createdAt: now
  }));

  const statements = [db.insert(trips).values(tripValues)];
  for (const row of expenseRows) statements.push(db.insert(tripExpenses).values(row) as any);
  for (const row of stopRows) statements.push(db.insert(tripStops).values(row) as any);
  await db.batch(statements as [any, ...any[]]);

  await writeAudit(db, auth.orgId, 'trips', data.id, 'insert', { status, expenseCount: expenseRows.length, stopCount: stopRows.length }, auth.userId);

  const documentRows = [];
  for (const doc of data.documents) {
    if (doc.base64.length > MAX_DOCUMENT_BASE64_LENGTH) continue;
    documentRows.push(await uploadDocument(c.env, db, auth, data.id, doc));
  }

  return c.json({ ...tripValues, expenses: expenseRows, stops: stopRows, documents: documentRows }, 201);
});

// Keyset pagination on (created_at desc, id) — newest-entered first, no
// offset scans as the log grows. Every filter is optional and order in the
// URL never matters.
tripRoutes.get('/', async (c) => {
  const auth = c.get('auth');
  const db = getDb(c.env);
  const query = new URL(c.req.url).searchParams;
  const { limit, cursor } = parsePagination(query);

  const conditions = [eq(trips.orgId, auth.orgId), ...buildFilters(query, {
    vehicle_id: { column: trips.vehicleId, op: 'eq' },
    driver_id: { column: trips.driverId, op: 'eq' },
    status: { column: trips.status, op: 'eq' },
    from: { column: trips.loadDate, op: 'gte' },
    to: { column: trips.loadDate, op: 'lte' }
  })];

  // Drivers can only list movements they entered themselves or that are assigned to them
  if (auth.role === 'driver') {
    const isDriverOwner = auth.driverId
      ? or(eq(trips.createdBy, auth.userId), eq(trips.driverId, auth.driverId))!
      : eq(trips.createdBy, auth.userId);
    conditions.push(isDriverOwner);
  }

  if (cursor) {
    const [cursorCreatedAt, cursorId] = cursor.split('|');
    conditions.push(or(lt(trips.createdAt, cursorCreatedAt), and(eq(trips.createdAt, cursorCreatedAt), gt(trips.id, cursorId)))!);
  }

  // Newest-entered first — the trip's own load date doesn't drive order,
  // so a movement logged just now always lands at the top of the list.
  const rows = await db.select().from(trips).where(combine(conditions)).orderBy(desc(trips.createdAt), trips.id).limit(limit);
  const nextCursor = rows.length === limit ? `${rows[rows.length - 1].createdAt}|${rows[rows.length - 1].id}` : null;

  const tripIds = rows.map((t) => t.id);
  const expenseRows = tripIds.length
    ? await db.select().from(tripExpenses).where(eq(tripExpenses.orgId, auth.orgId))
    : [];
  const byTrip = new Map<string, typeof expenseRows>();
  for (const e of expenseRows) {
    if (!tripIds.includes(e.tripId)) continue;
    if (!byTrip.has(e.tripId)) byTrip.set(e.tripId, []);
    byTrip.get(e.tripId)!.push(e);
  }
  const docsByTrip = await fetchDocumentsByTrip(db, auth.orgId, tripIds);
  // Same shape as the expense lookup above (an IN list over up to 200 trips
  // would blow D1's bound-parameter limit).
  const stopRows = tripIds.length
    ? await db.select().from(tripStops).where(eq(tripStops.orgId, auth.orgId)).orderBy(tripStops.seq)
    : [];
  const stopsByTrip = new Map<string, typeof stopRows>();
  for (const st of stopRows) {
    if (!tripIds.includes(st.tripId)) continue;
    if (!stopsByTrip.has(st.tripId)) stopsByTrip.set(st.tripId, []);
    stopsByTrip.get(st.tripId)!.push(st);
  }

  const isDriver = auth.role === 'driver';
  return c.json({
    trips: rows.map((t) => ({
      ...t,
      revenuePaise: isDriver ? 0 : t.revenuePaise,
      expenses: byTrip.get(t.id) ?? [],
      stops: stopsByTrip.get(t.id) ?? [],
      documents: docsByTrip.get(t.id) ?? []
    })),
    nextCursor
  });
});

// A read-only preview of the number the *next* trip will get — shown in the
// Add Movement form so the field isn't blank while the movement is drafted.
// It never writes, so it never consumes a number; the real one is only
// assigned (atomically) inside POST / itself, and can differ from this
// preview if another trip is saved in between.
tripRoutes.get('/next-number', async (c) => {
  const auth = c.get('auth');
  const db = getDb(c.env);
  const [row] = await db.select({ value: counters.value }).from(counters)
    .where(and(eq(counters.orgId, auth.orgId), eq(counters.key, 'trip_no'))).limit(1);
  return c.json({ number: `DEMO-${String((row?.value ?? 0) + 1).padStart(5, '0')}` });
});

tripRoutes.get('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, trip)) {
    return c.json({ error: { code: 'forbidden', message: 'Not your trip' } }, 403);
  }
  const expenses = await db.select().from(tripExpenses).where(eq(tripExpenses.tripId, id));
  const stops = await db.select().from(tripStops).where(eq(tripStops.tripId, id)).orderBy(tripStops.seq);
  const documents = (await fetchDocumentsByTrip(db, auth.orgId, [id])).get(id) ?? [];
  const tripSanitized = auth.role === 'driver' ? { ...trip, revenuePaise: 0 } : trip;
  return c.json({ ...tripSanitized, expenses, stops, documents });
});

// A driver may only add stops to their own trip while it's still open
// (draft); once it's submitted for approval the log for that trip is
// closed. Office/manager can add a cost line to any trip at any time.
tripRoutes.post('/:id/expenses', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = expenseLineSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  if (fuelLineBlocked(auth.role, parsed.data.kind)) return c.json({ error: { code: 'forbidden', message: FUEL_BLOCKED_MESSAGE } }, 403);

  const db = getDb(c.env);
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, trip) || (auth.role === 'driver' && trip.status === 'approved')) {
    return c.json({ error: { code: 'forbidden', message: 'Can only add to your own open movement' } }, 403);
  }
  if (auth.role === 'office' && trip.status === 'approved') {
    return c.json({ error: { code: 'forbidden', message: 'Only a manager can change a completed movement' } }, 403);
  }

  const row = { id: parsed.data.id ?? newId(), orgId: auth.orgId, tripId: id, createdBy: auth.userId, createdAt: nowIso(), ...parsed.data };
  await db.insert(tripExpenses).values(row);
  await writeAudit(db, auth.orgId, 'trip_expenses', row.id, 'insert', { tripId: id, kind: row.kind }, auth.userId);
  return c.json(row, 201);
});

// Removes one fuel/expense line. Same rule as adding: a driver only on their
// own open movement, office/manager on any trip (including approved ones —
// that's how a wrong entry on a completed movement gets corrected).
tripRoutes.delete('/:id/expenses/:expenseId', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const expenseId = c.req.param('expenseId')!;
  const db = getDb(c.env);

  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, trip) || (auth.role === 'driver' && trip.status === 'approved')) {
    return c.json({ error: { code: 'forbidden', message: 'Can only change your own open movement' } }, 403);
  }
  if (auth.role === 'office' && trip.status === 'approved') {
    return c.json({ error: { code: 'forbidden', message: 'Only a manager can change a completed movement' } }, 403);
  }

  const [line] = await db.select().from(tripExpenses)
    .where(and(eq(tripExpenses.id, expenseId), eq(tripExpenses.tripId, id), eq(tripExpenses.orgId, auth.orgId))).limit(1);
  if (!line) return c.json({ error: { code: 'not_found', message: 'Expense line not found' } }, 404);
  if (fuelLineBlocked(auth.role, line.kind)) return c.json({ error: { code: 'forbidden', message: FUEL_BLOCKED_MESSAGE } }, 403);

  await db.delete(tripExpenses).where(eq(tripExpenses.id, expenseId));
  await writeAudit(db, auth.orgId, 'trip_expenses', expenseId, 'delete', { tripId: id, kind: line.kind, amountPaise: line.amountPaise }, auth.userId);
  return c.json({ ok: true });
});

// Edits one expense/fuel line in place (date, litres, rate, amount, remarks).
// Same rule as adding and deleting: a driver only on their own open movement,
// office on any trip that isn't approved, manager on any trip.
tripRoutes.patch('/:id/expenses/:expenseId', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const expenseId = c.req.param('expenseId')!;
  const body = await c.req.json().catch(() => null);
  const parsed = expenseLineSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  if (fuelLineBlocked(auth.role, parsed.data.kind)) return c.json({ error: { code: 'forbidden', message: FUEL_BLOCKED_MESSAGE } }, 403);

  const db = getDb(c.env);
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, trip) || (auth.role === 'driver' && trip.status === 'approved')) {
    return c.json({ error: { code: 'forbidden', message: 'Can only change your own open movement' } }, 403);
  }
  if (auth.role === 'office' && trip.status === 'approved') {
    return c.json({ error: { code: 'forbidden', message: 'Only a manager can change a completed movement' } }, 403);
  }

  const [line] = await db.select().from(tripExpenses)
    .where(and(eq(tripExpenses.id, expenseId), eq(tripExpenses.tripId, id), eq(tripExpenses.orgId, auth.orgId))).limit(1);
  if (!line) return c.json({ error: { code: 'not_found', message: 'Expense line not found' } }, 404);
  if (fuelLineBlocked(auth.role, line.kind)) return c.json({ error: { code: 'forbidden', message: FUEL_BLOCKED_MESSAGE } }, 403);

  const d = parsed.data;
  const changes = {
    spentOn: d.spentOn, kind: d.kind, litres: d.litres ?? null, ratePaise: d.ratePaise ?? null,
    amountPaise: d.amountPaise, details: d.details?.trim() ? d.details.trim() : null
  };
  await db.update(tripExpenses).set(changes).where(eq(tripExpenses.id, expenseId));
  await writeAudit(db, auth.orgId, 'trip_expenses', expenseId, 'update', { tripId: id, ...changes }, auth.userId);
  const [row] = await db.select().from(tripExpenses).where(eq(tripExpenses.id, expenseId)).limit(1);
  return c.json(row);
});

// Same ownership/open-trip rule as expense lines above: a driver can only
// attach files to their own trip while it's still a draft.
tripRoutes.post('/:id/documents', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = documentInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  if (parsed.data.base64.length > MAX_DOCUMENT_BASE64_LENGTH) {
    return c.json({ error: { code: 'payload_too_large', message: 'File is too large' } }, 413);
  }

  const db = getDb(c.env);
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, trip) || (auth.role === 'driver' && trip.status === 'approved')) {
    return c.json({ error: { code: 'forbidden', message: 'Can only attach files to your own open movement' } }, 403);
  }
  if (auth.role === 'office' && trip.status === 'approved') {
    return c.json({ error: { code: 'forbidden', message: 'Only a manager can change a completed movement' } }, 403);
  }

  const doc = await uploadDocument(c.env, db, auth, id, parsed.data);
  await writeAudit(db, auth.orgId, 'trip_documents', doc.id, 'insert', { tripId: id, filename: doc.filename }, auth.userId);
  return c.json(doc, 201);
});

tripRoutes.delete('/:id/documents/:docId', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const docId = c.req.param('docId')!;
  const db = getDb(c.env);

  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, trip) || (auth.role === 'driver' && trip.status === 'approved')) {
    return c.json({ error: { code: 'forbidden', message: 'Can only remove files from your own open movement' } }, 403);
  }
  if (auth.role === 'office' && trip.status === 'approved') {
    return c.json({ error: { code: 'forbidden', message: 'Only a manager can change a completed movement' } }, 403);
  }

  const [doc] = await db.select().from(tripDocuments).where(and(eq(tripDocuments.id, docId), eq(tripDocuments.orgId, auth.orgId), eq(tripDocuments.tripId, id))).limit(1);
  if (!doc) return c.json({ error: { code: 'not_found', message: 'Document not found' } }, 404);

  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, doc.receiptId)).limit(1);
  // trip_documents.receipt_id has no ON DELETE cascade, so the child row
  // must go before its parent receipt.
  await db.delete(tripDocuments).where(eq(tripDocuments.id, docId));
  if (receipt) {
    await c.env.DOCS.delete(receipt.storageKey).catch(() => {});
    await db.delete(receipts).where(eq(receipts.id, receipt.id));
  }
  await writeAudit(db, auth.orgId, 'trip_documents', docId, 'delete', { tripId: id }, auth.userId);
  return c.json({ ok: true });
});

tripRoutes.get('/:id/documents/:docId/file', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const docId = c.req.param('docId')!;
  const db = getDb(c.env);

  const [trip] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!trip) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, trip)) {
    return c.json({ error: { code: 'forbidden', message: 'Not your movement' } }, 403);
  }

  const [doc] = await db.select().from(tripDocuments).where(and(eq(tripDocuments.id, docId), eq(tripDocuments.orgId, auth.orgId), eq(tripDocuments.tripId, id))).limit(1);
  if (!doc) return c.json({ error: { code: 'not_found', message: 'Document not found' } }, 404);
  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, doc.receiptId)).limit(1);
  if (!receipt) return c.json({ error: { code: 'not_found', message: 'File not found' } }, 404);

  const object = await c.env.DOCS.get(receipt.storageKey);
  if (!object) return c.json({ error: { code: 'not_found', message: 'File not found in storage' } }, 404);

  // Documents uploaded since the SEC-02 fix already have a verified,
  // allowlisted mimeType, but this also has to cover whatever was uploaded
  // before that check existed — anything not on the current allowlist is
  // served as an inert download rather than trusted to render inline.
  const isSafeInlineType = !!receipt.mimeType && (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(receipt.mimeType);
  const contentType = isSafeInlineType ? receipt.mimeType! : 'application/octet-stream';
  const filename = sanitizeFilenameForHeader(filenameFromKey(receipt.storageKey));
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${isSafeInlineType ? 'inline' : 'attachment'}; filename="${filename}"`
    }
  });
});

// Office/manager may edit any trip at any time. A driver may only edit
// their own trip, and only until it's approved — once office has closed it
// out it's locked from their side. A month-close guard (409 if the month is
// frozen) is future work once /months/:yyyy-mm:close exists.
tripRoutes.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const [existing] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, existing) || (auth.role === 'driver' && existing.status === 'approved')) {
    return c.json({ error: { code: 'forbidden', message: 'Can only edit your own open movement' } }, 403);
  }
  if (auth.role === 'office' && existing.status === 'approved') {
    return c.json({ error: { code: 'forbidden', message: 'Only a manager can change a completed movement' } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  // waybillNo is excluded — it's assigned once at creation and never editable.
  const baseSchema = createTripSchema.omit({ id: true, expenses: true, draft: true, documents: true, stops: true, waybillNo: true }).partial();
  // The driver named on a trip can be changed by whoever may edit it — as at
  // creation, a driver login is often an office assistant keying data for
  // whoever is actually driving. (Ownership, createdBy, never changes.)
  // Optional text fields can be cleared on edit by sending null.
  const clearable = z.string().nullable().optional();
  // stops, when present, replace the whole ordered list (checked together with the odometers below).
  const schema = baseSchema.extend({ itemNo: clearable, unloadDate: clearable, fromLoc: clearable, fromNote: clearable, toLoc: clearable, toNote: clearable, remarks: clearable, transporter: clearable, stops: z.array(stopSchema).max(MAX_STOPS).optional() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  if (parsed.data.driverId && parsed.data.driverId !== existing.driverId) {
    const [drv] = await db.select({ id: drivers.id }).from(drivers)
      .where(and(eq(drivers.id, parsed.data.driverId), eq(drivers.orgId, auth.orgId), eq(drivers.active, true))).limit(1);
    if (!drv) return c.json({ error: { code: 'validation_error', message: 'Driver not found', field: 'driverId' } }, 422);
  }

  const odoStart = ('odoStart' in parsed.data ? parsed.data.odoStart : undefined) ?? existing.odoStart;
  const odoEnd = ('odoEnd' in parsed.data ? parsed.data.odoEnd : undefined) ?? existing.odoEnd;
  if (odoEnd != null && odoStart != null && odoEnd <= odoStart) {
    return c.json({ error: { code: 'validation_error', message: 'Odometer end must be greater than odometer start', field: 'odoEnd' } }, 422);
  }

  const { stops: newStops, ...tripPatch } = parsed.data;
  if (auth.role === 'driver') {
    delete tripPatch.revenuePaise;
  }
  const storedStops = newStops ? [] : await db.select().from(tripStops).where(eq(tripStops.tripId, id)).orderBy(tripStops.seq);
  const effectiveStops: StopReading[] = newStops ?? storedStops;

  const problem = existing.status === 'approved'
    ? completionProblem({ weightKg: 'weightKg' in tripPatch ? tripPatch.weightKg : existing.weightKg, odoStart, odoEnd }, effectiveStops)
    : stopOdometerProblem(odoStart, odoEnd, effectiveStops);
  if (problem) return c.json({ error: { code: 'validation_error', ...problem } }, 422);

  const effectiveLoadDate = tripPatch.loadDate ?? existing.loadDate;
  const effectiveUnloadDate = 'unloadDate' in tripPatch ? tripPatch.unloadDate : existing.unloadDate;
  const dateProb = stopDateProblem(effectiveLoadDate, effectiveUnloadDate, newStops ?? []);
  if (dateProb) return c.json({ error: { code: 'validation_error', ...dateProb } }, 422);

  const now = nowIso();
  await db.update(trips).set({ ...tripPatch, updatedAt: now }).where(eq(trips.id, id));
  if (newStops) {
    const rows = newStops.map((st, i) => ({
      id: newId(), orgId: auth.orgId, tripId: id, seq: i + 1, location: st.location, date: st.date, odo: st.odo ?? null, note: st.note || null, createdAt: now
    }));
    const statements: any[] = [db.delete(tripStops).where(and(eq(tripStops.tripId, id), eq(tripStops.orgId, auth.orgId)))];
    for (const row of rows) statements.push(db.insert(tripStops).values(row));
    await db.batch(statements as [any, ...any[]]);
  }
  await writeAudit(db, auth.orgId, 'trips', id, 'update', { ...tripPatch, ...(newStops ? { stops: newStops.map((st) => st.location) } : {}) }, auth.userId);

  const [row] = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  const sanitizedRow = auth.role === 'driver' ? { ...row, revenuePaise: 0 } : row;
  return c.json(sanitizedRow);
});

// Finalizes an open trip (draft, or a pending one left over from the old
// driver-approval flow): sets the closing odometer reading and marks it
// approved. Office/manager only — a driver can open and add to a movement
// but never finalize it themselves, and finalizing needs no separate
// approval step.
tripRoutes.post('/:id/complete', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const [existing] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (existing.status === 'approved') {
    return c.json({ error: { code: 'invalid_state', message: 'This movement is already approved' } }, 409);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const stopsNow = await db.select().from(tripStops).where(eq(tripStops.tripId, id)).orderBy(tripStops.seq);
  const problem = completionProblem({ weightKg: existing.weightKg, odoStart: existing.odoStart, odoEnd: parsed.data.odoEnd }, stopsNow);
  if (problem) return c.json({ error: { code: 'validation_error', ...problem } }, 422);

  const now = nowIso();
  await db.update(trips).set({
    odoEnd: parsed.data.odoEnd,
    unloadDate: parsed.data.unloadDate ?? existing.unloadDate,
    remarks: parsed.data.remarks ?? existing.remarks,
    status: 'approved',
    updatedAt: now
  }).where(eq(trips.id, id));
  await writeAudit(db, auth.orgId, 'trips', id, 'complete', { status: 'approved' }, auth.userId);

  const [row] = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  return c.json(row);
});

// A driver may delete only their own still-open (draft) movement — once it
// is complete (pending or approved) it is locked from their side. Office/
// manager may delete any trip that isn't yet approved. Once approved it's
// locked for everyone; there is no undo, so this is a hard delete of the
// trip and its expense lines.
tripRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const [existing] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (!isDriverAuthorizedForTrip(auth, existing)) {
    return c.json({ error: { code: 'forbidden', message: 'Not your movement' } }, 403);
  }
  if (auth.role === 'driver' && existing.status !== 'draft') {
    return c.json({ error: { code: 'invalid_state', message: 'A completed movement cannot be deleted by a driver' } }, 409);
  }
  if (existing.status === 'approved') {
    return c.json({ error: { code: 'invalid_state', message: 'An approved movement cannot be deleted' } }, 409);
  }

  const docRows = await db.select().from(tripDocuments).where(and(eq(tripDocuments.tripId, id), eq(tripDocuments.orgId, auth.orgId)));
  const receiptIds = docRows.map((d) => d.receiptId);
  const relevantReceipts = receiptIds.length
    ? (await db.select().from(receipts).where(eq(receipts.orgId, auth.orgId))).filter((r) => receiptIds.includes(r.id))
    : [];

  // trip_documents.receipt_id has no ON DELETE cascade, so the child rows
  // must go before their parent receipts (and before the R2 objects, so a
  // crash mid-cleanup never leaves a dangling DB row pointing at nothing).
  await db.batch([
    db.delete(tripDocuments).where(eq(tripDocuments.tripId, id)),
    db.delete(tripExpenses).where(eq(tripExpenses.tripId, id)),
    db.delete(tripStops).where(eq(tripStops.tripId, id)),
    db.delete(notifications).where(and(eq(notifications.relatedTripId, id), eq(notifications.orgId, auth.orgId))),
    db.delete(trips).where(eq(trips.id, id))
  ]);

  if (relevantReceipts.length) {
    await Promise.all(relevantReceipts.map((r) => c.env.DOCS.delete(r.storageKey).catch(() => {})));
    await db.batch(relevantReceipts.map((r) => db.delete(receipts).where(eq(receipts.id, r.id))) as [any, ...any[]]);
  }
  await writeAudit(db, auth.orgId, 'trips', id, 'delete', { status: existing.status }, auth.userId);
  return c.json({ ok: true });
});

// The quick one-click finalize from Trip Log — same required-field bar as
// POST /:id/complete (loading weight and both odometer readings), just
// without opening the edit form first. A trip missing any of them has to be
// opened and filled in before it can be finalized either way.
tripRoutes.post('/:id/approve', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const [existing] = await db.select().from(trips).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Trip not found' } }, 404);
  if (existing.status === 'approved') {
    return c.json({ error: { code: 'invalid_state', message: 'This movement is already approved' } }, 409);
  }
  const stopsNow = await db.select().from(tripStops).where(eq(tripStops.tripId, id)).orderBy(tripStops.seq);
  const problem = completionProblem(existing, stopsNow);
  if (problem) return c.json({ error: { code: 'validation_error', ...problem } }, 422);

  await db.update(trips).set({ status: 'approved', updatedAt: nowIso() }).where(and(eq(trips.id, id), eq(trips.orgId, auth.orgId)));
  await writeAudit(db, auth.orgId, 'trips', id, 'approve', {}, auth.userId);
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.relatedTripId, id), eq(notifications.orgId, auth.orgId)));
  return c.json({ ok: true });
});
