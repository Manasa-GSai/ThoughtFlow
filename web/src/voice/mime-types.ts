/**
 * MediaRecorder MIME-type negotiation.
 *
 * Whisper accepts WebM/Opus natively (no transcoding needed) which is
 * Chrome/Firefox/Edge's preferred capture format. iOS Safari < 17 doesn't
 * support WebM in MediaRecorder, so we fall back to MP4/AAC (Safari's
 * native). If neither is supported (very old browsers), we surrender and
 * let the caller surface the error.
 */
export const PREFERRED_MIME_TYPES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/wav',
];

/**
 * Returns the first MIME type from PREFERRED_MIME_TYPES that the browser
 * supports, or null if none are supported. The MediaRecorder spec defines
 * isTypeSupported as a static method; we feature-detect to be safe.
 */
export function pickSupportedMimeType(): string | null {
  const recorder = (globalThis as { MediaRecorder?: { isTypeSupported?: (m: string) => boolean } })
    .MediaRecorder;
  if (!recorder || typeof recorder.isTypeSupported !== 'function') {
    // No MediaRecorder at all — caller should surface the error.
    return null;
  }
  for (const mime of PREFERRED_MIME_TYPES) {
    if (recorder.isTypeSupported(mime)) return mime;
  }
  return null;
}
