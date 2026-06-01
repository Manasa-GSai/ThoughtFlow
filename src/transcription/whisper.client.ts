export interface WhisperResponse {
  text: string;
  language?: string;
  duration?: number;
}

export interface WhisperClient {
  transcribe(audioBuffer: Buffer, contentType: string): Promise<WhisperResponse>;
}

export const createWhisperClient = (apiKey?: string): WhisperClient => {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for Whisper client");
  }

  const baseUrl = process.env.WHISPER_API_URL || "https://api.openai.com/v1/audio/transcriptions";

  return {
    async transcribe(audioBuffer: Buffer, contentType: string): Promise<WhisperResponse> {
      const ext = contentType.includes("webm") ? "webm" : contentType.includes("wav") ? "wav" : "mp3";
      const blob = new Blob([audioBuffer], { type: contentType });

      const formData = new FormData();
      formData.append("file", blob, `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("response_format", "json");
      formData.append("temperature", "0.1");

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Whisper API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as {
        text?: string;
        language?: string;
        duration?: number;
      };
      return {
        text: data.text ?? "",
        language: data.language,
        duration: data.duration,
      };
    },
  };
};
