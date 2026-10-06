import { describe, expect, it } from 'vitest';
import { resolveAuth, viewerBlocked } from './authCheck';
import type { AuthContext } from '../types';

const token: AuthContext = { orgId: 'org-1', userId: 'u1', role: 'office', driverId: null };

describe('resolveAuth', () => {
  it('uses the role in the database, not the one in the token', () => {
    const auth = resolveAuth(token, { orgId: 'org-1', role: 'viewer', driverId: null, disabledAt: null });
    expect(auth?.role).toBe('viewer');
  });

  it('refuses a deleted account', () => {
    expect(resolveAuth(token, undefined)).toBeNull();
  });

  it('refuses a disabled account', () => {
    expect(resolveAuth(token, { orgId: 'org-1', role: 'office', driverId: null, disabledAt: '2026-10-04' })).toBeNull();
  });

  it('refuses a token whose company no longer matches the account', () => {
    expect(resolveAuth(token, { orgId: 'org-2', role: 'office', driverId: null, disabledAt: null })).toBeNull();
  });
});

describe('viewerBlocked', () => {
  it('lets a viewer read ordinary data', () => {
    for (const path of ['/v1/trips', '/v1/trips/abc', '/v1/vehicles', '/v1/monthly-expenses', '/v1/settings']) {
      expect(viewerBlocked('GET', path)).toBe(false);
    }
  });

  it('blocks every write', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(viewerBlocked(method, '/v1/trips')).toBe(true);
      expect(viewerBlocked(method, '/v1/trips/abc/expenses/e1')).toBe(true);
    }
  });

  it('blocks bill downloads and the notification feed', () => {
    expect(viewerBlocked('GET', '/v1/trips/abc/documents/d1/file')).toBe(true);
    expect(viewerBlocked('GET', '/v1/monthly-expenses/abc/documents/d1/file')).toBe(true);
    expect(viewerBlocked('GET', '/v1/notifications')).toBe(true);
  });
});
