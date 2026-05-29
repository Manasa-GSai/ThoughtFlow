import { RedisSessionHelper, DEFAULT_REFRESH_TTL_SECONDS } from './session-helper';
import { createMockRedis } from './test-fixtures';

describe('RedisSessionHelper', () => {
  it('storeRefreshToken + getRefreshToken round-trip', async () => {
    const redis = createMockRedis();
    const sessions = new RedisSessionHelper(redis);

    await sessions.storeRefreshToken('user-1', 'jti-1');
    expect(await sessions.getRefreshToken('user-1', 'jti-1')).toBe('jti-1');
  });

  it('returns null for missing token', async () => {
    const sessions = new RedisSessionHelper(createMockRedis());
    expect(await sessions.getRefreshToken('user-1', 'unknown')).toBeNull();
  });

  it('honors TTL — expired token returns null', async () => {
    const redis = createMockRedis();
    const sessions = new RedisSessionHelper(redis);
    await sessions.storeRefreshToken('user-1', 'jti-1', 0); // 0s TTL → already expired by Redis

    // Some ioredis-mock builds treat EX 0 as "do not set"; force expiry via TTL=1 + delay alternative
    await sessions.storeRefreshToken('user-1', 'jti-ttl', 1);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await sessions.getRefreshToken('user-1', 'jti-ttl')).toBeNull();
  });

  it('revokeRefreshToken removes a single token', async () => {
    const sessions = new RedisSessionHelper(createMockRedis());
    await sessions.storeRefreshToken('user-1', 'jti-1');
    await sessions.revokeRefreshToken('user-1', 'jti-1');
    expect(await sessions.getRefreshToken('user-1', 'jti-1')).toBeNull();
  });

  it('revoke is idempotent for unknown token', async () => {
    const sessions = new RedisSessionHelper(createMockRedis());
    await expect(sessions.revokeRefreshToken('user-1', 'nope')).resolves.toBeUndefined();
  });

  it('revokeAllForUser revokes only that user’s tokens', async () => {
    const sessions = new RedisSessionHelper(createMockRedis());
    await sessions.storeRefreshToken('alice', 't1');
    await sessions.storeRefreshToken('alice', 't2');
    await sessions.storeRefreshToken('bob', 't3');

    await sessions.revokeAllForUser('alice');

    expect(await sessions.getRefreshToken('alice', 't1')).toBeNull();
    expect(await sessions.getRefreshToken('alice', 't2')).toBeNull();
    expect(await sessions.getRefreshToken('bob', 't3')).toBe('t3');
  });

  it('DEFAULT_REFRESH_TTL_SECONDS matches the architecture spec (7 days)', () => {
    expect(DEFAULT_REFRESH_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});
