import { describe, expect, test } from "bun:test";
import type { ArchitectureSnapshot } from "@repo/voice-types";
import { diffArchitectureSnapshots } from "./diff.js";

function snapshot(): ArchitectureSnapshot {
  return {
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
      {
        id: "queue",
        position: { x: 200, y: 0 },
        data: { componentType: "message_queue", label: "Queue" },
      },
    ],
    edges: [
      { id: "api-db", source: "api", target: "db" },
      { id: "db-queue", source: "db", target: "queue" },
    ],
  };
}

describe("architecture revision diff", () => {
  test("positions alone are not material", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.nodes[0]!.position = { x: 900, y: 400 };
    const diff = diffArchitectureSnapshots(before, after, 1, 2);
    expect(diff.material).toBe(false);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.edges.added).toEqual([]);
  });

  test("reports node and edge changes with labels and kinds", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.nodes[1]!.data.label = "Primary database";
    after.nodes[2]!.data.componentType = "worker";
    after.nodes.push({
      id: "cache",
      position: { x: 300, y: 0 },
      data: { componentType: "cache", label: "Redirect cache" },
    });
    after.edges[0] = { id: "api-db", source: "cache", target: "db" };

    const diff = diffArchitectureSnapshots(before, after, 1, 2);
    expect(diff.material).toBe(true);
    expect(diff.nodes.added).toEqual([
      {
        id: "cache",
        label: "Redirect cache",
        componentType: "cache",
      },
    ]);
    expect(diff.nodes.relabeled).toEqual([
      { id: "db", before: "Database", after: "Primary database" },
    ]);
    expect(diff.nodes.retyped).toEqual([
      {
        id: "queue",
        before: "message_queue",
        after: "worker",
      },
    ]);
    expect(diff.edges.reconnected).toEqual([
      {
        edgeId: "api-db",
        before: { source: "api", target: "db" },
        after: { source: "cache", target: "db" },
      },
    ]);
  });

  test("added and removed edges are sorted and material", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.edges = [
      { id: "z", source: "queue", target: "api" },
      { id: "a", source: "api", target: "queue" },
    ];
    const diff = diffArchitectureSnapshots(before, after, 3, 4);
    expect(diff.material).toBe(true);
    expect(diff.edges.added).toEqual([
      { source: "api", target: "queue" },
      { source: "queue", target: "api" },
    ]);
    expect(diff.edges.removed).toEqual([
      { source: "api", target: "db" },
      { source: "db", target: "queue" },
    ]);
  });
});
