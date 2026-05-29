import { HealthChecker, okChecker, runReadinessChecks } from './checker';

describe('okChecker', () => {
  it('returns name and healthy=true', async () => {
    const c = okChecker('postgres');
    expect(c.name).toBe('postgres');
    const r = await c.check();
    expect(r.healthy).toBe(true);
  });
});

describe('runReadinessChecks', () => {
  it('returns ready=true with no checkers', async () => {
    const report = await runReadinessChecks([]);
    expect(report.ready).toBe(true);
    expect(report.checks).toEqual([]);
  });

  it('returns ready=true when all checkers pass', async () => {
    const report = await runReadinessChecks([
      okChecker('postgres'),
      okChecker('redis'),
    ]);
    expect(report.ready).toBe(true);
    expect(report.checks.map((c) => c.name).sort()).toEqual(['postgres', 'redis']);
    expect(report.checks.every((c) => c.healthy)).toBe(true);
  });

  it('returns ready=false when any checker fails', async () => {
    const failing: HealthChecker = {
      name: 'redis',
      check: async () => ({ healthy: false, message: 'connection refused' }),
    };
    const report = await runReadinessChecks([okChecker('postgres'), failing]);
    expect(report.ready).toBe(false);
    const redis = report.checks.find((c) => c.name === 'redis');
    expect(redis?.healthy).toBe(false);
    expect(redis?.message).toBe('connection refused');
  });

  it('captures thrown errors as unhealthy with the error message', async () => {
    const throwing: HealthChecker = {
      name: 'broken',
      check: async () => {
        throw new Error('boom');
      },
    };
    const report = await runReadinessChecks([throwing]);
    expect(report.ready).toBe(false);
    expect(report.checks[0].healthy).toBe(false);
    expect(report.checks[0].message).toBe('boom');
  });

  it('captures non-Error throws as unknown_error', async () => {
    const throwing: HealthChecker = {
      name: 'weird',
      check: async () => {
        throw 'string-thrown';
      },
    };
    const report = await runReadinessChecks([throwing]);
    expect(report.checks[0].message).toBe('unknown_error');
  });

  it('times out a hanging checker', async () => {
    const hanging: HealthChecker = {
      name: 'slow',
      check: () => new Promise(() => undefined), // never resolves
    };
    const report = await runReadinessChecks([hanging], 50);
    expect(report.ready).toBe(false);
    expect(report.checks[0].message).toMatch(/timeout after 50ms/);
  });

  it('records latency_ms for each checker', async () => {
    const report = await runReadinessChecks([okChecker('postgres')]);
    expect(typeof report.checks[0].latency_ms).toBe('number');
    expect(report.checks[0].latency_ms!).toBeGreaterThanOrEqual(0);
  });

  it('preserves a checker-supplied latency_ms when present', async () => {
    const supplier: HealthChecker = {
      name: 'measured',
      check: async () => ({ healthy: true, latency_ms: 123.45 }),
    };
    const report = await runReadinessChecks([supplier]);
    expect(report.checks[0].latency_ms).toBe(123.45);
  });

  it('runs checkers in parallel', async () => {
    const start = Date.now();
    const slow = (name: string, ms: number): HealthChecker => ({
      name,
      check: async () => {
        await new Promise((r) => setTimeout(r, ms));
        return { healthy: true };
      },
    });
    await runReadinessChecks([slow('a', 40), slow('b', 40), slow('c', 40)]);
    // Sequential execution would take ~120ms; parallel should be ~40-60ms.
    expect(Date.now() - start).toBeLessThan(100);
  });
});
