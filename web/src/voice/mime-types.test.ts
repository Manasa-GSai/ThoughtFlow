import { pickSupportedMimeType, PREFERRED_MIME_TYPES } from './mime-types';
import { installRecorderMocks, restoreRecorderMocks } from './test-mocks';

describe('pickSupportedMimeType', () => {
  afterEach(() => {
    restoreRecorderMocks();
  });

  it('returns webm/opus when supported (Chrome/Firefox/Edge path)', () => {
    installRecorderMocks({ supportedMime: 'audio/webm;codecs=opus' });
    expect(pickSupportedMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('falls back to mp4 when webm is not supported (Safari path)', () => {
    installRecorderMocks({ supportedMime: 'audio/mp4;codecs=mp4a.40.2' });
    expect(pickSupportedMimeType()).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('returns null when MediaRecorder is unavailable', () => {
    // Don't install mocks — MediaRecorder isn't on jsdom by default
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(pickSupportedMimeType()).toBeNull();
  });

  it('PREFERRED_MIME_TYPES is ordered Whisper-friendly first', () => {
    expect(PREFERRED_MIME_TYPES[0]).toContain('webm');
    expect(PREFERRED_MIME_TYPES[0]).toContain('opus');
  });
});
