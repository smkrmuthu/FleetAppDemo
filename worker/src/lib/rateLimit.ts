// Fixed-window rate limiter backed by D1, so the count is shared by every
// Worker instance and survives restarts. (An in-memory counter is per
// instance, which lets a brute-force attempt spread across instances.)
// Protects sign-in against password guessing and the bill scanner against
// runaway use.

export interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export async function checkRateLimit(db: D1Database, identifier: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const key = `${options.keyPrefix}:${identifier}`;
  try {
    // One atomic upsert: start a new window if the old one has expired,
    // otherwise count this attempt in the current one.
    const row = await db.prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
       RETURNING count, reset_at`
    ).bind(key, now + options.windowSeconds, now).first<{ count: number; reset_at: number }>();
    if (!row) return { allowed: true, remaining: options.maxRequests - 1, resetInSeconds: options.windowSeconds };
    return {
      allowed: row.count <= options.maxRequests,
      remaining: Math.max(0, options.maxRequests - row.count),
      resetInSeconds: Math.max(1, row.reset_at - now)
    };
  } catch (err) {
    // If the limiter's own table can't be read, don't lock everyone out of
    // the app — sign-in itself needs the same database and would fail anyway.
    console.error('rate limiter unavailable', err);
    return { allowed: true, remaining: options.maxRequests, resetInSeconds: options.windowSeconds };
  }
}

export async function purgeExpiredRateLimits(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').bind(Math.floor(Date.now() / 1000)).run();
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '127.0.0.1'
  );
}
