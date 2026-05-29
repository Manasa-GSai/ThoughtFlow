import { RedisTokenStore, RedisRateLimiterStore } from './adapters';
import { RedisSessionHelper } from './session-helper';
import { createMockRedis } from './test-fixtures';
import { RefreshTokenRecord } from '../auth';

function record(token_id: string, user_id: string, ms_from_now: number): RefreshTokenRecord {
  return { token_id, user_id, expires_at: new Date(Date.now() + ms_from_now) };
}

describe('RedisTokenStore (WO-007 TokenStore impl)', () => {
  function buildStore(): RedisTokenStore {
    return new RedisTokenStore(new RedisSessionHelper(createMockRedis()));
  }

  it('put + get round-trip', async () => {
    const store = buildStore();
    await store.put(record('t1', 'u1', 60_000));
    const got = await store.get('t1');
    expect(got?.user_id).toBe('u1');
  });

  it('returns null for unknown token_id', async () => {
    const store = buildStore();
    expect(await store.get('nope')).toBeNull();
  });

  it('returns null when the record has expired', async () => {
    const store = buildStore();
    await store.put(record('t1', 'u1', -1));
    expect(await store.get('t1')).toBeNull();
  });

  it('revoke removes a token (idempotent)', async () => {
    const store = buildStore();
    await store.put(record('t1', 'u1', 60_000));
    await store.revoke('t1');
    expect(await store.get('t1')).toBeNull();
    await expect(store.revoke('t1')).resolves.toBeUndefined();
  });

  it('revokeAllForUser revokes that user only', async () => {
    const store = buildStore();
    await store.put(record('a1', 'alice', 60_000));
    await store.put(record('a2', 'alice', 60_000));
    await store.put(record('b1', 'bob', 60_000));

    await store.revokeAllForUser('alice');

    expect(await store.get('a1')).toBeNull();
    expect(await store.get('a2')).toBeNull();
    expect((await store.get('b1'))?.user_id).toBe('bob');
  });
});

describe('RedisRateLimiterStore (WO-007 RateLimiterStore impl)', () => {
  // Each test uses a unique key prefix to avoid ioredis-mock shared-state bleed.
  it('increments monotonically within a window', async () => {
    const store = new RedisRateLimiterStore(createMockRedis());
    expect(await store.hit('monotonic:1.2.3.4', 60_000)).toBe(1);
    expect(await store.hit('monotonic:1.2.3.4', 60_000)).toBe(2);
    expect(await store.hit('monotonic:1.2.3.4', 60_000)).toBe(3);
  });

  it('isolates buckets by key', async () => {
    const store = new RedisRateLimiterStore(createMockRedis());
    expect(await store.hit('isolate:1.2.3.4', 60_000)).toBe(1);
    expect(await store.hit('isolate:5.6.7.8', 60_000)).toBe(1);
  });

  it('resets after the TTL expires', async () => {
    const store = new RedisRateLimiterStore(createMockRedis());
    await store.hit('reset:k', 100); // 100ms TTL
    await new Promise((r) => setTimeout(r, 150));
    expect(await store.hit('reset:k', 100)).toBe(1);
  });
});
