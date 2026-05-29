import { Request, Response, NextFunction } from 'express';
import { JwtService } from './jwt-service';
import { AuthenticatedUser, UserTier } from './types';
import { setUserId } from '../logger/correlation';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Auth middleware: validates the Authorization Bearer token, extracts
 * user_id + tier, attaches to req.user, and pushes user_id into the
 * correlation context so request_completed logs (WO-005) include it
 * automatically without per-route plumbing.
 *
 * Returns 401 for missing/malformed/expired/invalid tokens — no leaking
 * which specific failure (avoids signal that helps attackers tune attacks).
 */
export function createRequireAuthMiddleware(jwtService: JwtService) {
  return function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.header('authorization') || req.header('Authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const token = header.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const claims = jwtService.verifyAccess(token);
      const authed: AuthenticatedUser = {
        id: claims.sub,
        email: claims.email,
        tier: claims.tier as UserTier,
      };
      req.user = authed;
      setUserId(authed.id);
      next();
    } catch {
      res.status(401).json({ error: 'unauthorized' });
    }
  };
}
