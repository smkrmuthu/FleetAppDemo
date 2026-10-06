import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../drizzle/schema';
import type { Env } from './types';

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
