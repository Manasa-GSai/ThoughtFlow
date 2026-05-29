import { RedisRateLimitHelper, TIER_LIMITS } from './rate-limit-helper';
import { createMockRedis } from './test-fixtures';

describe('TIER_LIMITS (AC #5, #6)', () => {
  it('Free tier: 20 captures/day, 30 API calls/min', () => {
    expect(TIER_LIMITS.free.capture.max).toBe(20);
    expect(TIER_LIMITS.free.capture.window_ms).toBe(24 * 60 * 60 * 1000);
    expect(TIER_LIMITS.free.api.max).toBe(30);
    expect(TIER_LIMITS.free.api.window_ms).toBe(60 * 1000);
  });

  it('Pro tier: unlimited captures, 100 API calls/min', () => {
    expect(TIER_LIMITS.pro.capture.max).toBe(Number.POSITIVE_INFINITY);
    expect(TIER_LIMITS.pro.api.max).toBe(100);
  });

  it('Enterprise tier matches Pro', () => {
    expect(TIER_LIMITS.enterprise.capture.max).toBe(Number.POSITIVE_INFINITY);
    expect(TIER_LIMITS.enterprise.api.max).toBe(100);
  });
});

describe('RedisRateLimitHelper.checkRateLimit', () => {
  it('Free tier capture: allows the first 20 requests, blocks the 21st', async () => {
    const helper = new RedisRateLimitHelper(createMockRedis());
    for (let i = 0; i < 20; i += 1) {
      const result = await helper.checkRateLimit('user-1', 'free', 'capture');
      expect(result.allowed).toBe(true);
    }
    const blocked = await helper.checkRateLimit('user-1', 'free', 'capture');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(20);
  });

  it('Pro tier capture: always allowed (unlimited)', async () => {
    const helper = new RedisRateLimitHelper(createMockRedis());
    for (let i = 0; i < 100; i += 1) {
      const r = await helper.checkRateLimit('user-1', 'pro', 'capture');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('Free tier API: blocks the 31st call', async () => {
    const helper = new RedisRateLimitHelper(createMockRedis());
    for (let i = 0; i < 30; i += 1) {
      await helper.checkRateLimit('user-2', 'free', 'api');
    }
    const blocked = await helper.checkRateLimit('user-2', 'free', 'api');
    expect(blocked.allowed).toBe(false);
  });

  it('Pro tier API: blocks the 101st call', async () => {
    const helper = new RedisRateLimitHelper(createMockRedis());
    for (let i = 0; i < 100; i += 1) {
      await helper.checkRateLimit('user-3', 'pro', 'api');
    }
    const blocked = await helper.checkRateLimit('user-3', 'pro', 'api');
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(100);
  });

  it('isolates buckets between users', async () => {
    const helper = new RedisRateLimitHelper(createMockRedis());
    for (let i = 0; i < 30; i += 1) {
      await helper.checkRateLimit('alice', 'free', 'api');
    }
    const aliceBlocked = await helper.checkRateLimit('alice', 'free', 'api');
    const bobOk = await helper.checkRateLimit('bob', 'free', 'api');
    expect(aliceBlocked.allowed).toBe(false);
    expect(bobOk.allowed).toBe(true);
  });

  it('isolates buckets between actions', async () => {
    const helper = new RedisRateLimitHelper(createMockRedis());
    // Use up the API budget...
    for (let i = 0; i < 30; i += 1) {
      await helper.checkRateLimit('user', 'free', 'api');
    }
    const apiBlocked = await helper.checkRateLimit('user', 'free', 'api');
    expect(apiBlocked.allowed).toBe(false);

    // ...captures are an independent bucket
    const captureOk = await helper.checkRateLimit('user', 'free', 'capture');
    expect(captureOk.allowed).toBe(true);
  });

  it('rejected requests do not permanently inflate the count beyond the limit', async () => {
    const helper = new RedisRateLimitHelper(createMockRedis());
    for (let i = 0; i < 30; i += 1) {
      await helper.checkRateLimit('u', 'free', 'api');
    }
    // 10 rejections — these should NOT decrement remaining further.
    for (let i = 0; i < 10; i += 1) {
      const r = await helper.checkRateLimit('u', 'free', 'api');
      expect(r.allowed).toBe(false);
      expect(r.remaining).toBe(0);
    }
  });

  it('sliding window: old entries fall off after the window elapses', async () => {
    // Drive a clock so we can fast-forward beyond the window.
    let now = 1_000_000_000_000;
    const helper = new RedisRateLimitHelper(createMockRedis(), () => now);

    // Saturate the API bucket
    for (let i = 0; i < 30; i += 1) {
      await helper.checkRateLimit('clock-user', 'free', 'api');
    }
    expect((await helper.checkRateLimit('clock-user', 'free', 'api')).allowed).toBe(false);

    // Advance past the 60s window — all prior entries should fall off
    now += 61_000;
    const after = await helper.checkRateLimit('clock-user', 'free', 'api');
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(29); // we just consumed 1
  });

  it('reset_at is in the future by exactly the window length', async () => {
    let now = 1_000_000_000_000;
    const helper = new RedisRateLimitHelper(createMockRedis(), () => now);
    const result = await helper.checkRateLimit('u', 'free', 'api');
    expect(result.reset_at).toBe(now + 60 * 1000);
  });
});
