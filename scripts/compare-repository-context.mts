import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  GithubScraper,
  isRepositorySource,
  type RepositoryContextMode,
} from "../apps/backend/src/github/github.scraper.js";
import type {
  GithubFile,
  IndexedFile,
} from "../apps/backend/src/github/github.types.js";
import {
  indexSymbols,
  RepositoryKnowledge,
} from "../apps/backend/src/github/knowledge.js";

interface Prompt {
  query: string;
  evidence: { path: string; contains: RegExp }[];
}

const projects: { name: string; prompts: Prompt[] }[] = [
  {
    name: "Predix",
    prompts: [
      {
        query: "Redis stream XACK after Postgres commit duplicate event",
        evidence: [
          {
            path: "internal/dbworker/worker.go",
            contains: /crash between commit and XACK/,
          },
        ],
      },
      {
        query: "Engine replay command log Redis event emission recovery",
        evidence: [
          {
            path: "internal/engine/replay.go",
            contains: /Event emission is suppressed/,
          },
        ],
      },
    ],
  },
  {
    name: "lovable-v0",
    prompts: [
      {
        query: "Redis consumer XACK handler failure dead letter delivery",
        evidence: [
          {
            path: "packages/shared-redis/index.ts",
            contains: /await this\.client\.xAck/,
          },
        ],
      },
      {
        query: "Kubernetes preview readiness readyz health probe supervisor",
        evidence: [
          {
            path: "apps/orchestator/src/handler/projectResources.ts",
            contains: /readinessProbe.*readyz/,
          },
          { path: "apps/serve/src/health.ts", contains: /readyz/ },
        ],
      },
    ],
  },
  {
    name: "Meetmind",
    prompts: [
      {
        query: "Recording container transcription queue Redis consumer BLPOP",
        evidence: [
          {
            path: "apps/docker-manager/src/index.ts",
            contains: /TRANSCRIPTION_QUEUE,/,
          },
          {
            path: "apps/media-processing/src/index.ts",
            contains: /TRANSCRIBE_QUEUE,/,
          },
          {
            path: "apps/transcribe-service/src/index.ts",
            contains: /blPop\(TRANSCRIPTION_QUEUE/,
          },
        ],
      },
      {
        query: "Transcript embedding status recording fails after summary",
        evidence: [
          {
            path: "apps/transcribe-service/src/index.ts",
            contains: /embeddingStatus: "FAILED"/,
          },
        ],
      },
    ],
  },
];

interface GitFile extends GithubFile {
  oid: string;
}

function readSnapshot(root: string) {
  const gitDir = resolve(root, ".git");
  const git = (args: string[], input?: string) =>
    execFileSync("git", [`--git-dir=${gitDir}`, ...args], {
      input,
      maxBuffer: 32 * 1024 * 1024,
    });
  const sha = git(["rev-parse", "HEAD"]).toString().trim();
  const tree: GitFile[] = git(["ls-tree", "-rzl", sha])
    .toString()
    .split("\0")
    .flatMap((entry) => {
      const match = /^100[0-7]+\s+blob\s+(\S+)\s+(\d+)\t(.*)$/s.exec(entry);
      return match
        ? [{ oid: match[1]!, size: Number(match[2]), path: match[3]! }]
        : [];
    });
  const files = tree.filter(
    (file) => file.size <= 256_000 && isRepositorySource(file.path),
  );
  const data = git(
    ["cat-file", "--batch"],
    files.map((file) => file.oid + "\n").join(""),
  );
  const contents = new Map<string, string>();
  let offset = 0;
  for (const { oid, path, size } of files) {
    const end = data.indexOf(10, offset);
    if (end < 0 || data.toString("utf8", offset, end) !== `${oid} blob ${size}`)
      throw new Error(`Git blob did not match its tree entry for ${path}`);
    const start = end + 1;
    contents.set(path, data.toString("utf8", start, start + size));
    offset = start + size + 1;
  }
  return { sha, tree, contents };
}

function percentile(samples: number[], p: number): number {
  return Number(
    samples
      .sort((a, b) => a - b)
      [Math.ceil(samples.length * p) - 1]!.toFixed(2),
  );
}

async function compare(root: string, project: (typeof projects)[number]) {
  const { sha, tree, contents } = readSnapshot(root);
  const variants = [];
  for (const mode of ["current", "diverse", "offline"] as const) {
    let requests = 0;
    let bytes = 0;
    const prepSamples: number[] = [];
    async function prepare(): Promise<IndexedFile[]> {
      if (mode === "offline")
        return [...contents].map(([path, content]) => ({ path, content }));
      requests = 0;
      bytes = 0;
      const scraper = new GithubScraper({}, mode, async (request) => {
        requests++;
        const url = new URL(request);
        if (url.hostname === "raw.githubusercontent.com") {
          const path = url.pathname
            .split("/")
            .slice(4)
            .map(decodeURIComponent)
            .join("/");
          const content = contents.get(path);
          if (content === undefined) return new Response(null, { status: 404 });
          bytes += Buffer.byteLength(content);
          return new Response(content);
        }
        if (url.pathname.includes("/commits/")) return Response.json({ sha });
        if (url.pathname.includes("/git/trees/")) {
          return Response.json({
            tree: tree.map(({ path, size }) => ({ path, size, type: "blob" })),
          });
        }
        if (url.pathname.endsWith("/languages")) return Response.json({});
        return Response.json({
          default_branch: "main",
          description: null,
          language: null,
          size: 1,
        });
      });
      return (await scraper.scrape("local", "snapshot")).sources ?? [];
    }

    let knowledge: RepositoryKnowledge;
    async function prepareKnowledge() {
      const started = performance.now();
      const files = await prepare();
      const prepared = new RepositoryKnowledge(
        sha,
        files,
        indexSymbols(files),
        {},
      );
      prepSamples.push(performance.now() - started);
      return prepared;
    }
    knowledge = await prepareKnowledge();
    for (let i = 0; i < 12; i++) knowledge = await prepareKnowledge();
    const searchSamples: number[] = [];
    const searchMode: RepositoryContextMode =
      mode === "current" ? "current" : "diverse";
    const prompts = project.prompts.map(({ query, evidence }) => {
      let hits = knowledge.search(query, searchMode);
      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        hits = knowledge.search(query, searchMode);
        searchSamples.push(performance.now() - started);
      }
      return {
        query,
        filesIndexed: evidence.filter((target) =>
          knowledge.files.some((file) => file.path === target.path),
        ).length,
        evidenceFound: evidence.filter((target) =>
          hits.some(
            (hit) =>
              hit.reference.path === target.path &&
              target.contains.test(hit.content),
          ),
        ).length,
        evidenceExpected: evidence.length,
        excerpts: hits.map(
          ({ reference: { path, startLine, endLine } }) =>
            `${path}:${startLine}-${endLine}`,
        ),
      };
    });
    variants.push({
      mode,
      files: knowledge.files.length,
      mockedGithubRequests: mode === "offline" ? undefined : requests,
      mockedSourceBytes: mode === "offline" ? undefined : bytes,
      inMemoryIndexP95Ms: percentile(prepSamples.slice(1), 0.95),
      searchP95Ms: percentile(searchSamples, 0.95),
      prompts,
    });
  }
  return { repo: project.name, sha, variants };
}

const roots = process.argv.slice(2);
if (roots.length !== projects.length)
  throw new Error(
    "Pass three local Git working directories in order: Predix, lovable-v0, Meetmind",
  );
for (const [index, project] of projects.entries()) {
  console.log(JSON.stringify(await compare(roots[index]!, project), null, 2));
}
