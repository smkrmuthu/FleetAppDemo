import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Env, Vars } from '../types';
import { getDb, newId, nowIso } from '../db';
import { drivers, expenseCategories, monthlyExpenses, monthlyExpenseDocuments, receipts, vehicles } from '../../drizzle/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildFilters, combine } from '../lib/filters';
import { writeAudit } from '../lib/audit';
import { base64ToBytes, filenameFromKey, storageKeyFor } from '../lib/storage';
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BASE64_LENGTH, documentInputSchema, sanitizeFilenameForHeader } from '../lib/fileValidation';

export const monthlyExpenseRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
monthlyExpenseRoutes.use('*', requireAuth);

// Uploads one bill to R2 and links it to the expense via a receipts row +
// a monthly_expense_documents row — same pattern as trips' uploadDocument.
async function uploadExpenseDocument(
  env: Env,
  db: ReturnType<typeof getDb>,
  auth: { orgId: string; userId: string },
  expenseId: string,
  doc: z.infer<typeof documentInputSchema>
) {
  const receiptId = newId();
  const storageKey = storageKeyFor(auth.orgId, expenseId, receiptId, doc.filename);
  await env.DOCS.put(storageKey, base64ToBytes(doc.base64), { httpMetadata: { contentType: doc.mimeType } });

  const now = nowIso();
  await db.insert(receipts).values({ id: receiptId, orgId: auth.orgId, storageKey, mimeType: doc.mimeType, uploadedBy: auth.userId, createdAt: now });
  const docId = newId();
  await db.insert(monthlyExpenseDocuments).values({ id: docId, orgId: auth.orgId, monthlyExpenseId: expenseId, receiptId, createdBy: auth.userId, createdAt: now });

  return { id: docId, filename: doc.filename, mimeType: doc.mimeType };
}

async function fetchDocumentsByExpense(db: ReturnType<typeof getDb>, orgId: string, expenseIds: string[]) {
  const byExpense = new Map<string, { id: string; filename: string; mimeType: string | null }[]>();
  if (!expenseIds.length) return byExpense;

  const docRows = (await db.select().from(monthlyExpenseDocuments).where(eq(monthlyExpenseDocuments.orgId, orgId))).filter((d) => expenseIds.includes(d.monthlyExpenseId));
  if (!docRows.length) return byExpense;

  const receiptRows = await db.select().from(receipts).where(eq(receipts.orgId, orgId));
  const receiptById = new Map(receiptRows.map((r) => [r.id, r]));

  for (const d of docRows) {
    const receipt = receiptById.get(d.receiptId);
    if (!byExpense.has(d.monthlyExpenseId)) byExpense.set(d.monthlyExpenseId, []);
    byExpense.get(d.monthlyExpenseId)!.push({ id: d.id, filename: receipt ? filenameFromKey(receipt.storageKey) : 'file', mimeType: receipt?.mimeType ?? null });
  }
  return byExpense;
}

// Drivers never see fixed costs: they get an empty list rather than an error,
// so an older app build that loads everything in one go keeps working. A
// Viewer reads the figures (they feed the reports) but not the bills (see
// viewerBlocked).
monthlyExpenseRoutes.get('/', async (c) => {
  const { orgId, role } = c.get('auth');
  if (role === 'driver') return c.json({ monthlyExpenses: [] });
  const db = getDb(c.env);
  const query = new URL(c.req.url).searchParams;

  const conditions = [eq(monthlyExpenses.orgId, orgId), isNull(monthlyExpenses.voidedAt), ...buildFilters(query, {
    vehicle_id: { column: monthlyExpenses.vehicleId, op: 'eq' },
    category: { column: monthlyExpenses.category, op: 'eq' },
    from: { column: monthlyExpenses.spentOn, op: 'gte' },
    to: { column: monthlyExpenses.spentOn, op: 'lte' }
  })];

  const rows = await db.select().from(monthlyExpenses).where(combine(conditions));
  const docsByExpense = await fetchDocumentsByExpense(db, orgId, rows.map((r) => r.id));
  return c.json({ monthlyExpenses: rows.map((r) => ({ ...r, documents: docsByExpense.get(r.id) ?? [] })) });
});

