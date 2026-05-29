import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

interface AlertRule {
  alert: string;
  expr: string;
  for?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

interface RuleGroup {
  name: string;
  interval?: string;
  rules: AlertRule[];
}

interface RuleFile {
  groups: RuleGroup[];
}

const ALERTS_PATH = path.resolve(__dirname, '..', '..', 'monitoring', 'alerts.yml');

describe('monitoring/alerts.yml', () => {
  let parsed: RuleFile;

  beforeAll(() => {
    const raw = fs.readFileSync(ALERTS_PATH, 'utf8');
    parsed = yaml.load(raw) as RuleFile;
  });

  it('parses as valid YAML with a top-level groups array', () => {
    expect(parsed).toBeDefined();
    expect(Array.isArray(parsed.groups)).toBe(true);
    expect(parsed.groups.length).toBeGreaterThan(0);
  });

  it('every group has a name and a rules array', () => {
    for (const g of parsed.groups) {
      expect(typeof g.name).toBe('string');
      expect(Array.isArray(g.rules)).toBe(true);
      expect(g.rules.length).toBeGreaterThan(0);
    }
  });

  it('every rule has alert, expr, for, labels.severity, and annotations.summary', () => {
    for (const g of parsed.groups) {
      for (const r of g.rules) {
        expect(typeof r.alert).toBe('string');
        expect(typeof r.expr).toBe('string');
        expect(typeof r.for).toBe('string');
        expect(r.labels?.severity).toMatch(/^(critical|warning|info)$/);
        expect(typeof r.annotations?.summary).toBe('string');
      }
    }
  });

  it('contains all alert rules required by WO-006 acceptance criterion #7', () => {
    const allAlertNames = parsed.groups.flatMap((g) => g.rules.map((r) => r.alert));
    // Required: error rate >5%/5m, p95 latency >500ms non-AI, Whisper errors >10%, health failing >2m
    expect(allAlertNames).toContain('HighHttpErrorRate');
    expect(allAlertNames).toContain('HighNonAiP95Latency');
    expect(allAlertNames).toContain('WhisperApiHighErrorRate');
    expect(allAlertNames).toContain('HealthCheckFailing');
  });

  it('HighHttpErrorRate uses a 5-minute window and 5% threshold', () => {
    const r = findRule(parsed, 'HighHttpErrorRate');
    expect(r.for).toBe('5m');
    expect(r.expr).toMatch(/\[5m\]/);
    expect(r.expr).toMatch(/>\s*0\.05/);
  });

  it('HighNonAiP95Latency thresholds at 500ms', () => {
    const r = findRule(parsed, 'HighNonAiP95Latency');
    expect(r.expr).toMatch(/>\s*0\.5/);
    expect(r.expr).toMatch(/histogram_quantile\(\s*0\.95/);
  });

  it('WhisperApiHighErrorRate thresholds at 10%', () => {
    const r = findRule(parsed, 'WhisperApiHighErrorRate');
    expect(r.expr).toMatch(/>\s*0\.10/);
  });

  it('HealthCheckFailing fires after 2 minutes', () => {
    const r = findRule(parsed, 'HealthCheckFailing');
    expect(r.for).toBe('2m');
  });
});

function findRule(parsed: RuleFile, name: string): AlertRule {
  for (const g of parsed.groups) {
    const r = g.rules.find((x) => x.alert === name);
    if (r) return r;
  }
  throw new Error(`Alert rule not found: ${name}`);
}
