import type Redis from 'ioredis';
import { HealthChecker, HealthCheckResult } from '../health';

/**
 * Plugs into WO-006's readiness probe: GET /health/ready will now consult
 * a live Redis PING instead of the okChecker placeholder.
 *
 * PING is the canonical liveness check — it's cheap (~sub-ms RTT in-cluster)
 * and exercises both the TCP connection and the Redis server itself. Returns
 * unhealthy if Redis is unreachable, not yet authenticated, or returns
 * anything other than 'PONG'.
 */
export class RedisHealthChecker implements HealthChecker {
  readonly name = 'redis';

  constructor(private readonly redis: Redis) {}

  async check(): Promise<HealthCheckResult> {
    const start = process.hrtime.bigint();
    try {
      const result = await this.redis.ping();
      const latency_ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      if (result !== 'PONG') {
        return { healthy: false, message: `unexpected PING response: ${result}`, latency_ms };
      }
      return { healthy: true, latency_ms: Math.round(latency_ms * 100) / 100 };
    } catch (err) {
      const latency_ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      const message = err instanceof Error ? err.message : 'unknown_redis_error';
      return { healthy: false, message, latency_ms: Math.round(latency_ms * 100) / 100 };
    }
  }
}
