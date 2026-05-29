import { Request, Response, Router } from 'express';
import { NotFoundError } from './errors';

/**
 * Placeholder routers for route trees the foundation WO promises to mount
 * (AC #7). Each tree's real implementation lands in its own feature WO:
 *   - /api/thoughts/* → WO-018 (CRUD), WO-024 (capture flow)
 *   - /api/sync/*     → WO-033 (sync service)
 *   - /api/user/*     → WO-037 (profile/settings)
 *
 * Until then, every request under these paths receives a 404 with a
 * "not_implemented" hint so the frontend can distinguish "route not yet
 * built" from "route truly does not exist".
 */

function notImplemented(prefix: string): Router {
  const router = Router();
  router.use((req: Request, _res: Response, next) => {
    next(
      new NotFoundError(
        `${req.method} ${prefix}${req.path} is not yet implemented`,
      ),
    );
  });
  return router;
}

export const createThoughtsPlaceholderRouter = (): Router => notImplemented('/api/thoughts');
export const createSyncPlaceholderRouter = (): Router => notImplemented('/api/sync');
export const createUserPlaceholderRouter = (): Router => notImplemented('/api/user');
