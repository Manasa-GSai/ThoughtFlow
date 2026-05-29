import { Request, Response, Router } from 'express';
import { Metrics } from './registry';

/**
 * Mounts GET /metrics returning Prometheus text-exposition format with the
 * correct Content-Type. The registry's contentType property already includes
 * the version (e.g., text/plain; version=0.0.4; charset=utf-8).
 */
export function createMetricsRouter(metrics: Metrics): Router {
  const router = Router();

  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const body = await metrics.registry.metrics();
      res.setHeader('Content-Type', metrics.registry.contentType);
      res.status(200).send(body);
    } catch (err) {
      res.status(500).json({ error: 'metrics_collection_failed' });
    }
  });

  return router;
}
