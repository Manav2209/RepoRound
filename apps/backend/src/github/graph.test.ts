import { expect, test } from "bun:test";
import { RepositoryKnowledge } from "./knowledge.js";
import { deriveRepoGraph, moduleRoot, repoGraphProbe } from "./graph.js";

const SHA = "a".repeat(40);

function knowledge(files: { path: string; content: string }[]) {
  return new RepositoryKnowledge(SHA, files, [], {});
}

const files = [
  {
    path: "package.json",
    content: JSON.stringify({ dependencies: { express: "^4.0.0", zod: "^3" } }),
  },
  { path: "src/database.ts", content: "export const query = () => 1;\n" },
  {
    path: "src/api.ts",
    content:
      'import { query } from "./database";\nimport express from "express";\nimport "./missing";\n',
  },
  { path: "src/server.ts", content: 'import { query } from "./database";\n' },
];

test("relative imports resolve to indexed files with line evidence", () => {
  const graph = deriveRepoGraph(knowledge(files));
  expect(graph.importsOf("src/api.ts")).toEqual([
    expect.objectContaining({
      kind: "IMPORTS",
      from: "src/api.ts",
      to: "src/database.ts",
      specifier: "./database",
      line: 1,
      commitSha: SHA,
    }),
  ]);
  expect(graph.importedBy("src/database.ts").map((e) => e.from).sort()).toEqual([
    "src/api.ts",
    "src/server.ts",
  ]);
});

test("a relative import whose target is not indexed stays unresolved, not invented", () => {
  const graph = deriveRepoGraph(knowledge(files));
  expect(graph.edges.some((e) => e.to === "src/missing.ts")).toBe(false);
  expect(graph.unresolvedImports).toEqual([
    { from: "src/api.ts", specifier: "./missing", line: 3 },
  ]);
});

test("bare imports and manifest dependencies are evidence-only edges", () => {
  const graph = deriveRepoGraph(knowledge(files));
  expect(graph.dependentsOf("express")).toEqual([
    expect.objectContaining({ kind: "IMPORTS_MODULE", from: "src/api.ts", to: "express", line: 2 }),
  ]);
  expect(graph.dependenciesOf("package.json")).toEqual([
    expect.objectContaining({ kind: "DEPENDS", to: "express", version: "^4.0.0" }),
    expect.objectContaining({ kind: "DEPENDS", to: "zod", version: "^3" }),
  ]);
  // No manifest declares react, so no DEPENDS edge is fabricated.
  expect(graph.edges.some((e) => e.kind === "DEPENDS" && e.to === "react")).toBe(false);
});

test("moduleRoot scopes subpath and scoped-package imports", () => {
  expect(moduleRoot("lodash/fp")).toBe("lodash");
  expect(moduleRoot("@scope/pkg/sub")).toBe("@scope/pkg");
});

test("a truncated manifest yields no dependency edges and never throws", () => {
  const graph = deriveRepoGraph(
    knowledge([{ path: "package.json", content: "{ broken json" }]),
  );
  expect(graph.edges).toEqual([]);
});

test("shortestImportPath is bounded and returns null when disconnected", () => {
  const graph = deriveRepoGraph(knowledge(files));
  expect(graph.shortestImportPath("src/server.ts", "src/database.ts", 5)).toEqual([
    "src/server.ts",
    "src/database.ts",
  ]);
  expect(graph.shortestImportPath("src/database.ts", "src/server.ts", 5)).toBeNull();
  expect(graph.shortestImportPath("src/api.ts", "src/server.ts", 5)).toBeNull();
});

test("repoGraphProbe grounds a fact in a verifiable indexed file", () => {
  const probe = repoGraphProbe(knowledge(files), {
    topic: "database access layer",
    description: "design the database access layer and its callers",
  });
  expect(probe?.probeId).toBe("repo.module-hub");
  expect(probe?.fact).toContain("src/database.ts is imported by 2");
  const reference = probe!.excerpts[0]!.reference;
  expect(knowledge(files).validReference(reference)).toBe(true);
});

test("repoGraphProbe returns null (INSUFFICIENT_EVIDENCE) when the index cannot support a fact", () => {
  const probe = repoGraphProbe(knowledge(files), {
    topic: "authentication flow",
    description: "explain the login and session revocation path",
  });
  expect(probe).toBeNull();
});
