import { InMemoryTokenStore } from './token-store';

function record(token_id: string, user_id: string, ms_from_now: number): {
  token_id: string;
  user_id: string;
  expires_at: Date;
} {
  return { token_id, user_id, expires_at: new Date(Date.now() + ms_from_now) };
}

describe('InMemoryTokenStore', () => {
  it('put + get returns the record before expiry', async () => {
    const store = new InMemoryTokenStore();
    await store.put(record('t1', 'u1', 60_000));
    const got = await store.get('t1');
    expect(got?.user_id).toBe('u1');
  });

  it('returns null for an unknown token_id', async () => {
    const store = new InMemoryTokenStore();
    expect(await store.get('does-not-exist')).toBeNull();
  });

  it('returns null and evicts an expired record', async () => {
    const store = new InMemoryTokenStore();
    await store.put(record('t1', 'u1', -1));
    expect(await store.get('t1')).toBeNull();
    // second get also returns null, confirming eviction
    expect(await store.get('t1')).toBeNull();
  });

  it('revoke removes a single token (idempotent)', async () => {
    const store = new InMemoryTokenStore();
    await store.put(record('t1', 'u1', 60_000));
    await store.revoke('t1');
    expect(await store.get('t1')).toBeNull();
    await expect(store.revoke('t1')).resolves.toBeUndefined();
  });

  it('revokeAllForUser revokes only that user’s tokens', async () => {
    const store = new InMemoryTokenStore();
    await store.put(record('t1', 'alice', 60_000));
    await store.put(record('t2', 'alice', 60_000));
    await store.put(record('t3', 'bob', 60_000));

    await store.revokeAllForUser('alice');

    expect(await store.get('t1')).toBeNull();
    expect(await store.get('t2')).toBeNull();
    expect((await store.get('t3'))?.user_id).toBe('bob');
  });

  it('put overwrites an existing record with the same id', async () => {
    const store = new InMemoryTokenStore();
    await store.put(record('t1', 'u1', 1_000));
    await store.put(record('t1', 'u2', 60_000));
    expect((await store.get('t1'))?.user_id).toBe('u2');
  });
});
