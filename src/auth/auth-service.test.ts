import {
  AuthService,
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from './auth-service';
import { BcryptPasswordHasher } from './password-hasher';
import { JwtService } from './jwt-service';
import { InMemoryUserStore } from './user-store';
import { InMemoryTokenStore } from './token-store';

function buildService(overrides: { jwtTtl?: number } = {}): {
  authService: AuthService;
  userStore: InMemoryUserStore;
  tokenStore: InMemoryTokenStore;
  jwtService: JwtService;
} {
  const userStore = new InMemoryUserStore();
  const tokenStore = new InMemoryTokenStore();
  const jwtService = new JwtService({
    access_token_secret: 'a',
    refresh_token_secret: 'r',
    access_token_ttl_seconds: 60,
    refresh_token_ttl_seconds: overrides.jwtTtl ?? 600,
  });
  const passwordHasher = new BcryptPasswordHasher(4);
  const authService = new AuthService({ userStore, tokenStore, passwordHasher, jwtService });
  return { authService, userStore, tokenStore, jwtService };
}

describe('AuthService.register', () => {
  it('creates a user and issues access+refresh tokens', async () => {
    const { authService } = buildService();
    const result = await authService.register({
      email: 'a@b.com',
      password: 'Password1A',
      displayName: 'A',
    });
    expect(result.response.user.email).toBe('a@b.com');
    expect(result.response.access_token).toBeTruthy();
    expect(result.refresh_token).toBeTruthy();
    expect(result.refresh_expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('persists the refresh token in the token store', async () => {
    const { authService, tokenStore, jwtService } = buildService();
    const result = await authService.register({
      email: 'a@b.com',
      password: 'Password1A',
      displayName: 'A',
    });
    const claims = jwtService.verifyRefresh(result.refresh_token);
    expect(await tokenStore.get(claims.jti)).not.toBeNull();
  });

  it('throws EmailAlreadyExistsError on duplicate email', async () => {
    const { authService } = buildService();
    await authService.register({ email: 'a@b.com', password: 'Password1A', displayName: 'A' });
    await expect(
      authService.register({ email: 'a@b.com', password: 'Password1A', displayName: 'A' }),
    ).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  it('hashes the password — verify() the hash, not the plaintext', async () => {
    const { authService, userStore } = buildService();
    await authService.register({
      email: 'a@b.com',
      password: 'Password1A',
      displayName: 'A',
    });
    const stored = await userStore.findByEmail('a@b.com');
    expect(stored?.password_hash).not.toBe('Password1A');
    expect(stored?.password_hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });
});

describe('AuthService.login', () => {
  it('returns tokens on correct credentials', async () => {
    const { authService } = buildService();
    await authService.register({ email: 'a@b.com', password: 'Password1A', displayName: 'A' });
    const result = await authService.login({ email: 'a@b.com', password: 'Password1A' });
    expect(result.response.user.email).toBe('a@b.com');
  });

  it('throws InvalidCredentialsError on wrong password', async () => {
    const { authService } = buildService();
    await authService.register({ email: 'a@b.com', password: 'Password1A', displayName: 'A' });
    await expect(
      authService.login({ email: 'a@b.com', password: 'WrongPass1' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError on unknown email (no enumeration)', async () => {
    const { authService } = buildService();
    await expect(
      authService.login({ email: 'nobody@here.com', password: 'Whatever1A' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('honors case-insensitive email lookup', async () => {
    const { authService } = buildService();
    await authService.register({
      email: 'CaseSensitive@Test.com',
      password: 'Password1A',
      displayName: 'A',
    });
    const result = await authService.login({
      email: 'casesensitive@test.com',
      password: 'Password1A',
    });
    expect(result.response.user.email).toBe('casesensitive@test.com');
  });
});

describe('AuthService.refresh', () => {
  it('issues a new token pair and rotates the refresh token', async () => {
    const { authService, tokenStore, jwtService } = buildService();
    const initial = await authService.register({
      email: 'a@b.com',
      password: 'Password1A',
      displayName: 'A',
    });
    const refreshed = await authService.refresh(initial.refresh_token);

    expect(refreshed.refresh_token).not.toBe(initial.refresh_token);

    // Old refresh token must be revoked
    const oldClaims = jwtService.verifyRefresh(initial.refresh_token);
    expect(await tokenStore.get(oldClaims.jti)).toBeNull();

    // New refresh token must be present
    const newClaims = jwtService.verifyRefresh(refreshed.refresh_token);
    expect(await tokenStore.get(newClaims.jti)).not.toBeNull();
  });

  it('rejects a previously-rotated refresh token (single use)', async () => {
    const { authService } = buildService();
    const initial = await authService.register({
      email: 'a@b.com',
      password: 'Password1A',
      displayName: 'A',
    });
    await authService.refresh(initial.refresh_token); // first rotation succeeds
    await expect(authService.refresh(initial.refresh_token)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('rejects a refresh token signed by a different secret', async () => {
    const { authService } = buildService();
    const other = new JwtService({ access_token_secret: 'x', refresh_token_secret: 'y' });
    const { token } = other.signRefresh({ sub: 'fake', jti: 'fake' });
    await expect(authService.refresh(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a refresh token for a deleted user', async () => {
    const { authService, userStore } = buildService();
    const initial = await authService.register({
      email: 'a@b.com',
      password: 'Password1A',
      displayName: 'A',
    });
    // Simulate user deletion by re-instantiating the store with no entries.
    (userStore as unknown as { byId: Map<string, unknown>; byEmail: Map<string, unknown> }).byId.clear();
    (userStore as unknown as { byId: Map<string, unknown>; byEmail: Map<string, unknown> }).byEmail.clear();
    await expect(authService.refresh(initial.refresh_token)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });
});

describe('AuthService.logout', () => {
  it('revokes the refresh token', async () => {
    const { authService, tokenStore, jwtService } = buildService();
    const initial = await authService.register({
      email: 'a@b.com',
      password: 'Password1A',
      displayName: 'A',
    });
    await authService.logout(initial.refresh_token);
    const claims = jwtService.verifyRefresh(initial.refresh_token);
    expect(await tokenStore.get(claims.jti)).toBeNull();
  });

  it('is idempotent for an undefined cookie', async () => {
    const { authService } = buildService();
    await expect(authService.logout(undefined)).resolves.toBeUndefined();
  });

  it('is idempotent for an invalid/expired token', async () => {
    const { authService } = buildService();
    await expect(authService.logout('not.a.valid.jwt')).resolves.toBeUndefined();
  });
});
