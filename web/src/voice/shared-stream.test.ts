import {
  acquireStream,
  releaseStream,
  getActiveStream,
  __resetSharedStreamForTests,
} from './shared-stream';
import { installRecorderMocks, restoreRecorderMocks } from './test-mocks';

describe('SharedStream (iOS Safari microphone-lock defense)', () => {
  let mocks: ReturnType<typeof installRecorderMocks>;

  beforeEach(() => {
    mocks = installRecorderMocks();
    __resetSharedStreamForTests();
  });

  afterEach(() => {
    __resetSharedStreamForTests();
    restoreRecorderMocks();
  });

  it('first acquire makes one getUserMedia call', async () => {
    await acquireStream();
    expect(mocks.getUserMediaCalls).toBe(1);
  });

  it('second acquire reuses the same stream — no extra getUserMedia (AC #5)', async () => {
    const a = await acquireStream();
    const b = await acquireStream();
    expect(mocks.getUserMediaCalls).toBe(1);
    expect(a).toBe(b);
  });

  it('release decrements ref count; tracks stopped only when count hits zero', async () => {
    await acquireStream();
    await acquireStream();
    const stream = getActiveStream();
    expect(stream).not.toBeNull();

    releaseStream(); // ref 2 → 1
    expect(getActiveStream()).not.toBeNull();

    releaseStream(); // ref 1 → 0
    expect(getActiveStream()).toBeNull();
  });

  it('after full release, next acquire opens a fresh stream', async () => {
    await acquireStream();
    releaseStream();
    await acquireStream();
    expect(mocks.getUserMediaCalls).toBe(2);
  });

  it('throws when getUserMedia is unsupported', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await expect(acquireStream()).rejects.toThrow(/not supported/);
  });

  it('surfaces NotAllowedError from getUserMedia (permission denial)', async () => {
    __resetSharedStreamForTests();
    restoreRecorderMocks();
    mocks = installRecorderMocks({ permissionDenied: true });

    await expect(acquireStream()).rejects.toThrow(/Permission denied/);
  });
});
