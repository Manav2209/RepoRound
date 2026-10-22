import { afterAll, beforeAll, expect, test } from "bun:test";
import { prisma } from "@repo/db";
import { Prisma } from "@repo/db";
import { InterviewOrchestrator } from "../interview/orchestrator.js";
import { initialSystemDesignState, stateSchema } from "../interview/schemas.js";
import { objectivesForProblem } from "../interview/strategies/system-design.js";
import { getProblem } from "./problems.js";
import type { LlmClient } from "../llm/llm.client.js";
import { newId } from "../lib/ids.js";
import { createTestUser } from "../../test-fixtures/database.js";
import type {
  ArchitectureSnapshot,
  SubmitArchitectureRequest,
} from "@repo/voice-types";
import { SubmissionError, submitArchitecture } from "./submissions.js";
import {
  setDesignGraphStore,
  type ComponentFact,
  type DesignGraphStore,
  type EdgeFact,
  type IsolatedFact,
  type QueueWorkerFact,
  type UpstreamFact,
  type VerifyResult,
} from "./graph.js";

// Opt-in: these tests need a real Postgres. Point DATABASE_URL at a scratch DB
// (e.g. docker postgres on :5434) and set RUN_DB_TESTS=1 before `bun test`.
const enabled = process.env.RUN_DB_TESTS === "1";
const suite = test.skipIf(!enabled);

class FakeGraphStore implements DesignGraphStore {
  fail = false;
  readonly installs: string[] = [];
  private readonly snapshots = new Map<string, ArchitectureSnapshot>();

  async install(input: {
    submissionId: string;
    snapshot: ArchitectureSnapshot;
  }): Promise<void> {
    if (this.fail) throw new Error("simulated FalkorDB outage");
    this.installs.push(input.submissionId);
    this.snapshots.set(input.submissionId, input.snapshot);
  }

  async verify(input: {
    submissionId: string;
    expectedNodes: number;
    expectedEdges: number;
  }): Promise<VerifyResult> {
    const snapshot = this.snapshots.get(input.submissionId);
    return {
      nodeCount: snapshot?.nodes.length ?? input.expectedNodes,
      edgeCount: snapshot?.edges.length ?? input.expectedEdges,
      crossSubmissionEdges: 0,
    };
  }

  async components(): Promise<ComponentFact[]> {
    return [];
  }
  async upstreamPaths(): Promise<UpstreamFact[]> {
    return [];
  }
  async queueWorkerPairs(): Promise<QueueWorkerFact[]> {
    return [];
  }
  async edges(): Promise<EdgeFact[]> {
    return [];
  }
  async isolatedComponents(): Promise<IsolatedFact[]> {
    return [];
  }
  async removeSubmission(): Promise<void> {}
  async ping(): Promise<boolean> {
    return !this.fail;
  }
  async close(): Promise<void> {}
}

const store = new FakeGraphStore();
const createdInterviewIds: string[] = [];
const createdUserIds: string[] = [];

function snapshot(label = "API"): ArchitectureSnapshot {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "client",
        position: { x: 0, y: 0 },
        data: { componentType: "client", label: "Web" },
      },
      {
        id: "api",
        position: { x: 200, y: 0 },
        data: { componentType: "api_service", label },
      },
    ],
    edges: [{ id: "e1", source: "client", target: "api" }],
  };
}

function request(
  requestId: string,
  expectedRevision: number,
  snap: ArchitectureSnapshot = snapshot(),
): SubmitArchitectureRequest {
  return { requestId, expectedRevision, snapshot: snap };
}

async function newInterview(mode: "GITHUB" | "SYSTEM_DESIGN"): Promise<string> {
  const userId = await createTestUser();
  createdUserIds.push(userId);
  const interview = await prisma.interview.create({
    data: {
      mode,
      userId,
      systemDesignProblemId:
        mode === "SYSTEM_DESIGN" ? "notification-system" : null,
      githubUrl: mode === "GITHUB" ? "https://github.com/example/repo" : null,
      owner: mode === "GITHUB" ? "example" : null,
      name: mode === "GITHUB" ? "repo" : null,
    },
  });
  createdInterviewIds.push(interview.id);
  return interview.id;
}

beforeAll(async () => {
  if (!enabled) return;
  setDesignGraphStore(store);
});