const createSchema = z.object({
  vehicleId: z.string().min(1),
  driverId: z.string().optional(),
  spentOn: z.string().min(1),
  category: z.string().trim().min(1).max(60),
  amountPaise: z.number().int().nonnegative(),
  remarks: z.string().optional(),
  documents: z.array(documentInputSchema).default([])
});

monthlyExpenseRoutes.post('/', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const db = getDb(c.env);
  const [cat] = await db.select({ id: expenseCategories.id }).from(expenseCategories)
    .where(and(eq(expenseCategories.id, parsed.data.category), eq(expenseCategories.orgId, auth.orgId), eq(expenseCategories.active, true))).limit(1);
  if (!cat) return c.json({ error: { code: 'validation_error', message: `"${parsed.data.category}" isn't a current description — add it under Master first`, field: 'category' } }, 422);

  const { documents, ...rest } = parsed.data;
  const id = newId();
  await db.insert(monthlyExpenses).values({ id, orgId: auth.orgId, createdBy: auth.userId, ...rest });
  await writeAudit(db, auth.orgId, 'monthly_expenses', id, 'insert', rest, auth.userId);

  const documentRows = [];
  for (const doc of documents) {
    if (doc.base64.length > MAX_DOCUMENT_BASE64_LENGTH) continue;
    documentRows.push(await uploadExpenseDocument(c.env, db, auth, id, doc));
  }

  const [row] = await db.select().from(monthlyExpenses).where(eq(monthlyExpenses.id, id)).limit(1);
  return c.json({ ...row, documents: documentRows }, 201);
});

const patchSchema = z.object({
  vehicleId: z.string().min(1),
  driverId: z.string().nullable().optional(),
  spentOn: z.string().min(1),
  category: z.string().trim().min(1).max(60),
  amountPaise: z.number().int().nonnegative(),
  remarks: z.string().nullable().optional()
});

// Edits the cost line itself; bills are added/removed through the document
// routes below. A description that has since been removed from Master is still
// accepted if the expense already carries it — only a *change* of description
// has to be a current one.
monthlyExpenseRoutes.patch('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);

  const db = getDb(c.env);
  const [existing] = await db.select().from(monthlyExpenses)
    .where(and(eq(monthlyExpenses.id, id), eq(monthlyExpenses.orgId, auth.orgId), isNull(monthlyExpenses.voidedAt))).limit(1);
  if (!existing) return c.json({ error: { code: 'not_found', message: 'Expense not found' } }, 404);

  const d = parsed.data;
  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, d.vehicleId), eq(vehicles.orgId, auth.orgId))).limit(1);
  if (!vehicle) return c.json({ error: { code: 'validation_error', message: `Truck "${d.vehicleId}" not found`, field: 'vehicleId' } }, 422);

  const driverId = d.driverId && d.driverId.trim() ? d.driverId : null;
  if (driverId) {
    const [driver] = await db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.orgId, auth.orgId))).limit(1);
    if (!driver) return c.json({ error: { code: 'validation_error', message: `Driver "${driverId}" not found`, field: 'driverId' } }, 422);
  }

  if (d.category !== existing.category) {
    const [cat] = await db.select({ id: expenseCategories.id }).from(expenseCategories)
      .where(and(eq(expenseCategories.id, d.category), eq(expenseCategories.orgId, auth.orgId), eq(expenseCategories.active, true))).limit(1);
    if (!cat) return c.json({ error: { code: 'validation_error', message: `"${d.category}" isn't a current description — add it under Master first`, field: 'category' } }, 422);
  }

  const changes = {
    vehicleId: d.vehicleId, driverId, spentOn: d.spentOn, category: d.category,
    amountPaise: d.amountPaise, remarks: d.remarks && d.remarks.trim() ? d.remarks.trim() : null
  };
  await db.update(monthlyExpenses).set(changes).where(and(eq(monthlyExpenses.id, id), eq(monthlyExpenses.orgId, auth.orgId)));
  await writeAudit(db, auth.orgId, 'monthly_expenses', id, 'update', changes, auth.userId);

  const [row] = await db.select().from(monthlyExpenses).where(eq(monthlyExpenses.id, id)).limit(1);
  const docs = await fetchDocumentsByExpense(db, auth.orgId, [id]);
  return c.json({ ...row, documents: docs.get(id) ?? [] });
});

