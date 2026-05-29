import {
  startRecording,
  stopRecording,
  getSnapshot,
  subscribe,
  __resetRecorderForTests,
} from './recorder-singleton';
import { __resetSharedStreamForTests } from './shared-stream';
import { installRecorderMocks, restoreRecorderMocks, RecorderMocks } from './test-mocks';

describe('recorder-singleton — state transitions (AC #1, #9)', () => {
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

  it('idle → recording on startRecording()', async () => {
    expect(getSnapshot().state).toBe('idle');
    await startRecording();
    expect(getSnapshot().state).toBe('recording');
  });

  it('start latency under 1 second (AC #2)', async () => {
    const before = Date.now();
    const recorded_at = await startRecording();
    const after = Date.now();
    expect(recorded_at - before).toBeLessThan(1000);
    expect(recorded_at).toBeGreaterThanOrEqual(before);
    expect(recorded_at).toBeLessThanOrEqual(after);
  });

  it('recording → stopped on stopRecording(), producing a Blob with the selected MIME type', async () => {
    await startRecording();
    const recorder = mocks.latestRecorder();
    recorder.__emitDataChunk(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }));
    const blob = await stopRecording();

    expect(getSnapshot().state).toBe('stopped');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe('audio/webm;codecs=opus');
    expect(blob!.size).toBeGreaterThan(0);
  });

  it('subscribers receive snapshots on every transition', async () => {
    const observed: string[] = [];
    const unsubscribe = subscribe((s) => observed.push(s.state));

    await startRecording();
    mocks.latestRecorder().__emitDataChunk(new Blob([new Uint8Array([1])], { type: 'audio/webm' }));
    await stopRecording();
    unsubscribe();

    expect(observed).toContain('idle');
    expect(observed).toContain('recording');
    expect(observed).toContain('stopped');
  });

  it('start is idempotent — second call returns the same start timestamp', async () => {
    const t1 = await startRecording();
    const t2 = await startRecording();
    expect(t2).toBe(t1);
  });

  it('stop is idempotent — second call resolves with previous blob (no extra recorder.stop)', async () => {
    await startRecording();
    mocks.latestRecorder().__emitDataChunk(new Blob([new Uint8Array([7])], { type: 'audio/webm' }));
    const first = await stopRecording();
    const second = await stopRecording();
    expect(second).toBe(first);
  });

  it('surfaces permission denial as error state (AC #8)', async () => {
    restoreRecorderMocks();
    __resetRecorderForTests();
    __resetSharedStreamForTests();
    installRecorderMocks({ permissionDenied: true });

    await expect(startRecording()).rejects.toThrow(/Permission denied/);
    expect(getSnapshot().state).toBe('error');
    expect(getSnapshot().error).toBeInstanceOf(Error);
  });

  it('throws when no supported MIME type is available', async () => {
    restoreRecorderMocks();
    __resetRecorderForTests();
    __resetSharedStreamForTests();
    // Install mocks but kill MediaRecorder
    installRecorderMocks();
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await expect(startRecording()).rejects.toThrow(/MIME type|MediaRecorder/);
  });

  it('persists across simulated component unmount/remount (AC #6)', async () => {
    // Mount A
    const unsubscribeA = subscribe(() => undefined);
    await startRecording();
    // Unmount A (simulating navigation)
    unsubscribeA();
    expect(getSnapshot().state).toBe('recording');
    // Mount B — sees the active session
    const observed: string[] = [];
    const unsubscribeB = subscribe((s) => observed.push(s.state));
    expect(observed[0]).toBe('recording');
    unsubscribeB();
  });
});

describe('recorder-singleton — waveform (AC #7)', () => {
  beforeEach(() => {
    installRecorderMocks();
    __resetRecorderForTests();
    __resetSharedStreamForTests();
  });

  afterEach(() => {
    __resetRecorderForTests();
    __resetSharedStreamForTests();
    restoreRecorderMocks();
  });

  it('waveform updates emit Uint8Array snapshots while recording', async () => {
    await startRecording();
    // Wait for one RAF tick (mock uses setTimeout(0))
    await new Promise((r) => setTimeout(r, 10));
    const snapshot = getSnapshot();
    expect(snapshot.waveform).toBeInstanceOf(Uint8Array);
    expect(snapshot.waveform!.length).toBeGreaterThan(0);
  });

  it('waveform is null after stop', async () => {
    await startRecording();
    await new Promise((r) => setTimeout(r, 10));
    await stopRecording();
    expect(getSnapshot().waveform).toBeNull();
  });

  it('recording still works when AudioContext is unavailable (graceful degradation)', async () => {
    restoreRecorderMocks();
    __resetRecorderForTests();
    __resetSharedStreamForTests();
    installRecorderMocks({ skipAudioContext: true });

    await startRecording();
    expect(getSnapshot().state).toBe('recording');
    expect(getSnapshot().waveform).toBeNull(); // no waveform without AnalyserNode
  });
});
