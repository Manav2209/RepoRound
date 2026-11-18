import { expect, spyOn, test } from "bun:test";
import { prisma } from "@repo/db";
import { createTestUser } from "../../test-fixtures/database.js";
import { activeSessions } from "./active-sessions.js";
import { initialState, stateSchema } from "./schemas.js";
import { InterviewOrchestrator } from "./orchestrator.js";
import { recordGithubQuestion } from "./github-policy.js";
import { RealtimeEventService } from "../realtime/events.js";
import { EvaluationService } from "../evaluation/evaluation.service.js";
import { snapshotInterviewMetrics } from "../observability/metrics.js";
import type { LlmClient } from "../llm/llm.client.js";
import { createInternalRouter } from "../api/internal.js";
import type { BackendConfig } from "../config.js";

const suite = test.skipIf(process.env.RUN_DB_TESTS !== "1");
async function fixture() {
  const userId = await createTestUser();
  const interviewId = `hot_${crypto.randomUUID()}`;
  const sessionId = `session_${crypto.randomUUID()}`;
  const state = initialState(
    [
      {
        id: "flow",
        kind: "OPENING",
        phase: "PROJECT_OVERVIEW",
        topic: "Request durability",
        description: "Trace an accepted request",
        targetEvidence: ["Explains the acceptance boundary"],
        priority: "HIGH",
        status: "IN_PROGRESS",
        attempts: 0,
        evidenceIds: [],
        sources: [{ path: "src/jobs.ts" }],
      },
      {
        id: "storage",
        kind: "REPOSITORY",
        phase: "ARCHITECTURE",
        topic: "Storage",
        description: "Explain durable storage",
        targetEvidence: ["Explains persistence"],
        priority: "HIGH",
        status: "NOT_STARTED",
        attempts: 0,
        evidenceIds: [],
        sources: [{ path: "src/jobs.ts" }],
      },
    ],
    "mid",
  );
  const objective = state.objectives[0]!;
  state.questions.push({
    id: "q0",
    objectiveId: objective.id,
    kind: "OPENING",
    text: "Trace one accepted request through the API and worker.",
    phase: objective.phase,
    difficulty: "MEDIUM",
    reason: "NEW_TOPIC",
    askedAt: new Date().toISOString(),
  });
  recordGithubQuestion(state, objective, false);
  await prisma.interview.create({
    data: {
      id: interviewId,
      userId,
      mode: "GITHUB",
      status: "active",
      owner: "fixture",
      name: "fixture",
      startedAt: new Date(),
    },
  });
  await prisma.interviewRuntime.create({
    data: {
      interviewId,
      data: state as never,
      deadlineAt: new Date(Date.now() + 900_000),
    },
  });
  await prisma.interviewSession.create({
    data: {
      id: sessionId,
      interviewId,
      roomName: sessionId,
      serverUrl: "ws://fixture.invalid",
      status: "active",
    },
  });
  await prisma.repositoryKnowledge.create({
    data: {
      interviewId,
      commitSha: "a".repeat(40),
      files: [
        {
          path: "src/jobs.ts",
          content: "export const accept = job => durableQueue.add(job);",
        },
      ],
      symbols: [],
      facts: { projectSummary: "An API that accepts durable jobs." },
    },
  });
  const memory = await activeSessions.activate(interviewId, sessionId);
  const output = {
    assessment: {
      summary: "The answer needs a concrete acceptance boundary.",
      claims: [],
      evidence: [],
      objectiveSatisfied: false,
      answeredQuestion: false,
      explainedResponsibilities: false,
      identifiedTradeoffOrFailure: false,
      consistentWithEvidence: true,
      uncertainty: [],
      suggestedFollowUps: [],
      toolRequests: [],
    },
    nextQuestion: {
      objectiveId: objective.id,
      question:
        "What must be persisted before your API confirms that a job was accepted?",
      referenceIndexes: [0],
    },
  };
  let calls = 0;
  const llm = {
    completeJson: async () => {
      calls++;
      return structuredClone(output);
    },
  } as unknown as LlmClient;
  const orchestrator = new InterviewOrchestrator(llm, 30, 15, "current", {
    activeStorage: "memory",
    githubTurnMode: "combined",
  });
  const input = {
    interviewId,
    sessionId,
    turnId: `turn_${crypto.randomUUID()}`,
    questionId: "q0",
    text: "The API accepts jobs and gives them to a worker.",
  };
  return {
    userId,
    interviewId,
    sessionId,
    memory,
    output,
    llm,
    orchestrator,
    input,
    calls: () => calls,
    dispose: async () => {
      activeSessions.evict(interviewId);
      await prisma.user.delete({ where: { id: userId } });
    },
  };
}

