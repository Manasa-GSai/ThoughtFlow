import { InMemoryUserStore, EmailAlreadyExistsError } from './user-store';

describe('InMemoryUserStore', () => {
  it('creates a user with default tier=free and ISO timestamp', async () => {
    const store = new InMemoryUserStore();
    const user = await store.create({
      email: 'a@b.com',
      display_name: 'Alice',
      password_hash: 'hash',
    });
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(user.email).toBe('a@b.com');
    expect(user.tier).toBe('free');
    expect(user.created_at).toBeInstanceOf(Date);
  });

  it('normalizes email to lowercase on create and lookup', async () => {
    const store = new InMemoryUserStore();
    await store.create({
      email: 'Mixed.Case@Example.COM',
      display_name: 'X',
      password_hash: 'h',
    });

    expect(await store.findByEmail('mixed.case@example.com')).not.toBeNull();
    expect(await store.findByEmail('MIXED.CASE@EXAMPLE.COM')).not.toBeNull();
  });

  it('rejects duplicate emails with EmailAlreadyExistsError', async () => {
    const store = new InMemoryUserStore();
    await store.create({ email: 'a@b.com', display_name: 'A', password_hash: 'h' });
    await expect(
      store.create({ email: 'a@b.com', display_name: 'A2', password_hash: 'h' }),
    ).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  it('rejects duplicates regardless of email case', async () => {
    const store = new InMemoryUserStore();
    await store.create({ email: 'A@B.com', display_name: 'A', password_hash: 'h' });
    await expect(
      store.create({ email: 'a@b.com', display_name: 'A2', password_hash: 'h' }),
    ).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  it('findById returns the user', async () => {
    const store = new InMemoryUserStore();
    const u = await store.create({ email: 'a@b.com', display_name: 'A', password_hash: 'h' });
    expect((await store.findById(u.id))?.email).toBe('a@b.com');
  });

  it('returns null when user not found by email', async () => {
    const store = new InMemoryUserStore();
    expect(await store.findByEmail('nobody@here.com')).toBeNull();
  });

  it('returns null when user not found by id', async () => {
    const store = new InMemoryUserStore();
    expect(await store.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('accepts an explicit tier on create', async () => {
    const store = new InMemoryUserStore();
    const u = await store.create({
      email: 'pro@b.com',
      display_name: 'P',
      password_hash: 'h',
      tier: 'pro',
    });
    expect(u.tier).toBe('pro');
  });

  it('createOAuth produces a user with null password_hash + oauth fields populated', async () => {
    const store = new InMemoryUserStore();
    const u = await store.createOAuth({
      email: 'gmail@example.com',
      display_name: 'G',
      provider: 'google',
      oauth_id: 'g-sub-1',
    });
    expect(u.password_hash).toBeNull();
    expect(u.oauth_provider).toBe('google');
    expect(u.oauth_id).toBe('g-sub-1');
    expect(u.tier).toBe('free');
  });

  it('findByOAuth returns the OAuth-only user', async () => {
    const store = new InMemoryUserStore();
    await store.createOAuth({
      email: 'apple@example.com',
      display_name: 'A',
      provider: 'apple',
      oauth_id: 'apple-sub-1',
    });
    const found = await store.findByOAuth('apple', 'apple-sub-1');
    expect(found?.email).toBe('apple@example.com');
  });

  it('findByOAuth returns null when (provider, oauth_id) does not match', async () => {
    const store = new InMemoryUserStore();
    expect(await store.findByOAuth('google', 'unknown')).toBeNull();
  });

  it('linkOAuth attaches provider + oauth_id to an existing password user', async () => {
    const store = new InMemoryUserStore();
    const u = await store.create({
      email: 'pw@example.com',
      display_name: 'P',
      password_hash: 'hash',
    });
    const linked = await store.linkOAuth(u.id, 'google', 'new-sub');
    expect(linked.oauth_provider).toBe('google');
    expect(linked.oauth_id).toBe('new-sub');
    // Existing password is preserved
    expect(linked.password_hash).toBe('hash');
    // Now findByOAuth resolves the same user
    expect((await store.findByOAuth('google', 'new-sub'))?.id).toBe(u.id);
  });

  it('linkOAuth throws when user_id is unknown', async () => {
    const store = new InMemoryUserStore();
    await expect(
      store.linkOAuth('00000000-0000-4000-8000-000000000000', 'google', 'x'),
    ).rejects.toThrow();
  });

  it('createOAuth rejects duplicate email', async () => {
    const store = new InMemoryUserStore();
    await store.createOAuth({
      email: 'dup@example.com',
      display_name: 'D',
      provider: 'google',
      oauth_id: 'g-1',
    });
    await expect(
      store.createOAuth({
        email: 'dup@example.com',
        display_name: 'D2',
        provider: 'apple',
        oauth_id: 'a-1',
      }),
    ).rejects.toThrow();
  });
});
