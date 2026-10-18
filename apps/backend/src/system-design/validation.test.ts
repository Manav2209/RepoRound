import { expect, test } from "bun:test";
import { normalizeSnapshot } from "./validation.js";
import type { ArchitectureSnapshot } from "@repo/voice-types";

function snapshot(
  overrides: Partial<ArchitectureSnapshot> = {},
): ArchitectureSnapshot {
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
        data: { componentType: "api_service", label: "API" },
      },
    ],
    edges: [{ id: "e1", source: "client", target: "api" }],
    ...overrides,
  } as ArchitectureSnapshot;
}

test("canonical snapshot strips UI-only fields and preserves topology", () => {
  const input = {
    schemaVersion: 1,
    nodes: [
      {
        id: "client",
        position: { x: 0, y: 0, zoom: 2 },
        data: { componentType: "client", label: " Web ", selected: true },
        selected: true,
        dragging: false,
      },
      {
        id: "api",
        position: { x: 200, y: 0 },
        data: { componentType: "api_service", label: "API" },
      },
    ],
    edges: [{ id: "e1", source: "client", target: "api", animated: true }],
  };
  const canonical = normalizeSnapshot(input);
  expect(canonical).toEqual({
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
        data: { componentType: "api_service", label: "API" },
      },
    ],
    edges: [{ id: "e1", source: "client", target: "api" }],
  });
});

test("snapshots referencing missing endpoints are rejected", () => {
  expect(() =>
    normalizeSnapshot(
      snapshot({ edges: [{ id: "e1", source: "client", target: "ghost" }] }),
    ),
  ).toThrow();
});

test("self-loops, duplicate pairs and undersized graphs are rejected", () => {
  expect(() =>
    normalizeSnapshot(
      snapshot({ edges: [{ id: "e1", source: "api", target: "api" }] }),
    ),
  ).toThrow();

  const node = snapshot().nodes[0]!;
  expect(() =>
    normalizeSnapshot(
      snapshot({
        nodes: [node],
        edges: [{ id: "e1", source: "client", target: "client" }],
      }),
    ),
  ).toThrow();

  expect(() => normalizeSnapshot(snapshot({ edges: [] }))).toThrow();
});

test("a terminal provider node with zero outdegree is valid", () => {
  const canonical = normalizeSnapshot({
    schemaVersion: 1,
    nodes: [
      {
        id: "worker",
        position: { x: 0, y: 0 },
        data: { componentType: "worker", label: "Worker" },
      },
      {
        id: "sms",
        position: { x: 200, y: 0 },
        data: { componentType: "external_service", label: "SMS Provider" },
      },
    ],
    edges: [{ id: "e1", source: "worker", target: "sms" }],
  });
  expect(canonical.nodes).toHaveLength(2);
  expect(canonical.edges).toHaveLength(1);
});