suite(
  "hot repository turns make one model call with no database reads or writes, and replay without another model call",
  async () => {
    const f = await fixture();
    const queries: string[] = [];
    let observing = true;
    prisma.$on(
      "query" as never,
      ((event: { query: string }) => {
        if (observing) queries.push(event.query);
      }) as never,
    );
    try {
      await prisma.$queryRaw`SELECT 1`;
      expect(queries.length).toBeGreaterThan(0);
      queries.length = 0;
      const next = await f.orchestrator.processTurn(f.input);
      expect(next.ended).toBe(false);
      if (next.ended) throw new Error("Missing next question");
      expect(next.question).toBe(f.output.nextQuestion.question);
      expect(f.calls()).toBe(1);
      expect(await f.orchestrator.processTurn(f.input)).toEqual(next);
      expect(f.calls()).toBe(1);
      expect(queries).toEqual([]);
    } finally {
      observing = false;
      await f.dispose();
    }
  },
);

suite(
  "worker HTTP turn, heartbeat, telemetry and polling stay in memory and enforce session ownership",
  async () => {
    const f = await fixture();
    const config = {
      INTERNAL_API_TOKEN: "synthetic-internal-token",
    } as BackendConfig;
    const app = createInternalRouter(
      config,
      new RealtimeEventService(),
      f.orchestrator,
      new EvaluationService(f.llm),
    );
    const queries: string[] = [];
    let observing = true;
    prisma.$on(
      "query" as never,
      ((event: { query: string }) => {
        if (observing) queries.push(event.query);
      }) as never,
    );
    const request = (path: string, body?: unknown) =>
      app.request(path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${config.INTERNAL_API_TOKEN}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      await prisma.$queryRaw`SELECT 1`;
      expect(queries.length).toBeGreaterThan(0);
      queries.length = 0;
      expect(
        (await request(`/interviews/${f.interviewId}/turns`, f.input)).status,
      ).toBe(200);
      for (const type of ["session.heartbeat", "voice.metrics"]) {
        expect(
          (
            await request("/realtime/events", {
              eventId: crypto.randomUUID(),
              interviewId: f.interviewId,
              sessionId: f.sessionId,
              timestamp: new Date().toISOString(),
              type,
              payload:
                type === "voice.metrics"
                  ? { source: "backend_roundtrip", durationMs: 10 }
                  : {},
            })
          ).status,
        ).toBe(200);
      }
      expect(
        (
          await request(
            `/interviews/${f.interviewId}/pending?sessionId=${f.sessionId}`,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            `/interviews/${f.interviewId}/status?sessionId=${f.sessionId}`,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            `/interviews/${f.interviewId}/status?sessionId=another-session`,
          )
        ).status,
      ).toBe(410);
      expect(
        (
          await app.request(
            `/interviews/${f.interviewId}/status?sessionId=${f.sessionId}`,
          )
        ).status,
      ).toBe(401);
      expect(f.calls()).toBe(1);
      expect(queries).toEqual([]);
    } finally {
      observing = false;
      await f.dispose();
    }
  },
);

