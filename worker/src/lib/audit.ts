import type { Db } from '../db';
import { newId, nowIso } from '../db';
import { auditLog } from '../../drizzle/schema';

export async function writeAudit(
  db: Db,
  orgId: string,
  entity: string,
  entityId: string,
  action: string,
  diff: Record<string, unknown>,
  actorId: string
) {
  await db.insert(auditLog).values({
    id: newId(),
    orgId,
    entity,
    entityId,
    action,
    diff,
    actorId,
    at: nowIso()
  });
}
