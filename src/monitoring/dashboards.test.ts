import fs from 'node:fs';
import path from 'node:path';
import { createMetrics } from '../metrics';

/**
 * Validates the Grafana SLI dashboard configuration shipped for WO-006.
 *
 * Beyond shape checks, the key guard here is metric-name alignment: every
 * Prometheus series referenced by a dashboard panel must map to a metric that
 * actually exists in the app's registry. This prevents dashboard/registry
 * drift — a panel that queries a renamed or deleted metric would render empty
 * in production but pass a naive JSON-shape test.
 */

interface PanelTarget {
  expr?: string;
  refId?: string;
  legendFormat?: string;
}

interface Panel {
  id: number;
  title: string;
  type: string;
  targets?: PanelTarget[];
}

interface Dashboard {
  uid: string;
  title: string;
  tags?: string[];
  panels: Panel[];
}

const DASHBOARDS_DIR = path.resolve(__dirname, '..', '..', 'monitoring', 'dashboards');

// prom-client appends these suffixes to histogram/summary series; strip them
// to recover the base metric name that createMetrics() registers.
const SERIES_SUFFIXES = ['_bucket', '_count', '_sum'];

// Metric references end in one of these units/kinds per Prometheus conventions.
// Matching on the suffix avoids false positives from PromQL functions
// (rate, sum, histogram_quantile) and label names (route, status_code).
const METRIC_TOKEN_RE = /\b[a-z][a-z0-9_]*_(?:total|seconds|connections)(?:_bucket|_count|_sum)?\b/g;

function loadDashboards(): { file: string; dashboard: Dashboard }[] {
  const files = fs.readdirSync(DASHBOARDS_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => ({
    file,
    dashboard: JSON.parse(fs.readFileSync(path.join(DASHBOARDS_DIR, file), 'utf8')) as Dashboard,
  }));
}

function normalizeMetricName(token: string): string {
  for (const suffix of SERIES_SUFFIXES) {
    if (token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function referencedMetrics(dashboard: Dashboard): Set<string> {
  const names = new Set<string>();
  for (const panel of dashboard.panels) {
    for (const target of panel.targets ?? []) {
      const expr = target.expr ?? '';
      for (const match of expr.match(METRIC_TOKEN_RE) ?? []) {
        names.add(normalizeMetricName(match));
      }
    }
  }
  return names;
}

describe('monitoring/dashboards', () => {
  const dashboards = loadDashboards();

  // Base metric names registered by the app (defaults disabled for stability).
  const registeredNames = new Set(
    createMetrics({ collectDefaults: false })
      .registry.getMetricsAsArray()
      .map((m) => m.name),
  );

  it('discovers the three WO-006 SLI dashboards', () => {
    const uids = dashboards.map((d) => d.dashboard.uid).sort();
    expect(uids).toEqual([
      'thoughtflow-ai-services',
      'thoughtflow-business',
      'thoughtflow-operations',
    ]);
  });

  it('every dashboard has a uid, title, and at least one panel', () => {
    for (const { file, dashboard } of dashboards) {
      expect(typeof dashboard.uid).toBe('string');
      expect(dashboard.uid.length).toBeGreaterThan(0);
      expect(typeof dashboard.title).toBe('string');
      expect(Array.isArray(dashboard.panels)).toBe(true);
      expect(dashboard.panels.length).toBeGreaterThan(0);
      expect(dashboard.tags).toContain('wo-006');
      // Fail with the offending file name for fast triage.
      expect(file.endsWith('.json')).toBe(true);
    }
  });

  it('every panel has a title and at least one target with a non-empty expr', () => {
    for (const { dashboard } of dashboards) {
      for (const panel of dashboard.panels) {
        expect(typeof panel.title).toBe('string');
        expect(panel.title.length).toBeGreaterThan(0);
        expect(Array.isArray(panel.targets)).toBe(true);
        expect(panel.targets!.length).toBeGreaterThan(0);
        for (const target of panel.targets!) {
          expect(typeof target.expr).toBe('string');
          expect(target.expr!.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('dashboard UIDs are unique across the set', () => {
    const uids = dashboards.map((d) => d.dashboard.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('every metric referenced by a panel exists in the app registry (no drift)', () => {
    for (const { file, dashboard } of dashboards) {
      for (const name of referencedMetrics(dashboard)) {
        // If this fails, a dashboard references a metric the app never emits.
        expect({ file, metric: name, registered: registeredNames.has(name) }).toEqual({
          file,
          metric: name,
          registered: true,
        });
      }
    }
  });

  it('covers the core WO-006 SLI metrics across the dashboard set', () => {
    const allReferenced = new Set<string>();
    for (const { dashboard } of dashboards) {
      for (const name of referencedMetrics(dashboard)) {
        allReferenced.add(name);
      }
    }
    // RED method + external AI + business + DB pool — the WO-006 metric surface.
    const required = [
      'http_requests_total',
      'http_request_duration_seconds',
      'active_connections',
      'whisper_api_duration_seconds',
      'whisper_api_errors_total',
      'claude_api_duration_seconds',
      'claude_api_errors_total',
      'thoughts_captured_total',
      'transcriptions_completed_total',
      'ai_categorizations_completed_total',
      'db_pool_active_connections',
      'db_pool_idle_connections',
      'db_query_duration_seconds',
    ];
    for (const metric of required) {
      expect(allReferenced.has(metric)).toBe(true);
    }
  });
});
