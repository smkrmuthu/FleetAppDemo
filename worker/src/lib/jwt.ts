import { sign, verify } from 'hono/jwt';
import type { AuthContext } from '../types';

const ACCESS_TTL_SECONDS = 60 * 60 * 12; // 12h — long enough for a driver's shift

export interface TokenPayload extends AuthContext {
  exp: number;
}

export async function signAccessToken(auth: AuthContext, secret: string): Promise<string> {
  const payload: TokenPayload = { ...auth, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS };
  return sign(payload as unknown as Record<string, unknown>, secret);
}

export async function verifyAccessToken(token: string, secret: string): Promise<AuthContext> {
  const payload = (await verify(token, secret, 'HS256')) as unknown as TokenPayload;
  return { orgId: payload.orgId, userId: payload.userId, role: payload.role, driverId: payload.driverId };
}
