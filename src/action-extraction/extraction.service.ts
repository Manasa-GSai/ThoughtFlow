import { Pool } from "pg";
import { randomUUID } from "crypto";
import { CircuitBreaker } from "../transcription/circuit-breaker";

export interface ExtractedActionItem {
  task: string;
  priority: "high" | "medium" | "low";
  due_date: string | null;
}

export interface ExtractionResult {
  thoughtId: string;
  actionItems: ExtractedActionItem[];
  status: "extracted" | "failed" | "queued";
}

export interface ActionExtractionClient {
  extractActions(text: string): Promise<ExtractedActionItem[]>;
}

export const createActionExtractionClient = (apiKey?: string): ActionExtractionClient => {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const baseUrl = process.env.CLAUDE_API_URL || "https://api.anthropic.com/v1/messages";

  return {
    async extractActions(text: string): Promise<ExtractedActionItem[]> {
      const systemPrompt = `Extract action items from the given text. Return ONLY a JSON array where each item has:
{"task": "<description>", "priority": "high"|"medium"|"low", "due_date": "<YYYY-MM-DD>"|null}
For due dates: "tomorrow" = next day, "by Friday" = next Friday, "next week" = next Monday. If no due date is inferable, use null. If priority cannot be determined, use "medium". Return [] if no action items found. Return ONLY the JSON array.`;

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: "user", content: text }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude API error ${response.status}`);
      }

      const data: any = await response.json();
      const content = data.content?.[0]?.text;
      if (!content) return [];

      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: any) => ({
        task: String(item.task || ""),
        priority: ["high", "medium", "low"].includes(item.priority) ? item.priority : "medium",
        due_date: item.due_date || null,
      }));
    },
  };
};

export interface ActionExtractionService {
  extractAndStore(thoughtId: string, userId: string): Promise<ExtractionResult>;
}

export const createActionExtractionService = (
  db: Pool,
  client: ActionExtractionClient,
  circuitBreaker: CircuitBreaker
): ActionExtractionService => {
  return {
    async extractAndStore(thoughtId: string, userId: string): Promise<ExtractionResult> {
      if (!circuitBreaker.canExecute()) {
        return { thoughtId, actionItems: [], status: "queued" };
      }

      const thought = await db.query(
        `SELECT id, raw_text FROM thoughts WHERE id = $1 AND user_id = $2`,
        [thoughtId, userId]
      );

      if (!thought.rows[0]?.raw_text) {
        throw new Error(`Thought ${thoughtId} not found or has no text`);
      }

      try {
        const items = await client.extractActions(thought.rows[0].raw_text);

        circuitBreaker.recordSuccess();

        const storedItems: ExtractedActionItem[] = [];
        for (const item of items) {
          const id = randomUUID();
          const validPriority = (["high", "medium", "low"].includes(item.priority)
            ? item.priority
            : "medium") as "high" | "medium" | "low";
          const normalized = { ...item, priority: validPriority };
          await db.query(
            `INSERT INTO action_items (id, thought_id, user_id, task, priority, due_date, completed, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())`,
            [id, thoughtId, userId, normalized.task, normalized.priority, normalized.due_date]
          );
          storedItems.push(normalized);
        }

        return { thoughtId, actionItems: storedItems, status: "extracted" };
      } catch (err) {
        circuitBreaker.recordFailure();
        return { thoughtId, actionItems: [], status: "failed" };
      }
    },
  };
};
