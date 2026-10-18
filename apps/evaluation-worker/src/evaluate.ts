import type { EvaluationService } from "@repo/backend/evaluation";
import { logEvaluation } from "./observability.js";

export interface EvaluationJobData {
  interviewId: string;
}

/**
 * Reuses the backend's EvaluationService unchanged so scoring never forks.
 * `evaluateAndStore` is idempotent: a retry after a committed evaluation sees
 * `Evaluation.status=completed` and returns without re-running the model.
 */
export class EvaluationRunner {
  constructor(private readonly service: EvaluationService) {}

  async run(data: EvaluationJobData): Promise<{ status: "completed" }> {
    const startedAt = Date.now();
    try {
      const outcome = await this.service.evaluateAndStore(data.interviewId);
      await this.service.settleIntent(data.interviewId, "completed");
      logEvaluation("evaluation.completed", {
        interviewId: data.interviewId,
        durationMs: Date.now() - startedAt,
      });
      return outcome;
    } catch (err) {
      logEvaluation("evaluation.failed_attempt", {
        interviewId: data.interviewId,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Called only after BullMQ exhausts its retries. */
  async markFailed(data: EvaluationJobData, error: string): Promise<void> {
    await this.service.settleIntent(data.interviewId, "failed", error);
    logEvaluation("evaluation.exhausted", {
      interviewId: data.interviewId,
      error,
    });
  }
}
