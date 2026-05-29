import {
  buildIoRedisOptions,
  createRedisClient,
  reconnectDelay,
  RECONNECT_BACKOFF_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from './client';

describe('reconnectDelay (AC #2 exponential backoff)', () => {
  it('returns the canonical schedule 1s → 2s → 4s → 8s', () => {
    expect(reconnectDelay(0)).toBe(1000);
    expect(reconnectDelay(1)).toBe(2000);
    expect(reconnectDelay(2)).toBe(4000);
    expect(reconnectDelay(3)).toBe(8000);
  });

  it('caps at 30 seconds regardless of attempt count', () => {
    expect(reconnectDelay(4)).toBeLessThanOrEqual(RECONNECT_MAX_BACKOFF_MS);
    expect(reconnectDelay(50)).toBe(RECONNECT_MAX_BACKOFF_MS);
    expect(reconnectDelay(1000)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('falls back to first backoff entry on negative attempt', () => {
    expect(reconnectDelay(-1)).toBe(RECONNECT_BACKOFF_MS[0]);
  });
});

describe('buildIoRedisOptions', () => {
  it('throws when no url is supplied', () => {
    expect(() => buildIoRedisOptions({ url: undefined as unknown as string })).toThrow(/url/);
  });

  it('infers TLS from rediss:// scheme', () => {
    const opts = buildIoRedisOptions({ url: 'rediss://prod-cache:6379' });
    expect(opts.tls).toBeDefined();
  });

  it('does not enable TLS for redis:// scheme', () => {
    const opts = buildIoRedisOptions({ url: 'redis://localhost:6379' });
    expect(opts.tls).toBeUndefined();
  });

  it('explicit tls=true overrides scheme inference', () => {
    const opts = buildIoRedisOptions({ url: 'redis://localhost:6379', tls: true });
    expect(opts.tls).toBeDefined();
  });

  it('attaches the password when provided', () => {
    const opts = buildIoRedisOptions({ url: 'redis://x', password: 'sekret' });
    expect(opts.password).toBe('sekret');
  });

  it('omits password when not provided', () => {
    const opts = buildIoRedisOptions({ url: 'redis://x' });
    expect(opts.password).toBeUndefined();
  });

  it('configures retryStrategy that fires the onReconnect callback', () => {
    const seen: Array<{ attempt: number; delay: number }> = [];
    const opts = buildIoRedisOptions({
      url: 'redis://x',
      onReconnect: (attempt, delay) => seen.push({ attempt, delay }),
    });
    expect(typeof opts.retryStrategy).toBe('function');
    const delay = opts.retryStrategy!(2);
    expect(delay).toBe(4000);
    expect(seen).toEqual([{ attempt: 2, delay: 4000 }]);
  });

  it('uses default connect timeout when not specified', () => {
    const opts = buildIoRedisOptions({ url: 'redis://x' });
    expect(opts.connectTimeout).toBe(10_000);
  });

  it('honors a custom connect timeout', () => {
    const opts = buildIoRedisOptions({ url: 'redis://x', connectTimeoutMs: 2000 });
    expect(opts.connectTimeout).toBe(2000);
  });
});

describe('createRedisClient', () => {
  it('returns null when no url is supplied (in-memory fallback path)', () => {
    expect(createRedisClient({})).toBeNull();
  });
});
