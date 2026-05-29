import http from 'node:http';
import { createApp, AppContext } from './app';
import { Logger } from './logger';

export interface ServerStartOptions {
  port?: number;
  /** Maximum time to wait for in-flight requests on shutdown. Default 30s (AC #6). */
  shutdown_timeout_ms?: number;
  /**
   * Whether to install SIGTERM/SIGINT handlers. Default true in production usage;
   * tests pass false so spawn-and-close doesn't leak listeners on the process.
   */
  install_signal_handlers?: boolean;
  /** Optional injected AppContext for tests; otherwise createApp() is called. */
  context?: AppContext;
}

export interface RunningServer {
  server: http.Server;
  context: AppContext;
  /** Stops accepting new connections and drains in-flight requests. */
  stop: () => Promise<void>;
}

export const DEFAULT_PORT = 3001;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Server bootstrap (AC #1, #6).
 *
 * Listening:
 *   - PORT env var or options.port → defaults to 3001 (matches the architecture
 *     "API Container" config and Forge Shipping deployment templates)
 *
 * Graceful shutdown:
 *   - On SIGTERM / SIGINT: server.close() stops accepting new connections,
 *     then we wait up to shutdown_timeout_ms for in-flight requests to finish.
 *     If the timeout fires, we force-exit with code 1 so the orchestrator
 *     can recycle the pod.
 *   - Redis client is quit() in the same window so reconnect-storms don't
 *     happen mid-shutdown.
 *
 * Returns a RunningServer for test harnesses that need programmatic stop().
 */
export async function startServer(options: ServerStartOptions = {}): Promise<RunningServer> {
  const ctx = options.context ?? createApp();
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const shutdown_timeout_ms = options.shutdown_timeout_ms ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const install_signals = options.install_signal_handlers ?? true;

  const server = http.createServer(ctx.app);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });

  ctx.logger.info('server_started', { port });

  let shutting_down = false;
  const stop = async (): Promise<void> => {
    if (shutting_down) return;
    shutting_down = true;
    ctx.logger.info('server_shutting_down', { timeout_ms: shutdown_timeout_ms });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ctx.logger.warn('server_shutdown_timed_out_forcing_close', { timeout_ms: shutdown_timeout_ms });
        resolve();
      }, shutdown_timeout_ms);
      // ensure the timer doesn't keep the event loop alive after server.close() resolves
      timer.unref();

      server.close((err) => {
        clearTimeout(timer);
        if (err) {
          ctx.logger.error('server_close_error', { error_message: err.message });
        } else {
          ctx.logger.info('server_closed');
        }
        resolve();
      });
    });

    if (ctx.redis) {
      try {
        await ctx.redis.quit();
        ctx.logger.info('redis_closed');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown_error';
        ctx.logger.warn('redis_close_error', { error_message: message });
      }
    }
  };

  if (install_signals) {
    const handle = (signal: NodeJS.Signals): void => {
      void stop().then(() => {
        // Give async log writes a tick to flush before exit
        setImmediate(() => process.exit(signal === 'SIGTERM' ? 0 : 0));
      });
    };
    process.once('SIGTERM', handle);
    process.once('SIGINT', handle);
  }

  return { server, context: ctx, stop };
}

/** Exposed for tests + the central CLI script's `if (require.main === module)`. */
export function isMainModule(): boolean {
  return typeof require !== 'undefined' && require.main === module;
}

if (isMainModule()) {
  startServer().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'unknown_error';
    void asyncLogStartupFailure(message);
    process.exit(1);
  });
}

async function asyncLogStartupFailure(message: string): Promise<void> {
  // Fallback to a temp logger if createApp threw before we had one.
  const { createLogger } = await import('./logger');
  const logger: Logger = createLogger({ service: 'thoughtflow-api' });
  logger.fatal('server_startup_failed', { error_message: message });
}
