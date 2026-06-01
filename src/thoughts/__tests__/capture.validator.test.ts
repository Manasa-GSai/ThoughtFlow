import {
  validateAudioFile,
  textCaptureSchema,
  ALLOWED_AUDIO_MIMES,
  MAX_AUDIO_SIZE_BYTES,
} from "../capture.validator";

describe("validateAudioFile", () => {
  const makeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File => ({
    fieldname: "audio",
    originalname: "recording.webm",
    encoding: "7bit",
    mimetype: "audio/webm",
    size: 1024,
    buffer: Buffer.alloc(1024),
    destination: "",
    filename: "",
    path: "",
    stream: null as any,
    ...overrides,
  });

  it("returns null for a valid audio file", () => {
    expect(validateAudioFile(makeFile())).toBeNull();
  });

  it("returns error when no file provided", () => {
    const result = validateAudioFile(undefined);
    expect(result).toEqual({ field: "audio", message: "Audio file is required" });
  });

  it("returns error for file exceeding 25MB", () => {
    const file = makeFile({ size: MAX_AUDIO_SIZE_BYTES + 1 });
    const result = validateAudioFile(file);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("exceeds maximum");
  });

  it("returns error for non-audio MIME type", () => {
    const file = makeFile({ mimetype: "application/pdf" });
    const result = validateAudioFile(file);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("Invalid audio format");
  });

  it.each(ALLOWED_AUDIO_MIMES)("accepts MIME type %s", (mime) => {
    const file = makeFile({ mimetype: mime });
    expect(validateAudioFile(file)).toBeNull();
  });
});

describe("textCaptureSchema", () => {
  it("accepts valid text", () => {
    const result = textCaptureSchema.safeParse({ text: "Buy groceries tomorrow" });
    expect(result.success).toBe(true);
  });

  it("rejects empty text", () => {
    const result = textCaptureSchema.safeParse({ text: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing text field", () => {
    const result = textCaptureSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects text exceeding 50000 characters", () => {
    const result = textCaptureSchema.safeParse({ text: "a".repeat(50001) });
    expect(result.success).toBe(false);
  });
});
