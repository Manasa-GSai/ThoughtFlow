import { JwtService } from './jwt-service';

const SECRETS = {
  access_token_secret: 'test-access-secret',
  refresh_token_secret: 'test-refresh-secret',
};

describe('JwtService — constructor', () => {
  it('throws when access secret is missing', () => {
    expect(
      () =>
        new JwtService({
          access_token_secret: '',
          refresh_token_secret: 'r',
        }),
    ).toThrow();
  });

  it('throws when refresh secret is missing', () => {
    expect(
      () =>
        new JwtService({
          access_token_secret: 'a',
          refresh_token_secret: '',
        }),
    ).toThrow();
  });
});

describe('JwtService — access tokens', () => {
  const svc = new JwtService(SECRETS);

  it('signs and verifies an access token round-trip', () => {
    const { token } = svc.signAccess({ sub: 'u1', email: 'a@b.com', tier: 'free' });
    const claims = svc.verifyAccess(token);
    expect(claims.sub).toBe('u1');
    expect(claims.email).toBe('a@b.com');
    expect(claims.tier).toBe('free');
    expect(typeof claims.iat).toBe('number');
    expect(typeof claims.exp).toBe('number');
  });

  it('access token expires 15 minutes from issuance by default', () => {
    const { token, expires_at } = svc.signAccess({ sub: 'u1', email: 'a@b.com', tier: 'free' });
    const claims = svc.verifyAccess(token);
    expect(claims.exp! - claims.iat!).toBe(15 * 60);
    expect(expires_at).toBe(claims.exp);
  });

  it('rejects access tokens signed with the refresh secret', () => {
    const refresh = new JwtService(SECRETS).signRefresh({ sub: 'u1', jti: 'j1' });
    expect(() => svc.verifyAccess(refresh.token)).toThrow();
  });

  it('rejects tampered tokens', () => {
    const { token } = svc.signAccess({ sub: 'u1', email: 'a@b.com', tier: 'free' });
    const tampered = token.slice(0, -3) + 'aaa';
    expect(() => svc.verifyAccess(tampered)).toThrow();
  });

  it('honors a custom access_token_ttl_seconds', () => {
    const s = new JwtService({ ...SECRETS, access_token_ttl_seconds: 60 });
    expect(s.accessTtlSeconds).toBe(60);
    const { token } = s.signAccess({ sub: 'u1', email: 'a@b.com', tier: 'free' });
    const claims = s.verifyAccess(token);
    expect(claims.exp! - claims.iat!).toBe(60);
  });
});

describe('JwtService — refresh tokens', () => {
  const svc = new JwtService(SECRETS);

  it('signs and verifies a refresh token round-trip', () => {
    const { token } = svc.signRefresh({ sub: 'u1', jti: 'j-xyz' });
    const claims = svc.verifyRefresh(token);
    expect(claims.sub).toBe('u1');
    expect(claims.jti).toBe('j-xyz');
  });

  it('refresh token expires 7 days from issuance by default', () => {
    const { token } = svc.signRefresh({ sub: 'u1', jti: 'j1' });
    const claims = svc.verifyRefresh(token);
    expect(claims.exp! - claims.iat!).toBe(7 * 24 * 60 * 60);
  });

  it('verifies expired token throws', () => {
    const s = new JwtService({ ...SECRETS, refresh_token_ttl_seconds: -1 });
    const { token } = s.signRefresh({ sub: 'u1', jti: 'j1' });
    expect(() => s.verifyRefresh(token)).toThrow();
  });

  it('exposes refreshTtlSeconds', () => {
    const s = new JwtService({ ...SECRETS, refresh_token_ttl_seconds: 9999 });
    expect(s.refreshTtlSeconds).toBe(9999);
  });
});
