import { expect, test } from "bun:test";
import { RepositoryKnowledge, indexSymbols } from "./knowledge.js";
import {
  GithubScraper,
  safeRepositoryPath,
  selectRepositoryFiles,
} from "./github.scraper.js";

test("repository tools return bounded excerpts pinned to the fetched commit", () => {
  const sha = "a".repeat(40);
  const files = [
    {
      path: "src/server.ts",
      content: "export function route() {\n  return cache.get('key');\n}\n",
    },
    { path: "package.json", content: '{"dependencies":{"redis":"^5.0.0"}}' },
  ];
  const knowledge = new RepositoryKnowledge(
    sha,
    files,
    indexSymbols(files),
    {},
  );
  const excerpt = knowledge.getFile("src/server.ts", 2, 1)!;
  expect(excerpt.content).toBe("2:   return cache.get('key');");
  expect(excerpt.reference).toEqual({
    path: "src/server.ts",
    commitSha: sha,
    startLine: 2,
    endLine: 2,
  });
  expect(knowledge.getSymbol("route")[0]!.reference.path).toBe("src/server.ts");
  expect(knowledge.search("cache").length).toBe(1);
  expect(knowledge.getDependency("redis")[0]!.version).toBe("^5.0.0");
  expect(knowledge.validReference({ ...excerpt.reference, endLine: 500 })).toBe(
    false,
  );
  expect(
    knowledge.validReference({
      ...excerpt.reference,
      commitSha: "b".repeat(40),
    }),
  ).toBe(false);
  expect(() => knowledge.getFile("../.env")).toThrow("Unsafe");
  expect(knowledge.getFile("src/missing.ts")).toBeNull();
});

test("repository paths and URLs reject traversal, secrets, credentials and other hosts", () => {
  for (const path of [
    "../foo",
    "src/../.env",
    "src\\server.ts",
    ".env.local",
    "keys/signing.pem",
    "node_modules/foo.js",
    "/etc/passwd",
  ])
    expect(safeRepositoryPath(path)).toBe(false);
  for (const url of [
    "http://github.com/a/b",
    "https://example.com/a/b",
    "https://user:pass@github.com/a/b",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/b?x=1",
  ])
    expect(() => GithubScraper.parseGithubUrl(url)).toThrow();
  expect(
    GithubScraper.parseGithubUrl("https://github.com/example/project.git").url,
  ).toBe("https://github.com/example/project");
});

test("diverse sampling leaves room for source across services in manifest-heavy repos", () => {
  const tree = [
    ...Array.from({ length: 24 }, (_, i) => `packages/tool-${i}/package.json`),
    "apps/api/src/main.ts",
    "apps/api/src/worker.test.ts",
    "apps/worker/src/consumer.ts",
    "apps/worker/src/.env",
  ].map((path) => ({ path, size: 1_000 }));

  expect(
    selectRepositoryFiles(tree, "current").every((file) =>
      file.path.endsWith("/package.json"),
    ),
  ).toBe(true);
  const chosen = selectRepositoryFiles(tree, "diverse").map(
    (file) => file.path,
  );
  expect(chosen).toHaveLength(24);
  expect(chosen).toContain("apps/api/src/main.ts");
  expect(chosen).toContain("apps/worker/src/consumer.ts");
  expect(chosen).not.toContain("apps/worker/src/.env");
});

test("topic lookup matches camel-cased symbols and returns bounded source locations", () => {
  const files = [
    {
      path: "src/preview.ts",
      content: "export function previewReadiness() {\n  return true;\n}",
    },
    { path: "src/other.ts", content: "// How does this work?" },
  ];
  const knowledge = new RepositoryKnowledge(
    "a".repeat(40),
    files,
    indexSymbols(files),
    {},
  );
  const hits = knowledge.search("How does preview readiness work?", "diverse");
  expect(hits).toHaveLength(1);
  expect(hits[0]?.content).toContain("previewReadiness");
  expect(knowledge.validReference(hits[0]!.reference)).toBe(true);
});
