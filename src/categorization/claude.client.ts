export interface CategorizationResult {
  category: string;
  confidence: number;
  tags: string[];
  sentiment: "positive" | "negative" | "neutral" | "mixed";
}

export interface ClaudeClient {
  categorize(text: string, customCategories?: string[]): Promise<CategorizationResult>;
}

const DEFAULT_CATEGORIES = ["work", "family", "errands", "ideas", "health", "finance"];

export const createClaudeClient = (apiKey?: string): ClaudeClient => {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude client");
  }

  const baseUrl = process.env.CLAUDE_API_URL || "https://api.anthropic.com/v1/messages";

  return {
    async categorize(text: string, customCategories: string[] = []): Promise<CategorizationResult> {
      const allCategories = [...DEFAULT_CATEGORIES, ...customCategories];
      const categoryEnum = allCategories.map((c) => `"${c}"`).join(", ");

      const systemPrompt = `You are a thought categorization assistant. Analyze the given text and return ONLY a JSON object with this exact structure:
{"category": <one of [${categoryEnum}]>, "confidence": <number 0.0-1.0>, "tags": <array of 1-5 short keyword tags>, "sentiment": <one of "positive", "negative", "neutral", "mixed">}
Return ONLY the JSON. No explanation.`;

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: "user", content: text }],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Claude API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text;

      if (!content) {
        throw new Error("Empty response from Claude API");
      }

      const parsed = JSON.parse(content);

      if (!allCategories.includes(parsed.category)) {
        parsed.category = "ideas"; // fallback
      }
      parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
      parsed.tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [];
      parsed.sentiment = ["positive", "negative", "neutral", "mixed"].includes(parsed.sentiment)
        ? parsed.sentiment
        : "neutral";

      return parsed;
    },
  };
};

export { DEFAULT_CATEGORIES };
