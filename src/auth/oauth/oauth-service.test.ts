import { OAuthService, OAuthAccountConflictError } from './oauth-service';
import { OAuthProfile } from './provider';
import { InMemoryUserStore } from '../user-store';
import { InMemoryTokenStore } from '../token-store';
import { JwtService } from '../jwt-service';
import { BcryptPasswordHasher } from '../password-hasher';

function buildService(): {
  service: OAuthService;
  userStore: InMemoryUserStore;
  tokenStore: InMemoryTokenStore;
  jwtService: JwtService;
  hasher: BcryptPasswordHasher;
} {
  const userStore = new InMemoryUserStore();
  const tokenStore = new InMemoryTokenStore();
  const jwtService = new JwtService({
    access_token_secret: 'a',
    refresh_token_secret: 'r',
    access_token_ttl_seconds: 60,
    refresh_token_ttl_seconds: 600,
  });
  return {
    service: new OAuthService({ userStore, tokenStore, jwtService }),
    userStore,
    tokenStore,
    jwtService,
    hasher: new BcryptPasswordHasher(4),
  };
}

function googleProfile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    provider: 'google',
    oauth_id: 'g-1',
    email: 'a@b.com',
    display_name: 'Alice',
    ...overrides,
  };
}

describe('OAuthService.signIn — first time with this provider', () => {
  it('creates a new user when email is unknown', async () => {
    const { service, userStore } = buildService();
    const result = await service.signIn(googleProfile());
    expect(result.is_new_user).toBe(true);
    expect(result.linked_existing).toBe(false);
    expect(result.response.user.email).toBe('a@b.com');
    expect(result.response.access_token).toBeTruthy();

    const created = await userStore.findByEmail('a@b.com');
    expect(created?.oauth_provider).toBe('google');
    expect(created?.oauth_id).toBe('g-1');
    expect(created?.password_hash).toBeNull();
  });

  it('links an existing password-only account with the same email', async () => {
    const { service, userStore, hasher } = buildService();
    const hash = await hasher.hash('Password1A');
    await userStore.create({ email: 'a@b.com', display_name: 'Existing', password_hash: hash });

    const result = await service.signIn(googleProfile({ email: 'a@b.com' }));

    expect(result.is_new_user).toBe(false);
    expect(result.linked_existing).toBe(true);
    const linked = await userStore.findByEmail('a@b.com');
    expect(linked?.oauth_provider).toBe('google');
    expect(linked?.oauth_id).toBe('g-1');
    expect(linked?.password_hash).toEqual(hash); // password preserved
  });

  it('issues identical token shape to email/password flow', async () => {
    const { service } = buildService();
    const result = await service.signIn(googleProfile());
    expect(result.response).toMatchObject({
      user: expect.objectContaining({ id: expect.any(String), email: 'a@b.com' }),
      access_token: expect.any(String),
      access_token_expires_at: expect.any(Number),
    });
    expect(result.refresh_token).toBeTruthy();
    expect(result.refresh_expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('OAuthService.signIn — returning user (provider identity already linked)', () => {
  it('signs in via direct OAuth lookup without re-linking', async () => {
    const { service } = buildService();
    await service.signIn(googleProfile());
    const second = await service.signIn(googleProfile());
    expect(second.is_new_user).toBe(false);
    expect(second.linked_existing).toBe(false);
  });

  it('persists the refresh token in the TokenStore for revocation', async () => {
    const { service, tokenStore, jwtService } = buildService();
    const result = await service.signIn(googleProfile());
    const claims = jwtService.verifyRefresh(result.refresh_token);
    expect(await tokenStore.get(claims.jti)).not.toBeNull();
  });
});

describe('OAuthService.signIn — account conflict (different provider, same email)', () => {
  it('refuses to overwrite an existing OAuth identity from a different provider', async () => {
    const { service } = buildService();
    await service.signIn(googleProfile({ oauth_id: 'g-1' })); // user signs up with Google
    // Same email tries to sign in via Apple — must be rejected
    await expect(
      service.signIn({
        provider: 'apple',
        oauth_id: 'apple-1',
        email: 'a@b.com',
        display_name: 'A',
      }),
    ).rejects.toBeInstanceOf(OAuthAccountConflictError);
  });
});
