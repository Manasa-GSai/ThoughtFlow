import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Shape of the metrics surface exposed to the rest of the app.
 *
 * All metric names follow Prometheus naming conventions:
 *   - lowercase + underscores
 *   - units suffixed (_seconds, _total)
 *   - _total suffix for monotonic counters
 *
 * Tests build a fresh Metrics via createMetrics() so they get isolated
 * registries — never share state via a module-level singleton.
 */
export interface Metrics {
  registry: Registry;
  // HTTP (RED method: Rate, Errors, Duration)
  httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  activeConnections: Gauge<string>;
  // External AI APIs
  whisperApiDuration: Histogram<'outcome'>;
  whisperApiErrorsTotal: Counter<'error_type'>;
  claudeApiDuration: Histogram<'outcome'>;
  claudeApiErrorsTotal: Counter<'error_type'>;
  // Business metrics
  thoughtsCapturedTotal: Counter<'source'>;
  transcriptionsCompletedTotal: Counter<string>;
  aiCategorizationsCompletedTotal: Counter<string>;
  // Database
  dbPoolActiveConnections: Gauge<string>;
  dbPoolIdleConnections: Gauge<string>;
  dbQueryDuration: Histogram<'operation'>;
}

export interface CreateMetricsOptions {
  /**
   * Whether to register prom-client default Node.js process metrics
   * (event_loop_lag, gc_duration, heap, etc). Default true in production,
   * disable in tests for output stability.
   */
  collectDefaults?: boolean;
}

export function createMetrics(options: CreateMetricsOptions = {}): Metrics {
  const { collectDefaults = true } = options;
  const registry = new Registry();

  if (collectDefaults) {
    collectDefaultMetrics({ register: registry });
  }

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    // Buckets matching SLO: p95 <500ms for non-AI endpoints; finer detail under 1s
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [registry],
  });

  const activeConnections = new Gauge({
    name: 'active_connections',
    help: 'Number of currently-active HTTP connections in flight',
    registers: [registry],
  });

  const whisperApiDuration = new Histogram({
    name: 'whisper_api_duration_seconds',
    help: 'OpenAI Whisper API call duration in seconds',
    labelNames: ['outcome'] as const,
    // Whisper SLO: <10s for recordings <2min; long-tail buckets to detect outliers
    buckets: [0.5, 1, 2, 5, 10, 15, 30, 60],
    registers: [registry],
  });

  const whisperApiErrorsTotal = new Counter({
    name: 'whisper_api_errors_total',
    help: 'Total number of OpenAI Whisper API errors, labeled by error_type',
    labelNames: ['error_type'] as const,
    registers: [registry],
  });

  const claudeApiDuration = new Histogram({
    name: 'claude_api_duration_seconds',
    help: 'Anthropic Claude API call duration in seconds',
    labelNames: ['outcome'] as const,
    // Claude SLO: <1s for categorization
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });

  const claudeApiErrorsTotal = new Counter({
    name: 'claude_api_errors_total',
    help: 'Total number of Anthropic Claude API errors, labeled by error_type',
    labelNames: ['error_type'] as const,
    registers: [registry],
  });

  const thoughtsCapturedTotal = new Counter({
    name: 'thoughts_captured_total',
    help: 'Total number of thoughts captured, labeled by input source',
    labelNames: ['source'] as const,
    registers: [registry],
  });

  const transcriptionsCompletedTotal = new Counter({
    name: 'transcriptions_completed_total',
    help: 'Total number of completed audio transcriptions',
    registers: [registry],
  });

  const aiCategorizationsCompletedTotal = new Counter({
    name: 'ai_categorizations_completed_total',
    help: 'Total number of completed AI categorizations',
    registers: [registry],
  });

  const dbPoolActiveConnections = new Gauge({
    name: 'db_pool_active_connections',
    help: 'Current number of active connections in the PostgreSQL pool',
    registers: [registry],
  });

  const dbPoolIdleConnections = new Gauge({
    name: 'db_pool_idle_connections',
    help: 'Current number of idle connections in the PostgreSQL pool',
    registers: [registry],
  });

  const dbQueryDuration = new Histogram({
    name: 'db_query_duration_seconds',
    help: 'PostgreSQL query duration in seconds, labeled by operation',
    labelNames: ['operation'] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  });

  return {
    registry,
    httpRequestDuration,
    httpRequestsTotal,
    activeConnections,
    whisperApiDuration,
    whisperApiErrorsTotal,
    claudeApiDuration,
    claudeApiErrorsTotal,
    thoughtsCapturedTotal,
    transcriptionsCompletedTotal,
    aiCategorizationsCompletedTotal,
    dbPoolActiveConnections,
    dbPoolIdleConnections,
    dbQueryDuration,
  };
}
