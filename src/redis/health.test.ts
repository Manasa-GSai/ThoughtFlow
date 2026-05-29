import { RedisHealthChecker } from './health';
import { createMockRedis } from './test-fixtures';
import type Redis from 'ioredis';

describe('RedisHealthChecker', () => {
  it('reports healthy when PING returns PONG', async () => {
    const checker = new RedisHealthChecker(createMockRedis());
    const result = await checker.check();
    expect(result.healthy).toBe(true);
    expect(typeof result.latency_ms).toBe('number');
  });

  it('reports unhealthy with error message when PING throws', async () => {
    const broken = {
      ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Redis;
    const checker = new RedisHealthChecker(broken);
    const result = await checker.check();
    expect(result.healthy).toBe(false);
    expect(result.message).toBe('ECONNREFUSED');
  });

  it('handles non-Error throws gracefully', async () => {
    const broken = {
      ping: jest.fn().mockRejectedValue('a string'),
    } as unknown as Redis;
    const checker = new RedisHealthChecker(broken);
    const result = await checker.check();
    expect(result.healthy).toBe(false);
    expect(result.message).toBe('unknown_redis_error');
  });

  it('reports unhealthy when PING returns an unexpected value', async () => {
    const wonky = {
      ping: jest.fn().mockResolvedValue('NOPE'),
    } as unknown as Redis;
    const checker = new RedisHealthChecker(wonky);
    const result = await checker.check();
    expect(result.healthy).toBe(false);
    expect(result.message).toContain('NOPE');
  });

  it('name is "redis"', () => {
    expect(new RedisHealthChecker(createMockRedis()).name).toBe('redis');
  });
});
