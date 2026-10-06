import { and, eq, gte, lte, like, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

export type FilterOp = 'eq' | 'gte' | 'lte' | 'like';

export interface FilterField {
  column: SQLiteColumn;
  op: FilterOp;
}

/**
 * Builds a WHERE clause from whichever of the allow-listed query params the
 * caller actually supplied, in whatever order they appear in the URL —
 * order never matters here, only presence. Add a new filterable field by
 * adding one entry to the allowlist the route passes in; nothing else
 * changes. Unknown query params are silently ignored rather than erroring,
 * so a client can add new UI filters without a backend deploy as long as
 * the field is already allow-listed.
 */
export function buildFilters(query: URLSearchParams, allowlist: Record<string, FilterField>): SQL[] {
  const conditions: SQL[] = [];
  for (const [key, { column, op }] of Object.entries(allowlist)) {
    const raw = query.get(key);
    if (raw === null || raw === '') continue;
    switch (op) {
      case 'eq':
        conditions.push(eq(column, raw));
        break;
      case 'gte':
        conditions.push(gte(column, raw));
        break;
      case 'lte':
        conditions.push(lte(column, raw));
        break;
      case 'like':
        conditions.push(like(column, `%${raw}%`));
        break;
    }
  }
  return conditions;
}

export function combine(conditions: SQL[]) {
  return conditions.length ? and(...conditions) : undefined;
}

export function parsePagination(query: URLSearchParams): { limit: number; cursor: string | null } {
  const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 200);
  const cursor = query.get('cursor');
  return { limit, cursor };
}
