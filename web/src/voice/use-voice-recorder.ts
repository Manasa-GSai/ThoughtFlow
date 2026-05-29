import { useCallback, useEffect, useState } from 'react';
import {
  RecorderSnapshot,
  getSnapshot,
  startRecording as singletonStart,
  stopRecording as singletonStop,
  subscribe,
} from './recorder-singleton';

/**
 * Public React hook (AC #1, #6, #8).
 *
 * Multiple components can call useVoiceRecorder simultaneously and all see
 * the SAME recording state — the underlying module-scope singleton owns the
 * MediaRecorder, so we get free cross-component persistence (the header
 * indicator and the capture screen stay in sync, and navigating away from
 * the capture screen keeps recording).
 *
 * Returned shape matches AC #1 verbatim.
 */
export interface UseVoiceRecorderReturn {
  isRecording: boolean;
  duration: number; // milliseconds
  audioBlob: Blob | null;
  waveformData: Uint8Array | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  error: Error | null;
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [snapshot, setSnapshot] = useState<RecorderSnapshot>(() => getSnapshot());

  useEffect(() => {
    return subscribe(setSnapshot);
  }, []);

  const start = useCallback(async () => {
    try {
      await singletonStart();
    } catch {
      // Singleton already updated snapshot.state to 'error' with the cause;
      // subscribers received the new snapshot. Swallow here so the caller
      // doesn't have to wrap in try/catch — they can read `error` from state.
    }
  }, []);

  const stop = useCallback(async () => {
    return singletonStop();
  }, []);

  return {
    isRecording: snapshot.state === 'recording',
    duration: snapshot.duration_ms,
    audioBlob: snapshot.audio_blob,
    waveformData: snapshot.waveform,
    startRecording: start,
    stopRecording: stop,
    error: snapshot.error,
  };
}
