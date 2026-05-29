/**
 * Field names whose values must NEVER appear in logs.
 *
 * The match is case-insensitive on the key name only — applied recursively
 * by `redactSensitive` so the same key is scrubbed at any nesting depth.
 *
 * Coverage rationale (acceptance criterion: password, token, audio,
 * transcription content must never log):
 *   - password / passwd: user credentials
 *   - token / access_token / refresh_token / authorization: auth material
 *   - audio / audio_content / audio_data / audio_blob: raw voice payloads
 *   - transcript / transcription / transcription_text / transcribed_text: NLP output
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'audio',
  'audio_content',
  'audio_data',
  'audio_blob',
  'transcript',
  'transcription',
  'transcription_text',
  'transcribed_text',
]);

export const REDACTED_VALUE = '[REDACTED]';

/**
 * Recursively walks an object, replacing values of sensitive keys with
 * REDACTED_VALUE. Returns a new object — never mutates the input (caller may
 * still hold a reference to it).
 *
 * Arrays are walked; primitives are returned as-is. Circular references would
 * loop infinitely — we rely on log payloads being JSON-safe (which they must
 * be anyway, since pino serializes them).
 */
export function redactSensitive(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED_VALUE;
    } else {
      out[key] = redactSensitive(val);
    }
  }
  return out;
}