suite(
  "decision interviews keep a grounded prepared follow-up when a live proposal targets the wrong objective, with one call and zero SQL",
  async () => {
    const f = await fixture();
    const ref = f.memory.knowledge.getFile("src/jobs.ts")!.reference;
    const current = f.memory.state.objectives[0]!;
    const followUp =
      "What tradeoff does accepting generation jobs asynchronously introduce for a user waiting for the result?";
    current.decision = {
      question:
        "What made asynchronous processing a suitable fit for generation jobs in this application?",
      followUps: [followUp],
      observedBehavior: "The API enqueues work.",
      assessmentFocus:
        "Explains the constraint behind asynchronous generation.",
      references: [ref],
    };
    f.output.nextQuestion.objectiveId = "unavailable-objective";
    const queries: string[] = [];
    let observing = true;
    prisma.$on(
      "query" as never,
      ((event: { query: string }) => {
        if (observing) queries.push(event.query);
      }) as never,
    );
    try {
      await prisma.$queryRaw`SELECT 1`;
      expect(queries.length).toBeGreaterThan(0);
      queries.length = 0;
      const response = await f.orchestrator.processTurn(f.input);
      if (response.ended) throw new Error("Expected grounded follow-up");
      expect(response.question).toBe(followUp);
      expect(f.calls()).toBe(1);
      expect(queries).toEqual([]);
      expect(await f.orchestrator.processTurn(f.input)).toEqual(response);
      expect(f.calls()).toBe(1);
    } finally {
      observing = false;
      await f.dispose();
    }
  },
);

suite(
  "memory transcript, telemetry and final state flush idempotently before evaluation is queued",
  async () => {
    const f = await fixture();
    try {
      const next = await f.orchestrator.processTurn(f.input);
      if (next.ended) throw new Error("Missing question");
      const events = new RealtimeEventService();
      const event = {
        eventId: crypto.randomUUID(),
        interviewId: f.interviewId,
        sessionId: f.sessionId,
        type: "transcript.completed",
        timestamp: new Date().toISOString(),
        payload: {
          role: "assistant",
          turnId: "spoken1",
          questionId: next.questionId,
          text: next.question,
        },
      };
      expect(await events.process(event)).toMatchObject({
        outcome: "created",
        turnCreated: true,
      });
      expect(await events.process(event)).toMatchObject({
        outcome: "duplicate",
      });
      expect(
        await prisma.conversationTurn.count({
          where: { interviewId: f.interviewId },
        }),
      ).toBe(0);
      expect(
        (await snapshotInterviewMetrics(f.interviewId))!.coverage.eventsRead,
      ).toBeGreaterThan(0);
      const service = new EvaluationService(f.llm);
      expect(await service.finalize(f.interviewId)).toEqual({
        status: "pending",
      });
      expect(f.memory.persisted).toBe(true);
      expect(
        await prisma.conversationTurn.count({
          where: { interviewId: f.interviewId },
        }),
      ).toBe(2);
      const saved = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId: f.interviewId },
      });
      expect(stateSchema.parse(saved.data)).toMatchObject({
        ended: true,
        activeFlushed: true,
        phase: "FINAL",
      });
      expect(
        (
          await prisma.interviewMemoryProjection.findUniqueOrThrow({
            where: { interviewId: f.interviewId },
          })
        ).version,
      ).toBe(saved.version);
      const count = await prisma.interviewEvent.count({
        where: { interviewId: f.interviewId },
      });
      await service.finalize(f.interviewId);
      expect(
        await prisma.interviewEvent.count({
          where: { interviewId: f.interviewId },
        }),
      ).toBe(count);
      expect(
        await prisma.interviewJob.count({
          where: { interviewId: f.interviewId, kind: "END" },
        }),
      ).toBe(1);
    } finally {
      await f.dispose();
    }
  },
);

