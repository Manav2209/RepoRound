import { expect, test } from "bun:test";
import type { ArchitectureSnapshot } from "@repo/voice-types";
import { initialSystemDesignState } from "../schemas.js";
import { getProblem } from "../../system-design/problems.js";
import { introQuestion } from "./system-design.js";

test("the opening asks about a connection in the submitted revision", () => {
  const problem = getProblem("notification-system")!;
  const state = initialSystemDesignState({
    problemId: problem.id,
    activeRevision: 1,
    objectives: [],
  });
  const snapshot: ArchitectureSnapshot = {
    schemaVersion: 1,
    nodes: [
      {
        id: "api",
        position: { x: 0, y: 0 },
        data: { componentType: "api_service", label: "Public API" },
      },
      {
        id: "queue",
        position: { x: 100, y: 0 },
        data: { componentType: "message_queue", label: "Delivery Queue" },
      },
    ],
    edges: [{ id: "route", source: "api", target: "queue" }],
  };
  const question = introQuestion(state, problem, snapshot);
  expect(question.text).toContain("Public API to Delivery Queue");
  expect(question.revision).toBe(1);
  expect(question.concern).toBe("FLOW");
});
