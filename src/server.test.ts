import { startServer, DEFAULT_PORT, DEFAULT_SHUTDOWN_TIMEOUT_MS } from './server';
import { createApp } from './app';
import { createMetrics } from './metrics';
import { Logger } from './logger';
import { BcryptPasswordHasher, JwtService } from './auth';

const silentLogger: Logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

function buildCtx() {
  return createApp({
    logger: silentLogger,
    metrics: createMetrics({ collectDefaults: false }),
    passwordHasher: new BcryptPasswordHasher(4),
    jwtService: new JwtService({ access_token_secret: 'a', refresh_token_secret: 'r' }),
    secureCookies: false,
    redis: null,
  });
}

describe('startServer (AC #1, #6)', () => {
  it('exposes default constants matching the architecture', () => {
    expect(DEFAULT_PORT).toBe(3001);
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
  });

  it('starts and binds to an OS-assigned port when port=0', async () => {
    const running = await startServer({
      port: 0,
      install_signal_handlers: false,
      context: buildCtx(),
    });
    const addr = running.server.address();
    expect(addr && typeof addr === 'object' && addr.port).toBeGreaterThan(0);
    await running.stop();
  });

  it('graceful stop closes the server', async () => {
    const running = await startServer({
      port: 0,
      install_signal_handlers: false,
      context: buildCtx(),
    });
    expect(running.server.listening).toBe(true);
    await running.stop();
    expect(running.server.listening).toBe(false);
  });

  it('rejects if the port is already in use', async () => {
    const first = await startServer({
      port: 0,
      install_signal_handlers: false,
      context: buildCtx(),
    });
    const addr = first.server.address();
    if (!addr || typeof addr !== 'object') throw new Error('unexpected address shape');

    await expect(
      startServer({
        port: addr.port,
        install_signal_handlers: false,
        context: buildCtx(),
      }),
    ).rejects.toThrow();

    await first.stop();
  });
});
