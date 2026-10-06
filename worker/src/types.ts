export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  ALLOWED_ORIGIN: string;
  JWT_SECRET: string;
  GEMINI_API_KEY: string;
}

// 'viewer' is read-only: it can see Dashboard / Movement Summary / Monthly
// Report data but can never change anything (enforced in requireAuth).
export type Role = 'driver' | 'office' | 'manager' | 'viewer';

// What every authenticated request carries, set once by the auth middleware
// from the verified JWT and never trusted from the request body.
export interface AuthContext {
  orgId: string;
  userId: string;
  role: Role;
  driverId: string | null;
}

export type Vars = {
  auth: AuthContext;
};
