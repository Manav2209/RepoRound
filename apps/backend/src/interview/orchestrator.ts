import { Prisma, prisma } from "@repo/db";
import { RepositoryKnowledge } from "../github/knowledge.js";
import { newId } from "../lib/ids.js";
import type { LlmClient } from "../llm/llm.client.js";
import { domainEvent, emit, withTrace } from "../observability/events.js";
import { enqueue, JobDeferred } from "../jobs/queue.js";
import { AnswerAnalyzer } from "./answer-analyzer.js";
import { QuestionGenerator } from "./question-generator.js";
import { prepareGithubObjectives, stateSchema } from "./schemas.js";
import { withInterviewLock } from "./runtime-lock.js";
import { PHASES, transition } from "./policies.js";
import {
  createGithubState,
  recordGithubQuestion,
  selectGithubAction,
} from "./github-policy.js";
import type {
  InterviewDifficulty,
  InterviewObjective,
  InterviewState,
  QuestionRecord,
} from "./interview.types.js";
import { getProblem } from "../system-design/problems.js";
import {
  activeRevision,
  getActiveSubmission,
  getReadySubmissionByRevision,
} from "../system-design/submissions.js";
import { designGraphStore } from "../system-design/graph.js";
import { gatherProbeContext, selectProbe } from "../system-design/probes.js";
import {
  challengeQuestion,
  componentsFromSnapshot,
  detectRevisionDecision,
  introQuestion,
  nudgeQuestion,
  phraseProbeQuestion,
  phraseRevisionReview,
} from "./strategies/system-design.js";
export { selectObjective } from "./policies.js";

const MAX_SD_PROBES = 3;

const DIFFICULTIES: InterviewDifficulty[] = [
  "EASY",
  "MEDIUM",
  "HARD",
  "EXPERT",
];
export function adaptDifficulty(
  current: InterviewDifficulty,
  strength: "WEAK" | "MODERATE" | "STRONG" | undefined,
): InterviewDifficulty {
  return DIFFICULTIES[
    Math.max(
      0,
      Math.min(
        3,
        DIFFICULTIES.indexOf(current) +
          (strength === "STRONG" ? 1 : strength === "WEAK" ? -1 : 0),
      ),
    )
  ]!;
}
export type NextResponse =
  | { ended: true; deadlineAt?: string }
  | { ended: false; questionId: string; question: string; deadlineAt?: string };

