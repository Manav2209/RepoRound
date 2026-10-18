/**
 * Stable surface for the independent evaluation worker (apps/evaluation-worker).
 * Keep this lean: importing it must never bootstrap the backend HTTP server.
 */
export { EvaluationService } from "./evaluation.service.js";
export { Evaluator, emptyEvaluation, categories } from "./evaluator.js";
export type {
  Evaluation,
  EvaluationContext,
  EvaluationDimensions,
} from "./evaluation.types.js";
export { loadConfig, loadWorkerConfig } from "../config.js";
export type { BackendConfig, WorkerConfig } from "../config.js";
export { LlmClient } from "../llm/llm.client.js";
export type { LlmMessage, LlmJsonOptions } from "../llm/llm.client.js";
