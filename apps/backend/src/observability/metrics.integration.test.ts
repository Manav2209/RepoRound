import { expect, test } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import { createTestUser } from "../../test-fixtures/database.js";
import { readUserMetrics, snapshotInterviewMetrics } from "./metrics.js";
import { createMetricsRouter } from "../api/metrics.js";

const suite = test.skipIf(process.env.RUN_DB_TESTS !== "1");
suite(
  "numeric telemetry survives raw cleanup, stays account-scoped, and is removed with the account",
  async () => {
    const userId = await createTestUser();
    const otherId = await createTestUser();
    const interviewId = `metrics_${randomUUID()}`;
    try {
      await prisma.interview.create({
        data: {
          id: interviewId,
          userId,
          mode: "SYSTEM_DESIGN",
          status: "completed",
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await prisma.interviewEvent.createMany({
        data: [
          {
            id: randomUUID(),
            interviewId,
            type: "voice.startup",
            payload: {
              durationMs: 12_000,
              intentionalDelayMs: 10_000,
              text: "PRIVATE",
            },
          },
          {
            id: randomUUID(),
            interviewId,
            type: "voice.response_start",
            payload: { durationMs: 4000, turnId: "t1" },
          },
          {
            id: randomUUID(),
            interviewId,
            type: "llm.design_assessment",
            payload: {
              durationMs: 2000,
              tokenUsage: { prompt_tokens: 100, completion_tokens: 20 },
            },
          },
        ],
      });
      await snapshotInterviewMetrics(interviewId);
      expect((await readUserMetrics(userId)).lifecycle.recordedRounds).toBe(1);
      await prisma.interview.delete({ where: { id: interviewId } });
      const stored = await prisma.interviewMetrics.findUniqueOrThrow({
        where: { interviewId },
      });
      expect(JSON.stringify(stored.summary)).not.toContain("PRIVATE");
      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("userId", userId);
        await next();
      });
      app.route("/metrics", createMetricsRouter({}));
      const result = await (await app.request("/metrics")).json();
      expect(result.latency["voice.startup_adjusted"].p50Ms).toBe(2000);
      expect(result.latency["voice.response_start"].p50Ms).toBe(4000);
      expect(result.lifecycle.completionRate).toBe(1);
      const other = new Hono();
      other.use("*", async (c, next) => {
        c.set("userId", otherId);
        await next();
      });
      other.route("/metrics", createMetricsRouter({}));
      expect(
        (await (await other.request("/metrics")).json()).lifecycle
          .recordedRounds,
      ).toBe(0);
      await prisma.user.delete({ where: { id: userId } });
      expect(
        await prisma.interviewMetrics.count({ where: { interviewId } }),
      ).toBe(0);
    } finally {
      await prisma.user.deleteMany({
        where: { id: { in: [userId, otherId] } },
      });
    }
  },
);
