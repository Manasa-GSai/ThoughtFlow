/**
 * Test fixtures (AC #11) — exported for downstream tests in any module
 * that needs a sample audio blob without invoking the real MediaRecorder.
 */

/** Tiny WebM/Opus header bytes — valid enough for instanceof Blob tests. */
const TINY_WEBM_HEADER = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
  0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
]);

export function sampleAudioBlob(): Blob {
  return new Blob([TINY_WEBM_HEADER], { type: 'audio/webm;codecs=opus' });
}

/**
 * Build a fake MediaStream stub. jsdom doesn't implement MediaStream/Track,
 * so tests need a minimal stand-in. The shape matches the methods our
 * shared-stream + recorder code actually touches: getTracks(), track.stop().
 */
export interface FakeMediaStream {
  active: boolean;
  getTracks(): Array<{ stop: () => void }>;
}

export function fakeMediaStream(): FakeMediaStream {
  const tracks = [{ stop: jest.fn() }, { stop: jest.fn() }];
  return {
    active: true,
    getTracks: () => tracks,
  };
}
