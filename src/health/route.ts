import { Request, Response, Router } from 'express';
import { HealthChecker, runReadinessChecks } from './checker';

export interface HealthRouterOptions {
  /** Git SHA or build version reported by GET /health */
  version: string;
  /** Dependency checkers consulted by GET /health/ready */
  checkers: HealthChecker[];
  /** Optional clock injection for tests */
  now?: () => number;
}

/**
 * Two separate endpoints because container platforms (k8s, Cloud Run)
 * distinguish liveness from readiness:
 *   - /health (liveness) — process is alive. Failing it triggers a restart.
 *     Must NOT depend on external systems — a transient DB blip would
 *     spuriously restart the pod.
 *   - /health/ready (readiness) — dependencies are available. Failing it
 *     pulls the pod out of the load-balancer rotation but does NOT restart.
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();
  const start_time = (options.now ?? Date.now)();

  router.get('/health', (_req: Request, res: Response) => {
    const now = (options.now ?? Date.now)();
    res.status(200).json({
      status: 'ok',
      version: options.version,
      uptime: Math.round((now - start_time) / 1000),
    });
  });

  router.get('/health/ready', async (_req: Request, res: Response) => {
    const report = await runReadinessChecks(options.checkers);
    res.status(report.ready ? 200 : 503).json(report);
  });

  return router;
}
