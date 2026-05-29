import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';

/**
 * Returns an in-process mock Redis instance suitable for unit tests in any
 * module that depends on a Redis client (AC #10). The mock implements the
 * ioredis Command API including transactions, sorted sets, and SCAN — enough
 * for our session/rate-limit helpers without spinning up a real container.
 *
 * Isolation note: ioredis-mock v8 shares its in-memory data store across
 * instances by default. Tests that share keys across cases should either
 * (a) use unique keys per case, or (b) call `redis.flushall()` in `beforeEach`.
 * Our test suites adopt approach (a) — keys are namespaced by the user_id or
 * test-specific identifier so cross-test contamination is impossible.
 */
export function createMockRedis(): Redis {
  return new (RedisMock as unknown as new () => Redis)();
}
