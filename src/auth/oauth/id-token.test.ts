import jwt from 'jsonwebtoken';
import { decodeAndValidateIdToken, InvalidIdTokenError } from './id-token';

const TEST_AUD = 'test-client-id';
const TEST_ISS = 'https://example.test/issuer';

function makeIdToken(claims: Record<string, unknown>): string {
  return jwt.sign(claims, 'unused-secret');
}

describe('decodeAndValidateIdToken', () => {
  it('returns claims when iss + aud + exp + sub + email are valid', () => {
    const token = makeIdToken({
      iss: TEST_ISS,
      aud: TEST_AUD,
      sub: 'sub-123',
      email: 'user@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const claims = decodeAndValidateIdToken(token, {
      expected_iss: TEST_ISS,
      expected_aud: TEST_AUD,
    });
    expect(claims.sub).toBe('sub-123');
    expect(claims.email).toBe('user@example.com');
  });

  it('accepts iss from an array of allowed issuers (Google has two)', () => {
    const token = makeIdToken({
      iss: 'accounts.google.com',
      aud: TEST_AUD,
      sub: 's',
      email: 'a@b.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() =>
      decodeAndValidateIdToken(token, {
        expected_iss: ['https://accounts.google.com', 'accounts.google.com'],
        expected_aud: TEST_AUD,
      }),
    ).not.toThrow();
  });

  it('rejects when iss does not match', () => {
    const token = makeIdToken({
      iss: 'https://evil.com',
      aud: TEST_AUD,
      sub: 's',
      email: 'a@b.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() =>
      decodeAndValidateIdToken(token, { expected_iss: TEST_ISS, expected_aud: TEST_AUD }),
    ).toThrow(InvalidIdTokenError);
  });

  it('rejects when aud does not match our client_id', () => {
    const token = makeIdToken({
      iss: TEST_ISS,
      aud: 'different-client',
      sub: 's',
      email: 'a@b.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() =>
      decodeAndValidateIdToken(token, { expected_iss: TEST_ISS, expected_aud: TEST_AUD }),
    ).toThrow(/aud/);
  });

  it('rejects expired tokens', () => {
    const token = makeIdToken({
      iss: TEST_ISS,
      aud: TEST_AUD,
      sub: 's',
      email: 'a@b.com',
      exp: Math.floor(Date.now() / 1000) - 60, // 60s ago
    });
    expect(() =>
      decodeAndValidateIdToken(token, {
        expected_iss: TEST_ISS,
        expected_aud: TEST_AUD,
        clock_skew_seconds: 0,
      }),
    ).toThrow(/expired/);
  });

  it('allows clock_skew_seconds tolerance', () => {
    const token = makeIdToken({
      iss: TEST_ISS,
      aud: TEST_AUD,
      sub: 's',
      email: 'a@b.com',
      exp: Math.floor(Date.now() / 1000) - 10, // 10s ago
    });
    expect(() =>
      decodeAndValidateIdToken(token, {
        expected_iss: TEST_ISS,
        expected_aud: TEST_AUD,
        clock_skew_seconds: 30,
      }),
    ).not.toThrow();
  });

  it('rejects when sub is missing', () => {
    const token = makeIdToken({
      iss: TEST_ISS,
      aud: TEST_AUD,
      email: 'a@b.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() =>
      decodeAndValidateIdToken(token, { expected_iss: TEST_ISS, expected_aud: TEST_AUD }),
    ).toThrow(/sub/);
  });

  it('rejects when email is missing', () => {
    const token = makeIdToken({
      iss: TEST_ISS,
      aud: TEST_AUD,
      sub: 's',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() =>
      decodeAndValidateIdToken(token, { expected_iss: TEST_ISS, expected_aud: TEST_AUD }),
    ).toThrow(/email/);
  });

  it('rejects malformed tokens', () => {
    expect(() =>
      decodeAndValidateIdToken('not-a-jwt', {
        expected_iss: TEST_ISS,
        expected_aud: TEST_AUD,
      }),
    ).toThrow(InvalidIdTokenError);
  });
});
