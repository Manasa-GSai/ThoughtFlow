import Redis, { RedisOptions } from 'ioredis';

/**
 * Redis client factory.
 *
 * Connection policy per architecture "Security Architecture":
 *   - TLS encryption mandatory in production (rediss:// or tls: option)
 *   - Auth via password from secrets manager (REDIS_PASSWORD env var)
 *   - Exponential backoff reconnect: 1s → 2s → 4s → 8s, capped at 30s (AC #2)
 *
 * We intentionally use ioredis (not `redis`) because:
 *   - Cluster support out of the box (architecture: "Cluster mode activated at >25K concurrent")
 *   - Reliable pipeline + transaction support for our sliding-window rate limiter
 *   - First-class TypeScript types
 */
export interface RedisClientOptions {
  /** Full Redis URL (redis:// or rediss://). If unset, returns null (in-memory fallback). */
  url?: string;
  /** Password override (ignored when embedded in url). */
  password?: string;
  /** Force TLS regardless of url scheme. Default: inferred from url. */
  tls?: boolean;
  /** Callback fired on reconnection attempts — wired into the logger by caller. */
  onReconnect?: (attempt: number, delayMs: number) => void;
  /** Callback fired on connection errors. */
  onError?: (err: Error) => void;
  /** Connect timeout in milliseconds. Default 10s. */
  connectTimeoutMs?: number;
}

export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000];
export const RECONNECT_MAX_BACKOFF_MS = 30_000;

/**
 * Compute the next reconnect delay using the backoff schedule (AC #2).
 * After the schedule is exhausted, doubles the last delay until capped at 30s.
 */
export function reconnectDelay(attempt: number): number {
  if (attempt <= 0) return RECONNECT_BACKOFF_MS[0];
  if (attempt < RECONNECT_BACKOFF_MS.length) return RECONNECT_BACKOFF_MS[attempt];
  const doubled = RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1] * Math.pow(2, attempt - RECONNECT_BACKOFF_MS.length + 1);
  return Math.min(doubled, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * Build the ioredis options for a real connection. Extracted so unit tests
 * can assert on the constructed config without spinning up a client.
 */
export function buildIoRedisOptions(options: RedisClientOptions): RedisOptions {
  const url = options.url;
  if (!url) {
    throw new Error('buildIoRedisOptions requires options.url');
  }

  const useTls = options.tls ?? url.startsWith('rediss://');

  return {
    lazyConnect: false,
    connectTimeout: options.connectTimeoutMs ?? 10_000,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    ...(options.password ? { password: options.password } : {}),
    ...(useTls ? { tls: {} } : {}),
    retryStrategy: (attempt: number): number => {
      const delay = reconnectDelay(attempt);
      options.onReconnect?.(attempt, delay);
      return delay;
    },
  };
}

/**
 * Construct a real ioredis client from a URL. Returns null when no URL is
 * provided — the caller is expected to use the in-memory fallback paths
 * (AC #7).
 */
export function createRedisClient(options: RedisClientOptions): Redis | null {
  if (!options.url) return null;
  const client = new Redis(options.url, buildIoRedisOptions(options));
  if (options.onError) {
    client.on('error', options.onError);
  }
  return client;
}
