import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import { createTestUser } from "../../test-fixtures/database.js";
import { InterviewOrchestrator } from "./orchestrator.js";
import {
  initialState,
  initialSystemDesignState,
  stateSchema,
} from "./schemas.js";
import type { LlmClient } from "../llm/llm.client.js";
import type { InterviewState, QuestionRecord } from "./interview.types.js";
import { checkpointPrompt } from "./strategies/system-design.js";

const suite = test.skipIf(process.env.RUN_DB_TESTS !== "1");
const question: QuestionRecord = {
  id: "q1",
  text: "How does a notification travel from the API to the worker?",
  objectiveId: "flow",
  phase: "ARCHITECTURE",
  difficulty: "MEDIUM",
  reason: "NEW_TOPIC",
  askedAt: new Date().toISOString(),
  revision: 1,
  concern: "FLOW",
};

async function fixture(state: InterviewState) {
  const userId = await createTestUser();
  const interviewId = `repeat_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;
  await prisma.interview.create({
    data: {
      id: interviewId,
      userId,
      mode: state.mode,
      status: "active",
      systemDesignProblemId: state.systemDesign?.problemId,
    },
  });
  await prisma.interviewRuntime.create({
    data: {
      interviewId,
      data: state as never,
      deadlineAt: new Date(Date.now() + 600_000),
    },
  });
  await prisma.interviewSession.create({
    data: {
      id: sessionId,
      interviewId,
      roomName: sessionId,
      serverUrl: "http://localhost",
      status: "active",
    },
  });
  return { userId, interviewId, sessionId };
}

suite(
  "repository repeat requests are idempotent and never become scored answers",
  async () => {
    const state = initialState(
      [
        {
          id: "flow",
          phase: "ARCHITECTURE",
          topic: "Notification flow",
          description: "Trace the flow",
          targetEvidence: ["Explains delivery"],
          priority: "HIGH",
          status: "NOT_STARTED",
          attempts: 0,
          evidenceIds: [],
        },
      ],
      "mid",
    );
    state.questions.push(question);
    const { userId, interviewId, sessionId } = await fixture(state);
    const orchestrator = new InterviewOrchestrator({
      completeJson: () => {
        throw new Error("Repeat must not call a model");
      },
    } as unknown as LlmClient);
    try {
      const input = {
        interviewId,
        sessionId,
        turnId: "repeat_1",
        questionId: "q1",
        text: "Can you repeat the question?",
      };
      const response = await orchestrator.processTurn(input);
      expect(response).toMatchObject({
        ended: false,
        questionId: "q1",
        question: question.text,
      });
      expect(await orchestrator.processTurn(input)).toEqual(response);
      expect(
        await prisma.conversationTurn.count({ where: { interviewId } }),
      ).toBe(0);
      const saved = stateSchema.parse(
        (
          await prisma.interviewRuntime.findUniqueOrThrow({
            where: { interviewId },
          })
        ).data,
      );
      expect(saved.questions).toHaveLength(1);
      expect(saved.evidence).toEqual([]);
      expect(saved.objectives.map((objective) => objective.attempts)).toEqual(
        state.objectives.map((objective) => objective.attempts),
      );
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  },
);

suite(
  "repeating from a diagram checkpoint replays the substantive question and accepts its answer",
  async () => {
    const state = initialSystemDesignState({
      problemId: "notification-system",
      activeRevision: 1,
      objectives: [],
    });
    state.systemDesign!.phase = "CHECKPOINT";
    state.questions.push(question);
    state.systemDesign!.questionsAsked = 1;
    const checkpoint = checkpointPrompt(state, {});
    state.questions.push(checkpoint);
    state.systemDesign!.pendingQuestionId = checkpoint.id;
    state.systemDesign!.checkpoint = {
      id: "cp1",
      questionId: checkpoint.id,
      questionRevision: 1,
      status: "AWAITING_CHOICE",
      openedAt: new Date().toISOString(),
      afterFailure: false,
    };
    state.systemDesign!.checkpoints.push(state.systemDesign!.checkpoint);
    const { userId, interviewId, sessionId } = await fixture(state);
    let calls = 0;
    let assessedQuestion = "";
    const llm = {
      completeJson: async (messages: Array<{ content: string }>) => {
        calls++;
        assessedQuestion = JSON.parse(messages[1]!.content).question;
        return {
          addressedQuestion: true,
          consistentWithDiagram: true,
          strength: "MODERATE",
          concern: "FLOW",
          claimedGuaranteeOrTradeoff:
            "The API persists the job before publishing it",
        };
      },
    } as unknown as LlmClient;
    const orchestrator = new InterviewOrchestrator(llm);
    try {
      await prisma.systemDesignSubmission.create({
        data: {
          id: `sub_${randomUUID()}`,
          interviewId,
          revision: 1,
          requestId: randomUUID(),
          snapshotHash: "test",
          graphStatus: "READY",
          snapshot: {
            schemaVersion: 1,
            nodes: [
              {
                id: "api",
                position: { x: 0, y: 0 },
                data: { componentType: "api_service", label: "API" },
              },
              {
                id: "worker",
                position: { x: 100, y: 0 },
                data: { componentType: "worker", label: "Worker" },
              },
            ],
            edges: [{ id: "route", source: "api", target: "worker" }],
          },
        },
      });
      for (const turnId of ["repeat_1", "repeat_2"]) {
        const response = await orchestrator.processTurn({
          interviewId,
          sessionId,
          turnId,
          questionId: checkpoint.id,
          text: "Sorry. Can you repeat the question?",
        });
        expect(response).toMatchObject({
          questionId: "q1",
          question: question.text,
          ended: false,
        });
      }
      expect(calls).toBe(0);
      expect(
        await prisma.conversationTurn.count({ where: { interviewId } }),
      ).toBe(0);
      expect(await orchestrator.start(interviewId, sessionId)).toMatchObject({
        questionId: "q1",
        question: question.text,
        ended: false,
      });
      const repeated = stateSchema.parse(
        (
          await prisma.interviewRuntime.findUniqueOrThrow({
            where: { interviewId },
          })
        ).data,
      );
      expect(repeated.questions).toHaveLength(2);
      expect(repeated.systemDesign).toMatchObject({
        questionsAsked: 1,
        phase: "CHECKPOINT",
        answerAssessments: [],
        checkpoint: { status: "AWAITING_CHOICE" },
      });
      const next = await orchestrator.processTurn({
        interviewId,
        sessionId,
        turnId: "actual_answer",
        questionId: "q1",
        text: "The API persists a notification job before publishing it to the queue, and a worker delivers it.",
      });
      expect(next.ended).toBe(false);
      expect(calls).toBe(1);
      expect(assessedQuestion).toBe(question.text);
      const answered = stateSchema.parse(
        (
          await prisma.interviewRuntime.findUniqueOrThrow({
            where: { interviewId },
          })
        ).data,
      );
      expect(answered.repeatedQuestionId).toBeUndefined();
      expect(answered.systemDesign?.questionsAsked).toBe(1);
      expect(answered.systemDesign?.answerAssessments).toHaveLength(1);
      expect(
        await prisma.conversationTurn.count({ where: { interviewId } }),
      ).toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  },
);
