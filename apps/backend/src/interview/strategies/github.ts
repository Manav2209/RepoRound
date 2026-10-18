import { objectiveSchema } from "../schemas.js";
import { selectObjective } from "../policies.js";
import type { InterviewObjective } from "../interview.types.js";

export interface GithubReadiness {
  interviewPlan: { objectives: unknown; difficulty: string } | null;
  knowledge: { interviewId: string } | null;
  status: string;
}

/** GitHub mode keeps its existing objective-plan readiness contract. */
export function isGithubReady(interview: GithubReadiness): boolean {
  return (
    Boolean(interview.interviewPlan) &&
    Boolean(interview.knowledge) &&
    interview.status === "active"
  );
}

export function githubObjectives(
  plan: { objectives: unknown } | null,
): InterviewObjective[] {
  return objectiveSchema
    .array()
    .min(1)
    .parse(plan?.objectives)
    .map((o) => ({
      ...o,
      status: "NOT_STARTED" as const,
      evidenceIds: [],
      attempts: 0,
    }));
}

export { selectObjective };