export class InterviewOrchestrator {
  private readonly analyzer: AnswerAnalyzer;
  private readonly generator: QuestionGenerator;
  constructor(
    private readonly llm: LlmClient,
    private readonly durationMinutes = 30,
    private readonly githubDurationMinutes = 15,
  ) {
    this.analyzer = new AnswerAnalyzer(llm);
    this.generator = new QuestionGenerator(llm);
  }
  private response(
    state: InterviewState,
    questionId?: string,
    deadlineAt?: Date,
  ): NextResponse {
    if (state.ended || questionId === "END")
      return { ended: true, deadlineAt: deadlineAt?.toISOString() };
    const question = state.questions.find((q) => q.id === questionId);
    return question
      ? {
          ended: false,
          questionId: question.id,
          question: question.text,
          deadlineAt: deadlineAt?.toISOString(),
        }
      : { ended: true };
  }
  private async save(
    interviewId: string,
    token: string,
    version: number,
    state: InterviewState,
    events: ReturnType<typeof domainEvent>[] = [],
    turn?: { id: string; status: string; error?: string },
  ): Promise<void> {
    stateSchema.parse(state);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.interviewRuntime.updateMany({
        where: {
          interviewId,
          leaseToken: token,
          version,
          interview: { status: "active" },
        },
        data: {
          version: { increment: 1 },
          data: state as unknown as Prisma.InputJsonValue,
        },
      });
      if (!updated.count)
        throw new Error("Interview changed before turn was committed");
      if (turn)
        await tx.conversationTurn.update({
          where: { id: turn.id },
          data: {
            analysisStatus: turn.status,
            analysisError: turn.error ?? null,
          },
        });
      if (events.length) await tx.interviewEvent.createMany({ data: events });
      if (state.ended)
        await tx.interviewJob.upsert({
          where: { key: `END:${interviewId}` },
          create: {
            id: newId("job"),
            interviewId,
            kind: "END",
            key: `END:${interviewId}`,
            payload: { reason: state.endReason ?? "objectives_completed" },
          },
          update: {},
        });
    });
  }
  async start(interviewId: string, sessionId?: string): Promise<NextResponse> {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        interviewPlan: true,
        knowledge: { select: { interviewId: true } },
      },
    });
    if (!interview) throw new Error("Interview not found");
    if (interview.mode === "SYSTEM_DESIGN")
      return this.startSystemDesign(interview, sessionId);
    if (
      !interview.interviewPlan ||
      !interview.knowledge ||
      interview.status !== "active"
    )
      throw new Error("Interview is not active or prepared");
    if (sessionId) await this.validateSession(interviewId, sessionId);
    const plan = prepareGithubObjectives(interview.interviewPlan.objectives);
    const initial: InterviewState = {
      mode: "GITHUB",
      github: createGithubState(plan, this.githubDurationMinutes),
      phase: "INTRO",
      difficulty:
        interview.interviewPlan.difficulty === "senior" ? "HARD" : "MEDIUM",
      objectives: plan,
      claims: [],
      evidence: [],
      questions: [],
      processedTurns: {},
      ended: false,
      skills: {},
      exploredTopics: [],
      toolCalls: 0,
    };
    await prisma.interviewRuntime.upsert({
      where: { interviewId },
      create: {
        interviewId,
        data: initial as unknown as Prisma.InputJsonValue,
        deadlineAt: new Date(
          Date.now() + this.githubDurationMinutes * 60_000,
        ),
      },
      update: {},
    });
    return withInterviewLock(interviewId, async (token) => {
      const row = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId },
      });
      const state = stateSchema.parse(row.data);
      if (row.deadlineAt <= new Date()) {
        state.ended = true;
        state.endReason = "time_limit";
        transition(state, "FINAL");
        await this.save(interviewId, token, row.version, state);
        return { ended: true };
      }
      if (state.questions.length || state.ended)
        return this.response(state, state.questions.at(-1)?.id, row.deadlineAt);
      const remainingMinutes = Math.max(
        0,
        Math.floor((row.deadlineAt.getTime() - Date.now()) / 60_000),
      );
      const action = selectGithubAction(state, remainingMinutes);
      if (action.type === "END_INTERVIEW") {
        state.ended = true;
        state.endReason = "objectives_completed";
        transition(state, "FINAL");
        await this.save(interviewId, token, row.version, state, [
          domainEvent(interviewId, "interview.ended", {
            reason: state.endReason,
          }),
        ]);
        return { ended: true };
      }
      const objective = state.objectives.find(
        (item) => item.id === action.objectiveId,
      );
      if (!objective) throw new Error("No interview objectives");
      const knowledge = await RepositoryKnowledge.load(interviewId);
      const question = await this.generator.generate(
        interviewId,
        state,
        objective,
        action,
        knowledge,
        [],
        remainingMinutes,
      );
      transition(state, objective.phase);
      objective.status = "IN_PROGRESS";
      state.questions.push(question);
      recordGithubQuestion(state, objective, false);
      await this.save(interviewId, token, row.version, state, [
        domainEvent(interviewId, "interview.started", {
          phase: state.phase,
          mode: "GITHUB",
        }),
        domainEvent(interviewId, "objective.started", {
          objectiveId: objective.id,
        }),
        domainEvent(interviewId, "interviewer.question", {
          questionId: question.id,
          objectiveId: objective.id,
          phase: state.phase,
          kind: question.kind,
        }),
      ]);
      return this.response(state, question.id, row.deadlineAt);
    });
  }
  private async startSystemDesign(
    interview: {
      id: string;
      status: string;
      systemDesignProblemId: string | null;
    },
    sessionId?: string,
  ): Promise<NextResponse> {
    const interviewId = interview.id;
    if (interview.status !== "active")
      throw new Error("Interview is not active");
    if (sessionId) await this.validateSession(interviewId, sessionId);
    const active = await getActiveSubmission(interviewId);
    if (!active)
      throw new Error("Interview has no ready architecture submission");
    const problem = getProblem(interview.systemDesignProblemId ?? "");
    if (!problem) throw new Error("Unknown system design problem");
    return withInterviewLock(interviewId, async (token) => {
      const row = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId },
      });
      const state = stateSchema.parse(row.data);
      if (row.deadlineAt <= new Date()) {
        state.ended = true;
        state.endReason = "time_limit";
        transition(state, "FINAL");
        await this.save(interviewId, token, row.version, state);
        return { ended: true };
      }
      if (state.questions.length || state.ended)
        return this.response(state, state.questions.at(-1)?.id, row.deadlineAt);
      const question = introQuestion(state, problem);
      state.questions.push(question);
      await this.save(interviewId, token, row.version, state, [
        domainEvent(interviewId, "interview.started", {
          phase: state.phase,
          mode: "SYSTEM_DESIGN",
        }),
        domainEvent(interviewId, "interviewer.question", {
          questionId: question.id,
          phase: state.phase,
        }),
      ]);
      return this.response(state, question.id, row.deadlineAt);
    });
  }

  private async validateSession(
    interviewId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
    });
    if (
      !session ||
      session.interviewId !== interviewId ||
      session.status === "failed"
    )
      throw new Error("Invalid interview session");
  }
  async processTurn(input: {
    interviewId: string;
    sessionId: string;
    turnId: string;
    text: string;
    questionId?: string;
  }): Promise<NextResponse> {
    await this.validateSession(input.interviewId, input.sessionId);
    return withTrace(input.interviewId, "candidate_turn", () =>
      withInterviewLock(input.interviewId, async (token) => {
        const row = await prisma.interviewRuntime.findUniqueOrThrow({
          where: { interviewId: input.interviewId },
        });
        const state = stateSchema.parse(row.data);
        const existing = await prisma.conversationTurn.findUnique({
          where: { id: input.turnId },
        });
        if (
          existing &&
          (existing.interviewId !== input.interviewId ||
            existing.sessionId !== input.sessionId ||
            existing.text !== input.text ||
            existing.role !== "user" ||
            (input.questionId && existing.questionId !== input.questionId))
        )
          throw new Error("Turn ID conflicts with a different transcript");
        const prior = state.processedTurns[input.turnId];
        if (prior) return this.response(state, prior, row.deadlineAt);
        const interview = await prisma.interview.findUniqueOrThrow({
          where: { id: input.interviewId },
        });
        if (state.ended || interview.status !== "active")
          return { ended: true };
        const lastQuestion = state.questions.at(-1);
        if (!lastQuestion) throw new Error("Interview has not started");
        const questionId = input.questionId ?? lastQuestion.id;
        if (!existing)
          await prisma.conversationTurn.create({
            data: {
              id: input.turnId,
              interviewId: input.interviewId,
              sessionId: input.sessionId,
              turnIndex: await prisma.conversationTurn.count({
                where: { interviewId: input.interviewId },
              }),
              role: "user",
              text: input.text,
              questionId,
              completedAt: new Date(),
            },
          });
        if (questionId !== lastQuestion.id) {
          state.processedTurns[input.turnId] = lastQuestion.id;
          await this.save(input.interviewId, token, row.version, state, [], {
            id: input.turnId,
            status: "failed",
            error: "Late answer will be analyzed after the interview",
          });
          return this.response(state, lastQuestion.id, row.deadlineAt);
        }
        lastQuestion.answerTurnId = input.turnId;
        const events = [
          domainEvent(input.interviewId, "candidate.transcript.final", {
            turnId: input.turnId,
            questionId,
          }),
        ];
        if (row.deadlineAt <= new Date()) {
          state.ended = true;
          state.endReason = "time_limit";
          transition(state, "FINAL");
          state.processedTurns[input.turnId] = "END";
          await this.save(
            input.interviewId,
            token,
            row.version,
            state,
            events,
            {
              id: input.turnId,
              status: "failed",
              error: "Analysis pending at deadline",
            },
          );
          return { ended: true };
        }
        if (interview.mode === "SYSTEM_DESIGN")
          return this.continueSystemDesign({
            interviewId: input.interviewId,
            token,
            row,
            state,
            turnId: input.turnId,
            text: input.text,
            events,
          });
        const objective = state.objectives.find(
          (o) => o.id === lastQuestion.objectiveId,
        )!;
        const knowledge = await RepositoryKnowledge.load(input.interviewId);
        let failedAnalysis = false;
        const beforeEvidence = state.evidence.length;
        const beforeClaims = state.claims.length;
        try {
          const analysis = await this.analyzer.analyze(
            input.interviewId,
            { id: input.turnId, text: input.text },
            lastQuestion.text,
            objective,
            knowledge,
          );
          this.analyzer.apply(state, input.turnId, objective, analysis);
          objective.attempts++;
          const strength = analysis.evidence.some(
            (e) => e.strength === "STRONG",
          )
            ? "STRONG"
            : analysis.evidence.some((e) => e.strength === "WEAK")
              ? "WEAK"
              : undefined;
          const adapted = adaptDifficulty(state.difficulty, strength);
          const difficulty = adapted === "EASY" ? "MEDIUM" : adapted;
          if (difficulty !== state.difficulty)
            events.push(
              domainEvent(input.interviewId, "difficulty.changed", {
                from: state.difficulty,
                to: difficulty,
              }),
            );
          state.difficulty = difficulty;
        } catch {
          failedAnalysis = true;
          events.push(
            domainEvent(input.interviewId, "analysis.failed", {
              turnId: input.turnId,
            }),
          );
        }
        if (
          (objective.attempts >= 2 ||
            state.questions.filter((q) => q.objectiveId === objective.id)
              .length >= 2) &&
          objective.status !== "SATISFIED"
        )
          objective.status = "INSUFFICIENT";
        if (objective.status === "SATISFIED")
          events.push(
            domainEvent(input.interviewId, "objective.satisfied", {
              objectiveId: objective.id,
            }),
          );
        for (const evidence of state.evidence.slice(beforeEvidence))
          events.push(
            domainEvent(input.interviewId, "candidate.evidence.recorded", {
              evidenceId: evidence.id,
              turnId: input.turnId,
              objectiveId: objective.id,
            }),
          );
        for (const claim of state.claims.slice(beforeClaims))
          events.push(
            domainEvent(input.interviewId, "candidate.claim.extracted", {
              claimId: claim.id,
              status: claim.status,
              turnId: input.turnId,
            }),
          );
        const remaining = Math.max(
          0,
          (row.deadlineAt.getTime() - Date.now()) / 60_000,
        );
        const action = selectGithubAction(
          state,
          Math.floor(remaining),
          failedAnalysis,
        );
        events.push(
          domainEvent(input.interviewId, "next_action.selected", {
            action: action.type,
            remainingMinutes: remaining,
          }),
        );
        if (action.type === "END_INTERVIEW") {
          state.ended = true;
          state.endReason = "objectives_completed";
          transition(state, "FINAL");
          state.processedTurns[input.turnId] = "END";
        } else {
          const next = state.objectives.find(
            (o) => o.id === action.objectiveId,
          )!;
          for (const skipped of state.objectives)
            if (
              PHASES.indexOf(skipped.phase) < PHASES.indexOf(next.phase) &&
              !["SATISFIED", "INSUFFICIENT"].includes(skipped.status)
            )
              skipped.status = "INSUFFICIENT";
          if (state.phase !== next.phase) {
            events.push(
              domainEvent(input.interviewId, "phase.changed", {
                from: state.phase,
                to: next.phase,
              }),
            );
            transition(state, next.phase);
          }
          const recent = await prisma.conversationTurn.findMany({
            where: { interviewId: input.interviewId },
            orderBy: { createdAt: "desc" },
            take: 4,
            select: { role: true, text: true },
          });
          const question = await this.generator.generate(
            input.interviewId,
            state,
            next,
            action,
            knowledge,
            recent.reverse(),
            remaining,
          );
          if (action.claimId) {
            const claim = state.claims.find((c) => c.id === action.claimId);
            if (claim) claim.probed = true;
          }
          const isFollowUp =
            state.questions.at(-1)?.objectiveId === next.id &&
            action.type !== "ASK_NEW_TOPIC";
          next.status = "IN_PROGRESS";
          state.questions.push({ ...question, sourceTurnId: input.turnId });
          recordGithubQuestion(state, next, isFollowUp);
          state.processedTurns[input.turnId] = question.id;
          events.push(
            domainEvent(input.interviewId, "interviewer.question", {
              questionId: question.id,
              objectiveId: next.id,
              phase: state.phase,
              action: action.type,
              kind: question.kind,
            }),
          );
        }
        if (row.deadlineAt <= new Date()) {
          state.ended = true;
          state.endReason = "time_limit";
          transition(state, "FINAL");
          state.processedTurns[input.turnId] = "END";
        }
        await this.save(input.interviewId, token, row.version, state, events, {
          id: input.turnId,
          status: failedAnalysis ? "failed" : "completed",
          error: failedAnalysis
            ? "Answer analysis failed and will be retried"
            : undefined,
        });
        return this.response(
          state,
          state.processedTurns[input.turnId],
          row.deadlineAt,
        );
      }),
    );
  }
  private async continueSystemDesign(input: {
    interviewId: string;
    token: string;
    row: { version: number; deadlineAt: Date };
    state: InterviewState;
    turnId: string;
    text: string;
    events: ReturnType<typeof domainEvent>[];
  }): Promise<NextResponse> {
    const { interviewId, token, row, state, turnId, text, events } = input;
    const sd = state.systemDesign;
    if (!sd) throw new Error("System design interview state is missing");
    const problem = getProblem(sd.problemId) ?? null;
    const active = await getActiveSubmission(interviewId);
    const push = (question: QuestionRecord): void => {
      state.questions.push({ ...question, sourceTurnId: turnId });
      state.processedTurns[turnId] = question.id;
      events.push(
        domainEvent(interviewId, "interviewer.question", {
          questionId: question.id,
          phase: state.phase,
          mode: "SYSTEM_DESIGN",
        }),
      );
    };
    const finish = (): void => {
      state.ended = true;
      state.endReason = "objectives_completed";
      transition(state, "FINAL");
      state.processedTurns[turnId] = "END";
    };
    const issueChallenge = (): void => {
      if (!problem) return;
      sd.phase = "REVISION_REQUESTED";
      sd.challengeIssued = true;
      push(challengeQuestion(state, problem));
      events.push(
        domainEvent(interviewId, "system_design.challenge", {
          problemId: problem.id,
        }),
      );
    };
    const remaining = Math.max(
      0,
      (row.deadlineAt.getTime() - Date.now()) / 60_000,
    );

    try {
      if (remaining <= 0 || !problem || !active) {
        finish();
      } else if (sd.phase === "DISCUSSION") {
        if (sd.probesAsked.length >= MAX_SD_PROBES) {
          issueChallenge();
        } else {
          const store = designGraphStore();
          const ctx = await gatherProbeContext({
            problem,
            submissionId: active.submissionId,
            revision: active.revision,
            store,
            askedProbeIds: sd.probesAsked,
          });
          const probe = selectProbe(ctx);
          // A small graph may exhaust its distinct probes before the limit.
          if (sd.probesAsked.includes(probe.probeId)) {
            issueChallenge();
          } else {
            sd.probesAsked.push(probe.probeId);
            sd.selectedProbeIds.push(probe.probeId);
            const question = await phraseProbeQuestion({
              llm: this.llm,
              interviewId,
              problem,
              probe,
              components: ctx.components,
              state,
            });
            push(question);
            events.push(
              domainEvent(interviewId, "system_design.probe", {
                probeId: probe.probeId,
                revision: probe.revision,
                reason: probe.reason,
              }),
            );
          }
        }
      } else if (sd.phase === "REVISION_REQUESTED") {
        if (sd.revisionSubmitted && active.revision >= 2) {
          sd.phase = "REVISION_REVIEW";
          const previous = await getReadySubmissionByRevision(interviewId, 1);
          const question = await phraseRevisionReview({
            llm: this.llm,
            interviewId,
            problem,
            previous: previous ? componentsFromSnapshot(previous.snapshot) : [],
            current: componentsFromSnapshot(active.snapshot),
            state,
          });
          push(question);
          events.push(
            domainEvent(interviewId, "system_design.revision_reviewed", {
              revision: active.revision,
            }),
          );
        } else {
          const decision = detectRevisionDecision(text);
          if (decision === "declined") {
            finish();
          } else
            push(
              nudgeQuestion(
                state,
                problem,
                sd.revisionSubmitted
                  ? "I see you submitted an update, but I couldn't load it yet. Resubmit so we can review it."
                  : "When you're ready, resubmit your updated design, or tell me if you'd prefer to keep your current design.",
              ),
            );
        }
      } else {
        finish();
      }
    } catch (err) {
      events.push(
        domainEvent(interviewId, "system_design.degraded", {
          error: String(err).slice(0, 200),
        }),
      );
      if (!state.ended)
        push(
          nudgeQuestion(
            state,
            problem ?? ({ id: sd.problemId, title: "your design" } as never),
            "Let's continue: what is the biggest risk in your design if a downstream dependency fails?",
          ),
        );
    }

    await this.save(interviewId, token, row.version, state, events, {
      id: turnId,
      status: "completed",
    });
    return this.response(state, state.processedTurns[turnId], row.deadlineAt);
  }

  async recoverAnalysis(interviewId: string, turnId: string): Promise<void> {
    await withInterviewLock(interviewId, async (token) => {
      const turn = await prisma.conversationTurn.findUnique({
        where: { id: turnId },
      });
      if (
        !turn ||
        turn.interviewId !== interviewId ||
        ["completed", "skipped"].includes(turn.analysisStatus)
      )
        return;
      const row = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId },
      });
      const state = stateSchema.parse(row.data);
      if (state.phase === "COMPLETED") return;
      const question = state.questions.find((q) => q.id === turn.questionId);
      const objective =
        question && state.objectives.find((o) => o.id === question.objectiveId);
      if (!question || !objective) throw new Error("Turn has no objective");
      const knowledge = await RepositoryKnowledge.load(interviewId);
      const analysis = await this.analyzer.analyze(
        interviewId,
        turn,
        question.text,
        objective,
        knowledge,
        true,
      );
      this.analyzer.apply(state, turnId, objective, analysis);
      await prisma.$transaction(async (tx) => {
        const updated = await tx.interviewRuntime.updateMany({
          where: { interviewId, version: row.version, leaseToken: token },
          data: {
            version: { increment: 1 },
            data: state as unknown as Prisma.InputJsonValue,
          },
        });
        if (!updated.count)
          throw new Error("State changed during analysis recovery");
        await tx.conversationTurn.update({
          where: { id: turnId },
          data: { analysisStatus: "completed", analysisError: null },
        });
        await tx.interviewEvent.create({
          data: domainEvent(interviewId, "analysis.recovered", { turnId }),
        });
      });
    });
  }
  async recoverAnalyses(interviewId: string): Promise<void> {
    const turns = await prisma.conversationTurn.findMany({
      where: {
        interviewId,
        role: "user",
        analysisStatus: { in: ["pending", "failed"] },
      },
      take: 40,
    });
    for (const turn of turns)
      await this.recoverAnalysis(interviewId, turn.id).catch(() => {});
  }
  async prepareEvaluation(interviewId: string): Promise<void> {
    const pending = await prisma.conversationTurn.findMany({
      where: {
        interviewId,
        role: "user",
        analysisStatus: { in: ["pending", "failed"] },
      },
      select: { id: true },
      take: 40,
    });
    for (const turn of pending)
      await enqueue(interviewId, "ANALYZE", `ANALYZE:${turn.id}`, {
        turnId: turn.id,
      });
    if (
      await prisma.interviewJob.count({
        where: {
          interviewId,
          kind: "ANALYZE",
          status: { in: ["pending", "running"] },
        },
      })
    )
      throw new JobDeferred("Waiting for answer analysis");
    const runtime = await prisma.interviewRuntime.findUniqueOrThrow({
      where: { interviewId },
    });
    const state = stateSchema.parse(runtime.data);
    const claims = state.claims.filter((c) => c.status === "UNVERIFIED");
    for (let i = 0; i < claims.length; i += 5) {
      const batch = claims.slice(i, i + 5).map((c) => c.id);
      await enqueue(
        interviewId,
        "VERIFY",
        `VERIFY:${interviewId}:${batch[0]}`,
        { claimIds: batch },
      );
    }
    if (
      await prisma.interviewJob.count({
        where: {
          interviewId,
          kind: "VERIFY",
          status: { in: ["pending", "running"] },
        },
      })
    )
      throw new JobDeferred("Waiting for claim verification");
  }
  async verifyClaims(interviewId: string, claimIds: string[]): Promise<void> {
    await withInterviewLock(interviewId, async (token) => {
      const row = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId },
      });
      const state = stateSchema.parse(row.data);
      if (state.phase === "COMPLETED") return;
      await this.analyzer.verify(
        interviewId,
        state,
        claimIds,
        await RepositoryKnowledge.load(interviewId),
      );
      await prisma.$transaction(async (tx) => {
        const saved = await tx.interviewRuntime.updateMany({
          where: { interviewId, leaseToken: token, version: row.version },
          data: {
            data: state as unknown as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        if (!saved.count)
          throw new Error("State changed during claim verification");
        await tx.interviewEvent.create({
          data: domainEvent(interviewId, "claims.verified", { claimIds }),
        });
      });
    });
  }
  async endInterview(interviewId: string, reason = "requested"): Promise<void> {
    await enqueue(interviewId, "END", `END:${interviewId}`, { reason });
    await emit(interviewId, "interview.end_requested", { reason });
  }
}
