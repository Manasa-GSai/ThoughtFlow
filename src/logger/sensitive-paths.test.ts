import { SENSITIVE_KEYS, REDACTED_VALUE, redactSensitive } from './sensitive-paths';

describe('SENSITIVE_KEYS', () => {
  it('includes all required sensitive field names', () => {
    const required = ['password', 'token', 'audio', 'transcript', 'transcription'];
    for (const field of required) {
      expect(SENSITIVE_KEYS.has(field)).toBe(true);
    }
  });

  it('REDACTED_VALUE is [REDACTED]', () => {
    expect(REDACTED_VALUE).toBe('[REDACTED]');
  });
});

describe('redactSensitive', () => {
  it('redacts top-level sensitive keys', () => {
    const out = redactSensitive({ password: 'p', token: 't', ok: 'visible' }) as Record<
      string,
      unknown
    >;
    expect(out.password).toBe(REDACTED_VALUE);
    expect(out.token).toBe(REDACTED_VALUE);
    expect(out.ok).toBe('visible');
  });

  it('redacts nested keys at any depth', () => {
    const out = redactSensitive({
      a: { b: { c: { password: 'deep', other: 'ok' } } },
    }) as Record<string, unknown>;
    const c = (((out.a as Record<string, unknown>).b as Record<string, unknown>).c) as Record<
      string,
      unknown
    >;
    expect(c.password).toBe(REDACTED_VALUE);
    expect(c.other).toBe('ok');
  });

  it('redacts keys inside array elements', () => {
    const out = redactSensitive({
      items: [{ token: 'a' }, { token: 'b', name: 'keep' }],
    }) as Record<string, unknown>;
    const items = out.items as Array<Record<string, unknown>>;
    expect(items[0].token).toBe(REDACTED_VALUE);
    expect(items[1].token).toBe(REDACTED_VALUE);
    expect(items[1].name).toBe('keep');
  });

  it('matches keys case-insensitively', () => {
    const out = redactSensitive({ Password: 'p', TOKEN: 't', Audio: 'bytes' }) as Record<
      string,
      unknown
    >;
    expect(out.Password).toBe(REDACTED_VALUE);
    expect(out.TOKEN).toBe(REDACTED_VALUE);
    expect(out.Audio).toBe(REDACTED_VALUE);
  });

  it('returns primitives unchanged', () => {
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
    expect(redactSensitive(true)).toBe(true);
  });

  it('does not mutate the input object', () => {
    const input = { password: 'secret', nested: { token: 'jwt' } };
    redactSensitive(input);
    expect(input.password).toBe('secret');
    expect(input.nested.token).toBe('jwt');
  });

  it('redacts transcription content', () => {
    const out = redactSensitive({
      transcript: 'private thought',
      transcription: 'also private',
      transcribed_text: 'verbatim',
    }) as Record<string, unknown>;
    expect(out.transcript).toBe(REDACTED_VALUE);
    expect(out.transcription).toBe(REDACTED_VALUE);
    expect(out.transcribed_text).toBe(REDACTED_VALUE);
  });

  it('redacts audio payloads under any variant name', () => {
    const out = redactSensitive({
      audio: 'a',
      audio_content: 'b',
      audio_data: 'c',
      audio_blob: 'd',
    }) as Record<string, unknown>;
    expect(out.audio).toBe(REDACTED_VALUE);
    expect(out.audio_content).toBe(REDACTED_VALUE);
    expect(out.audio_data).toBe(REDACTED_VALUE);
    expect(out.audio_blob).toBe(REDACTED_VALUE);
  });
});
