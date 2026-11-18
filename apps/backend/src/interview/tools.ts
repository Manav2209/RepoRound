import { z } from "zod";
import { RepositoryKnowledge } from "../github/knowledge.js";
import type { RepositoryContextMode } from "../github/github.scraper.js";
import { emit } from "../observability/events.js";
import { claimSchema, evidenceSchema, phaseSchema } from "./schemas.js";
import { transition } from "./policies.js";
import type { InterviewState } from "./interview.types.js";

export const readTools = [
  "get_project_context",
  "get_architecture",
  "get_file",
  "get_symbol",
  "search_code",
  "get_dependency",
  "get_candidate_state",
  "get_current_objective",
] as const;
export class ToolRegistry {
  private calls = 0;
  constructor(
    private readonly interviewId: string,
    private readonly knowledge: RepositoryKnowledge,
    private readonly state: InterviewState,
    private readonly repositoryContextMode: RepositoryContextMode = "current",
  ) {}
  async execute(
    name: string,
    args: unknown = {},
    allowMutation = false,
  ): Promise<unknown> {
    if (++this.calls > 5 || (this.state.toolCalls ?? 0) >= 200)
      throw new Error("Tool budget exceeded");
    this.state.toolCalls = (this.state.toolCalls ?? 0) + 1;
    await emit(this.interviewId, "tool.started", { name });
    try {
      const result = this.run(name, args, allowMutation);
      await emit(this.interviewId, "tool.completed", { name });
      return result;
    } catch (err) {
      await emit(this.interviewId, "tool.failed", { name });
      throw err;
    }
  }
  private run(name: string, args: unknown, allowMutation: boolean): unknown {
    switch (name) {
      case "get_project_context":
        return this.knowledge.facts;
      case "get_architecture":
        return this.knowledge.facts.architecture ?? {};
      case "get_file": {
        const p = z
          .object({
            path: z.string(),
            startLine: z.number().int().positive().optional(),
          })
          .parse(args);
        return this.knowledge.getFile(p.path, p.startLine);
      }
      case "get_symbol":
        return this.knowledge.getSymbol(
          z.object({ symbol: z.string().max(100) }).parse(args).symbol,
        );
      case "search_code":
        return this.knowledge.search(
          z.object({ query: z.string().max(200) }).parse(args).query,
          this.repositoryContextMode,
        );
      case "get_dependency":
        return this.knowledge.getDependency(
          z.object({ name: z.string().max(100) }).parse(args).name,
        );
      case "get_candidate_state":
        return {
          skills: this.state.skills,
          exploredTopics: this.state.exploredTopics,
          phase: this.state.phase,
        };
      case "get_current_objective":
        return (
          this.state.objectives.find((o) => o.status === "IN_PROGRESS") ?? null
        );
    }
    if (!allowMutation)
      throw new Error("Model tool calls cannot mutate interview state");
    switch (name) {
      case "record_claim": {
        const claim = claimSchema.parse(args);
        if (!this.state.claims.some((c) => c.id === claim.id))
          this.state.claims.push(claim);
        return claim.id;
      }
      case "record_evidence": {
        const evidence = evidenceSchema.parse(args);
        if (!this.state.objectives.some((o) => o.id === evidence.objectiveId))
          throw new Error("Unknown objective");
        if (!this.state.evidence.some((e) => e.id === evidence.id))
          this.state.evidence.push(evidence);
        return evidence.id;
      }
      case "mark_objective_satisfied": {
        const id = z
          .object({ objectiveId: z.string() })
          .parse(args).objectiveId;
        const objective = this.state.objectives.find((o) => o.id === id);
        if (
          !objective ||
          !this.state.evidence.some(
            (e) => e.objectiveId === id && e.strength !== "WEAK",
          )
        )
          throw new Error("Objective lacks evidence");
        objective.status = "SATISFIED";
        return id;
      }
      case "mark_skill_explored": {
        const skill = z.object({ skill: z.string() }).parse(args).skill;
        if (
          !this.state.skills?.[skill] ||
          this.state.skills[skill]?.needsMoreEvidence
        )
          throw new Error("Skill lacks evidence");
        this.state.exploredTopics = [
          ...new Set([...(this.state.exploredTopics ?? []), skill]),
        ];
        return skill;
      }
      case "request_phase_transition":
        transition(
          this.state,
          z.object({ phase: phaseSchema }).parse(args).phase,
        );
        return this.state.phase;
      case "end_interview":
        this.state.ended = true;
        this.state.endReason = "requested";
        transition(this.state, "FINAL");
        return true;
      default:
        throw new Error("Unknown tool");
    }
  }
}
