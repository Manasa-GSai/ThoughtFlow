import { act, renderHook } from '@testing-library/react';
import { useVoiceRecorder } from './use-voice-recorder';
import {
  installRecorderMocks,
  restoreRecorderMocks,
  RecorderMocks,
} from './test-mocks';
import { __resetRecorderForTests } from './recorder-singleton';
import { __resetSharedStreamForTests } from './shared-stream';

describe('useVoiceRecorder hook (AC #1)', () => {
  let mocks: RecorderMocks;

  beforeEach(() => {
    mocks = installRecorderMocks();
    __resetRecorderForTests();
    __resetSharedStreamForTests();
  });

  afterEach(() => {
    __resetRecorderForTests();
    __resetSharedStreamForTests();
    restoreRecorderMocks();
  });

  it('returns the documented shape with idle defaults', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.error).toBeNull();
    expect(typeof result.current.startRecording).toBe('function');
    expect(typeof result.current.stopRecording).toBe('function');
  });

  it('transitions to isRecording=true after startRecording()', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);
  });

  it('audioBlob is populated after stopRecording()', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.startRecording();
    });
    act(() => {
      mocks.latestRecorder().__emitDataChunk(
        new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      );
    });
    await act(async () => {
      await result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioBlob).toBeInstanceOf(Blob);
    expect(result.current.audioBlob!.size).toBeGreaterThan(0);
  });

  it('exposes errors via state without throwing from startRecording (AC #8)', async () => {
    restoreRecorderMocks();
    __resetRecorderForTests();
    __resetSharedStreamForTests();
    installRecorderMocks({ permissionDenied: true });

    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.isRecording).toBe(false);
  });

  it('two hook instances share the same recording state (singleton)', async () => {
    const hookA = renderHook(() => useVoiceRecorder());
    const hookB = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await hookA.result.current.startRecording();
    });

    expect(hookA.result.current.isRecording).toBe(true);
    expect(hookB.result.current.isRecording).toBe(true);
  });

  it('unmounting one hook does not stop recording for the other (AC #6)', async () => {
    const hookA = renderHook(() => useVoiceRecorder());
    const hookB = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await hookA.result.current.startRecording();
    });

    hookA.unmount(); // simulate navigation
    expect(hookB.result.current.isRecording).toBe(true);

    // Confirm only one getUserMedia happened
    expect(mocks.getUserMediaCalls).toBe(1);
  });
});
