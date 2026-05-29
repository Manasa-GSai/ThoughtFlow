import { Writable } from 'node:stream';
import { createLogger, resolveLogLevel } from './logger';
import { runWithCorrelation } from './correlation';
import { REDACTED_VALUE } from './sensitive-paths';

/**
 * Captures pino output into an in-memory buffer of parsed JSON entries so
 * tests can assert exact field shape without touching stdout.
 */
function makeCapture(): { stream: Writable; entries: Array<Record<string, unknown>> } {
  const entries: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      const line = chunk.toString().trim();
      if (line) entries.push(JSON.parse(line));
      cb();
    },
  });
  return { stream, entries };
}

describe('resolveLogLevel', () => {
  it('explicit override wins over env and node_env', () => {
    expect(resolveLogLevel('error', 'production', 'debug')).toBe('debug');
  });

  it('LOG_LEVEL env var wins when no override', () => {
    expect(resolveLogLevel('warn', 'production', undefined)).toBe('warn');
  });

  it('staging defaults to debug', () => {
    expect(resolveLogLevel(undefined, 'staging', undefined)).toBe('debug');
  });

  it('production defaults to info', () => {
    expect(resolveLogLevel(undefined, 'production', undefined)).toBe('info');
  });

  it('unspecified env defaults to info', () => {
    expect(resolveLogLevel(undefined, undefined, undefined)).toBe('info');
  });

  it('ignores invalid LOG_LEVEL values', () => {
    expect(resolveLogLevel('LOUD', 'production', undefined)).toBe('info');
  });
});

describe('createLogger — JSON format', () => {
  it('emits valid JSON with required fields', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'test-svc', level: 'info', destination: stream });

    logger.info('hello');

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(entry.level).toBe('info');
    expect(entry.service).toBe('test-svc');
    expect(entry.message).toBe('hello');
  });

  it('includes metadata object when provided', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('event', { foo: 'bar', count: 3 });

    expect(entries[0].metadata).toEqual({ foo: 'bar', count: 3 });
  });

  it('omits metadata key when not provided', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('plain');

    expect(entries[0]).not.toHaveProperty('metadata');
  });
});

describe('createLogger — correlation propagation', () => {
  it('attaches correlation_id from AsyncLocalStorage', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    runWithCorrelation({ correlation_id: 'corr-xyz' }, () => {
      logger.info('inside');
    });

    expect(entries[0].correlation_id).toBe('corr-xyz');
  });

  it('attaches user_id when present in context', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    runWithCorrelation({ correlation_id: 'c1', user_id: 'u-7' }, () => {
      logger.info('authed');
    });

    expect(entries[0].user_id).toBe('u-7');
  });

  it('omits correlation_id when called outside a run scope', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('orphan');

    expect(entries[0]).not.toHaveProperty('correlation_id');
  });

  it('propagates correlation through async boundaries', async () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    await runWithCorrelation({ correlation_id: 'async-corr' }, async () => {
      await Promise.resolve();
      logger.info('after-await');
    });

    expect(entries[0].correlation_id).toBe('async-corr');
  });
});

describe('createLogger — sensitive data filtering', () => {
  it('redacts password in metadata', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('login_attempt', { password: 'hunter2', username: 'alice' });

    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.password).toBe(REDACTED_VALUE);
    expect(meta.username).toBe('alice');
  });

  it('redacts token in metadata', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('auth', { token: 'jwt-secret-xyz' });

    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.token).toBe(REDACTED_VALUE);
  });

  it('redacts audio payloads', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('capture', { audio: 'binary-blob-bytes', audio_blob: 'more-bytes' });

    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.audio).toBe(REDACTED_VALUE);
    expect(meta.audio_blob).toBe(REDACTED_VALUE);
  });

  it('redacts transcription text', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('transcribed', {
      transcript: 'private thought contents',
      transcription: 'also private',
    });

    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.transcript).toBe(REDACTED_VALUE);
    expect(meta.transcription).toBe(REDACTED_VALUE);
  });

  it('redacts nested sensitive fields one level deep', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.info('nested', { body: { password: 'p', other: 'ok' } });

    const meta = entries[0].metadata as Record<string, unknown>;
    const body = meta.body as Record<string, unknown>;
    expect(body.password).toBe(REDACTED_VALUE);
    expect(body.other).toBe('ok');
  });
});

describe('createLogger — level filtering', () => {
  it('drops entries below the configured level', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'warn', destination: stream });

    logger.debug('debug-msg');
    logger.info('info-msg');
    logger.warn('warn-msg');
    logger.error('error-msg');

    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('warn-msg');
    expect(entries[1].message).toBe('error-msg');
  });

  it('always emits ERROR even at info default', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.error('boom');

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
  });

  it('always emits WARN even at info default', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'info', destination: stream });

    logger.warn('careful');

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
  });

  it('emits debug when level is debug', () => {
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', level: 'debug', destination: stream });

    logger.debug('details');

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('debug');
  });
});

describe('createLogger — env-driven level', () => {
  const origLevel = process.env.LOG_LEVEL;
  const origNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (origLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = origLevel;
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
  });

  it('uses LOG_LEVEL env var when no explicit level', () => {
    process.env.LOG_LEVEL = 'error';
    delete process.env.NODE_ENV;
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', destination: stream });

    logger.warn('should-drop');
    logger.error('should-keep');

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('should-keep');
  });

  it('staging NODE_ENV defaults to debug', () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'staging';
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', destination: stream });

    logger.debug('staging-debug');

    expect(entries).toHaveLength(1);
  });

  it('production NODE_ENV defaults to info (drops debug)', () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'production';
    const { stream, entries } = makeCapture();
    const logger = createLogger({ service: 'svc', destination: stream });

    logger.debug('prod-debug');
    logger.info('prod-info');

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('prod-info');
  });
});