// Same ownership scope as the rest of this route file (office/manager) — a
// bill can only be attached to/removed from an expense that still exists
// and isn't voided.
monthlyExpenseRoutes.post('/:id/documents', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const body = await c.req.json().catch(() => null);
  const parsed = documentInputSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: 'validation_error', message: parsed.error.message } }, 422);
  if (parsed.data.base64.length > MAX_DOCUMENT_BASE64_LENGTH) {
    return c.json({ error: { code: 'payload_too_large', message: 'File is too large' } }, 413);
  }

  const db = getDb(c.env);
  const [expense] = await db.select().from(monthlyExpenses).where(and(eq(monthlyExpenses.id, id), eq(monthlyExpenses.orgId, auth.orgId), isNull(monthlyExpenses.voidedAt))).limit(1);
  if (!expense) return c.json({ error: { code: 'not_found', message: 'Expense not found' } }, 404);

  const doc = await uploadExpenseDocument(c.env, db, auth, id, parsed.data);
  await writeAudit(db, auth.orgId, 'monthly_expense_documents', doc.id, 'insert', { expenseId: id, filename: doc.filename }, auth.userId);
  return c.json(doc, 201);
});

monthlyExpenseRoutes.delete('/:id/documents/:docId', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const docId = c.req.param('docId')!;
  const db = getDb(c.env);

  const [expense] = await db.select().from(monthlyExpenses).where(and(eq(monthlyExpenses.id, id), eq(monthlyExpenses.orgId, auth.orgId))).limit(1);
  if (!expense) return c.json({ error: { code: 'not_found', message: 'Expense not found' } }, 404);

  const [doc] = await db.select().from(monthlyExpenseDocuments).where(and(eq(monthlyExpenseDocuments.id, docId), eq(monthlyExpenseDocuments.orgId, auth.orgId), eq(monthlyExpenseDocuments.monthlyExpenseId, id))).limit(1);
  if (!doc) return c.json({ error: { code: 'not_found', message: 'Document not found' } }, 404);

  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, doc.receiptId)).limit(1);
  // monthly_expense_documents.receipt_id has no ON DELETE cascade, so the
  // child row must go before its parent receipt.
  await db.delete(monthlyExpenseDocuments).where(eq(monthlyExpenseDocuments.id, docId));
  if (receipt) {
    await c.env.DOCS.delete(receipt.storageKey).catch(() => {});
    await db.delete(receipts).where(eq(receipts.id, receipt.id));
  }
  await writeAudit(db, auth.orgId, 'monthly_expense_documents', docId, 'delete', { expenseId: id }, auth.userId);
  return c.json({ ok: true });
});

monthlyExpenseRoutes.get('/:id/documents/:docId/file', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const docId = c.req.param('docId')!;
  const db = getDb(c.env);

  const [expense] = await db.select().from(monthlyExpenses).where(and(eq(monthlyExpenses.id, id), eq(monthlyExpenses.orgId, auth.orgId))).limit(1);
  if (!expense) return c.json({ error: { code: 'not_found', message: 'Expense not found' } }, 404);

  const [doc] = await db.select().from(monthlyExpenseDocuments).where(and(eq(monthlyExpenseDocuments.id, docId), eq(monthlyExpenseDocuments.orgId, auth.orgId), eq(monthlyExpenseDocuments.monthlyExpenseId, id))).limit(1);
  if (!doc) return c.json({ error: { code: 'not_found', message: 'Document not found' } }, 404);
  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, doc.receiptId)).limit(1);
  if (!receipt) return c.json({ error: { code: 'not_found', message: 'File not found' } }, 404);

  const object = await c.env.DOCS.get(receipt.storageKey);
  if (!object) return c.json({ error: { code: 'not_found', message: 'File not found in storage' } }, 404);

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

// Soft void, never a hard delete — a removed cost line must still be
// explainable from the audit trail.
monthlyExpenseRoutes.delete('/:id', requireRole('office', 'manager'), async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id')!;
  const db = getDb(c.env);
  const result = await db.update(monthlyExpenses).set({ voidedAt: nowIso() }).where(and(eq(monthlyExpenses.id, id), eq(monthlyExpenses.orgId, auth.orgId)));
  if (result.meta.changes === 0) return c.json({ error: { code: 'not_found', message: 'Expense not found' } }, 404);
  await writeAudit(db, auth.orgId, 'monthly_expenses', id, 'void', {}, auth.userId);
  return c.json({ ok: true });
});
