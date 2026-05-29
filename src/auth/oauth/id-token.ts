import jwt from 'jsonwebtoken';

/**
 * Decode the payload of an ID token WITHOUT verifying the signature.
 *
 * Rationale: real verification requires fetching the provider's JWKS at the
 * `iss` URL and validating against the cert key id (kid). That's the
 * RIGHT thing for a production-hardened deployment and would land in
 * WO-043 (security hardening). For WO-009 we obtain the ID token by
 * doing an HTTPS POST to the provider's token endpoint over TLS using a
 * client_secret only WE know — so the token's authenticity is already
 * established by the channel. JWKS verification would be defense-in-depth.
 *
 * We DO validate:
 *   - `iss` matches expected issuer
 *   - `aud` matches our client_id
 *   - `exp` is in the future
 *   - `email` and `sub` are present
 *
 * These are the same checks any production verifier performs. The skipped
 * step is the cryptographic signature check, which WO-043 will add.
 */
export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  [key: string]: unknown;
}

export interface IdTokenValidationOptions {
  expected_iss: string | string[];
  expected_aud: string;
  /** Allow up to this many seconds of clock skew. Default 30s. */
  clock_skew_seconds?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class InvalidIdTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid ID token: ${reason}`);
    this.name = 'InvalidIdTokenError';
  }
}

export function decodeAndValidateIdToken(
  id_token: string,
  options: IdTokenValidationOptions,
): IdTokenClaims {
  const decoded = jwt.decode(id_token, { json: true }) as IdTokenClaims | null;
  if (!decoded) throw new InvalidIdTokenError('not a decodable JWT');

  const allowed_iss = Array.isArray(options.expected_iss)
    ? options.expected_iss
    : [options.expected_iss];
  if (!allowed_iss.includes(decoded.iss)) {
    throw new InvalidIdTokenError(`iss "${decoded.iss}" does not match expected`);
  }

  if (decoded.aud !== options.expected_aud) {
    throw new InvalidIdTokenError('aud does not match our client_id');
  }

  const now = (options.now ?? Date.now)();
  const skew_ms = (options.clock_skew_seconds ?? 30) * 1000;
  if (decoded.exp * 1000 + skew_ms < now) {
    throw new InvalidIdTokenError('token expired');
  }

  if (!decoded.sub) throw new InvalidIdTokenError('missing sub');
  if (!decoded.email) throw new InvalidIdTokenError('missing email');

  return decoded;
}
