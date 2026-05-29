import express, { Express } from 'express';
import { correlationIdMiddleware, createRequestLoggerMiddleware } from './middleware';
import { createLogger, Logger } from './logger';
import {
  createMetrics,
  createHttpMetricsMiddleware,
  createMetricsRouter,
  Metrics,
} from './metrics';
import { createHealthRouter, HealthChecker, okChecker } from './health';

export interface AppOptions {
  /** Service name attached to every log entry */
  service?: string;
  /** Build version / git SHA reported by GET /health */
  version?: string;
  /** Dependency checkers consulted by GET /health/ready */
  checkers?: HealthChecker[];
  /** Pre-built logger (lets tests capture output) */
  logger?: Logger;
  /** Pre-built metrics registry (lets tests use isolated registries) */
  metrics?: Metrics;
}

export interface AppContext {
  app: Express;
  logger: Logger;
  metrics: Metrics;
}

/**
 * Minimal app factory mounting WO-005 middlewares (correlation + request
 * logger) and WO-006 observability routes (/health, /health/ready, /metrics).
 *
 * Domain routes (auth, thoughts, etc.) will be mounted by WO-008's expanded
 * Express foundation — this factory intentionally exposes the underlying
 * `app` so future WOs can attach more routers without rewriting the wiring.
 */
export function createApp(options: AppOptions = {}): AppContext {
  const service = options.service ?? 'thoughtflow-api';
  const version = options.version ?? process.env.APP_VERSION ?? 'dev';
  const checkers = options.checkers ?? [okChecker('postgres'), okChecker('redis')];

  const logger = options.logger ?? createLogger({ service });
  const metrics = options.metrics ?? createMetrics();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.use(correlationIdMiddleware);
  app.use(createHttpMetricsMiddleware(metrics));
  app.use(createRequestLoggerMiddleware(logger));

  app.use(createHealthRouter({ version, checkers }));
  app.use(createMetricsRouter(metrics));

  return { app, logger, metrics };
}
