/**
 * Browser API mocks for jsdom — MediaRecorder, getUserMedia, AudioContext.
 *
 * jsdom doesn't implement these, so every voice-recorder test must install
 * shims first. Centralizing them here means the per-test boilerplate stays
 * tiny: `installRecorderMocks()` in beforeEach + `restoreRecorderMocks()`
 * in afterEach.
 */
import { FakeMediaStream, fakeMediaStream } from './test-fixtures';

export interface MockMediaRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused';
  mimeType: string;
  ondataavailable: ((e: BlobEvent) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  /** Helper for tests — emit a synthetic dataavailable event. */
  __emitDataChunk(blob: Blob): void;
}

type MockMediaRecorderCtor = (new (stream: MediaStream, options?: { mimeType?: string }) => MockMediaRecorder) & {
  isTypeSupported?: (mime: string) => boolean;
  /** Test-side handle — every constructed recorder is pushed here. */
  __instances?: MockMediaRecorder[];
};

export interface InstallMocksOptions {
  /** Force this MIME type as the only supported one. Default: webm/opus. */
  supportedMime?: string;
  /** Force getUserMedia to throw — simulates permission denial. */
  permissionDenied?: boolean;
  /** Skip AudioContext mocking (test the no-waveform fallback). */
  skipAudioContext?: boolean;
}

export interface RecorderMocks {
  recorderInstances: MockMediaRecorder[];
  stream: FakeMediaStream;
  getUserMediaCalls: number;
  /** Resolves the most-recently-constructed recorder, useful for assertions. */
  latestRecorder: () => MockMediaRecorder;
}

let originalDescriptors: Record<string, PropertyDescriptor | undefined> = {};

export function installRecorderMocks(options: InstallMocksOptions = {}): RecorderMocks {
  const supportedMime = options.supportedMime ?? 'audio/webm;codecs=opus';
  const recorderInstances: MockMediaRecorder[] = [];
  const stream = fakeMediaStream();
  let getUserMediaCalls = 0;

  const RecorderClass: MockMediaRecorderCtor = function (
    this: MockMediaRecorder,
    _stream: MediaStream,
    opts?: { mimeType?: string },
  ) {
    const target = new EventTarget() as MockMediaRecorder;
    target.state = 'inactive';
    target.mimeType = opts?.mimeType ?? supportedMime;
    target.ondataavailable = null;
    target.onstop = null;
    target.start = (_timeslice?: number) => {
      target.state = 'recording';
    };
    target.stop = () => {
      target.state = 'inactive';
      // Fire onstop async to mimic real MediaRecorder semantics
      setTimeout(() => target.onstop?.(), 0);
    };
    target.__emitDataChunk = (blob: Blob) => {
      target.ondataavailable?.({ data: blob } as BlobEvent);
    };
    recorderInstances.push(target);
    return target;
  } as unknown as MockMediaRecorderCtor;
  RecorderClass.isTypeSupported = (mime: string) => mime === supportedMime;
  RecorderClass.__instances = recorderInstances;

  saveDescriptor('MediaRecorder');
  Object.defineProperty(window, 'MediaRecorder', {
    value: RecorderClass,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: RecorderClass,
    configurable: true,
    writable: true,
  });

  // getUserMedia
  saveDescriptor('navigator.mediaDevices');
  const mediaDevices = {
    getUserMedia: async (_constraints: MediaStreamConstraints): Promise<MediaStream> => {
      getUserMediaCalls += 1;
      if (options.permissionDenied) {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        throw err;
      }
      return stream as unknown as MediaStream;
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: mediaDevices,
    configurable: true,
    writable: true,
  });

  // AudioContext (optional)
  if (!options.skipAudioContext) {
    saveDescriptor('AudioContext');
    const FakeAudioCtx = function (this: AudioContext) {
      return {
        state: 'running',
        createMediaStreamSource: () => ({ connect: () => undefined }),
        createAnalyser: () => ({
          fftSize: 0,
          frequencyBinCount: 128,
          getByteTimeDomainData: (out: Uint8Array) => {
            // fill with a recognizable pattern so tests can assert waveform updates
            for (let i = 0; i < out.length; i += 1) out[i] = (i * 2) % 256;
          },
        }),
        close: () => Promise.resolve(),
      } as unknown as AudioContext;
    } as unknown as typeof AudioContext;
    Object.defineProperty(window, 'AudioContext', {
      value: FakeAudioCtx,
      configurable: true,
      writable: true,
    });
  } else {
    saveDescriptor('AudioContext');
    Object.defineProperty(window, 'AudioContext', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }

  // requestAnimationFrame — jsdom provides one but uses setTimeout(16);
  // override to immediate-fire for deterministic tests.
  saveDescriptor('requestAnimationFrame');
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => {
      const handle = setTimeout(() => cb(performance.now()), 0);
      return handle as unknown as number;
    },
    configurable: true,
    writable: true,
  });
  saveDescriptor('cancelAnimationFrame');
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (handle: number) => clearTimeout(handle),
    configurable: true,
    writable: true,
  });

  return {
    recorderInstances,
    stream,
    get getUserMediaCalls() {
      return getUserMediaCalls;
    },
    latestRecorder: () => recorderInstances[recorderInstances.length - 1],
  };
}

export function restoreRecorderMocks(): void {
  for (const [path, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor === undefined) continue;
    const [obj, prop] = resolvePath(path);
    Object.defineProperty(obj, prop, descriptor);
  }
  originalDescriptors = {};
}

function saveDescriptor(path: string): void {
  const [obj, prop] = resolvePath(path);
  if (!(path in originalDescriptors)) {
    originalDescriptors[path] = Object.getOwnPropertyDescriptor(obj, prop);
  }
}

function resolvePath(path: string): [Record<string, unknown>, string] {
  if (path === 'MediaRecorder') return [globalThis as Record<string, unknown>, 'MediaRecorder'];
  if (path === 'AudioContext') return [window as unknown as Record<string, unknown>, 'AudioContext'];
  if (path === 'navigator.mediaDevices')
    return [navigator as unknown as Record<string, unknown>, 'mediaDevices'];
  if (path === 'requestAnimationFrame')
    return [globalThis as Record<string, unknown>, 'requestAnimationFrame'];
  if (path === 'cancelAnimationFrame')
    return [globalThis as Record<string, unknown>, 'cancelAnimationFrame'];
  throw new Error(`Unknown path: ${path}`);
}
