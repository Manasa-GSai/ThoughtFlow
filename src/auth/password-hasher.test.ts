import { BcryptPasswordHasher } from './password-hasher';

describe('BcryptPasswordHasher', () => {
  // Use low cost factor in tests to keep them fast; production uses 12.
  const hasher = new BcryptPasswordHasher(4);

  it('produces a non-empty bcrypt hash that is not the plaintext', async () => {
    const hash = await hasher.hash('Password1A');
    expect(hash).not.toBe('Password1A');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('verify returns true for the matching plaintext', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.verify('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('verify returns false for a wrong plaintext', async () => {
    const hash = await hasher.hash('rightPassword1');
    await expect(hasher.verify('wrongPassword1', hash)).resolves.toBe(false);
  });

  it('produces a different hash each call (random salt)', async () => {
    const h1 = await hasher.hash('samePassword1');
    const h2 = await hasher.hash('samePassword1');
    expect(h1).not.toBe(h2);
  });

  it('uses the configured cost factor in the hash prefix', async () => {
    const h = new BcryptPasswordHasher(5);
    const hash = await h.hash('whatever');
    expect(hash).toMatch(/^\$2[aby]\$05\$/);
  });

  it('defaults to cost factor 12 when none supplied', async () => {
    const h = new BcryptPasswordHasher();
    const hash = await h.hash('whatever');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  }, 10_000);
});
