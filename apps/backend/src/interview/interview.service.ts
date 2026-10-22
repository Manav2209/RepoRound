import { prisma, Prisma, type InterviewStatus } from "@repo/db";
import { GithubScraper } from "../github/github.scraper.js";
import { GithubAnalyzer } from "../github/github.analyzer.js";
import { InterviewPlanner } from "./interview.planner.js";
import type { LlmClient } from "../llm/llm.client.js";
import { newId } from "../lib/ids.js";
import {
  interviewRepo,
  type InterviewWithContext,
} from "../db/repositories/interview.repo.js";
import { storeKnowledge } from "../github/knowledge.js";
import { withTrace } from "../observability/events.js";
import { getProblem } from "../system-design/problems.js";
import { initialSystemDesignState } from "./schemas.js";
import { objectivesForProblem } from "./strategies/system-design.js";

export class InterviewService {
  private readonly scraper = new GithubScraper();
  private readonly analyzer: GithubAnalyzer;
  private readonly planner: InterviewPlanner;

  constructor(
    llm: LlmClient,
    private readonly systemDesignDurationMinutes = 15,
  ) {
    this.analyzer = new GithubAnalyzer(llm);
    this.planner = new InterviewPlanner(llm);
  }

  async create(
    githubUrl: string,
    userId: string,
  ): Promise<{ id: string; status: InterviewStatus }> {
    const { owner, name, url } = GithubScraper.parseGithubUrl(githubUrl);

    const interview = await prisma.$transaction(async (tx) => {
      const row = await tx.interview.create({
        data: {
          id: newId("int"),
          githubUrl: url,
          owner,
          name,
          userId,
          status: "analyzing",
        },
      });
      await tx.interviewJob.create({
        data: {
          id: newId("job"),
          interviewId: row.id,
          kind: "PREPARE",
          key: `PREPARE:${row.id}`,
          payload: {},
        },
      });
      return row;
    });

    return { id: interview.id, status: "analyzing" };
  }

  async createSystemDesign(
    problemId: string,
    userId: string,
  ): Promise<{ id: string; status: InterviewStatus }> {
    const problem = getProblem(problemId);
    if (!problem) throw new Error("Unknown system design problem");
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.interview.create({
        data: {
          id: newId("int"),
          mode: "SYSTEM_DESIGN",
          systemDesignProblemId: problem.id,
          userId,
          status: "created",
        },
      });
      const state = initialSystemDesignState({
        problemId: problem.id,
        problemSnapshot: problem,
        problemVersion: problem.version,
        objectives: objectivesForProblem(problem),
        difficulty: problem.difficulty,
        phase: "DESIGN_PENDING",
      });
      await tx.interviewRuntime.create({
        data: {
          interviewId: created.id,
          deadlineAt: new Date(
            Date.now() + this.systemDesignDurationMinutes * 60_000,
          ),
          data: state as unknown as Prisma.InputJsonValue,
        },
      });
      return created;
    });
    return { id: row.id, status: "created" };
  }

  async getById(id: string): Promise<InterviewWithContext | null> {
    return interviewRepo.getWithContext(id);
  }

  async runPipeline(id: string): Promise<void> {
    try {
      const interview = await interviewRepo.getById(id);
      if (!interview) throw new Error(`Interview ${id} not found`);
      if (interview.status !== "analyzing") return;
      if (!interview.owner || !interview.name)
        throw new Error("Interview is missing repository metadata");

      const scraped = await withTrace(id, "repository_retrieval", () =>
        this.scraper.scrape(interview.owner!, interview.name!),
      );
      const context = await withTrace(id, "repository_analysis", () =>
        this.analyzer.analyze(scraped),
      );
      await storeKnowledge(id, scraped, context);

      const plan = await withTrace(id, "interview_planning", () =>
        this.planner.plan(context),
      );

      await prisma.interviewPlan.upsert({
        where: { interviewId: id },
        create: {
          interviewId: id,
          role: plan.role,
          difficulty: plan.difficulty,
          topics: plan.topics as unknown as Prisma.InputJsonValue,
          objectives: plan.objectives as unknown as Prisma.InputJsonValue,
        },
        update: {
          role: plan.role,
          difficulty: plan.difficulty,
          topics: plan.topics as unknown as Prisma.InputJsonValue,
          objectives: plan.objectives as unknown as Prisma.InputJsonValue,
        },
      });

      await interviewRepo.markReady(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[interview:${id}] pipeline failed: ${message}`);
      throw err;
    }
  }
}
