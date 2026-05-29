import {
  runWithCorrelation,
  getCorrelationContext,
  getCorrelationId,
  setUserId,
} from './correlation';

describe('correlation context', () => {
  it('returns undefined when accessed outside a run scope', () => {
    expect(getCorrelationContext()).toBeUndefined();
    expect(getCorrelationId()).toBeUndefined();
  });

  it('exposes the correlation_id inside the run scope', () => {
    const result = runWithCorrelation({ correlation_id: 'abc-123' }, () => {
      return getCorrelationId();
    });
    expect(result).toBe('abc-123');
  });

  it('propagates context through nested synchronous calls', () => {
    runWithCorrelation({ correlation_id: 'outer' }, () => {
      const inner = (): string | undefined => getCorrelationId();
      expect(inner()).toBe('outer');
    });
  });

  it('propagates context through async/await chains', async () => {
    await runWithCorrelation({ correlation_id: 'async-id' }, async () => {
      await Promise.resolve();
      await Promise.resolve();
      expect(getCorrelationId()).toBe('async-id');
    });
  });

  it('propagates context across setTimeout boundaries', async () => {
    const captured = await new Promise<string | undefined>((resolve) => {
      runWithCorrelation({ correlation_id: 'timer-id' }, () => {
        setTimeout(() => resolve(getCorrelationId()), 1);
      });
    });
    expect(captured).toBe('timer-id');
  });

  it('isolates parallel contexts — no cross-contamination', async () => {
    const results = await Promise.all([
      runWithCorrelation({ correlation_id: 'req-A' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCorrelationId();
      }),
      runWithCorrelation({ correlation_id: 'req-B' }, async () => {
        await new Promise((r) => setTimeout(r, 2));
        return getCorrelationId();
      }),
    ]);
    expect(results).toEqual(['req-A', 'req-B']);
  });

  it('setUserId mutates the active context', () => {
    runWithCorrelation({ correlation_id: 'with-user' }, () => {
      setUserId('user-42');
      expect(getCorrelationContext()?.user_id).toBe('user-42');
    });
  });

  it('setUserId is a no-op outside a run scope', () => {
    expect(() => setUserId('lost-user')).not.toThrow();
  });
});