afterAll(async () => {
  if (!enabled) return;
    await prisma.interview.deleteMany({
      where: { id: { in: createdInterviewIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    setDesignGraphStore(null);
  await prisma.$disconnect();
});

suite("mode branching", async () => {
  const interviewId = await newInterview("GITHUB");
  let status = 0;
  try {
    await submitArchitecture({
      interviewId,
      request: request(crypto.randomUUID(), 0),
    });
  } catch (err) {
    status = err instanceof SubmissionError ? err.status : -1;
  }
  expect(status).toBe(409);
});

suite(
  "a minimal design reaches its challenge after exhausting distinct probes",
  async () => {
    const interviewId = await newInterview("SYSTEM_DESIGN");
    const problem = getProblem("url-shortener")!;
    const submission = await submitArchitecture({
      interviewId,
      request: request(crypto.randomUUID(), 0),
    });
    const state = initialSystemDesignState({
      problemId: problem.id,
      activeRevision: 1,
      activeSubmissionId: submission.submissionId,
      objectives: objectivesForProblem(problem),
    });
    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: "active", systemDesignProblemId: problem.id },
    });
    await prisma.interviewRuntime.create({
      data: {
        interviewId,
        data: state as unknown as Prisma.InputJsonValue,
        deadlineAt: new Date(Date.now() + 600000),
      },
    });
    const session = await prisma.interviewSession.create({
      data: {
        interviewId,
        roomName: `test-${interviewId}`,
        serverUrl: "ws://localhost:7880",
        status: "active",
      },
    });
    const llm = {
      async completeJson() {
        return { question: "How does your design handle a traffic spike?" };
      },
    } as unknown as LlmClient;
    const orchestrator = new InterviewOrchestrator(llm);
    let response = await orchestrator.start(interviewId, session.id);
    for (let index = 0; index < 3; index++) {
      if (response.ended)
        throw new Error("Interview ended before its challenge");
      response = await orchestrator.processTurn({
        interviewId,
        sessionId: session.id,
        turnId: newId("test-turn"),
        questionId: response.questionId,
        text: "The API accepts the request and stores its result.",
      });
      const runtime = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId },
      });
      const current = stateSchema.parse(runtime.data);
      if (current.systemDesign?.challengeIssued) break;
    }
    const runtime = await prisma.interviewRuntime.findUniqueOrThrow({
      where: { interviewId },
    });
    const current = stateSchema.parse(runtime.data);
    expect(current.systemDesign?.phase).toBe("REVISION_REQUESTED");
    expect(current.systemDesign?.challengeIssued).toBe(true);
    expect(current.questions.at(-1)?.text).toContain(problem.challenge.prompt);
    expect(current.systemDesign?.selectedProbeIds).toEqual([
      "generic.scaling-fallback",
    ]);
  },
);

suite("submission idempotency", async () => {
  const interviewId = await newInterview("SYSTEM_DESIGN");
  const requestId = crypto.randomUUID();

  const first = await submitArchitecture({
    interviewId,
    request: request(requestId, 0),
  });
  expect(first.revision).toBe(1);
  expect(first.graphStatus).toBe("READY");
  expect(first.replayed).toBe(false);

  const replay = await submitArchitecture({
    interviewId,
    request: request(requestId, 0),
  });
  expect(replay.replayed).toBe(true);
  expect(replay.submissionId).toBe(first.submissionId);

  const rows = await prisma.systemDesignSubmission.count({
    where: { interviewId },
  });
  expect(rows).toBe(1);

  let status = 0;
  try {
    await submitArchitecture({
      interviewId,
      request: request(requestId, 0, snapshot("Changed label")),
    });
  } catch (err) {
    status = err instanceof SubmissionError ? err.status : -1;
  }
  expect(status).toBe(409);
});

