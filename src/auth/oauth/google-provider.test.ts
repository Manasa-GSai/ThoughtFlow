import jwt from 'jsonwebtoken';
import { GoogleProviderClient } from './google-provider';
import { OAuthConfigError, OAuthExchangeError } from './provider';

const TEST_CLIENT_ID = 'test-google-client-id';

function makeGoogleIdToken(claims: Partial<{ sub: string; email: string; name: string; exp: number }>): string {
  return jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: TEST_CLIENT_ID,
      sub: claims.sub ?? 'sub-123',
      email: claims.email ?? 'user@example.com',
      name: claims.name,
      exp: claims.exp ?? Math.floor(Date.now() / 1000) + 3600,
    },
    'unused-secret',
  );
}

function mockFetchOk(payload: object): typeof fetch {
  return ((_url: string, _init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)),
    } as unknown as Response)) as typeof fetch;
}

function mockFetchError(status: number, body = 'oops'): typeof fetch {
  return ((_url: string, _init?: RequestInit) =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({ error: body }),
      text: () => Promise.resolve(body),
    } as unknown as Response)) as typeof fetch;
}

describe('GoogleProviderClient', () => {
  it('throws when client_id is missing', () => {
    expect(
      () => new GoogleProviderClient({ client_id: '', client_secret: 'x' }),
    ).toThrow(OAuthConfigError);
  });

  it('throws when client_secret is missing', () => {
    expect(
      () => new GoogleProviderClient({ client_id: 'x', client_secret: '' }),
    ).toThrow(OAuthConfigError);
  });

  it('builds an authorization URL with the required OAuth2 params', () => {
    const provider = new GoogleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 's',
    });
    const url = provider.authorizationUrl('state-abc', 'https://api.test/callback');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain(`client_id=${TEST_CLIENT_ID}`);
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapi.test%2Fcallback');
    expect(url).toContain('state=state-abc');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=openid+email+profile');
  });

  it('exchanges code and returns a normalized profile with display_name from the name claim', async () => {
    const id_token = makeGoogleIdToken({ sub: 'g-1', email: 'a@b.com', name: 'Alice' });
    const provider = new GoogleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchOk({ id_token }),
    });

    const profile = await provider.exchangeCode('code-1', 'https://api.test/callback');

    expect(profile.provider).toBe('google');
    expect(profile.oauth_id).toBe('g-1');
    expect(profile.email).toBe('a@b.com');
    expect(profile.display_name).toBe('Alice');
  });

  it('falls back to email local-part when name claim is absent', async () => {
    const id_token = makeGoogleIdToken({ sub: 'g-2', email: 'fallback@example.com' });
    const provider = new GoogleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchOk({ id_token }),
    });

    const profile = await provider.exchangeCode('code-2', 'https://api.test/callback');
    expect(profile.display_name).toBe('fallback');
  });

  it('throws OAuthExchangeError when token endpoint returns non-2xx', async () => {
    const provider = new GoogleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchError(400, 'invalid_grant'),
    });
    await expect(
      provider.exchangeCode('bad', 'https://api.test/callback'),
    ).rejects.toThrow(OAuthExchangeError);
  });

  it('throws OAuthExchangeError when response is missing id_token', async () => {
    const provider = new GoogleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchOk({ access_token: 'present', id_token: undefined }),
    });
    await expect(
      provider.exchangeCode('code', 'https://api.test/callback'),
    ).rejects.toThrow(/missing id_token/);
  });
});
