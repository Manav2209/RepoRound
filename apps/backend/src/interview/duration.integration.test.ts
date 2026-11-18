import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import { createTestUser } from "../../test-fixtures/database.js";
import { InterviewService } from "./interview.service.js";
import { SessionService } from "../realtime/session.service.js";
import { LiveKitService } from "../realtime/livekit.service.js";
import { initialState, stateSchema } from "./schemas.js";
import type { LlmClient } from "../llm/llm.client.js";

const suite = test.skipIf(process.env.RUN_DB_TESTS !== "1");
const livekit = {
  LIVEKIT_URL: "wss://voice.example.test",
  LIVEKIT_API_KEY: "test-key",
  LIVEKIT_API_SECRET: "test-secret",
};

suite(
  "new system design rounds receive 30 minutes and three core questions",
  async () => {
    const userId = await createTestUser();
    try {
      const before = Date.now();
      const created = await new InterviewService(
        {} as LlmClient,
      ).createSystemDesign("url-shortener", userId);
      const after = Date.now();
      const runtime = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId: created.id },
      });
      expect(runtime.deadlineAt.getTime()).toBeGreaterThanOrEqual(
        before + 30 * 60_000,
      );
      expect(runtime.deadlineAt.getTime()).toBeLessThanOrEqual(
        after + 30 * 60_000,
      );
      expect(stateSchema.parse(runtime.data).systemDesign?.questionTarget).toBe(
        3,
      );
      expect(
        await prisma.interviewMetrics.findUnique({
          where: { interviewId: created.id },
        }),
      ).toMatchObject({
        userId,
        mode: "SYSTEM_DESIGN",
        problemId: "url-shortener",
        status: "created",
      });
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  },
);

suite(
  "starting an existing system design runtime preserves its saved deadline",
  async () => {
    const userId = await createTestUser();
    const dispatch = spyOn(
      LiveKitService.prototype,
      "createSession",
    ).mockResolvedValue({
      roomName: "test-room",
      serverUrl: "https://voice.example.test",
      candidateToken: "test-token",
      dispatchId: "test-dispatch",
    });
    try {
      const created = await new InterviewService(
        {} as LlmClient,
      ).createSystemDesign("url-shortener", userId);
      const savedDeadline = new Date(Date.now() + 7 * 60_000);
      await prisma.interview.update({
        where: { id: created.id },
        data: { status: "ready" },
      });
      await prisma.interviewRuntime.update({
        where: { interviewId: created.id },
        data: { deadlineAt: savedDeadline },
      });
      await prisma.systemDesignSubmission.create({
        data: {
          id: `duration_${randomUUID()}`,
          interviewId: created.id,
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
                id: "db",
                position: { x: 100, y: 0 },
                data: { componentType: "database", label: "Database" },
              },
            ],
            edges: [{ id: "flow", source: "api", target: "db" }],
          },
        },
      });
      await new SessionService({
        ...livekit,
        SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES: 30,
      }).startForInterview(created.id);
      expect(
        (
          await prisma.interviewRuntime.findUniqueOrThrow({
            where: { interviewId: created.id },
          })
        ).deadlineAt,
      ).toEqual(savedDeadline);
      expect(
        await prisma.interviewMetrics.findUnique({
          where: { interviewId: created.id },
        }),
      ).toMatchObject({ status: "active", mode: "SYSTEM_DESIGN" });
    } finally {
      dispatch.mockRestore();
      await prisma.user.delete({ where: { id: userId } });
    }
  },
);

suite(
  "repository session allocation still defaults to 15 minutes",
  async () => {
    const userId = await createTestUser();
    const dispatch = spyOn(
      LiveKitService.prototype,
      "createSession",
    ).mockResolvedValue({
      roomName: "test-room",
      serverUrl: "https://voice.example.test",
      candidateToken: "test-token",
      dispatchId: "test-dispatch",
    });
    try {
      const created = await new InterviewService({} as LlmClient).create(
        "https://github.com/example/project",
        userId,
      );
      const objectives = initialState(
        [
          {
            id: "flow",
            kind: "OPENING",
            phase: "PROJECT_OVERVIEW",
            topic: "Request flow",
            description: "Trace a request",
            targetEvidence: ["Follows a request"],
            priority: "HIGH",
            status: "NOT_STARTED",
            evidenceIds: [],
            attempts: 0,
          },
        ],
        "mid",
      ).objectives;
      await prisma.interview.update({
        where: { id: created.id },
        data: { status: "ready" },
      });
      await prisma.interviewPlan.create({
        data: {
          interviewId: created.id,
          role: "engineer",
          difficulty: "mid",
          topics: [],
          objectives: objectives as never,
        },
      });
      const before = Date.now();
      await new SessionService({
        ...livekit,
        SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES: 30,
      }).startForInterview(created.id);
      const after = Date.now();
      const runtime = await prisma.interviewRuntime.findUniqueOrThrow({
        where: { interviewId: created.id },
      });
      expect(runtime.deadlineAt.getTime()).toBeGreaterThanOrEqual(
        before + 15 * 60_000,
      );
      expect(runtime.deadlineAt.getTime()).toBeLessThanOrEqual(
        after + 15 * 60_000,
      );
      expect(
        await prisma.interviewMetrics.findUnique({
          where: { interviewId: created.id },
        }),
      ).toMatchObject({ status: "active", mode: "GITHUB" });
    } finally {
      dispatch.mockRestore();
      await prisma.user.delete({ where: { id: userId } });
    }
  },
);
