import { Pool } from "pg";
import { ClaudeClient, CategorizationResult } from "./claude.client";
import { CircuitBreaker } from "../transcription/circuit-breaker";

export interface CategorizationResponse {
  thoughtId: string;
  category: string;
  confidence: number;
  tags: string[];
  sentiment: string;
  status: "categorized" | "failed" | "queued";
}

export interface CategorizationService {
  categorizeThought(thoughtId: string, userId: string): Promise<CategorizationResponse>;
}

export const createCategorizationService = (
  db: Pool,
  claude: ClaudeClient,
  circuitBreaker: CircuitBreaker
): CategorizationService => {
  return {
    async categorizeThought(thoughtId: string, userId: string): Promise<CategorizationResponse> {
      if (!circuitBreaker.canExecute()) {
        return { thoughtId, category: "", confidence: 0, tags: [], sentiment: "", status: "queued" };
      }

      const thought = await db.query(
        `SELECT id, raw_text, status FROM thoughts WHERE id = $1 AND user_id = $2`,
        [thoughtId, userId]
      );

      if (!thought.rows[0]) {
        throw new Error(`Thought ${thoughtId} not found`);
      }

      if (!thought.rows[0].raw_text) {
        throw new Error(`Thought ${thoughtId} has no text to categorize`);
      }

      // Fetch user's custom categories
      const customCats = await db.query(
        `SELECT name FROM custom_categories
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY sort_order`,
        [userId]
      );
      const customCategories = customCats.rows.map((r: any) => r.name);

      try {
        const result: CategorizationResult = await claude.categorize(
          thought.rows[0].raw_text,
          customCategories
        );

        circuitBreaker.recordSuccess();

        await db.query(
          `UPDATE thoughts SET category = $1, ai_confidence_score = $2, status = 'categorized', updated_at = NOW() WHERE id = $3`,
          [result.category, result.confidence, thoughtId]
        );

        return {
          thoughtId,
          category: result.category,
          confidence: result.confidence,
          tags: result.tags,
          sentiment: result.sentiment,
          status: "categorized",
        };
      } catch (err) {
        circuitBreaker.recordFailure();
        return { thoughtId, category: "", confidence: 0, tags: [], sentiment: "", status: "failed" };
      }
    },
  };
};
