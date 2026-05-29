import {
  InMemorySessionHelper,
  InMemoryRateLimitHelper,
} from './in-memory-fallback';

describe('InMemorySessionHelper (AC #7 fallback)', () => {
  it('round-trips a refresh token', async () => {
    const sessions = new InMemorySessionHelper();
    await sessions.storeRefreshToken('u', 'jti1');
    expect(await sessions.getRefreshToken('u', 'jti1')).toBe('jti1');
  });

  it('expires tokens after TTL', async () => {
    const sessions = new InMemorySessionHelper();
    await sessions.storeRefreshToken('u', 'jti1', 0); // 0s TTL → already expired
    expect(await sessions.getRefreshToken('u', 'jti1')).toBeNull();
  });

  it('revokeAllForUser scoped to one user', async () => {
    const sessions = new InMemorySessionHelper();
    await sessions.storeRefreshToken('alice', 't1');
    await sessions.storeRefreshToken('alice', 't2');
    await sessions.storeRefreshToken('bob', 't3');
    await sessions.revokeAllForUser('alice');
    expect(await sessions.getRefreshToken('alice', 't1')).toBeNull();
    expect(await sessions.getRefreshToken('bob', 't3')).toBe('t3');
  });
});

describe('InMemoryRateLimitHelper (AC #7 fallback)', () => {
  it('Free tier API: blocks 31st call (sliding window)', async () => {
    const helper = new InMemoryRateLimitHelper();
    for (let i = 0; i < 30; i += 1) {
      const r = await helper.checkRateLimit('u', 'free', 'api');
      expect(r.allowed).toBe(true);
    }
    const blocked = await helper.checkRateLimit('u', 'free', 'api');
    expect(blocked.allowed).toBe(false);
  });

  it('Pro tier capture: always allowed', async () => {
    const helper = new InMemoryRateLimitHelper();
    for (let i = 0; i < 50; i += 1) {
      expect((await helper.checkRateLimit('u', 'pro', 'capture')).allowed).toBe(true);
    }
  });

  it('rejected requests do not inflate count beyond limit', async () => {
    const helper = new InMemoryRateLimitHelper();
    for (let i = 0; i < 30; i += 1) {
      await helper.checkRateLimit('u', 'free', 'api');
    }
    for (let i = 0; i < 5; i += 1) {
      const r = await helper.checkRateLimit('u', 'free', 'api');
      expect(r.allowed).toBe(false);
      expect(r.remaining).toBe(0);
    }
  });

  it('sliding window evicts old entries when clock advances', async () => {
    let now = 1_000_000_000_000;
    const helper = new InMemoryRateLimitHelper(() => now);
    for (let i = 0; i < 30; i += 1) {
      await helper.checkRateLimit('u', 'free', 'api');
    }
    expect((await helper.checkRateLimit('u', 'free', 'api')).allowed).toBe(false);

    now += 61_000;
    expect((await helper.checkRateLimit('u', 'free', 'api')).allowed).toBe(true);
  });
});
