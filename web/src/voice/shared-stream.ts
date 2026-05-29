/**
 * Shared-stream singleton for getUserMedia.
 *
 * iOS Safari has a long-standing quirk where calling getUserMedia twice on
 * the same page LOCKS the microphone — the second call silently fails and
 * the first stream becomes unusable. The PRD ("iOS Safari microphone
 * permission quirks") and the architecture's "Voice Capture Flow" both call
 * out the need for a shared-stream singleton to avoid this.
 *
 * The singleton hands out a SINGLE active MediaStream and increments a
 * reference count. When all callers release the stream, we keep the tracks
 * stopped() to surrender the mic indicator — opening a fresh stream on the
 * next start.
 *
 * Public API:
 *   acquireStream()  → MediaStream (creates or returns the active one)
 *   releaseStream()  → decrements ref count; stops tracks when zero
 *   getActiveStream() → introspection, returns null when none
 */

export interface SharedStreamConstraints {
  /** Mono channel is preferred for Whisper accuracy. */
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export const DEFAULT_AUDIO_CONSTRAINTS: SharedStreamConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

let active_stream: MediaStream | null = null;
let ref_count = 0;

export async function acquireStream(
  constraints: SharedStreamConstraints = DEFAULT_AUDIO_CONSTRAINTS,
): Promise<MediaStream> {
  if (active_stream && active_stream.active) {
    ref_count += 1;
    return active_stream;
  }

  // Fresh getUserMedia call.
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') {
    throw new Error('getUserMedia is not supported in this environment');
  }
  active_stream = await md.getUserMedia({
    audio: {
      channelCount: constraints.channelCount ?? 1,
      echoCancellation: constraints.echoCancellation ?? true,
      noiseSuppression: constraints.noiseSuppression ?? true,
      autoGainControl: constraints.autoGainControl ?? true,
    },
    video: false,
  });
  ref_count = 1;
  return active_stream;
}

export function releaseStream(): void {
  ref_count = Math.max(0, ref_count - 1);
  if (ref_count === 0 && active_stream) {
    for (const track of active_stream.getTracks()) {
      track.stop();
    }
    active_stream = null;
  }
}

export function getActiveStream(): MediaStream | null {
  return active_stream;
}

/** Test-only reset hook — clears refs and stops tracks without ref counting. */
export function __resetSharedStreamForTests(): void {
  if (active_stream) {
    for (const track of active_stream.getTracks()) {
      track.stop();
    }
  }
  active_stream = null;
  ref_count = 0;
}
