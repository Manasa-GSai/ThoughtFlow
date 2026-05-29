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
});