suite(
  "concurrent revision-1 submissions create only one revision",
  async () => {
    const interviewId = await newInterview("SYSTEM_DESIGN");
    const results = await Promise.allSettled([
      submitArchitecture({
        interviewId,
        request: request(crypto.randomUUID(), 0),
      }),
      submitArchitecture({
        interviewId,
        request: request(crypto.randomUUID(), 0),
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const rows = await prisma.systemDesignSubmission.findMany({
      where: { interviewId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revision).toBe(1);
    expect(rows[0]!.graphStatus).toBe("READY");
  },
);

suite(
  "graph outage fails the submission and the same request can recover",
  async () => {
    const interviewId = await newInterview("SYSTEM_DESIGN");
    const requestId = crypto.randomUUID();
    const before = store.installs.length;

    store.fail = true;
    let status = 0;
    try {
      await submitArchitecture({ interviewId, request: request(requestId, 0) });
    } catch (err) {
      status = err instanceof SubmissionError ? err.status : -1;
    }
    store.fail = false;
    expect(status).toBe(503);

    const failed = await prisma.systemDesignSubmission.findFirst({
      where: { interviewId },
    });
    expect(failed?.graphStatus).toBe("FAILED");

    const recovered = await submitArchitecture({
      interviewId,
      request: request(requestId, 0),
    });
    expect(recovered.graphStatus).toBe("READY");
    expect(recovered.revision).toBe(1);
    expect(store.installs.length).toBe(before + 1);
  },
);

suite("revision 2 is gated on the interviewer requesting one", async () => {
  const interviewId = await newInterview("SYSTEM_DESIGN");
  const first = await submitArchitecture({
    interviewId,
    request: request(crypto.randomUUID(), 0),
  });

  const baseState = {
    mode: "SYSTEM_DESIGN" as const,
    phase: "ARCHITECTURE" as const,
    difficulty: "MEDIUM" as const,
    objectives: [],
    claims: [],
    evidence: [],
    questions: [],
    processedTurns: {},
    ended: false,
    systemDesign: {
      problemId: "notification-system",
      phase: "DISCUSSION" as const,
      activeRevision: 1,
      activeSubmissionId: first.submissionId,
      challengeIssued: true,
      revisionSubmitted: false,
      probesAsked: [],
      selectedProbeIds: [],
    },
  };
  await prisma.interviewRuntime.create({
    data: {
      interviewId,
      data: baseState,
      deadlineAt: new Date(Date.now() + 3_600_000),
    },
  });

  let denied = 0;
  try {
    await submitArchitecture({
      interviewId,
      request: request(crypto.randomUUID(), 1, snapshot("Revised")),
    });
  } catch (err) {
    denied = err instanceof SubmissionError ? err.status : -1;
  }
  expect(denied).toBe(409);

  await prisma.interviewRuntime.update({
    where: { interviewId },
    data: {
      data: {
        ...baseState,
        systemDesign: {
          ...baseState.systemDesign,
          phase: "REVISION_REQUESTED",
        },
      },
    },
  });

  const revised = await submitArchitecture({
    interviewId,
    request: request(crypto.randomUUID(), 1, snapshot("Revised")),
  });
  expect(revised.revision).toBe(2);
  expect(revised.graphStatus).toBe("READY");

  const runtime = await prisma.interviewRuntime.findUniqueOrThrow({
    where: { interviewId },
  });
  const stored = runtime.data as typeof baseState;
  expect(stored.systemDesign.revisionSubmitted).toBe(true);
  expect(stored.systemDesign.activeRevision).toBe(2);

  let secondRevision = 0;
  try {
    await submitArchitecture({
      interviewId,
      request: request(crypto.randomUUID(), 1, snapshot("Revised again")),
    });
  } catch (err) {
    secondRevision = err instanceof SubmissionError ? err.status : -1;
  }
  expect(secondRevision).toBe(409);

  const rows = await prisma.systemDesignSubmission.findMany({
    where: { interviewId },
    orderBy: { revision: "asc" },
  });
  expect(rows.map((r) => r.revision)).toEqual([1, 2]);
});

suite(
  "publication contention keeps revision 2 inactive and a replay recovers it",
  async () => {
    const interviewId = await newInterview("SYSTEM_DESIGN");
    const first = await submitArchitecture({
      interviewId,
      request: request(crypto.randomUUID(), 0),
    });
    const initial = initialSystemDesignState({
      problemId: "notification-system",
      activeRevision: 1,
      activeSubmissionId: first.submissionId,
      objectives: [],
    });
    initial.systemDesign!.phase = "REVISION_REQUESTED";
    initial.systemDesign!.challengeIssued = true;
    await prisma.interviewRuntime.create({
      data: {
        interviewId,
        data: initial as unknown as Prisma.InputJsonValue,
        deadlineAt: new Date(Date.now() + 600000),
        leaseToken: "test-busy-lease",
        leaseUntil: new Date(Date.now() + 60000),
      },
    });
    const revision = request(crypto.randomUUID(), 1, snapshot("Revised"));
    await expect(
      submitArchitecture({ interviewId, request: revision }),
    ).rejects.toMatchObject({ status: 503 });
    const failed = await prisma.systemDesignSubmission.findUniqueOrThrow({
      where: { requestId: revision.requestId },
    });
    expect(failed.graphStatus).toBe("FAILED");
    const before = await prisma.interviewRuntime.findUniqueOrThrow({
      where: { interviewId },
    });
    expect(stateSchema.parse(before.data).systemDesign!.activeRevision).toBe(1);
    await prisma.interviewRuntime.update({
      where: { interviewId },
      data: { leaseToken: null, leaseUntil: null },
    });
    const recovered = await submitArchitecture({
      interviewId,
      request: revision,
    });
    expect(recovered.graphStatus).toBe("READY");
    const after = await prisma.interviewRuntime.findUniqueOrThrow({
      where: { interviewId },
    });
    const current = stateSchema.parse(after.data).systemDesign!;
    expect(current.activeSubmissionId).toBe(recovered.submissionId);
    expect(current.revisionSubmitted).toBe(true);
  },
);
