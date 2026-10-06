import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken, verifyAccessToken } from './jwt';

describe('passwords', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const { hash, salt } = await hashPassword('Correct-horse-1');
    expect(await verifyPassword('Correct-horse-1', hash, salt)).toBe(true);
    expect(await verifyPassword('Correct-horse-2', hash, salt)).toBe(false);
  });

  it('uses a fresh salt each time, so equal passwords hash differently', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('access tokens', () => {
  const auth = { orgId: 'org-1', userId: 'u1', role: 'manager' as const, driverId: null };

  it('round-trips the identity', async () => {
    const token = await signAccessToken(auth, 'secret-one');
    expect(await verifyAccessToken(token, 'secret-one')).toEqual(auth);
  });

  it('rejects a token signed with another secret or altered', async () => {
    const token = await signAccessToken(auth, 'secret-one');
    await expect(verifyAccessToken(token, 'secret-two')).rejects.toThrow();
    const [h, p, s] = token.split('.');
    const forged = `${h}.${btoa(JSON.stringify({ ...auth, role: 'manager', userId: 'someone-else', exp: 9999999999 })).replace(/=+$/, '')}.${s}`;
    expect(p).not.toBe(forged.split('.')[1]);
    await expect(verifyAccessToken(forged, 'secret-one')).rejects.toThrow();
  });
});
