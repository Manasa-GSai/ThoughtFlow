import jwt from 'jsonwebtoken';
import { AppleProviderClient } from './apple-provider';
import { OAuthConfigError, OAuthExchangeError } from './provider';

const TEST_CLIENT_ID = 'com.example.thoughtflow.signin';

function makeAppleIdToken(claims: Partial<{ sub: string; email: string; exp: number }>): string {
  return jwt.sign(
    {
      iss: 'https://appleid.apple.com',
      aud: TEST_CLIENT_ID,
      sub: claims.sub ?? 'apple-sub-1',
      email: claims.email ?? 'a@privaterelay.appleid.com',
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

describe('AppleProviderClient', () => {
  it('throws when config is incomplete', () => {
    expect(() => new AppleProviderClient({ client_id: '', client_secret: 'x' })).toThrow(OAuthConfigError);
    expect(() => new AppleProviderClient({ client_id: 'x', client_secret: '' })).toThrow(OAuthConfigError);
  });

  it('authorization URL uses Apple endpoint with form_post mode and scope=name+email', () => {
    const provider = new AppleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 'apple-jwt-secret',
    });
    const url = provider.authorizationUrl('s', 'https://api.test/apple/callback');
    expect(url).toContain('appleid.apple.com/auth/authorize');
    expect(url).toContain('response_mode=form_post');
    expect(url).toContain('scope=name+email');
    expect(url).toContain('state=s');
  });

  it('exchanges code and returns normalized profile (display_name falls back to email local-part)', async () => {
    const id_token = makeAppleIdToken({ sub: 'apple-1', email: 'someone@privaterelay.appleid.com' });
    const provider = new AppleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchOk({ id_token }),
    });

    const profile = await provider.exchangeCode('code', 'https://api.test/apple/callback');

    expect(profile.provider).toBe('apple');
    expect(profile.oauth_id).toBe('apple-1');
    expect(profile.email).toBe('someone@privaterelay.appleid.com');
    expect(profile.display_name).toBe('someone'); // local-part fallback
  });

  it('throws when id_token is missing from Apple response', async () => {
    const provider = new AppleProviderClient({
      client_id: TEST_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchOk({ access_token: 'present' }),
    });
    await expect(
      provider.exchangeCode('code', 'https://api.test/apple/callback'),
    ).rejects.toThrow(OAuthExchangeError);
  });
});
