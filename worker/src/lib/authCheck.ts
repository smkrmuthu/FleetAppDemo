import type { AuthContext, Role } from '../types';

// What the database says about the account a token was issued to.
export interface AccountRow {
  orgId: string;
  role: Role;
  driverId: string | null;
  disabledAt: string | null;
}

// A token proves who someone was at sign-in, up to 12 hours ago. The account
// is checked against the database on every request, so a deleted or disabled
// user is locked out at once and a role change takes effect immediately.
// Returns null when the token should no longer be honoured.
export function resolveAuth(token: AuthContext, account: AccountRow | undefined): AuthContext | null {
  if (!account || account.disabledAt || account.orgId !== token.orgId) return null;
  return { orgId: account.orgId, userId: token.userId, role: account.role, driverId: account.driverId };
}

// A viewer is strictly read-only: no writes at all, and no access to uploaded
// bills/receipts or the notification feed (not part of Dashboard / Movement
// Summary / Monthly Report).
export function viewerBlocked(method: string, path: string): boolean {
  const readOnly = method === 'GET' || method === 'HEAD';
  const privateData = /\/documents\/[^/]+\/file$/.test(path) || path.startsWith('/v1/notifications');
  return !readOnly || privateData;
}
