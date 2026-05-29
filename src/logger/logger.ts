import pino, { Logger as PinoLogger, LoggerOptions, DestinationStream } from 'pino';
import { getCorrelationContext } from './correlation';
import { redactSensitive } from './sensitive-paths';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LoggerConfig {
  service: string;
  level?: LogLevel;
  destination?: DestinationStream;
}

/**
 * Resolve the effective log level.
 *
 * Precedence:
 *   1. Explicit override (config.level)
 *   2. LOG_LEVEL env var
 *   3. NODE_ENV-based default: staging → debug, production/default → info
 *
 * ERROR and WARN are always emitted because pino includes everything at or
 * above the configured level (info < warn < error).
 */
export function resolveLogLevel(
  envLevel: string | undefined,
  nodeEnv: string | undefined,
  override?: LogLevel,
): LogLevel {
  if (override) return override;
  if (envLevel && isValidLevel(envLevel)) return envLevel;
  if (nodeEnv === 'staging') return 'debug';
  return 'info';
}

function isValidLevel(level: string): level is LogLevel {
  return ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].includes(level);
}

export interface Logger {
  fatal(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
  trace(message: string, metadata?: Record<string, unknown>): void;
}

export function createLogger(config: LoggerConfig): Logger {
  const level = resolveLogLevel(
    process.env.LOG_LEVEL,
    process.env.NODE_ENV,
    config.level,
  );

  const pinoOptions: LoggerOptions = {
    level,
    base: { service: config.service },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    messageKey: 'message',
  };

  const pinoLogger: PinoLogger = config.destination
    ? pino(pinoOptions, config.destination)
    : pino(pinoOptions);

  return wrap(pinoLogger);
}

function wrap(pinoLogger: PinoLogger): Logger {
  const log = (level: LogLevel) =>
    (message: string, metadata?: Record<string, unknown>): void => {
      const ctx = getCorrelationContext();
      const payload: Record<string, unknown> = {};
      if (ctx?.correlation_id) payload.correlation_id = ctx.correlation_id;
      if (ctx?.user_id) payload.user_id = ctx.user_id;
      if (metadata) payload.metadata = redactSensitive(metadata);
      pinoLogger[level](payload, message);
    };

  return {
    fatal: log('fatal'),
    error: log('error'),
    warn: log('warn'),
    info: log('info'),
    debug: log('debug'),
    trace: log('trace'),
  };
}