suite(
  "a cancelled late model result cannot advance state; a generated but unspoken question can be rolled back",
  async () => {
    const f = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const model = spyOn(f.llm, "completeJson").mockImplementation((async () => {
      entered();
      await held;
      return f.output;
    }) as LlmClient["completeJson"]);
    try {
      const request = f.orchestrator.processTurn(f.input);
      await started;
      activeSessions.cancel(f.interviewId, f.input.turnId);
      release();
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(f.memory.state.questions).toHaveLength(1);
      model.mockRestore();
      const second = { ...f.input, turnId: `second_${crypto.randomUUID()}` };
      await f.orchestrator.processTurn(second);
      expect(f.memory.state.questions).toHaveLength(2);
      activeSessions.cancel(f.interviewId, second.turnId);
      expect(f.memory.state.questions).toHaveLength(1);
      expect(
        f.memory.turns.filter((turn) => turn.role === "user"),
      ).toHaveLength(2);
    } finally {
      release();
      model.mockRestore();
      await f.dispose();
    }
  },
);

suite(
  "lost memory requires a fresh interview, and invalid model proposals use a grounded fallback without a second request",
  async () => {
    const f = await fixture();
    try {
      f.output.nextQuestion.objectiveId = "invented-objective";
      const result = await f.orchestrator.processTurn(f.input);
      expect(f.calls()).toBe(1);
      expect(result.ended).toBe(false);
      if (!result.ended)
        expect(result.question).not.toBe(f.output.nextQuestion.question);
      activeSessions.evict(f.interviewId);
      await expect(
        f.orchestrator.processTurn({ ...f.input, turnId: "after_restart" }),
      ).rejects.toThrow("memory was lost");
      expect(f.calls()).toBe(1);
    } finally {
      await f.dispose();
    }
  },
);

suite(
  "concurrent finalized fragments keep the transcript but only the newest request can advance state",
  async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let modelCalls = 0;
    const model = spyOn(f.llm, "completeJson").mockImplementation((async () => {
      if (++modelCalls === 1) {
        entered();
        await gate;
      }
      return f.output;
    }) as LlmClient["completeJson"]);
    try {
      const first = f.orchestrator.processTurn(f.input);
      await started;
      const second = f.orchestrator.processTurn({
        ...f.input,
        turnId: "fragment2",
        text: "The next fragment.",
      });
      const third = f.orchestrator.processTurn({
        ...f.input,
        turnId: "fragment3",
        text: "The complete continuation.",
      });
      release();
      const results = await Promise.allSettled([first, second, third]);
      expect(results.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
        "fulfilled",
      ]);
      expect(modelCalls).toBe(2);
      expect(f.memory.state.questions).toHaveLength(2);
      expect(f.memory.state.questions.at(-2)?.answerTurnId).toBe("fragment3");
      expect(
        f.memory.turns.filter((turn) => turn.role === "user"),
      ).toHaveLength(3);
    } finally {
      release();
      model.mockRestore();
      await f.dispose();
    }
  },
);

suite(
  "completion commit failure rolls back and retains the session for a successful retry",
  async () => {
    const f = await fixture();
    try {
      await f.orchestrator.processTurn(f.input);
      f.memory.turns[0]!.sessionId = "missing-session";
      await expect(activeSessions.flush(f.interviewId)).rejects.toThrow();
      expect(f.memory.persisted).toBe(false);
      expect(f.memory.turns).toHaveLength(1);
      expect(
        await prisma.conversationTurn.count({
          where: { interviewId: f.interviewId },
        }),
      ).toBe(0);
      expect(
        stateSchema.parse(
          (
            await prisma.interviewRuntime.findUniqueOrThrow({
              where: { interviewId: f.interviewId },
            })
          ).data,
        ).ended,
      ).toBe(false);
      f.memory.turns[0]!.sessionId = f.sessionId;
      await activeSessions.flush(f.interviewId);
      expect(f.memory.persisted).toBe(true);
      expect(
        await prisma.conversationTurn.count({
          where: { interviewId: f.interviewId },
        }),
      ).toBe(1);
    } finally {
      await f.dispose();
    }
  },
);
