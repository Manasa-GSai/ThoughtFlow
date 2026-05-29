/**
 * Contract for readiness checks against external dependencies.
 *
 * Real implementations land with their owning work orders:
 *   - PostgreSQL checker → WO-003 (DB schema + connection pool)
 *   - Redis checker → WO-004 (cache + rate limiter)
 *
 * For tests and for the WO-006 baseline, a no-op `okChecker` lets the
 * readiness endpoint return 200 until those WOs land. Each checker has 5s
 * to respond; longer responses are surfaced as a timeout failure so a
 * stuck dependency cannot wedge the readiness probe.
 */
export interface HealthChecker {
  name: string;
  check(): Promise<HealthCheckResult>;
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latency_ms?: number;
}

export interface CheckerReport {
  name: string;
  healthy: boolean;
  message?: string;
  latency_ms?: number;
}

export interface ReadinessReport {
  ready: boolean;
  checks: CheckerReport[];
}

const DEFAULT_TIMEOUT_MS = 5000;

export async function runReadinessChecks(
  checkers: HealthChecker[],
  timeout_ms: number = DEFAULT_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const reports = await Promise.all(
    checkers.map((checker) => runWithTimeout(checker, timeout_ms)),
  );
  return {
    ready: reports.every((r) => r.healthy),
    checks: reports,
  };
}

async function runWithTimeout(
  checker: HealthChecker,
  timeout_ms: number,
): Promise<CheckerReport> {
  const start = process.hrtime.bigint();
  try {
    const result = await Promise.race([
      checker.check(),
      new Promise<HealthCheckResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`timeout after ${timeout_ms}ms`)),
          timeout_ms,
        ),
      ),
    ]);
    const elapsed_ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    return {
      name: checker.name,
      healthy: result.healthy,
      ...(result.message ? { message: result.message } : {}),
      latency_ms: result.latency_ms ?? Math.round(elapsed_ms * 100) / 100,
    };
  } catch (err) {
    const elapsed_ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    const message = err instanceof Error ? err.message : 'unknown_error';
    return {
      name: checker.name,
      healthy: false,
      message,
      latency_ms: Math.round(elapsed_ms * 100) / 100,
    };
  }
}

/**
 * Always-healthy checker — used as a placeholder until real dependency
 * checkers land. Also useful in unit tests for the readiness aggregator.
 */
export function okChecker(name: string): HealthChecker {
  return {
    name,
    check: async () => ({ healthy: true }),
  };
}
