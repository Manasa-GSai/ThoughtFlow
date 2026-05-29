import { createMetrics } from './registry';

describe('createMetrics', () => {
  it('builds an isolated registry per call', async () => {
    const a = createMetrics({ collectDefaults: false });
    const b = createMetrics({ collectDefaults: false });

    a.httpRequestsTotal.inc({ method: 'GET', route: '/x', status_code: '200' }, 1);

    const aOut = await a.registry.metrics();
    const bOut = await b.registry.metrics();

    expect(aOut).toMatch(/http_requests_total\{[^}]*\}\s+1/);
    expect(bOut).not.toMatch(/http_requests_total\{[^}]*\}\s+1/);
  });

  it('exposes all required HTTP metric names', async () => {
    const m = createMetrics({ collectDefaults: false });
    const out = await m.registry.metrics();
    expect(out).toContain('http_request_duration_seconds');
    expect(out).toContain('http_requests_total');
    expect(out).toContain('active_connections');
  });

  it('exposes all required external API metric names', async () => {
    const m = createMetrics({ collectDefaults: false });
    // Counters/histograms only appear in output once observed/incremented
    m.whisperApiDuration.observe({ outcome: 'success' }, 1.2);
    m.whisperApiErrorsTotal.inc({ error_type: 'timeout' });
    m.claudeApiDuration.observe({ outcome: 'success' }, 0.4);
    m.claudeApiErrorsTotal.inc({ error_type: 'rate_limit' });

    const out = await m.registry.metrics();
    expect(out).toContain('whisper_api_duration_seconds');
    expect(out).toContain('whisper_api_errors_total');
    expect(out).toContain('claude_api_duration_seconds');
    expect(out).toContain('claude_api_errors_total');
  });

  it('exposes business metric names', async () => {
    const m = createMetrics({ collectDefaults: false });
    m.thoughtsCapturedTotal.inc({ source: 'voice' });
    m.thoughtsCapturedTotal.inc({ source: 'typed' });
    m.transcriptionsCompletedTotal.inc();
    m.aiCategorizationsCompletedTotal.inc();

    const out = await m.registry.metrics();
    expect(out).toMatch(/thoughts_captured_total\{source="voice"\}\s+1/);
    expect(out).toMatch(/thoughts_captured_total\{source="typed"\}\s+1/);
    expect(out).toMatch(/transcriptions_completed_total\s+1/);
    expect(out).toMatch(/ai_categorizations_completed_total\s+1/);
  });

  it('exposes database metric names', async () => {
    const m = createMetrics({ collectDefaults: false });
    m.dbPoolActiveConnections.set(7);
    m.dbPoolIdleConnections.set(3);
    m.dbQueryDuration.observe({ operation: 'select' }, 0.01);

    const out = await m.registry.metrics();
    expect(out).toMatch(/db_pool_active_connections\s+7/);
    expect(out).toMatch(/db_pool_idle_connections\s+3/);
    expect(out).toContain('db_query_duration_seconds');
  });

  it('does not register default process metrics when collectDefaults=false', async () => {
    const m = createMetrics({ collectDefaults: false });
    const out = await m.registry.metrics();
    expect(out).not.toContain('process_cpu_user_seconds_total');
  });

  it('registers default process metrics when collectDefaults=true', async () => {
    const m = createMetrics({ collectDefaults: true });
    const out = await m.registry.metrics();
    expect(out).toContain('process_cpu_user_seconds_total');
  });
});
