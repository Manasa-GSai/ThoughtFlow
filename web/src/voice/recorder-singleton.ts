import { acquireStream, releaseStream } from './shared-stream';
import { pickSupportedMimeType } from './mime-types';

/**
 * Module-scope recorder singleton (AC #6).
 *
 * React components mount and unmount as the user navigates. If we stored
 * the active MediaRecorder inside a useState/useRef, navigating away from
 * the capture screen would lose the recording in progress. Instead we keep
 * a SINGLE module-scope recorder that the hook subscribes to via the
 * observer pattern below. Navigation does not affect it.
 *
 * The hook turns the singleton's events into React state via a subscribe()
 * callback fired on every transition. Multiple components can subscribe
 * (e.g., a header status indicator AND the main capture screen).
 */

export type RecorderState = 'idle' | 'recording' | 'stopped' | 'error';

export interface RecorderSnapshot {
  state: RecorderState;
  /** Milliseconds elapsed since startRecording resolved. 0 when idle/stopped. */
  duration_ms: number;
  /** The completed audio blob — populated after stopRecording resolves. */
  audio_blob: Blob | null;
  /** Latest waveform sample (Uint8Array from AnalyserNode). null when idle. */
  waveform: Uint8Array | null;
  /** MIME type the recorder ended up using. */
  mime_type: string | null;
  /** Last error, if any. */
  error: Error | null;
}

type Subscriber = (snapshot: RecorderSnapshot) => void;

interface ActiveSession {
  recorder: MediaRecorder;
  chunks: BlobPart[];
  mime_type: string;
  start_timestamp: number;
  analyser: AnalyserNode | null;
  audio_ctx: AudioContext | null;
  waveform_raf: number | null;
}

let snapshot: RecorderSnapshot = {
  state: 'idle',
  duration_ms: 0,
  audio_blob: null,
  waveform: null,
  mime_type: null,
  error: null,
};

let active_session: ActiveSession | null = null;
const subscribers = new Set<Subscriber>();

function emit(): void {
  for (const sub of subscribers) sub(snapshot);
}

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  subscriber(snapshot);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function getSnapshot(): RecorderSnapshot {
  return snapshot;
}

const WAVEFORM_FFT_SIZE = 256; // small power of 2 → low overhead

/**
 * Latency measurement (AC #2): caller can compare the value returned here
 * against a pre-call timestamp to verify <1s start. Returns the time at
 * which MediaRecorder actually entered 'recording' state.
 */
export async function startRecording(): Promise<number> {
  if (active_session) return active_session.start_timestamp;

  try {
    const stream = await acquireStream();

    const mime_type = pickSupportedMimeType();
    if (!mime_type) {
      throw new Error('No supported audio MIME type — MediaRecorder unavailable');
    }

    const recorder = new MediaRecorder(stream, { mimeType: mime_type });
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (event: BlobEvent): void => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    let audio_ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      // AudioContext is a separate browser primitive; it can fail in some
      // test envs without throwing. Wrap so a missing AnalyserNode doesn't
      // break recording — waveform just won't update.
      const AudioCtor = (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext;
      if (AudioCtor) {
        audio_ctx = new AudioCtor();
        const source = audio_ctx.createMediaStreamSource(stream);
        analyser = audio_ctx.createAnalyser();
        analyser.fftSize = WAVEFORM_FFT_SIZE;
        source.connect(analyser);
      }
    } catch {
      audio_ctx = null;
      analyser = null;
    }

    recorder.start(100); // chunk every 100ms so dataavailable fires regularly

    const start_timestamp = Date.now();
    active_session = {
      recorder,
      chunks,
      mime_type,
      start_timestamp,
      analyser,
      audio_ctx,
      waveform_raf: null,
    };

    snapshot = {
      state: 'recording',
      duration_ms: 0,
      audio_blob: null,
      waveform: null,
      mime_type,
      error: null,
    };
    emit();
    scheduleWaveformFrame();
    scheduleDurationTick();
    return start_timestamp;
  } catch (err) {
    const error =
      err instanceof Error
        ? err
        : new Error(typeof err === 'string' ? err : 'unknown_error_starting_recording');
    snapshot = { ...snapshot, state: 'error', error };
    emit();
    throw error;
  }
}

/**
 * Stop the active recording. Resolves with the final audio blob.
 * Idempotent: calling when no session is active returns the previous blob.
 */
export async function stopRecording(): Promise<Blob | null> {
  if (!active_session) return snapshot.audio_blob;
  const session = active_session;

  return new Promise<Blob | null>((resolve) => {
    const handle_stop = (): void => {
      const blob = new Blob(session.chunks, { type: session.mime_type });
      if (session.audio_ctx && session.audio_ctx.state !== 'closed') {
        void session.audio_ctx.close();
      }
      if (session.waveform_raf !== null) {
        cancelAnimationFrame(session.waveform_raf);
      }
      releaseStream();

      active_session = null;
      snapshot = {
        state: 'stopped',
        duration_ms: Date.now() - session.start_timestamp,
        audio_blob: blob,
        waveform: null,
        mime_type: session.mime_type,
        error: null,
      };
      emit();
      resolve(blob);
    };
    session.recorder.onstop = handle_stop;
    if (session.recorder.state !== 'inactive') {
      session.recorder.stop();
    } else {
      handle_stop();
    }
  });
}

function scheduleWaveformFrame(): void {
  if (!active_session || !active_session.analyser) return;
  const session = active_session;
  const buffer = new Uint8Array(session.analyser!.frequencyBinCount);

  const tick = (): void => {
    if (!active_session || active_session !== session) return;
    if (!session.analyser) return;
    session.analyser.getByteTimeDomainData(buffer);
    snapshot = { ...snapshot, waveform: new Uint8Array(buffer) };
    emit();
    session.waveform_raf = requestAnimationFrame(tick);
  };
  session.waveform_raf = requestAnimationFrame(tick);
}

function scheduleDurationTick(): void {
  if (!active_session) return;
  const session = active_session;
  const tick = (): void => {
    if (!active_session || active_session !== session) return;
    snapshot = { ...snapshot, duration_ms: Date.now() - session.start_timestamp };
    emit();
    // 4Hz — fast enough for a smooth duration counter, slow enough to
    // avoid React-rerender thrash. Use setTimeout (not RAF) so the tick
    // continues in background tabs.
    setTimeout(tick, 250);
  };
  setTimeout(tick, 250);
}

/** Test-only — clear singleton state between cases. */
export function __resetRecorderForTests(): void {
  if (active_session) {
    if (active_session.waveform_raf !== null) {
      cancelAnimationFrame(active_session.waveform_raf);
    }
    try {
      if (active_session.recorder.state !== 'inactive') active_session.recorder.stop();
    } catch {
      // ignore
    }
    if (active_session.audio_ctx) {
      try {
        void active_session.audio_ctx.close();
      } catch {
        // ignore
      }
    }
  }
  active_session = null;
  snapshot = {
    state: 'idle',
    duration_ms: 0,
    audio_blob: null,
    waveform: null,
    mime_type: null,
    error: null,
  };
  subscribers.clear();
}
